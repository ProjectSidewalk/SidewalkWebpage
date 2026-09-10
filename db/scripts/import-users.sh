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
#                    you already imported still point at them. Merging keeps them, and it also keeps every city's
#                    foreign keys into sidewalk_login, which a DROP SCHEMA ... CASCADE deletes.
#   --replace        Drop sidewalk_login and restore the dump from scratch. Use it for a fresh DB's first import, where
#                    there's nothing to keep and merging every account would take ~20 min. Anywhere else it throws away
#                    local-only accounts and every city's foreign keys into sidewalk_login; re-import your cities after.
#
# HOW A MERGE WORKS: pg_restore can only restore into the schema name the dump was made with, so the live schema steps
# aside as sidewalk_login_parked while the dump restores as sidewalk_login. When the restore finishes, the
# live schema gets its name again, the dump's copy becomes sidewalk_login_import, and one transaction copies the new
# accounts across. Renaming a schema doesn't disturb anything pointing into it: the cities' foreign keys follow the
# tables, not the name.
#
# HOW IT'S RUN:  make import-users [replace=1]  →  docker exec ... /opt/scripts/import-users.sh [--replace]
# INPUT:         /opt/sidewalk_users-dump  (i.e. db/sidewalk_users-dump on the host; git-ignored — see dev-environment.md).
#
# GOTCHAS:
#   - This force-terminates ALL connections to the `sidewalk` database first. If the web app (`npm start`) is running,
#     its DB connections are killed; just let sbt reconnect, but don't use the site until the script finishes.
#   - The users dump is ~1 GB, so the restore takes a couple of minutes, and a merge needs room for a second copy of
#     the login tables while it runs.
#   - A merged account keeps its user_id (what city data points at) but gets new row ids in the other login tables
#     (login_info_id, user_role_id, ...): your local sign-ups already used some of the ids the dump has since handed
#     out on prod. Nothing outside sidewalk_login refers to those ids.
#   - An account you already have is never updated from the dump, even if it changed on prod since.
#   - If a new account's username is taken by one of your local accounts, the local one is renamed (the script lists
#     it) so the prod account, which city dumps may reference, can come in under its real name.
#   - A merge copies the columns both copies of a table have, so a dump a few evolutions away from your local schema
#     still merges. If it fails on a missing column, start the app once so your local schema catches up, then re-run.
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

# Recovers from a merge that stopped partway (also run up front, for a run killed outright): while the live schema is
# parked, whatever holds the sidewalk_login name is a half-restored dump, so it's safe to drop.
cleanup_merge() {
  # client_min_messages hides the "skipping" and "drop cascades to" notices, which are routine here.
  psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" <<-'EOSQL'
    SET client_min_messages = warning;
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_namespace WHERE nspname = 'sidewalk_login_parked') THEN
        RAISE WARNING 'Moving your login schema back into place after an interrupted merge.';
        DROP SCHEMA IF EXISTS sidewalk_login CASCADE;
        ALTER SCHEMA sidewalk_login_parked RENAME TO sidewalk_login;
      END IF;
    END $$;
    DROP SCHEMA IF EXISTS sidewalk_login_import CASCADE;
EOSQL
}

# Terminate other backends first so the DROP/RENAME doesn't hit lock waits.
psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" <<-EOSQL
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = '$DB'
      AND pid <> pg_backend_pid();
EOSQL

cleanup_merge
trap cleanup_merge EXIT

has_login_schema=$(psql -At -U postgres -d "$DB" \
  -c "SELECT EXISTS (SELECT FROM pg_namespace WHERE nspname = 'sidewalk_login');")
if [[ "$MODE" == merge && "$has_login_schema" != t ]]; then
  echo "No sidewalk_login schema yet, so there's nothing to merge into; restoring the dump as-is."
  MODE=replace
fi

if [[ "$MODE" == replace ]]; then
  psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "DROP SCHEMA IF EXISTS sidewalk_login CASCADE;"
  # -j 4: parallel restore (valid for the -Fc custom-format dump; we don't use --single-transaction).
  run_with_progress "Restoring users dump (sidewalk_login)" \
    pg_restore -U sidewalk -Fc -j 4 -d "$DB" "$DUMP"
else
  psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "ALTER SCHEMA sidewalk_login RENAME TO sidewalk_login_parked;"
  run_with_progress "Restoring users dump into a side schema" \
    pg_restore -U sidewalk -Fc -j 4 -d "$DB" "$DUMP"
  psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" <<-'EOSQL'
    BEGIN;
    ALTER SCHEMA sidewalk_login RENAME TO sidewalk_login_import;
    ALTER SCHEMA sidewalk_login_parked RENAME TO sidewalk_login;
    COMMIT;
