#!/usr/bin/env bash
# =====================================================================================================================
# import-users.sh — (re)load the shared login schema (sidewalk_login) from the committed users dump.
#
# WHY THIS EXISTS: every city schema shares one `sidewalk_login` schema that holds accounts, roles, and auth data. The
# dev/CI database seeds this from a binary `pg_restore` dump rather than regenerating it, because it's large and not
# something evolutions produce. Run this once after the db container is up (and again whenever you refresh the dump).
#
# HOW IT'S RUN:  make import-users   →   docker exec ... /opt/scripts/import-users.sh   (inside projectsidewalk-db).
# INPUT:         /opt/sidewalk_users-dump  (i.e. db/sidewalk_users-dump on the host; git-ignored — see dev-environment.md).
#
# GOTCHAS:
#   - This force-terminates ALL connections to the `sidewalk` database before dropping the schema. If the web app
#     (`npm start`) is running, its DB connections are killed; just let sbt reconnect.
#   - The users dump is ~900 MB, so the restore takes a couple of minutes. run_with_progress shows a live clock; the
#     restore runs in parallel (-j) to keep that as short as possible.
# =====================================================================================================================
set -euo pipefail

source /opt/scripts/helpers.sh

DUMP=/opt/sidewalk_users-dump
if [[ ! -f "$DUMP" ]]; then
    echo "Error: users dump not found at $DUMP." >&2
    echo "       Place 'sidewalk_users-dump' in the db/ directory (it is git-ignored; see docs/dev-environment.md)." >&2
    exit 1
fi

# Terminate other backends first so the DROP doesn't hit "database is being accessed by other users" / lock waits, then
# drop the login schema so the restore starts from a clean slate.
psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE (pg_stat_activity.datname = 'sidewalk')
    AND pid <> pg_backend_pid();

    DROP SCHEMA IF EXISTS sidewalk_login CASCADE;
EOSQL

# -j 4: parallel restore (valid for the -Fc custom-format dump; we don't use --single-transaction) to speed up the
# large users dump. Wrapped in run_with_progress so the multi-minute restore isn't a silent wait.
run_with_progress "Restoring users dump (sidewalk_login)" \
    pg_restore -U sidewalk -Fc -j 4 -d sidewalk "$DUMP"

# The DROP SCHEMA above wiped readonly_user's grants on sidewalk_login, and the restored objects don't carry them, so
# re-grant read-only access (mirrors init.sh and import-dump.sh) — otherwise DB exploration via readonly_user breaks
# after every users re-import.
psql -v ON_ERROR_STOP=1 -U sidewalk -d sidewalk <<-EOSQL
    DO \$\$
    BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
            GRANT USAGE ON SCHEMA sidewalk_login TO readonly_user;
            GRANT SELECT ON ALL TABLES IN SCHEMA sidewalk_login TO readonly_user;
            ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk IN SCHEMA sidewalk_login GRANT SELECT ON TABLES TO readonly_user;
        END IF;
    END \$\$;
EOSQL
