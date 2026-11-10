#!/usr/bin/env bash
# =====================================================================================================================
# disable-streets-outside-area.sh — disable the open streets that lie outside a partner's study area.
#
# WHY THIS EXISTS: a partner may want to start with an area that cuts across neighborhoods (Velph's in Beringen,
# #5950). The regions stay whole so the city can grow later; the open streets outside the area become disabled, which
# no imagery rescan or region reveal undoes. Only open streets change, so it runs after the imagery scan: every
# disabled street then has imagery, and opening more of the city later is just disabled -> open.
#
# A street stays open when at least half of it is inside the area, or when 90% of it lies within 10 m of the area's
# edge (a street the partner drew the line along). The tutorial street is never touched. Re-running is safe.
#
# HOW IT'S RUN:  make onboard-city id=<city-id> args="--study-area <path>" runs it after the imagery scan; by hand,
#                make disable-streets-outside-area.
# INPUT:         a GeoJSON of the area under db/ (a FeatureCollection, a Feature, or a bare geometry). A "crs" member
#                naming an EPSG code is honored (a Belgian shapefile export is in EPSG:3812); without one it's lon/lat.
# =====================================================================================================================
set -euo pipefail

# shellcheck source=helpers.sh
source /opt/scripts/helpers.sh

# Optional positional args ($1 schema, $2 GeoJSON path relative to the db dir) so tools/city/setup_new_city.py can drive
# the script without faking its prompts; anything omitted is prompted for.
SCHEMA_NAME=${1:-$(prompt_with_default "Schema name")}
AREA_FILE=${2:-$(prompt_with_default \
    "Path to the study area GeoJSON (relative to db dir, e.g. onboarding/beringen-be/study_area.geojson)")}
AREA_FILE=/opt/$AREA_FILE
if [[ ! -f "$AREA_FILE" ]]; then
  echo "Error: no study area at $AREA_FILE." >&2
  exit 1
fi

psql -d sidewalk -U "$SCHEMA_NAME" -v ON_ERROR_STOP=1 -v area="$(cat "$AREA_FILE")" <<'EOSQL'
BEGIN;

CREATE TEMP TABLE study_area ON COMMIT DROP AS
WITH doc AS (
    SELECT :'area'::jsonb AS geojson
), parts AS (
    SELECT COALESCE(part -> 'geometry', part) AS geometry
    FROM doc, jsonb_array_elements(CASE WHEN geojson ->> 'type' = 'FeatureCollection' THEN geojson -> 'features'
                                        ELSE jsonb_build_array(geojson) END) AS part
)
SELECT ST_Transform(
           ST_SetSRID(ST_Union(ST_GeomFromGeoJSON(parts.geometry::text)),
                      COALESCE(substring((SELECT geojson -> 'crs' -> 'properties' ->> 'name' FROM doc)
                                         FROM 'EPSG::?([0-9]+)')::int, 4326)),
           4326) AS geom
FROM parts;

-- An area that misses every open street is the wrong file, or one in a coordinate system it doesn't declare; going on
-- would disable the whole launch.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM street_edge, study_area
                   WHERE street_edge.status = 'open' AND ST_Intersects(street_edge.geom, study_area.geom)) THEN
        RAISE EXCEPTION 'No open street lies in the study area. Is it the right file, in lon/lat or with a "crs" member?';
    END IF;
END $$;

CREATE TEMP TABLE outside ON COMMIT DROP AS
SELECT street_edge.street_edge_id
FROM street_edge
CROSS JOIN study_area
WHERE street_edge.status = 'open'
    AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    AND ST_Length(ST_Intersection(street_edge.geom, study_area.geom)::geography)
        < 0.5 * ST_Length(street_edge.geom::geography)
    AND ST_Length(ST_Intersection(street_edge.geom,
                                  ST_Buffer(ST_Boundary(study_area.geom)::geography, 10)::geometry)::geography)
        < 0.9 * ST_Length(street_edge.geom::geography);

\echo 'Open streets outside the study area, by region:'
SELECT street_edge_region.region_id,
       COUNT(*) AS disabled,
       ROUND(SUM(ST_Length(street_edge.geom::geography))::numeric / 1000, 2) AS disabled_km
FROM outside
JOIN street_edge ON street_edge.street_edge_id = outside.street_edge_id
JOIN street_edge_region ON street_edge_region.street_edge_id = outside.street_edge_id
GROUP BY street_edge_region.region_id
ORDER BY street_edge_region.region_id;

UPDATE street_edge
SET status = 'disabled'
WHERE street_edge_id IN (SELECT street_edge_id FROM outside);

INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
SELECT street_edge_id, 'open'::street_edge_status, 'disabled'::street_edge_status,
       'remove_streets'::street_edge_status_change_source
FROM outside;

-- A disabled street is never handed out, so it needs no priority row or reopen check.
DELETE FROM street_edge_priority WHERE street_edge_id IN (SELECT street_edge_id FROM outside);
DELETE FROM street_reopen_candidate WHERE street_edge_id IN (SELECT street_edge_id FROM outside);

-- Truncate the region_completion table to force recalculation of distances.
TRUNCATE TABLE region_completion;
COMMIT;

\echo 'Streets by status now:'
SELECT status, COUNT(*), ROUND(SUM(ST_Length(geom::geography))::numeric / 1000, 2) AS km
FROM street_edge
GROUP BY status
ORDER BY status;
EOSQL
