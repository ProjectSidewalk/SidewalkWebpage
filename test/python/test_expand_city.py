"""
Unit tests for tools/city/expand_city.py (#5924).

A six-street toy city stands in for the live one: three streets the build still has (one of which the build
extends east), one it has lost, one lying exactly on the new region border, and one outside every new region. The
build adds a brand-new road and a stub too short to keep. The tests cover the delta, the region mapping and
assignment, the plan files, both SQL scripts, and the CLI, with no database: the SQL's behaviour against a real
schema is the rehearsal in docs/onboarding-a-city.md.
"""
import csv
import hashlib
import json

import geopandas as gpd
import pandas as pd
import pytest
import shapely
from shapely.geometry import LineString, Polygon, box

import expand_city as ec
from onboard_city import ewkb_hex

pytest.importorskip('pyogrio')

# Live streets, in lon/lat near the equator so a degree is ~111 km both ways. Ids are deliberately sparse.
_A = LineString([(0.0, 0.0), (0.001, 0.0)])            # 1: kept whole
_B = LineString([(0.001, 0.0), (0.002, 0.0)])          # 2: kept, and the build continues it east
_C = LineString([(0.001, 0.0), (0.001, 0.001)])        # 3: kept whole, the build adds a 5 m stub past its end
_D = LineString([(0.0005, 0.0005), (0.0005, 0.0008)])  # 4: gone from OSM
_E = LineString([(0.0015, 0.0), (0.0015, 0.0005)])     # 5: on the border between the new regions
_F = LineString([(0.006, 0.0), (0.007, 0.0)])          # 6: outside every new region
_TUTORIAL = LineString([(1.0, 1.0), (1.0005, 1.0)])    # 99
_WEST = box(-0.0005, -0.001, 0.0015, 0.002)
_EAST = box(0.0015, -0.001, 0.004, 0.002)
_SOURCE = 'drawn by a test'


def _live_streets():
    rows = [(1, 'open', 'residential', 1, False, _A), (2, 'open', 'residential', 1, False, _B),
            (3, 'no_imagery', 'tertiary', 1, False, _C), (4, 'open', 'residential', 1, False, _D),
            (5, 'open', 'residential', 1, False, _E), (6, 'open', 'residential', 1, False, _F),
            (99, 'open', 'residential', 1, True, _TUTORIAL)]
    return gpd.GeoDataFrame({'street_edge_id': [r[0] for r in rows], 'status': [r[1] for r in rows],
                             'way_type': [r[2] for r in rows], 'region_id': [r[3] for r in rows],
                             'is_tutorial': [r[4] for r in rows],
                             'geom_md5': [hashlib.md5(r[5].wkb).hexdigest() for r in rows]},
                            geometry=[r[5] for r in rows], crs='EPSG:4326')


def _live_regions():
    return pd.DataFrame({'region_id': [1, 2], 'name': ['Old Town', 'Hidden'], 'deleted': [False, True]})


def _build_roads():
    lines = [LineString([(0.0, 0.0), (0.003, 0.0)]),           # A + B, continued 111 m east
             _C,                                               # C as is
             LineString([(0.003, 0.0), (0.003, 0.001)]),       # brand new
             LineString([(0.001, 0.0), (0.001, 0.00105)])]     # C plus a 5 m stub
    return gpd.GeoDataFrame({'road_id': [1, 2, 3, 4], 'osm_ids': [[100], [101], [102], [101]],
                             'highway': ['residential', 'tertiary', 'secondary', 'tertiary'],
                             'is_structure': [False, False, True, False], 'region_id': [1, 1, 2, 1],
                             'length_m': [333.0, 111.0, 111.0, 116.0]}, geometry=lines, crs='EPSG:4326')


def _build_regions():
    return gpd.GeoDataFrame({'region_id': [1, 2], 'name': ['West End', 'East End'], 'data_source': ['x', 'x']},
                            geometry=[_WEST, _EAST], crs='EPSG:4326')


def _ways():
    return gpd.GeoDataFrame({'osm_way_id': [100, 101, 102], 'highway': ['residential', 'tertiary', 'secondary']},
                            geometry=[LineString([(0.0, 0.0), (0.003, 0.0)]), LineString([(0.001, 0.0), (0.001, 0.0011)]),
                                      LineString([(0.003, 0.0), (0.003, 0.001)])], crs='EPSG:4326')


