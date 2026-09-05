"""
Unit tests for tools/build_city_streets.py, the headless replacement for the QGIS steps of the new-city runbook
(#4291).

The geometry rules are what these pin, because they are the part whose output is hard to check after the fact: a
way is split only where it meets another *included* way, a sub-threshold piece is merged back into its own way
without closing it into a ring (#4717), and a street straddling a neighborhood boundary is cut only when both
sides survive the cut. The SQL writer and the argument validation are covered end to end through `build`, with
Overpass stubbed, so nothing here touches the network.
"""

import json
import math

import pytest
from shapely.geometry import LineString, Polygon

import build_city_streets as bcs


# --------------------------------------------------------------------------------------------------------------------
# Distance
# --------------------------------------------------------------------------------------------------------------------

def test_haversine_matches_a_known_degree_of_latitude():
    # One degree of latitude is ~111.19 km on a sphere of the radius the module uses.
    assert bcs.haversine_m((0.0, 0.0), (0.0, 1.0)) == pytest.approx(math.pi / 180 * bcs.EARTH_RADIUS_M, rel=1e-9)
    assert bcs.haversine_m((5.0, 43.0), (5.0, 43.0)) == 0.0


def test_geodesic_length_sums_vertex_to_vertex():
    line = LineString([(0.0, 0.0), (0.0, 0.001), (0.0, 0.002)])
    assert bcs.geodesic_length_m(line) == pytest.approx(2 * bcs.haversine_m((0.0, 0.0), (0.0, 0.001)))
    assert bcs.geodesic_length_m(LineString([(0.0, 0.0), (0.0, 0.0)])) == 0.0


# --------------------------------------------------------------------------------------------------------------------
# Region-name quality report (#4620)
# --------------------------------------------------------------------------------------------------------------------

def test_check_region_names_flags_each_defect_once():
    warnings = bcs.check_region_names(["Petit Bayonne", "SAINT ESPRIT", "grand bayonne", " Marracq", "A  B",
                                       "", "Nul\x01", "Dupe", "Dupe", "Dupe"])
    joined = "; ".join(warnings)
    assert "ALL CAPS: 'SAINT ESPRIT'" in joined
    assert "all lowercase: 'grand bayonne'" in joined
    assert "stray whitespace in ' Marracq'" in joined
    assert "stray whitespace in 'A  B'" in joined
    assert "empty region name" in joined
    assert "control character" in joined
    # Three copies of one name are one warning, not three.
    assert sum(1 for w in warnings if "duplicate name" in w) == 1
    # A well-formed name earns no warning at all.
    assert "Petit Bayonne" not in joined


def test_check_region_names_leaves_a_short_acronym_alone():
    # The ALL CAPS rule needs >= 5 characters, so a genuinely short name isn't nagged about.
    assert bcs.check_region_names(["ZAC"]) == []


# --------------------------------------------------------------------------------------------------------------------
# Splitting at intersections
# --------------------------------------------------------------------------------------------------------------------

def _way(way_id, nodes, coords, highway="residential"):
    return {"type": "way", "id": way_id, "nodes": nodes, "tags": {"highway": highway},
            "geometry": [{"lon": x, "lat": y} for x, y in coords]}


def test_split_only_where_two_included_ways_share_a_node():
    # Way 1 runs west to east through node 2; way 2 touches it there, so way 1 is cut in two.
    ways = [_way(1, [1, 2, 3], [(0.0, 0.0), (0.001, 0.0), (0.002, 0.0)]),
            _way(2, [2, 9], [(0.001, 0.0), (0.001, 0.001)])]
    segments = bcs.split_at_intersections(ways)
    assert [(s["osm_id"], s["nodes"]) for s in segments] == [(1, [1, 2]), (1, [2, 3]), (2, [2, 9])]


def test_a_node_no_other_way_uses_is_not_a_split():
    ways = [_way(1, [1, 2, 3], [(0.0, 0.0), (0.001, 0.0), (0.002, 0.0)])]
    segments = bcs.split_at_intersections(ways)
    assert len(segments) == 1 and segments[0]["nodes"] == [1, 2, 3]


