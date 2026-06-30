#!/usr/bin/env bash
set -euo pipefail

# Feeder 2 for the street_imagery table (#4348): ingest the per-street imagery summary produced by
# check_streets_for_imagery.py (db/street_imagery_summary.csv) into street_imagery with data_source = 'imagery_scan'.
# This covers streets a scan reached but that have no labels yet, so Feeder 1 (the evolution-326 pano_data backfill)
# could not see them. A deliberate scan is treated as authoritative for the streets it covers, so on a key collision the
# scan row supersedes an existing pano_data row.

source /opt/scripts/helpers.sh

SCHEMA_NAME=$(prompt_with_default "Schema name")

# Prompt user for path to CSV file and prepend working dir.
CSV_FILENAME=$(prompt_with_default "Path to CSV file (relative to db dir)" "street_imagery_summary.csv")
CSV_FILENAME=/opt/$CSV_FILENAME
if [[ ! -f "$CSV_FILENAME" ]]; then
    echo "Error: CSV not found at $CSV_FILENAME. Generate it with check_streets_for_imagery.py first." >&2
    exit 1
fi

# Stage the CSV in a temp table (all text so empty date fields survive as ''), then upsert only the streets that have
# imagery. Empty oldest/newest fields become NULL; a street with imagery but no parseable capture date still gets a row
# (NULL dates) so it is distinguishable from a street that was never scanned.
psql -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" <<EOSQL
    BEGIN;

    CREATE TEMP TABLE street_imagery_import (
        street_edge_id INTEGER,
        region_id      INTEGER,
        has_imagery    TEXT,
        oldest_capture TEXT,
        newest_capture TEXT,
        n_panos        INTEGER
    ) ON COMMIT DROP;

    \copy street_imagery_import FROM '$CSV_FILENAME' WITH (FORMAT csv, HEADER true)

    INSERT INTO street_imagery (street_edge_id, oldest_capture, newest_capture, n_panos, data_source, updated_at)
    SELECT street_edge_id,
           NULLIF(oldest_capture, '')::date,
           NULLIF(newest_capture, '')::date,
           n_panos,
           'imagery_scan',
           now()
    FROM street_imagery_import
    WHERE has_imagery = 'True'
    ON CONFLICT (street_edge_id) DO UPDATE
    SET oldest_capture = EXCLUDED.oldest_capture,
        newest_capture = EXCLUDED.newest_capture,
        n_panos        = EXCLUDED.n_panos,
        data_source    = EXCLUDED.data_source,
        updated_at     = EXCLUDED.updated_at;

    COMMIT;
EOSQL

echo "Done! Ingested $CSV_FILENAME into street_imagery (data_source = 'imagery_scan')."
