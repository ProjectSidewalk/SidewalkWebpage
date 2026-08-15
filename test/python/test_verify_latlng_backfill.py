"""
Unit tests for tools/verify_latlng_backfill.py, the #4818 backfill rollout-gate verifier.

Covers the estimator transcription (pinned research fixtures, blend continuity, monotonicity, horizon flatness),
the destination math (identity, direction, the deliberate no-antimeridian-wrap app parity), the row verifier
(parity pass/fail, stamp and NULL checks, the failure cap, displacement stats), the fixture self-test's own
failure detection, and `main` end-to-end via argv/CSV. The verifier is deliberately an independent transcription
of PanoDataService/CommonUtils, so these tests pin it to the published research values the Scala spec pins
(test/service/PanoDataServiceSpec.scala) rather than to the implementation under test.
"""

import csv
import math

import pytest

import verify_latlng_backfill as vb


def _row(pano_lat=47.6553, pano_lng=-122.3035, camera_heading=90.0, width=13312, height=6656,
         x=6656, y=4160, label_point_id="1", **overrides):
    """A synthetic export row whose stored values are the verifier's own recompute (parity delta exactly 0)."""
    lat, lng = vb.to_lat_lng(pano_lat, pano_lng, x, y, width, height, camera_heading)
    row = {
        "label_point_id": label_point_id, "pano_lat": str(pano_lat), "pano_lng": str(pano_lng),
        "camera_heading": str(camera_heading), "pano_width": str(width), "pano_height": str(height),
        "pano_x": str(x), "pano_y": str(y), "new_lat": repr(lat), "new_lng": repr(lng),
        "computation_method": "approximation3", "old_lat": str(pano_lat), "old_lng": str(pano_lng),
    }
    row.update(overrides)
    return row


# --------------------------------------------------------------------------------------------------------------------
# estimate_distance_from_pano_m
# --------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("depression, expected", [
    (45.0, 2.341219672825709), (15.0, 8.737550770665331), (30.0, 4.055111425013912), (60.0, 1.351703808337971),
    (11.25, 11.770106120938644), (5.0, 18.480192309211834), (2.0, 21.701033679582963),
    (0.0, 23.848261259830384), (-10.0, 23.848261259830384),
])
def test_distance_matches_pinned_research_values(depression, expected):
    assert vb.estimate_distance_from_pano_m(depression) == pytest.approx(expected, abs=1e-9)


def test_distance_blend_handoff_is_continuous():
    at_blend = vb.estimate_distance_from_pano_m(vb.BLEND_DEG)
    just_below = vb.estimate_distance_from_pano_m(vb.BLEND_DEG - 1e-9)
    assert just_below == pytest.approx(at_blend, abs=1e-6)


def test_distance_decreases_monotonically_with_depression():
    distances = [vb.estimate_distance_from_pano_m(d) for d in range(-5, 86)]
    assert all(steeper <= near_horizon for near_horizon, steeper in zip(distances, distances[1:]))


def test_distance_is_flat_above_the_horizon():
    assert vb.estimate_distance_from_pano_m(-90.0) == vb.estimate_distance_from_pano_m(0.0)


# --------------------------------------------------------------------------------------------------------------------
# calculate_destination / haversine_meters
# --------------------------------------------------------------------------------------------------------------------

def test_destination_zero_distance_is_identity():
    # Not bit-exact: the degrees -> radians -> degrees round trip may differ by a ulp.
    assert vb.calculate_destination(47.6553, -122.3035, 0.0, 123.4) == pytest.approx((47.6553, -122.3035), abs=1e-12)


def test_destination_due_north_moves_only_latitude():
    lat, lng = vb.calculate_destination(10.0, 20.0, 1.0, 0.0)
    assert lat > 10.0
    assert lng == pytest.approx(20.0, abs=1e-12)


