"""
Unit tests for tools/city/overpass.py (#5741): the retry schedule, the probe, osmnx's settings and the day cache, and
the paced multi-request fetch. Stdlib + requests only, so they run in both interpreter halves; the clock, the sleep
and the network are faked throughout.
"""
import logging
import sys
import threading
import time
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'tools' / 'city'))
import overpass as op  # noqa: E402


class FakeClock:
    """A clock that only moves when something sleeps on it, so a schedule is checked exactly, not timed."""

    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds

    def __call__(self):
        return self.now


class ResponseStatusCodeError(ValueError):
    """osmnx's class, by name: is_retryable goes by the name so the module needs no osmnx."""


def failing(exceptions, result='ok'):
    """An attempt that raises each exception in turn, then returns ``result``."""
    queue = list(exceptions)

    def attempt():
        if queue:
            raise queue.pop(0)
        return result
    return attempt


def no_jitter():
    return 0.0


# ------------------------------------------------------------------------------------------------- policy

def test_policy_doubles_from_30s_caps_at_240s_and_jitter_only_adds():
    policy = op.RetryPolicy()
    assert [policy.wait_after(k, 0.0) for k in range(1, 6)] == [30, 60, 120, 240, 240]
    assert policy.wait_after(1, 0.999) == pytest.approx(30 * 1.24975)
    assert policy.wait_after(1, 0.0) >= op.MIN_RETRY_WAIT_S


def test_policy_refuses_a_wait_under_the_usage_policy_floor_or_an_inconsistent_shape():
    with pytest.raises(ValueError, match='at least 30'):
        op.RetryPolicy(initial_wait_s=10)
    with pytest.raises(ValueError):
        op.RetryPolicy(max_wait_s=20)
    with pytest.raises(ValueError):
        op.RetryPolicy(window_s=0)


@pytest.mark.parametrize('exc, retryable', [
    (requests.ConnectionError('refused'), True),
    (requests.ConnectTimeout('slow'), True),
    (requests.ReadTimeout('slow'), True),
    (op.Refused('probe'), True),
    (ResponseStatusCodeError("'overpass-api.de' responded: 502 Bad Gateway <html>at capacity</html>"), True),
    (ResponseStatusCodeError("'overpass-api.de' responded: 429 Too Many Requests"), True),
    (ResponseStatusCodeError("'overpass-api.de' responded: 406 Not Acceptable"), True),
    (ResponseStatusCodeError("'overpass-api.de' responded: 400 Bad Request: line 1: parse error"), False),
    (ValueError('No matching features'), False),
    (KeyError('highway'), False),
])
def test_is_retryable_waits_only_on_transport_faults_and_refusal_statuses(exc, retryable):
    assert op.is_retryable(exc) is retryable


# ------------------------------------------------------------------------------------------------- retry

@pytest.mark.parametrize('exc', [
    requests.ConnectionError('Connection refused'),
    ResponseStatusCodeError("'overpass-api.de' responded: 502 Bad Gateway"),
    ResponseStatusCodeError("'overpass-api.de' responded: 429 Too Many Requests"),
])
def test_retry_waits_at_least_30s_after_any_refusal_then_doubles(exc, caplog):
    clock = FakeClock()
    with caplog.at_level(logging.WARNING):
        result = op.call_with_retry(failing([exc, exc, exc]), 'request 1/1', sleep=clock.sleep, clock=clock,
                                    rng=no_jitter)
    assert result == 'ok'
    assert clock.sleeps == [30, 60, 120]
    assert all(s >= op.MIN_RETRY_WAIT_S for s in clock.sleeps)
    assert 'waiting 30 s before attempt 2' in caplog.text


def test_retry_gives_up_only_when_the_window_runs_out_and_names_the_last_failure():
    clock = FakeClock()
    forever = requests.ConnectionError('Connection refused')
    with pytest.raises(op.OverpassUnavailable, match='after 5 attempt') as info:
        op.call_with_retry(failing([forever] * 20), 'request 3/9', sleep=clock.sleep, clock=clock, rng=no_jitter)
    # 30 + 60 + 120 + 240 = 450 s slept; the next 240 s wait would end past the 600 s window, so no sixth attempt.
    assert clock.sleeps == [30, 60, 120, 240]
    assert info.value.__cause__ is forever
    assert 'Connection refused' in str(info.value) and 'do not keep sending' in str(info.value)


