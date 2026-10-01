-- =====================================================================
-- Delete the anonymous accounts that only exist because someone opened a public page (#5612). Written against
-- evolution 411.
--
-- Until v11.8.0, opening any page made an anonymous account, so most accounts belong to crawlers and one-time
-- visitors. An account is deleted when ALL of these hold:
--   * It is anonymous and never did anything: no table in any city has a row for it, other than webpage_activity
--     and the rows every visitor gets (the login tables, user_stat, user_current_region, user_settings).
--   * None of its sign-up rows (AnonAutoSignUp_url="...") names a page that still needs an account (Explore,
--     Validate, the dashboard, ...; the full list is in the settings table below). Those are people who opened a tool.
--   * It has no sign-up row for "/" since v11.8.0. From then on, "/" means the account was made in the background
--     for someone's first vote or comment on a public page.
--   * It has no campaign (user_utm) rows, was not made in the last day, and has logged nothing in the last day.
-- The shared `anonymous` account is never touched: the app still needs it.
--
-- What happens to an account's rows: its sign-up rows in webpage_activity are deleted, its other webpage_activity
-- rows stay with no user (the way a visit without a session is logged now), and the rows every visitor gets go.
--
-- WHY IT SWITCHES OFF THE FOREIGN-KEY CHECK: deleting an account normally makes Postgres look that account up in
-- every table that points at sidewalk_user, in every city. That is about 1,800 lookups per account on prod, some of
-- them reading a whole table, so 5 million accounts would take weeks. The script does the same check itself instead,
-- one pass per table for a whole batch, and turns the built-in check off for the one DELETE on sidewalk_user
-- (session_replication_role, which only a superuser can set). Each batch first locks its accounts, which makes any
-- other session that tries to attach a row to one of them wait, and only then re-checks them, so nothing can slip
-- in between the check and the delete. A table with no foreign key to sidewalk_user doesn't get that protection;
-- "rows left behind" in the output counts anything that got through, and should be 0.
--
-- While a batch runs (a few minutes), a visitor whose account is in it waits for the batch to finish, then carries
-- on with no account: public pages render, and a tool page gives them a new one.
--
-- It looks across every city schema by itself, so run it ONCE, not per city: -m -c "seattle" through
-- sidewalk-server-tools/run-query-in-every-city.sh. Nothing here relies on the search_path. The runner opens its
-- connections read-only, which blocks even the temp tables a dry run needs, so the first statement turns that off.
--
-- DRY RUN BY DEFAULT: prints the accounts per sign-up page and what would happen to them, and writes nothing. Read
-- that list before applying. Pass -v apply=1 to write. The runner passes no such variable, so send it a copy with
-- `\set apply 1` in place of `\set apply 0` below.
--
-- Each batch is saved as it finishes, so an interrupted run can simply be run again. Before the #5532 backfill has
-- run, every account looks like it was made on the day of the v11.17.0 deploy, so run this after the backfill or
-- more than a day after that deploy.
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

SET default_transaction_read_only = off;

-- tool_page: the pages that still need an account. v11.8.0 was tagged at lazy_accounts_since, a little before it
-- went live, so the few accounts made from "/" in between are kept.
CREATE TEMP TABLE settings AS
SELECT '^/(explore|audit|validate|expertValidate|adminValidate|newValidateBeta|mobile|serviceHoursInstructions'
       || '|timeCheck|dashboard|profile|routes|stories|survey|admin)(/|$)' AS tool_page,
       TIMESTAMPTZ '2026-08-10 15:57:47-07' AS lazy_accounts_since,
       NOW() - INTERVAL '1 day' AS quiet_since;

-- Every column that can hold a user id: anything with a foreign key to sidewalk_user, in any schema, plus the usual
-- column names in the sidewalk_* schemas (several big tables have no foreign key). sidewalk_user and the login-info
-- chain are handled by name further down.
CREATE TEMP TABLE sources AS
SELECT pg_namespace.nspname AS table_schema, pg_class.relname AS table_name, pg_attribute.attname AS column_name,
       pg_attribute.attnotnull AS required,
       CASE WHEN pg_class.relname = 'webpage_activity' THEN 'activity'
            WHEN pg_class.relname = 'user_utm' THEN 'campaign'
            WHEN pg_class.relname IN ('user_role', 'user_stat', 'user_current_region', 'user_settings', 'auth_tokens')
              THEN 'visitor row'
            ELSE 'work' END AS kind
FROM pg_attribute
INNER JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
INNER JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE pg_class.relkind = 'r' AND pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped
  AND NOT (pg_namespace.nspname = 'sidewalk_login' AND pg_class.relname IN ('sidewalk_user', 'user_login_info'))
  AND (
    (pg_namespace.nspname LIKE 'sidewalk\_%'
     AND pg_attribute.attname IN ('user_id', 'edited_by', 'deleted_by', 'created_by', 'updated_by', 'moderated_by')
     AND pg_attribute.atttypid IN ('text'::regtype, 'character varying'::regtype))
    OR EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE pg_constraint.contype = 'f' AND pg_constraint.confrelid = 'sidewalk_login.sidewalk_user'::regclass
        AND pg_constraint.conrelid = pg_class.oid AND pg_attribute.attnum = ANY (pg_constraint.conkey)
    )
  );

