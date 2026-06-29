"""
Finds streets that lack street-view imagery (Google Street View or Mapillary) and writes them to a CSV.

This is a standalone, manually-run utility (it is not invoked by the app). Workflow:

  1. Export a CSV of the ``street_edge`` table with columns ``street_edge_id, region_id, x1, y1, x2, y2, geom`` (geom as
     WKB hex), named ``street_edge_endpoints.csv``, in the repo root.
  2. From the repo root, run one of:

         python3 scripts/check_streets_for_imagery.py --gsv
         python3 scripts/check_streets_for_imagery.py --mapillary

     ``--gsv`` needs ``GOOGLE_MAPS_API_KEY``; ``--mapillary`` needs ``MAPILLARY_ACCESS_TOKEN``.
  3. It writes streets without imagery to ``db/streets_with_no_imagery.csv``, and a per-street imagery summary
     (presence + capture-date range) to ``db/street_imagery_summary.csv``.
  4. Run ``make hide-streets-without-imagery`` to mark those streets in the database.

For each street it first checks both endpoints; if neither has imagery the street is flagged immediately. Otherwise it
walks points along the street (added roughly every 15 m) and flags the street once enough points lack imagery (see
``imagery_verdict`` for the exact thresholds).

Imagery age: the GSV responses we already fetch also carry a capture ``date``, so for no extra API calls we record each
street's imagery capture-date range (oldest/newest) into the summary file — telling us not just whether a street has
imagery but how old it is. (Mapillary capture dates are a future enhancement; GSV only for now.)

Resilience (so a long scan survives a flaky network): each request is retried with exponential backoff; a street that
still fails is logged and the scan continues rather than aborting, and the failed set is retried once at the end (any
still-failing streets land in ``db/failed_streets.csv``). Progress is checkpointed per street to
``db/streets_imagery_checkpoint.csv``, so a re-run resumes where it left off and re-attempts only failed/unprocessed
streets. The final ``db/streets_with_no_imagery.csv`` is derived from the checkpoint, so its schema is unchanged.

The pure functions (``create_bounding_box``, ``redistribute_vertices``, ``gsv_has_imagery``, ``mapillary_has_imagery``,
``standardize_capture_date``, ``gsv_capture_date``, ``imagery_verdict``, ``street_has_no_imagery``, ``summarize_dates``)
are import-safe and unit-tested in ``test/python/test_check_streets_for_imagery.py``; network and file I/O live in thin
wrappers and ``main``.

The paths above are resolved relative to the current working directory, so always run from the repo root.

Design lineage
--------------
The resilience and concurrency here are adapted from Jon Froehlich's GSV Tracker (https://github.com/jonfroehlich/
gsv-tracker) — specifically its retry-with-backoff, fail-soft "log-and-continue", resumable progress, and rate-aware
concurrent fetching. We deliberately differ from it in three ways, because the two tools answer different questions:

  * Sampling: GSV Tracker samples a uniform geographic *grid* (it measures area-wide coverage and temporal patterns).
    We instead follow each street's geometry with early-exit, because our question is per-street ("does this
    ``street_edge`` have usable imagery?"). Street-following is more targeted and makes far fewer API calls than gridding
    a whole city, and it attributes results directly to a ``street_edge`` instead of needing a spatial join.
  * Concurrency: GSV Tracker uses asyncio/aiohttp tuned for maximum throughput (toward Google's ~500 req/s ceiling). We
    use a small thread pool plus a conservative token-bucket QPS cap, deliberately staying well under the limit; at that
    bounded concurrency, threads are simpler and sufficient, and async's scale advantage would be wasted.
  * Providers: we support GSV *and* Mapillary (Project Sidewalk uses both); GSV Tracker is GSV-only.
"""

import argparse
import csv
import logging
import os
import sys
import threading
import time
from collections import namedtuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import pandas as pd
import requests
import tenacity
from geopy import Point
from geopy.distance import geodesic
from shapely import wkb
from shapely.geometry import LineString

logger = logging.getLogger(__name__)

