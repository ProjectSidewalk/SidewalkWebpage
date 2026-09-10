#!/usr/bin/env bash
# =====================================================================================================================
# import-users.sh — load the shared login schema (sidewalk_login) from the users dump, merging it into what you have.
#
# WHY THIS EXISTS: every city schema shares one `sidewalk_login` schema that holds accounts, roles, and auth data. The
# dev/CI database seeds this from a binary `pg_restore` dump rather than regenerating it, because it's large and not
# something evolutions produce. Run this once after the db container is up, and again whenever a newer city dump needs
# accounts that were made on prod after your last users import.
#
# TWO MODES (#3721):
#   merge (default)  Adds the dump's accounts that you don't have yet and leaves every account you do have alone,
#                    including test accounts you made locally. Those local accounts are what break a wipe: the cities
#                    you already imported still point at them. A merge only writes rows, so the live schema's structure,
#                    and everything in the cities that depends on it, stays as it is.
#   --replace        Drop sidewalk_login and restore the dump from scratch. Use it for a fresh DB's first import, where
#                    there's nothing to keep and merging every account would take ~20 min. Anywhere else it's
#                    destructive: DROP SCHEMA ... CASCADE also drops every city's foreign keys into sidewalk_login,
#                    its survey_question.survey_user_role column (typed as the schema's `role` enum) and its
#                    label_comments_agg view, so re-import every city after it.
#
# HOW A MERGE WORKS: pg_restore can only restore into the schema name the dump was made with, so the dump is turned
# into SQL, and its schema name is rewritten to sidewalk_login_import on the way into psql. Only the table definitions
# and the COPY/setval lines name the schema, so data rows pass through untouched. One transaction then copies the new
# accounts across. The live schema is never renamed or dropped, so the app can keep running meanwhile.
#
# HOW IT'S RUN:  make import-users [replace=1]  →  docker exec ... /opt/scripts/import-users.sh [--replace]
# INPUT:         /opt/sidewalk_users-dump  (i.e. db/sidewalk_users-dump on the host; git-ignored — see dev-environment.md).
#
# GOTCHAS:
#   - --replace force-terminates ALL connections to the `sidewalk` database first. If the web app (`npm start`) is
#     running, its DB connections are killed; just let sbt reconnect.
#   - The users dump is ~1 GB, so loading it takes a minute or two, and a merge needs room for a second copy of the
#     login tables while it runs.
#   - A merged account keeps its user_id (what city data points at) but gets new row ids in the other login tables
#     (login_info_id, user_role_id, ...): your local sign-ups already used some of the ids the dump has since handed
#     out on prod. Nothing outside sidewalk_login refers to those ids.
#   - An account you already have is never updated from the dump, even if it changed on prod since. The exception is a
#     clash: the app finds accounts by username and by email, so if a new account has the username or email of one you
#     have, yours gives it up (the script lists which). The new account may be what a city dump references.
#   - A merge copies the columns both copies of a table have. It warns about columns only the dump has (start the app
#     once so your schema catches up, then re-run) and fails on a required column only yours has (get a newer dump).
#   - It moves rows, not structure. Constraints and indexes the dump has but your schema lacks are listed, not added:
#     one could fail on your local data, and `--replace` is the way to take prod's structure wholesale.
# =====================================================================================================================
set -euo pipefail

source /opt/scripts/helpers.sh

DB=sidewalk
DUMP=/opt/sidewalk_users-dump

MODE=merge
case "${1:-}" in
  "") ;;
  --replace) MODE=replace ;;
  *)
    echo "Usage: import-users.sh [--replace]" >&2
    echo "       Typically run via: make import-users [replace=1]" >&2
    exit 1
    ;;
esac

if [[ ! -f "$DUMP" ]]; then
  echo "Error: users dump not found at $DUMP." >&2
  echo "       Place 'sidewalk_users-dump' in the db/ directory (it is git-ignored; see docs/dev-environment.md)." >&2
  exit 1
fi

# A second run would load into, and then drop, the side schema the first one is using.
exec 9>/tmp/import-users.lock
if ! flock -n 9; then
  echo "Error: another import-users is already running." >&2
  exit 1
fi

# -X skips any ~/.psqlrc, which could add output to what's parsed here.
has_login_schema=$(psql -X -At -U postgres -d "$DB" \
  -c "SELECT EXISTS (SELECT FROM pg_namespace WHERE nspname = 'sidewalk_login');")
