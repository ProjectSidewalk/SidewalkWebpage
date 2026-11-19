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
import onboard_city

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


def test_zones_by_name_unions_repeated_names_in_first_seen_order():
    zones = dr.zones_by_name(['West', 'East', 'West'], [box(0, 0, 1, 1), box(5, 0, 6, 1), box(2, 0, 3, 1)])
    assert list(zones) == ['West', 'East']
    assert zones['West'].area == pytest.approx(2) and zones['West'].contains(Point(2.5, 0.5))


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


def test_block_regions_leaves_a_county_enclave_out():
    # A hole inside one block: its ring is polygonized with the streets, so it is a face, but it is not the city's.
    streets, names, square, regions, is_divide = assigned_grid()
    city = square.difference(box(120, 120, 180, 180))
    geoms = dr.block_regions(streets, regions, is_divide, city, names=names)
    assert not any(geom.intersects(Point(150, 150)) for geom in geoms.values())
    assert dr.check_regions(streets, names, regions, geoms, city, []) == []


def test_block_regions_returns_a_zone_no_street_went_to_empty():
    streets, names, boundary, regions, is_divide = assigned_grid()
    geoms = dr.block_regions(streets, regions, is_divide, boundary, order=['North', 'West', 'East'])
    assert list(geoms) == ['North', 'West', 'East'] and geoms['North'].is_empty


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
        ['the regions leave a gap of 100 m² inside the city']
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


def bent_row(dy):
    """
    Row, West's divide road, bends at (100, 100), dropping ``dy`` over its west half; Avenue, East's, crosses it there.

    Returns:
        ``(streets, names, regions, is_divide, boundary, row_strip)``, the last being Row's own 15 m strip.
    """
    bend = (100, 100)
    streets = [LineString([(0, 100 - dy), bend]), LineString([bend, (200, 100)]), LineString([(100, 0), bend]),
               LineString([bend, (100, 200)])]
    names = [frozenset({'Row'})] * 2 + [frozenset({'Avenue'})] * 2
    row_strip = shapely.line_merge(shapely.union_all(streets[:2])).buffer(15, cap_style='flat')
    return streets, names, ['West', 'West', 'East', 'East'], [True, True, False, False], box(0, 0, 200, 200), row_strip


def test_block_regions_buffers_each_named_run_whole_so_no_tick_crosses_a_border():
    # Buffered segment by segment, flat caps at the bend leave a wedge in Row's strip that Avenue's strip (East) shows
    # through as a tick across West's ground (Evansdale, 2026-11-18). A 3 degree bend makes a wedge the sliver trim
    # removes either way; a 20 degree one makes one too wide for it, so only buffering the run whole keeps it out.
    streets, names, regions, is_divide, boundary, row_strip = bent_row(5)
    assert dr.block_regions(streets, regions, is_divide, boundary)['East'].intersection(row_strip).area == 0
    streets, names, regions, is_divide, boundary, row_strip = bent_row(36.4)
    by_segment = dr.block_regions(streets, regions, is_divide, boundary)
    assert by_segment['East'].intersection(row_strip).area > 10
    by_run = dr.block_regions(streets, regions, is_divide, boundary, names=names)
    assert by_run['East'].intersection(row_strip).area == 0


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
    zones, _ = dr.zone_regions(ZONES, boundary, [])
    # East's south part is larger than the build's 1 ha floor, so it stays East's.
    assert len(shapely.get_parts(zones['East'])) == 2
    regions = dr.majority_regions(streets, zones)
    assert dr.check_regions(streets, names, regions, zones, boundary, []) == []
    assert regions[names.index(frozenset({'Avenue 300'}))] == 'East'


