"""
Unit tests for scripts/check_streets_for_imagery.py.

Covers the pure helpers (bounding box, vertex interpolation, response parsers, capture-date parsing, Mapillary
pano ranking, decision thresholds), the retry/fetch and per-street worker (including imagery-age capture), the checkpoint/output persistence
(no-imagery list + imagery summary), and the `main` scan end-to-end with the HTTP layer mocked (happy path, no-imagery
flagging, resume, fail-soft + retry, and interrupt). See test/python/README.md.
"""

import base64
import json
import math
import os

import pandas as pd
import pytest
import requests
from geopy import Point as GeoPoint
from geopy.distance import geodesic
from shapely import wkb
from shapely.geometry import LineString

import check_streets_for_imagery as cs

_LINE_60 = LineString([(-122.300, 47.60), (-122.299, 47.60)])
_LINE_61 = LineString([(-122.310, 47.61), (-122.309, 47.61)])

# A point the Mapillary fixtures sit on, and a timestamp to age them against. 1626307200000 is 2021-07-15T00:00:00Z
# exactly, so a seconds-vs-ms mixup or a local-timezone conversion both produce a different date.
_LAT, _LNG = 47.60, -122.300
_JUL_2021_MS = 1626307200000
_JUN_2019_MS = 1560000000000
_NOW_MS = 1725000000000  # 2024-08-30T06:40:00Z, comfortably after both.


def _lat_north_of_origin(meters):
    """The latitude `meters` due north of (_LAT, _LNG), for placing a fixture at a known distance from it."""
    return geodesic(meters=meters).destination(GeoPoint(_LAT, _LNG), bearing=0).latitude


def _image(captured_at=_JUL_2021_MS, lat=_LAT, lng=_LNG, width=8192, image_id=1, **extra):
    """A Mapillary `data` entry carrying every field score_pano ranks on. Override one field to isolate a term."""
    return {'id': image_id, 'captured_at': captured_at, 'width': width,
            'geometry': {'type': 'Point', 'coordinates': [lng, lat]}, **extra}


# --------------------------------------------------------------------------------------------------------------------
# create_bounding_box / redistribute_vertices
# --------------------------------------------------------------------------------------------------------------------

def test_create_bounding_box_is_ordered_and_radius_scales():
    west, south, east, north = cs.create_bounding_box(47.6, -122.3, 0.025)
    assert west < east
    assert south < north
    # radius_km is in kilometers, so a 25 km box is ~1000x wider than a 25 m (0.025 km) box.
    small_width = east - west
    large = cs.create_bounding_box(47.6, -122.3, 25)
    assert (large[2] - large[0]) > small_width * 100


def test_redistribute_vertices_short_line_keeps_endpoints():
    assert len(cs.redistribute_vertices(LineString([(0, 0), (0, cs.DISTANCE / 2)])).coords) >= 2


def test_redistribute_vertices_long_line_adds_points_every_distance():
    # length / DISTANCE = 10 segments -> 11 vertices.
    assert len(cs.redistribute_vertices(LineString([(0, 0), (0, cs.DISTANCE * 10)])).coords) == 11


# --------------------------------------------------------------------------------------------------------------------
# response parsers + capture-date parsing
# --------------------------------------------------------------------------------------------------------------------

def test_gsv_has_imagery():
    assert cs.gsv_has_imagery({'status': 'OK', 'location': {'lat': 47.6, 'lng': -122.3}}) is True
    assert cs.gsv_has_imagery({'status': 'ZERO_RESULTS'}) is False


def test_mapillary_has_imagery_data_presence():
    assert cs.mapillary_has_imagery({'data': [{'id': 1}]}) is True
    assert cs.mapillary_has_imagery({'data': []}) is False


def test_mapillary_has_imagery_error_code_100_means_plenty():
    assert cs.mapillary_has_imagery({'error': {'code': 100, 'message': 'too many'}}) is True


def test_mapillary_has_imagery_other_error_raises():
    with pytest.raises(cs.ImageryApiError):
        cs.mapillary_has_imagery({'error': {'code': 400, 'message': 'bad request'}})


@pytest.mark.parametrize('raw, expected', [
    ('2019-06-15', '2019-06-15'),   # full date
    ('2019-06', '2019-06-01'),      # year-month -> 1st of month
    ('2019', '2019-01-01'),         # year only -> Jan 1
    (None, None),
    ('', None),
    ('not-a-date', None),
])
def test_standardize_capture_date(raw, expected):
    assert cs.standardize_capture_date(raw) == expected


def test_standardize_capture_date_handles_nan():
    assert cs.standardize_capture_date(float('nan')) is None


def test_gsv_capture_date():
    assert cs.gsv_capture_date({'status': 'OK', 'date': '2020-03'}) == '2020-03-01'
    assert cs.gsv_capture_date({'status': 'ZERO_RESULTS'}) is None  # no 'date' field
    assert cs.gsv_capture_date({'status': 'OK'}) is None            # imagery but no date


# --------------------------------------------------------------------------------------------------------------------
# Mapillary pano ranking (score_pano / best_pano / mapillary_capture_date)
# --------------------------------------------------------------------------------------------------------------------

def test_pano_scoring_config_holds_four_weights_summing_to_one():
    # The docstrings promise a score in [0, 1], and the JS port relies on the same four names.
    weights = {key: value for key, value in cs.PANO_SCORING.items() if key.endswith('Weight')}
    assert set(weights) == {'distanceWeight', 'resolutionWeight', 'recencyWeight', 'sequenceWeight'}
    assert sum(weights.values()) == pytest.approx(1.0)


def test_score_pano_is_the_weighted_sum_of_its_terms():
    # A pano at the cap width, captured "now", 10 m from the sampled point: resolution and recency both score 1, so
    # only the distance term is interesting. The sequence term is absent offline, hence the missing sequenceWeight.
    scoring = cs.PANO_SCORING
    image = _image(lat=_lat_north_of_origin(10), width=scoring['maxImageWidthPx'], captured_at=_NOW_MS)
    expected = (scoring['distanceWeight'] * math.exp(-10 / scoring['distanceDecayMeters'])
                + scoring['resolutionWeight']
                + scoring['recencyWeight'])
    assert cs.score_pano(image, _LAT, _LNG, _NOW_MS) == pytest.approx(expected, rel=1e-3)


