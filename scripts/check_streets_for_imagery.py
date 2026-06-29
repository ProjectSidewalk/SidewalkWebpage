"""
Finds streets that lack street-view imagery (Google Street View or Mapillary) and writes them to a CSV.

This is a standalone, manually-run utility (it is not invoked by the app). Workflow:

  1. Export a CSV of the ``street_edge`` table with columns ``street_edge_id, region_id, x1, y1, x2, y2, geom`` (geom as
     WKB hex), named ``street_edge_endpoints.csv``, in the repo root.
  2. From the repo root, run one of:

         python3 scripts/check_streets_for_imagery.py --gsv
         python3 scripts/check_streets_for_imagery.py --mapillary

     ``--gsv`` needs ``GOOGLE_MAPS_API_KEY``; ``--mapillary`` needs ``MAPILLARY_ACCESS_TOKEN``.
  3. It writes streets without imagery to ``db/streets_with_no_imagery.csv`` (resumable: re-running picks up where it
     left off, using the last row of that file as a progress marker).
  4. Run ``make hide-streets-without-imagery`` to mark those streets in the database.

For each street it first checks both endpoints; if neither has imagery the street is flagged immediately. Otherwise it
walks points along the street (added roughly every 15 m) and flags the street once enough points lack imagery (see
``imagery_verdict`` for the exact thresholds).

The paths above are resolved relative to the current working directory, so always run from the repo root.

The pure functions (``create_bounding_box``, ``redistribute_vertices``, ``gsv_has_imagery``, ``mapillary_has_imagery``,
``imagery_verdict``, ``street_has_no_imagery``) are import-safe and unit-tested in
``test/python/test_check_streets_for_imagery.py``; network and file I/O live in thin wrappers and ``main``.

Known deferred bugs (tracked in issue #4342, intentionally NOT fixed here so this refactor stays behavior-preserving):
  * The first Mapillary endpoint is checked with a 25 km bbox instead of 25 m (see ``main``).
  * ``write_output`` has a no-op ``print`` that drops a progress newline.
"""

import argparse
import os
import sys

import pandas as pd
import requests
from geopy import Point
from geopy.distance import geodesic
from shapely import wkb
from shapely.geometry import LineString

# Output CSV of streets found to be missing imagery (also used as the resume marker on re-runs).
OUTPUT_FILE = 'db/streets_with_no_imagery.csv'

# Seconds before a request to Google/Mapillary is abandoned, so a slow provider can't hang the run forever.
REQUEST_TIMEOUT = 30

# Spacing between interpolated vertices along a street, in lat/lng degrees (~15 m). Accuracy here is not critical.
DISTANCE = 0.000135

# A street is flagged as missing imagery once the fraction of checked points without imagery reaches FAIL_FRACTION, or
# reaches FAIL_FRACTION_WITH_ENDPOINT when at least one endpoint already lacked imagery. Conversely the check stops
# early (street has imagery) once SUCCESS_FRACTION of points have imagery, or SUCCESS_FRACTION_WITH_ENDPOINT when both
# endpoints had imagery. The asymmetric thresholds make us stricter when an endpoint is already missing imagery.
FAIL_FRACTION = 0.5
FAIL_FRACTION_WITH_ENDPOINT = 0.25
SUCCESS_FRACTION = 0.75
SUCCESS_FRACTION_WITH_ENDPOINT = 0.5

# Verdicts returned by imagery_verdict.
NO_IMAGERY = 'no_imagery'
HAS_IMAGERY = 'has_imagery'


class ImageryApiError(Exception):
    """Raised when an imagery provider returns an unexpected error response that should abort the run."""


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


