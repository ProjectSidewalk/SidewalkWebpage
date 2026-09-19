"""
Unit tests for scripts/street_gradient.py.

Covers the profile math (sampling points along a street, bilinear lookup, gap filling, smoothing, the windowed grade
statistics, the structure / suspect / no-data verdicts), the elevation sources (USGS tile naming, the hand-downloaded
directory locator, the raster sampler), the cityparams lookup, the CSV layer, and `main` end to end. Nothing touches
the network: rasters are small synthetic GeoTIFFs written to `tmp_path` whose elevation is a known plane, so an
expected grade is arithmetic rather than a recorded number. See test/python/README.md.
"""

import argparse
import csv
from pathlib import Path

import numpy as np
import pytest
import rasterio
import shapely
from pyproj import Geod
from rasterio.errors import RasterioIOError
from rasterio.transform import from_origin
from shapely.geometry import LineString

import street_gradient as sg

_GEOD = Geod(ellps='WGS84')
# The south-west corner of the synthetic rasters, in Seattle so the USGS naming tests share it.
_LNG, _LAT = -122.30, 47.60
_CELL_DEG = 0.0001
_MD5 = '0123456789abcdef0123456789abcdef'


def _east(meters, lng=_LNG, lat=_LAT):
    """The (lng, lat) `meters` due east of a point."""
    lng2, lat2, _ = _GEOD.fwd(lng, lat, 90, meters)
    return lng2, lat2


def _write_plane(path, rise_per_degree_lng=0.0, base=100.0, size=200, nodata_cols=(), lng=_LNG, lat=_LAT,
                 cell=_CELL_DEG, decimeters=False):
    """
    A `size` x `size` EPSG:4326 GeoTIFF whose elevation at a cell center is `base + rise_per_degree_lng * (center lng -
    west edge)`. Bilinear interpolation of a plane is exact, so a sampled elevation is this formula at the point.
    Columns in `nodata_cols` are no-data. `decimeters` stores the same surface the way GEDTM30 does: int32 tenths of a
    meter with a 0.1 scale.
    """
    centers = (np.arange(size) + 0.5) * cell
    grid = np.tile(base + rise_per_degree_lng * centers, (size, 1))
    grid = np.round(grid * 10) if decimeters else grid
    grid[:, list(nodata_cols)] = -9999
    dtype = 'int32' if decimeters else 'float32'
    with rasterio.open(path, 'w', driver='GTiff', height=size, width=size, count=1, dtype=dtype, nodata=-9999,
                       crs='EPSG:4326', transform=from_origin(lng, lat + size * cell, cell, cell)) as ds:
        ds.write(grid.astype(dtype), 1)
        if decimeters:
            ds.scales = (0.1,)
    return path


def _street(street_id, coords, is_structure=False):
    return {'street_edge_id': street_id, 'geom_md5': _MD5, 'is_structure': is_structure, 'coords': coords}


# --------------------------------------------------------------------------------------------------------------------
# sample_points
# --------------------------------------------------------------------------------------------------------------------


def test_sample_points_keeps_both_endpoints_exact_and_spaces_evenly():
    start, end = (_LNG, _LAT), _east(52)
    lngs, lats, length = sg.sample_points([start, end], 5.0)
    assert length == pytest.approx(52, abs=0.01)
    assert len(lngs) == 11  # round(52 / 5) = 10 intervals of 5.2 m rather than ten of 5 m and a 2 m stub.
    assert (lngs[0], lats[0]) == start
    assert (lngs[-1], lats[-1]) == pytest.approx(end)
    gaps = _GEOD.line_lengths(lngs, lats)
    assert max(gaps) - min(gaps) < 0.01


def test_sample_points_follows_the_vertices_not_the_chord():
    corner = _east(30)
    north = _GEOD.fwd(*corner, 0, 30)[:2]
    lngs, lats, length = sg.sample_points([(_LNG, _LAT), corner, north], 10.0)
    assert length == pytest.approx(60, abs=0.01)
    assert (lngs[3], lats[3]) == pytest.approx(corner)


def test_sample_points_crosses_the_antimeridian_the_short_way():
    lngs, lats, length = sg.sample_points([(179.999, -36.0), (-179.999, -36.0)], 5.0)
    assert length == pytest.approx(180.3, abs=0.1)
    assert (lngs[0], lngs[-1]) == (179.999, -179.999)
    assert (np.abs(lngs) >= 179.999).all()  # Interpolated raw, the midpoint would sit at longitude 0.
    assert max(_GEOD.line_lengths(lngs, lats)) < 5.1


def test_sample_points_of_a_zero_length_line_is_its_point_twice():
    lngs, lats, length = sg.sample_points([(_LNG, _LAT), (_LNG, _LAT)], 5.0)
    assert length == 0
    assert list(lngs) == [_LNG, _LNG] and list(lats) == [_LAT, _LAT]


