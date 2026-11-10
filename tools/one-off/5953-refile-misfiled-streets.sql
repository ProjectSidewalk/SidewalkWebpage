-- =====================================================================================================================
-- Refile streets filed under a region they don't run through (#5953). Written against evolution 430.
--
-- The 4717 and 3067 merges filed kept streets under a live region picked by bounding box, so a street lying in a
-- hidden region could land in a live one. Reveals, hides and the imagery scan find streets by region, so such a street
-- is skipped when its own region is revealed, and a no_imagery one reopens inside a hidden region.
--
-- A street moves to the region holding most of it when it has under a metre inside its own, or when the two differ
-- in being hidden (an open street with a metre or more in its live region stays: it is shown and may carry work).
-- Its status then follows the region as reveal-or-hide-regions.sh would (closed in a live one opens, open in a hidden
-- one closes; no_imagery and disabled stay). Streets in no region, the tutorial street (outside the regions by
-- design), and streets audited in the last day (a user may be on one) are left alone.
--
-- DRY RUN BY DEFAULT: everything runs inside a transaction that is rolled back, and one summary row per city is
-- printed. -v list=1 prints one row per street instead. Built for sidewalk-server-tools/run-query-in-every-city.sh
-- (-m), which sets the search_path and the city variable and passes no other: send it a copy with `\set apply 1` (or
-- `\set list 1`) in place of the default below. For one city by hand:
--   docker exec -i projectsidewalk-db psql "dbname=sidewalk options=--search_path=sidewalk_seattle,public" \
--     -U sidewalk_seattle -v city=seattle -v apply=0 -f - < tools/one-off/5953-refile-misfiled-streets.sql
-- Afterwards clear each city's Play cache (or deploy), so the landing page's distances refresh.
-- =====================================================================================================================

\set QUIET on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?list}
\else
  \set list 0
\endif

-- The fleet runner opens every connection read-only; temp tables need this off even for a dry run.
SET default_transaction_read_only = off;
BEGIN;

-- Most streets lie wholly inside their region; ST_CoveredBy rules them out far cheaper than measuring each one.
CREATE TEMP TABLE candidate ON COMMIT DROP AS
SELECT street_edge.street_edge_id, street_edge.status, street_edge.geom,
       street_edge_region.region_id AS filed_region_id,
       EXISTS (SELECT 1 FROM audit_task
               WHERE audit_task.street_edge_id = street_edge.street_edge_id
                   AND audit_task.task_start >= now() - interval '1 day') AS recently_audited
FROM street_edge
JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
WHERE street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    AND NOT ST_CoveredBy(street_edge.geom,
                         (SELECT region.geom FROM region WHERE region.region_id = street_edge_region.region_id));

CREATE TEMP TABLE misfiled ON COMMIT DROP AS
SELECT candidate.street_edge_id, candidate.status AS old_status, candidate.filed_region_id AS from_region_id,
       filed.deleted AS from_hidden, best.region_id AS to_region_id, best.deleted AS to_hidden,
       (CASE
           WHEN candidate.status = 'closed' AND NOT best.deleted THEN 'open'
           WHEN candidate.status = 'open' AND best.deleted THEN 'closed'
           ELSE candidate.status::text
       END)::street_edge_status AS new_status,
       candidate.recently_audited,
       ST_Length(candidate.geom::geography) AS meters
FROM candidate
CROSS JOIN LATERAL (
    SELECT region.deleted, ST_Length(ST_Intersection(region.geom, candidate.geom)::geography) AS meters_inside
    FROM region
    WHERE region.region_id = candidate.filed_region_id
) AS filed
CROSS JOIN LATERAL (
    SELECT region.region_id, region.deleted,
           ST_Length(ST_Intersection(region.geom, candidate.geom)::geography) AS meters_inside
    FROM region
    WHERE ST_Intersects(region.geom, candidate.geom)
    ORDER BY meters_inside DESC, region.region_id
    LIMIT 1
) AS best
WHERE best.meters_inside >= 1
    AND best.meters_inside > filed.meters_inside
    AND (filed.meters_inside < 1 OR (best.deleted <> filed.deleted AND candidate.status <> 'open'));

SELECT count(*) FILTER (WHERE recently_audited) AS skipped_recent_audit,
       (count(*) FILTER (WHERE NOT recently_audited) > 0)::int AS any_to_move
FROM misfiled \gset
DELETE FROM misfiled WHERE recently_audited;