def mapillary_has_imagery(response_json):
    """
    Interprets a Mapillary images response.

    An empty ``data`` array means no imagery. Error code 100 means "too many images, request a smaller area" — which
    actually implies plenty of imagery, so it counts as present. Any other error is unexpected and aborts the run.

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


def street_has_no_imagery(first_endpoint_fail, second_endpoint_fail, point_has_imagery):
    """
    Pure replay of the along-street imagery decision, mirroring the lazy loop in ``main``.

    Returns ``True`` as soon as both endpoints lack imagery; otherwise walks the per-point results applying
    ``imagery_verdict`` and returns the settled verdict (defaulting to "has imagery" if never settled).

    Args:
        first_endpoint_fail:  Whether the first endpoint lacked imagery.
        second_endpoint_fail: Whether the second endpoint lacked imagery.
        point_has_imagery:    Ordered booleans, one per along-street point (``True`` = imagery present).

    Returns:
        ``True`` if the street should be flagged as missing imagery, else ``False``.
    """
    if first_endpoint_fail and second_endpoint_fail:
        return True

    endpoint_failed = first_endpoint_fail or second_endpoint_fail
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


def write_output(no_imagery_df, curr_street, output_file=OUTPUT_FILE):
    """
    Writes the streets-without-imagery DataFrame to CSV.

    When called mid-run (``curr_street`` is not ``None``), the current street is appended as the last row so a re-run can
    resume from it; that marker row is dropped when the run resumes.

    Args:
        no_imagery_df: DataFrame with ``street_edge_id`` and ``region_id`` columns.
        curr_street:   The street being processed (progress marker), or ``None`` when the run finished.
        output_file:   Destination CSV path.
    """
    print  # noqa -- no-op today; the intended progress newline (should be print()) is restored in issue #4342.

    # If we aren't done, save the street we're on as the last row so a re-run can resume from it.
    if curr_street is not None:
        no_imagery_df = pd.concat([no_imagery_df, _no_imagery_row(curr_street)])

    # street_edge_id/region_id come back as floats from the concat above; the consumer expects integers.
    no_imagery_df.street_edge_id = no_imagery_df.street_edge_id.astype('int32')
    no_imagery_df.region_id = no_imagery_df.region_id.astype('int32')
    no_imagery_df.to_csv(output_file, index=False)


def _no_imagery_row(street):
    """Builds a one-row DataFrame holding a street's ids, for appending to the no-imagery output."""
    return pd.DataFrame({'street_edge_id': street.street_edge_id, 'region_id': street.region_id}, index=[0])


def _get_json(url):
    """GETs a URL and returns the decoded JSON (with a bounded timeout)."""
    return requests.get(url, timeout=REQUEST_TIMEOUT).json()


def _mapillary_bbox_url(mapillary_url, lat, lng, radius_km):
    """Appends a ``&bbox=`` query (a box of ``radius_km`` around the point) to the Mapillary base URL."""
    bbox = create_bounding_box(lat, lng, radius_km)
    return mapillary_url + '&bbox=' + ','.join(str(coord) for coord in bbox)


def _point_has_imagery(api, lat, lng, gsv_url, mapillary_url, mapillary_radius_km):
    """
    Queries the configured provider at one point and returns whether imagery is present.

    Args:
        api:                 ``'GSV'`` or ``'Mapillary'``.
        lat:                 Latitude of the point.
        lng:                 Longitude of the point.
        gsv_url:             GSV metadata base URL with the desired ``&radius=`` already baked in (GSV only).
        mapillary_url:       Mapillary images base URL (Mapillary only).
        mapillary_radius_km: Bounding-box half-extent in km for the Mapillary query.

    Returns:
        ``True`` if imagery is present at the point.
    """
    if api == 'GSV':
        return gsv_has_imagery(_get_json(gsv_url + '&location=' + str(lat) + ',' + str(lng)))
    return mapillary_has_imagery(_get_json(_mapillary_bbox_url(mapillary_url, lat, lng, mapillary_radius_km)))


