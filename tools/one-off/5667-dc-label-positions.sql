-- #5667: give Washington DC's labels the coordinates evolution 179 never computed for them.
--
-- Written against evolution 413 (v11.17.0). ONE schema (sidewalk_dc), a write role. Preview with apply=0 (the
-- default: prints every count, then rolls back), apply with apply=1. Writes only where a value is missing or still
-- legacy, so a rerun after more dimensions arrive converts just the newly reachable labels. Not for
-- run-query-in-every-city.sh (read-only runner). Undo: 5667-undo-dc-label-positions.sql.
--
-- The main transaction holds row locks on every converted label_point/label row for its ~90 s and the backup table
-- is created in its own short transaction (its foreign keys take a share lock on label, label_point and
-- street_edge that would otherwise block writes to DC for the whole run). Run it at a quiet hour anyway.
--
-- Run first (read-only, produce the two CSVs this script loads):
--   1. 5667-dc-store-dims.py on the scraper box against /mnt/panostore/washington-dc -> 5667-dc-store.csv
--      (every stored pano's JPEG size, cbk XML sidecar fields and ledger verdict).
--   2. 5667-fetch-photometa.py for the panos the store lacks -> photometa CSVs.
--   3. 5667-join-dims.py -> 5667-dc-dims.csv (one size per pano, sidecar > photometa > JPEG header, conflicts
--      reported and left out). A pano never changes size, so the sources must agree wherever they overlap.
--
--   psql "dbname=sidewalk options=--search_path=sidewalk_dc,public" -U sidewalk_dc -v ON_ERROR_STOP=1 \
--     -v dims=5667-dc-dims.csv -v store=5667-dc-store.csv -v apply=0 -f tools/one-off/5667-dc-label-positions.sql
--
-- WHY. DC's 2018 fork nulled every pano width the day its 179 backport ran, so 179 converted nothing there and the
-- #4700 migration replayed 179, 352 and 366 as no-ops: every DC label still holds the legacy horizon-centred
-- coordinates (negative pano_y), which keeps it out of crops, AI validation and the position estimator. Part 1
-- fills pano_data from the store and photometa; part 2 is evolution 366's parts 2 and 3 verbatim, with its own
-- backup table. Tutorial labels stay as they are (#4587). Clusters are not invalidated (352/366 precedent): force
-- a re-cluster on DC afterwards (/runClustering?allRegions=true), then recompute user stats.

\if :{?apply}
\else
  \set apply 0
\endif
SET lock_timeout = '10s';

-- The backup table outlives the run: it is the undo record, and a rerun adds to it. Own transaction, see above.
CREATE TABLE IF NOT EXISTS old_label_point_coords_2 (
  label_point_id INT PRIMARY KEY REFERENCES label_point (label_point_id),
  label_id INT NOT NULL UNIQUE REFERENCES label (label_id),
  pano_x INT NOT NULL,
  pano_y INT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geom geometry,
  computation_method TEXT,
  street_edge_id INT NOT NULL REFERENCES street_edge (street_edge_id)
);

BEGIN;

-- ---------------------------------------------------------------------------------------------------------------
-- Part 1. Pano metadata from the store and photometa.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE dims_in (pano_id TEXT PRIMARY KEY, width INT, height INT, tile_width INT, tile_height INT,
                           source TEXT) ON COMMIT DROP;
\set copy_dims '\\copy dims_in FROM ' :'dims' ' WITH (FORMAT csv, HEADER true)'
:copy_dims

CREATE TEMP TABLE store_in (pano_id TEXT, folder TEXT, jpeg_w INT, jpeg_h INT, xml_w INT, xml_h INT, xml_tile_w INT,
                            xml_tile_h INT, xml_lat DOUBLE PRECISION, xml_lng DOUBLE PRECISION,
                            xml_orig_lat DOUBLE PRECISION, xml_orig_lng DOUBLE PRECISION, xml_yaw DOUBLE PRECISION,
                            xml_date TEXT, has_depth INT, log_downloaded TEXT) ON COMMIT DROP;
\set copy_store '\\copy store_in FROM ' :'store' ' WITH (FORMAT csv, HEADER true, NULL '''')'
:copy_store
ANALYZE dims_in;
ANALYZE store_in;

SELECT 'dims to fill' AS what, count(*) FROM pano_data INNER JOIN dims_in USING (pano_id)
WHERE pano_data.width IS NULL OR pano_data.height IS NULL;
SELECT 'capture_date to fill' AS what, count(*) FROM pano_data INNER JOIN store_in USING (pano_id)
WHERE pano_data.capture_date = '' AND store_in.xml_date ~ '^[0-9]{4}-[0-9]{2}$';
SELECT 'dims by source' AS what, source, count(*) FROM dims_in GROUP BY source;

UPDATE pano_data
SET width = COALESCE(pano_data.width, dims_in.width), height = COALESCE(pano_data.height, dims_in.height),
    tile_width = COALESCE(pano_data.tile_width, dims_in.tile_width),
    tile_height = COALESCE(pano_data.tile_height, dims_in.tile_height)
FROM dims_in
WHERE pano_data.pano_id = dims_in.pano_id AND (pano_data.width IS NULL OR pano_data.height IS NULL)
  AND dims_in.width > 0 AND dims_in.height > 0;

-- The migration's stub rows (360.pre) carry '' for capture_date.
UPDATE pano_data SET capture_date = store_in.xml_date
FROM store_in
WHERE pano_data.pano_id = store_in.pano_id AND pano_data.capture_date = ''
  AND store_in.xml_date ~ '^[0-9]{4}-[0-9]{2}$';

SELECT 'panos still without dims' AS what, count(*) FROM pano_data WHERE width IS NULL OR height IS NULL;
SELECT 'labelled panos still without dims' AS what, count(DISTINCT label.pano_id) FROM label
INNER JOIN pano_data ON label.pano_id = pano_data.pano_id WHERE pano_data.width IS NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- Part 2. The coordinate conversion 179 skipped, then the position recompute (evolution 366 parts 2 and 3).
-- ---------------------------------------------------------------------------------------------------------------
-- Earlier runs' rows fail the population test below, so every later statement drives off this run's rows only.
CREATE TEMP TABLE run_rows (label_point_id INT PRIMARY KEY) ON COMMIT DROP;

-- The population: labels whose coordinates still equal their pre-179 backup, on a pano that now has all four fields
-- 179's formula needs. old_label_metadata covers every label 179 could have reached, so this is exhaustive.
WITH inserted AS (
INSERT INTO old_label_point_coords_2
  (label_point_id, label_id, pano_x, pano_y, lat, lng, geom, computation_method, street_edge_id)
SELECT label_point.label_point_id, label.label_id, label_point.pano_x, label_point.pano_y,
       label_point.lat, label_point.lng, label_point.geom, label_point.computation_method::text,
       label.street_edge_id
FROM old_label_metadata
INNER JOIN label_point ON old_label_metadata.label_id = label_point.label_id
INNER JOIN label ON label_point.label_id = label.label_id
INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
WHERE NOT label.tutorial
  AND label_point.pano_x = old_label_metadata.old_pano_x
  AND label_point.pano_y = old_label_metadata.old_pano_y
  -- The pano_x expression ends in `% pano_data.width` and nothing keeps these above zero, so a stored zero would
  -- abort the whole script with a division by zero.
  AND pano_data.width IS NOT NULL AND pano_data.width > 0
  AND pano_data.height IS NOT NULL AND pano_data.height > 0
  AND pano_data.camera_heading IS NOT NULL AND pano_data.camera_heading <> 'NaN'
  AND pano_data.camera_pitch IS NOT NULL AND pano_data.camera_pitch <> 'NaN'
RETURNING label_point_id
)
INSERT INTO run_rows SELECT label_point_id FROM inserted;

-- 179's conversion, copied verbatim from 179.sql so the labels it skipped get exactly what the ones it reached got.
-- It reads only the labeller's own viewport record (canvas_x/y, heading, pitch, zoom), which 179 never touched, so
-- this is a true replay. Spot-checked on DC imagery in #5667.
UPDATE label_point
SET pano_x = (pano_data.width + ROUND(pano_data.width * (((atan2((360 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END) * PI() / 180))*cos((label_point.pitch * PI() / 180.0)) * sin((label_point.heading * PI() / 180.0)) + (label_point.canvas_x - 360) * SIGN(cos((label_point.pitch * PI() / 180.0))) * cos((label_point.heading * PI() / 180.0)) + (240 - label_point.canvas_y) * -sin((label_point.pitch * PI() / 180.0)) * sin((label_point.heading * PI() / 180.0)), (360 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END) * PI() / 180)) * cos((label_point.pitch * PI() / 180.0)) * cos((label_point.heading * PI() / 180.0)) + (label_point.canvas_x - 360) * -SIGN(cos((label_point.pitch * PI() / 180.0))) * sin((label_point.heading * PI() / 180.0)) + (240 - label_point.canvas_y) * -sin((label_point.pitch * PI() / 180.0)) * cos((label_point.heading * PI() / 180.0))) * 180.0 / PI())::DECIMAL % 360 + 360)::DECIMAL % 360 - (pano_data.camera_heading + 180)::DECIMAL % 360) / 360)) % pano_data.width,
    pano_y = (pano_data.height / 2) - ROUND((pano_data.height / 2) * ((asin(((0.5 * 720 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * sin((label_point.pitch * PI() / 180.0)) + (480 / 2 - label_point.canvas_y) * cos((label_point.pitch * PI() / 180.0))) / sqrt(((0.5 * 720 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * cos((label_point.pitch * PI() / 180.0)) * sin((label_point.heading * PI() / 180.0)) + (label_point.canvas_x - 720 / 2) * SIGN(cos((label_point.pitch * PI() / 180.0))) * cos((label_point.heading * PI() / 180.0)) + (480 / 2 - label_point.canvas_y) * -sin((label_point.pitch * PI() / 180.0)) * sin((label_point.heading * PI() / 180.0)))^2 + ((0.5 * 720 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * cos((label_point.pitch * PI() / 180.0)) * cos((label_point.heading * PI() / 180.0)) + (label_point.canvas_x - 720 / 2) * -SIGN(cos((label_point.pitch * PI() / 180.0))) * sin((label_point.heading * PI() / 180.0)) + (480 / 2 - label_point.canvas_y) * -sin((label_point.pitch * PI() / 180.0)) * cos((label_point.heading * PI() / 180.0)))^2 + ((0.5 * 720 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * sin((label_point.pitch * PI() / 180.0)) + (480 / 2 - label_point.canvas_y) * cos((label_point.pitch * PI() / 180.0)))^ 2)) * 180.0 / PI()) / 90))
FROM run_rows
INNER JOIN old_label_point_coords_2 ON run_rows.label_point_id = old_label_point_coords_2.label_point_id
INNER JOIN label ON old_label_point_coords_2.label_id = label.label_id
INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
WHERE label_point.label_point_id = old_label_point_coords_2.label_point_id;

-- 352's recompute, statement for statement, restricted to the labels just moved that carry an estimated position.
-- 'depth' rows are measured positions and are left alone.
WITH constants AS (
  -- PanoDataService.LatLngEstimation and CommonUtils.EARTH_RADIUS_KM, verbatim.
  SELECT 2.341219672825709::float8 AS camera_height_m,
         11.25::float8 AS blend_deg,
         50.0::float8 AS max_distance_m,
         6371.0::float8 AS earth_radius_km
), recompute_inputs AS (
  SELECT old_label_point_coords_2.label_point_id,
         pano_data.lat AS pano_lat, pano_data.lng AS pano_lng, pano_data.camera_heading,
         pano_data.width, pano_data.height, label_point.pano_x, label_point.pano_y
  FROM run_rows
  INNER JOIN old_label_point_coords_2 ON run_rows.label_point_id = old_label_point_coords_2.label_point_id
  INNER JOIN label_point ON old_label_point_coords_2.label_point_id = label_point.label_point_id
  INNER JOIN label ON label_point.label_id = label.label_id
  INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
  -- 'approximation3' too: 352 may have recomputed a skipped label from its still-legacy pixels and stamped it so.
  -- Every row here held pre-179 coordinates by construction, so there is no correct 'approximation3' to clobber.
  WHERE old_label_point_coords_2.computation_method IN ('approximation2', 'approximation3')
    AND pano_data.lat IS NOT NULL
    AND pano_data.lng IS NOT NULL
    AND pano_data.camera_heading IS NOT NULL
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

-- Reattach to the nearest open street, as the app does at submission (352/366), but only labels whose position this
-- run changed or created. Unlike 366 the unmoved rows are left alone: on DC the strictly-closer sweep would re-file
-- 20,098 labels whose position did not change for a median gain of 0.76 m, adjacent-street coin flips. The rows
-- that HAD no position are included on purpose: DC's legacy nearest-street assignment filed them from garbage
-- coordinates (3,435 labels on 3 streets a median 8.5 km from their pano). The strictly-closer test keeps a label
-- whose own street has since closed from being dragged onto a farther open one.
UPDATE label
SET street_edge_id = nearest_street.street_edge_id
FROM run_rows
INNER JOIN old_label_point_coords_2 ON run_rows.label_point_id = old_label_point_coords_2.label_point_id
INNER JOIN label_point ON old_label_point_coords_2.label_point_id = label_point.label_point_id
INNER JOIN street_edge AS current_street
  ON old_label_point_coords_2.street_edge_id = current_street.street_edge_id
CROSS JOIN LATERAL (
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
WHERE label.label_id = old_label_point_coords_2.label_id
  AND label_point.lat IS NOT NULL
  AND (old_label_point_coords_2.lat IS NULL
       OR old_label_point_coords_2.lat <> label_point.lat OR old_label_point_coords_2.lng <> label_point.lng)
  AND label.street_edge_id <> nearest_street.street_edge_id
  AND ST_DistanceSphere(nearest_street.geom, label_point.geom)
    < ST_DistanceSphere(current_street.geom, label_point.geom);

SELECT 'labels converted this run' AS what, count(*) FROM run_rows;
SELECT 'positions recomputed this run' AS what, count(*) FROM run_rows
INNER JOIN label_point USING (label_point_id) WHERE label_point.computation_method = 'approximation3';
SELECT 'labels reattached this run' AS what, count(*) FROM run_rows
INNER JOIN old_label_point_coords_2 USING (label_point_id) INNER JOIN label USING (label_id)
WHERE label.street_edge_id <> old_label_point_coords_2.street_edge_id;
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
