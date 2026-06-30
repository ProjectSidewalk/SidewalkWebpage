#!/usr/bin/env bash
# =====================================================================================================================
# hide-streets-without-imagery.sh — mark streets that have no street-view imagery as un-auditable.
#
# WHY THIS EXISTS: a city import includes every OSM street, but some have no usable street-view imagery and shouldn't be
# handed out for auditing. check_streets_for_imagery.py scans the city and writes a CSV of those street IDs; this script
# applies that CSV by setting street_edge.status = 'no_imagery' and dropping the streets' priority rows (see #4348/#4335).
#
# HOW IT'S RUN:  make hide-streets-without-imagery   →   /opt/scripts/hide-streets-without-imagery.sh   (in projectsidewalk-db).
# INPUT:         a headered CSV whose first column is street_edge_id (default db/streets_with_no_imagery.csv).
#
# The actual UPDATE/DELETE lives in mark_streets_no_imagery() in helpers.sh, shared with reveal-or-hide-neighborhoods.sh
# so the two can't drift. It's idempotent, so re-running on an already-processed region is safe.
# =====================================================================================================================
set -euo pipefail

source /opt/scripts/helpers.sh

SCHEMA_NAME=$(prompt_with_default "Schema name")

# Prompt user for path to CSV file and prepend the container working dir (/opt == ./db on the host).
CSV_FILENAME=$(prompt_with_default "Path to CSV file (relative to db dir)" "streets_with_no_imagery.csv")
CSV_FILENAME=/opt/$CSV_FILENAME
if [[ ! -f "$CSV_FILENAME" ]]; then
    echo "Error: CSV not found at $CSV_FILENAME. Generate it with check_streets_for_imagery.py first." >&2
    exit 1
fi

# Read list of streets to hide from CSV file.
STREET_IDS=$(read_street_ids_from_csv "$CSV_FILENAME")
echo "Streets to exclude: $STREET_IDS"

# Mark the streets without imagery (shared with reveal-or-hide-neighborhoods.sh via helpers.sh).
mark_streets_no_imagery "$STREET_IDS" -d sidewalk -U "$SCHEMA_NAME"

echo "Done! You can now safely delete the $CSV_FILENAME file."
