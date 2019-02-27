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

psql -v ON_ERROR_STOP=1 -U sidewalk -d sidewalk <<-EOSQL
    SELECT setval('label_type_label_type_id_seq', (SELECT MAX(label_type_id) from sidewalk.label_type));
    SELECT setval('mission_type_mission_type_id_seq', (SELECT MAX(mission_type_id) from sidewalk.mission_type));
    SELECT setval('role_role_id_seq', (SELECT MAX(role_id) from sidewalk.role));
    SELECT setval('survey_category_option_survey_category_option_id_seq', (SELECT MAX(survey_category_option_id) from sidewalk.survey_category_option));
    SELECT setval('survey_question_survey_question_id_seq', (SELECT MAX(survey_question_id) from sidewalk.survey_question));
    SELECT setval('tag_tag_id_seq', (SELECT MAX(tag_id) from sidewalk.tag));
EOSQL

psql -U sidewalk -d sidewalk -c 'CREATE EXTENSION IF NOT EXISTS postgis'
psql -U sidewalk -d sidewalk -c 'CREATE EXTENSION IF NOT EXISTS postgis_topology'
psql -U sidewalk -d sidewalk -c 'CREATE EXTENSION IF NOT EXISTS fuzzystrmatch'
psql -U sidewalk -d sidewalk -c 'CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder'

# DOESN'T WORK
# sudo su -l postgres -c "psql sidewalk -c 'CREATE EXTENSION pgrouting'"