def test_destination_does_not_wrap_at_the_antimeridian():
    # App parity, pinned deliberately: CommonUtils.calculateDestination leaves longitude unwrapped, and the SQL port
    # matches it -- label_point's lat/lng CHECK constraint is the guard that makes an out-of-range value loud.
    lat, lng = vb.calculate_destination(0.0, 179.9999, 20.0, 90.0)
    assert lng > 180.0


def test_haversine_zero_for_identical_points():
    assert vb.haversine_meters(47.0, -122.0, 47.0, -122.0) == 0.0


def test_haversine_round_trips_destination_distance():
    lat, lng = vb.calculate_destination(47.6553, -122.3035, 0.0238, 33.0)
    assert vb.haversine_meters(47.6553, -122.3035, lat, lng) == pytest.approx(23.8, abs=1e-6)


# --------------------------------------------------------------------------------------------------------------------
# to_lat_lng
# --------------------------------------------------------------------------------------------------------------------

def test_center_column_lands_along_the_camera_heading():
    expected = vb.calculate_destination(47.6553, -122.3035, vb.estimate_distance_from_pano_m(22.5) / 1000.0, 90.0)
    got = vb.to_lat_lng(47.6553, -122.3035, 6656, 4160, 13312, 6656, 90.0)
    assert got == pytest.approx(expected, abs=1e-9)


def test_quarter_width_bears_ninety_degrees_counter_clockwise():
    expected = vb.calculate_destination(47.6553, -122.3035, vb.estimate_distance_from_pano_m(22.5) / 1000.0, 147.5)
    got = vb.to_lat_lng(47.6553, -122.3035, 3328, 4160, 13312, 6656, 237.5)
    assert got == pytest.approx(expected, abs=1e-9)


def test_negative_bearing_equals_its_in_range_equivalent():
    # An eighth across at heading 10 gives 10 - 180 + 45 = -125 degrees, whose in-range equivalent is 235.
    expected = vb.calculate_destination(47.6553, -122.3035, vb.estimate_distance_from_pano_m(22.5) / 1000.0, 235.0)
    got = vb.to_lat_lng(47.6553, -122.3035, 1664, 4160, 13312, 6656, 10.0)
    assert got == pytest.approx(expected, abs=1e-9)


def test_to_lat_lng_is_independent_of_panorama_resolution():
    low = vb.to_lat_lng(47.6553, -122.3035, 1440, 1800, 5760, 2880, 237.5)
    high = vb.to_lat_lng(47.6553, -122.3035, 3328, 4160, 13312, 6656, 237.5)
    assert low == pytest.approx(high, abs=1e-9)


# --------------------------------------------------------------------------------------------------------------------
# quantile
# --------------------------------------------------------------------------------------------------------------------

def test_quantile_of_empty_list_is_nan():
    assert math.isnan(vb.quantile([], 0.5))


def test_quantile_single_element():
    assert vb.quantile([7.0], 0.5) == 7.0
    assert vb.quantile([7.0], 0.99) == 7.0


def test_quantile_nearest_rank_on_known_list():
    values = list(range(1, 101))
    assert vb.quantile(values, 0.50) == 50
    assert vb.quantile(values, 0.90) == 90
    assert vb.quantile(values, 0.99) == 99


# --------------------------------------------------------------------------------------------------------------------
# self_test
# --------------------------------------------------------------------------------------------------------------------

def test_self_test_passes_with_shipped_constants():
    assert vb.self_test() == []


def test_self_test_detects_a_wrong_camera_height(monkeypatch):
    # The self-test guards the transcription, so it must actually fail when a constant drifts from the research.
    monkeypatch.setattr(vb, "CAMERA_HEIGHT_M", 2.6)
    assert vb.self_test() != []


# --------------------------------------------------------------------------------------------------------------------
# verify_rows
# --------------------------------------------------------------------------------------------------------------------

