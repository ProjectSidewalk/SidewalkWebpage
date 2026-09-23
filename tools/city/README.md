# City tools

Scripts that build, check or update one city's data. They run on `python3.13` with
[`requirements-offline-tools.txt`](../../requirements-offline-tools.txt) (host-side, >= 3.11) and resolve their paths
relative to the repo root, so they can be launched from any working directory. Unit tests live in
[`test/python/`](../../test/python).

| Script | Run with | What it does |
| --- | --- | --- |
| `onboard_city.py` | `make build-city-data` | Builds a new city's street/region staging data from open sources |
| `check_streets_for_imagery.py` | `make check-imagery` | Imagery preflight or full scan of a city's streets |
| `setup_new_city.py` | `make onboard-city` | Chains the rest of a new city's setup: configs, GA, schema, fill, scan, dump |
| `create_ga_properties.py` | `make onboard-city`, or by hand | Creates a city's Google Analytics properties |
| `maps_key_referrers.py` | `make onboard-city`, or by hand | Adds a city's hostnames to the Maps key's referrer list |
| `street_gradient.py` | `make street-gradient` | Samples an elevation model along every street |

The whole new-city sequence is [`docs/onboarding-a-city.md`](../../docs/onboarding-a-city.md); `setup_new_city.py`,
`create_ga_properties.py` and `maps_key_referrers.py` are documented in their headers.

## `check_streets_for_imagery.py`

Finds streets lacking street-view imagery (Google Street View, Mapillary, Panoramax, or Infra3d) and writes them to a
CSV.
Standalone and manual — nothing in the app calls it.

1. Export a CSV of the `street_edge` table with columns `street_edge_id, region_id, x1, y1, x2, y2, geom` (geom as WKB
   hex) to `db/onboarding/<city-id>/street_edge_endpoints.csv`. Every scan file lives in that per-city dir, so scans
   for different cities can't collide or resume each other's checkpoints.
