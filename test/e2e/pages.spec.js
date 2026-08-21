/**
 * Phase-1 smoke tests (issue #4504): load each core anonymous-accessible page and fail on any uncaught
 * page error or non-allowlisted console error. Catches load-time breakage (stale bundles, missing globals,
 * broken init) that compile and lint can't see.
 *
 * No explicit sign-in: most of these pages render sessionless (#4643), and a top-level navigation to one
 * behind a SecuredAction 303s through /anonSignUp (which mints an anonymous session) and back — per-test
 * browser contexts persist that cookie. So a page here may load with or without a session, and anything it
 * fetches at init has to tolerate both.
 * Registered-user pages live in dashboard.spec.js; /explore and /validate (which need working street-view
 * imagery) are phase 2 — see explore-validate.spec.js.
 */
const {test, expect, stubMapbox, waitForAppReady} = require('./fixtures');

// mapbox: page builds a Mapbox map at init — stub it (see fixtures.js) so a dummy CI key can't hang init.
// loadingOverlay: page uses the shared #page-loading overlay — wait for it to hide before the error check.
const PAGES = [
  {path: '/', mapbox: true},
  {path: '/signIn'},
  {path: '/signUp'},
  {path: '/leaderboard'},
  {path: '/routes'},
  {path: '/stories'},
  {path: '/help'},
  {path: '/labelingGuide'},
  {path: '/api'},
  {path: '/v3/api-docs/rawLabels'},
  {path: '/v3/api-docs/streets'},
  {path: '/gallery', loadingOverlay: true},
  {path: '/labelMap', mapbox: true, loadingOverlay: true},
  {path: '/routeBuilder', mapbox: true},
  {path: '/cities', mapbox: true},
  {path: '/mobileLanding'},
];

for (const p of PAGES) {
  test(`${p.path} loads without console errors`, async ({page, context, consoleErrors}) => {
    if (p.mapbox) await stubMapbox(context);
    const response = await page.goto(p.path);
    expect(response.status(), `${p.path} responded ${response.status()}`).toBeLessThan(400);
    await waitForAppReady(page);
    // The landing page defers its maps and validation grid behind util.onFirstInteractionOrIdle (#4486). Headless
    // Chromium generates no input events, so without a nudge they'd only start on the 5s fallback — after the settle
    // window below, silently costing this spec its coverage of map init rather than failing it.
    await page.mouse.move(10, 10);
    if (p.path === '/') await page.waitForFunction(() => window.choropleth && window.deploymentMap);
    if (p.loadingOverlay) await page.locator('#page-loading').waitFor({state: 'hidden'});
    // Settle window: init errors from late async work (post-ready fetches, map callbacks) land here.
    await page.waitForTimeout(1000);
    expect(consoleErrors).toEqual([]);
  });
}
