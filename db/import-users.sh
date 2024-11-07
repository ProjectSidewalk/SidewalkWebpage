#!/bin/bash

psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE (pg_stat_activity.datname = 'sidewalk')
    AND pid <> pg_backend_pid();

    DROP SCHEMA IF EXISTS sidewalk_login CASCADE;
EOSQL

pg_restore -U sidewalk -Fc -d sidewalk /opt/sidewalk_users-dump
