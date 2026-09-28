-- =====================================================================
-- Fill in sidewalk_user.created_at for accounts made before the column existed (#5532). Written against evolution 410.
--
-- Each account gets its earliest timestamp in ANY city, from webpage_activity, mission, audit_task or
-- label_validation. On prod (2026-09-28) that covers all but 1,843 of 6.2M accounts. Those get an estimate: the date
-- of the closest account made before them (by user_role.user_role_id) that has one. Accounts brought in later in bulk
-- break that order, so treat those few dates as approximate.
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
  AND (with_neighbors.first_at IS NOT NULL OR sidewalk_user.created_at = evolution_stamp.stamped_at);
CREATE INDEX ON new_date (batch);
ANALYZE new_date;

\if :apply
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
