"""
Unit tests for scripts/check_streets_for_imagery.py.

Covers the pure helpers (bounding box, vertex interpolation, response parsers, decision thresholds, CSV writer) and the
`main` scan end-to-end with the HTTP layer mocked (happy path, no-imagery flagging, resume, and every error path). See
test/python/README.md.
"""

import pandas as pd
import pytest
import requests
from shapely import wkb
from shapely.geometry import LineString

import check_streets_for_imagery as cs


# --------------------------------------------------------------------------------------------------------------------
# create_bounding_box / redistribute_vertices
# --------------------------------------------------------------------------------------------------------------------

def test_create_bounding_box_is_ordered_and_radius_scales():
    west, south, east, north = cs.create_bounding_box(47.6, -122.3, 0.025)
    assert west < east
    assert south < north

    # radius_km is in kilometers, so a 25 km box is ~1000x wider than a 25 m (0.025 km) box. This makes the deferred
    # endpoint-radius unit bug (issue #4342) self-evident: the first Mapillary endpoint passes 25 instead of 0.025.
    small_width = east - west
    large = cs.create_bounding_box(47.6, -122.3, 25)
    assert (large[2] - large[0]) > small_width * 100


def test_redistribute_vertices_short_line_keeps_endpoints():
    short = LineString([(0, 0), (0, cs.DISTANCE / 2)])
    assert len(cs.redistribute_vertices(short).coords) >= 2


def test_redistribute_vertices_long_line_adds_points_every_distance():
    long_line = LineString([(0, 0), (0, cs.DISTANCE * 10)])
    # length / DISTANCE = 10 segments -> 11 vertices.
    assert len(cs.redistribute_vertices(long_line).coords) == 11


# --------------------------------------------------------------------------------------------------------------------
# response parsers
# --------------------------------------------------------------------------------------------------------------------

def test_gsv_has_imagery():
    assert cs.gsv_has_imagery({'status': 'OK', 'location': {'lat': 47.6, 'lng': -122.3}}) is True
    assert cs.gsv_has_imagery({'status': 'ZERO_RESULTS'}) is False


def test_mapillary_has_imagery_data_presence():
    assert cs.mapillary_has_imagery({'data': [{'id': 1}]}) is True
    assert cs.mapillary_has_imagery({'data': []}) is False


def test_mapillary_has_imagery_error_code_100_means_plenty():
    # "Too many images, request a smaller area" -> there is clearly imagery present.
    assert cs.mapillary_has_imagery({'error': {'code': 100, 'message': 'too many'}}) is True


def test_mapillary_has_imagery_other_error_raises():
    with pytest.raises(cs.ImageryApiError):
        cs.mapillary_has_imagery({'error': {'code': 400, 'message': 'bad request'}})


# --------------------------------------------------------------------------------------------------------------------
# imagery_verdict / street_has_no_imagery
# --------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize('n_fail, n_success, n_coords, endpoint_failed, expected', [
    (5, 0, 10, False, cs.NO_IMAGERY),               # >= 50% of points missing imagery.
    (3, 0, 10, True, cs.NO_IMAGERY),                # >= 25% missing AND an endpoint already missing.
    (3, 0, 10, False, None),                        # 30% missing but no endpoint failure -> undecided.
    (0, 8, 10, True, cs.HAS_IMAGERY),               # > 75% have imagery.
    (0, 6, 10, False, cs.HAS_IMAGERY),              # > 50% have imagery AND both endpoints had imagery.
    (0, 6, 10, True, None),                         # > 50% have imagery but an endpoint failed -> undecided.
])
def test_imagery_verdict(n_fail, n_success, n_coords, endpoint_failed, expected):
    assert cs.imagery_verdict(n_fail, n_success, n_coords, endpoint_failed) == expected


def test_street_has_no_imagery_both_endpoints_missing():
    assert cs.street_has_no_imagery(True, True, [True, True, True]) is True


def test_street_has_no_imagery_all_points_have_imagery():
    assert cs.street_has_no_imagery(False, False, [True] * 10) is False


