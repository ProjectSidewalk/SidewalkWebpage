#!/usr/bin/env bash
# =====================================================================================================================
# hide-streets-without-imagery.sh — mark streets that have no street-view imagery as un-auditable.
#
# WHY THIS EXISTS: a city import includes every OSM street, but some have no usable street-view imagery and shouldn't be
# handed out for auditing. check_streets_for_imagery.py scans the city and writes a CSV of those street IDs; this script
# applies that CSV by setting street_edge.status = 'no_imagery' and dropping the streets' priority rows (see #4348/#4335).
#
# HOW IT'S RUN:  make hide-streets-without-imagery   →   /opt/scripts/hide-streets-without-imagery.sh   (in projectsidewalk-db).
# INPUT:         a headered CSV whose first column is street_edge_id (db/onboarding/<city-id>/streets_with_no_imagery.csv).
#
# The actual UPDATE/DELETE lives in mark_streets_no_imagery() in helpers.sh, shared with reveal-or-hide-neighborhoods.sh
# so the two can't drift. It's idempotent, so re-running on an already-processed region is safe.
# =====================================================================================================================
set -euo pipefail

source /opt/scripts/helpers.sh

# Optional positional args ($1 schema, $2 CSV path relative to the db dir) so tools/setup_new_city.py can drive the
# script without faking its prompts; anything omitted is prompted for. The CSV path is prepended with the container
# working dir (/opt == ./db on the host). No prompt default: the scan writes into each city's own onboarding dir.
SCHEMA_NAME=${1:-$(prompt_with_default "Schema name")}
CSV_FILENAME=${2:-$(prompt_with_default "Path to CSV file (relative to db dir, e.g. onboarding/newport-ky/streets_with_no_imagery.csv)")}
CSV_FILENAME=/opt/$CSV_FILENAME
if [[ ! -f "$CSV_FILENAME" ]]; then
    echo "Error: CSV not found at $CSV_FILENAME. Generate it with check_streets_for_imagery.py first." >&2
    exit 1
fi

# Read list of streets to hide from CSV file.
STREET_IDS=$(read_street_ids_from_csv "$CSV_FILENAME")
echo "Streets to exclude: $STREET_IDS"

# Mark the streets without imagery (shared with reveal-or-hide-neighborhoods.sh via helpers.sh).
mark_streets_no_imagery "$STREET_IDS" hide_streets_without_imagery -d sidewalk -U "$SCHEMA_NAME"

echo "Done! You can now safely delete $CSV_FILENAME — but keep the street_imagery_summary CSV until it has been"
echo "ingested with 'make import-street-imagery'."
