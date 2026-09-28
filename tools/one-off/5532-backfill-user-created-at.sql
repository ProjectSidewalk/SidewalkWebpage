-- =====================================================================
-- Fill in sidewalk_user.created_at for accounts made before the column existed (#5532). Written against evolution 410.
--
-- Each account gets its earliest timestamp in ANY city, from webpage_activity, mission, audit_task or
-- label_validation. On prod (2026-09-28) that covers all but 1,843 of 6.2M accounts, and those own nothing beyond the
-- rows every visitor gets (checked across every table that points at sidewalk_user):
--   * The anonymous ones (1,841) are DELETED. If one turns out to own anything else, a foreign key stops the delete
--     and the script ends before changing a thing.
--   * The rest (2 registered) are kept, since someone made those on purpose. They get the date of the closest
--     account made before them (by user_role.user_role_id) that has one. Accounts brought in later in bulk break that
--     order, so treat those dates as approximate.
--
-- It looks across every city schema by itself, so run it ONCE, not per city: -m -c "seattle" through
-- sidewalk-server-tools/run-query-in-every-city.sh.
--
-- DRY RUN BY DEFAULT: prints one summary row and writes nothing. Pass -v apply=1 to write. The runner passes no such
-- variable, so send it a copy with `\set apply 1` in place of `\set apply 0` below.
--
-- A date is only ever moved earlier, and each batch of 50,000 is saved as it finishes, so an interrupted run can
-- simply be run again. Dry run ~1 min, apply ~34 min on the dev database, nearly all of it spent re-filing every
-- changed row in the table's indexes. That was with the two indexes 410 drops still in place.
-- =====================================================================
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?city}
\else
  \set city ''
\endif

CREATE TEMP TABLE first_seen_by_source (user_id TEXT, first_at TIMESTAMPTZ);

DO $$
DECLARE
  city_schema TEXT;
BEGIN
  FOR city_schema IN
    SELECT table_schema FROM information_schema.tables
    WHERE table_name = 'webpage_activity' AND table_schema LIKE 'sidewalk\_%'
    ORDER BY table_schema
  LOOP
    EXECUTE format(
      'INSERT INTO first_seen_by_source
       SELECT user_id, MIN(timestamp) FROM %1$I.webpage_activity GROUP BY user_id
       UNION ALL SELECT user_id, MIN(mission_start) FROM %1$I.mission GROUP BY user_id
       UNION ALL SELECT user_id, MIN(task_start) FROM %1$I.audit_task GROUP BY user_id
       UNION ALL SELECT user_id, MIN(start_timestamp) FROM %1$I.label_validation GROUP BY user_id',
      city_schema);
  END LOOP;
END $$;

CREATE TEMP TABLE first_seen AS
SELECT user_id, MIN(first_at) AS first_at FROM first_seen_by_source GROUP BY user_id;
ALTER TABLE first_seen ADD PRIMARY KEY (user_id);
ANALYZE first_seen;

-- Evolution 410's date is the one thousands of accounts share. None means the backfill already ran.
CREATE TEMP TABLE evolution_stamp AS
SELECT created_at AS stamped_at FROM sidewalk_login.sidewalk_user
GROUP BY created_at HAVING COUNT(*) > 1000
ORDER BY COUNT(*) DESC LIMIT 1;

-- Only accounts from before the evolution, so a visitor who arrived seconds ago and has logged nothing yet is safe.
CREATE TEMP TABLE to_delete AS
SELECT sidewalk_user.user_id
FROM sidewalk_login.sidewalk_user
INNER JOIN evolution_stamp ON evolution_stamp.stamped_at = sidewalk_user.created_at
INNER JOIN sidewalk_login.user_role ON user_role.user_id = sidewalk_user.user_id
WHERE user_role.role::text = 'Anonymous'
  AND NOT EXISTS (SELECT 1 FROM first_seen WHERE first_seen.user_id = sidewalk_user.user_id);
ALTER TABLE to_delete ADD PRIMARY KEY (user_id);
ANALYZE to_delete;

