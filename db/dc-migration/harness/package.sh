#!/usr/bin/env bash
# Package a replayed + post-cleaned DC sandbox as a normal city dump (issue #4700).
#
# Usage: ./package.sh [--db sidewalk_dc_work] [--out /opt/sidewalk_dc-dump]
#
# Works on a throwaway clone so the sandbox stays replayable: renames schema `sidewalk` to `sidewalk_dc` (the
# city's schema/role name everywhere else) and the sandbox's own `sidewalk_login` to `sidewalk_dc_login` (DC's
# login rows, which the merge step folds into the real shared schema and then drops), dumps both, drops the clone.
# The dump lands in the db/ directory (mounted at /opt), so `make import-dump db=sidewalk_dc` restores it into the
# dev database like any city; harness/login-merge.sh then does the sidewalk_login merge there.
set -euo pipefail
CONTAINER=${DC_CONTAINER:-projectsidewalk-db}
DB=sidewalk_dc_work
OUT=/opt/sidewalk_dc-dump
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
PKG=${DB}_pkg
admin() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

echo "== cloning $DB -> $PKG"
admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid();" \
      -c "DROP DATABASE IF EXISTS $PKG;" -c "CREATE DATABASE $PKG TEMPLATE $DB OWNER sidewalk;"
echo "== renaming schemas"
docker exec -i "$CONTAINER" psql -U sidewalk -d "$PKG" -v ON_ERROR_STOP=1 -q \
  -c "ALTER SCHEMA sidewalk RENAME TO sidewalk_dc;" \
  -c "ALTER SCHEMA sidewalk_login RENAME TO sidewalk_dc_login;"
echo "== dumping to $OUT"
docker exec "$CONTAINER" pg_dump -U sidewalk -Fc -n sidewalk_dc -n sidewalk_dc_login -d "$PKG" -f "$OUT"
docker exec "$CONTAINER" ls -la "$OUT"
admin -c "DROP DATABASE $PKG;"
echo "== next: make import-dump db=sidewalk_dc   (drops any existing sidewalk_dc schema in the dev db first)"
echo "         harness/login-merge.sh             (merges sidewalk_dc_login into sidewalk_login, repoints FKs)"
