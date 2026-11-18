"""
Draws a city's regions from hand-drawn inputs, for a city with no neighbourhood data of its own (#6013).

Some cities have no neighbourhood polygons anywhere (no OSM neighbourhoods, no open-data layer, a census tract or two),
so ``onboard_city.py`` makes the whole city one region, which is too big for missions and completion to mean much.
This draws regions a resident would recognise, from the street build ``onboard_city.py`` already wrote:

1. **Streets to regions.** A rough polygon per region (``--zones``; sloppy edges are fine) claims every street whose
   midpoint it holds. A divide road (``--divide-road "Central Avenue:south"``) goes instead to the zone a short step
   to the named side of each of its pieces, so the road the regions meet along belongs to one of them per stretch
   rather than flipping with where its midpoint happens to fall.
2. **Blocks, not points.** The streets, the city edge and any ``--dividers`` lines (a freeway, a river, a road's line
   carried across open ground) cut the city into faces. Each face goes to the region owning most of the side-street
   length around and inside it; divide roads only break ties, so the block behind a row of side streets follows them.
   Then every street claims a strip along itself for its own region, divide roads last. A border therefore runs
   alongside a road, ``--strip-m`` off its centreline. Tiling by the nearest street point instead draws borders that
   zigzag between side-street ends and grow thin wedges where two regions' streets meet at a junction.
3. **Checks.** The regions must tile the city; no street may leave its region by more than the build's 30 m heal
   (a longer piece would become a street of its own); no named street may switch region and back again; each
   ``--landmark`` must lie in the region named after it; no region may be empty.

It reads ``db/onboarding/<city-id>/<city-id>_qa.gpkg`` (``qgis_road``, ``city_boundary``, and ``osm_way`` for the
street names) and writes ``regions_drawn.geojson`` beside it, the input for the next build:

    make draw-regions id=evansdale-ia args="--zones zones.geojson --dividers dividers.geojson \\
        --divide-road 'Gilbert Drive:south' --divide-road 'Central Avenue:south' --landmark 'Bunger=-92.2747,42.4716'"
    make build-city-data id=evansdale-ia args="--place 'Evansdale, Iowa, USA' \\
        --regions-file db/onboarding/evansdale-ia/regions_drawn.geojson --regions-source '...'"

When a check fails it writes ``regions_drawn.rejected.geojson`` instead, for a look in QGIS, and exits 1. The method,
its pitfalls and a worked example are in ``docs/onboarding-a-city.md`` → "No neighbourhood data: draw your own".
"""
import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
import networkx as nx
import shapely
from shapely.geometry import Point, mapping

sys.path.insert(0, str(Path(__file__).resolve().parent))
from onboard_city import valid_city_id  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_NAME = 'regions_drawn.geojson'
REJECTED_NAME = 'regions_drawn.rejected.geojson'
SIDES = {'north': (0.0, 1.0), 'south': (0.0, -1.0), 'east': (1.0, 0.0), 'west': (-1.0, 0.0)}
# A divide road counts this much per metre when a face's owner is picked: enough to settle a face no side street
# reaches, too little to outvote one.
DIVIDE_ROAD_WEIGHT = 0.01
# onboard_city.py's --heal-segment-m default: a street piece shorter than this that strays over a region edge is
# joined back to its street by the build; a longer one would be cut off as a street of its own.
HEAL_M = 30.0


def parse_divide_road(value):
    """
    argparse type for ``--divide-road``: ``"<OSM street name>:<side>"``, the side being the region that owns it.

    Args:
        value: The flag's text, e.g. ``"Central Avenue:south"``.

    Returns:
        A ``(name, side)`` pair.

    Raises:
        argparse.ArgumentTypeError: when there is no ``:`` or the side is not north, south, east or west.
    """
    name, sep, side = value.rpartition(':')
    side = side.strip().lower()
    if not sep or not name.strip() or side not in SIDES:
        raise argparse.ArgumentTypeError(f'"{value}" — use "<street name>:<north|south|east|west>".')
    return name.strip(), side