2. Run **one** of (from any directory — paths resolve relative to the repo root):
   ```bash
   python3.13 tools/city/check_streets_for_imagery.py --city-id newport-ky --gsv         # needs GOOGLE_MAPS_API_KEY
   python3.13 tools/city/check_streets_for_imagery.py --city-id newport-ky --mapillary   # needs MAPILLARY_ACCESS_TOKEN
   python3.13 tools/city/check_streets_for_imagery.py --city-id newport-ky --infra3d     # needs INFRA3D_CLIENT_ID +
                                                                 # INFRA3D_CLIENT_SECRET; add --campaign <uid> if
                                                                 # the tenant has several
   python3.13 tools/city/check_streets_for_imagery.py --city-id newport-ky --panoramax   # public API, no credential;
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
  closest frame), so "has imagery" is decided client-side: the nearest frame within the same 25 m radius GSV uses.
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
A rerun with the same `N` and `--seed` resumes the sample; a different sample replaces that provider's row rather than
accumulating into it.

### Imagery age

The responses we already fetch also carry an imagery capture date, so — for **no extra API calls** — the scan records
each street's capture-date range (oldest/newest) and pano count into `street_imagery_summary.csv` (`street_edge_id,
region_id, has_imagery, oldest_capture, newest_capture, n_panos, max_cross_track_m, cross_track_limit_m`). That tells us
not just whether a street has imagery but how old it is. GSV and Infra3d each answer with a single pano, so its date is
the one recorded.
Mapillary instead returns every image in the queried box, and the date recorded belongs to the image Explore would
actually display: `score_pano` ports the viewer's ranking (distance, resolution, recency), reading its weights from
`conf/pano-scoring.json` so the two can't drift. Recording the *newest* image instead would let a street look freshly
imaged while the viewer went on serving older panos (#4411). Persisting this into the database — to power a "stale
imagery" signal alongside the `street_edge_status` work (#3888) — is tracked as a separate follow-up (#4348).

### Search radius, and how far off the street a pano sits

Every sampled point — street endpoints and the points between them alike — is queried at **25 m**, the radius Explore
searches (`svl.STREETVIEW_MAX_DISTANCE`). Matching it is what makes the hide list mean "Explore has no imagery of this
street"; and the radius has to clear each provider's capture interval anyway, or the box can straddle a gap and report
no imagery where there is some. Mapillary's smart spacing targets 20 m on highways, and 12.6% of Budapest's
consecutive captures exceed 20 m.

A circle is not quite the right shape for the job, though: it has to be generous *along* the street to clear that
interval, but everything it also reaches *across* the street is a chance to accept a pano belonging to an adjacent
carriageway, alley or frontage road — imagery of a different street. So a GSV pano has to pass two tests before it
counts toward a street's verdict:

- **Along the street:** GSV's `radius` parameter is a search hint, not a bound. A 25 m query has returned a pano 77 m
  away, and in Seattle a user photosphere in another state (#5114); a 15 m scan accepted the same far panos. So the
  scan checks the position each GSV response reports, and treats a pano as no imagery at that point when it lies
  beyond the search radius of both the query point and the street's own centerline. The street half matters: a pano
  more than 25 m further down the same street is still imagery of it, and a point-only check hid six Teaneck streets
  that way. Explore's viewer makes the point half of that check (#5114) and gets the street half from sampling the
  street every 10 m, so the two agree on which panos count as imagery at a point. Their street-level verdicts still
  differ: the scan weighs endpoints and a failure fraction, while Explore needs only one point along the street to
  work. Mapillary and Panoramax already filter to the box server-side, and Infra3d applies its radius client-side.
- **Across the street:** the pano must sit within `--max-cross-track-m` (default **15 m**) of the centerline. The
  one exception is the answer to either of the street's two endpoint queries: it also counts if the pano lies within
  **25 m** of an endpoint. An endpoint is an intersection, and the nearest pano to one is often up the crossing street.
  The allowance is a disc around each endpoint, and only the endpoint queries get it: every point between them is held
  to the limit, however near an end its pano is. Explore does not apply this test; it is the scan's alone.

Every distance is measured from the street's stored centerline. The walk samples points from a resampled copy, whose
straight chords cut the corners of a bend.

Both numbers were measured, not picked (#5091). They come from the panos each street's walk actually visited, recorded
with `--point-log` (below):

| | Teaneck (2,172 streets) | Seattle (27,645 streets) |
| --- | --- | --- |
| panos measured (mid-street / endpoint answers) | 8,435 / 4,311 | 111,804 / 54,830 |
| mid-street offset p50 / p99 / p99.9 | 1.4 / 6.6 / 14.7 m | 0.8 / 5.4 / 14.8 m |
| widest arterials, mid-street | trunk, max 11.8 m | primary p99.9 13.9 m, secondary 13.0 m |
| endpoint answers > 15 m off, within 25 m of an endpoint | 21 of 21 | 123 of 125 |
| streets hidden, no limit | 26 | 287 |
| more hidden at 10 / 12 / **15** / 18 / 20 m | 3 / 2 / **1** / 1 / 0 | 27 / 20 / **15** / 9 / 6 |
| … at 15 m without the endpoint allowance | 9 | 49 |

- **Below 15 m**, the limit starts cutting into lane offsets on wide arterials.
- **Beyond 15 m**, most of what it rejects is a pano of another roadway. Teaneck's one extra hidden street, 834, is
  seen mid-street only from panos 1–2 m from the parallel street 833. Twelve of Seattle's fifteen are seen mid-street
  only from panos on another street 0.4–1.7 m away, or on an alley the street network leaves out. Two are downtown
  primary streets with complex carriageways, and one (1109) has its crossing-street pano 25.9 m from the endpoint,
  just outside the disc.
- **The allowance's cost:** a street short enough to have no sampled point between its endpoints (400 in Teaneck, 3,615
  in Seattle, mostly under about 15 m) is judged by its endpoint answers alone, so for it the limit is in effect the
  25 m disc.

The limit applies to GSV only. It was measured on Google's car-mounted captures, and a GSV response is the one pano
the viewer would open. Mapillary and Panoramax are also captured on foot and by bike, off the roadway, so a car's
limit would reject their sidewalk captures. For Mapillary, holding the viewer's pick (`score_pano`) to the limit would
hide points that have an on-street runner-up, and filtering the candidates before scoring would record a date the
viewer never shows (#4411). Infra3d answers with its nearest frame as GSV does, but no Infra3d city has been measured.
`--point-log` works for every provider, so each one's limit can come from its own distribution. Passing
`--max-cross-track-m` with another provider is an error.

Each street's `max_cross_track_m` in the summary is the distance from its centerline to the farthest pano it saw,
counted or not, so a street hidden by the limit still shows why. Past either end of a street, that distance is to the
endpoint. The summary also records the `cross_track_limit_m` its verdict was reached under (0 for none).

`--search-radius-m` (whole metres) and `--max-cross-track-m` (`0` turns the limit off) are the knobs these
comparisons turn. Changing either one changes which streets count as having imagery. So every checkpoint row records
both, and the scan refuses to resume a checkpoint written with other values or by an older version of the scan. Give
each setting its own `--city-id` (and so its own `db/onboarding/<city-id>/` dir), or move that provider's
`streets_imagery_checkpoint_<provider>.csv` aside between runs, and `street_points_<provider>.csv` with it.

`--point-log` writes `street_points_<provider>.csv`, one row per point a street's walk visited. Each row records:
- whether the point was an endpoint query;
- the pano the provider answered;
- its distance from the query point (`point_distance_m`), from the centerline (`cross_track_m`) and, for an endpoint
  query, from the nearer endpoint;
- whether it `counted`;
- the radius and limit it was counted under.

That is the distribution the numbers above came from. The log follows the checkpoint:
- **A fresh scan** (no settled streets) starts the log empty.
- **A resumed scan** keeps only the rows of streets the checkpoint has settled. A street logged just before a crash,
  whose checkpoint row was never written, is rescanned and logged once.
- **The flag has to be on from a scan's first run.** A resume with `--point-log` into a scan that ran without it is
  refused, since the streets already settled were never logged.

Because every step of a street's walk is logged, a log from a run at a strict setting can be replayed at any looser one
without querying again. A replay gives the same verdict as a direct run (to within the 1 cm the log rounds distances
to, and given identical GSV answers) wherever the looser rule settles within the logged walk. That is how the table
above was built, with a targeted rescan of each street whose walk ended before the replay settled.

### Resilience & resume

The scan is built to survive a flaky network over a long run, and to scan a whole city in reasonable time:

- **Concurrency:** streets are checked in parallel (thread pool), but a shared **token-bucket rate limiter** caps total
  requests/second (`--max-qps`) so we stay well under the provider limit regardless of worker count. Each worker keeps
  the sequential endpoint→points early-exit, so concurrency doesn't inflate the number of API calls.
- **Retry:** each request is retried with exponential backoff + jitter (`tenacity`) before giving up.
- **Fail-soft:** a street that still errors is logged and the scan **continues** (it no longer aborts the whole run);
  the failed set is retried once at the end, and any still-failing streets are written to `failed_streets.csv`.
- **Resume:** progress is checkpointed per street to `streets_imagery_checkpoint_<provider>.csv`, so a re-run resumes
  where it left off and re-attempts only failed/unprocessed streets — and since every city's files live in its own dir
  and the checkpoint is per provider, a scan can never resume another city's or another provider's results:
  `--mapillary` after `--gsv` rescans and regenerates the output CSVs from the Mapillary checkpoint. The final
  no-imagery CSV is derived from the checkpoint at the end — its schema is unchanged, so
  `make hide-streets-without-imagery` is unaffected. `failed_streets.csv` is rewritten every run (empty when nothing
  failed), so a rerun with a fixed key clears it.
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
loop and the imagery preflight, is [`docs/onboarding-a-city.md`](../../docs/onboarding-a-city.md).

```bash
make build-city-data id=laurens-ia args="--place 'Laurens, Iowa, USA'"
make build-city-data id=bayonne-fr args="--boundary-file city.geojson --regions-file quartiers.geojson \
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
preflight below runs before any database exists), `street_structures.csv` (which streets are on a bridge, in a
tunnel or covered, from the OSM tags, with each street's geometry hash, so the street-gradient export can run before
the nightly `osm_way` cache exists and can refuse a file from another build; it rides in the GeoPackage too, so a
`--from-gpkg` re-export rewrites it), and `report.md` with the tiny-segment histogram (production
averages 18% of streets under 20 m; Bayonne rebuilt at 4%), per-region km with `SPARSE`/`OVERSIZED`/`EMPTY` flags,
and boundary coverage. The QA loop: rerun with tweaked flags — `--merge-regions
"Census Tract 513:Census Tract 523.01"` folds regions by *name* and re-splits the streets against the merged
boundaries, and `--rename-regions` applies `db/onboarding/<city-id>/region_renames.csv` — or hand-edit the
GeoPackage in QGIS and regenerate the SQL with `make build-city-data id=<city-id> args="--from-gpkg"`, which
validates the layers first (a hand-built layer with a single `osm_id` column is accepted).

