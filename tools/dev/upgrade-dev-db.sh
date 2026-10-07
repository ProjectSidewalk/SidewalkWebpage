#!/usr/bin/env bash
#
# Copy a dev database from its Postgres 16 volume (`<project>_pgdata`) into the Postgres 18 one (`<project>_pgdata18`).
#
#     make upgrade-dev-db
#     bash tools/dev/upgrade-dev-db.sh [--container <db-container>]
#
# Runs on the HOST: it opens the old volume in a throwaway Postgres 16 container and pg_dumpalls it into the new one.
# The old volume's data never changes, so a bad copy costs nothing: rerun it.
#
# Everything in the new database is replaced, including the template data init.sh loaded on its first boot.
#
set -euo pipefail

CONTAINER="projectsidewalk-db"
while [ $# -gt 0 ]; do
  case "$1" in
    --container)
      shift
      [ $# -gt 0 ] || { echo "error: --container needs a value"; exit 2; }
      CONTAINER="$1"
      ;;
    *) echo "error: unknown argument: $1"; exit 2 ;;
  esac
  shift
done

# The last Postgres 16 image we ran. Same major version as the old data, which is all Postgres needs to open it.
OLD_IMAGE="postgis/postgis:16-3.5"
OLD_CONTAINER="${CONTAINER}-16"
LOG="$(mktemp)"

die() { echo "error: $*" >&2; exit 1; }
cleanup() { docker rm -f "$OLD_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Each city's label count, one "schema|count" line per city, so the two databases can be diffed as text.
LABEL_COUNTS_SQL="SELECT nspname || '|' || (xpath('/row/c/text()',
    query_to_xml(format('SELECT count(*) AS c FROM %I.label', nspname), false, true, '')))[1]::text
  FROM pg_namespace WHERE nspname LIKE 'sidewalk\_%' AND to_regclass(quote_ident(nspname) || '.label') IS NOT NULL
  ORDER BY nspname"

[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ] \
  || die "$CONTAINER isn't running. Start it with \`make docker-up-db\`."

new_version=$(docker exec "$CONTAINER" psql -U postgres -tAc "SHOW server_version_num")
(( new_version >= 180000 )) \
  || die "$CONTAINER is still on Postgres $((new_version / 10000)). Rebuild it: \`docker compose up -d --build db\`."

project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$CONTAINER")
network=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$CONTAINER")
old_volume="${project}_pgdata"
docker volume inspect "$old_volume" >/dev/null 2>&1 \
  || die "there's no $old_volume volume, so there's nothing to copy. Your Postgres 18 database is ready as it is."

old_major=$(docker run --rm -v "$old_volume":/data:ro --entrypoint cat "$OLD_IMAGE" /data/PG_VERSION)
[ "$old_major" = "16" ] || die "$old_volume holds Postgres $old_major data, but this script only copies from 16."

# pg_dumpall drops and recreates the sidewalk database, which fails while anything is connected to it.
clients=$(docker exec "$CONTAINER" psql -U postgres -tAc \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = 'sidewalk' AND pid <> pg_backend_pid()")
(( clients == 0 )) \
  || die "$clients connection(s) to the sidewalk database. Stop \`npm start\` (and any psql sessions) first."

echo "Copying $old_volume (Postgres 16) into $CONTAINER (Postgres $((new_version / 10000)))."
echo "The data in your old volume is only read, never changed."

cleanup
docker run -d --name "$OLD_CONTAINER" --network "$network" -v "$old_volume":/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=sidewalk "$OLD_IMAGE" postgres -c jit=off >/dev/null
for _ in $(seq 1 60); do
  docker exec "$OLD_CONTAINER" pg_isready -q -h localhost -U postgres && break
  sleep 1
done
docker exec "$OLD_CONTAINER" pg_isready -q -h localhost -U postgres \
  || die "the old database didn't start; see \`docker logs $OLD_CONTAINER\`."

echo "Copying every database and role. A database with several cities takes a while..."
# The new server's own pg_dumpall does the dump: a newer pg_dumpall can read an older server, not the other way round.
# template_postgis is skipped because each postgis image makes its own, for its own PostGIS version.
docker exec -e PGPASSWORD=sidewalk "$CONTAINER" bash -o pipefail -c \
  "pg_dumpall -h $OLD_CONTAINER -U postgres --clean --if-exists --exclude-database=template_postgis \
    | psql -U postgres -d postgres -q -o /dev/null" \
  2> "$LOG" || die "the copy failed; its errors are in $LOG."

# Expected: pg_dumpall recreates the postgres role the restore runs as, and drops the skipped template_postgis.
unexpected=$(grep 'ERROR:' "$LOG" \
  | grep -v -e 'current user cannot be dropped' -e 'role "postgres" already exists' \
    -e 'cannot drop a template database' || true)
if [ -n "$unexpected" ]; then
  echo "The copy reported errors (full log: $LOG):" >&2
  echo "$unexpected" | head -20 >&2
fi

echo "Rebuilding query planner statistics..."
docker exec "$CONTAINER" vacuumdb -U postgres --all --analyze-only -q

old_counts=$(docker exec "$OLD_CONTAINER" psql -U postgres -d sidewalk -tAc "$LABEL_COUNTS_SQL")
new_counts=$(docker exec "$CONTAINER" psql -U postgres -d sidewalk -tAc "$LABEL_COUNTS_SQL")
echo
echo "Labels per city (old | new):"
LC_ALL=C join -t '|' -a 1 -a 2 -e missing -o 0,1.2,2.2 <(echo "$old_counts" | LC_ALL=C sort) \
  <(echo "$new_counts" | LC_ALL=C sort) | column -t -s '|'

if [ "$old_counts" != "$new_counts" ] || [ -n "$unexpected" ]; then
  die "the copy doesn't match. Your old volume is untouched; fix the cause and rerun."
fi
echo
echo "Done: every city matches. Once you've checked the app, delete the old volume with:"
echo "    docker volume rm $old_volume"
rm -f "$LOG"
