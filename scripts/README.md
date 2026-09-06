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

Finds streets lacking street-view imagery (Google Street View, Mapillary, Panoramax, or Infra3d) and writes them to a
CSV.
Standalone and manual — nothing in the app calls it.

1. Export a CSV of the `street_edge` table with columns `street_edge_id, region_id, x1, y1, x2, y2, geom` (geom as WKB
   hex) to `db/onboarding/<city-id>/street_edge_endpoints.csv`. Every scan file lives in that per-city dir, so scans
   for different cities can't collide or resume each other's checkpoints.
2. Run **one** of (from any directory — paths resolve relative to the repo root):
   ```bash
   python3.13 scripts/check_streets_for_imagery.py --city-id newport-ky --gsv         # needs GOOGLE_MAPS_API_KEY
   python3.13 scripts/check_streets_for_imagery.py --city-id newport-ky --mapillary   # needs MAPILLARY_ACCESS_TOKEN
   python3.13 scripts/check_streets_for_imagery.py --city-id newport-ky --infra3d     # needs INFRA3D_CLIENT_ID +
                                                                 # INFRA3D_CLIENT_SECRET; add --campaign <uid> if
                                                                 # the tenant has several
   python3.13 scripts/check_streets_for_imagery.py --city-id newport-ky --panoramax   # public API, no credential;
                                                                 # 360° pictures only
   ```
   It checks each street's endpoints first, then samples points along the street, and flags streets where enough points
   lack imagery. It writes streets without imagery to `streets_with_no_imagery.csv`, and a per-street imagery summary
   (presence + capture-date range) to `street_imagery_summary.csv`, both in the same dir.
3. Run `make hide-streets-without-imagery` to mark those streets in the database.

Optional flags: `--workers N` (streets checked concurrently, default 8) and `--max-qps F` (global cap on requests per
second across all workers, default 10 — deliberately conservative; Google allows ~500/s).

### Infra3d

