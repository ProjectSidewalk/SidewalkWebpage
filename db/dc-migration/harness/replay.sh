#!/usr/bin/env bash
# Replay SidewalkWebpage evolutions against a DC migration sandbox database (issue #4700).
#
# Usage:
#   ./replay.sh [--db NAME] [--from TEMPLATE] [--reset] [START [END]]
#
#   --db NAME        Sandbox database to replay into (default: sidewalk_dc_work). Never the baselines.
#   --from TEMPLATE  Baseline to clone on --reset: sidewalk_dc_core (default, no interaction log) or
#                    sidewalk_dc (the full 25 GB restore).
#   --reset          Drop the sandbox, re-create it as a copy of the baseline (CREATE DATABASE ... TEMPLATE,
#                    seconds instead of a pg_restore), then apply patches/00-preclean.sql before replaying.
#   START/END        Evolution range (defaults 15..HIGHEST, where HIGHEST is the last file in conf/evolutions).
#
# Patch overlay (in ../patches/):
#   N.skip     — skip evolution N entirely (e.g. 135, already applied by DC's fork).
#   N.sql      — plain-SQL replacement for evolution N's Ups (no !Ups/!Downs markers).
#   N.pre.sql  — extra SQL applied immediately before evolution N (e.g. the anonymous-user split at 16, the
#                hand-run sidewalk_login split at 252).
#   N.notxn    — run evolution N without --single-transaction.
#
# Unpatched evolutions have their Ups section extracted from the repo and Play's ';;' escaping unescaped,
# matching Play's apply semantics. Everything runs through psql inside the dev db container, as the `sidewalk`
# superuser, with the search_path a prod city role has (city schema, shared login schema, public) and a prod-like
# work_mem (the dev container's 4 MB turns 338's NOT IN dedups into per-row subplans that never finish).
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BASE=$(dirname "$HERE")
REPO=$(cd "$BASE/../.." && pwd)
EVODIR=$REPO/conf/evolutions/default
PATCHES=$BASE/patches
CONTAINER=${DC_CONTAINER:-projectsidewalk-db}
DB=sidewalk_dc_work
TEMPLATE=sidewalk_dc_core
RESET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB=$2; shift 2 ;;
    --from) TEMPLATE=$2; shift 2 ;;
    --reset) RESET=1; shift ;;
    --) shift; break ;;
    -*) echo "unknown option $1" >&2; exit 64 ;;
    *) break ;;
  esac
done
HIGHEST=$(ls "$EVODIR" | sed 's/\.sql$//' | sort -n | tail -1)
START=${1:-15}
END=${2:-$HIGHEST}

case "$DB" in sidewalk_dc|sidewalk_dc_core|sidewalk|postgres) echo "refusing to replay into baseline '$DB'" >&2; exit 65 ;; esac

RUN_ID=$(date +%Y%m%d-%H%M%S)
LOGDIR=${DC_LOGDIR:-$REPO/scratchpad/dc-migration/logs}/run-$RUN_ID
mkdir -p "$LOGDIR"

psql_admin() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql_run() {  # psql_run [--no-txn] < sql
  local txn="--single-transaction"
  if [ "${1:-}" = "--no-txn" ]; then txn=""; shift; fi
  docker exec -i -e PGOPTIONS="-c search_path=sidewalk,sidewalk_login,public -c work_mem=256MB" \
    "$CONTAINER" psql -U sidewalk -d "$DB" -v ON_ERROR_STOP=1 -q $txn -f -
}

extract_ups() {
  awk '/^# --- !Ups/{flag=1;next} /^# --- !Downs/{flag=0} flag' "$1" | sed 's/;;/;/g'
}

if [ "$RESET" = 1 ]; then
  echo "== reset: recreating $DB from template $TEMPLATE"
  psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$DB', '$TEMPLATE') AND pid <> pg_backend_pid();" \
             -c "DROP DATABASE IF EXISTS $DB;" \
             -c "CREATE DATABASE $DB TEMPLATE $TEMPLATE OWNER sidewalk;" || exit 1
  echo "== reset: applying 00-preclean.sql"
  if ! psql_run < "$PATCHES/00-preclean.sql" > "$LOGDIR/00-preclean.out" 2>&1; then
    echo "PRECLEAN FAILED — see $LOGDIR/00-preclean.out"; tail -20 "$LOGDIR/00-preclean.out"; exit 1
  fi
  cat "$LOGDIR/00-preclean.out"
fi

echo "== replaying $START..$END into $DB (log: $LOGDIR)"
for N in $(seq "$START" "$END"); do
  if [ -f "$PATCHES/$N.skip" ]; then
    printf '%-4s skip  (%s)\n' "$N" "$(head -1 "$PATCHES/$N.skip" 2>/dev/null || echo patched-out)" \
      | tee -a "$LOGDIR/timings.log"
    continue
  fi
  if [ -f "$PATCHES/$N.pre.sql" ]; then
    echo "$N   pre-hook" | tee -a "$LOGDIR/timings.log"
    T0=$(date +%s.%N)
    if ! psql_run < "$PATCHES/$N.pre.sql" > "$LOGDIR/$N.pre.out" 2>&1; then
      echo "FAILED at $N.pre.sql — see $LOGDIR/$N.pre.out"; tail -20 "$LOGDIR/$N.pre.out"; exit 2
    fi
    printf '%-4s pre   %6.2fs\n' "$N" "$(echo "$(date +%s.%N) - $T0" | bc)" | tee -a "$LOGDIR/timings.log"
    grep -v '^$' "$LOGDIR/$N.pre.out" | sed 's/^/     /'
  fi
  if [ -f "$PATCHES/$N.sql" ]; then
    SRC="$PATCHES/$N.sql"; KIND=patch
    SQL=$(cat "$SRC")
  else
    SRC="$EVODIR/$N.sql"; KIND=repo
    [ -f "$SRC" ] || { echo "missing $SRC"; exit 3; }
    SQL=$(extract_ups "$SRC")
  fi
  TXNFLAG=""
  [ -f "$PATCHES/$N.notxn" ] && TXNFLAG="--no-txn"
  T0=$(date +%s.%N)
  if ! printf '%s\n' "$SQL" | psql_run $TXNFLAG > "$LOGDIR/$N.out" 2>&1; then
    echo "FAILED at evolution $N ($KIND) — see $LOGDIR/$N.out"
    tail -20 "$LOGDIR/$N.out"
    printf '%s\n' "$SQL" > "$LOGDIR/$N.failing.sql"
    exit 2
  fi
  T1=$(date +%s.%N)
  printf '%-4s %-5s %6.2fs\n' "$N" "$KIND" "$(echo "$T1 - $T0" | bc)" | tee -a "$LOGDIR/timings.log"
done
echo "== replay complete ($START..$END)"