def parse_landmark(value):
    """
    argparse type for ``--landmark``: ``"<region name>=<lon>,<lat>"``, a place the region is named after.

    Args:
        value: The flag's text, e.g. ``"Bunger=-92.2747,42.4716"``.

    Returns:
        A ``(region name, lon, lat)`` triple.

    Raises:
        argparse.ArgumentTypeError: when the text does not have that shape.
    """
    region, sep, where = value.partition('=')
    try:
        lon, lat = (float(part) for part in where.split(','))
    except ValueError:
        lon = None
    if not sep or not region.strip() or lon is None:
        raise argparse.ArgumentTypeError(f'"{value}" — use "<region name>=<lon>,<lat>".')
    return region.strip(), lon, lat


def street_names(osm_ids, way_names):
    """
    The OSM names a built street carries, from the ways it was cut from.

    Args:
        osm_ids:   The street's ``qgis_road.osm_ids``, comma-separated way ids.
        way_names: ``{osm_way_id: name}`` from the GeoPackage's ``osm_way`` layer; unnamed ways are absent.

    Returns:
        A frozenset of names, empty for a street on unnamed ways.
    """
    ids = (int(part) for part in str(osm_ids).split(',') if part.strip())
    return frozenset(way_names[i] for i in ids if i in way_names)


def zone_at(point, zones):
    """
    The zone holding a point, or the nearest one when the rough zones leave it uncovered.

    Args:
        point: A shapely Point, in the zones' CRS.
        zones: ``{region name: Polygon}``.

    Returns:
        A region name.
    """
    for name, zone in zones.items():
        if zone.contains(point):
            return name
    return min(zones, key=lambda name: zones[name].distance(point))


def assign_streets(streets, names, zones, divide_roads, offset_m=30.0):
    """
    Gives every street a region: a divide road by the zone to its owning side, any other street by its midpoint.

    Args:
        streets:      Street LineStrings in a metric CRS.
        names:        The frozenset of OSM names of each street (:func:`street_names`), aligned with ``streets``.
        zones:        ``{region name: rough Polygon}`` in the same CRS.
        divide_roads: ``[(name, side)]``; a street carrying two of the names follows the first listed.
        offset_m:     How far to the side the zone is looked up; past the road's own strip, short of the next block.

    Returns:
        A ``(regions, is_divide)`` pair of lists aligned with ``streets``.
    """
    regions, is_divide = [], []
    for line, street in zip(streets, names):
        mid = line.interpolate(0.5, normalized=True)
        side = next((side for name, side in divide_roads if name in street), None)
        if side is None:
            regions.append(zone_at(mid, zones))
        else:
            dx, dy = SIDES[side]
            regions.append(zone_at(Point(mid.x + dx * offset_m, mid.y + dy * offset_m), zones))
        is_divide.append(side is not None)
    return regions, is_divide


def absorb_fragments(geoms):
    """
    Keeps each region's largest piece and hands every other piece to the neighbour it shares the longest edge with.

    Clipping to a concave city edge, or a strip cutting a corner, can leave a region in pieces.

    Args:
        geoms: ``{region name: (Multi)Polygon}``.

    Returns:
        ``{region name: Polygon}``; a piece that touches no other region (an island of the city) joins the nearest.
    """
    main = {name: max(shapely.get_parts(geom), key=lambda part: part.area) for name, geom in geoms.items()}
    orphans = [part for name, geom in geoms.items() for part in shapely.get_parts(geom) if not part.equals(main[name])]
    stalled = 0
    while orphans:
        piece = orphans.pop(0)
        shared = {name: piece.boundary.intersection(geom.buffer(0.05)).length for name, geom in main.items()}
        best = max(shared, key=shared.get)
        if shared[best] == 0 and stalled <= len(orphans):
            orphans.append(piece)   # Touches only another orphan for now; retry once that one is absorbed.
            stalled += 1
            continue
        if shared[best] == 0:
            best = min(main, key=lambda name: main[name].distance(piece))
        main[best] = shapely.union_all([main[best], piece])
        stalled = 0
    return main


