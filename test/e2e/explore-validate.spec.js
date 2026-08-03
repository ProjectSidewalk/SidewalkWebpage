/**
 * Phase-2 seam (issue #4504): smoke tests for the two pages that need working Google Street View imagery
 * to initialize. With CI's dummy GOOGLE_MAPS_API_KEY the pano load times out (GsvViewer's 10s timeout) and
 * Explore's PanoManager reloads the page in a loop — so these specs only run when CI injects the real
 * referrer/API-restricted key (GOOGLE_MAPS_API_KEY_TEST secret → HAS_REAL_GMAPS_KEY=true; the secret is
 * absent on fork PRs, where everything here self-skips).
 *
 * Phase-2 prerequisites beyond the key: a committed label/street seed for the CI schema — /validate's
 * bootstrap indexes param.labelList[0] (public/js/validate/src/Main.js) and an empty city has nothing to
 * validate; /explore on an empty city takes the no-task branch (apps/explore.scala.html) instead of
 * initializing the tool.
 */
const {test} = require('./fixtures');

test.skip(
  process.env.HAS_REAL_GMAPS_KEY !== 'true',
  'Needs the restricted Google Maps key (GOOGLE_MAPS_API_KEY_TEST secret; absent locally and on fork PRs)',
);

// Readiness: '.tool-ui:not(.ps-invisible)' (init done) or the no-task overlay on an empty city.
test.fixme('/explore loads without console errors', async () => {});

// Readiness: '#page-loading' hidden. Requires seeded labels (see header).
test.fixme('/validate loads without console errors', async () => {});
