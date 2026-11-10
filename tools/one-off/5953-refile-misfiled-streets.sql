-- =====================================================================================================================
-- Refile streets filed under a region they don't run through (#5953). Written against evolution 430.
--
-- The 4717 and 3067 merges filed kept streets under a live region picked by bounding box, so a street lying in a
-- hidden region could land in a live one. Reveals, hides and the imagery scan find streets by region, so such a street
-- is skipped when its own region is revealed, and a no_imagery one reopens inside a hidden region.
--
-- Each street with under a metre inside its region moves to the region holding most of it, and its status follows
-- that region as reveal-or-hide-regions.sh would (closed in a live one opens, open in a hidden one closes; no_imagery
-- and disabled stay). Streets in no region, and the tutorial street (outside the regions by design), are left alone.
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

CREATE TEMP TABLE misfiled ON COMMIT DROP AS
SELECT street_edge.street_edge_id, street_edge.status AS old_status, street_edge_region.region_id AS from_region_id,
       best.region_id AS to_region_id, best.deleted AS to_hidden,
       (CASE
           WHEN street_edge.status = 'closed' AND NOT best.deleted THEN 'open'
           WHEN street_edge.status = 'open' AND best.deleted THEN 'closed'
           ELSE street_edge.status::text
       END)::street_edge_status AS new_status,
       ST_Length(street_edge.geom::geography) AS meters
FROM street_edge
JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
JOIN region AS filed_region ON street_edge_region.region_id = filed_region.region_id
CROSS JOIN LATERAL (
    SELECT region.region_id, region.deleted,
           ST_Length(ST_Intersection(region.geom, street_edge.geom)::geography) AS meters_inside
    FROM region
    WHERE ST_Intersects(region.geom, street_edge.geom)
    ORDER BY meters_inside DESC, region.region_id
    LIMIT 1
) AS best
WHERE ST_Length(ST_Intersection(filed_region.geom, street_edge.geom)::geography) < 1
    AND best.meters_inside >= 1
    AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config);

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

TRUNCATE TABLE region_completion;

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
         -- Each should be 0 afterwards.
         (SELECT count(*) FROM street_edge JOIN street_edge_region USING (street_edge_id)
              JOIN region USING (region_id)
          WHERE street_edge.status = 'closed' AND NOT region.deleted) AS check_closed_in_live_region,
         (SELECT count(*) FROM street_edge JOIN street_edge_region USING (street_edge_id)
              JOIN region USING (region_id)
          WHERE street_edge.status = 'open' AND region.deleted) AS check_open_in_hidden_region,
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
