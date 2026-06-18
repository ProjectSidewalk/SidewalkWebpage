# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Project Sidewalk is a web-based crowdsourcing tool for mapping and assessing sidewalk accessibility. The backend is **Scala + Play Framework 3.0** (Scala 2.13, Java 17) with a **Postgres + PostGIS** database accessed via **Slick** (with slick-pg for spatial/JSON types). The frontend is **vanilla JavaScript + jQuery + Bootstrap**, organized as several independent apps that are bundled with **Grunt** (concatenation only — no transpilation/minification). Everything runs in **Docker** for development.

## Development commands

Development runs inside Docker. The `Makefile` wraps `docker-compose`.

```bash
make dev            # start the db container, then drop into a shell in the web container
                    # (= make docker-up-db + make docker-run)
make docker-up      # start all services detached
make docker-stop    # stop and remove containers
make ssh target=db  # exec into a running container (projectsidewalk-db / -web)
```

Inside the web container shell, start the app with the npm scripts (they run Grunt concat + watch in the background, then `sbt run`):

```bash
npm start           # grunt watch + sbt run, using conf/application.local.conf; serves on :9000
npm run debug       # same, with sbt JVM debug on port 9998
```

The app serves on **http://localhost:9000**. First compile is slow (sbt resolves dependencies). Sbt is configured to keep coursier/sbt caches inside the project dir (`.coursier`, `.sbt`).

### Building frontend assets

JS/CSS is concatenated by Grunt (see `Gruntfile.js`). `grunt watch` rebuilds bundles on change; `grunt` (default) or `npm run grunt-concat` builds once. Bundles are written to `public/javascripts/*/build/`. **Edit the `src/` files, never the `build/` output.** Concatenation order matters and is hand-specified in `Gruntfile.js` (e.g. `PopupPanoManager` and `LabelDetail` must precede `LabelPopup`).

### Linting

```bash
make lint           # eslint + htmlhint + stylelint
make lint-fix       # eslint --fix + stylelint --fix
make eslint dir=public/javascripts/SVValidate   # scope to a dir; also htmlhint / stylelint targets
```

Config: `.eslintrc.json`, `.stylelintrc.json`, `.htmlhintrc`. Scala formatting is `.scalafmt.conf`.

### Tests

There is **no Scala/backend test suite** in this repo. `npm test` runs Grunt-based frontend checks. Validate backend changes by compiling (`sbt compile` / `sbt run`) — note `build.sbt` sets `-Xfatal-warnings`, so warnings (unused imports/params, dead code, value discard) fail the build.

## Backend architecture

Request flow: **routes → Controller → Service → Table (DAO)**.

- **`conf/routes`** — single routes file mapping URLs to controller methods. The public data API lives under `/v3/api/...` (handlers in `app/controllers/api/`).
- **`app/controllers/`** — thin HTTP layer. Auth-protected actions use **Silhouette** (`SilhouetteModule.scala`, `app/models/auth/`). `app/controllers/api/` holds the versioned public API controllers.
- **`app/service/`** — business logic (e.g. `LabelService`, `ValidationService`, `ExploreService`, `AccessScoreService`, `ApiService`). Controllers should delegate here rather than touching tables directly.
- **`app/models/`** — Slick table definitions and queries, grouped by domain (`label/`, `validation/`, `mission/`, `region/`, `street/`, `route/`, `user/`, `cluster/`, `gallery/`, `api/`, ...). Files named `*Table.scala` define schema + queries (DAO pattern).
- **`app/models/utils/MyPostgresProfile.scala`** — custom Slick Postgres profile wiring in PostGIS geometry, JSON, and other slick-pg extensions. Spatial query helpers are in `SpatialQueryDefs.scala`.
- **DI**: Guice. App bootstraps via `app/CustomApplicationLoader.scala`; modules registered in `conf/application.conf` and defined in `app/modules/` (`CustomControllerModule`, `ActorModule`, `ExecutorsModule`, `SilhouetteModule`). Custom execution contexts are in `app/executors/`; background actors in `app/actor/`.
- **Views**: Twirl templates (`app/views/*.scala.html`). The sbt build silences warnings in `views/` and the routes file specifically.

### Database & evolutions

Schema changes are **Play evolutions**: numbered SQL files in `conf/evolutions/default/` (`1.sql` … `99.sql`). Add the next-numbered file for schema changes; each has `# --- !Ups` and `# --- !Downs` sections. The dev DB is seeded from a dump — see the wiki and `db/scripts/` (`import-dump`, `create-new-schema`, etc., exposed as `make` targets). Connection config is env-driven (`DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD`) in `conf/application.conf`.

## Frontend architecture

Each major UI is a self-contained app under `public/javascripts/`, bundled separately by Grunt and loaded by the corresponding Twirl view:

- **`SVLabel/`** — the Explore/Audit tool (users label accessibility issues on street-view panoramas). The largest app.
- **`SVValidate/`** — the Validate tool (users confirm/reject others' labels).
- **`Gallery/`** — browsable gallery of labels with filtering.
- **`Admin/`** — admin dashboards and maps.
- **`Progress/`** — user/neighborhood progress dashboards.
- **`PSMap/`** — shared map component used across pages.
- **`Help/`** — interactive help/onboarding.
- **`common/`** — shared modules pulled into multiple bundles: `pano-viewer/` (abstraction over GSV / Mapillary / Infra3d / Pannellum imagery providers), `label-detail/` (label popups), and various utilities.

Frontend i18n strings live in `public/locales/<lang>/`; backend i18n in `conf/messages.<lang>`.

## Configuration

- `conf/application.conf` is the base; environment overlays are `application.local.conf`, `application.staging.conf`, `application.test.conf`. `npm start` runs with `application.local.conf`.
- Per-city settings: `conf/cityparams.conf` (selected via `SIDEWALK_CITY_ID`). Many secrets/keys come from env vars (Mapbox, Google Maps, Gemini, Mapillary, Infra3d, Silhouette signer/crypter); dev defaults are dummy values in `docker-compose.yml`, with real local values in `docker-compose.override.yml`.

## Python utilities

Two standalone scripts (run via the Python deps in `requirements.txt`, installed in the Docker image), invoked out-of-band rather than from the running web app:

- `label_clustering.py` — clusters nearby labels (used by the clustering flow; see `ClusterController.scala` / `app/models/cluster/`).
- `check_streets_for_imagery.py` — checks streets for available street-view imagery (related: `make hide-streets-without-imagery`).

## Conventions

- Version lives in `build.sbt` (`version`) and is bumped per release.
- Main development branch is **develop**; **master** is the release branch. PRs target `develop`.
- When changing JS behavior, edit `src/` and let `grunt watch` rebuild; if a new `src/` file isn't picked up, check that its path matches a glob in `Gruntfile.js`.