def test_score_pano_caps_resolution_at_the_max_width():
    at_cap = _image(width=cs.PANO_SCORING['maxImageWidthPx'])
    over_cap = _image(width=cs.PANO_SCORING['maxImageWidthPx'] * 4)
    assert cs.score_pano(over_cap, _LAT, _LNG, _NOW_MS) == pytest.approx(cs.score_pano(at_cap, _LAT, _LNG, _NOW_MS))


def test_score_pano_missing_width_costs_the_whole_resolution_term():
    sized = _image(width=cs.PANO_SCORING['maxImageWidthPx'])
    unsized = _image()
    del unsized['width']
    lost = cs.score_pano(sized, _LAT, _LNG, _NOW_MS) - cs.score_pano(unsized, _LAT, _LNG, _NOW_MS)
    assert lost == pytest.approx(cs.PANO_SCORING['resolutionWeight'])


def test_score_pano_prefers_computed_geometry_over_raw_geometry():
    refined = _image(lat=_lat_north_of_origin(25),
                     computed_geometry={'type': 'Point', 'coordinates': [_LNG, _lat_north_of_origin(1)]})
    raw_only = _image(lat=_lat_north_of_origin(25))
    assert cs.score_pano(refined, _LAT, _LNG, _NOW_MS) > cs.score_pano(raw_only, _LAT, _LNG, _NOW_MS)


def test_score_pano_unscorable_image_returns_none():
    assert cs.score_pano({'id': 1, 'captured_at': _JUL_2021_MS}, _LAT, _LNG, _NOW_MS) is None  # no coordinates
    undated = _image()
    del undated['captured_at']
    assert cs.score_pano(undated, _LAT, _LNG, _NOW_MS) is None


def test_best_pano_returns_the_highest_scorer():
    close = _image(image_id='close', lat=_lat_north_of_origin(2))
    far = _image(image_id='far', lat=_lat_north_of_origin(24))
    assert cs.best_pano({'data': [far, close]}, _LAT, _LNG, _NOW_MS)['id'] == 'close'


def test_best_pano_none_when_nothing_is_scorable():
    assert cs.best_pano({'data': []}, _LAT, _LNG, _NOW_MS) is None
    assert cs.best_pano({'error': {'code': 100, 'message': 'too many'}}, _LAT, _LNG, _NOW_MS) is None


def test_mapillary_capture_date_takes_the_viewers_pick_not_the_newest():
    # The failure this ranking exists to prevent (#4411): the brand-new but distant, low-res pano would set the
    # street's recorded date, and we would stop flagging the street while Explore kept showing the older one.
    close_old = _image(image_id='close_old', captured_at=_JUN_2019_MS, lat=_lat_north_of_origin(3), width=8192)
    far_new = _image(image_id='far_new', captured_at=_NOW_MS, lat=_lat_north_of_origin(20), width=2048)
    response = {'data': [close_old, far_new]}
    assert max(image['captured_at'] for image in response['data']) == _NOW_MS  # newest really is the other one
    assert cs.mapillary_capture_date(response, _LAT, _LNG, _NOW_MS) == '2019-06-08'


def test_mapillary_capture_date_converts_epoch_milliseconds_in_utc():
    # captured_at is a Unix epoch timestamp in **milliseconds**, UTC. _JUL_2021_MS is 2021-07-15T00:00:00Z exactly, so
    # a seconds-vs-ms mixup or a local-timezone conversion would both produce a different date.
    assert cs.mapillary_capture_date({'data': [_image()]}, _LAT, _LNG, _NOW_MS) == '2021-07-15'


def test_mapillary_capture_date_defaults_to_the_current_time():
    # With one candidate the recency term can't change the winner, so an unpinned "now" is still deterministic.
    assert cs.mapillary_capture_date({'data': [_image()]}, _LAT, _LNG) == '2021-07-15'


def test_mapillary_capture_date_no_scorable_images():
    assert cs.mapillary_capture_date({'data': []}, _LAT, _LNG) is None
    assert cs.mapillary_capture_date({'data': [{'id': 1}]}, _LAT, _LNG) is None  # fields= gave us nothing to rank
    assert cs.mapillary_capture_date({'error': {'code': 100, 'message': 'too many'}}, _LAT, _LNG) is None


def test_pano_info():
    assert cs._pano_info('GSV', {'status': 'OK', 'date': '2019'}, _LAT, _LNG) == cs.PanoInfo(True, '2019-01-01')
    assert cs._pano_info('GSV', {'status': 'ZERO_RESULTS'}, _LAT, _LNG) == cs.PanoInfo(False, None)
    assert cs._pano_info('Mapillary', {'data': [_image()]}, _LAT, _LNG) == cs.PanoInfo(True, '2021-07-15')
    assert cs._pano_info('Mapillary', {'data': [{'id': 1}]}, _LAT, _LNG) == cs.PanoInfo(True, None)


# --------------------------------------------------------------------------------------------------------------------
# Infra3d: nearest-frame interpretation + token handling
# --------------------------------------------------------------------------------------------------------------------

def _frame(lat, lng, timestamp='2024-06-17T11:23:09.795417+00:00'):
    return {'latitude': lat, 'longitude': lng, 'timestamp': timestamp, 'type': 'cubemap'}


def test_infra3d_pano_info_nearest_within_radius():
    # ~11 m north of the point, inside the 15 m radius.
    response = {'value': [_frame(47.6001, -122.3)]}
    assert cs.infra3d_pano_info(response, 47.6, -122.3, 0.015) == cs.PanoInfo(True, '2024-06-17')


def test_infra3d_pano_info_picks_the_nearest_of_several():
    response = {'value': [_frame(47.61, -122.3, '2020-01-01T00:00:00+00:00'), _frame(47.6001, -122.3)]}
    assert cs.infra3d_pano_info(response, 47.6, -122.3, 0.015) == cs.PanoInfo(True, '2024-06-17')