def test_a_way_that_revisits_a_node_is_not_split_on_itself():
    # A closed loop repeats its first node at the end; that repeat must not read as an intersection.
    ways = [_way(1, [1, 2, 3, 1], [(0.0, 0.0), (0.001, 0.0), (0.001, 0.001), (0.0, 0.0)])]
    assert len(bcs.split_at_intersections(ways)) == 1


# --------------------------------------------------------------------------------------------------------------------
# Tier-1 merge of tiny same-way pieces (#4717)
# --------------------------------------------------------------------------------------------------------------------

def _seg(osm_id, nodes, coords):
    return {"osm_id": osm_id, "highway": "residential", "nodes": nodes, "coords": coords}


def _stats():
    from collections import defaultdict
    s = defaultdict(float)
    s.update(tier1_merged=0)
    return s


def test_a_short_piece_is_absorbed_into_its_own_way():
    # ~11 m stub followed by a ~111 m run, both from way 1.
    short = _seg(1, [1, 2], [(0.0, 0.0), (0.0, 0.0001)])
    long = _seg(1, [2, 3], [(0.0, 0.0001), (0.0, 0.0011)])
    stats = _stats()
    merged = bcs.merge_tiny_same_way([short, long], 20.0, stats)
    assert len(merged) == 1
    assert merged[0]["nodes"] == [1, 2, 3]
    assert merged[0]["coords"] == [(0.0, 0.0), (0.0, 0.0001), (0.0, 0.0011)]
    assert stats["tier1_merged"] == 1


def test_a_short_piece_of_another_way_is_left_alone():
    short = _seg(1, [1, 2], [(0.0, 0.0), (0.0, 0.0001)])
    other = _seg(2, [2, 3], [(0.0, 0.0001), (0.0, 0.0011)])
    stats = _stats()
    assert len(bcs.merge_tiny_same_way([short, other], 20.0, stats)) == 2
    assert stats["tier1_merged"] == 0


def test_a_merge_that_would_close_the_way_into_a_ring_is_skipped():
    # Two short arcs of a roundabout that meet at both ends: merging them makes a street whose ends coincide,
    # which the app's end-of-street check can't read.
    a = _seg(1, [1, 2], [(0.0, 0.0), (0.0, 0.0001)])
    b = _seg(1, [2, 1], [(0.0, 0.0001), (0.0, 0.0)])
    stats = _stats()
    assert len(bcs.merge_tiny_same_way([a, b], 20.0, stats)) == 2
    assert stats["tier1_merged"] == 0


def test_merging_is_off_at_zero():
    segments = [_seg(1, [1, 2], [(0.0, 0.0), (0.0, 0.0001)]), _seg(1, [2, 3], [(0.0, 0.0001), (0.0, 0.0011)])]
    assert bcs.merge_tiny_same_way(segments, 0.0, _stats()) is segments


# --------------------------------------------------------------------------------------------------------------------
# Region assignment (#4717 phase 3)
# --------------------------------------------------------------------------------------------------------------------

_WEST = Polygon([(0.0, -1.0), (0.001, -1.0), (0.001, 1.0), (0.0, 1.0)])
_EAST = Polygon([(0.001, -1.0), (0.003, -1.0), (0.003, 1.0), (0.001, 1.0)])
_REGIONS = [(1, _WEST), (2, _EAST)]


def test_a_street_inside_one_region_goes_there_whole():
    line = LineString([(0.0002, 0.0), (0.0008, 0.0)])
    stats = _stats()
    assert bcs.assign_regions(line, _REGIONS, 20.0, 50.0, stats) == [(1, line)]


def test_a_street_is_cut_at_the_boundary_when_both_sides_survive():
    # ~110 m either side of the boundary at x = 0.001.
    line = LineString([(0.0, 0.0), (0.002, 0.0)])
    stats = _stats()
    parts = bcs.assign_regions(line, _REGIONS, 20.0, 50.0, stats)
    assert sorted(rid for rid, _ in parts) == [1, 2]
    assert stats["boundary_cuts"] == 1
    assert stats["kept_whole_across_boundary"] == 0


