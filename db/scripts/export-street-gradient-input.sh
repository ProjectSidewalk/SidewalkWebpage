#!/usr/bin/env bash
set -euo pipefail

# Step 1 of filling the street_gradient table (#5223): write the streets that scripts/street_gradient.py should sample
# to db/onboarding/<city-id>/street_gradient_input.csv. By default that is only the streets with no street_gradient row
# or whose geometry has changed since they were sampled (geom_md5), so after a street import the same three commands
# top the table up instead of resampling the city. Pass "all" as the third argument to export every street, e.g.
# after the sampling method itself changes.
#
# is_structure marks a street whose OSM way is a bridge, a tunnel or a covered way, read from the nightly osm_way
# table the same way the intersection derivation reads it. A bare-earth elevation model has the ground under a bridge
# and over a tunnel, so the sampler draws those streets as a straight line between their endpoints. A city whose
# osm_way table is still empty (a new city before its first nightly refresh) exports every street as not a structure,
# so run this after that refresh.

source /opt/scripts/helpers.sh

# Optional positional args ($1 schema, $2 city id, $3 "all") so a caller can drive the script without its prompts.
SCHEMA_NAME=${1:-$(prompt_with_default "Schema name")}
CITY_ID=${2:-$(prompt_with_default "City id (the db/onboarding/<city-id> dir to write into, e.g. seattle-wa)")}
SCOPE=${3:-stale}
if [[ "$SCOPE" != "stale" && "$SCOPE" != "all" ]]; then
    echo "Error: the third argument is \"all\" or omitted, not \"$SCOPE\"." >&2
    exit 1
fi
EXPORT_ALL=$([[ "$SCOPE" == "all" ]] && echo TRUE || echo FALSE)

OUT_DIR=/opt/onboarding/$CITY_ID
mkdir -p "$OUT_DIR"
OUT_FILE=$OUT_DIR/street_gradient_input.csv

psql -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" > "$OUT_FILE" <<EOSQL
    COPY (
        SELECT street_edge.street_edge_id,
               md5(ST_AsBinary(street_edge.geom)) AS geom_md5,
               (COALESCE(osm_way.tags ->> 'bridge', 'no') <> 'no'
                OR COALESCE(osm_way.tags ->> 'tunnel', 'no') <> 'no'
                OR COALESCE(osm_way.tags ->> 'covered', 'no') = 'yes') AS is_structure,
               ST_AsHEXEWKB(street_edge.geom) AS geom
        FROM street_edge
        LEFT JOIN osm_way_street_edge ON street_edge.street_edge_id = osm_way_street_edge.street_edge_id
        LEFT JOIN osm_way ON osm_way_street_edge.osm_way_id = osm_way.osm_way_id
        LEFT JOIN street_gradient ON street_edge.street_edge_id = street_gradient.street_edge_id
        WHERE $EXPORT_ALL
            OR street_gradient.street_edge_id IS NULL
            OR street_gradient.geom_md5 <> md5(ST_AsBinary(street_edge.geom))
        ORDER BY street_edge.street_edge_id
    ) TO STDOUT WITH (FORMAT csv, HEADER)
EOSQL

echo "Done! Wrote $(($(wc -l < "$OUT_FILE") - 1)) street(s) to $OUT_FILE. Next: make street-gradient id=$CITY_ID"