def test_street_has_no_imagery_all_points_missing():
    assert cs.street_has_no_imagery(False, False, [False] * 10) is True


def test_street_has_no_imagery_quarter_missing_with_failed_endpoint():
    assert cs.street_has_no_imagery(True, False, [False, False, False] + [True] * 7) is True


def test_street_has_no_imagery_never_settles_returns_false():
    # No points to check and not both endpoints failing -> never settles -> defaults to "has imagery".
    assert cs.street_has_no_imagery(False, False, []) is False


# --------------------------------------------------------------------------------------------------------------------
# write_output
# --------------------------------------------------------------------------------------------------------------------

def test_write_output_coerces_ids_to_int(tmp_path):
    out = tmp_path / 'no_imagery.csv'
    df = pd.DataFrame({'street_edge_id': [1.0, 2.0], 'region_id': [10.0, 20.0]})

    cs.write_output(df, None, output_file=str(out))

    written = pd.read_csv(out)
    assert written['street_edge_id'].tolist() == [1, 2]
    assert written['region_id'].tolist() == [10, 20]
    assert written['street_edge_id'].dtype.kind == 'i'


def test_write_output_appends_progress_marker(tmp_path):
    out = tmp_path / 'no_imagery.csv'
    df = pd.DataFrame({'street_edge_id': [1.0], 'region_id': [10.0]})
    street = pd.Series({'street_edge_id': 3, 'region_id': 30})

    cs.write_output(df, street, output_file=str(out))

    assert pd.read_csv(out)['street_edge_id'].tolist() == [1, 3]


# --------------------------------------------------------------------------------------------------------------------
# small I/O helpers
# --------------------------------------------------------------------------------------------------------------------

def test_get_json(monkeypatch):
    class _Resp:
        def json(self):
            return {'ok': True}

    monkeypatch.setattr(cs.requests, 'get', lambda url, timeout: _Resp())
    assert cs._get_json('http://x') == {'ok': True}


def test_mapillary_bbox_url_appends_four_coords():
    url = cs._mapillary_bbox_url('http://m?access_token=k', 47.6, -122.3, 0.025)
    assert url.startswith('http://m?access_token=k&bbox=')
    assert len(url.split('&bbox=')[1].split(',')) == 4


def test_point_has_imagery_gsv(monkeypatch):
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'OK'})
    assert cs._point_has_imagery('GSV', 47.6, -122.3, 'gsv', 'map', 0.015) is True


def test_point_has_imagery_mapillary(monkeypatch):
    monkeypatch.setattr(cs, '_get_json', lambda url: {'data': []})
    assert cs._point_has_imagery('Mapillary', 47.6, -122.3, 'gsv', 'map', 0.015) is False


# --------------------------------------------------------------------------------------------------------------------
# main (HTTP mocked)
# --------------------------------------------------------------------------------------------------------------------

def _write_street_csv(directory, streets):
    """Write a street_edge_endpoints.csv (street_edge_id, region_id, x1, y1, x2, y2, geom-as-WKB-hex) for `streets`."""
    rows = []
    for street_edge_id, region_id, line in streets:
        x1, y1 = line.coords[0]
        x2, y2 = line.coords[-1]
        rows.append({'street_edge_id': street_edge_id, 'region_id': region_id,
                     'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'geom': wkb.dumps(line, hex=True)})
    pd.DataFrame(rows).to_csv(directory / 'street_edge_endpoints.csv', index=False)


def _setup_gsv_run(monkeypatch, tmp_path, streets):
    """Place the input CSV + db/ dir, chdir into tmp, and set the GSV key. Caller patches cs._get_json."""
    _write_street_csv(tmp_path, streets)
    (tmp_path / 'db').mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('GOOGLE_MAPS_API_KEY', 'dummy')


_LINE_100 = LineString([(-122.300, 47.600), (-122.299, 47.600)])
_LINE_200 = LineString([(-122.310, 47.610), (-122.309, 47.610)])


def test_main_requires_a_provider_flag():
    with pytest.raises(SystemExit):
        cs.main([])


def test_main_rejects_both_flags():
    with pytest.raises(SystemExit):
        cs.main(['--gsv', '--mapillary'])


def test_main_missing_api_key_returns_1(monkeypatch):
    monkeypatch.delenv('GOOGLE_MAPS_API_KEY', raising=False)
    assert cs.main(['--gsv']) == 1


def test_main_flags_street_with_no_endpoint_imagery(monkeypatch, tmp_path):
    _setup_gsv_run(monkeypatch, tmp_path, [(100, 1, _LINE_100)])
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'ZERO_RESULTS'})  # nothing has imagery

    assert cs.main(['--gsv']) == 0
    assert pd.read_csv(tmp_path / 'db' / 'streets_with_no_imagery.csv')['street_edge_id'].tolist() == [100]


