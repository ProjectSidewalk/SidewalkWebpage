/**
 * Shared fixtures and helpers for the browser smoke suite (issue #4504).
 *
 * The suite's primary assertion is "no uncaught errors": every spec collects `pageerror` events and
 * non-allowlisted `console.error` output via the `consoleErrors` fixture and asserts the list is empty
 * after the page settles.
 */
const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Where auth.setup.js saves the registered user's session for the specs that need one (dashboard.spec.js).
const STORAGE_STATE = 'test-results/.auth/registered.json';

// The phone profile the viewport specs measure at. defaultBrowserType is dropped because the suite's chromium
// project already fixes the browser; shared so the page walk and the checks that pin its rules can't drift apart.
const PHONE_DEVICE = {...base.devices['iPhone 13'], viewport: {width: 390, height: 844}};
delete PHONE_DEVICE.defaultBrowserType;

// Known-benign console errors ONLY. Keep this tight: every entry needs a comment explaining the cause, and
// entries are added only for observed, understood noise — never to get a red run green. `pageerror` (an
// uncaught exception) is NEVER allowlisted.
const CONSOLE_ERROR_ALLOWLIST = [
  // i18next probes optional per-locale/namespace overlays (/assets/locales/{lng}/{ns}.json); a missing overlay
  // 404s by design and i18next falls back through the locale chain. Anchored to the browser's resource-load
  // failure line so a real app error whose text merely mentions a locale path can't hide behind it.
  /^console\.error: Failed to load resource: .*\(.*\/assets\/locales\/.+\.json(\?[^)]*)?\)$/,
  // Mapbox telemetry; stubbed to 204 by stubMapbox but belt-and-braces for pages that skip the stub.
  /events\.mapbox\.com/,
  // The app ships CSP in REPORT-ONLY mode (conf/application.conf, reportOnly = true): the browser logs each
  // would-be violation as a console error but takes no action, so pages embedding external content (e.g. the
  // /help YouTube iframes) emit these on every load. Enforcement policy is a backend-config concern, not the
  // page-runtime breakage this suite exists to catch.
  /report-only Content Security Policy/,
  // The /help YouTube embeds' player script probes the Compute Pressure API, which the embedding iframes don't
  // delegate (no allow="compute-pressure"), and Chromium logs the violation as a console error attributed to
  // the player's own base.js. Intermittent: it fires only when the player boots far enough within the settle
  // window. Anchored to the violation text plus a youtube.com source so nothing of ours can hide behind it.
  /^console\.error: Permissions policy violation: compute-pressure .+ \(https:\/\/www\.youtube\.com\/.+\)$/,
];