def test_infra3d_pano_info_nearest_beyond_radius_is_no_imagery():
    # The endpoint has no distance cap, so a frame 1 km away still comes back; it must not count.
    response = {'value': [_frame(47.61, -122.3)]}
    assert cs.infra3d_pano_info(response, 47.6, -122.3, 0.015) == cs.PanoInfo(False, None)


def test_infra3d_pano_info_empty_value_is_no_imagery():
    assert cs.infra3d_pano_info({'value': []}, 47.6, -122.3, 0.015) == cs.PanoInfo(False, None)


def test_infra3d_pano_info_missing_timestamp_has_no_date():
    response = {'value': [{'latitude': 47.6, 'longitude': -122.3, 'timestamp': None}]}
    assert cs.infra3d_pano_info(response, 47.6, -122.3, 0.015) == cs.PanoInfo(True, None)


@pytest.mark.parametrize('response', [{'message': 'Unauthorized'}, {'value': 'nope'}, ['not', 'a', 'dict']])
def test_infra3d_pano_info_unexpected_response_raises(response):
    with pytest.raises(cs.ImageryApiError):
        cs.infra3d_pano_info(response, 47.6, -122.3, 0.015)


@pytest.mark.parametrize('frame', [
    {'longitude': -122.3, 'timestamp': 'x'},  # no latitude
    {'latitude': 'north', 'longitude': -122.3},  # non-numeric coordinate
    {'latitude': 47.6, 'longitude': -122.3, 'timestamp': 1718622189},  # numeric, not ISO
    'not a frame',
])
def test_infra3d_pano_info_malformed_frame_raises_api_error(frame):
    # A bad frame must surface as ImageryApiError (-> the street is FAILED), never as a raw KeyError/TypeError that
    # would escape process_street and kill the whole scan.
    with pytest.raises(cs.ImageryApiError, match='malformed'):
        cs.infra3d_pano_info({'value': [frame]}, 47.6, -122.3, 0.015)


def test_infra3d_campaigns_parses_uid_and_name():
    response = {'value': [{'uid': 'c1', 'name': '2024 Zürich'}, {'uid': 'c2'}]}
    assert cs.infra3d_campaigns(response) == [('c1', '2024 Zürich'), ('c2', None)]


@pytest.mark.parametrize('response', [{'message': 'Unauthorized'}, {'value': [{'name': 'no uid'}]}, {'value': ['x']}])
def test_infra3d_campaigns_unexpected_response_raises(response):
    with pytest.raises(cs.ImageryApiError):
        cs.infra3d_campaigns(response)


def test_choose_infra3d_campaigns_uses_the_only_campaign():
    assert cs.choose_infra3d_campaigns([('c1', 'only')], []) == ['c1']


def test_choose_infra3d_campaigns_honors_request():
    assert cs.choose_infra3d_campaigns([('c1', 'a'), ('c2', 'b')], ['c2', 'c1']) == ['c2', 'c1']


def test_choose_infra3d_campaigns_several_without_request_lists_them():
    with pytest.raises(ValueError, match=r'2 campaigns.*\n  c1  a\n  c2  b'):
        cs.choose_infra3d_campaigns([('c1', 'a'), ('c2', 'b')], [])


def test_choose_infra3d_campaigns_none_in_tenant():
    with pytest.raises(ValueError, match='0 campaigns'):
        cs.choose_infra3d_campaigns([], [])


def test_choose_infra3d_campaigns_unknown_request_rejected():
    # Filtering on a uid the tenant doesn't hold makes the knn query time out server-side, so catch it up front.
    with pytest.raises(ValueError, match='not in this tenant: c9'):
        cs.choose_infra3d_campaigns([('c1', 'a')], ['c1', 'c9'])


def test_infra3d_knn_url_encodes_pano_and_campaign_filter():
    url = cs._infra3d_knn_url('uzh', 47.6, -122.3, ['c1', 'c2'])
    assert url.startswith('https://api.infra3d.com/framegate/frames/uzh/knn/query?longitude=-122.3&latitude=47.6')
    assert url.endswith('&filter=type%20in%20%27%28calotte%2C%20cubemap%29%27%20and%20campaign_uid%20in%20%27%28c1'
                        '%2C%20c2%29%27')


def _jwt(claims):
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
    return 'header.%s.signature' % payload


def test_jwt_claims_decodes_unpadded_payload():
    assert cs._jwt_claims(_jwt({'exp': 1, 'scope': 'a b'})) == {'exp': 1, 'scope': 'a b'}


class _TokenResp:
    def __init__(self, status_code, token=None, text='error body'):
        self.status_code = status_code
        self._token = token
        self.text = text

    def json(self):
        return {'access_token': self._token}


def _auth(post, now):
    return cs.Infra3dAuth('id', 'secret', post=post, now=now)


def test_infra3d_auth_mints_token_and_reads_tenant_from_scope():
    calls = []

    def post(url, data, headers, timeout):
        calls.append((url, data))
        return _TokenResp(200, _jwt({'exp': 4000, 'scope': 'permission/edit framegate/uzh role/user'}))

    auth = _auth(post, now=lambda: 1000)
    headers = auth.headers()
    assert auth.tenant == 'uzh'
    assert headers['Authorization'].startswith('Bearer header.')
    assert headers['x-api-key'] == cs.INFRA3D_API_KEY
    assert calls == [(cs.INFRA3D_TOKEN_URL,
                      {'client_id': 'id', 'client_secret': 'secret', 'grant_type': 'client_credentials'})]


def test_infra3d_auth_reuses_token_until_near_expiry():
    clock = {'t': 1000}
    calls = {'n': 0}

    def post(url, data, headers, timeout):
        calls['n'] += 1
        return _TokenResp(200, _jwt({'exp': clock['t'] + 3600, 'scope': 'framegate/uzh'}))

    auth = _auth(post, now=lambda: clock['t'])
    auth.headers()
    clock['t'] += 3600 - cs.INFRA3D_TOKEN_REFRESH_MARGIN - 1  # still (just) outside the refresh margin
    auth.headers()
    assert calls['n'] == 1
    clock['t'] += 1  # now inside the margin -> refreshed
    auth.headers()
    assert calls['n'] == 2