def test_retry_counts_the_attempts_own_time_against_the_window():
    clock = FakeClock()

    def slow_refusal():
        clock.now += 200  # Each attempt sits through osmnx's 60 s /status fallback and a long connect timeout.
        raise requests.ConnectTimeout('slow')
    with pytest.raises(op.OverpassUnavailable):
        op.call_with_retry(slow_refusal, 'request', sleep=clock.sleep, clock=clock, rng=no_jitter)
    # 200 + 30 + 200 + 60 = 490 s in; a 120 s wait after the third attempt (690 s) would overrun the window.
    assert clock.sleeps == [30, 60]


def test_retry_raises_anything_that_is_not_a_refusal_at_once():
    clock = FakeClock()
    with pytest.raises(ValueError, match='parse error'):
        op.call_with_retry(failing([ValueError('parse error')]), 'request', sleep=clock.sleep, clock=clock)
    assert clock.sleeps == []


def test_retry_cuts_off_an_attempt_that_outlives_its_deadline_and_retries_it():
    clock = FakeClock()
    calls = []

    def hangs_once():
        calls.append(1)
        if len(calls) == 1:
            time.sleep(5)  # osmnx's unbounded 429 recursion, in miniature.
        return 'ok'
    policy = op.RetryPolicy(attempt_deadline_s=0.05)
    assert op.call_with_retry(hangs_once, 'request', policy, sleep=clock.sleep, clock=clock, rng=no_jitter) == 'ok'
    assert len(calls) == 2 and clock.sleeps == [30]


def test_with_deadline_restores_the_previous_alarm_handler_and_runs_unbounded_off_the_main_thread():
    import signal
    before = signal.getsignal(signal.SIGALRM)
    assert op.with_deadline(lambda: 'done', 1) == 'done'
    assert signal.getsignal(signal.SIGALRM) is before
    result = []
    worker = threading.Thread(target=lambda: result.append(op.with_deadline(lambda: 'thread', 0.01)))
    worker.start()
    worker.join()
    assert result == ['thread']


def test_summary_is_one_short_line():
    assert op.summary(ValueError('a\n  b   c')) == 'ValueError: a b c'
    assert op.summary(ValueError('x' * 500)).endswith('x') and len(op.summary(ValueError('x' * 500))) < 200
    assert op.summary(ValueError()) == 'ValueError'


# ------------------------------------------------------------------------------------------------- probe

def fake_post(status=200, reason='OK', raises=None):
    seen = {}

    def post(url, data, timeout, headers):
        seen.update(url=url, data=data, timeout=timeout, headers=headers)
        if raises:
            raise raises
        return SimpleNamespace(ok=status < 400, status_code=status, reason=reason)
    return post, seen


def test_probe_sends_the_tiny_query_with_our_identity():
    post, seen = fake_post()
    assert op.is_answering(post) is True
    assert seen['url'].endswith('/api/interpreter') and seen['data'] == {'data': op.PROBE_QUERY}
    assert seen['headers'] == {'User-Agent': op.USER_AGENT} and 'sidewalk@cs.uw.edu' in op.USER_AGENT
    assert 'node(1)' in op.PROBE_QUERY and '[timeout:5]' in op.PROBE_QUERY


def test_probe_is_false_on_a_refusal_or_a_bad_status_without_retrying(caplog):
    post, _ = fake_post(raises=requests.ConnectionError('refused'))
    with caplog.at_level(logging.INFO):
        assert op.is_answering(post) is False
        post, _ = fake_post(429, 'Too Many Requests')
        assert op.is_answering(post) is False
    assert 'probe failed' in caplog.text and 'answered 429' in caplog.text


def test_wait_until_answering_retries_the_probe_on_the_schedule(monkeypatch):
    answers = [False, False, True]
    monkeypatch.setattr(op, 'is_answering', lambda: answers.pop(0))
    clock = FakeClock()
    op.wait_until_answering(sleep=clock.sleep, clock=clock, rng=no_jitter)
    assert clock.sleeps == [30, 60]
    monkeypatch.setattr(op, 'is_answering', lambda: False)
    with pytest.raises(op.OverpassUnavailable, match='Overpass probe'):
        op.wait_until_answering(sleep=clock.sleep, clock=clock, rng=no_jitter)


def test_main_check_exits_0_when_answering_and_75_when_not(monkeypatch, capsys):
    monkeypatch.setattr(op, 'is_answering', lambda: True)
    assert op.main(['--check']) == 0
    monkeypatch.setattr(op, 'is_answering', lambda: False)
    assert op.main(['--check']) == op.EXIT_UNAVAILABLE == 75
    assert 'not answering' in capsys.readouterr().out
    with pytest.raises(SystemExit):
        op.main([])