EOSQL

  echo "⏳ Merging new accounts into sidewalk_login..." >&2
  psql -q -v ON_ERROR_STOP=1 -U sidewalk -d "$DB" <<-'EOSQL'
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

    -- A login table this script has no rule for would silently lose the dump's rows, so name it.
    DO $$
    DECLARE
      unhandled text;
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
    END $$;

    -- The accounts to add: in the dump, but not here.
    CREATE TEMP TABLE new_account ON COMMIT DROP AS
    SELECT user_id FROM sidewalk_login_import.sidewalk_user
    EXCEPT
    SELECT user_id FROM sidewalk_login.sidewalk_user;
    ALTER TABLE new_account ADD PRIMARY KEY (user_id);
    ANALYZE new_account;

    -- A local account holding a username that one of the new accounts has on prod gives the name up, keeping a short
    -- piece of its user_id so the new name stays unique and within the 30-character limit.
    CREATE TEMP TABLE renamed_account ON COMMIT DROP AS
    SELECT user_id, username AS old_username, left(username, 21) || '_' || left(user_id, 8) AS new_username
    FROM sidewalk_login.sidewalk_user
    WHERE username IN (
      SELECT sidewalk_user.username
      FROM sidewalk_login_import.sidewalk_user
      INNER JOIN new_account ON new_account.user_id = sidewalk_user.user_id
    );
    UPDATE sidewalk_login.sidewalk_user
    SET username = renamed_account.new_username
    FROM renamed_account
    WHERE renamed_account.user_id = sidewalk_user.user_id;

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
    SELECT pg_temp.copy_rows('partner', '{partner_id}',
      'WHERE NOT EXISTS (
         SELECT FROM sidewalk_login.partner
         WHERE sidewalk_login.partner.name = sidewalk_login_import.partner.name
           AND sidewalk_login.partner.city_id IS NOT DISTINCT FROM sidewalk_login_import.partner.city_id
       )') AS partner_added \gset

    -- Anonymous clashes can number in the thousands (a city's login migration run locally gives its accounts different
    -- user_ids than prod's run did), and nobody logs in to one, so only the other renamed accounts are listed.
    CREATE TEMP TABLE renamed_login ON COMMIT DROP AS
    SELECT renamed_account.old_username, renamed_account.new_username
    FROM renamed_account
    WHERE NOT EXISTS (
      SELECT FROM sidewalk_login.user_role
      WHERE user_role.user_id = renamed_account.user_id AND user_role.role::text = 'Anonymous'
    );
    SELECT (SELECT count(*) FROM renamed_account) AS renamed_count,
           (SELECT count(*) FROM renamed_login) AS renamed_login_count,
           (SELECT count(*) > 0 FROM renamed_login) AS any_renamed_login,
           (SELECT count(*) > 25 FROM renamed_login) AS more_renamed_login \gset
    \if :any_renamed_login
      \echo 'These accounts the dump does not have used a username one of its new accounts has, so they were renamed:'
      SELECT format('  %s -> %s', old_username, new_username) FROM renamed_login ORDER BY old_username LIMIT 25
      \g (format=unaligned tuples_only=on)
      \if :more_renamed_login
        \echo '  (first 25 of' :renamed_login_count 'shown)'
      \endif
    \endif

    SELECT format('✓ Added %s new accounts (%s login_info, %s user_login_info, %s user_password_info, %s user_role, '
                  '%s user_utm rows) and %s partners. Kept %s accounts the dump does not have, renaming %s of them '
                  'for a username clash.',
                  :accounts_added, :login_info_added, :user_login_info_added, :user_password_info_added,
                  :user_role_added, :user_utm_added, :partner_added,
                  (SELECT count(*)
                   FROM sidewalk_login.sidewalk_user
                   WHERE NOT EXISTS (
                     SELECT FROM sidewalk_login_import.sidewalk_user
                     WHERE sidewalk_login_import.sidewalk_user.user_id = sidewalk_login.sidewalk_user.user_id
                   )),
                  :renamed_count)
    \g (format=unaligned tuples_only=on)

    COMMIT;
EOSQL

  cleanup_merge
  # The planner's row counts for these tables are stale after a big merge (e.g. into the tiny first-boot schema).
  psql -q -v ON_ERROR_STOP=1 -U sidewalk -d "$DB" -c "ANALYZE sidewalk_login.sidewalk_user, sidewalk_login.login_info,
    sidewalk_login.user_login_info, sidewalk_login.user_password_info, sidewalk_login.user_role,
    sidewalk_login.user_utm, sidewalk_login.partner;"
fi

# A fresh restore's objects don't carry readonly_user's grants, so re-grant them (mirrors init.sh and import-dump.sh).
psql -q -v ON_ERROR_STOP=1 -U sidewalk -d "$DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
        GRANT USAGE ON SCHEMA sidewalk_login TO readonly_user;
        GRANT SELECT ON ALL TABLES IN SCHEMA sidewalk_login TO readonly_user;
        ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk IN SCHEMA sidewalk_login GRANT SELECT ON TABLES TO readonly_user;
      END IF;
    END \$\$;
EOSQL