// Minimal Mapbox style the app's runtime accepts: MapboxLanguage throws unless the style has a vector source
// based on mapbox-streets-v8, and addLayer rejects `text-field` layers (RouteBuilder's labels) unless the
// style declares `glyphs` — so both are stubbed, pointing at api.mapbox.com where the catch-all answers 204
// (a valid empty tile/glyph response). The map's `load` event fires, createPSMap's promise resolves, and
// runtime addSource/addLayer calls work.
const STUB_STYLE = {
  version: 8,
  name: 'ci-stub',
  sources: {composite: {type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8'}},
  glyphs: 'https://api.mapbox.com/fonts/v1/ci-stub/{fontstack}/{range}.pbf',
  layers: [],
};

// TileJSON metadata for the stub source above (mapbox-gl fetches it eagerly even with no layers using the
// source). The tiles template stays on api.mapbox.com so the catch-all intercepts any stray tile request
// with a 204, which mapbox-gl treats as a valid empty tile.
const STUB_TILEJSON = {
  tilejson: '2.2.0',
  name: 'ci-stub',
  tiles: ['https://api.mapbox.com/v4/ci-stub/{z}/{x}/{y}.vector.pbf'],
  vector_layers: [],
};

// Hand-encoded glyph PBF: one fontstack (name "stub", range "0-255") with zero glyphs. Glyph requests need a
// structurally valid protobuf — an empty 204 body parses to a fontstack missing its glyphs array, and
// mapbox-gl's glyph loader throws ("glyphs is not iterable") on every text layer render.
const STUB_GLYPH_PBF = Buffer.from([
  0x0a, 0x0d, // field 1 (fontstack), length 13
  0x0a, 0x04, 0x73, 0x74, 0x75, 0x62, // name = "stub"
  0x12, 0x05, 0x30, 0x2d, 0x32, 0x35, 0x35, // range = "0-255"
]);

/**
 * Stubs all Mapbox network traffic for a browser context. Use on pages that build a map at init: with CI's
 * dummy MAPBOX_API_KEY the style request would 401, the map's `load` event would never fire, and the
 * `#page-loading` overlay would hang forever. Intercepting even when a real key is configured (local dev)
 * keeps the suite deterministic in both environments.
 *
 * @param {import('@playwright/test').BrowserContext} context - The context whose requests to intercept.
 */
async function stubMapbox(context) {
  // Catch-all is registered first: Playwright matches the MOST RECENTLY registered route, so the more
  // specific TileJSON/style routes below win for their requests.
  await context.route(/https:\/\/(api|events)\.mapbox\.com\/.*/, (route) => route.fulfill({status: 204, body: ''}));
  await context.route(/https:\/\/api\.mapbox\.com\/v4\/.*\.json.*/, (route) => route.fulfill({json: STUB_TILEJSON}));
  await context.route(/https:\/\/api\.mapbox\.com\/fonts\/v1\/.*/, (route) =>
    route.fulfill({body: STUB_GLYPH_PBF, contentType: 'application/x-protobuf'}));
  await context.route(/https:\/\/api\.mapbox\.com\/styles\/v1\/.*/, (route) => route.fulfill({json: STUB_STYLE}));
}

// The fake Google Maps JS API (test/e2e/fixtures/google-maps-stub.js), read once per worker.
const GOOGLE_MAPS_STUB = fs.readFileSync(path.join(__dirname, 'fixtures', 'google-maps-stub.js'), 'utf8');

// 1x1 transparent PNG, so an <img> pointed at it fires `load` rather than `error`. Decoded once per worker.
const TRANSPARENT_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64');

// Every host the Maps JS API, Street View, or the Street View Static API fans out to. Nothing here may be reached
// from a test: Google bills per `StreetViewPanorama` / `Map` instantiation and per static image, and a request to
// any of these means a real one was built. Deliberately a fixed list — fonts.googleapis.com (free, and the app's
// web fonts) and the YouTube-side *-pa.googleapis.com endpoints the /help embeds call are not Maps.
const GOOGLE_MAPS_HOSTS = new RegExp(`^https://(${[
  'maps\\.googleapis\\.com', // The API bootstrap, its module chunks, the billing beacons, map tiles, metadata RPCs.
  'maps\\.gstatic\\.com', // Static assets the API loads (icons, the pegman sprite).
  'mapsresources-pa\\.googleapis\\.com', // Marker and style resources.
  'streetviewpixels-pa\\.googleapis\\.com', // Street View tiles.
  'geo\\d*\\.ggpht\\.com', // Street View thumbnails.
  'cbks?\\d*\\.google\\.com', // Legacy Street View tile hosts.
].join('|')})/`);

/**
 * Replaces the Google Maps JavaScript API with the local stub for a browser context, answers Street View static
 * images with a transparent pixel, and refuses every other request to Google's map hosts (issue #5129).
 *
 * The app's inline loader (main.scala.html) requests `https://maps.googleapis.com/maps/api/js?...` on the first
 * `google.maps.importLibrary()`; the stub answers it and releases the loader. Static images get the pixel because
 * their URL is signed with GOOGLE_MAPS_SECRET — a dummy in CI, absent from most dev setups — so a real request is
 * refused and Chromium logs a console error the suite reads as breakage. Anything else bound for a Google map host
 * is aborted and recorded in `leaks`. The `googleMapsLeaks` auto-fixture is the one install site and owns the
 * assertion; a hand-built context must do both itself, which is why `leaks` is not optional.
 *
 * @param {import('@playwright/test').BrowserContext} context - The context whose requests to intercept.
 * @param {string[]} leaks - Receives the URL of every refused request, for the caller's leak assertion.
 */
async function stubGoogleMaps(context, leaks) {
  // Broadest first: Playwright tries the most recently registered route first, so the specific ones below win.
  await context.route(GOOGLE_MAPS_HOSTS, (route) => {
    leaks.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await context.route(/https:\/\/maps\.googleapis\.com\/maps\/api\/streetview(\/|\?).*/, (route) =>
    route.fulfill({body: TRANSPARENT_PIXEL, contentType: 'image/png'}));
  await context.route(/^https:\/\/maps\.googleapis\.com\/maps\/api\/js(\?|$)/, (route) =>
    route.fulfill({status: 200, contentType: 'text/javascript', body: GOOGLE_MAPS_STUB}));
}

/**
 * Makes the Google Maps stub resolve every pano id on this context's pages, instead of only ids it has seen (its
 * default, Google's contract, which sends an expired pano down the Pannellum + backup path). For a spec that wants
 * the primary-viewer path — production's when Google still serves a panorama our metadata check has retired. Must
 * run before navigation: it is an init script the stub reads at install.
 *
 * @param {import('@playwright/test').BrowserContext} context - The context whose pages should see every pano resolve.
 */
async function serveAnyPano(context) {
  await context.addInitScript(() => {
    window.googleMapsStubOptions = {serveAnyPano: true};
  });
}

/**
 * Stubs the Makeability Lab API that /about hydrates its team/publications/grants sections from. The empty
 * listing keeps every section on its server-rendered fallback, so the suite measures a deterministic DOM in
 * both environments — and an ML-site outage can't fail the run (Chromium logs its own console error for any
 * failed fetch, which no allowlist entry covers).
 *
 * @param {import('@playwright/test').BrowserContext} context - The context whose requests to intercept.
 */
async function stubMakeabilityLab(context) {
  await context.route('https://makeabilitylab.cs.washington.edu/**', (route) =>
    route.fulfill({json: {results: [], next: null}}));
}

/**
 * Stubs the neighborhood and street layers that createPSMap loads before a map's label feed.
 *
 * On a seeded schema those are ~7.4 MB (Seattle) that must download, parse, and reach mapbox-gl before
 * createPSMap resolves — and only then can a label-feed assertion become true. That doesn't reliably fit the
 * 5s default expect timeout with four workers competing at the start of a run, and CI's empty database hides
 * it (#5081). Specs asserting feed behavior never read this data, so serving none of it costs them nothing.
 *
 * @param {import('@playwright/test').BrowserContext} context - The context whose requests to intercept.
 */
async function stubMapBaseLayers(context) {
  const emptyGeoJson = {type: 'FeatureCollection', features: []};
  // `*` stops at a path separator, so the /neighborhoods route can't swallow /neighborhoods/completionRate —
  // which answers with a rate array, not GeoJSON (addNeighborhoodsToMap looks regions up in it by region_id).
  await context.route('**/neighborhoods*', (route) => route.fulfill({json: emptyGeoJson}));
  await context.route('**/neighborhoods/completionRate*', (route) => route.fulfill({json: []}));
  await context.route('**/contribution/streets/all*', (route) => route.fulfill({json: emptyGeoJson}));
}

/**
 * Waits until the shared AppManager (public/js/common/AppManager.js, wired into every page by
 * app/views/common/main.scala.html) reports initialization complete.
 *
 * This is the WAIT, not the assertion: AppManager catches exceptions thrown by init tasks and ready
 * callbacks, console.error's them, and flips isReady to true anyway — so a broken page still "becomes
 * ready". The consoleErrors fixture is what actually catches the failure.
 *
 * @param {import('@playwright/test').Page} page - The page to wait on.
 */
async function waitForAppReady(page) {
  await page.waitForFunction(() => window.appManager && window.appManager.isReady === true);
}

/**
 * Navigates to a page-table entry and waits for it to settle — the one load protocol shared by
 * pages.spec.js, dashboard.spec.js, and phone-viewport.spec.js, so it can't drift between them.
 *
 * @param {import('@playwright/test').Page} page - The test's page.
 * @param {import('@playwright/test').BrowserContext} context - The page's context (route stubs are per-context).
 * @param {{path: string, mapbox?: boolean, makeabilityLab?: boolean, loadingOverlay?: boolean,
 *   waitFor?: function(import('@playwright/test').Page): Promise<void>}} p - The page-table entry: `mapbox` /
 *   `makeabilityLab` install the stubs above before navigating, `loadingOverlay` waits for the shared
 *   #page-loading overlay to hide, and `waitFor` is an extra page-specific readiness wait.
 */
async function loadAndSettle(page, context, p) {
  if (p.mapbox) await stubMapbox(context);
  if (p.makeabilityLab) await stubMakeabilityLab(context);
  const response = await page.goto(p.path);
  base.expect(response.status(), `${p.path} responded ${response.status()}`).toBeLessThan(400);
  // Asserted before any waiting so a redirected load fails fast and legibly: a bounced session lands on
  // /signIn, and a page that gained a mobile-UA redirect lands on /mobileLanding — both with a clean console.
  base.expect(page.url(), `${p.path} landed on ${page.url()}`).toContain(p.path);
  await waitForAppReady(page);
  // The landing page defers its maps and validation grid behind util.onFirstInteractionOrIdle (#4486).
  // Headless Chromium generates no input events, so without a nudge deferred init would only start on the 5s
  // fallback — after the settle window below, silently costing coverage rather than failing.
  await page.mouse.move(10, 10);
  if (p.waitFor) await p.waitFor(page);
  if (p.loadingOverlay) await page.locator('#page-loading').waitFor({state: 'hidden'});
  // Settle window: errors from late async work (post-ready fetches, image/map callbacks) land here.
  await page.waitForTimeout(1000);
}

/**
 * Measures horizontal overflow at the current viewport width (issue #4883): every element whose border box
 * extends past the right edge of the layout viewport, except content inside an `overflow-x: auto|scroll`
 * ancestor — a horizontal scroller is the sanctioned way to present wide content (tables, code) on a phone.
 *
 * Measuring layout (bounding boxes) rather than scrollbars is the point: `body {overflow-x: clip}` in
 * main.css means an overflowing page never shows a scrollbar, and a `position: fixed` element sized off the
 * overflowed initial containing block (the #4857 footer bug) never widens `scrollWidth` at all. The page-level
 * `scrollWidth` is still reported as a second, cheaper signal.
 *
 * Deliberately strict: content laid out wider than the viewport but clipped by an `overflow: hidden|clip`
 * ancestor is still reported — unreachable-but-laid-out-wide content is the #4883 bug class itself. UI
 * deliberately parked off-screen (an off-canvas drawer) should be display: none / visibility: hidden while
 * closed rather than exempted here. Known blind spot: `overflow-y: auto` computes `overflow-x: auto` on the
 * same box, so a vertical-only scroll pane (e.g. the auth pages' .au-body) exempts its descendants.
 *
 * `visibility: hidden` (and `collapse`) is exempt, so a page can take the parking advice above —
 * `.filter-sidebar--hidden` does, citing this file. It also keeps third-party probes out: the Google Maps SDK
 * measures font metrics with a hidden `<span style="position:absolute; font-size:300px">BESbswy</span>` on
 * `<body>`, ~1200px wide under an `overflow-x: hidden` div the scroller rule does not exempt, alive only until
 * the font resolves — so it lands in some runs and not others, and cost #5025 a full investigation to name.
 *
 * A hidden `position: fixed` box is reported anyway: that is the #4857 shape itself, and nothing else measures
 * it. Second known blind spot, therefore: a hidden `absolute` box is measured by nothing — it stretches no
 * ancestor to report in its place, and `body {overflow-x: clip}` keeps it out of `pageScrollWidth`.
 *
 * @param {import('@playwright/test').Page} page - The page to measure, already loaded and settled.
 * @returns {Promise<{viewportWidth: number, pageScrollWidth: number, offenders: string[], offenderCount: number}>}
 *   Offenders are CSS-selector-ish descriptions with their nearest ancestors
 *   (`div#gallery.sidebar right=612px width=270px in main.page < body`), capped at 10; offenderCount is the
 *   uncapped total.
 */
async function horizontalOverflowReport(page) {
  return page.evaluate(() => {
    const TOLERANCE_PX = 1; // Sub-pixel rounding at fractional device-pixel-ratios is not overflow.
    const ANCESTORS_SHOWN = 3; // Enough to place an element without turning the line into a full DOM path.
    const viewportWidth = document.documentElement.clientWidth;
    const describe = (node) => {
      const id = node.id ? `#${node.id}` : '';
      const cls = node.classList.length ? `.${[...node.classList].join('.')}` : '';
      return `${node.tagName.toLowerCase()}${id}${cls}`;
    };
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.right <= viewportWidth + TOLERANCE_PX) continue;
      const style = getComputedStyle(el);
      // See the header: a parked or third-party-probe box, unless it is fixed — that one is the #4857 shape.
      if (['hidden', 'collapse'].includes(style.visibility) && style.position !== 'fixed') continue;
      let inScroller = false;
      // A fixed element's containing block is the viewport, so no ancestor scrolls or clips it (the #4857
      // footer bug shape); and the walk stops before body so a horizontally scrollable page can't exempt
      // everything on it.
      if (style.position !== 'fixed') {
        for (let a = el.parentElement; a && a !== document.body && !inScroller; a = a.parentElement) {
          inScroller = ['auto', 'scroll'].includes(getComputedStyle(a).overflowX);
        }
      }
      if (inScroller) continue;
      const ancestry = [];
      for (let a = el.parentElement; a && ancestry.length < ANCESTORS_SHOWN; a = a.parentElement) {
        ancestry.push(describe(a));
        if (a === document.body) break; // Everything is under html; naming it places nothing.
      }
      // An element with neither id nor class is unidentifiable from its tag alone, so those carry a text
      // sample too — that is the whole gap #5025 hit, where `span right=1284px` named no way to find it. Double
      // quotes become single so the sample can't close its own quoting mid-line.
      const bare = !el.id && !el.classList.length;
      const text = bare ? (el.textContent || '').trim().replace(/\s+/g, ' ').replace(/"/g, '\'').slice(0, 40) : '';
      offenders.push(`${describe(el)} right=${Math.round(rect.right)}px width=${Math.round(rect.width)}px` +
        `${ancestry.length ? ` in ${ancestry.join(' < ')}` : ''}${text ? ` text="${text}"` : ''}`);
    }
    return {
      viewportWidth,
      pageScrollWidth: document.scrollingElement.scrollWidth,
      offenders: offenders.slice(0, 10),
      offenderCount: offenders.length,
    };
  });
}

const test = base.test.extend({
  /**
   * Installs the Google Maps stub on every context before any page opens, and fails the test afterwards if a
   * request still reached a Google map host — the structural form of "CI makes zero billable Google calls"
   * (#5129): a new page or spec that instantiates a real map or panorama cannot merge.
   *
   * Two checks, each covering the other's blind spot: no request reached a known host (negative), and whatever
   * `google.maps` a page ended up with is the stub's (positive) — so a loader moved to a host or scheme the list
   * doesn't name, or a vendored copy of the API, fails here rather than passing silently.
   */
  googleMapsLeaks: [async ({context}, use) => {
    const leaks = [];
    await stubGoogleMaps(context, leaks);
    await use(leaks);
    base.expect(leaks, 'requests reached a Google Maps host — every map and panorama must come from the stub')
      .toEqual([]);
    for (const page of context.pages()) {
      if (page.isClosed()) continue;
      // A page mid-navigation or torn down since the check above has nothing left to inspect.
      const version = await page.evaluate(() => window.google?.maps?.version).catch(() => undefined);
      // Undefined: the page never asked for Maps (most don't).
      if (version === undefined) continue;
      base.expect(version, `${page.url()} loaded a google.maps that is not the stub`).toBe('stub');
    }
  }, {auto: true}],

  /**
   * Collects uncaught exceptions and non-allowlisted console errors for the test's page. Specs assert
   * `expect(consoleErrors).toEqual([])` at the end; an empty diff prints the offending messages verbatim.
   */
  consoleErrors: async ({page}, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const entry = `console.error: ${msg.text()} (${msg.location().url})`;
      if (CONSOLE_ERROR_ALLOWLIST.some((re) => re.test(entry))) return;
      errors.push(entry);
    });
    await use(errors);
  },
});

module.exports = {
  test,
  expect: base.expect,
  stubMapbox,
  stubGoogleMaps,
  serveAnyPano,
  stubMakeabilityLab,
  stubMapBaseLayers,
  waitForAppReady,
  loadAndSettle,
  horizontalOverflowReport,
  PHONE_DEVICE,
  STORAGE_STATE,
};