def test_zone_regions_gives_a_divide_road_to_the_zone_its_probe_reaches():
    # Main Street runs 55 m inside East, as Kuna's East Kuna Road runs 70 m off its section line: a 30 m probe to the
    # west stays in East, a 120 m one reaches West.
    main = LineString([(260, 0), (260, 400)])
    boundary = box(0, 0, 400, 400)
    short, report = dr.zone_regions(ZONES, boundary, [(main, 'west', 'Main')], strip_m=15, probe_m=30)
    assert short['East'].contains(Point(250, 200)) and not short['West'].intersects(Point(250, 200))
    # The short probe stays in East, the zone the road lies in, with West's zone near enough ahead that a longer
    # probe might have been meant, and the report says so.
    assert report == {'Main': {('inside', 'East', 'West'): pytest.approx(400)}}
    long, report = dr.zone_regions(ZONES, boundary, [(main, 'west', 'Main')], strip_m=15, probe_m=120)
    assert long['West'].contains(Point(250, 200)) and long['West'].contains(Point(270, 200))
    assert long['East'].contains(Point(280, 200))
    # The 40 m of East between the strip and West's zone stays East's: in this 400 m tall city it covers 1.6 ha, a part
    # the build keeps. So West's 1.2 ha strip is a ribbon cut off from the rest of West, which the report names.
    assert len(shapely.get_parts(long['East'])) == 2
    assert report == {'Main': {'West': pytest.approx(400), ('cut off', 'West'): pytest.approx(400)}}
    # In a 200 m tall city both are under the build's 1 ha: the band borders only West's ground and goes to West, the
    # 0.6 ha strip borders only East's and goes to East, as the build would hand them, and the report says so.
    low, report = dr.zone_regions(ZONES, box(0, 0, 400, 200), [(LineString([(260, 0), (260, 200)]), 'west', 'Main')],
                                  probe_m=120)
    assert low['West'].contains(Point(230, 100)) and low['East'].contains(Point(260, 100))
    assert dr.detached_pieces(low) == []
    assert report == {'Main': {'West': pytest.approx(200), ('handed away', 'West'): pytest.approx(200)}}
    # A road whose probe lands past every zone keeps no strip.
    edge, report = dr.zone_regions(ZONES, boundary, [(LineString([(2, 0), (2, 400)]), 'west', 'Edge')], probe_m=30)
    assert edge['West'].equals(dr.polygons(ZONES['West'].intersection(boundary)))
    assert report == {'Edge': {'no zone': pytest.approx(400)}}


def test_zone_regions_notes_a_deep_stretch_only_with_a_border_near_ahead():
    zones = {'West': box(-10, -10, 205, 410), 'East': box(205, -10, 300, 410), 'Far': box(300, -10, 1000, 410)}
    city = box(0, 0, 1000, 400)

    def report(x, side='east'):
        return dr.zone_regions(zones, city, [(LineString([(x, 0), (x, 400)]), side, 'Main')], probe_m=30)[1]['Main']
    # 10 m inside East on its east side: the probe finds East, but the probe back finds West, so the road is at
    # East's edge and plainly East's, even with Far 120 m ahead.
    assert report(215) == {'East': pytest.approx(400)}
    # 45 m inside East: deep, with Far within four probes ahead, so maybe a probe too short.
    assert report(250) == {('inside', 'East', 'Far'): pytest.approx(400)}
    # Deep in Far with no other zone within four probes ahead: a road running on past its border, not noted.
    assert report(600) == {'Far': pytest.approx(400)}


def test_zone_regions_looks_a_road_up_one_stretch_at_a_time():
    # Row runs along the south edge of two zones; its west stretches belong to the zone north of them, its east ones
    # to the other. One lookup for the whole road would hand it all to the zone its midpoint's probe reaches. The way
    # runs on 100 m past the city edge, which the report leaves out.
    zones = {'Northwest': box(-10, 200, 205, 410), 'Northeast': box(205, 200, 410, 410),
             'South': box(-10, -10, 410, 200)}
    row = LineString([(0, 200), (500, 200)])
    geoms, report = dr.zone_regions(zones, box(0, 0, 400, 400), [(row, 'north', 'Row')])
    assert geoms['Northwest'].contains(Point(100, 195)) and geoms['Northeast'].contains(Point(300, 195))
    assert report['Row'] == {'Northwest': pytest.approx(200), 'Northeast': pytest.approx(200)}


def test_zone_regions_buffers_a_bent_road_whole_so_the_other_region_does_not_reach_it():
    # Row bends 20 degrees at a stretch boundary; buffered stretch by stretch, the flat caps there leave a wedge of
    # South reaching up to the road on the outside of the bend.
    zones = {'North': box(-10, 200, 410, 410), 'South': box(-10, -10, 410, 200)}
    row = LineString([(0, 200), (200, 200), (400, 272.8)])
    geoms, _ = dr.zone_regions(zones, box(0, 0, 400, 400), [(row, 'north', 'Row')])
    assert geoms['North'].contains(Point(201, 192))


