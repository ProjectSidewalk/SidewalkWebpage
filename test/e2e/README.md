# Browser smoke tests (Playwright)

A thin headless-browser suite (issue #4504) that loads each core page and **fails on any uncaught page
error or non-allowlisted `console.error`**. It exists to catch the class of regression that compile, the
grunt build, and all four linters are blind to: runtime-only JS errors — a stale bundle, a missing global,
an unbound-method `this` bug, a route-ordering 400 breaking a fetch. It asserts *pages initialize cleanly*
plus one piece of layout geometry — `phone-viewport.spec.js` re-loads the responsive pages at a 390×844
phone viewport and fails on horizontal overflow (#4883) — and one accessibility gate: `a11y.spec.js` runs
axe-core over each audited page and fails on any untracked WCAG 2.1 AA violation (#5060). Deep
canvas/imagery testing stays manual by design.

## Running locally

The suite does **not** boot the app — it runs against whatever `BASE_URL` points at (default
`http://localhost:9000`). So bring an app up first (`npm start` inside `make dev`, or `make qa-worktree
wt=<name>` for a branch under QA); that occupies a terminal, so run the suite from a second one.

```bash
make test-e2e                                  # the whole suite
make test-e2e args="-g labelMap --no-deps"     # one page (see the --no-deps note below)
make test-e2e wt=<worktree-name>               # a worktree's specs instead of the main checkout's
```

**There is no setup step.** The runner is a container built from [`docker/e2e/Dockerfile`](../../docker/e2e/Dockerfile)
on the official Playwright image, which already carries Chromium and its OS libraries — so the same command and
the same browser build work on Linux, WSL2, and macOS (the image is multi-arch, so Apple Silicon runs Chromium
natively), with no host Node and no `playwright install`. The image builds on first use and rebuilds itself when
`package.json`'s `@playwright/test` or `@axe-core/playwright` pin changes, because `make` derives both the image
tag and the tools installed in it from those pins.

Three details worth knowing when something looks odd:

- The runner joins the **web container's network namespace**, so `localhost:9000` inside it is the dev app.
  `BASE_URL` exists mainly for CI; locally there is little to point it at, because
  `conf/application.local.conf` sets `play.filters.hosts.allowed = ["localhost:9000"]` and Play's host filter
  400s anything else — including `web:9000` and any other port — and because `localhost` now resolves inside
  the web container rather than on your host.
- It inherits the web container's **mounts** (not its image filesystem), so the repo is at `/home` and worktree
  paths resolve unchanged. The one exception is `/home/node_modules`, which is deliberately masked with an empty
  tmpfs so `require('@playwright/test')` resolves to the runner in the image instead of the repo's own copy —
  two copies in one process makes Playwright abort with *"did not expect `test()` to be called here"*.
- Reports, traces, and screenshots land in gitignored `test-results/`, written as **your** uid (the runner passes
  `--user`), so you can read and delete them from the host like any other file.

Works against a populated dev DB or an empty CI-style one — specs tolerate both. `/explore` and `/validate`
self-skip unless you `export HAS_REAL_GMAPS_KEY=true` (phase 2, below).

Note that a `-g`-scoped run still executes the `setup` project first (Playwright runs project dependencies
regardless of filters), so every run registers a throwaway `ci-smoke-<timestamp>` user in the dev DB. Add
`--no-deps` to skip it when your filter doesn't include `/dashboard`: `make test-e2e args="-g labelMap --no-deps"`.

### Watching it run, and debugging a failure

`--headed`, `--ui`, and `show-trace` need a display the container doesn't have, so they run host-side:

```bash
make test-e2e-host args="-g labelMap --headed"
```

That path needs a host toolchain the containerized one doesn't: **Node 23**, `npm install` at the repo root (the
container's `node_modules` is a Docker volume, so the host copy is separate and unpinned — there's no committed
`package-lock.json`), and `npx playwright install chromium`, plus `sudo npx playwright install-deps` on
Linux/WSL. Use it for interactive debugging; `make test-e2e` is what a normal run and CI both exercise.

## How a spec works

1. `page.goto(path)` — no explicit sign-in is needed: most public pages render sessionless (#4643), and a
   top-level navigation to one behind a `SecuredAction` 303s through `/anonSignUp` (which mints an anonymous
   session) and back. A page under test therefore may load with **or** without a session, which is itself
   part of what the suite covers — an init-time fetch that assumes a session `console.error`s and fails the
   spec. Registered-user pages (`dashboard.spec.js`) reuse the storageState saved by `auth.setup.js`
   (two-step CSRF `POST /signUp`).
2. Wait for `window.appManager.isReady` (every page's shared init manager), plus the page's own signal
   where one exists (the `#page-loading` overlay hiding).
   **The wait is not the assertion**: AppManager catches init/ready-callback exceptions, `console.error`s
   them, and flips `isReady` anyway — a broken page still "becomes ready".
3. Assert the collected `pageerror` + `console.error` list (the `consoleErrors` fixture) is empty.

Steps 1–2 (plus a stayed-put URL assert and a 1s settle window for late async work) live in the shared
`loadAndSettle()` helper in `fixtures.js`, driven by per-entry flags in each spec's page table — the load
protocol is defined once so the table-driven specs can't drift apart.

### Mapbox stub

Pages that build a Mapbox map at init (`/`, `/about`, `/labelMap`, `/routeBuilder`, `/cities`, `/dashboard`)
get `stubMapbox()`: all `api.mapbox.com` traffic is intercepted and the style request answered with a minimal
valid empty style. Without it, CI's dummy `MAPBOX_API_KEY` 401s the style request, the map's `load` event
never fires, and `#page-loading` hangs forever. The stub runs even against a real local key so behavior is
identical in both environments.

### Makeability Lab API stub

`/about` hydrates its team/publications/grants sections from the live ML API, so it gets
`stubMakeabilityLab()`: every `makeabilitylab.cs.washington.edu` request is answered with an empty listing,
keeping each section on its server-rendered fallback. That makes the measured DOM deterministic and keeps an
ML-site outage from failing the run.

### Accessibility gate

`a11y.spec.js` runs axe-core (`@axe-core/playwright`) over each page in its own table, tagged `wcag2a` +
`wcag2aa` + `wcag21aa`, and fails on any violation `a11y-allowlist.js` does not already track — each allowlist
entry citing the issue that will fix it. Run it alone with `make test-e2e args="-g a11y --no-deps"`. The page
table is separate from `pages.spec.js`'s on purpose: a page joins once its violations are fixed or tracked, so a
page missing from it is a page nobody has audited. Policy, the allowlist rules, and the manual checklist that
covers what axe can't see: [`docs/accessibility.md`](../../docs/accessibility.md).

### Console-error allowlist

`CONSOLE_ERROR_ALLOWLIST` in `fixtures.js`. Policy: entries are added only for **observed, understood**
noise, each with a comment explaining the cause — never to get a red run green. `pageerror` (an uncaught
exception) is never allowlisted.

## Where it runs in CI

The `e2e-smoke` job in `.github/workflows/ci.yml`, on every PR. It builds the bundles, stages the app
(prod-mode binary against the CI Postgres+PostGIS with the empty `sidewalk_teaneck` schema), and runs this
suite in two steps: the **accessibility gate** (`-g 'a11y:'`) **blocking**, then the smoke half
(`--grep-invert 'a11y:'`) **advisory** (`continue-on-error` on the step, not the job — on the job it would
excuse the gate too). On failure it uploads the Playwright report, traces, and `app.log`. **It never runs
during local development** — your edit / `grunt watch` / reload loop is untouched.

## Phase roadmap

- **Phase 1:** load every core anonymous page + `/dashboard`; fail on uncaught errors. ✅
- **Phase 2:** `/explore` + `/validate` (`explore-validate.spec.js`), gated on a real Google Maps key
  (`GOOGLE_MAPS_API_KEY_TEST` repo secret → `HAS_REAL_GMAPS_KEY=true`; specs self-skip without it, e.g. on
  fork PRs — locally, export the variable to opt in). `/explore` asserts the audit tutorial loads: it's
  deterministic for every fresh anonymous user, its pano tiles are local assets (no live GSV imagery), and
  CI seeds the one region it requires (`fixtures/ci-seed.sql` — with zero regions `/explore` is a server
  error). A reload counter turns Explore's viewer-failure reload loop into a fast, named failure.
  `/validate` accepts either legitimate terminal state error-free: a mission (seeded DBs) or the
  "no new mission" modal (CI's empty city — a mission needs ≥ 10 validatable labels of one type). `/mobile`
  runs the same two-terminal-state check under an iPhone descriptor (the server serves that page by UA and
  redirects a desktop one to `/`), in portrait and in landscape, each pinning the layout viewport to the
  device's own width — the #4891 contract. ✅
- **Phase 2b (open):** make CI exercise `/validate`'s real mission path — needs a committed seed of ≥ 10
  non-tutorial labels whose panos are live or locally backed up, and a real `GOOGLE_MAPS_SECRET` for the
  server-side pano-metadata check (#4948 records the trade); also gallery expanded-card view and api-docs
  preview content asserts (then drop the `regionWithMostLabels` allowlist entries in `fixtures.js`).
  `/v3/api-docs/labelTags` can't join the page tables until its missing tag example images (ids 43, 76–79)
  are added — each 404 is a console error.
- **Phase 3:** primary-control interactions per page (info button, tag menu, mission modal) and a few
  end-to-end flows (place a label + tag; validate a label); admin pages (promote the setup user via a
  superuser `UPDATE user_role` in CI).

## File map

| File | Role |
|---|---|
| `../../playwright.config.js` | Config: `testDir`, retries, reporters, the `setup` → `chromium` projects |
| `../../docker/e2e/Dockerfile` | The runner image `make test-e2e` builds and runs (Chromium + the pinned runner) |
| `fixtures.js` | `consoleErrors` fixture, Mapbox + ML-API stubs, `loadAndSettle`, `waitForAppReady`, `horizontalOverflowReport`, allowlist |
| `auth.setup.js` | Registers a throwaway user, saves storageState for registered-user specs |
| `pages.spec.js` | Table-driven phase-1 anonymous pages |
| `phone-viewport.spec.js` | The same pages at a 390×844 phone viewport: no horizontal overflow (#4883) |
| `a11y.spec.js` | The accessibility gate: axe-core over the audited pages, WCAG 2.1 AA (#5060) |
| `a11y-allowlist.js` | Per-page allowlist of tracked violations, plus the partition/format helpers |
| `overflow-report.spec.js` | `horizontalOverflowReport`'s exemption rules, pinned against synthetic DOM |
| `dashboard.spec.js` | Registered-user pages |
| `explore-validate.spec.js` | Phase-2 Explore/Validate/mobile-Validate specs (skip without the real GSV key) |
| `labelmap-feed-failure.spec.js` | What `/labelMap` shows when its label feed fails (intercepted, so DB-independent) |
