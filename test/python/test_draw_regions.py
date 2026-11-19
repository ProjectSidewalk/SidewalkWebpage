"""
Unit tests for tools/city/draw_regions.py (#6013): regions drawn for a city with no neighbourhood data.

The synthetic city is a 400 m square street grid in a metric CRS, split by a north-south divide road down its middle,
so every expectation is arithmetic. A second synthetic city has a county bay cut into its east side, the shape that
defeats the block method and that ``--method zones`` exists for (Kuna, ID). The Evansdale fixture
(``test/fixtures/draw-regions-evansdale.json``) pins the tool against the regions drawn by hand for Evansdale, IA,
the city the method was worked out on.
"""
import argparse
import json
from pathlib import Path

import geopandas as gpd
import pytest
import shapely
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, shape

import draw_regions as dr

FIXTURE = Path(__file__).resolve().parent.parent / 'fixtures' / 'draw-regions-evansdale.json'
UTM = 32615
# A 400 m city at an arbitrary UTM offset, so the lon/lat round trip in main() lands somewhere real.
X0, Y0 = 500_000.0, 4_700_000.0


def grid():
    """
    Streets every 100 m across a 400 m square: Main Street is the vertical at x=200, the divide between West and
    East; the horizontals are each cut at every crossing, as a build cuts them, and named by their row.

    Returns:
        A ``(streets, names, boundary)`` triple.
    """
    streets, names = [], []
    for x in range(0, 401, 100):
        for y in range(0, 400, 100):
            streets.append(LineString([(x, y), (x, y + 100)]))
            names.append(frozenset({'Main Street'} if x == 200 else {f'Avenue {x}'}))
    for y in range(0, 401, 100):
        for x in range(0, 400, 100):
            streets.append(LineString([(x, y), (x + 100, y)]))
            names.append(frozenset({f'Row {y}'}))
    return streets, names, box(0, 0, 400, 400)


ZONES = {'West': box(-10, -10, 205, 410), 'East': box(205, -10, 410, 410)}


def test_parse_divide_road_takes_the_last_colon_and_a_compass_side():
    assert dr.parse_divide_road('Central Avenue:south') == ('Central Avenue', 'south')
    assert dr.parse_divide_road('Route 9: Old Road : West') == ('Route 9: Old Road', 'west')
    for bad in ('Central Avenue', 'Central Avenue:up', ':south'):
        with pytest.raises(argparse.ArgumentTypeError, match='street name'):
            dr.parse_divide_road(bad)


def test_parse_landmark_needs_a_region_and_two_numbers():
    assert dr.parse_landmark('Bunger=-92.2747,42.4716') == ('Bunger', -92.2747, 42.4716)
    for bad in ('Bunger', 'Bunger=-92.2', 'Bunger=a,b', '=-92.2,42.4'):
        with pytest.raises(argparse.ArgumentTypeError, match='region name'):
            dr.parse_landmark(bad)


def test_street_names_reads_every_way_and_skips_unnamed_ones():
    names = {1: 'Elm Street', 2: 'Oak Street'}
    assert dr.street_names('1,2', names) == {'Elm Street', 'Oak Street'}
    assert dr.street_names('1, 3', names) == {'Elm Street'}
    assert dr.street_names('3', names) == frozenset()


def test_zone_at_falls_back_to_the_nearest_zone():
    assert dr.zone_at(Point(100, 100), ZONES) == 'West'
    assert dr.zone_at(Point(420, 100), ZONES) == 'East'


def test_assign_streets_puts_a_divide_road_on_its_side_whatever_its_midpoint():
    streets, names, _ = grid()
    # Zones whose edge runs right along Main Street: its midpoints sit on the edge, the noise the side rule removes.
    zones = {'West': box(-10, -10, 200, 410), 'East': box(200, -10, 410, 410)}
    regions, is_divide = dr.assign_streets(streets, names, zones, [('Main Street', 'east')])
    main = [region for region, street in zip(regions, names) if 'Main Street' in street]
    assert main == ['East'] * 4
    assert sum(is_divide) == 4
    regions, _ = dr.assign_streets(streets, names, zones, [('Main Street', 'west')])
    assert {region for region, street in zip(regions, names) if 'Main Street' in street} == {'West'}
    # A side street goes by its midpoint.
    assert regions[names.index(frozenset({'Avenue 100'}))] == 'West'


def assigned_grid():
    streets, names, boundary = grid()
    regions, is_divide = dr.assign_streets(streets, names, ZONES, [('Main Street', 'west')])
    return streets, names, boundary, regions, is_divide