def test_zone_regions_keeps_strips_inside_the_city():
    # Row runs 5 m inside the city's north edge and belongs to South; its strip would reach 10 m past the edge.
    # Outer runs 10 m outside the city: it borders no region, so it lays no strip along the edge.
    zones = {'North': box(-10, 390, 410, 410), 'South': box(-10, -10, 410, 390)}
    ways = [(LineString([(0, 395), (400, 395)]), 'south', 'Row'),
            (LineString([(0, 410), (400, 410)]), 'south', 'Outer')]
    geoms, report = dr.zone_regions(zones, box(0, 0, 400, 400), ways)
    assert geoms['South'].contains(Point(200, 398))
    assert report == {'Row': {'South': pytest.approx(400)}, 'Outer': {}}
    assert all(geom.difference(box(0, 0, 400, 400)).area < 1e-6 for geom in geoms.values())


def test_zone_regions_finds_an_owner_whose_zone_is_a_county_enclave_at_the_probe():
    # An enclave fills North's zone right behind Row, so a 120 m probe lands outside the city. The owner is looked up
    # in the unclipped zones, which still hold the probe, and North has ground beside the enclave to attach to.
    zones = {'North': box(-10, 200, 410, 410), 'South': box(-10, -10, 410, 200)}
    city = box(0, 0, 400, 400).difference(box(100, 205, 300, 340))
    geoms, report = dr.zone_regions(zones, city, [(LineString([(0, 200), (400, 200)]), 'north', 'Row')], probe_m=120)
    assert geoms['North'].contains(Point(200, 195))
    assert report['Row'] == {'North': pytest.approx(400)}


def test_zone_regions_gives_no_strip_to_a_zone_with_no_ground_nearby():
    # East's zone lies wholly outside the city, past Row on its east edge: its strip would be a ribbon cut off from
    # any region of its own (Kuna's Columbia Road gave Stroebel one, 700 m from the rest of it).
    zones = {'West': box(-10, -10, 400, 410), 'East': box(400, -10, 600, 410)}
    road = LineString([(395, 0), (395, 400)])
    geoms, report = dr.zone_regions(zones, box(0, 0, 400, 400), [(road, 'east', 'Edge Road')], probe_m=30)
    assert geoms['East'].is_empty and geoms['West'].contains(Point(398, 200))
    assert report == {'Edge Road': {'out of reach': pytest.approx(400)}}
    # North's zone holds the probe, but the city reaches it only across a bay 155 m wide: no strip there either.
    zones = {'North': box(-10, 200, 410, 410), 'South': box(-10, -10, 410, 200)}
    city = shapely.union_all([box(0, 0, 400, 200), box(0, 355, 400, 400)])
    geoms, report = dr.zone_regions(zones, city, [(LineString([(0, 195), (400, 195)]), 'north', 'Row')], probe_m=30)
    assert geoms['South'].contains(Point(200, 190)) and not geoms['North'].intersects(box(0, 0, 400, 200))
    assert report == {'Row': {'out of reach': pytest.approx(400)}}


def test_tiling_problems_report_gaps_spills_and_overlaps_but_not_snapping_noise():
    city = box(0, 0, 400, 400)
    west, east = box(0, 0, 200, 400), box(200, 0, 400, 400)
    assert dr.tiling_problems({'West': west, 'East': east}, city) == []
    # 10 cm off all the way along the border: 40 m² in all, but thinner than any real gap.
    assert dr.tiling_problems({'West': box(0, 0, 199.9, 400), 'East': east}, city) == []
    # A real 10 x 10 m gap joined to 5 mm of snapping noise around the edge: its average width is a few centimetres,
    # but it is still a gap.
    inset = {'West': box(0.005, 0.005, 200, 399.995), 'East': box(200, 0.005, 399.995, 399.995).difference(
        box(390, 390, 400, 400))}
    assert dr.tiling_problems(inset, city) == ['the regions leave a gap of 108 m² inside the city']
    assert dr.tiling_problems({'West': box(0, 0, 199, 400), 'East': east}, city) == \
        ['the regions leave a gap of 400 m² inside the city']
    assert dr.tiling_problems({'West': box(0, 0, 201, 400), 'East': east}, city) == \
        ['regions "West" and "East" overlap by 400 m²']
    problems = dr.tiling_problems({'West': box(-10, 0, 200, 400), 'East': east}, city, crs=UTM)
    assert problems[0].startswith('region "West" reaches 4000 m² outside the city near ')


