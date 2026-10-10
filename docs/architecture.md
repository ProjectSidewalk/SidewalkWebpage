# Architecture

A tour of how Project Sidewalk is put together, for contributors getting oriented. For setup see
[`docs/dev-environment.md`](dev-environment.md); for the contribution workflow and coding standards see
[`CONTRIBUTING.md`](../CONTRIBUTING.md). [`CLAUDE.md`](../CLAUDE.md) is the short AI-assistant-facing index of
cross-cutting rules; it points here for the architecture.

## Overview

Project Sidewalk is a web-based crowdsourcing tool for mapping and assessing sidewalk accessibility. Contributors
move through panoramic street imagery and label accessibility features and problems; that data is validated,
aggregated, scored, and served back out through a public API and a set of dashboards.

**Stack:**
- **Backend** — Scala 3.9 + Play Framework 3.0 (Java 17).
- **Database** — Postgres + PostGIS, accessed via Slick (with slick-pg for spatial/JSON types).
- **Frontend** — vanilla JavaScript ES modules, bundled per page by Vite (no transpilation), with no framework:
  native DOM and CSS on the `main.css` design tokens.
- **Dev/runtime** — everything runs in Docker.

## System at a glance

```
Browser (vanilla-JS apps: Explore, Validate, Gallery, Admin, UserDashboard, PSMap)
        │  HTTP
        ▼
Play backend ── routes → Controller → Service → Table (DAO/Slick)
        │                                   │
        │                                   ▼
        │                         Postgres + PostGIS  (one schema per city: sidewalk_<city>;
        │                                              auth in sidewalk_login)
        ▼
External imagery providers (Google Street View / Mapillary / Infra3d / Panoramax / Pannellum)

Out-of-band Python utilities: scripts/label_clustering.py, tools/city/check_streets_for_imagery.py
```

## Backend

### Request flow

The backend follows a consistent layering: **routes → Controller → Service → Table (DAO)**.

- **`conf/routes`** — a single file mapping URLs to controller methods. The public data API lives under
  `/v3/api/...`.
- **`app/controllers/`** — a thin HTTP layer. Controllers parse/validate requests and delegate; they should not
  touch tables directly. Auth-protected actions use **Silhouette** (`app/models/auth/`, `SilhouetteModule`).
  Versioned public-API controllers live in `app/controllers/api/`.
- **`app/service/`** — business logic (e.g. `LabelService`, `ValidationService`, `ExploreService`,
  `AccessScoreService`, `ApiService`). This is where most non-trivial logic belongs.
- **`app/models/`** — Slick table definitions and queries, grouped by domain (`label/`, `validation/`, `mission/`,
  `region/`, `street/`, `route/`, `user/`, `cluster/`, `gallery/`, `api/`, …). Files named `*Table.scala` define
  schema + queries (the DAO pattern).

### Database access

- **`app/models/utils/MyPostgresProfile.scala`** — a custom Slick Postgres profile wiring in PostGIS geometry,
  JSON, and other slick-pg extensions. Spatial query helpers live in `SpatialQueryDefs.scala`.
