#!/bin/sh -e

psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<-EOSQL
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE (pg_stat_activity.datname = 'sidewalk')
    AND pid <> pg_backend_pid();

    DROP DATABASE IF EXISTS "sidewalk";
    DROP SCHEMA IF EXISTS sidewalk;
    DROP USER IF EXISTS sidewalk;

    CREATE USER sidewalk WITH PASSWORD 'sidewalk';
    CREATE DATABASE "sidewalk" WITH OWNER=sidewalk TEMPLATE template0;
    GRANT ALL PRIVILEGES ON DATABASE sidewalk to sidewalk;

    ALTER USER sidewalk SUPERUSER;
    GRANT ALL PRIVILEGES ON DATABASE sidewalk TO sidewalk;

    CREATE SCHEMA sidewalk;
    GRANT ALL ON ALL TABLES IN SCHEMA sidewalk TO sidewalk;
    ALTER DEFAULT PRIVILEGES IN SCHEMA sidewalk GRANT ALL ON TABLES TO sidewalk;
    ALTER DEFAULT PRIVILEGES IN SCHEMA sidewalk GRANT ALL ON SEQUENCES TO sidewalk;
EOSQL

psql -U sidewalk -d sidewalk -a -f /opt/schema.sql
psql -U sidewalk -d sidewalk -a -f /opt/fix-auto-inc.sql

# DOESN'T WORK
# sudo su -l postgres -c "psql sidewalk -c 'CREATE EXTENSION pgrouting'"
