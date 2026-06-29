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
   lack imagery. It writes results to `db/streets_with_no_imagery.csv`.
3. Run `make hide-streets-without-imagery` to mark those streets in the database.

### Resilience & resume

The scan is built to survive a flaky network over a long run:

- **Retry:** each request is retried with exponential backoff + jitter (`tenacity`) before giving up.
- **Fail-soft:** a street that still errors is logged and the scan **continues** (it no longer aborts the whole run);
  the failed set is retried once at the end, and any still-failing streets are written to `db/failed_streets.csv`.
- **Resume:** progress is checkpointed per street to `db/streets_imagery_checkpoint.csv`, so a re-run resumes where it
  left off and re-attempts only failed/unprocessed streets. The final `db/streets_with_no_imagery.csv` is derived from
  the checkpoint at the end — its schema is unchanged, so `make hide-streets-without-imagery` is unaffected.

(The earlier bbox-radius unit bug and the no-op `print` — issue #4342 — are fixed as part of this.)

## Testing

```bash
make test-python          # runs pytest in the web container
```

See [`test/python/README.md`](../test/python/README.md) for details and CI status.
