#!/usr/bin/env bash
# =====================================================================================================================
# create-new-schema.sh — create a brand-new, empty city schema by cloning a live city's structure.
#
# WHY THIS EXISTS: when you're standing up a new city (before you have a data dump for it), you need an empty schema
# with the full, *current* Project Sidewalk table structure. This copies a donor city's schema (structure only), the
# handful of seed rows every city carries — the applied evolutions, the version history, `config` with its tutorial
# street, the tag catalogue, and the survey questions — creates the owning role, and wires up search_path + read-only
# grants. After this, you'd load the city's streets/regions with fill-new-schema.sh.
#
# It clones a donor rather than restoring the committed `sidewalk_init` template because the template is frozen at
# evolution 252 and can no longer be replayed forward: evolutions 270/295/355 read `sidewalk_login.role`, which 372
# dropped, so a schema that old wedges on its first app boot (#5198). A donor at the current evolution level never
# goes stale. `init.sh` and CI still restore the template for the dev DB's first boot; only this script moved on.
#
# HOW IT'S RUN:  make create-new-schema name=<schema> donor=<schema>   →   /opt/scripts/create-new-schema.sh <args>
# INPUT:         $1 = new schema name (e.g. sidewalk_newcity)
#                $2 = donor schema (an existing city, e.g. sidewalk_richmond; the active dev city is a good default)
#                $3 = (optional) the repo's highest evolution number. The donor is refused when it has applied
#                     anything beyond it: a dev schema that hosted another branch's QA can sit *ahead* of develop, and
#                     cloning it would carry that branch's evolution into the new city. `make` passes this for you.
#
# GOTCHA: the names are interpolated into DDL, so they must be safe bare SQL identifiers (validated below). Re-running
# for an existing name drops and recreates that schema — destructive, as intended for a fresh setup.
# =====================================================================================================================
set -euo pipefail

source /opt/scripts/helpers.sh

NAME=${1:-}
DONOR=${2:-}
MAX_EVOLUTION=${3:-}
if [[ -z "$NAME" || -z "$DONOR" ]]; then
    echo "Usage: create-new-schema.sh <schema_name> <donor_schema> [max_evolution]" >&2
    echo "       Typically run via: make create-new-schema name=<schema_name> donor=<donor_schema>" >&2
    exit 1
fi
for identifier in "$NAME" "$DONOR"; do
    if [[ ! "$identifier" =~ ^[a-z][a-z0-9_]*$ ]]; then
        echo "Error: '$identifier' is not a valid schema name." >&2
        echo "       Use lowercase letters, digits, and underscores, starting with a letter (e.g. sidewalk_newcity)." >&2
        exit 1
    fi
done
if [[ "$NAME" == "$DONOR" ]]; then
    echo "Error: the new schema and the donor must differ." >&2
    exit 1
fi
if [[ -n "$MAX_EVOLUTION" && ! "$MAX_EVOLUTION" =~ ^[0-9]+$ ]]; then
    echo "Error: max_evolution must be a number (got '$MAX_EVOLUTION')." >&2
    exit 1
fi

# The donor must be a real city schema at a shipped evolution level.
donor_exists=$(psql -U postgres -d sidewalk -tAc "SELECT 1 FROM pg_namespace WHERE nspname = '$DONOR'")
if [[ "$donor_exists" != "1" ]]; then
    echo "Error: donor schema '$DONOR' does not exist." >&2
    exit 1
fi
donor_evolution=$(psql -U postgres -d sidewalk -tAc "SELECT max(id) FROM $DONOR.play_evolutions")
if [[ -z "$donor_evolution" ]]; then
    echo "Error: '$DONOR' has no play_evolutions rows — is it a city schema?" >&2
    exit 1
fi
if [[ -n "$MAX_EVOLUTION" && "$donor_evolution" -gt "$MAX_EVOLUTION" ]]; then
    echo "Error: donor '$DONOR' is at evolution $donor_evolution, beyond this checkout's highest ($MAX_EVOLUTION)." >&2
    echo "       It has applied an evolution from another branch; pick a donor that hasn't (see docs/onboarding-a-city.md)." >&2
    exit 1
fi
echo "Cloning the structure of $DONOR (at evolution $donor_evolution) into $NAME..."

