"""
Finds streets that lack street-view imagery (Google Street View, Mapillary, or Infra3d) and writes them to a CSV.

This is a standalone, manually-run utility (it is not invoked by the app). Workflow:

  1. Export a CSV of the ``street_edge`` table with columns ``street_edge_id, region_id, x1, y1, x2, y2, geom`` (geom as
     WKB hex), named ``street_edge_endpoints.csv``, in the repo root.
  2. Run one of (from anywhere — all data files are resolved relative to the repo root, not your working directory):

         python3.13 scripts/check_streets_for_imagery.py --gsv
         python3.13 scripts/check_streets_for_imagery.py --mapillary
         python3.13 scripts/check_streets_for_imagery.py --infra3d

     ``--gsv`` needs ``GOOGLE_MAPS_API_KEY``; ``--mapillary`` needs ``MAPILLARY_ACCESS_TOKEN``; ``--infra3d`` needs
     ``INFRA3D_CLIENT_ID`` and ``INFRA3D_CLIENT_SECRET`` (one city's pair — the same OAuth client-credentials the app
     holds per city as ``INFRA3D_CLIENT_ID_<CITY>``). It is ``python3.13`` rather than the container's default
     ``python3`` because this tool's libraries need Python >= 3.11.
  3. It writes streets without imagery to ``db/streets_with_no_imagery.csv``, and a per-street imagery summary
     (presence + capture-date range) to ``db/street_imagery_summary.csv``.
  4. Run ``make hide-streets-without-imagery`` to mark those streets in the database.

For each street it first checks both endpoints; if neither has imagery the street is flagged immediately. Otherwise it
walks points along the street (added roughly every 15 m) and flags the street once enough points lack imagery (see
``imagery_verdict`` for the exact thresholds).

Imagery age: the GSV and Infra3d responses we already fetch also carry a capture date, so for no extra API calls we
record each street's imagery capture-date range (oldest/newest) into the summary file — telling us not just whether a
street has imagery but how old it is. (Mapillary capture dates are a future enhancement.)

Infra3d has no metadata endpoint of its own; the check uses the same nearest-frame query (``framegate``'s
``knn/query``) that the vendored Infra3d viewer SDK issues on every ``setLocation``, authenticated with the same
per-city OAuth token the app fetches in ``PanoDataService.getInfra3dToken``. The query returns the single nearest
frame with no distance cap, so "imagery here" is decided client-side: the nearest 360° frame within the same 25 m /
15 m radius GSV bakes into its URL. Flat mono/stereo frames are filtered out server-side, matching the viewer's
``setFilter(['in', 'cameraType', 'calotte', 'cubemap'])`` — an Infra3d street with only flat photos is unusable for
labeling and should count as having no imagery.

Resilience (so a long scan survives a flaky network): each request is retried with exponential backoff; a street that
still fails is logged and the scan continues rather than aborting, and the failed set is retried once at the end (any
still-failing streets land in ``db/failed_streets.csv``). Progress is checkpointed per street to
``db/streets_imagery_checkpoint.csv``, so a re-run resumes where it left off and re-attempts only failed/unprocessed
streets. The final ``db/streets_with_no_imagery.csv`` is derived from the checkpoint, so its schema is unchanged.

The pure functions (``create_bounding_box``, ``redistribute_vertices``, ``gsv_has_imagery``, ``mapillary_has_imagery``,
``infra3d_pano_info``, ``standardize_capture_date``, ``gsv_capture_date``, ``imagery_verdict``,
``street_has_no_imagery``, ``summarize_dates``) are import-safe and unit-tested in
``test/python/test_check_streets_for_imagery.py``; network and file I/O live in thin wrappers and ``main``.

The paths above are resolved relative to the repo root (this script's parent directory), so the tool works the same no
matter which directory you launch it from.

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
  * Providers: we support GSV, Mapillary, *and* Infra3d (Project Sidewalk uses all three); GSV Tracker is GSV-only.
"""

import argparse
import base64
import csv
import json
import logging
import os
import sys
import threading
import time
from collections import namedtuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from urllib.parse import quote

import pandas as pd
import requests
import tenacity
from geopy import Point
from geopy.distance import geodesic
from shapely import wkb
from shapely.geometry import LineString
from tqdm import tqdm

logger = logging.getLogger(__name__)

