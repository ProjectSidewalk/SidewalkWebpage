#!/usr/bin/env bash
#
# Export a city schema's validation queue and replay it through tools/analyze_validation_queue.py (#4715).
#
# Usage (host side, both dev containers up):
#   tools/validation_queue/run.sh <schema> [out-dir-relative-to-repo-root] [-- extra analyzer args]
#
# Examples:
#   tools/validation_queue/run.sh sidewalk_seattle
#   tools/validation_queue/run.sh sidewalk_teaneck tmp/validation-queue-teaneck -- --votes 5000
#
# The out dir defaults to tmp/validation-queue/, which .gitignore already covers: the CSVs are a snapshot of a
# database and must never be committed. Only report.md is meant to leave the machine.
#
# Two containers, two roles: psql runs in projectsidewalk-db as readonly_user (SELECT only, so a typo cannot write),
# and the analysis runs in projectsidewalk-web, the only place numpy is installed. The out dir therefore has to sit
# inside the worktree, which is the part of the host filesystem both containers see.
set -euo pipefail

SCHEMA=${1:?usage: run.sh <schema> [out-dir] [-- analyzer args]}
shift
OUT_REL=tmp/validation-queue
if [ $# -gt 0 ] && [ "$1" != "--" ]; then OUT_REL=$1; shift; fi
if [ "${1:-}" = "--" ]; then shift; fi

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
OUT_HOST="$REPO/$OUT_REL"
mkdir -p "$OUT_HOST"

# The web container mounts the main checkout at /home, and a worktree lives underneath it, so the container path is
# the host path with the main checkout's root swapped for /home. Asking git for the common dir finds that root from
# a worktree as well as from the checkout itself.
MAIN_ROOT=$(cd "$(dirname "$(git -C "$REPO" rev-parse --git-common-dir)")" && pwd)
case "$REPO" in
    "$MAIN_ROOT")   REPO_IN_WEB=/home ;;
    "$MAIN_ROOT"/*) REPO_IN_WEB="/home${REPO#"$MAIN_ROOT"}" ;;
    *) echo "cannot map $REPO into the web container (main checkout is $MAIN_ROOT)" >&2; exit 1 ;;
esac
OUT_IN_WEB="$REPO_IN_WEB/$OUT_REL"

psql_ro() { docker exec -i projectsidewalk-db psql -q -U readonly_user -d sidewalk "$@"; }

# Evolution 373 replaced label.label_type_id (plus its label_type lookup table) with a Postgres enum column. Both
# shapes are live on the dev DB and older city schemas migrate at their own pace, so the queries take the type
# expression as a psql variable rather than assuming either shape.
LEVEL=$(psql_ro -Atc "SELECT max(id) FROM $SCHEMA.play_evolutions")
if [ "$LEVEL" -ge 373 ]; then
    TYPE_EXPR="label.label_type::text"
    TYPE_JOIN=""
else
    TYPE_EXPR="label_type.label_type"
    TYPE_JOIN="INNER JOIN label_type ON label.label_type_id = label_type.label_type_id"
fi

# Whichever imagery source the city's labels actually live on; Validate only ever serves one source at a time.
PANO_SOURCE=$(psql_ro -Atc \
    "SELECT source FROM $SCHEMA.pano_data GROUP BY source ORDER BY count(*) DESC LIMIT 1")

echo "schema=$SCHEMA evolution=$LEVEL label_type=$TYPE_EXPR pano_source=$PANO_SOURCE" >&2

for query in pool validations; do
    echo "exporting $query.csv ..." >&2
    psql_ro -v schema="$SCHEMA" -v label_type_expr="$TYPE_EXPR" -v label_type_join="$TYPE_JOIN" \
        -v pano_source="$PANO_SOURCE" -f - < "$HERE/$query.sql" > "$OUT_HOST/$query.csv"
done
wc -l "$OUT_HOST"/pool.csv "$OUT_HOST"/validations.csv >&2

docker exec projectsidewalk-web python3.13 "$REPO_IN_WEB/tools/analyze_validation_queue.py" \
    --pool "$OUT_IN_WEB/pool.csv" \
    --validations "$OUT_IN_WEB/validations.csv" \
    --schema "$SCHEMA" \
    --out "$OUT_IN_WEB/report.md" \
    "$@"

echo "report written to $OUT_HOST/report.md" >&2