Infra3d has no metadata endpoint, so `--infra3d` uses the nearest-frame query (`framegate`'s `knn/query`) that the
vendored viewer SDK issues on every `setLocation` — the same request a labeler's browser makes as they move — with the
same per-city OAuth client credentials the app uses (`PanoDataService.getInfra3dToken`). Export **one** city's pair as
`INFRA3D_CLIENT_ID` / `INFRA3D_CLIENT_SECRET` (in the web container they're `INFRA3D_CLIENT_ID_ZURICH`,
`..._WINTERTHUR`, etc.); the tenant to query comes from the token's own scope, so nothing else is per-city. Two things
differ from the other providers:

- The query returns the nearest frame **with no distance cap** (a point far outside the city still gets the city's
  closest frame), so "has imagery" is decided client-side: the nearest frame within the same 25 m (endpoints) / 15 m
  (along-street) radius GSV uses.
- Frames are filtered server-side to 360° types (`calotte`/`cubemap`), matching the viewer's `setFilter` — Infra3d
  datasets mix in flat mono/stereo photos that Explore can't label on, so a street with only flat frames counts as
  having no imagery.
- Frames are also restricted to a **campaign** (one drive). The viewer restricts every query to its project's
  campaigns (the `project_uid` hardcoded in `Infra3dViewer.js`), but our credentials can't read the project, so the
  scan lists the tenant's campaigns at startup instead: with one campaign (every city today) it's used automatically
  and printed; with several, the scan lists them and stops until you pass `--campaign <uid>` (repeatable). Without
  this, frames from any other drive in the tenant would count as imagery Explore can't actually reach.

The token lives 60 minutes and is refreshed automatically during a long scan. Infra3d publishes no rate limit; the
default `--max-qps 10` is in the range of a single busy browser session, so keep it there (or lower) rather than
raising it.

### Preflight (`--sample`)

```bash
make check-imagery id=laurens-ia args="--sample --gsv"          # 150 random streets; --sample 60 --seed 3 to vary
make check-imagery id=laurens-ia args="--sample --mapillary"
```

The same per-street verdict on a random sample, kept under `db/onboarding/<city-id>/preflight/<provider>/` so a full
scan's checkpoint is untouched, with every provider sampled so far summarized side by side in
`db/onboarding/<city-id>/preflight_report.md`: coverage, **failed** (a key or quota problem — GSV's
`OVER_QUERY_LIMIT` / `REQUEST_DENIED` now fail the street instead of counting as imagery), and the oldest / median /
newest of the covered streets' newest captures. Because `onboard_city.py` writes the endpoints CSV this reads, the
question "does this city have imagery, and how fresh?" is answered minutes after the build, before any database work.

### Imagery age

The GSV, Panoramax, and Infra3d responses we already fetch also carry an imagery capture date, so — for **no extra API
calls** — the scan records each street's capture-date range (oldest/newest) and pano count into
`street_imagery_summary.csv`
(`street_edge_id, region_id, has_imagery, oldest_capture, newest_capture, n_panos`). That tells us not just whether a
street has imagery but how old it is. Mapillary capture dates are a future enhancement. Persisting this into the
database — to power a "stale imagery" signal alongside the `street_edge_status` work (#3888) — is tracked as a
separate follow-up (#4348).

### Resilience & resume

The scan is built to survive a flaky network over a long run, and to scan a whole city in reasonable time:

- **Concurrency:** streets are checked in parallel (thread pool), but a shared **token-bucket rate limiter** caps total
  requests/second (`--max-qps`) so we stay well under the provider limit regardless of worker count. Each worker keeps
  the sequential endpoint→points early-exit, so concurrency doesn't inflate the number of API calls.
- **Retry:** each request is retried with exponential backoff + jitter (`tenacity`) before giving up.
- **Fail-soft:** a street that still errors is logged and the scan **continues** (it no longer aborts the whole run);
  the failed set is retried once at the end, and any still-failing streets are written to `failed_streets.csv`.
- **Resume:** progress is checkpointed per street to `streets_imagery_checkpoint.csv`, so a re-run resumes where it
  left off and re-attempts only failed/unprocessed streets — and since every city's files live in its own dir, a
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
- **Providers — GSV, Mapillary, *and* Infra3d.** GSV Tracker is GSV-only.

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
  see them), run `make import-street-imagery` to ingest `db/onboarding/<city-id>/street_imagery_summary.csv` — the
  per-street summary the scan writes. Rows are tagged `data_source = 'imagery_scan'`, and a scan
  supersedes an existing `pano_data` row for the same street (it's a deliberate, fresher measurement).

## `onboard_city.py`

Builds a new city's street + region staging data (`qgis_road`/`qgis_region`, consumed by
`db/scripts/fill-new-schema.sh`) from open data sources — the headless replacement for the QGIS onboarding runbook
(#4291). Standalone and manual; it never writes to the database. The full workflow around it, including the QGIS QA
loop and the imagery preflight, is [`docs/onboarding-a-city.md`](../docs/onboarding-a-city.md).

```bash
make build-city-data id=laurens-ia args="--place 'Laurens, Iowa, USA'"
make build-city-data id=bayonne args="--boundary-file city.geojson --regions-file quartiers.geojson \
    --region-name-col nom --regions-source 'https://…'"
```

`--city-id` is the id the deployment will use in `conf/cityparams.conf` (`SIDEWALK_CITY_ID`); the schema /
`DATABASE_USER` swaps its hyphens for underscores (`sidewalk_laurens_ia` — new cities keep the full city id).

Streets come from OSM (osmnx, the runbook's highway filter minus `area=yes` plazas, `--include-alleys` for
`service=alley`), noded only where included ways meet. Then the #4717 anti-tiny-segment rules: pieces under
`--merge-tiny-m` (20 m) left between close intersections merge back into a touching piece of the same OSM way (never
closing a ring); region-boundary fragments under `--heal-segment-m` are reabsorbed; boundary-running splits are merged
(`rider_merges` QA layer); truncated ends riding within `--boundary-merge-tol-m` of the covered area are restored.
osmnx joins consecutive OSM ways between intersections into one edge, so a street lists every way it spans in
`osm_ids` (the fill records the first in `osm_way_street_edge`, which is one row per street). Regions come from the
first source that works: `--regions-file` (any OGR format/CRS; `--region-name-col` names its name column, and
`--regions-source` records the provenance in `region.data_source`), OSM neighbourhood polygons (auto-rejected under
75% city coverage), US census tracts (TIGERweb), or the city boundary as a single region.

Outputs land in `db/onboarding/<city-id>/` (git-ignored; visible to the db container at `/opt/onboarding/` when run
from the main checkout): the QA GeoPackage, `qgis_tables.sql`, `street_edge_endpoints.csv` (the scan's input, so the
preflight below runs before any database exists), and `report.md` with the tiny-segment histogram (production
averages 18% of streets under 20 m; Bayonne rebuilt at 4%), per-region km with `SPARSE`/`OVERSIZED`/`EMPTY` flags,
region-name warnings (#4620), and boundary coverage. The QA loop: rerun with tweaked flags — `--merge-regions
"Census Tract 513:Census Tract 523.01"` folds regions by *name* and re-splits the streets against the merged
boundaries — or hand-edit the GeoPackage in QGIS and regenerate the SQL with `make build-city-data id=<city-id>
args="--from-gpkg"`, which validates the layers first (a hand-built layer with a single `osm_id` column is accepted).

## Testing

```bash
make test-python          # both halves, in the web container
make test-python-app      # just label_clustering.py, on python3 (3.8)
make test-python-tools    # just the offline tooling, on python3.13
```

See [`test/python/README.md`](../test/python/README.md) for details and CI status.
