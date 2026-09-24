#!/usr/bin/env bash
set -euo pipefail

# Step 1 of filling the street_gradient table (#5223): write the streets that tools/city/street_gradient.py should
# sample to db/onboarding/<city-id>/street_gradient_input.csv. By default that is only the streets with no
# street_gradient row or whose geometry has changed since they were sampled (geom_md5), so after a street import the
# same three commands top the table up instead of resampling the city. Pass --all to export every street, e.g. after
# the sampling method itself changes. The tutorial street is never exported: it is the shared DC geometry, so no
# elevation model the city is sampled from says anything true about it.
#
# is_structure marks a street whose OSM way is a bridge, a tunnel or a covered way, read from the nightly osm_way
# table the same way the intersection derivation reads it. A bare-earth elevation model has the ground under a bridge
# and over a tunnel, so the sampler gives those streets no grade. A city whose osm_way table is still empty (a new
# city before its first nightly refresh, or a dev database that never ran one) would export every street as not a
# structure and have its bridges sampled as the ravine beneath them, with nothing downstream able to tell. So an empty
# osm_way stops the export unless --allow-empty-osm-way says it is expected, or --structures names the flags the
# street build wrote from the same OSM tags (db/onboarding/<city-id>/street_structures.csv, tools/city/onboard_city.py),
# which is how a city is sampled during onboarding rather than a night later.

source /opt/scripts/helpers.sh

# Flags anywhere, plus optional positional args ($1 schema, $2 city id) so a caller can drive the script without its
# prompts. `make export-street-gradient-input args=--all` still prompts for both.
EXPORT_ALL=FALSE
ALLOW_EMPTY_OSM_WAY=false
ALLOW_UNFLAGGED=FALSE
STRUCTURES_FILE=
POSITIONAL=()
while (($#)); do
    case "$1" in
        --all) EXPORT_ALL=TRUE ;;
        --allow-empty-osm-way) ALLOW_EMPTY_OSM_WAY=true ;;   # Moot with --structures, which never reads osm_way.
        --allow-unflagged-streets) ALLOW_UNFLAGGED=TRUE ;;
        --structures)
            # The path lands inside a quoted SQL literal, so it is held to the characters a path under db/ needs.
            if (($# < 2)) || [[ ! "$2" =~ ^[A-Za-z0-9_./-]+$ ]]; then
                echo "Error: --structures needs a path relative to the db dir (letters, digits, . _ - /), e.g." >&2
                echo "onboarding/seattle-wa/street_structures.csv." >&2
                exit 1
            fi
            STRUCTURES_FILE=/opt/$2
            shift ;;
        -*) echo "Error: unknown option \"$1\". Options: --all, --allow-empty-osm-way, --structures <path>," >&2
            echo "--allow-unflagged-streets." >&2
            exit 1 ;;
        *) POSITIONAL+=("$1") ;;
    esac
    shift
done
SCHEMA_NAME=${POSITIONAL[0]:-$(prompt_with_default "Schema name")}
CITY_ID=${POSITIONAL[1]:-$(prompt_with_default \
    "City id (the db/onboarding/<city-id> dir to write into, e.g. seattle-wa)")}