def test_detached_pieces_and_the_check_ignore_crumbs_and_parts_the_build_keeps():
    main, crumb, piece, part = box(0, 0, 200, 200), box(300, 0, 305, 5), box(300, 100, 330, 130), box(500, 0, 700, 100)
    geoms = {'West': shapely.union_all([main, crumb, piece, part])}
    assert [(name, round(p.area)) for name, p in dr.detached_pieces(geoms)] == [('West', 900)]
    # A piece touching the rest of its region at a corner shares no border with it, so the build hands it over too.
    corner = {'West': shapely.union_all([main, box(200, 200, 230, 230)])}
    assert [(name, round(p.area)) for name, p in dr.detached_pieces(corner)] == [('West', 900)]
    problems = dr.check_regions([], [], [], geoms, shapely.union_all(list(geoms.values())), [])
    assert problems == ['region "West" holds no street: fold its zone into a neighbour',
                        'region "West" has a 900 m² piece cut off from the rest; the build would hand it to a '
                        'neighbour']


def test_check_regions_flags_a_stray_from_the_build_heal_length():
    # Avenue runs north out of West into East; the build reattaches a stray shorter than 30 m.
    geoms = {'West': box(0, 0, 100, 100), 'East': box(0, 100, 100, 300)}
    boundary = box(0, 0, 100, 300)
    lane = LineString([(20, 200), (20, 290)])   # East's own street.

    def problems(stray):
        return dr.check_regions([LineString([(50, 0), (50, 100 + stray)]), lane],
                                [frozenset({'Avenue'}), frozenset({'Lane'})], ['West', 'East'], geoms, boundary, [])
    assert problems(20) == [] and problems(29) == []
    for stray in (30.2, 40):
        assert problems(stray) == [f'Avenue leaves its region for {stray - dr.STRAY_SLACK_M:.0f} m; the build would '
                                   f'cut it into a street of its own (move a zone edge or a divider off it)']


def test_majority_regions_takes_the_longer_share_or_the_nearest_region():
    geoms = {'West': box(0, 0, 100, 100), 'East': box(100, 0, 200, 100)}
    streets = [LineString([(80, 50), (150, 50)]), LineString([(250, 50), (260, 50)])]
    assert dr.majority_regions(streets, geoms) == ['East', 'East']


def test_feature_collection_snaps_to_a_1e7_degree_grid_and_drops_crumbs():
    region = shapely.union_all([box(X0, Y0, X0 + 100, Y0 + 100), box(X0 + 200, Y0, X0 + 200.7, Y0 + 0.7)])
    geom = shape(dr.feature_collection({'West': region}, [('West', 1, 0.1)], UTM)['features'][0]['geometry'])
    assert geom.geom_type == 'Polygon' and geom.is_valid
    assert all(round(v * 1e7) == pytest.approx(v * 1e7, abs=1e-6) for xy in geom.exterior.coords for v in xy)


def test_feature_collection_refuses_a_region_it_cannot_make_valid(monkeypatch):
    # Whatever polygons() gives back is checked; a line stands in for a geometry it failed to repair.
    monkeypatch.setattr(dr, 'polygons', lambda geom, min_area=0.0: LineString([(0, 0), (1, 1)]))
    with pytest.raises(ValueError, match='region "West" is not a valid polygon'):
        dr.feature_collection({'West': box(X0, Y0, X0 + 10, Y0 + 10)}, [('West', 1, 0.1)], UTM)