CREATE TEMP TABLE new_date AS
WITH ordered AS (
  SELECT user_role.user_id, user_role.user_role_id, first_seen.first_at,
         COUNT(first_seen.first_at) OVER (ORDER BY user_role.user_role_id) AS known_before,
         COUNT(first_seen.first_at) OVER (ORDER BY user_role.user_role_id DESC) AS known_after
  FROM sidewalk_login.user_role
  LEFT JOIN first_seen ON first_seen.user_id = user_role.user_id
), with_neighbors AS (
  SELECT user_id, first_at,
         MAX(first_at) OVER (PARTITION BY known_before) AS closest_before,
         MAX(first_at) OVER (PARTITION BY known_after) AS closest_after
  FROM ordered
)
SELECT sidewalk_user.user_id,
       COALESCE(with_neighbors.first_at, with_neighbors.closest_before, with_neighbors.closest_after) AS created_at,
       CASE WHEN with_neighbors.first_at IS NOT NULL THEN 'own timestamp' ELSE 'neighbor' END AS source,
       -- Batches follow the order rows sit on disk, so each one writes to one stretch of the table.
       (ROW_NUMBER() OVER (ORDER BY sidewalk_user.ctid) - 1) / 50000 AS batch
FROM sidewalk_login.sidewalk_user
INNER JOIN with_neighbors ON with_neighbors.user_id = sidewalk_user.user_id
LEFT JOIN evolution_stamp ON TRUE
WHERE COALESCE(with_neighbors.first_at, with_neighbors.closest_before, with_neighbors.closest_after)
        < sidewalk_user.created_at
  -- An estimate is only for an account that still has the evolution's date.
  AND (with_neighbors.first_at IS NOT NULL OR sidewalk_user.created_at = evolution_stamp.stamped_at)
  AND NOT EXISTS (SELECT 1 FROM to_delete WHERE to_delete.user_id = sidewalk_user.user_id);
CREATE INDEX ON new_date (batch);
ANALYZE new_date;

\if :apply
  BEGIN;
  DELETE FROM sidewalk_login.user_password_info
  WHERE login_info_id IN (
    SELECT user_login_info.login_info_id FROM sidewalk_login.user_login_info
    INNER JOIN to_delete ON to_delete.user_id = user_login_info.user_id
  );
  WITH unlinked AS (
    DELETE FROM sidewalk_login.user_login_info
    WHERE user_id IN (SELECT user_id FROM to_delete)
    RETURNING login_info_id
  )
  DELETE FROM sidewalk_login.login_info WHERE login_info_id IN (SELECT login_info_id FROM unlinked);

  -- The rows an account has without ever doing anything. Anything else it owns is left for the foreign keys to trip on.
  DO $$
  DECLARE
    bookkeeping RECORD;
  BEGIN
    FOR bookkeeping IN
      SELECT table_schema, table_name FROM information_schema.columns
      WHERE column_name = 'user_id' AND table_schema LIKE 'sidewalk\_%'
        AND table_name IN ('user_stat', 'user_current_region', 'auth_tokens', 'user_role', 'user_settings',
                           'user_account_state', 'user_state', 'user_utm')
    LOOP
      EXECUTE format('DELETE FROM %I.%I WHERE user_id IN (SELECT user_id FROM to_delete)',
                     bookkeeping.table_schema, bookkeeping.table_name);
    END LOOP;
  END $$;

  DELETE FROM sidewalk_login.sidewalk_user WHERE user_id IN (SELECT user_id FROM to_delete);
  COMMIT;

  DO $$
  DECLARE
    last_batch BIGINT := (SELECT MAX(batch) FROM new_date);
  BEGIN
    FOR current_batch IN 0..COALESCE(last_batch, -1) LOOP
      UPDATE sidewalk_login.sidewalk_user
      SET created_at = new_date.created_at
      FROM new_date
      WHERE new_date.batch = current_batch AND sidewalk_user.user_id = new_date.user_id;
      COMMIT;
      RAISE NOTICE 'batch % of % done', current_batch + 1, last_batch + 1;
    END LOOP;
  END $$;
\endif

-- still_on_evolution_date should be 0 after applying: anything left has no user_role row to find a neighbor by.
SELECT :'city' AS run_from_city,
       :apply::int = 1 AS applied,
       (SELECT COUNT(*) FROM sidewalk_login.sidewalk_user) AS accounts,
       (SELECT COUNT(*) FROM to_delete) AS undated_anonymous_to_delete,
       (SELECT COUNT(*) FROM new_date WHERE source = 'own timestamp') AS dated_from_own_timestamp,
       (SELECT COUNT(*) FROM new_date WHERE source = 'neighbor') AS dated_from_neighbor,
       (SELECT COUNT(*) FROM sidewalk_login.sidewalk_user
        INNER JOIN evolution_stamp ON evolution_stamp.stamped_at = sidewalk_user.created_at) AS still_on_evolution_date,
       (SELECT MIN(created_at) FROM new_date) AS earliest_new_date,
       (SELECT MAX(created_at) FROM new_date) AS latest_new_date;

\if :apply
  -- Frees the old copy of every row that the update left behind.
  VACUUM ANALYZE sidewalk_login.sidewalk_user;
\endif