def _write_live(workspace):
    workspace.mkdir(parents=True, exist_ok=True)
    live = _live_streets()
    pd.DataFrame({'street_edge_id': live['street_edge_id'], 'status': live['status'], 'way_type': live['way_type'],
                  'region_id': live['region_id'], 'is_tutorial': ['t' if t else 'f' for t in live['is_tutorial']],
                  'geom_md5': live['geom_md5'],
                  'geom': [ewkb_hex(geom).lower() for geom in live.geometry]}).to_csv(
        workspace / ec.LIVE_STREETS_FILE, index=False)
    pd.DataFrame({'region_id': [1, 2], 'name': ['Old Town', 'Hidden'], 'deleted': ['f', 't']}).to_csv(
        workspace / ec.LIVE_REGIONS_FILE, index=False)


def _write_build(path):
    roads = _build_roads()
    roads['osm_ids'] = roads['osm_ids'].map(lambda ids: '{' + ','.join(map(str, ids)) + '}')  # As the build stores them.
    roads.to_file(path, layer='qgis_road', driver='GPKG')
    _build_regions().to_file(path, layer='qgis_region', driver='GPKG')
    _ways().to_file(path, layer='osm_way', driver='GPKG')
    return path


def _plan(**overrides):
    kwargs = dict(live=_live_streets(), live_regions=_live_regions(), roads=_build_roads(),
                  build_regions=_build_regions(), ways=_ways(), keep={1: 'West End'}, data_source=_SOURCE,
                  city_id='testville')
    kwargs.update(overrides)
    return ec.make_plan(**kwargs)


# ---------------------------------------------------------------------------------------------------------------------
# Inputs.
# ---------------------------------------------------------------------------------------------------------------------

def test_read_live_streets_parses_the_export_and_refuses_a_partial_one(tmp_path):
    _write_live(tmp_path)
    live = ec.read_live_streets(tmp_path / ec.LIVE_STREETS_FILE)
    assert list(live['street_edge_id']) == [1, 2, 3, 4, 5, 6, 99]
    assert list(live['is_tutorial']) == [False] * 6 + [True]
    assert live.geometry.iloc[1].equals(_B) and live.crs.to_epsg() == 4326
    regions = ec.read_live_regions(tmp_path / ec.LIVE_REGIONS_FILE)
    assert list(regions['deleted']) == [False, True]
    (tmp_path / 'short.csv').write_text('street_edge_id,geom\n1,00\n')
    with pytest.raises(ValueError, match='lacks the column'):
        ec.read_live_streets(tmp_path / 'short.csv')


def test_live_fingerprint_is_the_md5_of_ids_and_geometry_hashes():
    live = _live_streets()
    expected = hashlib.md5(','.join(f'{r.street_edge_id}:{r.geom_md5}' for r in live.itertuples()).encode())
    assert ec.live_fingerprint(live) == expected.hexdigest()


def test_read_build_needs_the_three_layers(tmp_path):
    roads, regions, ways = ec.read_build(_write_build(tmp_path / 'b.gpkg'))
    assert list(roads['osm_ids']) == [[100], [101], [102], [101]] and len(regions) == 2 and len(ways) == 3
    _build_regions().to_file(tmp_path / 'hand.gpkg', layer='qgis_region', driver='GPKG')
    with pytest.raises(ValueError, match='osm_way'):
        ec.read_build(tmp_path / 'hand.gpkg')


def test_parse_osm_ids_takes_every_shape_the_geopackage_gives():
    assert ec.parse_osm_ids('{1,2}') == [1, 2] and ec.parse_osm_ids('[3, "4"]') == [3, 4]
    assert ec.parse_osm_ids(7) == [7] and ec.parse_osm_ids((8, 9)) == [8, 9] and ec.parse_osm_ids('') == []


# ---------------------------------------------------------------------------------------------------------------------
# The delta.
# ---------------------------------------------------------------------------------------------------------------------

def test_new_street_pieces_finds_the_extension_and_the_new_road_and_drops_the_stub():
    pieces, dropped = ec.new_street_pieces(_live_streets(), _build_roads())
    assert [piece['road_id'] for piece in pieces] == [1, 3]
    extension, new_road = pieces
    # The extension starts where live street 2 ends: its cut end was snapped onto it.
    assert extension['touches'] == [2, None]
    assert extension['geometry'].coords[0] == pytest.approx((0.002, 0.0), abs=1e-7)
    assert extension['length_m'] == pytest.approx(111.3, abs=0.5)
    assert extension['highway'] == 'residential' and extension['osm_ids'] == [100]
    assert new_road['touches'] == [None, None] and new_road['is_structure'] is True
    assert [piece['road_id'] for piece in dropped] == [4] and dropped[0]['length_m'] < 15