def test_main_does_not_flag_street_with_imagery(monkeypatch, tmp_path):
    _setup_gsv_run(monkeypatch, tmp_path, [(100, 1, _LINE_100)])
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'OK'})  # imagery everywhere

    assert cs.main(['--gsv']) == 0
    assert pd.read_csv(tmp_path / 'db' / 'streets_with_no_imagery.csv').empty


def test_main_flags_street_when_along_street_points_lack_imagery(monkeypatch, tmp_path):
    _setup_gsv_run(monkeypatch, tmp_path, [(100, 1, _LINE_100)])
    # Endpoints (radius=25) have imagery, but the points along the street (radius=15) do not.
    monkeypatch.setattr(cs, '_get_json',
                        lambda url: {'status': 'OK'} if 'radius=25' in url else {'status': 'ZERO_RESULTS'})

    assert cs.main(['--gsv']) == 0
    assert pd.read_csv(tmp_path / 'db' / 'streets_with_no_imagery.csv')['street_edge_id'].tolist() == [100]


def test_main_resumes_from_existing_output(monkeypatch, tmp_path):
    _setup_gsv_run(monkeypatch, tmp_path, [(100, 1, _LINE_100), (200, 1, _LINE_200)])
    # A prior run got as far as street 200 (the last row is the progress marker), so 100 must be skipped on resume.
    pd.DataFrame({'street_edge_id': [200], 'region_id': [1]}).to_csv(
        tmp_path / 'db' / 'streets_with_no_imagery.csv', index=False)
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'ZERO_RESULTS'})

    assert cs.main(['--gsv']) == 0
    # Only street 200 was (re)processed; 100 was skipped, so it is absent from the output.
    assert pd.read_csv(tmp_path / 'db' / 'streets_with_no_imagery.csv')['street_edge_id'].tolist() == [200]


def test_main_writes_progress_and_returns_1_on_request_error(monkeypatch, tmp_path):
    _setup_gsv_run(monkeypatch, tmp_path, [(100, 1, _LINE_100)])

    def _boom(url):
        raise requests.exceptions.RequestException('connection reset')

    monkeypatch.setattr(cs, '_get_json', _boom)

    assert cs.main(['--gsv']) == 1
    # The interrupted street is saved as the progress marker so a re-run resumes from it.
    assert 100 in pd.read_csv(tmp_path / 'db' / 'streets_with_no_imagery.csv')['street_edge_id'].tolist()


def test_main_mapillary_does_not_flag_street_with_imagery(monkeypatch, tmp_path):
    _write_street_csv(tmp_path, [(100, 1, _LINE_100)])
    (tmp_path / 'db').mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('MAPILLARY_ACCESS_TOKEN', 'dummy')
    monkeypatch.setattr(cs, '_get_json', lambda url: {'data': [{'id': 1}]})  # imagery everywhere

    assert cs.main(['--mapillary']) == 0
    assert pd.read_csv(tmp_path / 'db' / 'streets_with_no_imagery.csv').empty


def test_main_returns_1_on_unexpected_mapillary_error(monkeypatch, tmp_path):
    _write_street_csv(tmp_path, [(100, 1, _LINE_100)])
    (tmp_path / 'db').mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('MAPILLARY_ACCESS_TOKEN', 'dummy')
    monkeypatch.setattr(cs, '_get_json', lambda url: {'error': {'code': 400, 'message': 'bad request'}})

    assert cs.main(['--mapillary']) == 1