def test_infra3d_auth_non_200_raises():
    auth = _auth(lambda url, data, headers, timeout: _TokenResp(401, text='bad client'), now=lambda: 0)
    with pytest.raises(cs.ImageryApiError, match='401'):
        auth.headers()


@pytest.mark.parametrize('scope', ['role/user', 'framegate/uzh framegate/uzh_winterthur'])
def test_infra3d_auth_scope_without_exactly_one_tenant_raises(scope):
    auth = _auth(lambda url, data, headers, timeout: _TokenResp(200, _jwt({'exp': 9, 'scope': scope})),
                 now=lambda: 0)
    with pytest.raises(cs.ImageryApiError, match='exactly one framegate'):
        auth.headers()


class _RawTokenResp:
    status_code = 200
    text = ''

    def __init__(self, body):
        self._body = body

    def json(self):
        return self._body


@pytest.mark.parametrize('body', [
    {'error': 'captive portal'},  # 200 without an access_token
    {'access_token': 'not-a-jwt'},  # no payload segment
    {'access_token': 'h.!!!.s'},  # payload isn't base64/JSON
    {'access_token': _jwt({'scope': 'framegate/uzh'})},  # no exp
    {'access_token': 42},
])
def test_infra3d_auth_unparseable_token_response_is_api_error(body):
    auth = _auth(lambda url, data, headers, timeout: _RawTokenResp(body), now=lambda: 0)
    with pytest.raises(cs.ImageryApiError, match='unexpected Infra3d token response'):
        auth.headers()


def test_infra3d_auth_failed_refresh_keeps_raising():
    # A refresh that fails validation must not commit the new token/expiry: otherwise the next call would see an
    # unexpired token, skip the refresh, and carry on with the stale tenant.
    responses = [_TokenResp(200, _jwt({'exp': 4000, 'scope': 'framegate/uzh'})),
                 _TokenResp(200, _jwt({'exp': 99999, 'scope': 'role/user'}))]
    auth = _auth(lambda url, data, headers, timeout: responses.pop(0), now=lambda: 5000)
    auth.headers()  # first token: fine
    with pytest.raises(cs.ImageryApiError):  # already past its expiry, so this refreshes -> rejected
        auth.headers()
    assert auth.tenant == 'uzh'
    with pytest.raises(IndexError):  # tries to refresh again rather than serving the rejected token
        auth.headers()


def test_summarize_dates():
    assert cs.summarize_dates([]) == (None, None, 0)
    assert cs.summarize_dates(['2020-05-05', '2019-01-01', '2019-06-01']) == ('2019-01-01', '2020-05-05', 3)


# --------------------------------------------------------------------------------------------------------------------
# imagery_verdict / street_has_no_imagery
# --------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize('n_fail, n_success, n_coords, endpoint_failed, expected', [
    (5, 0, 10, False, cs.NO_IMAGERY),
    (3, 0, 10, True, cs.NO_IMAGERY),
    (3, 0, 10, False, None),
    (0, 8, 10, True, cs.HAS_IMAGERY),
    (0, 6, 10, False, cs.HAS_IMAGERY),
    (0, 6, 10, True, None),
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
    assert cs.street_has_no_imagery(False, False, []) is False


def test_street_has_no_imagery_lazy_iterable_stops_early():
    fetched = []

    def lazy_points():
        for value in [False, False, False, False, False]:
            fetched.append(value)
            yield value

    # 5 points, both endpoints ok, all missing -> NO_IMAGERY once n_fail >= 0.5*5 = 2.5 (at the 3rd point).
    assert cs.street_has_no_imagery(False, False, lazy_points(), n_coords=5) is True
    assert len(fetched) == 3  # stopped consuming (and fetching) early


# --------------------------------------------------------------------------------------------------------------------
# make_fetch (retry) + rate limiter
# --------------------------------------------------------------------------------------------------------------------

def test_make_fetch_retries_then_succeeds(monkeypatch):
    calls = {'n': 0}

    def flaky(url):
        calls['n'] += 1
        if calls['n'] < 2:
            raise requests.exceptions.ConnectionError('transient')
        return {'ok': True}

    monkeypatch.setattr(cs, '_get_json', flaky)
    sleeps = []
    fetch = cs.make_fetch(max_attempts=3, sleep=sleeps.append)
    assert fetch('http://x') == {'ok': True}
    assert calls['n'] == 2
    assert len(sleeps) == 1  # slept once between the two attempts


def test_make_fetch_reraises_after_max_attempts(monkeypatch):
    def always_fail(url):
        raise requests.exceptions.ConnectionError('down')

    monkeypatch.setattr(cs, '_get_json', always_fail)
    fetch = cs.make_fetch(max_attempts=2, sleep=lambda _seconds: None)
    with pytest.raises(requests.exceptions.RequestException):
        fetch('http://x')


def test_get_json_defaults_to_get(monkeypatch):
    class _Resp:
        def json(self):
            return {'ok': True}

    seen = {}

    def request(**kwargs):
        seen.update(kwargs)
        return _Resp()

    monkeypatch.setattr(cs.requests, 'request', request)
    assert cs._get_json('http://x') == {'ok': True}
    assert seen == {'url': 'http://x', 'method': 'GET', 'timeout': cs.REQUEST_TIMEOUT}


def test_get_json_passes_method_and_headers_through(monkeypatch):
    seen = {}

    class _Resp:
        def json(self):
            return {}

    def request(**kwargs):
        seen.update(kwargs)
        return _Resp()

    monkeypatch.setattr(cs.requests, 'request', request)
    cs._get_json('http://x', method='POST', headers={'x-api-key': 'k'})
    assert (seen['method'], seen['headers']) == ('POST', {'x-api-key': 'k'})


def test_make_fetch_forwards_kwargs(monkeypatch):
    seen = {}
    monkeypatch.setattr(cs, '_get_json', lambda url, **kwargs: seen.update(kwargs) or {'ok': True})
    assert cs.make_fetch(sleep=lambda _s: None)('http://x', method='POST') == {'ok': True}
    assert seen == {'method': 'POST'}