def write_city(root, city_id, names=True, zones=None):
    """
    Writes the synthetic grid as a build's QA GeoPackage under ``root/db/onboarding/<city_id>/``, shifted into UTM 15N.
    Its ``osm_way`` layer also holds Far Road, a named way outside the city that no built street lies on.

    Args:
        zones: ``[(name, Polygon)]`` for ``zones.geojson``, in the grid's coordinates; :data:`ZONES` by default.

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
    ways = {'osm_way_id': [*way_ids.values(), len(way_ids) + 1]}
    if names:
        ways['name'] = [*way_ids, 'Far Road']
    # Each way is the merged run of the streets carrying its name, which --method zones strips along.
    way_lines = [shift(shapely.line_merge(shapely.union_all([line for line, s in zip(streets, street_names)
                                                             if n in s])))
                 for n in way_ids] + [shift(LineString([(600, 0), (600, 400)]))]
    gpd.GeoDataFrame(ways, geometry=way_lines, crs=UTM).to_file(gpkg, layer='osm_way')
    # In lon/lat, as zones drawn in QGIS usually are, so main() densifies them before reprojecting.
    zones = zones or list(ZONES.items())
    frame = gpd.GeoDataFrame({'name': [name for name, _ in zones]}, geometry=[shift(z) for _, z in zones], crs=UTM)
    frame.to_crs(4326).to_file(city_dir / 'zones.geojson', driver='GeoJSON')
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
    # The build reads the file as written: two valid regions, each one polygon, tiling the city.
    regions = gpd.read_file(city_dir / dr.OUTPUT_NAME)
    city = gpd.read_file(city_dir / 'grid-ia_qa.gpkg', layer='city_boundary').to_crs(4326)
    built = onboard_city.prepare_regions(regions, city, 10_000).to_crs(UTM)
    assert sorted(built['name']) == ['East', 'West'] and built.is_valid.all()
    assert [len(shapely.get_parts(geom)) for geom in built.geometry] == [1, 1]
    # To within the 1 cm the regions are snapped to, around a 1.6 km edge.
    assert built.union_all().symmetric_difference(city.to_crs(UTM).union_all()).area < 16
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
    assert 'Main Street:east -> East 0.40' in capsys.readouterr().out
    with pytest.raises(SystemExit):
        dr.main(argv + ['--dividers', str(city_dir / 'dividers.geojson')])
    assert 'does nothing with --method zones' in capsys.readouterr().err
    with pytest.raises(SystemExit):
        dr.main(argv + ['--probe-m', '15'])
    assert '--probe-m must be longer than --strip-m' in capsys.readouterr().err


def test_main_prints_the_stretches_a_divide_road_kept_no_strip_for(tmp_path, monkeypatch, capsys):
    # West's zone covers the city up to y=300, North's the rest, and Sky's lies past the city's north edge. Row 400
    # (the edge) has no zone to its north; Row 100 lies deep in West with no other zone near; Row 200 lies deep in
    # West too, but with North 100 m ahead, so it is noted.
    monkeypatch.setattr(dr, 'REPO_ROOT', tmp_path)
    city_dir = write_city(tmp_path, 'grid-ia', zones=[('West', box(-10, -10, 410, 300)),
                                                      ('North', box(-10, 300, 410, 410)),
                                                      ('Sky', box(-10, 500, 410, 700))])
    argv = ['--city-id', 'grid-ia', '--method', 'zones', '--zones', str(city_dir / 'zones.geojson'),
            '--divide-road', 'Row 400:north', '--divide-road', 'Row 100:north', '--divide-road', 'Row 200:north']
    assert dr.main(argv) == 1
    printed = capsys.readouterr().out
    assert 'Row 400:north -> no region' in printed and '0.40 kept no strip: the probe left every zone' in printed
    assert 'Row 100:north -> West 0.40' in printed
    assert '0.40 lie more than --probe-m inside West, with North within 4x --probe-m to the north' in printed
    assert printed.count('lie more than --probe-m') == 1
    assert 'region "Sky" holds no street' in printed


def test_main_refuses_a_divide_road_strip_cut_off_from_its_owner(tmp_path, monkeypatch, capsys):
    # Avenue 300 lies 95 m inside East's zone and belongs to West: its strip reaches West's zone only across 70 m of
    # East. At 15 m a side the strip is 1.2 ha, a ribbon the build would keep as a detached part of West.
    monkeypatch.setattr(dr, 'REPO_ROOT', tmp_path)
    city_dir = write_city(tmp_path, 'grid-ia')
    argv = ['--city-id', 'grid-ia', '--method', 'zones', '--zones', str(city_dir / 'zones.geojson'),
            '--divide-road', 'Avenue 300:west', '--probe-m', '120']
    assert dr.main(argv) == 1
    assert 'Avenue 300:west: 400 m of its strip for "West" is cut off from the rest of "West"' in \
        capsys.readouterr().out
    # At 10 m a side it is 0.8 ha, which the build hands to East: the road is East's after all, said as a note.
    assert dr.main(argv + ['--strip-m', '10']) == 0
    assert '0.40 of strip for West went to a neighbour, cut off from the rest of West' in capsys.readouterr().out


def test_main_refuses_bad_inputs_and_writes_a_rejected_file(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(dr, 'REPO_ROOT', tmp_path)
    city_dir = write_city(tmp_path, 'grid-ia')
    zones = ['--zones', str(city_dir / 'zones.geojson')]
    # A misspelt road, and one OSM has but the build does not.
    for road in ('Mian Street', 'Far Road'):
        assert dr.main(['--city-id', 'grid-ia', *zones, '--divide-road', f'{road}:west']) == 1
        assert f'no built street is named {road}' in capsys.readouterr().out
    (city_dir / dr.OUTPUT_NAME).write_text('{}')   # A stale pass from an earlier run.
    assert dr.main(['--city-id', 'grid-ia', *zones, '--landmark', f'West={lonlat(300, 200)}']) == 1
    assert (city_dir / dr.REJECTED_NAME).exists() and not (city_dir / dr.OUTPUT_NAME).exists()
    assert 'landmark for "West"' in capsys.readouterr().out
    # A pass clears the earlier rejection.
    assert dr.main(['--city-id', 'grid-ia', *zones]) == 0
    assert (city_dir / dr.OUTPUT_NAME).exists() and not (city_dir / dr.REJECTED_NAME).exists()
    # A run that fails before writing leaves neither file behind.
    monkeypatch.setattr(dr, 'feature_collection', lambda *_: (_ for _ in ()).throw(ValueError('not valid')))
    with pytest.raises(ValueError):
        dr.main(['--city-id', 'grid-ia', *zones])
    assert not (city_dir / dr.OUTPUT_NAME).exists() and not (city_dir / dr.REJECTED_NAME).exists()
    other = write_city(tmp_path, 'nameless-ia', names=False)
    assert dr.main(['--city-id', 'nameless-ia', '--zones', str(other / 'zones.geojson')]) == 1
    assert 'no street names on its osm_way layer' in capsys.readouterr().out


def test_main_names_a_zones_file_it_cannot_read(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(dr, 'REPO_ROOT', tmp_path)
    city_dir = write_city(tmp_path, 'grid-ia')
    assert dr.main(['--city-id', 'grid-ia', '--zones', str(city_dir / 'zones.geojson'), '--zone-name-col', 'nom']) == 1
    assert 'has no "nom" column (it has: name); pass --zone-name-col' in capsys.readouterr().out
    gpd.GeoDataFrame({'name': ['West']}, geometry=[box(0, 0, 1, 1)]).to_file(city_dir / 'bare.gpkg')
    assert dr.main(['--city-id', 'grid-ia', '--zones', str(city_dir / 'bare.gpkg')]) == 1
    assert 'has no CRS' in capsys.readouterr().out


def test_main_draws_a_region_from_several_zones_and_reports_one_without_streets(tmp_path, monkeypatch, capsys):
    # West drawn as two polygons, and a zone Empty out past the city's east edge, by blocks.
    monkeypatch.setattr(dr, 'REPO_ROOT', tmp_path)
    city_dir = write_city(tmp_path, 'grid-ia', zones=[('West', box(-10, -10, 205, 200)), ('East', ZONES['East']),
                                                      ('West', box(-10, 200, 205, 410)), ('Empty', box(500, 0, 600,
                                                                                                         400))])
    assert dr.main(['--city-id', 'grid-ia', '--zones', str(city_dir / 'zones.geojson')]) == 1
    printed = capsys.readouterr().out
    assert printed.splitlines()[1].split() == ['West', '22', '2.20']
    assert 'region "Empty" holds no street: fold its zone into a neighbour' in printed


def test_read_zones_densifies_lonlat_edges_before_reprojecting(tmp_path):
    # Two zones share a 16 km parallel, one drawn with a corner halfway along it. Reprojected corner to corner, the
    # undivided edge would run as a straight chord nearly 5 m off the other zone's corner (Kuna's 46 m gap, #6013).
    lon, lat = -93.3, 42.0
    frame = gpd.GeoDataFrame({'name': ['North', 'South', 'South']},
                             geometry=[box(lon, lat, lon + 0.2, lat + 0.05), box(lon, lat - 0.05, lon + 0.1, lat),
                                       box(lon + 0.1, lat - 0.05, lon + 0.2, lat)], crs=4326)
    frame.to_file(tmp_path / 'zones.geojson')
    zones = dr.read_zones(tmp_path / 'zones.geojson', 'name', UTM)
    corner = gpd.GeoSeries([Point(lon + 0.1, lat)], crs=4326).to_crs(UTM).iloc[0]
    assert zones['North'].distance(corner) < 0.01
    assert zones['North'].intersection(zones['South']).area < 1


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