# Start from clean: drop any previous copy of the schema and its role, then create the role the dump's grants name.
psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    DROP SCHEMA IF EXISTS $NAME CASCADE;
    DROP USER IF EXISTS $NAME;
    CREATE USER $NAME;
    GRANT sidewalk TO $NAME;
EOSQL

# Structure only. Every mention of the donor's name — the schema, the enum types it qualifies, the donor role in
# GRANT / ALTER DEFAULT PRIVILEGES lines — becomes the new name; word boundaries keep `sidewalk_la` from matching
# inside `sidewalk_la_piedad`.
run_with_progress "Copying $DONOR's schema structure" bash -o pipefail -c \
    "pg_dump -U postgres -d sidewalk --schema-only -n '$DONOR' \
        | sed -E 's/\\b$DONOR\\b/$NAME/g' \
        | psql -v ON_ERROR_STOP=1 -q -U postgres -d sidewalk"

# Seed rows every city carries, copied as text so per-schema enum types (way_type, label_type, ...) round-trip
# without a cross-schema cast. Order matters for the FKs: the tutorial street before config (which points at it),
# survey questions before their options.
copy_rows() {
    local table=$1
    local select=$2
    psql -U postgres -d sidewalk -c "\\copy ($select) TO STDOUT" \
        | psql -v ON_ERROR_STOP=1 -q -U postgres -d sidewalk -c "\\copy $NAME.$table FROM STDIN"
}
copy_rows play_evolutions "SELECT * FROM $DONOR.play_evolutions ORDER BY id"
copy_rows version         "SELECT * FROM $DONOR.version"
copy_rows tag             "SELECT * FROM $DONOR.tag ORDER BY tag_id"
copy_rows survey_question "SELECT * FROM $DONOR.survey_question ORDER BY survey_question_id"
copy_rows survey_option   "SELECT * FROM $DONOR.survey_option ORDER BY survey_option_id"
copy_rows street_edge     "SELECT * FROM $DONOR.street_edge
                           WHERE street_edge_id = (SELECT tutorial_street_edge_id FROM $DONOR.config)"
copy_rows config          "SELECT * FROM $DONOR.config"

psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk <<-EOSQL
    ALTER SCHEMA $NAME OWNER TO sidewalk;
    ALTER ROLE $NAME SET search_path = $NAME,sidewalk_login,public;

    -- Sequences arrive at 1; move each past the rows just copied (the tag ids, the tutorial street, ...), so the
    -- first runtime INSERT doesn't collide with a seed row.
    DO \$\$
    DECLARE
        seq record;
    BEGIN
        FOR seq IN
            SELECT sequence_class.relname AS sequence_name, table_class.relname AS table_name,
                   attribute.attname AS column_name
            FROM pg_class sequence_class
            JOIN pg_namespace ON pg_namespace.oid = sequence_class.relnamespace
            JOIN pg_depend ON pg_depend.objid = sequence_class.oid AND pg_depend.deptype = 'a'
            JOIN pg_class table_class ON table_class.oid = pg_depend.refobjid
            JOIN pg_attribute attribute ON attribute.attrelid = table_class.oid
                                       AND attribute.attnum = pg_depend.refobjsubid
            WHERE sequence_class.relkind = 'S' AND pg_namespace.nspname = '$NAME'
        LOOP
            EXECUTE format('SELECT setval(%L, COALESCE((SELECT max(%I) FROM %I.%I), 0) + 1, false)',
                           '$NAME.' || seq.sequence_name, seq.column_name, '$NAME', seq.table_name);
        END LOOP;
    END \$\$;

    -- Read-only exploration role, as import-dump.sh grants it.
    DO \$\$
    BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_user') THEN
            EXECUTE format('GRANT USAGE ON SCHEMA %I TO readonly_user', '$NAME');
            EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO readonly_user', '$NAME');
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO readonly_user',
                           '$NAME', '$NAME');
        END IF;
    END \$\$;
EOSQL

echo "Created $NAME from $DONOR: $(psql -U postgres -d sidewalk -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = '$NAME'") tables, \
evolutions through $donor_evolution, $(psql -U postgres -d sidewalk -tAc "SELECT count(*) FROM $NAME.tag") tags, one tutorial street."
echo "Next: load qgis_road + qgis_region into it, then make fill-new-schema."