case "$has_login_schema" in
  t) ;;
  f)
    if [[ "$MODE" == merge ]]; then
      echo "No sidewalk_login schema yet, so there's nothing to merge into; restoring the dump as-is."
      MODE=replace
    fi
    ;;
  *)
    echo "Error: couldn't tell whether sidewalk_login exists; psql returned: $has_login_schema" >&2
    exit 1
    ;;
esac

if [[ "$MODE" == replace ]]; then
  # Terminate other backends first so the DROP doesn't hit lock waits.
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB" <<-EOSQL
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = '$DB'
      AND pid <> pg_backend_pid();
EOSQL
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "DROP SCHEMA IF EXISTS sidewalk_login CASCADE;"
  # -j 4: parallel restore (valid for the -Fc custom-format dump; we don't use --single-transaction).
  run_with_progress "Restoring users dump (sidewalk_login)" \
    pg_restore -U sidewalk -Fc -j 4 -d "$DB" "$DUMP"

  # The restored objects don't carry readonly_user's grants, so re-grant them (mirrors init.sh and import-dump.sh).
  psql -X -q -v ON_ERROR_STOP=1 -U sidewalk -d "$DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
        GRANT USAGE ON SCHEMA sidewalk_login TO readonly_user;
        GRANT SELECT ON ALL TABLES IN SCHEMA sidewalk_login TO readonly_user;
        ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk IN SCHEMA sidewalk_login GRANT SELECT ON TABLES TO readonly_user;
      END IF;
    END \$\$;
EOSQL
  exit 0
fi

drop_import_schema() {
  psql -X -q -v ON_ERROR_STOP=1 -U sidewalk -d "$DB" \
    -c "SET client_min_messages = warning; DROP SCHEMA IF EXISTS sidewalk_login_import CASCADE;"
}

# Loads the dump into sidewalk_login_import. It skips the dump's indexes and constraints: the merge doesn't need them,
# and building them over ~6M rows would be most of the load time.
load_import_schema() {
  pg_restore --section=pre-data -f - "$DUMP" \
    | sed -E 's/\bsidewalk_login\b/sidewalk_login_import/g' \
    | psql -X -q -v ON_ERROR_STOP=1 -U sidewalk -d "$DB"
  pg_restore --data-only -f - "$DUMP" \
    | sed -E '/^(COPY|SELECT pg_catalog\.setval)/ s/\bsidewalk_login\b/sidewalk_login_import/' \
    | psql -X -q -v ON_ERROR_STOP=1 -U sidewalk -d "$DB"
  # Without row counts the planner guesses these tables are tiny and picks nested loops over millions of rows.
  psql -X -q -v ON_ERROR_STOP=1 -U sidewalk -d "$DB" <<-'EOSQL'
    DO $$
    DECLARE
      tbl text;
    BEGIN
      FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'sidewalk_login_import' LOOP
        EXECUTE format('ANALYZE sidewalk_login_import.%I', tbl);
      END LOOP;
    END $$;
EOSQL
}

drop_import_schema
trap drop_import_schema EXIT
run_with_progress "Loading users dump into a side schema" load_import_schema

# The dump's constraint and index names, so the merge can point out any the live schema lacks.
dump_objects=$(pg_restore -l "$DUMP" \
  | awk '/^[0-9]+;/ && ($4 == "INDEX" || $4 == "CONSTRAINT" || ($4 == "FK" && $5 == "CONSTRAINT")) {print $(NF-1)}' \
  | paste -sd, -)

