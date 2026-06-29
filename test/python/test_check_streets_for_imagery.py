"""
Unit tests for scripts/check_streets_for_imagery.py.

Covers the pure helpers (bounding box, vertex interpolation, response parsers, capture-date parsing, decision
thresholds), the retry/fetch and per-street worker (including imagery-age capture), the checkpoint/output persistence
(no-imagery list + imagery summary), and the `main` scan end-to-end with the HTTP layer mocked (happy path, no-imagery
flagging, resume, fail-soft + retry, and interrupt). See test/python/README.md.
"""

import os

import pandas as pd
import pytest
import requests
from shapely import wkb
from shapely.geometry import LineString

import check_streets_for_imagery as cs

_LINE_60 = LineString([(-122.300, 47.60), (-122.299, 47.60)])
_LINE_61 = LineString([(-122.310, 47.61), (-122.309, 47.61)])


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


def test_pano_info():
    assert cs._pano_info('GSV', {'status': 'OK', 'date': '2019'}) == cs.PanoInfo(True, '2019-01-01')
    assert cs._pano_info('GSV', {'status': 'ZERO_RESULTS'}) == cs.PanoInfo(False, None)
    assert cs._pano_info('Mapillary', {'data': [{'id': 1}]}) == cs.PanoInfo(True, None)  # Mapillary date not captured


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
    assert _run_process(_LINE_60, 'Mapillary', lambda url: {'data': [{'id': 1}]}).outcome == cs.HAS_IMAGERY


def test_process_street_mapillary_no_imagery():
    assert _run_process(_LINE_60, 'Mapillary', lambda url: {'data': []}).outcome == cs.NO_IMAGERY


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
# persistence: load_processed / append_checkpoint / _write_ids_csv / finalize_outputs / _print_progress
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


def test_print_progress(capsys):
    cs._print_progress(1, 4)
    assert '25.00% complete' in capsys.readouterr().out


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
    monkeypatch.chdir(tmp_path)
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


def test_main_resumes_from_checkpoint(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60), (200, 1, _LINE_61)])
    _settled_checkpoint([(100, 1, cs.HAS_IMAGERY, '2019-01-01', '2019-01-01', 3)]).to_csv(
        tmp_path / cs.CHECKPOINT_FILE, index=False)
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'ZERO_RESULTS'})
    assert cs.main(['--gsv']) == 0
    # 100 was already settled (has imagery) and skipped; only 200 was processed -> flagged.
    assert _output(tmp_path)['street_edge_id'].tolist() == [200]


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


def test_main_keyboard_interrupt_finalizes_and_returns_1(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, [(100, 1, _LINE_60)])
    monkeypatch.setattr(cs, '_get_json', lambda url: {'status': 'OK'})

    def interrupt(*_args, **_kwargs):
        raise KeyboardInterrupt()

    monkeypatch.setattr(cs, 'process_street', interrupt)
    assert cs.main(['--gsv']) == 1
    assert _output(tmp_path).empty  # finalize still ran, producing an (empty) output file