# --------------------------------------------------------------------------------------------------------------------
# bilinear / fill_gaps / smooth
# --------------------------------------------------------------------------------------------------------------------


def test_bilinear_is_exact_on_a_plane_including_the_last_row_and_column():
    rows_idx, cols_idx = np.mgrid[0:4, 0:5]
    grid = 2.0 * rows_idx + 3.0 * cols_idx
    rows, cols = np.array([0.0, 1.25, 3.0]), np.array([0.0, 2.5, 4.0])
    assert sg.bilinear(grid, rows, cols) == pytest.approx(2.0 * rows + 3.0 * cols)


def test_bilinear_is_nan_off_the_grid_beside_a_nan_cell_and_on_a_grid_too_small_to_interpolate():
    grid = np.arange(9, dtype=float).reshape(3, 3)
    grid[0, 0] = np.nan
    got = sg.bilinear(grid, np.array([0.5, 1.5, -0.1, 1.0]), np.array([0.5, 1.5, 1.0, 2.1]))
    assert np.isnan(got[0]) and got[1] == pytest.approx(6.0) and np.isnan(got[2]) and np.isnan(got[3])
    assert np.isnan(sg.bilinear(np.ones((1, 5)), np.array([0.0]), np.array([1.0]))).all()
    assert np.isnan(sg.bilinear(np.ones((5, 1)), np.array([1.0]), np.array([0.0]))).all()


def test_fill_gaps_bridges_a_run_linearly():
    z = np.array([10.0, np.nan, np.nan, 16.0, 17.0])
    assert list(sg.fill_gaps(z)) == [10.0, 12.0, 14.0, 16.0, 17.0]


def test_smooth_widens_an_even_window_so_the_endpoints_still_hold():
    bumpy = np.array([2.0, 0.0, 3.0, 5.0, 1.0, 0.0, 4.0, 7.0])
    assert list(sg.smooth(bumpy, 4)) == list(sg.smooth(bumpy, 5))
    assert (sg.smooth(bumpy, 4)[0], sg.smooth(bumpy, 4)[-1]) == pytest.approx((2.0, 7.0))


def test_smooth_leaves_a_constant_grade_and_both_endpoints_alone_and_is_a_no_op_when_it_cannot_apply():
    line = 3.0 + 0.5 * np.arange(10)
    assert sg.smooth(line, 5) == pytest.approx(line)  # End to end, not just inside: the padding continues the slope.
    bumpy = np.array([2.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 7.0])
    smoothed = sg.smooth(bumpy, 5)
    assert len(smoothed) == len(bumpy)
    assert smoothed[3] == pytest.approx(1.0) and (smoothed[0], smoothed[-1]) == pytest.approx((2.0, 7.0))
    assert sg.smooth(line, 1) is line
    assert list(sg.smooth(line[:3], 5)) == list(line[:3])


# --------------------------------------------------------------------------------------------------------------------
# window_grades / grade_metrics
# --------------------------------------------------------------------------------------------------------------------


def test_window_grades_slides_a_baseline_and_falls_back_to_end_to_end_on_a_short_street():
    z = np.array([0.0, 0.5, 1.0, 1.0, 1.0])  # 5 m steps: 10% for 10 m, then level.
    assert list(sg.window_grades(z, 20.0, 10.0)) == pytest.approx([0.10, 0.05, 0.0])
    assert list(sg.window_grades(z, 20.0, 30.0)) == pytest.approx([0.05])


def test_grade_metrics_of_a_constant_six_percent_climb():
    length = 100.0
    z = 50.0 + 0.06 * np.linspace(0, length, 21)
    m = sg.grade_metrics(z, length)
    assert m['net_grade'] == pytest.approx(0.06)
    assert m['mean_grade'] == pytest.approx(0.06) and m['max_grade'] == pytest.approx(0.06)
    assert m['meters_over_5pct_grade'] == pytest.approx(length) and m['meters_over_8pct_grade'] == 0
    assert m['climb_m'] == pytest.approx(6.0) and m['descent_m'] == 0
    assert m['profile_cm'][0] == 5000 and m['profile_cm'][-1] == 5600 and len(m['profile_cm']) == 11


def test_grade_metrics_of_a_hill_counts_both_sides_and_signs_net_by_direction():
    length = 105.0  # 21 intervals of 5 m: not a whole number of 10 m steps, so the last knot is the endpoint itself.
    x = np.linspace(0, length, 22)
    z = np.where(x <= 50, 0.10 * x, 5.0 - 0.10 * (x - 50))
    m = sg.grade_metrics(z, length)
    assert m['net_grade'] == pytest.approx(-0.5 / length)
    assert m['climb_m'] == pytest.approx(5.0) and m['descent_m'] == pytest.approx(5.5)
    assert m['max_grade'] == pytest.approx(0.10)
    assert 0 < m['meters_over_8pct_grade'] < length  # The baselines straddling the crest read under 8%.
    assert m['meters_over_8pct_grade'] <= m['meters_over_5pct_grade']


