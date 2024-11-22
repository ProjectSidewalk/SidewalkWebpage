#!/bin/bash
set -e  # Exit on any error

source /opt/scripts/helpers.sh

SCHEMA_NAME=$(prompt_with_default "Schema name")

# Prompt user for path to CSV file and prepend working dir.
CSV_FILENAME=$(prompt_with_default "Path to CSV file (relative to db dir)" "scripts/streets_with_no_imagery.csv")
CSV_FILENAME=/opt/$CSV_FILENAME

# Read list of streets to hide from CSV file.
STREET_IDS=$(tail -n +2 $CSV_FILENAME | cut -d',' -f1 | tr '\n' ',' | sed 's/,$//')


# Mark streets with no imagery as deleted, remove them from the street_edge_priority table,
# and truncate the region_completion table to force recalculation of distances.
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

echo "Done! You can now safely delete the street_edge_endpoints.csv and streets_with_no_imagery.csv files"
