-- =====================================================================
-- Delete the anonymous accounts that only exist because someone opened a public page (#5612). Written against
-- evolution 411.
--
-- An account is deleted when ALL of these hold:
--   * It is anonymous and has no rows in any city, other than webpage_activity and the rows every visitor gets
--     (login tables, user_stat, user_current_region, user_settings).
--   * It wasn't made from a page that still needs an account (Explore, Validate, the dashboard, ...; listed in
--     settings below), or from "/" since v11.8.0, when "/" started to mean a first vote or comment on a public page.
--   * It has no campaign (user_utm) rows, and was not made or active in the last day.
-- The shared `anonymous` account is never touched: the app still needs it.
--
-- Its sign-up rows in webpage_activity are deleted, its other webpage_activity rows stay with no user, and the rows
-- every visitor gets are deleted.
--
-- NEEDS A SUPERUSER. Postgres normally looks a deleted account up in every table that points at sidewalk_user, in
-- every city, which is far too slow for 5 million accounts. The script does that check itself, a batch at a time, and
-- switches the built-in one off for the account delete. Each batch locks its accounts before re-checking them, so
-- nothing can be attached to one in between. Tables with no foreign key to sidewalk_user can't be locked that way;
-- "rows left behind" in the output names anything that got through (expect none).
--
-- A visitor whose account is in the batch being deleted waits for it to finish, then carries on with no account (a
-- tool page gives them a new one). If they register in that window, it doesn't stick.
--
-- Run it ONCE, not per city, since it looks across every city by itself: -m -c "seattle" through
-- sidewalk-server-tools/run-query-in-every-city.sh.
--
-- DRY RUN BY DEFAULT: prints the accounts per sign-up page and what would happen to them. To write, send the runner
-- a copy with `\set apply 1` in place of `\set apply 0` below. Each batch is saved as it finishes, so an interrupted
-- run can be run again.
--
-- Run it after the #5532 backfill, or more than a day after evolution 410 is deployed: until then every account
-- looks like it was made on deploy day and is skipped.
-- =====================================================================
\set QUIET on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?city}
\else
  \set city ''
\endif
\if :{?batch_size}
\else
  \set batch_size 250000
\endif

-- The runner opens connections read-only, which blocks even temp tables.
SET default_transaction_read_only = off;

-- tool_page: the pages that still need an account. lazy_accounts_since: when v11.8.0 was tagged.
CREATE TEMP TABLE settings AS
SELECT '^/(explore|audit|validate|expertValidate|adminValidate|newValidateBeta|mobile'
       || '|serviceHoursInstructions|timeCheck|dashboard|profile|routes|stories|survey|admin)(/|$)' AS tool_page,
       TIMESTAMPTZ '2026-08-10 15:57:47-07' AS lazy_accounts_since,
       NOW() - INTERVAL '1 day' AS quiet_since;

-- Every column that can hold a user id: those with a foreign key to sidewalk_user, plus the usual column names,
-- since not every table has the key. sidewalk_user and user_login_info are handled by name further down.
CREATE TEMP TABLE sources AS
WITH candidates AS (
  SELECT pg_namespace.nspname AS table_schema, pg_class.relname AS table_name, pg_attribute.attname AS column_name,
         pg_attribute.attnotnull AS required, pg_attribute.atttypid AS column_type,
         EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE pg_constraint.contype = 'f' AND pg_constraint.confrelid = 'sidewalk_login.sidewalk_user'::regclass
             AND pg_constraint.conrelid = pg_class.oid AND pg_attribute.attnum = ANY (pg_constraint.conkey)
         ) AS has_foreign_key
  FROM pg_attribute
  INNER JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
  INNER JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_class.relkind = 'r' AND pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped
    AND NOT (pg_namespace.nspname = 'sidewalk_login' AND pg_class.relname IN ('sidewalk_user', 'user_login_info'))
)
SELECT table_schema, table_name, column_name, required, has_foreign_key,
       CASE WHEN table_name = 'webpage_activity' THEN 'activity'
            WHEN table_name = 'user_utm' THEN 'campaign'
            WHEN table_name IN ('user_role', 'user_stat', 'user_current_region', 'user_settings', 'auth_tokens')
              THEN 'visitor row'
            ELSE 'work' END AS kind
FROM candidates
WHERE has_foreign_key
   OR (table_schema LIKE 'sidewalk\_%'
       AND column_name IN ('user_id', 'edited_by', 'deleted_by', 'created_by', 'updated_by', 'moderated_by')
       AND column_type IN ('text'::regtype, 'character varying'::regtype));

