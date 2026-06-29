#!/bin/bash
set -e  # Exit on any error

source /opt/scripts/helpers.sh

SCHEMA_NAME=$(prompt_with_default "Schema name")

# Prompt user for path to CSV file and prepend working dir.
CSV_FILENAME=$(prompt_with_default "Path to CSV file (relative to db dir)" "streets_with_no_imagery.csv")
CSV_FILENAME=/opt/$CSV_FILENAME

# Read list of streets to hide from CSV file.
STREET_IDS=$(read_street_ids_from_csv "$CSV_FILENAME")
echo "Streets to exclude: $STREET_IDS"

# Mark the streets without imagery (shared with reveal-or-hide-neighborhoods.sh via helpers.sh).
mark_streets_no_imagery "$STREET_IDS" -d sidewalk -U "$SCHEMA_NAME"

echo "Done! You can now safely delete the street_edge_endpoints.csv and streets_with_no_imagery.csv files"