def test_verify_rows_passes_on_faithful_rows():
    stats, failures = vb.verify_rows([_row(label_point_id=str(i)) for i in range(1, 4)], eps=1e-9)
    assert failures == []
    assert stats["rows"] == 3
    assert stats["max_delta_deg"] == 0.0
    # old position is the pano itself, so displacement equals the estimated distance at 22.5 degrees depression.
    assert stats["displacement_p50_m"] == pytest.approx(vb.estimate_distance_from_pano_m(22.5), abs=1e-6)


def test_verify_rows_flags_a_wrong_stamp():
    stats, failures = vb.verify_rows([_row(computation_method="approximation2")], eps=1e-9)
    assert len(failures) == 1
    assert "stamped" in failures[0]


def test_verify_rows_flags_null_lat_lng():
    stats, failures = vb.verify_rows([_row(new_lat="", new_lng="")], eps=1e-9)
    assert len(failures) == 1
    assert "NULL" in failures[0]


def test_verify_rows_flags_a_value_beyond_eps():
    good = _row()
    bad = dict(good, new_lat=repr(float(good["new_lat"]) + 1e-6))
    stats, failures = vb.verify_rows([bad], eps=1e-9)
    assert len(failures) == 1
    assert "delta" in failures[0]
    assert stats["max_delta_deg"] == pytest.approx(1e-6, rel=1e-3)


def test_verify_rows_caps_reported_failures_at_twenty():
    rows = [_row(label_point_id=str(i), computation_method="depth") for i in range(25)]
    stats, failures = vb.verify_rows(rows, eps=1e-9)
    assert len(failures) == 20
    assert stats["rows"] == 25


def test_verify_rows_skips_displacement_when_old_position_is_missing():
    stats, failures = vb.verify_rows([_row(old_lat="", old_lng="")], eps=1e-9)
    assert failures == []
    assert math.isnan(stats["displacement_p50_m"])


# --------------------------------------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------------------------------------

def _write_csv(path, rows):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def test_main_self_test_only_exits_zero(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["verify_latlng_backfill.py", "--self-test-only"])
    assert vb.main() == 0
    assert "self-test: OK" in capsys.readouterr().out


def test_main_passes_on_a_faithful_export(tmp_path, monkeypatch, capsys):
    path = tmp_path / "rows.csv"
    _write_csv(path, [_row(label_point_id=str(i)) for i in range(1, 6)])
    monkeypatch.setattr("sys.argv", ["verify_latlng_backfill.py", str(path)])
    assert vb.main() == 0
    out = capsys.readouterr().out
    assert "rows verified:      5" in out
    assert "PASSED" in out


def test_main_fails_on_a_corrupted_export(tmp_path, monkeypatch, capsys):
    good = _row()
    path = tmp_path / "rows.csv"
    _write_csv(path, [dict(good, new_lng=repr(float(good["new_lng"]) + 0.001))])
    monkeypatch.setattr("sys.argv", ["verify_latlng_backfill.py", str(path)])
    assert vb.main() == 1
    assert "FAILED" in capsys.readouterr().out


def test_main_fails_on_an_empty_export(tmp_path, monkeypatch, capsys):
    path = tmp_path / "rows.csv"
    _write_csv(path, [_row()])
    # Header only: rewrite with zero data rows.
    with open(path, "w", newline="") as f:
        csv.DictWriter(f, fieldnames=list(_row().keys())).writeheader()
    monkeypatch.setattr("sys.argv", ["verify_latlng_backfill.py", str(path)])
    assert vb.main() == 1
    assert "no rows" in capsys.readouterr().out


def test_main_reads_stdin_when_no_path_is_given(tmp_path, monkeypatch, capsys):
    path = tmp_path / "rows.csv"
    _write_csv(path, [_row()])
    monkeypatch.setattr("sys.argv", ["verify_latlng_backfill.py"])
    with open(path) as f:
        monkeypatch.setattr("sys.stdin", f)
        assert vb.main() == 0
    assert "PASSED" in capsys.readouterr().out
