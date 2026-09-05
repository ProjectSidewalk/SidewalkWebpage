#!/usr/bin/env python3.13
"""Build the ``qgis_road`` / ``qgis_region`` staging tables for a new city from OSM and a boundary dataset.

This is the headless counterpart of the QGIS steps in the wiki's "Creating database for a new city" runbook
(#4291): it fetches the city's streets from OpenStreetMap, splits them at intersections, clips them to the city
boundary, assigns each piece to a neighborhood, and writes one SQL file that creates and fills the two staging
tables ``db/scripts/fill-new-schema.sh`` consumes. Nothing touches the database directly -- review the summary it
prints, load the SQL as the city's role, then run ``make fill-new-schema``.

Two rules keep the result free of the tiny street segments that plague older imports (#4717):

* a way is split only where it meets another *included* way, so a footpath crossing a street does not cut it;
* a piece shorter than ``--merge-tiny-m`` (20 m) is merged back into the adjacent piece of the same OSM way, so a
  roundabout's exit-to-exit arcs and the stubs between a dual carriageway's links become one street each;
* a street that straddles a neighborhood boundary is cut there only when both resulting parts are at least
  ``--min-split-m`` long (20 m by default); otherwise it stays whole and goes to the neighborhood that holds most of
  its length. Pieces shorter than ``--edge-stub-m`` left over from clipping to the city boundary are dropped.

Usage (from the repo root, inside the web container, whose python3.13 has shapely + requests)::

    python3.13 tools/build_city_streets.py --boundary city.geojson --regions quartiers.geojson \\
        --region-name-prop nom --out /tmp/city_staging.sql --cache /tmp/city_osm.json
    docker exec -i projectsidewalk-db psql -v ON_ERROR_STOP=1 -U sidewalk_<city> -d sidewalk < /tmp/city_staging.sql
    make fill-new-schema        # answer: way_type column "highway", region name column = --region-name-prop

Both GeoJSON inputs must be in WGS 84 (EPSG:4326); the regions file needs one feature per neighborhood with a name
property. Region ids are assigned in file order starting at 1, road ids likewise, so the tutorial region prompt in
``fill-new-schema.sh`` refers to the first feature unless you pass ``--tutorial-region``.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import requests
from shapely.geometry import LineString, MultiPolygon, Polygon, shape
from shapely.ops import unary_union

# The wiki's default road classes. Alleys (highway=service + service=alley) are opt-in, as in the QGIS flow.
DEFAULT_HIGHWAY_TYPES = (
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "residential",
    "unclassified",
    "pedestrian",
    "living_street",
)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "ProjectSidewalk-build-city-streets/1.0 (sidewalk@cs.uw.edu)"
EARTH_RADIUS_M = 6_371_008.8


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in metres between two (lng, lat) points."""
    lng1, lat1, lng2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(d))


