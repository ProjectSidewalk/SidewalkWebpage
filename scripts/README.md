# Python utility scripts

Three standalone Python utilities for Project Sidewalk. They are **not** part of the running web app's request path
(except as noted below) — they are run out-of-band. `check_streets_for_imagery.py` and `onboard_city.py` resolve their
data/output paths relative to the repo root, so they can be launched from any working directory. Unit tests for all
three live in [`test/python/`](../test/python).

## Which interpreter to use

The web container ships **two** Pythons, mirroring prod (makelab1 runs the app on the OS's Python; user accounts have
a current one):

| Script | Interpreter | Dependencies |
| --- | --- | --- |
| `label_clustering.py` | `python3` (3.8) | [`requirements.txt`](../requirements.txt) |
| `check_streets_for_imagery.py` | `python3.13` | [`requirements-offline-tools.txt`](../requirements-offline-tools.txt) |
| `onboard_city.py` | `python3.13` | [`requirements-offline-tools.txt`](../requirements-offline-tools.txt) |

`label_clustering.py` is shelled out to by the running app, so it must work on whatever `python3` the server has —
currently 3.8, which is EOL (#4396). Offline tooling has no such tie and runs on `python3.13`; host-side, ≥ 3.11.

## `label_clustering.py`

Clusters a region's accessibility labels by type and posts the results back to the app.

This one **is** invoked in-band: `ClusterService.runMultiUserClustering`
([`app/service/ClusterService.scala`](../app/service/ClusterService.scala)) shells out to it once per
region when an admin triggers clustering at `/runClustering` (and on the nightly `ClusteringActor` schedule). The script GETs the region's labels from
`/labelsToClusterInRegion`, clusters each label type independently (complete-linkage hierarchical clustering over
haversine distance, with per-type distance thresholds; labels from the same user+pano are never clustered together),
makes the cluster ids globally unique, and POSTs the labels, clusters, and thresholds back to `/clusteringResults`.

```bash
INTERNAL_API_KEY=<internal-api-key> python3 scripts/label_clustering.py --region_id <id> [--debug]
```

- `INTERNAL_API_KEY` (env) — the internal API key, sent as an `Authorization: Bearer` header (kept off the command
  line so it can't leak into `ps`/access logs). The app passes `config.get[String]("internal-api-key")`.
- `--region_id` — the region whose labels to cluster.
- `--debug` — print per-type cluster counts and coordinate-cleaning stats.
- `SIDEWALK_HTTP_PORT` (env) — app port, defaults to `9000`.

Because this one runs in-band, the deployed app has to be able to both **find** and **run** it: `scripts/` is bundled
into the staged package via `Universal / mappings` in [`build.sbt`](../build.sbt) and `ClusterService` resolves it
against the app root (not the process working directory), and its [`requirements.txt`](../requirements.txt)
dependencies must be installed in the `python3` interpreter the app shells out to.

## `check_streets_for_imagery.py`

Finds streets lacking street-view imagery (Google Street View or Mapillary) and writes them to a CSV. Standalone and
manual — nothing in the app calls it.

1. Export a CSV of the `street_edge` table with columns `street_edge_id, region_id, x1, y1, x2, y2, geom` (geom as WKB
   hex), named `street_edge_endpoints_<city-id>.csv`, in the repo root. Every data file carries the city id, so scans
   for different cities can't collide or resume each other's checkpoints.
2. Run **one** of (from any directory — paths resolve relative to the repo root):
   ```bash
   python3.13 scripts/check_streets_for_imagery.py --city-id newport-ky --gsv         # needs GOOGLE_MAPS_API_KEY
   python3.13 scripts/check_streets_for_imagery.py --city-id newport-ky --mapillary   # needs MAPILLARY_ACCESS_TOKEN
   ```
   It checks each street's endpoints first, then samples points along the street, and flags streets where enough points
   lack imagery. It writes streets without imagery to `db/streets_with_no_imagery_<city-id>.csv`, and a per-street
   imagery summary (presence + capture-date range) to `db/street_imagery_summary_<city-id>.csv`.
3. Run `make hide-streets-without-imagery` to mark those streets in the database.

Optional flags: `--workers N` (streets checked concurrently, default 8) and `--max-qps F` (global cap on requests per
second across all workers, default 10 — deliberately conservative; Google allows ~500/s).

### Imagery age

The GSV metadata responses we already fetch also carry an imagery capture `date`, so — for **no extra API calls** — the
scan records each street's capture-date range (oldest/newest) and pano count into `db/street_imagery_summary_<city-id>.csv`
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
  the failed set is retried once at the end, and any still-failing streets are written to
  `db/failed_streets_<city-id>.csv`.
- **Resume:** progress is checkpointed per street to `db/streets_imagery_checkpoint_<city-id>.csv`, so a re-run resumes
  where it left off and re-attempts only failed/unprocessed streets — and since every file carries the city id, a
  leftover checkpoint from another city can never be resumed by mistake. The final no-imagery CSV is derived from
  the checkpoint at the end — its schema is unchanged, so `make hide-streets-without-imagery` is unaffected.
- **Progress:** a `tqdm` progress bar (count, %, rate, and ETA) renders to stderr as streets complete. It tracks the
  whole city and is seeded with already-settled streets, so a resumed run picks up at its prior percentage rather than
  restarting at 0%. It auto-suppresses when stderr isn't a terminal, so redirected/CI logs stay clean.

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
  see them), run `make import-street-imagery` to ingest `db/street_imagery_summary_<city-id>.csv` — the per-street summary the
  scan writes. Rows are tagged `data_source = 'imagery_scan'`, and a scan
  supersedes an existing `pano_data` row for the same street (it's a deliberate, fresher measurement).

## `onboard_city.py`

Builds a new city's street + region staging data (`qgis_road`/`qgis_region`, consumed by
`db/scripts/fill-new-schema.sh`) from open data sources — the automated replacement for the manual QGIS onboarding
pipeline (#4291). Standalone and manual; it never writes to the database.

```bash
docker exec projectsidewalk-web sh -c "cd /home && python3.13 scripts/onboard_city.py \
    --place 'Newport, Kentucky, USA' --city-id newport-ky"
```

`--city-id` is the id the deployment will eventually use in `conf/cityparams.conf` (`SIDEWALK_CITY_ID`), so later
config steps can consume it directly; the suggested schema name / `DATABASE_USER` swaps its hyphens for underscores
(`sidewalk_newport_ky` — new cities keep the full city id there, unlike older hand-trimmed schemas like
`sidewalk_newport`).

Streets come from OSM (osmnx, the wiki's highway filter, `--include-alleys` for `service=alley`). Regions come from
the first source that works: `--regions-file` (bring your own; must carry a `name` column), OSM neighborhood polygons (auto-rejected under 75%
city coverage), US census tracts (TIGERweb), or the city boundary as a single region. Streets are split at region
boundaries, then healed so boundary-riding streets aren't shredded or truncated: fragments under `--heal-segment-m`
are reabsorbed, out-of-coverage gaps/ends riding within `--boundary-merge-tol-m` of the covered area are restored
(streets may poke slightly outside the city), and boundary-running splits are merged (`rider_merges` QA layer).

Outputs land in `db/onboarding/<city-id>/` (git-ignored; visible in the db container under `/opt`): a QA GeoPackage
to eyeball in QGIS, the `qgis_tables.sql` load file, and a Markdown report with per-region stats and flags
(SPARSE/OVERSIZED/EMPTY). The QA loop: rerun with tweaked flags — including
`--merge-regions "Census Tract 513:Census Tract 523.01"` (region *names*) to fold flagged regions into neighbors;
structural region changes always go through a full rerun so streets re-split and re-heal against the merged
boundaries and region ids stay dense. For surgical fixes, hand-edit the GeoPackage layers in QGIS and regenerate the
SQL with `--from-gpkg <path>` (validates the edited layers first).

Once the GeoPackage passes QA, `make onboard-city id=<city-id>` (host-side, `tools/setup_new_city.py`) chains the
rest of the setup: config registration, schema creation, evolutions, the staging load, the fill, and the
`check_streets_for_imagery.py` scan + no-imagery street hiding + imagery-age import — see
[`db/scripts/README.md`](../db/scripts/README.md) → "Standing up a brand-new city".

## Testing

```bash
make test-python          # both halves, in the web container
make test-python-app      # just label_clustering.py, on python3 (3.8)
make test-python-tools    # just the offline tooling, on python3.13
```

See [`test/python/README.md`](../test/python/README.md) for details and CI status.