# Data files are resolved against the repo root (this script's parent dir), not the current working directory, so the
# tool behaves identically no matter where it's launched from. It previously only worked from the repo root: run from
# scripts/, the CWD-relative db/ dir didn't exist, so the first checkpoint write raised inside a worker thread and
# surfaced as a confusing traceback after the progress bar had already painted 0% (#4359).
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Input CSV export of street_edge endpoints + geom (see module docstring), expected in the repo root.
INPUT_FILE = 'street_edge_endpoints.csv'
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

# Search radii, in km: 25 m at street endpoints, 15 m at along-street points — the smaller mid-street radius avoids
# picking up imagery from a nearby parallel street.
ENDPOINT_RADIUS_KM = 0.025
POINT_RADIUS_KM = 0.015

# Infra3d: the token grant mirrors PanoDataService.getInfra3dToken; the framegate route is what the vendored viewer SDK
# calls for setLocation. The route's tenant segment comes from the token's scope, so there is no per-city config.
INFRA3D_TOKEN_URL = 'https://uzh.auth.eu-west-1.amazoncognito.com/oauth2/token'
INFRA3D_API_URL = 'https://api.infra3d.com/framegate'
# The SDK's own API-gateway key, baked into the vendored bundle and sent by every browser session alongside the bearer;
# it identifies the SDK, not us -- the per-city bearer token is what grants access to a tenant's imagery.
INFRA3D_API_KEY = '6zGSQ8u14j3AqL8myGcP54rbXS9aLCpr6lY99B9F'
# 360° frames only, matching Infra3dViewer's setFilter: Explore can't label on Infra3d's flat mono/stereo photos.
INFRA3D_PANO_FILTER = "type in '(calotte, cubemap)'"
# Infra3d access tokens live 60 minutes; refresh this many seconds before expiry so a long scan never sends a stale one.
INFRA3D_TOKEN_REFRESH_MARGIN = 300

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


def _jwt_claims(token):
    """Decodes a JWT's payload (no signature check -- we only read our own token's scope/expiry)."""
    payload = token.split('.')[1]
    return json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))


class Infra3dAuth:
    """
    Holds an Infra3d access token for the scan, refreshing it before it expires.

    The token is minted with the per-city OAuth client credentials (the same grant ``PanoDataService.getInfra3dToken``
    uses), and its ``framegate/<tenant>`` scope names the tenant whose frames we may query. ``headers()`` is safe to
    call from the worker threads; the clock and HTTP ``post`` are injectable for deterministic tests.
    """

    def __init__(self, client_id, client_secret, post=None, now=time.time):
        self._client_id = client_id
        self._client_secret = client_secret
        self._post = post if post is not None else requests.post
        self._now = now
        self._lock = threading.Lock()
        self._token = None
        self._expires_at = 0
        self.tenant = None

    def _refresh(self):
        body = {'client_id': self._client_id, 'client_secret': self._client_secret, 'grant_type': 'client_credentials'}
        response = self._post(INFRA3D_TOKEN_URL, data=body, headers={'Accept': 'application/json'},
                              timeout=REQUEST_TIMEOUT)
        if response.status_code != 200:
            raise ImageryApiError('Infra3d token request failed with status %d: %s' % (response.status_code,
                                                                                      response.text))
        self._token = response.json()['access_token']
        claims = _jwt_claims(self._token)
        self._expires_at = claims['exp']
        tenants = [s.split('/', 1)[1] for s in claims.get('scope', '').split() if s.startswith('framegate/')]
        if not tenants:
            raise ImageryApiError('Infra3d token carries no framegate/<tenant> scope: %s' % claims.get('scope'))
        self.tenant = tenants[0]

    def headers(self):
        """Returns the auth headers for a framegate request, minting/refreshing the token first if needed."""
        with self._lock:
            if self._now() >= self._expires_at - INFRA3D_TOKEN_REFRESH_MARGIN:
                self._refresh()
            return {'Authorization': 'Bearer ' + self._token, 'x-api-key': INFRA3D_API_KEY,
                    'Accept': 'application/json'}


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


