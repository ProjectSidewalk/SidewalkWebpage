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
- **Backend** — Scala 2.13 + Play Framework 3.0 (Java 17).
- **Database** — Postgres + PostGIS, accessed via Slick (with slick-pg for spatial/JSON types).
- **Frontend** — vanilla JavaScript, organized as several independent apps bundled by Grunt (concatenation only —
  no transpilation/module system). Migrating off jQuery and Bootstrap.
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
External imagery providers (Google Street View / Mapillary / Infra3d / Pannellum)

Out-of-band Python utilities: scripts/label_clustering.py, scripts/check_streets_for_imagery.py
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
  Authentication lives in `sidewalk_login`.
- **Evolutions** — schema changes are Play evolutions: numbered SQL files in `conf/evolutions/default/`, each with
  `# --- !Ups` / `# --- !Downs`, auto-applied at startup to every city schema. Numbers are gapless, a PR's changes go
  in one file, every new table gets `ALTER TABLE <name> OWNER TO sidewalk;` and its full set of constraints, and the
  SQL is written for production scale. The full rules are in [`docs/evolutions.md`](evolutions.md). The dev DB is
  seeded from a dump rather than built up from evolutions; the scripts that do that seeding (and other DB
  lifecycle/maintenance tasks) live in [`db/scripts/`](../db/scripts/README.md).

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

If either category outgrows its lane — thousands of files, multi-MB originals, a CDN or on-the-fly transforms in
front — the move is to object storage (S3/MinIO), never the local filesystem.

### Dependency injection & runtime

DI is Guice. The app bootstraps via `app/CustomApplicationLoader.scala`; modules are registered in
`conf/application.conf` and defined in `app/modules/` (`CustomControllerModule`, `ActorModule`, `ExecutorsModule`,
`SilhouetteModule`, and `StartupChecksModule` — the home for boot-time checks that surface deployment-level
misconfiguration, like `PersistentMediaDirCheck`). Custom execution contexts live in `app/executors/`; background
actors in `app/actor/`.

**Views** are Twirl templates (`app/views/*.scala.html`).

### Background jobs

Each deployment runs a set of nightly jobs as pekko actors in `app/actor/` — the imagery expiry sweep, the
imagery-age poll and freshness sync, street-priority recalculation, user and funnel stats, label clustering, OSM way
refresh, AI validations, and auth-token cleanup. The schedule lives in one place, `app/actor/ScheduledJobs.scala`:
each actor reads its own time from there, staggered across the small hours and shifted per city by
`ConfigService.getOffsetHours` so 50+ deployments don't contend for the same database and provider quotas.

Every run is bracketed by `JobRunService.record`, which writes a `background_job_run` row — start, finish, outcome,
and the job's own counts as JSONB (#4928). Without it, a job that silently stops firing is indistinguishable from one
that found nothing to do, since the absence of a log line is not something anyone notices. `/admin/health` renders
the roster, flagging any job that is overdue, failed, or has never run. The wrapper is strictly subordinate to the
job: a bookkeeping failure is logged and swallowed, and a job's own failure propagates unchanged.

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
  GeoPackage fields (`label_id`, `region_name`, `city_id`) — one canonical field name across those formats. For
  macro serializers, use a scoped `JsonConfiguration(JsonNaming.SnakeCase)` so `Json.format`/`Json.writes` emit
  snake_case; hand-build the `JsObject` with snake_case keys for nested/custom shapes.
- **Shapefile is the exception:** its fields stay **camelCase and abbreviated** (`labelId`, `regionName`,
  `neighborhd`, `cameraHdng`). The DBF format hard-truncates field names to 10 chars, so shapefiles can't carry the
  canonical snake_case names regardless of casing; camelCase reclaims the byte the underscore would waste. Shapefile
  is a legacy export being phased out — GeoPackage is the modern GIS export that carries the canonical snake_case names.