def test_block_regions_tiles_the_city_with_the_border_alongside_the_divide_road():
    streets, names, boundary, regions, is_divide = assigned_grid()
    geoms = dr.block_regions(streets, regions, is_divide, boundary, strip_m=15)
    assert set(geoms) == {'West', 'East'}
    assert dr.check_regions(streets, names, regions, geoms, boundary, []) == []
    # Main Street belongs to West, so the border runs 15 m east of it, straight, the length of the city.
    border = geoms['West'].intersection(geoms['East'])
    assert border.length == pytest.approx(400)
    assert border.bounds[0] == pytest.approx(215) and border.bounds[2] == pytest.approx(215)


def test_block_regions_gives_ground_no_street_reaches_to_its_neighbour():
    streets, names, _, regions, is_divide = assigned_grid()
    # A strip of empty land past the east edge, cut off by a divider so it is a face of its own.
    boundary = box(0, 0, 480, 400)
    divider = LineString([(450, -10), (450, 410)])
    geoms = dr.block_regions(streets, regions, is_divide, boundary, [divider])
    assert geoms['East'].contains(Point(470, 200))
    assert shapely.union_all(list(geoms.values())).area == pytest.approx(boundary.area)


def test_absorb_fragments_hands_pieces_to_neighbours_and_islands_to_the_nearest():
    west, east = box(0, 0, 10, 10), box(20, 0, 30, 10)
    # Listed first, the far piece touches only the near one, so it waits for that one to be absorbed.
    far, near = box(12, 0, 14, 2), box(10, 0, 12, 2)
    island = box(100, 0, 101, 1)
    geoms = dr.absorb_fragments({'West': west, 'East': MultiPolygon([east, far, near, island])})
    assert geoms['West'].contains(Point(13, 1)) and geoms['West'].contains(Point(11, 1))
    assert geoms['East'].contains(Point(100.5, 0.5))


def test_weaving_streets_flags_a_return_but_not_a_crossing_or_two_separate_streets():
    a, b, c, d = LineString([(0, 0), (1, 0)]), LineString([(1, 0), (2, 0)]), LineString([(2, 0), (3, 0)]), \
        LineString([(10, 0), (11, 0)])
    elm, oak = frozenset({'Elm'}), frozenset({'Oak'})
    assert dr.weaving_streets([a, b, c], [elm] * 3, ['A', 'B', 'A']) == ['Elm']
    assert dr.weaving_streets([a, b, c], [oak] * 3, ['A', 'A', 'B']) == []
    # Two "Oak"s far apart, both in A: two runs, neither weaves.
    assert dr.weaving_streets([a, d], [oak, oak], ['A', 'A']) == []


def test_check_regions_reports_every_kind_of_problem():
    streets, names, boundary, regions, is_divide = assigned_grid()
    geoms = dr.block_regions(streets, regions, is_divide, boundary)
    # A gap: East loses a corner.
    gappy = {'West': geoms['West'], 'East': geoms['East'].difference(box(390, 390, 400, 400))}
    assert dr.check_regions(streets, names, regions, gappy, boundary, []) == \
        ['the regions do not tile the city (gaps or overlaps)']
    # An empty region, a street far into the wrong region, a weave, and landmarks in the wrong place or nowhere.
    swapped = list(regions)
    swapped[names.index(frozenset({'Avenue 100'}))] = 'East'
    # Row 100's four blocks run West, West, East, East; the last one going West makes it leave West and come back.
    row = [i for i, n in enumerate(names) if n == frozenset({'Row 100'})]
    assert [swapped[i] for i in row] == ['West', 'West', 'East', 'East']
    swapped[row[3]] = 'West'
    problems = dr.check_regions(streets, names, swapped, {**geoms, 'North': Polygon()}, boundary,
                                [('West', Point(300, 200)), ('East', Point(900, 900))])
    assert 'region "North" holds no street: fold its zone into a neighbour' in problems
    assert any(p.startswith('Avenue 100 leaves its region for 100 m') for p in problems)
    assert 'Row 100 switches region and back again: give it a --divide-road side, or redraw the zones' in problems
    assert 'landmark for "West" lies in [\'East\']' in problems
    assert 'landmark for "East" lies in no region' in problems
    # An unnamed street is still named in the message.
    unnamed = [frozenset() if n == frozenset({'Avenue 100'}) else n for n in names]
    problems = dr.check_regions(streets, unnamed, swapped, geoms, boundary, [])
    assert any(p.startswith('an unnamed street leaves its region') for p in problems)


