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
- **(d) Thin browser E2E (advisory)** — Playwright, 1–3 smoke flows only, external imagery stubbed; nightly/advisory, **never** blocks PRs.

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
- **Functional (c):** **`ImageControllerSpec` (#4239)** — `saveImage` rejects path-traversal `label_type`/`name` and requires a signed-in user; `serveCropImage` enforces `validLabelTypes` + HMAC + Referer. `PublicApiSpec` — v3 bbox/date/CSV parsing + output shape.

## Frontend testing

- **Runner: Jest + jsdom** (CommonJS-friendly for the no-module global-script reality; less ESM friction than Vitest). Load each pure util via a small `vm`/require helper that captures its global (`util.math`, the pano-viewer classes) — **no production-code changes required** to start. First targets: `common/UtilitiesMath.js`, `common/pano-viewer/src/PanoUtilities.js`, `common/aggregate-stats.js`.
- Replace the broken `npm test` (`grunt && grunt test`) with `jest`.
- **Lint gate** (`make lint`: eslint/htmlhint/stylelint, already configured) is **owned by #2487, not this plan.** That issue sequences the linter rollout with the in-progress JS ES5→ES6 migration (dropping a linter into CI mid-migration = large, conflict-prone churn). So linting-in-CI is deliberately **deferred to #2487** and introduced on that track (advisory first, then blocking once the baseline is clean) — *not* part of Phase 0.

## CI — GitHub Actions (`.github/workflows/ci.yml`)

Two parallel jobs:
- **backend** — `setup-java@v4` (temurin 17, `cache: sbt` + coursier/`~/.sbt`); `services:` `postgis/postgis:16-3.5` (health-checked); dummy env (`SIDEWALK_APPLICATION_SECRET`, `SILHOUETTE_SIGNER_KEY`/`CRYPTER_KEY`, `INTERNAL_API_KEY`, `DATABASE_USER`/`PASSWORD` required; Mapbox/Google/Gemini/Mapillary/Infra3d/SciStarter dummy). Steps grow by phase.
- **frontend** — `setup-node@v4` (Node 23); `npm install` → `npx grunt` (exercises grunt concat) → (Phase 1+) `jest`. (`make lint` is **not** here — see #2487. No committed `package-lock.json` yet, so `npm install` not `npm ci`, and no npm cache.)

**PR** runs fast feedback (compile, unit, build); **main/push** adds coverage; **E2E** is a separate **nightly/advisory** workflow. **Gating policy:** `sbt compile` blocking from day one; **scalafmt advisory** (`scalafmtCheckAll` via `continue-on-error`, no reformat pass yet); frontend lint deferred to #2487 (its own advisory→blocking ramp there); test phases advisory ~1 week then blocking on PR; **E2E always advisory**.

**Dependency automation:** sbt deps are kept current by **VirtusLab's hosted Scala Steward instance** (register the repo via a one-line PR to `VirtusLab/scala-steward-repos`) — no token, secret, or Actions minutes, which suits a long-lived public OSS repo better than a self-hosted workflow + PAT. Dependabot has no native sbt updater, so **`.github/dependabot.yml`** covers `npm`, `github-actions`, and `docker` (also covers the open Dependabot alerts), weekly, grouped.

## Phased rollout (each phase independently mergeable)

- **Phase 0 — gate, zero tests required (land first):** add sbt-scalafmt/sbt-scoverage plugins; `ci.yml` with `sbt compile` (blocking) + `scalafmtCheckAll` (advisory) + frontend asset build; `.github/dependabot.yml` + register with hosted Scala Steward; fix the `npm test` placeholder. (Frontend lint excluded — owned by #2487.) **Implemented on `feature/ci-phase0`.**
- **Phase 1 — unit:** backend Layer-(a) specs + Jest util tests; run on every PR (no DB service needed for the unit subset).
- **Phase 2 — DB integration:** PostGIS service + `PostgresTestKit`; #4239 + #4228 regression specs; measure evolution time.
- **Phase 3 — functional:** silhouette-testkit + `FakeAuth`/`GuiceTestApp`/`WsStubs`; `ImageControllerSpec` + `PublicApiSpec`.
- **Phase 4 — coverage + E2E:** scoverage with a **low, ratcheting** threshold (start near current %, raise over time); Playwright thin smoke suite (advisory/nightly, imagery stubbed via `page.route`).

## Key decisions

- **scalafmt: advisory only** for now, no repo-wide reformat pass yet (the plugin is still added for local use).
- **E2E: thin & advisory** (3 smoke flows, stubbed imagery, nightly, never blocks PRs).
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
- **E2E:** `npx playwright test` locally with imagery routes stubbed; confirm sign-in + `/validate` load.
