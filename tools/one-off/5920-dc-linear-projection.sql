-- #5920: aim Washington DC's pre-2017 label records at the spot the labeller actually clicked.
--
-- Written against evolution 429 (v11.20). ONE schema (sidewalk_dc), a write role. Preview with apply=0 (the
-- default: prints every count, then rolls back), apply with apply=1. A rerun is a no-op: the backup table is the
-- population guard. Not for run-query-in-every-city.sh (read-only runner). Undo: 5920-undo-dc-linear-projection.sql
-- (positions and records only; the voided votes stay archived).
-- Run after 5667-dc-label-positions.sql, at a quiet hour: the transaction holds row locks on ~61k label_point rows.
--
--   psql "dbname=sidewalk options=--search_path=sidewalk_dc,public" -U sidewalk_dc -v ON_ERROR_STOP=1 \
--     -v apply=0 -f tools/one-off/5920-dc-linear-projection.sql
--
-- WHY. Until Google retired Maps API 3.25 on 2017-02-15, the labeling client asked for the flat `html4` Street View
-- renderer and computed its label coordinates (kept since as old_label_metadata.old_pano_x/old_pano_y) with a
-- linear model of that view: a 13312 x 6656 frame, 4.6 frame px per canvas px, scaled by zoom (#429, #518). Every
-- reader since v2.1 projects the record (heading, pitch, zoom, canvas_x, canvas_y) with the perspective formula
-- instead, which puts the marker up to ~5 deg from the click for anything not near the canvas centre: top clicks
-- render too high, bottom ones too low, side ones too far out. Validate, Gallery and label cards all draw from the
-- record, and #5667's coordinate conversion replayed the same formula, so pano_x/pano_y and lat/lng are off by the
-- same amount. Confirmed on ~70 labels against the stored pano copies (#5920).
--
-- WHAT. The linear coordinates give the direction the labeller clicked (heading = old_pano_x * 360 / 13312 from
-- north, altitude = old_pano_y * 90 / 3328). Part 1 re-solves heading/pitch so the perspective projection of the
-- untouched canvas_x/canvas_y/zoom lands there (355's solver), part 2 writes pano_x/pano_y for it (179), part 3 is
-- 352's position recompute, 366's reattach and 377's centerline offset, which also catches up the labels #5667
-- moved without recomputing it. Tutorial labels stay as they are (#4587). Clusters are not invalidated (352/366
-- precedent): force a re-cluster on DC afterwards (/runClustering?allRegions=true), then recompute user stats.
-- Part 4 is 355's vote treatment: a human vote on a label whose old marker drew 30 px or more off judged the wrong
-- spot, so it is archived in voided_label_validation (the table 355 made, which the app reads for work credit) and
-- the label's counts and its labeler's stats are recomputed from what survives. 56 votes on prod when written.
--
-- THE CUT. label.time_created is naive US/Eastern before 2018-08-25 (docs/data-notes.md), compared here as stored.
-- The last label that renders on the linear model is stamped 2017-02-15 15:54, the first on the perspective one
-- 20:23, with one label in between (18:29) that stays as it is. The 13 labels from the cut to the v2.1 deploy
-- (2017-03-21) were recorded with the linear formula but seen through the perspective renderer: left alone.

\if :{?apply}
\else
  \set apply 0
\endif
SET lock_timeout = '10s';

-- The backup table outlives the run: it is the undo record and the rerun guard. Own transaction, as in #5667 (its
-- foreign keys take share locks that would otherwise block writes to DC for the whole run).
CREATE TABLE IF NOT EXISTS old_label_point_linear (
  label_point_id INT PRIMARY KEY REFERENCES label_point (label_point_id),
  label_id INT NOT NULL UNIQUE REFERENCES label (label_id),
  heading DOUBLE PRECISION NOT NULL,
  pitch DOUBLE PRECISION NOT NULL,
  pano_x INT NOT NULL,
  pano_y INT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geom geometry,
  computation_method TEXT,
  street_edge_id INT NOT NULL REFERENCES street_edge (street_edge_id),
  centerline_offset_m DOUBLE PRECISION,
  -- How far the old record rendered from the click, in Validate px at the record's zoom (355's metric).
  old_render_error_px DOUBLE PRECISION NOT NULL
);

BEGIN;

SELECT 'labels in the cut-to-v2.1 window, left alone' AS what, count(*) FROM label
WHERE NOT label.tutorial AND label.time_created >= '2017-02-15 17:00:00+00'
  AND label.time_created < '2017-03-22 00:00:00+00';

-- ---------------------------------------------------------------------------------------------------------------
-- Part 1. The click direction from the linear coordinates, and the record re-solved to point there.
-- ---------------------------------------------------------------------------------------------------------------
-- The target heading is wrapped because the client only wrapped negative frame x, never x past the frame width.
CREATE TEMP TABLE pov_inputs ON COMMIT DROP AS
SELECT record.*, 360.0 / TAN(0.5 * RADIANS(fov_deg)) AS f
FROM (
  SELECT label_point.label_point_id, label.label_id,
         old_label_metadata.old_pano_x * 360.0 / 13312
           - 360.0 * FLOOR(old_label_metadata.old_pano_x * 360.0 / 13312 / 360.0) AS target_heading,
         old_label_metadata.old_pano_y * 90.0 / 3328 AS target_altitude,
         CASE WHEN label_point.zoom <= 2 THEN 126.5 - 36.75 * label_point.zoom
              ELSE 195.93 / POWER(1.92, label_point.zoom) END AS fov_deg,
         (label_point.canvas_x - 360)::DOUBLE PRECISION AS du,
         (240 - label_point.canvas_y)::DOUBLE PRECISION AS dv,
         RADIANS(label_point.heading) AS heading_rad,
         RADIANS(label_point.pitch) AS pitch_rad
  FROM old_label_metadata
  INNER JOIN label ON old_label_metadata.label_id = label.label_id
  INNER JOIN label_point ON label.label_id = label_point.label_id
  WHERE NOT label.tutorial
    AND label.time_created < '2017-02-15 17:00:00+00'
    AND label_point.heading IS NOT NULL AND label_point.pitch IS NOT NULL AND label_point.zoom IS NOT NULL
    AND label_point.canvas_x IS NOT NULL AND label_point.canvas_y IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM old_label_point_linear
                    WHERE old_label_point_linear.label_point_id = label_point.label_point_id)
) AS record;

