#!/usr/bin/env bash
# =====================================================================================================================
# disable-streets-outside-area.sh — limit a city's open regions to a partner's study area.
#
# WHY THIS EXISTS: a partner may want to start with an area that cuts across neighborhoods (Velph's in Beringen,
# #5950). The regions stay whole so the city can grow; in the open regions, the streets outside the area become
# disabled, which no imagery rescan, region reveal or admin Reopen undoes. Each change is logged as 'study_area' with
# the street's status before it, so a rerun with a larger area puts back what the old one disabled: no_imagery stays
# no_imagery, and the rest open (closed, if their region has since been hidden). Hidden regions are left alone, so
# revealing one later opens it whole.
#
# A street counts as inside when at least half of it is in the area, or when 90% of it lies within 10 m of the area's
# edge (a street the partner drew the line along). The tutorial street is never touched. It runs after the imagery
# scan: a street disabled first would be skipped by the scan and put back later without a verdict.
#
# HOW IT'S RUN:  make onboard-city id=<city-id> args="--study-area <path>" runs it after the imagery scan; by hand,
#                make disable-streets-outside-area. Re-running is safe.
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

# psql reads the file itself: a city-sized outline is larger than one command-line argument may be.
psql -d sidewalk -U "$SCHEMA_NAME" -v ON_ERROR_STOP=1 -v area_file="$AREA_FILE" <<'EOSQL'
\set area `cat :'area_file'`
BEGIN;

-- A file-level "crs" names every geometry's system; otherwise ST_GeomFromGeoJSON reads a geometry's own, or lon/lat.
-- Features without a geometry are skipped, and an outline that crosses itself is repaired.
CREATE TEMP TABLE study_area ON COMMIT DROP AS
WITH doc AS (
    SELECT :'area'::jsonb AS geojson
), declared AS (
    SELECT substring(geojson -> 'crs' -> 'properties' ->> 'name' FROM 'EPSG::?([0-9]+)')::int AS srid
    FROM doc
), parts AS (
    SELECT COALESCE(value -> 'geometry', value) AS geometry
    FROM doc, jsonb_array_elements(CASE WHEN geojson ->> 'type' = 'FeatureCollection' THEN geojson -> 'features'
                                        ELSE jsonb_build_array(geojson) END)
), area AS (
    SELECT ST_Union(ST_CollectionExtract(ST_MakeValid(ST_Transform(
               CASE WHEN declared.srid IS NULL THEN ST_GeomFromGeoJSON(parts.geometry::text)
                    ELSE ST_SetSRID(ST_GeomFromGeoJSON(parts.geometry::text), declared.srid) END,
               4326)), 3)) AS geom
    FROM parts
    CROSS JOIN declared
    WHERE jsonb_typeof(parts.geometry) = 'object'
)
SELECT geom, ST_Buffer(ST_Boundary(geom)::geography, 10)::geometry AS edge
FROM area;

-- An area that misses every street is the wrong file, or one in a coordinate system it doesn't declare; going on would
-- disable the whole launch.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM street_edge, study_area WHERE ST_Intersects(street_edge.geom, study_area.geom)) THEN
        RAISE EXCEPTION 'No street lies in the study area. Is it the right file, in lon/lat or with a "crs" member?';
    END IF;
END $$;

CREATE TEMP TABLE street_fit ON COMMIT DROP AS
SELECT street_edge.street_edge_id,
       street_edge.status,
       region.deleted AS region_hidden,
       ST_Length(ST_Intersection(street_edge.geom, study_area.geom)::geography)
           >= 0.5 * ST_Length(street_edge.geom::geography)
       OR ST_Length(ST_Intersection(street_edge.geom, study_area.edge)::geography)
           >= 0.9 * ST_Length(street_edge.geom::geography) AS inside
FROM street_edge
JOIN street_edge_region ON street_edge_region.street_edge_id = street_edge.street_edge_id
JOIN region ON region.region_id = street_edge_region.region_id
CROSS JOIN study_area
WHERE street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config);

