#!/usr/bin/env bash
# Turn a fully replayed DC sandbox into a schema shaped like any other city (issue #4700).
#
# Usage:
#   ./postclean.sh [--db NAME] [--ref SCHEMA]
#
#   --db NAME     The replayed sandbox (default sidewalk_dc_work). Must already be at the highest evolution.
#   --ref SCHEMA  A modern city schema in the dev `sidewalk` database to take play_evolutions rows and the
#                 shape diff from (default sidewalk_seattle).
#
# Steps: export the dc_migration_* audit tables to CSV (kept beside the replay logs), drop them and every temp
# index/constraint the overlay added, add the three prod-only indexes no evolution creates, write the
# play_evolutions rows 15..N copied from the reference schema (Play verifies these against the repo files at boot,
# so the rows must carry mainline's scripts and hashes, never the patched ones), ANALYZE, and print the remaining
# shape diff against the reference schema, which should be empty.
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BASE=$(dirname "$HERE")
REPO=$(cd "$BASE/../.." && pwd)
CONTAINER=${DC_CONTAINER:-projectsidewalk-db}
DB=sidewalk_dc_work
REF=sidewalk_seattle
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB=$2; shift 2 ;;
    --ref) REF=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
case "$DB" in sidewalk_dc|sidewalk_dc_core|sidewalk|postgres) echo "refusing to touch baseline '$DB'" >&2; exit 65 ;; esac

OUT=${DC_LOGDIR:-$REPO/scratchpad/dc-migration/logs}/postclean-$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT/report"

psql_dc()  { docker exec -i -e PGOPTIONS="-c search_path=sidewalk,sidewalk_login,public" "$CONTAINER" psql -U sidewalk -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }
psql_dev() { docker exec -i "$CONTAINER" psql -U sidewalk -d sidewalk -v ON_ERROR_STOP=1 -q "$@"; }

echo "== exporting dc_migration_* audit tables to $OUT/report"
docker exec "$CONTAINER" mkdir -p /tmp/dc-migration-report
for T in $(psql_dc -At -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'sidewalk' AND table_name LIKE 'dc\\_%' ORDER BY 1"); do
  psql_dc -c "\\copy (SELECT * FROM $T) TO '/tmp/dc-migration-report/$T.csv' CSV HEADER" || exit 1
done
docker cp "$CONTAINER":/tmp/dc-migration-report/. "$OUT/report/" >/dev/null && docker exec "$CONTAINER" rm -rf /tmp/dc-migration-report
ls "$OUT/report"

echo "== play_evolutions rows from $REF"
psql_dev -c "\\copy (SELECT id, hash, applied_at, apply_script, revert_script, state, last_problem FROM $REF.play_evolutions WHERE id >= 15 ORDER BY id) TO '/tmp/dc-play-evolutions.csv' CSV" || exit 1

echo "== applying 999-postclean.sql"
psql_dc --single-transaction -f - < "$BASE/patches/999-postclean.sql" > "$OUT/postclean.out" 2>&1 || { echo "POSTCLEAN FAILED"; tail -20 "$OUT/postclean.out"; exit 2; }
cat "$OUT/postclean.out"
docker exec "$CONTAINER" rm -f /tmp/dc-play-evolutions.csv

echo "== shape diff vs $REF (expect only the login-FK set 337 documents and the two data-driven index notes)"
shape() {  # shape DBNAME SCHEMA
  docker exec -i "$CONTAINER" psql -U sidewalk -d "$1" -At <<EOF
SELECT 'table ' || table_name FROM information_schema.tables WHERE table_schema = '$2' AND table_type = 'BASE TABLE'
UNION ALL
SELECT 'column ' || table_name || '.' || column_name || ' ' || data_type || CASE WHEN is_nullable = 'NO' THEN ' NN' ELSE '' END
  FROM information_schema.columns WHERE table_schema = '$2'
UNION ALL
SELECT 'constraint ' || regexp_replace(conrelid::regclass::text, '^$2\\.', '') || ' ' || conname || ' ' || replace(pg_get_constraintdef(oid), '$2.', '')
  FROM pg_constraint WHERE connamespace = '$2'::regnamespace
UNION ALL
SELECT 'index ' || tablename || ' ' || regexp_replace(indexdef, '.* USING ', '') FROM pg_indexes WHERE schemaname = '$2'
UNION ALL
SELECT 'enum ' || typname || ' ' || string_agg(enumlabel, ',' ORDER BY enumsortorder)
  FROM pg_type JOIN pg_enum ON enumtypid = pg_type.oid WHERE typnamespace = '$2'::regnamespace GROUP BY typname
ORDER BY 1;
EOF
}
shape sidewalk "$REF" > "$OUT/shape-$REF.txt"
shape "$DB" sidewalk > "$OUT/shape-dc.txt"
diff "$OUT/shape-$REF.txt" "$OUT/shape-dc.txt" | grep '^[<>]' | tee "$OUT/shape-diff.txt"
echo "== done ($OUT)"