def test_share_live_vertices_copies_the_live_end_node_exactly_and_leaves_mid_block_joins_alone():
    live = {3: LineString([(0.0, 0.0), (0.0012345678912, 0.0)])}
    to_metres, _ = ec.projections(list(live.values()))
    # The rounded snap sits a few millimetres off the live end node, where the live vertex has more decimals.
    continuation = LineString([(0.0012346, 0.0), (0.002, 0.0)])
    shared = ec.share_live_vertices(continuation, [3, None], live, to_metres)
    assert shared.coords[0] == (0.0012345678912, 0.0) and shared.coords[-1] == (0.002, 0.0)
    mid_block = LineString([(0.0006, 0.0), (0.0006, 0.001)])
    assert ec.share_live_vertices(mid_block, [3, None], live, to_metres).coords[0] == (0.0006, 0.0)
    assert ec.share_live_vertices(mid_block, [None, None], live, to_metres).equals(mid_block)


def test_snap_ends_moves_only_ends_within_reach():
    live_m = {7: LineString([(0, 0), (100, 0)])}
    piece = LineString([(100, 2), (100, 50), (300, 50)])
    snapped, touches = ec.snap_ends(piece, live_m, snap_m=2.5)
    assert touches == [7, None] and list(snapped.coords)[0] == (100.0, 0.0) and list(snapped.coords)[-1] == (300, 50)
    _, touches = ec.snap_ends(LineString([(100, 3), (300, 50)]), live_m, snap_m=2.5)
    assert touches == [None, None]


def test_uncovered_live_streets_names_the_one_osm_lost():
    assert ec.uncovered_live_streets(_live_streets(), _build_roads()) == [4, 5, 6]
    assert ec.uncovered_live_streets(_live_streets().iloc[0:0], _build_roads()) == []


def test_round_coords_leaves_osm_precision_alone():
    line = LineString([(0.1234567, 0.0000001), (0.12345678, 0.1)])
    assert list(ec.round_coords(line).coords) == [(0.1234567, 1e-7), (0.1234568, 0.1)]


# ---------------------------------------------------------------------------------------------------------------------
# Regions.
# ---------------------------------------------------------------------------------------------------------------------

def test_parse_keep_region_validates_each_pair():
    assert ec.parse_keep_region(['1=West End', '7= The Flats ']) == {1: 'West End', 7: 'The Flats'}
    assert ec.parse_keep_region(None) == {}
    for bad in ('West End', 'x=West', '1='):
        with pytest.raises(ValueError, match='keep-region'):
            ec.parse_keep_region([bad])


def test_map_regions_keeps_live_ids_and_numbers_new_regions_after_them():
    regions, build_to_final = ec.map_regions(_live_regions(), _build_regions(), {1: 'West End'}, _SOURCE)
    assert build_to_final == {1: 1, 2: 3}
    assert [(r['region_id'], r['name'], r['action'], r['old_name']) for r in regions] == \
        [(1, 'West End', 'update', 'Old Town'), (3, 'East End', 'insert', None)]
    assert all(r['geometry'].geom_type == 'MultiPolygon' for r in regions)
    assert regions[0]['data_source'] == _SOURCE


def test_map_regions_refuses_an_unkept_live_region_and_bad_names():
    with pytest.raises(ValueError, match='never removes a region'):
        ec.map_regions(_live_regions(), _build_regions(), {}, _SOURCE)
    with pytest.raises(ValueError, match='does not have'):
        ec.map_regions(_live_regions(), _build_regions(), {1: 'West End', 9: 'East End'}, _SOURCE)
    with pytest.raises(ValueError, match='0 region'):
        ec.map_regions(_live_regions(), _build_regions(), {1: 'Nowhere'}, _SOURCE)
    twice = pd.concat([_build_regions(), _build_regions().iloc[[0]]], ignore_index=True)
    with pytest.raises(ValueError, match='2 region'):
        ec.map_regions(_live_regions(), twice, {1: 'West End'}, _SOURCE)
    both_live = pd.DataFrame({'region_id': [1, 2], 'name': ['a', 'b'], 'deleted': [False, False]})
    with pytest.raises(ValueError, match='same build region'):
        ec.map_regions(both_live, _build_regions(), {1: 'West End', 2: 'West End'}, _SOURCE)
    # No live region at all (a schema whose regions were wiped): new ids start at 1.
    none = pd.DataFrame({'region_id': pd.Series([], dtype=int), 'name': [], 'deleted': []})
    regions, _ = ec.map_regions(none, _build_regions(), {}, _SOURCE)
    assert [r['region_id'] for r in regions] == [1, 2]