def infra3d_pano_info(response_json, lat, lng, radius_km):
    """
    Interprets an Infra3d nearest-frame (``knn/query``) response for a query point.

    The endpoint returns the nearest frame(s) with no distance cap -- a point 90 km outside the city still gets the
    city's closest frame -- so presence means "the nearest frame is within ``radius_km`` of the point". The frames are
    already filtered to 360° types by the request's ``filter`` param.

    Args:
        response_json: The decoded JSON from the framegate ``knn/query`` endpoint (``{"value": [frame, ...]}``).
        lat:           Latitude of the queried point.
        lng:           Longitude of the queried point.
        radius_km:     Max distance from the point at which a frame counts as imagery for it.

    Returns:
        A ``PanoInfo``: imagery present iff the nearest frame is within the radius, with that frame's capture date.

    Raises:
        ImageryApiError: If the response has no ``value`` list (auth failure, bad request, ...).
    """
    frames = response_json.get('value') if isinstance(response_json, dict) else None
    if not isinstance(frames, list):
        raise ImageryApiError('unexpected Infra3d response: ' + json.dumps(response_json)[:200])
    if not frames:
        return PanoInfo(False, None)
    nearest = min(frames, key=lambda f: geodesic((lat, lng), (f['latitude'], f['longitude'])).km)
    if geodesic((lat, lng), (nearest['latitude'], nearest['longitude'])).km > radius_km:
        return PanoInfo(False, None)
    return PanoInfo(True, standardize_capture_date((nearest.get('timestamp') or '')[:10]))


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


def _get_json(url, **kwargs):
    """
    Requests a URL and returns the decoded JSON (with a bounded per-attempt timeout).

    GET by default; ``kwargs`` (``method``, ``headers``, ...) pass through to ``requests.request`` for providers that
    need more, like Infra3d's POST + bearer token.
    """
    kwargs.setdefault('method', 'GET')
    return requests.request(url=url, timeout=REQUEST_TIMEOUT, **kwargs).json()


def make_fetch(max_attempts=MAX_ATTEMPTS, sleep=None, rate_limiter=None):
    """
    Builds a ``fetch(url, **kwargs) -> json`` that retries transient network errors with exponential backoff + jitter.

    The retry/backoff approach is adapted from GSV Tracker (see the module "Design lineage" note).

    Args:
        max_attempts: Attempts before giving up (then the underlying ``requests`` error is re-raised).
        sleep:        Sleep function between retries; defaults to ``time.sleep`` (injectable so tests run instantly).
        rate_limiter: Optional ``RateLimiter``; if given, a token is acquired before every request (including retries).

    Returns:
        A ``fetch`` callable; any keyword arguments are passed through to ``_get_json``.
    """
    retryer = tenacity.Retrying(
        stop=tenacity.stop_after_attempt(max_attempts),
        wait=tenacity.wait_random_exponential(multiplier=0.5, max=10),
        retry=tenacity.retry_if_exception_type(requests.exceptions.RequestException),
        sleep=sleep if sleep is not None else time.sleep,
        reraise=True,
    )

    def attempt(url, **kwargs):
        if rate_limiter is not None:
            rate_limiter.acquire()
        return _get_json(url, **kwargs)

    return lambda url, **kwargs: retryer(lambda: attempt(url, **kwargs))


def _mapillary_bbox_url(mapillary_url, lat, lng, radius_km):
    """Appends a ``&bbox=`` query (a box of ``radius_km`` around the point) to the Mapillary base URL."""
    bbox = create_bounding_box(lat, lng, radius_km)
    return mapillary_url + '&bbox=' + ','.join(str(coord) for coord in bbox)


def _infra3d_knn_url(tenant, lat, lng):
    """Builds the framegate nearest-360°-frame query URL for a point."""
    return '%s/frames/%s/knn/query?longitude=%s&latitude=%s&filter=%s' % (
        INFRA3D_API_URL, tenant, lng, lat, quote(INFRA3D_PANO_FILTER, safe=''))


def _infra3d_point_pano_info(auth, lat, lng, radius_km, fetch):
    """Queries Infra3d for the nearest 360° frame to a point (via ``fetch``) and returns its ``PanoInfo``."""
    headers = auth.headers()  # Before the URL: minting the token is what populates auth.tenant.
    response = fetch(_infra3d_knn_url(auth.tenant, lat, lng), method='POST', headers=headers)
    return infra3d_pano_info(response, lat, lng, radius_km)


def _pano_info(api, response_json):
    """
    Builds a ``PanoInfo`` (imagery present? + capture date) from one provider response.

    GSV responses carry a capture date; Mapillary capture dates are not yet captured (a future enhancement), so
    Mapillary panos report ``capture_date=None``.
    """
    if api == 'GSV':
        return PanoInfo(gsv_has_imagery(response_json), gsv_capture_date(response_json))
    return PanoInfo(mapillary_has_imagery(response_json), None)


