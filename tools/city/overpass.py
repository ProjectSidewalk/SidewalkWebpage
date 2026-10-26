"""
How the city tools talk to the public Overpass server (overpass-api.de) without getting our network blocked (#5741).

Overpass is a shared, volunteer-run service. It admits a query only while it has the server time and memory the query
declares, and it blocks the address of a client that keeps sending after being refused, for hours; behind our NAT that
is the whole network, and it has happened to us (#5741). So, as streetscape-tracker settled on after its own block:

- say who we are (the app's User-Agent; a bare Python client is answered with a 406);
- ask for small areas with small declared limits, so a query gets in while the server is busy;
- keep osmnx's cache by day, so a rerun after a failure fetches only what it has not got today;
- after any refusal wait 30 s, then 60, 120, 240 (jitter only adds), and give up after about ten minutes. A refused
  connection is waited out like a 502, since only its length tells a flap from a block, and nothing fails over to a
  mirror, which has its own usage policy;
- pause between requests, and never run two Overpass clients from one network at once (the fleet driver checks).

``python3.13 tools/city/overpass.py --check`` asks the server one tiny question and exits 0 when it answers, 75 when it
does not; the fleet driver runs it before starting. Everything else is imported. Stdlib and ``requests`` only, so it
runs under both interpreters (``.claude/rules/python-scripts.md``).

Every entry point takes the instance's base URL, since the main one has days when it admits nothing and the other
public instances are run by other people, with their own usage policy and their own copy of the data (minutes behind
OSM on a healthy one, months on a neglected one). Pick one on purpose, after reading its policy, never by failing over
on a refusal: a client that has been refused should not move its traffic.
"""
import argparse
import logging
import random
import re
import shutil
import signal
import sys
import threading
import time
from dataclasses import dataclass
from datetime import date, timedelta

import requests

logger = logging.getLogger('overpass')

# app/service/OutboundHttp.scala's string: the usage policy wants a contact, and a bare python-requests UA gets a 406.
USER_AGENT = 'ProjectSidewalk/1.0 (+https://projectsidewalk.org; sidewalk@cs.uw.edu)'
OVERPASS_URL = 'https://overpass-api.de/api'   # The base, as osmnx takes it; /interpreter is appended.
# The smallest question the interpreter answers. Not /status: it has answered while /interpreter refused the same IP.
PROBE_QUERY = '[out:json][timeout:5][maxsize:1048576];node(1);out ids;'
# Generous: a busy mirror has taken over ten seconds to answer even this, and a late answer is not a block.
PROBE_TIMEOUT_S = 60
# The usage policy's pause after a 429/406; retrying sooner is what gets an IP blocked, so no policy may go under it.
MIN_RETRY_WAIT_S = 30.0
# EX_TEMPFAIL: the driver stops the whole run on it; more queries to a refusing server turn a throttle into a block.
EXIT_UNAVAILABLE = 75
CACHE_KEEP_DAYS = 7
# How much longer than the declared server time the client waits for the answer. osmnx uses one number for both,
# so the client would hang up just as the server stopped, and the server's "timed out" remark would never arrive.
CLIENT_SLACK_S = 30
# Only transport faults and these answers mean "ask again later"; anything else is a bug to see, not to wait on.
RETRYABLE_STATUS = re.compile(r'responded: (406|429|502|503|504)\b')


class OverpassUnavailable(Exception):
    """Overpass kept refusing for the whole retry window; the caller should stop, not move on."""


class Refused(Exception):
    """A settled refusal the retry treats like a transport fault (the probe not answering, an attempt timing out)."""