def test_grade_metrics_never_reports_a_maximum_under_the_mean():
    z = np.tile([0.0, 0.3, 0.0, -0.3], 5)[:17]  # A washboard: 3% over every 10 m baseline, ~0 over any 30 m one.
    m = sg.grade_metrics(z, 160.0)
    assert m['mean_grade'] > 0.02
    assert m['max_grade'] == m['mean_grade']


def test_grade_metrics_of_a_street_under_30_m_takes_its_steepest_10_m_pitch_as_the_maximum():
    z = np.array([0.0, 0.0, 0.0, 1.0, 2.0])  # 5 m steps: level for 10 m, then 20% for 10 m. 10% end to end.
    m = sg.grade_metrics(z, 20.0)
    assert m['net_grade'] == pytest.approx(0.10)
    assert m['max_grade'] == pytest.approx(0.20)
    # At 30 m the 30 m baseline takes over, and it is the whole street.
    assert sg.grade_metrics(np.array([0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 2.0]), 30.0)['max_grade'] == pytest.approx(2 / 30)


def test_grade_metrics_of_a_street_shorter_than_every_baseline():
    m = sg.grade_metrics(np.array([10.0, 10.4]), 8.0)
    assert m['mean_grade'] == m['max_grade'] == pytest.approx(0.05)
    assert m['climb_m'] == pytest.approx(0.4)
    assert m['profile_cm'] == [1000, 1040]


# --------------------------------------------------------------------------------------------------------------------
# edge_gradient / confidence_for
# --------------------------------------------------------------------------------------------------------------------


def test_edge_gradient_measures_a_clean_profile_and_bridges_a_short_gap():
    z = 20.0 + 0.04 * np.linspace(0, 100, 21)
    z[5:8] = np.nan
    got = sg.edge_gradient(z, 100.0, False)
    assert got['quality'] == sg.QUALITY_MEASURED
    assert got['mean_grade'] == pytest.approx(0.04)
    assert (got['elev_start_m'], got['elev_end_m']) == pytest.approx((20.0, 24.0))


def test_edge_gradient_has_no_data_for_an_empty_a_zero_length_or_an_unanchored_profile():
    mostly_missing = np.array([1.0, np.nan, np.nan, np.nan, np.nan, 2.0])
    assert sg.edge_gradient(mostly_missing, 25.0, False) == {'quality': sg.QUALITY_NO_DATA}
    assert sg.edge_gradient(np.array([1.0, 1.0]), 0.0, False) == {'quality': sg.QUALITY_NO_DATA}
    # A 1% street missing a fifth of its length at each end: held flat out to the ends it would read 0.6%, measured.
    ramp = 100.0 + 0.01 * np.linspace(0, 100, 11)
    for lost in (slice(0, 2), slice(-2, None), slice(0, 1), slice(-1, None)):
        z = ramp.copy()
        z[lost] = np.nan
        assert sg.edge_gradient(z, 100.0, False) == {'quality': sg.QUALITY_NO_DATA}
    assert sg.edge_gradient(np.array([np.nan, 1.0, 2.0, 3.0]), 15.0, True) == {'quality': sg.QUALITY_NO_DATA}
    assert sg.edge_gradient(np.array([1.0, 2.0, 3.0, np.nan]), 15.0, True) == {'quality': sg.QUALITY_NO_DATA}


def test_edge_gradient_gives_a_structure_its_endpoint_elevations_and_no_grade():
    # A bare-earth model under a bridge: the deck is level at 30 m, the ravine below drops 20 m.
    z = np.array([30.0, 22.0, 10.0, 10.0, 10.0, 12.0, 24.0, 31.0])
    assert sg.edge_gradient(z, 70.0, True) == {'quality': sg.QUALITY_STRUCTURE, 'elev_start_m': 30.0,
                                               'elev_end_m': 31.0}
    # Mostly missing in between is fine for a structure: only its ends are read.
    assert sg.edge_gradient(np.array([30.0] + [np.nan] * 6 + [31.0]), 70.0, True)['quality'] == sg.QUALITY_STRUCTURE
    # One end read at the lip of the cut it crosses: 12 m over 11 m is no grade to report, and no verdict on the ends.
    lip = sg.edge_gradient(np.array([30.0, 24.0, 18.0]), 11.0, True)
    assert lip['quality'] == sg.QUALITY_STRUCTURE and 'net_grade' not in lip
    row = sg.format_row(_street(5, [], True), lip, 'usgs-3dep-10m', 10.0)
    assert (row['elev_start_m'], row['elev_end_m'], row['net_grade'], row['profile_cm']) == ('30.00', '18.00', '', '')


