#!/usr/bin/env bash
# Replay SidewalkWebpage evolutions against the DC migration sandbox (issue #4700).
#
# Usage:
#   ./replay.sh [--reset] [START [END]]
#
#   --reset   Drop the sandbox schema, re-restore the core dump, and apply patches/00-preclean.sql
#             before replaying. Without it, replay continues against the current sandbox state.
#   START/END Evolution range (defaults 15..343).
#
# Patch overlay (in ../patches/):
#   N.skip     — skip evolution N entirely (e.g. 135, already applied by DC's fork).
#   N.sql      — plain-SQL replacement for evolution N's Ups (no !Ups/!Downs markers).
#   N.pre.sql  — extra SQL applied immediately before evolution N (e.g. the hand-run
#                sidewalk_login split injected at 252).
#   N.notxn    — run evolution N without --single-transaction.
#
# Unpatched evolutions have their Ups section extracted from the repo and Play's ';;'
# escaping unescaped, matching Play's apply semantics.
set -uo pipefail

REPO=/home/jonf/git/SidewalkWebpage
EVODIR=$REPO/conf/evolutions/default
BASE=/home/jonf/git/dc-migration
PATCHES=$BASE/patches
DUMP=$BASE/dumps/dc-core.dump
CONTAINER=dc-sandbox-db
RUN_ID=$(date +%Y%m%d-%H%M%S)
LOGDIR=$BASE/logs/run-$RUN_ID
mkdir -p "$LOGDIR"

RESET=0
if [ "${1:-}" = "--reset" ]; then RESET=1; shift; fi
START=${1:-15}
END=${2:-343}

# search_path mirrors prod city roles: city schema, shared login, public (postgis).
# A not-yet-existing sidewalk_login entry is silently ignored by Postgres.
psql_run() {  # psql_run [--no-txn] < sql
  local txn="--single-transaction"
  if [ "${1:-}" = "--no-txn" ]; then txn=""; shift; fi
  docker exec -i -e PGOPTIONS="-c search_path=sidewalk,sidewalk_login,public" \
    "$CONTAINER" psql -U sidewalk -d sidewalk -v ON_ERROR_STOP=1 -q $txn -f -
}

extract_ups() {
  awk '/^# --- !Ups/{flag=1;next} /^# --- !Downs/{flag=0} flag' "$1" | sed 's/;;/;/g'
}

if [ "$RESET" = 1 ]; then
  echo "== reset: dropping schema + restoring $DUMP"
  docker exec "$CONTAINER" psql -U postgres -d sidewalk -q \
    -c "DROP SCHEMA IF EXISTS sidewalk CASCADE;" \
    -c "DROP SCHEMA IF EXISTS sidewalk_login CASCADE;" || exit 1
  docker cp "$DUMP" "$CONTAINER":/tmp/dc-core.dump >/dev/null
  docker exec "$CONTAINER" pg_restore -U sidewalk -d sidewalk --no-owner -j 4 /tmp/dc-core.dump || exit 1
  echo "== reset: applying 00-preclean.sql"
  psql_run < "$PATCHES/00-preclean.sql" || { echo "PRECLEAN FAILED"; exit 1; }
fi

echo "== replaying $START..$END (log: $LOGDIR)"
for N in $(seq "$START" "$END"); do
  if [ -f "$PATCHES/$N.skip" ]; then
    printf '%-4s skip  (%s)\n' "$N" "$(head -1 "$PATCHES/$N.skip" 2>/dev/null || echo patched-out)" \
      | tee -a "$LOGDIR/timings.log"
    continue
  fi
  if [ -f "$PATCHES/$N.pre.sql" ]; then
    echo "$N   pre-hook" | tee -a "$LOGDIR/timings.log"
    if ! psql_run < "$PATCHES/$N.pre.sql" > "$LOGDIR/$N.pre.out" 2>&1; then
      echo "FAILED at $N.pre.sql — see $LOGDIR/$N.pre.out"; tail -20 "$LOGDIR/$N.pre.out"; exit 2
    fi
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
