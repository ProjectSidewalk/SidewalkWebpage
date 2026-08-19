"""
Unit tests for scripts/onboard_city.py.

Covers the pure helpers — the Overpass filter builder, osmnx tag flattening/normalization, geodesic measures, the
short-segment and region-stats QA logic, boundary-coverage, and the COPY/EWKB serialization used to build the SQL
load file — plus the I/O layer (fetches, geopackage/SQL/report writers, the CLI, and ``main``) with the network and
osmnx mocked out.

The geo stack (requirements-offline-tools.txt) needs >= 3.11, so the whole module skips on the in-band 3.8 half.
"""

import logging
import sys
from types import SimpleNamespace

import pytest

gpd = pytest.importorskip('geopandas', reason='the geo stack (requirements-offline-tools.txt) needs Python >= 3.11')

from shapely.geometry import LineString, MultiPolygon, Point, Polygon, mapping  # noqa: E402

import onboard_city as oc  # noqa: E402

# A ~1.1 km x ~1.1 km square at the equator (0.01 degrees).
_SQUARE = Polygon([(0, 0), (0.01, 0), (0.01, 0.01), (0, 0.01)])


# --------------------------------------------------------------------------------------------------------------------
# build_osm_filters / flatten_tag / normalize_way_type
# --------------------------------------------------------------------------------------------------------------------

def test_build_osm_filters_covers_default_way_types_only():
    filters = oc.build_osm_filters()
    assert len(filters) == 1
    for way_type in oc.DEFAULT_WAY_TYPES:
        assert way_type in filters[0]
    assert 'alley' not in filters[0]


def test_build_osm_filters_alleys_add_a_second_filter():
    filters = oc.build_osm_filters(include_alleys=True)
    assert len(filters) == 2
    assert '"service"="alley"' in filters[1]


def test_flatten_tag_scalar_passthrough_and_list_head():
    assert oc.flatten_tag(123) == 123
    assert oc.flatten_tag([456, 789]) == 456


def test_normalize_way_type_prefers_an_allowed_value_from_merged_lists():
    assert oc.normalize_way_type('residential') == 'residential'
    # A merged edge listing an unaudited type first still picks the audited one.
    assert oc.normalize_way_type(['track', 'residential']) == 'residential'
    assert oc.normalize_way_type(['service', 'track']) == 'service'
    # Nothing allowed: falls back to the first element rather than failing.
    assert oc.normalize_way_type(['track', 'raceway']) == 'track'


# --------------------------------------------------------------------------------------------------------------------
# Geodesic measures
# --------------------------------------------------------------------------------------------------------------------

def test_geodesic_length_of_a_degree_of_longitude_at_equator():
    # One degree of longitude at the equator is ~111.3 km.
    assert oc.geodesic_length_m(LineString([(0, 0), (1, 0)])) == pytest.approx(111_320, rel=0.01)


def test_geodesic_area_of_small_square():
    # 0.01 x 0.01 degrees at the equator is ~1113 m x ~1106 m.
    assert oc.geodesic_area_m2(_SQUARE) == pytest.approx(1_113 * 1_106, rel=0.01)


def test_boundary_coverage_half_covered():
    half = gpd.GeoDataFrame(geometry=[Polygon([(0, 0), (0.005, 0), (0.005, 0.01), (0, 0.01)])], crs='EPSG:4326')
    assert oc.boundary_coverage(half, _SQUARE) == pytest.approx(0.5, rel=0.01)


# --------------------------------------------------------------------------------------------------------------------
# drop_short_segments / region_street_stats
# --------------------------------------------------------------------------------------------------------------------

def _roads(lengths, region_ids=None):
    region_ids = region_ids or [1] * len(lengths)
    return gpd.GeoDataFrame({
        'length_m': lengths,
        'region_id': region_ids,
        'geometry': [LineString([(0, 0), (0.001, 0)])] * len(lengths),
    }, crs='EPSG:4326')


def test_drop_short_segments_partitions_at_threshold():
    kept, dropped = oc.drop_short_segments(_roads([5, 14.9, 15, 300]), 15)
    assert list(kept['length_m']) == [15, 300]
    assert list(dropped['length_m']) == [5, 14.9]


def test_region_street_stats_flags_oversized_sparse_and_empty():
    regions = gpd.GeoDataFrame({'region_id': [1, 2, 3, 4], 'name': ['big', 'ok', 'tiny', 'none'],
                                'geometry': [_SQUARE] * 4}, crs='EPSG:4326')
    roads = _roads([70_000, 20_000, 100], region_ids=[1, 2, 3])
    stats = oc.region_street_stats(roads, regions, max_region_street_km=60)
    assert list(stats['flag']) == ['OVERSIZED — consider splitting', '', 'SPARSE — consider merging into a neighbor',
                                   'EMPTY — no streets']
    assert stats.loc[stats['region_id'] == 4, 'n_streets'].iloc[0] == 0


# --------------------------------------------------------------------------------------------------------------------
# heal_edge_pieces (region-boundary fragment healing)
# --------------------------------------------------------------------------------------------------------------------

def _piece(region_id, x_start_m, x_end_m):
    """Builds a Piece on the equator running west->east; positions/lengths derive from meters (~111.32 km/degree)."""
    start_deg, end_deg = x_start_m / 111_320, x_end_m / 111_320
    geom = LineString([(start_deg, 0), (end_deg, 0)])
    return oc.Piece(region_id, geom, start_deg, end_deg, oc.geodesic_length_m(geom))


def test_heal_absorbs_mid_street_hole():
    # A short middle fragment in another region (boundary wobble) merges away instead of punching a hole.
    healed = oc.heal_edge_pieces([_piece(1, 0, 100), _piece(2, 100, 110), _piece(1, 110, 230)], heal_m=30)
    assert [piece.region_id for piece in healed] == [1]
    assert healed[0].length_m == pytest.approx(230, rel=0.01)


