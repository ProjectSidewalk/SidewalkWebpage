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
#     Reveal the regions: set region.deleted = FALSE and flip the regions' 'closed' streets back to 'open'.
#     Optionally take a no-imagery CSV and mark those streets 'no_imagery' (a first-reveal convenience that mirrors
#     hide-streets-without-imagery.sh; see below).
# If hiding:
#     Ask which regions to hide.
#     Check if tutorial street is in one of the regions being hidden.
#     If yes:
#         Ask user which region to move the tutorial street to and check that it's valid.
#         Move the tutorial street to that region.
#     Hide the regions: set region.deleted = TRUE and flip the regions' 'open' streets to 'closed'.
#
# Street availability lives on street_edge.status (open/no_imagery/closed/disabled). This script only ever flips
# streets between 'open' and 'closed' to mirror the region's opened/closed state, so 'no_imagery' and 'disabled'
# streets are never disturbed and the old streets_with_no_imagery / formerly-hidden-streets CSV bookkeeping (which
# existed solely to remember no-imagery streets across region toggles) is no longer needed.

SCHEMA_NAME=$(prompt_with_default "Schema name")

# Ask if we're running locally or on the server.
LOCAL_OR_SERVER=$(prompt_with_default "Running locally or on the server?" "local" "local|server")

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
    TEST_OR_PROD=$(prompt_with_default "Test or prod?" "test" "test|prod")
    if [ "$TEST_OR_PROD" = "test" ]; then
        DB_NAME=sidewalk_test
        PORT=6432
    else
        DB_NAME=sidewalk_prod
        PORT=5434
    fi
fi

# Ask if we are revealing neighborhoods or hiding them.
REVEAL_OR_HIDE=$(prompt_with_default "Revealing or hiding regions?" "reveal" "reveal|hide")

