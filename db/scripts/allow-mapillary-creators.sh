#!/bin/bash
# =====================================================================================================================
# allow-mapillary-creators.sh — restrict a Mapillary deployment to imagery from chosen creators (#5407).
#
# WHY THIS EXISTS: a city that must launch already restricted (one running only on imagery we collected ourselves)
# has no admin yet to add the creators from /admin/imagery, so `make onboard-city` seeds them through this script.
# On a running deployment, use the admin page instead: it checks each username against Mapillary first.
#
# Pair it with a street imagery scan run under the same restriction
# (`check_streets_for_imagery.py --mapillary --mapillary-creator <username>`), so the streets those creators never
# drove are hidden rather than offered to labelers.
#
# USAGE (inside the projectsidewalk-db container, where /opt == ./db):
#     /opt/scripts/allow-mapillary-creators.sh <schema> <username>[,<username>...]
# =====================================================================================================================
set -euo pipefail
source /opt/scripts/helpers.sh

SCHEMA_NAME=${1:-$(prompt_with_default "Schema name")}
CREATORS=${2:-$(prompt_with_default "Mapillary usernames (comma-separated)")}

allow_mapillary_creators "$CREATORS" -d sidewalk -U "$SCHEMA_NAME"
echo "Done! $SCHEMA_NAME is restricted to Mapillary imagery by: $CREATORS"