UPDATE street_edge_region
SET region_id = misfiled.to_region_id
FROM misfiled
WHERE street_edge_region.street_edge_id = misfiled.street_edge_id;

UPDATE street_edge
SET status = misfiled.new_status
FROM misfiled
WHERE street_edge.street_edge_id = misfiled.street_edge_id
    AND misfiled.new_status <> misfiled.old_status;

INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
SELECT street_edge_id, old_status, new_status,
       (CASE WHEN new_status = 'open' THEN 'reveal_regions' ELSE 'hide_regions' END)::street_edge_status_change_source
FROM misfiled
WHERE new_status <> old_status;

-- Only open streets are handed out, and handing out joins on the priority row.
INSERT INTO street_edge_priority (street_edge_id, priority)
SELECT misfiled.street_edge_id, 1
FROM misfiled
WHERE misfiled.new_status = 'open'
    AND NOT EXISTS (SELECT 1 FROM street_edge_priority
                    WHERE street_edge_priority.street_edge_id = misfiled.street_edge_id);

DELETE FROM street_edge_priority
USING misfiled
WHERE street_edge_priority.street_edge_id = misfiled.street_edge_id
    AND misfiled.new_status <> 'open';

-- TRUNCATE locks the table until the transaction ends, so only when a street actually moved.
\if :any_to_move
  TRUNCATE TABLE region_completion;
\endif

\if :list
  SELECT :'city' AS city, street_edge_id, old_status, new_status, from_region_id, to_region_id, to_hidden,
         round(meters::numeric) AS meters
  FROM misfiled
  ORDER BY street_edge_id;
\else
  SELECT :'city' AS city,
         count(*) AS refiled,
         count(*) FILTER (WHERE old_status = 'closed' AND new_status = 'closed') AS closed_stay_closed,
         count(*) FILTER (WHERE old_status = 'closed' AND new_status = 'open') AS closed_to_open,
         round((coalesce(sum(meters) FILTER (WHERE old_status = 'closed' AND new_status = 'open'), 0)
                / 1609.344)::numeric, 1) AS miles_opened,
         count(*) FILTER (WHERE old_status = 'open' AND new_status = 'open') AS open_stay_open,
         count(*) FILTER (WHERE old_status = 'open' AND new_status = 'closed') AS open_to_closed,
         count(*) FILTER (WHERE old_status = 'no_imagery') AS no_imagery,
         count(*) FILTER (WHERE old_status = 'no_imagery' AND to_hidden) AS no_imagery_into_hidden,
         count(*) FILTER (WHERE old_status = 'disabled') AS disabled,
         -- Work on streets going from a live region into a hidden one drops out of sight until that region opens.
         (SELECT count(*) FROM label JOIN misfiled USING (street_edge_id)
          WHERE NOT misfiled.from_hidden AND misfiled.to_hidden AND NOT label.deleted) AS labels_hidden,
         (SELECT count(*) FROM audit_task JOIN misfiled USING (street_edge_id)
          WHERE NOT misfiled.from_hidden AND misfiled.to_hidden) AS audits_hidden,
         :skipped_recent_audit AS skipped_recent_audit,
         -- Each should be 0 afterwards.
         (SELECT count(*) FROM street_edge JOIN street_edge_region USING (street_edge_id)
              JOIN region USING (region_id)
          WHERE street_edge.status = 'closed' AND NOT region.deleted) AS check_closed_in_live_region,
         (SELECT count(*) FROM street_edge JOIN street_edge_region USING (street_edge_id)
              JOIN region USING (region_id)
          WHERE street_edge.status = 'open' AND region.deleted) AS check_open_in_hidden_region,
         (SELECT count(*) FROM street_edge JOIN street_edge_region USING (street_edge_id)
              JOIN region USING (region_id)
          WHERE street_edge.status = 'no_imagery' AND NOT region.deleted
              AND ST_Length(ST_Intersection(region.geom, street_edge.geom)::geography) < 1)
           AS check_no_imagery_outside_live_region,
         (SELECT count(*) FROM street_edge
          WHERE status = 'open' AND NOT EXISTS (SELECT 1 FROM street_edge_priority
                                                WHERE street_edge_priority.street_edge_id = street_edge.street_edge_id))
           AS check_open_without_priority
  FROM misfiled;
\endif

\if :apply
  COMMIT;
\else
  ROLLBACK;
\endif
