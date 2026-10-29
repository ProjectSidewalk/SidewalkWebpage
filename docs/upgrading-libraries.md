# Upgrading libraries

How to upgrade what Project Sidewalk depends on, and what to watch when you do. **The version numbers live in the
manifests the bots bump**: [`build.sbt`](../build.sbt) and `project/` for Scala, [`package.json`](../package.json) for
JavaScript, the `requirements*.txt` files for Python. Scala Steward and Dependabot open the monthly bumps, and patch and
minor ones merge on their own once CI is green (#4395), so a version written down here would be stale within the month.
Other docs mention only stable *major* versions (Scala 3.9, Play 3.0, Java 17).

What this page carries instead is the part a bot can't know: a library gets an entry below only when a bump needs a
human to know something (a hold and why, a private API we reach into, a file to edit alongside, a check to run after).
Those notes are institutional knowledge: update them rather than dropping them, and add one when you learn something
the hard way. The platform section is the exception: runtimes, images and the database server are upgraded by hand, so
their versions are tabled there.

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
| db image | **`postgres:18-trixie`** + PGDG `postgresql-18-postgis-3` (the `postgis/postgis` images are amd64-only, #5789) | 18 / PostGIS 3.6 | ~Aug 2028 (Debian 13) | `db/Dockerfile` |
| ShellCheck image | **`koalaman/shellcheck:v0.11.0`** | 0.11.0 | — | `docker/shellcheck/Dockerfile` (never built; the pin `make shellcheck` and CI run, kept where Dependabot looks) |

- **Focal does more than it looks.** It's what makes `python3` mean 3.8 (retiring that is
  [#4396](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4396)), and its glibc 2.31 is older than the
  2.32 and 2.34 that sbt's `sbtn` needs, so `sbt --client` can't run in the container at all and everything uses
  `sbt --jvm-client` instead (#5268). Jammy (glibc 2.35, `python3` 3.10) or noble (2.39, 3.12) fixes both, but a
  move has to say what happens to 3.8 first.
- **The db image updates by rebuilding.** It's Debian 13 with Postgres from the official image and PostGIS, GEOS and
  PROJ from Postgres's own package server, the same source as prod's.
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

Versions are in [`build.sbt`](../build.sbt), [`project/build.properties`](../project/build.properties) and
[`project/plugins.sbt`](../project/plugins.sbt); look one up at [mvnrepository.com](https://mvnrepository.com/). After
changing any of them, rerun `npm start` so the new versions download and the build re-resolves (a running sbt, which
`make compile` reuses, ignores the change until it reloads). Scala Steward opens the bumps
([`.scala-steward.conf`](../.scala-steward.conf)); a hold goes in its `updates.pin` list, where Scala and Play already
are, since a 3.10 or 3.1 would otherwise merge as a "minor".

- **Scala** — the 3.9 LTS line; the next LTS is a deliberate bump (#5605). Edit `scalaVersion` in `build.sbt` and
  `runner.dialect` in `.scalafmt.conf` (once scalafmt knows the new minor; #5609). Our libraries are published for 3.3,
  which a newer compiler reads fine. A bump mostly surfaces new warnings, and the compiler can fix many itself, but only
  with `-Werror` off (a failed compile writes no fixes):
  `set scalacOptions := scalacOptions.value.filterNot(_ == "-Werror") ++ Seq("-rewrite", "-source", "3.7-migration")`
  then `compile; Test/compile`, once per minor that changed the language (3.3 → 3.9 needed `3.7-migration`, for
  `using`).
- **sbt** — set in `project/build.properties`. The `Dockerfile` pins the apt `sbt` launcher to the same version, so
  also `docker compose build web` after a bump (Compose won't rebuild on its own). sbt **2.x** is gated on Play: its
  `sbt-plugin` has no sbt 2 build outside the 3.1.0 milestones, and sbt 2 build definitions are Scala 3, so it's a
  tracked migration rather than a bump.
- **Play** — the `sbt-plugin` version in `project/plugins.sbt`. The Play libraries in `build.sbt` that share its version
  (`play-guice`, `play-cache`, `play-ws`, `play-caffeine-cache`) read it through `PlayVersion.current`, so they follow
  on their own. play-mailer, play-json, play-slick and play-silhouette are versioned separately and each publishes a
  table of which of its versions goes with which Play:
  [play-mailer](https://github.com/playframework/play-mailer?tab=readme-ov-file#versioning),
  [play-slick](https://github.com/playframework/play-slick?tab=readme-ov-file#all-releases),
  [play-silhouette](https://github.com/playframework/play-silhouette?tab=readme-ov-file#version-compatibility-matrix).
- **scala-guice** — **stay on 6.** 7.0.0 is 6.0.0 with `javax` swapped for `jakarta`
  ([Guice 7 transition](https://github.com/google/guice/wiki/Guice700#jee-jakarta-transition)), which Play hasn't done,
  so 7 breaks core Play functionality until Play migrates (watch the
  [Play changelog](https://www.playframework.com/changelog)).
- **GeoTools (`gt-shapefile`, `gt-epsg-hsql`, `gt-geopkg`)** — Shapefile/GeoPackage generation, served by the OSGeo
  resolver in `build.sbt`, not Maven Central. Needs Java 17. We use a tiny corner of the API, so bumps are usually
  mechanical; check both exports afterward (#4393). The GeoPackage writer relies on gt-geopkg handing back a
  `JDBCDataStore` and on it leaving the `gpkg_contents` bounds to us (#5275), so after a bump confirm
  `ogrinfo -so <file>.gpkg <layer>` shows a real Extent, not (0, 0) - (0, 0).
  [Upgrade notes](https://docs.geotools.org/latest/userguide/welcome/upgrade.html)
- **scalafmt** — pinned in [`.scalafmt.conf`](../.scalafmt.conf), which the **sbt-scalafmt** plugin
  (`project/plugins.sbt`) fetches; `scalafmtCheckAll` and `scalafmtSbtCheck` are blocking CI gates, so a bump that
  changes formatting comes with the reformat.
- **sbt-digest** — the sbt-web plugins moved from `com.typesafe.sbt` to `com.github.sbt`, and only the latter supports
  Play 3.

## JavaScript

Versions are in [`package.json`](../package.json), each an exact pin (`"mapbox-gl": "3.24.1"`, no `^`); look one up at
[npmjs.com](https://www.npmjs.com/). Every library is `import`ed by the module that uses it, stylesheet included
(`import 'mapbox-gl/dist/mapbox-gl.css'`), and `npm ci` installs them from `package-lock.json` in the Dockerfile, CI
and the deploy. Vite then bundles each page with the libraries it reaches and, for a tree-shakeable one like turf,
only the functions it calls (#5734; [`architecture.md`](architecture.md) → "Modules and the build"). The four imagery
viewers `import()` their SDK on demand, through the small modules in `frontend/js/common/pano-viewer/sdk/`, so a
Mapillary city's visitors never download Infra3d's 9 MB and vice versa. **Nothing under `node_modules/` is ever
edited.**

**To upgrade by hand:** `docker exec projectsidewalk-web bash -c 'cd /home && npm install --save-exact <pkg>@<ver>'`,
then `bash tools/dev/npm-sync.sh --write-stamp` so the next `make dev` doesn't redo `npm ci`. Dependabot
([`.github/dependabot.yml`](../.github/dependabot.yml)) opens the monthly bumps; majors wait for a person, and so does
anything in its `npm-imagery` groups (the viewer SDKs, MapLibre, pmtiles, proj4), since CI never drives a
pano viewer or the minimap: try those in a city that uses each one. **A version hold needs an `ignore` entry there**, or
Dependabot bumps straight past it; mapbox-gl's is the one in place.

- **basemap-glyphs** (`public/vendor/basemap-glyphs/`, from protomaps/basemaps-assets at `028c18f`) — the one
  third-party asset served as files: the Noto Sans Regular and Italic glyphs for the minimap's labels (#5716), with
  their license. MapLibre requests them by URL pattern, so they're served from `/basemap/glyphs/`, not `assets.path`.
  To upgrade, copy the two font folders from a newer commit of the [repo](https://github.com/protomaps/basemaps-assets)
  and update the commit here.
- **chart.js** — the API docs' preview charts. Chart.js is modular, and `frontend/js/api-docs/apiDocsChart.js`
  registers only the chart types, scales and plugins the previews use, so a new kind of chart means adding its pieces
  there, or it fails at draw time.
- **i18next** and **i18next-http-backend** — `test/js/i18nextLocales.test.js` runs both over our real locale files in
  every language, so `make test-js args=i18nextLocales` is the check after a bump of either.
- **@inovitas/infra3dapi** (with **proj4**, loaded through `sdk/infra3d.js`) — `Infra3dViewer.js` reaches past the
  documented API into `_sdk_viewer` (`moveToKey`, `movePosition`, `setFilter`, `resize`, the component toggles, the
  `nodechanged` event, the navigator's `imagesByKNN$`) and each node's `spatialEdges$` stream, none of which the
  [changelog](https://developers.infra3d.com/javascript-api/reference/index.html#md:changelog) covers, so after a bump
  grep the package's `infra3dapi.js` for each name. The riskiest bump here, which is why the `npm-imagery` groups wait
  for a person.
- **maplibre-gl** — draws the Explore minimap (#5429). It looks for its Web Worker beside its own file, which in the
  bundle is the Explore chunk, so `Minimap.js` imports the worker through Vite's `?worker&url` and hands the URL to
  `setWorkerUrl`. A bump that renames `dist/maplibre-gl-worker.mjs` fails the build at that import; a worker that
  builds but won't start leaves a blank minimap, logged as `Minimap_Error` or `Minimap_Unavailable` (#5810).
- **mapbox-gl** — imported through `frontend/js/common/mapboxgl.js`, which takes the CSP build and hands it the worker
  Vite builds from `dist/mapbox-gl-csp-worker.js` (the comment there says why the regular build can't be bundled).
  **Held below 3.25 on purpose**, by the `ignore` entry in `.github/dependabot.yml`: from 3.25.0 a symbol layer that
  shares a source with feature-state paint (Route Builder's region labels, AccessScore's) crashes the map with
  `Cannot read properties of undefined (reading 'paint')` once that state changes
  ([mapbox-gl-js#13714](https://github.com/mapbox/mapbox-gl-js/issues/13714)). Take 3.25+ (and drop the entry) once the
  fix ([#13721](https://github.com/mapbox/mapbox-gl-js/pull/13721)) ships, or give every such symbol layer a
  feature-state paint expression first. The same file opens the map credits in a new tab by their
  `.mapboxgl-ctrl-attrib` class (#5856), which mapbox-gl doesn't promise to keep; `test/e2e/map-attribution.spec.js`
  fails if a bump renames it.
- **mapillary-js** (loaded through `sdk/mapillary.js`) — Explore and Validate leave the
  SDK's `.mapillary-attribution-container` where it renders it and override its position from `svl.css` and
  `svv-panorama.css` (#5600), keyed on that class, and Explore's `PanoManager.#liftAboveMapillaryAttribution` finds the
  node by it once and relies on the SDK creating the container once and patching it in place (not replacing it on the
  compact flip); on upgrade, re-check both.
- **pannellum** (loaded through `sdk/pannellum.js`) — the viewer for self-hosted panos. A classic script with no exports
  that puts itself on `window`; that module reads it back.
- **@photo-sphere-viewer/core + equirectangular-tiles-adapter** (loaded through `sdk/photoSphereViewer.js`) — the
  renderer behind the Panoramax imagery provider (#5185). The two packages move together. three.js comes in as PSV's
  own dependency. Never add it to `package.json`: the tiles adapter imports `three` without listing it, so it would
  load our copy while PSV's core loads its own (#5811). `test/js/photoSphereViewerThreeCopy.test.js` fails any
  install that splits them.
  [PSV docs](https://photo-sphere-viewer.js.org/guide/)
- **pmtiles** — lets MapLibre read the minimap's tile archive (#5716). The server's `pmtiles` command-line tool is
  separate: it's pinned in `BasemapService` (`CliVersion` and each release file's SHA-256), so change those to upgrade
  it. [CLI releases](https://github.com/protomaps/go-pmtiles/releases)
- **prismjs** — syntax highlighting for the API docs' code blocks. `pages/api-docs/layout.js` imports the core plus
  only the language components the docs use (`json`, `csv`), so a new `language-*` class in a docs page means importing
  that component too. **No stock theme:** the `.token.*` colors are ours, in `css/pages/api-docs/api-docs.css`, so the
  blocks stay on the design-system tokens. **1.x is the line to track:** v1 is in maintenance while the repo's default
  branch develops **v2**, an unreleased breaking rewrite (ESM, `src/languages/`, a different dist layout), so 2.x will
  be a migration rather than a bump.
- **tom-select** — the tag picker on Validate. We import the `tom-select/base` build, which has no plugins, plus the
  unthemed `tom-select.css`; the picker's look comes from `svv-validation-menu.css`.
- **vega, vega-lite, vega-embed** — the coverage charts on the admin dashboard. We write Vega-Lite specs and hand them
  to `vegaEmbed`, which pulls in Vega itself as the renderer, so all three move together. When bumping vega-lite's
  major, also bump the `$schema` URL in the specs under `frontend/js/admin-dashboard/`.

## Python

Only the standalone utilities in [`scripts/`](../scripts) and [`tools/`](../tools) are Python; the app itself is Scala.
Versions are pinned in the `requirements*.txt` files at the repo root (look one up at [pypi.org](https://pypi.org/))
and installed by the [`Dockerfile`](../Dockerfile). After a bump, rebuild the web image (`docker compose build web`) and
run `make test-python`.

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

- **`requirements.txt`** (3.8, the in-band `label_clustering.py`: pandas, scipy, haversine, requests) — **frozen** at
  the last releases that install on 3.8, until the interpreter moves; Dependabot skips the file.
- **`requirements-offline-tools.txt`** (3.13: `check_streets_for_imagery.py`, `onboard_city.py`, `street_gradient.py`;
  pandas, requests, shapely, geopy, tenacity, tqdm, the onboarding geo stack of osmnx, geopandas, pyogrio and scipy, and
  the street-gradient raster stack of rasterio, whose wheel bundles GDAL so nothing comes from the OS, and pyproj) —
  self-contained rather than layered on `requirements.txt`, since the two files target different interpreters and so
  can't share a pin. **Requires Python ≥ 3.12**, set by scipy, rasterio and pyproj: re-check that floor when bumping any
  of them, and update the docs that quote it.
- **`requirements-dev.txt`** (both: pytest, pytest-cov) — two pinned pairs by environment marker, pytest 9 on 3.10+ and
  pytest 8.3.5 below. **The boundary is pytest 9's own floor, not the 3.8 side**: 8.3.5 is both the last pytest
  supporting 3.8 and the first supporting 3.13, so it covers the 3.8–3.9 gap. Keep the ranges adjacent and re-check that
  overlap before changing either.