def test_summary_rows_and_feature_collection_keep_the_zone_order():
    streets, names, boundary, regions, is_divide = assigned_grid()
    geoms = dr.block_regions(streets, regions, is_divide, boundary)
    rows = dr.summary_rows(regions, [line.length for line in streets], ['East', 'West'])
    assert rows == [('East', 18, 1.8), ('West', 22, 2.2)]
    shifted = {name: shapely.affinity.translate(geom, X0, Y0) for name, geom in geoms.items()}
    collection = dr.feature_collection(shifted, rows, UTM)
    assert [f['properties'] for f in collection['features']] == \
        [{'name': 'East', 'streets': 18, 'km': 1.8}, {'name': 'West', 'streets': 22, 'km': 2.2}]
    lon, lat = shape(collection['features'][0]['geometry']).centroid.coords[0]
    assert -94 < lon < -92 and 42 < lat < 43


def test_block_regions_buffers_each_named_run_whole_so_no_tick_crosses_a_border():
    # Row 100 bends 3 degrees at x=100; buffered segment by segment, the flat caps there leave a wedge that Avenue
    # 100's strip (East, here) shows through as a tick across West's ground (Evansdale, 2026-11-18).
    bend = (100, 100)
    streets = [LineString([(0, 95), bend]), LineString([bend, (200, 100)]), LineString([(100, 0), bend]),
               LineString([bend, (100, 200)])]
    names = [frozenset({'Row'})] * 2 + [frozenset({'Avenue'})] * 2
    regions, is_divide = ['West', 'West', 'East', 'East'], [True, True, False, False]
    boundary = box(0, 0, 200, 200)
    by_run = dr.block_regions(streets, regions, is_divide, boundary, names=names)
    assert not by_run['East'].intersects(Point(100, 112))
    # Unnamed, each segment is its own run, and the wedge is still trimmed to the neighbour.
    by_segment = dr.block_regions(streets, regions, is_divide, boundary)
    assert not by_segment['East'].intersects(Point(100, 112))


def test_trim_slivers_moves_a_thin_part_to_its_neighbour_but_keeps_one_nobody_borders():
    sliver = box(10, 0, 20, 0.5)
    geoms = dr.trim_slivers({'A': shapely.union_all([box(0, 0, 10, 10), sliver]), 'B': box(10, 0.5, 20, 10)})
    assert geoms['B'].contains(Point(15, 0.25)) and not geoms['A'].contains(Point(15, 0.25))
    alone = dr.trim_slivers({'A': shapely.union_all([box(0, 0, 10, 10), sliver])})
    assert alone['A'].contains(Point(15, 0.25))


def test_polygons_keeps_only_valid_polygons_above_the_minimum_area():
    nested = shapely.GeometryCollection([shapely.GeometryCollection([box(0, 0, 10, 10), Point(50, 50)]),
                                         LineString([(0, 0), (30, 30)]), box(20, 20, 20.5, 20.5)])
    assert dr.polygons(nested, min_area=1.0).equals(box(0, 0, 10, 10))
    bowtie = Polygon([(0, 0), (10, 10), (10, 0), (0, 10)])
    assert not bowtie.is_valid and dr.polygons(bowtie).is_valid
    assert dr.polygons(LineString([(0, 0), (1, 1)])).is_empty


def bay_city():
    """
    The grid city with a county bay cut in from its east edge (x 150 to 400, y 110 to 140), which splits East's ground
    into a large north part and a small south part joined only through West.

    Returns:
        A ``(streets, names, boundary)`` triple, the streets clipped to the city.
    """
    streets, names, square = grid()
    boundary = square.difference(box(150, 110, 401, 140))
    # A street crossing the bay is cut in two, as the build cuts it at the city edge.
    kept = [(part, name) for line, name in zip(streets, names)
            for part in shapely.get_parts(line.intersection(boundary)) if part.length > 0]
    return [line for line, _ in kept], [name for _, name in kept], boundary


def test_bay_defeats_blocks_but_not_zones():
    streets, names, boundary = bay_city()
    regions, is_divide = dr.assign_streets(streets, names, ZONES, [])
    blocks = dr.block_regions(streets, regions, is_divide, boundary, names=names)
    # Blocks keep East's larger part and hand the south one, streets and all, to West.
    problems = dr.check_regions(streets, names, regions, blocks, boundary, [])
    assert any('leaves its region for 100 m' in problem for problem in problems)
    zones = dr.zone_regions(ZONES, boundary, [])
    assert len(shapely.get_parts(zones['East'])) == 2
    regions = dr.majority_regions(streets, zones)
    assert dr.check_regions(streets, names, regions, zones, boundary, []) == []
    assert regions[names.index(frozenset({'Avenue 300'}))] == 'East'


