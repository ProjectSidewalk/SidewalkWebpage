#!/usr/bin/env bash
# =====================================================================================================================
# fill-new-schema.sh — populate a fresh city schema's streets and regions from QGIS-imported staging tables.
#
# WHY THIS EXISTS: after create-new-schema.sh gives you an empty city schema, the geographic data (streets + regions)
# is loaded into two staging tables — qgis_road and qgis_region — from a QGIS/OSM export. This script turns that
# staging data into the app's real tables (street_edge, region, street_edge_region, street_edge_priority, ...),
# relocates the template's seeded DC tutorial street to sit after the imported streets, sets the city center/bounds in
# `config`, and drops the staging tables when done.
# It's interactive: it asks for the column/value details that vary per import, prints a summary, and confirms before
# touching the DB. Everything runs in one transaction, so a failure rolls the whole thing back.
#
# HOW IT'S RUN:  make fill-new-schema   →   /opt/scripts/fill-new-schema.sh   (inside projectsidewalk-db).
# PRECONDITION:  the target schema exists (create-new-schema.sh) and qgis_road + qgis_region are loaded into it.
#
# GOTCHA: prompt answers are interpolated into SQL. Region-id lists must be space-separated integers; the schema must
# be a real city schema with the QGIS staging tables present.
# =====================================================================================================================
set -euo pipefail

source /opt/scripts/helpers.sh

# Prompt for parameters.
SCHEMA_NAME=$(prompt_with_default "Schema name")
WAY_TYPE=$(prompt_with_default "OSM way_type column name" "highway")
REGION_DATA_SOURCE=$(prompt_with_default "Region data source (string)")
REGION_NAME_COL=$(prompt_with_default "Region name column (all lowercase)" "name")
TUTORIAL_REGION_ID=$(prompt_with_default "Tutorial region id" "1")

# Ask whether all regions are being included.
INCLUDE_ALL_REGIONS=$(prompt_with_default "Including all regions?" "y" "y|n")

# Declared up-front (empty) so references stay valid under `set -u` even when "include all regions" skips the branch
# that fills them.
MODE=""
REGIONS_SHOWN=""
REGIONS_HIDDEN=""

# If excluding some, ask if we are listing included or listing excluded region ids.
if [ "$INCLUDE_ALL_REGIONS" = "n" ]; then
    MODE=$(prompt_with_default "Is it easier to list regions to include or exclude?" "include" "include|exclude")

    # Prompt for REGIONS_HIDDEN/SHOWN list, space-separated.
    if [ "$MODE" = "include" ]; then
        REGIONS_SHOWN=$(prompt_with_default "Enter IDs to include (space-separated)" "")
        # Check if tutorial region is in the include list (space-padded literal containment, not a regex).
        if [[ " $REGIONS_SHOWN " != *" $TUTORIAL_REGION_ID "* ]]; then
            echo "Error: Tutorial region $TUTORIAL_REGION_ID must be in the include list"
            exit 1
        fi
    else
        REGIONS_HIDDEN=$(prompt_with_default "Enter IDs to exclude (space-separated)" "")
        # Check if tutorial region is in the exclude list (space-padded literal containment, not a regex).
        if [[ " $REGIONS_HIDDEN " == *" $TUTORIAL_REGION_ID "* ]]; then
            echo "Error: Tutorial region $TUTORIAL_REGION_ID cannot be in the exclude list"
            exit 1
        fi
    fi
fi

# Print configs to the user.
echo -e "\nConfiguration Summary:"
echo "schema name: $SCHEMA_NAME"
echo "way_type column: $WAY_TYPE"
echo "region data source: $REGION_DATA_SOURCE"
echo "region name column: $REGION_NAME_COL"
echo "tutorial region id: $TUTORIAL_REGION_ID"
if [ "$INCLUDE_ALL_REGIONS" = "y" ]; then
    echo "regions to include: all"
elif [ "$MODE" = "include" ]; then
    echo "regions to include: $REGIONS_SHOWN"
else
    echo "regions to exclude: $REGIONS_HIDDEN"
fi

# Check for confirmation before making changes to the db.
PROCEED=$(prompt_with_default "Proceed?" "y" "y|n")
if [ "$PROCEED" = "n" ]; then
    exit 1
fi

# Create some pieces of the queries that change based on user input.
if [ "$INCLUDE_ALL_REGIONS" = "y" ]; then
    REGION_DELETED_Q="FALSE"
    OPEN_STATUS_Q="fully"
elif [ "$MODE" = "include" ]; then
    REGION_DELETED_Q="region_id NOT IN (${REGIONS_SHOWN// /,})"
    OPEN_STATUS_Q="partially"
else
    REGION_DELETED_Q="region_id IN (${REGIONS_HIDDEN// /,})"
    OPEN_STATUS_Q="partially"
fi