- v3 is a **preview** surface: breaking changes are made in place rather than minting a new version (precedent: #4223).

**Data structures (DTOs).** The response/filter types live in **`app/models/api/`** (`package models.api`), in
per-domain `*ApiModels.scala` files (`LabelApiModels.scala`, `StreetsApiModels.scala`, …). That is the canonical
home: a `*Table.scala` DAO *produces* its DTOs but never *defines* them (issue #3885). The convention:

- **Naming:** response types are `*ForApi` (`LabelDataForApi`, `UserStatForApi`); parsed query filters are
  `*FiltersForApi` (`RawLabelFiltersForApi`).
- **Streaming:** response DTOs extend `StreamingApiType` (`app/models/api/StreamingApiType.scala`) and implement
  `toJson` / `toCsvRow` inline on the case class, so `BaseApiController`'s `outputJSON`/`outputCSV`/`outputGeoJSON`
  helpers can serialize a stream of them uniformly. Serialization lives *on the DTO*, not as free functions elsewhere.
- **Companion object** holds the `csvHeader` string (next to `toCsvRow`, so columns can't drift) and the JSON writers.
- **Shared helpers:** reuse `ApiModelUtils` (`escapeCsvField`, `createGeoJsonPointGeometry`, `labelTypeOrdering`,
  `toSnakeKey`, …) rather than re-rolling CSV/GeoJSON logic.
- **Every `/v3` DTO's serialization lives in `models.api`.** There is no shared formats object for API output and no
  API serialization inline in a controller. The `app/formats/json/*Formats.scala` files serve the internal (non-`/v3`)
  endpoints only (issue #3891).

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
composited onto the crop (or a branded fallback) — cached under `share.image.directory`
(`SIDEWALK_SHARE_IMAGES_DIR`), the same mounted volume as label crops so share links persist across container
recreation; the per-city cache is LRU-bounded so the public, enumerable URL space can't fill the volume. To
support the anonymous landing, the `LabelController.getLabelData` read backing the label-detail popup was opened
to anonymous access.

## Frontend

Each major UI is a self-contained app under `public/js/`, bundled separately by Grunt and loaded by the
corresponding Twirl view:

- **`explore/`** — the Explore/Audit tool (label accessibility issues on street-view panoramas). The largest app.
- **`validate/`** — the Validate tool (confirm/reject others' labels).
- **`gallery/`** — browsable, filterable gallery of labels.
- **`admin-dashboard/`** — the admin dashboard (#4272), served file-by-file rather than bundled: one
  `<PageName>Page.js` per route, loaded by that page's Twirl template. `AdminShell.js` loads on every one of those
  pages and holds the shared formatting helpers (escaping, numbers, durations, relative times, the standard table
  markup).
- **`user-dashboard/`** — the redesigned user dashboard, settings, leaderboard, and public profiles, plus the admin's view of a user's dashboard (`/admin/user/:username`). Served file-by-file like `admin-dashboard/` — no Grunt bundle.
- **`api-docs/`** — the `/api-docs` reference pages: one `<endpoint>Preview.js` per page renders a live sample of
  that endpoint, alongside `apiDocs.js` (shell behavior), `apiTableWrapper.js`, and `apiDocsTheme.js`
  (`ApiDocsTheme.color(token, alpha?)`, the one way preview code reads a CSS color token for Chart.js/Mapbox so
  chart colors follow the design system). Served file-by-file — no Grunt bundle.
- **`ps-map/`** — shared map component used across pages.
- **`common/`** — modules shared across bundles: `pano-viewer/` (an abstraction over the GSV / Mapillary / Infra3d /
  Pannellum imagery providers), `label-detail/` (label popups), and various utilities.

There is **no module system**: files are concatenated in a hand-specified order (see `Gruntfile.js`). Third-party
libraries live under `public/vendor/<lib>/`, one self-contained folder each (never edited or linted). Edit `src/`
files only — bundles are generated into `public/js/*/build/`.

First-party assets split by type: `public/js/` is JavaScript-only, `public/css/` holds all styles, and media lives in
`public/images/`, `public/audio/`, and `public/videos/`. Within `public/css/`, files are organized by what they are
(#5030): `main.css` and `fonts.css` at the root (tokens and `.ps-*` primitives), `css/components/` for anything more
than one page links (one component per file — the `page-shell.css` sidebar + content + TOC template, `kpi.css`,
`tables.css`, `label-detail.css`, `toast.css`, …), and `css/pages/` for everything page-specific (a single file per
page, or a subdir for a multi-file page family such as `pages/explore/` or `pages/api-docs/`). A page's stylesheet is
linked only by that page, and a page's class prefix (`ud-`, `ac-`, `svl-`, …) is defined only in that page's
stylesheet(s) — `tools/check-css-layout.mjs` (`make lint-css-layout`) enforces both. Directories and CSS files are kebab-case; JS files use Airbnb casing (PascalCase for class files, camelCase
otherwise). See [`style-guide.md`](style-guide.md) for the full layout and naming conventions.

**Assets are named by logical path, never by URL** (#4893). A Twirl template asks for one with `assets.path("…")`,
which resolves to the content-fingerprinted copy a staged build serves under a year-long `immutable` cache; a
hardcoded `/assets/…` string gets the one-hour default instead. JS can't call `assets.path`, so the app publishes the
answers: `build.sbt` names the asset families JS draws from (`assetManifestPrefixes`) and generates an inventory of
them, `AssetManifestService` resolves each through `AssetsFinder` at startup, and `main.scala.html` stamps the
resulting `{logical path → md5}` map onto every page as `window.assetDigests` — ahead of `utilities.js`, since the
tool bundles resolve icon URLs in module-level constants at script-eval time. Frontend code then writes
`util.assetPath('images/icons/openhand.cur')`, building the whole path inside one template literal when part of it
varies. Under dev `sbt run` nothing is fingerprinted, so the stamp is empty and every lookup falls back to the plain
`/assets/<path>`. Neither half of a mistake fails at runtime, so `tools/check-asset-paths.mjs`
(`make lint-asset-paths`, a blocking CI step) is the gate: no hardcoded `/assets/` URLs under `public/js/`, and every
`util.assetPath` argument names a real file in a manifest family. Full caching contract:
[`deployment-and-stages.md`](deployment-and-stages.md) → "Asset caching".

**Styling comes from the design-system tokens in `main.css` `:root`** — color ramps (`--color-*`), composite type
tokens (`--text-*`, complete `font` shorthands that bake in the tool-UI zoom factor `--ui-scale`), spacing, radii,
shadows, motion, and z-index layers — plus the component primitives `.button-ps`, `.ps-input`, `.ps-select`, and
`.ps-table`. They mirror the "Design System Tokens" Figma; the rules for using them are in
[`style-guide.md`](style-guide.md). One coupling worth knowing: **`css/components/page-shell.css` is the shell
(`.page-*` classes) that the API docs, the admin dashboard, and the user dashboard all build on** for the sidebar +
content + TOC layout and the base type, so a change there reaches all three; `css/pages/api-docs/api-docs.css` holds only
the docs' own components (`.preview-*`, `.map-toolbar`, status messages).

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

Supported languages: en, es, de, nl, zh-TW, pt-BR, plus regional English variants en-US and en-NZ.

## Configuration & deployment

- `conf/application.conf` is the base; environment overlays are `application.local.conf`, `application.staging.conf`,
  `application.test.conf`. Local dev runs with `application.local.conf`.
- Per-city settings live in `conf/cityparams.conf`, selected via the `SIDEWALK_CITY_ID` env var.
- Secrets/keys (Mapbox, Google Maps, Gemini, Mapillary, Infra3d, Silhouette signer/crypter, DB credentials) come
  from environment variables; local values live in a `docker-compose.override.yml`.

For how these configs map to hosted **stages** (test / staging / prod), how a branch or tag deploys to each, and the
production runtime shape, see [`docs/deployment-and-stages.md`](deployment-and-stages.md).

## Python utilities

Two standalone scripts under [`scripts/`](../scripts) (see [`scripts/README.md`](../scripts/README.md)):

- `scripts/label_clustering.py` — clusters nearby labels (used by the clustering flow; see `ClusterService` /
  `app/models/cluster/`). Run as `python3` — the app shells out to it, so it has to work on the deployed server's
  system Python.
- `scripts/check_streets_for_imagery.py` — checks streets for available street-view imagery. Run as `python3.13`,
  the second interpreter the web image carries for offline tooling whose libraries have moved past 3.8.

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

## Where to go next

- [`docs/dev-environment.md`](dev-environment.md) — get it running locally.
- [`docs/deployment-and-stages.md`](deployment-and-stages.md) — hosted stages, branch/tag → stage deploys, prod runtime shape.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — workflow, coding standards, i18n, testing.
- [`docs/testing-and-ci.md`](testing-and-ci.md) — testing strategy and CI.
- [`docs/evolutions.md`](evolutions.md) — the rules for writing a schema change.
- [`CLAUDE.md`](../CLAUDE.md) — the short index of cross-cutting rules used as AI-assistant context.