def test_heal_absorbs_end_stub_into_longer_neighbor():
    healed = oc.heal_edge_pieces([_piece(1, 0, 8), _piece(2, 8, 200)], heal_m=30)
    assert [piece.region_id for piece in healed] == [2]


def test_heal_keeps_genuine_crossing_split():
    healed = oc.heal_edge_pieces([_piece(1, 0, 100), _piece(2, 100, 250)], heal_m=30)
    assert [piece.region_id for piece in healed] == [1, 2]


def test_heal_collapses_alternating_shred():
    shredded = [_piece(1, 0, 5), _piece(2, 5, 9), _piece(1, 9, 15), _piece(2, 15, 315)]
    healed = oc.heal_edge_pieces(shredded, heal_m=30)
    assert [piece.region_id for piece in healed] == [2]
    assert healed[0].length_m == pytest.approx(315, rel=0.01)


def test_heal_never_merges_across_a_gap():
    # The street left every region between 100 m and 150 m (e.g. exited the city): the 10 m tail past the gap has no
    # touching neighbor, so it must survive healing (and be dropped later as an isolated sliver, not absorbed).
    healed = oc.heal_edge_pieces([_piece(1, 0, 100), _piece(1, 150, 160)], heal_m=30)
    assert len(healed) == 2
    assert healed[1].length_m == pytest.approx(10, rel=0.05)


def _edge(x_end_m):
    """An equator-running edge from 0 to ``x_end_m`` meters (in degrees)."""
    return LineString([(0, 0), (x_end_m / 111_320, 0)])


def test_bridge_short_gaps_restores_city_boundary_wobble():
    # The street dipped outside the city between 100 m and 110 m; the missing 10 m comes back from the original
    # geometry and the whole street heals into one piece.
    pieces, n_bridged, restored_m = oc.bridge_short_gaps(
        _edge(200), [_piece(1, 0, 100), _piece(1, 110, 200)], heal_m=30)
    assert n_bridged == 1
    assert restored_m == pytest.approx(10, rel=0.05)
    assert oc.pieces_touch(pieces[0], pieces[1])
    healed = oc.heal_edge_pieces(pieces, heal_m=30)
    assert len(healed) == 1
    assert healed[0].length_m == pytest.approx(200, rel=0.01)


def test_bridge_short_gaps_leaves_long_gaps_cut():
    pieces, n_bridged, restored_m = oc.bridge_short_gaps(
        _edge(300), [_piece(1, 0, 100), _piece(1, 150, 300)], heal_m=30)
    assert (n_bridged, restored_m) == (0, 0)
    assert not oc.pieces_touch(pieces[0], pieces[1])


# A thin coverage strip along the equator (~22 m half-width), standing in for the buffered union of the regions:
# geometry on/near the equator "rides the boundary" of the covered area; geometry pulling away leaves it.
_COVERAGE_STRIP = Polygon([(-0.01, -0.0002), (0.03, -0.0002), (0.03, 0.0002), (-0.01, 0.0002)])


def test_bridge_long_gap_riding_the_coverage_boundary():
    # A 50 m gap (over the 30 m heal threshold) that hugs the covered area is restored anyway — the city-boundary
    # analog of rider merging.
    pieces, n_bridged, restored_m = oc.bridge_short_gaps(
        _edge(300), [_piece(1, 0, 100), _piece(1, 150, 300)], heal_m=30, buffered_coverage=_COVERAGE_STRIP)
    assert n_bridged == 1
    assert restored_m == pytest.approx(50, rel=0.05)
    healed = oc.heal_edge_pieces(pieces, heal_m=30)
    assert len(healed) == 1


def test_bridge_long_gap_pulling_away_stays_cut():
    # Same gap, but the coverage ends at the 100 m mark: the gap leaves the covered area, so it stays cut.
    ends_at_gap = Polygon([(-0.01, -0.0002), (100 / 111_320, -0.0002), (100 / 111_320, 0.0002), (-0.01, 0.0002)])
    pieces, n_bridged, _ = oc.bridge_short_gaps(
        _edge(300), [_piece(1, 0, 100), _piece(1, 150, 300)], heal_m=30, buffered_coverage=ends_at_gap)
    assert n_bridged == 0
    assert not oc.pieces_touch(pieces[0], pieces[1])


def test_restore_boundary_tails_restores_riding_ends():
    # The street's first 60 m and last 40 m fell outside every region but hug the covered area: both come back.
    pieces, n_restored, restored_m = oc.restore_boundary_tails(
        _edge(300), [_piece(1, 60, 260)], _COVERAGE_STRIP)
    assert n_restored == 2
    assert restored_m == pytest.approx(100, rel=0.05)
    assert len(pieces) == 1
    assert pieces[0].region_id == 1
    assert pieces[0].length_m == pytest.approx(300, rel=0.01)


def test_restore_boundary_tails_keeps_genuine_exits_truncated():
    # Coverage ends at the piece: the missing ends pull away from the covered area, so the truncation stands.
    ends_at_piece = Polygon([(60 / 111_320, -0.0002), (260 / 111_320, -0.0002),
                             (260 / 111_320, 0.0002), (60 / 111_320, 0.0002)])
    pieces, n_restored, _ = oc.restore_boundary_tails(_edge(300), [_piece(1, 60, 260)], ends_at_piece)
    assert n_restored == 0
    assert pieces[0].length_m == pytest.approx(200, rel=0.01)


