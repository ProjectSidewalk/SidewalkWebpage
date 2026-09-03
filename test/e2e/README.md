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

Works against a populated dev DB or CI's small seeded one — specs tolerate both. Google Maps is never contacted:
every context gets the local stub (`fixtures/google-maps-stub.js`, phase 2 below), so `/explore` and `/validate`
run without a key and the dev app's real key is never billed by a test run.

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

### Map base-layer stub

The two `/labelMap` behavior specs (`labelmap-feed-failure.spec.js`, `labelmap-viewport-fetch.spec.js`) add
`stubMapBaseLayers()`, which answers `/neighborhoods`, `/neighborhoods/completionRate`, and
`/contribution/streets/all` with empty collections. `createPSMap` loads all three before the label feed, and on a
seeded schema they run to megabytes (~7.4 MB in Seattle) that must reach mapbox-gl before the page promise
resolves — long enough to blow the 5s default `expect` timeout with four workers competing at the start of a run,
and hidden in CI, whose seed is a few streets (#5081). Neither spec reads that data: both assert request and error
behavior, so serving none of it makes them behave identically against a seeded schema and an empty one, in content
and in how long they take. The smoke and a11y specs deliberately do **not** stub it — they are there to load the
real page.

### Accessibility gate

`a11y.spec.js` runs axe-core (`@axe-core/playwright`) over every page in `pages.js`, tagged `wcag2a` +
`wcag2aa` + `wcag21aa`, and fails on any violation `a11y-allowlist.js` does not already track — each allowlist
entry citing the issue that will fix it. It is its own Playwright project, so run it alone with
`make test-e2e args="--project=a11y"`. Coverage is **opt-out**: because the page table is shared, a page added for
the smoke tests is gated for accessibility too unless someone writes it into `EXEMPT_PAGES` with a reason. What a
page renders depends on its data: CI's seed (see "The CI test city" below) puts a few gallery cards, leaderboard
rows and api-docs preview features on the page, while a full dev DB puts thousands — so volume-driven violations
are still only visible locally. Policy, the allowlist rules, and the manual checklist
that covers what axe can't see: [`docs/accessibility.md`](../../docs/accessibility.md).

`a11y-api-docs-states.spec.js` belongs to the same project and covers what a page walk structurally can't: the
api-docs previews' *message* renders. It intercepts a preview's endpoint, serves a truncated body or an empty
result, and scans the "failed to load" or "no data" markup the preview shows in place of its chart — one state per
distinct DOM shape, since twelve previews share the same `.message-error` markup. Its allowlist keys carry a
` [state]` suffix, and every case also asserts the injected message carries `role="alert"` (a failure) or
`role="status"` (an ordinary empty result), which is a rule axe does not have.

Both files match the `A11Y_SPECS` pattern in `playwright.config.js`, which is what puts a spec in the gate and
keeps it out of the smoke half — one definition, used for the a11y project's `testMatch` and the smoke project's
`testIgnore`.

### Console-error allowlist

`CONSOLE_ERROR_ALLOWLIST` in `fixtures.js`. Policy: entries are added only for **observed, understood**
noise, each with a comment explaining the cause — never to get a red run green. `pageerror` (an uncaught
exception) is never allowlisted.

## Where it runs in CI

The `e2e-smoke` job in `.github/workflows/ci.yml`, on every PR. It builds the bundles, stages the app
(prod-mode binary against the CI Postgres+PostGIS), seeds the test city from `fixtures/ci-seed.sql`, and runs
this suite in two steps: the **accessibility gate** (`--project=a11y`), then the smoke half
(`--project=chromium`). **Both are blocking** — the smoke half stopped being advisory in #5115, once the seed
gave the pages content to render. Each project writes to its own `test-results/` subdirectory, so the second run
does not clear the first's traces before they are uploaded. On failure of either half it uploads the Playwright
report, traces, and `app.log`. **It never runs
during local development** — your edit / `grunt watch` / reload loop is untouched.

### The CI test city

`fixtures/ci-seed.sql`, applied by this job and by `backend-tests`, and the one definition of what CI's database
holds: one real Teaneck neighbourhood — its four streets, 33 labels, and the panoramas they sit on — pulled from
prod with `../../tools/ci_seed_slice.sql` and rebuilt by `../../tools/gen_ci_seed.py`. Real, because a fixture that
invents its own coordinates and panorama ids can only show that the code runs, not that it runs on the shape of data
it will meet. Small on purpose: enough that every page renders real content and every backend spec has something to
read, not a second city dump to maintain. Three things about it shape this suite:

- **Every panorama it names is expired**, as the rows it was taken from are. That is what keeps the server side
  hermetic: an expired pano is never fetched from a provider, so building a validation mission needs neither live
  imagery nor the `GOOGLE_MAPS_SECRET` CI does not have (#4948). What stands in is on disk — `install-media.sh`,
  run right after the seed, installs the backup panoramas Pannellum renders and the crops the Gallery reads.
  (The *browser* still tries the primary viewer first and usually succeeds, since Google goes on serving
  panoramas our own metadata check has retired; the backups cover the rest.) `install-media.sh` reads
  `SIDEWALK_CITY_ID` for the directory to write into, the same way the app reads it, and fails if it isn't set:
  put the files under the wrong city and nothing errors, imagery just silently falls back to a provider.
- **Label imagery still can't come from Google**, so the `stubStreetViewImages` fixture answers the static
  Street View API with a 1×1 pixel for every test. Without a real `GOOGLE_MAPS_API_KEY` (fork PRs, most dev
  setups) the Maps JS API also refuses to initialize, and that one message is allowlisted — conditionally, so it
  still fails a run that *has* a key configured.
- **The seed sets the city's own map parameters.** The committed template ships someone else's centre and
  bounding box, so every map opened hundreds of miles from the only labels there are, and the specs that open a
  label card near the city centre skipped for want of one. They run now.

## Phase roadmap

- **Phase 1:** load every core anonymous page + `/dashboard`; fail on uncaught errors. ✅
- **Phase 2:** `/explore` + `/validate` (`explore-validate.spec.js`) against a **stubbed Google Maps JS API**
  (`fixtures/google-maps-stub.js`, routed in for every context by `fixtures.js`; #5129). Google bills every
  `StreetViewPanorama` and `Map` instantiation — local tiles or not — and the label-detail popup instantiates a
  panorama on each `/labelMap`, `/gallery`, `/dashboard` and `/stories` load (#5128), so a suite run against the
  real API was ~20 billable events. The stub implements just the surface `public/js` uses, fires the events the
  app awaits, and serves any pano id the server vouched for (a spec exercises the expired-imagery path by calling
  `google.maps.__stub.expire([...])` first). The
  `googleMapsLeaks` auto-fixture aborts and reports any request that still reaches a Google map host, so a page
  that builds a real map or panorama cannot merge. `/explore` asserts the audit tutorial loads: it's
  deterministic for every fresh anonymous user, its panos are custom (`registerPanoProvider`) with local tiles,
  and CI seeds the one region it requires (`fixtures/ci-seed.sql` — with zero regions `/explore` is a server
  error). A reload counter turns Explore's viewer-failure reload loop into a fast, named failure.
  `/validate` accepts either legitimate terminal state error-free: a mission or the "no new mission" modal.
  CI takes the mission branch — the seed carries the ≥ 10 validatable labels of one type a mission needs, and
  the server resolves their imagery from the committed backups rather than a provider (#5115). `/mobile`
  runs the same two-terminal-state check under an iPhone descriptor (the server serves that page by UA and
  redirects a desktop one to `/`), in portrait and in landscape, each pinning the layout viewport to the
  device's own width — the #4891 contract. ✅
- **Phase 2b:** make CI exercise `/validate`'s real mission path. ✅ via #5115's seed — ten validatable labels
  on panos with committed backup imagery. The `GOOGLE_MAPS_SECRET` #4948 called for
  turned out not to be needed: the seeded panoramas are expired, so the server-side imagery check reads the
  backup files on disk instead of asking a provider. Still open under #4948 is coverage of the mission's
  *interactions* (menu handlers, keyboard shortcuts, undo), not reaching a mission at all. Also open: gallery
  expanded-card view and api-docs preview content asserts.
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
| `fixtures.js` | `consoleErrors` fixture, Mapbox / Street-View / ML-API stubs, `loadAndSettle`, `waitForAppReady`, `horizontalOverflowReport`, allowlist |
| `fixtures/ci-seed.sql` | The CI test city: region, streets, users, labels, missions, panos. Applied by both CI jobs |
| `fixtures/install-media.sh` | Copies `fixtures/media/` into the app's pano and crop directories |
| `fixtures/media/` | The seeded labels' real imagery, downscaled: backup panoramas and label crops |
| `../../tools/gen_ci_seed.py` | Regenerates `fixtures/ci-seed.sql` from a prod slice; holds the fixture's invariants |
| `../../tools/ci_seed_slice.sql` | The read-only prod query the slice comes from (which rows, and why those) |
| `auth.setup.js` | Registers a throwaway user, saves storageState for registered-user specs |
| `pages.js` | **The** page table: every anonymous page the suite walks, and how each loads. Adding one here opts it into the smoke tests *and* the accessibility gate |
| `pages.spec.js` | Table-driven phase-1 anonymous pages |
| `phone-viewport.spec.js` | The same pages at a 390×844 phone viewport: no horizontal overflow (#4883) |
| `a11y.spec.js` | The accessibility gate: axe-core over every page in `pages.js`, WCAG 2.1 AA (#5060) |
| `a11y-api-docs-states.spec.js` | The same gate over the api-docs previews' error and empty renders, forced by intercepting their feeds (#5122) |
| `a11y-allowlist.js` | Per-page allowlist of tracked violations, the shared WCAG tag list, plus the partition/format helpers |
| `overflow-report.spec.js` | `horizontalOverflowReport`'s exemption rules, pinned against synthetic DOM |
| `dashboard.spec.js` | Registered-user pages |
| `explore-validate.spec.js` | Phase-2 Explore/Validate/mobile-Validate specs (skip without the real GSV key) |
| `labelmap-feed-failure.spec.js` | What `/labelMap` shows when its label feed fails (intercepted, so DB-independent) |