# Final output of streets found to be missing imagery (consumed by `make hide-streets-without-imagery`).
OUTPUT_FILE = 'db/streets_with_no_imagery.csv'
# Per-street imagery summary (presence + capture-date range) for every settled street.
SUMMARY_FILE = 'db/street_imagery_summary.csv'
# Per-street progress log; enables crash-safe resume and is the source the other outputs are derived from.
CHECKPOINT_FILE = 'db/streets_imagery_checkpoint.csv'
# Streets that still errored after the end-of-run retry, for follow-up.
FAILED_FILE = 'db/failed_streets.csv'

# Seconds before a single request to Google/Mapillary is abandoned (each attempt; retries are layered on top).
REQUEST_TIMEOUT = 30
# Max attempts per request before a street is marked failed.
MAX_ATTEMPTS = 3

# Concurrency defaults. Streets are checked in parallel, but a global QPS cap keeps total request rate well under the
# provider limit (Google allows ~500 req/s; the metadata endpoint is rate-limited but free). Deliberately conservative.
DEFAULT_WORKERS = 8
DEFAULT_MAX_QPS = 10.0

# Spacing between interpolated vertices along a street, in lat/lng degrees (~15 m). Accuracy here is not critical.
DISTANCE = 0.000135

# Bounding-box half-extents (km) for Mapillary queries: 25 m at endpoints, 15 m at along-street points (a smaller
# radius along the street avoids picking up imagery from a nearby parallel street). GSV bakes these into the URL.
ENDPOINT_RADIUS_KM = 0.025
POINT_RADIUS_KM = 0.015

# A street is flagged as missing imagery once the fraction of checked points without imagery reaches FAIL_FRACTION, or
# reaches FAIL_FRACTION_WITH_ENDPOINT when at least one endpoint already lacked imagery. Conversely the check stops
# early (street has imagery) once SUCCESS_FRACTION of points have imagery, or SUCCESS_FRACTION_WITH_ENDPOINT when both
# endpoints had imagery. The asymmetric thresholds make us stricter when an endpoint is already missing imagery.
FAIL_FRACTION = 0.5
FAIL_FRACTION_WITH_ENDPOINT = 0.25
SUCCESS_FRACTION = 0.75
SUCCESS_FRACTION_WITH_ENDPOINT = 0.5

# Per-point imagery verdicts returned by imagery_verdict.
NO_IMAGERY = 'no_imagery'
HAS_IMAGERY = 'has_imagery'
# Additional per-street outcome when a street could not be checked (all retries exhausted).
FAILED = 'failed'

# Date formats Google returns in the GSV metadata ``date`` field, most-specific first.
CAPTURE_DATE_FORMATS = ('%Y-%m-%d', '%Y-%m', '%Y')

CHECKPOINT_COLUMNS = ['street_edge_id', 'region_id', 'outcome', 'oldest_capture', 'newest_capture', 'n_panos']
# Columns of the per-street imagery summary output.
SUMMARY_COLUMNS = ['street_edge_id', 'region_id', 'has_imagery', 'oldest_capture', 'newest_capture', 'n_panos']

# Outcome of checking one street: its ids, the outcome (NO_IMAGERY / HAS_IMAGERY / FAILED), and the imagery capture-date
# range observed (oldest/newest ISO dates and the number of dated panos seen; empty/0 when no dated imagery was found).
StreetResult = namedtuple('StreetResult', CHECKPOINT_COLUMNS)

# Imagery seen at one queried location: whether imagery is present and its (standardized) capture date, if any.
PanoInfo = namedtuple('PanoInfo', ['has_imagery', 'capture_date'])


class ImageryApiError(Exception):
    """Raised when an imagery provider returns an unexpected error response that should abort checking a street."""


class RateLimiter:
    """
    A thread-safe token-bucket rate limiter shared across worker threads.

    ``acquire()`` blocks until a token is available, capping the global request rate at ``max_per_second`` (allowing
    short bursts up to ``capacity``). Bounding the *rate* — rather than just the worker count — keeps us safely under
    the provider's limit even if responses come back fast. The clock and sleep are injectable for deterministic tests.
    """

    def __init__(self, max_per_second, capacity=None, monotonic=time.monotonic, sleep=time.sleep):
        self._rate = max_per_second
        self._capacity = capacity if capacity is not None else max_per_second
        self._tokens = self._capacity
        self._updated = monotonic()
        self._monotonic = monotonic
        self._sleep = sleep
        self._lock = threading.Lock()

    def acquire(self):
        """Block until a token is available, then consume it."""
        while True:
            with self._lock:
                now = self._monotonic()
                self._tokens = min(self._capacity, self._tokens + (now - self._updated) * self._rate)
                self._updated = now
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                wait = (1 - self._tokens) / self._rate
            self._sleep(wait)  # Sleep outside the lock so other threads can refill/observe progress.