def test_bridge_short_gaps_attaches_gap_to_longer_side():
    # Different regions around the gap: the restored stretch joins the longer piece's region, and the genuine
    # region transition survives healing.
    pieces, n_bridged, _ = oc.bridge_short_gaps(_edge(300), [_piece(1, 0, 100), _piece(2, 110, 300)], heal_m=30)
    assert n_bridged == 1
    healed = oc.heal_edge_pieces(pieces, heal_m=30)
    assert [piece.region_id for piece in healed] == [1, 2]
    assert healed[1].length_m == pytest.approx(200, rel=0.01)


# Regions split by the equator (region 1 north, region 2 south), pre-buffered by ~15 m as absorb_boundary_riders
# expects. A street ON the equator rides both; a street heading north pulls away from region 2.
_TOL_DEG = 15 / 111_320
_BUFFERED_REGIONS = {
    1: Polygon([(-0.1, 0), (0.1, 0), (0.1, 0.1), (-0.1, 0.1)]).buffer(_TOL_DEG),
    2: Polygon([(-0.1, -0.1), (0.1, -0.1), (0.1, 0), (-0.1, 0)]).buffer(_TOL_DEG),
}


def _piece_at(region_id, coords):
    """Builds a Piece from explicit lon/lat coords, positioned by its first coordinate's longitude."""
    geom = LineString(coords)
    return oc.Piece(region_id, geom, coords[0][0], coords[-1][0], oc.geodesic_length_m(geom))


def test_riders_merge_boundary_running_split_to_longer_side():
    # Both pieces sit on the equator (the shared boundary): a boundary-runner split midway merges into one street
    # carrying the longer side's region.
    pieces = [_piece_at(1, [(0, 0), (0.001, 0)]), _piece_at(2, [(0.001, 0), (0.003, 0)])]
    merged, junctions = oc.absorb_boundary_riders(pieces, _BUFFERED_REGIONS)
    assert [piece.region_id for piece in merged] == [2]
    assert len(junctions) == 1
    assert junctions[0].x == pytest.approx(0.001)


def test_riders_absorb_hugging_stub_into_interior_side():
    # The region-2 piece runs along the equator; the region-1 piece dives north, solidly interior. The stub joins
    # the interior side's region even though it's longer than any fragment threshold.
    pieces = [_piece_at(2, [(0, 0), (0.002, 0)]), _piece_at(1, [(0.002, 0), (0.002, 0.004)])]
    merged, junctions = oc.absorb_boundary_riders(pieces, _BUFFERED_REGIONS)
    assert [piece.region_id for piece in merged] == [1]
    assert len(junctions) == 1


def test_riders_keep_genuine_crossing_split():
    # A north-south street crossing the equator: neither side hugs the other's region, so the split survives.
    pieces = [_piece_at(2, [(0, -0.002), (0, 0)]), _piece_at(1, [(0, 0), (0, 0.002)])]
    merged, junctions = oc.absorb_boundary_riders(pieces, _BUFFERED_REGIONS)
    assert [piece.region_id for piece in merged] == [2, 1]
    assert junctions == []


def test_merge_linestrings_dedupes_shared_junction_vertex():
    merged = oc.merge_linestrings(LineString([(0, 0), (1, 0)]), LineString([(1, 0), (2, 0)]))
    assert list(merged.coords) == [(0, 0), (1, 0), (2, 0)]


def test_oriented_piece_reverses_backwards_pieces():
    edge = LineString([(0, 0), (10, 0)])
    geom, start_pos, end_pos = oc.oriented_piece(edge, LineString([(5, 0), (2, 0)]))
    assert list(geom.coords) == [(2, 0), (5, 0)]
    assert (start_pos, end_pos) == (2, 5)


# --------------------------------------------------------------------------------------------------------------------
# parse_merge_spec / merge_regions / validate_staging
# --------------------------------------------------------------------------------------------------------------------

def test_parse_merge_spec_parses_name_pairs():
    assert oc.parse_merge_spec('Census Tract 513:Census Tract 523.01, Downtown:Old Town') == {
        'Census Tract 513': 'Census Tract 523.01', 'Downtown': 'Old Town'}


def test_parse_merge_spec_rejects_bad_input():
    with pytest.raises(SystemExit):
        oc.parse_merge_spec('Downtown')  # No target.
    with pytest.raises(SystemExit):
        oc.parse_merge_spec('Downtown:')  # Empty target.
    with pytest.raises(SystemExit):
        oc.parse_merge_spec('Downtown:Downtown')  # Self-merge.
    with pytest.raises(SystemExit):
        oc.parse_merge_spec('Downtown:East,Downtown:West')  # Repeated source.
    with pytest.raises(SystemExit):
        oc.parse_merge_spec('Downtown:East,East:West')  # Chain: East is both a target and merged away.


def _region_set():
    left = Polygon([(0, 0), (0.01, 0), (0.01, 0.01), (0, 0.01)])
    right = Polygon([(0.01, 0), (0.02, 0), (0.02, 0.01), (0.01, 0.01)])
    return gpd.GeoDataFrame({'region_id': [1, 2], 'name': ['left', 'right'],
                             'geometry': [MultiPolygon([left]), MultiPolygon([right])]}, crs='EPSG:4326')


def test_merge_regions_folds_geometry_and_renumbers_densely():
    regions = _region_set()
    merged = oc.merge_regions(regions, {'left': 'right'})
    # The survivor keeps its name but is renumbered from 2 to 1, and covers both squares.
    assert list(merged['name']) == ['right']
    assert list(merged['region_id']) == [1]
    assert oc.geodesic_area_m2(merged.geometry.iloc[0]) == pytest.approx(
        sum(oc.geodesic_area_m2(geom) for geom in regions.geometry), rel=0.01)


def test_merge_regions_rejects_unknown_names():
    with pytest.raises(SystemExit):
        oc.merge_regions(_region_set(), {'nowhere': 'left'})