def test_mapillary_bbox_url_appends_four_coords():
    url = cs._mapillary_bbox_url('http://m?access_token=k', 47.6, -122.3, 0.025)
    assert url.startswith('http://m?access_token=k&bbox=')
    assert len(url.split('&bbox=')[1].split(',')) == 4


def test_make_fetch_acquires_a_rate_limiter_token(monkeypatch):
    monkeypatch.setattr(cs, '_get_json', lambda url: {'ok': True})
    acquired = []

    class _Limiter:
        def acquire(self):
            acquired.append(1)

    cs.make_fetch(sleep=lambda _s: None, rate_limiter=_Limiter())('http://x')
    assert acquired == [1]  # a token was taken before the request


def test_rate_limiter_allows_burst_up_to_capacity():
    sleeps = []
    limiter = cs.RateLimiter(max_per_second=2, capacity=2, monotonic=lambda: 0.0, sleep=sleeps.append)
    limiter.acquire()
    limiter.acquire()
    assert sleeps == []  # a full bucket lets two through with no waiting


def test_rate_limiter_throttles_when_depleted():
    clock = {'t': 0.0}
    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)
        clock['t'] += seconds  # advance the fake clock so the bucket refills

    limiter = cs.RateLimiter(max_per_second=2, capacity=2, monotonic=lambda: clock['t'], sleep=sleep)
    limiter.acquire()
    limiter.acquire()  # bucket now empty
    limiter.acquire()  # must wait ~0.5 s for one token to refill at 2/s
    assert sleeps == [pytest.approx(0.5)]


# --------------------------------------------------------------------------------------------------------------------
# process_street (fetch stubbed directly, no network)
# --------------------------------------------------------------------------------------------------------------------