@dataclass(frozen=True)
class RetryPolicy:
    """
    How long to keep asking after a refusal: the wait doubles from ``initial_wait_s`` up to ``max_wait_s``, times
    ``1 + jitter * u`` for a random ``u`` in [0, 1), so it never goes under the floor. No attempt starts if its wait
    would end more than ``window_s`` after the first one began. An attempt itself is unbounded here; a fetcher that
    knows one call is one request wraps it in :func:`with_deadline`.
    """
    initial_wait_s: float = 30.0
    max_wait_s: float = 240.0
    jitter: float = 0.25
    window_s: float = 600.0

    def __post_init__(self):
        if self.initial_wait_s < MIN_RETRY_WAIT_S:
            raise ValueError(f'initial_wait_s must be at least {MIN_RETRY_WAIT_S:.0f} s (Overpass usage policy)')
        if self.max_wait_s < self.initial_wait_s or self.jitter < 0 or self.window_s <= 0:
            raise ValueError('max_wait_s >= initial_wait_s, jitter >= 0, window_s > 0')

    def wait_after(self, failures, u):
        """The wait after the ``failures``-th failure in a row, with ``u`` in [0, 1) as the jitter draw."""
        return min(self.max_wait_s, self.initial_wait_s * 2 ** (failures - 1)) * (1 + self.jitter * u)


def is_retryable(exc):
    """Whether ``exc`` is Overpass saying "not now": a transport fault, a refusal status, or one of ours."""
    if isinstance(exc, (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError, Refused)):
        return True
    return type(exc).__name__ == 'ResponseStatusCodeError' and bool(RETRYABLE_STATUS.search(str(exc)))


def with_deadline(attempt, seconds):
    """
    Runs ``attempt()``, raising :class:`Refused` if it has not returned after ``seconds``.

    This bounds osmnx's own retry of a 429 or 504 (a fixed 55 s sleep and a resend, with no limit), so a server that
    throttles for an hour costs the retry window, not the night. Only for a call that is one Overpass request (osmnx
    cuts a polygon over 2,500 km² into several, and a street graph fetch is many). ``seconds`` None runs it unbounded,
    as does any thread but the main one, since this uses SIGALRM.
    """
    if seconds is None or threading.current_thread() is not threading.main_thread():
        return attempt()

    def cut_off(signum, frame):
        raise Refused(f'no answer within {seconds:.0f} s')

    previous = signal.signal(signal.SIGALRM, cut_off)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        return attempt()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def call_with_retry(attempt, what, policy=RetryPolicy(), sleep=time.sleep, clock=time.monotonic, rng=random.random):
    """
    Calls ``attempt()`` until it returns, waiting out refusals on ``policy``'s schedule.

    Args:
        attempt: The call; a retryable failure (:func:`is_retryable`) is waited on, any other raised through.
        what:    Names the call in the log and the final error.
        policy:  The schedule.
        sleep, clock, rng: ``time.sleep``, ``time.monotonic`` and ``random.random`` unless a test fakes them.

    Returns:
        What ``attempt`` returned.

    Raises:
        OverpassUnavailable: when the window closes without an answer; the last failure is its cause.
    """
    started = clock()
    failures = 0
    while True:
        try:
            return attempt()
        except Exception as exc:
            if not is_retryable(exc):
                raise
            failures += 1
            wait = policy.wait_after(failures, rng())
            elapsed = clock() - started
            if elapsed + wait > policy.window_s:
                raise OverpassUnavailable(f'{what}: Overpass still not answering after {failures} attempt(s) over '
                                          f'{elapsed:.0f} s ({summary(exc)}); stop and resume later, do not keep '
                                          f'sending') from exc
            logger.warning('%s: %s; waiting %.0f s before attempt %d', what, summary(exc), wait, failures + 1)
            sleep(wait)


def summary(exc):
    """One line naming a failure: its type and the start of its message (an Overpass error page runs to pages)."""
    text = ' '.join(str(exc).split())
    return f'{type(exc).__name__}: {text[:160]}' if text else type(exc).__name__