def test_validate_staging_passes_good_data():
    regions = _region_set()
    roads = gpd.GeoDataFrame({'road_id': [1, 2], 'osm_id': [11, 22], 'highway': ['residential', 'primary'],
                              'region_id': [1, 2],
                              'geometry': [LineString([(0, 0), (0.001, 0)])] * 2}, crs='EPSG:4326')
    assert oc.validate_staging(roads, regions) == []


def test_validate_staging_catches_broken_edits():
    regions = _region_set()
    roads = gpd.GeoDataFrame({'road_id': [1, 1], 'osm_id': [11, 22], 'highway': ['residential', 'primary'],
                              'region_id': [1, 9],
                              'geometry': [LineString([(0, 0), (0.001, 0)])] * 2}, crs='EPSG:4326')
    errors = oc.validate_staging(roads, regions)
    assert any('duplicate road_id' in error for error in errors)
    assert any('region id(s) [9]' in error for error in errors)


# --------------------------------------------------------------------------------------------------------------------
# SQL serialization helpers
# --------------------------------------------------------------------------------------------------------------------

def test_copy_escape_escapes_copy_metacharacters():
    assert oc.copy_escape('plain name') == 'plain name'
    assert oc.copy_escape('a\tb\nc\\d') == 'a\\tb\\nc\\\\d'


def test_ewkb_hex_embeds_srid_4326():
    hex_ewkb = oc.ewkb_hex(LineString([(0, 0), (1, 1)]))
    # EWKB with an embedded SRID sets the 0x20000000 flag and stores 4326 (0x10E6) little-endian.
    assert hex_ewkb.upper().startswith('0102000020E6100000')


def test_to_multipolygon_promotes_and_passes_through():
    assert isinstance(oc.to_multipolygon(_SQUARE), MultiPolygon)
    multi = MultiPolygon([_SQUARE])
    assert oc.to_multipolygon(multi) is multi


# --------------------------------------------------------------------------------------------------------------------
# Remaining healing branches
# --------------------------------------------------------------------------------------------------------------------

def test_merge_linestrings_keeps_nearby_but_unequal_junction_vertices():
    # Overlay-produced endpoints can differ by float noise; both vertices are kept rather than deduped.
    merged = oc.merge_linestrings(LineString([(0, 0), (1, 0)]), LineString([(1 + 1e-9, 0), (2, 0)]))
    assert len(merged.coords) == 4


def test_bridge_short_gaps_passes_touching_pieces_through():
    pieces, n_bridged, restored_m = oc.bridge_short_gaps(
        _edge(200), [_piece(1, 0, 100), _piece(2, 100, 200)], heal_m=30)
    assert (n_bridged, restored_m) == (0, 0.0)
    assert len(pieces) == 2


def test_bridge_short_gaps_skips_degenerate_gap_geometry():
    # Positions past the edge's end make substring collapse to a Point; there is no gap geometry to restore.
    edge = LineString([(0, 0), (0.001, 0)])
    first = oc.Piece(1, LineString([(0, 0), (0.001, 0)]), 0, 0.001, 111.3)
    second = oc.Piece(1, LineString([(0.005, 0.001), (0.006, 0.001)]), 0.002, 0.003, 111.3)
    pieces, n_bridged, _ = oc.bridge_short_gaps(edge, [first, second], heal_m=1000)
    assert n_bridged == 0
    assert len(pieces) == 2


def test_heal_absorbs_fragment_into_longer_left_neighbor():
    healed = oc.heal_edge_pieces([_piece(1, 0, 120), _piece(2, 120, 130), _piece(1, 130, 230)], heal_m=30)
    assert [piece.region_id for piece in healed] == [1]
    assert healed[0].length_m == pytest.approx(230, rel=0.01)


def test_riders_leave_same_region_pieces_to_coalesce():
    same = [_piece_at(1, [(0, 0), (0.001, 0)]), _piece_at(1, [(0.001, 0), (0.002, 0)])]
    merged, junctions = oc.absorb_boundary_riders(same, _BUFFERED_REGIONS)
    assert [piece.region_id for piece in merged] == [1]
    assert junctions == []


def test_riders_absorb_hugging_stub_when_it_comes_second():
    # Mirror of the interior-side case with the riding piece second: the interior piece leads, the equator-hugging
    # region-2 piece follows and joins region 1.
    pieces = [_piece_at(1, [(0.002, 0.004), (0.002, 0)]), _piece_at(2, [(0.002, 0), (0.004, 0)])]
    merged, junctions = oc.absorb_boundary_riders(pieces, _BUFFERED_REGIONS)
    assert [piece.region_id for piece in merged] == [1]
    assert len(junctions) == 1


def test_oriented_piece_keeps_forward_pieces():
    edge = LineString([(0, 0), (10, 0)])
    geom, start_pos, end_pos = oc.oriented_piece(edge, LineString([(2, 0), (5, 0)]))
    assert list(geom.coords) == [(2, 0), (5, 0)]
    assert (start_pos, end_pos) == (2, 5)


def test_validate_staging_catches_geometry_name_and_null_problems():
    regions = _region_set()
    regions.loc[0, 'name'] = '   '
    regions.loc[[1], 'geometry'] = [_SQUARE]
    roads = gpd.GeoDataFrame({'road_id': [1, 2], 'osm_id': [11, None], 'highway': ['residential', 'primary'],
                              'region_id': [1, 2],
                              'geometry': [Point(0, 0), LineString([(0, 0), (0.001, 0)])]}, crs='EPSG:4326')
    errors = oc.validate_staging(roads, regions)
    assert any('must be LineString' in error for error in errors)
    assert any('MultiPolygon' in error for error in errors)
    assert any('non-empty name' in error for error in errors)
    assert any('non-null' in error for error in errors)