def geodesic_length_m(line: LineString) -> float:
    """Length of a WGS 84 linestring in metres, summed vertex to vertex (matches ST_Length(geom::geography)
    closely enough for thresholds; the app itself measures geodesically, per CLAUDE.md)."""
    coords = list(line.coords)
    return sum(haversine_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def load_polygons(path: Path) -> list[tuple[dict, Polygon | MultiPolygon]]:
    """Read a GeoJSON FeatureCollection of (Multi)Polygons, repairing invalid rings with buffer(0)."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for feature in data["features"]:
        geom = shape(feature["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        if geom.geom_type not in ("Polygon", "MultiPolygon"):
            raise SystemExit(f"{path}: expected polygons, got {geom.geom_type}")
        out.append((feature.get("properties") or {}, geom))
    return out


def check_region_names(names: list[str]) -> list[str]:
    """Flag names that look poorly formatted (#4620): ALL CAPS, all lowercase, stray whitespace, empty, control
    characters, duplicates. Returns human-readable warnings; the caller decides whether to stop."""
    warnings = []
    seen = Counter(names)
    for name in names:
        if not name or not name.strip():
            warnings.append("empty region name")
            continue
        if name != name.strip() or "  " in name:
            warnings.append(f"stray whitespace in {name!r}")
        letters = [c for c in name if c.isalpha()]
        if letters and all(c.isupper() for c in letters) and len(name) >= 5:
            warnings.append(f"ALL CAPS: {name!r}")
        if letters and all(c.islower() for c in letters):
            warnings.append(f"all lowercase: {name!r}")
        if re.search(r"[\x00-\x1f\x7f]", name):
            warnings.append(f"control character in {name!r}")
        if seen[name] > 1:
            warnings.append(f"duplicate name: {name!r}")
            seen[name] = 0  # report once
    return warnings


def fetch_ways(bbox: tuple[float, float, float, float], highway_types: tuple[str, ...], include_alleys: bool,
               cache: Path | None, overpass_url: str) -> list[dict]:
    """Fetch the included OSM ways (with node ids and geometry) inside ``bbox``, caching the raw response so a re-run
    needs no network. bbox is (min_lng, min_lat, max_lng, max_lat)."""
    if cache and cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))["elements"]
    s, w, n, e = bbox[1], bbox[0], bbox[3], bbox[2]
    types = "|".join(highway_types)
    selectors = [f'way["highway"~"^({types})$"]["area"!="yes"]({s},{w},{n},{e});']
    if include_alleys:
        selectors.append(f'way["highway"="service"]["service"="alley"]({s},{w},{n},{e});')
    query = "[out:json][timeout:300];(" + "".join(selectors) + ");out geom;"
    for attempt in range(4):
        response = requests.post(overpass_url, data={"data": query}, headers={"User-Agent": USER_AGENT}, timeout=330)
        if response.status_code == 200:
            break
        # 429/504 are Overpass telling us to back off; anything else is a real error.
        if response.status_code not in (429, 504) or attempt == 3:
            raise SystemExit(f"Overpass returned HTTP {response.status_code}: {response.text[:300]}")
        time.sleep(30 * (attempt + 1))
    payload = response.json()
    if cache:
        cache.write_text(json.dumps(payload), encoding="utf-8")
    return payload["elements"]


def split_at_intersections(ways: list[dict]) -> list[dict]:
    """Cut each way at every interior node it shares with another included way -- the topological equivalent of QGIS
    "Split with lines" run over the filtered roads layer. Returns dicts with osm_id, highway, coords."""
    node_uses: Counter[int] = Counter()
    for way in ways:
        # A node repeated inside the same way (a loop) counts once, so a self-touching way is not split on itself.
        node_uses.update(set(way["nodes"]))
    segments = []
    for way in ways:
        nodes, geometry = way["nodes"], way["geometry"]
        cut_indices = [0] + [i for i in range(1, len(nodes) - 1) if node_uses[nodes[i]] > 1] + [len(nodes) - 1]
        for start, end in zip(cut_indices, cut_indices[1:]):
            coords = [(p["lon"], p["lat"]) for p in geometry[start:end + 1]]
            if len(coords) >= 2:
                segments.append({"osm_id": way["id"], "highway": way["tags"]["highway"], "coords": coords,
                                 "nodes": nodes[start:end + 1]})
    return segments


def merge_tiny_same_way(segments: list[dict], max_len_m: float, stats: dict) -> list[dict]:
    """Absorb segments shorter than ``max_len_m`` into an adjacent segment of the same OSM way (#4717 tier 1).

    Two pieces of one way meet head-to-tail at the intersection node that split them, so the merge is a plain
    concatenation and the result still follows the way's own geometry. A merge that would close the way into a ring
    (the last two arcs of a roundabout) is skipped, because a street whose two ends coincide confuses the app's
    end-of-street check. Repeats until nothing short remains that has a same-way neighbour.
    """
    if max_len_m <= 0:
        return segments
    segments = [dict(s) for s in segments]
    alive = [True] * len(segments)
    by_start: dict[tuple[int, int], int] = {}
    by_end: dict[tuple[int, int], int] = {}
    for i, seg in enumerate(segments):
        by_start[(seg["osm_id"], seg["nodes"][0])] = i
        by_end[(seg["osm_id"], seg["nodes"][-1])] = i
    changed = True
    while changed:
        changed = False
        for i, seg in enumerate(segments):
            if not alive[i] or geodesic_length_m(LineString(seg["coords"])) >= max_len_m:
                continue
            key_prev = (seg["osm_id"], seg["nodes"][0])
            key_next = (seg["osm_id"], seg["nodes"][-1])
            prev_i = by_end.get(key_prev)
            next_i = by_start.get(key_next)
            candidates = [j for j in (prev_i, next_i) if j is not None and j != i and alive[j]]
            # Skip a neighbour whose merge would close a loop; prefer the shorter neighbour to keep lengths even.
            candidates = [j for j in candidates
                          if (segments[j]["nodes"][0] if j == prev_i else seg["nodes"][0])
                          != (seg["nodes"][-1] if j == prev_i else segments[j]["nodes"][-1])]
            if not candidates:
                continue
            j = min(candidates, key=lambda k: geodesic_length_m(LineString(segments[k]["coords"])))
            first, second = (segments[j], seg) if j == prev_i else (seg, segments[j])
            merged = {"osm_id": seg["osm_id"], "highway": seg["highway"],
                      "coords": first["coords"] + second["coords"][1:], "nodes": first["nodes"] + second["nodes"][1:]}
            alive[j] = False
            segments[i] = merged
            by_start[(merged["osm_id"], merged["nodes"][0])] = i
            by_end[(merged["osm_id"], merged["nodes"][-1])] = i
            stats["tier1_merged"] += 1
            changed = True
    return [seg for seg, keep in zip(segments, alive) if keep]


def explode_lines(geom) -> list[LineString]:
    """Flatten a (Multi)LineString / GeometryCollection into its LineString parts, dropping points."""
    if geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if geom.geom_type in ("MultiLineString", "GeometryCollection"):
        return [part for sub in geom.geoms for part in explode_lines(sub)]
    return []


def assign_regions(line: LineString, regions: list[tuple[int, Polygon | MultiPolygon]], min_split_m: float,
                   outside_tolerance_m: float, stats: dict) -> list[tuple[int, LineString]]:
    """Attach a street piece to one or more regions per the #4717 rule.

    Returns (region_id, geometry) pairs: several when the street is cut at a boundary and every part clears
    ``min_split_m``; one (the whole line, to the majority region) otherwise; none when the line lies outside every
    region by more than ``outside_tolerance_m``.
    """
    by_region: dict[int, list[LineString]] = {}
    for region_id, polygon in regions:
        if not line.intersects(polygon):
            continue
        parts = explode_lines(line.intersection(polygon))
        if parts:
            by_region[region_id] = parts
    if not by_region:
        nearest = min(regions, key=lambda r: line.distance(r[1]))
        if line.distance(nearest[1]) * 111_000 <= outside_tolerance_m:  # degrees to metres, rough is fine here
            stats["outside_attached"] += 1
            return [(nearest[0], line)]
        stats["outside_dropped"] += 1
        stats["outside_dropped_m"] += geodesic_length_m(line)
        return []
    region_lengths = {rid: sum(geodesic_length_m(p) for p in parts) for rid, parts in by_region.items()}
    if len(by_region) == 1:
        return [(next(iter(by_region)), line)]
    # A pure boundary sliver on either side would make the cut worthless (#4717 phase 3): keep the street whole.
    if all(geodesic_length_m(p) >= min_split_m for parts in by_region.values() for p in parts):
        stats["boundary_cuts"] += 1
        return [(rid, p) for rid, parts in by_region.items() for p in parts]
    majority = max(region_lengths, key=region_lengths.get)
    stats["kept_whole_across_boundary"] += 1
    stats["kept_whole_spill_m"] += sum(v for rid, v in region_lengths.items() if rid != majority)
    return [(majority, line)]


def sql_literal(text: str) -> str:
    """Quote a string for a SQL literal."""
    return "'" + text.replace("'", "''") + "'"


def wkt(geom) -> str:
    """WKT with coordinates truncated to 7 decimals (~1 cm), which keeps the SQL file small."""
    return re.sub(r"(-?\d+\.\d{7})\d+", r"\1", geom.wkt)


def build(args: argparse.Namespace) -> int:
    # Checked before the Overpass fetch and the geometry pass, so a typo costs a second rather than the whole run.
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", args.region_name_prop):
        raise SystemExit(f"--region-name-prop {args.region_name_prop!r} must be a plain lowercase SQL identifier")
    boundary = unary_union([g for _, g in load_polygons(args.boundary)])
    if boundary.is_empty or boundary.area == 0:
        raise SystemExit(f"{args.boundary}: the boundary is empty -- is it WGS 84 (EPSG:4326)?")
    region_features = load_polygons(args.regions)
    if not 1 <= args.tutorial_region <= len(region_features):
        raise SystemExit(f"--tutorial-region {args.tutorial_region} is not one of the 1..{len(region_features)} "
                         f"regions in {args.regions}")
    names = [str(props.get(args.region_name_prop, "")) for props, _ in region_features]
    for warning in check_region_names(names):
        print(f"WARNING region name: {warning}", file=sys.stderr)
    regions = [(i + 1, geom) for i, (_, geom) in enumerate(region_features)]
    region_union = unary_union([g for _, g in regions])
    covered = boundary.intersection(region_union).area / boundary.area * 100
    print(f"{covered:.1f}% of the boundary is covered by the {len(regions)} regions' union; streets in the rest are "
          f"attached to the nearest region within {args.outside_tolerance_m:.0f} m.")

    ways = fetch_ways(boundary.bounds, tuple(args.highway_types), args.include_alleys, args.cache, args.overpass_url)
    ways = [w for w in ways if w.get("type") == "way" and "geometry" in w and "highway" in w.get("tags", {})]
    print(f"{len(ways)} OSM ways fetched in the bounding box.")
    segments = split_at_intersections(ways)
    print(f"{len(segments)} segments after splitting at shared intersections.")
    stats: dict = defaultdict(float)
    stats.update(boundary_cuts=0, kept_whole_across_boundary=0, outside_attached=0, outside_dropped=0,
                 edge_stubs_dropped=0, tier1_merged=0)
    segments = merge_tiny_same_way(segments, args.merge_tiny_m, stats)
    print(f"{stats['tier1_merged']} segments under {args.merge_tiny_m:.0f} m merged into a same-way neighbour "
          f"(#4717 tier 1); {len(segments)} remain.")
    roads: list[tuple[int, int, str, int, LineString]] = []  # road_id, osm_id, highway, region_id, geom
    for seg in segments:
        line = LineString(seg["coords"])
        if not line.intersects(boundary):
            continue
        for piece in explode_lines(line.intersection(boundary)):
            # Clipping at the city limit leaves slivers of streets that mostly run outside the city; the wiki has
            # the operator delete those by hand.
            if not piece.equals(line) and geodesic_length_m(piece) < args.edge_stub_m:
                stats["edge_stubs_dropped"] += 1
                stats["edge_stubs_dropped_m"] += geodesic_length_m(piece)
                continue
            for region_id, geom in assign_regions(piece, regions, args.min_split_m, args.outside_tolerance_m, stats):
                roads.append((len(roads) + 1, seg["osm_id"], seg["highway"], region_id, geom))

    lengths = [geodesic_length_m(r[4]) for r in roads]
    if not lengths:
        raise SystemExit("No street survived clipping to the boundary. Check that both GeoJSON inputs are WGS 84 "
                         "(EPSG:4326) and that the boundary covers the streets --highway-types selects.")
    total_km = sum(lengths) / 1000
    per_region_km = defaultdict(float)
    for road, length in zip(roads, lengths):
        per_region_km[road[3]] += length / 1000
    print(f"\n{len(roads)} streets, {total_km:.1f} km, in {len(regions)} regions "
          f"(median {sorted(lengths)[len(lengths) // 2]:.0f} m per street).")
    print(f"  Cut at a region boundary: {stats['boundary_cuts']}; kept whole across one: "
          f"{stats['kept_whole_across_boundary']} ({stats['kept_whole_spill_m'] / 1000:.2f} km lies outside the "
          f"assigned region).")
    print(f"  Outside every region: {stats['outside_attached']} attached to the nearest, {stats['outside_dropped']} "
          f"dropped ({stats['outside_dropped_m'] / 1000:.2f} km).")
    print(f"  City-edge stubs under {args.edge_stub_m:.0f} m dropped: {stats['edge_stubs_dropped']} "
          f"({stats['edge_stubs_dropped_m'] / 1000:.2f} km).")
    print("  Tiny segments (#4717): "
          + ", ".join(f"< {t} m: {sum(1 for l in lengths if l < t)}" for t in (5, 10, 20)))
    print("\n  region_id  km     name")
    for (region_id, _), name in zip(regions, names):
        print(f"  {region_id:>9}  {per_region_km[region_id]:5.1f}  {name}")
    print(f"\n  Tutorial region for fill-new-schema: {args.tutorial_region} "
          f"({names[args.tutorial_region - 1]}); region name column: {args.region_name_prop}")

    name_col = args.region_name_prop
    lines_out = [
        "-- Generated by tools/build_city_streets.py; load as the city's role, then run `make fill-new-schema`.",
        "BEGIN;",
        "DROP TABLE IF EXISTS qgis_road;",
        "DROP TABLE IF EXISTS qgis_region;",
        f"CREATE TABLE qgis_region (region_id integer PRIMARY KEY, {name_col} text NOT NULL, "
        "geom geometry(MultiPolygon, 4326) NOT NULL);",
    ]
    for (region_id, geom), name in zip(regions, names):
        lines_out.append(f"INSERT INTO qgis_region VALUES ({region_id}, {sql_literal(name)}, "
                         f"ST_Multi(ST_GeomFromText({sql_literal(wkt(geom))}, 4326)));")
    # No FK to qgis_region: fill-new-schema.sh drops qgis_region before qgis_road, and a dependency there would abort
    # its transaction.
    lines_out.append("CREATE TABLE qgis_road (road_id integer PRIMARY KEY, osm_id bigint NOT NULL, highway text NOT "
                     "NULL, region_id integer NOT NULL, geom geometry(LineString, 4326) NOT NULL);")
    for road_id, osm_id, highway, region_id, geom in roads:
        lines_out.append(f"INSERT INTO qgis_road VALUES ({road_id}, {osm_id}, {sql_literal(highway)}, {region_id}, "
                         f"ST_GeomFromText({sql_literal(wkt(geom))}, 4326));")
    lines_out.append("COMMIT;")
    args.out.write_text("\n".join(lines_out) + "\n", encoding="utf-8")
    print(f"\nWrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB).")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--boundary", type=Path, required=True, help="GeoJSON of the city limit (EPSG:4326)")
    parser.add_argument("--regions", type=Path, required=True, help="GeoJSON of the neighborhoods (EPSG:4326)")
    parser.add_argument("--region-name-prop", default="name",
                        help="property holding each neighborhood's name; also the qgis_region column name")
    parser.add_argument("--out", type=Path, required=True, help="SQL file to write")
    parser.add_argument("--cache", type=Path, help="cache the raw Overpass response here and reuse it on re-runs")
    parser.add_argument("--highway-types", nargs="+", default=list(DEFAULT_HIGHWAY_TYPES),
                        help="OSM highway values to include")
    parser.add_argument("--include-alleys", action="store_true", help="also include highway=service + service=alley")
    parser.add_argument("--merge-tiny-m", type=float, default=20.0,
                        help="merge segments shorter than this into an adjacent piece of the same OSM way (0 = off)")
    parser.add_argument("--min-split-m", type=float, default=20.0,
                        help="cut a street at a region boundary only if both parts are at least this long (#4717)")
    parser.add_argument("--edge-stub-m", type=float, default=20.0,
                        help="drop pieces shorter than this that clipping to the city limit leaves behind")
    parser.add_argument("--outside-tolerance-m", type=float, default=50.0,
                        help="attach a street outside every region to the nearest one if within this distance")
    parser.add_argument("--tutorial-region", type=int, default=1, help="region id to report as the tutorial region")
    parser.add_argument("--overpass-url", default=OVERPASS_URL)
    return parser.parse_args(argv)


if __name__ == "__main__":
    sys.exit(build(parse_args()))
