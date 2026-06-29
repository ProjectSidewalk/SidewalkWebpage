# Python utility scripts

Two standalone Python utilities for Project Sidewalk. They are **not** part of the running web app's request path
(except as noted below) — they are run out-of-band. Their runtime dependencies are pinned in
[`requirements.txt`](../requirements.txt) and installed into the web Docker container; unit tests live in
[`test/python/`](../test/python). **Always run them from the repo root** — paths are resolved relative to the current
working directory.

## `label_clustering.py`

Clusters a region's accessibility labels by type and posts the results back to the app.

This one **is** invoked in-band: `ClusterController.runMultiUserClustering`
([`app/controllers/ClusterController.scala`](../app/controllers/ClusterController.scala)) shells out to it once per
region when an admin triggers clustering at `/runClustering`. The script GETs the region's labels from
`/labelsToClusterInRegion`, clusters each label type independently (complete-linkage hierarchical clustering over
haversine distance, with per-type distance thresholds; labels from the same user+pano are never clustered together),
makes the cluster ids globally unique, and POSTs the labels, clusters, and thresholds back to `/clusteringResults`.

```bash
python3 scripts/label_clustering.py --key <internal-api-key> --region_id <id> [--debug]
```

- `--key` — the internal API key (the app passes `config.get[String]("internal-api-key")`).
- `--region_id` — the region whose labels to cluster.
- `--debug` — print per-type cluster counts and coordinate-cleaning stats.
- `SIDEWALK_HTTP_PORT` (env) — app port, defaults to `9000`.

## `check_streets_for_imagery.py`

Finds streets lacking street-view imagery (Google Street View or Mapillary) and writes them to a CSV. Standalone and
manual — nothing in the app calls it.

1. Export a CSV of the `street_edge` table with columns `street_edge_id, region_id, x1, y1, x2, y2, geom` (geom as WKB
   hex), named `street_edge_endpoints.csv`, in the repo root.
2. From the repo root, run **one** of:
   ```bash
   python3 scripts/check_streets_for_imagery.py --gsv         # needs GOOGLE_MAPS_API_KEY
   python3 scripts/check_streets_for_imagery.py --mapillary   # needs MAPILLARY_ACCESS_TOKEN
   ```
   It checks each street's endpoints first, then samples points along the street, and flags streets where enough points
   lack imagery. It writes results to `db/streets_with_no_imagery.csv` and is **resumable** (re-running continues from
   the last row of that file).
3. Run `make hide-streets-without-imagery` to mark those streets in the database.

### Known bugs (tracked in issue #4342)

Two bugs are documented but intentionally left for a separate fix so the quality refactor stayed behavior-preserving:

- The **first Mapillary endpoint** is checked with a 25 km bounding box instead of 25 m (the second endpoint correctly
  uses 25 m). This over-large box can falsely report imagery present.
- `write_output` contains a no-op bare `print` (should be `print()`), so an intended progress newline is dropped.

## Testing

```bash
make test-python          # runs pytest in the web container
```

See [`test/python/README.md`](../test/python/README.md) for details and CI status.
