-- Delete the regions outside Taipei City from the taipei schema, along with their streets (#5252). Written against
-- evolution 374 (v11.11.0); applied on prod 2026-09-09.
--
-- The taipei schema was imported with regions for all of Taiwan. Only the 456 in Taipei City are open and have any
-- work in them; the other 7497 are closed and empty, and caused 1110 of the 1435 duplicate region names. Deleting
-- them removes 466,463 street-to-region links. 4119 of those regions are in places with no other schema of ours,
-- so this was our only copy of their streets; nobody had labeled there, and re-importing from OSM is cheap.
--
-- THIS DELETES FOR GOOD. Take a dump of sidewalk_taipei first, then run on taipei only:
--     scp tools/one-off/5252-delete-taipei-extra-regions.sql saugstad@makelab1.cs.washington.edu:sidewalk-server-tools/current-query.sql
--     ./run-query-in-every-city.sh -p -m -c "taipei" -o "5252-taipei-deletion"
--     scp saugstad@makelab1.cs.washington.edu:sidewalk-server-tools/5252-taipei-deletion.csv scratchpad/
-- The output is one row per table with how many rows were removed, after a few psql status lines.
--
-- Safety checks, any of which rolls back everything:
--   * Only runs in sidewalk_taipei. Elsewhere "closed" means something else (96 of detroit's 97 regions).
--   * The closed/open counts must still be 7497/456; only then does "closed" mean "outside Taipei City".
--   * No doomed region may have work attached, and neither the tutorial street nor a saved route may be deleted.
-- A street shared with a region that stays is kept.
--
-- The runner sets the search_path.
BEGIN;

SET LOCAL lock_timeout = '30s';

DO $$
BEGIN
  IF current_schema() <> 'sidewalk_taipei' THEN
    RAISE EXCEPTION '#5252: this script is only for sidewalk_taipei, not %; nothing deleted', current_schema();
  END IF;
END $$;

CREATE TEMP TABLE receipt (step text, n bigint);

CREATE TEMP TABLE doomed_region AS SELECT region_id FROM region WHERE deleted;

-- If these counts moved, a region was closed for some other reason (say, no imagery) and would lose its streets.
DO $$
DECLARE n_closed bigint; n_open bigint;
BEGIN
  SELECT count(*) FILTER (WHERE deleted), count(*) FILTER (WHERE NOT deleted) INTO n_closed, n_open FROM region;
  IF n_closed <> 7497 OR n_open <> 456 THEN
    RAISE EXCEPTION '#5252: expected 7497 closed and 456 open regions, found % and %; nothing deleted',
      n_closed, n_open;
  END IF;
END $$;

DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad
  FROM doomed_region
  WHERE EXISTS (SELECT 1 FROM mission WHERE mission.region_id = doomed_region.region_id)
     OR EXISTS (SELECT 1 FROM route WHERE route.region_id = doomed_region.region_id)
     OR EXISTS (SELECT 1 FROM clustering_session WHERE clustering_session.region_id = doomed_region.region_id)
     OR EXISTS (SELECT 1 FROM user_current_region WHERE user_current_region.region_id = doomed_region.region_id)
     OR EXISTS (
          SELECT 1 FROM street_edge_region
          INNER JOIN label ON label.street_edge_id = street_edge_region.street_edge_id
          WHERE street_edge_region.region_id = doomed_region.region_id)
     OR EXISTS (
          SELECT 1 FROM street_edge_region
          INNER JOIN audit_task ON audit_task.street_edge_id = street_edge_region.street_edge_id
          WHERE street_edge_region.region_id = doomed_region.region_id)
     -- Street data not deleted below; checking here gives a clear error instead of a foreign-key one.
     OR EXISTS (
          SELECT 1 FROM street_edge_region
          INNER JOIN audit_task_comment ON audit_task_comment.edge_id = street_edge_region.street_edge_id
          WHERE street_edge_region.region_id = doomed_region.region_id)
     OR EXISTS (
          SELECT 1 FROM street_edge_region
          INNER JOIN cluster ON cluster.street_edge_id = street_edge_region.street_edge_id
          WHERE street_edge_region.region_id = doomed_region.region_id)
     OR EXISTS (
          SELECT 1 FROM street_edge_region
          INNER JOIN old_label_point_coords ON old_label_point_coords.street_edge_id = street_edge_region.street_edge_id
          WHERE street_edge_region.region_id = doomed_region.region_id)
     OR EXISTS (
          SELECT 1 FROM street_edge_region
          INNER JOIN old_label_point_position
                  ON old_label_point_position.street_edge_id = street_edge_region.street_edge_id
          WHERE street_edge_region.region_id = doomed_region.region_id);
  IF bad > 0 THEN
    RAISE EXCEPTION '#5252: % closed regions still have work attached in %; nothing deleted', bad, current_schema();
  END IF;
END $$;

CREATE TEMP TABLE doomed_street AS
SELECT DISTINCT street_edge_region.street_edge_id
FROM street_edge_region
INNER JOIN doomed_region ON doomed_region.region_id = street_edge_region.region_id
WHERE NOT EXISTS (
  SELECT 1
  FROM street_edge_region AS surviving
  WHERE surviving.street_edge_id = street_edge_region.street_edge_id
    AND surviving.region_id NOT IN (SELECT region_id FROM doomed_region)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM config WHERE tutorial_street_edge_id IN (SELECT street_edge_id FROM doomed_street)) THEN
    RAISE EXCEPTION '#5252: the tutorial street belongs to a region being deleted in %; nothing deleted',
      current_schema();
  END IF;
  -- Deleting a street out of a saved route would leave a gap in it, so stop instead.
  IF EXISTS (SELECT 1 FROM route_street WHERE street_edge_id IN (SELECT street_edge_id FROM doomed_street)) THEN
    RAISE EXCEPTION '#5252: a saved route runs down a street being deleted in %; nothing deleted', current_schema();
  END IF;
END $$;

-- Count the rows the database deletes on its own (ON DELETE CASCADE) so the output shows them.
INSERT INTO receipt
SELECT 'street_edge_region (cascade)',
       count(*) FROM street_edge_region WHERE street_edge_id IN (SELECT street_edge_id FROM doomed_street);
INSERT INTO receipt
SELECT 'street_edge_status_change (cascade)',
       count(*) FROM street_edge_status_change WHERE street_edge_id IN (SELECT street_edge_id FROM doomed_street);
INSERT INTO receipt
SELECT 'street_reopen_candidate (cascade)',
       count(*) FROM street_reopen_candidate WHERE street_edge_id IN (SELECT street_edge_id FROM doomed_street);
INSERT INTO receipt
SELECT 'region_completion (cascade)',
       count(*) FROM region_completion WHERE region_id IN (SELECT region_id FROM doomed_region);
INSERT INTO receipt
SELECT 'user_current_region (cascade)',
       count(*) FROM user_current_region WHERE region_id IN (SELECT region_id FROM doomed_region);

-- Intersections block a region delete, so they go first. The table (evolution 381) wasn't on prod yet, so it's
-- named in a string to avoid an error. A kept intersection that loses a street has a stale count until a rebuild.
DO $$
DECLARE n bigint := 0;
BEGIN
  IF to_regclass('intersection') IS NOT NULL THEN
    EXECUTE 'DELETE FROM intersection WHERE region_id IN (SELECT region_id FROM doomed_region)';
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  INSERT INTO receipt VALUES ('intersection', n);
END $$;

-- Street data first, then the streets. Tables not listed here are cleared automatically with the street.
WITH d AS (
  DELETE FROM street_edge_priority WHERE street_edge_id IN (SELECT street_edge_id FROM doomed_street) RETURNING 1
) INSERT INTO receipt SELECT 'street_edge_priority', count(*) FROM d;

WITH d AS (
  DELETE FROM osm_way_street_edge WHERE street_edge_id IN (SELECT street_edge_id FROM doomed_street) RETURNING 1
) INSERT INTO receipt SELECT 'osm_way_street_edge', count(*) FROM d;

WITH d AS (
  DELETE FROM street_imagery WHERE street_edge_id IN (SELECT street_edge_id FROM doomed_street) RETURNING 1
) INSERT INTO receipt SELECT 'street_imagery', count(*) FROM d;

WITH d AS (
  DELETE FROM street_edge_issue WHERE street_edge_id IN (SELECT street_edge_id FROM doomed_street) RETURNING 1
) INSERT INTO receipt SELECT 'street_edge_issue', count(*) FROM d;

WITH d AS (
  DELETE FROM street_edge WHERE street_edge_id IN (SELECT street_edge_id FROM doomed_street) RETURNING 1
) INSERT INTO receipt SELECT 'street_edge', count(*) FROM d;

-- Links from doomed regions to streets that stay because another region shares them.
WITH d AS (
  DELETE FROM street_edge_region WHERE region_id IN (SELECT region_id FROM doomed_region) RETURNING 1
) INSERT INTO receipt SELECT 'street_edge_region (shared streets)', count(*) FROM d;

WITH d AS (
  DELETE FROM region WHERE region_id IN (SELECT region_id FROM doomed_region) RETURNING 1
) INSERT INTO receipt SELECT 'region', count(*) FROM d;

SELECT :'city' AS city, step, n FROM receipt ORDER BY step;

COMMIT;
