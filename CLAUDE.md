# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Project Sidewalk is a web-based crowdsourcing tool for mapping and assessing sidewalk accessibility. The backend is **Scala + Play Framework 3.0** (Scala 2.13, Java 17) with a **Postgres + PostGIS** database accessed via **Slick** (with slick-pg for spatial/JSON types). The frontend is **vanilla JavaScript**, organized as several independent apps that are bundled with **Grunt** (concatenation only — no transpilation/minification). Everything runs in **Docker** for development.

## Backend architecture

> Human-facing companion: [`docs/architecture.md`](docs/architecture.md) covers this same architecture as narrative
> contributor docs (and is what the README links to). Keep the two in sync when architecture changes; this file
> stays the AI-facing reference and adds the operational/tooling notes below.

Request flow: **routes → Controller → Service → Table (DAO)**.

- **`conf/routes`** — single routes file mapping URLs to controller methods. The public data API lives under `/v3/api/...` (handlers in `app/controllers/api/`).
  - **Any server-to-server POST authenticated by the internal key (`ControllerUtils.internalKeyValid`) needs a `+ nocsrf` modifier line** above it. Play's CSRF filter protects every unsafe request carrying an `Authorization` header, and a bearer token is exactly how these callers authenticate — so without the modifier the request 403s before it reaches the controller, and the endpoint looks alive while every real submission is rejected. This is invisible in local testing (a curl without the header 401s the same either way) and cost `/ai/submitLabelsOnPano` a silent outage (#4806). `internalKeyValid` fails closed on an unset key, so it, not CSRF, is the gate. Existing examples: `/clusteringResults`, `/ai/submitLabelsOnPano`.
  - **v3 API naming convention (issue #3871):** query/REST **parameters are camelCase** (`minSeverity`, `regionId`, `validationStatus`); **all output field names are snake_case** — JSON bodies, GeoJSON `properties`, CSV headers, and GeoPackage fields (`label_id`, `region_name`, `city_id`) — one canonical field name across those formats. For macro serializers, use a scoped `JsonConfiguration(JsonNaming.SnakeCase)` so `Json.format`/`Json.writes` emit snake_case. `ApiError.parameter` names a query param, so it stays camelCase. **Known exception — Shapefile/DBF:** shapefile fields stay **camelCase and abbreviated** (`labelId`, `regionName`, `osmWayId`, `neighborhd`, `cameraHdng`) because the DBF format hard-truncates field names to 10 chars, so they can't carry the canonical snake_case names regardless of casing — camelCase reclaims the byte the underscore would waste. Shapefile is a legacy export being phased out; **GeoPackage is the modern GIS export that carries the canonical snake_case names** (decided on #3871, 2026-06-25). v3 is a **preview** surface: breaking changes are made in place rather than minting a new version (precedent: #4223).
- **`app/controllers/`** — thin HTTP layer. Auth-protected actions use **Silhouette** (`SilhouetteModule.scala`, `app/models/auth/`). `app/controllers/api/` holds the versioned public API controllers.
- **`app/service/`** — business logic (e.g. `LabelService`, `ValidationService`, `ExploreService`, `AccessScoreService`, `ApiService`). Controllers should delegate here rather than touching tables directly.
- **`app/models/`** — Slick table definitions and queries, grouped by domain (`label/`, `validation/`, `mission/`, `region/`, `street/`, `route/`, `user/`, `cluster/`, `gallery/`, `api/`, ...). Files named `*Table.scala` define schema + queries (DAO pattern).
- **`app/models/utils/MyPostgresProfile.scala`** — custom Slick Postgres profile wiring in PostGIS geometry, JSON, and other slick-pg extensions. Spatial query helpers are in `SpatialQueryDefs.scala`.
- **DI**: Guice. App bootstraps via `app/CustomApplicationLoader.scala`; modules registered in `conf/application.conf` and defined in `app/modules/` (`CustomControllerModule`, `ActorModule`, `ExecutorsModule`, `SilhouetteModule`, `StartupChecksModule` — the last is the home for boot-time deployment-misconfiguration checks like `PersistentMediaDirCheck`, #4925). Custom execution contexts are in `app/executors/`; background actors in `app/actor/`.
- **Views**: Twirl templates (`app/views/*.scala.html`). The sbt build silences warnings in `views/` and the routes file specifically.

### API data structures (`app/models/api/`)

The data structures (DTOs) returned by the public `/v3` API live in **`app/models/api/`** (`package models.api`), in
per-domain files named `*ApiModels.scala` (`LabelApiModels.scala`, `StreetsApiModels.scala`, `UserStatsApiModels.scala`,
...). This is the canonical home — do **not** define new API DTOs inside `*Table.scala` DAO files (issue #3885). Each DAO
file produces its DTOs but the DTO *definitions* belong in `models.api`. The convention:

- **Naming**: response types are `*ForApi` (e.g. `LabelDataForApi`, `UserStatForApi`); parsed query filters are
  `*FiltersForApi` (e.g. `RawLabelFiltersForApi`).
- **Streaming**: response DTOs extend **`StreamingApiType`** (`app/models/api/StreamingApiType.scala`) and implement
  `toJson` / `toCsvRow` **inline** on the case class, so `BaseApiController`'s `outputJSON`/`outputCSV`/`outputGeoJSON`
  helpers can serialize a stream of them uniformly. Serialization lives *on the DTO*, not as free functions elsewhere.
- **Companion object** holds the `csvHeader` string (keep it next to `toCsvRow` so columns can't drift) and JSON writers.
- **snake_case JSON** per #3871: derive writers with a scoped `JsonConfiguration(JsonNaming.SnakeCase)` +
  `Json.format`/`Json.writes`, or hand-build the `JsObject` with snake_case keys for nested/custom shapes.
- **Shared helpers**: reuse `ApiModelUtils` (`escapeCsvField`, `createGeoJsonPointGeometry`, `labelTypeOrdering`,
  `toSnakeKey`, ...) rather than re-rolling CSV/GeoJSON logic.

**Every `/v3` DTO's serialization lives in `models.api` — there is no shared formats object for API output, and no
API serialization inline in a controller.** The `app/formats/json/*Formats.scala` files serve the internal (non-`/v3`)
endpoints only; don't route API writers through them (issue #3891).

### Database & evolutions

Schema changes are **Play evolutions**: numbered SQL files in `conf/evolutions/default/`. Add the next-numbered file for schema changes; each has `# --- !Ups` and `# --- !Downs` sections. **Numbers must be gapless**: Play's evolutions reader walks 1, 2, 3, … and stops at the first missing file, so a file that skips ahead of a number an in-flight PR "owns" is silently never read — the app boots fine and the evolution just doesn't apply. Always take exactly `highest-on-your-branch + 1` and resolve any collision with other in-flight PRs at merge time via the renumbering flow below. **One evolution file per PR:** all of a PR's schema changes go in a single file, even when they land in separate commits or feel like separate concerns — until the PR merges, nothing has shipped, so fold later changes into the existing file instead of minting the next number (which also collides faster with other in-flight PRs).

**Renumbering after a merge from `develop`.** In-flight PRs claim numbers concurrently, so a merge routinely lands
someone else's file on the number yours is using. Renumber yours (never theirs — theirs has shipped):
1. `git mv conf/evolutions/default/<old>.sql conf/evolutions/default/<new>.sql`, where `<new>` is one past the highest
   number now in the directory. Grep the repo for the old number and update every reference — evolution comments, PR
   description, planning docs, the branch's own commit messages if you're rewriting them.
2. Load any page. The local DB needs no manual cleanup: Play stores each applied evolution's `revert_script` in
   `<schema>.play_evolutions`, so when develop's file lands on the id yours was applied under, the hash mismatch makes
   it run *your* saved downs and then develop's ups, followed by your new number's ups. `autoApply` and
   `autoApplyDowns` are both on, so this is silent. It does mean **your Down has to actually work** — a broken one
   fails here and leaves the row in `applying_down`, which is the state that produces Play's "inconsistent state"
   error and does need hand-fixing.

The dev DB is seeded from a dump — see [`db/scripts/README.md`](db/scripts/README.md) for the full DB lifecycle/maintenance scripts (`import-dump`, `create-new-schema`, etc., exposed as `make` targets). Connection config is env-driven (`DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD`) in `conf/application.conf`.

**Every `CREATE TABLE` must be followed by `ALTER TABLE <name> OWNER TO sidewalk;`** in the same evolution (see 309.sql for the pattern). On the prod server, evolutions run as an admin role, so a new table would otherwise be owned by that role and the `sidewalk` app role would lack permissions on it. This applies to **tables only** — it's easy to forget, and a missed one has to be patched by a later evolution (e.g. 321.sql fixed 314.sql; 329.sql fixed 326.sql/327.sql). Note:
- **SERIAL / identity sequences** are covered automatically: `ALTER TABLE … OWNER TO` recursively reassigns any sequence a column owns, so no separate statement is needed for them.
- **Enum types, views, and standalone (non-column-owned) sequences do *not* get an owner change** — the app only needs default `USAGE`/`SELECT` on those, which it already has, and they're never altered at runtime. Don't add `OWNER TO` for them.

**Write evolution SQL for production scale, and finish every evolution with an explicit efficiency pass.** The dev
DB is small enough that any SQL looks fast; prod tables are not (`label`, `label_validation`, `label_history` run to
hundreds of thousands of rows per schema, `user_stat` to ~1M, and evolutions apply to **every** city schema in
sequence on deploy — a slow statement multiplies by 54). Concretely:
- **Prefer joins to correlated subqueries.** A scalar subquery in a SELECT list or a per-row `IN (SELECT …)` /
  `NOT IN (SELECT …)` re-executes per outer row; the same lookup as a `JOIN`/`LEFT JOIN` (or `EXISTS`/`NOT EXISTS`,
  which the planner turns into semi/anti-joins) lets the planner pick a hash join and stays fast when the outer set
  is large. `NOT IN` also has the NULL trap: one NULL in the subquery result silently empties the whole result set.
- **A join can keep a scalar subquery's fail-loudly property.** If a scalar subquery is doing double duty as a
  one-to-one assert ("more than one row returned"), a `LEFT JOIN` that fans out into a PRIMARY KEY/UNIQUE violation
  on the receiving table fails just as loudly with a better plan — don't let the assert justify the slow form.
- **Before an evolution is done, walk every statement and name its access path** on the big tables: which index
  serves each join/filter column (check with `\d` — don't assume), and what the driving row count is at prod scale.
  A statement with no index behind it on a large table needs a rewrite or a justification comment.
- This came out of PR #4866 review — reviewer-observed pattern: subquery-shaped SQL that is invisible on dev
  "can take our evolutions to a crawl when the evolutions run on prod."

**Give every table its full set of constraints — don't lean on the app to enforce integrity.** When you `CREATE TABLE` (or `ALTER` one), add every constraint the data model implies: `NOT NULL` on any column the app never writes null to, `UNIQUE` on a natural key or one-to-one relationship (or make it the `PRIMARY KEY`), a `FOREIGN KEY` for every reference to another table, and a `CHECK` for a bounded domain (a severity `1`–`3`, a non-negative count, a `0`–`1` fraction, a valid lat/lng). A missing constraint silently rots into bad data — backfilling ones that should have been there from the start has cost whole PRs (#3574 for FKs, #3944 for NOT NULL/UNIQUE/PK/CHECK). **Mirror each in the Slick model** so schema and code agree: a non-`Option` `column[T]` means `NOT NULL`, `def pk = primaryKey(...)` declares a composite PK (single-column PKs use `O.PrimaryKey` inline), `index(..., unique = true)` a UNIQUE, and `foreignKey(...)` an FK. A column `DEFAULT` is mirrored with `O.Default(...)` (#4801) — it's DDL-only in Slick and we never generate DDL, so it's documentation, but a `*Table.scala` should say what the schema does. Two things `O.Default` can't express, because it holds a *value* rather than an expression: a **volatile default** (`now()`, `CURRENT_TIMESTAMP`) — mirroring one as `O.Default(OffsetDateTime.now)` freezes an arbitrary instant into the model and re-evaluates it on every query compilation, so write `// DEFAULT now() in the DB` instead; and a **CHECK constraint**, which has no Slick DSL at all — leave a comment noting the invariant.

**Closed value sets: prefer enum types or CHECKs over lookup tables and bare text (#4103).** When a column can only hold a fixed set of values, pick between two tools. Use a **Postgres enum type** when the column is on a high-row-count table, is written at runtime, or is mirrored by a Scala enum — it makes the DB self-describing (readable raw SQL and dumps, no join to a lookup table, no hand-maintained Scala id map that nothing validates) and fails loudly on drift. Wire it up like the existing ones (`pano_source`, `validation_option`, `street_edge_status`, `mission_type`, `way_type`): a Scala `Enumeration` object whose string values match the enum labels, plus a `createEnumJdbcType` mapper in `MyPostgresProfile`. Growing a set later is fine — `ALTER TYPE ... ADD VALUE` has prod precedent (331/332/339). Use a plain **`CHECK (col IN (...))`** instead for tiny script-seeded config/cache tables (e.g. `config.open_status`, `funnel_stat.funnel_type`), where the enum's join/space/mapping benefits are nil. Two gotchas: tables and types share a namespace, so when an enum replaces a lookup table of the same name, `DROP TABLE` must precede `CREATE TYPE`; and enum values are compared as enum literals in SQL, so a raw-SQL filter built from user input must validate values first (an invalid literal is a Postgres error, not an empty result).

**Postgres does *not* rename a table's constraints or indexes when you rename the table or a column** — the old name sticks and silently drifts from what it enforces. So an evolution that renames a column (or table) must also `ALTER TABLE … RENAME CONSTRAINT` / `ALTER INDEX … RENAME` every constraint and index whose name embeds the old identifier, back to the `<table>_<column>_{fkey,key,pkey,check}` convention, and update the matching name string in the Slick model (`foreignKey`/`index`/`primaryKey`). Skipping this forces a later evolution to patch the fossils — 337.sql had to rename three, e.g. `user_org_org_id_fkey` → `user_team_team_id_fkey`, left over from an old `user_org` → `user_team` table rename.

**A new table that `ConfigTable`'s cross-schema fan-out queries read is exposed during the rollout window**, when an
updated instance can query a city schema that hasn't applied the evolution yet — see
[`docs/deployment-and-stages.md`](docs/deployment-and-stages.md) → "Adding a table that cross-schema queries read" for
the two ways to handle it.

## Frontend architecture

Each major UI is a self-contained app under `public/js/`, bundled separately by Grunt and loaded by the corresponding Twirl view. (Directory names are kebab-case; the app's internal JS namespace global may still use its old short name — see the `svl`/`sg` note below.)

- **`explore/`** — the Explore/Audit tool (users label accessibility issues on street-view panoramas). The largest app; internal namespace global is still `svl`.
- **`validate/`** — the Validate tool (users confirm/reject others' labels).
- **`gallery/`** — browsable gallery of labels with filtering; internal namespace global is still `sg`.
- **`admin-dashboard/`** — the admin dashboard (#4272), served file-by-file rather than bundled: one `<PageName>Page.js` per route, loaded by that page's Twirl template, with shared helpers in `AdminShell.js`.
- **`user-dashboard/`** — the redesigned user dashboard, settings, leaderboard, and public profiles (#4323), plus the admin's view of a user's dashboard (`/admin/user/:username` and its `/manage` page, #4964). Served file-by-file like `admin-dashboard/` — no Grunt bundle.
- **`api-docs/`** — the `/api-docs` reference pages: one `<endpoint>Preview.js` per page renders a live sample of that endpoint, with `apiDocs.js` (shell behavior), `apiTableWrapper.js`, and `apiDocsTheme.js` (`ApiDocsTheme.color(token, alpha?)` — the one way preview JS reads a CSS color token for Chart.js/Mapbox, so chart colors follow the design system). Served file-by-file — no Grunt bundle.
- **`ps-map/`** — shared map component used across pages.
- **`help/`** — help/faq page (rarely used).
- **`common/`** — shared modules pulled into multiple bundles: `pano-viewer/` (abstraction over GSV / Mapillary / Infra3d / Pannellum imagery providers), `label-detail/` (label popups), and various utilities.

No npm-based module system on the frontend — files are simply concatenated in order. Third-party libraries live under `public/vendor/`, one self-contained folder per library (its JS + CSS + fonts + images together, upstream layout preserved). **Nothing under `vendor/` is edited or linted.**

**Reference every asset through `assets.path("...")` in Twirl, never a hardcoded `/assets/...` string.** `stage`/`dist` content-fingerprints assets (sbt-digest), and only `assets.path` resolves to the fingerprinted URL that gets a one-year `immutable` cache; a hardcoded path falls back to the one-hour default, which is *unsafe for files swapped in place* — its ETag ignores content, so replacing a file's bytes under the same name never invalidates cached copies. Full contract: [`docs/deployment-and-stages.md`](docs/deployment-and-stages.md) → "Asset caching".

**Asset layout (going-forward invariant, from the #2292 reorg).** First-party assets split **by type**: `public/js/` is JavaScript-only, `public/css/` holds all styles, organized **by what each file is** (#5030) — its root has exactly four entries: `main.css` + `fonts.css` (tokens and `.ps-*` primitives, no layout knowledge); `css/components/` for anything more than one page links — one component per file with a `ps-` or component-named prefix (`page-shell.css`, `kpi.css`, `tables.css`, `label-detail.css`, `toast.css`, …); and `css/pages/` for everything page-specific — a single file for a single page (`about.css`, `auth.css`, `admin-dashboard.css`, `user-dashboard.css`, …) and a subdir for a page family with several files (`pages/explore/`, `pages/validate/`, `pages/gallery/`, `pages/api-docs/`). Media lives in `public/images/`, `public/audio/`, `public/videos/`. There are **no `css/`, `img/`, or `audio/` dirs nested inside an app dir under `js/`** — app-private styles go to `css/pages/` and app-private images to `images/<app>/`. Third-party code groups by library under `vendor/` (never `js/` or `css/`).

**Two rules keep that split honest, and `make lint-css-layout` (`tools/check-css-layout.mjs`, a blocking CI step) enforces them:** every entry under `pages/` is registered in the lint's `PAGES` map with the views that may link it — its own page, or for the Grunt-bundled tools, its own bundle (the two legacy exceptions, `homepage.css` and `auth.css`, are registered to `common/main.scala.html` and so load site-wide) — and an unregistered file fails the lint; the moment a second page needs a rule, it moves to `css/components/`; and a page's class prefix (`ud-`, `ac-`/`ov-`/`dq-`/…, `svl-`, `svv-`, `gallery-`) is defined only in that page's stylesheet(s). Layouts link the shell plus only the component files their pages use — never `@import` (Play fingerprints per file, and an import adds a serial round trip).

**`css/components/page-shell.css` is the sidebar + content + TOC shell (`.page-container`, `.page-content`, `.page-section`, `.page-heading`, `.page-sidebar`/`.page-nav-*`, `.page-toc`, plus the base type/link/code styles).** Three surfaces link it — the API docs (`apiDocs/layout.scala.html`), the admin dashboard (`admin/dashboard/adminLayout.scala.html`), and the user dashboard (`userDashboard/layout.scala.html`) — so a change there is a change to all three. `css/pages/api-docs/api-docs.css` is docs-only (`.preview-*`, `.map-toolbar`, status messages, download buttons). All three style everything from the `main.css` tokens and primitives (see "Style all UI from the design-system tokens" under Development Guidelines) — a `--font-size-*` / `--color-text-*` name is a leftover from the pre-#4300 alias block, not a token to use.

**Naming conventions (from #2292):** directories are **kebab-case**; CSS files are **kebab-case**; JS files follow Airbnb style — **PascalCase** for files that define a class/constructor (`AppManager.js`, `LabelPopup.js`), **camelCase** for function/utility/entry files (`main.js`, `aggregateStats.js`). Kebab-case is not used for JS files. Full write-up in [`docs/style-guide.md`](docs/style-guide.md). **Deferred mismatch:** the app dirs were renamed (`SVLabel → explore`, `SVValidate → validate`, `Progress → user-dashboard`), but the internal JS namespace *identifiers* `svl` (Explore) and `sg` (Gallery) were left as-is — renaming those is a large independent refactor, not part of the file reorg.

**Mobile detection has one definition: `ControllerUtils.isMobile` (server-side UA regex).** It gates which UI a
request is served (mobile → `/mobileLanding`, `/mobile`, the shared auth pages; other pages redirect), and
`main.scala.html` stamps its verdict on every page as `<html data-mobile-device>`; client code asks
`util.isMobile()`, which reads that stamp — never re-sniff the UA in JS (#4887; `MobileDetectionSpec` pins the
stamp). For touch-vs-hover behavior questions, use a capability query (`pointer: coarse` — see `ShareWidget.js`)
rather than the mobile flag. The device regex in `FunnelStatTable.scala` classifies stored analytics rows by
recorded OS name and is analytics-only, never a product gate. (Longer-term direction: #4875.)

## Internationalization
Two separate i18n systems:
1. **Backend**: Play i18n with message files in `conf/messages/` (server-rendered strings)
2. **Frontend**: JSON files in `public/locales/{lang}/common.json` (client-side strings)

Supported languages: en, es, nl, zh-TW, de, pt-BR, en-US, en-NZ.

User-facing text changes require translations for all supported languages

**Backend: English goes in `messages.en`, never the base `messages` file.** For a `@Messages("...")` key, put the
English string in **`conf/messages/messages.en`** and a (best-effort, machine-translation-OK) translation in **each**
`messages.<lang>` (`.es`, `.nl`, `.de`, `.pt-BR`, `.zh-TW`). The base **`conf/messages/messages`** (no suffix) is the
Play *default/fallback* file — reserve it for genuinely language-neutral values (city-name proper nouns, way-type keys)
and never add translatable English prose there. **The common trap:** doing an English-only first pass and dropping the
strings into the base `messages` (it looks like "the English/default file"), then adding `messages.en` + `messages.<lang>`
in a later translation pass — which leaves a stale, duplicated English copy in the base file. Even the English-only
first pass belongs in `messages.en`. (Regional English overlays `messages.en-US`/`messages.en-NZ` fall back through
`messages.en`; the other languages fall back straight to the base default, so a missing `messages.<lang>` key shows the
raw key — which is why every language file must carry the key.)

Lean towards using `data-i18n="ns:key"` in HTML so that we can keep the translations in the i18next JS library and reduce duplicate translations.

Full details (both systems, regional `en-US`/`en-NZ` rules, adding a new language): [`docs/internationalization.md`](docs/internationalization.md).

## Configuration

- `conf/application.conf` is the base; environment overlays are `application.local.conf`, `application.staging.conf`, `application.test.conf`. `npm start` runs with `application.local.conf`.
- Per-city settings: `conf/cityparams.conf` (selected via `SIDEWALK_CITY_ID`). Many secrets/keys come from env vars (Mapbox, Google Maps, Gemini, Mapillary, Infra3d, Silhouette signer/crypter); dev defaults are dummy values in `docker-compose.yml`, with real local values in `docker-compose.override.yml` (hidden from Claude, ask if you need to know something like the city-id).

## Python utilities

Two standalone scripts in **`scripts/`**, invoked out-of-band rather than from the running web app. Full usage in [`scripts/README.md`](scripts/README.md):

- `scripts/label_clustering.py` — clusters nearby labels. This one is invoked **in-band**: `ClusterService.runMultiUserClustering` shells out to `scripts/label_clustering.py` per region during admin-triggered `/runClustering` and the nightly `ClusteringActor` run (see `app/service/ClusterService.scala` / `app/models/cluster/`). If you move/rename it, update that invocation path. Because it runs in-band, the deployed app must be able to find it: `scripts/` is bundled into the staged/dist package via `Universal / mappings` in `build.sbt`, and `ClusterService` resolves the script against the app root (Play `Environment`) rather than the process working directory — a staged app runs from the stage dir, not the repo root, so a working-directory-relative path or an unbundled script fails with a cryptic python exit-2 ("can't open file"). Its `requirements.txt` deps must also be installed in the `python3` the app invokes.
- `scripts/check_streets_for_imagery.py` — checks streets for available street-view imagery (related: `make hide-streets-without-imagery`). Resolves its data files relative to the repo root, so it runs from any working directory.

**The web image carries two interpreters, and which one a script uses is a constraint, not a preference (#4396).** `python3` is the base image's **3.8** — EOL, but it is what the deployed app shells out to, so `label_clustering.py` and its `requirements.txt` pins must stay installable there. `python3.13` (a uv-fetched standalone CPython) runs everything offline and holds `requirements-offline-tools.txt`, which needs ≥ 3.11. This mirrors prod: makelab1 runs the app on Rocky's system Python, user accounts have 3.13. So **run offline tooling as `python3.13 scripts/...`, and don't add libraries to `requirements.txt`** — anything current has dropped 3.8. `requirements-dev.txt` installs into both, environment markers giving each its newest usable pytest.

Each script's pure logic is refactored into importable functions and **unit-tested** under `test/python/` (`pytest`). Keep I/O (HTTP/file) in thin wrappers and `main` so the logic stays testable. The suite splits along the same line: `make test-python` runs both halves, each taking the whole directory *minus* the one file the other interpreter owns (`--ignore`, in the `Makefile`'s `pytest-args-*` and mirrored in the CI matrix), so **a new test file runs in both halves by default**. Coverage is always on and gated at 100% via `source = ["scripts"]`, so a script arriving with no tests is reported at 0%; each half sets **`COVERAGE_OMIT`** to the script it can't import.

## Label Type Colors and Icons

Every label type has a **canonical color** and a set of **icon images**. Always use these — never invent substitute colors.

| Label Type     | Color     |
|----------------|-----------|
| CurbRamp       | `#90C31F` |
| NoCurbRamp     | `#E679B6` |
| Obstacle       | `#78B0EA` |
| SurfaceProblem | `#F68D3E` |
| NoSidewalk     | `#BE87D8` |
| Crosswalk      | `#FABF1C` |
| Signal         | `#63C0AB` |
| Other          | `#B3B3B3` |
| Occlusion      | `#B3B3B3` |

**Icons** live in `public/images/icons/label_type_icons/`. The colored marker every label type is drawn with is the
scalable `{LabelType}_small.svg`, and it is **the only variant our own pages may use** — `util.misc.getIconImagePaths(labelType).iconImagePath`
returns it, and that accessor is the one way frontend code should name an icon. Reach for it even when the icon is
going somewhere a raster feels natural: the Explore canvas rasterizes it once at high resolution
(`Label.preloadIcons`) and the labeling cursor is rasterized from that same cache, because a fixed-size PNG upscales
badly on the HiDPI canvas.

Three raster sizes sit beside it — `{LabelType}.png` (large; a *different*, grayscale illustration used by the
ribbon menu, not a bigger copy of the marker), `{LabelType}_small.png`, and `{LabelType}_tiny.png`. They exist only
for consumers that cannot take vector art: server-side share-image compositing (`ShareController`, via Java
`ImageIO`) and the `icon_url`/`small_icon_url`/`tiny_icon_url` fields published by `/v3/api/labelTypes`. Adding a
frontend use of one is a bug. The canonical source of truth for colors and icon URLs remains `/v3/api/labelTypes`.

**In JavaScript:** call `util.misc.getLabelColors(labelType)` — defined in
`public/js/common/UtilitiesSidewalk.js` and loaded on every page that includes
`app/views/apiDocs/layout.scala.html` or the main app bundles. Do **not** hardcode the hex values in
feature code; use `getLabelColors()` so colors stay in sync automatically.

## Backend is the source of truth — avoid hardcoded literals in the frontend

The [Label Type Colors and Icons](#label-type-colors-and-icons) rule (colors/icons come from
`/v3/api/labelTypes`, read via `getLabelColors()`) is one instance of a broader discipline: **domain values —
enum members, value ranges (min/max), thresholds, and especially the *mappings* between them — must come from
the backend** (a `/v3/api/...` endpoint, or a value the controller injects into the Twirl view), **not be
re-declared as literals in JavaScript.** A hardcoded frontend copy silently drifts from the backend the moment
either side changes, and nothing catches it.

**The trap: a value that *looks* trivial often encodes domain logic.** Severity is `1`–`3`, but the
`good`/`ok`/`bad` interpretation is **not** a fixed mapping. **Positive** access features (e.g. curb ramps,
where the feature's *presence* is good) and **negative** access features (e.g. obstacles, surface problems,
where presence is bad) map severity to quality in **opposite** directions. So a frontend
`const quality = {1: 'good', 2: 'ok', 3: 'bad'}` is wrong for half the label types — and even if it were
right today, it would rot the next time the backend's logic changed. This is exactly the kind of literal to
never hand-write on the frontend.

**What to do, in order of preference:**
1. **Source it** — pull the value/range/mapping from an existing API endpoint, or from a value the controller
   passes into the view.
2. **Expose it** — if no such source exists but the value is non-trivial or shared with the backend,
   add/extend an endpoint or view binding to surface it, and treat that as part of the task rather than
   hardcoding a copy.
3. **Centralize + justify** — only if a literal is genuinely unavoidable (a purely presentational constant
   with no backend counterpart), define it in one place and comment *why* it isn't sourced from the backend.

When you catch yourself writing a frontend constant that mirrors a backend value, stop and source it instead.

## Development Guidelines
- Main development branch is **develop**; **master** is the release branch. PRs target `develop`.
- **Never open a pull request (or merge/tag/release) without the maintainer's specific OK.** Do the work, run the
  CI-equivalent checks locally, and push the branch if useful — then stop and ask before running `gh pr create`.
  Filing GitHub *issues* is fine; the consent gate is at PR creation, and again (separately) at merge.
- **Deploying to production is tag-triggered, not branch-triggered:** pushing `develop` redeploys the **test** stage, but prod only deploys when a **`vX.Y.Z` GitHub Release/tag** is cut on `master`. Cutting a release also requires bumping `build.sbt` **and** adding a `version`-table evolution (the two are separate: the tag deploys the code, the evolution updates the displayed version). Full step-by-step runbook: [`docs/deployment-and-stages.md`](docs/deployment-and-stages.md) ("Cutting a release").
- **Maintainers / GitHub @-mentions:** Project Sidewalk is maintained by **@jonfroehlich** (Professor Jon Froehlich) and
  **@misaugstad** (Mikey / Michael Saugstad).
- If there is an associated Github issue, beging the branch name with the issue number (e.g. `1234-fix-label-popup`).
- When changing JS behavior, edit `src/` and let `grunt watch` rebuild; if a new `src/` file isn't picked up, check that its path matches a glob in `Gruntfile.js`.
- When updating code in JavaScript, migrate it to modern ECMAScript — we target **ES2022** (the `ecmaVersion` in [`eslint.config.js`](eslint.config.js)): `let`/`const` instead of `var`, arrow functions, `#private` class fields, `async`/`await`, optional chaining (`?.`), etc.
- Build HTML strings with **template literals, never `+` concatenation**, indenting the markup inside the backticks to mirror its HTML nesting (ESLint doesn't reformat template-literal interiors). The newlines/indent become part of the string, so when converting an old concatenation, check the target container's CSS first — safe in block/flex/grid containers and collapsible inline text, but a plain inline container gains a visible space, and a line break inside an attribute value (e.g. `title="..."`) renders literally. `eslint --fix` can't do this conversion (`prefer-template` ignores literal-plus-literal chains), so convert by hand as you touch code. Full write-up: [`docs/style-guide.md`](docs/style-guide.md).
- When refactoring a JS constructor function (the `function Foo(...) { const self = this; ... return self; }` pattern), convert it to a `class`. Use `#` private fields/methods. Use arrow functions in event listeners to keep `this` bound correctly.
- Update said code to use the native `fetch` API rather than jQuery, and to make use of Promises. But if said refactor would impact many other functions that use it, then wait for a dedicated refactor.
- Replace uses of Bootstrap with native JS alternatives as you come across them
- When writing SQL, avoid table aliases
- **Measure geographic distances geodesically** — `ST_Length(geom::geography)` in raw SQL, the `lengthGeodesic`
  extension method in Slick (defined in `MyPostgresProfile`), turf.js on the frontend. Never measure by projecting to
  a fixed SRID: a projection is only accurate near its own meridian, and measuring every city through UTM zone 18N
  overstated street distances by up to +51% (#4641). Cached distance columns (`user_stat.meters_audited`,
  `labels_per_meter` and the `high_quality` flag derived from it, `region_completion`, `route.distance_meters`) must
  equal what their runtime recompute would produce, so changing a distance query means recomputing its caches in the
  same evolution — and the nightly refresh that maintains them has to reach every row a full recompute would touch
  (#4774). `GeodesicDistanceSpec` checks both against the connected database. It needs a *seeded* one: its
  cache-freshness tests `assume` non-empty tables and CANCEL otherwise, so treat a full-suite run against your dev DB
  as the real gate.
- After editing any Scala file, run `make scalafmt-fix` (reformats the whole tree in place via the sbt thin client) before treating the change as done — scalafmt is a blocking CI gate, so unformatted Scala fails the build. One run after a batch of edits is enough; no need to format after every single edit.
- After editing frontend files, lint what you touched and get to zero before the change is done. All four frontend linters are **blocking CI gates** (steps in the `frontend` job — see Continuous integration), the JS/CSS/HTML/i18n counterparts to the scalafmt rule above, so a finding fails the build. The whole tree is lint-clean (#2487), so any finding is from your change.
  - **JavaScript** (`public/js/`): `make eslint-fix dir=<what you touched>`, hand-fix what `--fix` can't, until `make eslint` passes.
  - **CSS** (`public/css/`): `make stylelint-fix dir=<…>`, then `make stylelint`.
  - **HTML** (Twirl views in `app/views/`): `make htmlhint`.
  - **Translation JSON** (`public/locales/`): `make eslint` (per-file validity/dup-key checks) plus `make lint-locales` (cross-locale key parity).
  - **CSS layout** (`public/css/` + the views' `<link>`s): `make lint-css-layout` (page stylesheets linked only by their page, page prefixes only in their page's files, every linked file exists).
  - `make lint` runs all of them (plus the evolutions lint) at once; `make lint-fix` autofixes the ESLint + Stylelint mechanical findings.
- User interactions are logged (clicks, key presses, mode switches, pano changes, mission/task events, etc.) to the activity/interaction tables. When you **add or change an interaction**, add or adjust the corresponding logging so analytics stay complete; keep event names consistent with the existing ones, and update [`docs/logged-events.md`](docs/logged-events.md) (how logging works + the event reference).
- Ensure WCAG 2.1/2.2 Level AA accessibility standards are met
- **Style all UI from the design-system tokens in `main.css` `:root`** — colors (`--color-*`), type (`--text-*`),
  spacing (`--space-*`), radii (`--border-radius*`), elevation (`--box-shadow*`), motion (`--transition-*`),
  stacking (`--z-index-*`), breakpoints (`--breakpoint-*`, reference values — `var()` can't appear in a media query,
  so write the px and name the token in a comment), and the component primitives (`.button-ps` + `.button--*`,
  `.ps-input` / `.ps-select` (+ `--large`), `.ps-table` (+ `--compact`, `.ps-table-wrapper`)). They mirror our
  "Design System Tokens" Figma
  and are the default for any new or refactored UI: a hardcoded hex color or hand-assembled font stack is a bug
  unless the token set genuinely has no fit. For type specifically:
  - **Set type with a composite `--text-*` token, not the raw font variables.** Write
    `font: var(--text-body-regular);` — never `font-family: var(--font-primary)` plus hand-picked
    size/weight/line-height. The `--text-*` tokens are complete `font` shorthands (weight, size/line-height, family)
    and already bake in `var(--ui-scale)`. If one aspect of the token doesn't suit the design — usually line-height —
    keep the token and override just that property after it (`font: var(--text-body-regular); line-height: 1.5;`)
    rather than dropping to raw `font-*` properties. Long-form reading text (documentation, multi-paragraph copy)
    takes `--text-prose-regular`, the body size with looser leading; `--text-body-*` is for UI copy. Code blocks take
    `--text-code-regular`; inline `code` keeps `font-family: var(--font-mono)` at a relative `em` size so it tracks
    the text it sits in.
  - **Size in px, never `rem`.** Bootstrap 3 sets `html { font-size: 62.5% }`, so `1rem` is 10px on every page and a
    `0.875rem` "14px" renders at 8.75px. The `--text-*` tokens are px for this reason; the legacy `--font-size-*`
    rem aliases in `admin-dashboard.css` are the last holdouts (#4300).
  - **Default to the primary font (Mulish).** The accent font (`--font-accent`, Raleway) is display-only and already
    scoped to the few tokens that carry it (`--text-h1-bold`, `--text-h2-bold`, `--text-small-accent`) — don't
    introduce it elsewhere.
  - **Never set numbers in Raleway.** Raleway defaults to old-style (text) figures: digits vary in height and
    3/4/5/7/9 descend below the baseline, so numeric strings look uneven and misaligned. Anything that renders
    digits — counts, stats, timers, percentages, dates — gets a primary-font `--text-*` token, even inside an
    otherwise accent-styled heading.
- **Scale tool UI with `var(--ui-scale)`.** The Explore and Validate tools (and self-contained overlays layered over them — the mission-complete modal, the tutorial intro/complete screens, etc.) are zoomed uniformly to fit the viewport by `util.applyToolScale` (`public/js/common/utilities.js`), which sets `--ui-scale` on both `.tool-ui` and the document root. So **every fixed dimension you author for tool/overlay UI must be expressed as `calc(<base>px * var(--ui-scale, 1))`** — paddings, gaps, widths, heights, border widths/radii, icon sizes, and any hardcoded `font-size`/`letter-spacing`. For type, prefer the `--text-*` tokens (they already bake in `var(--ui-scale)`); only drop to a raw `calc(... * var(--ui-scale, 1))` font-size when no token matches the size. A bare `px` value here is a bug: it won't grow/shrink with the rest of the tool. (Fluid values — `%`, `flex`, `aspect-ratio`, viewport units — don't need it.) This does **not** apply to fixed page chrome like the navbar, which deliberately stays unscaled.
- Max line length of 120 characters, with long line exceptions where appropriate. For multi-line comments, TARGET line length is 120 characters
- **Keep docs in sync.** When you change architecture, framework versions, supported languages, label types, or other conventions, update the affected docs in the *same* change: [`docs/architecture.md`](docs/architecture.md) mirrors this file's architecture (and the README's tech-stack summary), and [`CONTRIBUTING.md`](CONTRIBUTING.md) holds the workflow/standards. To avoid drift, keep exact dependency/patch versions in **one** place — the dependency-version inventory ([`docs/upgrading-libraries.md`](docs/upgrading-libraries.md)) — rather than copying them across docs. README/architecture mention only stable major versions (e.g. Scala 2.13, Play 3.0, Java 17).

## Code Commenting Standards

Comments communicate **why** code makes a choice — not **what** it does (well-named identifiers handle that). Follow the
language-specific conventions below so that IDEs, documentation generators, and the next developer can consume them.

### Scala (ScalaDoc)

Use `/** ... */` for all ScalaDoc. Every class, trait, object, and non-trivial method gets one — including `private`
methods. Private methods are read by the next developer, not just public API consumers.

**Method / function:**
```scala
/**
 * One-line summary of what this does or returns.
 *
 * Longer description when the contract, preconditions, or edge cases need more room.
 * Separate from the summary with a blank line; keep each line under 120 chars.
 *
 * @param name  Description. Don't repeat the type — it is already in the signature.
 * @param other Description. Align multi-param descriptions for readability.
 * @return      What is returned and meaningful edge cases (e.g. `None` if absent,
 *              `Left(ApiError)` if malformed, `Right(Some(...))` if valid).
 */
```

**Class / trait / object / companion:**
```scala
/**
 * One-line description of this type's single responsibility.
 *
 * Longer description if construction semantics, lifecycle, or thread-safety matter.
 *
 * @param cc  Description of constructor param (omit implicit/DI-only params).
 */
```

Rules:
- Use `@return` (not `@returns`) — that is the ScalaDoc standard.
- Align `@param` descriptions when there are multiple — consistent with Play/Slick/Scala stdlib style.
- Omit `@throws` unless the exception is part of the intentional public contract.
- Do not document implicit params that are pure DI plumbing details.
- Trivial one-line helpers (simple delegators, obvious getters) may omit the header.

### JavaScript (JSDoc)

Use `/** ... */` for all JSDoc. Every `class` and every non-trivial method gets one — including `#private` methods.
Type annotations in `@param` are especially important in JS because there is no static type checker.

**Method / function:**
```javascript
/**
 * One-line summary.
 *
 * Longer description when needed. Keep lines under 120 chars.
 *
 * @param {string} name - Description. Mark optional params as {string} [name] = defaultValue.
 * @param {number} count - Description.
 * @returns {boolean} What is returned; include edge cases (null if not found, etc.).
 */
```

**Class:**
```javascript
/**
 * One-line description of the class's single responsibility.
 */
class Foo {
    /**
     * @param {string} name - Description.
     */
    constructor(name) { ... }
}
```

Rules:
- Use `@returns` (not `@return`) — that is the JSDoc standard (opposite of ScalaDoc).
- Always include `{Type}` in `@param` and `@returns`.
- Use `{Type} [paramName]` (square brackets) for optional parameters.
- Use `{Type} [paramName=default]` when a default exists and is non-obvious.
- Trivial one-line helpers may omit the header.

### Inline comments

Use `//` for inline comments within a body. Write the **why**, never the what:

```scala
// bbox takes precedence over region filters per the v3 API contract (#3871).
val finalBbox = if (bboxActive) parsedBbox else ...
```

not:

```scala
// check if bbox is active   ← restates the code; adds no value
val finalBbox = if (bboxActive) parsedBbox else ...
```

Good targets for inline comments:
- Non-obvious algorithmic choices or ordering constraints that must be preserved.
- Business rules and domain invariants that aren't apparent from identifiers alone.
- Workarounds for external bugs, framework quirks, or surprising behavior.
- Why a specific constant or threshold was chosen (link to issue/spec if possible).
- Branches where the "looks-wrong" path is actually correct.
- `firstError`-style validation sequences where the order of checks matters.

### What not to comment

- Do not restate what the code obviously does.
- Do not describe what the code *used to* do, or narrate a change — that is changelog, and git
  history already records it. This is the single most common offender: a diff renames or replaces
  something, and a comment gets added to explain the *before*. The reader only needs the current
  contract; if a comment is only meaningful read against the diff, delete it. Applies everywhere,
  but especially in tests and `models/` DAO/DTO files. Concretely (from a real rename PR):

  ```scala
  // BAD — narrates the rename; only makes sense next to the diff:
  // region_id + region_name replace the old neighborhood field (#3980).
  body must not include "neighborhood" // now region_name (#3980)

  // GOOD — the assertions already state the current contract; no comment needed:
  body must include("region_id,region_name")
  body must not include "neighborhood"
  ```

  Tells that you are writing one of these and should stop: *used to*, *previously*, *formerly*,
  *replaces the old*, *renamed to/from*, *no longer*. A `PostToolUse` hook in `.claude/settings.json`
  flags these on save — if it fires, rewrite to state only the current behavior.
- Do not leave `TODO`/`FIXME` in committed code without a linked tracking issue.
- Do not add a header just because a function was touched; only add one if it is missing
  and the function is non-trivial.

## Linting Rules (all four frontend linters must pass before check-in — blocking CI gates, like Scala `scalafmt`; see Continuous integration)
- ESLint: ES2022, `const`/`let` only (no `var`), arrow functions, template literals, semicolons required, 120-char line limit
- Stylelint: stylelint-config-standard + @stylistic (2-space indentation, 120-char lines) + Baseline widely-available features only (`stylelint.config.mjs`)
- HTMLHint: lowercase tags/attrs, double quotes, no inline scripts/styles, alt text required

## Testing the Local Web App

Everything runs inside Docker; the `Makefile` wraps `docker-compose`. A developer typically already has the app running, so before starting your own containers, check whether they're up (`docker ps`) and reuse them.

```bash
make dev            # start the db container, then drop into a shell in the web container
                    # (= make docker-up-db + make docker-run)
make docker-up      # start all services detached
make docker-stop    # stop and remove containers
make ssh target=db  # exec into a running container (projectsidewalk-db / -web)
```

> Human-facing companions to this section: [`docs/dev-environment.md`](docs/dev-environment.md) (full setup —
> prerequisites, WSL2, city switching, troubleshooting) and [`CONTRIBUTING.md`](CONTRIBUTING.md) (workflow + coding
> standards). This file stays the AI-facing reference; those are written for contributors.

Inside the web container shell, the developer starts the app with `npm start` (runs Grunt concat + watch in the background, then `sbt run` — i.e. `sbt ~ run`, continuous recompile; `npm run debug` adds a JVM debug port). It serves on **http://localhost:9000** using `conf/application.local.conf`. First compile is slow (sbt resolves dependencies); sbt keeps its caches inside the project dir (`.coursier`, `.sbt`).

### Running a worktree's app for QA

To QA an uncommitted branch that lives in a git **worktree** (`.claude/worktrees/<name>`) rather than the main repo,
run **`make qa-worktree wt=<name>`** (the same on Mac, Linux, and WSL — all the setup runs inside the web container).
It handles what the plain `npm start` flow doesn't for a worktree: symlink the main repo's `node_modules` (gitignored,
so absent in worktrees), build that branch's JS/CSS bundles (also gitignored/absent — without them every page 404s its
assets), start a backgrounded **`grunt watch`** so later `public/js/**` / `public/css/**` edits rebuild the bundles
automatically (a plain hard-reload always reflects the latest source — no manual reconcat), free `:9000`, kill any stray
`sbt --client` server *or* hung `sbtn` task sharing the worktree's `target/` (either deadlocks `~ run` on compile locks),
and launch `sbt ~ run` with `-Dconfig.file` at the worktree's own conf and the sbt caches pointed at the main repo's warm
`.coursier`/`.sbt` (cwd-relative caches from a worktree would re-download gigabytes). The first HTTP request triggers the
dev compile; **Ctrl-C stops the app and reaps the grunt watch** (a trap, so the watcher never lingers). To tear a session
down out-of-band, run **`make qa-worktree-stop wt=<name>`** (add `clean=1` to also drop the `node_modules` symlink).
Implementation: `tools/qa-worktree.sh` — both targets run the **worktree's own** copy of that script when it has one
(falling back to the main checkout's), so the branch being QA'd supplies its own tooling.

`make` itself still reads the **main checkout's** Makefile, so when that checkout sits on a branch without the target,
make reports `No rule to make target 'qa-worktree'`. Either check out a branch that has it, or run the worktree's script
directly: `docker exec -it projectsidewalk-web bash /home/.claude/worktrees/<name>/tools/qa-worktree.sh <name>`.

**Disposing of a worktree entirely** is **`make worktree-remove wt=<name>`** (`tools/worktree-remove.sh`): it stops any
QA session, deletes the directory *and* git's registration under `.git/worktrees/`, then deletes the branch if every
commit on it is already in `develop` (otherwise it names the branch and leaves it). `rm -rf` on the directory alone is
**not** equivalent — the registration survives and the worktree keeps showing up in `git worktree list` until something
prunes it; the target recognizes and cleans up that half-removed state too. Unlike the QA targets it runs **host-side**:
a worktree's `.git` file points at the main repo's `.git/worktrees/<name>` by absolute host path, which doesn't exist
inside the container, so git can't touch the worktree from in there. It stops before doing anything if the worktree has
uncommitted or untracked files (`force=1` deletes them along with it) or if the worktree is **locked** — an active
Claude Code worktree session holds a lock, and git refuses a locked worktree even with `--force`. The main-checkout
caveat above applies here too; the direct invocation is host-side rather than through docker:
`bash .claude/worktrees/<name>/tools/worktree-remove.sh <name>`.

**Admin-authenticated QA:** the dev DB is seeded from a dump that includes real accounts and their bcrypt password
hashes, and password verification is config-independent (plain bcrypt, no server-side pepper), so if your own account is
in the dump you can just sign in with your normal credentials. If you don't have credentials for a seeded account — or
want a throwaway admin — create a fresh account (two-step CSRF `POST /signUp`) and grant it a role via a local DB write;
roles are resolved per-request, so an existing session cookie gains access without re-login:

```sql
UPDATE sidewalk_login.user_role
SET role_id = (SELECT role_id FROM sidewalk_login.role WHERE role = 'Owner')
WHERE user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = '<user>');
```

### Verifying backend (Scala) changes compile

For a quick pass/fail without running tests, validate backend changes by compiling. The clean way is the **sbt thin client**, which runs against its own dedicated server and so does *not* fight the developer's running `sbt ~ run` (a plain second `sbt compile` collides with it over build/target locks and hangs):

```bash
docker exec projectsidewalk-web bash -lc "cd /home && sbt --client compile"
```

- First call per container boot is ~30s (it starts the dedicated compile server); every call after is near-instant (warm server reuse).
- It compiles whatever is **saved on disk**, so it reflects uncommitted edits. `build.sbt` sets `-Xfatal-warnings`, so a `[success]` means warning-clean too (unused imports/params, dead code, value discard all fail the build).
- It only needs the web container up — the app itself (`npm start`) does not have to be running.

Alternatively, since the developer's `sbt ~ run` recompiles on save, hitting any route over HTTP (see below) also forces a compile; errors surface as a 500 page rather than clean output, so prefer the thin client when you just want a pass/fail.

### Running tests

There **is** a backend test suite (ScalaTest via `scalatestplus-play`), under `test/` — mostly public-API functional specs in `test/controllers/api/`, plus `test/models/api/` and `test/formats/json/`. Run it with the thin client:

```bash
docker exec projectsidewalk-web bash -lc "cd /home && sbt --client test"                                # whole suite
docker exec projectsidewalk-web bash -lc "cd /home && sbt --client \"testOnly controllers.api.PublicApiSpec\""
```

The API specs **boot the real app against Postgres+PostGIS**, so the `db` container must be up; they assert response contract/shape, not data values. There is no `make` target — invoke sbt directly. The phased testing strategy and rationale live in [`docs/testing-and-ci.md`](docs/testing-and-ci.md).

A **JS** test layer (jsdom) lives under `test/js/` — run `npm run test:js`. CI runs it as an **advisory** step inside the `frontend` job, so a failure reports but doesn't block a merge while coverage is still thin (sequenced with the ES5→ES2022 migration, #2487); see `test/js/README.md`.

A **Python** unit suite (`pytest`) for the `scripts/` utilities lives under `test/python/` — run `make test-python` (runs pytest in the web container, once per interpreter; `make test-python-app` / `make test-python-tools` run one half). It needs no DB/network (pure-logic tests only) and runs as a CI matrix with one leg per interpreter: the **in-band script** leg is **blocking** (the app shells out to `label_clustering.py`), the **offline tooling** leg stays advisory; see `test/python/README.md`.

A **browser smoke suite** (Playwright, #4504) lives under `test/e2e/` — loads each core page in headless Chromium and fails on any uncaught console/page error. It also carries the **accessibility gate** (`a11y.spec.js`, #5060): axe-core at WCAG 2.1 AA over `test/e2e/pages.js`, the page table it shares with the smoke specs — so accessibility coverage is opt-out, and a page added for one is gated by the other — failing on any violation `a11y-allowlist.js` doesn't already track against an issue. Adding an allowlist entry is a last resort — fix the violation, or file the issue and cite it. Policy, the manual checklist, and how the tool UIs are handled: [`docs/accessibility.md`](docs/accessibility.md). Run it with **`make test-e2e`** against an already-running dev app (`BASE_URL` overrides `http://localhost:9000`; scope with `args="-g labelMap --no-deps"`; run a worktree's specs with `wt=<name>`). No setup step and no host Node: like every other tooling target it runs in a container, built from `docker/e2e/Dockerfile` on the official multi-arch Playwright image (Chromium and its OS libs baked in), joined to the web container's network namespace so `localhost:9000` resolves — the only host `conf/application.local.conf`'s `play.filters.hosts.allowed` permits. `make` derives both the image tag and the tools installed in it from `package.json`'s `@playwright/test` and `@axe-core/playwright` pins, so a Dependabot bump rebuilds the image instead of drifting from its Chromium. `make test-e2e-host` is the host-side escape hatch for `--headed`/`--ui`/`show-trace` (needs Node 23 + `npm install` + `npx playwright install chromium` on the host). It never runs during local development on its own — CI runs it as the `e2e-smoke` job (on the GitHub runner's own toolchain, not this image), where the accessibility gate is a blocking step (`--project=a11y`) and the smoke half stays advisory. CI's schema is empty, so anything that needs data to render is only really gated when the suite runs against a seeded DB. The `/explore`/`/validate` specs need a real Maps key, so they self-skip unless `HAS_REAL_GMAPS_KEY=true` (set automatically in CI from the `GOOGLE_MAPS_API_KEY_TEST` secret; export it manually to run them locally); see `test/e2e/README.md`.

### Continuous integration

`.github/workflows/ci.yml` runs on PRs and pushes to `develop`/`master`: backend **`sbt compile`** (blocking gate), **`scalafmtCheckAll`** (blocking — the tree is kept format-clean; auto-format with `make scalafmt-fix` / `sbt scalafmtAll`, config in `.scalafmt.conf`), the **frontend grunt build** plus the four frontend linters — **ESLint** (JS + translation JSON), **Stylelint** (CSS), **HTMLHint** (HTML), and **locale key-parity** — all **blocking** steps in the `frontend` job, so they ride the required `Frontend (build)` check (each blocks on `error`-severity findings; the lone `warn` rule on ESLint/Stylelint, `max-len`, is advisory so there's no `--max-warnings 0`; the trees are kept lint-clean, auto-fix with `make lint-fix`), the **evolutions lint** (blocking — static checks on `conf/evolutions/default/*.sql`, e.g. a semicolon mid-`--`-comment that Play's parser splits on; run locally with `make lint-evolutions`), the **route reachability lint** (blocking — fails if a `conf/routes` entry is unreachable because an earlier same-method route already matches all its paths; run locally with `python3 tools/check_route_reachability.py`), the **DB-backed API tests** (blocking — boots the app, so it also exercises forward evolution application), the **Python unit tests** (in-band leg blocking, offline-tooling leg advisory), and the **browser smoke tests** (`e2e-smoke` — builds the bundles, stages a prod-mode binary against the CI DB, and runs the Playwright suite in `test/e2e/`; the axe-core accessibility gate is a blocking step, the runtime-error smoke half is advisory; the Explore/Validate specs self-skip until the `GOOGLE_MAPS_API_KEY_TEST` repo secret exists). "Advisory" steps report findings but don't block merges yet — and note that `continue-on-error` on a **job** makes it report `success` even when it fails, so it goes on the narrowest step or matrix leg it should excuse, never the job. **Branch protection** on `develop` (set 2026-06-29, extended 2026-09-01) wires the deterministic blocking jobs as **required status checks** (`Backend (compile + scalafmt)`, `Frontend (build)` — covers all four frontend linters — `Route reachability lint`, `Evolutions lint`, `Backend tests (API, PostGIS)`, and `Python tests (in-band script)`) so a red build can't merge; `enforce_admins=true`, **no required reviews** (self-merge preserved), the advisory checks (`E2E smoke (Playwright)`, `Python tests (offline tooling)`) not required. Because `enforce_admins` is on, **nobody can push directly to `develop`** — a direct push has no PR for the required checks to run against, so it's rejected for maintainers too; all changes go through a PR. Full policy: [`docs/testing-and-ci.md`](docs/testing-and-ci.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

### Building frontend assets

JS/CSS is concatenated by Grunt (see `Gruntfile.js`) and rebuilt automatically by the `grunt watch` that `npm start` runs — so when a developer has the app up, your saved `src/` edits are bundled for you. **Do not run `grunt`/`npm run grunt-concat` yourself and do not edit the `build/` output.** Edit the `src/` files only; bundles are written to `public/js/*/build/`. If a new `src/` file isn't picked up, check that its path matches a glob in `Gruntfile.js`. Concatenation order matters and is hand-specified there (e.g. `PopupPanoManager` and `LabelDetail` must precede `LabelPopup`).

### Exercising routes over HTTP

`WebFetch` cannot reach `localhost`, so use `curl` via the Bash tool. Most routes require authentication, so grab an anonymous session cookie once, then reuse the cookie jar:

```bash
# one-time per conversation: get an anonymous session cookie
curl -s -c /tmp/sidewalk_cookies.txt "http://localhost:9000/anonSignUp?url=%2F"
# authenticated request: pass the cookie jar with -b
curl -s -b /tmp/sidewalk_cookies.txt "http://localhost:9000/v3/api/labelTypes"
```

The cookie persists for the shell session; re-run `anonSignUp` at the start of each new conversation for a fresh one.

### Inspecting the database

To understand the schema, query the live DB directly rather than reading through evolutions. Use the **read-only** `readonly_user` role (only SELECT privileges — never `-U sidewalk`, to avoid accidental writes):

```bash
docker exec projectsidewalk-db psql -U readonly_user -d sidewalk -c "\dt sidewalk_seattle.*"
docker exec projectsidewalk-db psql -U readonly_user -d sidewalk -c "SELECT * FROM sidewalk_login.role;"
```

Each city has its own schema (`sidewalk_<city>`), and they are essentially identical — `sidewalk_seattle` is a safe default for **schema** questions; authentication lives in `sidewalk_login`. Evolutions in `conf/evolutions/default/` are auto-applied when a page loads, so you don't run them manually.

**For anything about *data* or *migration state*, first find out which city is actually running** — don't assume `sidewalk_seattle`:

```bash
docker exec projectsidewalk-web bash -lc 'echo $DATABASE_USER'   # this value IS the active schema name
```

`DATABASE_USER` selects the schema and is authoritative; `SIDEWALK_CITY_ID` only selects `cityparams.conf` entries (map center, bounds, display name). The two are *supposed* to correspond (see [`docs/dev-environment.md`](docs/dev-environment.md) → "City IDs"), but a container can be left with them **mismatched**, in which case the app renders one city's params over another city's data — an empty map with no error in any log. Confirm what the app believes it is with `curl -s -b <cookie-jar> localhost:9000/labelmap | grep -oE 'cityId: "[^"]*"'`.

**`readonly_user` cannot see every schema, and the failure is silent.** It is granted per-schema, so it may have no rights on the active city's schema — and `information_schema` / `\dt` simply **omit** what you can't see rather than erroring, which reads as "that schema doesn't exist" or "that evolution never applied". `pg_namespace` is world-readable, so enumerate with it, then query the city as its own role:

```bash
docker exec projectsidewalk-db psql -U readonly_user -d sidewalk -tAc \
  "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'sidewalk%' ORDER BY 1"
docker exec projectsidewalk-db psql -U sidewalk_teaneck -d sidewalk -c \
  "SELECT max(id) FROM sidewalk_teaneck.play_evolutions"
```

Never conclude "evolution N didn't apply" from a `readonly_user` query without first confirming which schema the app uses.

**The dev DB is not representative of production size, and some tables may be absent.** The two largest production tables by a wide margin are **`audit_task_interaction`** and **`validation_task_interaction`** (raw per-action interaction logs — pans, zooms, clicks). The dev DB dumps that seed local development **omit** these tables to stay manageable, so locally they are typically empty or missing. Never infer a table's production size or existence from the local DB. When reasoning about query cost or indexes, treat these two interaction tables — not `webpage_activity` — as the heavyweight logs.

### Linting

```bash
make lint           # eslint + stylelint + htmlhint + lint-locales + lint-css-layout + lint-evolutions (all of it)
make lint-fix       # eslint --fix + stylelint --fix
make eslint         # JS + translation JSON; defaults to public/js/ + public/locales/ (build/ carved out by config ignores; vendor/ is out of the files glob)
make stylelint      # CSS; defaults to public/**/*.css (vendor/ carved out by the config's ignoreFiles)
make htmlhint       # HTML; defaults to app/views/
make lint-locales   # cross-locale key parity (tools/check-locale-parity.mjs)
make lint-css-layout # public/css/ layout: page files linked only by their page, prefixes in place (tools/check-css-layout.mjs)
make lint-evolutions # static checks on conf/evolutions/default/*.sql (host-side bash, no container needed)
make eslint dir=public/js/validate   # scope any target to a dir/file; also stylelint / htmlhint
```

**All four frontend linters must pass (zero errors) before code is checked in** — like scalafmt for Scala. The trees are
fully lint-clean (#2487), so a bare run should come back green and any finding is yours: `make lint-fix` handles the
mechanical ESLint + Stylelint fixes, hand-fix the rest, then confirm with `make lint`. All four are **blocking CI gates**
(steps in the `frontend` job), so an `error`-severity finding fails the build — the frontend counterpart to scalafmt.
The one `warn` rule on ESLint and Stylelint (`max-len` / `max-line-length`) is deliberately advisory (CLAUDE.md permits
long-line exceptions), so CI runs without `--max-warnings 0` and an over-limit line nags but doesn't block.

These are run **from the host** (like `make scalafmt`): the targets `docker exec` into the running web container,
where the linters' `node_modules` live (there is no host-side `npm install`), so the web container must be up. Scope a
run with `dir=` and pass extra flags with `args=`.

Config: `eslint.config.js`, `stylelint.config.mjs`, `.htmlhintrc`; cross-locale parity is `tools/check-locale-parity.mjs`. Scala formatting is `.scalafmt.conf`.

### What not to automate

Do **not** attempt live or browser-automated testing of anything that requires viewing or interacting with a GSV (street-view) panorama — placing labels in Explore, validating in Validate, etc. The developer tests those visually. Instead, hand them a short checklist of things to verify or a console snippet to run while reproducing the issue. (Narrow exception: the `test/e2e/` smoke suite *loads* Explore's tutorial — whose pano tiles are local assets, no live GSV — and Validate's landing state, asserting only "no uncaught errors". That load-only boundary is deliberate; don't extend the suite into pano interaction.)
