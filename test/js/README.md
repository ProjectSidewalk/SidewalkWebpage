# Frontend JS tests

The jsdom unit suite for `frontend/js/`, run by [Vitest](https://vitest.dev) (`vitest.config.mjs`). Each `*.test.js`
covers one behavior, and its header says which. The suite is a blocking step in CI's `frontend` job.

## How to run

From the repo root:

```bash
make test-js                                      # the whole suite, in the web container (where node_modules live)
make test-js args=test/js/toastPosition.test.js   # one suite
make test-js args=--coverage                      # with the coverage report, as CI runs it
```

`describe`/`it`/`expect`/`vi` are globals. Each file runs in its own VM context whose global is the jsdom window, so a
page global that production reads bare (`i18next`, `mapboxgl`, `turf`, ...) is set with `window.X = …`. Before every
test the config and `setup.js` undo spies and `vi.stubGlobal` stubs, empty every mock's call history and put real
timers back, so no suite writes that cleanup. `setup.js` also stamps `window.labelTypes` the way every page is served
it, and replaces Node's `fetch` with one that throws until a suite stubs it, so nothing here can reach the network.

## How a suite loads its subject

`const { Toast } = await loadModules('frontend/js/common/Toast.js')`, from `loader.js`, returns the file's exports
from a fresh module registry. Files named in one call share a registry, so one's import of another is the instance
the suite gets back; what the suite itself loads is always the real module.

A collaborator the subject should not really use is handed to it where its constructor (or `create`) takes one, which
is most Explore and Validate classes. Otherwise:

- `mockModule('frontend/js/common/Toast.js', () => ({ Toast: fake }))` before the load replaces what the subject
  imports from that file. The factory gets `importOriginal`, so it can spread the real exports and override one;
  `unmockModule(path)` undoes it.
- `useUtil({ isMobile: () => true, misc: { getStreetNameNear } })` puts those members on the real `util` as the
  modules import it; sub-objects such as `misc` and `math` merge into the real ones. Without it, modules get the real
  `util`, which already behaves in jsdom (`assetPath` gives `/assets/<path>`, `isMobile()` is false).
- `loadVendored('turf')` runs a vendored bundle into the page like its `<script>` tag.

What `useUtil` and `mockModule` set lasts for the rest of the file, so a test that changes one is followed by a
`beforeEach` that sets it back.

The stand-ins a constructor takes when they are not under test (a gate, a tracker, a task container, a pano manager)
come from `fakes.js`: `fakeGate()`, `fakeTracker()` and so on, each taking overrides, so a constructor change is a
one-file edit. The same file holds the mock sets several suites share; larger harnesses live under `support/`.

## Lint and coverage

`test/js/` is linted with the same ESLint rules as `test/e2e/`, plus the Vitest globals and the house style's
2-space indent. The browser, Node and Vitest globals are declared in `eslint.config.js`, so no suite needs a
`/* global */` directive.

Coverage is reported over all of `frontend/js/**/*.js`, so a file no test loads still counts against the ratio. The
console shows totals; `coverage/lcov-report/index.html` has per-file detail. `coverage.thresholds` in
`vitest.config.mjs` is a ratchet: a run that drops below any floor fails even when every test passes. Raise the floors
when a PR adds the headroom.

## Complementary E2E

These tests check behavior in isolation. The Playwright smoke suite in [`test/e2e/`](../e2e) loads core pages against
a running app and fails on any uncaught console or page error, catching what a mocked unit test cannot: a real
endpoint's shape, or a missing vendor global.
