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
   lack imagery. It writes streets without imagery to `db/streets_with_no_imagery.csv`, and a per-street imagery
   summary (presence + capture-date range) to `db/street_imagery_summary.csv`.
3. Run `make hide-streets-without-imagery` to mark those streets in the database.

Optional flags: `--workers N` (streets checked concurrently, default 8) and `--max-qps F` (global cap on requests per
second across all workers, default 10 — deliberately conservative; Google allows ~500/s).

### Imagery age

The GSV metadata responses we already fetch also carry an imagery capture `date`, so — for **no extra API calls** — the
scan records each street's capture-date range (oldest/newest) and pano count into `db/street_imagery_summary.csv`
(`street_edge_id, region_id, has_imagery, oldest_capture, newest_capture, n_panos`). That tells us not just whether a
street has imagery but how old it is. Mapillary capture dates are a future enhancement (GSV only for now). Persisting
this into the database — to power a "stale imagery" signal alongside the `street_edge_status` work (#3888) — is tracked
as a separate follow-up (#4348).

### Resilience & resume

The scan is built to survive a flaky network over a long run, and to scan a whole city in reasonable time:

- **Concurrency:** streets are checked in parallel (thread pool), but a shared **token-bucket rate limiter** caps total
  requests/second (`--max-qps`) so we stay well under the provider limit regardless of worker count. Each worker keeps
  the sequential endpoint→points early-exit, so concurrency doesn't inflate the number of API calls.
- **Retry:** each request is retried with exponential backoff + jitter (`tenacity`) before giving up.
- **Fail-soft:** a street that still errors is logged and the scan **continues** (it no longer aborts the whole run);
  the failed set is retried once at the end, and any still-failing streets are written to `db/failed_streets.csv`.
- **Resume:** progress is checkpointed per street to `db/streets_imagery_checkpoint.csv`, so a re-run resumes where it
  left off and re-attempts only failed/unprocessed streets. The final `db/streets_with_no_imagery.csv` is derived from
  the checkpoint at the end — its schema is unchanged, so `make hide-streets-without-imagery` is unaffected.

(The earlier bbox-radius unit bug and the no-op `print` — issue #4342 — are fixed as part of this.)

### Design lineage (and why it differs from GSV Tracker)

The resilience and concurrency above are adapted from Jon Froehlich's [GSV Tracker](https://github.com/jonfroehlich/gsv-tracker)
— its retry/backoff, fail-soft "log-and-continue", resumable progress, and rate-aware concurrent fetching. We diverge
from it on purpose, because the two tools answer different questions:

- **Sampling — street-following, not a grid.** GSV Tracker samples a uniform geographic *grid* to measure area-wide
  coverage and *temporal* patterns. Here the question is per-street ("does this `street_edge` have usable imagery?"), so
  we follow each street's geometry with early-exit: far fewer API calls than gridding a whole city, and results map
  directly to a `street_edge` (no spatial join).
- **Concurrency — conservative threads, not async.** GSV Tracker uses `asyncio`/`aiohttp` tuned for maximum throughput
  (toward Google's ~500 req/s ceiling). We use a small thread pool + a token-bucket QPS cap and deliberately stay well
  under the limit; at that bounded concurrency, threads are simpler and sufficient and async's scale benefit is wasted.
- **Providers — GSV *and* Mapillary.** GSV Tracker is GSV-only.

## Persisting imagery age to the database (#4348)

The `street_imagery` table records, per street, the capture-date range of the panos observed on it (`oldest_capture`,
`newest_capture`, `n_panos`) so the app can flag streets whose imagery is stale — complementing `street_edge_status`
(#3888), which only says *whether* a street has imagery. The table has two feeders, distinguished by its `data_source`
column:

- **Feeder 1 — `pano_data` (automatic).** Evolution `326.sql` creates the table and backfills it from `pano_data`
  (joined to streets via `label`, which carries both `pano_id` and `street_edge_id`). This runs per-city on deploy at
  zero API cost and covers every **audited** street, including Mapillary/Infra3d panos. Rows are tagged
  `data_source = 'pano_data'`.
- **Feeder 2 — the imagery scan (manual).** For streets a scan reached but that have no labels yet (so Feeder 1 can't
  see them), run `make import-street-imagery` to ingest `db/street_imagery_summary.csv` — the per-street summary the
  scan writes. Rows are tagged `data_source = 'imagery_scan'`, and a scan
  supersedes an existing `pano_data` row for the same street (it's a deliberate, fresher measurement).

## Testing

```bash
make test-python          # runs pytest in the web container
```

See [`test/python/README.md`](../test/python/README.md) for details and CI status.
