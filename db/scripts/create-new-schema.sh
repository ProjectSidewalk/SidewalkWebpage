#!/bin/bash
set -e  # Exit on any error

/opt/scripts/import-dump.sh "sidewalk_init"

# Rename the sidewalk_init to the given name, create a user w/ that name, and give the user appropriate permissions.
psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    DROP SCHEMA IF EXISTS $1 CASCADE;
    DROP USER IF EXISTS $1;

    ALTER SCHEMA sidewalk_init RENAME TO $1;
    CREATE USER $1;
    GRANT sidewalk TO $1;
    ALTER SCHEMA $1 OWNER TO sidewalk;
    ALTER ROLE $1 SET search_path = $1,sidewalk_login,public;

    -- import-dump.sh registered default privileges under the sidewalk_init role; rebind them to the new role
    -- so sidewalk_init has no lingering dependencies blocking it from being dropped on the next run.
    DO \$\$
    BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk_init IN SCHEMA %I REVOKE SELECT ON TABLES FROM readonly_user', '$1');
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO readonly_user', '$1', '$1');
        END IF;
    END \$\$;
EOSQL
