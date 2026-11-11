#!/usr/bin/env bash
# =====================================================================================================================
# hide-streets-without-imagery.sh — set each street's status from the imagery checker's verdict.
#
# WHY THIS EXISTS: a city import includes every OSM street, but some have no usable street-view imagery and shouldn't be
# handed out for auditing. check_streets_for_imagery.py scans the city and writes a per-street summary; this script
# applies it in both directions, so a rescan (new imagery, or a new coverage rule, #5669) corrects an earlier verdict.
# A hidden region's streets are judged too, landing on closed rather than open, so revealing it later needs no scan.
#
# HOW IT'S RUN:  make hide-streets-without-imagery → /opt/scripts/hide-streets-without-imagery.sh (in the db box).
# INPUT:         db/onboarding/<city-id>/street_imagery_summary.csv, or a plain street_edge_id list to only mark.
#
# The SQL lives in helpers.sh, shared with reveal-or-hide-regions.sh so the two can't drift; re-running a file is safe.
# =====================================================================================================================
set -euo pipefail

# shellcheck source=helpers.sh
source /opt/scripts/helpers.sh

# Optional positional args ($1 schema, $2 CSV path relative to the db dir) so tools/city/setup_new_city.py can drive the
# script without faking its prompts; anything omitted is prompted for. The CSV path is prepended with the container
# working dir (/opt == ./db on the host). No prompt default: the scan writes into each city's own onboarding dir.
SCHEMA_NAME=${1:-$(prompt_with_default "Schema name")}
CSV_FILENAME=${2:-$(prompt_with_default \
    "Path to CSV file (relative to db dir, e.g. onboarding/newport-ky/street_imagery_summary.csv)")}
CSV_FILENAME=/opt/$CSV_FILENAME
if [[ ! -f "$CSV_FILENAME" ]]; then
  echo "Error: CSV not found at $CSV_FILENAME. Generate it with check_streets_for_imagery.py first." >&2
  exit 1
fi
HEADER=$(head -n 1 "$CSV_FILENAME" | tr -d '\r')
if [[ "$HEADER" == *has_imagery* ]]; then
  # A summary can open streets, so only a full city's current one is taken: a preflight sample covers a few streets,
  # and an older summary was written under another coverage rule.
  EXPECTED_HEADER="street_edge_id,region_id,has_imagery,oldest_capture,newest_capture,n_panos,max_cross_track_m,\
cross_track_limit_m"
  if [[ "$CSV_FILENAME" == */preflight/* ]]; then
    echo "Error: $CSV_FILENAME is a preflight sample, not a full scan." >&2
    exit 1
  fi
  if [[ "$HEADER" != "$EXPECTED_HEADER" ]]; then
    echo "Error: $CSV_FILENAME does not have the columns check_streets_for_imagery.py writes:" >&2
    echo "  expected: $EXPECTED_HEADER" >&2
    echo "  found:    $HEADER" >&2
    exit 1
  fi
  NO_IMAGERY_IDS=$(awk -F',' 'NR > 1 && $3 == "False" { print $1 }' "$CSV_FILENAME" | paste -sd',' -)
  HAS_IMAGERY_IDS=$(awk -F',' 'NR > 1 && $3 == "True" { print $1 }' "$CSV_FILENAME" | paste -sd',' -)
  N_UNDECIDED=$(awk -F',' 'NR > 1 && $3 != "False" && $3 != "True"' "$CSV_FILENAME" | wc -l)
  if (( N_UNDECIDED > 0 )); then
    echo "Error: $N_UNDECIDED rows in $CSV_FILENAME have no True/False verdict." >&2
    exit 1
  fi
else
  # A plain id list (a hand-made one, or the checker's streets_with_no_imagery.csv) only marks.
  NO_IMAGERY_IDS=$(read_street_ids_from_csv "$CSV_FILENAME")
  HAS_IMAGERY_IDS=""
fi
echo "Streets without imagery: $NO_IMAGERY_IDS"

mark_streets_no_imagery "$NO_IMAGERY_IDS" hide_streets_without_imagery -d sidewalk -U "$SCHEMA_NAME"
reopen_streets_with_imagery "$HAS_IMAGERY_IDS" hide_streets_without_imagery -d sidewalk -U "$SCHEMA_NAME"

echo "Done! Keep $CSV_FILENAME until it has been ingested with 'make import-street-imagery'."
echo "The app caches street counts: clear the Play cache for $SCHEMA_NAME (PUT /adminapi/clearPlayCache) or restart it."