## `street_gradient.py`

Samples a bare-earth elevation model along every street's centerline and writes each street's running slope, climb
and elevation profile to `db/onboarding/<city-id>/street_gradient.csv`, which `make import-street-gradient` loads into
the `street_gradient` table (#5223). The method, the measurements behind its constants, and the per-country source
table are in [`docs/street-gradient.md`](../../docs/street-gradient.md).

```bash
make export-street-gradient-input      # streets with no row yet, or whose geometry changed
make street-gradient id=seattle-wa     # US cities: USGS 3DEP 10 m, picked from the city's country-id
make street-gradient id=cdmx args="--dem-dir db/onboarding/cdmx/dem --dem-name inegi-mdt-5m --dem-resolution-m 5"
make import-street-gradient
```

`make onboard-city` runs the three for a new city (step 8), passing the export
`--structures onboarding/<city-id>/street_structures.csv` so it needs no `osm_way` cache; a live city is topped up
by hand with the same three commands, and the nightly `StreetGradientStalenessActor` says when (Admin > Health).

- **Sources.** A registered source is chosen from the city's `country-id` in `conf/cityparams.conf` (only the USA so
  far). Anything else goes through `--dem-dir`: a directory of hand-downloaded GeoTIFFs in any mix of coordinate
  systems, elevations in meters.
- **Bridges and tunnels.** A bare-earth model has the ground under a bridge, so streets the export marks
  `is_structure` (from `osm_way.tags`) get their endpoint elevations and no grade (`quality = structure`), and an
  untagged street whose profile holds an implausible pitch is drawn as a straight line between its endpoints
  (`quality = suspect`).
- **An empty `osm_way` stops the export**, since every bridge would then be sampled as the ground beneath it. Pass
  `args="--structures onboarding/<city-id>/street_structures.csv"` to take the flags from the street build (what
  onboarding does), `args=--allow-empty-osm-way` for a city that really has none, and `args=--all` to resample
  every street. The tutorial street is never exported.
- **Resume.** Rows are flushed a grid cell at a time; `--resume` keeps the ones that answer the current export (same
  street, same `geom_md5`) and samples the rest.
- **No network in tests.** `test/python/test_street_gradient.py` writes small GeoTIFFs whose elevation is a known
  plane, so every expected grade is arithmetic.