SELECT 'labels before the cut without a usable record' AS what, count(*) FROM label
INNER JOIN label_point ON label.label_id = label_point.label_id
LEFT JOIN old_label_metadata ON label.label_id = old_label_metadata.label_id
WHERE NOT label.tutorial AND label.time_created < '2017-02-15 17:00:00+00'
  AND NOT EXISTS (SELECT 1 FROM pov_inputs WHERE pov_inputs.label_point_id = label_point.label_point_id)
  AND NOT EXISTS (SELECT 1 FROM old_label_point_linear
                  WHERE old_label_point_linear.label_point_id = label_point.label_point_id);

-- 355's closed forms: pitch from the ray's elevation f*sin(P) + dv*cos(P) = |ray| * sin(target altitude), with
-- |ray| = sqrt(f^2+du^2+dv^2) invariant in (heading, pitch), then heading = target minus the ray's azimuth term.
-- Any solution that aims the canvas ray at the target renders identically, because every reader re-centres through
-- canvasCoordToCenteredPov.
CREATE TEMP TABLE solved ON COMMIT DROP AS
WITH ray AS (
  SELECT pov_inputs.*,
         f * COS(pitch_rad) * SIN(heading_rad)
           + du * (CASE WHEN COS(pitch_rad) >= 0 THEN 1.0 ELSE -1.0 END) * COS(heading_rad)
           - dv * SIN(pitch_rad) * SIN(heading_rad) AS ray_x,
         f * COS(pitch_rad) * COS(heading_rad)
           - du * (CASE WHEN COS(pitch_rad) >= 0 THEN 1.0 ELSE -1.0 END) * SIN(heading_rad)
           - dv * SIN(pitch_rad) * COS(heading_rad) AS ray_y,
         f * SIN(pitch_rad) + dv * COS(pitch_rad) AS ray_z
  FROM pov_inputs
), replayed AS (
  SELECT ray.*,
         DEGREES(ATAN2(ray_x, ray_y)) + CASE WHEN ATAN2(ray_x, ray_y) < 0 THEN 360.0 ELSE 0.0 END AS old_heading,
         DEGREES(ASIN(ray_z / SQRT(ray_x * ray_x + ray_y * ray_y + ray_z * ray_z))) AS old_altitude
  FROM ray
), pitched AS (
  -- The asin domain guard and a sanity bound on the stored altitude: a row they reject is left alone.
  SELECT replayed.*,
         DEGREES(ASIN(SQRT(f * f + du * du + dv * dv) * SIN(RADIANS(target_altitude)) / SQRT(f * f + dv * dv))
                 - ATAN2(dv, f)) AS new_pitch
  FROM replayed
  WHERE ABS(target_altitude) <= 90
    AND ABS(SQRT(f * f + du * du + dv * dv) * SIN(RADIANS(target_altitude))) <= SQRT(f * f + dv * dv)
), headed AS (
  SELECT pitched.*,
         target_heading
           - DEGREES(ATAN2(du * (CASE WHEN COS(RADIANS(new_pitch)) >= 0 THEN 1.0 ELSE -1.0 END),
                           f * COS(RADIANS(new_pitch)) - dv * SIN(RADIANS(new_pitch)))) AS new_heading_raw
  FROM pitched
)
SELECT label_point_id, label_id, target_heading, target_altitude,
       new_heading_raw - 360.0 * FLOOR(new_heading_raw / 360.0) AS new_heading,
       new_pitch,
       SQRT(POWER(old_heading - target_heading - 360.0 * ROUND((old_heading - target_heading) / 360.0), 2)
            + POWER(old_altitude - target_altitude, 2)) / fov_deg * 720.0 AS old_render_error_px
