# --- !Ups
-- #4818: recompute every stored 'approximation2' label position with the 'approximation3' estimator (#4765/#4766)
-- that live submissions run, and stamp the rows accordingly. All of the estimator's inputs are already stored
-- (label_point.pano_x/pano_y plus pano_data lat/lng/camera_heading/width/height), so the whole recompute is SQL: a
-- statement-for-statement port of PanoDataService.calculatePovFromPanoXY, PanoDataService.estimateDistanceFromPanoM,
-- and CommonUtils.calculateDestination (spherical haversine on R = 6371 km, matching the app bit-for-bit rather than
-- the geodesic ST_Project), so an independent recompute of every row (tools/verify_latlng_backfill.py) agrees to
-- float noise. Constant provenance: the LatLngEstimation scaladoc and the label-latlng-estimation repo reports it
-- links. 'depth' rows hold positions measured from GSV depth data, better than any estimate, and are untouched.
-- Rows without usable pano_data metadata keep 'approximation2', so computation_method stays honest about which
-- estimator produced each stored position.
--
-- Not done here, and deliberately: label clusters are NOT invalidated. ClusteringSessionTable.getRegionsToCluster
-- picks regions by comparing which labels *should* be clustered against which ones *are*, so moving a label the
-- clusterer already knows about flags nothing, and neither the nightly ClusteringActor nor an admin /runClustering
-- will revisit it (#4818 review). Forcing a full re-cluster means emptying clustering_session (cascades to cluster
-- and cluster_label) so every region reads as unclustered -- but that also empties the clusters the Access Score and
-- attribute APIs serve until each region is rebuilt, which is a deploy-time operator decision about a visible
-- outage, not something an evolution should do to 54 schemas on its own. It is a rollout step, tracked on #4818.

-- Backup of every row this evolution modifies, so the Down is a lossless restore-from-copy rather than a formula
-- replay (179.sql precedent). computation_method is TEXT here so this table cannot block the enum rebuild below.
-- street_edge_id is captured for every backed-up label, since the reattachment below sweeps the whole population.
CREATE TABLE old_label_point_position (
    label_point_id INT PRIMARY KEY REFERENCES label_point (label_point_id),
    label_id INT NOT NULL UNIQUE REFERENCES label (label_id),
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    geom geometry,
    computation_method TEXT NOT NULL,
    street_edge_id INT NOT NULL REFERENCES street_edge (street_edge_id)
);
ALTER TABLE old_label_point_position OWNER TO sidewalk;

-- The recompute set: 'approximation2' rows with usable pano metadata. Every needed pano_data field is nullable and a
-- pano_data row can be missing outright, so the inner join plus NOT NULL and positive-dimension guards define who is
-- recomputed -- the UPDATE below drives off this table, so backed-up set and modified set are identical by
-- construction. Comparing computation_method to 'approximation2' (a long-standing value) is safe even when 349.sql
-- is pending in this same transaction -- the in-transaction restriction covers only a newly added value.
INSERT INTO old_label_point_position
    (label_point_id, label_id, lat, lng, geom, computation_method, street_edge_id)
SELECT label_point.label_point_id, label.label_id, label_point.lat, label_point.lng, label_point.geom,
       label_point.computation_method::text, label.street_edge_id
FROM label_point
INNER JOIN label ON label_point.label_id = label.label_id
INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
WHERE label_point.computation_method = 'approximation2'
    AND pano_data.lat IS NOT NULL
    AND pano_data.lng IS NOT NULL
    AND pano_data.camera_heading IS NOT NULL
    AND pano_data.width IS NOT NULL AND pano_data.width > 0
    AND pano_data.height IS NOT NULL AND pano_data.height > 0;

