#!/bin/bash
set -e  # Exit on any error

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/helpers.sh"

# The general flow of this script is as follows:
#
# Ask if we're running locally or on the server. Sets params accordingly.
# Ask if revealing or hiding regions.
# If revealing:
#     Ask which regions to reveal.
#     Ask for CSV file that lists streets that are missing imagery.
#     Reveal the regions.
# If hiding:
#     Ask which regions to hide.
#     Check if tutorial street is in one of the regions being hidden.
#     If yes:
#         Ask user which region to move the tutorial street to and check that it's valid.
#         Move the tutorial street to that region.
#     Output CSV listing streets that were marked as deleted in regions we're hiding for easy future reversal.
#     Hide the regions.

SCHEMA_NAME=$(prompt_with_default "Schema name" "")

# Ask if we're running locally or on the server.
while true; do
    LOCAL_OR_SERVER=$(prompt_with_default "Running locally or on the server? (local/server)" "local")
    if [[ ! "$LOCAL_OR_SERVER" =~ ^(local|server)$ ]]; then
        echo "Invalid response. Must be 'local' or 'server'"
    else
        break
    fi
done

# Set some params appropriately based on whether we're running locally or on the server.
if [ "$LOCAL_OR_SERVER" = "local" ]; then
    PSQL_USER=$SCHEMA_NAME
    WORKING_DIR="/opt"
    WORKING_DIR_TO_PRINT="db"
    DB_NAME=sidewalk
    PORT=5432
else
    PSQL_USER="saugstad"
    WORKING_DIR="/homes/gws/saugstad"
    WORKING_DIR_TO_PRINT=$WORKING_DIR
    while true; do
        TEST_OR_PROD=$(prompt_with_default "Test or prod? (t/p)" "t")
        if [[ ! "$TEST_OR_PROD" =~ ^(t|p)$ ]]; then
            echo "Invalid response. Must be 't' or 'p'"
        else
            break
        fi
    done
    if [ "$TEST_OR_PROD" = "t" ]; then
        DB_NAME=sidewalk_test
        PORT=6432
    else
        DB_NAME=sidewalk_prod
        PORT=5434
    fi
fi

# Ask if we are revealing neighborhoods or hiding them.
while true; do
    REVEAL_OR_HIDE=$(prompt_with_default "Revealing or hiding regions? (reveal/hide)" "reveal")
    if [[ ! "$REVEAL_OR_HIDE" =~ ^(reveal|hide)$ ]]; then
        echo "Invalid response. Must be 'reveal' or 'hide'"
    else
        break
    fi
done