FROM headed;

SELECT 'labels the solver cannot aim (left alone)' AS what, count(*) FROM pov_inputs
WHERE NOT EXISTS (SELECT 1 FROM solved WHERE solved.label_point_id = pov_inputs.label_point_id);

-- Every later statement drives off this run's rows only.
CREATE TEMP TABLE run_rows (label_point_id INT PRIMARY KEY) ON COMMIT DROP;

WITH inserted AS (
INSERT INTO old_label_point_linear
  (label_point_id, label_id, heading, pitch, pano_x, pano_y, lat, lng, geom, computation_method, street_edge_id,
   centerline_offset_m, old_render_error_px)
SELECT solved.label_point_id, solved.label_id, label_point.heading, label_point.pitch, label_point.pano_x,
       label_point.pano_y, label_point.lat, label_point.lng, label_point.geom, label_point.computation_method::text,
       label.street_edge_id, label_point.centerline_offset_m, solved.old_render_error_px
FROM solved
INNER JOIN label_point ON solved.label_point_id = label_point.label_point_id
INNER JOIN label ON solved.label_id = label.label_id
RETURNING label_point_id
)
INSERT INTO run_rows SELECT label_point_id FROM inserted;

UPDATE label_point
SET heading = solved.new_heading,
    pitch = solved.new_pitch
FROM run_rows
INNER JOIN solved ON run_rows.label_point_id = solved.label_point_id
WHERE label_point.label_point_id = solved.label_point_id;

-- ---------------------------------------------------------------------------------------------------------------
-- Part 2. pano_x/pano_y for the click direction, on every pano whose dimensions are known.
-- ---------------------------------------------------------------------------------------------------------------
-- 179's raster mapping (column zero is camera_heading + 180, row zero is +90 deg). A label on a pano nobody has
-- sized keeps its legacy coordinates: its record now aims right, so a later #5667 rerun converts its pixels and
-- position correctly (its centerline offset then needs a recompute, as for everything that script moves).
UPDATE label_point
SET pano_x = (pano_data.width + ROUND(pano_data.width * (solved.target_heading::DECIMAL
               - (pano_data.camera_heading + 180)::DECIMAL % 360) / 360)) % pano_data.width,
    pano_y = (pano_data.height / 2) - ROUND((pano_data.height / 2) * (solved.target_altitude / 90))
FROM run_rows
INNER JOIN solved ON run_rows.label_point_id = solved.label_point_id
INNER JOIN label ON solved.label_id = label.label_id
INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
WHERE label_point.label_point_id = solved.label_point_id
  AND pano_data.width IS NOT NULL AND pano_data.width > 0
  AND pano_data.height IS NOT NULL AND pano_data.height > 0
  AND pano_data.camera_heading IS NOT NULL AND pano_data.camera_heading <> 'NaN';