def redistribute_vertices(geom, distance=DISTANCE):
    """
    Returns a copy of a LineString with extra vertices interpolated along it.

    Vertices are spaced roughly ``distance`` apart (in lat/lng degrees), so a long street is sampled at many points.
    Adapted from https://stackoverflow.com/questions/34906124/interpolating-every-x-distance-along-multiline-in-shapely.

    Args:
        geom:     A shapely ``LineString``.
        distance: Target spacing between vertices, in lat/lng degrees.

    Returns:
        A new ``LineString`` with at least two vertices.
    """
    num_vert = int(round(geom.length / distance))
    if num_vert == 0:
        num_vert = 1
    return LineString([geom.interpolate(float(n) / num_vert, normalized=True) for n in range(num_vert + 1)])


def create_bounding_box(lat, lng, radius_km):
    """
    Builds an axis-aligned bounding box around a point.

    Args:
        lat:       Latitude of the center point.
        lng:       Longitude of the center point.
        radius_km: Half-extent of the box, in **kilometers** (e.g. ``0.025`` is 25 m, ``25`` is 25 km).

    Returns:
        A ``(west, south, east, north)`` tuple of longitudes/latitudes.
    """
    center = Point(lat, lng)
    west = geodesic(kilometers=radius_km).destination(center, bearing=270).longitude
    south = geodesic(kilometers=radius_km).destination(center, bearing=180).latitude
    east = geodesic(kilometers=radius_km).destination(center, bearing=90).longitude
    north = geodesic(kilometers=radius_km).destination(center, bearing=0).latitude
    return (west, south, east, north)


def gsv_has_imagery(response_json):
    """
    Interprets a Google Street View metadata response.

    Args:
        response_json: The decoded JSON from the GSV metadata endpoint.

    Returns:
        ``True`` if imagery is present, ``False`` if the response status is ``ZERO_RESULTS``.
    """
    status = pd.json_normalize(response_json).status[0]
    return status != 'ZERO_RESULTS'


