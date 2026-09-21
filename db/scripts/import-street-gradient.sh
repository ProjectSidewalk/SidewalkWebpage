#!/usr/bin/env bash
set -euo pipefail

# Step 3 of filling the street_gradient table (#5223): upsert the CSV scripts/street_gradient.py wrote
# (db/onboarding/<city-id>/street_gradient.csv). A row for a street that already has one replaces it whole, since a
# resample is only ever asked for when the geometry or the method changed and the old statistics describe neither.
#
# A row is only loaded when its geom_md5 still matches the street's geometry. street_edge_id is a per-city serial, so
# a CSV pointed at the wrong schema matches thousands of ids by accident, and the geometry hash is what tells a
# street from its namesake in another city. The same test skips a street deleted or edited between the export and
# this import. A few skipped rows are normal and are reported. Most of a sizeable file failing the test means the
# wrong city or a stale export, and aborts the import. A top-up of a handful of streets is too small for that share to
# mean anything (one street edited since the export is a third of a three-row file), so it only aborts when nothing
# matches at all.

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

# COPY maps columns by position, so a CSV from another version of the sampler would fail on whichever column first
# disagrees, with an error that names the column and not the cause. The header is the sampler's OUTPUT_FIELDS.
EXPECTED_HEADER="street_edge_id,quality,confidence,net_grade,mean_grade,max_grade,max_grade_from_m,max_grade_to_m,\
meters_over_5pct_grade,meters_over_8pct_grade,climb_m,descent_m,elev_start_m,elev_end_m,profile_cm,dem_source,\
dem_resolution_m,geom_md5"
# A byte-order mark (a CSV re-saved from a spreadsheet) is dropped here; COPY skips the header row, so it is harmless
# there. The error prints both headers, since an empty or wrong file fails this test too.
ACTUAL_HEADER=$(head -n 1 "$CSV_FILENAME" | tr -d '\r' | sed $'1s/^\xef\xbb\xbf//')
if [[ "$ACTUAL_HEADER" != "$EXPECTED_HEADER" ]]; then
    echo "Error: $CSV_FILENAME does not have the columns scripts/street_gradient.py writes." >&2
    echo "Expected: $EXPECTED_HEADER" >&2
    echo "Found:    $ACTUAL_HEADER" >&2
    echo "Resample the city with the current script." >&2
    exit 1
fi

# Staged as text so the sampler's empty fields survive as '' and become NULL here. The table's CHECK constraints then
# hold the rows to the same invariants the sampler is meant to produce, and one bad row fails the whole transaction.
psql -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" <<EOSQL
    BEGIN;

    CREATE TEMP TABLE street_gradient_import (
        street_edge_id         INTEGER,
        quality                TEXT,
        confidence             TEXT,
        net_grade              TEXT,
        mean_grade             TEXT,
        max_grade              TEXT,
        max_grade_from_m       TEXT,
        max_grade_to_m         TEXT,
        meters_over_5pct_grade TEXT,
        meters_over_8pct_grade TEXT,
        climb_m                TEXT,
        descent_m              TEXT,
        elev_start_m           TEXT,
        elev_end_m             TEXT,
        profile_cm             TEXT,
        dem_source             TEXT,
        dem_resolution_m       DOUBLE PRECISION,
        geom_md5               TEXT
    ) ON COMMIT DROP;

    \copy street_gradient_import FROM '$CSV_FILENAME' WITH (FORMAT csv, HEADER true)

    CREATE TEMP TABLE street_gradient_match ON COMMIT DROP AS
    SELECT street_gradient_import.street_edge_id
    FROM street_gradient_import
    INNER JOIN street_edge ON street_gradient_import.street_edge_id = street_edge.street_edge_id
        AND street_gradient_import.geom_md5 = md5(ST_AsBinary(street_edge.geom));

    SELECT (SELECT COUNT(*) FROM street_gradient_import) AS rows_in_csv,
           (SELECT COUNT(*) FROM street_gradient_match) AS rows_matching_a_street;

    DO \$\$
    DECLARE
        rows_in_csv INTEGER := (SELECT COUNT(*) FROM street_gradient_import);
        rows_matching INTEGER := (SELECT COUNT(*) FROM street_gradient_match);
    BEGIN
        IF rows_in_csv > 0 AND rows_matching = 0 THEN
            RAISE EXCEPTION 'None of the % CSV row(s) match a street geometry in this schema.', rows_in_csv
                USING HINT = 'Wrong city? Otherwise every street in the file changed since the export: export again.';
        ELSIF rows_in_csv >= 20 AND rows_matching * 2 < rows_in_csv THEN
            RAISE EXCEPTION 'Only % of the % CSV rows match a street geometry in this schema.',
                rows_matching, rows_in_csv
                USING HINT = 'An export older than a street import? Export and sample again.';
        END IF;
    END
    \$\$;

    INSERT INTO street_gradient (street_edge_id, quality, confidence, net_grade, mean_grade, max_grade,
                                 max_grade_from_m, max_grade_to_m, meters_over_5pct_grade, meters_over_8pct_grade,
                                 climb_m, descent_m, elev_start_m, elev_end_m, profile_cm, dem_source,
                                 dem_resolution_m, geom_md5, sampled_at)
    SELECT street_gradient_import.street_edge_id,
           quality::street_gradient_quality,
           confidence::street_gradient_confidence,
           NULLIF(net_grade, '')::DOUBLE PRECISION,
           NULLIF(mean_grade, '')::DOUBLE PRECISION,
           NULLIF(max_grade, '')::DOUBLE PRECISION,
           NULLIF(max_grade_from_m, '')::DOUBLE PRECISION,
           NULLIF(max_grade_to_m, '')::DOUBLE PRECISION,
           NULLIF(meters_over_5pct_grade, '')::DOUBLE PRECISION,
           NULLIF(meters_over_8pct_grade, '')::DOUBLE PRECISION,
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
    INNER JOIN street_gradient_match ON street_gradient_import.street_edge_id = street_gradient_match.street_edge_id
    ON CONFLICT (street_edge_id) DO UPDATE
    SET quality                = EXCLUDED.quality,
        confidence             = EXCLUDED.confidence,
        net_grade              = EXCLUDED.net_grade,
        mean_grade             = EXCLUDED.mean_grade,
        max_grade              = EXCLUDED.max_grade,
        max_grade_from_m       = EXCLUDED.max_grade_from_m,
        max_grade_to_m         = EXCLUDED.max_grade_to_m,
        meters_over_5pct_grade = EXCLUDED.meters_over_5pct_grade,
        meters_over_8pct_grade = EXCLUDED.meters_over_8pct_grade,
        climb_m                = EXCLUDED.climb_m,
        descent_m              = EXCLUDED.descent_m,
        elev_start_m           = EXCLUDED.elev_start_m,
        elev_end_m             = EXCLUDED.elev_end_m,
        profile_cm             = EXCLUDED.profile_cm,
        dem_source             = EXCLUDED.dem_source,
        dem_resolution_m       = EXCLUDED.dem_resolution_m,
        geom_md5               = EXCLUDED.geom_md5,
        sampled_at             = EXCLUDED.sampled_at;

    SELECT quality, COUNT(*) AS streets FROM street_gradient GROUP BY quality ORDER BY quality;

    COMMIT;
EOSQL

echo "Done! Ingested $CSV_FILENAME into street_gradient."