def test_edge_gradient_flags_an_untagged_artifact_but_not_a_uniformly_steep_hill():
    ravine = np.array([30.0, 30.0, 30.0, 22.0, 22.0, 30.0, 30.0, 30.0, 30.0])  # An 8 m hole in a level 40 m street.
    got = sg.edge_gradient(ravine, 40.0, False)
    assert got['quality'] == sg.QUALITY_SUSPECT
    assert got['max_grade'] == 0 and got['profile_cm'] == [3000] * 5
    hill = 0.25 * np.linspace(0, 100, 21)  # 25% end to end: steep, and the pitch agrees with the net grade.
    assert sg.edge_gradient(hill, 100.0, False)['quality'] == sg.QUALITY_MEASURED
    # Over the ratio but under SUSPECT_GRADE: a 12% pitch on a level street is a driveway dip, not an artifact.
    dip = np.array([10.0, 10.0, 8.8, 10.0, 10.0, 10.0, 10.0])
    assert sg.edge_gradient(dip, 60.0, False)['quality'] == sg.QUALITY_MEASURED


def test_edge_gradient_caps_what_any_street_can_be():
    # A 45% pitch on a 30% hill passes the ratio test, but no street has a 45% pitch.
    cliffy = np.concatenate([0.30 * np.arange(0, 45, 5), [13.5 + 2.25, 13.5 + 4.5], 18.0 + 0.30 * np.arange(5, 40, 5)])
    got = sg.edge_gradient(cliffy, 85.0, False)
    assert got['quality'] == sg.QUALITY_SUSPECT and got['max_grade'] < sg.MAX_PLAUSIBLE_GRADE
    # A 10 m stub whose ends are 6 m apart in height: the endpoints themselves are wrong, so nothing is reported.
    assert sg.edge_gradient(np.array([10.0, 13.0, 16.0]), 10.0, False) == {'quality': sg.QUALITY_SUSPECT}


def test_edge_gradient_smooths_a_fine_model_without_moving_its_endpoints():
    z = 0.03 * np.arange(61.0)
    z[30] += 0.4  # A curb-height blip mid-block on a 3% street sampled every meter.
    raw, smoothed = sg.edge_gradient(z, 60.0, False), sg.edge_gradient(z, 60.0, False, smooth_samples=5)
    assert smoothed['mean_grade'] < raw['mean_grade']
    assert smoothed['mean_grade'] == pytest.approx(0.03, abs=0.004)
    assert smoothed['net_grade'] == raw['net_grade'] == pytest.approx(0.03)
    assert (smoothed['elev_start_m'], smoothed['elev_end_m']) == pytest.approx((0.0, 1.8))


def test_confidence_for_maps_grid_size_to_the_three_tiers():
    assert [sg.confidence_for(r) for r in (1, 10, 10.5, 20, 30)] == ['high', 'high', 'medium', 'medium', 'low']


# --------------------------------------------------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------------------------------------------------


def test_usgs_tile_is_named_for_its_north_west_corner():
    assert sg.usgs_13_tile_url(-122.33, 47.62).endswith('/13/TIFF/current/n48w123/USGS_13_n48w123.tif')
    assert sg.usgs_13_tile_url(-74.01, 40.89).endswith('/n41w075/USGS_13_n41w075.tif')
    assert sg.usgs_13_tile_url(-122.33, 47.62).startswith('/vsicurl/https://')
    assert sg.usgs_13_tile_url(4.9, 52.37) is None and sg.usgs_13_tile_url(-70.65, -33.44) is None
    assert sg.usgs_13_locate(np.array([-122.33, 4.9]), np.array([47.62, 52.37])) == [
        sg.usgs_13_tile_url(-122.33, 47.62), None]


def test_directory_locator_finds_the_covering_raster_first_in_name_order(tmp_path):
    a = _write_plane(tmp_path / 'a.tif')
    _write_plane(tmp_path / 'b.TIF', lng=_LNG + 0.01)  # 100 cells east of a's west edge: overlaps a's eastern half.
    (tmp_path / 'notes.txt').write_text('not a raster')
    locate = sg.directory_locator(tmp_path)
    lngs = np.array([_LNG + 0.005, _LNG + 0.015, _LNG + 0.025, _LNG + 0.5])
    got = locate(lngs, np.full(4, _LAT + 0.01))
    assert got == [str(a), str(a), str(tmp_path / 'b.TIF'), None]


def test_directory_locator_projects_once_per_coordinate_system_and_stops_when_every_point_is_placed(tmp_path):
    a = _write_plane(tmp_path / 'a.tif')
    _write_plane(tmp_path / 'b.tif', lng=_LNG + 0.02)
    opened = []

    def opener(path):
        opened.append(path)
        return rasterio.open(path)
    locate = sg.directory_locator(tmp_path, opener)
    calls = []
    real = sg.warp_transform
    try:
        sg.warp_transform = lambda *args: calls.append(args[1]) or real(*args)
        assert locate(np.array([_LNG + 0.001]), np.array([_LAT + 0.01])) == [str(a)]  # Placed by a: b is never tested.
        both = locate(np.array([_LNG + 0.001, _LNG + 0.021]), np.full(2, _LAT + 0.01))
        assert both == [str(a), str(tmp_path / 'b.tif')]
    finally:
        sg.warp_transform = real
    assert len(opened) == 2 and len(calls) == 2  # Two tiles in one system: one projection per batch, not per tile.