def probe(post=requests.post, url=OVERPASS_URL):
    """
    Asks the interpreter a tiny query once, with no retry, so a check costs nothing.

    Returns:
        ``(answered, data_timestamp)``: whether it answered, and how current its copy of OSM is (the reply's
        ``timestamp_osm_base``; None when it did not answer or did not say), which is what a mirror is judged on.
    """
    try:
        response = post(f'{url.rstrip("/")}/interpreter', data={'data': PROBE_QUERY}, timeout=PROBE_TIMEOUT_S,
                        headers={'User-Agent': USER_AGENT})
    except (requests.ConnectionError, requests.Timeout) as exc:
        logger.info('Overpass probe failed: %s', summary(exc))
        return False, None
    if not response.ok:
        logger.info('Overpass probe answered %s %s', response.status_code, response.reason)
        return False, None
    try:
        return True, response.json().get('osm3s', {}).get('timestamp_osm_base')
    except ValueError:
        return True, None


def wait_until_answering(policy=RetryPolicy(), url=OVERPASS_URL, **retry_kwargs):
    """
    Waits for the interpreter to answer the probe, on the retry schedule, before a run sends anything heavier.

    Returns:
        How current its copy of OSM is, as :func:`probe` reports it.

    Raises:
        OverpassUnavailable: when it does not answer within the window.
    """
    def attempt():
        answered, data_timestamp = probe(url=url)
        if not answered:
            raise Refused('the probe query was not answered')
        return data_timestamp
    return call_with_retry(attempt, 'Overpass probe', policy, **retry_kwargs)


def configure(ox, cache_root, request_timeout_s=180, memory_mb=None, today=date.today, url=OVERPASS_URL):
    """
    Points osmnx at Overpass the polite way: our identity, the declared limits, and a cache that lasts a day.

    Args:
        ox:                The osmnx module.
        url:               The instance's base URL; osmnx keys its cache on the full request URL, so each instance's
                           answers are kept apart.
        cache_root:        Where osmnx's responses are kept; today's go in a ``YYYY-MM-DD`` folder under it, and
                           folders older than :data:`CACHE_KEEP_DAYS` are removed. A rerun on the same day re-reads
                           what it already fetched, and a later one sees what OSM holds then.
        request_timeout_s: The ``[timeout:]`` every query declares, and the HTTP timeout. Overpass admits a query
                           only while it has that much server time spare, so a small area should declare a small
                           number (the backfill's tiles ask for a minute); a whole city's street graph needs
                           osmnx's default.
        memory_mb:         The ``[maxsize:]`` declared, in MB; None leaves it to the server's default (512 MB).
        today:             ``date.today`` unless a test fakes it.
    """
    ox.settings.http_user_agent = USER_AGENT
    ox.settings.http_referer = USER_AGENT
    ox.settings.overpass_url = url
    # osmnx asks /status for a free slot before every query and waits a fixed 60 s when it cannot read the answer;
    # the main instance serves it, the others may not (openstreetmap.fr answers 403), and the pacing here stands in.
    ox.settings.overpass_rate_limit = url == OVERPASS_URL
    declare_limits(ox, request_timeout_s, memory_mb)
    ox.settings.use_cache = True
    ox.settings.cache_folder = str(cache_root / today().isoformat())
    prune_cache(cache_root, today())
    remark_watch(ox)


class RemarkWatch(logging.Handler):
    """
    Listens to osmnx's log for the server's remarks. A query the server cuts short, out of the time or memory it
    declared, comes back as a 200 with a ``remark`` and whatever the server had got to, and osmnx only logs that; a
    tile would quietly lose its ways with no one reading the log. osmnx's own warnings (its 55 s retry of a 429) are
    passed on to our log, so an operator sees why an attempt is slow.
    """

    def __init__(self):
        super().__init__(logging.WARNING)
        self.remark = None

    def emit(self, record):
        message = record.getMessage()
        logger.warning('osmnx: %s', message)
        if 'remarked:' in message:
            self.remark = message.split('remarked:', 1)[1].strip().strip("'")

    @property
    def cut_short(self):
        """Whether the last query was cut short by the server (a runtime error: out of time, out of memory)."""
        return self.remark is not None and 'runtime error' in self.remark

    def clear(self):
        self.remark = None


