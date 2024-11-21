#!/bin/bash
set -e  # Exit on any error

source /opt/scripts/helpers.sh

# Prompt for parameters.
SCHEMA_NAME=$(prompt_with_default "Schema name" "")
WAY_TYPE=$(prompt_with_default "OSM way_type column name" "highway")
REGION_DATA_SOURCE=$(prompt_with_default "Region data source (string)" "")
REGION_NAME_COL=$(prompt_with_default "Region name column (all lowercase)" "name")
TUTORIAL_REGION_ID=$(prompt_with_default "Tutorial region id" "1")

# Ask whether all regions are being included.
while true; do
    INCLUDE_ALL_REGIONS=$(prompt_with_default "Including all regions? (y/n)" "y")
    if [[ ! "$INCLUDE_ALL_REGIONS" =~ ^(y|n)$ ]]; then
        echo "Invalid response. Must be 'y' or 'n'"
    else
        break
    fi
done

# If excluding some, ask if we are listing included or listing excluded region ids.
if [ "$INCLUDE_ALL_REGIONS" = "n" ]; then
    while true; do
        MODE=$(prompt_with_default "Is it easier to list regions to include or exclude? (include/exclude)" "include")
        if [[ ! "$MODE" =~ ^(include|exclude)$ ]]; then
            echo "Invalid response. Must be 'include' or 'exclude'"
        else
            break
        fi
    done

    # Prompt for REGIONS_HIDDEN/SHOWN list, space-separated.
    if [ "$MODE" = "include" ]; then
        REGIONS_SHOWN=$(prompt_with_default "Enter IDs to include (space-separated)" "")
        # Check if tutorial region is in the include list
        if [[ ! " $REGIONS_SHOWN " =~ " $TUTORIAL_REGION_ID " ]]; then
            echo "Error: Tutorial region $TUTORIAL_REGION_ID must be in the include list"
            exit 1
        fi
    else
        REGIONS_HIDDEN=$(prompt_with_default "Enter IDs to exclude (space-separated)" "")
        # Check if tutorial region is in the exclude list
        if [[ " $REGIONS_HIDDEN " =~ " $TUTORIAL_REGION_ID " ]]; then
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
    echo "regions to include: ${REGIONS_SHOWN[@]}"
else
    echo "regions to exclude: ${REGIONS_HIDDEN[@]}"
fi

# Check for confirmation before making changes to the db.
while true; do
    PROCEED=$(prompt_with_default "Proceed? (y/n)" "y")
    if [[ ! "$PROCEED" =~ ^(y|n)$ ]]; then
        echo "Invalid response. Must be 'y' or 'n'"
    elif [ "$PROCEED" = "n" ]; then
        exit 1
    else
        break
    fi
done

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
# TODO coerce some data types in case they are strings instead of ints, for example.
#      I'll add these as the situation arises organically in future deployments.
psql -v ON_ERROR_STOP=1 -d sidewalk -U $SCHEMA_NAME <<-EOSQL
    BEGIN;
    -- Fill in the street_edge table using the qgis_road table.
    INSERT INTO street_edge (street_edge_id, geom, way_type, deleted, timestamp, x1, y1, x2, y2)
        SELECT road_id, geom, $WAY_TYPE, $REGION_DELETED_Q, now(),
               ST_X(ST_StartPoint(geom)), ST_Y(ST_StartPoint(geom)), ST_X(ST_EndPoint(geom)), ST_Y(ST_EndPoint(geom))
        FROM qgis_road;

    -- Fill in the osm_way_street_edge table to link streets to their original OSM ways.
    INSERT INTO osm_way_street_edge (osm_way_id, street_edge_id)
        SELECT CAST(osm_id AS INT), road_id FROM qgis_road;

    -- Add the tutorial street edge from DC into the database and update tutorial id in the config table.
    INSERT INTO street_edge(street_edge_id, geom, x1, y1, x2, y2, way_type, deleted, timestamp)
        SELECT MAX(street_edge_id) + 1, '0102000020E6100000040000007C9E3F6D544453C00A2E56D460784340ECF7C43A554453C02B685A6265784340F29A5775564453C0C4D2C08F6A784340F73DEAAF574453C0B0CBF09F6E784340', -77.067653, 38.940455, -77.067852, 38.940876, 'tertiary', FALSE, '2015-11-17 04:20:19.46+00'
        FROM street_edge;
    UPDATE config SET tutorial_street_edge_id = (SELECT MAX(street_edge_id) FROM street_edge);

    -- Fill in the region table using the qgis_region table.
    INSERT INTO region (region_id, data_source, name, geom, deleted)
        SELECT region_id, '$REGION_DATA_SOURCE', $REGION_NAME_COL, geom, $REGION_DELETED_Q
        FROM qgis_region;

    -- Fill in the street_edge_region table. First streets for the city, then the tutorial street.
    INSERT INTO street_edge_region (street_edge_id, region_id)
        SELECT road_id, region_id
        FROM qgis_road;
    INSERT INTO street_edge_region (street_edge_id, region_id)
        SELECT MAX(street_edge_id), $TUTORIAL_REGION_ID
        FROM street_edge;

    -- Initialize the street_edge_priority table.
    INSERT INTO street_edge_priority (street_edge_id, priority)
        SELECT street_edge_id, 1
        FROM street_edge
        WHERE deleted = FALSE;

    -- Update config table's open_status column based on whether regions were removed.
    UPDATE config SET open_status = '$OPEN_STATUS_Q';

    -- Set the city_center lat/lng in the config table using the open regions' geoms.
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