def test_zone_regions_gives_a_divide_road_to_the_zone_its_probe_reaches():
    # Main Street runs 55 m inside East, as Kuna's East Kuna Road runs 70 m off its section line: a 30 m probe to the
    # west stays in East, a 120 m one reaches West.
    main = LineString([(260, 0), (260, 400)])
    boundary = box(0, 0, 400, 400)
    short = dr.zone_regions(ZONES, boundary, [(main, 'west')], strip_m=15, probe_m=30)
    long = dr.zone_regions(ZONES, boundary, [(main, 'west')], strip_m=15, probe_m=120)
    assert short['East'].contains(Point(250, 200)) and not short['West'].intersects(Point(250, 200))
    assert long['West'].contains(Point(250, 200)) and long['West'].contains(Point(270, 200))
    assert long['East'].contains(Point(280, 200))
    # A road whose probe lands past every zone keeps no strip.
    edge = dr.zone_regions(ZONES, boundary, [(LineString([(2, 0), (2, 400)]), 'west')], probe_m=30)
    assert edge['West'].equals(dr.polygons(ZONES['West'].intersection(boundary)))


def test_majority_regions_takes_the_longer_share_or_the_nearest_region():
    geoms = {'West': box(0, 0, 100, 100), 'East': box(100, 0, 200, 100)}
    streets = [LineString([(80, 50), (150, 50)]), LineString([(250, 50), (260, 50)])]
    assert dr.majority_regions(streets, geoms) == ['East', 'East']


def test_feature_collection_refuses_a_region_it_cannot_make_valid(monkeypatch):
    # Whatever polygons() gives back is checked; a line stands in for a geometry it failed to repair.
    monkeypatch.setattr(dr, 'polygons', lambda geom, min_area=0.0: LineString([(0, 0), (1, 1)]))
    with pytest.raises(ValueError, match='region "West" is not a valid polygon'):
        dr.feature_collection({'West': box(X0, Y0, X0 + 10, Y0 + 10)}, [('West', 1, 0.1)], UTM)


def write_city(root, city_id, names=True):
    """
    Writes the synthetic grid as a build's QA GeoPackage under ``root/db/onboarding/<city_id>/``, shifted into UTM 15N.

    Returns:
        The city directory.
    """
    streets, street_names, boundary = grid()
    city_dir = root / 'db' / 'onboarding' / city_id
    city_dir.mkdir(parents=True)
    gpkg = city_dir / f'{city_id}_qa.gpkg'
    way_ids = {name: i for i, name in enumerate(sorted({n for s in street_names for n in s}), start=1)}
    shift = lambda geom: shapely.affinity.translate(geom, X0, Y0)  # noqa: E731
    gpd.GeoDataFrame({'road_id': range(1, len(streets) + 1),
                      'osm_ids': [','.join(str(way_ids[n]) for n in sorted(s)) for s in street_names],
                      'length_m': [line.length for line in streets]},
                     geometry=[shift(line) for line in streets], crs=UTM).to_file(gpkg, layer='qgis_road')
    gpd.GeoDataFrame(geometry=[shift(boundary)], crs=UTM).to_file(gpkg, layer='city_boundary')
    ways = {'osm_way_id': list(way_ids.values())}
    if names:
        ways['name'] = list(way_ids)
    # Each way is the merged run of the streets carrying its name, which --method zones strips along.
    way_lines = [shift(shapely.line_merge(shapely.union_all([line for line, s in zip(streets, street_names)
                                                             if n in s])))
                 for n in way_ids]
    gpd.GeoDataFrame(ways, geometry=way_lines, crs=UTM).to_file(gpkg, layer='osm_way')
    # In lon/lat, as zones drawn in QGIS usually are, so main() densifies them before reprojecting.
    zones = gpd.GeoDataFrame({'name': list(ZONES)}, geometry=[shift(z) for z in ZONES.values()], crs=UTM)
    zones.to_crs(4326).to_file(city_dir / 'zones.geojson', driver='GeoJSON')
    gpd.GeoDataFrame(geometry=[shift(LineString([(-5, 450), (-5, 460)]))], crs=UTM) \
        .to_file(city_dir / 'dividers.geojson', driver='GeoJSON')
    return city_dir