def test_a_boundary_sliver_keeps_the_street_whole_in_its_majority_region():
    # Only ~1 m pokes into the west region, so cutting would leave a piece too short to be a street.
    line = LineString([(0.00099, 0.0), (0.003, 0.0)])
    stats = _stats()
    assert bcs.assign_regions(line, _REGIONS, 20.0, 50.0, stats) == [(2, line)]
    assert stats["kept_whole_across_boundary"] == 1
    assert stats["kept_whole_spill_m"] > 0


def test_a_street_just_outside_every_region_attaches_to_the_nearest():
    line = LineString([(0.0031, 0.0), (0.0032, 0.0)])  # ~8 m east of the east region
    stats = _stats()
    assert bcs.assign_regions(line, _REGIONS, 20.0, 50.0, stats) == [(2, line)]
    assert stats["outside_attached"] == 1


def test_a_street_far_outside_every_region_is_dropped():
    line = LineString([(0.01, 0.0), (0.0101, 0.0)])  # ~780 m east
    stats = _stats()
    assert bcs.assign_regions(line, _REGIONS, 20.0, 50.0, stats) == []
    assert stats["outside_dropped"] == 1
    assert stats["outside_dropped_m"] > 0


# --------------------------------------------------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------------------------------------------------

def test_explode_lines_keeps_only_line_parts():
    from shapely.geometry import GeometryCollection, MultiLineString, Point
    line = LineString([(0.0, 0.0), (1.0, 0.0)])
    assert bcs.explode_lines(line) == [line]
    assert bcs.explode_lines(MultiLineString([line])) == [line]
    assert bcs.explode_lines(GeometryCollection([line, Point(0.0, 0.0)])) == [line]
    assert bcs.explode_lines(Point(0.0, 0.0)) == []
    assert bcs.explode_lines(LineString()) == []


