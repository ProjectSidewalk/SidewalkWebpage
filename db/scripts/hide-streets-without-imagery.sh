#!/bin/bash

prompt_with_default() {
    local prompt=$1
    local default=$2
    local input

    while true; do
        if [ -n "$default" ]; then
            read -p "${prompt} [${default}]: " input
            input="${input:-$default}"
            break
        else
            read -p "${prompt}: " input
            [ -n "$input" ] && break
        fi
    done
    
    echo "$input"
}

SCHEMA_NAME=$(prompt_with_default "Schema name" "")

# Prompt user for path to CSV file and prepend working dir.
CSV_FILENAME=$(prompt_with_default "Path to CSV file (relative to db dir)" "scripts/streets_with_no_imagery.csv")
CSV_FILENAME=/opt/$CSV_FILENAME

# Read list of streets to hide from CSV file.
STREET_IDS=$(tail -n +2 $CSV_FILENAME | cut -d',' -f1 | tr '\n' ',' | sed 's/,$//')


# Rename the sidewalk_init to the given name, create a user w/ that name,
# and give the user appropriate permissions.
psql -v ON_ERROR_STOP=1 -d sidewalk -U $SCHEMA_NAME <<-EOSQL
    BEGIN;

    -- Mark streets with no imagery as deleted.
    UPDATE street_edge
    SET deleted = TRUE
    WHERE street_edge_id IN ($STREET_IDS);

    -- Remove street_edge_priority for deleted streets.
    DELETE FROM street_edge_priority
    USING street_edge
    WHERE street_edge_priority.street_edge_id = street_edge.street_edge_id
        AND deleted = TRUE;

    -- Truncate the region_completion table to force recalculation of distances.
    TRUNCATE TABLE region_completion;

    COMMIT;
EOSQL
