#!/usr/bin/env bash
# Exports each dev city's open streets for the #5526 replay benchmark (see README.md), one JSON file per city:
# data/<city>.json = [{id, regionId, coords, priority, lengthM}], sorted by id, which is approximately the
# order the server returns tasks in (selectTasksInARegion has no ORDER BY, so ties in the replayed rule may differ).
#
# Read-only (readonly_user). The street set mirrors StreetEdgeTable.streets: status 'open', in a region that isn't
# deleted, and never the tutorial street.
#
# Usage: tools/experiments/5526-mission-walk-planner/export.sh [city ...]   (default: seattle teaneck richmond)
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p data
cities=("$@")
[ ${#cities[@]} -eq 0 ] && cities=(seattle teaneck richmond)

for city in "${cities[@]}"; do
  docker exec projectsidewalk-db psql -U readonly_user -d sidewalk -Atq -c "
    SET search_path = sidewalk_${city}, public;
    SELECT COALESCE(json_agg(json_build_object(
             'id', se.street_edge_id,
             'regionId', ser.region_id,
             'coords', (ST_AsGeoJSON(se.geom, 7)::json)->'coordinates',
             'priority', sep.priority,
             'lengthM', round(ST_Length(se.geom::geography)::numeric, 2)
           ) ORDER BY se.street_edge_id), '[]'::json)
    FROM street_edge se
    JOIN street_edge_region ser ON ser.street_edge_id = se.street_edge_id
    JOIN region ON region.region_id = ser.region_id
    JOIN street_edge_priority sep ON sep.street_edge_id = se.street_edge_id
    WHERE se.status = 'open'
      AND NOT region.deleted
      AND se.street_edge_id NOT IN (
        SELECT tutorial_street_edge_id FROM config WHERE tutorial_street_edge_id IS NOT NULL
      );
  " > "data/${city}.json"
  echo "${city}: $(node -e "console.log(require('./data/${city}.json').length)") streets -> data/${city}.json"
done