def block_regions(streets, regions, is_divide, boundary, dividers=(), strip_m=15.0):
    """
    Tiles the city from its blocks, so every border runs along a street (step 2 of the module docstring).

    Args:
        streets:   Street LineStrings in a metric CRS.
        regions:   Each street's region name, aligned with ``streets``.
        is_divide: Whether each street is a divide road, aligned with ``streets``.
        boundary:  The city (Multi)Polygon, same CRS.
        dividers:  Lines that cut faces but belong to no region.
        strip_m:   Half-width of the strip each street claims for its own region.

    Returns:
        ``{region name: Polygon}`` for every region in ``regions``, tiling ``boundary``.
    """
    names = list(dict.fromkeys(regions))
    # Snap-rounded to 1 cm: noded in floating point, a street lying along the city edge or a divider is noded
    # differently on two machines (93 faces on one, 94 on another for Evansdale; 111 snapped, on both), and a face
    # that fails to close merges with its neighbour and can change owner.
    lines = shapely.union_all([line.intersection(boundary) for line in streets]
                              + [boundary.boundary] + [line.intersection(boundary) for line in dividers],
                              grid_size=0.01)
    faces = [face for face in shapely.get_parts(shapely.polygonize(shapely.get_parts(lines))) if face.area > 1]
    tree = shapely.STRtree(streets)
    geoms = {name: [] for name in names}
    unowned = []
    for face in faces:
        reach = face.buffer(1.0)
        weight = {}
        for i in tree.query(reach, predicate='intersects'):
            share = streets[i].intersection(reach).length * (DIVIDE_ROAD_WEIGHT if is_divide[i] else 1.0)
            weight[regions[i]] = weight.get(regions[i], 0.0) + share
        if weight:
            geoms[max(weight, key=weight.get)].append(face)
        else:
            unowned.append(face)
    geoms = {name: shapely.union_all(parts) for name, parts in geoms.items()}
    for face in unowned:   # Ground no street reaches: the neighbour it shares most edge with.
        best = max(names, key=lambda name: face.boundary.intersection(geoms[name].buffer(0.5)).length)
        geoms[best] = shapely.union_all([geoms[best], face])
    for divide_pass in (False, True):
        for line, region, divide in zip(streets, regions, is_divide):
            if divide != divide_pass:
                continue
            strip = line.buffer(strip_m, cap_style='flat').intersection(boundary)
            for name in names:
                geoms[name] = geoms[name].union(strip) if name == region else geoms[name].difference(strip)
    return absorb_fragments({name: geom.buffer(0) for name, geom in geoms.items()})


def stray_pieces(streets, regions, geoms, boundary):
    """
    How far each street strays out of its own region, inside the city.

    Args:
        streets:  Street LineStrings in a metric CRS.
        regions:  Each street's region name.
        geoms:    ``{region name: Polygon}``.
        boundary: The city (Multi)Polygon.

    Returns:
        A list aligned with ``streets``: the length of the longest piece outside the street's region, 0 when none.
    """
    out = []
    for line, region in zip(streets, regions):
        stray = line.intersection(boundary).difference(geoms[region].buffer(0.5))
        out.append(max((part.length for part in shapely.get_parts(stray)), default=0.0))
    return out


def weaving_streets(streets, names, regions):
    """
    Named streets that leave a region and come back to it, which reads as a border weaving across the road.

    A street is checked one connected run at a time (two separate "2nd Avenue"s are two runs): a run weaves when one
    region's pieces of it fall into more than one stretch.

    Args:
        streets: Street LineStrings in a metric CRS.
        names:   Each street's frozenset of OSM names.
        regions: Each street's region name.

    Returns:
        A sorted list of the names that weave.
    """
    graphs = {}
    for line, street, region in zip(streets, names, regions):
        ends = [tuple(round(v) for v in line.coords[i]) for i in (0, -1)]
        for name in street:
            graphs.setdefault(name, nx.MultiGraph()).add_edge(*ends, region=region)
    weave = set()
    for name, graph in graphs.items():
        for run in nx.connected_components(graph):
            edges = list(graph.subgraph(run).edges(keys=True, data='region'))
            for region in {data for *_, data in edges}:
                stretch = graph.edge_subgraph([(u, v, k) for u, v, k, data in edges if data == region])
                if nx.number_connected_components(stretch) > 1:
                    weave.add(name)
    return sorted(weave)


