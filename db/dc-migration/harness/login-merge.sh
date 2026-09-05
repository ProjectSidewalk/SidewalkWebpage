#!/usr/bin/env bash
# Run harness/login-merge.sql inside the dev `sidewalk` database after `make import-dump db=sidewalk_dc` (issue #4700).
# Usage: ./login-merge.sh [--db sidewalk]     One transaction; prints the merge report.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CONTAINER=${DC_CONTAINER:-projectsidewalk-db}
DB=sidewalk
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
docker exec -i "$CONTAINER" psql -U sidewalk -d "$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f - < "$HERE/login-merge.sql"
