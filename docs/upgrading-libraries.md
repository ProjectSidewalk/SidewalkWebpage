# Upgrading libraries

This is the **canonical inventory** of everything Project Sidewalk depends on — the third-party libraries, and the
runtimes, base images, and database server underneath them — with the version we're on and how to check for and apply
updates to each. We update these periodically; this page exists so that the next person scanning the list can tell at
a glance whether something has a newer release available, or has gone end-of-life.

**Keep the versions here in sync with the code, and keep this the only _doc_ that carries full versions.** Other docs
([`CLAUDE.md`](../CLAUDE.md), [`docs/architecture.md`](architecture.md), the README) mention only stable *major*
versions (Scala 3.9, Play 3.0, Java 17) and point here for the exact numbers — so a patch bump only has to be
recorded once. When you upgrade something, bump its version number below in the same change.

> Many entries carry a **note** explaining *why* we're pinned where we are (a known incompatibility, an abandoned
> upstream, a migration we haven't taken on yet). Those notes are institutional knowledge — preserve and update them
> rather than dropping them.

## Platform (runtimes, base images, database server)

What the app runs *on*, as opposed to what it links against. **Prod isn't containerized** — it's bare-metal Rocky
Linux 9.8 on makelab1 ([#4398](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4398)) — so dev and prod are
listed separately and are *expected* to differ; the goal is skew that's written down, not a parity we can't reach.
**The "latest" and EOL columns were checked on 2026-09-09** — re-check and re-date them rather than trusting them.

### Runtimes and base images

| | Ours | Latest | Upstream EOL | Set in |
|---|---|---|---|---|
| Java (JDK) | Temurin **17** | 25 LTS | Oct 2027 | web base image, `build.sbt`, `ci.yml` |
| Node (+ npm) | **24.x** (npm ≥ 11) | 26.x | Apr 2028 | `Dockerfile`, `package.json` `engines`, `ci.yml` |
| Python (app) | **3.8** | 3.14.7 | **Oct 2024 — past** | web base image ([why two](#interpreters)) |
| Python (tooling) | **3.13.15** | 3.14.7 | Oct 2029 | `Dockerfile`, via uv |
| web image | **`eclipse-temurin:17-jdk-focal`** | jammy / noble | **May 2025 — past** | `Dockerfile` |
| db image | **`postgis/postgis:18-3.6`** | 18-3.6 | ~Aug 2028 (Debian 13) | `db/Dockerfile` |
| ShellCheck image | **`koalaman/shellcheck:v0.11.0`** | 0.11.0 | — | `docker/shellcheck/Dockerfile` (never built; the pin `make shellcheck` and CI run, kept where Dependabot looks) |

- **Focal does more than it looks.** It's what makes `python3` mean 3.8 (retiring that is
  [#4396](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4396)), and its glibc 2.31 is older than the
  2.32 and 2.34 that sbt's `sbtn` needs, so `sbt --client` can't run in the container at all and everything uses
  `sbt --jvm-client` instead (#5268). Jammy (glibc 2.35, `python3` 3.10) or noble (2.39, 3.12) fixes both, but a
  move has to say what happens to 3.8 first.
- **The db image updates by rebuilding.** It's Debian 13 with Postgres, PostGIS, GEOS and PROJ from Postgres's own
  package server, the same source as prod's.
- **Java 17** in dev and CI, **21** on prod; moving dev to 21 is
  [#4396](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4396). Dependabot deliberately ignores major
  `eclipse-temurin` bumps. **Node 24** is LTS until Apr 2028, with 26 taking over as LTS in Oct 2026.

### Database server

Prod is the target dev tracks. Test moved to Postgres 18 on 2026-10-07, ahead of prod (#3955). Prod's column was
read on 2026-07-01 (#4398), test's on 2026-10-07; re-check any of them with
`SELECT version();` and `SELECT PostGIS_Full_Version();` (in dev, `docker exec projectsidewalk-db psql -U
readonly_user -d sidewalk`).

| | dev (`projectsidewalk-db`) | test (makelab1) | prod (makelab1) | Latest |
|---|---|---|---|---|
| OS | Debian 13 trixie | Rocky Linux 9.8 (EOL May 2032) | Rocky Linux 9.8 | — |
| Postgres | **18.6** | **18.6** | **16.14** | 18.6 |
| PostGIS | **3.6.4** | **3.6.4** | **3.4.6** | 3.6.4 |
| GEOS | **3.14.1** | **3.14.1** | **3.14.1** | 3.15.0 |
| PROJ | **9.8.1** | **9.8.1** | **9.8.1** | 9.8.1 |
| GDAL | **3.10.3** (`libgdal36`) | not collected | not collected | 3.13.3 |

- **Dev matches test, and prod except for the Postgres and PostGIS versions.** Until prod is on 18, don't use SQL
  that's new in 17 or 18 (`RETURNING OLD/NEW`, `uuidv7()`, `JSON_TABLE`, virtual generated columns). JIT is off in
  `docker-compose.yml`, matching prod ([#4376](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4376)).
- **Name time zones as Area/City** (`America/Los_Angeles`, not `US/Pacific`). Debian 13 dropped the old names, so
  dev's Postgres rejects them; Rocky's still accepts them.
- **Prod server settings dev lacks** (set by CSE IT in its `postgresql.conf` after
  [#4545](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4545)):
  `idle_in_transaction_session_timeout = 2min` and `log_lock_waits = on`.
- **Dumps only load into the same or a newer Postgres** (otherwise: `unsupported version (1.16) in file header`), and
  an older `pg_dump` refuses a newer server. So dev must be at least as new as the server its dumps come from.
- **makelab1's `psql` on the PATH is 13.23.** It can query both servers, but its `pg_dump` refuses them: use
  `/usr/pgsql-<version>/bin/pg_dump` (sidewalk-server-tools#8 makes the scripts do this).
- **When CSE IT updates a server's PostGIS library**, its SQL functions lag behind (`PostGIS_Full_Version()` ends in
  `need upgrade`). Run `ALTER EXTENSION postgis UPDATE` in each database, then hand any new functions to `sidewalk`.
  Avoid `postgis_extensions_upgrade()` until `tools/one-off/3955-drop-raster-leftovers.sql` has cleared that
  database's old raster functions. **GDAL** isn't reported there (no raster support); dev's comes from its package.

## Scala / sbt / Play

These versions live in [`build.sbt`](../build.sbt), [`project/build.properties`](../project/build.properties), and
[`project/plugins.sbt`](../project/plugins.sbt). After changing any of them, rerun `npm start` so the new versions
download and the build re-resolves (a running sbt, which `make compile` reuses, ignores the change until it reloads).

### Core toolchain

- **Scala: 3.9.0** — the 3.9 LTS line; `.scala-steward.conf` pins Steward to it, so the next LTS is a deliberate
  bump. Edit `scalaVersion` in `build.sbt` and `runner.dialect` in `.scalafmt.conf` (once scalafmt knows the new
  minor; #5609). Our libraries are published for 3.3, which a newer compiler reads fine. A bump mostly surfaces new
  warnings, and the compiler can fix many itself, but only with `-Werror` off (a failed compile writes no fixes):
  `set scalacOptions := scalacOptions.value.filterNot(_ == "-Werror") ++ Seq("-rewrite", "-source", "3.7-migration")`
  then `compile; Test/compile`, once per minor that changed the language (3.3 → 3.9 needed `3.7-migration`, for
  `using`).
  [Releases](https://www.scala-lang.org/download/all.html) · [Changelog](https://github.com/scala/scala3/releases)
- **sbt: 1.13.0** — set in `project/build.properties`; downloaded automatically on the next `npm start`. The
  `Dockerfile` pins the apt `sbt` launcher to that same version, so also `docker compose build web` after a bump
  (Compose won't rebuild on its own). sbt **2.x** is gated on Play: its `sbt-plugin` has no sbt 2 build outside the
  3.1.0 milestones, and sbt 2 build definitions are Scala 3, so it's a tracked migration rather than a bump. You may
  need to bump Play at the same time for major sbt updates. [Releases](https://github.com/sbt/sbt/releases)
- **Play Framework: 3.0.12** — to update, change the `sbt-plugin` version in `project/plugins.sbt`. The Play libraries
  in `build.sbt` that share its version (`play-guice`, `play-cache`, `play-ws`, `play-caffeine-cache`) read it from
  the plugin through `PlayVersion.current`, so they follow on their own.
  [Releases](https://github.com/playframework/playframework/releases) ·
  [Changelog](https://www.playframework.com/changelog)

### Play ecosystem (own versioning schemes)

- **play-mailer / play-mailer-guice: 10.1.0** — versioned separately from Play.
  [Releases](https://mvnrepository.com/artifact/org.playframework/play-mailer) ·
  [Which version to use](https://github.com/playframework/play-mailer?tab=readme-ov-file#versioning)
- **play-json: 3.0.6** — versioned separately from Play.
  [Releases](https://github.com/playframework/play-json/releases)
- **play-silhouette (+ password-bcrypt, crypto-jca, persistence): 10.0.4** — authentication.
  [Releases](https://mvnrepository.com/artifact/org.playframework.silhouette/play-silhouette) ·
  [Compatibility matrix](https://github.com/playframework/play-silhouette?tab=readme-ov-file#version-compatibility-matrix)
- **scala-guice: 6.0.0** — DI on top of play-guice. **Note:** 6.0.0 and 7.0.0 are identical except 7.0.0 switches
  `javax` → `jakarta` ([Guice 7 transition](https://github.com/google/guice/wiki/Guice700#jee-jakarta-transition)).
  Play itself hasn't made that switch, so moving to 7 breaks core Play functionality — **stay on 6** until Play
  migrates (watch the [Play changelog](https://www.playframework.com/changelog)).
  [Releases](https://mvnrepository.com/artifact/net.codingwell/scala-guice) ·
  [Changelog](https://github.com/codingwell/scala-guice/blob/develop/CHANGELOG.md)

### Database (Slick + Postgres + PostGIS)

These are the JVM libraries we talk to the database *through*; the database server's own versions are under
[Database server](#database-server) above.

- **postgresql (JDBC driver): 42.7.13** — the `org.postgresql` driver in `build.sbt`.
  [Releases](https://mvnrepository.com/artifact/org.postgresql/postgresql) · [Changelog](https://jdbc.postgresql.org/)
- **play-slick / play-slick-evolutions: 6.2.0**.
  [Releases](https://mvnrepository.com/artifact/org.playframework/play-slick) ·
  [Which version to use](https://github.com/playframework/play-slick?tab=readme-ov-file#all-releases)
- **slick-pg (+ `slick-pg_jts_lt`, `slick-pg_play-json`): 0.23.1** — PostGIS/JSON Slick extensions.
  [Releases](https://mvnrepository.com/artifact/com.github.tminglei/slick-pg) ·
  [Changelog](https://github.com/tminglei/slick-pg/releases)

### Geospatial

- **jts-core: 1.20.0** — geometry types.
  [Releases](https://mvnrepository.com/artifact/org.locationtech.jts/jts-core) ·
  [Changelog](https://projects.eclipse.org/projects/locationtech.jts)
- **gt-shapefile / gt-epsg-hsql / gt-geopkg (GeoTools): 35.1** — Shapefile/GeoPackage generation. Served by the
  OSGeo resolver in `build.sbt`, not Maven Central. Needs Java 17. We use a tiny corner of the API, so bumps are
  usually mechanical; check both exports afterward (#4393). Brings Eclipse ImageN, sqlite-jdbc, and Jackson 3's
  `jackson-core` along (its own package, so no clash with Play's Jackson 2). The GeoPackage writer relies on gt-geopkg
  handing back a `JDBCDataStore` and on it leaving the `gpkg_contents` bounds to us (#5275), so after a bump confirm
  `ogrinfo -so <file>.gpkg <layer>` shows a real Extent, not (0, 0) - (0, 0).
  [Releases](https://mvnrepository.com/artifact/org.geotools/gt-shapefile?repo=geotools-releases) ·
  [Changelog](https://github.com/geotools/geotools/releases) ·
  [Upgrade notes](https://docs.geotools.org/latest/userguide/welcome/upgrade.html)

### Other Scala

- **metadata-extractor: 2.21.0** — reads EXIF (photos) and QuickTime/MP4 atoms (videos) from user-uploaded story
  media (#4054). Pure Java with one small transitive dep (`xmpcore`); used transiently on ingest — the derived
  recency/proximity buckets are stored, the precise values discarded.
  [Releases](https://mvnrepository.com/artifact/com.drewnoakes/metadata-extractor) ·
  [Changelog](https://github.com/drewnoakes/metadata-extractor/releases)

### Build plugins & test (`project/plugins.sbt`, `.scalafmt.conf`, test deps)

- **sbt-plugin (Play): 3.0.12** — tracks the Play version above (`project/plugins.sbt`).
- **scalafmt: 3.11.5** — pinned in [`.scalafmt.conf`](../.scalafmt.conf); the **sbt-scalafmt** plugin (**2.6.2**,
  `project/plugins.sbt`) fetches it. `scalafmtCheckAll` and `scalafmtSbtCheck` are blocking CI gates.
  [Releases](https://github.com/scalameta/scalafmt/releases)
- **sbt-scoverage: 2.4.4** — coverage, for a later CI phase with a ratcheting threshold.
  [Releases](https://github.com/scoverage/sbt-scoverage/releases)
- **sbt-digest: 2.1.0** — content-fingerprints assets during `stage`/`dist` (see `build.sbt`). Note the org: the
  sbt-web plugins moved from `com.typesafe.sbt` to `com.github.sbt`, and only the latter supports Play 3.
  [Releases](https://github.com/sbt/sbt-digest/releases)
- **scalatestplus-play: 7.0.2** (test scope) — ScalaTest + Play test helpers; backs the API specs under `test/`.
  [Releases](https://mvnrepository.com/artifact/org.scalatestplus.play/scalatestplus-play)

## JavaScript

**`package.json` is the version list.** Every library the pages use is an npm `dependency` pinned to an exact version
(`"mapbox-gl": "3.24.1"`, no `^`), installed by `npm ci` (the Dockerfile, CI and the deploy all run it against
`package-lock.json`) and `import`ed by the module that uses it, so Vite bundles each page with the libraries it reaches
and, for a tree-shakeable one like turf, only the functions it calls (#5734; [`architecture.md`](architecture.md) →
"Modules and the build"). A library's stylesheet is imported by the same module
(`import 'mapbox-gl/dist/mapbox-gl.css'`). **Nothing under `node_modules/` is ever edited.** The imagery viewers load
on demand: MapillaryViewer, PanoramaxViewer,
PannellumViewer and Infra3dViewer each `import()` their SDK, through the small modules in
`frontend/js/common/pano-viewer/sdk/`, in `preloadLibrary()`, so a Mapillary city's visitors never download Infra3d's
9 MB and vice versa.

**To upgrade a library:** `docker exec projectsidewalk-web bash -c 'cd /home && npm install --save-exact <pkg>@<ver>'`,
then `bash tools/dev/npm-sync.sh --write-stamp` so the next `make dev` doesn't redo `npm ci`, and bump the version below
in the same change. Dependabot opens the monthly bumps itself ([`.github/dependabot.yml`](../.github/dependabot.yml)):
patch and minor ones auto-merge once CI is green (#4395), majors wait for a person, and so does anything in its
`npm-imagery` group (the viewer SDKs, three.js, MapLibre, pmtiles), since CI never drives a pano viewer or the minimap:
try those in a city that uses each one. **A version hold needs an `ignore` entry there**, or Dependabot bumps straight
past it; mapbox-gl's is the one in place.

The one third-party asset still served as files is the minimap's basemap glyphs under `public/vendor/basemap-glyphs/`,
which MapLibre fetches by URL pattern rather than through the bundle.

- **async-lock: 1.4.1** — serializes Explore's label submissions.
  [Versions](https://github.com/rogierschouten/async-lock/releases)
- **basemap-glyphs (protomaps/basemaps-assets at `028c18f`)** — the Noto Sans Regular and Italic glyphs for the
  minimap's labels (#5716), with their license. To upgrade, copy the two font folders from a newer commit and update the
  commit here. MapLibre requests them by URL pattern, so they're served from `/basemap/glyphs/`, not `assets.path`.
  [Repo](https://github.com/protomaps/basemaps-assets)
- **bowser: 2.14.1** — browser detection.
  [Changelog](https://github.com/bowser-js/bowser/releases)
- **chart.js: 4.5.1** — the API docs' preview charts; check the running version with `Chart.version`. **Note:** Chart.js
  is modular, and `frontend/js/api-docs/apiDocsChart.js` registers only the chart types, scales and plugins the
  previews use, so a new kind of chart means adding its pieces there, or it fails at draw time.
  [Changelog](https://github.com/chartjs/Chart.js/releases)
- **dompurify: 3.4.16** — cleans HTML from outside sources before it's shown.
  [Changelog](https://github.com/cure53/DOMPurify/releases)
- **@floating-ui/dom: 1.8.0** — positions the tutorial's callouts; `@floating-ui/core` comes with it.
  [Changelog](https://github.com/floating-ui/floating-ui/releases)
- **i18next: 26.4.2** — frontend translations. **Note:** `test/js/i18nextLocales.test.js` runs it and
  i18next-http-backend over our real locale files in every language, so `make test-js args=i18nextLocales` is the
  check after a bump of either.
  [Changelog](https://github.com/i18next/i18next/blob/master/CHANGELOG.md)
- **i18next-http-backend: 4.0.2** — loads translation files.
  [Changelog](https://github.com/i18next/i18next-http-backend/blob/master/CHANGELOG.md)
- **@inovitas/infra3dapi: 1.12.1** — Infra3d imagery provider, loaded on demand through `sdk/infra3d.js` with proj4.
  **Note:** `Infra3dViewer.js` reaches past the documented API into `_sdk_viewer` (`moveToKey`, `movePosition`,
  `setFilter`, `resize`, the component toggles, the `nodechanged` event, the navigator's `imagesByKNN$`) and each node's
  `spatialEdges$` stream, none of which the changelog covers, so after a bump grep the package's `infra3dapi.js` for
  each name. The riskiest bump here, which is why the `npm-imagery` group waits for a person.
  [Changelog](https://developers.infra3d.com/javascript-api/reference/index.html#md:changelog)
- **maplibre-gl: 6.10.0** — draws the Explore minimap (#5429); check with `maplibregl.getVersion()`. **Note:** it looks
  for its Web Worker beside its own file, which in the bundle is the Explore chunk, so `Minimap.js` imports the worker
  through Vite's `?worker&url` and hands the URL to `setWorkerUrl`. A bump that renames `dist/maplibre-gl-worker.mjs`
  shows up as a minimap that never draws.
  [Changelog](https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md)
- **mapbox-gl: 3.24.1** — check with `mapboxgl.version`. Imported through `frontend/js/common/mapboxgl.js`, which takes
  the CSP build and hands it the worker Vite builds from `dist/mapbox-gl-csp-worker.js` (the comment there says why the
  regular build can't be bundled). **Note:** held below 3.25 on purpose, by the `ignore` entry in
  `.github/dependabot.yml`. From 3.25.0 a symbol layer that shares a source with feature-state paint (Route Builder's
  region labels, AccessScore's) crashes the map with `Cannot read properties of undefined (reading 'paint')` once that
  state changes ([mapbox-gl-js#13714](https://github.com/mapbox/mapbox-gl-js/issues/13714)); take 3.25+ (and drop the
  entry) once the fix ([#13721](https://github.com/mapbox/mapbox-gl-js/pull/13721)) ships, or give every such symbol
  layer a feature-state paint expression first.
  [Changelog](https://github.com/mapbox/mapbox-gl-js/blob/main/CHANGELOG.md)
- **@mapbox/mapbox-gl-language: 1.0.1** — [Changelog](https://github.com/mapbox/mapbox-gl-language/releases)
- **@mapbox/search-js-web: 1.6.0** — the place search on the Label Map and Route Builder.
  [Changelog](https://docs.mapbox.com/mapbox-search-js/guides/changelog/)
- **mapillary-js: 4.1.2** — Mapillary imagery provider, loaded on demand through `sdk/mapillary.js` with its stylesheet
  and the three.js classes below. **Note:** Explore and Validate leave the SDK's `.mapillary-attribution-container`
  where it renders it and override its position from `svl.css` and `svv-panorama.css` (#5600), keyed on that class, and
  Explore's `PanoManager.#liftAboveMapillaryAttribution` finds the node by it once and relies on the SDK creating the
  container once and patching it in place (not replacing it on the compact flip); on upgrade, re-check both.
  [Changelog](https://github.com/mapillary/mapillary-js/releases)
- **pannellum: 2.5.7** — the viewer for self-hosted panos, loaded on demand through `sdk/pannellum.js`. **Note:** a
  classic script with no exports that puts itself on `window`; that module reads it back.
  [Changelog](https://github.com/mpetroff/pannellum/blob/2.5.7/changelog.md)
- **panzoom: 9.4.4** — zoom/pan for static images in LabelMap/Gallery.
  [Versions](https://github.com/anvaka/panzoom/tags)
- **@photo-sphere-viewer/core + equirectangular-tiles-adapter: 5.15.1** — the renderer behind the Panoramax imagery
  provider (#5185), loaded on demand through `sdk/photoSphereViewer.js`. The two move together, and three.js follows
  the core's own pin (below). [Releases](https://github.com/mistic100/Photo-Sphere-Viewer/releases) ·
  [Docs](https://photo-sphere-viewer.js.org/guide/)
- **pmtiles: 4.5.0** — lets MapLibre read the minimap's tile archive (#5716). **Note:** the server's `pmtiles`
  command-line tool is separate. It's pinned in `BasemapService` (`CliVersion` and each release file's SHA-256); change
  those to upgrade it.
  [Changelog](https://github.com/protomaps/PMTiles/blob/main/js/CHANGELOG.md) ·
  [CLI releases](https://github.com/protomaps/go-pmtiles/releases)
- **prismjs: 1.30.0** — syntax highlighting for the API docs' code blocks. `pages/api-docs/layout.js` imports the core
  plus only the language components the docs use (`json`, `csv`), so a new `language-*` class in a docs page means
  importing that component too. **No stock theme:** the `.token.*` colors are ours, in
  `css/pages/api-docs/api-docs.css`, so the blocks stay on the design-system tokens. **Note:** 1.30.0 is old (March
  2025) because v1 is in maintenance
  while the repo's default branch develops **v2**, an unreleased breaking rewrite (ESM, `src/languages/`, a different
  dist layout). So 1.x is the stable line to track, and `1.30.0 → 2.x` will be a migration rather than a bump.
  [Changelog](https://github.com/PrismJS/prism/releases)
- **proj4: 2.22.0** — turns a lat/lng into the Web Mercator metres Infra3d's spatial queries take; loaded with that SDK.
  [Changelog](https://github.com/proj4js/proj4js/releases)
- **three: 0.185.1** — the three.js Photo Sphere Viewer pins (`^0.185`); pinned here at the same version so Mapillary's
  `extractPitchRoll`, which uses its `Vector3` and `Matrix4`, shares the one copy. **Note:** move it with
  Photo Sphere Viewer, never ahead of it, or the bundle carries two copies.
  [Changelog](https://github.com/mrdoob/three.js/releases)
- **tom-select: 2.6.2** — the tag picker on Validate. We import the `tom-select/base` build, which has no plugins, plus
  the unthemed `tom-select.css`; the picker's look comes from `svv-validation-menu.css`.
  [Changelog](https://github.com/orchidjs/tom-select/releases)
- **@turf/turf: 7.4.0** — imported as a namespace (`import * as turf from '@turf/turf'`) that Vite tree-shakes to the
  functions each page calls. [Changelog](https://github.com/Turfjs/turf/releases)
- **vega: 6.4.0, vega-lite: 6.5.0, vega-embed: 7.3.0** — the coverage charts on the admin dashboard. We write Vega-Lite
  specs and hand them to `vegaEmbed`, which pulls in Vega itself as the renderer, so all three move together. When
  bumping vega-lite's major, also bump the `$schema` URL in the specs under `frontend/js/admin-dashboard/`.
  [Changelog](https://github.com/vega/vega-lite/releases)

## Python

Only the standalone utilities in [`scripts/`](../scripts) are Python; the app itself is Scala. Versions are pinned in
the `requirements*.txt` files at the repo root and installed by the [`Dockerfile`](../Dockerfile). After a bump,
rebuild the web image (`docker compose build web`) and run `make test-python`.

### Interpreters

The web image carries two, and **which one a package targets decides which file it goes in**
([#4396](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4396)):

- **Python 3.8** (`python3`) — the base image's own, and past EOL. **Note:** kept only because the deployed app
  shells out to it for in-band clustering (prod runs on Rocky's system Python).
  Retiring it means changing the base image, tracked in
  [#4396](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4396) — until then, don't add libraries to
  `requirements.txt`, because current releases have all dropped 3.8.
- **Python 3.13** (`python3.13`) — a [python-build-standalone](https://github.com/astral-sh/python-build-standalone)
  CPython fetched by **uv 0.12.15** at image build time, since no PPA carries 3.13 for focal. Where offline tooling
  runs. Both interpreters are pinned to exact patch versions in the `Dockerfile` (the installer URL and the
  `uv python install` argument); those patches are in the [runtimes table](#runtimes-and-base-images), so bump the
  `Dockerfile` and that table together. [Python releases](https://www.python.org/downloads/) ·
  [uv releases](https://github.com/astral-sh/uv/releases)

### Packages

- **`requirements.txt`** (3.8, the in-band `label_clustering.py`) — **pandas 2.0.3**, **scipy 1.10.1**,
  **haversine 2.8.1**, **requests 2.32.4**. **Note:** these are the last releases that install on 3.8, so they are
  frozen until the interpreter moves. [pandas](https://pandas.pydata.org/docs/whatsnew/) ·
  [scipy](https://docs.scipy.org/doc/scipy/release.html) ·
  [haversine](https://github.com/mapado/haversine/releases) · [requests](https://github.com/psf/requests/releases)
- **`requirements-offline-tools.txt`** (3.13, `check_streets_for_imagery.py` + `onboard_city.py` +
  `street_gradient.py`) — **pandas 3.0.6**, **requests 2.34.2**, **shapely 2.1.2**, **geopy 2.5.0**,
  **tenacity 9.1.4**, **tqdm 4.70.1**, plus the onboarding geo stack: **osmnx 2.1.1**, **geopandas 1.2.0**,
  **pyogrio 0.13.0**, **scipy 1.18.1**, and the street-gradient raster stack: **rasterio 1.5.2** (its wheel bundles
  GDAL, so nothing comes from the OS), **pyproj 3.8.0**. Self-contained rather than layered on `requirements.txt`,
  since the two files target different interpreters and so can't share a pin.
  **Note:** requires **Python ≥ 3.12**, set by scipy, rasterio and pyproj — re-check it when bumping any of them, and
  update the docs that quote it. [shapely](https://github.com/shapely/shapely/releases) ·
  [geopy](https://github.com/geopy/geopy/releases) · [tenacity](https://github.com/jd/tenacity/releases) ·
  [tqdm](https://github.com/tqdm/tqdm/releases) · [osmnx](https://github.com/gboeing/osmnx/releases) ·
  [geopandas](https://github.com/geopandas/geopandas/releases) ·
  [pyogrio](https://github.com/geopandas/pyogrio/blob/main/CHANGES.md) ·
  [scipy](https://docs.scipy.org/doc/scipy/release.html) ·
  [rasterio](https://github.com/rasterio/rasterio/blob/main/CHANGES.txt) ·
  [pyproj](https://pyproj4.github.io/pyproj/stable/history.html)
- **`requirements-dev.txt`** (both) — **pytest 9.1.1** / **pytest-cov 7.1.0** on 3.10+, **pytest 8.3.5** /
  **pytest-cov 5.0.0** below, by environment marker. **Note:** the boundary is pytest 9's own floor, not the 3.8 side
  — 8.3.5 is both the last pytest supporting 3.8 and the first supporting 3.13, so it covers the 3.8–3.9 gap. Keep the
  ranges adjacent and re-check that overlap before changing either.
  [pytest](https://docs.pytest.org/en/stable/changelog.html) ·
  [pytest-cov](https://github.com/pytest-dev/pytest-cov/blob/master/CHANGELOG.rst)
