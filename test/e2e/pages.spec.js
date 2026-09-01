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
const {test, expect, loadAndSettle} = require('./fixtures');

// mapbox: page builds a Mapbox map at init — stub it (see fixtures.js) so a dummy CI key can't hang init.
// loadingOverlay: page uses the shared #page-loading overlay — wait for it to hide before the error check.
const PAGES = [
  // Deferred landing maps (#4486): wait until they're built so their init errors land inside the settle window.
  {path: '/', mapbox: true, waitFor: (page) => page.waitForFunction(() => window.choropleth && window.deploymentMap)},
  {path: '/signIn'},
  {path: '/signUp'},
  // /about hydrates from the Makeability Lab API (stubbed for determinism) and lazy-builds a Mapbox map.
  {path: '/about', makeabilityLab: true, mapbox: true},
  {path: '/leaderboard'},
  {path: '/routes'},
  {path: '/stories'},
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
    await loadAndSettle(page, context, p);
    expect(consoleErrors).toEqual([]);
  });
}