def _street(line, street_edge_id=100, region_id=1):
    x1, y1 = line.coords[0]
    x2, y2 = line.coords[-1]
    return pd.Series({'street_edge_id': street_edge_id, 'region_id': region_id,
                      'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'geom': line})


def _run_process(line, api, fetch):
    return cs.process_street(_street(line), api, fetch, 'gsv&radius=15', 'gsv&radius=25', 'mapillary')


def test_process_street_gsv_no_imagery():
    result = _run_process(_LINE_60, 'GSV', lambda url: {'status': 'ZERO_RESULTS'})
    assert (result.street_edge_id, result.region_id, result.outcome) == (100, 1, cs.NO_IMAGERY)
    assert (result.oldest_capture, result.newest_capture, result.n_panos) == (None, None, 0)


def test_process_street_gsv_has_imagery_without_dates():
    # Imagery present but the responses carry no 'date' -> no capture dates collected.
    result = _run_process(_LINE_60, 'GSV', lambda url: {'status': 'OK'})
    assert result.outcome == cs.HAS_IMAGERY
    assert (result.oldest_capture, result.newest_capture, result.n_panos) == (None, None, 0)


def test_process_street_captures_capture_date_range():
    # Endpoints (radius=25) older, along-street points (radius=15) newer -> a captured date range.
    def fetch(url):
        return {'status': 'OK', 'date': '2018-01'} if 'radius=25' in url else {'status': 'OK', 'date': '2021-07-15'}

    result = _run_process(_LINE_60, 'GSV', fetch)
    assert result.outcome == cs.HAS_IMAGERY
    assert result.oldest_capture == '2018-01-01'
    assert result.newest_capture == '2021-07-15'
    assert result.n_panos >= 3


def test_process_street_gsv_points_missing_imagery():
    # Endpoints (radius=25) have imagery; along-street points (radius=15) do not.
    fetch = lambda url: {'status': 'OK'} if 'radius=25' in url else {'status': 'ZERO_RESULTS'}
    assert _run_process(_LINE_60, 'GSV', fetch).outcome == cs.NO_IMAGERY


def test_process_street_mapillary_has_imagery():
    assert _run_process(_LINE_60, 'Mapillary', lambda url: {'data': [_image()]}).outcome == cs.HAS_IMAGERY


def test_process_street_mapillary_no_imagery():
    assert _run_process(_LINE_60, 'Mapillary', lambda url: {'data': []}).outcome == cs.NO_IMAGERY


def test_process_street_mapillary_captures_date_range():
    # The first two fetches are the endpoints (older imagery); along-street points see newer imagery -> a date range.
    calls = {'n': 0}

    def fetch(url):
        calls['n'] += 1
        captured_at = _JUN_2019_MS if calls['n'] <= 2 else _JUL_2021_MS
        return {'data': [_image(image_id=calls['n'], captured_at=captured_at)]}

    result = _run_process(_LINE_60, 'Mapillary', fetch)
    assert result.outcome == cs.HAS_IMAGERY
    assert result.oldest_capture == '2019-06-08'
    assert result.newest_capture == '2021-07-15'
    assert result.n_panos >= 3


class _FakeInfra3dAuth:
    tenant = 'uzh'

    def headers(self):
        return {'Authorization': 'Bearer t'}


def _run_process_infra3d(line, fetch):
    scan = cs.Infra3dScan(_FakeInfra3dAuth(), ['c1'])
    return cs.process_street(_street(line), 'Infra3d', fetch, None, None, None, scan)


def _frame_at(url, timestamp='2024-06-17T11:23:09.795417+00:00'):
    # Echoing the query point back as the nearest frame means every checked point has imagery.
    query = dict(part.split('=') for part in url.split('?')[1].split('&'))
    return {'value': [{'latitude': float(query['latitude']), 'longitude': float(query['longitude']),
                       'timestamp': timestamp, 'type': 'cubemap'}]}


def test_process_street_infra3d_has_imagery_with_dates():
    seen = []

    def fetch(url, **kwargs):
        seen.append((url, kwargs))
        return _frame_at(url)

    result = _run_process_infra3d(_LINE_60, fetch)
    assert result.outcome == cs.HAS_IMAGERY
    assert (result.oldest_capture, result.newest_capture) == ('2024-06-17', '2024-06-17')
    assert result.n_panos >= 3
    assert all(url.startswith('https://api.infra3d.com/framegate/frames/uzh/knn/query?') for url, _ in seen)
    assert all('campaign_uid%20in%20%27%28c1%29%27' in url for url, _ in seen)
    assert all(kw == {'method': 'POST', 'headers': {'Authorization': 'Bearer t'}} for _, kw in seen)


def test_process_street_infra3d_nearest_frame_too_far_is_no_imagery():
    # The API answers (nearest frame ~1 km away), but nothing is within radius.
    far = {'value': [{'latitude': 47.61, 'longitude': -122.3, 'timestamp': '2024-01-01T00:00:00+00:00'}]}
    assert _run_process_infra3d(_LINE_60, lambda url, **kw: far).outcome == cs.NO_IMAGERY


def test_process_street_infra3d_bad_response_is_failed():
    assert _run_process_infra3d(_LINE_60, lambda url, **kw: {'message': 'Unauthorized'}).outcome == cs.FAILED

def test_process_street_request_error_is_failed():
    def boom(url):
        raise requests.exceptions.ConnectionError('down')

    assert _run_process(_LINE_60, 'GSV', boom).outcome == cs.FAILED


def test_process_street_api_error_is_failed():
    assert _run_process(_LINE_60, 'Mapillary',
                        lambda url: {'error': {'code': 400, 'message': 'bad'}}).outcome == cs.FAILED


def test_process_street_point_error_is_failed():
    # Endpoints OK, but a point fetch raises mid-walk -> the whole street is FAILED.
    def fetch(url):
        if 'radius=25' in url:
            return {'status': 'OK'}
        raise requests.exceptions.ConnectionError('down')

    assert _run_process(_LINE_60, 'GSV', fetch).outcome == cs.FAILED


# --------------------------------------------------------------------------------------------------------------------
# persistence: load_processed / append_checkpoint / _write_ids_csv / finalize_outputs
# --------------------------------------------------------------------------------------------------------------------

def test_load_processed_no_file(tmp_path):
    assert cs.load_processed(str(tmp_path / 'missing.csv')) == set()


def test_load_processed_excludes_failed(tmp_path):
    checkpoint = tmp_path / 'cp.csv'
    pd.DataFrame({'street_edge_id': [1, 2, 3], 'region_id': [1, 1, 1],
                  'outcome': [cs.NO_IMAGERY, cs.HAS_IMAGERY, cs.FAILED]}).to_csv(checkpoint, index=False)
    assert cs.load_processed(str(checkpoint)) == {1, 2}


def test_append_checkpoint_writes_header_then_appends(tmp_path):
    checkpoint = str(tmp_path / 'cp.csv')
    cs.append_checkpoint(cs.StreetResult(1, 10, cs.NO_IMAGERY, None, None, 0), checkpoint)
    cs.append_checkpoint(cs.StreetResult(2, 20, cs.HAS_IMAGERY, '2019-06-01', '2020-01-01', 5), checkpoint)
    written = pd.read_csv(checkpoint)
    assert list(written.columns) == cs.CHECKPOINT_COLUMNS
    assert written['street_edge_id'].tolist() == [1, 2]
    assert written['outcome'].tolist() == [cs.NO_IMAGERY, cs.HAS_IMAGERY]
    assert written['n_panos'].tolist() == [0, 5]


def test_write_ids_csv_coerces_to_int(tmp_path):
    out = tmp_path / 'ids.csv'
    cs._write_ids_csv(pd.DataFrame({'street_edge_id': [1.0, 2.0], 'region_id': [10.0, 20.0]}), str(out))
    written = pd.read_csv(out)
    assert written['street_edge_id'].tolist() == [1, 2]
    assert written['street_edge_id'].dtype.kind == 'i'


def _settled_checkpoint(rows):
    """Build a checkpoint DataFrame (full column set) from (id, region, outcome, oldest, newest, n_panos) tuples."""
    return pd.DataFrame(rows, columns=cs.CHECKPOINT_COLUMNS)


def test_finalize_outputs_dedups_keep_last_and_writes_summary(tmp_path):
    checkpoint = str(tmp_path / 'cp.csv')
    output, failed, summary = (str(tmp_path / f) for f in ('out.csv', 'failed.csv', 'summary.csv'))
    # Street 3 failed, then succeeded as no_imagery on retry -> keep the later outcome.
    _settled_checkpoint([
        (1, 1, cs.NO_IMAGERY, None, None, 0),
        (2, 1, cs.HAS_IMAGERY, '2019-01-01', '2020-05-05', 4),
        (3, 1, cs.FAILED, None, None, 0),
        (3, 1, cs.NO_IMAGERY, None, None, 0),
    ]).to_csv(checkpoint, index=False)

    cs.finalize_outputs(checkpoint, output, failed, summary)

    assert pd.read_csv(output)['street_edge_id'].tolist() == [1, 3]
    assert not os.path.exists(failed)
    summary_df = pd.read_csv(summary).set_index('street_edge_id').sort_index()
    assert list(summary_df.index) == [1, 2, 3]  # all settled (failed excluded)
    assert bool(summary_df.loc[2, 'has_imagery']) is True
    assert bool(summary_df.loc[1, 'has_imagery']) is False
    assert summary_df.loc[2, 'newest_capture'] == '2020-05-05'


def test_finalize_outputs_writes_failed_file(tmp_path):
    checkpoint = str(tmp_path / 'cp.csv')
    output, failed, summary = (str(tmp_path / f) for f in ('out.csv', 'failed.csv', 'summary.csv'))
    _settled_checkpoint([
        (1, 1, cs.NO_IMAGERY, None, None, 0),
        (2, 1, cs.FAILED, None, None, 0),
    ]).to_csv(checkpoint, index=False)

    cs.finalize_outputs(checkpoint, output, failed, summary)

    assert pd.read_csv(output)['street_edge_id'].tolist() == [1]
    assert pd.read_csv(failed)['street_edge_id'].tolist() == [2]
    assert pd.read_csv(summary)['street_edge_id'].tolist() == [1]  # failed streets are not summarized


def test_finalize_outputs_without_checkpoint_writes_empty(tmp_path):
    output, failed, summary = (str(tmp_path / f) for f in ('out.csv', 'failed.csv', 'summary.csv'))
    cs.finalize_outputs(str(tmp_path / 'missing.csv'), output, failed, summary)
    assert pd.read_csv(output).empty
    assert pd.read_csv(summary).empty


# --------------------------------------------------------------------------------------------------------------------
# main (HTTP mocked)
# --------------------------------------------------------------------------------------------------------------------

def _write_street_csv(directory, streets):
    rows = []
    for street_edge_id, region_id, line in streets:
        x1, y1 = line.coords[0]
        x2, y2 = line.coords[-1]
        rows.append({'street_edge_id': street_edge_id, 'region_id': region_id,
                     'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'geom': wkb.dumps(line, hex=True)})
    pd.DataFrame(rows).to_csv(directory / 'street_edge_endpoints.csv', index=False)


def _setup(monkeypatch, tmp_path, streets, env_var='GOOGLE_MAPS_API_KEY'):
    _write_street_csv(tmp_path, streets)
    (tmp_path / 'db').mkdir()
    # Point the script's repo root at tmp_path, then run from an unrelated CWD that has neither the input CSV nor a
    # db/ dir. This makes every main() test a regression check that the script resolves its files against the repo
    # root rather than the working directory (running from scripts/ used to fail at 0% progress, #4359).
    monkeypatch.setattr(cs, 'REPO_ROOT', str(tmp_path))
    elsewhere = tmp_path / 'elsewhere'
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.setenv(env_var, 'dummy')


def _output(tmp_path):
    return pd.read_csv(tmp_path / cs.OUTPUT_FILE)


def _summary(tmp_path):
    return pd.read_csv(tmp_path / cs.SUMMARY_FILE).set_index('street_edge_id')


def test_main_requires_a_provider_flag():
    with pytest.raises(SystemExit):
        cs.main([])


def test_main_rejects_both_flags():
    with pytest.raises(SystemExit):
        cs.main(['--gsv', '--mapillary'])


def test_main_missing_api_key_returns_1(monkeypatch):
    monkeypatch.delenv('GOOGLE_MAPS_API_KEY', raising=False)
    assert cs.main(['--gsv']) == 1


def test_main_happy_mixed_outcomes_and_summary(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60), (200, 1, _LINE_61)])
    # Street 200 (lat 47.61) has imagery everywhere; street 100 (lat 47.6) has none.
    monkeypatch.setattr(cs, '_get_json',
                        lambda url: {'status': 'OK'} if '47.61' in url else {'status': 'ZERO_RESULTS'})
    # High QPS so the rate limiter never actually throttles the test; --workers exercises the thread pool.
    assert cs.main(['--gsv', '--workers', '4', '--max-qps', '1000']) == 0
    assert _output(tmp_path)['street_edge_id'].tolist() == [100]
    summary = _summary(tmp_path)
    assert sorted(summary.index) == [100, 200]
    assert bool(summary.loc[200, 'has_imagery']) is True
    assert bool(summary.loc[100, 'has_imagery']) is False


def test_main_summary_captures_capture_dates(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(200, 1, _LINE_61)])
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'OK', 'date': '2021-08'})
    assert cs.main(['--gsv', '--max-qps', '1000']) == 0
    summary = _summary(tmp_path)
    assert summary.loc[200, 'newest_capture'] == '2021-08-01'
    assert summary.loc[200, 'n_panos'] >= 1


