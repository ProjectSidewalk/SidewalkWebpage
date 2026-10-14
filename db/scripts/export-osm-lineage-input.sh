#!/usr/bin/env bash
set -euo pipefail

# Step 1 of positioning a live city's streets on their OpenStreetMap ways (#5741): write every served street with the
# way ids it is linked to into db/onboarding/<city-id>/osm_lineage_input.csv, for tools/city/backfill_osm_lineage.py
# to match against the ways OSM holds today. Every street is exported, whether or not it already has positions: the
# matching claims a street's stretches way by way, so it is only right over the whole street at once. The tutorial
# street is never exported: it is the shared DC geometry, on no way of this city's.
#
# A city whose streets did not come from OSM (the Infra3d cities, linked to the placeholder way -1 throughout) has
# nothing to position, and the export stops rather than send the matcher looking for ways that are not there.

# shellcheck source=helpers.sh
source /opt/scripts/helpers.sh

# Optional positional args ($1 schema, $2 city id) so a caller can drive the script without its prompts.
SCHEMA_NAME=${1:-$(prompt_with_default "Schema name")}
CITY_ID=${2:-$(prompt_with_default "City id (the db/onboarding/<city-id> dir to write into, e.g. seattle-wa)")}
# The same shape tools/city/backfill_osm_lineage.py accepts, so a typo cannot create a directory it then refuses.
if [[ ! "$CITY_ID" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Error: city id \"$CITY_ID\" is not lowercase kebab-case (e.g. seattle-wa)." >&2
  exit 1
fi

OSM_LINKED=$(psql -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" -At \
  -c "SELECT COUNT(*) FROM osm_way_street_edge WHERE osm_way_id <> -1")
if [[ "$OSM_LINKED" -eq 0 ]]; then
  echo "Error: no street in $SCHEMA_NAME is linked to an OpenStreetMap way (an Infra3d city?), so there is" >&2
  echo "nothing to position." >&2
  exit 1
fi

OUT_DIR=/opt/onboarding/$CITY_ID
mkdir -p "$OUT_DIR"
OUT_FILE=$OUT_DIR/osm_lineage_input.csv
# Written beside the target and moved into place on success, so a failed export never leaves a partial file under the
# name the matcher reads.
TMP_FILE=$OUT_FILE.partial
trap 'rm -f "$TMP_FILE"' EXIT

# geom_md5 is what import-osm-lineage.sh compares against the street's geometry at import time: a row only loads
# while the street still has the line it was matched on.
psql -q -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" > "$TMP_FILE" <<EOSQL
    COPY (
        SELECT street_edge.street_edge_id,
               md5(ST_AsBinary(street_edge.geom)) AS geom_md5,
               COALESCE((SELECT string_agg(DISTINCT osm_way_street_edge.osm_way_id::text, ',')
                         FROM osm_way_street_edge
                         WHERE osm_way_street_edge.street_edge_id = street_edge.street_edge_id), '') AS osm_way_ids,
               ST_AsHEXEWKB(street_edge.geom) AS geom
        FROM street_edge
        WHERE street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
        ORDER BY street_edge.street_edge_id
    ) TO STDOUT WITH (FORMAT csv, HEADER)
EOSQL
mv "$TMP_FILE" "$OUT_FILE"

echo "Done! Wrote $(($(wc -l < "$OUT_FILE") - 1)) street(s) to $OUT_FILE. Next: make osm-lineage id=$CITY_ID"
