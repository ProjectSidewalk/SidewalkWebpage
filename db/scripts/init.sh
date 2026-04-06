#!/bin/sh -e

psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<-EOSQL
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE (pg_stat_activity.datname = 'sidewalk')
    AND pid <> pg_backend_pid();

    DROP DATABASE IF EXISTS "sidewalk";
    DROP USER IF EXISTS sidewalk;

    CREATE USER sidewalk WITH PASSWORD 'sidewalk';
    CREATE DATABASE "sidewalk" WITH OWNER=sidewalk TEMPLATE template0;
    GRANT ALL PRIVILEGES ON DATABASE sidewalk to sidewalk;

    ALTER USER sidewalk SUPERUSER;
    GRANT ALL PRIVILEGES ON DATABASE sidewalk TO sidewalk;

    CREATE USER saugstad;
    GRANT sidewalk TO saugstad;
    CREATE USER sidewalk_init;
    GRANT sidewalk TO sidewalk_init;
EOSQL

psql -v ON_ERROR_STOP=1 -U sidewalk -d sidewalk <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;
    COMMENT ON EXTENSION plpgsql IS 'PL/pgSQL procedural language';

    CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
    COMMENT ON EXTENSION postgis IS 'PostGIS geometry, geography, and raster spatial types and functions';
EOSQL

pg_restore -U sidewalk -Fc -d sidewalk /opt/sidewalk_init_users_dump
pg_restore -U sidewalk -Fc -d sidewalk /opt/sidewalk_init_dump

# Create a read-only user for safe database exploration (e.g., by Claude Code).
psql -v ON_ERROR_STOP=1 -U sidewalk -d sidewalk <<-'EOSQL'
    DO $$
    DECLARE
        schema_name TEXT;
    BEGIN
        -- Create the read-only role.
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
            CREATE ROLE readonly_user WITH LOGIN PASSWORD 'readonly';
        END IF;
        GRANT CONNECT ON DATABASE sidewalk TO readonly_user;

        -- Grant SELECT on all sidewalk schemas, with default privileges for each schema's owner.
        FOR schema_name IN
            SELECT nspname FROM pg_namespace WHERE nspname LIKE 'sidewalk_%'
        LOOP
            EXECUTE format('GRANT USAGE ON SCHEMA %I TO readonly_user', schema_name);
            EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO readonly_user', schema_name);
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO readonly_user', schema_name, schema_name);
        END LOOP;
    END $$;
EOSQL

# Remove any password authentication on databases. This should be used for dev environment only.
sed -i -e 's/host all all all scram-sha-256/host all all all trust/' /var/lib/postgresql/data/pg_hba.conf
