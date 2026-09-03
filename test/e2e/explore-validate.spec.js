/**
 * Phase-2 smoke tests (issue #4504): /explore and /validate, the two pages built around the Street View
 * viewer, plus /mobile. They run against the local Google Maps stub (test/e2e/fixtures/google-maps-stub.js),
 * installed on every context by fixtures.js — so no key is needed, nothing reaches Google, and nothing is
 * billed (#5129). Locally: `make test-e2e args="-g 'explore|validate|mobile'"`.
 *
 * /explore: a fresh anonymous user always starts the audit TUTORIAL, deterministically, in every environment.
 * Its panos are custom (registerPanoProvider) and its tiles local assets, so the stub's panorama serves it the
 * way the real one does. CI seeds the one region it requires (test/e2e/fixtures/ci-seed.sql); with zero regions
 * /explore is a server error.
 *
 * /validate has two legitimate terminal states, both asserted error-free: a mission loads, or the "no new
 * mission" modal shows (a mission needs >= 10 validatable labels of one type). CI takes the mission branch, on
 * ci-seed.sql's seventeen CurbRamps. No GOOGLE_MAPS_SECRET is involved in getting there: the seeded panoramas are
 * expired, so the server-side imagery check never asks a provider — it answers from the backup images on disk
 * (install-media.sh). Which viewer then renders is the stub's call, and both of production's answers are covered:
 * by default the stub answers ZERO_RESULTS for a pano it has never seen, as Google does for an expired one, so the
 * page falls back to Pannellum and the committed backup; with `serveAnyPano` it resolves every id, as Google does
 * for a panorama our own metadata check has retired, and the primary viewer renders. A mission that renders no
 * panorama at all is the #4810 failure either way.
 *
 * /mobile is the same tool under a phone UA (the server redirects a desktop one to /), loaded in both
 * orientations with the layout viewport pinned to the device width (#4891).
 *
 * Both are landing-state checks: the page reaches its ready state and the console, no pano interaction.
 */
const {test, expect, stubMapbox, serveAnyPano, waitForAppReady, PHONE_DEVICE} = require('./fixtures');

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

test('/validate falls back to Pannellum and the backup image for an expired pano', async ({page, consoleErrors}) => {
  const onMission = await loadValidate(page, '/validate');
  expect(consoleErrors).toEqual([]);
  if (onMission) await expectPanoRendered(page, '/validate', 'pannellum');
});

test('/validate renders the primary viewer when the pano is still served', async ({page, context, consoleErrors}) => {
  await serveAnyPano(context);
  const onMission = await loadValidate(page, '/validate');
  expect(consoleErrors).toEqual([]);
  if (onMission) await expectPanoRendered(page, '/validate', 'gsv');
});

/**
 * Loads `/validate` or `/mobile` and settles it.
 * @param {import('@playwright/test').Page} page The test's page.
 * @param {string} path The page to load.
 * @returns {Promise<boolean>} True on the mission path, false on the no-mission modal.
 */
async function loadValidate(page, path) {
  const response = await page.goto(path);
  expect(response.status(), `${path} responded ${response.status()}`).toBeLessThan(400);
  await waitForAppReady(page);
  const onMission = await waitForValidateTerminalState(page);
  await page.waitForTimeout(1000);
  return onMission;
}

/**
 * Asserts that a mission's imagery rendered and that the expected viewer rendered it. #4810 drops a label whose
 * imagery won't load silently and by design, so an empty pano area would otherwise look like a healthy one; and
 * the stub decides which viewer can succeed (see the header), so the wrong one means the fallback chain took a
 * path it shouldn't have. Callers skip this on the no-mission modal, which has nothing to render.
 * @param {import('@playwright/test').Page} page The page under test, settled on the mission path.
 * @param {string} path The page's path, for the failure message.
 * @param {'gsv'|'pannellum'} viewerType The PanoViewer.viewerType expected to have rendered the pano.
 */
async function expectPanoRendered(page, path, viewerType) {
  const state = await page.evaluate(() => ({
    panoLoaded: window.svv?.panoManager?.getProperty('panoLoaded'),
    viewerType: window.svv?.panoViewer?.viewerType,
  }));
  expect(state.panoLoaded, `${path} assigned a mission but rendered no panorama`).toBe(true);
  expect(state.viewerType, `${path} rendered its panorama with the wrong viewer`).toBe(viewerType);
}

/**
 * Waits for Validate to settle into either of its two legitimate end states. Terminal state is
 * path-dependent: the mission path hides #page-loading (visibility, not display); the no-mission path un-hides the
 * modal holder instead — and may hide the overlay too, when a mission was assigned but every label's imagery failed
 * (#4810), so the modal is checked first. Callers let the console assertion judge whichever ran.
 * @param {import('@playwright/test').Page} page The page under test.
 * @returns {Promise<boolean>} True if it settled on the mission path, false on the no-mission modal.
 */
async function waitForValidateTerminalState(page) {
  const handle = await page.waitForFunction(() => {
    const loading = document.querySelector('#page-loading');
    const missionUiReady = loading && getComputedStyle(loading).visibility === 'hidden';
    const modal = document.querySelector('#modal-mission-holder');
    const noMissionShown = modal && !modal.classList.contains('ps-hidden');
    return noMissionShown ? 'no-mission' : (missionUiReady ? 'mission' : false);
  });
  return (await handle.jsonValue()) === 'mission';
}

test.describe('/mobile', () => {
  // The suite's one phone profile, so a change of reference phone moves /mobile and the viewport specs together.
  test.use(PHONE_DEVICE);

  /**
   * Loads /mobile at whatever viewport the enclosing describe set and asserts it reached a terminal state
   * cleanly at the device's own width — which is the whole of #4891: without the viewport meta the page lays
   * out at the browser's ~980px fallback in either orientation, and every size on it is chosen against that.
   * @param {import('@playwright/test').Page} page The page under test.
   * @param {string[]} consoleErrors The collected uncaught/console errors, asserted empty.
   * @param {number} expectedWidth The layout viewport width the page must report, in CSS px.
   */
  async function loadMobileValidate(page, consoleErrors, expectedWidth) {
    const onMission = await loadValidate(page, '/mobile');
    expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(expectedWidth);
    expect(consoleErrors).toEqual([]);
    // Same #4810 check the desktop test makes: /mobile shares LabelContainer#loadPanoForCurrentLabel and has no
    // separate guard, so without this an empty pano area passes in both orientations. Expired-pano path only: the
    // primary-viewer path doesn't differ by viewport, and the desktop test has it.
    if (onMission) await expectPanoRendered(page, '/mobile', 'pannellum');
  }

  test('loads in portrait without console errors', async ({page, consoleErrors}) => {
    await loadMobileValidate(page, consoleErrors, 390);
  });

  test.describe('held sideways', () => {
    test.use({viewport: {width: 844, height: 390}});

    test('loads in landscape without console errors', async ({page, consoleErrors}) => {
      await loadMobileValidate(page, consoleErrors, 844);
    });
  });
});