if [ "$REVEAL_OR_HIDE" = "reveal" ]; then
    # Ask which regions to reveal.
    regions_to_reveal=$(prompt_with_default "Region IDs to reveal (space-separated)")

    # Reveal the neighborhoods. We only flip the regions' 'closed' streets back to 'open'; 'no_imagery' and 'disabled'
    # streets keep their status, so the old cross-toggle CSV bookkeeping (which existed to remember no-imagery streets)
    # is no longer needed. A one-time no-imagery CSV can still be applied for a first reveal -- see below.
    psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,sidewalk_login,public" -v ON_ERROR_STOP=1 -U "$PSQL_USER" -p $PORT <<EOSQL
        BEGIN;
        -- Re-open the streets that were closed along with the region (leaves no_imagery/disabled streets alone).
        UPDATE street_edge
        SET status = 'open'
        FROM street_edge_region
        WHERE street_edge.street_edge_id = street_edge_region.street_edge_id
            AND street_edge_region.region_id IN (${regions_to_reveal// /,})
            AND street_edge.status = 'closed';

        -- Add street_edge_priority entries for the newly re-opened streets that don't have one yet.
        INSERT INTO street_edge_priority (street_edge_id, priority)
            SELECT street_edge.street_edge_id, 1
            FROM street_edge
            LEFT JOIN street_edge_priority ON street_edge.street_edge_id = street_edge_priority.street_edge_id
            WHERE street_edge.status = 'open'
                AND priority IS NULL;

        -- Reveal the neighborhoods.
        UPDATE region SET deleted = FALSE WHERE region_id IN (${regions_to_reveal// /,});

        -- Truncate the region_completion table to force recalculation of distances.
        TRUNCATE TABLE region_completion;
        COMMIT;
EOSQL

    # Optionally mark this region's streets without imagery in the same pass. In the new status model 'no_imagery' is
    # persistent across hide/reveal cycles, so it only needs doing the first time a region is revealed (re-reveals
    # leave existing 'no_imagery' streets untouched) -- enter 'none' to skip. Folded in here (via the shared helper) so
    # hide-streets-without-imagery.sh doesn't have to be a separate back-to-back step when revealing (#4335 review).
    no_imagery_csv=$(prompt_with_default "No-imagery CSV to also mark (relative to $WORKING_DIR_TO_PRINT dir, 'none' to skip)" "none")
    if [ "$no_imagery_csv" != "none" ]; then
        no_imagery_ids=$(read_street_ids_from_csv "$WORKING_DIR/$no_imagery_csv")
        echo "Marking streets without imagery: $no_imagery_ids"
        mark_streets_no_imagery "$no_imagery_ids" "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,sidewalk_login,public" -U "$PSQL_USER" -p $PORT
    fi

# If hiding neighborhoods.
else
    # Ask which regions to hide.
    regions_to_hide=$(prompt_with_default "Region IDs to hide (space-separated)")

    # Check if tutorial street is in one of the regions being hidden.
    hiding_tutorial_street=$(psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,sidewalk_login,public" -v ON_ERROR_STOP=1 -U $PSQL_USER -p $PORT -t -A <<EOSQL
        SELECT COUNT(*) > 0
        FROM street_edge_region
        INNER JOIN config ON street_edge_region.street_edge_id = config.tutorial_street_edge_id
        WHERE region_id IN (${regions_to_hide// /,});
EOSQL
    )

    # If trying to hide tutorial's region, ask which region to transfer tutorial to.
    if [ "$hiding_tutorial_street" = "t" ]; then
        # Get list of region IDs where you could safely move the tutorial street and show to user.
        mapfile -t safe_region_ids < <(psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,sidewalk_login,public" -v ON_ERROR_STOP=1 -U $PSQL_USER -p $PORT -t -A <<-EOSQL
            SELECT region.region_id
            FROM region
            INNER JOIN region_completion ON region.region_id = region_completion.region_id
            WHERE deleted = FALSE
                AND region.region_id NOT IN (${regions_to_hide// /,})
            ORDER BY total_distance DESC;
EOSQL
        )

        # Ask which neighborhood to transfer to. Converts region list to being pipe-separated.
        echo "The tutorial street is in one of the neighborhoods you're hiding, so we'll need to move it to a new region."
        echo "Valid regions for the street are in order of descending total distance (if none listed, may need to initialize region_completion table)."
        new_tutorial_region=$(prompt_with_default "Which region should the tutorial street be moved to?" "${safe_region_ids[0]}" "$(IFS="|"; echo "${safe_region_ids[*]}")")

        # Update tutorial's region.
        psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,sidewalk_login,public" -v ON_ERROR_STOP=1 -U $PSQL_USER -p $PORT <<EOSQL
            UPDATE street_edge_region
            SET region_id = $new_tutorial_region
            WHERE street_edge_id = (SELECT tutorial_street_edge_id FROM config);
EOSQL
        echo "Tutorial street successfully updated to $new_tutorial_region!"
    fi

    # Finally, hide the regions: flip their 'open' streets to 'closed', drop those streets' priority rows, remove any
    # user_current_regions, and truncate region_completion. We only touch 'open' streets, so 'no_imagery' and
    # 'disabled' streets keep their status.
    psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,sidewalk_login,public" -v ON_ERROR_STOP=1 -U $PSQL_USER -p $PORT <<EOSQL
        BEGIN;
        UPDATE region
        SET deleted = TRUE
        WHERE region_id IN (${regions_to_hide// /,});

        UPDATE street_edge
        SET status = 'closed'
        FROM street_edge_region
        WHERE street_edge.street_edge_id = street_edge_region.street_edge_id
            AND street_edge_region.region_id IN (${regions_to_hide// /,})
            AND street_edge.status = 'open';

        DELETE FROM user_current_region WHERE region_id IN (${regions_to_hide// /,});

        -- Closed streets should not be assignable for auditing, so remove their priority rows.
        DELETE FROM street_edge_priority
        USING street_edge_region
        WHERE street_edge_priority.street_edge_id = street_edge_region.street_edge_id
            AND street_edge_region.region_id IN (${regions_to_hide// /,});

        TRUNCATE TABLE region_completion;
        COMMIT;
EOSQL
fi

# Refresh planner statistics on the modified tables. Bulk-flipping the street status / region.deleted columns stays
# under autoanalyze's ~10% threshold, leaving the planner with stale row estimates that cause catastrophically slow
# query plans.
psql "dbname=$DB_NAME options=--search_path=$SCHEMA_NAME,sidewalk_login,public" -v ON_ERROR_STOP=1 -U $PSQL_USER -p $PORT <<EOSQL
    VACUUM ANALYZE street_edge;
    VACUUM ANALYZE street_edge_region;
    VACUUM ANALYZE street_edge_priority;
    VACUUM ANALYZE region;
EOSQL

echo "Done! Please clear the Play cache for $SCHEMA_NAME to reset remaining distance on landing page"
