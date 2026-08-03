# Browser smoke tests (Playwright)

A thin headless-browser suite (issue #4504) that loads each core page and **fails on any uncaught page
error or non-allowlisted `console.error`**. It exists to catch the class of regression that compile, the
grunt build, and all four linters are blind to: runtime-only JS errors — a stale bundle, a missing global,
an unbound-method `this` bug, a route-ordering 400 breaking a fetch. It asserts *pages initialize cleanly*,
not pixel-level behavior; deep canvas/imagery testing stays manual by design.

## Running locally

The suite does **not** boot the app — it runs against whatever `BASE_URL` points at (default
`http://localhost:9000`, i.e. your running dev app).

```bash
# One-time host setup (node_modules normally lives only in the web container):
npm install && npx playwright install chromium

# Run against the already-running dev app:
make test-e2e                       # = npx playwright test
make test-e2e args="-g labelMap"    # single test; add --headed to watch it
BASE_URL=http://localhost:9001 npx playwright test   # non-default port
```

Works against a populated dev DB or an empty CI-style one — specs tolerate both.

Note that a `-g`-scoped run still executes the `setup` project first (Playwright runs project dependencies
regardless of filters), so every run registers a throwaway `ci-smoke-<timestamp>` user in the dev DB. Add
`--no-deps` to skip it when your filter doesn't include `/dashboard`: `make test-e2e args="-g labelMap --no-deps"`.

## How a spec works

1. `page.goto(path)` — an unauthenticated top-level navigation 303s through `/anonSignUp` (which mints an
   anonymous session) and back, so no explicit sign-in is needed. Registered-user pages
   (`dashboard.spec.js`) reuse the storageState saved by `auth.setup.js` (two-step CSRF `POST /signUp`).
2. Wait for `window.appManager.isReady` (every page's shared init manager), plus the page's own signal
   where one exists (the `#page-loading` overlay hiding).
   **The wait is not the assertion**: AppManager catches init/ready-callback exceptions, `console.error`s
   them, and flips `isReady` anyway — a broken page still "becomes ready".
3. Assert the collected `pageerror` + `console.error` list (the `consoleErrors` fixture) is empty.

### Mapbox stub

Pages that build a Mapbox map at init (`/`, `/labelMap`, `/routeBuilder`, `/cities`, `/dashboard`) get
`stubMapbox()`: all `api.mapbox.com` traffic is intercepted and the style request answered with a minimal
valid empty style. Without it, CI's dummy `MAPBOX_API_KEY` 401s the style request, the map's `load` event
never fires, and `#page-loading` hangs forever. The stub runs even against a real local key so behavior is
identical in both environments.

### Console-error allowlist

`CONSOLE_ERROR_ALLOWLIST` in `fixtures.js`. Policy: entries are added only for **observed, understood**
noise, each with a comment explaining the cause — never to get a red run green. `pageerror` (an uncaught
exception) is never allowlisted.

## Where it runs in CI

The `e2e-smoke` job in `.github/workflows/ci.yml` — **advisory** (`continue-on-error: true`, like
`backend-tests`) on every PR, promotable to blocking once proven stable. It builds the bundles, stages the
app (prod-mode binary against the CI Postgres+PostGIS with the empty `sidewalk_teaneck` schema), and runs
this suite; on failure it uploads the Playwright report, traces, and `app.log`. **It never runs during
local development** — your edit / `grunt watch` / reload loop is untouched.

## Phase roadmap

- **Phase 1 (this suite):** load every core anonymous page + `/dashboard`; fail on uncaught errors.
- **Phase 2:** `/explore` + `/validate` (`explore-validate.spec.js` is the skip-guarded seam). Needs (a)
  the `GOOGLE_MAPS_API_KEY_TEST` repo secret — a referrer/API-restricted Google Maps key; with the dummy
  key the pano load times out and Explore reload-loops — and (b) a committed label/street seed SQL for the
  CI schema (`/validate` indexes `param.labelList[0]`; empty `/explore` takes the no-task branch). Also:
  gallery expanded-card view, api-docs preview assertions.
- **Phase 3:** primary-control interactions per page (info button, tag menu, mission modal) and a few
  end-to-end flows (place a label + tag; validate a label); admin pages (promote the setup user via a
  superuser `UPDATE user_role` in CI).

## File map

| File | Role |
|---|---|
| `../../playwright.config.js` | Config: `testDir`, retries, reporters, the `setup` → `chromium` projects |
| `fixtures.js` | `consoleErrors` fixture, Mapbox stub, `waitForAppReady`, allowlist |
| `auth.setup.js` | Registers a throwaway user, saves storageState for registered-user specs |
| `pages.spec.js` | Table-driven phase-1 anonymous pages |
| `dashboard.spec.js` | Registered-user pages |
| `explore-validate.spec.js` | Phase-2 seam (skips without the real GSV key) |
