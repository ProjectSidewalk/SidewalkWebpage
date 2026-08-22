/**
 * Phone-viewport regression checks (issue #4883; Phase 0 guardrails of the responsive-first direction in #4875).
 *
 * Each covered page is loaded at an iPhone-class 390×844 viewport with a mobile user agent and must (a) produce
 * no uncaught/console errors — the standard smoke assertion — and (b) show no horizontal overflow: no element's
 * border box past the right edge of the viewport (except inside a horizontal scroller — see
 * horizontalOverflowReport in fixtures.js for why layout is measured instead of scrollbars) and no page-level
 * scrollWidth beyond the viewport.
 *
 * Coverage is the pages that are already responsive, so today's good state is locked in. As #4875's phases
 * convert the UA-redirected pages (/gallery, /labelMap, landing, …), each conversion PR adds its page here —
 * on a mobile UA those pages currently redirect to /mobileLanding, so listing them today would only re-test it.
 *
 * Lives apart from explore-validate.spec.js on purpose: that file skips wholesale without a real Google Maps
 * key (absent on fork PRs), and nothing here needs one.
 */
const {devices} = require('@playwright/test');
const {test, expect, stubMapbox, waitForAppReady, horizontalOverflowReport, STORAGE_STATE} = require('./fixtures');

// devices['iPhone 13'] supplies the mobile UA, touch support and DPR. defaultBrowserType is dropped because the
// suite's chromium project already fixes the browser, and the viewport is widened to the full 390×844 screen.
const IPHONE = {...devices['iPhone 13'], viewport: {width: 390, height: 844}};
delete IPHONE.defaultBrowserType;

/**
 * Loads a page, waits for it to settle, and runs the shared no-errors + no-horizontal-overflow assertions.
 *
 * @param {import('@playwright/test').Page} page - The test's page, already configured with the phone viewport.
 * @param {string[]} consoleErrors - The consoleErrors fixture's collector for this page.
 * @param {{path: string, loadingOverlay?: boolean}} p - The page table entry being checked.
 */
async function checkPhoneViewport(page, consoleErrors, p) {
  const response = await page.goto(p.path);
  expect(response.status(), `${p.path} responded ${response.status()}`).toBeLessThan(400);
  await waitForAppReady(page);
  if (p.loadingOverlay) await page.locator('#page-loading').waitFor({state: 'hidden'});
  // Settle window, matching pages.spec.js: late async work (post-ready fetches, image/map callbacks) lands here.
  await page.waitForTimeout(1000);

  const report = await horizontalOverflowReport(page);
  expect(report.offenders, `${p.path}: ${report.offenderCount} element(s) overflow the ` +
    `${report.viewportWidth}px viewport`).toEqual([]);
  expect(report.pageScrollWidth, `${p.path}: page scrollWidth exceeds the ${report.viewportWidth}px viewport`)
    .toBeLessThanOrEqual(report.viewportWidth + 1);
  expect(consoleErrors).toEqual([]);
}

test.describe('phone viewport (390px)', () => {
  test.use(IPHONE);

  // mapbox / loadingOverlay flags as in pages.spec.js. Pages that UA-redirect mobile visitors are deliberately
  // absent (see the header comment); /labelingGuide serves phones but is not yet responsive, so it joins with
  // its #4875 phase-2 conversion.
  const PAGES = [
    {path: '/mobileLanding'},
    {path: '/signIn'},
    {path: '/signUp'},
    {path: '/about'},
    {path: '/leaderboard'},
    {path: '/routes'},
    {path: '/stories'},
    {path: '/cities', mapbox: true},
    {path: '/api'},
    {path: '/v3/api-docs/rawLabels'},
  ];

  for (const p of PAGES) {
    test(`${p.path} fits without horizontal overflow`, async ({page, context, consoleErrors}) => {
      if (p.mapbox) await stubMapbox(context);
      await checkPhoneViewport(page, consoleErrors, p);
    });
  }
});

test.describe('phone viewport (390px), registered user', () => {
  test.use({...IPHONE, storageState: STORAGE_STATE});

  test('/dashboard fits without horizontal overflow', async ({page, context, consoleErrors}) => {
    await stubMapbox(context); // The contribution choropleth is a Mapbox map.
    await checkPhoneViewport(page, consoleErrors, {path: '/dashboard'});
    // A bounced anonymous/expired session would land on /signIn with a clean console — assert we stayed put.
    expect(page.url()).toContain('/dashboard');
  });
});
