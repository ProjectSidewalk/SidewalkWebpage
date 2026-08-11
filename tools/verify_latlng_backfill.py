#!/usr/bin/env python3
"""Rollout-gate verifier for the #4818 backfill (evolution 352): recompute every backfilled label position
independently and confirm the stored values match to float noise.

The evolution ports PanoDataService.calculatePovFromPanoXY, PanoDataService.estimateDistanceFromPanoM, and
CommonUtils.calculateDestination to SQL. This script carries its own transcription of the same math (deliberately a
second, independent copy -- agreement between the two implementations on every row is the certification), plus the
pinned research fixtures from test/service/PanoDataServiceSpec.scala as a self-test, so a transcription error here
fails loudly before the script judges any database.

Run it at every rollout stage (localhost -> test server -> production), per city schema:

  1. Export the backfilled rows with the canonical COPY query below, running psql as the city's own role
     (e.g. -U sidewalk_seattle) so unqualified table names resolve to that city's schema:

       COPY (
           SELECT label_point.label_point_id, pano_data.lat AS pano_lat, pano_data.lng AS pano_lng,
                  pano_data.camera_heading, pano_data.width AS pano_width, pano_data.height AS pano_height,
                  label_point.pano_x, label_point.pano_y, label_point.lat AS new_lat, label_point.lng AS new_lng,
                  label_point.computation_method::text AS computation_method,
                  old_label_point_position.lat AS old_lat, old_label_point_position.lng AS old_lng
           FROM old_label_point_position
           INNER JOIN label_point ON old_label_point_position.label_point_id = label_point.label_point_id
           INNER JOIN label ON label_point.label_id = label.label_id
           INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
       ) TO STDOUT WITH CSV HEADER

     localhost:  docker exec projectsidewalk-db psql -U sidewalk_<city> -d sidewalk -c "COPY (...) TO STDOUT
                 WITH CSV HEADER" > rows.csv
     test/prod:  ssh <server> 'psql ... -c "COPY (...) TO STDOUT WITH CSV HEADER"' > rows.csv
                 (the public v3 API cannot drive this -- it exposes neither computation_method nor the pano's
                 own lat/lng)

  2. python3 tools/verify_latlng_backfill.py rows.csv

Companion invariants, run as psql one-liners alongside the parity check:

  -- Every 'approximation2' row left behind is missing metadata (expect 0):
  SELECT count(*) FROM label_point
  INNER JOIN label ON label_point.label_id = label.label_id
  INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
  WHERE label_point.computation_method = 'approximation2'
      AND pano_data.lat IS NOT NULL AND pano_data.lng IS NOT NULL AND pano_data.camera_heading IS NOT NULL
      AND pano_data.width IS NOT NULL AND pano_data.width > 0
      AND pano_data.height IS NOT NULL AND pano_data.height > 0;

  -- 'depth' rows untouched (compare to the pre-apply count):
  SELECT count(*) FROM label_point WHERE computation_method = 'depth';

  -- geom agrees with lat/lng on every backfilled row (expect 0):
  SELECT count(*) FROM label_point
  INNER JOIN old_label_point_position
      ON label_point.label_point_id = old_label_point_position.label_point_id
  WHERE ST_X(label_point.geom) IS DISTINCT FROM label_point.lng
      OR ST_Y(label_point.geom) IS DISTINCT FROM label_point.lat;

  -- Street-flip measurement for the human-label reattachment decision on #4818 (read-only):
  SELECT count(*) FILTER (WHERE nearest_street.street_edge_id <> label.street_edge_id) AS flipped, count(*) AS total
  FROM old_label_point_position
  INNER JOIN label_point ON old_label_point_position.label_point_id = label_point.label_point_id
  INNER JOIN label ON old_label_point_position.label_id = label.label_id
  CROSS JOIN LATERAL (
      SELECT candidate_streets.street_edge_id
      FROM (
          SELECT street_edge.street_edge_id, street_edge.geom
          FROM street_edge
          WHERE street_edge.status = 'open'
          ORDER BY street_edge.geom <-> label_point.geom
          LIMIT 20
      ) candidate_streets
      ORDER BY ST_DistanceSphere(candidate_streets.geom, label_point.geom)
      LIMIT 1
  ) nearest_street;
"""

import argparse
import csv
import math
import sys

# PanoDataService.LatLngEstimation and CommonUtils.EARTH_RADIUS_KM. A refit that changes the backend constants must
# change these with them (and re-pin the fixtures below from the new research summary, as the Scala spec requires).
CAMERA_HEIGHT_M = 2.341219672825709
BLEND_DEG = 11.25
MAX_DISTANCE_M = 50.0
EARTH_RADIUS_KM = 6371.0


