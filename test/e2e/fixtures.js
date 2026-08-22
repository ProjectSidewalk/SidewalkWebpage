/**
 * Shared fixtures and helpers for the browser smoke suite (issue #4504).
 *
 * The suite's primary assertion is "no uncaught errors": every spec collects `pageerror` events and
 * non-allowlisted `console.error` output via the `consoleErrors` fixture and asserts the list is empty
 * after the page settles.
 */
const base = require('@playwright/test');

// Where auth.setup.js saves the registered user's session for the specs that need one (dashboard.spec.js).
const STORAGE_STATE = 'test-results/.auth/registered.json';

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
  // The rawLabels/streets api-docs live previews pick a demo region via /v3/api/regionWithMostLabels. CI's
  // database is the bare sidewalk_init template — no labels, so there is nothing to pick and the endpoint 404s.
  // Three messages come out of that one 404: Chromium's own "Failed to load resource" line (matched by the URL)
  // and the preview's two handled errors (matched by their shared phrase). The page still initializes, and
  // against any seeded database — local dev included — none of them fire. Drop both entries when phase 2 seeds
  // CI label data, at which point a 404 here would mean something real.
  /regionWithMostLabels/,
  /region with most labels/,
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
 * Measures horizontal overflow at the current viewport width (issue #4883): every element whose border box
 * extends past the right edge of the layout viewport, except content inside an `overflow-x: auto|scroll`
 * ancestor — a horizontal scroller is the sanctioned way to present wide content (tables, code) on a phone.
 *
 * Measuring layout (bounding boxes) rather than scrollbars is the point: `body {overflow-x: clip}` in
 * main.css means an overflowing page never shows a scrollbar, and a `position: fixed` element sized off the
 * overflowed initial containing block (the #4857 footer bug) never widens `scrollWidth` at all. The page-level
 * `scrollWidth` is still reported as a second, cheaper signal.
 *
 * @param {import('@playwright/test').Page} page - The page to measure, already loaded and settled.
 * @returns {Promise<{viewportWidth: number, pageScrollWidth: number, offenders: string[], offenderCount: number}>}
 *   Offenders are CSS-selector-ish descriptions (`div#gallery.sidebar right=612px`), capped at 10; offenderCount
 *   is the uncapped total.
 */
async function horizontalOverflowReport(page) {
  return page.evaluate(() => {
    const TOLERANCE_PX = 1; // Sub-pixel rounding at fractional device-pixel-ratios is not overflow.
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.right <= viewportWidth + TOLERANCE_PX) continue;
      let inScroller = false;
      for (let a = el.parentElement; a && !inScroller; a = a.parentElement) {
        inScroller = ['auto', 'scroll'].includes(getComputedStyle(a).overflowX);
      }
      if (inScroller) continue;
      const id = el.id ? `#${el.id}` : '';
      const cls = el.classList.length ? `.${[...el.classList].join('.')}` : '';
      offenders.push(`${el.tagName.toLowerCase()}${id}${cls} right=${Math.round(rect.right)}px`);
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

module.exports = {test, expect: base.expect, stubMapbox, waitForAppReady, horizontalOverflowReport, STORAGE_STATE};
