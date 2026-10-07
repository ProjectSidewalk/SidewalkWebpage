#!/usr/bin/env bash
#
# Copy a dev database from its Postgres 16 volume (`<project>_pgdata`) into the Postgres 18 one (`<project>_pgdata18`).
#
#     make upgrade-dev-db [all=1]
#     bash tools/dev/upgrade-dev-db.sh [--all] [--yes] [--container <db-container>]
#
# Runs on the HOST: it opens the old volume in a throwaway Postgres 16 container and copies the roles and the sidewalk
# database into the new one (--all: every database). The old volume's data never changes, so a bad copy costs nothing.
#
# Whatever is in the new sidewalk database is replaced, so it asks first if that holds any cities (--yes skips that).
#
set -euo pipefail

CONTAINER="projectsidewalk-db"
COPY_ALL=""
ASSUME_YES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --all) COPY_ALL="1" ;;
    --yes) ASSUME_YES="1" ;;
    --container)
      shift
      [ $# -gt 0 ] || { echo "error: --container needs a value"; exit 2; }
      CONTAINER="$1"
      ;;
    *) echo "error: unknown argument: $1"; exit 2 ;;
  esac
  shift
done

# The image that wrote the old data, which every existing checkout still has; a fresh pull of 16 works as well.
OLD_IMAGE="projectsidewalk/db:latest"
docker image inspect "$OLD_IMAGE" >/dev/null 2>&1 || OLD_IMAGE="postgis/postgis:16-3.5"
OLD_CONTAINER="${CONTAINER}-16"
LOG="$(mktemp)"

die() { echo "error: $*" >&2; exit 1; }
# A clean stop, so the old server shuts down normally instead of needing crash recovery next time.
cleanup() {
  docker stop -t 60 "$OLD_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$OLD_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Over TCP: during the first boot, init.sh's temporary server answers on the socket only, and must not be copied into.
new_psql() { docker exec "$CONTAINER" psql -h 127.0.0.1 -U postgres "$@"; }

# Each city's label count, one "schema|count" line per city, so the two databases can be diffed as text.
LABEL_COUNTS_SQL="SELECT nspname || '|' || (xpath('/row/c/text()',
    query_to_xml(format('SELECT count(*) AS c FROM %I.label', nspname), false, true, '')))[1]::text
  FROM pg_namespace WHERE nspname LIKE 'sidewalk\_%' AND to_regclass(quote_ident(nspname) || '.label') IS NOT NULL
  ORDER BY nspname"

[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ] \
  || die "$CONTAINER isn't running. Start it with \`make docker-up-db\`."
for _ in $(seq 1 300); do
  docker exec "$CONTAINER" pg_isready -q -h 127.0.0.1 -U postgres && break
  sleep 1
done

new_version=$(new_psql -tAc "SHOW server_version_num")
(( new_version >= 180000 )) \
  || die "$CONTAINER is still on Postgres $((new_version / 10000)). Rebuild it: \`docker compose up -d --build db\`."

project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$CONTAINER")
network=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$CONTAINER")
old_volume="${project}_pgdata"
docker volume inspect "$old_volume" >/dev/null 2>&1 \
  || die "there's no $old_volume volume, so there's nothing to copy. Your Postgres 18 database is ready as it is."

old_major=$(docker run --rm -v "$old_volume":/data:ro --entrypoint cat "$OLD_IMAGE" /data/PG_VERSION)
[ "$old_major" = "16" ] || die "$old_volume holds Postgres $old_major data, but this script only copies from 16."

# The copy drops and recreates databases, which fails while a client (the app, psql, a GUI tool) is connected.
clients=$(new_psql -tAc \
  "SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()")
(( clients == 0 )) \
  || die "$clients open connection(s) to $CONTAINER. Stop \`npm start\`, psql and any database GUI first."