def remark_watch(ox):
    """
    The one :class:`RemarkWatch` on osmnx's logger, installed on first use.

    osmnx adds its own file handler only to a logger that has none, and only logs at all with ``log_file`` on, so
    the handler goes in first and that setting on; the logger stops propagating so the root logger does not print
    every message a second time.
    """
    ox.settings.log_file = True
    osmnx_logger = logging.getLogger(getattr(ox.settings, 'log_name', 'OSMnx'))
    for handler in osmnx_logger.handlers:
        if isinstance(handler, RemarkWatch):
            return handler
    watch = RemarkWatch()
    osmnx_logger.addHandler(watch)
    osmnx_logger.setLevel(logging.WARNING)
    osmnx_logger.propagate = False
    return watch


def declare_limits(ox, server_timeout_s, memory_mb):
    """
    Sets the ``[timeout:]`` and ``[maxsize:]`` every query declares, with the client waiting :data:`CLIENT_SLACK_S`
    longer than the server is allowed, so a query the server stops is answered (with its remark) rather than hung up on.
    """
    ox.settings.overpass_settings = f'[out:json][timeout:{server_timeout_s}]{{maxsize}}'
    ox.settings.requests_timeout = server_timeout_s + CLIENT_SLACK_S
    ox.settings.overpass_memory = None if memory_mb is None else memory_mb * 1024 * 1024


def prune_cache(cache_root, today):
    """Removes the day folders under ``cache_root`` older than :data:`CACHE_KEEP_DAYS`; anything else there stays."""
    if not cache_root.is_dir():
        return
    oldest_kept = today - timedelta(days=CACHE_KEEP_DAYS)
    for entry in cache_root.iterdir():
        is_day = entry.is_dir() and re.fullmatch(r'\d{4}-\d{2}-\d{2}', entry.name)
        if is_day and date.fromisoformat(entry.name) < oldest_kept:
            shutil.rmtree(entry)


def fetch_each(polygons, fetch_one, pause_s=7.0, policy=RetryPolicy(), sleep=time.sleep, **retry_kwargs):
    """
    Fetches every polygon in turn, each under the retry policy, pausing between requests the server actually served.

    Args:
        polygons:  The areas, in lon/lat.
        fetch_one: ``fetch_one(polygon)`` -> ``(result, served)``: the result for one area and whether the server
                   was asked for it (nothing is owed for an answer from osmnx's cache).
        pause_s:   The rest between two served requests.
        policy:    The retry schedule for each request.
        sleep, retry_kwargs: ``time.sleep`` and :func:`call_with_retry`'s fakes.

    Yields:
        Each result in turn, so a caller can fold one in before the next is fetched.

    Raises:
        OverpassUnavailable: from the first polygon whose window closes.
    """
    for i, polygon in enumerate(polygons, 1):
        result, served = call_with_retry(lambda: fetch_one(polygon), f'request {i}/{len(polygons)}', policy,
                                         sleep=sleep, **retry_kwargs)
        yield result
        if served and i < len(polygons):
            sleep(pause_s)


def main(argv=None):
    """
    ``--check``: is Overpass answering? Waits out a refusal on the retry schedule, as a run would, so a passing
    moment of 502s does not read as a block. Exit 0 once it answers, :data:`EXIT_UNAVAILABLE` when the window closes.
    """
    parser = argparse.ArgumentParser(description='Asks an Overpass instance one tiny question.')
    parser.add_argument('--check', action='store_true', required=True,
                        help='Exit 0 once the interpreter answers (waiting up to the retry window), 75 if it does not.')
    parser.add_argument('--url', default=OVERPASS_URL,
                        help=f'The instance, without /interpreter (default {OVERPASS_URL}).')
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    try:
        data_timestamp = wait_until_answering(url=args.url)
    except OverpassUnavailable:
        print(f'Overpass at {args.url} is not answering; wait before sending it anything (a block lifts on its own, '
              'after a while).')
        return EXIT_UNAVAILABLE
    print(f'Overpass is answering at {args.url}; its data is from {data_timestamp or "a time it did not state"}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