- **Per-city schemas** — each city is its own schema (`sidewalk_<city>`); they're essentially identical.
  Authentication lives in the shared `sidewalk_login` schema, along with anything that belongs to the account rather
  than to one city: `user_settings` holds choices the user makes (units, service-hours tracking) and
  `user_account_state` holds what the site records about them (having finished the Explore tutorial, and when a
  password change or Settings' "Sign out of other devices" last signed them out everywhere, #5305). Both only get a row once there's something to store
  (#3720). Per-city stats and privacy flags stay in each city's `user_stat`.
  The schema holds auth to one account per email, one login row per account, and one password per login row
  (#5317), and sign-in, reset, and change-password all reach the password through the account.
- **Which rows count** — never re-type the "deleted / tutorial / excluded user / tutorial street" filters. Slick queries
  start from the named sets (`LabelTable.labels` and its variants, `StreetEdgeTable.streets`, `countedAuditTasks`,
  `completedAuditTasks`); raw SQL starts from the matching fragments in `app/models/utils/FilteredTables.scala`
  (#5287), e.g. `FilteredTables.streets()`, or `notTutorialStreet` for a query that keeps streets of every status.
- **Values in raw SQL** — a value from a request goes into a `sql"..."` fragment as `$value`, so Postgres gets it
  separately from the query text; `#$` pastes text in and is only for SQL written in code. Optional filters are
  lists of fragments, combined with `SqlFragments.allOf` or `join` (#2756). `SqlFragments` also holds the bbox tests,
  enum lists (`enumList`), the check a schema name must pass before it's pasted in (`requireSafeIdentifiers`), and
  per-transaction Postgres settings (`withLocalSetting`).
- **Evolutions** — schema changes are Play evolutions: numbered SQL files in `conf/evolutions/default/`, each with
  `# --- !Ups` / `# --- !Downs`, auto-applied at startup to every city schema. Numbers are gapless, a PR's changes go
  in one file, every new table gets `ALTER TABLE <name> OWNER TO sidewalk;` and its full set of constraints, and the
  SQL is written for production scale. The full rules are in [`docs/evolutions.md`](evolutions.md). The dev DB is
  seeded from a dump rather than built up from evolutions; the scripts that do that seeding (and other DB
  lifecycle/maintenance tasks) live in [`db/scripts/`](../db/scripts/README.md).

### Streets, regions, and routes

Regions (neighborhoods) organize the work: a mission is filed under one, the dashboard and LabelMap filter by one,
and `region_completion` reports progress per region. They are **not** a boundary the streets or a route have to stay
inside (#3488). The larger aim behind that, shared with the tiny-segment work (#4717) and the planned mission routes
proposed in #5526, is walks that make sense on the ground: routes that end at intersections rather than at an
arbitrary line, fewer tiny disconnected pieces, and enough of a plan that the tool can show where a walk is going.

- **`street_edge_region` is an assignment, not geometry.** Every street belongs to exactly one region (UNIQUE on
  `street_edge_id`, evolution 338); that is what files a street's missions and credits its completion. Nothing in
  the app relies on the street lying inside the region's polygon, and Explore never reads the polygon at all.
  Historically the city build cut streets at region borders so the two coincided; new cities are no longer meant to
  be cut that way (see [`docs/onboarding-a-city.md`](onboarding-a-city.md)), and existing cuts are to be merged
  back in a later, staged data repair. Until then a street that was cut at a border is simply two streets.
- **A route may run through any number of regions.** `route.region_id` is the region the route **starts** in: the
  first street's region, derived by the server on save and re-derived by `RouteTable.updateStats` whenever the
  street list changes, never taken from the client. Listings carry `region_count` beside it, so a route that leaves
  its start region reads "Start region + N more". RouteBuilder's A* runs over the whole city's street graph.
- **A route walk is filed under the start region.** Explore sets the walker's `user_current_region` to it and files
  the walk's mission there, which is also where the walker carries on exploring once the route ends. The streets a
  walk hands out come from the route (`selectTasksInRoute`), not from the region, so no region-scoped query on the
  Explore path applies to a walk: a walk does not ask for the region's live street priorities (the route fixes the
  next street), and `region_completion` is credited street by street, so a border crossing credits both regions.
- **A user's earlier labels are gathered by mission region OR street region.** Explore redraws them on every page
  load (`LabelTable.getLabelsFromUserInRegions`), for the page's region plus every region the current walk runs
  through (`UserRouteTable.getRegionIds`). A label counts when its mission is filed under one of those regions *or*
  its street is: going by the mission alone would hide a route's labels from a later visit to the neighborhood they
  are actually in, and going by the street alone would drop a label placed just across a border from its mission's
  region. It is a UNION of two indexed branches on purpose; an OR across the two joins can't use either index.

### Media storage

Uploaded media has two homes, chosen by its profile — and neither is the app-local filesystem, which a
multi-instance deployment can't use safely (`sbt clean stage` once deleted production user media that lived under
the app dir, #4925):

- **Small, bounded, admin-curated, globally shared media lives as database rows.** Partner logos (#4516) are the
  model case: re-encoded server-side, hard-capped by a `CHECK (octet_length(...) <= 1048576)` constraint, read by
  every city app from the shared `sidewalk_login` schema, cached in-process and served with immutable cache
  headers. At this size Postgres outperforms a filesystem (the classic crossover is ~256KB — Sears/van Ingen/Gray,
  *To BLOB or Not To BLOB*, 2006), writes are transactional with the owning row, and the bytes ride the existing
  DB backups with no extra provisioning. Full tradeoff record: issue #4516.
- **Unbounded, per-city, user-generated media lives in the persistent media directories** (`MediaDirs`) — story
  photos and audio today. These sit outside the app dir, are validated at boot by `PersistentMediaDirCheck`, and
  need their own provisioning and backup path on every host.

`cropped.image.directory` additionally holds the **label crops** (#4865), cut from the self-hosted panorama store
(`pano.images.directory`, which the nightly panorama-tools scraper fills) by the nightly `CropGenerationActor` via
`CropService`, under `<city-id>/<LabelType>/` (a label whose type is edited has its crop moved to the new type's
directory by `LabelEditService`). They are disposable — delete the store and the next run rebuilds it —
which is why they live beside the app's other derived media rather than in the panorama store, which the app only
reads.

A pano's `pano_data.width`/`height` never change: Google re-renders pixels, never the frame (measured in
sidewalk-panorama-tools, `reports/2026-08-09-photometa-census.md`). A stored image of another size is a mis-stitched
file, not a resized pano (#5667).

Crops are the image the Gallery, the landing validation grid and label popups fall back to when live imagery is
unavailable; they are written by the browser's `POST /saveImage` canvas snapshot at labeling time and by the job for
every label that has none (AI submissions, failed uploads, any past city). The card surfaces (Gallery, landing grid,
dashboard mistakes, the share preview) fall back one step further for a GSV label with no crop, to a Street View
Static API still requested at 640×427 — Google's 640-px cap at the boxed Explore canvas's aspect — so it is the
boxed labeling frame at a smaller scale and a marker at the label's canvas fraction still lands on the feature (#3095;
asking for 720×480 got a 640×480 still with extra sky and ground). A label placed in immersive mode (#5085) has a frame
of the window's aspect: its snapshot crop keeps that aspect (`ImageController.writeImageFile` normalizes the width
only), and `util.misc.labelMarkerFraction` re-places its marker in the 3:2 still and in the 3:2 box every card
cover-fits its image into. Label popups never use the still: their chain is live pano →
self-hosted backup → crop → "imagery not available". The geometry — `CropSizingRule` (the
swappable, versioned sizing rule) and `CropGeometry` (equirectangular mechanics) — is a port of panorama-tools'
`CropRunner.py`, pinned to it by golden fixtures under `test/resources/crops/`. The two writers put the label in
different places — the snapshot at its canvas fraction, the job's window wherever `CropGeometry.labelPositionInCrop`
says (the centre, unless the window shifted off a pole) — and the files look alike, so **every crop's provenance is a
`label_crop` row** (#2660): which writer, and the label's position as fractions of the image. Each writer records its
row as it writes, the job's reconcile pass classifies any crop found without one (by size, then by the file's age
against the label's, and never on a signal that disagrees with the others), and the six surfaces that draw a marker
on a crop — the Gallery card, the landing validation grid, the dashboard's mistake cards, the popup's crop fallback,
the share preview, the label mini-card (`LabelMiniCard.js`, the AccessScore sheet and photo strip) — take it from the
row (`crop_marker` in the label payloads), falling back to the canvas fraction only while a crop is unrecorded or the
image on screen is the Street View still. A new crop writer must write that row, and a new surface that marks a crop
must read it. A pano too wide for the viewer's GPU is shown from a downscaled copy, and `/backupImage/:panoId` serves
that in place of the native file without the viewer being able to tell, because it places markers by angle. A backup
is served only when its row holds the pano's dimensions, camera position and heading; camera pitch and roll are
stored but not needed, since the viewer takes the horizon from the image itself (#5174, #5725), and
`PanoDataTable.hasBackupViewerFields` names every copy of that rule. **The viewer decides when one is needed**,
because only it knows the GPU: Pannellum uploads an equirect as two halves, so its limit is `2 x MAX_TEXTURE_SIZE`
and a device advertising 8192 renders a 16384-wide pano — the widest GSV produces — untouched. When a device can't,
it appends `?maxWidth=` and `PanoDisplayCopyService` cuts a copy at that
width on demand, caching it under the crop store (#5256). A phone asks for 8192 whatever its GPU says, because the
native file's decode and textures are more memory than iOS lets a tab have, and it answers by killing the tab (#5561).
For the same reason a requested width is a bound, not a preference: a copy the server can't cut right now (its cut
pool is full, or the cut failed) is a `503` with `Retry-After`, never the native file, and the viewer's own ladder
steps down to a smaller width on that refusal. A pool with no room refuses every width alike, so a foreground load
that meets one gives the label up (`LabelSkipped_NoImagery`, the #4810 path) rather than wait; a prefetch, with
nothing waiting on it, retries once after `Retry-After`. Validate also fetches the backups of the next expired labels into
`PanoImageCache` while the current one is judged, one at a time, and Pannellum loads the held `blob:` URL in place of
the network one, waiting a bounded time for a prefetch still in flight rather than downloading beside it (#5562).

The app used to precompute that copy for every wide pano nightly, which OOM-killed prod JVMs (#5239) — not because
downscaling is beyond a city stage, but because doing it for a whole store, for copies almost nothing ever displays,
was never worth it. On-demand costs ~105 MB and ~2 s per copy, by letting the JPEG decoder subsample rather than
decoding and rescaling; the trade is pixel-dropping instead of area-averaging, taken deliberately given how rarely
it runs.

Imagery Project Sidewalk shows a copy of — a self-hosted pano or a crop — carries the attribution
`ImageryAttribution` composes (Mapillary contributors are CC BY-SA 4.0), rendered by `PanoAttribution.js` alongside
the source logo `PanoViewerLogo.js` draws: in the label-detail pano box, in Validate's Pannellum fallback, and on
every card that shows a crop — the Gallery card, the landing validation grid, and the dashboard's mistake cards
(`css/components/pano-attribution.css` is the shared look; each host positions the pill). A card that falls back to
the Street View Static API still drops the overlay: Google bakes its own logo and copyright into that image. The
providers' live viewers draw their own pill, and Mapillary's is left inside the SDK's DOM rather than moved into the
control layer, because the SDK patches it in place per image (#5600). That keeps it accurate but, on desktop, under
the transparent control layer, so its links take no pointer clicks (they stay in the tab order); the pano info popover
carries the view-in-Mapillary link. Mobile Validate's control layer is click-through, so taps reach it there. The
image-adjustment filter sits on the mount, so it dims the pill along with the imagery, as it does Google's logo.

If either category outgrows its lane — thousands of files, multi-MB originals, a CDN or on-the-fly transforms in
front — the move is to object storage (S3/MinIO), never the local filesystem.

### Dependency injection & runtime

DI is Guice. The app bootstraps via `app/CustomApplicationLoader.scala`; modules are registered in
`conf/application.conf` and defined in `app/modules/` (`CustomControllerModule`, `ActorModule`, `ExecutorsModule`,
`SilhouetteModule`, and `StartupChecksModule` — the home for boot-time checks that surface deployment-level
misconfiguration, like `PersistentMediaDirCheck`, and for boot-time repairs like `AiSeedRowsRepair`, which inserts
the SidewalkAI user's per-schema rows wherever a schema was created without running 281.sql — a cloned or
dump-restored city, #5349, and `OrphanedJobRunSweep`, which closes the job runs a previous process died in the
middle of, #5236). Custom execution contexts live in `app/executors/`; background actors in `app/actor/`;
HTTP filters in `app/filters/`, registered through `play.filters.enabled` in
`conf/application.conf`.

**Views** are Twirl templates (`app/views/*.scala.html`).

### Background jobs

Each deployment runs a set of nightly jobs as pekko actors in `app/actor/` — the imagery expiry sweep, the
imagery-age poll and freshness sync, street-priority recalculation, user and funnel stats, the sidewalk presence
rebuild (which re-derives the `sidewalk_presence` table, one verdict per side of each street, from the day's labels,
audits and validator verdicts, #5279/#5285), label clustering (which opens with the intersection rebuild that
re-derives the `intersection` table from the street graph and attributes corner-feature clusters to it, #5095), crop
generation, OSM way refresh, AI validations, and auth-token cleanup. The schedule lives in one place,
`app/actor/ScheduledJobs.scala`: each actor reads its own time from there, staggered across the small hours and
shifted per city by `ConfigService.getOffsetHours` so 50+ deployments don't contend for the same database and
provider quotas.

Label clustering closes with the **AccessScore Spotlight snapshot** (#5215), which writes `region_access_score`
and `street_access_score` from the clusters that run just built: one row per region per night (kept, so the table is
a score history) and one row per OSM way per region, replaced each run. The landing page and `/cities` read only
those two tables, which is what makes a ranked AccessScore safe to put on a page nobody waits for. Like the
intersection rebuild it records its own run and is recovered rather than propagated, so a clustering success never
stands in for a snapshot nobody wrote. The snapshot's computation is the very value `/v3/api/accessScoreStreets` and
its siblings cache per JVM, so it also seeds that cache (`SwrCache.put`, #5418): on a large city the whole-city
computation takes longer than the reverse proxy allows a request, so a cold cache — after a deploy, or a city nobody
opened in two days — would otherwise cost the first visitor a `502`. When the cache is cold anyway, the full-city
endpoints wait at most 45 s and then answer `503` with `Retry-After: 30` while the computation finishes in the
background; the AccessScore tool retries on that header and says so under its spinner.

The **places refresh** (#5311) keeps the per-city `place` table current from OpenStreetMap: one Overpass query per
run over the city's bounds for every tag in the `PlaceCategory` catalog (schools, health care, libraries, grocery,
transit, parks, community centers, government offices), merged by `PlaceTable.replaceOsmPlaces` so a place keeps its
`place_id` across refreshes, with the containing region and the nearest open street within 250 m computed in SQL as
it lands. It ticks nightly like every job but fetches only when the newest place is more than a week old, or the table
is empty, which is how a city gets its places with nothing done at onboarding; the skipped ticks are recorded too, so
the Health panel can tell "fresh" from "stuck". `/v3/api/places` serves the table (the whole-city read cached with
`SwrCache`, cleared by a refresh), the AccessScore map draws it, and Admin > Management can run the fetch on demand.

Every run is bracketed by `JobRunService.record`, which writes a `background_job_run` row — start, finish, outcome,
and the job's own counts as JSONB (#4928). Without it, a job that silently stops firing is indistinguishable from one
that found nothing to do, since the absence of a log line is not something anyone notices. `/admin/health` renders
the roster, flagging any job that is overdue, failed, interrupted, or has never run. The wrapper is strictly
subordinate to the job: a bookkeeping failure is logged and swallowed, and a job's own failure propagates unchanged.
It also logs each run's outcome and duration, so the log alone can tell a job still working from one that died.
Only the process that opened a run can close it, so a process that dies mid-run (a deploy, a crash) would leave the
row `running` forever; `OrphanedJobRunSweep` closes those at the next boot as `interrupted` (#5236), taking every run
that started before this JVM did. That rule rests on each stage running one process per city schema. A run that hangs
inside a live process is not caught at boot; the Health panel reads it as `abandoned` after 12 hours.

The two derived tables, `intersection` and `sidewalk_presence`, share one pattern: the derivation is raw SQL held once
in the DAO (`IntersectionTable.derivationSql`, `SidewalkPresenceTable.derivationSql`), the evolution that created the
table — or the latest one to change the derivation, with a real Down that re-derives the old way (388.sql) — carries
a pasted copy for the one-time population of existing cities, the nightly rebuild re-runs the DAO's copy
into a temp table and touches only the rows that changed, and a spec (`IntersectionTableSpec`,
`SidewalkPresenceTableSpec`) runs the evolution's statement and then the rebuild to prove the two copies still agree.

`sidewalk_presence` is read in two places: the public `/v3/api/sidewalkPresence`, and the admin Sidewalks page
(`/admin/sidewalks`, #5724), which maps every face and lists the calls most worth checking. The admin page reads
`/adminapi/sidewalkPresence` instead of the public endpoint, because it also needs per-side curb ramp and
obstacle/surface-problem counts that exist only to flag faces for review and shouldn't become part of the public API.

`street_gradient` (399.sql, #5223; read through `StreetGradientTable`) is per-street too but is not one of these: its
elevations come from rasters the database never sees, so there is no SQL derivation and no nightly rebuild. An offline
script samples a bare-earth elevation model and a db script upserts the CSV, the way the imagery scan feeds
`street_imagery`; new cities get it during onboarding. Staleness is a `geom_md5` comparison the export script makes,
and the one nightly job in this area, `StreetGradientStalenessActor`, only counts it: the served streets with no row
and those sampled on an older geometry, recorded so the Health panel says when a city needs a fill or a top-up
(Admin > Management can recount on demand). See [`street-gradient.md`](street-gradient.md).

A job that both the scheduler and an admin can trigger has exactly one definition of its counts — a `runDetails` on
the job's result type, or next to the actor's `Name` when the result is a bare count — which both call sites pass to
`record`. A details object built from a literal at each call site would let the two shapes drift, and `/admin/health`
charts both triggers as one job (#5044). Jobs with a single call site build theirs inline. `JobRunDetailsSpec` pins
the key names, which readers of `background_job_run.details` are written against.

### The public API (`/v3`)

The `/v3` API is the canonical public surface (handlers in `app/controllers/api/`). Conventions (issue #3871):

- **Query/REST parameters are camelCase** (`minSeverity`, `regionId`, `validationStatus`). `ApiError.parameter`
  names a query param, so it stays camelCase too.
- **All output field names are snake_case** — JSON bodies, GeoJSON `properties`, CSV headers, and
  GeoPackage fields (`label_id`, `region_name`, `city_id`) — one canonical field name across those formats. A
  response DTO declares its fields once, in the `ApiFields` list on its companion (below), and every format is
  built from that list, so a field cannot be named one thing in one format and something else in another. A value
  the JSON nests gets a dotted name (`labels.CurbRamp.count`), which is a nested key in the JSON, a CSV column
  of exactly that name, and a GeoPackage column with each dot turned into an underscore (`labels_CurbRamp_count`),
  since ArcGIS rejects a dot in a column name (#5273).
- **Shapefile is the exception:** its fields stay **camelCase and abbreviated** (`labelId`, `regionName`,
  `neighborhd`, `cameraHdng`). The DBF format hard-truncates field names to 10 chars, so shapefiles can't carry the
  canonical snake_case names regardless of casing; camelCase reclaims the byte the underscore would waste. Shapefile
  is a legacy export being phased out — GeoPackage is the modern GIS export that carries the canonical snake_case names.
- **File downloads** (shapefile, GeoPackage, zipped CSVs) are each built in their own folder under `api-downloads/`
  and deleted once streamed; a folder untouched for two hours (its client gave up) is swept on a later download (#4133).
- **One file download per URL at a time.** While a file is being built and streamed, a repeat of the same URL gets a
  429 with `Retry-After`, so an impatient retry can't double minutes of work (#4161). Plain CSV/GeoJSON streams are
  not guarded, since the site's own pages fetch the same URLs in parallel. A `HEAD` request gets the same 429 without
  building anything, which is how the Label Map's download button warns before it starts; the API docs buttons fetch
  the file themselves, so they read the 429 off the download. A built file also carries its uncompressed size in
  `X-File-Size`, for clients showing download progress, since gzip strips `Content-Length`.
- v3 is a **preview** surface: breaking changes are made in place rather than minting a new version (precedent: #4223).

**Data structures (DTOs).** The response/filter types live in **`app/models/api/`** (`package models.api`), in
per-domain `*ApiModels.scala` files (`LabelApiModels.scala`, `StreetsApiModels.scala`, …). That is the canonical
home: a `*Table.scala` DAO *produces* its DTOs but never *defines* them (issue #3885). The convention:

- **Naming:** response types are `*ForApi` (`LabelDataForApi`, `UserStatForApi`); parsed query filters are
  `*FiltersForApi` (`RawLabelFiltersForApi`).
- **Streaming:** response DTOs extend `StreamingApiType` (`app/models/api/StreamingApiType.scala`) and implement
  `toJson` / `toCsvRow` inline on the case class, so `BaseApiController`'s `outputJSON`/`outputCSV`/`outputGeoJSON`
  helpers can serialize a stream of them uniformly. Serialization lives *on the DTO*, not as free functions elsewhere.
- **Companion object extends `ApiFields[T]`** and declares `fields`: one ordered list of `field("name")(_.accessor)`
  entries, from which `csvHeader`, `toCsvRow`, and `toJson` are all derived. `csvOnlyFields` adds columns the CSV
  carries but the JSON expresses another way — a geometry the CSV can only summarize as `start_point`/`end_point`,
  say — and `csvFields` can be overridden where the CSV needs an order the JSON doesn't have. A GeoJSON DTO puts
  `toJson(this)` in the Feature's `properties` and passes the geometry separately. A GeoPackage layer
  (`ShapefilesCreatorHelper.GeoPackageLayer`) takes `fields` as its columns, each typed from the field's Scala type
  (`GeoColumnFor`) and holding the field's JSON value.
- **Single-object endpoints** (`overallStats`, `aggregateStats`) return one object rather than a list of records, so
  their CSV lists stats down the page: `ApiModelUtils.toCsvKeyValueRows(toJson)` under `keyValueCsvHeader`, keying
  each row by its dotted path.
- **Shared helpers:** reuse `ApiModelUtils` (`escapeCsvField`, `createGeoJsonPointGeometry`, `labelTypeOrdering`,
  `csvCell`, …) rather than re-rolling CSV/GeoJSON logic.
- **Every `/v3` DTO's serialization lives in `models.api`.** There is no shared formats object for API output and no
  API serialization inline in a controller. The `app/formats/json/*Formats.scala` files serve the internal (non-`/v3`)
  endpoints only (issue #3891). They use `Json.reads`/`Json.writes` with snake_case keys, and are hand-written only
  when they do more than rename keys. Add a case to `SnakeCaseReadersSpec`/`SnakeCaseWritersSpec` for each new one.

**Internal-key routes need `+ nocsrf`.** Any server-to-server POST authenticated by the internal key
(`ControllerUtils.internalKeyValid`) needs a `+ nocsrf` modifier line above its `conf/routes` entry. Play's CSRF
filter protects every unsafe request carrying an `Authorization` header, and a bearer token is exactly how these
callers authenticate, so without the modifier the request 403s before it reaches the controller. This is invisible in
local testing (a curl without the header 401s the same either way) and cost `/ai/submitLabelsOnPano` a silent outage
(#4806). `internalKeyValid` fails closed on an unset key, so it, not CSRF, is the gate. Existing examples:
`/clusteringResults`, `/ai/submitLabelsOnPano`.

### Public label-share surface (`/label/:id`)

A public, account-free share surface (issue #456, `ShareController`) lets a single label be linked externally.
`GET /label/:id` renders a single-label spotlight page — the shared LabelDetail component as the hero plus a
nearby-labels minimap fed by the cheap, bbox-bounded `/v3/api/rawLabels` API (deliberately not LabelMap's
city-wide `/labels/all` layer) — with server-rendered Open Graph / Twitter Card meta so a pasted link produces a
rich preview. `GET /label/:id/image` serves the preview image — self-hosted, with the label-type marker
composited onto the crop (or a Street View still, or a branded fallback) — cached under `share.image.directory`
(`SIDEWALK_SHARE_IMAGES_DIR`), the same mounted volume as label crops so share links persist across container
recreation; the per-city cache is LRU-bounded so the public, enumerable URL space can't fill the volume. Previews
never expire, so a change to how they are built bumps `ShareImageCache.Generation`: it is in the filename, so a
label's old preview is replaced the next time it is requested (rebuilt, or renamed into place when nothing can be
built any more — an old preview beats the logo), and in the advertised `og:image` URL, so platforms that cache the
card by URL re-fetch. Old files for labels never requested again age out of the LRU cap. To
support the anonymous landing, the `LabelController.getLabelData` read backing the label-detail popup was opened
to anonymous access.

## Frontend

Each major UI is a self-contained app under `frontend/js/`, started from its page's entry in `frontend/js/pages/` and
loaded by the corresponding Twirl view:

- **`explore/`** — the Explore/Audit tool (label accessibility issues on street-view panoramas). The largest app.
  Its immersive mode (#5085, the shared `common/ImmersiveMode.js` + `css/pages/explore/svl-immersive.css`) fills
  the browser window with the pano; the labeling frame it stores with every label, and why, is in
  [`label-latlng-estimation.md`](label-latlng-estimation.md) under "The frame contract". Validate has the same mode
  (#5560, `css/pages/validate/svv-immersive.css`): over the boxed DOM, CSS alone floats the menu column as a dock at
  the bottom-centre and the mission title and progress bar as one pill at the top-centre. Expert Validate stays boxed
  until its edit sections have an immersive placement.
  Explore's URL follows the labeler (#5480, `src/navigation/ExploreUrlSync.js`): on pano and POV changes, at most one
  write per 500 ms with the latest state winning, it is rewritten in place (`replaceState`, never a Back entry) with
  `panoId`, `lat`, `lng`, `heading`, `pitch`, `zoom` and, in immersive mode, `immersive=1` — the same params
  `ExploreController.getSession` reads, so the address bar is always a shareable link to that view. To anyone else the
  URL names a place, not a session: opening it lands in free exploration there (the `?lat&lng` drop-in of #4451),
  never in the sharer's mission or route, so `routeId`, `resumeRoute`, `regionId`, `streetEdgeId` and `placeName`
  are dropped from it once the page is up. To its owner it is still their session: the URL also carries the
  `missionId` it was written from, which the controller honors only when the requesting user owns that mission,
  so a refresh, or one of Explore's own reloads (after an hour idle, on a submit failure), resumes the mission at
  the same pano and view while the id is inert for a recipient. Free exploration writes no id, since the drop-in
  path already resumes the user's own open drop-in mission.
  The Image pill in the chevron menu beside Stuck (#3136, `common/PanoImageAdjustments.js` +
  `PanoImageAdjustmentsPopover.js`) lifts shadows and adjusts brightness/contrast as a CSS `filter` on the pano mount —
  display-only, for the labeler's eyes: the mount is a sibling of every overlay, and crops are cut from the provider's
  raw canvas, so neither the label markers nor the stored imagery carry it. Its panel opens below the pill, clear of
  the pills continuing the row, and to its right in full screen, where the pills form a column. Shadows is a gamma
  curve (an SVG `feComponentTransfer` the model injects on first use) rather than brightness, because the dark
  sidewalks people struggle with sit in otherwise well-exposed scenes and a brightness multiplier clips the sky before
  it opens the shadows. Values persist in localStorage, shared with Validate, which mounts the same two classes (below).
- **`validate/`** — the Validate tool (confirm/reject others' labels). Which labels it serves, in what order,
  and why: [`docs/validation-queue.md`](validation-queue.md).
  Desktop Validate mounts Explore's image adjustments panel (#5501) from an Image pill in a chevron menu beside the
  hide-label toggle (`validate/panorama/PanoControlMenu.js`), the same arrangement as Explore's beside Stuck.
  The model takes a list of mounts there, `#svv-panorama` and the `#svv-panorama-pannellum` sibling PanoManager
  swaps in when GSV has no imagery, so the filter is already on whichever viewer shows the label. Validate scopes
  the keyboard for the panel in `KeyboardManager` rather than suspending it with `disableKeyboard()`, a single flag
  that the modals and the loading lock also set, and the partial sits outside `#svv-application-holder` so the busy
  state's `pointer-events: none` can't freeze the sliders. Mobile Validate has no panel.
  **A viewer canvas is painted only while it holds the current label's pano at that label's POV**
  (`validate/panorama/PanoManager.js`). The Pannellum fallback is revealed only once its image has loaded (#5206),
  the primary canvas rejoins the layout unpainted after a fallback label (#5453), and on a primary viewer that paints
  during a load (`PanoViewer.PAINTS_DURING_LOAD`: Mapillary, Panoramax) the canvas and marker are hidden for every load
  and revealed by `renderPanoMarker` two animation frames after it sets the label's POV (#5582), capped at 100 ms for
  a background tab, which is also when `LabelContainer` unlocks the tool. The reveal runs even when aiming or drawing
  the marker throws, a marker built while the canvas is hidden is hidden with it, and its pulse starts at the
  reveal. GSV keeps the outgoing pano up during its ~50 ms swap. Mapillary moves
  in Validate and the label popup use `TransitionMode.Instantaneous`; Explore keeps the animated walk.
  **A label whose pano won't load** is passed over by `LabelContainer.#loadPanoForCurrentLabel`, and `setPanorama`'s
  `{panoData, reason}` result says which kind: `'no-imagery'` drops it and asks `/validationTask/moreLabels` for a
  replacement (#4810); `'slow'` (the primary threw `PanoLoadTimeoutError` and there was no usable backup) moves it to
  the end of the queue once, and drops it only if it is slow again (#5581), so the validator waits out at most one
  deadline before seeing another label. After three slow loads in a row with none succeeding, slow labels are dropped
  on their first try and no replacements are requested, so a dead network reaches the imagery modal in minutes
  rather than a quarter of an hour. A failed load during an undo abandons the undo instead (the label is already
  validated, so it must not be deferred or owed): the label undone from is shown again and Back is disabled.
  `PanoManager.create` loads no pano; the first label's `setPanorama` is its only load. A label the payload flags
  `expired` that has a backup skips the primary and goes straight to Pannellum (#5561), trying the primary only if
  the backup fails, so a slow `reason` there comes from that late attempt and a load that never asked the primary is
  `'no-imagery'`. Once a label is on screen, `LabelContainer.#prefetchUpcomingPanos` warms the next two: an expired
  label with a backup has that backup fetched into `PanoImageCache` (#5562), and any other has its pano warmed
  through `PanoViewer.prefetchPano` (Mapillary caches the image's metadata and thumbnail, which is what `moveTo`
  waits on; #5581). Validate and the label popup pass the `linkedPanos: false` pano
  option, so a Mapillary load resolves as soon as the image is set instead of after the linked-pano graph request
  that only Explore's navigation reads. `PanoLoadingStatus` shows "Loading imagery…" over the pano
  (`#svv-pano-loading`, a polite live region in both views, so boxed, immersive and mobile share it): at once when
  the pano area is blank for
  the load (`PanoManager.blanksPanoWhileLoading`, true for a paints-during-load primary or an empty pano area), after
  2 s when the outgoing pano stays up. The screen-reader announcement and the `PanoLoadingStatus_Shown` event always
  wait the 2 s, so neither fires for fast labels. It switches to "Still loading, trying the next label…" when a label
  is deferred. The busy state leaves `aria-busy` off the region that contains that live region, since assistive tech
  may hold a busy subtree's announcements until it clears, and dims the application holder's parts individually so the
  status itself is never under the 60 % opacity; the mission modals are left out of that dim as well, so they keep
  stacking above the status, and the status is not started at all while one of them covers the pano (the next
  mission's first label loads behind "Great job!", whose disabled button is the loading state there). `#svv-panorama-holder` carries the viewer's dark backdrop, so
  the area stays dark while the canvas is hidden for a load.
- **`gallery/`** — browsable, filterable gallery of labels. `?labelIds=1,2,3` puts it in **review-list mode**
  (#5444): the page shows exactly those labels, in that order, as a review queue. The list replaces the filters
  rather than intersecting with them — **no sidebar is rendered at all**, so the grid runs the full width (four
  columns on a desktop, which is why a list page holds 12 cards where the filtered grid holds 9;
  `CardContainer.getCardsPerPage()` is the one place that knows, and `ExpandedView` reads it back rather than
  keeping a copy). What the list has to say about itself sits in one left-aligned line above the grid
  (`.gallery-list-bar`), flush with the first card: a "← Browse all labels" link back to the plain Gallery (a link,
  not a button — it navigates), then the count as a pill ("20 labels in this list", or "18 of 20 labels in this
  list" once some aren't available), then the unavailable-ids disclosure, the over-cap notice and any load error.
  There is deliberately no heading and no review instructions there: the URL is a sharing link as much as a queue.
  `GalleryFilter` is still constructed with `null` for the absent sidebar and reset, because it owns the address
  bar (both `?labelIds=` and the `?labelId=` deep link) and the filter state `CardContainer` reads.
  List mode also skips the quality gates the filtered query applies (contributor quality, the disagree ratio,
  already-loaded ids), since the rater asked for these ids by name. `LabelService.getGalleryLabels` takes the
  branch, `LabelTable.getGalleryLabelsByIdQuery` is the query, and both share the row projection with the filtered
  query. Ids the city doesn't have, or whose imagery is gone with no crop to fall back on, come back in the card
  query's `unavailableLabelIds` and are named on the page, so a short list never reads as a complete one. The list
  is capped at `GalleryController.MaxLabelIds` (500) on both the page request and the card query, and a list that
  hits the cap says on the page how many ids were dropped — a truncated review queue that looked complete would be
  worse than a refused one. The request line for 500 seven-digit ids is ~4 KB, so `application.conf` raises
  `pekko.http.server.parsing.max-uri-length` to 8k (Pekko's 2k default 414'd at about 290 ids). The imagery check
  runs in chunks of `LabelServiceImpl.ImageryCheckChunkSize` so a 500-id list can't open 500 provider lookups at
  once. The page's "labels are sorted randomly" footer is not rendered in list mode: the order is the caller's.
- **`admin-dashboard/`** — the admin dashboard (#4272): one `<PageName>Page.js` per route, started by that page's entry
  in `pages/admin/`. `AdminShell.js` loads on every one of those
  pages (and the user dashboard's) and holds the shared shell behaviors — the "On this page" list and its
  scroll-spy, and keeping a deep link's target in place while sections above it are still loading — plus the shared
  formatting helpers (escaping, numbers, durations, relative times, the standard table markup).
- **`user-dashboard/`** — the redesigned user dashboard, settings, leaderboard, and public profiles, plus the admin's view of a user's dashboard (`/admin/user/:username`). Entries in `pages/dashboard/`.
- **`api-docs/`** — the `/api-docs` reference pages: one `<endpoint>Preview.js` per page renders a live sample of
  that endpoint, alongside `apiDocs.js` (shell behavior), `apiTableWrapper.js`, and `apiDocsTheme.js`
  (`ApiDocsTheme.color(token, alpha?)`, the one way preview code reads a CSS color token for Chart.js/Mapbox so
  chart colors follow the design system). Entries in `pages/api-docs/`, one per page plus `layout.js` for the chrome.
- **`access-score/`** — the AccessScore tool (`/accessScore`, #5217): a pure scoring model that re-runs the engine's
  math in the browser (`AccessScoreModel.js`, pinned to the Scala engine through `test/fixtures/accessScoreParity.json`;
  it ingests `/v3/api/accessScoreStreets` and `/v3/api/accessScoreIntersections` and reproduces a street's
  `segment_score`, every intersection's score, and the headline `score` #5095 averages from them — so the map's
  colors are the API's numbers, reweighted live; the one departure is that an unaudited street stays unscored
  rather than borrowing a headline from its crossings),
  the map view (streets and a neighborhood choropleth colored from feature-state, with a ramp legend beside the
  zoom buttons, `AccessScoreMapLegend.js`), the cluster evidence layer
  (`AccessScoreClusterLayer.js`, fed by `/v3/api/labelClusters` — the clusters the engine actually scores, not the
  raw labels), the places layer (`AccessScorePlacesLayer.js`, fed by `/v3/api/places`: one symbol layer per category,
  every category off until a reader ticks it, each marker's disc in the score color of its nearest street — drawn
  per histogram bin, since a symbol's image can't read feature-state — and the place card, #5311), the cluster sheet (`AccessScoreClusterSheet.js`: every label in a clicked cluster at once, as crop
  cards), the weights sidebar, URL state, and the insights band along the bottom of the map (`AccessScoreDock.js`
  coordinating four hand-rolled HTML views — the score histogram, which doubles as the legend and takes a
  drag-and-keyboard brush; what's here, a per-type cluster count split by rating and pooled over streets and
  intersections (`AccessScoreWhatsHere.js`); the rank list, which ranks whichever unit is in force — every neighborhood
  above the completion floor, or, in the streets unit, the 20 best-scoring streets with a toggle to the 20 worst
  (`AccessScoreModel#rankedStreets`, #5223) — and which steps out of the band above 1100px, the other three panels
  closing over its column, while a city mapped as one neighborhood is in the neighborhoods unit (#5419); and a photo
  strip of label crops from the scope's neighborhood feed, ranked worst first with confirmed labels ahead of unchecked
  ones (`AccessScorePhotoStrip.js`) — the first three subclasses of `AccessScoreChart.js`;
  the whole city is the population, a brush emphasizes in the overview views, narrows what's here and dims the
  map, and a selection marks the overview views, scopes what's here and the photos, and fades the rest of the
  map). An optional dark basemap (`?dark=1`, or the sidebar toggle, which is a live `map.setStyle` followed by a
  `remount()` of the map view and the cluster layer on `style.load`) reads the ramp in its dark stepping
  (`--color-score-ramp-dark-*`, passed per call as `{ mode: 'dark' }`) with a second chrome palette; the band and
  popups stay light and keep the light ramp. The shared score ramp is `common/scoreRamp.js`.
- **`AccessScoreSpotlight.js`** — the AccessScore Spotlight (#5215), a standalone module that the
  landing page and `/cities` both mount: the highest- and lowest-scoring neighborhoods, or streets, as two ranked
  lists whose bars are painted by `common/scoreRamp.js`. It reads one feed, `/v3/api/accessScoreSpotlight`, which
  answers from the nightly snapshot tables; nothing is fetched until the visitor's first interaction, and the
  section hides itself when the city has nothing ranked. A city mapped as one neighborhood has no neighborhood ranking
  to give, so that unit is dropped in favor of its street list — unless no street is ranked either, where the one score
  is still better than an empty section — and the unit switch is only drawn when both units have something to show.
  Hovering or focusing a row lights that neighborhood on the landing choropleth — or that city's circle on `/cities` —
  through the same `hover` feature-state the maps' own pointer handlers use, and the map never moves. The completion
  floor below which a neighborhood is not ranked is the backend's `min_region_completion`, the same number the
  AccessScore tool hatches by.
- **`ps-map/`** — shared map component used across pages, on Mapbox GL.
- **The Explore minimap is the one map that isn't `ps-map/`** (#5429): MapLibre GL over OpenStreetMap vector tiles
  (OpenFreeMap), so a city on Mapillary or Panoramax imagery loads no Google JavaScript on Explore at all. Three
  rules keep it that way. *The library is named in exactly one file*, `explore/navigation/Minimap.js`; the peg,
  label icons, crumbs, flags and `Task`'s street lines reach the map through its methods (`addMarker`,
  `setStreetLines`, `project`, `getZoom`, `getBounds`, `setBasemapVisible`) in plain `{lat, lng}` and DOM elements,
  and the map object is never handed out. *The basemap is code*, `MinimapBasemapStyle.js`: a sparse style (land,
  water, rivers, parks, buildings, roads, and road and water names in the UI language where OSM has one) built from
  the `main.css` tokens, reviewed like any other change; its tile host must also be in the CSP's `connect-src`. *A
  dead tile host degrades, never breaks*: `Minimap.create` resolves when the style is ready, not when tiles arrive,
  so streets, markers and fog draw over a blank background. *No map degrades too*: MapLibre needs WebGL2 and throws
  without it, so `create` never rejects; a minimap that can't be built says so in its place and draws nothing,
  `isAvailable()` turns false for the overlays drawn to its scale, and the rest of Explore starts
  (`Minimap_Unavailable` is logged). What Project Sidewalk itself draws on the map (street-line encodings, fog, cone)
  is `MinimapStyle.js`. The library is served as its own files rather than bundled (`docs/upgrading-libraries.md`
  says why), and the mission-complete map on the same page is still Mapbox, so Explore loads both libraries.
- **`common/`** — modules shared across bundles: `pano-viewer/` (an abstraction over the GSV / Mapillary / Infra3d /
  Panoramax / Pannellum imagery providers), `label-detail/` (label popups), and various utilities. The popup's pano viewer is
  built for the first label shown, never for a visit that opens none: Google bills every `StreetViewPanorama`
  constructed, hidden or not, and most visits to a hosting page never open a label (#5128). Only the free library
  download is scheduled early (`PanoViewer.preloadLibrary`). Deferring the build moves that cost to the first open,
  where the user is watching, so the card covers the wait with `.label-detail__pano-loading` until imagery paints.
  Infra3d's access token is minted server-side (`PanoDataService.getInfra3dToken`: an hour-long Cognito token, cached
  until it nears expiry), stamped into the page once, and renewed in place by `Infra3dViewer` through
  `GET /imageryAccessToken` five minutes before it expires, since the SDK has no refresh flow of its own. Failures
  inside a viewer that no return value carries reach the logs through `PanoViewer._fireDiagnostic`
  (`docs/logged-events.md`). A GSV search by location is held to its radius on our side: Google's `radius` is only a
  hint and has answered a 25 m query with a photosphere in another state (#5114), so `GsvViewer` treats a reply
  beyond `svl.STREETVIEW_MAX_DISTANCE` exactly like `ZERO_RESULTS`. Mapillary and Panoramax search a square box of
  that half-width, so their corners reach about 35 m; Infra3d checks the radius in `findPanoNear` but not yet in
  `setLocation`.
  `PanoViewer.setPano` types its rejections, because callers decide from them whether to give up on what needed the
  pano: `NoImageryError` means the provider no longer has it, `PanoLoadTimeoutError` means it didn't load in time or
  the network failed and the provider didn't say it is gone, and anything else is a failure on a pano the provider
  still has. `MapillaryViewer` holds only `moveTo` to its 12 s deadline, gives the linked-pano wait its own 4 s one
  that degrades to no links, and classifies a failure with one Graph API read of the image, capped at 3 s (#5581):
  only a 404 or Graph's "does not exist" error (code 100, subcode 33) makes it `NoImageryError`, since that verdict
  drops a Validate label, and a check that can't be made makes it `PanoLoadTimeoutError` whatever the SDK said, since
  offline or rate-limited the SDK fails fast rather than timing out. A move the SDK cancels for a newer one is
  rethrown unclassified. A viewer whose SDK draws the incoming pano before `setPano` resolves declares
  `static PAINTS_DURING_LOAD = true` (#5582). `setPov` returns nothing to wait on (MapillaryJS 4.1.2's `setCenter` and
  `setFieldOfView` return `undefined`), so a caller that must not show the old heading waits animation frames instead,
  as Validate's reveal does.

### Modules and the build

Every first-party file is an **ES module** (#4467): it `import`s what it needs and `export`s what others use, so
the imports decide load order, not a hand-kept list. Each tool keeps its shared state in one exported object
(`explore/svl.js`, `validate/svv.js`, `gallery/sg.js`). `util` is the object `common/utilities.js` exports; a file
that reads `util.misc`, `util.math`, `util.url` or `util.pano` imports the file that adds it (`utilitiesSidewalk.js`,
`utilitiesMath.js`, `urlQuery.js`, `pano-viewer/panoUtilities.js`). Vendor libraries (`mapboxgl`, `i18next`, `turf`, …)
stay `<script>`-tag globals, declared for the type checker in `tools/lint/js-types/globals.d.ts`.

**One entry per page** lives in `frontend/js/pages/` (`pages/explore.js`, `pages/admin/overview.js`, …): it imports
the page's code and runs its start-up. **Vite** (`vite.config.mjs`, Rolldown underneath) builds every file in that
folder to `public/build/js/<same path>.js`, minified, with code that several pages share split into
`public/build/js/chunks/` so a visitor downloads it once; a new page is just a new file there.
A view loads its entry with `<script type="module" src='@assets.path("build/js/<page>.js")'>`, after `pages/main.js`, which
`main.scala.html` loads on every page (shared helpers, app manager, navbar, auth dialog). Because a bundled module can't
be templated and runs only after the page is parsed, a view hands its entry the server's values on that tag as
`data-*` attributes (`id="page-entry"`) or, for the tools' larger sets, in a `<script type="application/json"
id="page-data">` block the entry parses. That block holds session scalars only (user, language, imagery source,
keys, Validate's filters): the mission or task a tool opens on is fetched by the entry (`common/pageSession.js`) from
`POST /validationTask/mission` or `GET /explore/session`, the latter with the page's own query string, so a copy of
the page the browser cached can never show labels the user already judged, and the first mission arrives in the same
shape as the next one (#5650). The tool pages also answer `Cache-Control: no-store` for the same reason.

The sources live in `frontend/`, outside `public/`, because Play serves everything under `public/`: only the bundles
ship (their sourcemaps carry the JS sources for the browser's debugger). **Stylesheets go through the same build**
(#5651): a module `import`s the stylesheet it depends on (`Toast.js` imports `toast.css`, a page's entry imports the
page's own sheet), and Vite writes them to `public/build/css/`, split by chunk, so a component several pages share is
one file they all load. Which files a page needs is only known after the build, so the build writes `manifest.json`
(Vite's [backend integration](https://vite.dev/guide/backend-integration)) and a view emits its tags with
`@ViteAssets.stylesheets("<entry>")` (`app/views/ViteAssets.scala`), which links the imported chunks' sheets before
the page's own, and a shared sheet before a chunk's own, so a page's rules come last. A page inside a layout that
links an entry of its own (the admin and user dashboards, the API docs) names it as `alreadyLinked = "<shell entry>"`,
so nothing is linked twice. A `url()` in a source stylesheet is the file's root-absolute path under `public/`
(`url("/images/icons/x.svg")`), which the build turns into the served `/assets/` URL. No Vite dev server: `npm start`
runs `npm run watch` (`tools/dev/watch-assets.mjs`, `vite build --watch` plus a restart when a page entry is added or
removed), so a save rebuilds into `public/build/` for `sbt run` to serve. Everything under `public/build/` is generated and
git-ignored. Third-party libraries live under `public/vendor/<lib>/`, one self-contained folder each (never edited or
linted).

First-party assets split by type: `frontend/js/` is JavaScript-only, `frontend/css/` holds all styles, and media
lives in `public/images/`, `public/audio/`, and `public/videos/`. Within `frontend/css/`, files are organized by what
they are (#5030): `main.css` and `fonts.css` at the root (tokens and `.ps-*` primitives), `css/components/` for
anything more than one page uses (one component per file — the `page-shell.css` sidebar + content + TOC template,
`kpi.css`, `tables.css`, `label-detail.css`, `toast.css`, …), and `css/pages/` for everything page-specific (a single
file per page, or a subdir for a multi-file page family such as `pages/explore/` or `pages/api-docs/`). A page's
stylesheet is imported only by that page's modules, every stylesheet is imported by something, a page's class prefix
(`ud-`, `ac-`, `svl-`, …) is defined only in that page's stylesheet(s), and a view that loads an entry's JS asks for
that entry's styles — `tools/lint/check-css-layout.mjs` (`make lint-css-layout`) enforces all four. Directories and CSS
files are kebab-case; JS files use Airbnb casing (PascalCase for class files, camelCase otherwise). See
[`style-guide.md`](style-guide.md) for the full layout and naming conventions.

**Assets are named by logical path, never by URL** (#4893). A Twirl template asks for one with `assets.path("…")`,
which resolves to the content-fingerprinted copy a staged build serves under a year-long `immutable` cache; a
hardcoded `/assets/…` string gets the one-hour default instead. JS can't call `assets.path`, so the app publishes the
answers: `build.sbt` names the asset families JS draws from (`assetManifestPrefixes`) and generates an inventory of
them, `AssetManifestService` resolves each through `AssetsFinder` at startup, and `main.scala.html` stamps the
resulting `{logical path → md5}` map onto every page as `window.assetDigests` — ahead of `utilities.js`, since the
tool bundles resolve icon URLs in module-level constants at script-eval time. Frontend code then writes
`util.assetPath('images/icons/openhand.cur')`, building the whole path inside one template literal when part of it
varies. Under dev `sbt run` nothing is fingerprinted, so the stamp is empty and every lookup falls back to the plain
`/assets/<path>`. Neither half of a mistake fails at runtime, so `tools/lint/check-asset-paths.mjs`
(`make lint-asset-paths`, a blocking CI step) is the gate: no hardcoded `/assets/` URLs under `frontend/js/`, every
`util.assetPath` argument names a real file in a manifest family, and no code edits an element's resolved `src` as a
string. Full caching contract: [`deployment-and-stages.md`](deployment-and-stages.md) → "Asset caching".

**Styling comes from the design-system tokens in `main.css` `:root`** — color ramps (`--color-*`), composite type
tokens (`--text-*`, complete `font` shorthands that bake in the tool-UI zoom factor `--ui-scale`), spacing, radii,
shadows, motion, and z-index layers — plus the component primitives `.button`, `.ps-input`, `.ps-select`, and
`.ps-table`. They mirror the "Design System Tokens" Figma; the rules for using them are in
[`style-guide.md`](style-guide.md). One coupling worth knowing: **`css/components/page-shell.css` is the shell
(`.page-*` classes) that the API docs, the admin dashboard, the user dashboard, and the labeling guide all build on**
for the sidebar + content + TOC layout and the base type, so a change there reaches all four;
`css/pages/api-docs/api-docs.css` holds only the docs' own components (`.preview-*`, `.map-toolbar`, status messages).

**Mobile detection has exactly one definition:** `ControllerUtils.isMobile`, a server-side User-Agent check that
decides which UI a request is served (mobile visitors get `/mobileLanding`, the mobile Validate page at `/mobile`,
and the shared auth pages; other pages redirect them). The shared layout stamps that verdict on every page as
`<html data-mobile-device>`, and client code reads it back through `util.isMobile()` — never re-sniff the UA in JS,
or client and server can disagree about which UI variant is running. Where the real question is touch-vs-hover
capability rather than "which variant is this page", use a media query (`pointer: coarse`) instead. The device
regex in the funnel-stats SQL classifies *stored* analytics rows by recorded OS name; it is analytics-only, never a
product gate. (The longer-term direction — responsive pages replacing the UA fork entirely — is
[#4875](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4875).)

## Internationalization

Two separate i18n systems:

1. **Backend** (server-rendered) — Play message files `conf/messages.<lang>`, referenced in Twirl with
   `@Messages("key")`.
2. **Frontend** (client-side) — JSON under `public/locales/<lang>/` (e.g. `common.json`), referenced with
   `i18next.t('key')` or, preferably, `data-i18n="ns:key"` in HTML.

Supported languages: en, es, de, nl, zh-TW, pt-BR, fr, plus regional English variants en-US and en-NZ.

## Configuration & deployment

- `conf/application.conf` is the base; environment overlays are `application.local.conf`, `application.staging.conf`,
  `application.test.conf`. Local dev runs with `application.local.conf`.
- Per-city settings live in `conf/cityparams.conf`, selected via the `SIDEWALK_CITY_ID` env var.
- Secrets/keys (Mapbox, Google Maps, Gemini, Mapillary, Infra3d, Silhouette signer/crypter, DB credentials) come
  from environment variables; local values live in a `docker-compose.override.yml`.

For how these configs map to hosted **stages** (test / staging / prod), how a branch or tag deploys to each, and the
production runtime shape, see [`docs/deployment-and-stages.md`](deployment-and-stages.md).

## Scripts and tools

A script lives where its caller is: [`scripts/`](../scripts/README.md) holds only what the running app shells out
to (`label_clustering.py`, bundled into the staged package by `build.sbt`), [`tools/`](../tools/README.md) holds
what a person or CI runs, sorted by caller (`lint/`, `dev/`, `city/`, `validation_queue/`, and the unmaintained
`one-off/` and `experiments/`), and [`db/scripts/`](../db/scripts/README.md) holds what runs inside the DB container.

`label_clustering.py` is invoked **in-band** (`ClusterService.runMultiUserClustering` shells out to it per region
during admin-triggered `/runClustering` and the nightly `ClusteringActor` run), so the deployed app must be able to
find and run it: `scripts/` is bundled into the staged package via `Universal / mappings` in `build.sbt`,
`ClusterService` resolves the script against the app root rather than the process working directory (a staged app
runs from the stage dir, not the repo root), and its `requirements.txt` deps must be installable on the `python3` the
app invokes. Don't add libraries to `requirements.txt` that have dropped 3.8.

Their pure logic is unit-tested under [`test/python/`](../test/python) (`pytest`, coverage gated at 100%) — one CI
run per interpreter, the in-band leg blocking and the offline-tooling leg advisory. See
[`docs/testing-and-ci.md`](testing-and-ci.md).

## Label types

Every label type (CurbRamp, NoCurbRamp, Obstacle, SurfaceProblem, Crosswalk, Signal, NoSidewalk, Other, …) has a
canonical color and icon set. The source of truth is the **`/v3/api/labelTypes`** endpoint; in frontend code use
`util.misc.getLabelColors(labelType)` rather than hardcoding hex values. See [`CLAUDE.md`](../CLAUDE.md) for the
canonical color table and icon locations.

Each type carries two independent domain facts, both published by that endpoint:

- **access impact** (`AccessImpact`, `access_impact`) — `problem` (a barrier), `feature` (something
  that helps), or `neutral` (Occlusion and Other). This drives framing and copy.
- **rating scale** (`RatingScale`, `rating_scale`) — `quality` (1 is good, 3 is bad), `severity`
  (1 is low, 3 is high), or `unrated` for a type whose labels never carry a 1–3 rating. Anything that *reads* a
  label's severity branches on this.

Neither derives from the other: Other is `neutral` but rated on the severity scale, NoSidewalk is a `problem` that
is unrated, and Signal is a `feature` that is unrated. Source both rather than hand-writing a list of type names —
`util.misc.isPositiveLabelType` is `rating_scale === 'quality'`, not an access-impact check.

`main.scala.html` stamps this whole table onto every page as `window.labelTypes` (like `window.assetDigests`), and
`utilitiesSidewalk.js` builds every frontend label-type list, colour and rating flag from it. A page that doesn't
stamp it gets an empty table, so `util.misc`'s lists come back empty rather than erroring.

## Where to go next

- [`docs/dev-environment.md`](dev-environment.md) — get it running locally.
- [`docs/deployment-and-stages.md`](deployment-and-stages.md) — hosted stages, branch/tag → stage deploys, prod runtime shape.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — workflow, coding standards, i18n, testing.
- [`docs/testing-and-ci.md`](testing-and-ci.md) — testing strategy and CI.
- [`docs/evolutions.md`](evolutions.md) — the rules for writing a schema change.
- [`CLAUDE.md`](../CLAUDE.md) — the short index of cross-cutting rules used as AI-assistant context.