def test_assign_by_longest_overlap_breaks_ties_low_and_flags_the_stranded():
    regions = [(3, _EAST), (1, _WEST)]
    assigned, flagged = ec.assign_by_longest_overlap([_A, _E, _F, LineString([(0.0025, 0), (0.003, 0)])], regions)
    assert assigned == [1, 1, 3, 3] and flagged == [2]


# ---------------------------------------------------------------------------------------------------------------------
# The plan.
# ---------------------------------------------------------------------------------------------------------------------

def test_make_plan_numbers_new_streets_after_the_live_ones_and_flags_what_needs_a_look():
    plan = _plan()
    assert [p['street_edge_id'] for p in plan['new_streets']] == [100, 101]
    assert [p['region_id'] for p in plan['new_streets']] == [3, 3]
    assert plan['first_new_street_id'] == 100
    assert plan['live'] == {'n_streets': 7, 'max_street_id': 99, 'tutorial_street_id': 99,
                            'fingerprint': ec.live_fingerprint(_live_streets()),
                            'regions': [{'region_id': 1, 'name': 'Old Town', 'deleted': False},
                                        {'region_id': 2, 'name': 'Hidden', 'deleted': True}]}
    # Only the stranded street moves region (to the nearest, East); the border street stays West by the tie rule.
    assert [(r['street_edge_id'], r['from_region_id'], r['to_region_id']) for r in plan['remaps']] == [(6, 1, 3)]
    assert plan['dropped'][0]['road_id'] == 4
    assert plan['flags'] == ['live street 6 lies in no region; assigned to the nearest (3)',
                             'live street 4 is no longer in OSM (the build covers under half of it); left as is',
                             'live street 5 is no longer in OSM (the build covers under half of it); left as is',
                             'live street 6 is no longer in OSM (the build covers under half of it); left as is']
    extension = plan['new_streets'][0]
    assert [(l['osm_way_id'], l['street_from_frac'], l['street_to_frac']) for l in extension['lineage']] == \
        [(100, 0.0, 1.0)]
    assert extension['lineage'][0]['way_from_frac'] == pytest.approx(2 / 3, abs=1e-3)
    assert ec.lineage_for(plan['new_streets'], _ways()) == {100: 'matched', 101: 'matched'}


def test_make_plan_takes_an_explicit_first_id_and_refuses_a_taken_one():
    assert [p['street_edge_id'] for p in _plan(first_id=500)['new_streets']] == [500, 501]
    with pytest.raises(ValueError, match='not past'):
        _plan(first_id=99)


def test_make_plan_flags_a_street_its_ways_cannot_place_and_duplicates():
    ways = _ways().iloc[[1]]  # Only way 101 is known, so neither new street can be positioned.
    plan = _plan(ways=ways)
    assert 'new street 100 matched its OSM ways only in part (unmatched); check it in QGIS' in plan['flags']
    assert plan['new_streets'][0]['lineage'] == [{'osm_way_id': 100, 'street_from_frac': None, 'street_to_frac': None,
                                                  'way_from_frac': None, 'way_to_frac': None, 'same_direction': None}]
    roads = pd.concat([_build_roads(), _build_roads().iloc[[2]].assign(road_id=5)], ignore_index=True)
    plan = _plan(roads=roads)
    assert 'new streets 101 and 102 lie on top of each other; fix the build and plan again' in plan['flags']
    assert ec.overlapping_pieces(plan['new_streets'][:1]) == []


def test_make_plan_without_a_tutorial_street_or_new_streets():
    live = _live_streets()
    live = live[~live['is_tutorial']].reset_index(drop=True)
    plan = _plan(live=live, roads=_build_roads().iloc[[1]])
    assert plan['live']['tutorial_street_id'] is None and plan['new_streets'] == [] and plan['dropped'] == []