CREATE TEMP TABLE to_disable ON COMMIT DROP AS
SELECT street_edge_id, status AS old_status
FROM street_fit
WHERE NOT inside AND NOT region_hidden AND status IN ('open', 'no_imagery');

-- What an earlier, smaller area disabled and this one covers: the street's last change was this script's.
CREATE TEMP TABLE last_change ON COMMIT DROP AS
SELECT DISTINCT ON (street_edge_id) street_edge_id, old_status, source
FROM street_edge_status_change
ORDER BY street_edge_id, changed_at DESC, street_edge_status_change_id DESC;

CREATE TEMP TABLE to_restore ON COMMIT DROP AS
SELECT street_fit.street_edge_id,
       (CASE WHEN last_change.old_status = 'no_imagery' THEN 'no_imagery'
             WHEN street_fit.region_hidden THEN 'closed'
             ELSE 'open' END)::street_edge_status AS new_status
FROM street_fit
JOIN last_change ON last_change.street_edge_id = street_fit.street_edge_id
WHERE street_fit.inside AND street_fit.status = 'disabled' AND last_change.source = 'study_area';

\echo 'Streets outside the study area being disabled, and ones a larger area puts back, by region:'
SELECT street_edge_region.region_id,
       COUNT(to_disable.street_edge_id) AS disabled,
       ROUND((SUM(ST_Length(street_edge.geom::geography)) FILTER (WHERE to_disable.street_edge_id IS NOT NULL))::numeric
             / 1000, 2) AS disabled_km,
       COUNT(to_restore.street_edge_id) AS restored
FROM street_edge_region
JOIN street_edge ON street_edge.street_edge_id = street_edge_region.street_edge_id
LEFT JOIN to_disable ON to_disable.street_edge_id = street_edge.street_edge_id
LEFT JOIN to_restore ON to_restore.street_edge_id = street_edge.street_edge_id
WHERE to_disable.street_edge_id IS NOT NULL OR to_restore.street_edge_id IS NOT NULL
GROUP BY street_edge_region.region_id
ORDER BY street_edge_region.region_id;

UPDATE street_edge
SET status = 'disabled'
WHERE street_edge_id IN (SELECT street_edge_id FROM to_disable);

INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
SELECT street_edge_id, old_status, 'disabled'::street_edge_status, 'study_area'::street_edge_status_change_source
FROM to_disable;

UPDATE street_edge
SET status = to_restore.new_status
FROM to_restore
WHERE street_edge.street_edge_id = to_restore.street_edge_id;

INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
SELECT street_edge_id, 'disabled'::street_edge_status, new_status, 'study_area'::street_edge_status_change_source
FROM to_restore;

-- Task assignment joins on the priority row, so a street that opens needs one and a disabled one must not keep one.
INSERT INTO street_edge_priority (street_edge_id, priority)
SELECT street_edge_id, 1.0
FROM to_restore
WHERE new_status = 'open'
    AND NOT EXISTS (
        SELECT 1 FROM street_edge_priority WHERE street_edge_priority.street_edge_id = to_restore.street_edge_id
    );
DELETE FROM street_edge_priority WHERE street_edge_id IN (SELECT street_edge_id FROM to_disable);
DELETE FROM street_reopen_candidate WHERE street_edge_id IN (SELECT street_edge_id FROM to_disable);

-- Truncate the region_completion table to force recalculation of distances.
TRUNCATE TABLE region_completion;
COMMIT;

\echo 'Open regions left with no open street (hide them with make reveal-or-hide-regions):'
SELECT region.region_id, region.name
FROM region
WHERE NOT region.deleted
    AND NOT EXISTS (
        SELECT 1
        FROM street_edge_region
        JOIN street_edge ON street_edge.street_edge_id = street_edge_region.street_edge_id
        WHERE street_edge_region.region_id = region.region_id AND street_edge.status = 'open'
    )
ORDER BY region.region_id;

\echo 'Streets by status now:'
SELECT status, COUNT(*), ROUND(SUM(ST_Length(geom::geography))::numeric / 1000, 2) AS km
FROM street_edge
GROUP BY status
ORDER BY status;
EOSQL