-- Checked up front, before the slow list-building.
\if :apply
  DO $$
  DECLARE
    not_ready TEXT := (SELECT string_agg(table_schema, ', ' ORDER BY table_schema) FROM sources
                       WHERE kind = 'activity' AND required);
  BEGIN
    IF current_setting('is_superuser') <> 'on' THEN
      RAISE EXCEPTION 'Run this as a database superuser: it has to switch off the foreign-key check for the delete.';
    END IF;
    -- A leftover sidewalk_* schema that isn't a live city counts too: drop it or run 411's ALTER on it first.
    IF not_ready IS NOT NULL THEN
      RAISE EXCEPTION 'webpage_activity.user_id cannot be empty yet (evolution 411 has not run) in: %', not_ready;
    END IF;
  END $$;
\endif

CREATE TEMP TABLE worked (user_id TEXT);
DO $$
DECLARE
  source RECORD;
BEGIN
  FOR source IN SELECT * FROM sources WHERE kind = 'work' LOOP
    EXECUTE format('INSERT INTO worked SELECT DISTINCT %3$I FROM %1$I.%2$I WHERE %3$I IS NOT NULL',
                   source.table_schema, source.table_name, source.column_name);
  END LOOP;
END $$;
CREATE INDEX ON worked (user_id);
ANALYZE worked;

CREATE TEMP TABLE did_nothing AS
SELECT sidewalk_user.user_id, sidewalk_user.created_at
FROM sidewalk_login.sidewalk_user
INNER JOIN sidewalk_login.user_role ON user_role.user_id = sidewalk_user.user_id
WHERE user_role.role::text = 'Anonymous'
  AND sidewalk_user.username <> 'anonymous'
  AND NOT EXISTS (SELECT 1 FROM worked WHERE worked.user_id = sidewalk_user.user_id);
ALTER TABLE did_nothing ADD PRIMARY KEY (user_id);
ANALYZE did_nothing;

-- The page is the path in the sign-up row, without its query string. Sign-up rows from before April 2023 have none.
CREATE TEMP TABLE seen_by_city (
  user_id TEXT, opened_tool BOOLEAN, root_since_release BOOLEAN, signup_page TEXT, signed_up TIMESTAMPTZ,
  last_seen TIMESTAMPTZ
);
DO $$
DECLARE
  source RECORD;
BEGIN
  FOR source IN SELECT * FROM sources WHERE kind = 'activity' LOOP
    EXECUTE format(
      $query$
        INSERT INTO seen_by_city
        SELECT webpage_activity.user_id,
               COALESCE(BOOL_OR(substring(webpage_activity.activity FROM 'AnonAutoSignUp_url="([^"?]*)')
                                ~ settings.tool_page), FALSE),
               COALESCE(BOOL_OR(substring(webpage_activity.activity FROM 'AnonAutoSignUp_url="([^"?]*)') = '/'
                                AND webpage_activity.timestamp >= settings.lazy_accounts_since), FALSE),
               MIN(substring(webpage_activity.activity FROM 'AnonAutoSignUp_url="([^"?]*)')),
               MIN(webpage_activity.timestamp) FILTER (WHERE webpage_activity.activity LIKE 'AnonAutoSignUp%%'),
               MAX(webpage_activity.timestamp)
        FROM %1$I.webpage_activity
        INNER JOIN did_nothing ON did_nothing.user_id = webpage_activity.user_id
        CROSS JOIN settings
        GROUP BY webpage_activity.user_id
      $query$, source.table_schema);
  END LOOP;
END $$;

CREATE TEMP TABLE seen AS
SELECT user_id, BOOL_OR(opened_tool) AS opened_tool, BOOL_OR(root_since_release) AS root_since_release,
       MIN(signup_page) AS signup_page, MIN(signed_up) AS signed_up, MAX(last_seen) AS last_seen
FROM seen_by_city GROUP BY user_id;
ALTER TABLE seen ADD PRIMARY KEY (user_id);
ANALYZE seen;