def check_regions(streets, names, regions, geoms, boundary, landmarks, heal_m=HEAL_M):
    """
    Every check of step 3 of the module docstring, as messages.

    Args:
        streets:   Street LineStrings in a metric CRS.
        names:     Each street's frozenset of OSM names.
        regions:   Each street's region name.
        geoms:     ``{region name: Polygon}``.
        boundary:  The city (Multi)Polygon.
        landmarks: ``[(region name, Point)]`` in the same CRS.
        heal_m:    The longest stray piece the build reattaches to its street.

    Returns:
        A list of problems, empty when the regions are fit to build with.
    """
    problems = []
    union = shapely.union_all(list(geoms.values()))
    overlap = sum(geom.area for geom in geoms.values()) - union.area
    # The faces are snapped to 1 cm (block_regions), so the city edge may be off by up to that much all the way round.
    tolerance = 0.01 * boundary.length + 1e-6 * boundary.area
    if union.symmetric_difference(boundary).area > tolerance or overlap > tolerance:
        problems.append('the regions do not tile the city (gaps or overlaps)')
    for name in geoms:
        if name not in regions:
            problems.append(f'region "{name}" holds no street: fold its zone into a neighbour')
    for line, street, stray in zip(streets, names, stray_pieces(streets, regions, geoms, boundary)):
        if stray >= heal_m:
            label = ' / '.join(sorted(street)) or 'an unnamed street'
            problems.append(f'{label} leaves its region for {stray:.0f} m; the build would cut it into a street of '
                            f'its own (move a zone edge or a divider off it)')
    for name in weaving_streets(streets, names, regions):
        problems.append(f'{name} switches region and back again: give it a --divide-road side, or redraw the zones')
    for region, point in landmarks:
        inside = [name for name, geom in geoms.items() if geom.contains(point)]
        if inside != [region]:
            problems.append(f'landmark for "{region}" lies in {inside or "no region"}')
    return problems


def summary_rows(regions, lengths_m, order):
    """
    The per-region street count and km, in the zones' order.

    Args:
        regions:   Each street's region name.
        lengths_m: Each street's geodesic length (``qgis_road.length_m``).
        order:     Region names in output order.

    Returns:
        ``[(name, streets, km)]``.
    """
    rows = []
    for name in order:
        picked = [length for region, length in zip(regions, lengths_m) if region == name]
        rows.append((name, len(picked), round(sum(picked) / 1000, 2)))
    return rows


def feature_collection(geoms, rows, crs):
    """
    The regions as GeoJSON in lon/lat, each with its street count and km, for ``onboard_city.py --regions-file``.

    Args:
        geoms: ``{region name: Polygon}`` in ``crs``.
        rows:  :func:`summary_rows` output.
        crs:   The CRS of ``geoms``.

    Returns:
        A GeoJSON FeatureCollection dict.
    """
    features = []
    for name, streets, km in rows:
        geom = gpd.GeoSeries([shapely.set_precision(geoms[name], 0.01)], crs=crs).to_crs(4326).iloc[0]
        features.append({'type': 'Feature', 'properties': {'name': name, 'streets': streets, 'km': km},
                         'geometry': mapping(geom)})
    return {'type': 'FeatureCollection', 'features': features}