def test_main_runs_from_a_different_working_directory(monkeypatch, tmp_path):
    # Regression for #4359: running from scripts/ (a dir without a db/ subdir) used to fail silently at 0% progress,
    # because the first checkpoint write hit a CWD-relative db/ path that didn't exist. Anchoring to the repo root
    # fixes it: here we run from a scripts/ dir that has neither the input CSV nor db/, and the scan still completes.
    _write_street_csv(tmp_path, [(100, 1, _LINE_60)])
    (tmp_path / 'db').mkdir()
    monkeypatch.setattr(cs, 'REPO_ROOT', str(tmp_path))
    scripts_dir = tmp_path / 'scripts'
    scripts_dir.mkdir()
    monkeypatch.chdir(scripts_dir)
    monkeypatch.setenv('GOOGLE_MAPS_API_KEY', 'dummy')
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'ZERO_RESULTS'})  # no imagery -> flagged

    assert cs.main(['--gsv']) == 0
    # Output and checkpoint land under the repo root's db/, not the scripts/ working directory.
    assert _output(tmp_path)['street_edge_id'].tolist() == [100]
    assert not (scripts_dir / 'db').exists()


def test_main_resumes_from_checkpoint(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60), (200, 1, _LINE_61)])
    _settled_checkpoint([(100, 1, cs.HAS_IMAGERY, '2019-01-01', '2019-01-01', 3)]).to_csv(
        tmp_path / cs.CHECKPOINT_FILE, index=False)
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'ZERO_RESULTS'})
    assert cs.main(['--gsv']) == 0
    # 100 was already settled (has imagery) and skipped; only 200 was processed -> flagged.
    assert _output(tmp_path)['street_edge_id'].tolist() == [200]


def test_progress_bar_resumes_at_prior_position(monkeypatch, tmp_path):
    # The bar tracks the whole city (total) and is seeded with already-settled streets (initial) so a resumed scan
    # picks up at its prior percentage rather than restarting at 0% (requested on #4360).
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60), (200, 1, _LINE_61), (300, 1, _LINE_60)])
    _settled_checkpoint([(100, 1, cs.HAS_IMAGERY, '2019-01-01', '2019-01-01', 3),
                         (200, 1, cs.NO_IMAGERY, None, None, 0)]).to_csv(tmp_path / cs.CHECKPOINT_FILE, index=False)
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'ZERO_RESULTS'})

    captured = {}

    def spy_tqdm(iterable, **kwargs):
        captured.update(kwargs)
        return iterable

    monkeypatch.setattr(cs, 'tqdm', spy_tqdm)
    assert cs.main(['--gsv']) == 0
    # 3 streets total, 2 already settled -> bar starts at 2/3, not 0/3.
    assert captured['total'] == 3
    assert captured['initial'] == 2