def test_directory_locator_refuses_a_directory_with_no_rasters(tmp_path):
    with pytest.raises(SystemExit, match='no .tif files'):
        sg.directory_locator(tmp_path)


def test_raster_sampler_reads_a_plane_exactly_and_marks_nodata_and_uncovered_points(tmp_path):
    rise = 50000.0  # Meters per degree of longitude: ~0.66 m per 10 m cell at this latitude.
    path = _write_plane(tmp_path / 'dem.tif', rise_per_degree_lng=rise, nodata_cols=(150,))
    sampler = sg.RasterSampler(sg.directory_locator(tmp_path))
    lngs = np.array([_LNG + 0.00503, _LNG + 0.01234, _LNG + 0.01505, _LNG + 0.5])
    got = sampler.sample(lngs, np.full(4, _LAT + 0.01))
    assert got[0] == pytest.approx(100.0 + rise * 0.00503, abs=1e-3)
    assert got[1] == pytest.approx(100.0 + rise * 0.01234, abs=1e-3)
    assert np.isnan(got[2]) and np.isnan(got[3])
    assert list(sampler._datasets) == [str(path)]
    sampler.close()
    assert sampler._datasets == {}


def test_raster_sampler_leaves_no_dead_band_where_two_tiles_abut(tmp_path):
    rise = 50000.0
    _write_plane(tmp_path / 'a.tif', rise_per_degree_lng=rise, size=100)
    _write_plane(tmp_path / 'b.tif', rise_per_degree_lng=rise, size=100, lng=_LNG + 0.01, base=100.0 + rise * 0.01)
    sampler = sg.RasterSampler(sg.directory_locator(tmp_path))
    # Every tenth of a cell across the seam at _LNG + 0.01, the seam itself included, then both outer edges and the
    # north-east corner cell, whose window would otherwise be a single row and column.
    lngs = np.concatenate([_LNG + 0.01 + _CELL_DEG * np.arange(-10, 11) / 10,
                           [_LNG + 0.00002, _LNG + 0.01998, _LNG + 0.00999]])
    lats = np.concatenate([np.full(23, _LAT + 0.005), [_LAT + 0.00999]])
    got = sampler.sample(lngs, lats)
    assert not np.isnan(got).any()
    # Inside the half-cell band the edge cell's value stands in, so the plane is matched to within half a cell's rise.
    assert np.abs(got - (100.0 + rise * (lngs - _LNG))).max() <= rise * _CELL_DEG / 2 + 1e-3
    sampler.close()


def test_raster_sampler_applies_a_rasters_scale(tmp_path):
    _write_plane(tmp_path / 'dm.tif', rise_per_degree_lng=50000.0, decimeters=True)
    sampler = sg.RasterSampler(sg.directory_locator(tmp_path))
    got = sampler.sample(np.array([_LNG + 0.01005]), np.array([_LAT + 0.01]))
    assert got[0] == pytest.approx(100.0 + 50000.0 * 0.01005, abs=0.06)  # Meters, not the stored decimeters.
    sampler.close()


def test_raster_sampler_survives_a_missing_raster_and_asks_for_it_once(tmp_path):
    path = str(_write_plane(tmp_path / 'dem.tif'))
    opened = []

    def opener(p):
        opened.append(p)
        if p == 'missing.tif':
            raise RasterioIOError('HTTP 404')
        return rasterio.open(p)

    # The second point is located to a real raster it is not actually on, as a tile-naming locator can do at an edge.
    sampler = sg.RasterSampler(lambda lngs, lats: ['missing.tif', path, 'missing.tif'], opener)
    lngs, lats = np.array([_LNG + 0.001, _LNG - 1.0, _LNG + 0.002]), np.full(3, _LAT + 0.01)
    assert np.isnan(sampler.sample(lngs, lats)).all()
    assert np.isnan(sampler.sample(lngs, lats)).all()
    assert sorted(opened) == sorted(['missing.tif', path])
    sampler.close()


# --------------------------------------------------------------------------------------------------------------------
# Config and CSV layer
# --------------------------------------------------------------------------------------------------------------------

_CONF = '''
city-params {
  state-id {
    seattle-wa = "washington"
    bayonne-fr = null
  }
  country-id {
    seattle-wa = "usa"
    cdmx = "mexico"
    validation-study = ${city-params.country-id.seattle-wa}
    nowhere = null
  }
  status {
    seattle-wa = "live"
  }
}
'''


