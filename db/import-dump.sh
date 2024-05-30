#!/bin/bash

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
    ALTER ROLE $1 SET search_path = $1, public;
EOSQL
