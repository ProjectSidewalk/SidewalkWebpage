#!/usr/bin/env bash
# Fetch the geometry of every OSM way DC's legacy street_edge_parent_edge names (issue #4700), so patches/25.pre.sql
# can pick one way per street by overlap. The modern osm_way_street_edge allows one way per street (338 makes it
# UNIQUE) while ~2,900 legacy DC streets were stitched from several ways, and the legacy database kept only the ids.
#
# Usage: ./fetch-osm-ways.sh [--from DB]      (default sidewalk_dc; read-only against it)
#
# Writes /tmp/dc-events/osm_ways.csv (osm_way_id, WKT) in the db container; a way OSM has since deleted has no row.
set -euo pipefail
CONTAINER=${DC_CONTAINER:-projectsidewalk-db}
FROM=sidewalk_dc
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
OUT=$(mktemp -d)
# Sixteen legacy rows name another street as the parent; its own parents are the ways, so follow one hop.
docker exec -e PGOPTIONS="-c search_path=sidewalk,public" "$CONTAINER" psql -U sidewalk -d "$FROM" -Atc "
  SELECT DISTINCT COALESCE(p2.parent_edge_id, p.parent_edge_id)
  FROM street_edge_parent_edge p
  LEFT JOIN street_edge_parent_edge p2 ON p.parent_edge_id IN (SELECT street_edge_id FROM street_edge)
    AND p2.street_edge_id = p.parent_edge_id
  WHERE COALESCE(p2.parent_edge_id, p.parent_edge_id) NOT IN (SELECT street_edge_id FROM street_edge)
  ORDER BY 1" > "$OUT/ids.txt"
echo "== $(wc -l < "$OUT/ids.txt") way ids"
python3 - "$OUT/ids.txt" "$OUT/osm_ways.csv" <<'PY'
import csv, json, sys, time, urllib.parse, urllib.request
ids = [l.strip() for l in open(sys.argv[1]) if l.strip()]
w = csv.writer(open(sys.argv[2], 'w', newline=''))
w.writerow(['osm_way_id', 'wkt'])
got = 0
for i in range(0, len(ids), 400):
    chunk = ids[i:i + 400]
    q = f"[out:json][timeout:120];way(id:{','.join(chunk)});out geom;"
    for attempt in range(5):
        try:
            # Overpass answers urllib's default User-Agent with 406.
            req = urllib.request.Request('https://overpass-api.de/api/interpreter',
                                         data=urllib.parse.urlencode({'data': q}).encode(),
                                         headers={'User-Agent': 'ProjectSidewalk-dc-migration/1.0'})
            d = json.load(urllib.request.urlopen(req, timeout=180))
            break
        except Exception as e:  # Overpass rate-limits bursts with 429/504; back off and retry.
            print(f'chunk {i}: {e}, retrying', file=sys.stderr); time.sleep(15 * (attempt + 1))
    else:
        sys.exit(f'chunk {i} failed')
    for e in d['elements']:
        g = e.get('geometry') or []
        if len(g) < 2: continue
        w.writerow([e['id'], 'LINESTRING(' + ','.join(f"{p['lon']} {p['lat']}" for p in g) + ')'])
        got += 1
    print(f'== {i + len(chunk)}/{len(ids)} ids, {got} geometries', file=sys.stderr)
    time.sleep(3)
PY
docker exec "$CONTAINER" mkdir -p /tmp/dc-events
docker cp "$OUT/osm_ways.csv" "$CONTAINER:/tmp/dc-events/osm_ways.csv"
docker exec "$CONTAINER" ls -la /tmp/dc-events/osm_ways.csv
rm -rf "$OUT"