if [ "$REVEAL_OR_HIDE" = "reveal" ]; then
    # Ask which regions to reveal.
    regions_to_reveal=$(prompt_with_default "Region IDs to reveal (space-separated)" "")

    # Prompt user for path to CSV file and prepend working dir.
    csv_filename=$(prompt_with_default "Path to CSV file (relative to $WORKING_DIR_TO_PRINT dir)" "streets_with_no_imagery.csv")
    csv_filename=$WORKING_DIR/$csv_filename
    echo "Using CSV file: $csv_filename"

    # Read list of streets to hide from CSV file.
    # TODO deal with the situation where list of streets to hide is empty. Both bc no file and empty list.
    street_ids=$(tail -n +2 "$csv_filename" | cut -d',' -f1 | tr '\n' ',' | sed 's/,$//')
    echo "Streets to exclude: $street_ids"

    # Reveal the streets/regions.
    psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,public" -v ON_ERROR_STOP=1 -U "$PSQL_USER" -p $PORT <<EOSQL
        BEGIN;
        -- Mark streets as deleted=FALSE unless they are missing imagery.
        UPDATE street_edge
        SET deleted = FALSE
        FROM street_edge_region
        WHERE street_edge.street_edge_id = street_edge_region.street_edge_id
            AND street_edge.deleted = TRUE
            AND region_id IN (${regions_to_reveal// /,})
            AND street_edge.street_edge_id NOT IN ($street_ids);

        -- Add entries for the newly added streets to the street_edge_priority table.
        INSERT INTO street_edge_priority (street_edge_id, priority)
            SELECT street_edge.street_edge_id, 1
            FROM street_edge
            LEFT JOIN street_edge_priority ON street_edge.street_edge_id = street_edge_priority.street_edge_id
            WHERE deleted = FALSE
                AND priority IS NULL;

        -- Reveal the neighborhoods.
        UPDATE region SET deleted = FALSE WHERE region_id IN (${regions_to_reveal// /,});

        -- Truncate the region_completion table to force recalculation of distances.
        TRUNCATE TABLE region_completion;
        COMMIT;
EOSQL

# If hiding neighborhoods.
else    
    # Ask which regions to hide.
    regions_to_hide=$(prompt_with_default "Region IDs to hide (space-separated)" "")

    # Check if tutorial street is in one of the regions being hidden.
    hiding_tutorial_street=$(psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,public" -v ON_ERROR_STOP=1 -U $PSQL_USER -p $PORT -t -A <<EOSQL
        SELECT COUNT(*) > 0
        FROM street_edge_region
        INNER JOIN config ON street_edge_region.street_edge_id = config.tutorial_street_edge_id
        WHERE region_id IN (${regions_to_hide// /,});
EOSQL
    )

    # If trying to hide tutorial's region, ask which region to transfer tutorial to.
    if [ "$hiding_tutorial_street" = "t" ]; then
        # Get list of region IDs where you could safely move the tutorial street and show to user.
        mapfile -t safe_region_ids < <(psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,public" -v ON_ERROR_STOP=1 -U $PSQL_USER -p $PORT -t -A <<-EOSQL
            SELECT region.region_id
            FROM region
            INNER JOIN region_completion ON region.region_id = region_completion.region_id
            WHERE deleted = FALSE
                AND region.region_id NOT IN (${regions_to_hide// /,})
            ORDER BY total_distance DESC;
EOSQL
        )
        echo "The tutorial street is in one of the neighborhoods you're hiding, so we'll need to move it to a new region."
        echo "Below are the valid regions that you could move the street to, in order of descending total distance (if none listed, may need to initialize region_completion table):"
        echo "${safe_region_ids[@]}"

        # Ask which neighborhood to transfer to.
        while true; do
            new_tutorial_region=$(prompt_with_default "Which region should the tutorial street be moved to?" "${safe_region_ids[0]}")
            if [[ ! " ${safe_region_ids[@]} " =~ " $new_tutorial_region " ]]; then
                echo "Please choose one of the safe region IDs listed above."
            else
                break
            fi
        done

        # Update tutorial's region.
        psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,public" -v ON_ERROR_STOP=1 -U $PSQL_USER -p $PORT <<EOSQL
            UPDATE street_edge_region
            SET region_id = $new_tutorial_region
            WHERE street_edge_id = (SELECT tutorial_street_edge_id FROM config);
EOSQL
        echo "Tutorial street successfully updated to $new_tutorial_region!"
    fi

    # Output CSV listing streets that were marked as deleted in regions we're hiding for easy future reversal.
    curr_date=$(date +"%b-%d-%Y" | tr '[:upper:]' '[:lower:]')
    output_file="formerly-hidden-streets-$SCHEMA_NAME-$TEST_OR_PROD-$curr_date.csv"
    psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME" -v ON_ERROR_STOP=1 -U $PSQL_USER -p $PORT -A -F "," --csv <<EOSQL > "$output_file"
        SELECT street_edge.street_edge_id, region_id
        FROM street_edge
        INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
        WHERE region_id IN (${regions_to_hide// /,})
            AND deleted = TRUE;
EOSQL
    echo "Wrote list of previously deleted streets in hidden neighborhoods to $output_file"

    # Finally, hide the streets/regions and truncate the region_completion table.
    psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,public" -v ON_ERROR_STOP=1 -U $PSQL_USER -p $PORT <<EOSQL
        BEGIN;
        UPDATE region
        SET deleted = TRUE
        WHERE region_id IN (${regions_to_hide// /,});

        UPDATE street_edge
        SET deleted = TRUE
        FROM street_edge_region
        WHERE street_edge.street_edge_id = street_edge_region.street_edge_id
            AND street_edge_region.region_id IN (${regions_to_hide// /,});

        DELETE FROM street_edge_priority
        USING street_edge
        WHERE street_edge_priority.street_edge_id = street_edge.street_edge_id
            AND street_edge.deleted = TRUE;

        TRUNCATE TABLE region_completion;
        COMMIT;
EOSQL
fi

echo "Done! Please clear the Play cache for $SCHEMA_NAME to reset remaining distance on landing page"

if [ "$REVEAL_OR_HIDE" = "reveal" ]; then
    echo "You can now safely delete the street_edge_endpoints.csv and streets_with_no_imagery.csv files"
fi