def test_country_id_reads_direct_aliased_null_and_missing_entries():
    assert sg.country_id('seattle-wa', _CONF) == 'usa'
    assert sg.country_id('cdmx', _CONF) == 'mexico'
    assert sg.country_id('validation-study', _CONF) == 'usa'
    assert sg.country_id('nowhere', _CONF) is None
    assert sg.country_id('bayonne-fr', _CONF) is None  # Only in state-id: another block's entries do not leak in.
    assert sg.country_id('seattle-wa', 'city-params { }') is None


def test_country_id_resolves_every_city_in_the_real_cityparams():
    conf = sg.CITYPARAMS.read_text()
    assert sg.country_id('seattle-wa', conf) == 'usa'
    assert sg.country_id('zurich-infra3d', conf) == 'switzerland'
    assert sg.country_id('crowdstudy', conf) == 'usa'


def test_positive_float_refuses_zero_negatives_and_nan():
    assert sg.positive_float('0.5') == 0.5
    for bad in ('0', '-5', 'nan'):
        with pytest.raises(argparse.ArgumentTypeError, match='greater than 0'):
            sg.positive_float(bad)


def test_valid_city_id_accepts_kebab_case_only():
    assert sg.valid_city_id('newport-ky') == 'newport-ky'
    for bad in ('Seattle', '../etc', 'a--b', ''):
        with pytest.raises(argparse.ArgumentTypeError):
            sg.valid_city_id(bad)


