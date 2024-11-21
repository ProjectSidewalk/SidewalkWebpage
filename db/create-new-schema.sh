#!/bin/bash

./import-dump.sh "sidewalk_init"

# Rename the sidewalk_init to the given name, create a user w/ that name,
# and give the user appropriate permissions.
psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    ALTER SCHEMA sidewalk_init RENAME TO $1;
    CREATE USER $1;
    GRANT sidewalk TO $1;
    ALTER SCHEMA $1 OWNER TO sidewalk;
EOSQL
