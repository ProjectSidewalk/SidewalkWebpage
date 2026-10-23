#!/usr/bin/env bash
set -euo pipefail

# Step 3 of positioning a live city's streets on their OpenStreetMap ways (#5741): load the CSV
# tools/city/backfill_osm_lineage.py wrote (db/onboarding/<city-id>/osm_lineage.csv) into osm_way_street_edge. Each
# street in the file has its rows replaced whole, and only while the file's geom_md5 still matches the street's
# geometry: street_edge_id is a per-city serial, so a CSV pointed at the wrong schema would match thousands of ids, and
# the hash is what tells the streets apart. The same test skips a street edited since the export, which keeps its old
# rows. A few skipped streets are normal and reported; most of a sizeable file failing means the wrong city or a stale
# export, and the import aborts.

# shellcheck source=helpers.sh
source /opt/scripts/helpers.sh

# Optional positional args ($1 schema, $2 CSV path relative to the db dir), so a caller can skip the prompts.
SCHEMA_NAME=${1:-$(prompt_with_default "Schema name")}
CSV_FILENAME=${2:-$(prompt_with_default \
  "Path to CSV file (relative to db dir, e.g. onboarding/seattle-wa/osm_lineage.csv)")}
CSV_FILENAME=/opt/$CSV_FILENAME
if [[ ! -f "$CSV_FILENAME" ]]; then
  echo "Error: CSV not found at $CSV_FILENAME. Generate it with tools/city/backfill_osm_lineage.py first." >&2
  exit 1
fi

# COPY maps columns by position, so a CSV with other columns would fail on whichever column first disagrees, with an
# error that names the column and not the cause. The header is the matcher's OUTPUT_FIELDS.
EXPECTED_HEADER="street_edge_id,osm_way_id,street_from_frac,street_to_frac,way_from_frac,way_to_frac,same_direction,\
geom_md5"
# A byte-order mark (a CSV re-saved from a spreadsheet) is dropped here; COPY skips the header row, so it is harmless
# there. The error prints both headers, since an empty or wrong file fails this test too.
ACTUAL_HEADER=$(head -n 1 "$CSV_FILENAME" | tr -d '\r' | sed $'1s/^\xef\xbb\xbf//')
if [[ "$ACTUAL_HEADER" != "$EXPECTED_HEADER" ]]; then
  echo "Error: $CSV_FILENAME does not have the columns tools/city/backfill_osm_lineage.py writes." >&2
  echo "Expected: $EXPECTED_HEADER" >&2
  echo "Found:    $ACTUAL_HEADER" >&2
  exit 1
fi

# Staged as text so the matcher's empty fields survive as '' and become NULL here. The table's CHECK constraints then
# hold the rows to the invariants the matcher is meant to produce, and one bad row fails the whole transaction.
psql -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" <<EOSQL
    BEGIN;
    -- The re-rank trigger keeps the first plan its change check gets in this session (evolution 422 plans it per
    -- statement; a stage not yet on it does not), and the DELETE's re-rank below touches no row, which would leave
    -- a nested loop that is quadratic on the INSERT's. With nested loops off for this transaction, the first plan is
    -- a hash join whatever the row count.
    SET LOCAL enable_nestloop = off;

    CREATE TEMP TABLE osm_lineage_import (
        street_edge_id   INTEGER,
        osm_way_id       BIGINT,
        street_from_frac TEXT,
        street_to_frac   TEXT,
        way_from_frac    TEXT,
        way_to_frac      TEXT,
        same_direction   TEXT,
        geom_md5         TEXT
    ) ON COMMIT DROP;

    \copy osm_lineage_import FROM '$CSV_FILENAME' WITH (FORMAT csv, HEADER true)

    CREATE TEMP TABLE osm_lineage_match ON COMMIT DROP AS
    SELECT DISTINCT osm_lineage_import.street_edge_id
    FROM osm_lineage_import
    INNER JOIN street_edge ON osm_lineage_import.street_edge_id = street_edge.street_edge_id
        AND osm_lineage_import.geom_md5 = md5(ST_AsBinary(street_edge.geom));
    -- A temp table filled in the same transaction has no statistics, so the joins below would be planned off a guess
    -- at its size; a bad guess costs hours on a big city.
    ANALYZE osm_lineage_import;
    ANALYZE osm_lineage_match;

    SELECT (SELECT COUNT(DISTINCT street_edge_id) FROM osm_lineage_import) AS streets_in_csv,
           (SELECT COUNT(*) FROM osm_lineage_match) AS streets_matching_a_geometry;

    DO \$\$
    DECLARE
        streets_in_csv INTEGER := (SELECT COUNT(DISTINCT street_edge_id) FROM osm_lineage_import);
        streets_matching INTEGER := (SELECT COUNT(*) FROM osm_lineage_match);
    BEGIN
        IF streets_in_csv > 0 AND streets_matching = 0 THEN
            RAISE EXCEPTION 'None of the % CSV street(s) match a street geometry in this schema.', streets_in_csv
                USING HINT = 'Wrong city? Otherwise every street in the file changed since the export: export again.';
        ELSIF streets_in_csv >= 20 AND streets_matching * 2 < streets_in_csv THEN
            RAISE EXCEPTION 'Only % of the % CSV streets match a street geometry in this schema.',
                streets_matching, streets_in_csv
                USING HINT = 'An export older than a street import? Export and match again.';
        END IF;
    END
    \$\$;

    -- A dump-restored schema can have the id sequence behind the table. Set before the DELETE, since a sequence change
    -- survives a rollback and must never end up below a row the rollback brings back.
    SELECT setval(pg_get_serial_sequence('osm_way_street_edge', 'osm_way_street_edge_id'),
                  (SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge), false);
    DELETE FROM osm_way_street_edge
    USING osm_lineage_match
    WHERE osm_way_street_edge.street_edge_id = osm_lineage_match.street_edge_id;

    INSERT INTO osm_way_street_edge (osm_way_id, street_edge_id, street_from_frac, street_to_frac, way_from_frac,
                                     way_to_frac, same_direction, matched_at)
    SELECT osm_lineage_import.osm_way_id,
           osm_lineage_import.street_edge_id,
           NULLIF(street_from_frac, '')::DOUBLE PRECISION,
           NULLIF(street_to_frac, '')::DOUBLE PRECISION,
           NULLIF(way_from_frac, '')::DOUBLE PRECISION,
           NULLIF(way_to_frac, '')::DOUBLE PRECISION,
           NULLIF(same_direction, '')::BOOLEAN,
           CASE WHEN street_from_frac <> '' THEN now() END
    FROM osm_lineage_import
    INNER JOIN osm_lineage_match ON osm_lineage_import.street_edge_id = osm_lineage_match.street_edge_id;

    SELECT COUNT(*) FILTER (WHERE street_from_frac IS NOT NULL) AS positioned_links,
           COUNT(*) FILTER (WHERE street_from_frac IS NULL) AS unpositioned_links,
           COUNT(DISTINCT street_edge_id) AS linked_streets
    FROM osm_way_street_edge;

    COMMIT;
EOSQL

echo "Done! Ingested $CSV_FILENAME into osm_way_street_edge."