-- Rebuild the enum rather than using the value 349.sql added: evolutions share one transaction (autocommit=false in
-- application.conf), so on a database where 349 is still pending both files apply together and naming
-- 'approximation3' -- even as a text-to-enum cast -- fails with "unsafe use of new value". A type created inside the
-- current transaction carries no such restriction (342.sql mechanics, mandated by 349.sql's comment). The recompute
-- UPDATE below runs while the column is plain text, touching no enum machinery at all. label_point.computation_method
-- is the type's only column anywhere, so this is the whole rebuild.
ALTER TABLE label_point ALTER COLUMN computation_method TYPE TEXT USING computation_method::text;
DROP TYPE computation_method;
CREATE TYPE computation_method AS ENUM ('depth', 'approximation2', 'approximation3');

-- The recompute itself. Each CTE is one stage of the Scala pipeline it is named for, and every fitted constant
-- appears exactly once in the constants CTE, so a refit (for example, if the absolute-scale question in
-- label-latlng-estimation#7 resolves against the current camera height) re-runs this same UPDATE as a later
-- evolution with one changed literal.
WITH constants AS (
    -- PanoDataService.LatLngEstimation and CommonUtils.EARTH_RADIUS_KM, verbatim.
    SELECT 2.341219672825709::float8 AS camera_height_m,
           11.25::float8 AS blend_deg,
           50.0::float8 AS max_distance_m,
           6371.0::float8 AS earth_radius_km
), recompute_inputs AS (
    SELECT old_label_point_position.label_point_id,
           pano_data.lat AS pano_lat, pano_data.lng AS pano_lng, pano_data.camera_heading,
           pano_data.width, pano_data.height, label_point.pano_x, label_point.pano_y
    FROM old_label_point_position
    INNER JOIN label_point ON old_label_point_position.label_point_id = label_point.label_point_id
    INNER JOIN label ON label_point.label_id = label.label_id
    INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
), angles AS (
    -- calculatePovFromPanoXY: depression below the horizon from the pixel row, bearing from the pixel column (pixel
    -- column zero looks 180 degrees behind the camera). mod(numeric, numeric) keeps the dividend's sign exactly like
    -- Scala's %, so a westward heading can leave the bearing negative -- harmless, it only ever feeds sin and cos.
    -- The float8 casts and leading float literals block integer division.
    SELECT label_point_id, pano_lat, pano_lng,
           180.0 * pano_y / height - 90.0 AS depression_deg,
           mod((camera_heading - 180.0 + (pano_x::float8 / width) * 360.0)::numeric, 360.0)::float8 AS bearing_deg
    FROM recompute_inputs
), distances AS (
    -- estimateDistanceFromPanoM: flat-ground cotangent at or steeper than blend_deg, then a linear tail with matched
    -- value and slope, held flat above the horizon (GREATEST) and capped (LEAST -- cannot bind at this height, kept
    -- so the estimate is bounded by construction). angular_dist is the haversine input, distance over Earth radius.
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
    -- CommonUtils.calculateDestination, latitude half. The LEAST/GREATEST clamp is the one deliberate deviation from
    -- the Scala (whose asin would yield NaN) -- it can only engage within float error of a pole, where no imagery
    -- exists, and keeps the statement total instead of erroring mid-apply.
    SELECT label_point_id, pano_lat, pano_lng, bearing_deg, angular_dist,
           asin(LEAST(1.0, GREATEST(-1.0,
               sin(radians(pano_lat)) * cos(angular_dist)
                   + cos(radians(pano_lat)) * sin(angular_dist) * cos(radians(bearing_deg))
           ))) AS new_lat_rad
    FROM distances
), new_positions AS (
    -- Longitude half. Like the Scala, the result is not wrapped into [-180, 180]: it could only escape for a pano
    -- within ~24 m of the antimeridian, no deployed city is within hundreds of km of one, and the table's
    -- label_point_lat_lng_check constraint would fail this evolution loudly rather than store a wrapped-out value.
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

ALTER TABLE label_point
    ALTER COLUMN computation_method TYPE computation_method USING computation_method::computation_method;

-- Reattach every backfilled label to the street nearest its corrected position. Both authorship paths pick
-- street_edge_id at submission time as the open street (tutorial street included) nearest the *estimated* position --
-- crowd labels since 8713a521e (Feb 2019) via ExploreService.insertLabel, AI labels via
-- ExploreService.submitAiLabelData, both calling LabelTable.getStreetEdgeIdClosestToLatLng -- so the attachment
-- follows the position for the whole population rather than the AI slice alone (#4818 review). Labels whose stored
-- position was NULL are skipped: those took the audit task's own street at insert instead of a computed one, so
-- their attachment never derived from the estimator and must not be replaced by a guess.
--
-- The exactness argument for the prefilter: PostGIS's <-> on geometry is planar distance in degrees, so it ranks by
-- sqrt(dlat^2 + dlng^2) while the app ranks by true distance, which scales dlng by cos(latitude). A street can
-- therefore only beat the degree-nearest one on the sphere if its degree distance is under 1/cos(latitude) times the
-- minimum -- a factor of 2 at 60 degrees, past every deployed city. Fifty candidates is far more street edges than
-- can pass within twice a label's nearest-street distance (metres to tens of metres) at any real street density, and
-- the verifier's companion query re-derives every attachment with a ten-times-wider window (expect 0 disagreements).
UPDATE label
SET street_edge_id = nearest_street.street_edge_id
FROM old_label_point_position
INNER JOIN label_point ON old_label_point_position.label_point_id = label_point.label_point_id
CROSS JOIN LATERAL (
    SELECT candidate_streets.street_edge_id
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
WHERE label.label_id = old_label_point_position.label_id
    AND old_label_point_position.lat IS NOT NULL
    AND old_label_point_position.lng IS NOT NULL
    AND label.street_edge_id <> nearest_street.street_edge_id;

# --- !Downs
-- Restore every modified row byte-for-byte from the backup. Labels created after the Up ran are absent from the
-- backup and correctly keep their live-computed values. label.street_edge_id is insert-only in the app (no code path
-- updates it), so restoring the backed-up value cannot overwrite anything that happened between Up and Down. The
-- inequality is only there to skip no-op rows. The enum keeps all three values -- the running app writes
-- 'approximation3', and 349.sql's Down already declines the rebuild that removing a value would take.
UPDATE label
SET street_edge_id = old_label_point_position.street_edge_id
FROM old_label_point_position
WHERE label.label_id = old_label_point_position.label_id
    AND label.street_edge_id <> old_label_point_position.street_edge_id;

UPDATE label_point
SET lat = old_label_point_position.lat,
    lng = old_label_point_position.lng,
    geom = old_label_point_position.geom,
    computation_method = old_label_point_position.computation_method::computation_method
FROM old_label_point_position
WHERE label_point.label_point_id = old_label_point_position.label_point_id;

DROP TABLE old_label_point_position;