def test_load_polygons_repairs_a_self_intersecting_ring(tmp_path):
    bowtie = {"type": "FeatureCollection", "features": [{
        "properties": {"nom": "Bowtie"},
        "geometry": {"type": "Polygon",
                     "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}}]}
    path = tmp_path / "regions.geojson"
    path.write_text(json.dumps(bowtie), encoding="utf-8")
    (props, geom), = bcs.load_polygons(path)
    assert props == {"nom": "Bowtie"}
    assert geom.is_valid


def test_load_polygons_rejects_a_non_polygon(tmp_path):
    path = tmp_path / "lines.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": [{
        "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}}]}), encoding="utf-8")
    with pytest.raises(SystemExit):
        bcs.load_polygons(path)


def test_sql_literal_doubles_an_apostrophe():
    assert bcs.sql_literal("Saint-Esprit") == "'Saint-Esprit'"
    assert bcs.sql_literal("L'Ourse") == "'L''Ourse'"


def test_wkt_truncates_to_seven_decimals():
    assert bcs.wkt(LineString([(1.123456789, 2.0), (3.0, 4.0)])) == "LINESTRING (1.1234567 2, 3 4)"


# --------------------------------------------------------------------------------------------------------------------
# build() end to end, with Overpass stubbed
# --------------------------------------------------------------------------------------------------------------------

def _geojson(tmp_path, name, polygons, props=None):
    features = [{"properties": p, "geometry": {"type": "Polygon", "coordinates": [list(poly)]}}
                for poly, p in zip(polygons, props or [{} for _ in polygons])]
    path = tmp_path / name
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    return path


_SQUARE = [(0.0, 0.0), (0.004, 0.0), (0.004, 0.004), (0.0, 0.004), (0.0, 0.0)]


def _args(tmp_path, **overrides):
    boundary = _geojson(tmp_path, "boundary.geojson", [_SQUARE])
    regions = _geojson(tmp_path, "regions.geojson", [_SQUARE], [{"name": "Centre"}])
    return bcs.parse_args([
        "--boundary", str(boundary), "--regions", str(regions), "--out", str(tmp_path / "out.sql"),
        *sum(([f"--{k.replace('_', '-')}", str(v)] for k, v in overrides.items()), []),
    ])


def test_build_writes_loadable_sql(tmp_path, monkeypatch, capsys):
    ways = [_way(1, [1, 2], [(0.001, 0.002), (0.003, 0.002)])]
    monkeypatch.setattr(bcs, "fetch_ways", lambda *a, **kw: ways)
    assert bcs.build(_args(tmp_path)) == 0
    sql = (tmp_path / "out.sql").read_text(encoding="utf-8")
    assert "CREATE TABLE qgis_region (region_id integer PRIMARY KEY, name text NOT NULL" in sql
    assert "INSERT INTO qgis_region VALUES (1, 'Centre'," in sql
    assert sql.count("INSERT INTO qgis_road VALUES") == 1
    assert "'residential'" in sql
    assert sql.startswith("-- Generated by tools/build_city_streets.py")
    assert sql.rstrip().endswith("COMMIT;")
    out = capsys.readouterr().out
    assert "1 streets" in out
    assert "Tutorial region for fill-new-schema: 1 (Centre)" in out


def test_build_rejects_a_region_name_prop_that_is_not_an_identifier(tmp_path, monkeypatch):
    # And does so before the fetch: a stub that would fail the test if reached.
    monkeypatch.setattr(bcs, "fetch_ways", lambda *a, **kw: pytest.fail("fetched before validating the arguments"))
    with pytest.raises(SystemExit, match="lowercase SQL identifier"):
        bcs.build(_args(tmp_path, region_name_prop="Nom; DROP TABLE"))


def test_build_rejects_a_tutorial_region_that_does_not_exist(tmp_path, monkeypatch):
    monkeypatch.setattr(bcs, "fetch_ways", lambda *a, **kw: pytest.fail("fetched before validating the arguments"))
    with pytest.raises(SystemExit, match="not one of the 1..1 regions"):
        bcs.build(_args(tmp_path, tutorial_region=2))


def test_build_says_so_when_nothing_survived_the_clip(tmp_path, monkeypatch):
    # A way well outside the boundary: the clip leaves nothing, which is the shape a wrong CRS produces.
    monkeypatch.setattr(bcs, "fetch_ways", lambda *a, **kw: [_way(1, [1, 2], [(9.0, 9.0), (9.001, 9.0)])])
    with pytest.raises(SystemExit, match="No street survived clipping"):
        bcs.build(_args(tmp_path))


def test_build_rejects_an_empty_boundary(tmp_path, monkeypatch):
    monkeypatch.setattr(bcs, "fetch_ways", lambda *a, **kw: pytest.fail("fetched before validating the arguments"))
    args = _args(tmp_path)
    degenerate = [(0.0, 0.0), (0.0, 0.0), (0.0, 0.0), (0.0, 0.0)]
    args.boundary = _geojson(tmp_path, "flat.geojson", [degenerate])
    with pytest.raises(SystemExit, match="the boundary is empty"):
        bcs.build(args)


# --------------------------------------------------------------------------------------------------------------------
# Overpass fetch
# --------------------------------------------------------------------------------------------------------------------

class _Response:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


def _capture_posts(monkeypatch, responses):
    """Stubs requests.post with a queue of responses, recording the query each call sent."""
    posts = []

    def post(url, data, headers, timeout):
        posts.append({"url": url, "query": data["data"], "headers": headers})
        return responses[len(posts) - 1]

    monkeypatch.setattr(bcs.requests, "post", post)
    monkeypatch.setattr(bcs.time, "sleep", lambda _: None)
    return posts


def test_fetch_ways_asks_overpass_for_the_selected_highway_types(monkeypatch):
    posts = _capture_posts(monkeypatch, [_Response(200, {"elements": [{"id": 1}]})])
    elements = bcs.fetch_ways((-1.5, 43.4, -1.4, 43.5), ("residential", "primary"), False, None, bcs.OVERPASS_URL)
    assert elements == [{"id": 1}]
    query = posts[0]["query"]
    assert '["highway"~"^(residential|primary)$"]' in query
    assert "(43.4,-1.5,43.5,-1.4)" in query  # Overpass orders a bbox south,west,north,east.
    assert "service" not in query
    assert posts[0]["headers"]["User-Agent"] == bcs.USER_AGENT


def test_fetch_ways_opts_alleys_in_with_a_second_selector(monkeypatch):
    posts = _capture_posts(monkeypatch, [_Response(200, {"elements": []})])
    bcs.fetch_ways((-1.5, 43.4, -1.4, 43.5), ("residential",), True, None, bcs.OVERPASS_URL)
    assert '["highway"="service"]["service"="alley"]' in posts[0]["query"]


def test_fetch_ways_backs_off_and_retries_a_throttled_overpass(monkeypatch):
    posts = _capture_posts(monkeypatch, [_Response(429), _Response(504), _Response(200, {"elements": [{"id": 7}]})])
    assert bcs.fetch_ways((0, 0, 1, 1), ("residential",), False, None, bcs.OVERPASS_URL) == [{"id": 7}]
    assert len(posts) == 3


def test_fetch_ways_gives_up_on_an_error_that_is_not_a_back_off(monkeypatch):
    _capture_posts(monkeypatch, [_Response(400, text="bad query")])
    with pytest.raises(SystemExit, match="Overpass returned HTTP 400"):
        bcs.fetch_ways((0, 0, 1, 1), ("residential",), False, None, bcs.OVERPASS_URL)


def test_fetch_ways_gives_up_after_the_last_retry(monkeypatch):
    _capture_posts(monkeypatch, [_Response(429)] * 4)
    with pytest.raises(SystemExit, match="Overpass returned HTTP 429"):
        bcs.fetch_ways((0, 0, 1, 1), ("residential",), False, None, bcs.OVERPASS_URL)


def test_fetch_ways_writes_a_cache_and_reuses_it_without_the_network(tmp_path, monkeypatch):
    cache = tmp_path / "osm.json"
    posts = _capture_posts(monkeypatch, [_Response(200, {"elements": [{"id": 3}]})])
    assert bcs.fetch_ways((0, 0, 1, 1), ("residential",), False, cache, bcs.OVERPASS_URL) == [{"id": 3}]
    assert json.loads(cache.read_text(encoding="utf-8")) == {"elements": [{"id": 3}]}

    monkeypatch.setattr(bcs.requests, "post", lambda **kw: pytest.fail("re-fetched despite a warm cache"))
    assert bcs.fetch_ways((0, 0, 1, 1), ("residential",), False, cache, bcs.OVERPASS_URL) == [{"id": 3}]
    assert len(posts) == 1


def test_build_drops_a_city_edge_stub(tmp_path, monkeypatch, capsys):
    # A way running from well inside the boundary to well outside it: the clip leaves a ~5 m stub crossing the
    # eastern edge at x = 0.004, under the 20 m --edge-stub-m default.
    ways = [_way(1, [1, 2], [(0.00396, 0.002), (0.006, 0.002)])]
    monkeypatch.setattr(bcs, "fetch_ways", lambda *a, **kw: ways)
    with pytest.raises(SystemExit, match="No street survived clipping"):
        bcs.build(_args(tmp_path))
    assert "City-edge stubs under 20 m dropped" not in capsys.readouterr().out  # It exits before the summary.


def test_build_keeps_a_long_enough_piece_that_crosses_the_city_edge(tmp_path, monkeypatch, capsys):
    # Same shape but ~110 m inside the boundary, so the clipped piece clears --edge-stub-m and is kept.
    ways = [_way(1, [1, 2], [(0.003, 0.002), (0.006, 0.002)])]
    monkeypatch.setattr(bcs, "fetch_ways", lambda *a, **kw: ways)
    assert bcs.build(_args(tmp_path)) == 0
    assert "City-edge stubs under 20 m dropped: 0" in capsys.readouterr().out


def test_build_reports_a_badly_formatted_region_name_on_stderr(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(bcs, "fetch_ways", lambda *a, **kw: [_way(1, [1, 2], [(0.001, 0.002), (0.003, 0.002)])])
    args = _args(tmp_path)
    args.regions = _geojson(tmp_path, "shouty.geojson", [_SQUARE], [{"name": "GRAND BAYONNE"}])
    assert bcs.build(args) == 0
    assert "WARNING region name: ALL CAPS: 'GRAND BAYONNE'" in capsys.readouterr().err