-- Self-check: replay every repaired record through the readers' projection. The CHECKs are the assert, so one row
-- off by more than rounding noise (355's tolerances) aborts the transaction instead of shipping a wrong repair.
CREATE TEMP TABLE repair_check (
  label_point_id INT PRIMARY KEY,
  residual_deg DOUBLE PRECISION NOT NULL CHECK (residual_deg <= 0.01),
  residual_px DOUBLE PRECISION CHECK (residual_px <= 2)
) ON COMMIT DROP;

WITH ray AS (
  SELECT solved.label_point_id, solved.target_heading, solved.target_altitude, pov_inputs.f, pov_inputs.du,
         pov_inputs.dv, pov_inputs.f * COS(RADIANS(label_point.pitch)) * SIN(RADIANS(label_point.heading))
           + pov_inputs.du * (CASE WHEN COS(RADIANS(label_point.pitch)) >= 0 THEN 1.0 ELSE -1.0 END)
             * COS(RADIANS(label_point.heading))
           - pov_inputs.dv * SIN(RADIANS(label_point.pitch)) * SIN(RADIANS(label_point.heading)) AS ray_x,
         pov_inputs.f * COS(RADIANS(label_point.pitch)) * COS(RADIANS(label_point.heading))
           - pov_inputs.du * (CASE WHEN COS(RADIANS(label_point.pitch)) >= 0 THEN 1.0 ELSE -1.0 END)
             * SIN(RADIANS(label_point.heading))
           - pov_inputs.dv * SIN(RADIANS(label_point.pitch)) * COS(RADIANS(label_point.heading)) AS ray_y,
         pov_inputs.f * SIN(RADIANS(label_point.pitch)) + pov_inputs.dv * COS(RADIANS(label_point.pitch)) AS ray_z,
         label_point.pano_x, label_point.pano_y, pano_data.width::DOUBLE PRECISION AS width,
         pano_data.height::DOUBLE PRECISION AS height, pano_data.camera_heading
  FROM run_rows
  INNER JOIN solved ON run_rows.label_point_id = solved.label_point_id
  INNER JOIN pov_inputs ON solved.label_point_id = pov_inputs.label_point_id
  INNER JOIN label_point ON solved.label_point_id = label_point.label_point_id
  INNER JOIN label ON solved.label_id = label.label_id
  LEFT JOIN pano_data ON label.pano_id = pano_data.pano_id
    AND pano_data.width > 0 AND pano_data.height > 0
    AND pano_data.camera_heading IS NOT NULL AND pano_data.camera_heading <> 'NaN'
), replayed AS (
  SELECT ray.*,
         DEGREES(ATAN2(ray_x, ray_y)) + CASE WHEN ATAN2(ray_x, ray_y) < 0 THEN 360.0 ELSE 0.0 END AS new_heading,
         DEGREES(ASIN(ray_z / SQRT(ray_x * ray_x + ray_y * ray_y + ray_z * ray_z))) AS new_altitude,
         camera_heading + 180.0 - 360.0 * FLOOR((camera_heading + 180.0) / 360.0) AS heading_pixel_zero
  FROM ray
)
INSERT INTO repair_check (label_point_id, residual_deg, residual_px)
SELECT label_point_id,
       SQRT(POWER(new_heading - target_heading - 360.0 * ROUND((new_heading - target_heading) / 360.0), 2)
            + POWER(new_altitude - target_altitude, 2)),
       CASE WHEN width IS NULL THEN NULL ELSE GREATEST(
         ABS((pano_x - ((width::INT + ROUND(width * (new_heading - heading_pixel_zero) / 360.0)::INT) % width::INT))
             - width * ROUND((pano_x
                              - ((width::INT + ROUND(width * (new_heading - heading_pixel_zero) / 360.0)::INT)
                                 % width::INT)) / width)),
         ABS(pano_y - (height / 2.0 - ROUND((height / 2.0) * new_altitude / 90.0))::INT)) END
FROM replayed;

-- ---------------------------------------------------------------------------------------------------------------
-- Part 3. Positions, streets and centerline offsets for the labels whose pixels moved.
-- ---------------------------------------------------------------------------------------------------------------
-- 352's recompute, statement for statement, for the labels whose pano_x/pano_y this run wrote. 'depth' rows were
-- measured from the linear coordinates when the labels were placed, so they already sit at the click.
WITH constants AS (
  -- PanoDataService.LatLngEstimation and CommonUtils.EARTH_RADIUS_KM, verbatim.
  SELECT 2.341219672825709::float8 AS camera_height_m,
         11.25::float8 AS blend_deg,
         50.0::float8 AS max_distance_m,
         6371.0::float8 AS earth_radius_km
), recompute_inputs AS (
  SELECT old_label_point_linear.label_point_id,
         pano_data.lat AS pano_lat, pano_data.lng AS pano_lng, pano_data.camera_heading,
         pano_data.width, pano_data.height, label_point.pano_x, label_point.pano_y
  FROM run_rows
  INNER JOIN old_label_point_linear ON run_rows.label_point_id = old_label_point_linear.label_point_id
  INNER JOIN label_point ON old_label_point_linear.label_point_id = label_point.label_point_id
  INNER JOIN label ON label_point.label_id = label.label_id
  INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
  WHERE old_label_point_linear.computation_method IN ('approximation2', 'approximation3')
    AND (label_point.pano_x <> old_label_point_linear.pano_x OR label_point.pano_y <> old_label_point_linear.pano_y)
    AND pano_data.lat IS NOT NULL
    AND pano_data.lng IS NOT NULL
    AND pano_data.camera_heading IS NOT NULL AND pano_data.camera_heading <> 'NaN'
    AND pano_data.width > 0
    AND pano_data.height > 0
), angles AS (
  -- mod() keeps the dividend's sign like Scala's %; a negative bearing is harmless, it only feeds sin and cos.
  SELECT label_point_id, pano_lat, pano_lng,
         180.0 * pano_y / height - 90.0 AS depression_deg,
         mod((camera_heading - 180.0 + (pano_x::float8 / width) * 360.0)::numeric, 360.0)::float8 AS bearing_deg
  FROM recompute_inputs
), distances AS (
  SELECT label_point_id, pano_lat, pano_lng, bearing_deg,
         CASE
           WHEN depression_deg >= blend_deg THEN camera_height_m / tan(radians(depression_deg))
           ELSE LEAST(
             camera_height_m / tan(radians(blend_deg))
               + camera_height_m * (pi() / 180.0) / power(sin(radians(blend_deg)), 2)
                 * (blend_deg - GREATEST(depression_deg, 0.0)),
             max_distance_m)
         END / 1000.0 / earth_radius_km AS angular_dist
  FROM angles, constants
), new_latitudes AS (
  -- The clamp keeps asin off NaN within float error of a pole; 352 made the same deviation from the Scala.
  SELECT label_point_id, pano_lat, pano_lng, bearing_deg, angular_dist,
         asin(LEAST(1.0, GREATEST(-1.0,
           sin(radians(pano_lat)) * cos(angular_dist)
             + cos(radians(pano_lat)) * sin(angular_dist) * cos(radians(bearing_deg))
         ))) AS new_lat_rad
  FROM distances
), new_positions AS (
  SELECT label_point_id, degrees(new_lat_rad) AS new_lat,
         degrees(radians(pano_lng) + atan2(
           sin(radians(bearing_deg)) * sin(angular_dist) * cos(radians(pano_lat)),
           cos(angular_dist) - sin(radians(pano_lat)) * sin(new_lat_rad)
         )) AS new_lng
  FROM new_latitudes
)
UPDATE label_point
SET lat = new_lat,
    lng = new_lng,
    geom = ST_SetSRID(ST_Point(new_lng, new_lat), 4326),
    computation_method = 'approximation3'
FROM new_positions
WHERE label_point.label_point_id = new_positions.label_point_id;

-- Reattach only labels whose position moved and only to a strictly closer open street (#5667's reasoning: unmoved
-- rows are adjacent-street coin flips, and the strict test keeps a label whose own street has closed from being
-- dragged onto a farther open one).
UPDATE label
SET street_edge_id = nearest_street.street_edge_id
FROM run_rows
INNER JOIN old_label_point_linear ON run_rows.label_point_id = old_label_point_linear.label_point_id
INNER JOIN label_point ON old_label_point_linear.label_point_id = label_point.label_point_id
INNER JOIN street_edge ON old_label_point_linear.street_edge_id = street_edge.street_edge_id
CROSS JOIN LATERAL (
  -- The street_edge inside this subquery is its own, the outer one is the label's current street.
  SELECT candidate_streets.street_edge_id, candidate_streets.geom
  FROM (
    SELECT street_edge.street_edge_id, street_edge.geom
    FROM street_edge
    WHERE street_edge.status = 'open'
    ORDER BY street_edge.geom <-> label_point.geom
    LIMIT 50
  ) candidate_streets
  ORDER BY ST_DistanceSphere(candidate_streets.geom, label_point.geom)
  LIMIT 1
) nearest_street
WHERE label.label_id = old_label_point_linear.label_id
  AND label_point.lat IS NOT NULL
  AND (old_label_point_linear.lat IS NULL
       OR old_label_point_linear.lat <> label_point.lat OR old_label_point_linear.lng <> label_point.lng)
  AND label.street_edge_id <> nearest_street.street_edge_id
  AND ST_DistanceSphere(nearest_street.geom, label_point.geom)
    < ST_DistanceSphere(street_edge.geom, label_point.geom);

-- 377's offset must follow the position and the street (docs/evolutions.md). #5667 moved rows without doing so.
UPDATE label_point
SET centerline_offset_m = label_centerline_offset_m(label_point.geom, street_edge.geom)
FROM label, street_edge
WHERE label.label_id = label_point.label_id
  AND street_edge.street_edge_id = label.street_edge_id
  AND label_point.geom IS NOT NULL
  AND (EXISTS (SELECT 1 FROM run_rows WHERE run_rows.label_point_id = label_point.label_point_id)
       OR EXISTS (SELECT 1 FROM old_label_point_coords_2
                  WHERE old_label_point_coords_2.label_point_id = label_point.label_point_id))
  AND label_point.centerline_offset_m IS DISTINCT FROM label_centerline_offset_m(label_point.geom, street_edge.geom);

-- ---------------------------------------------------------------------------------------------------------------
-- Part 4. Votes cast on a marker drawn 30 px or more off (355's threshold, 4190's removal, 355's archive).
-- ---------------------------------------------------------------------------------------------------------------
-- Human votes as 355 defines them, on the label's current type only: a vote on a type it no longer has counts
-- for nothing, and the archive holds one row per (user, label). Comments stay (text, not a verdict).
-- mission.labels_validated stays, as in 4190.
CREATE TEMP TABLE voided_now (label_validation_id INT PRIMARY KEY, label_id INT NOT NULL, user_id TEXT NOT NULL)
  ON COMMIT DROP;
INSERT INTO voided_now
SELECT label_validation.label_validation_id, label_validation.label_id, label_validation.user_id
FROM run_rows
INNER JOIN old_label_point_linear ON run_rows.label_point_id = old_label_point_linear.label_point_id
INNER JOIN label ON old_label_point_linear.label_id = label.label_id
INNER JOIN label_validation ON label.label_id = label_validation.label_id
WHERE old_label_point_linear.old_render_error_px >= 30
  AND label_validation.label_type = label.label_type
  AND label_validation.source <> 'SidewalkAI'
  AND NOT EXISTS (
    SELECT 1 FROM sidewalk_login.user_role
    WHERE user_role.role = 'AI' AND user_role.user_id = label_validation.user_id
  );

-- The archive keeps the app's work-credit totals whole (FilteredTables counts voided votes). Its shape is 355's,
-- so the vote's edit, if any, fills old_/new_ severity and tags, else the label's own state fills both. The
-- PRIMARY KEY is the one-to-one assert on the LEFT JOINs.
INSERT INTO voided_label_validation (label_validation_id, label_id, validation_result, user_id, mission_id, canvas_x,
                                     canvas_y, heading, pitch, zoom, canvas_height, canvas_width, start_timestamp,
                                     end_timestamp, source, old_severity, new_severity, old_tags, new_tags,
                                     viewer_type, old_render_error_px, label_ai_assessment_id, old_history_id,
                                     old_history_edit_time, old_history_tags)
SELECT label_validation.label_validation_id, label_validation.label_id, label_validation.validation_result,
       label_validation.user_id, label_validation.mission_id, label_validation.canvas_x, label_validation.canvas_y,
       label_validation.heading, label_validation.pitch, label_validation.zoom, label_validation.canvas_height,
       label_validation.canvas_width, label_validation.start_timestamp, label_validation.end_timestamp,
       label_validation.source,
       CASE WHEN label_edit.label_edit_id IS NULL THEN label.severity ELSE label_edit.old_severity END,
       CASE WHEN label_edit.label_edit_id IS NULL THEN label.severity ELSE label_edit.new_severity END,
       COALESCE(label_edit.old_tags, label.tags), COALESCE(label_edit.new_tags, label.tags),
       label_validation.viewer_type, old_label_point_linear.old_render_error_px,
       label_ai_assessment.label_ai_assessment_id,
       label_history.label_history_id, label_history.edit_time, label_history.tags
FROM voided_now
INNER JOIN label_validation ON voided_now.label_validation_id = label_validation.label_validation_id
INNER JOIN label ON label_validation.label_id = label.label_id
INNER JOIN old_label_point_linear ON label.label_id = old_label_point_linear.label_id
LEFT JOIN label_edit ON label_edit.label_validation_id = label_validation.label_validation_id
LEFT JOIN label_history ON label_history.label_edit_id = label_edit.label_edit_id
LEFT JOIN label_ai_assessment ON label_ai_assessment.label_validation_id = label_validation.label_validation_id;

-- Assessments are model outputs and stay: only the reference to a deleted vote is nulled (4190, 355).
UPDATE label_ai_assessment
SET label_validation_id = NULL
WHERE label_validation_id IN (SELECT label_validation_id FROM voided_now);

CREATE TEMP TABLE edits_to_remove (label_edit_id INT PRIMARY KEY, label_id INT NOT NULL) ON COMMIT DROP;
INSERT INTO edits_to_remove
SELECT label_edit_id, label_id FROM label_edit
WHERE label_validation_id IN (SELECT label_validation_id FROM voided_now);

DELETE FROM label_history WHERE label_edit_id IN (SELECT label_edit_id FROM edits_to_remove);
DELETE FROM label_edit WHERE label_edit_id IN (SELECT label_edit_id FROM edits_to_remove);
DELETE FROM label_validation WHERE label_validation_id IN (SELECT label_validation_id FROM voided_now);

-- 4190's chain repair with the type in the state, as LabelEditService.revertEdit has it: each surviving edit
-- starts from the history row before it, one that now changes nothing goes, and the label takes its latest row.
CREATE TEMP TABLE rebased_edits ON COMMIT DROP AS
SELECT label_edit.label_edit_id, ordered.prev_label_type, ordered.prev_severity, ordered.prev_tags,
       (label_edit.new_label_type = ordered.prev_label_type
        AND label_edit.new_severity IS NOT DISTINCT FROM ordered.prev_severity
        AND label_edit.new_tags <@ ordered.prev_tags AND ordered.prev_tags <@ label_edit.new_tags) AS noop
FROM (
  SELECT label_edit_id,
         LAG(label_type) OVER per_label AS prev_label_type,
         LAG(severity) OVER per_label AS prev_severity,
         LAG(tags) OVER per_label AS prev_tags
  FROM label_history
  WHERE label_id IN (SELECT label_id FROM edits_to_remove)
  WINDOW per_label AS (PARTITION BY label_id ORDER BY edit_time, label_history_id)
) AS ordered
INNER JOIN label_edit ON ordered.label_edit_id = label_edit.label_edit_id
WHERE ordered.prev_tags IS NOT NULL
  AND (label_edit.old_label_type <> ordered.prev_label_type
       OR label_edit.old_severity IS DISTINCT FROM ordered.prev_severity
       OR NOT (label_edit.old_tags <@ ordered.prev_tags AND ordered.prev_tags <@ label_edit.old_tags));

DELETE FROM label_history WHERE label_edit_id IN (SELECT label_edit_id FROM rebased_edits WHERE noop);
DELETE FROM label_edit WHERE label_edit_id IN (SELECT label_edit_id FROM rebased_edits WHERE noop);

UPDATE label_edit
SET old_label_type = rebased_edits.prev_label_type,
    old_severity = rebased_edits.prev_severity,
    old_tags = rebased_edits.prev_tags
FROM rebased_edits
WHERE rebased_edits.label_edit_id = label_edit.label_edit_id AND NOT rebased_edits.noop;

UPDATE label
SET label_type = latest.label_type,
    severity = latest.severity,
    tags = latest.tags
FROM (
  SELECT DISTINCT ON (label_id) label_id, label_type, severity, tags
  FROM label_history
  WHERE label_id IN (SELECT label_id FROM edits_to_remove)
  ORDER BY label_id, edit_time DESC, label_history_id DESC
) AS latest
WHERE latest.label_id = label.label_id
  AND (label.label_type <> latest.label_type OR label.severity IS DISTINCT FROM latest.severity
       OR NOT (label.tags <@ latest.tags AND latest.tags <@ label.tags));

-- LabelTable.recalculateValidationCounts's per-vote rule (FilteredTables.isVerdictVote), verbatim.
UPDATE label
SET (agree_count, disagree_count, unsure_count, correct) = (n_agree, n_disagree, n_unsure, is_correct)
FROM (
  SELECT label.label_id,
         COUNT(*) FILTER (WHERE label_validation.validation_result = 'Agree') AS n_agree,
         COUNT(*) FILTER (WHERE label_validation.validation_result = 'Disagree') AS n_disagree,
         COUNT(*) FILTER (WHERE label_validation.validation_result = 'Unsure') AS n_unsure,
         CASE WHEN COUNT(*) FILTER (WHERE label_validation.validation_result = 'Agree')
                 > COUNT(*) FILTER (WHERE label_validation.validation_result = 'Disagree') THEN TRUE
              WHEN COUNT(*) FILTER (WHERE label_validation.validation_result = 'Disagree')
                 > COUNT(*) FILTER (WHERE label_validation.validation_result = 'Agree') THEN FALSE
              END AS is_correct
  FROM label
  LEFT JOIN label_validation ON label.label_id = label_validation.label_id
    AND label_validation.user_id <> label.user_id
    AND label_validation.label_type = label.label_type
    AND NOT EXISTS (SELECT 1 FROM user_stat
                    WHERE user_stat.user_id = label_validation.user_id AND user_stat.excluded)
  WHERE EXISTS (SELECT 1 FROM voided_now WHERE voided_now.label_id = label.label_id)
  GROUP BY label.label_id
) AS validation_count
WHERE label.label_id = validation_count.label_id;

-- UserStatTable.updateAccuracy (FilteredTables.accuracyLabels) and computedHighQuality (347's SQL copy), verbatim.
UPDATE user_stat
SET own_labels_validated = COALESCE(recomputed.new_validated_count, 0),
    accuracy = recomputed.new_accuracy
FROM (
  SELECT affected_labeler.user_id,
         CAST(SUM(CASE WHEN label.correct THEN 1 ELSE 0 END) AS FLOAT)
           / NULLIF(SUM(CASE WHEN label.correct THEN 1 ELSE 0 END)
                    + SUM(CASE WHEN NOT label.correct THEN 1 ELSE 0 END), 0) AS new_accuracy,
         COUNT(CASE WHEN label.correct IS NOT NULL THEN 1 END) AS new_validated_count
  FROM (SELECT DISTINCT label.user_id FROM label
        INNER JOIN voided_now ON label.label_id = voided_now.label_id) AS affected_labeler
  LEFT JOIN (
    SELECT label.user_id, label.correct
    FROM label
    INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
    WHERE (NOT label.deleted OR (label.deleted_source <> 'Explore' AND label.correct = FALSE))
      AND label.tutorial = FALSE
      AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
      AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
  ) AS label ON label.user_id = affected_labeler.user_id
  GROUP BY affected_labeler.user_id
) AS recomputed
WHERE user_stat.user_id = recomputed.user_id;

UPDATE user_stat
SET high_quality =
  NOT excluded
  AND COALESCE(high_quality_manual, TRUE)
  AND (COALESCE(high_quality_manual, FALSE)
       OR ((meters_audited = 0 OR COALESCE(labels_per_meter, 5) > 0.0375)
           AND (COALESCE(accuracy, 1.0) > 0.6 OR own_labels_validated < 50)))
FROM (SELECT DISTINCT label.user_id FROM label
      INNER JOIN voided_now ON label.label_id = voided_now.label_id) AS affected_labeler
WHERE user_stat.user_id = affected_labeler.user_id AND NOT user_stat.excluded;

SELECT 'records re-aimed this run' AS what, count(*) FROM run_rows;
SELECT 'votes voided this run' AS what, count(*) FROM voided_now;
SELECT 'human votes on another type of these labels, left alone' AS what, count(*) FROM run_rows
INNER JOIN old_label_point_linear USING (label_point_id) INNER JOIN label USING (label_id)
INNER JOIN label_validation USING (label_id)
WHERE old_label_point_linear.old_render_error_px >= 30 AND label_validation.label_type <> label.label_type
  AND label_validation.source <> 'SidewalkAI';
SELECT 'edits removed with them' AS what, count(*) FROM edits_to_remove;
SELECT 'old render error px: median, p90, share >= 30' AS what,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY old_render_error_px),
       percentile_cont(0.9) WITHIN GROUP (ORDER BY old_render_error_px),
       avg((old_render_error_px >= 30)::int)
FROM run_rows INNER JOIN old_label_point_linear USING (label_point_id);
SELECT 'pano_x/pano_y written this run' AS what, count(*) FROM run_rows
INNER JOIN old_label_point_linear USING (label_point_id) INNER JOIN label_point USING (label_point_id)
WHERE label_point.pano_x <> old_label_point_linear.pano_x OR label_point.pano_y <> old_label_point_linear.pano_y;
SELECT 'positions recomputed this run' AS what, count(*) FROM run_rows
INNER JOIN old_label_point_linear USING (label_point_id) INNER JOIN label_point USING (label_point_id)
WHERE label_point.lat IS DISTINCT FROM old_label_point_linear.lat
   OR label_point.lng IS DISTINCT FROM old_label_point_linear.lng;
SELECT 'labels reattached this run' AS what, count(*) FROM run_rows
INNER JOIN old_label_point_linear USING (label_point_id) INNER JOIN label USING (label_id)
WHERE label.street_edge_id <> old_label_point_linear.street_edge_id;
SELECT 'labels still legacy (not tutorial)' AS what, count(*) FROM label_point
INNER JOIN label USING (label_id) INNER JOIN old_label_metadata USING (label_id)
WHERE NOT label.tutorial AND label_point.pano_x = old_label_metadata.old_pano_x
  AND label_point.pano_y = old_label_metadata.old_pano_y;
SELECT 'label positions still NULL' AS what, count(*) FROM label_point WHERE lat IS NULL;

\if :apply
  COMMIT;
\else
  ROLLBACK;
\endif
