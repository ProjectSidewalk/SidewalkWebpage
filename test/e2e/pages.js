/**
 * The anonymous-accessible pages the browser suite covers, and how each one loads.
 *
 * One table, read by every spec that walks the site: the runtime-error smoke tests (pages.spec.js) and the
 * accessibility gate (a11y.spec.js). Adding a page here therefore opts it into **both** — which is the point. A new
 * page is held to the standards the existing ones meet unless someone writes down a reason it can't be, rather than
 * silently escaping them by not appearing on a list.
 *
 * Entry fields are `loadAndSettle`'s (fixtures.js): `mapbox` / `makeabilityLab` install network stubs before
 * navigating, `loadingOverlay` waits for the shared #page-loading overlay to hide, and `waitFor` is an extra
 * page-specific readiness wait.
 *
 * Registered-user pages are not here — they need a session, so they live in dashboard.spec.js with its storageState.
 */
const PAGES = [
  // Deferred landing maps (#4486): wait until they're built so their init errors land inside the settle window.
  {path: '/', mapbox: true, waitFor: (page) => page.waitForFunction(() => window.choropleth && window.deploymentMap)},
  {path: '/signIn'},
  {path: '/signUp'},
  {path: '/forgotPassword'},
  {path: '/terms'},
  {path: '/serviceHoursInstructions'},
  // /about hydrates from the Makeability Lab API (stubbed for determinism) and lazy-builds a Mapbox map.
  {path: '/about', makeabilityLab: true, mapbox: true},
  {path: '/leaderboard'},
  {path: '/routes'},
  {path: '/stories'},
  {path: '/labelingGuide'},
  {path: '/labelingGuide/curbRamps'},
  {path: '/labelingGuide/surfaceProblems'},
  {path: '/labelingGuide/obstacles'},
  {path: '/labelingGuide/noSidewalk'},
  {path: '/labelingGuide/occlusion'},
  {path: '/api'},
  {path: '/v3/api-docs'},
  {path: '/v3/api-docs/labelTypes'},
  // Every api-docs page below that carries `mapbox` builds a live preview map (in its own Twirl view for
  // /cities, in public/js/api-docs/*Preview.js for the rest), so each needs the style/tile stub.
  {path: '/v3/api-docs/cities', mapbox: true},
  {path: '/v3/api-docs/labelTags'},
  {path: '/v3/api-docs/rawLabels', mapbox: true},
  {path: '/v3/api-docs/labelClusters', mapbox: true},
  {path: '/v3/api-docs/streets', mapbox: true},
  {path: '/v3/api-docs/streetTypes'},
  {path: '/v3/api-docs/regions', mapbox: true},
  {path: '/v3/api-docs/accessScoreStreets', mapbox: true},
  {path: '/v3/api-docs/accessScoreRegions', mapbox: true},
  {path: '/v3/api-docs/validations'},
  {path: '/v3/api-docs/validation-result-types'},
  {path: '/v3/api-docs/labelEdits'},
  {path: '/v3/api-docs/user-stats'},
  {path: '/v3/api-docs/overall-stats'},
  {path: '/v3/api-docs/overall-stats-by-day'},
  {path: '/v3/api-docs/aggregate-stats'},
  {path: '/v3/api-docs/aggregate-stats-by-day'},
  {path: '/gallery', loadingOverlay: true},
  {path: '/labelMap', mapbox: true, loadingOverlay: true},
  {path: '/routeBuilder', mapbox: true},
  {path: '/cities', mapbox: true},
  {path: '/mobileLanding'},
];

module.exports = {PAGES};