def standardize_capture_date(raw):
    """
    Normalizes a GSV capture date to an ISO ``YYYY-MM-DD`` string.

    Google returns the ``date`` field in varying precision (``2019``, ``2019-06``, or ``2019-06-15``); we standardize
    so callers get one comparable format (a year-only value becomes January 1st, a year-month becomes the 1st).

    Args:
        raw: The raw ``date`` value (string, or ``None``/NaN).

    Returns:
        An ISO ``YYYY-MM-DD`` string, or ``None`` if absent/unparseable.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    for fmt in CAPTURE_DATE_FORMATS:
        try:
            return datetime.strptime(str(raw), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def gsv_capture_date(response_json):
    """
    Extracts the standardized imagery capture date from a GSV metadata response.

    Args:
        response_json: The decoded JSON from the GSV metadata endpoint.

    Returns:
        An ISO ``YYYY-MM-DD`` string, or ``None`` if the response carries no usable ``date``.
    """
    results = pd.json_normalize(response_json)
    if 'date' not in results.columns:
        return None
    return standardize_capture_date(results['date'][0])


def mapillary_has_imagery(response_json):
    """
    Interprets a Mapillary images response.

    An empty ``data`` array means no imagery. Error code 100 means "too many images, request a smaller area" — which
    actually implies plenty of imagery, so it counts as present. Any other error is unexpected and aborts the street.

    Args:
        response_json: The decoded JSON from the Mapillary images endpoint.

    Returns:
        ``True`` if imagery is present, ``False`` if ``data`` is empty.

    Raises:
        ImageryApiError: If the response carries an error code other than 100.
    """
    results = pd.json_normalize(response_json)
    if 'error.code' in results.columns and results['error.code'][0] != 100:
        raise ImageryApiError(
            'new error type (code ' + str(results['error.code'][0]) + '): ' + results['error.message'][0])
    no_imagery = 'data' in results.columns and results.data[0] == []
    return not no_imagery


def imagery_verdict(n_fail, n_success, n_coords, endpoint_failed):
    """
    Decides, from running point counts, whether the street's imagery status is settled yet.

    Args:
        n_fail:          Number of checked points so far without imagery.
        n_success:       Number of checked points so far with imagery.
        n_coords:        Total number of points along the street.
        endpoint_failed: Whether at least one street endpoint lacked imagery.

    Returns:
        ``NO_IMAGERY`` or ``HAS_IMAGERY`` once the thresholds settle it, otherwise ``None`` (keep checking).
    """
    if n_fail >= FAIL_FRACTION * n_coords or (n_fail >= FAIL_FRACTION_WITH_ENDPOINT * n_coords and endpoint_failed):
        return NO_IMAGERY
    if n_success > SUCCESS_FRACTION * n_coords or (n_success > SUCCESS_FRACTION_WITH_ENDPOINT * n_coords
                                                   and not endpoint_failed):
        return HAS_IMAGERY
    return None


def street_has_no_imagery(first_endpoint_fail, second_endpoint_fail, point_has_imagery, n_coords=None):
    """
    Decides whether a street should be flagged as missing imagery.

    Returns ``True`` immediately if both endpoints lack imagery; otherwise walks the per-point results applying
    ``imagery_verdict`` and returns the settled verdict (defaulting to "has imagery" if never settled). ``point_has_
    imagery`` may be a lazy iterable (e.g. a generator that fetches each point on demand) so the walk stops fetching as
    soon as the verdict settles; pass ``n_coords`` in that case since the length can't be taken up front.

    Args:
        first_endpoint_fail:  Whether the first endpoint lacked imagery.
        second_endpoint_fail: Whether the second endpoint lacked imagery.
        point_has_imagery:    Ordered booleans, one per along-street point (``True`` = imagery present).
        n_coords:             Total number of points; if ``None``, ``point_has_imagery`` is materialized to count it.

    Returns:
        ``True`` if the street should be flagged as missing imagery, else ``False``.
    """
    if first_endpoint_fail and second_endpoint_fail:
        return True

    endpoint_failed = first_endpoint_fail or second_endpoint_fail
    if n_coords is None:
        point_has_imagery = list(point_has_imagery)
        n_coords = len(point_has_imagery)

    n_fail = n_success = 0
    for has_imagery in point_has_imagery:
        if has_imagery:
            n_success += 1
        else:
            n_fail += 1
        verdict = imagery_verdict(n_fail, n_success, n_coords, endpoint_failed)
        if verdict == NO_IMAGERY:
            return True
        if verdict == HAS_IMAGERY:
            return False
    return False


def _get_json(url):
    """GETs a URL and returns the decoded JSON (with a bounded per-attempt timeout)."""
    return requests.get(url, timeout=REQUEST_TIMEOUT).json()


def make_fetch(max_attempts=MAX_ATTEMPTS, sleep=None, rate_limiter=None):
    """
    Builds a ``fetch(url) -> json`` that retries transient network errors with exponential backoff + jitter.

    The retry/backoff approach is adapted from GSV Tracker (see the module "Design lineage" note).

    Args:
        max_attempts: Attempts before giving up (then the underlying ``requests`` error is re-raised).
        sleep:        Sleep function between retries; defaults to ``time.sleep`` (injectable so tests run instantly).
        rate_limiter: Optional ``RateLimiter``; if given, a token is acquired before every request (including retries).

    Returns:
        A ``fetch`` callable.
    """
    retryer = tenacity.Retrying(
        stop=tenacity.stop_after_attempt(max_attempts),
        wait=tenacity.wait_random_exponential(multiplier=0.5, max=10),
        retry=tenacity.retry_if_exception_type(requests.exceptions.RequestException),
        sleep=sleep if sleep is not None else time.sleep,
        reraise=True,
    )

    def attempt(url):
        if rate_limiter is not None:
            rate_limiter.acquire()
        return _get_json(url)

    return lambda url: retryer(lambda: attempt(url))


def _mapillary_bbox_url(mapillary_url, lat, lng, radius_km):
    """Appends a ``&bbox=`` query (a box of ``radius_km`` around the point) to the Mapillary base URL."""
    bbox = create_bounding_box(lat, lng, radius_km)
    return mapillary_url + '&bbox=' + ','.join(str(coord) for coord in bbox)


def _pano_info(api, response_json):
    """
    Builds a ``PanoInfo`` (imagery present? + capture date) from one provider response.

    GSV responses carry a capture date; Mapillary capture dates are not yet captured (a future enhancement), so
    Mapillary panos report ``capture_date=None``.
    """
    if api == 'GSV':
        return PanoInfo(gsv_has_imagery(response_json), gsv_capture_date(response_json))
    return PanoInfo(mapillary_has_imagery(response_json), None)


def _point_pano_info(api, lat, lng, fetch, gsv_url, mapillary_url, mapillary_radius_km):
    """Queries the configured provider at one point (via ``fetch``) and returns its ``PanoInfo``."""
    if api == 'GSV':
        return _pano_info(api, fetch(gsv_url + '&location=' + str(lat) + ',' + str(lng)))
    return _pano_info(api, fetch(_mapillary_bbox_url(mapillary_url, lat, lng, mapillary_radius_km)))


def _check_endpoints(street, api, fetch, gsv_url_endpoint, mapillary_url):
    """Checks both of a street's endpoints; returns ``(first_pano_info, second_pano_info)``."""
    if api == 'GSV':
        first = _pano_info(api, fetch(gsv_url_endpoint + '&location=' + str(street.y1) + ',' + str(street.x1)))
        second = _pano_info(api, fetch(gsv_url_endpoint + '&location=' + str(street.y2) + ',' + str(street.x2)))
    else:
        first = _pano_info(api, fetch(_mapillary_bbox_url(mapillary_url, street.y1, street.x1, ENDPOINT_RADIUS_KM)))
        second = _pano_info(api, fetch(_mapillary_bbox_url(mapillary_url, street.y2, street.x2, ENDPOINT_RADIUS_KM)))
    return first, second


