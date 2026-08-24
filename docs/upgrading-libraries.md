# Upgrading libraries

This is the **canonical inventory** of the third-party libraries Project Sidewalk depends on, with the version we're
on and how to check for and apply updates to each. We update libraries periodically; this page exists so that the
next person scanning the list can tell at a glance whether something has a newer release available.

**Keep the versions here in sync with the code, and keep this the _only_ place full versions live.** Other docs
([`CLAUDE.md`](../CLAUDE.md), [`docs/architecture.md`](architecture.md), the README) mention only stable *major*
versions (Scala 2.13, Play 3.0, Java 17) and point here for the exact numbers — so a patch bump only has to be
recorded once. When you upgrade a library, bump its version number below in the same change.

> Many entries carry a **note** explaining *why* we're pinned where we are (a known incompatibility, an abandoned
> upstream, a migration we haven't taken on yet). Those notes are institutional knowledge — preserve and update them
> rather than dropping them.

## Scala / sbt / Play

These versions live in [`build.sbt`](../build.sbt), [`project/build.properties`](../project/build.properties), and
[`project/plugins.sbt`](../project/plugins.sbt). After changing any of them, rerun `npm start` (or
`sbt --client compile`) so the new versions download and the build re-resolves.

### Core toolchain

- **Scala: 2.13.18** — we're staying on 2.13 for now; the move to Scala 3 is a major lift tracked in
  [#3936](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3936) (unclear if all our libraries support it
  yet). Edit `scalaVersion` in `build.sbt`.
  [Releases](https://www.scala-lang.org/download/all.html) · [Changelog](https://github.com/scala/scala/releases)
- **sbt: 1.12.13** — set in `project/build.properties`; downloaded automatically on the next `npm start`. You may need
  to bump Play at the same time for major sbt updates. [Releases](https://github.com/sbt/sbt/releases)
- **Play Framework: 3.0.11** — to update: (1) change the version in `project/plugins.sbt` (the `sbt-plugin`
  dependency), and (2) change it in `build.sbt` for the Play-provided libraries that share Play's versioning scheme
  (`play-guice`, `play-cache`, `play-ws`, `play-caffeine-cache`).
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
- **ficus: 1.5.2** — typed config reading.
  [Releases](https://mvnrepository.com/artifact/com.iheart/ficus)

### Database (Slick + Postgres + PostGIS)

- **postgresql (JDBC driver): 42.7.10** — the `org.postgresql` driver in `build.sbt`.
  [Releases](https://mvnrepository.com/artifact/org.postgresql/postgresql) · [Changelog](https://jdbc.postgresql.org/)
- **play-slick / play-slick-evolutions: 6.2.0**.
  [Releases](https://mvnrepository.com/artifact/org.playframework/play-slick) ·
  [Which version to use](https://github.com/playframework/play-slick?tab=readme-ov-file#all-releases)
- **slick-pg (+ `slick-pg_jts_lt`, `slick-pg_play-json`): 0.23.1** — PostGIS/JSON Slick extensions.
  [Releases](https://mvnrepository.com/artifact/com.github.tminglei/slick-pg) ·
  [Changelog](https://github.com/tminglei/slick-pg/releases)

### Geospatial

- **jts: 1.20.0** — geometry types.
  [Releases](https://mvnrepository.com/artifact/org.locationtech.jts/jts) ·
  [Changelog](https://projects.eclipse.org/projects/locationtech.jts)
- **jackson-datatype-jts: 1.2.10** — automatic WKT → GeoJSON/Shapefile conversion with slick-pg. **Note:** finding a
  version compatible with our slick-pg/jts has been finicky; newer versions exist (from
  [other repos](https://mvnrepository.com/search?q=jackson-datatype-jts)) but may not work. Take minor bumps from the
  link below; a full upgrade needs dedicated investigation.
  [Releases](https://mvnrepository.com/artifact/org.n52.jackson/jackson-datatype-jts)
- **gt-shapefile / gt-epsg-hsql / gt-geopkg (GeoTools): 29.6** — Shapefile/GeoPackage generation. **Note:** we froze
  here over a compatibility issue, though it's not confirmed we *couldn't* move forward. GeoTools is actively
  maintained, so there are likely benefits to figuring out the upgrade.
  [Releases](https://mvnrepository.com/artifact/org.geotools/gt-shapefile?repo=geotools-releases) ·
  [Changelog](https://github.com/geotools/geotools/releases)
- **jai_core: 1.1.3** — pulled in by GeoTools; not on Maven Central, so `build.sbt` downloads it from the OSGeo repo.
  **Note:** no new releases; GeoTools has
  [long-term plans to phase it out](https://github.com/geotools/geotools/wiki/Replace-JAI).
  [Releases](https://mvnrepository.com/artifact/javax.media/jai_core)

### Other Scala

- **metadata-extractor: 2.19.0** — reads EXIF (photos) and QuickTime/MP4 atoms (videos) from user-uploaded story
  media (#4054). Pure Java with one small transitive dep (`xmpcore`); used transiently on ingest — the derived
  recency/proximity buckets are stored, the precise values discarded.
  [Releases](https://mvnrepository.com/artifact/com.drewnoakes/metadata-extractor) ·
  [Changelog](https://github.com/drewnoakes/metadata-extractor/releases)
- **play-bootstrap: 1.6.1-P28-B3** — Twirl helpers for the sign-in/up views. **Note:** the `P28-B3` suffix means
  "Play 2.8, Bootstrap 3"; 1.6.1 is the newest and there have been no releases since April 2020. It still works, only
  a few pages use it (mostly auth), and we don't expect further updates — we'd rather move off Bootstrap entirely.
  [Releases](https://mvnrepository.com/artifact/com.adrianhurt/play-bootstrap) ·
  [Docs](https://playframework.github.io/play-bootstrap/)

### Build plugins & test (`project/plugins.sbt`, `.scalafmt.conf`, test deps)

- **sbt-plugin (Play): 3.0.11** — tracks the Play version above (`project/plugins.sbt`).
- **scalafmt: 3.9.10** — pinned in [`.scalafmt.conf`](../.scalafmt.conf); the **sbt-scalafmt** plugin (**2.5.6**,
  `project/plugins.sbt`) fetches it. `scalafmtCheckAll` is a blocking CI gate.
  [Releases](https://github.com/scalameta/scalafmt/releases)
- **sbt-scoverage: 2.4.4** — coverage, for a later CI phase with a ratcheting threshold.
  [Releases](https://github.com/scoverage/sbt-scoverage/releases)
- **sbt-digest: 2.1.0** — content-fingerprints assets during `stage`/`dist` (see `build.sbt`). Note the org: the
  sbt-web plugins moved from `com.typesafe.sbt` to `com.github.sbt`, and only the latter supports Play 3.
  [Releases](https://github.com/sbt/sbt-digest/releases)
- **scalatestplus-play: 7.0.2** (test scope) — ScalaTest + Play test helpers; backs the API specs under `test/`.
  [Releases](https://mvnrepository.com/artifact/org.scalatestplus.play/scalatestplus-play)

## JavaScript

In almost all cases we **self-host** JS libraries (download the file into `public/vendor/<lib>/`) rather than use a
CDN — it's generally faster for users and gives us clearer control over exactly what we ship. Prefer minified
(`.min.js`) builds. Each library gets its own self-contained folder under `public/vendor/` (its JS + CSS + fonts +
images together, upstream layout preserved so relative `url()` refs keep working). **Nothing under `vendor/` is ever
edited or linted.**

**To upgrade a self-hosted library:** download the new version, drop it in `public/vendor/<lib>/`, **rename it to
include the version number** (e.g. `turf-7.3.4.min.js`) for clarity, update every reference to the old filename across
the code, and delete the old file. The version baked into each filename under `vendor/` is the real source of truth for
the frontend — the app has no asset fingerprinting, so version-in-filename is the only cache-buster — keep this list
matching it.

- **async-lock: 1.4.1** — **note:** a fresh download probably needs the trailing `module.export` line removed.
  [Download](https://cdn.jsdelivr.net/npm/async-lock@1.4.1/lib/index.min.js) ·
  [Versions](https://github.com/rogierschouten/async-lock/releases)
- **betterknown: 1.2.0** — [Download](https://unpkg.com/betterknown) ·
  [Versions](https://www.npmjs.com/package/betterknown?activeTab=versions) ·
  [Changelog](https://github.com/placemark/betterknown/releases)
- **bootstrap: 3.3.5** — **note:** upgrading Bootstrap is a huge undertaking, deferred indefinitely — the goal is to
  remove the dependency entirely (a slow, ongoing transition). (A separate copy of Bootstrap 3.1.1 ships inside the
  `bootstrap-accessibility-plugin/` bundle below.)
- **bootstrap-accessibility-plugin** (bundles Bootstrap 3.1.1 + jQuery 1.12.2) — accessibility patches for our
  Bootstrap 3 UI; lives in `public/vendor/bootstrap-accessibility/` (with the bundled Bootstrap 3.1.1 JS and jQuery
  1.12.2 split out into `public/vendor/bootstrap/` and `public/vendor/jquery/`). Tied to the Bootstrap-removal effort.
- **bowser: 2.14.1** — browser detection.
  [Versions](https://www.npmjs.com/package/bowser?activeTab=versions) ·
  [Changelog](https://github.com/bowser-js/bowser/releases)
- **chart.js: 4.5.1** — check the running version with `Chart.version`.
  [Download](https://unpkg.com/chart.js) · [Changelog](https://github.com/chartjs/Chart.js/releases)
- **countUp.js: 1.9.3** — animates the counting-up of stats on the landing page; lightly used. (Several libraries
  share this name — be careful which you grab.)
- **d3: 3.5.6** — **note:** we're several major versions behind; it's a big library and the upgrade hasn't been
  prioritized. [Versions](https://www.npmjs.com/package/d3?activeTab=versions) ·
  [Changelog](https://github.com/d3/d3/releases)
- **dataTables.bootstrap / jquery.dataTables** — **TODO:** clarify these and their relationship to jQuery/Bootstrap.
  Tied to the jQuery/Bootstrap removal effort.
- **floating-ui: 1.7.6 (`@floating-ui/dom`), 1.7.5 (`@floating-ui/core`)** — **note:** start from the newest `dom`
  version, then pick a `core` version that satisfies its dependency.
  [Changelog](https://github.com/floating-ui/floating-ui/releases) ·
  [Download dom](https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.7.6) ·
  [Download core](https://cdn.jsdelivr.net/npm/@floating-ui/core@1.7.5)
- **i18next: 23.16.8** — **note:** v24+ has breaking changes we haven't worked through (the changelog links a
  migration guide); take minor bumps meanwhile.
  [Download](https://unpkg.com/i18next/dist/umd/i18next.min.js) ·
  [Changelog](https://github.com/i18next/i18next/blob/master/CHANGELOG.md)
- **i18next-http-backend: 3.0.4** — loads translation files (`i18nextHttpBackend-3.0.4.min.js`).
  [Project + downloads](https://github.com/i18next/i18next-http-backend) ·
  [Changelog](https://github.com/i18next/i18next-http-backend/blob/master/CHANGELOG.md)
- **infra3dapi: 1.8.0** — Infra3d imagery provider. **Note:** we currently ship a locally-patched build with fixes we
  needed; expect those to land upstream soon. Test by panning in a circle — watch for jumpiness.
  [Download](https://cdn.jsdelivr.net/npm/@inovitas/infra3dapi@1.8.0/infra3dapi.js) ·
  [Changelog](https://developers.infra3d.com/javascript-api/reference/index.html#md:changelog)
- **js-cookie: 3.0.5** — [Download](https://unpkg.com/js-cookie) ·
  [Changelog](https://github.com/js-cookie/js-cookie/releases)
- **kinetic: 4.4.3** — **note:** only used for the hand animation in the Explore tutorial;
  [no longer maintained](https://github.com/ericdrowell/KineticJS). Could bump to 5.1.0 and leave it.
- **mapbox-gl (js & css): 3.21.0** — check with `mapboxgl.version`.
  [Install/download](https://docs.mapbox.com/mapbox-gl-js/guides/install/) ·
  [Changelog](https://github.com/mapbox/mapbox-gl-js/blob/main/CHANGELOG.md)
- **mapbox-gl-language: 1.0.1** — [Download](https://unpkg.com/@mapbox/mapbox-gl-language) ·
  [Changelog](https://github.com/mapbox/mapbox-gl-language/releases)
- **mapbox-search-js: 1.5.0** — [Install/download](https://docs.mapbox.com/mapbox-search-js/guides/install/) ·
  [Changelog](https://docs.mapbox.com/mapbox-search-js/guides/changelog/)
- **mapillary: 4.1.2** — Mapillary imagery provider.
  [Downloads](https://mapillary.github.io/mapillary-js/docs/intro/try/#using-a-cdn) ·
  [Changelog](https://github.com/mapillary/mapillary-js/releases)
- **moment.js: 2.30.1** — vendored alongside one locale file per supported language. Only `en` and `en-US` need none,
  since moment has US English built in; other English variants do have their own file (`en-NZ` formats dates
  differently). **Adding a language means adding its locale file too**, or its dates silently render in English;
  `common/main.scala.html` picks the file by lowercased language code. [Download](https://momentjs.com/) ·
  [Locale files](https://github.com/moment/moment/tree/develop/locale) ·
  [Changelog](https://github.com/moment/moment/blob/develop/CHANGELOG.md)
- **pannellum: 2.5.7** — Pannellum panorama viewer. [Download](https://pannellum.org/download/) ·
  [Changelog](https://github.com/mpetroff/pannellum/blob/2.5.7/changelog.md)
- **panzoom: 9.4.4** — zoom/pan for static images in LabelMap/Gallery.
  [Download](https://unpkg.com/panzoom@9.4.4/dist/panzoom.min.js) · [Versions](https://github.com/anvaka/panzoom/tags)
- **proj4js: 2.19.10** — [Download](https://cdnjs.com/libraries/proj4js) ·
  [Changelog](https://github.com/proj4js/proj4js/releases)
- **selectize.js: 0.15.2** — **note:** unmaintained (last release 2022). The suggested successor is
  [tom-select](https://github.com/orchidjs/tom-select), a maintained fork that drops jQuery — a good fit as we move
  off jQuery. [Download](https://selectize.dev/docs/intro) · [Changelog](https://github.com/selectize/selectize.js/releases)
- **three.js: 0.160.1** — **note:** only used to compute camera pitch/roll for Mapillary imagery. Mapillary bundles
  three.js but doesn't expose it on `window`. After 0.160.1 upstream stopped shipping a standalone `three.min.js`
  (bundler-only), so upgrading isn't worth it soon.
  [Download](https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js) ·
  [Changelog](https://github.com/mrdoob/three.js/releases)
- **turf.js: 7.3.4** — [Download (set version in URL)](https://unpkg.com/@turf/turf@7.3.4/turf.min.js) ·
  [Changelog](https://github.com/Turfjs/turf/releases)
- **jquery.magnific-popup** — **TODO:** unclear status; resolve the jQuery situation first. Tied to jQuery removal.

> **jQuery / Bootstrap removal:** several entries above (Bootstrap, dataTables, magnific-popup, selectize) are part of
> a slow, deliberate transition *off* jQuery and Bootstrap toward native JS/CSS. Prefer native alternatives in new
> code rather than leaning further on these. See the coding guidance in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Python

Only the standalone utilities in [`scripts/`](../scripts) are Python; the app itself is Scala. Versions are pinned in
the `requirements*.txt` files at the repo root and installed by the [`Dockerfile`](../Dockerfile). After a bump,
rebuild the web image (`docker compose build web`) and run `make test-python`.

### Interpreters

The web image carries two, and **which one a package targets decides which file it goes in**
([#4396](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4396)):

- **Python 3.8** (`python3`) — the `eclipse-temurin:17-jdk-focal` base image's own. **Note:** EOL since October 2024,
  kept only because the deployed app shells out to it for in-band clustering (prod runs on Rocky's system Python).
  Retiring it means changing the base image, gated on the prod-environment audit
  ([#4385](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4385)) — until then, don't add libraries to
  `requirements.txt`, because current releases have all dropped 3.8.
- **Python 3.13.15** (`python3.13`) — a [python-build-standalone](https://github.com/astral-sh/python-build-standalone)
  CPython fetched by **uv 0.12.5** at image build time, since no PPA carries 3.13 for focal. Where offline tooling
  runs. Both versions are pinned exactly in the `Dockerfile` (the installer URL and the `uv python install` argument),
  so bump them there and here together. [Python releases](https://www.python.org/downloads/) ·
  [uv releases](https://github.com/astral-sh/uv/releases)

### Packages

- **`requirements.txt`** (3.8, the in-band `label_clustering.py`) — **pandas 2.0.3**, **scipy 1.10.1**,
  **haversine 2.8.1**, **requests 2.32.4**. **Note:** these are the last releases that install on 3.8, so they are
  frozen until the interpreter moves. [pandas](https://pandas.pydata.org/docs/whatsnew/) ·
  [scipy](https://docs.scipy.org/doc/scipy/release.html) ·
  [haversine](https://github.com/mapado/haversine/releases) · [requests](https://github.com/psf/requests/releases)
- **`requirements-offline-tools.txt`** (3.13, `check_streets_for_imagery.py`) — **pandas 3.0.5**,
  **requests 2.34.2**, **shapely 2.1.2**, **geopy 2.5.0**, **tenacity 9.1.4**, **tqdm 4.70.0**. Self-contained rather
  than layered on `requirements.txt`, since the two files target different interpreters and so can't share a pin.
  **Note:** requires **Python ≥ 3.11**, and pandas is what sets that floor — re-check it when bumping pandas, and
  update the docs that quote it. [shapely](https://github.com/shapely/shapely/releases) ·
  [geopy](https://github.com/geopy/geopy/releases) · [tenacity](https://github.com/jd/tenacity/releases) ·
  [tqdm](https://github.com/tqdm/tqdm/releases)
- **`requirements-dev.txt`** (both) — **pytest 9.1.1** / **pytest-cov 7.1.0** on 3.10+, **pytest 8.3.5** /
  **pytest-cov 5.0.0** below, by environment marker. **Note:** the boundary is pytest 9's own floor, not the 3.8 side
  — 8.3.5 is both the last pytest supporting 3.8 and the first supporting 3.13, so it covers the 3.8–3.9 gap. Keep the
  ranges adjacent and re-check that overlap before changing either.
  [pytest](https://docs.pytest.org/en/stable/changelog.html) ·
  [pytest-cov](https://github.com/pytest-dev/pytest-cov/blob/master/CHANGELOG.rst)