def test_validate_staging_catches_duplicate_region_ids():
    regions = _region_set()
    regions['region_id'] = [1, 1]
    roads = gpd.GeoDataFrame({'road_id': [1], 'osm_id': [11], 'highway': ['residential'], 'region_id': [1],
                              'geometry': [LineString([(0, 0), (0.001, 0)])]}, crs='EPSG:4326')
    assert any('duplicate region_id' in error for error in oc.validate_staging(roads, regions))


# --------------------------------------------------------------------------------------------------------------------
# Fetch wrappers (osmnx and the TIGERweb API mocked out)
# --------------------------------------------------------------------------------------------------------------------

# A 2x1 city: west + east squares, each ~1.1 km on a side.
_W = Polygon([(0, 0), (0.01, 0), (0.01, 0.01), (0, 0.01)])
_E = Polygon([(0.01, 0), (0.02, 0), (0.02, 0.01), (0.01, 0.01)])
_CITY = Polygon([(0, 0), (0.02, 0), (0.02, 0.01), (0, 0.01)])
_CITY_GDF = gpd.GeoDataFrame(geometry=[_CITY], crs='EPSG:4326')


def _fake_osmnx(monkeypatch, **attrs):
    """Installs a stand-in for the lazily-imported osmnx module."""
    fake = SimpleNamespace(**attrs)
    monkeypatch.setitem(sys.modules, 'osmnx', fake)
    return fake


def _empty_regions():
    return gpd.GeoDataFrame(columns=['name', 'geometry'], geometry='geometry', crs='EPSG:4326')


def test_fetch_boundary_returns_polygon_geometry(monkeypatch):
    gdf = gpd.GeoDataFrame({'display_name': ['Testville, USA']}, geometry=[_CITY], crs='EPSG:4326')
    _fake_osmnx(monkeypatch, geocode_to_gdf=lambda place: gdf)
    boundary = oc.fetch_boundary('Testville, USA')
    assert list(boundary.columns) == ['geometry']
    assert boundary.geometry.iloc[0].equals(_CITY)


def test_fetch_boundary_rejects_non_polygon_geocode(monkeypatch):
    gdf = gpd.GeoDataFrame({'display_name': ['x']}, geometry=[Point(0, 0)], crs='EPSG:4326')
    _fake_osmnx(monkeypatch, geocode_to_gdf=lambda place: gdf)
    with pytest.raises(SystemExit):
        oc.fetch_boundary('somewhere ambiguous')


def test_read_boundary_file_dissolves_to_one_polygon(tmp_path):
    two = gpd.GeoDataFrame(geometry=[_W, _E], crs='EPSG:4326')
    path = tmp_path / 'boundary.geojson'
    two.to_file(path, driver='GeoJSON')
    boundary = oc.read_boundary_file(path)
    assert len(boundary) == 1
    assert oc.geodesic_area_m2(boundary.geometry.iloc[0]) == pytest.approx(oc.geodesic_area_m2(_CITY), rel=0.01)


def _fake_features(monkeypatch, place_result, admin_result):
    """Fakes ox.features_from_polygon, dispatching on the tags to the place-query or admin-query result."""
    def features_from_polygon(poly, tags):
        result = place_result if 'place' in tags else admin_result
        if isinstance(result, Exception):
            raise result
        return result
    _fake_osmnx(monkeypatch, features_from_polygon=features_from_polygon)


def test_fetch_osm_neighborhoods_combines_place_and_level_10_admin_polygons(monkeypatch):
    place = gpd.GeoDataFrame({'name': ['west']}, geometry=[_W], crs='EPSG:4326')
    admin = gpd.GeoDataFrame({'name': ['east', 'county'], 'admin_level': ['10', '6']}, geometry=[_E, _CITY],
                             crs='EPSG:4326')
    _fake_features(monkeypatch, place, admin)
    hoods = oc.fetch_osm_neighborhoods(_CITY)
    assert sorted(hoods['name']) == ['east', 'west']


def test_fetch_osm_neighborhoods_survives_failed_query_and_missing_names(monkeypatch):
    place = gpd.GeoDataFrame(geometry=[_W], crs='EPSG:4326')
    _fake_features(monkeypatch, place, ValueError('no matches'))
    hoods = oc.fetch_osm_neighborhoods(_CITY)
    assert len(hoods) == 1
    assert hoods['name'].iloc[0] is None


def test_fetch_osm_neighborhoods_ignores_non_polygons_and_unleveled_admin(monkeypatch):
    place = gpd.GeoDataFrame({'name': ['pt']}, geometry=[Point(0, 0)], crs='EPSG:4326')
    admin = gpd.GeoDataFrame({'name': ['x']}, geometry=[_W], crs='EPSG:4326')
    _fake_features(monkeypatch, place, admin)
    assert oc.fetch_osm_neighborhoods(_CITY).empty


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_fetch_census_tracts_parses_geojson(monkeypatch):
    payload = {'features': [{'type': 'Feature', 'properties': {'GEOID': '21037050100', 'NAME': 'Census Tract 501'},
                             'geometry': mapping(_W)}]}
    monkeypatch.setattr(oc.requests, 'get', lambda url, params, timeout: _FakeResponse(payload))
    tracts = oc.fetch_census_tracts(_CITY)
    assert list(tracts['name']) == ['Census Tract 501']
    assert list(tracts.columns) == ['name', 'geometry']


def test_fetch_census_tracts_empty_outside_the_us(monkeypatch):
    monkeypatch.setattr(oc.requests, 'get', lambda url, params, timeout: _FakeResponse({'features': []}))
    assert oc.fetch_census_tracts(_CITY).empty