# ------------------------------------------------------------------------------------------------- osmnx

def test_configure_identifies_us_declares_the_limits_and_caches_by_day(tmp_path):
    ox = SimpleNamespace(settings=SimpleNamespace())
    op.configure(ox, tmp_path, 60, 256, today=lambda: date(2026, 10, 20))
    assert ox.settings.http_user_agent == op.USER_AGENT and ox.settings.http_referer == op.USER_AGENT
    assert ox.settings.requests_timeout == 60 and ox.settings.overpass_memory == 256 * 1024 * 1024
    assert ox.settings.use_cache is True and ox.settings.cache_folder == str(tmp_path / '2026-10-20')
    assert ox.settings.log_file is True
    op.configure(ox, tmp_path, today=lambda: date(2026, 10, 20))
    assert ox.settings.requests_timeout == 180 and ox.settings.overpass_memory is None


def test_configure_prunes_day_folders_older_than_a_week_and_nothing_else(tmp_path):
    for name in ['2026-10-20', '2026-10-13', '2026-10-12', '2025-01-01']:
        (tmp_path / name).mkdir()
        (tmp_path / name / 'x.json').write_text('{}')
    (tmp_path / 'abc.json').write_text('{}')
    (tmp_path / 'notes').mkdir()
    op.configure(SimpleNamespace(settings=SimpleNamespace()), tmp_path, today=lambda: date(2026, 10, 20))
    assert sorted(p.name for p in tmp_path.iterdir()) == ['2026-10-13', '2026-10-20', 'abc.json', 'notes']
    op.prune_cache(tmp_path / 'missing', date(2026, 10, 20))


def test_remark_watch_reads_the_servers_remark_and_passes_osmnx_warnings_on(caplog):
    ox = SimpleNamespace(settings=SimpleNamespace(log_name='OSMnx-test'))
    osmnx_logger = logging.getLogger('OSMnx-test')
    osmnx_logger.addHandler(logging.NullHandler())  # Someone else's handler is left alone and looked past.
    watch = op.remark_watch(ox)
    assert op.remark_watch(ox) is watch and ox.settings.log_file is True
    assert osmnx_logger.propagate is False and osmnx_logger.handlers[-1] is watch and len(osmnx_logger.handlers) == 2
    with caplog.at_level(logging.WARNING, logger='overpass'):
        osmnx_logger.info('Pausing 0 seconds')
        osmnx_logger.warning("'overpass-api.de' responded 429 Too Many Requests: we'll retry in 55 secs")
        assert not watch.cut_short
        osmnx_logger.warning("'overpass-api.de' remarked: 'runtime error: Query timed out in \"query\" at line 1'")
    assert watch.cut_short and watch.remark.startswith('runtime error: Query timed out')
    assert 'osmnx: \'overpass-api.de\' responded 429' in caplog.text and 'Pausing' not in caplog.text
    watch.clear()
    assert watch.remark is None and not watch.cut_short


# ------------------------------------------------------------------------------------------------- fetch_each

def test_fetch_each_pauses_only_after_a_request_the_server_served():
    clock = FakeClock()

    def fetch_one(polygon):
        if polygon != 'cached':
            clock.now += 3
        return polygon.upper()
    results = op.fetch_each(['a', 'cached', 'b', 'c'], fetch_one, pause_s=7, sleep=clock.sleep, clock=clock)
    assert results == ['A', 'CACHED', 'B', 'C']
    assert clock.sleeps == [7, 7]  # After a and b; not after the cache hit, not after the last.


def test_fetch_each_retries_each_request_and_names_it(caplog):
    clock = FakeClock()
    attempts = {'b': 0}

    def fetch_one(polygon):
        if polygon == 'b' and attempts['b'] == 0:
            attempts['b'] += 1
            raise requests.ConnectionError('refused')
        return polygon
    with caplog.at_level(logging.WARNING):
        results = op.fetch_each(['a', 'b'], fetch_one, pause_s=5, sleep=clock.sleep, clock=clock, rng=no_jitter)
    assert results == ['a', 'b']
    assert clock.sleeps == [30]
    assert 'request 2/2: ConnectionError: refused' in caplog.text
    down = failing([requests.ConnectionError('down')] * 9)
    with pytest.raises(op.OverpassUnavailable, match='request 1/1'):
        op.fetch_each(['x'], lambda polygon: down(), sleep=clock.sleep, clock=clock, rng=no_jitter)