def estimate_distance_from_pano_m(depression_deg):
    """PanoDataService.estimateDistanceFromPanoM: saturating-cotangent blend on the single camera height.

    @param depression_deg: Degrees below the horizon (negative when above it).
    @return: Estimated distance in meters, bounded at the horizon's answer for any input.
    """
    blend_rad = math.radians(BLEND_DEG)
    if depression_deg >= BLEND_DEG:
        return CAMERA_HEIGHT_M / math.tan(math.radians(depression_deg))
    tail_m = CAMERA_HEIGHT_M / math.tan(blend_rad) + \
        CAMERA_HEIGHT_M * (math.pi / 180.0) / math.sin(blend_rad) ** 2 * \
        (BLEND_DEG - max(depression_deg, 0.0))
    return min(tail_m, MAX_DISTANCE_M)


def calculate_destination(lat, lng, distance_km, bearing_deg):
    """CommonUtils.calculateDestination: spherical (haversine) forward destination on R = 6371 km.

    @return: (lat, lng) of the destination in degrees. Longitude is not wrapped into [-180, 180], same as the app.
    """
    lat1 = math.radians(lat)
    lng1 = math.radians(lng)
    bearing = math.radians(bearing_deg)
    angular = distance_km / EARTH_RADIUS_KM
    lat2 = math.asin(math.sin(lat1) * math.cos(angular) + math.cos(lat1) * math.sin(angular) * math.cos(bearing))
    lng2 = lng1 + math.atan2(math.sin(bearing) * math.sin(angular) * math.cos(lat1),
                             math.cos(angular) - math.sin(lat1) * math.sin(lat2))
    return math.degrees(lat2), math.degrees(lng2)


def to_lat_lng(pano_lat, pano_lng, pano_x, pano_y, pano_width, pano_height, camera_heading):
    """PanoDataService.toLatLng: pixel position within the pano to an estimated label lat/lng.

    math.fmod keeps the dividend's sign like Scala's %, so a westward heading can leave the bearing negative --
    harmless, the destination formula is periodic.
    """
    bearing_deg = math.fmod(camera_heading - 180.0 + (pano_x / pano_width) * 360.0, 360.0)
    depression_deg = 180.0 * pano_y / pano_height - 90.0
    distance_m = estimate_distance_from_pano_m(depression_deg)
    return calculate_destination(pano_lat, pano_lng, distance_m / 1000.0, bearing_deg)


def haversine_meters(lat1, lng1, lat2, lng2):
    """CommonUtils.haversineMeters: great-circle distance in meters, for displacement stats."""
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * \
        math.sin(d_lng / 2) ** 2
    return 2 * EARTH_RADIUS_KM * 1000 * math.asin(math.sqrt(a))


def self_test():
    """Pin this script's transcription to the research fixtures in PanoDataServiceSpec before judging any data.

    @return: List of failure descriptions, empty when the transcription is faithful.
    """
    eps = 1e-9
    failures = []

    # Distance fixtures, pinned from the label-latlng-estimation summaries (same values the Scala spec pins).
    pinned = [(45.0, 2.341219672825709), (15.0, 8.737550770665331), (30.0, 4.055111425013912),
              (60.0, 1.351703808337971), (11.25, 11.770106120938644), (5.0, 18.480192309211834),
              (2.0, 21.701033679582963), (0.0, 23.848261259830384), (-10.0, 23.848261259830384)]
    for depression, expected in pinned:
        got = estimate_distance_from_pano_m(depression)
        if abs(got - expected) > eps:
            failures.append(f"distance({depression}) = {got!r}, pinned {expected!r}")

    # A label on the pano's center column lands along the camera heading.
    expected = calculate_destination(47.6553, -122.3035, estimate_distance_from_pano_m(22.5) / 1000.0, 90.0)
    got = to_lat_lng(47.6553, -122.3035, 6656, 4160, 13312, 6656, 90.0)
    if max(abs(got[0] - expected[0]), abs(got[1] - expected[1])) > eps:
        failures.append(f"center-column fixture: {got!r} != {expected!r}")

    # A quarter of the way across the pano bears 90 degrees counter-clockwise of the camera heading.
    expected = calculate_destination(47.6553, -122.3035, estimate_distance_from_pano_m(22.5) / 1000.0, 147.5)
    got = to_lat_lng(47.6553, -122.3035, 3328, 4160, 13312, 6656, 237.5)
    if max(abs(got[0] - expected[0]), abs(got[1] - expected[1])) > eps:
        failures.append(f"quarter-width fixture: {got!r} != {expected!r}")

    # A negative bearing lands where its in-range equivalent does (-125 vs 235 for an eighth across at heading 10).
    expected = calculate_destination(47.6553, -122.3035, estimate_distance_from_pano_m(22.5) / 1000.0, 235.0)
    got = to_lat_lng(47.6553, -122.3035, 1664, 4160, 13312, 6656, 10.0)
    if max(abs(got[0] - expected[0]), abs(got[1] - expected[1])) > eps:
        failures.append(f"negative-bearing fixture: {got!r} != {expected!r}")

    # Resolution independence (#4765): proportional pixel coordinates at two native resolutions agree.
    low = to_lat_lng(47.6553, -122.3035, 1440, 1800, 5760, 2880, 237.5)
    high = to_lat_lng(47.6553, -122.3035, 3328, 4160, 13312, 6656, 237.5)
    if max(abs(low[0] - high[0]), abs(low[1] - high[1])) > eps:
        failures.append(f"resolution-independence fixture: {low!r} != {high!r}")

    return failures