def main(argv=None):
    """
    Parses arguments and scans every street for imagery, writing those without it to ``OUTPUT_FILE``.

    Args:
        argv: Optional argument list (defaults to ``sys.argv``); accepted to make the entrypoint testable.

    Returns:
        Process exit code: 0 on success, 1 on a missing API key or an aborted run.
    """
    parser = argparse.ArgumentParser(
        description='Loops through streets, outputting any without imagery to a separate file.')
    parser.add_argument('--gsv', action='store_true', help='Include if checking for GSV imagery')
    parser.add_argument('--mapillary', action='store_true', help='Include if checking for Mapillary imagery')
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
    n_streets = len(street_data)
    street_data['id'] = range(1, n_streets + 1)
    street_data['geom'] = list(map(lambda g: redistribute_vertices(wkb.loads(g, hex=True)), list(street_data['geom'])))

    streets_with_no_imagery = pd.DataFrame(columns=['street_edge_id', 'region_id'])

    # Resume from a previous run, if any: the last row of the output file marks how far we got.
    if os.path.isfile(OUTPUT_FILE):
        streets_with_no_imagery = pd.read_csv(OUTPUT_FILE)
        progress = streets_with_no_imagery.iloc[-1]['street_edge_id']
        progress_index = int(street_data[street_data.street_edge_id == progress]['id'].iloc[0])
        street_data = street_data[street_data.id >= progress_index]
        streets_with_no_imagery.drop(streets_with_no_imagery.tail(1).index, inplace=True)

    # GSV bakes the search radius into the URL (25 m at endpoints, 15 m along the street); Mapillary uses a bbox instead.
    gsv_base_url = 'https://maps.googleapis.com/maps/api/streetview/metadata?source=outdoor&key=' + api_key
    gsv_url = gsv_base_url + '&radius=15'
    gsv_url_endpoint = gsv_base_url + '&radius=25'
    mapillary_url = 'https://graph.mapillary.com/images?is_pano=true&access_token=' + api_key

    street_data = street_data.set_index('id')
    for index, street in street_data.iterrows():
        # Print a progress percentage in place.
        percent_complete = 100 * round(float(index) / n_streets, 4)
        sys.stdout.write("\r%.2f%% complete" % percent_complete)
        sys.stdout.flush()

        # Any network/parse error while checking this street: save progress (with the current street as the marker) and
        # stop, so a re-run resumes here. One try/except covers both the endpoint and along-street checks below.
        try:
            # Check both endpoints first; if neither has imagery we can flag the street without walking it. We use a 25 m
            # radius at endpoints to guarantee a place to start. NOTE(#4342): the first Mapillary endpoint uses 25 (km),
            # a ~1000x-too-large box; it should be 0.025 like the second. Preserved here pending the fix in #4342.
            if api == 'GSV':
                first_endpoint_fail = not gsv_has_imagery(
                    _get_json(gsv_url_endpoint + '&location=' + str(street.y1) + ',' + str(street.x1)))
                second_endpoint_fail = not gsv_has_imagery(
                    _get_json(gsv_url_endpoint + '&location=' + str(street.y2) + ',' + str(street.x2)))
            else:
                first_endpoint_fail = not mapillary_has_imagery(
                    _get_json(_mapillary_bbox_url(mapillary_url, street.y1, street.x1, 25)))
                second_endpoint_fail = not mapillary_has_imagery(
                    _get_json(_mapillary_bbox_url(mapillary_url, street.y2, street.x2, 0.025)))

            # No imagery at either endpoint: flag and move on.
            if first_endpoint_fail and second_endpoint_fail:
                streets_with_no_imagery = pd.concat([streets_with_no_imagery, _no_imagery_row(street)])
                continue

            # At least one endpoint had imagery: sample points along the street (15 m radius) to decide whether most of
            # it is missing imagery. The smaller radius avoids picking up imagery from a nearby street.
            endpoint_failed = first_endpoint_fail or second_endpoint_fail
            coords = list(street['geom'].coords)
            n_coords = len(coords)
            n_fail = n_success = 0
            # `no branch`: by the final point the cumulative counts always satisfy a NO_IMAGERY or HAS_IMAGERY threshold
            # (see imagery_verdict), so this loop always exits via break for any real street (geom has >= 2 points).
            for coord in coords:  # pragma: no branch
                lng_pt, lat_pt = coord[0], coord[1]  # Shapely coords are (x=lng, y=lat).
                has_imagery = _point_has_imagery(api, lat_pt, lng_pt, gsv_url, mapillary_url, 0.015)
                if has_imagery:
                    n_success += 1
                else:
                    n_fail += 1

                verdict = imagery_verdict(n_fail, n_success, n_coords, endpoint_failed)
                if verdict == NO_IMAGERY:
                    streets_with_no_imagery = pd.concat([streets_with_no_imagery, _no_imagery_row(street)])
                    break
                if verdict == HAS_IMAGERY:
                    break
        except (requests.exceptions.RequestException, KeyboardInterrupt):
            write_output(streets_with_no_imagery, street)
            return 1
        except ImageryApiError as err:
            print(err)
            write_output(streets_with_no_imagery, street)
            return 1

    print()  # Stops the overflow on a new line.
    write_output(streets_with_no_imagery, None)
    return 0


if __name__ == '__main__':
    sys.exit(main())
