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
- **(d) Thin browser E2E (advisory)** — Playwright smoke suite ([`test/e2e/`](../test/e2e)): loads each core page in headless Chromium and fails on uncaught console/page errors, external imagery stubbed or skip-guarded. Runs as an **advisory step on every PR** (`e2e-smoke`; the `continue-on-error` sits on the smoke step, not the job, so the accessibility gate beside it still blocks), promotable to blocking once proven stable. **Landed with #4504** (page-load phase; interactions and flows are later phases).

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
"com.dimafeng"                 %% "testcontainers-scala-scalatest"  % "0.43.0" % Test,  // optional local toggle
"com.dimafeng"                 %% "testcontainers-scala-postgresql" % "0.43.0" % Test,
"org.mockito"                   % "mockito-core"            % "5.14.2" % Test
```
`project/plugins.sbt` (currently only the Play plugin):
```scala
addSbtPlugin("org.scalameta" % "sbt-scalafmt"  % "2.5.4")
addSbtPlugin("org.scoverage" % "sbt-scoverage" % "2.3.1")
```

## Test support harness — `test/` mirrors `app/`, plus `test/util/`

**Landed as `test/util/`** (the bullets below, plus `StreetFixtures.scala` and `UserAgents.scala`; `GuiceTestApp`/`WsStubs` are still proposals). Suites build their own `GuiceApplicationBuilder` with `.disable[modules.ActorModule]` rather than sharing one.

- `util/RolledBackDb.scala` — DB config plus `runRolledBack`, which runs a body inside a transaction that always aborts. For layer (b): the HTTP path can't share a transaction, so a layer-(c) spec that writes rows deletes them by id in `afterAll` instead (`ImageryAdminSpec`, `AdminJobTriggerSpec`).
- `util/AnonSession.scala` — `freshAnonSession()`, a distinct persistent user per call, minted through the real `/anonSignUp` route. That route is rate-limited per IP and every suite in a run shares loopback, so a suite minting more than a couple of sessions must `.configure("rate-limit.anon-signup.enabled" -> false)`.
- `util/RoleSession.scala` (#4946) — `sessionAs("Administrator")` / `sessionAs("Registered")`: an anonymous session promoted by a DB write to `sidewalk_login.user_role`, demoted again in `afterAll`. Roles are checked against `RoleTable.ADMIN_ROLES` (`app/models/auth/WithRole.scala`); the anonymous posture checks in `RouteAuthPostureSpec` can't tell `WithAdmin` from `WithOwner`, so pinning a *required role* needs one of these. Seeding its own account is what keeps it honest — a spec that `assume`s an existing admin cancels on CI's account-less schema, which reads as passing. **Gotchas** (from `app/service/CustomSecurityService.scala`): every `SecuredAction` runs `ensureUserStatExists` and an Infra3d check — keep `panoSource = GSV` in test config or set `infra3dAccess = true`.
- `util/StubService.scala` (#4946) — a reflective stand-in for a service trait that answers named methods and throws on the rest, for specs about what a controller *does* rather than what its collaborator computes. Only works on traits whose members are all abstract (what makes a Scala trait a Java interface).
- `support/GuiceTestApp.scala` — a shared `GuiceApplicationBuilder` with `bind[WSClient].toInstance(stub)`. It does not need to do anything about the eager actors: `.disable[modules.ActorModule]` is what every suite uses today and it needs no `@Named` `ActorRef` re-binding.
- `support/WsStubs.scala` — canned responses for the external callers: `PanoDataService` (Google SV metadata, Infra3d OAuth), `AiService` (Sidewalk AI), `ConfigService` (SciStarter).
- ScalaTest **tags** `DbTest` / `Functional` so CI can include/exclude by phase; unit tests untagged (always run).

## First concrete test targets

- **Unit (a):** `ImageSigningServiceSpec` (HMAC sign/verify, expiry, tamper, wrong-path), `CommonUtilsSpec` (`calculateDestination`), `ControllerUtilsSpec` (`parseIntegerSeq`/`isMobile`/`parseURL`), `PanoDataServiceMathSpec` (`getFov`/`calculatePovFromPanoXY`/`toLatLng`).
- **DB (b):** **`LabelTableSqlEscapingSpec` (#4239)** — drive the raw-SQL builders with `'`, `''`, `'; DROP TABLE` payloads in regionName/tags/labelType/wayType; assert safe execution + correct results; mirror for `ClusterTable`/`StreetEdgeTable`. **`ValidationServiceSpec` (#4228)** — assert the previously-discarded `DBIO` side effect actually persists inside `.transactionally`.
- **Functional (c):** **`ImageControllerSpec` (#4239)** — `saveImage` rejects path-traversal `label_type`/`name` and requires a signed-in user; `serveCropImage` enforces `labelTypeNames` + HMAC + Referer. `PublicApiSpec` — v3 bbox/date/CSV parsing + output shape. **`RouteAuthPostureSpec` (#4441)** — table-driven over `Router.documentation`: every declared `/adminapi/` route must refuse an anonymous request (explicit allow-list for the two that stay public), plus authenticated checks that pin the *required role*, which the anonymous cases cannot distinguish. **`AssetManifestServiceSpec` + `AssetManifestWiringSpec` (#4893)** — the digest map behind `util.assetPath`: md5 extraction, the build-generated asset inventory (non-empty, sorted, sentinels present), and that `main.scala.html` stamps `window.assetDigests` ahead of `utilities.js`. Every failure here is invisible in a browser — assets still load off their unfingerprinted paths — so nothing else would catch one.

## Frontend testing

- **Runner: Jest + jsdom** (CommonJS-friendly for the no-module global-script reality; less ESM friction than Vitest). Load each pure util via a small `require` helper that captures its global (`util.math`, the pano-viewer classes) — **no production-code changes required** to start. First targets: `common/UtilitiesMath.js`, `common/pano-viewer/src/PanoUtilities.js`, `common/aggregate-stats.js`.
- Replace the broken `npm test` (`grunt && grunt test`) with `jest`.
- **Lint gate** (`make lint`: ESLint + Stylelint + HTMLHint + locale key-parity + the `public/css/` layout check + the `public/js/` asset-path check, plus the evolutions lint below) was rolled out under **#2487**, sequenced with the in-progress JS ES5→ES2022 migration (dropping linters into CI mid-migration = large, conflict-prone churn). All are **now blocking** steps in the `frontend` job — ESLint (`public/js/` + `public/locales/`), Stylelint (`public/**/*.css`), HTMLHint (`app/views`), `tools/check-locale-parity.mjs`, `tools/check-css-layout.mjs` (#5030: a page's stylesheet is linked only by that page, page class prefixes stay in the page's own files, every linked stylesheet exists), and `tools/check-asset-paths.mjs` (#4893: no hardcoded `/assets/` URL in `public/js/` outside its allowlist, and every `util.assetPath` argument checkable — a literal one naming a real file in a fingerprinted family, an interpolated one opening with a literal family directory) — each landing once its tree was clean, straight to blocking with no advisory ramp (same as scalafmt/evolutions-lint). **Severity is the gate**: `error` rules block the build (correctness + must-fix smells like `no-unused-vars`/`no-shadow`), while the one `warn` rule on ESLint/Stylelint (`max-len` / `max-line-length`) is deliberately advisory — CLAUDE.md sanctions long-line exceptions, so they're *not* run with `--max-warnings 0`.

## Python utility testing

- **Runner: `pytest`** for the two standalone scripts in [`scripts/`](../scripts) (`label_clustering.py`, `check_streets_for_imagery.py`) — the only Python in the repo. Tests live in [`test/python/`](../test/python); config is in `pyproject.toml` (`[tool.pytest.ini_options]`, with `scripts/` on `pythonpath`).
- The scripts were refactored so their decision logic sits in **pure, importable** functions (distance metric, coordinate cleaning, clustering, cluster-id offsetting; bounding-box/vertex math, GSV/Mapillary response parsing, imagery-decision thresholds, CSV writing), with network/file I/O isolated in thin wrappers and `main`. Tests target the pure functions — **no DB, no network**.
- **Coverage gate:** the suite measures line + branch coverage (`pytest-cov`) and **fails under 100%** (`--cov-fail-under=100` in `pyproject.toml`). Justified: the scripts are small and now pure, so full correctness coverage is achievable and keeps a new uncovered branch from slipping in. (Contrast the Scala suite, which starts with a low, *ratcheting* scoverage threshold in Phase 4 — a large legacy surface can't jump to 100%.) `main`'s I/O is covered by mocking the network wrappers + `tmp_path`; the only exclusions are the `__main__` guards and one provably-unreachable loop branch (`# pragma: no branch`). Scoping is a bare `--cov` plus `source = ["scripts"]`, so the gate is always on and covers both arms — an uncovered *branch*, and a script nothing imports, which `source` reports at 0%. Each half sets `COVERAGE_OMIT` to the script its interpreter can't import; unset, the gate fails loudly rather than silently measuring less.
- **Split by interpreter (#4396).** Each script is tested on the Python that runs it: `label_clustering.py` on **`python3` (3.8)**, since the app shells out to it and prod's system Python is 3.8; `check_streets_for_imagery.py` on **`python3.13`**, since its libraries need ≥ 3.11. `make test-python` runs both halves (`test-python-app` / `test-python-tools` for one). Each takes the whole directory minus the one file the other owns, so a new test file runs in both by default; one that only works on one gets an `--ignore` in the other.
- Deps, all installed into the web container by the `Dockerfile`: `requirements.txt` (the in-band script's) into 3.8, `requirements-offline-tools.txt` (the offline `check_streets` utility's) into 3.13, and `requirements-dev.txt` (`pytest`, `pytest-cov`, environment-marked per interpreter) into both. Exact pins live in [`docs/upgrading-libraries.md`](upgrading-libraries.md).

## CI — GitHub Actions (`.github/workflows/ci.yml`)

Parallel jobs:
- **evolutions-lint** — host bash; `bash db/scripts/lint-evolutions.sh` (also `make lint-evolutions`, and included in the `make lint` umbrella). Static checks on `conf/evolutions/default/*.sql`: a semicolon mid-`--`-comment (Play splits statements on every `;`, including ones inside comments, then executes the orphaned text — this broke evolution 325, see #4335/#4351) and missing `!Ups`/`!Downs` markers. **Blocking**, and a required status check — fast, deterministic, no DB. (Forward *application* of new evolutions is already exercised by `backend-tests`, which boots the app and auto-applies pending evolutions. A from-scratch up→down→up round-trip was prototyped and dropped: applying the full history against the project `db` image re-inserts already-seeded `sidewalk_login` rows — a bespoke empty-login DB would be needed, not worth it for an advisory check.)
- **route-lint** — `setup-python` (3.8, stdlib only); `python3 tools/check_route_reachability.py`. Fails if a `conf/routes` entry is unreachable because an earlier same-method route already matches all of its request paths — Play commits to the first path-pattern match and 400s on a typed-param mismatch rather than falling through, which is how a wildcard above a literal sibling silently broke `/label/tags` (#456). **Blocking**, and a required status check. The compiled-router counterpart is `RouteReachabilitySpec` in `backend-tests`, which also covers sub-router includes.
- **python-tests** — a two-leg `setup-python` matrix (`fail-fast: false`) mirroring `make test-python`: **`Python tests (in-band script)`** installs `requirements.txt` + `requirements-dev.txt` on **3.8**, **`Python tests (offline tooling)`** installs `requirements-offline-tools.txt` + `requirements-dev.txt` on **3.13**, and each runs `test/python` minus the other interpreter's file. No DB/network. `continue-on-error` is `${{ matrix.advisory }}` rather than a job-level flag, so the two legs gate differently: the **in-band** leg is **blocking** and required, because `label_clustering.py` is shelled out to by the running app; the **offline tooling** leg stays **advisory**, because `check_streets_for_imagery.py` is an operator utility that never runs on the server. Note that `half` also spells the check name — renaming a leg renames a required check, which branch protection then waits on forever.
- **backend-tests** — `setup-java` + the repo `db` image (TCP readiness probe, `sidewalk_init` → `sidewalk_teaneck` schema rename); runs the enrolled specs (`PublicApiSpec`, the health-dashboard/route-auth/geodesic gating specs) against a real Postgres+PostGIS. **Blocking**, and a required status check. Booting the app auto-applies pending evolutions, so this is also the forward-apply gate — the class of failure that shipped the broken evolution 325. Its suite is a hand-maintained enrollment list rather than `sbt test` (#5042), so green here means "the enrolled specs pass", not "the backend is covered". Both spec steps run under **scoverage** (`sbt coverage "testOnly ..."`), and a final `coverageReport` step enforces the **statement-coverage ratchet** configured in `build.sbt` (#4743) — see "Coverage" below.
- **backend** — `setup-java@v4` (temurin 17, `cache: sbt` + coursier/`~/.sbt`); `services:` `postgis/postgis:16-3.5` (health-checked); dummy env (`SIDEWALK_APPLICATION_SECRET`, `SILHOUETTE_SIGNER_KEY`/`CRYPTER_KEY`, `INTERNAL_API_KEY`, `DATABASE_USER`/`PASSWORD` required; Mapbox/Google/Gemini/Mapillary/Infra3d/SciStarter dummy). Steps grow by phase.
- **frontend** — `setup-node` (Node 24); `npm install` → `npx grunt` (exercises grunt concat) → the six frontend lint steps, all **blocking** and each `if: always()` so the build + every lint result report in one run: **`npx eslint public/js/ public/locales/ test/e2e/ playwright.config.js`**, **`npx stylelint 'public/**/*.css'`**, **`npx htmlhint app/views`**, **`node tools/check-locale-parity.mjs`**, **`node tools/check-css-layout.mjs`**, **`node tools/check-asset-paths.mjs`** (no `--max-warnings 0` — the lone `warn` rule, `max-len`, is advisory), then **`npm run test:js`** (the jsdom Jest suite in `test/js/`) as an **advisory** step — `continue-on-error` sits on the step rather than the job, so a red suite reports without turning the required `Frontend (build)` check red. (No committed `package-lock.json` yet, so `npm install` not `npm ci`, and no npm cache.)
- **e2e-smoke** — the Playwright browser smoke suite ([`test/e2e/`](../test/e2e), #4504). Reuses `backend-tests`' DB recipe (repo `db` image, TCP readiness probe, `sidewalk_init` → `sidewalk_teaneck` schema rename), builds the grunt bundles, then `sbt stage` and boots the **prod-mode binary** on `:9000` (evolutions auto-apply at startup; readiness = `GET /signIn` returning 200) and runs the suite against it in two steps — the accessibility gate **blocking**, then the runtime-error smoke half **advisory** (`continue-on-error` on that step, not the job) — on every PR; uploads the Playwright report + `app.log` as an artifact when either half fails. `GOOGLE_MAPS_API_KEY` prefers the **`GOOGLE_MAPS_API_KEY_TEST`** repo secret (a referrer/API-restricted key for the phase-2 Explore/Validate specs); when absent — fork PRs, or until the secret is created — the specs that need it self-skip and everything else runs with dummy keys (Mapbox is stubbed in-suite). CI installs Playwright on the runner directly (`npx playwright install --with-deps chromium`) rather than using the local `docker/e2e` runner image — a GitHub runner already has the toolchain, and the job is fast and stable as-is. This job also carries the **accessibility gate** (`a11y.spec.js`, #5060): axe-core at WCAG 2.1 AA over `test/e2e/pages.js` — the page table it shares with the smoke suite, so coverage is opt-out — failing on any violation `a11y-allowlist.js` does not track. It is its own Playwright project (`--project=a11y`), run as a **blocking** step ahead of the advisory smoke half, which is why `continue-on-error` sits on that step rather than on the job — at job level it would excuse the gate too. A project rather than a `--grep` keeps the split structural: rewording a test title can't move it between the halves. Gating this early is safe because a page enters the table only once its violations are fixed or tracked, so a failure is a regression rather than a known gap. Note that the CI schema is empty, so anything only visible with data (gallery cards, leaderboard rows, api-docs previews) is covered only when the suite runs against a seeded DB. The data portal pages (#5058) join when they land. Promoting **`E2E smoke (Playwright)`** to a required check makes the whole job blocking — the DB bring-up, `sbt stage`, the app boot and both readiness probes — not just the gate, so let it run green on a few PRs first. Policy and the manual checklist are in [`docs/accessibility.md`](accessibility.md).

**Gating policy:** `sbt compile` blocking from day one; **scalafmt blocking** (`scalafmtCheckAll`, run with `if: always()` so it reports alongside a compile failure; the tree is kept format-clean and `make scalafmt-fix` auto-formats); **every frontend linter blocking** (ESLint, Stylelint, HTMLHint, locale key-parity, CSS layout, asset paths — steps in the `frontend` job, each `if: always()`; each skipped the advisory ramp once its tree was clean, same call as scalafmt/evolutions-lint); the **test jobs ramped advisory → blocking** once their run history was clean (#4743 — `backend-tests` and the in-band `python-tests` leg, promoted after a 26-run sweep showed no failed steps behind their `continue-on-error`); **E2E advisory on every PR** (the `e2e-smoke` job — originally sketched as a nightly workflow, moved to PR-time with #4504 because the regressions it exists to catch were all PR-time misses; promotion to blocking is a later, deliberate call).

**`continue-on-error` belongs on the narrowest thing it should excuse.** A job carrying it reports its conclusion as `success` even when its steps fail, so an advisory job looks green in the checks list and adding it to branch protection enforces *nothing* until the flag comes off. Where only part of a job is advisory, put the flag on that step (`e2e-smoke`'s smoke half, `frontend`'s Jest step) or on that matrix leg (`python-tests`' offline half, via `continue-on-error: ${{ matrix.advisory }}`) — at job level it would excuse the blocking work sitting beside it.

**Branch protection (`develop`, set 2026-06-29; extended 2026-09-01 with #4743).** The deterministic jobs are wired as **required status checks** so a red build can't merge (the failure that shipped the broken evolution 325): **`Backend (compile + scalafmt)`**, **`Frontend (build)`**, **`Route reachability lint`**, **`Evolutions lint`**, **`Backend tests (API, PostGIS)`**, and **`Python tests (in-band script)`**. A required check a PR doesn't *produce* blocks it forever, so a new job is only promoted once it's on `develop`; an older branch that predates the job has to merge `develop` in before it can go green. The **frontend lint** gates (ESLint, Stylelint, HTMLHint, locale key-parity, CSS layout, asset paths) were added as *steps inside the existing `frontend` job* rather than new jobs precisely to avoid that stranding: they ride the already-required **`Frontend (build)`** check, so each is enforced immediately with no branch-protection change and no in-flight PR left waiting on a check name it can't produce. Settings: `enforce_admins=true` (no admin bypass — it only ever blocks a *red* merge), **no required reviews** (maintainers self-merge; review stays a convention, not a gate — see [`CONTRIBUTING.md`](../CONTRIBUTING.md)), `strict=false` (no "branch up to date" churn). The remaining **advisory** checks — `E2E smoke (Playwright)` and `Python tests (offline tooling)` — are deliberately **not** required: the first until its full job (DB bring-up, `sbt stage`, app boot) has proven stable, the second because it covers an operator utility that never runs on the server. Repo **auto-merge** is enabled (opt-in per PR: queue a merge that fires when checks pass; merges nothing on its own).

**Dependency automation:** **Scala Steward** (GitHub Action) for sbt deps — Dependabot has no native sbt updater — plus **`.github/dependabot.yml`** for `npm`, `github-actions`, and `docker` (covers the open Dependabot alerts), weekly, grouped.

## Coverage

Scala and JS hold **ratchets** — a floor just under the measured number, raised in whichever PR earns the headroom.
Python holds a real **100%** floor (small, pure scripts; see [Python utility testing](#python-utility-testing)).

**Scala — `sbt-scoverage` (#4743).** `backend-tests` runs both spec steps under `coverage` and ends on a blocking
`coverageReport`; the floor is `coverageMinimumStmtTotal` in `build.sbt`. Reproduce with
`sbt clean coverage test coverageReport`.

**A coverage number is only comparable to one measured the same way**, so read the new figure off a CI run before
raising the floor. A local run scores far higher, by tens of points: `backend-tests` runs a hand-listed subset of
`test/`, so the unenrolled spec files go unmeasured (#5042), and its schema is empty, so data-dependent paths are
covered locally but not there.

Only `controllers.javascript.*` is excluded: Twirl emits the JS reverse router for the browser, so nothing calls its
692 statements from Scala. The Scala router and the templates stay in — the functional specs render pages and route
requests, so their coverage is real, and excluding them would move the number by only ~1.5 points.

**JavaScript — Jest.** `collectCoverageFrom` is `public/js/**/*.js` minus the Grunt `build/` bundles, with `public/js`
in `roots` so an *untested* file counts against the ratio instead of being invisible — without that root Jest reports
only on files a suite happened to `require`, which answers "how well is the tested code tested" (~70%) rather than
"how much of the frontend is tested" (~3%). The floor stays low by design: most of the denominator is the
Explore/Validate canvas and pano code we never unit-test. The step is advisory (#2487), so a dip doesn't block.

## Phased rollout (each phase independently mergeable)

- **Phase 0 — gate, zero tests required (land first):** add sbt-scalafmt/sbt-scoverage plugins; `ci.yml` with `sbt compile` (blocking) + `scalafmtCheckAll` (blocking) + frontend asset build; `.github/dependabot.yml` + Scala Steward; fix the `npm test` placeholder. (Frontend lint excluded — owned by #2487.) **Implemented on `feature/ci-phase0`.**
- **Phase 1 — unit:** backend Layer-(a) specs + **Jest util tests** (advisory step in the `frontend` job, landed with #4504) + **`pytest` for the `scripts/` utilities** (the `python-tests` matrix — in-band leg blocking, offline leg advisory); run on every PR (no DB service needed for the unit subset).
- **Phase 2 — DB integration:** PostGIS service + `PostgresTestKit`; #4239 + #4228 regression specs; measure evolution time.
- **Phase 3 — functional:** `RoleSession`/`AnonSession` (landed) + `GuiceTestApp`/`WsStubs`; `ImageControllerSpec` + `PublicApiSpec`.
- **Phase 4 — coverage + E2E:** scoverage with a **low, ratcheting** threshold (start near current %, raise over time) — **landed with #4743**, see [Coverage](#coverage); Playwright thin smoke suite. **The E2E half landed with #4504** ([`test/e2e/`](../test/e2e), advisory `e2e-smoke` PR job, Mapbox stubbed via `page.route`); its own later phases add Explore/Validate (real restricted GSV key + seeded labels), per-page interactions, and a few end-to-end flows.

## Key decisions

- **scalafmt: blocking** — the tree is kept format-clean; `make scalafmt-fix` (or `sbt scalafmtAll`) auto-formats before pushing.
- **E2E: thin & advisory** — a page-load smoke suite ([`test/e2e/`](../test/e2e)) with stubbed Mapbox and skip-guarded Street View specs, run as an advisory PR job (`e2e-smoke`); deep canvas/imagery testing stays manual.
- **Test DB: GitHub Actions `services:` PostGIS** (Testcontainers optional/local), not Testcontainers-in-CI.
- **Coverage: a ratchet on every PR** — under the measured number, raised as the suite grows, and on PRs rather than pushes because a floor that only reports after a merge cannot stop the drop it exists to catch. The exception is Python, which holds a real 100% floor.

## Risks / gotchas

- **Actor disabling is load-bearing** — if the eager actors aren't neutralized they fire scheduled DB/WS work → flaky functional tests + dirty DB. Most likely early-flakiness source.
- **Authenticated requests** — settled, no testkit needed: sessions are minted through the real `/anonSignUp` route and promoted with a DB write (`util/RoleSession.scala`). A `FakeEnvironment` identity would not survive contact with the admin routes anyway — most log activity keyed to `request.identity.userId`, so an identity with no `sidewalk_user` row trips the FK.
- **Evolution apply time** is unverified — measure in Phase 2; cache if slow.
- **Isolation strategies must not mix** within a suite (rollback vs truncate) — keep (b)/(c) separate.
- **Dependabot ≠ sbt** — Scala Steward handles sbt bumps.

## Verification

- **Local:** `sbt test` (against a local PostGIS, a `DATABASE_URL` to the dev DB, or the Testcontainers toggle), `npm test` (jest), `make lint`, `sbt scalafmtCheckAll`.
- **CI smoke:** open a draft PR, confirm both jobs run and pass; prove the gates bite by (1) pushing an intentional unused import (the compile gate must fail) and (2) reverting one `.replace("'","''")` from #4239 and confirming `LabelTableSqlEscapingSpec` fails.
- **E2E:** `make test-e2e` against the running dev app — no setup, the runner is a container (details in [`test/e2e/README.md`](../test/e2e/README.md)); prove the gate bites by appending a planted `console.error` to a built bundle and confirming that page's test fails.