-- The first reason that fits wins.
CREATE TEMP TABLE verdict AS
SELECT did_nothing.user_id, COALESCE(seen.signup_page, '(no sign-up page)') AS signup_page, seen.signed_up,
       CASE WHEN seen.opened_tool THEN 'keep: opened a tool'
            WHEN seen.root_since_release THEN 'keep: made from / since v11.8.0'
            WHEN seen.last_seen > settings.quiet_since OR did_nothing.created_at > settings.quiet_since
              THEN 'keep: made or active in the last day'
            WHEN EXISTS (SELECT 1 FROM sidewalk_login.user_utm WHERE user_utm.user_id = did_nothing.user_id)
              THEN 'keep: has campaign rows'
            ELSE 'delete' END AS decision
FROM did_nothing
LEFT JOIN seen ON seen.user_id = did_nothing.user_id
CROSS JOIN settings;

-- Batches follow the order rows sit on disk, so each one writes to one stretch of sidewalk_user.
CREATE TEMP TABLE to_delete AS
SELECT verdict.user_id, (ROW_NUMBER() OVER (ORDER BY sidewalk_user.ctid) - 1) / :batch_size AS batch
FROM verdict
INNER JOIN sidewalk_login.sidewalk_user ON sidewalk_user.user_id = verdict.user_id
WHERE verdict.decision = 'delete';
ALTER TABLE to_delete ADD PRIMARY KEY (user_id);
CREATE INDEX ON to_delete (batch);
ANALYZE to_delete;

CREATE TEMP TABLE batch_ids (user_id TEXT PRIMARY KEY);
CREATE TEMP TABLE deleted (user_id TEXT PRIMARY KEY);
CREATE TEMP TABLE left_behind (table_schema TEXT, table_name TEXT, row_count BIGINT);

