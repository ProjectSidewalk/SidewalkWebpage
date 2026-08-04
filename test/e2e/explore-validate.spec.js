/**
 * Phase-2 smoke tests (issue #4504): /explore and /validate, the two pages built around the Street View
 * viewer. They run only when a real referrer/API-restricted Google Maps key is configured
 * (GOOGLE_MAPS_API_KEY_TEST secret → HAS_REAL_GMAPS_KEY=true in ci.yml): with a dummy key
 * google.maps.importLibrary fails and Explore's PanoManager reloads the page in a loop, so nothing
 * meaningful can be asserted. The secret is withheld on fork PRs, where everything here self-skips.
 * Run locally against the dev app (which serves its own real key) with:
 *   HAS_REAL_GMAPS_KEY=true make test-e2e args="-g 'explore|validate'"
 *
 * /explore: a fresh anonymous user always starts the audit TUTORIAL, deterministically, in every
 * environment. Tutorial panorama tiles are local assets (/assets/images/pano-tutorial/), so no live GSV
 * imagery is fetched — the key is needed only to load the Maps JS API itself. CI seeds the one region this
 * requires (test/e2e/fixtures/ci-seed.sql); with zero regions /explore is a server error.
 *
 * /validate has two legitimate terminal states, both asserted error-free: a mission loads (any seeded DB,
 * local dev included), or the "no new mission" modal shows (CI's empty city — the server only wires up a
 * mission when >= 10 validatable labels of one type exist). Making CI exercise the mission path needs a
 * label seed with live or backed-up panos plus a real GOOGLE_MAPS_SECRET for the metadata check — tracked
 * as a later phase in test/e2e/README.md.
 */
const {test, expect, stubMapbox, waitForAppReady} = require('./fixtures');

test.skip(
  process.env.HAS_REAL_GMAPS_KEY !== 'true',
  'Needs a real Google Maps key (GOOGLE_MAPS_API_KEY_TEST secret; set HAS_REAL_GMAPS_KEY=true locally)',
);

test('/explore loads the tutorial without console errors', async ({page, context, consoleErrors}) => {
  // Explore's mission-complete map is Mapbox, built at init — stubbed like every other map page.
  await stubMapbox(context);
  // Explore reacts to pano-viewer creation failure by navigating back to /explore, which fails the same
  // way — an unbounded reload loop that would otherwise just burn the whole test timeout. Counting full
  // document loads makes that failure mode fast and self-describing.
  let reloads = -1; // The initial goto's own load event brings this to 0.
  page.on('load', () => reloads++);

  const response = await page.goto('/explore');
  expect(response.status(), `/explore responded ${response.status()}`).toBeLessThan(400);
  await waitForAppReady(page);
  // The loading overlay disappearing is the true success signal: the no-task branch also reveals
  // .tool-ui but leaves #page-loading up.
  await page.locator('#page-loading').waitFor({state: 'hidden'});
  await page.waitForTimeout(1000);
  expect(reloads, 'page reloaded — pano viewer creation failed at the starting location').toBe(0);
  expect(consoleErrors).toEqual([]);
});

test('/validate reaches a mission or the no-mission modal without console errors', async ({page, consoleErrors}) => {
  const response = await page.goto('/validate');
  expect(response.status(), `/validate responded ${response.status()}`).toBeLessThan(400);
  await waitForAppReady(page);
  // Terminal state is path-dependent: the mission path hides #page-loading (visibility, not display);
  // the no-mission path leaves it up and un-hides the modal holder instead. Wait for either, then let
  // the console assertion judge whichever ran.
  await page.waitForFunction(() => {
    const loading = document.querySelector('#page-loading');
    const missionUiReady = loading && getComputedStyle(loading).visibility === 'hidden';
    const modal = document.querySelector('#modal-mission-holder');
    const noMissionShown = modal && !modal.classList.contains('ps-hidden');
    return missionUiReady || noMissionShown;
  });
  await page.waitForTimeout(1000);
  expect(consoleErrors).toEqual([]);
});