# The same shape tools/city/street_gradient.py accepts, so a typo cannot create a directory the sampler then refuses.
if [[ ! "$CITY_ID" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo "Error: city id \"$CITY_ID\" is not lowercase kebab-case (e.g. seattle-wa)." >&2
    exit 1
fi

if [[ -n "$STRUCTURES_FILE" && ! -f "$STRUCTURES_FILE" ]]; then
    echo "Error: structures file not found at $STRUCTURES_FILE. tools/city/onboard_city.py writes it beside the" >&2
    echo "build's other artifacts (make build-city-data)." >&2
    exit 1
fi
if [[ -z "$STRUCTURES_FILE" ]]; then
    OSM_WAYS=$(psql -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" -At -c "SELECT COUNT(*) FROM osm_way")
    if [[ "$OSM_WAYS" -eq 0 && "$ALLOW_EMPTY_OSM_WAY" != true ]]; then
        echo "Error: $SCHEMA_NAME.osm_way is empty, so no street can be recognized as a bridge or tunnel and each" >&2
        echo "would be sampled as the ground beneath it. Export after the nightly OSM refresh has filled it, pass" >&2
        echo "--structures <the build's street_structures.csv>, or pass --allow-empty-osm-way if an empty cache is" >&2
        echo "expected here." >&2
        exit 1
    fi
fi

OUT_DIR=/opt/onboarding/$CITY_ID
mkdir -p "$OUT_DIR"
OUT_FILE=$OUT_DIR/street_gradient_input.csv
# Written beside the target and moved into place on success, so a failed export never leaves a partial file under the
# name the sampler reads. The SQL is assembled in a file of its own because the structures file, when there is one,
# is staged in a temp table that has to live in the same session as the export.
TMP_FILE=$OUT_FILE.partial
SQL_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE" "$SQL_FILE"' EXIT

if [[ -n "$STRUCTURES_FILE" ]]; then
    # The file and the schema must name the same streets, in both directions, with the same geometry: every build
    # numbers its roads 1..N, so a file from another build marks the wrong streets as bridges while its ids look
    # right, and a rebuild that dropped streets leaves a file whose ids are a subset of the schema's, which the
    # one-directional check would pass. The file's geom_md5 is the hash this script computes for the export, so a
    # street whose geometry differs from the file's came from another build. Only streets inserted by hand after
    # the build (nothing in onboarding does) leave a street unflagged, and --allow-unflagged-streets says so; those
    # read as not on a structure.
    cat >> "$SQL_FILE" <<EOSQL
    CREATE TEMP TABLE street_structures_import (
        street_edge_id INTEGER PRIMARY KEY, is_structure BOOLEAN NOT NULL, geom_md5 TEXT NOT NULL);
    \\copy street_structures_import FROM '$STRUCTURES_FILE' WITH (FORMAT csv, HEADER true)
    DO \$\$
    DECLARE
        unknown_streets INTEGER;
        moved_streets INTEGER;
        unflagged_streets INTEGER;
    BEGIN
        SELECT COUNT(*) INTO unknown_streets
        FROM street_structures_import
        LEFT JOIN street_edge ON street_structures_import.street_edge_id = street_edge.street_edge_id
        WHERE street_edge.street_edge_id IS NULL;
        IF unknown_streets > 0 THEN
            RAISE EXCEPTION '% street(s) in the structures file are not in this schema.', unknown_streets
                USING HINT = 'A file from another build? Rebuild (or re-export with --from-gpkg) and load that SQL, '
                             'or export without --structures after the nightly OSM way refresh.';
        END IF;
        SELECT COUNT(*) INTO moved_streets
        FROM street_structures_import
        INNER JOIN street_edge ON street_structures_import.street_edge_id = street_edge.street_edge_id
        WHERE street_structures_import.geom_md5 <> md5(ST_AsBinary(street_edge.geom));
        IF moved_streets > 0 THEN
            RAISE EXCEPTION '% street(s) in the structures file have a different geometry in this schema.',
                moved_streets
                USING HINT = 'A file from another build of the same size? Load the SQL of the build that wrote the '
                             'file, or export without --structures after the nightly OSM way refresh.';
        END IF;
        SELECT COUNT(*) INTO unflagged_streets
        FROM street_edge
        LEFT JOIN street_structures_import ON street_edge.street_edge_id = street_structures_import.street_edge_id
        WHERE street_structures_import.street_edge_id IS NULL
            AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config);
        IF unflagged_streets > 0 AND NOT $ALLOW_UNFLAGGED THEN
            RAISE EXCEPTION '% street(s) in this schema are not in the structures file.', unflagged_streets
                USING HINT = 'A file from another build? Rebuild (or re-export with --from-gpkg) and load that SQL, '
                             'or export without --structures after the nightly OSM way refresh. For streets added by '
                             'hand after the build, --allow-unflagged-streets reads them as not on a structure.';
        ELSIF unflagged_streets > 0 THEN
            RAISE NOTICE '% street(s) are not in the structures file and are taken as not on a structure.',
                unflagged_streets;
        END IF;
    END \$\$;
EOSQL
    STRUCTURE_JOIN="LEFT JOIN street_structures_import
            ON street_edge.street_edge_id = street_structures_import.street_edge_id"
    STRUCTURE_EXPR="COALESCE(street_structures_import.is_structure, FALSE)"
else
    STRUCTURE_JOIN="LEFT JOIN osm_way_street_edge ON street_edge.street_edge_id = osm_way_street_edge.street_edge_id
        LEFT JOIN osm_way ON osm_way_street_edge.osm_way_id = osm_way.osm_way_id"
    STRUCTURE_EXPR="(COALESCE(osm_way.tags ->> 'bridge', 'no') <> 'no'
                OR COALESCE(osm_way.tags ->> 'tunnel', 'no') <> 'no'
                OR COALESCE(osm_way.tags ->> 'covered', 'no') = 'yes')"
fi

cat >> "$SQL_FILE" <<EOSQL
    COPY (
        SELECT street_edge.street_edge_id,
               md5(ST_AsBinary(street_edge.geom)) AS geom_md5,
               $STRUCTURE_EXPR AS is_structure,
               ST_AsHEXEWKB(street_edge.geom) AS geom
        FROM street_edge
        $STRUCTURE_JOIN
        LEFT JOIN street_gradient ON street_edge.street_edge_id = street_gradient.street_edge_id
        WHERE street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
            AND ($EXPORT_ALL
                 OR street_gradient.street_edge_id IS NULL
                 OR street_gradient.geom_md5 <> md5(ST_AsBinary(street_edge.geom)))
        ORDER BY street_edge.street_edge_id
    ) TO STDOUT WITH (FORMAT csv, HEADER)
EOSQL

# -q keeps the command tags (CREATE TABLE, COPY n) off stdout, which is the CSV.
psql -q -v ON_ERROR_STOP=1 -d sidewalk -U "$SCHEMA_NAME" -f "$SQL_FILE" > "$TMP_FILE"
mv "$TMP_FILE" "$OUT_FILE"

echo "Done! Wrote $(($(wc -l < "$OUT_FILE") - 1)) street(s) to $OUT_FILE. Next: make street-gradient id=$CITY_ID"