-- Everyone who has a row anywhere that counts as having done something.
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

-- What each of those accounts has in webpage_activity, one row per account per city. The page is the path in the
-- sign-up row without its query string; rows from before April 2023 have none.
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

-- The first reason that fits wins, so an account shows up under one decision only.
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
    not_ready TEXT := (SELECT string_agg(table_schema, ', ' ORDER BY table_schema) FROM sources
                       WHERE kind = 'activity' AND required);
  BEGIN
    IF current_setting('is_superuser') <> 'on' THEN
      RAISE EXCEPTION 'Run this as a database superuser: it has to switch off the foreign-key check for the delete.';
    END IF;
    -- A sidewalk_* schema that isn't a live city (a leftover copy, say) lands here too. Its rows would be left
    -- pointing at deleted accounts, so drop it or run evolution 411's ALTER on it before applying.
    IF not_ready IS NOT NULL THEN
      RAISE EXCEPTION 'webpage_activity.user_id cannot be empty yet (evolution 411 has not run) in: %', not_ready;
    END IF;

    FOR current_batch IN 0..COALESCE(last_batch, -1) LOOP
      batch_started := clock_timestamp();
      TRUNCATE batch_ids;
      INSERT INTO batch_ids SELECT user_id FROM to_delete WHERE batch = current_batch;
      GET DIAGNOSTICS listed = ROW_COUNT;
      ANALYZE batch_ids;

      -- From here until the batch is saved, nobody else can attach a row to one of these accounts.
      PERFORM 1 FROM sidewalk_login.sidewalk_user
      WHERE user_id IN (SELECT user_id FROM batch_ids)
      FOR UPDATE;

      -- The list is minutes to hours old by now, so anyone on it who has done or logged something since comes off.
      FOR source IN SELECT * FROM sources WHERE kind IN ('work', 'campaign') LOOP
        EXECUTE format(
          'DELETE FROM batch_ids WHERE EXISTS (SELECT 1 FROM %1$I.%2$I WHERE %2$I.%3$I = batch_ids.user_id)',
          source.table_schema, source.table_name, source.column_name);
      END LOOP;
      FOR source IN SELECT * FROM sources WHERE kind = 'activity' LOOP
        EXECUTE format(
          'DELETE FROM batch_ids
           WHERE EXISTS (SELECT 1 FROM %1$I.%2$I CROSS JOIN settings
                         WHERE %2$I.%3$I = batch_ids.user_id AND %2$I.timestamp > settings.quiet_since)',
          source.table_schema, source.table_name, source.column_name);
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

      -- Everything that could point at these accounts was just checked or cleared above, so Postgres's own
      -- per-account check is skipped for this one statement.
      SET LOCAL session_replication_role = replica;
      DELETE FROM sidewalk_login.sidewalk_user WHERE user_id IN (SELECT user_id FROM batch_ids);
      GET DIAGNOSTICS removed = ROW_COUNT;
      SET LOCAL session_replication_role = origin;

      INSERT INTO deleted SELECT user_id FROM batch_ids;
      COMMIT;
      RAISE NOTICE 'batch % of %: deleted % accounts, skipped % (%)', current_batch + 1, last_batch + 1, removed,
        listed - removed, date_trunc('second', clock_timestamp() - batch_started);
    END LOOP;

    -- Proof that nothing still points at a deleted account, including tables with no foreign key to stop it.
    ANALYZE deleted;
    FOR source IN SELECT * FROM sources LOOP
      EXECUTE format(
        'INSERT INTO left_behind
         SELECT %1$L, %2$L, COUNT(*) FROM %1$I.%2$I WHERE %3$I IN (SELECT user_id FROM deleted) HAVING COUNT(*) > 0',
        source.table_schema, source.table_name, source.column_name);
    END LOOP;
  END $$;
\endif

-- One row per sign-up page and decision, then the totals. Pages with few accounts are lumped together.
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
  SELECT 5, 'result', 'accounts skipped at the last moment (active since the list was made)',
         CASE WHEN :apply::int = 1 THEN (SELECT COUNT(*) FROM to_delete) - (SELECT COUNT(*) FROM deleted) ELSE 0 END,
         NULL
  UNION ALL
  SELECT 6, 'result', 'rows left behind that still name a deleted account (expect 0)',
         (SELECT COALESCE(SUM(row_count), 0) FROM left_behind), NULL
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
  -- Lets the space the deleted rows took up be used again.
  VACUUM ANALYZE sidewalk_login.sidewalk_user;
  VACUUM ANALYZE sidewalk_login.user_role;
  VACUUM ANALYZE sidewalk_login.user_login_info;
  VACUUM ANALYZE sidewalk_login.login_info;
  VACUUM ANALYZE sidewalk_login.user_password_info;
\endif
