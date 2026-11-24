#!/usr/bin/env bash
# =====================================================================================================================
# build-ci-city.sh — rebuild CI's test city the way a launched city is built: cloned from a donor, dumped, restored.
#
# WHY THIS EXISTS: a launched city is never the committed sidewalk_init template. Onboarding clones a donor's structure
# and seed rows (db/scripts/create-new-schema.sh), dumps the result with the data of every table it did not write left
# out (tools/city/setup_new_city.py's dump_schema), and the server restores that dump. Rows an evolution seeded into
# the donor do not survive that trip unless the clone copies them and the dump keeps them, because the clone copies
# the donor's play_evolutions and so never runs those evolutions itself. The committed template still holds every
# seeded row, so a suite run on the template alone passes on a schema no launched city has: that is how the tutorial
# broke on every city onboarded for two months without a red build (#6036).
#
# HOW IT'S RUN (from the repo root, in CI, with the db container up and sidewalk_teaneck already evolved to HEAD):
#   bash test/e2e/fixtures/build-ci-city.sh build        clone sidewalk_teaneck into a fresh one via a dump
#   bash test/e2e/fixtures/build-ci-city.sh check        fail if a table lost every row the donor had (see below)
#   bash test/e2e/fixtures/build-ci-city.sh drop-donor   drop the donor, so CI stays single-city
# `check` belongs after an app boot on the rebuilt city, because the boot re-creates some rows itself
# (AiSeedRowsRepair, #5349), and a table it refills must not count as lost.
#
# Everything here runs the real scripts — create-new-schema.sh, dump_schema, import-dump.sh — so a change to any of
# them is tested by every spec in both DB jobs. Not covered: fill-new-schema.sh (ci-seed.sql stands in for the
# streets and regions it would load) and the server's own restore (import-dump.sh stands in for it).
#
# GOTCHA: import-dump.sh terminates every connection to the database first, so stop the app before `build`.
# CI only: on a dev machine the same names are the developer's own Teaneck city and its git-ignored dump (db/ is the
# db container's /opt), and `build` then `drop-donor` would destroy both, so it refuses to run outside CI.
# =====================================================================================================================
set -euo pipefail

if [[ "${CI:-}" != "true" ]]; then
  echo "build-ci-city.sh only runs in CI: here it would replace your sidewalk_teaneck and its db/ dump." >&2
  exit 1
fi

CITY=sidewalk_teaneck
DONOR=sidewalk_ci_donor
DB_CONTAINER=projectsidewalk-db

# Tables whose rows a launched city legitimately starts without, though the donor has them. Each one needs a reason
# that says where the launched city's rows come from instead; anything else that goes missing fails `check`.
declare -A EMPTY_AT_LAUNCH=(
  [pano_data]="The tutorial panos' rows (evolution 360). The server writes them with the first tutorial label (#6036)."
  [sidewalk_presence]="Derived from the streets and their labels; SidewalkPresenceActor rebuilds it nightly (#5279)."
)

cd "$(dirname "$0")/../../.."

db_psql() {
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -X -q -U postgres -d sidewalk "$@"
}

build() {
  local head
  head=$(find conf/evolutions/default -name '*.sql' -printf '%f\n' | sed 's/\.sql$//' | sort -n | tail -1)

  echo "Moving the evolved $CITY aside as the donor, $DONOR..."
  db_psql -c "DROP SCHEMA IF EXISTS $DONOR CASCADE; ALTER SCHEMA $CITY RENAME TO $DONOR;"

  echo "Cloning it the way onboarding does..."
  docker exec "$DB_CONTAINER" /opt/scripts/create-new-schema.sh "$CITY" "$DONOR" "$head"

  echo "Dumping the clone the way onboarding does..."
  python3 -c "import sys; sys.path.insert(0, 'tools/city'); import setup_new_city; setup_new_city.dump_schema('$CITY')"

  echo "Restoring the dump the way a launch does..."
  docker exec "$DB_CONTAINER" /opt/scripts/import-dump.sh "$CITY"
  docker exec "$DB_CONTAINER" rm -f "/opt/$CITY-dump"
}

check() {
  local allowed="" table
  for table in "${!EMPTY_AT_LAUNCH[@]}"; do
    allowed+="${allowed:+,}'$table'"
    echo "Allowed to start empty: $table — ${EMPTY_AT_LAUNCH[$table]}"
  done
  db_psql <<-EOSQL
	DO \$\$
	DECLARE
	    table_name text;
	    donor_rows bigint;
	    city_rows  bigint;
	    lost       text[] := '{}';
	    compared   int := 0;
	BEGIN
	    FOR table_name IN SELECT tablename FROM pg_tables WHERE schemaname = '$DONOR' ORDER BY tablename LOOP
	        EXECUTE format('SELECT count(*) FROM %I.%I', '$DONOR', table_name) INTO donor_rows;
	        CONTINUE WHEN donor_rows = 0;
	        compared := compared + 1;
	        EXECUTE format('SELECT count(*) FROM %I.%I', '$CITY', table_name) INTO city_rows;
	        IF city_rows = 0 AND NOT table_name = ANY (ARRAY[$allowed]::text[]) THEN
	            lost := lost || format('%s (%s rows in the donor)', table_name, donor_rows);
	        END IF;
	    END LOOP;
	    IF compared = 0 THEN
	        RAISE EXCEPTION 'No table in $DONOR has rows to compare against: run check before drop-donor.';
	    END IF;
	    IF cardinality(lost) > 0 THEN
	        RAISE EXCEPTION 'The launched city has none of the donor''s rows in: %. A clone, dump and restore loses '
	            'them, so a real city launched today would too. Copy them in create-new-schema.sh and keep them in '
	            'the dump, have the app write them, or add the table to EMPTY_AT_LAUNCH in build-ci-city.sh with '
	            'the reason it may start empty.', array_to_string(lost, ', ');
	    END IF;
	END \$\$;
	EOSQL
  echo "Every table the donor has rows in has rows in $CITY, or is allowed to start empty."
}

drop_donor() {
  db_psql -c "DROP SCHEMA $DONOR CASCADE;"
}

case "${1:-}" in
  build) build ;;
  check) check ;;
  drop-donor) drop_donor ;;
  *) echo "Usage: build-ci-city.sh build|check|drop-donor" >&2; exit 2 ;;
esac