def _point_pano_info(api, lat, lng, fetch, gsv_url, mapillary_url, radius_km, infra3d_auth=None):
    """
    Queries the configured provider at one point (via ``fetch``) and returns its ``PanoInfo``.

    ``radius_km`` is the Mapillary bbox half-extent / Infra3d max frame distance; GSV bakes its radius into ``gsv_url``.
    """
    if api == 'GSV':
        return _pano_info(api, fetch(gsv_url + '&location=' + str(lat) + ',' + str(lng)))
    if api == 'Infra3d':
        return _infra3d_point_pano_info(infra3d_auth, lat, lng, radius_km, fetch)
    return _pano_info(api, fetch(_mapillary_bbox_url(mapillary_url, lat, lng, radius_km)))


def _check_endpoints(street, api, fetch, gsv_url_endpoint, mapillary_url, infra3d_auth=None):
    """Checks both of a street's endpoints; returns ``(first_pano_info, second_pano_info)``."""
    # GSV carries its radius in the URL, so the endpoint URL goes where the along-street point URL normally would.
    first = _point_pano_info(api, street.y1, street.x1, fetch, gsv_url_endpoint, mapillary_url, ENDPOINT_RADIUS_KM,
                             infra3d_auth)
    second = _point_pano_info(api, street.y2, street.x2, fetch, gsv_url_endpoint, mapillary_url, ENDPOINT_RADIUS_KM,
                              infra3d_auth)
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