def _write_input(path, streets, md5=_MD5):
    """The export's shape: psql booleans as t/f, the geometry as hex EWKB (SRID 4326, as ST_AsHEXEWKB writes it)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['street_edge_id', 'geom_md5', 'is_structure', 'geom'])
        for street_id, coords, is_structure in streets:
            geom = shapely.to_wkb(shapely.set_srid(LineString(coords), 4326), hex=True, include_srid=True)
            writer.writerow([street_id, md5, 't' if is_structure else 'f', geom])


def test_read_streets_parses_the_export(tmp_path):
    path = tmp_path / 'in.csv'
    _write_input(path, [(7, [(_LNG, _LAT), _east(40)], False), (8, [(_LNG, _LAT), _east(10)], True)])
    streets = sg.read_streets(path)
    assert [s['street_edge_id'] for s in streets] == [7, 8]
    assert [s['is_structure'] for s in streets] == [False, True]
    assert streets[0]['coords'][0] == (_LNG, _LAT) and streets[0]['geom_md5'] == _MD5


def test_read_streets_parses_what_postgis_itself_exports(tmp_path):
    # Seattle street 1, verbatim from the export's query: ST_AsHEXEWKB carries the SRID flag plain WKB does not.
    path = tmp_path / 'in.csv'
    path.write_text('street_edge_id,geom_md5,is_structure,geom\n1,9b25a2a1f1577c1e05facdbb4f06b7cb,f,0102000020E6100000'
                    '02000000D1F4C8D57E935EC046802E75EBD24740423AE1CA7E935EC0903E9C76E7D24740\n')
    assert sg.read_streets(path)[0]['coords'] == [(-122.3046164, 47.6478106), (-122.3046138, 47.6476887)]


def _output_line(street_id, md5=_MD5):
    return f'{street_id},measured,high,0,0,0,0,0,0,0,0,0,"{{0,0}}",earlier,10.0,{md5}\n'


_HEADER = ','.join(sg.OUTPUT_FIELDS) + '\n'
_WANTED = [_street(3, []), _street(9, [])]


def test_done_ids_is_empty_without_a_file_and_reads_one_back_untouched(tmp_path):
    path = tmp_path / 'out.csv'
    assert sg.done_ids(path, _WANTED) == set()
    path.write_text(_HEADER + _output_line(3) + _output_line(9))
    before = path.stat().st_mtime_ns
    assert sg.done_ids(path, _WANTED) == {3, 9}
    assert path.stat().st_mtime_ns == before


def test_done_ids_cuts_off_the_partial_line_a_killed_run_left(tmp_path):
    path = tmp_path / 'out.csv'
    path.write_text(_HEADER + _output_line(3) + '123')  # Killed while writing street 12345.
    assert sg.done_ids(path, _WANTED) == {3}
    assert path.read_text() == _HEADER + _output_line(3)


def test_done_ids_drops_a_row_whose_street_changed_or_left_the_export(tmp_path):
    path = tmp_path / 'out.csv'
    stale = 'f' * 32  # Street 9 was re-imported with a new geometry since this row was written.
    path.write_text(_HEADER + _output_line(3) + _output_line(9, stale) + _output_line(40))
    assert sg.done_ids(path, _WANTED) == {3}
    assert path.read_text() == _HEADER + _output_line(3)


def test_done_ids_starts_over_from_a_file_with_other_columns(tmp_path):
    path = tmp_path / 'out.csv'
    path.write_text('street_edge_id,quality,geom_md5\n3,measured,' + _MD5 + '\n')
    assert sg.done_ids(path, _WANTED) == set()
    assert path.read_text() == _HEADER


def test_format_row_leaves_a_no_data_street_blank_and_formats_a_measured_one():
    street = _street(4, [(_LNG, _LAT), _east(40)])
    blank = sg.format_row(street, {'quality': sg.QUALITY_NO_DATA}, 'moi-dtm-20m', 20.0)
    assert blank['confidence'] == 'medium' and blank['net_grade'] == '' and blank['profile_cm'] == ''
    assert set(blank) == set(sg.OUTPUT_FIELDS)
    result = sg.edge_gradient(10.0 + 0.0612345 * np.linspace(0, 40, 9), 40.0, False)
    row = sg.format_row(street, result, 'usgs-3dep-10m', 10.0)
    assert row['net_grade'] == '0.06123' and row['climb_m'] == '2.45' and row['elev_start_m'] == '10.00'
    assert row['profile_cm'] == '{1000,1061,1122,1184,1245}'
    assert row['geom_md5'] == _MD5 and row['dem_source'] == 'usgs-3dep-10m'


def test_cells_groups_by_first_vertex_in_row_major_order():
    south_west = _street(1, [(-122.34, 47.51), (-122.30, 47.59)])  # Ends in another cell: grouped by its start.
    south_east = _street(2, [(-122.26, 47.52), (-122.26, 47.53)])
    north_west = _street(3, [(-122.33, 47.57), (-122.33, 47.58)])
    also_south_west = _street(4, [(-122.31, 47.54), (-122.31, 47.545)])
    got = sg.cells([north_west, south_east, south_west, also_south_west], 0.05)
    assert [[s['street_edge_id'] for s in cell] for cell in got] == [[1, 4], [2], [3]]


def test_process_cell_samples_a_fine_model_every_meter_and_a_coarse_one_every_five(tmp_path):
    _write_plane(tmp_path / 'dem.tif', rise_per_degree_lng=4000.0)
    calls = []

    class Recording(sg.RasterSampler):
        def sample(self, lngs, lats):
            calls.append(len(lngs))
            return super().sample(lngs, lats)

    streets = [_street(1, [(_LNG + 0.002, _LAT + 0.01), _east(50, _LNG + 0.002, _LAT + 0.01)]),
               _street(2, [(_LNG + 0.004, _LAT + 0.012), _east(20, _LNG + 0.004, _LAT + 0.012)], True)]
    locate = sg.directory_locator(tmp_path)
    coarse = sg.process_cell(streets, Recording(locate), sg.Source('coarse', 10.0, locate))
    fine = sg.process_cell(streets, Recording(locate), sg.Source('fine', 1.0, locate))
    assert calls == [11 + 5, 51 + 21]
    assert [row['street_edge_id'] for row in coarse] == [1, 2]
    assert [row['quality'] for row in coarse] == [sg.QUALITY_MEASURED, sg.QUALITY_STRUCTURE]
    # Both see the same plane, so the grade is the plane's whatever the sampling: 4000 m per degree of longitude.
    meters_per_degree = _GEOD.line_length([_LNG, _LNG + 1], [_LAT + 0.01, _LAT + 0.01])
    for rows in (coarse, fine):
        assert float(rows[0]['net_grade']) == pytest.approx(4000.0 / meters_per_degree, abs=2e-4)
    assert fine[0]['confidence'] == 'high' and fine[0]['dem_source'] == 'fine'


# --------------------------------------------------------------------------------------------------------------------
# resolve_source / main
# --------------------------------------------------------------------------------------------------------------------


def _args(**overrides):
    base = {'city_id': 'seattle-wa', 'source': None, 'dem_dir': None, 'dem_name': None, 'dem_resolution_m': None}
    return argparse.Namespace(**{**base, **overrides})


def test_resolve_source_uses_the_countrys_registered_source_or_an_explicit_one():
    assert sg.resolve_source(_args(), _CONF) is sg.USGS_3DEP_10M
    assert sg.resolve_source(_args(city_id='cdmx', source='usgs-3dep-10m'), _CONF) is sg.USGS_3DEP_10M


def test_resolve_source_explains_what_to_do_for_an_unregistered_country():
    with pytest.raises(SystemExit, match='country-id "mexico".*--dem-dir'):
        sg.resolve_source(_args(city_id='cdmx'), _CONF)


def test_resolve_source_builds_a_directory_source_from_absolute_and_repo_relative_paths(tmp_path, monkeypatch):
    (tmp_path / 'dem').mkdir()
    _write_plane(tmp_path / 'dem' / 'a.tif')
    absolute = sg.resolve_source(_args(dem_dir=tmp_path / 'dem', dem_name='inegi-mdt-5m', dem_resolution_m=5.0), _CONF)
    assert (absolute.name, absolute.resolution_m) == ('inegi-mdt-5m', 5.0)
    monkeypatch.setattr(sg, 'REPO_ROOT', tmp_path)
    relative = sg.resolve_source(_args(dem_dir=Path('dem'), dem_name='inegi-mdt-5m', dem_resolution_m=5.0), _CONF)
    assert relative.locate(np.array([_LNG + 0.001]), np.array([_LAT + 0.001])) == [str(tmp_path / 'dem' / 'a.tif')]
    with pytest.raises(SystemExit, match='also needs --dem-name'):
        sg.resolve_source(_args(dem_dir=tmp_path / 'dem', dem_name='inegi-mdt-5m'), _CONF)


@pytest.fixture
def city(tmp_path, monkeypatch):
    """A throwaway repo root holding a cityparams file, a sloped raster, and a two-street export for `testville`."""
    monkeypatch.setattr(sg, 'REPO_ROOT', tmp_path)
    conf = tmp_path / 'cityparams.conf'
    conf.write_text(_CONF)
    monkeypatch.setattr(sg, 'CITYPARAMS', conf)
    (tmp_path / 'dem').mkdir()
    _write_plane(tmp_path / 'dem' / 'plane.tif', rise_per_degree_lng=4000.0)
    city_dir = tmp_path / 'db' / 'onboarding' / 'testville'
    on_raster = (_LNG + 0.002, _LAT + 0.01)
    _write_input(city_dir / sg.INPUT_NAME, [(1, [on_raster, _east(60, *on_raster)], False),
                                            (2, [(_LNG + 0.5, _LAT), _east(60, _LNG + 0.5, _LAT)], False)])
    return city_dir


_DEM_ARGS = ['--city-id', 'testville', '--dem-dir', 'dem', '--dem-name', 'test-plane', '--dem-resolution-m', '10']


def _read_output(city_dir):
    with (city_dir / sg.OUTPUT_NAME).open(newline='') as f:
        return list(csv.DictReader(f))


def test_main_samples_every_street_and_writes_the_csv(city, caplog):
    caplog.set_level('INFO')
    assert sg.main(_DEM_ARGS) == 0
    rows = {int(row['street_edge_id']): row for row in _read_output(city)}
    assert rows[1]['quality'] == sg.QUALITY_MEASURED and float(rows[1]['net_grade']) > 0.04
    assert rows[2]['quality'] == sg.QUALITY_NO_DATA and rows[2]['net_grade'] == ''
    assert rows[1]['dem_source'] == 'test-plane' and rows[1]['confidence'] == 'high'
    assert '1 measured, 1 no_data' in caplog.text


def test_main_resume_keeps_finished_rows_and_a_plain_rerun_starts_over(city, caplog):
    caplog.set_level('INFO')
    header = ','.join(sg.OUTPUT_FIELDS)
    (city / sg.OUTPUT_NAME).write_text(f'{header}\n1,measured,high,9,9,9,0,0,0,0,0,0,"{{0,0}}",earlier,10.0,{_MD5}\n')
    assert sg.main([*_DEM_ARGS, '--resume']) == 0
    rows = _read_output(city)
    assert [(row['street_edge_id'], row['dem_source']) for row in rows] == [('1', 'earlier'), ('2', 'test-plane')]

    caplog.clear()
    assert sg.main([*_DEM_ARGS, '--resume']) == 0  # Everything is done: nothing sampled, nothing rewritten.
    assert 'nothing new' in caplog.text and len(_read_output(city)) == 2

    assert sg.main(_DEM_ARGS) == 0
    assert [row['dem_source'] for row in _read_output(city)] == ['test-plane', 'test-plane']


def test_main_resume_with_no_earlier_output_writes_a_header(city):
    assert sg.main([*_DEM_ARGS, '--resume']) == 0
    assert len(_read_output(city)) == 2


def test_main_refuses_both_a_registered_source_and_a_directory(city, capsys):
    with pytest.raises(SystemExit):
        sg.main([*_DEM_ARGS, '--source', 'usgs-3dep-10m'])
    assert 'not allowed with argument' in capsys.readouterr().err


def test_main_closes_its_rasters_when_sampling_fails(city, monkeypatch):
    closed = []
    monkeypatch.setattr(sg.RasterSampler, 'close', lambda self: closed.append(True))
    monkeypatch.setattr(sg, 'process_cell', lambda *args: 1 / 0)
    with pytest.raises(ZeroDivisionError):
        sg.main(_DEM_ARGS)
    assert closed == [True]


def test_main_points_at_the_export_when_there_is_no_input(city):
    (city / sg.INPUT_NAME).unlink()
    with pytest.raises(SystemExit, match='make export-street-gradient-input'):
        sg.main(_DEM_ARGS)