def summarize_dates(dates):
    """
    Summarizes a street's observed imagery capture dates.

    Args:
        dates: ISO ``YYYY-MM-DD`` date strings (lexicographic order equals chronological order).

    Returns:
        ``(oldest, newest, n_panos)`` — oldest/newest ISO dates and the count, or ``(None, None, 0)`` if empty.
    """
    if not dates:
        return None, None, 0
    return min(dates), max(dates), len(dates)


def process_street(street, api, fetch, gsv_url, gsv_url_endpoint, mapillary_url):
    """
    Checks one street for imagery and returns its outcome (pure of any file/checkpoint I/O, so it is pool-safe).

    Walks the endpoints, then along-street points with early-exit (points are fetched lazily, so a settled verdict
    stops further requests). Any network/parse error after retries is caught and reported as ``FAILED`` so the overall
    scan can continue.

    Args:
        street:           A street row (Series) with ``street_edge_id``, ``region_id``, endpoint x/y, and ``geom``.
        api:              ``'GSV'`` or ``'Mapillary'``.
        fetch:            A ``fetch(url) -> json`` (typically from ``make_fetch``, with retry).
        gsv_url:          GSV metadata base URL with the along-street radius baked in (GSV only).
        gsv_url_endpoint: GSV metadata base URL with the endpoint radius baked in (GSV only).
        mapillary_url:    Mapillary images base URL (Mapillary only).

    Returns:
        A ``StreetResult`` with outcome ``NO_IMAGERY`` / ``HAS_IMAGERY`` / ``FAILED`` and, for settled streets, the
        observed imagery capture-date range. The capture dates come from the responses we already fetch, so the
        early-exit point sampling means no extra API calls are made.
    """
    try:
        first, second = _check_endpoints(street, api, fetch, gsv_url_endpoint, mapillary_url)
        coords = list(street['geom'].coords)
        dates = [d for d in (first.capture_date, second.capture_date) if d]

        # Yield the per-point has_imagery booleans to the (unchanged) decision function, recording each point's capture
        # date as a side effect. Because street_has_no_imagery consumes this lazily and stops at the verdict, we only
        # fetch — and only collect dates for — the points actually visited.
        def has_imagery_stream():
            # `no branch`: street_has_no_imagery settles and stops consuming before this loop is exhausted (for any
            # real street, which has >= 2 points), so the generator is abandoned rather than run to completion.
            for coord in coords:  # pragma: no branch  -- Shapely coords are (x=lng, y=lat).
                info = _point_pano_info(api, coord[1], coord[0], fetch, gsv_url, mapillary_url, POINT_RADIUS_KM)
                if info.capture_date:
                    dates.append(info.capture_date)
                yield info.has_imagery

        no_imagery = street_has_no_imagery(not first.has_imagery, not second.has_imagery,
                                           has_imagery_stream(), n_coords=len(coords))
        outcome = NO_IMAGERY if no_imagery else HAS_IMAGERY
        oldest, newest, n_panos = summarize_dates(dates)
    except (requests.exceptions.RequestException, ImageryApiError) as err:
        logger.warning("Could not check street %s after %d attempts: %s", street.street_edge_id, MAX_ATTEMPTS, err)
        outcome, oldest, newest, n_panos = FAILED, None, None, 0
    return StreetResult(int(street.street_edge_id), int(street.region_id), outcome, oldest, newest, n_panos)


