#!/usr/bin/env bash
# =====================================================================================================================
# import-dump.sh — (re)load a single city's schema from its committed binary dump.
#
# WHY THIS EXISTS: each city lives in its own schema (sidewalk_seattle, sidewalk_amsterdam, ...) seeded from a
# `pg_restore` dump. This script drops any existing copy of that schema + owning role, recreates the role, restores the
# dump, points the role's search_path at the right schema, and (if present) re-grants the read-only role. It's the
# everyday "give me this city's data" command, and is also reused by create-new-schema.sh to load the empty template.
#
# HOW IT'S RUN:  make import-dump db=<schema_name>   →   /opt/scripts/import-dump.sh <schema_name>   (in projectsidewalk-db).
#                db defaults to "sidewalk" in the Makefile.
# INPUT:         $1 = schema name (e.g. sidewalk_seattle); restored from /opt/<schema_name>-dump (db/<schema_name>-dump
#                on the host). City dumps are git-ignored; the sidewalk_init template dump is committed.
#
# GOTCHAS:
#   - The schema name is interpolated directly into DDL, so it must be a safe bare SQL identifier (validated below).
#   - This force-terminates ALL connections to the `sidewalk` database before the drop (kills a running `npm start`'s
#     connections; sbt will reconnect).
# =====================================================================================================================
set -euo pipefail

source /opt/scripts/helpers.sh

SCHEMA=${1:-}
if [[ -z "$SCHEMA" ]]; then
    echo "Usage: import-dump.sh <schema_name>   (e.g. sidewalk_seattle)" >&2
    echo "       Typically run via: make import-dump db=<schema_name>" >&2
    exit 1
fi

# The name is interpolated into DDL (DROP/CREATE/ALTER below), so reject anything that isn't a plain SQL identifier
# rather than risk a broken statement or injection.
if [[ ! "$SCHEMA" =~ ^[a-z][a-z0-9_]*$ ]]; then
    echo "Error: '$SCHEMA' is not a valid schema name." >&2
    echo "       Use lowercase letters, digits, and underscores, starting with a letter (e.g. sidewalk_seattle)." >&2
    exit 1
fi

DUMP=/opt/$SCHEMA-dump
if [[ ! -f "$DUMP" ]]; then
    echo "Error: dump not found at $DUMP." >&2
    echo "       Place '${SCHEMA}-dump' in the db/ directory, or check the db= value (see docs/dev-environment.md)." >&2
    exit 1
fi

# Terminate other backends first so the DROP doesn't block, then drop and recreate the schema's owning role from clean.
psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE (pg_stat_activity.datname = 'sidewalk')
    AND pid <> pg_backend_pid();

    DROP SCHEMA IF EXISTS $SCHEMA CASCADE;
    DROP USER IF EXISTS $SCHEMA;

    CREATE USER $SCHEMA;
    GRANT sidewalk TO $SCHEMA;
EOSQL

# -j 4: parallel restore (valid for the -Fc custom-format dump) to speed up large city dumps; wrapped so the restore
# isn't a silent multi-minute wait.
run_with_progress "Restoring $SCHEMA dump" \
    pg_restore -U sidewalk -Fc -j 4 -d sidewalk "$DUMP"

# Set the schema search path for the user so that it points to the schema for the correct city.
psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    ALTER ROLE $SCHEMA SET search_path = $SCHEMA,sidewalk_login,public;
EOSQL

# Grant read-only access to the new schema if readonly_user exists (created by init.sh for safe DB exploration).
psql -v ON_ERROR_STOP=1 -U sidewalk -d sidewalk <<-EOSQL
    DO \$\$
    BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
            EXECUTE format('GRANT USAGE ON SCHEMA %I TO readonly_user', '$SCHEMA');
            EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO readonly_user', '$SCHEMA');
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO readonly_user', '$SCHEMA', '$SCHEMA');
        END IF;
    END \$\$;
EOSQL
