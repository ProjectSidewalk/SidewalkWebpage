#!/usr/bin/env bash
set -euo pipefail

# Step 1 of filling the street_gradient table (#5223): write the streets that scripts/street_gradient.py should sample
# to db/onboarding/<city-id>/street_gradient_input.csv. By default that is only the streets with no street_gradient row
# or whose geometry has changed since they were sampled (geom_md5), so after a street import the same three commands
# top the table up instead of resampling the city. Pass --all to export every street, e.g. after the sampling method
# itself changes.
#
# is_structure marks a street whose OSM way is a bridge, a tunnel or a covered way, read from the nightly osm_way
# table the same way the intersection derivation reads it. A bare-earth elevation model has the ground under a bridge
# and over a tunnel, so the sampler gives those streets no grade. A city whose osm_way table is still empty (a new
# city before its first nightly refresh, or a dev database that never ran one) would export every street as not a
# structure and have its bridges sampled as the ravine beneath them, with nothing downstream able to tell. So an empty
# osm_way stops the export unless --allow-empty-osm-way says it is expected.

source /opt/scripts/helpers.sh

# Flags anywhere, plus optional positional args ($1 schema, $2 city id) so a caller can drive the script without its
# prompts. `make export-street-gradient-input args=--all` still prompts for both.
EXPORT_ALL=FALSE
ALLOW_EMPTY_OSM_WAY=false
POSITIONAL=()
for arg in "$@"; do
    case "$arg" in
        --all) EXPORT_ALL=TRUE ;;
        --allow-empty-osm-way) ALLOW_EMPTY_OSM_WAY=true ;;
        -*) echo "Error: unknown option \"$arg\". Options: --all, --allow-empty-osm-way." >&2; exit 1 ;;
        *) POSITIONAL+=("$arg") ;;
    esac
done
SCHEMA_NAME=${POSITIONAL[0]:-$(prompt_with_default "Schema name")}
CITY_ID=${POSITIONAL[1]:-$(prompt_with_default \
    "City id (the db/onboarding/<city-id> dir to write into, e.g. seattle-wa)")}
# The same shape scripts/street_gradient.py accepts, so a typo cannot create a directory the sampler then refuses.
if [[ ! "$CITY_ID" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo "Error: city id \"$CITY_ID\" is not lowercase kebab-case (e.g. seattle-wa)." >&2
    exit 1
fi

OSM_WAYS=$(psql -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" -At -c "SELECT COUNT(*) FROM osm_way")
if [[ "$OSM_WAYS" -eq 0 && "$ALLOW_EMPTY_OSM_WAY" != true ]]; then
    echo "Error: $SCHEMA_NAME.osm_way is empty, so no street can be recognized as a bridge or tunnel and each would" >&2
    echo "be sampled as the ground beneath it. Export after the nightly OSM refresh has filled it, or pass" >&2
    echo "--allow-empty-osm-way if that is expected here." >&2
    exit 1
fi

OUT_DIR=/opt/onboarding/$CITY_ID
mkdir -p "$OUT_DIR"
OUT_FILE=$OUT_DIR/street_gradient_input.csv
# Written beside the target and moved into place on success, so a failed export never leaves a partial file under the
# name the sampler reads.
TMP_FILE=$OUT_FILE.partial
trap 'rm -f "$TMP_FILE"' EXIT

psql -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" > "$TMP_FILE" <<EOSQL
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
mv "$TMP_FILE" "$OUT_FILE"

echo "Done! Wrote $(($(wc -l < "$OUT_FILE") - 1)) street(s) to $OUT_FILE. Next: make street-gradient id=$CITY_ID"