def parse_args(argv=None):
    """Parses the command line (the module docstring describes each input)."""
    parser = argparse.ArgumentParser(description='Draw regions for a city with no neighbourhood data (#6013).')
    parser.add_argument('--city-id', required=True, type=valid_city_id,
                        help='Reads db/onboarding/<city-id>/<city-id>_qa.gpkg and writes regions_drawn.geojson there.')
    parser.add_argument('--zones', required=True, type=Path,
                        help='Rough region polygons with a name column (any OGR format); their order is the output '
                             'order.')
    parser.add_argument('--zone-name-col', default='name', help='The zones\' name column (default: name).')
    parser.add_argument('--divide-road', action='append', default=[], type=parse_divide_road,
                        help='"<OSM street name>:<north|south|east|west>": the road belongs to the region on that '
                             'side. Repeatable.')
    parser.add_argument('--dividers', type=Path,
                        help='Lines that divide regions where no street does: a freeway, a river, a road\'s line '
                             'carried across open ground.')
    parser.add_argument('--landmark', action='append', default=[], type=parse_landmark,
                        help='"<region name>=<lon>,<lat>": the place a region is named after must lie in it. '
                             'Repeatable.')
    parser.add_argument('--strip-m', type=float, default=15.0,
                        help='How far a border sits from the road it runs along (default 15).')
    return parser.parse_args(argv)


def main(argv=None):
    """
    Reads the build and the hand-drawn inputs, draws and checks the regions, and writes them.

    Returns:
        0 when the regions pass every check, 1 when one fails (the problems are printed).
    """
    args = parse_args(argv)
    city_dir = REPO_ROOT / 'db' / 'onboarding' / args.city_id
    gpkg = city_dir / f'{args.city_id}_qa.gpkg'
    roads = gpd.read_file(gpkg, layer='qgis_road')
    crs = roads.estimate_utm_crs()
    roads = roads.to_crs(crs)
    boundary = gpd.read_file(gpkg, layer='city_boundary').to_crs(crs).geometry.union_all()
    ways = gpd.read_file(gpkg, layer='osm_way')
    if 'name' not in ways.columns:
        print(f'error: {gpkg.name} has no street names on its osm_way layer; rebuild it with this checkout\'s '
              f'onboard_city.py.')
        return 1
    way_names = {int(i): name for i, name in zip(ways['osm_way_id'], ways['name']) if isinstance(name, str)}
    zones_frame = gpd.read_file(args.zones).to_crs(crs)
    zones = dict(zip(zones_frame[args.zone_name_col].astype(str), zones_frame.geometry))
    dividers = list(gpd.read_file(args.dividers).to_crs(crs).geometry) if args.dividers else []
    unknown = sorted({name for name, _ in args.divide_road} - set(way_names.values()))
    if unknown:   # A misspelt divide road would otherwise be zoned by its midpoint without a word.
        print(f'error: no street is named {", ".join(unknown)}; names must match OSM exactly.')
        return 1
    streets = list(roads.geometry)
    names = [street_names(ids, way_names) for ids in roads['osm_ids']]
    regions, is_divide = assign_streets(streets, names, zones, args.divide_road)
    geoms = block_regions(streets, regions, is_divide, boundary, dividers, args.strip_m)
    landmarks = [(region, gpd.GeoSeries([Point(lon, lat)], crs=4326).to_crs(crs).iloc[0])
                 for region, lon, lat in args.landmark]
    problems = check_regions(streets, names, regions, geoms, boundary, landmarks)
    rows = summary_rows(regions, roads['length_m'], list(zones))
    print(f'{"region":<24} {"streets":>7} {"km":>6}')
    for name, count, km in rows:
        print(f'{name:<24} {count:>7} {km:>6.2f}')
    out = city_dir / (REJECTED_NAME if problems else OUTPUT_NAME)
    out.write_text(json.dumps(feature_collection(geoms, rows, crs)))
    if problems:
        # A passing file from an earlier run would otherwise sit beside the rejection, ready to be built with.
        (city_dir / OUTPUT_NAME).unlink(missing_ok=True)
        print(f'\n{len(problems)} problem(s); wrote {out.name} for a look in QGIS, not for a build:')
        for problem in problems:
            print(f'  - {problem}')
        return 1
    print(f'\nWrote {out}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
