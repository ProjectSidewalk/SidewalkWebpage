"""Unit tests for tools/city/osm_lineage.py (#5741): matching streets to the OSM ways they lie on, by geometry."""
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
from shapely.geometry import LineString, Point, Polygon

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'tools' / 'city'))
import osm_lineage as ol  # noqa: E402

# One degree of longitude at the equator is ~111 km, so this many degrees is about one metre.
M = 1 / 111_320


def lonlat(*points_m):
    """A LineString through the given (x, y) metre offsets from (0, 0), in lon/lat."""
    return LineString([(x * M, y * M) for x, y in points_m])


def links_of(lineages):
    return [(link.way_id, link.street_from, link.street_to, link.way_from, link.way_to, link.same_direction)
            for link in lineages[0].links]


# --------------------------------------------------------------------------------------------------------------------
# compute_lineage end to end
# --------------------------------------------------------------------------------------------------------------------

def test_a_street_cut_from_one_way_covers_it_in_the_drawn_direction():
    way = lonlat((0, 0), (100, 0))
    lineages = ol.compute_lineage([(1, way, [10])], {10: way})
    assert lineages[0].status == 'matched'
    assert lineages[0].coverage == pytest.approx(1.0)
    (way_id, s_from, s_to, w_from, w_to, same), = links_of(lineages)
    assert (way_id, s_from, s_to, same) == (10, 0.0, 1.0, True)
    assert (w_from, w_to) == pytest.approx((0.0, 1.0), abs=1e-6)


def test_a_street_drawn_against_its_way_is_flagged_as_the_other_direction():
    way = lonlat((0, 0), (100, 0))
    street = lonlat((100, 0), (0, 0))
    lineages = ol.compute_lineage([(1, street, [10])], {10: way})
    (_, s_from, s_to, w_from, w_to, same), = links_of(lineages)
    assert (s_from, s_to, same) == (0.0, 1.0, False)
    assert (w_from, w_to) == pytest.approx((0.0, 1.0), abs=1e-6)


def test_a_street_joined_from_two_ways_lists_both_in_street_order_with_their_stretches():
    # Way 20 is drawn toward the street's start, so the street runs it backwards; the street's vertex at 60 m is the
    # handover, which the sampling hits exactly.
    way_a = lonlat((0, 0), (60, 0))
    way_b = lonlat((100, 0), (60, 0))
    street = lonlat((0, 0), (60, 0), (100, 0))
    lineages = ol.compute_lineage([(1, street, [20, 10])], {10: way_a, 20: way_b})
    links = links_of(lineages)
    assert [link[0] for link in links] == [10, 20]
    # Exact: the run along each way is trimmed at the way's end node, not at the last sample within tolerance of it.
    assert links[0][1:3] == (0.0, 0.6)
    assert links[1][1:3] == (0.6, 1.0)
    assert links[0][3:] == pytest.approx((0.0, 1.0, True), abs=1e-6)
    assert links[1][3:] == pytest.approx((0.0, 1.0, False), abs=1e-6)
    assert lineages[0].status == 'matched'


def test_a_street_in_the_middle_of_a_long_way_locates_its_stretch_along_the_way():
    way = lonlat((0, 0), (300, 0))
    street = lonlat((100, 0), (200, 0))
    (_, s_from, s_to, w_from, w_to, same), = links_of(ol.compute_lineage([(1, street, [])], {10: way}))
    assert (s_from, s_to, same) == (0.0, 1.0, True)
    assert (w_from, w_to) == pytest.approx((1 / 3, 2 / 3), abs=1e-6)


def test_a_cross_street_through_the_middle_is_not_a_way_the_street_lies_on():
    way = lonlat((0, 0), (100, 0))
    cross = lonlat((50, -50), (50, 50))
    lineages = ol.compute_lineage([(1, way, [10])], {10: way, 30: cross})
    assert [link.way_id for link in lineages[0].links] == [10]


def test_a_parallel_way_beyond_the_tolerance_is_ignored_and_one_within_it_only_gets_what_is_free():
    way = lonlat((0, 0), (100, 0))
    far = lonlat((0, 15), (100, 15))
    near = lonlat((0, 2), (100, 2))
    # The hint way claims the whole street first, so the near parallel way is left with nothing.
    lineages = ol.compute_lineage([(1, way, [10])], {10: way, 40: far, 50: near})
    assert [link.way_id for link in lineages[0].links] == [10]
    # Without the hint, the longer run wins and the shorter parallel way again gets nothing.
    short_near = lonlat((20, 2), (40, 2))
    lineages = ol.compute_lineage([(1, way, [])], {10: way, 60: short_near})
    assert [link.way_id for link in lineages[0].links] == [10]