def test_plan_round_trips_through_json():
    plan = _plan()
    plan['new_streets'][0]['nan_value'] = float('nan')
    data = json.loads(json.dumps(ec.plan_to_json(plan)))
    assert data['new_streets'][0]['nan_value'] is None
    assert data['regions'][0]['geometry'].startswith('0106000020E6100000')
    back = ec.plan_from_json(data)
    assert back['new_streets'][0]['geometry'].equals(plan['new_streets'][0]['geometry'])
    assert back['remaps'][0]['geometry'].equals(_F)


def test_write_plan_files_writes_the_gpkg_report_and_tool_inputs(tmp_path):
    plan = _plan()
    ec.write_plan_files(tmp_path, plan, _live_streets())
    layers = set(gpd.list_layers(tmp_path / ec.PLAN_GPKG)['name'])
    assert layers == {'new_streets', 'regions', 'remapped_streets', 'dropped_pieces'}
    endpoints = pd.read_csv(tmp_path / ec.ENDPOINTS_FILE)
    assert list(endpoints.columns) == ['street_edge_id', 'region_id', 'x1', 'y1', 'x2', 'y2', 'geom']
    assert list(endpoints['street_edge_id']) == [100, 101]
    assert shapely.from_wkb(bytes.fromhex(endpoints.loc[1, 'geom'])).equals(plan['new_streets'][1]['geometry'])
    gradient_in = pd.read_csv(tmp_path / ec.GRADIENT_INPUT_FILE)
    assert list(gradient_in.columns) == ['street_edge_id', 'geom_md5', 'is_structure', 'geom']
    assert list(gradient_in['is_structure']) == ['f', 't']
    assert gradient_in.loc[0, 'geom_md5'] == ec.geom_md5(plan['new_streets'][0]['geometry'])
    report = (tmp_path / ec.REPORT_FILE).read_text()
    assert 'New streets: **2**' in report and '| 100 | residential | 111 | East End | 100 |  | 2 / — |' in report
    assert '| 1 | West End | update (was "Old Town") | 5 |' in report and '| 3 | East End | insert | 1 |' in report
    assert 'West End (1) → East End (3): 1 streets (6)' in report and 'build road 4: 5.' in report
    assert json.loads((tmp_path / ec.PLAN_FILE).read_text())['first_new_street_id'] == 100
    # The plan file is rewritten in place, and a plan with nothing to add still reports.
    plan['new_streets'], plan['remaps'], plan['dropped'], plan['flags'] = [], [], [], []
    ec.write_plan_files(tmp_path, plan, _live_streets())
    report = (tmp_path / ec.REPORT_FILE).read_text()
    assert 'New streets: **none**' in report and 'None: every build street' in report and '\nNone.' in report
    assert set(gpd.list_layers(tmp_path / ec.PLAN_GPKG)['name']) == {'new_streets', 'regions'}


# ---------------------------------------------------------------------------------------------------------------------
# SQL.
# ---------------------------------------------------------------------------------------------------------------------

def test_sql_literals():
    assert ec.sql_text(None) == 'NULL' and ec.sql_text("O'Hare") == "'O''Hare'"
    assert ec.sql_number(None) == 'NULL' and ec.sql_number('') == 'NULL' and ec.sql_number(float('nan')) == 'NULL'
    assert ec.sql_number(0.5) == '0.5' and ec.sql_number(3) == '3' and ec.sql_number('0.25') == '0.25'
    assert ec.sql_bool(None) == 'NULL' and ec.sql_bool(float('nan')) == 'NULL'
    assert ec.sql_bool(True) == 'TRUE' and ec.sql_bool(False) == 'FALSE'
    assert ec.sql_geom(_A) == f"'{ewkb_hex(_A)}'::geometry"
    assert ec.values_list([('1', 'a'), ('2', 'b')]) == '        (1, a),\n        (2, b)'


def _imagery_csv(path, verdicts):
    with open(path, 'w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(['street_edge_id', 'region_id', 'has_imagery', 'oldest_capture', 'newest_capture', 'n_panos',
                         'max_cross_track_m', 'cross_track_limit_m'])
        for street_id, (has, oldest, newest, n) in verdicts.items():
            writer.writerow([street_id, 3, has, oldest, newest, n, '', 0.0])