def test_read_regions_file_requires_a_name_column(tmp_path):
    named = gpd.GeoDataFrame({'name': ['west']}, geometry=[_W], crs='EPSG:4326')
    named_path = tmp_path / 'hoods.geojson'
    named.to_file(named_path, driver='GeoJSON')
    assert list(oc.read_regions_file(named_path)['name']) == ['west']
    unnamed = gpd.GeoDataFrame({'hood': ['west']}, geometry=[_W], crs='EPSG:4326')
    unnamed_path = tmp_path / 'unnamed.geojson'
    unnamed.to_file(unnamed_path, driver='GeoJSON')
    with pytest.raises(SystemExit):
        oc.read_regions_file(unnamed_path)


def test_fetch_streets_buffers_the_fetch_polygon_and_normalizes_columns(monkeypatch):
    edges = gpd.GeoDataFrame({'osmid': [[100, 101], 200], 'highway': [['track', 'residential'], 'primary']},
                             geometry=[LineString([(0, 0), (0.001, 0)]), LineString([(0.001, 0), (0.002, 0)])],
                             crs='EPSG:4326')
    seen = {}

    def graph_from_polygon(poly, custom_filter, simplify, retain_all, truncate_by_edge):
        seen['poly'] = poly
        return 'graph'

    _fake_osmnx(monkeypatch, graph_from_polygon=graph_from_polygon,
                convert=SimpleNamespace(to_undirected=lambda graph: graph,
                                        graph_to_gdfs=lambda graph, nodes, edges: edges_gdf))
    edges_gdf = edges
    streets = oc.fetch_streets(_CITY, include_alleys=False, fetch_buffer_m=50)
    assert list(streets['osm_id']) == [100, 200]
    assert list(streets['highway']) == ['residential', 'primary']
    assert seen['poly'].contains(_CITY)
    assert seen['poly'].area > _CITY.area


# --------------------------------------------------------------------------------------------------------------------
# prepare_regions / assign_regions
# --------------------------------------------------------------------------------------------------------------------

def test_prepare_regions_clips_names_and_assigns_ids():
    raw = gpd.GeoDataFrame({'name': ['west', None]}, geometry=[_W, _E.buffer(0.005)], crs='EPSG:4326')
    regions = oc.prepare_regions(raw, _CITY_GDF, min_part_m2=10_000)
    assert list(regions['region_id']) == [1, 2]
    assert list(regions['name']) == ['Region 1', 'west']
    assert set(regions.geometry.geom_type) == {'MultiPolygon'}
    # The buffered unnamed polygon was clipped back to the city boundary.
    assert oc.geodesic_area_m2(regions.union_all()) <= oc.geodesic_area_m2(_CITY) * 1.001


def test_prepare_regions_drops_isolated_slivers_and_rejects_empty_result():
    tiny = Polygon([(0.015, 0.002), (0.0151, 0.002), (0.0151, 0.0021), (0.015, 0.0021)])
    raw = gpd.GeoDataFrame({'name': ['west', 'sliver']}, geometry=[_W, tiny], crs='EPSG:4326')
    regions = oc.prepare_regions(raw, _CITY_GDF, min_part_m2=10_000)
    assert list(regions['name']) == ['west']
    outside = gpd.GeoDataFrame({'name': ['gone']}, geometry=[Polygon([(1, 1), (1.01, 1), (1.01, 1.01), (1, 1.01)])],
                               crs='EPSG:4326')
    with pytest.raises(SystemExit):
        oc.prepare_regions(outside, _CITY_GDF, min_part_m2=10_000)


def test_prepare_regions_absorbs_small_parts_into_longest_border_neighbor():
    # The nib (~9300 m²) touches west along its full ~167 m west edge and south along only a ~56 m edge, so it
    # joins west rather than being deleted (or joining south).
    nib = Polygon([(0.01, 0.004), (0.0105, 0.004), (0.0105, 0.0055), (0.01, 0.0055)])
    south = Polygon([(0.01, 0.001), (0.0105, 0.001), (0.0105, 0.004), (0.01, 0.004)])
    raw = gpd.GeoDataFrame({'name': ['west', 'nib', 'south']}, geometry=[_W, nib, south], crs='EPSG:4326')
    regions = oc.prepare_regions(raw, _CITY_GDF, min_part_m2=10_000)
    assert list(regions['name']) == ['south', 'west']
    west_area = oc.geodesic_area_m2(regions.loc[regions['name'] == 'west', 'geometry'].iloc[0])
    assert west_area == pytest.approx(oc.geodesic_area_m2(_W) + oc.geodesic_area_m2(nib), rel=0.01)


def test_prepare_regions_warns_on_overlapping_regions(caplog):
    raw = gpd.GeoDataFrame({'name': ['a', 'b']}, geometry=[_W, _W], crs='EPSG:4326')
    with caplog.at_level(logging.WARNING):
        oc.prepare_regions(raw, _CITY_GDF, min_part_m2=10_000)
    assert any('DUPLICATED' in record.message for record in caplog.records)


def _streets_gdf(lines):
    return gpd.GeoDataFrame({'osm_id': list(range(100, 100 + len(lines))), 'highway': ['residential'] * len(lines)},
                            geometry=[LineString(line) for line in lines], crs='EPSG:4326')


def _city_regions():
    return gpd.GeoDataFrame({'region_id': [1, 2], 'name': ['west', 'east'],
                             'geometry': [MultiPolygon([_W]), MultiPolygon([_E])]}, crs='EPSG:4326')


