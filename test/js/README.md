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
npm run test:js    # runs Jest against test/js/ only
```

`npm run test:js` is a **new** script; the existing placeholder `npm test` is left untouched.

> Node note: the dev DB / Scala app run in Docker, but Jest runs on the host with plain Node (the plan targets Node 23).
> No Docker is needed for these tests.

## How it works (no module system)

Project Sidewalk's frontend has **no module system** — files are plain scripts concatenated by Grunt that assign their
surface onto `window` (e.g. `window.AggregateStatsPreview = { setup, init }`). So we don't `require()` the production
file directly. Instead `loadGlobalScript.js` reads the file and executes it in the jsdom `window`'s global scope via
Node's `vm` module — exactly as a browser `<script>` tag would. After loading, `window.AggregateStatsPreview` is
available to the test. **No production-code changes are required.**

Each test:

1. Sets `document.body.innerHTML` to the container `<div id="...-preview">` the module renders into.
2. Stubs global `fetch` to resolve a hardcoded fixture object (no network).
3. Loads the module with `loadGlobalScript(...)`.
4. Calls `.setup({}).init()` and asserts on the resolved promise + rendered DOM.

## Globals that had to be stubbed

For these two modules, almost nothing — they are deliberately dependency-light. The only thing stubbed is **`fetch`**
(jsdom does not provide a usable one). They otherwise use only `window`, `document`, `console`, `Promise`,
`Object.assign`, and `Number.prototype.toLocaleString`, all of which jsdom/Node provide.

## Extending to the other previews

The remaining `*Preview.js` modules pull in heavier globals. To bring them under test, stub these in `beforeEach`
**before** calling `loadGlobalScript`:

- **Chart.js** (`label-types`, `validations`, `street-types`, …): set `window.Chart = jest.fn()` — a constructor
  spy is enough to assert "a chart was constructed with the right data" without rendering a canvas (jsdom has no 2D
  context).
- **Leaflet** (`label-clusters`, `regions`, map previews): stub `window.L` with the chained no-op factory methods the
  module calls (`L.map().setView()`, `L.tileLayer().addTo()`, `L.geoJSON()`, …).
- **i18next / `i18next.t`**: stub `window.i18next = { t: (k) => k }` so translation lookups return the key.
- **`util.*` globals** (e.g. `util.math`, formatting helpers in `common/`): either `loadGlobalScript` the real
  `common/` file first, or stub the specific `util.foo` functions used.

The general recipe stays the same: container div → stub fetch with a captured snake_case fixture → stub libs →
`loadGlobalScript` → `setup({}).init()` → assert no "Failed to load" + expected content. A shared
`beforeEach` helper (e.g. `stubChartJs()`, `stubLeaflet()`) can live alongside `loadGlobalScript.js` as coverage grows.

`common/aggregateStats.js` (named as a first target in the plan) is a good next addition — it has retry/timeout logic
worth unit-testing with fake timers.

## Why this is opt-in and NOT in CI

Frontend linting and the JS **ES5→ES2022 migration** are owned by a separate in-flight effort, **issue #2487**. Dropping
test/lint tooling into CI mid-migration would create large, conflict-prone churn and risks colliding with that work.
So:

- **No ESLint, no broad config** is introduced here (`jest.config.js` is scoped to `test/js/` only and never touches
  production JS).
- **Nothing is wired into CI.** Per `docs/testing-and-ci.md`, the frontend CI ramp is deferred to #2487's track.
- The existing `npm test` placeholder is **unchanged** to avoid surprising any tooling that already calls it.

When #2487 lands, this prototype is ready to be promoted into the frontend CI job (`npx jest` / `npm run test:js`)
described in the plan.

## Complementary E2E (recommendation)

These jsdom tests verify the render contract in isolation. A thin **Playwright** "api-docs smoke" is the natural E2E
complement: load each `/v3/api-docs/*` page against a running app, **fail on any console error**, and assert each
preview container is non-empty and contains no "Failed to load" banner. That catches integration-level breakage (real
endpoint shape, script load order from Grunt, missing globals) that a mocked-`fetch` unit test cannot. Per the plan,
keep it **advisory/nightly**, never blocking PRs.