def process_street(street, api, fetch, gsv_url, gsv_url_endpoint, mapillary_url, infra3d_auth=None):
    """
    Checks one street for imagery and returns its outcome (pure of any file/checkpoint I/O, so it is pool-safe).

    Walks the endpoints, then along-street points with early-exit (points are fetched lazily, so a settled verdict
    stops further requests). Any network/parse error after retries is caught and reported as ``FAILED`` so the overall
    scan can continue.

    Args:
        street:           A street row (Series) with ``street_edge_id``, ``region_id``, endpoint x/y, and ``geom``.
        api:              ``'GSV'``, ``'Mapillary'``, or ``'Infra3d'``.
        fetch:            A ``fetch(url, **kwargs) -> json`` (typically from ``make_fetch``, with retry).
        gsv_url:          GSV metadata base URL with the along-street radius baked in (GSV only).
        gsv_url_endpoint: GSV metadata base URL with the endpoint radius baked in (GSV only).
        mapillary_url:    Mapillary images base URL (Mapillary only).
        infra3d_auth:     An ``Infra3dAuth`` supplying the tenant and bearer headers (Infra3d only).

    Returns:
        A ``StreetResult`` with outcome ``NO_IMAGERY`` / ``HAS_IMAGERY`` / ``FAILED`` and, for settled streets, the
        observed imagery capture-date range. The capture dates come from the responses we already fetch, so the
        early-exit point sampling means no extra API calls are made.
    """
    try:
        first, second = _check_endpoints(street, api, fetch, gsv_url_endpoint, mapillary_url, infra3d_auth)
        coords = list(street['geom'].coords)
        dates = [d for d in (first.capture_date, second.capture_date) if d]

        # Yield the per-point has_imagery booleans to the (unchanged) decision function, recording each point's capture
        # date as a side effect. Because street_has_no_imagery consumes this lazily and stops at the verdict, we only
        # fetch — and only collect dates for — the points actually visited.
        def has_imagery_stream():
            # `no branch`: street_has_no_imagery settles and stops consuming before this loop is exhausted (for any
            # real street, which has >= 2 points), so the generator is abandoned rather than run to completion.
            for coord in coords:  # pragma: no branch  -- Shapely coords are (x=lng, y=lat).
                info = _point_pano_info(api, coord[1], coord[0], fetch, gsv_url, mapillary_url, POINT_RADIUS_KM,
                                        infra3d_auth)
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
    provider = parser.add_mutually_exclusive_group(required=True)
    provider.add_argument('--gsv', action='store_true', help='Check for GSV imagery (needs GOOGLE_MAPS_API_KEY)')
    provider.add_argument('--mapillary', action='store_true',
                          help='Check for Mapillary imagery (needs MAPILLARY_ACCESS_TOKEN)')
    provider.add_argument('--infra3d', action='store_true',
                          help='Check for Infra3d imagery (needs INFRA3D_CLIENT_ID + INFRA3D_CLIENT_SECRET)')
    parser.add_argument('--workers', type=int, default=DEFAULT_WORKERS,
                        help='Number of streets to check concurrently (default: %(default)s).')
    parser.add_argument('--max-qps', type=float, default=DEFAULT_MAX_QPS,
                        help='Global cap on requests per second across all workers (default: %(default)s).')
    args = parser.parse_args(argv)
    api = 'GSV' if args.gsv else 'Mapillary' if args.mapillary else 'Infra3d'

    api_key = None
    infra3d_auth = None
    if api == 'Infra3d':
        client_id, client_secret = os.getenv('INFRA3D_CLIENT_ID'), os.getenv('INFRA3D_CLIENT_SECRET')
        if client_id is None or client_secret is None:
            print("Couldn't read INFRA3D_CLIENT_ID / INFRA3D_CLIENT_SECRET environment variables.")
            return 1
        infra3d_auth = Infra3dAuth(client_id, client_secret)
        try:
            infra3d_auth.headers()  # Mint the first token up front so bad credentials fail fast, not per street.
        except (requests.exceptions.RequestException, ImageryApiError) as err:
            print("Couldn't get an Infra3d access token: %s" % err)
            return 1
    else:
        api_key = os.getenv('GOOGLE_MAPS_API_KEY') if api == 'GSV' else os.getenv('MAPILLARY_ACCESS_TOKEN')
        if api_key is None:
            print("Couldn't read API key environment variable.")
            return 1

    # Resolve every data file against the repo root so the script works regardless of the working directory.
    input_path = os.path.join(REPO_ROOT, INPUT_FILE)
    checkpoint_path = os.path.join(REPO_ROOT, CHECKPOINT_FILE)
    output_path = os.path.join(REPO_ROOT, OUTPUT_FILE)
    failed_path = os.path.join(REPO_ROOT, FAILED_FILE)
    summary_path = os.path.join(REPO_ROOT, SUMMARY_FILE)

    # Read street edge data and interpolate vertices roughly every 15 m so we can sample imagery along each street.
    street_data = pd.read_csv(input_path)
    street_data = street_data.sort_values(by=['region_id', 'street_edge_id'])
    street_data['geom'] = list(map(lambda g: redistribute_vertices(wkb.loads(g, hex=True)), list(street_data['geom'])))

    gsv_base_url = 'https://maps.googleapis.com/maps/api/streetview/metadata?source=outdoor&key=%s' % api_key
    gsv_url = gsv_base_url + '&radius=15'
    gsv_url_endpoint = gsv_base_url + '&radius=25'
    mapillary_url = 'https://graph.mapillary.com/images?is_pano=true&access_token=%s' % api_key
    # One shared rate limiter caps total request rate across all worker threads.
    fetch = make_fetch(rate_limiter=RateLimiter(args.max_qps))
    checkpoint_lock = threading.Lock()

    def check_and_record(street):
        result = process_street(street, api, fetch, gsv_url, gsv_url_endpoint, mapillary_url, infra3d_auth)
        with checkpoint_lock:  # process_street does no file I/O; only the checkpoint append needs serializing.
            append_checkpoint(result, checkpoint_path)
        return result

    # Resume: skip streets already settled in the checkpoint; failed/unprocessed streets are (re)checked.
    processed = load_processed(checkpoint_path)
    todo = street_data[~street_data['street_edge_id'].isin(processed)]
    # Count settled streets via the input set (not len(processed)) so a stale checkpoint with extra ids can't push the
    # bar past 100%. Seeds tqdm's `initial` below so a resumed scan picks up at its prior percentage, not back at 0%.
    already_settled = len(street_data) - len(todo)

    try:
        # Threads (not asyncio) with a global QPS cap: a deliberately conservative take on GSV Tracker's concurrent
        # fetching (see the module "Design lineage" note). Parallelize across streets; each worker keeps the sequential
        # endpoint->points early-exit internally.
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(check_and_record, street): street for _, street in todo.iterrows()}
            failed_streets = []
            # total/initial track the whole city so the bar reflects overall progress and resumes at the right percent.
            # disable=None makes tqdm auto-suppress when stderr isn't a TTY, so redirected/CI logs get clean output
            # instead of carriage-return spam.
            progress = tqdm(as_completed(futures), total=len(street_data), initial=already_settled,
                            desc='Checking %s imagery' % api, unit='street', disable=None)
            for future in progress:
                if future.result().outcome == FAILED:
                    failed_streets.append(futures[future])

            # Retry the streets that errored once more, since such failures are usually transient.
            for future in as_completed({executor.submit(check_and_record, s): s for s in failed_streets}):
                future.result()
    except KeyboardInterrupt:
        print("\nInterrupted; progress saved to the checkpoint. Re-run to resume.")
        finalize_outputs(checkpoint_path, output_path, failed_path, summary_path)
        return 1

    finalize_outputs(checkpoint_path, output_path, failed_path, summary_path)
    return 0


if __name__ == '__main__':
    sys.exit(main())
