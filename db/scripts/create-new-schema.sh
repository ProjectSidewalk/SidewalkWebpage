#!/usr/bin/env bash
# =====================================================================================================================
# create-new-schema.sh — create a brand-new, empty city schema from the committed template.
#
# WHY THIS EXISTS: when you're standing up a new city (before you have a data dump for it), you need an empty schema
# with the full Project Sidewalk table structure. This restores the `sidewalk_init` template (via import-dump.sh),
# renames it to the city schema you asked for, creates the owning role, and wires up search_path + read-only grants.
# After this, you'd load the city's streets/regions with fill-new-schema.sh.
#
# HOW IT'S RUN:  make create-new-schema name=<schema_name>   →   /opt/scripts/create-new-schema.sh <schema_name>.
# INPUT:         $1 = new schema name (e.g. sidewalk_newcity). Restores from the committed sidewalk_init-dump template.
#
# GOTCHA: the name is interpolated into DDL, so it must be a safe bare SQL identifier (validated below). Re-running for
# an existing name drops and recreates that schema — destructive, as intended for a fresh setup.
# =====================================================================================================================
set -euo pipefail

NAME=${1:-}
if [[ -z "$NAME" ]]; then
    echo "Usage: create-new-schema.sh <schema_name>   (e.g. sidewalk_newcity)" >&2
    echo "       Typically run via: make create-new-schema name=<schema_name>" >&2
    exit 1
fi
if [[ ! "$NAME" =~ ^[a-z][a-z0-9_]*$ ]]; then
    echo "Error: '$NAME' is not a valid schema name." >&2
    echo "       Use lowercase letters, digits, and underscores, starting with a letter (e.g. sidewalk_newcity)." >&2
    exit 1
fi

# Restore a fresh copy of the empty template into the sidewalk_init schema (from the committed sidewalk_init-dump).
/opt/scripts/import-dump.sh "sidewalk_init"

# Rename sidewalk_init to the requested name, create a matching role, and give it appropriate permissions.
psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    DROP SCHEMA IF EXISTS $NAME CASCADE;
    DROP USER IF EXISTS $NAME;

    ALTER SCHEMA sidewalk_init RENAME TO $NAME;
    CREATE USER $NAME;
    GRANT sidewalk TO $NAME;
    ALTER SCHEMA $NAME OWNER TO sidewalk;
    ALTER ROLE $NAME SET search_path = $NAME,sidewalk_login,public;

    -- import-dump.sh registered default privileges under the sidewalk_init role; rebind them to the new role
    -- so sidewalk_init has no lingering dependencies blocking it from being dropped on the next run.
    DO \$\$
    BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk_init IN SCHEMA %I REVOKE SELECT ON TABLES FROM readonly_user', '$NAME');
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO readonly_user', '$NAME', '$NAME');
        END IF;
    END \$\$;
EOSQL