def load_processed(checkpoint_file=CHECKPOINT_FILE):
    """Returns the set of ``street_edge_id`` already settled (failed streets are excluded so they get re-attempted)."""
    if not os.path.isfile(checkpoint_file):
        return set()
    checkpoint = pd.read_csv(checkpoint_file)
    return set(checkpoint[checkpoint['outcome'] != FAILED]['street_edge_id'])


def append_checkpoint(result, checkpoint_file=CHECKPOINT_FILE):
    """Appends one street's result to the checkpoint (writing the header on first use)."""
    write_header = not os.path.isfile(checkpoint_file)
    with open(checkpoint_file, 'a', newline='') as handle:
        writer = csv.writer(handle)
        if write_header:
            writer.writerow(CHECKPOINT_COLUMNS)
        writer.writerow(list(result))


def _write_ids_csv(rows, output_file):
    """Writes a ``(street_edge_id, region_id)`` frame as CSV with integer ids."""
    df = pd.DataFrame(rows, columns=['street_edge_id', 'region_id'])
    df['street_edge_id'] = df['street_edge_id'].astype('int32')
    df['region_id'] = df['region_id'].astype('int32')
    df.to_csv(output_file, index=False)


def _write_summary_csv(settled, summary_file):
    """Writes the per-street imagery summary (presence + capture-date range) for the settled streets."""
    summary = pd.DataFrame(settled, columns=CHECKPOINT_COLUMNS).copy()
    summary['has_imagery'] = summary['outcome'] == HAS_IMAGERY
    summary['street_edge_id'] = summary['street_edge_id'].astype('int32')
    summary['region_id'] = summary['region_id'].astype('int32')
    summary['n_panos'] = summary['n_panos'].fillna(0).astype('int32')
    summary[SUMMARY_COLUMNS].to_csv(summary_file, index=False)


def finalize_outputs(checkpoint_file=CHECKPOINT_FILE, output_file=OUTPUT_FILE, failed_file=FAILED_FILE,
                     summary_file=SUMMARY_FILE):
    """
    Derives the final output files from the checkpoint.

    Writes ``output_file`` (streets with no imagery), ``summary_file`` (every settled street with its imagery
    presence + capture-date range), and, if any remain, ``failed_file`` (streets that errored out). The latest outcome
    per street wins, so a street that failed then succeeded on retry is counted as succeeded.
    """
    if os.path.isfile(checkpoint_file):
        checkpoint = pd.read_csv(checkpoint_file).drop_duplicates('street_edge_id', keep='last')
    else:
        # Interrupted before any street completed: still emit (empty) output files.
        checkpoint = pd.DataFrame(columns=CHECKPOINT_COLUMNS)
    _write_ids_csv(checkpoint[checkpoint['outcome'] == NO_IMAGERY], output_file)
    _write_summary_csv(checkpoint[checkpoint['outcome'] != FAILED], summary_file)
    failed = checkpoint[checkpoint['outcome'] == FAILED]
    if not failed.empty:
        _write_ids_csv(failed, failed_file)