def test_main_fail_soft_records_failed_streets(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60)])
    monkeypatch.setattr(cs.time, 'sleep', lambda *_a: None)  # neutralize backoff waits

    def boom(url):
        raise requests.exceptions.ConnectionError('down')

    monkeypatch.setattr(cs, '_get_json', boom)
    assert cs.main(['--gsv', '--max-qps', '1000']) == 0  # the scan completes despite the failure
    assert _output(tmp_path).empty
    assert pd.read_csv(tmp_path / cs.FAILED_FILE)['street_edge_id'].tolist() == [100]


def test_main_mapillary_branch(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60)], env_var='MAPILLARY_ACCESS_TOKEN')
    monkeypatch.setattr(cs, '_get_json', lambda url: {'data': []})  # no imagery
    assert cs.main(['--mapillary']) == 0
    assert _output(tmp_path)['street_edge_id'].tolist() == [100]


def test_main_mapillary_requests_and_records_capture_dates(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(200, 1, _LINE_61)], env_var='MAPILLARY_ACCESS_TOKEN')
    urls = []

    def fake_get_json(url):
        urls.append(url)
        return {'data': [_image()]}

    monkeypatch.setattr(cs, '_get_json', fake_get_json)
    assert cs.main(['--mapillary', '--max-qps', '1000']) == 0
    # Every request must ask for the fields score_pano ranks on — a default response carries only `id`.
    assert urls
    for field in ('captured_at', 'geometry', 'computed_geometry', 'width'):
        assert all(field in url.split('fields=')[1].split('&')[0] for url in urls)
    summary = _summary(tmp_path)
    assert bool(summary.loc[200, 'has_imagery']) is True
    assert summary.loc[200, 'newest_capture'] == '2021-07-15'
    assert summary.loc[200, 'n_panos'] >= 1


def _infra3d_token_post(status_code=200):
    def post(url, data, headers, timeout):
        return _TokenResp(status_code, _jwt({'exp': 10 ** 10, 'scope': 'framegate/uzh'}))
    return post


def _setup_infra3d(monkeypatch, tmp_path, campaigns, seen=None):
    """Fakes a tenant holding ``campaigns`` (``(uid, name)`` pairs) whose every knn query finds no imagery."""
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60)], env_var='INFRA3D_CLIENT_ID')
    monkeypatch.setenv('INFRA3D_CLIENT_SECRET', 'dummy')
    monkeypatch.setattr(cs.requests, 'post', _infra3d_token_post())

    def get_json(url, **kwargs):
        if seen is not None:
            seen.append(url)
        if url == 'https://api.infra3d.com/framegate/campaigns/uzh/query':
            return {'value': [{'uid': uid, 'name': name} for uid, name in campaigns]}
        return {'value': []}

    monkeypatch.setattr(cs, '_get_json', get_json)


def test_main_infra3d_branch_scopes_to_the_only_campaign(monkeypatch, tmp_path, capsys):
    seen = []
    _setup_infra3d(monkeypatch, tmp_path, [('c1', '2024 Zürich')], seen)
    assert cs.main(['--infra3d']) == 0
    assert _output(tmp_path)['street_edge_id'].tolist() == [100]
    assert 'tenant uzh, campaign(s): c1 (2024 Zürich)' in capsys.readouterr().out
    assert all('campaign_uid%20in%20%27%28c1%29%27' in url for url in seen[1:])


def test_main_infra3d_several_campaigns_need_a_choice(monkeypatch, tmp_path, capsys):
    _setup_infra3d(monkeypatch, tmp_path, [('c1', 'a'), ('c2', 'b')])
    assert cs.main(['--infra3d']) == 1
    out = capsys.readouterr().out
    assert '--campaign' in out and 'c1  a' in out and 'c2  b' in out


def test_main_infra3d_campaign_flag_selects_scope(monkeypatch, tmp_path):
    seen = []
    _setup_infra3d(monkeypatch, tmp_path, [('c1', 'a'), ('c2', 'b')], seen)
    assert cs.main(['--infra3d', '--campaign', 'c2', '--campaign', 'c1']) == 0
    assert all('campaign_uid%20in%20%27%28c2%2C%20c1%29%27' in url for url in seen[1:])


def test_main_infra3d_unknown_campaign_returns_1(monkeypatch, tmp_path, capsys):
    _setup_infra3d(monkeypatch, tmp_path, [('c1', 'a')])
    assert cs.main(['--infra3d', '--campaign', 'nope']) == 1
    assert 'not in this tenant: nope' in capsys.readouterr().out


def test_main_infra3d_missing_credentials_returns_1(monkeypatch):
    monkeypatch.setenv('INFRA3D_CLIENT_ID', 'dummy')
    monkeypatch.delenv('INFRA3D_CLIENT_SECRET', raising=False)
    assert cs.main(['--infra3d']) == 1


def test_main_infra3d_token_failure_returns_1(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60)], env_var='INFRA3D_CLIENT_ID')
    monkeypatch.setenv('INFRA3D_CLIENT_SECRET', 'dummy')
    monkeypatch.setattr(cs.requests, 'post', _infra3d_token_post(status_code=401))
    assert cs.main(['--infra3d']) == 1


def test_main_unexpected_worker_error_still_finalizes_outputs(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60), (200, 1, _LINE_61)])
    monkeypatch.setattr(cs.time, 'sleep', lambda *_a: None)

    def get_json(url):
        if '47.61' in url:
            raise RuntimeError('a bug, not a network error')
        return {'status': 'ZERO_RESULTS'}

    monkeypatch.setattr(cs, '_get_json', get_json)
    with pytest.raises(RuntimeError):  # not swallowed: a bug should still be loud...
        cs.main(['--gsv', '--workers', '1', '--max-qps', '1000'])
    assert _output(tmp_path)['street_edge_id'].tolist() == [100]  # ...but the settled streets are written out.

def test_main_keyboard_interrupt_finalizes_and_returns_1(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60)])
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'OK'})

    def interrupt(*_args, **_kwargs):
        raise KeyboardInterrupt()

    monkeypatch.setattr(cs, 'process_street', interrupt)
    assert cs.main(['--gsv']) == 1
    assert _output(tmp_path).empty  # finalize still ran, producing an (empty) output file