# Run the queries.
# NOTE: this assumes qgis_road/qgis_region columns already have the expected types (e.g. integer ids). If a future
# import arrives with string-typed columns, add explicit CAST()s here rather than relying on implicit coercion.
psql -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" <<-EOSQL
    BEGIN;
    -- The sidewalk_init template seeds the shared DC tutorial street at street_edge_id = 1 (so config's
    -- tutorial_street_edge_id FK is satisfiable in the otherwise-empty template). Imported qgis road_ids also start at
    -- 1, so relocate the tutorial to sit just past the imported streets before importing them -- this keeps every real
    -- street's street_edge_id equal to its qgis road_id. config's FK is RESTRICT, so the id can't be UPDATEd in place:
    -- copy the tutorial row to MAX(road_id) + 1, repoint config at the copy, then delete the original.
    INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status, timestamp)
        SELECT (SELECT MAX(road_id) FROM qgis_road) + 1, geom, x1, y1, x2, y2, way_type, status, timestamp
        FROM street_edge;
    UPDATE config SET tutorial_street_edge_id = (SELECT MAX(street_edge_id) FROM street_edge);
    DELETE FROM street_edge WHERE street_edge_id <> (SELECT tutorial_street_edge_id FROM config);

    -- Fill in the street_edge table using the qgis_road table. A street in a hidden region is seeded 'closed' (the
    -- whole neighborhood isn't open yet); everything else starts 'open' (#3888). $REGION_DELETED_Q is a boolean
    -- expression that is TRUE for streets whose region is hidden.
    INSERT INTO street_edge (street_edge_id, geom, way_type, status, timestamp, x1, y1, x2, y2)
        SELECT road_id, geom, ($WAY_TYPE)::way_type,
               (CASE WHEN $REGION_DELETED_Q THEN 'closed' ELSE 'open' END)::street_edge_status, now(),
               ST_X(ST_StartPoint(geom)), ST_Y(ST_StartPoint(geom)), ST_X(ST_EndPoint(geom)), ST_Y(ST_EndPoint(geom))
        FROM qgis_road;

    -- Fill in the osm_way_street_edge table to link streets to their original OSM ways.
    INSERT INTO osm_way_street_edge (osm_way_id, street_edge_id)
        SELECT CAST(osm_id AS INT), road_id FROM qgis_road;

    -- Fill in the region table using the qgis_region table. Names imported from QGIS/OSM are sometimes ALL CAPS
    -- (issue #4596), so title-case any name that is entirely uppercase and does not look like an acronym. Guards keep
    -- abbreviations intact: single tokens of 4 chars or fewer ("VCU"/"NASA"), names containing an "&" ("PSE&G"), and
    -- dotted initialisms ("P.I.C.O.") are left as-is; multi-word names and longer single words ("SUNNYSIDE") are
    -- title-cased. COLLATE "default" makes initcap use the DB's UTF-8 collation so accented names title-case correctly;
    -- a name that already carries a lowercase letter is left as provided. Evolution 341 back-fills Houston, the one
    -- existing site imported before this was added.
    INSERT INTO region (region_id, data_source, name, geom, deleted)
        SELECT region_id, '$REGION_DATA_SOURCE',
               CASE WHEN $REGION_NAME_COL = upper($REGION_NAME_COL)
                         AND $REGION_NAME_COL ~ '[[:alpha:]]'
                         AND $REGION_NAME_COL NOT LIKE '%&%'
                         AND (char_length($REGION_NAME_COL) - char_length(replace($REGION_NAME_COL, '.', ''))) < 2
                         AND ($REGION_NAME_COL LIKE '% %' OR char_length($REGION_NAME_COL) >= 5)
                    THEN initcap($REGION_NAME_COL COLLATE "default")
                    ELSE $REGION_NAME_COL
               END,
               geom, $REGION_DELETED_Q
        FROM qgis_region;

    -- Fill in the street_edge_region table. First streets for the city, then the tutorial street.
    INSERT INTO street_edge_region (street_edge_id, region_id)
        SELECT road_id, region_id
        FROM qgis_road;
    INSERT INTO street_edge_region (street_edge_id, region_id)
        SELECT tutorial_street_edge_id, $TUTORIAL_REGION_ID
        FROM config;

    -- Initialize the street_edge_priority table for auditable streets only (#3888).
    INSERT INTO street_edge_priority (street_edge_id, priority)
        SELECT street_edge_id, 1
        FROM street_edge
        WHERE status = 'open';

    -- Update config table's open_status column based on whether regions were removed.
    UPDATE config SET open_status = '$OPEN_STATUS_Q';

    -- Set the city_center lat/lng in the config table using the open regions' geoms. The ±1° boundary box is a rough
    -- placeholder (~111 km) meant to comfortably contain the city; tighten it per-city later if needed.
    UPDATE config
    SET city_center_lat = city_lat,
        city_center_lng = city_lng,
        southwest_boundary_lat = city_lat - 1,
        southwest_boundary_lng = city_lng - 1,
        northeast_boundary_lat = city_lat + 1,
        northeast_boundary_lng= city_lng + 1
    FROM (
        SELECT (ST_YMin(ST_Extent(geom)) + ST_YMax(ST_Extent(geom))) / 2 AS city_lat,
               (ST_XMin(ST_Extent(geom)) + ST_XMax(ST_Extent(geom))) / 2 AS city_lng
        FROM region
        WHERE deleted = FALSE
    );

    -- Remove the qgis_region and qgis_road tables.
    DROP TABLE qgis_region;
    DROP TABLE qgis_road;

    COMMIT;
EOSQL