\if :apply
  DO $$
  DECLARE
    source RECORD;
    last_batch BIGINT := (SELECT MAX(batch) FROM to_delete);
    batch_started TIMESTAMPTZ;
    listed BIGINT;
    removed BIGINT;
  BEGIN
    FOR current_batch IN 0..COALESCE(last_batch, -1) LOOP
      batch_started := clock_timestamp();
      TRUNCATE batch_ids;
      INSERT INTO batch_ids SELECT user_id FROM to_delete WHERE batch = current_batch;
      GET DIAGNOSTICS listed = ROW_COUNT;
      ANALYZE batch_ids;

      -- Until the batch is saved, nobody else can attach a row to these accounts or change their role.
      PERFORM 1 FROM sidewalk_login.sidewalk_user
      WHERE user_id IN (SELECT user_id FROM batch_ids)
      FOR UPDATE;
      PERFORM 1 FROM sidewalk_login.user_role
      WHERE user_id IN (SELECT user_id FROM batch_ids)
      FOR UPDATE;

      -- The list is old by now, so anyone who has since registered, been given a role, or done anything comes off.
      -- Tables the lock doesn't cover go last, so less time passes between their check and the delete.
      DELETE FROM batch_ids
      WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.user_role
                        WHERE user_role.user_id = batch_ids.user_id AND user_role.role::text = 'Anonymous');
      FOR source IN SELECT * FROM sources WHERE kind <> 'visitor row' ORDER BY has_foreign_key DESC LOOP
        EXECUTE format(
          'DELETE FROM batch_ids
           WHERE EXISTS (SELECT 1 FROM %1$I.%2$I CROSS JOIN settings WHERE %2$I.%3$I = batch_ids.user_id %4$s)',
          source.table_schema, source.table_name, source.column_name,
          CASE WHEN source.kind = 'activity'
               THEN format('AND %I.timestamp > settings.quiet_since', source.table_name) ELSE '' END);
      END LOOP;

      FOR source IN SELECT * FROM sources WHERE kind = 'activity' LOOP
        EXECUTE format(
          'DELETE FROM %1$I.%2$I
           WHERE %3$I IN (SELECT user_id FROM batch_ids) AND activity LIKE ''AnonAutoSignUp%%''',
          source.table_schema, source.table_name, source.column_name);
        EXECUTE format('UPDATE %1$I.%2$I SET %3$I = NULL WHERE %3$I IN (SELECT user_id FROM batch_ids)',
                       source.table_schema, source.table_name, source.column_name);
      END LOOP;
      FOR source IN SELECT * FROM sources WHERE kind = 'visitor row' LOOP
        EXECUTE format('DELETE FROM %1$I.%2$I WHERE %3$I IN (SELECT user_id FROM batch_ids)',
                       source.table_schema, source.table_name, source.column_name);
      END LOOP;

      DELETE FROM sidewalk_login.user_password_info
      WHERE login_info_id IN (
        SELECT user_login_info.login_info_id FROM sidewalk_login.user_login_info
        INNER JOIN batch_ids ON batch_ids.user_id = user_login_info.user_id
      );
      WITH unlinked AS (
        DELETE FROM sidewalk_login.user_login_info
        WHERE user_id IN (SELECT user_id FROM batch_ids)
        RETURNING login_info_id
      )
      DELETE FROM sidewalk_login.login_info WHERE login_info_id IN (SELECT login_info_id FROM unlinked);

      -- Everything pointing at these accounts was just checked or cleared, so Postgres's own check is skipped here.
      SET LOCAL session_replication_role = replica;
      DELETE FROM sidewalk_login.sidewalk_user WHERE user_id IN (SELECT user_id FROM batch_ids);
      GET DIAGNOSTICS removed = ROW_COUNT;
      SET LOCAL session_replication_role = origin;

      INSERT INTO deleted SELECT user_id FROM batch_ids;
      COMMIT;
      RAISE NOTICE 'batch % of %: deleted % accounts, skipped % (%)', current_batch + 1, last_batch + 1, removed,
        listed - removed, date_trunc('second', clock_timestamp() - batch_started);
    END LOOP;

    -- Counts anything that still points at a deleted account.
    ANALYZE deleted;
    FOR source IN SELECT * FROM sources LOOP
      EXECUTE format(
        'INSERT INTO left_behind
         SELECT %1$L, %2$L, COUNT(*) FROM %1$I.%2$I WHERE %3$I IN (SELECT user_id FROM deleted) HAVING COUNT(*) > 0',
        source.table_schema, source.table_name, source.column_name);
    END LOOP;
  END $$;
\endif

-- Pages with few accounts are lumped together so crawler paths don't bury the list.
WITH by_page AS (
  SELECT decision, signup_page, COUNT(*) AS accounts, MAX(signed_up) AS newest_signup
  FROM verdict GROUP BY decision, signup_page
), listed AS (
  SELECT decision, CASE WHEN accounts >= 500 THEN signup_page ELSE '(pages with under 500 accounts each)' END AS what,
         SUM(accounts) AS accounts, MAX(newest_signup) AS newest_signup
  FROM by_page GROUP BY 1, 2
), report AS (
  SELECT 1 AS section, decision, what, accounts, newest_signup FROM listed
  UNION ALL
  SELECT 2, 'total', decision, COUNT(*), MAX(signed_up) FROM verdict GROUP BY decision
  UNION ALL
  SELECT 3, 'total', 'anonymous accounts that did something (kept, not listed above)',
         (SELECT COUNT(*) FROM sidewalk_login.user_role
          WHERE role::text = 'Anonymous' AND EXISTS (SELECT 1 FROM worked WHERE worked.user_id = user_role.user_id)),
         NULL
  UNION ALL
  SELECT 4, 'result', 'accounts deleted by this run', (SELECT COUNT(*) FROM deleted), NULL
  UNION ALL
  SELECT 5, 'result', 'accounts skipped at the last moment (changed since the list was made)',
         CASE WHEN :apply::int = 1 THEN (SELECT COUNT(*) FROM to_delete) - (SELECT COUNT(*) FROM deleted) ELSE 0 END,
         NULL
  UNION ALL
  SELECT 6, 'result',
         'rows left behind that still name a deleted account (expect 0)'
           || COALESCE(': ' || string_agg(table_schema || '.' || table_name, ' ' ORDER BY table_schema, table_name),
                       ''),
         COALESCE(SUM(row_count), 0), NULL
  FROM left_behind
  UNION ALL
  SELECT 7, 'check',
         'schemas where evolution 411 has not run (must be 0 to apply)'
           || COALESCE(': ' || string_agg(table_schema, ' ' ORDER BY table_schema), ''),
         COUNT(*), NULL
  FROM sources WHERE kind = 'activity' AND required
)
SELECT :'city' AS run_from_city, :apply::int = 1 AS applied, decision, what, accounts, newest_signup
FROM report
ORDER BY section, decision, accounts DESC;

\if :apply
  -- Lets the space the deleted rows took be reused.
  VACUUM ANALYZE sidewalk_login.sidewalk_user;
  VACUUM ANALYZE sidewalk_login.user_role;
  VACUUM ANALYZE sidewalk_login.user_login_info;
  VACUUM ANALYZE sidewalk_login.login_info;
  VACUUM ANALYZE sidewalk_login.user_password_info;
\endif