def _gradient_csv(path, plan, override_md5=None, header=None):
    with open(path, 'w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(header or ec.GRADIENT_COLUMNS)
        for piece in plan['new_streets']:
            md5 = override_md5 or ec.geom_md5(piece['geometry'])
            writer.writerow([piece['street_edge_id'], 'measured', 'high', 0.01, 0.02, 0.03, 10.0, 40.0, 0.0, 0.0, 1.1,
                             0.0, 5.0, 6.1, '{500,510}', 'usgs-3dep-10m', 10.0, md5])


def test_read_imagery_summary_and_gradient_rows_check_completeness_and_geometry(tmp_path):
    plan = _plan()
    _imagery_csv(tmp_path / 'i.csv', {100: ('True', '2024-05-21', '2025-09-05', 12), 101: ('False', '', '', 0)})
    verdicts = ec.read_imagery_summary(tmp_path / 'i.csv', [100, 101])
    assert verdicts == {100: (True, '2024-05-21', '2025-09-05', 12), 101: (False, None, None, 0)}
    with pytest.raises(ValueError, match='no verdict for new street'):
        ec.read_imagery_summary(tmp_path / 'i.csv', [100, 101, 102])
    expected = {piece['street_edge_id']: ec.geom_md5(piece['geometry']) for piece in plan['new_streets']}
    _gradient_csv(tmp_path / 'g.csv', plan)
    rows = ec.read_gradient_rows(tmp_path / 'g.csv', expected)
    assert rows[101]['profile_cm'] == '{500,510}'
    _gradient_csv(tmp_path / 'bad.csv', plan, override_md5='0' * 32)
    with pytest.raises(ValueError, match='different geometry'):
        ec.read_gradient_rows(tmp_path / 'bad.csv', expected)
    _gradient_csv(tmp_path / 'hdr.csv', plan, header=['street_edge_id', 'grade'])
    with pytest.raises(ValueError, match='not the gradient sampler'):
        ec.read_gradient_rows(tmp_path / 'hdr.csv', expected)
    with pytest.raises(ValueError, match='no row for new street'):
        ec.read_gradient_rows(tmp_path / 'g.csv', {**expected, 102: 'x'})


def _emit_inputs(tmp_path, plan):
    _imagery_csv(tmp_path / 'i.csv', {100: ('True', '2024-05-21', '2025-09-05', 12), 101: ('False', '', '', 0)})
    _gradient_csv(tmp_path / 'g.csv', plan)
    imagery = ec.read_imagery_summary(tmp_path / 'i.csv', [100, 101])
    gradient = ec.read_gradient_rows(tmp_path / 'g.csv',
                                     {p['street_edge_id']: ec.geom_md5(p['geometry']) for p in plan['new_streets']})
    return imagery, gradient


def test_expansion_sql_has_every_step_gated_in_one_transaction(tmp_path):
    plan = _plan()
    imagery, gradient = _emit_inputs(tmp_path, plan)
    sql = ec.expansion_sql(plan, 'sidewalk_testville', 'sidewalk_testville_bak', imagery, gradient, 4836, 'ws', 'abc')
    assert sql.startswith('-- Expansion of sidewalk_testville: 2 new street(s), 1 new region(s), 1 street(s) reassigned')
    assert sql.count('BEGIN;') == 1 and sql.rstrip().endswith('\\endif') and '\\if :apply\n  \\echo' in sql
    assert "IF current_schema() <> 'sidewalk_testville'" in sql
    assert 'n_streets <> 7 OR max_id <> 99' in sql and 'street_edge_id >= 100' in sql
    assert f"fingerprint <> '{plan['live']['fingerprint']}'" in sql
    assert "IS DISTINCT FROM '1:Old Town,2:Hidden'" in sql
    assert "IF n_labels <> 4836 THEN" in sql
    assert 'CREATE SCHEMA sidewalk_testville_bak;' in sql and "'abc' AS plan_sha256" in sql
    assert 'ARRAY[3]::integer[] AS new_region_ids' in sql
    assert "SET name = 'West End'" in sql and 'WHERE region_id = 1;' in sql
    assert "(3, 'drawn by a test', 'East End', ST_Multi(" in sql
    assert '        (6, 1, 3)\n) AS moves' in sql
    assert '(100, \'0102000020E6100000' in sql and "'residential'::way_type, 'open'::street_edge_status" in sql
    assert f"(100, '{ec.geom_md5(plan['new_streets'][0]['geometry'])}')" in sql
    assert '(100, 3),\n        (101, 3);' in sql
    assert '(100, 100, 0.0, 1.0,' in sql and 'now()),\n        (102, 101, 0.0, 1.0, 0.0, 1.0, TRUE, now());' in sql
    assert 'WHERE street_edge_id IN (100, 101);' in sql
    assert 'WHERE street_edge_id IN (101) AND status = \'open\'' in sql
    assert "(100, '2024-05-21'::date, '2025-09-05'::date, 12)" in sql
    assert "'{500,510}'::integer[], 'usgs-3dep-10m', 10.0," in sql
    assert 'TRUNCATE region_completion;' in sql and 'UPDATE mission' in sql and 'UPDATE user_current_region' in sql
    assert "FROM (VALUES ('street_edge', 'street_edge_id'), ('region', 'region_id'))" in sql
    assert "'nextval\\(''([^'']+)'''" in sql
    assert '(SELECT count(*) FROM street_edge) <> 9' in sql
    assert 'ST_Length(geom::geography) < 15' in sql


def test_expansion_sql_skips_the_blocks_an_empty_plan_has_nothing_for():
    plan = _plan()
    plan['new_streets'], plan['remaps'], plan['regions'] = [], [], [r for r in plan['regions'] if r['action'] == 'update']
    sql = ec.expansion_sql(plan, 'sidewalk_testville', 'bak', {}, {})
    assert 'INSERT INTO region' not in sql and 'AS moves' not in sql and 'INSERT INTO street_edge ' not in sql
    assert 'RAISE WARNING' not in sql and 'ARRAY[]::integer[]' in sql and '99 AS last_new_street_id' in sql


def test_expansion_sql_without_no_imagery_streets_or_lineage(tmp_path):
    plan = _plan()
    for piece in plan['new_streets']:
        piece['lineage'] = []
    imagery = {100: (True, '2024-05-21', '2024-05-21', 3), 101: (True, None, None, 0)}
    _gradient_csv(tmp_path / 'g.csv', plan)
    gradient = ec.read_gradient_rows(tmp_path / 'g.csv',
                                     {p['street_edge_id']: ec.geom_md5(p['geometry']) for p in plan['new_streets']})
    sql = ec.expansion_sql(plan, 'sidewalk_testville', 'bak', imagery, gradient)
    assert 'INSERT INTO osm_way_street_edge' not in sql and "SET status = 'no_imagery'" not in sql
    assert '(101, NULL::date, NULL::date, 0)' in sql
    nothing = {100: (False, None, None, 0), 101: (False, None, None, 0)}
    sql = ec.expansion_sql(plan, 'sidewalk_testville', 'bak', nothing, gradient)
    assert 'INSERT INTO street_imagery' not in sql and 'WHERE street_edge_id IN (100, 101) AND status' in sql
    plan['new_streets'] = []
    sql = ec.expansion_sql(plan, 'sidewalk_testville', 'bak', {}, {})
    assert 'INSERT INTO street_imagery' not in sql and 'INSERT INTO street_gradient' not in sql


def test_rollback_sql_restores_from_the_backup_and_refuses_once_the_streets_are_used():
    plan = _plan()
    sql = ec.rollback_sql(plan, 'sidewalk_testville', 'sidewalk_testville_bak', 'ws', 'abc')
    assert sql.startswith('-- Rollback of the expansion of sidewalk_testville')
    assert "IF meta.plan_sha256 <> 'abc'" in sql
    assert 'FROM label WHERE street_edge_id >= 100' in sql and 'FROM audit_task_comment\n        WHERE edge_id >= 100' in sql
    assert 'DELETE FROM street_edge WHERE street_edge_id >= 100;' in sql
    assert 'FROM sidewalk_testville_bak.street_edge_region AS before' in sql
    assert 'DELETE FROM region WHERE region_id IN (3);' in sql and 'UPDATE intersection SET region_id = 1 WHERE' in sql
    assert f"fingerprint <> '{plan['live']['fingerprint']}'" in sql
    assert "IS DISTINCT FROM '1:Old Town,2:Hidden'" in sql and 'WHERE street_edge_id < 100) <> 7' in sql
    assert 'DROP SCHEMA sidewalk_testville_bak CASCADE;' in sql and sql.rstrip().endswith('\\endif')
    plan['regions'] = [r for r in plan['regions'] if r['action'] == 'insert']
    sql = ec.rollback_sql(plan, 'sidewalk_testville', 'bak')
    assert 'UPDATE place SET region_id = 1 WHERE region_id IN (3);' in sql
    plan['regions'] = []
    assert 'WHERE region_id IN (NULL);' in ec.rollback_sql(plan, 'sidewalk_testville', 'bak')


# ---------------------------------------------------------------------------------------------------------------------
# CLI.
# ---------------------------------------------------------------------------------------------------------------------

def test_parse_args_for_both_subcommands():
    args = ec.parse_args(['plan', '--city-id', 'testville', '--workspace', 'testville-expansion', '--build', 'b.gpkg',
                          '--keep-region', '1=West End', '--data-source', 'me'])
    assert args.keep_region == {1: 'West End'} and args.first_new_street_id is None and args.corridor_m == 2.0
    args = ec.parse_args(['emit', '--workspace', 'testville-expansion', '--schema', 'sidewalk_testville'])
    assert args.backup_schema.startswith('sidewalk_testville_bak_20') and args.expect_label_count is None
    args = ec.parse_args(['emit', '--workspace', 'w', '--schema', 'sidewalk_testville', '--backup-schema', 'keep_me'])
    assert args.backup_schema == 'keep_me'
    with pytest.raises(SystemExit):
        ec.parse_args(['emit', '--workspace', 'w', '--schema', 'Sidewalk-Testville'])
    with pytest.raises(SystemExit):
        ec.parse_args(['plan', '--city-id', 'testville', '--workspace', 'Bad_Name', '--build', 'b', '--data-source', 'x'])
    with pytest.raises(SystemExit):
        ec.parse_args([])


def test_main_plans_then_emits_from_a_workspace(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(ec, 'REPO_ROOT', tmp_path)
    workspace = tmp_path / 'db' / 'onboarding' / 'testville-expansion'
    _write_live(workspace)
    build = _write_build(tmp_path / 'build.gpkg')
    ec.main(['plan', '--city-id', 'testville', '--workspace', 'testville-expansion', '--build', str(build),
             '--keep-region', '1=West End', '--data-source', _SOURCE])
    plan = ec.plan_from_json(json.loads((workspace / ec.PLAN_FILE).read_text()))
    assert [p['street_edge_id'] for p in plan['new_streets']] == [100, 101]
    assert 'live street 6 lies in no region' in caplog.text
    # emit needs the scan and the sampler to have run on the workspace first.
    with pytest.raises(SystemExit, match='error: '):
        ec.main(['emit', '--workspace', 'testville-expansion', '--schema', 'sidewalk_testville'])
    _imagery_csv(workspace / ec.IMAGERY_SUMMARY_FILE, {100: ('True', '2024-05-21', '2024-05-21', 5),
                                                       101: ('False', '', '', 0)})
    _gradient_csv(workspace / ec.GRADIENT_FILE, plan)
    ec.main(['emit', '--workspace', 'testville-expansion', '--schema', 'sidewalk_testville', '--backup-schema', 'bak'])
    sums = dict(line.split('  ')[::-1] for line in (workspace / ec.SHA_FILE).read_text().splitlines())
    assert set(sums) == {ec.PLAN_FILE, ec.EXPANSION_SQL, ec.ROLLBACK_SQL}
    assert sums[ec.EXPANSION_SQL] == ec.sha256_of(workspace / ec.EXPANSION_SQL)
    expansion = (workspace / ec.EXPANSION_SQL).read_text()
    assert f'(sha256 {sums[ec.PLAN_FILE]})' in expansion and 'CREATE SCHEMA bak;' in expansion
    assert f"meta.plan_sha256 <> '{sums[ec.PLAN_FILE]}'" in (workspace / ec.ROLLBACK_SQL).read_text()


def test_main_emits_an_empty_plan_without_scan_files(tmp_path, monkeypatch):
    monkeypatch.setattr(ec, 'REPO_ROOT', tmp_path)
    workspace = tmp_path / 'db' / 'onboarding' / 'testville-expansion'
    workspace.mkdir(parents=True)
    plan = _plan()
    plan['new_streets'] = []
    (workspace / ec.PLAN_FILE).write_text(json.dumps(ec.plan_to_json(plan)))
    ec.main(['emit', '--workspace', 'testville-expansion', '--schema', 'sidewalk_testville'])
    assert 'INSERT INTO street_edge ' not in (workspace / ec.EXPANSION_SQL).read_text()


def test_main_reports_a_bad_keep_region_as_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(ec, 'REPO_ROOT', tmp_path)
    workspace = tmp_path / 'db' / 'onboarding' / 'testville-expansion'
    _write_live(workspace)
    build = _write_build(tmp_path / 'build.gpkg')
    with pytest.raises(SystemExit, match='never removes a region'):
        ec.main(['plan', '--city-id', 'testville', '--workspace', 'testville-expansion', '--build', str(build),
                 '--data-source', _SOURCE])