def quantile(sorted_values, q):
    """Nearest-rank quantile over an already-sorted list, empty-safe."""
    if not sorted_values:
        return float("nan")
    index = min(len(sorted_values) - 1, max(0, math.ceil(q * len(sorted_values)) - 1))
    return sorted_values[index]


def verify_rows(reader, eps):
    """Recompute every exported row and compare against the stored values.

    @param reader: csv.DictReader over the canonical COPY export.
    @param eps:    Max tolerated |difference| in degrees on either axis (float-noise scale, not perceptual).
    @return: (stats dict, list of failure descriptions capped at 20).
    """
    failures = []
    total = 0
    max_delta_deg = 0.0
    displacements_m = []

    for row in reader:
        total += 1
        expected_lat, expected_lng = to_lat_lng(
            float(row["pano_lat"]), float(row["pano_lng"]), int(row["pano_x"]), int(row["pano_y"]),
            int(row["pano_width"]), int(row["pano_height"]), float(row["camera_heading"]))
        if row["computation_method"] != "approximation3":
            if len(failures) < 20:
                failures.append(f"label_point {row['label_point_id']}: stamped {row['computation_method']!r}")
            continue
        if row["new_lat"] == "" or row["new_lng"] == "":
            if len(failures) < 20:
                failures.append(f"label_point {row['label_point_id']}: NULL lat/lng after backfill")
            continue
        delta = max(abs(float(row["new_lat"]) - expected_lat), abs(float(row["new_lng"]) - expected_lng))
        max_delta_deg = max(max_delta_deg, delta)
        if delta > eps:
            if len(failures) < 20:
                failures.append(f"label_point {row['label_point_id']}: stored ({row['new_lat']}, {row['new_lng']}), "
                                f"recomputed ({expected_lat!r}, {expected_lng!r}), delta {delta:.3e} deg")
        if row["old_lat"] != "" and row["old_lng"] != "":
            displacements_m.append(haversine_meters(
                float(row["old_lat"]), float(row["old_lng"]), float(row["new_lat"]), float(row["new_lng"])))

    displacements_m.sort()
    stats = {
        "rows": total,
        "max_delta_deg": max_delta_deg,
        "displacement_p50_m": quantile(displacements_m, 0.50),
        "displacement_p90_m": quantile(displacements_m, 0.90),
        "displacement_p99_m": quantile(displacements_m, 0.99),
        "displacement_max_m": displacements_m[-1] if displacements_m else float("nan"),
    }
    return stats, failures


def main():
    parser = argparse.ArgumentParser(description="Verify the #4818 lat/lng backfill (see module docstring).")
    parser.add_argument("csv_path", nargs="?", help="CSV from the canonical COPY query. Omit to read stdin.")
    parser.add_argument("--eps", type=float, default=1e-9,
                        help="Max tolerated |delta| in degrees per axis (default 1e-9, about 0.1 mm).")
    parser.add_argument("--self-test-only", action="store_true", help="Run the fixture self-test and exit.")
    args = parser.parse_args()

    self_test_failures = self_test()
    if self_test_failures:
        print("SELF-TEST FAILED -- this script's transcription is wrong, no data was judged:")
        for failure in self_test_failures:
            print(f"  {failure}")
        return 1
    print("self-test: OK (9 pinned distances, 4 toLatLng fixtures)")
    if args.self_test_only:
        return 0

    source = open(args.csv_path, newline="") if args.csv_path else sys.stdin
    try:
        stats, failures = verify_rows(csv.DictReader(source), args.eps)
    finally:
        if args.csv_path:
            source.close()

    print(f"rows verified:      {stats['rows']}")
    print(f"max |delta|:        {stats['max_delta_deg']:.3e} deg (eps {args.eps:.1e})")
    print(f"displacement p50:   {stats['displacement_p50_m']:.3f} m")
    print(f"displacement p90:   {stats['displacement_p90_m']:.3f} m")
    print(f"displacement p99:   {stats['displacement_p99_m']:.3f} m")
    print(f"displacement max:   {stats['displacement_max_m']:.3f} m")

    if failures:
        print(f"\nFAILED -- {len(failures)} shown (cap 20):")
        for failure in failures:
            print(f"  {failure}")
        return 1
    if stats["rows"] == 0:
        print("\nFAILED -- no rows in the export (wrong schema, or the evolution has not applied)")
        return 1
    print("\nPASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
