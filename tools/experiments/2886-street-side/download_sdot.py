"""Page every feature of an SDOT FeatureServer layer to GeoJSON (WGS84)."""
import json, sys, time, urllib.request, urllib.parse
BASE = "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/{svc}/FeatureServer/0/query"
def fetch(svc, out):
    feats, offset, page = [], 0, 2000
    while True:
        q = urllib.parse.urlencode({"where": "1=1", "outFields": "*", "outSR": 4326, "f": "geojson",
                                    "resultOffset": offset, "resultRecordCount": page})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(BASE.format(svc=svc) + "?" + q, timeout=120) as r:
                    d = json.load(r)
                break
            except Exception as e:
                print(svc, offset, "retry", attempt, e, file=sys.stderr); time.sleep(3)
        else:
            raise SystemExit(f"{svc}: gave up at offset {offset}")
        got = d.get("features", [])
        feats.extend(got)
        print(svc, offset, len(got), file=sys.stderr)
        if not d.get("properties", {}).get("exceededTransferLimit") and len(got) < page:
            break
        if not got:
            break
        offset += len(got)
    with open(out, "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f)
    print(svc, "total", len(feats))
for svc, out in [("Sidewalks_CDL", "sidewalks.geojson"), ("Curb_Ramps_CDL", "curb_ramps.geojson"),
                 ("Seattle_Streets_1", "streets.geojson")]:
    fetch(svc, f"{sys.argv[1]}/{out}")