def _print_progress(position, total):
    """Prints an in-place progress percentage."""
    sys.stdout.write("\r%.2f%% complete" % (100 * position / total))
    sys.stdout.flush()


def main(argv=None):
    """
    Parses arguments and scans every street for imagery, writing those without it to ``OUTPUT_FILE``.

    Args:
        argv: Optional argument list (defaults to ``sys.argv``); accepted to make the entrypoint testable.

    Returns:
        Process exit code: 0 on success, 1 on a missing API key or a user interrupt.
    """
    parser = argparse.ArgumentParser(
        description='Loops through streets, outputting any without imagery to a separate file.')
    parser.add_argument('--gsv', action='store_true', help='Include if checking for GSV imagery')
    parser.add_argument('--mapillary', action='store_true', help='Include if checking for Mapillary imagery')
    parser.add_argument('--workers', type=int, default=DEFAULT_WORKERS,
                        help='Number of streets to check concurrently (default: %(default)s).')
    parser.add_argument('--max-qps', type=float, default=DEFAULT_MAX_QPS,
                        help='Global cap on requests per second across all workers (default: %(default)s).')
    args = parser.parse_args(argv)
    if not (args.gsv or args.mapillary):
        parser.error('At least one of --gsv or --mapillary is required')
    if args.gsv and args.mapillary:
        parser.error('Please specify only one of --gsv or --mapillary')
    api = 'GSV' if args.gsv else 'Mapillary'

    api_key = os.getenv('GOOGLE_MAPS_API_KEY') if api == 'GSV' else os.getenv('MAPILLARY_ACCESS_TOKEN')
    if api_key is None:
        print("Couldn't read API key environment variable.")
        return 1

    # Read street edge data and interpolate vertices roughly every 15 m so we can sample imagery along each street.
    street_data = pd.read_csv('street_edge_endpoints.csv')
    street_data = street_data.sort_values(by=['region_id', 'street_edge_id'])
    street_data['geom'] = list(map(lambda g: redistribute_vertices(wkb.loads(g, hex=True)), list(street_data['geom'])))

    # GSV bakes the search radius into the URL (25 m at endpoints, 15 m along the street); Mapillary uses a bbox.
    gsv_base_url = 'https://maps.googleapis.com/maps/api/streetview/metadata?source=outdoor&key=' + api_key
    gsv_url = gsv_base_url + '&radius=15'
    gsv_url_endpoint = gsv_base_url + '&radius=25'
    mapillary_url = 'https://graph.mapillary.com/images?is_pano=true&access_token=' + api_key
    # One shared rate limiter caps total request rate across all worker threads.
    fetch = make_fetch(rate_limiter=RateLimiter(args.max_qps))
    checkpoint_lock = threading.Lock()

    def check_and_record(street):
        result = process_street(street, api, fetch, gsv_url, gsv_url_endpoint, mapillary_url)
        with checkpoint_lock:  # process_street does no file I/O; only the checkpoint append needs serializing.
            append_checkpoint(result)
        return result

    # Resume: skip streets already settled in the checkpoint; failed/unprocessed streets are (re)checked.
    processed = load_processed()
    todo = street_data[~street_data['street_edge_id'].isin(processed)]
    total = len(todo)

    try:
        # Threads (not asyncio) with a global QPS cap: a deliberately conservative take on GSV Tracker's concurrent
        # fetching (see the module "Design lineage" note). Parallelize across streets; each worker keeps the sequential
        # endpoint->points early-exit internally.
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(check_and_record, street): street for _, street in todo.iterrows()}
            failed_streets = []
            for position, future in enumerate(as_completed(futures), start=1):
                if future.result().outcome == FAILED:
                    failed_streets.append(futures[future])
                _print_progress(position, total)

            # Retry the streets that errored once more, since such failures are usually transient.
            for future in as_completed({executor.submit(check_and_record, s): s for s in failed_streets}):
                future.result()
    except KeyboardInterrupt:
        print("\nInterrupted; progress saved to the checkpoint. Re-run to resume.")
        finalize_outputs()
        return 1

    print()  # Finish the in-place progress line.
    finalize_outputs()
    return 0


if __name__ == '__main__':
    sys.exit(main())