def test_assign_regions_splits_streets_and_assigns_dense_road_ids():
    streets = _streets_gdf([
        [(0.002, 0.005), (0.008, 0.005)],   # Fully inside west.
        [(0.005, 0.002), (0.015, 0.002)],   # A genuine west-east crossing: split into two long pieces.
    ])
    roads, dropped, heal_stats, riders = oc.assign_regions(streets, _city_regions(), min_segment_m=15, heal_m=30,
                                                           boundary_merge_tol_m=15)
    assert list(roads['road_id']) == [1, 2, 3]
    assert sorted(roads['region_id']) == [1, 1, 2]
    assert dropped.empty
    assert heal_stats.n_riders == 0
    assert riders.empty


# --------------------------------------------------------------------------------------------------------------------
# Output writers / CLI / main
# --------------------------------------------------------------------------------------------------------------------

def _staged_roads():
    return gpd.GeoDataFrame({'road_id': [1, 2], 'osm_id': [100, 101], 'highway': ['residential', 'primary'],
                             'region_id': [1, 2], 'length_m': [667.9, 667.9],
                             'geometry': [LineString([(0.002, 0.005), (0.008, 0.005)]),
                                          LineString([(0.012, 0.005), (0.018, 0.005)])]}, crs='EPSG:4326')


def _empty_riders():
    return gpd.GeoDataFrame(columns=['osm_id', 'geometry'], geometry='geometry', crs='EPSG:4326')


def test_write_gpkg_writes_qa_layers(tmp_path):
    roads = _staged_roads()
    riders = gpd.GeoDataFrame({'osm_id': [100]}, geometry=[Point(0.01, 0.005)], crs='EPSG:4326')
    path = tmp_path / 'qa.gpkg'
    oc.write_gpkg(path, roads, _city_regions(), _CITY_GDF, roads.iloc[0:1], riders)
    assert set(gpd.list_layers(path)['name']) == {'qgis_road', 'qgis_region', 'city_boundary', 'dropped_segments',
                                                  'rider_merges'}


def test_write_gpkg_skips_empty_qa_layers(tmp_path):
    roads = _staged_roads()
    path = tmp_path / 'qa.gpkg'
    oc.write_gpkg(path, roads, _city_regions(), _CITY_GDF, roads.iloc[0:0], _empty_riders())
    assert set(gpd.list_layers(path)['name']) == {'qgis_road', 'qgis_region', 'city_boundary'}


def test_write_sql_emits_loadable_copy_blocks(tmp_path):
    path = tmp_path / 'qgis_tables.sql'
    oc.write_sql(path, _staged_roads(), _city_regions())
    sql = path.read_text()
    assert sql.count('FROM stdin;') == 2
    assert 'BEGIN;' in sql
    assert sql.rstrip().endswith('COMMIT;')
    assert '0102000020E610' in sql.upper()


def test_parse_args_requires_exactly_one_input_mode():
    with pytest.raises(SystemExit):
        oc.parse_args(['--city-id', 'x'])
    with pytest.raises(SystemExit):
        oc.parse_args(['--city-id', 'x', '--place', 'a', '--from-gpkg', 'b.gpkg'])
    assert oc.parse_args(['--city-id', 'x', '--from-gpkg', 'b.gpkg']).from_gpkg == 'b.gpkg'


def test_parse_args_validates_the_city_id():
    with pytest.raises(SystemExit):
        oc.parse_args(['--city-id', 'Newport KY', '--place', 'Newport, Kentucky, USA'])


def test_schema_name_swaps_hyphens_for_underscores():
    assert oc.schema_name('newport-ky') == 'sidewalk_newport_ky'


def test_write_report_summarizes_a_fetch_run(tmp_path):
    args = oc.parse_args(['--city-id', 'testville-wa', '--place', 'Testville, USA'])
    roads, regions = _staged_roads(), _city_regions()
    stats = oc.region_street_stats(roads, regions, 60)
    heal = oc.HealStats(3, 2, 45.0, 1)
    oc.write_report(tmp_path / 'report.md', args, 'US Census tracts (TIGERweb)', roads, regions, roads.iloc[0:1],
                    stats, 0.98, heal)
    report = (tmp_path / 'report.md').read_text()
    assert '98.0%' in report
    assert 'dropped_segments' in report
    assert 'make onboard-city id=testville-wa' in report
    assert '| residential | 1 |' in report


def test_write_report_re_export_variant_omits_healing_and_coverage(tmp_path):
    args = oc.parse_args(['--city-id', 'testville', '--from-gpkg', 'edited.gpkg'])
    roads, regions = _staged_roads(), _city_regions()
    stats = oc.region_street_stats(roads, regions, 60)
    oc.write_report(tmp_path / 'report.md', args, 'edited GeoPackage (edited.gpkg)', roads, regions, roads.iloc[0:0],
                    stats, None, None)
    report = (tmp_path / 'report.md').read_text()
    assert 'Healed' not in report
    assert 'covering' not in report


def _staging_gpkg(tmp_path, with_boundary=True):
    path = tmp_path / 'city_qa.gpkg'
    _staged_roads().to_file(path, layer='qgis_road', driver='GPKG')
    _city_regions().to_file(path, layer='qgis_region', driver='GPKG')
    if with_boundary:
        _CITY_GDF.to_file(path, layer='city_boundary', driver='GPKG')
    return path


def test_run_from_gpkg_regenerates_sql_from_edited_layers(tmp_path):
    path = _staging_gpkg(tmp_path)
    oc.run_from_gpkg(oc.parse_args(['--city-id', 'testville', '--from-gpkg', str(path)]))
    assert 'COPY qgis_road' in (tmp_path / 'qgis_tables.sql').read_text()
    report = (tmp_path / 'report.md').read_text()
    assert 'edited GeoPackage' in report
    assert 'covering' in report


