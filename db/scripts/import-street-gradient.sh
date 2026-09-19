#!/usr/bin/env bash
set -euo pipefail

# Step 3 of filling the street_gradient table (#5223): upsert the CSV scripts/street_gradient.py wrote
# (db/onboarding/<city-id>/street_gradient.csv). A row for a street that already has one replaces it whole, since a
# resample is only ever asked for when the geometry or the method changed and the old statistics describe neither.
# A street deleted between the export and this import is skipped rather than failing the batch on its foreign key.

source /opt/scripts/helpers.sh

# Optional positional args ($1 schema, $2 CSV path relative to the db dir) so a caller can drive the script without
# its prompts. No prompt default: the sampler writes into each city's own onboarding dir.
SCHEMA_NAME=${1:-$(prompt_with_default "Schema name")}
CSV_FILENAME=${2:-$(prompt_with_default \
    "Path to CSV file (relative to db dir, e.g. onboarding/seattle-wa/street_gradient.csv)")}
CSV_FILENAME=/opt/$CSV_FILENAME
if [[ ! -f "$CSV_FILENAME" ]]; then
    echo "Error: CSV not found at $CSV_FILENAME. Generate it with scripts/street_gradient.py first." >&2
    exit 1
fi

# Staged as text so the sampler's empty fields survive as '' and become NULL here. The table's CHECK constraints then
# hold the rows to the same invariants the sampler is meant to produce, and one bad row fails the whole transaction.
psql -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" <<EOSQL
    BEGIN;

    CREATE TEMP TABLE street_gradient_import (
        street_edge_id   INTEGER,
        quality          TEXT,
        confidence       TEXT,
        net_grade        TEXT,
        mean_grade       TEXT,
        max_grade        TEXT,
        meters_over_5pct TEXT,
        meters_over_8pct TEXT,
        climb_m          TEXT,
        descent_m        TEXT,
        elev_start_m     TEXT,
        elev_end_m       TEXT,
        profile_cm       TEXT,
        dem_source       TEXT,
        dem_resolution_m DOUBLE PRECISION,
        geom_md5         TEXT
    ) ON COMMIT DROP;

    \copy street_gradient_import FROM '$CSV_FILENAME' WITH (FORMAT csv, HEADER true)

    INSERT INTO street_gradient (street_edge_id, quality, confidence, net_grade, mean_grade, max_grade,
                                 meters_over_5pct, meters_over_8pct, climb_m, descent_m, elev_start_m, elev_end_m,
                                 profile_cm, dem_source, dem_resolution_m, geom_md5, sampled_at)
    SELECT street_gradient_import.street_edge_id,
           quality::street_gradient_quality,
           confidence::street_gradient_confidence,
           NULLIF(net_grade, '')::DOUBLE PRECISION,
           NULLIF(mean_grade, '')::DOUBLE PRECISION,
           NULLIF(max_grade, '')::DOUBLE PRECISION,
           NULLIF(meters_over_5pct, '')::DOUBLE PRECISION,
           NULLIF(meters_over_8pct, '')::DOUBLE PRECISION,
           NULLIF(climb_m, '')::DOUBLE PRECISION,
           NULLIF(descent_m, '')::DOUBLE PRECISION,
           NULLIF(elev_start_m, '')::DOUBLE PRECISION,
           NULLIF(elev_end_m, '')::DOUBLE PRECISION,
           NULLIF(profile_cm, '')::INTEGER[],
           dem_source,
           dem_resolution_m,
           geom_md5,
           now()
    FROM street_gradient_import
    INNER JOIN street_edge ON street_gradient_import.street_edge_id = street_edge.street_edge_id
    ON CONFLICT (street_edge_id) DO UPDATE
    SET quality          = EXCLUDED.quality,
        confidence       = EXCLUDED.confidence,
        net_grade        = EXCLUDED.net_grade,
        mean_grade       = EXCLUDED.mean_grade,
        max_grade        = EXCLUDED.max_grade,
        meters_over_5pct = EXCLUDED.meters_over_5pct,
        meters_over_8pct = EXCLUDED.meters_over_8pct,
        climb_m          = EXCLUDED.climb_m,
        descent_m        = EXCLUDED.descent_m,
        elev_start_m     = EXCLUDED.elev_start_m,
        elev_end_m       = EXCLUDED.elev_end_m,
        profile_cm       = EXCLUDED.profile_cm,
        dem_source       = EXCLUDED.dem_source,
        dem_resolution_m = EXCLUDED.dem_resolution_m,
        geom_md5         = EXCLUDED.geom_md5,
        sampled_at       = EXCLUDED.sampled_at;

    SELECT quality, COUNT(*) AS streets FROM street_gradient GROUP BY quality ORDER BY quality;

    COMMIT;
EOSQL

echo "Done! Ingested $CSV_FILENAME into street_gradient."
