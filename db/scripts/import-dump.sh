#!/bin/bash
set -e  # Exit on any error

psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE (pg_stat_activity.datname = 'sidewalk')
    AND pid <> pg_backend_pid();

    DROP SCHEMA IF EXISTS $1 CASCADE;
    DROP USER IF EXISTS $1;

    CREATE USER $1;
    GRANT sidewalk TO $1;
EOSQL

pg_restore -U sidewalk -Fc -d sidewalk /opt/$1-dump

# Set the schema search path for the user so that it points to the schema for the correct city.
psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    ALTER ROLE $1 SET search_path = $1,sidewalk_login,public;
EOSQL

# Grant read-only access to the new schema if readonly_user exists.
psql -v ON_ERROR_STOP=1 -U sidewalk -d sidewalk <<-EOSQL
    DO \$\$
    BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
            EXECUTE format('GRANT USAGE ON SCHEMA %I TO readonly_user', '$1');
            EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO readonly_user', '$1');
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO readonly_user', '$1', '$1');
        END IF;
    END \$\$;
EOSQL