cities=$(new_psql -d sidewalk -tAc "SELECT count(*) FROM pg_namespace
  WHERE nspname LIKE 'sidewalk\_%' AND nspname NOT IN ('sidewalk_login', 'sidewalk_init')" 2>/dev/null || echo 0)
if (( cities > 0 )) && [ -z "$ASSUME_YES" ]; then
  [ -t 0 ] || die "the Postgres 18 database already has $cities city schema(s). Rerun with --yes to replace them."
  read -r -p "The Postgres 18 database already has $cities city schema(s). Replace them with the 16 copy? [y/N] " reply
  [[ "$reply" == [yY]* ]] || die "nothing was changed."
fi

echo "Copying $old_volume (Postgres 16) into $CONTAINER (Postgres $((new_version / 10000)))."

cleanup
docker run -d --name "$OLD_CONTAINER" --network "$network" -v "$old_volume":/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=sidewalk "$OLD_IMAGE" postgres -c jit=off -c autovacuum=off >/dev/null
for _ in $(seq 1 60); do
  docker exec "$OLD_CONTAINER" pg_isready -q -h localhost -U postgres && break
  sleep 1
done
docker exec "$OLD_CONTAINER" pg_isready -q -h localhost -U postgres \
  || die "the old database didn't start; see \`docker logs $OLD_CONTAINER\`."

# The new server's own tools do the dump: a newer pg_dump can read an older server, not the other way round.
dump_from_old="pg_dumpall -h $OLD_CONTAINER -U postgres --roles-only; \
  pg_dump -h $OLD_CONTAINER -U postgres --create --clean --if-exists -d sidewalk"
if [ -n "$COPY_ALL" ]; then
  # template_postgis is skipped because each postgis image makes its own, for its own PostGIS version.
  dump_from_old="pg_dumpall -h $OLD_CONTAINER -U postgres --clean --if-exists --exclude-database=template_postgis"
  echo "Copying every database and role. Several cities, or a DC copy, take a while..."
else
  echo "Copying the roles and the sidewalk database. Several cities take a while..."
fi
docker exec -e PGPASSWORD=sidewalk "$CONTAINER" bash -o pipefail -c \
  "{ $dump_from_old; } | psql -h 127.0.0.1 -U postgres -d postgres -q -o /dev/null" \
  2> "$LOG" || die "the copy failed; its errors are in $LOG."

# Expected: the roles init.sh already made exist, and --all also tries to drop the postgres role the restore runs as
# and the template_postgis it was told to skip.
unexpected=$(grep 'ERROR:' "$LOG" \
  | grep -v -e 'role ".*" already exists' -e 'current user cannot be dropped' \
    -e 'cannot drop a template database' || true)
if [ -n "$unexpected" ]; then
  echo "The copy reported errors (full log: $LOG):" >&2
  echo "$unexpected" | head -20 >&2
fi

echo "Rebuilding query planner statistics..."
docker exec "$CONTAINER" vacuumdb -h 127.0.0.1 -U postgres --all --analyze-only -q

old_counts=$(docker exec "$OLD_CONTAINER" psql -U postgres -d sidewalk -tAc "$LABEL_COUNTS_SQL")
new_counts=$(new_psql -d sidewalk -tAc "$LABEL_COUNTS_SQL")
echo
echo "Labels per city (old | new):"
LC_ALL=C join -t '|' -a 1 -a 2 -e missing -o 0,1.2,2.2 <(echo "$old_counts" | LC_ALL=C sort) \
  <(echo "$new_counts" | LC_ALL=C sort) | column -t -s '|'

if [ "$old_counts" != "$new_counts" ] || [ -n "$unexpected" ]; then
  die "the copy doesn't match. Your old volume is unchanged; fix the cause and rerun."
fi
echo
echo "Done: every city matches. Keep $old_volume while you still check out branches from before Postgres 18 (they"
echo "start it again). After that, delete it with:"
echo "    docker volume rm $old_volume"
rm -f "$LOG"
