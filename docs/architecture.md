# Architecture

A tour of how Project Sidewalk is put together, for contributors getting oriented. For setup see
[`docs/dev-environment.md`](dev-environment.md); for the contribution workflow and coding standards see
[`CONTRIBUTING.md`](../CONTRIBUTING.md). [`CLAUDE.md`](../CLAUDE.md) is the AI-assistant-facing companion to this
document — same architecture, plus tool/operational notes for coding agents.

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
Browser (vanilla-JS apps: Explore, Validate, Gallery, Admin, Progress, PSMap)
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
  `# --- !Ups` / `# --- !Downs`. The dev DB is seeded from a dump rather than built up from evolutions; the scripts that
  do that seeding (and other DB lifecycle/maintenance tasks) live in [`db/scripts/`](../db/scripts/README.md).

### Dependency injection & runtime

DI is Guice. The app bootstraps via `app/CustomApplicationLoader.scala`; modules are registered in
`conf/application.conf` and defined in `app/modules/` (`CustomControllerModule`, `ActorModule`, `ExecutorsModule`,
`SilhouetteModule`). Custom execution contexts live in `app/executors/`; background actors in `app/actor/`.

**Views** are Twirl templates (`app/views/*.scala.html`).

### The public API (`/v3`)

The `/v3` API is the canonical public surface (handlers in `app/controllers/api/`). Conventions (issue #3871):

- **Query/REST parameters are camelCase** (`minSeverity`, `regionId`, `validationStatus`).
- **All output field names are snake_case** — JSON bodies, GeoJSON `properties`, CSV headers, and
  GeoPackage fields (`label_id`, `region_name`, `city_id`) — one canonical field name across those formats.
- **Shapefile is the exception:** its fields stay **camelCase and abbreviated** (`labelId`, `regionName`,
  `neighborhd`, `cameraHdng`). The DBF format hard-truncates field names to 10 chars, so shapefiles can't carry the
  canonical snake_case names regardless of casing; camelCase reclaims the byte the underscore would waste. Shapefile
  is a legacy export being phased out — GeoPackage is the modern GIS export that carries the canonical snake_case names.
- v3 is a **preview** surface: breaking changes are made in place rather than minting a new version.

The response/filter data structures (DTOs) live in **`app/models/api/`** (`package models.api`), in per-domain
`*ApiModels.scala` files (issue #3885). Response types are named `*ForApi`; parsed query filters are
`*FiltersForApi`. Response DTOs extend `StreamingApiType` and implement `toJson`/`toCsvRow` inline so the
`BaseApiController` helpers can serialize a stream of them uniformly.

### Public label-share surface (`/label/:id`)

A public, account-free share surface (issue #456, `ShareController`) lets a single label be linked externally.
`GET /label/:id` renders LabelMap focused on that label with server-rendered Open Graph / Twitter Card meta so a
pasted link produces a rich preview. `GET /label/:id/image` serves the preview image — self-hosted, with the
label-type marker composited onto the crop (or a branded fallback) — cached under `share.image.directory`
(`SIDEWALK_SHARE_IMAGES_DIR`), the same mounted volume as label crops so share links persist across container
recreation. To support the anonymous landing, LabelMap's `RegionController.listNeighborhoods` and
`AdminController.getLabelData` reads were opened to anonymous access.

## Frontend

Each major UI is a self-contained app under `public/javascripts/`, bundled separately by Grunt and loaded by the
corresponding Twirl view:

- **`SVLabel/`** — the Explore/Audit tool (label accessibility issues on street-view panoramas). The largest app.
- **`SVValidate/`** — the Validate tool (confirm/reject others' labels).
- **`Gallery/`** — browsable, filterable gallery of labels.
- **`Admin/`** — admin dashboards and maps.
- **`Progress/`** — user dashboards.
- **`PSMap/`** — shared map component used across pages.
- **`Help/`** — help/FAQ page.
- **`common/`** — modules shared across bundles: `pano-viewer/` (an abstraction over the GSV / Mapillary / Infra3d /
  Pannellum imagery providers), `label-detail/` (label popups), and various utilities.

There is **no module system**: files are concatenated in a hand-specified order (see `Gruntfile.js`); external
libraries live in `public/javascripts/lib/`. Edit `src/` files only — bundles are generated into
`public/javascripts/*/build/`.

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

## Python utilities

Two standalone scripts under [`scripts/`](../scripts) (see [`scripts/README.md`](../scripts/README.md)):

- `scripts/label_clustering.py` — clusters nearby labels (used by the clustering flow; see `ClusterController` /
  `app/models/cluster/`).
- `scripts/check_streets_for_imagery.py` — checks streets for available street-view imagery.

Their pure logic is unit-tested under [`test/python/`](../test/python) (`pytest`, advisory in CI). See
[`docs/testing-and-ci.md`](testing-and-ci.md).

## Label types

Every label type (CurbRamp, NoCurbRamp, Obstacle, SurfaceProblem, NoSidewalk, Crosswalk, Signal, Other, …) has a
canonical color and icon set. The source of truth is the **`/v3/api/labelTypes`** endpoint; in frontend code use
`util.misc.getLabelColors(labelType)` rather than hardcoding hex values. See [`CLAUDE.md`](../CLAUDE.md) for the
canonical color table and icon locations.

## Where to go next

- [`docs/dev-environment.md`](dev-environment.md) — get it running locally.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — workflow, coding standards, i18n, testing.
- [`docs/testing-and-ci.md`](testing-and-ci.md) — testing strategy and CI.
- [`CLAUDE.md`](../CLAUDE.md) — the same architecture plus conventions and operational notes, used as AI-assistant
  context.
