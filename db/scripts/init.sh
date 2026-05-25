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

# Add the AI user and create a read-only user for safe database exploration (e.g., by Claude Code).
psql -v ON_ERROR_STOP=1 -U sidewalk -d sidewalk <<-'EOSQL'
    DO $$
    DECLARE
        schema_name TEXT;
    BEGIN
        -- Add SidewalkAI user.
        INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
        SELECT '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 'SidewalkAI', 'sidewalkai@dummysitethatdoesnotexist.com'
        WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.sidewalk_user WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4');

        INSERT INTO sidewalk_login.user_role (user_id, role_id)
        SELECT '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 1
        WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.user_role WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4');

        -- Create the read-only role.
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
            CREATE ROLE readonly_user WITH LOGIN PASSWORD 'readonly';
        END IF;
        GRANT CONNECT ON DATABASE sidewalk TO readonly_user;

        -- Grant SELECT on sidewalk_login (owned by the sidewalk role).
        GRANT USAGE ON SCHEMA sidewalk_login TO readonly_user;
        GRANT SELECT ON ALL TABLES IN SCHEMA sidewalk_login TO readonly_user;
        ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk IN SCHEMA sidewalk_login GRANT SELECT ON TABLES TO readonly_user;

        -- Grant SELECT on per-city schemas (each owned by a role matching the schema name).
        FOR schema_name IN
            SELECT nspname FROM pg_namespace WHERE nspname LIKE 'sidewalk_%' AND nspname != 'sidewalk_login'
        LOOP
            EXECUTE format('GRANT USAGE ON SCHEMA %I TO readonly_user', schema_name);
            EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO readonly_user', schema_name);
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO readonly_user', schema_name, schema_name);
        END LOOP;
    END $$;
EOSQL

# Remove any password authentication on databases. This should be used for dev environment only.
sed -i -e 's/host all all all scram-sha-256/host all all all trust/' /var/lib/postgresql/data/pg_hba.conf