def test_a_hint_way_the_matching_cannot_place_is_listed_without_a_position():
    way = lonlat((0, 0), (100, 0))
    elsewhere = lonlat((0, 500), (100, 500))
    lineages = ol.compute_lineage([(1, way, [99, 10])], {10: way, 99: elsewhere})
    links = lineages[0].links
    assert [link.way_id for link in links] == [10, 99]
    assert links[0].positioned and not links[1].positioned
    assert links[1] == ol.WayLink(99)
    # A hint way the fetch did not return at all is listed the same way, once however often the export named it.
    lineages = ol.compute_lineage([(1, way, [77, 77])], {10: way})
    assert [(link.way_id, link.positioned) for link in lineages[0].links] == [(10, True), (77, False)]


def test_a_short_way_between_two_long_ones_gets_exactly_the_stretch_between_its_nodes():
    # 15 m is shorter than the tolerance reaches on both sides together, so without trimming at the way's nodes the
    # run along it would be mostly overhang and read as merely touching it.
    way_a, way_b, way_c = lonlat((0, 0), (40, 0)), lonlat((40, 0), (55, 0)), lonlat((55, 0), (100, 0))
    street = lonlat((0, 0), (40, 0), (55, 0), (100, 0))
    lineages = ol.compute_lineage([(1, street, [])], {1: way_a, 2: way_b, 3: way_c})
    assert [link[:3] for link in links_of(lineages)] == [(1, 0.0, 0.4), (2, 0.4, 0.55), (3, 0.55, 1.0)]
    assert lineages[0].status == 'matched'


def test_partial_and_unmatched_streets_report_their_coverage():
    way = lonlat((0, 0), (40, 0))
    street = lonlat((0, 0), (100, 0))
    partial, = ol.compute_lineage([(1, street, [])], {10: way})
    assert partial.status == 'partial'
    assert partial.coverage == pytest.approx(0.4, abs=0.06)
    unmatched, = ol.compute_lineage([(2, lonlat((0, 300), (100, 300)), [10])], {10: way})
    assert unmatched.status == 'unmatched'
    assert unmatched.coverage == 0.0
    assert unmatched.links == (ol.WayLink(10),)
    assert ol.lineage_summary([partial, unmatched]) == {'matched': 0, 'partial': 1, 'unmatched': 1}


def test_a_street_shorter_than_the_minimum_run_still_matches_whole():
    way = lonlat((0, 0), (3, 0))
    lineages = ol.compute_lineage([(1, way, [])], {10: way})
    assert lineages[0].status == 'matched'
    assert lineages[0].links[0].street_to == 1.0


def test_what_is_left_of_a_run_between_claimed_stretches_must_still_be_long_enough():
    # Ways 10 and 30 are the street's own ways, with a 6 m gap between them; way 20 runs along the whole middle and
    # gets only that gap, which a 7 m minimum run rejects.
    project = ol.metric_projection(0, 0)
    street = project(lonlat((0, 0), (100, 0)))
    ways = {10: project(lonlat((0, 0), (48, 0))), 30: project(lonlat((54, 0), (100, 0))),
            20: project(lonlat((30, 0), (70, 0)))}
    links, coverage = ol.match_street(street, ways, hint_ids=(10, 30), min_run_m=7)
    assert [link.way_id for link in links] == [10, 30]
    assert coverage == pytest.approx(0.94, abs=1e-3)
    links, coverage = ol.match_street(street, ways, hint_ids=(10, 30))
    assert [link.way_id for link in links] == [10, 20, 30]
    assert links[1].street_from == pytest.approx(0.48, abs=1e-4)
    assert links[1].street_to == pytest.approx(0.54, abs=1e-4)
    assert coverage == pytest.approx(1.0)


def test_no_streets_means_no_lineages():
    assert ol.compute_lineage([], {10: lonlat((0, 0), (1, 0))}) == []


# --------------------------------------------------------------------------------------------------------------------
# The pieces
# --------------------------------------------------------------------------------------------------------------------

