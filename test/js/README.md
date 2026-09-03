# Frontend JS tests (prototype)

This directory is the **first** frontend/JavaScript test layer for Project Sidewalk. It is a small, **opt-in
prototype** — a proof of concept, not a CI gate (yet). See `docs/testing-and-ci.md` (Phase 1, "Frontend testing") for
where this fits in the larger plan.

## What this proves

A "smoke test" for the API-docs **live-preview** modules under `public/js/api-docs/*Preview.js`. These
modules `fetch()` a `/v3/api/...` endpoint and render the JSON into a `<div>`. They are tightly coupled to the exact
**field names** the API returns.

The motivating bug: `overallStatsPreview.js` read `data.validations.total_validations` after that field had moved
under `data.validations.combined`, throwing `Cannot read properties of undefined`. Nothing caught it before it
shipped. These tests pin the contract between a captured **snake_case** API response (per the v3 naming convention,
issue #3871) and the renderer, so a field-name drift fails loudly here instead of silently in the browser.

Two modules are covered (the newest, dependency-light, vanilla-DOM ones):

- `aggregateStatsPreview.js` → `aggregateStatsPreview.test.js`
- `validationResultTypesPreview.js` → `validationResultTypesPreview.test.js`

Also covered, beyond the api-docs previews:

- `common/share/ShareWidget.js` → `share-widget.test.js` — the label share control (#456): native-share vs popover
  fork, the popover's ARIA contract and focus management, clipboard/intents, and activity logging. `ShareWidget` is a
  top-level `class` declaration (not a `window.X = ...` assignment), so the test evals the source into the jsdom
  global scope instead of using `loadGlobalScript`.
- `common/AppManager.js` → `appManagerCsrfFetch.test.js` — the `window.fetch` CSRF wrapper (#4232): the token must
  reach same-origin requests and *only* same-origin requests, across all three argument types `fetch` accepts
  (string, `URL`, `Request`). jsdom implements neither `fetch` nor `Request`, so the test supplies both.
- `community/*.js` → `communityListPage.test.js` — the /stories + /routes listing pages' client layer (#4688):
  search filtering (hidden attr, live count, no-results), sort orders and tie-breaks, localized dates, type-chip
  tinting, the read-more clamp toggle, view-label popup-vs-navigation routing, and the copy-share-link fallbacks.
- `common/pano-viewer/src/PanoInfoPopover.js` → `panoInfoViewLink.test.js` — the pano info popover's
  "view in \<provider\>" link (#4813). Validate and the label card swap the active viewer from label to label, so the
  popover resolves it on every open and offers the link only when that viewer both publishes a public site and is
  holding the pano on screen. These pin the link hidden — rather than left pointing at the previous label's pano — on
  both fallbacks: Pannellum, and the static crop, where the provider's viewer is still loaded but with someone else's
  pano. Like `ShareWidget` this is a top-level `class`, so the test evals the source instead of using
  `loadGlobalScript`. jsdom implements neither the Popover API nor `:popover-open`, so the test stands both up.
- `common/pano-viewer/src/panoUtilities.js` → `panoProjection.test.js` — the canvas↔POV↔pano projection (#4851): the
  canvas coordinate carries no anchor offset, the canvas→POV→canvas round trip is an identity (and returns null
  behind the camera), Validate's `getOriginalPov` call site passes the stored coordinate through untouched, and the
  non-WebGL 2D fallback projects both axes and wraps headings. Record fixtures are shared with
  `test/service/PanoDataServiceSpec.scala`, so the JS and Scala ports are pinned to one external oracle
  (`pov_replay.py`) rather than to each other.
- `common/pano-viewer/src/panoUtilities.js` → `gsvFovContract.test.js` — the empirically measured GSV FOV-vs-aspect
  contract (#5083). `tools/gsv-fov-probe/` measured what field of view Google's WebGL renderer holds fixed as the
  container aspect changes; this pins the projection helpers' width-spanning assumption, the measured clamp window
  and its per-zoom binding aspects, and the analyzer's copy of `zoomToFov`, against the recorded fixture
  `fixtures/gsvFovMeasurements.json`. It pins *code* against frozen measurements — a renderer change on Google's
  side is invisible to it and needs a fresh probe run (that tool's README says when).
- `tools/gsv-fov-probe/estimator.cjs` → `gsvFovProbeEstimator.test.js` — the probe's focal-length fitter against
  synthetic pinhole ground truth (#5083), gate 1 of that experiment's protocol: no live measurement is trusted until
  the estimator recovers a known focal length to better than 0.2%. This is the slowest suite in the tree (~40 s,
  nearly all of it in the synthetic renders); if it grows further, shrink the synthetic image rather than raising
  `testTimeout`.

Each test file has:

1. A **good-fixture** test: feed a realistic snake_case response, assert the promise resolves, the container has **no
   "Failed to load" banner**, and the expected content (names + formatted numbers + the right number of table rows)
   is present.
2. **Wrong-shape** test(s): feed a camelCase fixture and/or a "field moved under a sub-object" fixture (a direct analog
   of the original bug) and **document the behavior** — these modules are null-safe, so they don't throw; instead they
   silently render `0`/empty. The assertions lock that degraded behavior so the drift is visible. (If a future refactor
   ever removes the null-guards, the good-fixture test catches the resulting throw.)

## How to run

From the repo root:

```bash
npm install        # first time only — installs jest + jest-environment-jsdom (devDependencies)
npm run test:js    # runs the suites in test/js/
npm run test:js:coverage    # the same, plus the coverage report (what CI runs)
```

`npm run test:js` is a **new** script; the existing placeholder `npm test` is left untouched.

> Node note: the dev DB / Scala app run in Docker, but Jest runs on the host with plain Node (the plan targets Node 24).
> No Docker is needed for these tests.

## How it works (no module system)

Project Sidewalk's frontend has **no module system** — files are plain scripts concatenated by Grunt that assign their
surface onto `window` (e.g. `window.AggregateStatsPreview = { setup, init }`). `loadGlobalScript.js` `require()`s the
file after a `jest.resetModules()`: jsdom exposes `window`/`document` as Node globals, so the file's top-level IIFE
runs and performs its `window.X = ...` assignment exactly as a `<script>` tag would, and the reset gives each test a
fresh module-scoped singleton. Going through `require` is also what lets Jest instrument these files for coverage.
**No production-code changes are required.**

Each test:

1. Sets `document.body.innerHTML` to the container `<div id="...-preview">` the module renders into.
2. Stubs global `fetch` to resolve a hardcoded fixture object (no network).
3. Loads the module's one script dependency, `api-docs/apiTableWrapper.js` (see below), with `loadGlobalScript(...)`.
4. Loads the module with `loadGlobalScript(...)`.
5. Calls `.setup({}).init()` and asserts on the resolved promise + rendered DOM.

## Globals these modules need

Only one thing is **stubbed**: `fetch` (jsdom does not provide a usable one). Otherwise they use just `window`,
`document`, `console`, `Promise`, `Object.assign`, and `Number.prototype.toLocaleString`, all of which jsdom/Node
provide.

They do have one script dependency that has to be **loaded**: both renderers wrap their table with
`window.createApiTableWrapper`, defined in `public/js/api-docs/apiTableWrapper.js`, which
`apiDocs/layout.scala.html` loads ahead of every preview script. Jest sees no `<script>` tags, so each `beforeEach`
hand-loads that file before the module. Skip it and the render throws `createApiTableWrapper is not a function` —
which the module's `.catch` turns into a "Failed to load" banner instead of a stack trace, so the failure reads as a
bad fixture. Five previews call it: `aggregateStats`, `validationResultTypes`, `labelTypes`, `labelTags`,
`streetTypes`.

The production half of that wiring — the layout loading the helper ahead of `@content` — is pinned by
`test/controllers/ApiDocsPreviewWiringSpec.scala`, since these tests supply the helper themselves and so can't
notice it going missing from the page.

## Extending to the other previews

The remaining `*Preview.js` modules pull in heavier globals. To bring them under test, load or stub these in
`beforeEach` **before** calling `loadGlobalScript` on the module:

- **`window.createApiTableWrapper`** (`label-types`, `label-tags`, `street-types`):
  `loadGlobalScript('public/js/api-docs/apiTableWrapper.js')`. It is a production file rather than a third-party
  library, so load it instead of stubbing it, exactly as the two covered suites do.
- **Chart.js** (`label-types`, `validations`, `street-types`, …): set `window.Chart = jest.fn()` — a constructor
  spy is enough to assert "a chart was constructed with the right data" without rendering a canvas (jsdom has no 2D
  context).
- **Mapbox GL** (every map preview): stub `window.mapboxgl` with no-op `Map` (whose instances need `on`, `addSource`,
  `addLayer`, `addControl`, `setPaintProperty`, `getCanvas`), `NavigationControl`, `AttributionControl`,
  `LngLatBounds`, and `Popup`, plus `window.MapboxLanguage`. The previews reach all of it through
  `js/api-docs/apiDocsMap.js`, which `loadGlobalScript` has to load first.
- **i18next / `i18next.t`**: stub `window.i18next = { t: (k) => k }` so translation lookups return the key.
- **`util.*` globals** (e.g. `util.math`, formatting helpers in `common/`): either `loadGlobalScript` the real
  `common/` file first, or stub the specific `util.foo` functions used.

The general recipe stays the same: container div → stub fetch with a captured snake_case fixture → stub libs and
`loadGlobalScript` any production dependency → `loadGlobalScript` the module → `setup({}).init()` → assert no
"Failed to load" + expected content. A shared `beforeEach` helper (e.g. `stubChartJs()`, `stubMapboxGl()`) can live
alongside `loadGlobalScript.js` as coverage grows.

`common/aggregateStats.js` (named as a first target in the plan) is a good next addition — it has retry/timeout logic
worth unit-testing with fake timers.

## Why this is opt-in and NOT in CI

Frontend linting and the JS **ES5→ES2022 migration** are owned by a separate in-flight effort, **issue #2487**. Dropping
test/lint tooling into CI mid-migration would create large, conflict-prone churn and risks colliding with that work.
So:

- **No ESLint, no broad config** is introduced here (`testMatch` is anchored to `test/js/`, so production JS is only
  ever loaded as a module under test, never collected as one).
- **CI runs this suite as an advisory step** in the `frontend` job (`npm run test:js`, `continue-on-error` on the step
  so a failure never turns the required `Frontend (build)` check red). Promotion to blocking rides #2487's track,
  once coverage is broad enough that a red suite always means a real regression.
- The existing `npm test` placeholder is **unchanged** to avoid surprising any tooling that already calls it.

## Coverage

`npm run test:js:coverage` reports over the whole first-party frontend: `public/js/**/*.js` minus the Grunt `build/`
bundles, with `public/js` as one of Jest's `roots` so a file **no test loads** still counts against the ratio. The
console shows totals only; open `coverage/lcov-report/index.html` for per-file detail.

**Read the number with care, and don't put a floor on it yet (#5112).** Jest instruments only what it hands out
through `require` — which is what `loadGlobalScript` does. The other 99 suites `eval` their subject instead, because
`require` can't reach a file that defines a bare top-level class rather than assigning to `window` (see *How it works*
above). `eval` bypasses the module system, so those files are never instrumented: **10 of 229 files carry every
covered statement**, and `AcrossCitiesPage.js` reports 0/790 despite having a passing suite. A `coverageThreshold` on
top of that would read as protection without being any — deleting an eval-loaded module's tests moves the number by
zero. The fix is upstream, in the ES-modules question (#4467).

## Complementary E2E

These jsdom tests verify the render contract in isolation. Their E2E complement now exists: the **Playwright browser
smoke suite in [`test/e2e/`](../e2e)** (#4504) loads core pages — including api-docs pages — against a running app and
**fails on any uncaught console/page error**, catching integration-level breakage (real endpoint shape, script load
order from Grunt, missing globals) that a mocked-`fetch` unit test cannot. It runs as the `e2e-smoke` CI job
on every PR; asserting on the api-docs preview *content* (non-empty container, no "Failed to load" banner) is a
planned phase-2 extension there.
