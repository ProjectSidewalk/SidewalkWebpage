# Testing & CI Plan

_A proposed, phased plan to introduce an automated test suite and continuous integration to Project Sidewalk. Drafted June 2026 from a code-audit pass; open for team feedback. Tracking issue: #1086._

## Context

Project Sidewalk is a public civic-tech app with real end users, yet it currently has **zero backend (Scala) tests, no JS tests, and no CI** — `.github/` contains only a PR template, and `npm test` invokes a non-existent grunt task. A recent audit shipped a security fix (PR #4239: SQL-injection escaping + `saveImage` path validation) and surfaced a discarded-`DBIO` data-integrity bug (#4228) — none of which have anything guarding them against regression. The compiler (`-Xfatal-warnings`) is presently the *only* automated gate.

**Goal:** stand up a layered, best-practices test suite + GitHub Actions CI, delivered in **independently mergeable phases**, the first of which requires *zero tests to exist* so it can land immediately.

**Non-goals (for now):** deep canvas/imagery E2E, high coverage targets, or rewriting the frontend to a module system.

## Test architecture — four layers (fat base, thin top)

- **(a) Unit, no-DB** — plain ScalaTest on pure logic / DI-free `object`s. Milliseconds, no app, no services.
- **(b) DB integration** — `*Service`/`*Table` query tests against **real Postgres + PostGIS** (H2 cannot emulate the slick-pg geometry/enum/jsonb/hstore types in `app/models/utils/MyPostgresProfile.scala`). Home of the #4239 / #4228 regressions.
- **(c) In-JVM functional/route** — boot a `GuiceApplicationBuilder` app with faked Silhouette auth, stubbed `WSClient`, and the eager actors disabled; exercise controllers/routes including auth guards and the public v3 API.
- **(d) Thin browser E2E (advisory)** — Playwright smoke suite ([`test/e2e/`](../test/e2e)): loads each core page in headless Chromium and fails on uncaught console/page errors, external imagery stubbed or skip-guarded. Runs as an **advisory job on every PR** (`e2e-smoke`, `continue-on-error` — like `backend-tests`), promotable to blocking once proven stable. **Landed with #4504** (page-load phase; interactions and flows are later phases).

## Test database

- **CI uses a GitHub Actions `services:` container** (`postgis/postgis:16-3.5`) — simpler/faster than Testcontainers (no Docker-in-Docker, no per-suite startup), and contributors aren't forced to run Docker locally.
- Connection comes from env vars so the *same* tests run against the CI service, a local dev DB, or an **optional** Testcontainers instance toggled by a system property (Testcontainers stays available, not mandatory).
- **Schema:** `play.evolutions.db.default.autoApply=true` is already set and `conf/application.test.conf` does `include "application.conf"`, so Play applies all evolutions automatically on first DB access — **once per CI job**. Measure apply time in Phase 2; cache an evolved volume/image only if it proves slow.
- **Isolation:** transaction-rollback per test for layer (b); `TRUNCATE … RESTART IDENTITY CASCADE` + minimal reseed in `beforeEach` for layer (c) (the HTTP path can't share a transaction). Never drop/re-evolve per test. Keep layer-(b) and layer-(c) suites separate (enforced via tags + directories).
- Start with the stock PostGIS image; only switch to the repo's `db/` image (adds pgrouting/gdal) if a test actually needs those extensions.

## Dependencies to add

`build.sbt` (Test-scoped; pin exact versions, let automation bump):
```scala
"org.playframework"            %% "play-test"               % "3.0.10" % Test,
"org.scalatestplus.play"       %% "scalatestplus-play"      % "7.0.1"  % Test,
"org.playframework.silhouette" %% "play-silhouette-testkit" % "10.0.4" % Test,  // confirm artifact publishes for this line; else hand-roll FakeEnvironment (~20 lines)
"com.dimafeng"                 %% "testcontainers-scala-scalatest"  % "0.43.0" % Test,  // optional local toggle
"com.dimafeng"                 %% "testcontainers-scala-postgresql" % "0.43.0" % Test,
"org.mockito"                   % "mockito-core"            % "5.14.2" % Test
```
`project/plugins.sbt` (currently only the Play plugin):
```scala
addSbtPlugin("org.scalameta" % "sbt-scalafmt"  % "2.5.4")
addSbtPlugin("org.scoverage" % "sbt-scoverage" % "2.3.1")
```

## Test support harness — `test/` mirrors `app/`, plus `test/support/`

- `support/PostgresTestKit.scala` — DB config, evolutions-applied-once, transaction-rollback helper.
- `support/FakeAuth.scala` — `FakeEnvironment[DefaultEnv]` + `SidewalkUserWithRole` fixtures. Roles are checked against `RoleTable.ADMIN_ROLES` (`app/models/auth/WithRole.scala`): use an admin role for `WithAdmin`, `"Registered"` for `WithSignedIn`, `"Anonymous"` for negatives. **Gotchas** (from `app/service/CustomSecurityService.scala`): every `SecuredAction` runs `ensureUserStatExists` (so the fixture user row must exist in the test DB) and an Infra3d check — keep `panoSource = GSV` in test config or set `infra3dAccess = true`.
- `support/GuiceTestApp.scala` — `GuiceApplicationBuilder` that **neutralizes the eager actors** by overriding `ActorInitializer` (`app/actor/ActorInitializer.scala`) with a no-op (smaller blast radius than `.disable[ActorModule]`, which would also require re-binding the `@Named` `ActorRef`s), and `bind[WSClient].toInstance(stub)`.
- `support/WsStubs.scala` — canned responses for the external callers: `PanoDataService` (Google SV metadata, Infra3d OAuth), `AiService` (Sidewalk AI), `ConfigService` (SciStarter).
- ScalaTest **tags** `DbTest` / `Functional` so CI can include/exclude by phase; unit tests untagged (always run).

## First concrete test targets

- **Unit (a):** `ImageSigningServiceSpec` (HMAC sign/verify, expiry, tamper, wrong-path), `CommonUtilsSpec` (`calculateDestination`), `ControllerUtilsSpec` (`parseIntegerSeq`/`isMobile`/`parseURL`), `PanoDataServiceMathSpec` (`getFov`/`calculatePovFromPanoXY`/`toLatLng`).
- **DB (b):** **`LabelTableSqlEscapingSpec` (#4239)** — drive the raw-SQL builders with `'`, `''`, `'; DROP TABLE` payloads in regionName/tags/labelType/wayType; assert safe execution + correct results; mirror for `ClusterTable`/`StreetEdgeTable`. **`ValidationServiceSpec` (#4228)** — assert the previously-discarded `DBIO` side effect actually persists inside `.transactionally`.
- **Functional (c):** **`ImageControllerSpec` (#4239)** — `saveImage` rejects path-traversal `label_type`/`name` and requires a signed-in user; `serveCropImage` enforces `labelTypeNames` + HMAC + Referer. `PublicApiSpec` — v3 bbox/date/CSV parsing + output shape. **`RouteAuthPostureSpec` (#4441)** — table-driven over `Router.documentation`: every declared `/adminapi/` route must refuse an anonymous request (explicit allow-list for the two that stay public), plus authenticated checks that pin the *required role*, which the anonymous cases cannot distinguish.

## Frontend testing

- **Runner: Jest + jsdom** (CommonJS-friendly for the no-module global-script reality; less ESM friction than Vitest). Load each pure util via a small `vm`/require helper that captures its global (`util.math`, the pano-viewer classes) — **no production-code changes required** to start. First targets: `common/UtilitiesMath.js`, `common/pano-viewer/src/PanoUtilities.js`, `common/aggregate-stats.js`.
- Replace the broken `npm test` (`grunt && grunt test`) with `jest`.
- **Lint gate** (`make lint`: ESLint + Stylelint + HTMLHint + locale key-parity, plus the evolutions lint below) was rolled out under **#2487**, sequenced with the in-progress JS ES5→ES2022 migration (dropping linters into CI mid-migration = large, conflict-prone churn). All four are **now blocking** steps in the `frontend` job — ESLint (`public/js/` + `public/locales/`), Stylelint (`public/**/*.css`), HTMLHint (`app/views`), and `tools/check-locale-parity.mjs` — each landing once its tree was clean, straight to blocking with no advisory ramp (same as scalafmt/evolutions-lint). **Severity is the gate**: `error` rules block the build (correctness + must-fix smells like `no-unused-vars`/`no-shadow`), while the one `warn` rule on ESLint/Stylelint (`max-len` / `max-line-length`) is deliberately advisory — CLAUDE.md sanctions long-line exceptions, so they're *not* run with `--max-warnings 0`.

## Python utility testing

- **Runner: `pytest`** for the two standalone scripts in [`scripts/`](../scripts) (`label_clustering.py`, `check_streets_for_imagery.py`) — the only Python in the repo. Tests live in [`test/python/`](../test/python); config is in `pyproject.toml` (`[tool.pytest.ini_options]`, with `scripts/` on `pythonpath`).
- The scripts were refactored so their decision logic sits in **pure, importable** functions (distance metric, coordinate cleaning, clustering, cluster-id offsetting; bounding-box/vertex math, GSV/Mapillary response parsing, imagery-decision thresholds, CSV writing), with network/file I/O isolated in thin wrappers and `main`. Tests target the pure functions — **no DB, no network**.
- **Coverage gate:** the suite measures line + branch coverage (`pytest-cov`) and **fails under 100%** (`--cov-fail-under=100` in `pyproject.toml`). Justified: the scripts are small and now pure, so full correctness coverage is achievable and keeps a new uncovered branch from slipping in. (Contrast the Scala suite, which starts with a low, *ratcheting* scoverage threshold in Phase 4 — a large legacy surface can't jump to 100%.) `main`'s I/O is covered by mocking the network wrappers + `tmp_path`; the only exclusions are the `__main__` guards and one provably-unreachable loop branch (`# pragma: no branch`). Which module a run measures is passed as `--cov=<module>` per half (below) rather than set in `pyproject.toml`, so neither half is scored on code its interpreter cannot import.
- **Split by interpreter (#4396).** The web container ships two Pythons and each script is tested on the one that runs it: `label_clustering.py` on **`python3` (3.8)**, because the app shells out to it and prod's system Python is 3.8; `check_streets_for_imagery.py` on **`python3.13`**, because its libraries need ≥ 3.10. `make test-python` runs both halves (`make test-python-app` / `make test-python-tools` for one), and a new test file must be added to the matching `pytest-args-*` list in the `Makefile` and to the CI matrix or nothing collects it.
- Deps, all installed into the web container by the `Dockerfile`: `requirements.txt` (the in-band script's) into 3.8, `requirements-offline-tools.txt` (the offline `check_streets` utility's) into 3.13, and `requirements-dev.txt` (`pytest`, `pytest-cov`, environment-marked per interpreter) into both. Exact pins live in [`docs/upgrading-libraries.md`](upgrading-libraries.md).

## CI — GitHub Actions (`.github/workflows/ci.yml`)

Parallel jobs:
- **evolutions-lint** — host bash; `bash db/scripts/lint-evolutions.sh` (also `make lint-evolutions`, and included in the `make lint` umbrella). Static checks on `conf/evolutions/default/*.sql`: a semicolon mid-`--`-comment (Play splits statements on every `;`, including ones inside comments, then executes the orphaned text — this broke evolution 325, see #4335/#4351) and missing `!Ups`/`!Downs` markers. **Blocking** — fast, deterministic, no DB. (Forward *application* of new evolutions is already exercised by `backend-tests`, which boots the app and auto-applies pending evolutions. A from-scratch up→down→up round-trip was prototyped and dropped: applying the full history against the project `db` image re-inserts already-seeded `sidewalk_login` rows — a bespoke empty-login DB would be needed, not worth it for an advisory check.)
- **route-lint** — `setup-python` (3.8, stdlib only); `python3 tools/check_route_reachability.py`. Fails if a `conf/routes` entry is unreachable because an earlier same-method route already matches all of its request paths — Play commits to the first path-pattern match and 400s on a typed-param mismatch rather than falling through, which is how a wildcard above a literal sibling silently broke `/label/tags` (#456). **Blocking**, and a required status check. The compiled-router counterpart is `RouteReachabilitySpec` in `backend-tests`, which also covers sub-router includes.
- **python-tests** — a two-leg `setup-python` matrix (`fail-fast: false`) mirroring `make test-python`: **`Python tests (in-band script)`** installs `requirements.txt` + `requirements-dev.txt` on **3.8** and runs the `label_clustering` tests, **`Python tests (offline tooling)`** installs `requirements-offline-tools.txt` + `requirements-dev.txt` on **3.13** and runs the rest. Advisory (`continue-on-error`); no DB/network. Ramp to blocking once stable.
- **backend** — `setup-java@v4` (temurin 17, `cache: sbt` + coursier/`~/.sbt`); `services:` `postgis/postgis:16-3.5` (health-checked); dummy env (`SIDEWALK_APPLICATION_SECRET`, `SILHOUETTE_SIGNER_KEY`/`CRYPTER_KEY`, `INTERNAL_API_KEY`, `DATABASE_USER`/`PASSWORD` required; Mapbox/Google/Gemini/Mapillary/Infra3d/SciStarter dummy). Steps grow by phase.
- **frontend** — `setup-node` (Node 23); `npm install` → `npx grunt` (exercises grunt concat) → the four frontend lint steps, all **blocking** and each `if: always()` so the build + every lint result report in one run: **`npx eslint public/js/ public/locales/ test/e2e/ playwright.config.js`**, **`npx stylelint 'public/**/*.css'`**, **`npx htmlhint app/views`**, **`node tools/check-locale-parity.mjs`** (no `--max-warnings 0` — the lone `warn` rule, `max-len`, is advisory), then **`npm run test:js`** (the jsdom Jest suite in `test/js/`) as an **advisory** step — `continue-on-error` sits on the step rather than the job, so a red suite reports without turning the required `Frontend (build)` check red. (No committed `package-lock.json` yet, so `npm install` not `npm ci`, and no npm cache.)
- **e2e-smoke** — the Playwright browser smoke suite ([`test/e2e/`](../test/e2e), #4504). Reuses `backend-tests`' DB recipe (repo `db` image, TCP readiness probe, `sidewalk_init` → `sidewalk_teaneck` schema rename), builds the grunt bundles, then `sbt stage` and boots the **prod-mode binary** on `:9000` (evolutions auto-apply at startup; readiness = `GET /signIn` returning 200) and runs `npx playwright test` against it. **Advisory** (`continue-on-error`), on every PR; uploads the Playwright report + `app.log` as an artifact on failure. `GOOGLE_MAPS_API_KEY` prefers the **`GOOGLE_MAPS_API_KEY_TEST`** repo secret (a referrer/API-restricted key for the phase-2 Explore/Validate specs); when absent — fork PRs, or until the secret is created — the specs that need it self-skip and everything else runs with dummy keys (Mapbox is stubbed in-suite).

**PR** runs fast feedback (compile, unit, build, eslint); **main/push** adds coverage. **Gating policy:** `sbt compile` blocking from day one; **scalafmt blocking** (`scalafmtCheckAll`, run with `if: always()` so it reports alongside a compile failure; the tree is kept format-clean and `make scalafmt-fix` auto-formats); **all four frontend linters blocking** (ESLint, Stylelint, HTMLHint, locale key-parity — steps in the `frontend` job, each `if: always()`; each skipped the advisory ramp once its tree was clean, same call as scalafmt/evolutions-lint); test phases advisory ~1 week then blocking on PR; **E2E advisory on every PR** (the `e2e-smoke` job — originally sketched as a nightly workflow, moved to PR-time with #4504 because the regressions it exists to catch were all PR-time misses; promotion to blocking is a later, deliberate call).

**Branch protection (`develop`, set 2026-06-29).** The deterministic jobs are wired as **required status checks** so a red build can't merge (the failure that shipped the broken evolution 325): **`Backend (compile + scalafmt)`**, **`Frontend (build)`**, and **`Route reachability lint`**. **`Evolutions lint`** runs on every PR but is not yet required — a required check a PR doesn't *produce* blocks it forever, so a new job is only promoted once it's on `develop` and the in-flight branches have picked it up. The **frontend lint** gates (ESLint, Stylelint, HTMLHint, locale key-parity) were added as *steps inside the existing `frontend` job* rather than new jobs precisely to avoid that stranding: they ride the already-required **`Frontend (build)`** check, so each is enforced immediately with no branch-protection change and no in-flight PR left waiting on a check name it can't produce. Settings: `enforce_admins=true` (no admin bypass — it only ever blocks a *red* merge), **no required reviews** (maintainers self-merge; review stays a convention, not a gate — see [`CONTRIBUTING.md`](../CONTRIBUTING.md)), `strict=false` (no "branch up to date" churn). The **advisory** jobs (`Backend tests (API, PostGIS)`, `Python tests`) are deliberately **not** required while they stabilize. Repo **auto-merge** is enabled (opt-in per PR: queue a merge that fires when checks pass; merges nothing on its own).

**Dependency automation:** **Scala Steward** (GitHub Action) for sbt deps — Dependabot has no native sbt updater — plus **`.github/dependabot.yml`** for `npm`, `github-actions`, and `docker` (covers the open Dependabot alerts), weekly, grouped.

## Phased rollout (each phase independently mergeable)

- **Phase 0 — gate, zero tests required (land first):** add sbt-scalafmt/sbt-scoverage plugins; `ci.yml` with `sbt compile` (blocking) + `scalafmtCheckAll` (blocking) + frontend asset build; `.github/dependabot.yml` + Scala Steward; fix the `npm test` placeholder. (Frontend lint excluded — owned by #2487.) **Implemented on `feature/ci-phase0`.**
- **Phase 1 — unit:** backend Layer-(a) specs + **Jest util tests** (advisory step in the `frontend` job, landed with #4504) + **`pytest` for the `scripts/` utilities** (advisory `python-tests` job, already landed); run on every PR (no DB service needed for the unit subset).
- **Phase 2 — DB integration:** PostGIS service + `PostgresTestKit`; #4239 + #4228 regression specs; measure evolution time.
- **Phase 3 — functional:** silhouette-testkit + `FakeAuth`/`GuiceTestApp`/`WsStubs`; `ImageControllerSpec` + `PublicApiSpec`.
- **Phase 4 — coverage + E2E:** scoverage with a **low, ratcheting** threshold (start near current %, raise over time); Playwright thin smoke suite. **The E2E half landed with #4504** ([`test/e2e/`](../test/e2e), advisory `e2e-smoke` PR job, Mapbox stubbed via `page.route`); its own later phases add Explore/Validate (real restricted GSV key + seeded labels), per-page interactions, and a few end-to-end flows.

## Key decisions

- **scalafmt: blocking** — the tree is kept format-clean; `make scalafmt-fix` (or `sbt scalafmtAll`) auto-formats before pushing.
- **E2E: thin & advisory** — a page-load smoke suite ([`test/e2e/`](../test/e2e)) with stubbed Mapbox and skip-guarded Street View specs, run as an advisory PR job (`e2e-smoke`); deep canvas/imagery testing stays manual.
- **Test DB: GitHub Actions `services:` PostGIS** (Testcontainers optional/local), not Testcontainers-in-CI.

## Risks / gotchas

- **Actor disabling is load-bearing** — if the eager actors aren't neutralized they fire scheduled DB/WS work → flaky functional tests + dirty DB. Most likely early-flakiness source.
- **Silhouette testkit version** — confirm `play-silhouette-testkit 10.0.4` publishes for this Play 3 / Pekko line; fallback is a ~20-line hand-rolled `FakeEnvironment`.
- **Evolution apply time** is unverified — measure in Phase 2; cache if slow.
- **Isolation strategies must not mix** within a suite (rollback vs truncate) — keep (b)/(c) separate.
- **Dependabot ≠ sbt** — Scala Steward handles sbt bumps.

## Verification

- **Local:** `sbt test` (against a local PostGIS, a `DATABASE_URL` to the dev DB, or the Testcontainers toggle), `npm test` (jest), `make lint`, `sbt scalafmtCheckAll`.
- **CI smoke:** open a draft PR, confirm both jobs run and pass; prove the gates bite by (1) pushing an intentional unused import (the compile gate must fail) and (2) reverting one `.replace("'","''")` from #4239 and confirming `LabelTableSqlEscapingSpec` fails.
- **E2E:** one-time host setup `npm install && npx playwright install chromium`, then `make test-e2e` against the running dev app (details in [`test/e2e/README.md`](../test/e2e/README.md)); prove the gate bites by appending a planted `console.error` to a built bundle and confirming that page's test fails.
