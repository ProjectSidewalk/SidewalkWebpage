-- =====================================================================================================================
-- Disable the streets of some open regions that lie outside a partner's study area (#5950). Written against
-- evolution 430, for Beringen's launch: Velph's ~22 km study area covered parts of four neighborhoods.
--
-- A street is kept when at least half of it is inside the area, or when 90% of it lies within 10 m of the area's
-- edge (a street the partner drew the line along). Only open streets change: no_imagery ones keep the scan's verdict,
-- so every disabled street has imagery, and opening more of the city later is just disabled -> open, with no rescan.
-- Disabled streets are never reopened by an imagery rescan or a region reveal. Each change is logged in
-- street_edge_status_change as remove_streets.
--
-- Run it on the onboarding schema before the dump. Inputs: the area as a lon/lat WKT, and the open regions to trim.
-- DRY RUN BY DEFAULT: prints kept/disabled per region and rolls back; -v apply=1 commits.
--   docker exec -i projectsidewalk-db psql "dbname=sidewalk options=--search_path=sidewalk_beringen_be,public" \
--     -U sidewalk_beringen_be -v regions=11,13,14,21 -v apply=0 \
--     -v study_wkt="$(cat db/onboarding/beringen-be/source/study_area.wkt)" \
--     -f - < tools/one-off/5950-disable-streets-outside-study-area.sql
-- =====================================================================================================================

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

BEGIN;

CREATE TEMP TABLE study_area ON COMMIT DROP AS
SELECT ST_GeomFromText(:'study_wkt', 4326) AS geom;

CREATE TEMP TABLE street_fit ON COMMIT DROP AS
SELECT street_edge.street_edge_id,
       street_edge_region.region_id,
       ST_Length(street_edge.geom::geography) AS length_m,
       street_edge.status = 'open'
           AND ST_Length(ST_Intersection(street_edge.geom, study_area.geom)::geography)
               / ST_Length(street_edge.geom::geography) < 0.5
           AND ST_Length(ST_Intersection(street_edge.geom,
                                         ST_Buffer(ST_Boundary(study_area.geom)::geography, 10)::geometry)::geography)
               / ST_Length(street_edge.geom::geography) < 0.9 AS to_disable
FROM street_edge
JOIN street_edge_region ON street_edge_region.street_edge_id = street_edge.street_edge_id
CROSS JOIN study_area
WHERE street_edge_region.region_id IN (:regions);

SELECT region_id,
       COUNT(*) FILTER (WHERE NOT to_disable) AS kept,
       ROUND(SUM(length_m) FILTER (WHERE NOT to_disable)::numeric / 1000, 2) AS kept_km,
       COUNT(*) FILTER (WHERE to_disable) AS disabled,
       ROUND(SUM(length_m) FILTER (WHERE to_disable)::numeric / 1000, 2) AS disabled_km
FROM street_fit
GROUP BY region_id
ORDER BY region_id;

WITH changed AS (
    UPDATE street_edge
    SET status = 'disabled'
    WHERE street_edge_id IN (SELECT street_edge_id FROM street_fit WHERE to_disable)
    RETURNING street_edge_id
)
INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
SELECT street_edge_id, 'open'::street_edge_status, 'disabled'::street_edge_status,
       'remove_streets'::street_edge_status_change_source
FROM changed;

-- A disabled street is never routed to, so it needs no priority or reopen check; completion is recomputed.
DELETE FROM street_edge_priority WHERE street_edge_id IN (SELECT street_edge_id FROM street_fit WHERE to_disable);
DELETE FROM street_reopen_candidate WHERE street_edge_id IN (SELECT street_edge_id FROM street_fit WHERE to_disable);
TRUNCATE TABLE region_completion;

SELECT status, COUNT(*), ROUND(SUM(ST_Length(geom::geography))::numeric / 1000, 2) AS km
FROM street_edge
GROUP BY status
ORDER BY status;

\if :apply
  COMMIT;
\else
  ROLLBACK;
  \echo 'Dry run: rolled back. Rerun with -v apply=1 to commit.'
\endif