echo "⏳ Merging new accounts into sidewalk_login..." >&2
psql -X -q -v ON_ERROR_STOP=1 -v dump_objects="{$dump_objects}" -U sidewalk -d "$DB" <<-'EOSQL'
  BEGIN;
  -- The joins below run over millions of accounts; the dev server's 4 MB default spills every one of them to disk.
  -- Parallel workers would share that memory through /dev/shm, which Docker caps at 64 MB, so they're turned off.
  SET LOCAL work_mem = '256MB';
  SET LOCAL max_parallel_workers_per_gather = 0;

  -- Copies rows from the dump's copy of a login table into the live one and returns how many it copied. It takes
  -- every column the two copies share except those in `skip`, so a dump that's an evolution or two away from the
  -- local schema still lines up. A column whose type differs goes through text: that's how the dump's copy of the
  -- `role` enum lands in the live one. `extra_cols` / `extra_vals` add columns the caller fills itself (a remapped
  -- id), and `joins` picks which of the dump's rows to copy.
  CREATE FUNCTION pg_temp.copy_rows(tbl text, skip text[], joins text, extra_cols text DEFAULT NULL,
                                    extra_vals text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
  DECLARE
    target_cols text;
    source_cols text;
    copied bigint;
  BEGIN
    WITH live_col AS (
      SELECT attname, attnum, atttypid, atttypmod
      FROM pg_attribute
      WHERE attrelid = format('sidewalk_login.%I', tbl)::regclass AND attnum > 0 AND NOT attisdropped
    ), import_col AS (
      SELECT attname, atttypid
      FROM pg_attribute
      WHERE attrelid = format('sidewalk_login_import.%I', tbl)::regclass AND attnum > 0 AND NOT attisdropped
    )
    SELECT string_agg(format('%I', live_col.attname), ', ' ORDER BY live_col.attnum),
           string_agg(CASE WHEN live_col.atttypid = import_col.atttypid
                           THEN format('sidewalk_login_import.%I.%I', tbl, live_col.attname)
                           ELSE format('sidewalk_login_import.%I.%I::text::%s', tbl, live_col.attname,
                                       format_type(live_col.atttypid, live_col.atttypmod))
                      END, ', ' ORDER BY live_col.attnum)
    INTO target_cols, source_cols
    FROM live_col
    INNER JOIN import_col ON import_col.attname = live_col.attname
    WHERE live_col.attname <> ALL (skip);

    EXECUTE format('INSERT INTO sidewalk_login.%I (%s) SELECT %s FROM sidewalk_login_import.%I %s',
                   tbl, concat_ws(', ', extra_cols, target_cols), concat_ws(', ', extra_vals, source_cols),
                   tbl, joins);
    GET DIAGNOSTICS copied = ROW_COUNT;
    RETURN copied;
  END $$;

  -- What a merge can't carry over is named rather than silently dropped.
  DO $$
  DECLARE
    unhandled text;
    dump_only_columns text;
  BEGIN
    SELECT string_agg(tablename, ', ') INTO unhandled
    FROM pg_tables
    WHERE schemaname = 'sidewalk_login_import'
      AND tablename <> ALL (
        '{sidewalk_user,login_info,user_login_info,user_password_info,user_role,user_utm,partner}'
      );
    IF unhandled IS NOT NULL THEN
      RAISE WARNING 'The dump has login tables this script does not merge: %. Add a rule for them to %.',
        unhandled, 'import-users.sh';
    END IF;

    SELECT string_agg(format('%s.%s', table_name, column_name), ', ' ORDER BY table_name, ordinal_position)
    INTO dump_only_columns
    FROM information_schema.columns
    WHERE table_schema = 'sidewalk_login_import'
      AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'sidewalk_login')
      AND (table_name, column_name) NOT IN (
        SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'sidewalk_login'
      );
    IF dump_only_columns IS NOT NULL THEN
      RAISE WARNING 'The dump has columns your login schema lacks, so merged accounts come in without them: %. '
        'Start the app once so your schema catches up to the dump, then re-run.', dump_only_columns;
    END IF;
  END $$;

  WITH dump_object AS (SELECT unnest(:'dump_objects'::text[]) AS name)
  SELECT coalesce(string_agg(name, ', ' ORDER BY name), '') AS missing_objects, count(*) > 0 AS any_missing_objects
  FROM dump_object
  WHERE name NOT IN (SELECT conname FROM pg_constraint WHERE connamespace = 'sidewalk_login'::regnamespace)
    AND name NOT IN (SELECT relname FROM pg_class WHERE relnamespace = 'sidewalk_login'::regnamespace AND relkind = 'i')
  \gset
  \if :any_missing_objects
    \warn 'WARNING:  Your login schema lacks these constraints/indexes the dump has:' :missing_objects
    \warn '          A merge only moves rows; replace=1 takes the dump''s structure (then re-import every city).'
  \endif

  -- The accounts to add: in the dump, but not here.
  CREATE TEMP TABLE new_account ON COMMIT DROP AS
  SELECT user_id FROM sidewalk_login_import.sidewalk_user
  EXCEPT
  SELECT user_id FROM sidewalk_login.sidewalk_user;
  ALTER TABLE new_account ADD PRIMARY KEY (user_id);
  ANALYZE new_account;

  CREATE TEMP TABLE new_identity ON COMMIT DROP AS
  SELECT sidewalk_user.username, lower(sidewalk_user.email) AS lower_email
  FROM sidewalk_login_import.sidewalk_user
  INNER JOIN new_account ON new_account.user_id = sidewalk_user.user_id;
  ANALYZE new_identity;

  -- Sign-in, sessions and the "is it taken?" checks find an account by username or by lowercased email, so a local
  -- account sharing either with a new one gives it up. Anonymous accounts rename outright and keep the app's
  -- anonymous@<username>.com form. Others keep what doesn't clash, plus a short piece of their user_id so the new
  -- value stays unique and a username stays within the 30-character limit.
  CREATE TEMP TABLE renamed_account ON COMMIT DROP AS
  WITH clashing AS (
    SELECT sidewalk_user.user_id, sidewalk_user.username, sidewalk_user.email,
           sidewalk_user.username IN (SELECT username FROM new_identity) AS username_taken,
           lower(sidewalk_user.email) IN (SELECT lower_email FROM new_identity) AS email_taken,
           EXISTS (
             SELECT FROM sidewalk_login.user_role
             WHERE user_role.user_id = sidewalk_user.user_id AND user_role.role::text = 'Anonymous'
           ) AS anonymous
    FROM sidewalk_login.sidewalk_user
    WHERE sidewalk_user.username IN (SELECT username FROM new_identity)
       OR lower(sidewalk_user.email) IN (SELECT lower_email FROM new_identity)
  ), renamed AS (
    SELECT clashing.*,
           CASE WHEN username_taken OR anonymous THEN left(username, 21) || '_' || left(user_id, 8)
                ELSE username END AS new_username
    FROM clashing
  )
  SELECT user_id, anonymous, username AS old_username, new_username, email AS old_email,
         CASE WHEN anonymous THEN 'anonymous@' || new_username || '.com'
              WHEN email_taken THEN left(user_id, 8) || '.' || email
              ELSE email END AS new_email
  FROM renamed;

  UPDATE sidewalk_login.sidewalk_user
  SET username = renamed_account.new_username, email = renamed_account.new_email
  FROM renamed_account
  WHERE renamed_account.user_id = sidewalk_user.user_id;

  -- Sign-in looks the password up through login_info's lowercased copy of the email, so that follows too.
  UPDATE sidewalk_login.login_info
  SET provider_key = lower(renamed_account.new_email)
  FROM renamed_account
  INNER JOIN sidewalk_login.user_login_info ON user_login_info.user_id = renamed_account.user_id
  WHERE login_info.login_info_id = user_login_info.login_info_id
    AND login_info.provider_key = lower(renamed_account.old_email)
    AND renamed_account.new_email <> renamed_account.old_email;

  -- The dump's login_info ids for newer accounts overlap the ones local sign-ups took from the same sequence, so
  -- every merged login_info row gets a fresh id, and the two tables that point at login_info follow this map.
  CREATE TEMP TABLE login_info_map ON COMMIT DROP AS
  WITH merged_login_info AS (
    SELECT DISTINCT user_login_info.login_info_id
    FROM sidewalk_login_import.user_login_info
    INNER JOIN new_account ON new_account.user_id = user_login_info.user_id
  )
  SELECT login_info_id AS old_id,
         nextval(pg_get_serial_sequence('sidewalk_login.login_info', 'login_info_id')) AS new_id
  FROM merged_login_info;
  ALTER TABLE login_info_map ADD PRIMARY KEY (old_id);
  ANALYZE login_info_map;

  SELECT pg_temp.copy_rows('sidewalk_user', '{}',
    'INNER JOIN new_account ON new_account.user_id = sidewalk_user.user_id') AS accounts_added \gset
  SELECT pg_temp.copy_rows('login_info', '{login_info_id}',
    'INNER JOIN login_info_map ON login_info_map.old_id = login_info.login_info_id',
    'login_info_id', 'login_info_map.new_id') AS login_info_added \gset
  SELECT pg_temp.copy_rows('user_login_info', '{user_login_info_id,login_info_id}',
    'INNER JOIN new_account ON new_account.user_id = user_login_info.user_id
     INNER JOIN login_info_map ON login_info_map.old_id = user_login_info.login_info_id',
    'login_info_id', 'login_info_map.new_id') AS user_login_info_added \gset
  SELECT pg_temp.copy_rows('user_password_info', '{user_password_info_id,login_info_id}',
    'INNER JOIN login_info_map ON login_info_map.old_id = user_password_info.login_info_id',
    'login_info_id', 'login_info_map.new_id') AS user_password_info_added \gset
  SELECT pg_temp.copy_rows('user_role', '{user_role_id}',
    'INNER JOIN new_account ON new_account.user_id = user_role.user_id') AS user_role_added \gset
  SELECT pg_temp.copy_rows('user_utm', '{user_utm_id}',
    'INNER JOIN new_account ON new_account.user_id = user_utm.user_id') AS user_utm_added \gset
  -- Partners aren't owned by an account, so a dump partner comes in unless that city already has one by its name.
  -- Each scope's display_order is a dense 0..n-1, so merged partners go after the ones already there, in dump order.
  SELECT pg_temp.copy_rows('partner', '{partner_id,display_order}',
    'WHERE NOT EXISTS (
       SELECT FROM sidewalk_login.partner
       WHERE sidewalk_login.partner.name = sidewalk_login_import.partner.name
         AND sidewalk_login.partner.city_id IS NOT DISTINCT FROM sidewalk_login_import.partner.city_id
     )',
    'display_order',
    '(SELECT coalesce(max(sidewalk_login.partner.display_order) + 1, 0)
      FROM sidewalk_login.partner
      WHERE sidewalk_login.partner.city_id IS NOT DISTINCT FROM sidewalk_login_import.partner.city_id)
     + row_number() OVER (PARTITION BY sidewalk_login_import.partner.city_id
                          ORDER BY sidewalk_login_import.partner.display_order) - 1') AS partner_added \gset

  -- Anonymous clashes can number in the thousands (a city's login migration run locally gives its accounts different
  -- user_ids than prod's run did), and nobody logs in to one, so only the other changed accounts are listed.
  SELECT count(*) AS renamed_count,
         count(*) FILTER (WHERE anonymous) AS renamed_anonymous_count,
         count(*) FILTER (WHERE NOT anonymous) AS renamed_login_count,
         count(*) FILTER (WHERE NOT anonymous) > 0 AS any_renamed_login,
         count(*) FILTER (WHERE NOT anonymous) > 25 AS more_renamed_login
  FROM renamed_account \gset
  \if :any_renamed_login
    \echo 'These accounts shared a username or email with one of the dump''s new accounts, so theirs changed:'
    SELECT format('  %s: %s', old_username,
                  concat_ws(', ', CASE WHEN new_username <> old_username THEN 'username -> ' || new_username END,
                                  CASE WHEN new_email <> old_email THEN 'email -> ' || new_email END))
    FROM renamed_account
    WHERE NOT anonymous
    ORDER BY old_username
    LIMIT 25
    \g (format=unaligned tuples_only=on)
    \if :more_renamed_login
      \echo '  (first 25 of' :renamed_login_count 'shown)'
    \endif
  \endif

  SELECT format('✓ Added %s new accounts (%s login_info, %s user_login_info, %s user_password_info, %s user_role, '
                '%s user_utm rows) and %s partners. Kept %s accounts the dump does not have. Changed the username '
                'or email of %s accounts (%s anonymous) that clashed with a new one.',
                :accounts_added, :login_info_added, :user_login_info_added, :user_password_info_added,
                :user_role_added, :user_utm_added, :partner_added,
                (SELECT count(*)
                 FROM sidewalk_login.sidewalk_user
                 WHERE NOT EXISTS (
                   SELECT FROM sidewalk_login_import.sidewalk_user
                   WHERE sidewalk_login_import.sidewalk_user.user_id = sidewalk_login.sidewalk_user.user_id
                 )),
                :renamed_count, :renamed_anonymous_count)
  \g (format=unaligned tuples_only=on)

  COMMIT;
EOSQL

drop_import_schema
# The planner's row counts for these tables are stale after a big merge (e.g. into the tiny first-boot schema).
psql -X -q -v ON_ERROR_STOP=1 -U sidewalk -d "$DB" -c "ANALYZE sidewalk_login.sidewalk_user, sidewalk_login.login_info,
  sidewalk_login.user_login_info, sidewalk_login.user_password_info, sidewalk_login.user_role,
  sidewalk_login.user_utm, sidewalk_login.partner;"