def test_sample_positions_cover_vertices_steps_and_both_ends():
    line = LineString([(0, 0), (12, 0), (12, 9)])
    positions = ol.sample_positions(line, 5.0)
    assert positions[0] == 0.0 and positions[-1] == pytest.approx(21.0)
    assert 12.0 in positions
    assert {5.0, 10.0, 15.0, 20.0} <= set(positions)
    assert list(ol.sample_positions(line, 0)) == [0.0, 12.0, 21.0]


def test_runs_finds_each_maximal_stretch_of_true():
    assert ol._runs(np.array([False, True, True, False, True])) == [(1, 2), (4, 4)]
    assert ol._runs(np.array([True, True])) == [(0, 1)]
    assert ol._runs(np.array([False])) == []


def test_subtract_leaves_the_pieces_outside_the_taken_intervals():
    assert ol._subtract((0, 10), []) == [(0, 10)]
    assert ol._subtract((0, 10), [(3, 4)]) == [(0, 3), (4, 10)]
    assert ol._subtract((0, 10), [(0, 4), (8, 20)]) == [(4, 8)]
    assert ol._subtract((0, 10), [(-1, 11)]) == []
    assert ol._subtract((0, 10), [(20, 30)]) == [(0, 10)]


def test_candidate_runs_rejects_a_run_that_merely_touches_the_way():
    street = LineString([(0, 0), (100, 0)])
    positions = ol.sample_positions(street, 5.0)
    cross = LineString([(50, -50), (50, 50)])
    assert ol.candidate_runs(street, cross, positions) == []
    # One sample within a tight tolerance is a point, not a stretch.
    assert ol.candidate_runs(street, cross, positions, tol_m=2) == []
    # A stretch shorter than the minimum run on a longer street.
    stub = LineString([(48, 0), (52, 0)])
    assert ol.candidate_runs(street, stub, ol.sample_positions(street, 1.0), tol_m=0.5) == []
    along = LineString([(0, 0), (100, 0)])
    assert ol.candidate_runs(street, along, positions) == [(0.0, 100.0, True)]
    backwards = LineString([(100, 0), (0, 0)])
    assert ol.candidate_runs(street, backwards, positions) == [(0.0, 100.0, False)]


def test_snap_fraction_takes_rounding_noise_off_the_ends_only():
    assert ol.snap_fraction(1e-9) == 0.0
    assert ol.snap_fraction(1 - 1e-9) == 1.0
    assert ol.snap_fraction(0.25) == 0.25
    assert ol.snap_fraction(0.1 + 0.2) == 0.3


def test_locate_on_way_is_none_when_the_stretch_collapses_to_a_point():
    street = LineString([(0, 0), (100, 0)])
    way = LineString([(0, 0), (50, 0)])
    assert ol.locate_on_way(street, way, 0, 25) == pytest.approx((0.0, 0.5))
    assert ol.locate_on_way(street, way, 60, 80) is None


def test_ways_from_features_keeps_linestring_ways_only():
    features = gpd.GeoDataFrame(
        {'highway': ['residential', 'pedestrian', 'crossing']},
        geometry=[LineString([(0, 0), (1, 0)]), Polygon([(0, 0), (1, 0), (1, 1)]), Point(0, 0)],
        index=pd.MultiIndex.from_tuples([('way', 5), ('way', 6), ('node', 7)], names=['element', 'id']),
        crs='EPSG:4326')
    ways = ol.ways_from_features(features)
    assert list(ways) == [5]
    assert ways[5].equals(LineString([(0, 0), (1, 0)]))


def test_lineage_rows_flatten_positioned_and_unpositioned_links():
    lineage = ol.StreetLineage(7, (ol.WayLink(1, 0.0, 0.5, 0.2, 0.9, True), ol.WayLink(2)), 0.5)
    rows = ol.lineage_rows([lineage])
    assert rows == [
        {'street_id': 7, 'osm_way_id': 1, 'street_from_frac': 0.0, 'street_to_frac': 0.5, 'way_from_frac': 0.2,
         'way_to_frac': 0.9, 'same_direction': True},
        {'street_id': 7, 'osm_way_id': 2, 'street_from_frac': None, 'street_to_frac': None, 'way_from_frac': None,
         'way_to_frac': None, 'same_direction': None},
    ]