def lonlat(x, y):
    point = gpd.GeoSeries([Point(X0 + x, Y0 + y)], crs=UTM).to_crs(4326).iloc[0]
    return f'{point.x},{point.y}'


def test_main_writes_the_regions_and_the_build_reads_them(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(dr, 'REPO_ROOT', tmp_path)
    city_dir = write_city(tmp_path, 'grid-ia')
    argv = ['--city-id', 'grid-ia', '--zones', str(city_dir / 'zones.geojson'), '--divide-road', 'Main Street:west',
            '--landmark', f'East={lonlat(300, 200)}']
    assert dr.main(argv + ['--dividers', str(city_dir / 'dividers.geojson')]) == 0
    out = json.loads((city_dir / dr.OUTPUT_NAME).read_text())
    assert [f['properties']['name'] for f in out['features']] == ['West', 'East']
    assert 'West' in capsys.readouterr().out
    # Without dividers too.
    assert dr.main(argv) == 0


def test_main_draws_zones_with_a_divide_road_strip(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(dr, 'REPO_ROOT', tmp_path)
    city_dir = write_city(tmp_path, 'grid-ia')
    argv = ['--city-id', 'grid-ia', '--method', 'zones', '--zones', str(city_dir / 'zones.geojson'),
            '--divide-road', 'Main Street:east', '--landmark', f'West={lonlat(100, 200)}']
    assert dr.main(argv) == 0
    out = {f['properties']['name']: f['properties'] for f in
           json.loads((city_dir / dr.OUTPUT_NAME).read_text())['features']}
    # Main Street, on x=200 just inside West's zone, goes to East with its strip.
    assert out['East']['streets'] == 22 and out['West']['streets'] == 18
    with pytest.raises(SystemExit):
        dr.main(argv + ['--dividers', str(city_dir / 'dividers.geojson')])
    assert 'does nothing with --method zones' in capsys.readouterr().err


def test_main_refuses_bad_inputs_and_writes_a_rejected_file(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(dr, 'REPO_ROOT', tmp_path)
    city_dir = write_city(tmp_path, 'grid-ia')
    zones = ['--zones', str(city_dir / 'zones.geojson')]
    assert dr.main(['--city-id', 'grid-ia', *zones, '--divide-road', 'Mian Street:west']) == 1
    assert 'no street is named Mian Street' in capsys.readouterr().out
    (city_dir / dr.OUTPUT_NAME).write_text('{}')   # A stale pass from an earlier run.
    assert dr.main(['--city-id', 'grid-ia', *zones, '--landmark', f'West={lonlat(300, 200)}']) == 1
    assert (city_dir / dr.REJECTED_NAME).exists() and not (city_dir / dr.OUTPUT_NAME).exists()
    assert 'landmark for "West"' in capsys.readouterr().out
    other = write_city(tmp_path, 'nameless-ia', names=False)
    assert dr.main(['--city-id', 'nameless-ia', '--zones', str(other / 'zones.geojson')]) == 1
    assert 'no street names on its osm_way layer' in capsys.readouterr().out


def test_evansdale_regions_are_reproduced():
    """
    Evansdale's 314 streets, its hand-drawn zones, dividers and divide roads give back the regions approved for it
    (Option C of #6013, with Timberline Drive's ground in Gilbert Drive): every street in the same region, every check
    passing.
    """
    data = json.loads(FIXTURE.read_text())
    crs = data['crs']
    streets = [shape(s['geometry']) for s in data['streets']]
    names = [frozenset(s['names']) for s in data['streets']]
    zones = {z['name']: shape(z['geometry']) for z in data['zones']}
    boundary = shape(data['boundary'])
    dividers = [shape(d) for d in data['dividers']]
    divide_roads = [tuple(d) for d in data['divide_roads']]
    regions, is_divide = dr.assign_streets(streets, names, zones, divide_roads)
    assert regions == [s['region'] for s in data['streets']]
    geoms = dr.block_regions(streets, regions, is_divide, boundary, dividers, names=names)
    landmarks = [(region, gpd.GeoSeries([Point(lon, lat)], crs=4326).to_crs(crs).iloc[0])
                 for region, lon, lat in data['landmarks']]
    assert dr.check_regions(streets, names, regions, geoms, boundary, landmarks) == []
    # The approved polygons, to within the 1 cm the faces are snapped to.
    assert {name: round(geom.area) for name, geom in geoms.items()} == pytest.approx(data['approved_area_m2'], abs=20)