def test_run_from_gpkg_honors_out_dir_and_survives_missing_boundary_layer(tmp_path):
    path = _staging_gpkg(tmp_path, with_boundary=False)
    out = tmp_path / 'out'
    args = oc.parse_args(['--city-id', 'testville', '--from-gpkg', str(path), '--out-dir', str(out)])
    oc.run_from_gpkg(args)
    report = (out / 'report.md').read_text()
    assert 'Regions: **2**' in report
    assert 'covering' not in report


def test_run_from_gpkg_rejects_broken_edits(tmp_path):
    roads = _staged_roads()
    roads['region_id'] = 9
    path = tmp_path / 'broken_qa.gpkg'
    roads.to_file(path, layer='qgis_road', driver='GPKG')
    _city_regions().to_file(path, layer='qgis_region', driver='GPKG')
    with pytest.raises(SystemExit):
        oc.run_from_gpkg(oc.parse_args(['--city-id', 'testville', '--from-gpkg', str(path)]))


def _patch_pipeline(monkeypatch, hoods, tracts=None):
    """Points main's fetch stage at canned data: the 2x1 test city and two streets (one crossing both regions)."""
    monkeypatch.setattr(oc, 'fetch_boundary', lambda place: _CITY_GDF.copy())
    monkeypatch.setattr(oc, 'fetch_osm_neighborhoods', lambda poly: hoods)
    monkeypatch.setattr(oc, 'fetch_census_tracts',
                        lambda poly: tracts if tracts is not None else _empty_regions())
    monkeypatch.setattr(oc, 'fetch_streets', lambda poly, alleys, buffer_m: _streets_gdf([
        [(0.002, 0.005), (0.008, 0.005)], [(0.005, 0.002), (0.015, 0.002)]]))


def _two_hoods():
    return gpd.GeoDataFrame({'name': ['west', 'east']}, geometry=[_W, _E], crs='EPSG:4326')


def test_main_uses_osm_neighborhoods_and_writes_artifacts(tmp_path, monkeypatch):
    _patch_pipeline(monkeypatch, _two_hoods())
    oc.main(['--city-id', 'testville', '--place', 'Testville, USA', '--out-dir', str(tmp_path)])
    assert (tmp_path / 'testville_qa.gpkg').exists()
    assert (tmp_path / 'qgis_tables.sql').exists()
    report = (tmp_path / 'report.md').read_text()
    assert 'OpenStreetMap' in report
    assert 'Streets: **3**' in report


def test_main_falls_back_to_census_when_osm_is_sparse(tmp_path, monkeypatch):
    sparse = gpd.GeoDataFrame({'name': ['corner']},
                               geometry=[Polygon([(0, 0), (0.004, 0), (0.004, 0.005), (0, 0.005)])], crs='EPSG:4326')
    _patch_pipeline(monkeypatch, sparse, tracts=_two_hoods())
    oc.main(['--city-id', 'testville', '--place', 'Testville, USA', '--out-dir', str(tmp_path)])
    assert 'US Census tracts' in (tmp_path / 'report.md').read_text()


def test_main_single_region_fallback_and_default_out_dir(tmp_path, monkeypatch):
    _patch_pipeline(monkeypatch, _empty_regions())
    monkeypatch.setattr(oc, 'REPO_ROOT', tmp_path)
    oc.main(['--city-id', 'testville', '--place', 'Testville, USA'])
    report = (tmp_path / 'db' / 'onboarding' / 'testville' / 'report.md').read_text()
    assert 'city boundary' in report
    assert 'Regions: **1**' in report


def test_main_uses_regions_file_and_warns_on_low_coverage(tmp_path, monkeypatch, caplog):
    _patch_pipeline(monkeypatch, _empty_regions())
    boundary_path = tmp_path / 'boundary.geojson'
    _CITY_GDF.to_file(boundary_path, driver='GeoJSON')
    regions_path = tmp_path / 'hoods.geojson'
    gpd.GeoDataFrame({'name': ['west']}, geometry=[_W], crs='EPSG:4326').to_file(regions_path, driver='GeoJSON')
    with caplog.at_level(logging.WARNING):
        oc.main(['--city-id', 'testville', '--boundary-file', str(boundary_path), '--regions-file', str(regions_path),
                 '--out-dir', str(tmp_path / 'out')])
    assert any('cover only' in record.message for record in caplog.records)
    assert 'hoods.geojson' in (tmp_path / 'out' / 'report.md').read_text()


def test_main_applies_region_merges_before_assignment(tmp_path, monkeypatch):
    _patch_pipeline(monkeypatch, _two_hoods())
    oc.main(['--city-id', 'testville', '--place', 'Testville, USA', '--out-dir', str(tmp_path),
             '--merge-regions', 'west:east'])
    report = (tmp_path / 'report.md').read_text()
    assert 'Regions: **1**' in report
    assert '| 1 | east |' in report


def test_main_dispatches_from_gpkg_runs(monkeypatch):
    calls = {}
    monkeypatch.setattr(oc, 'run_from_gpkg', lambda args: calls.setdefault('gpkg', args.from_gpkg))
    oc.main(['--city-id', 'x', '--from-gpkg', 'edited.gpkg'])
    assert calls['gpkg'] == 'edited.gpkg'


def test_parse_args_rejects_merges_on_reexport_runs():
    with pytest.raises(SystemExit):
        oc.parse_args(['--city-id', 'x', '--from-gpkg', 'b.gpkg', '--merge-regions', 'Downtown:East'])


def test_main_aborts_when_generated_data_fails_validation(tmp_path, monkeypatch):
    _patch_pipeline(monkeypatch, _two_hoods())
    monkeypatch.setattr(oc, 'validate_staging', lambda roads, regions: ['boom'])
    with pytest.raises(SystemExit):
        oc.main(['--city-id', 'testville', '--place', 'Testville, USA', '--out-dir', str(tmp_path)])
