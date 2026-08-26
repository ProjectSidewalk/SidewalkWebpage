/**
 * Phone-viewport regression checks (issue #4883; Phase 0 guardrails of the responsive-first direction in #4875).
 *
 * Each covered page is loaded at an iPhone-class 390×844 viewport with a mobile user agent and must (a) produce
 * no uncaught/console errors — the standard smoke assertion — and (b) show no horizontal overflow: no element's
 * border box past the right edge of the viewport (except inside a horizontal scroller — see
 * horizontalOverflowReport in fixtures.js for why layout is measured instead of scrollbars) and no page-level
 * scrollWidth beyond the viewport. The community pages repeat both checks at 320px, the narrowest phone width we
 * serve (Galaxy Fold cover display, older SE class), where their card grid's own minimum is what has to give.
 *
 * Coverage is the pages that are already responsive, so today's good state is locked in. As #4875's phases
 * convert the UA-redirected pages (the landing page, …), each conversion PR adds its page here — on a mobile
 * UA those pages currently redirect to /mobileLanding, so listing them today would only re-test it
 * (loadAndSettle's stayed-put URL assert catches a covered page joining that redirect set later).
 *
 * Lives apart from explore-validate.spec.js on purpose: that file skips wholesale without a real Google Maps
 * key (absent on fork PRs), and nothing here needs one.
 */
const {devices} = require('@playwright/test');
const {test, expect, loadAndSettle, horizontalOverflowReport, STORAGE_STATE} = require('./fixtures');

// devices['iPhone 13'] supplies the mobile UA, touch support and DPR. defaultBrowserType is dropped because the
// suite's chromium project already fixes the browser, and the viewport is widened to the full 390×844 screen.
const IPHONE = {...devices['iPhone 13'], viewport: {width: 390, height: 844}};
delete IPHONE.defaultBrowserType;

/**
 * Loads a page-table entry and runs the shared no-errors + no-horizontal-overflow assertions.
 *
 * @param {import('@playwright/test').Page} page - The test's page, already configured with the phone viewport.
 * @param {import('@playwright/test').BrowserContext} context - The page's context.
 * @param {string[]} consoleErrors - The consoleErrors fixture's collector for this page.
 * @param {object} p - The page table entry being checked (see loadAndSettle for the flags).
 */
async function checkPhoneViewport(page, context, consoleErrors, p) {
  await loadAndSettle(page, context, p);

  const report = await horizontalOverflowReport(page);
  expect(report.offenders, `${p.path}: ${report.offenderCount} element(s) overflow the ` +
    `${report.viewportWidth}px viewport`).toEqual([]);
  expect(report.pageScrollWidth, `${p.path}: page scrollWidth exceeds the ${report.viewportWidth}px viewport`)
    .toBeLessThanOrEqual(report.viewportWidth + 1);
  expect(consoleErrors).toEqual([]);
}

// mapbox / makeabilityLab / loadingOverlay flags as in pages.spec.js. Pages that UA-redirect mobile visitors
// are deliberately absent (see the header comment); /labelingGuide serves phones but is not yet responsive,
// so it joins with its #4875 phase-2 conversion. Caveat: against CI's near-empty seed the data-driven pages
// (/leaderboard, /routes, /stories, the rawLabels preview) render empty shells, so content-driven overflow
// (a long username, a story title) is only exercised by a local run against a seeded DB.
const PAGES = [
  {path: '/mobileLanding'},
  {path: '/signIn'},
  {path: '/signUp'},
  {path: '/about', makeabilityLab: true, mapbox: true},
  {path: '/leaderboard'},
  {path: '/routes'},
  {path: '/stories'},
  {path: '/cities', mapbox: true},
  {path: '/labelMap', mapbox: true, loadingOverlay: true},
  {path: '/gallery', loadingOverlay: true},
  {path: '/api'},
  {path: '/v3/api-docs/rawLabels'},
];

test.describe('phone viewport (390px)', () => {
  test.use(IPHONE);

  for (const p of PAGES) {
    test(`${p.path} fits without horizontal overflow`, async ({page, context, consoleErrors}) => {
      await checkPhoneViewport(page, context, consoleErrors, p);
    });
  }
});

// The card grids' minimums only bind below ~368px, so the 390px block above cannot see them (#4691) — the
// community pages' 320px track floor, and the Gallery's 280px card track in a 300px content box. Same seed caveat,
// and it bites harder: with nothing in CI's DB these load the empty shell, which fits at any width — the
// cards are exercised by a local run against a seeded DB.
test.describe('narrow phone viewport (320px)', () => {
  test.use({...IPHONE, viewport: {width: 320, height: 653}});

  const NARROW_PATHS = ['/routes', '/stories', '/gallery'];
  for (const p of PAGES.filter((page) => NARROW_PATHS.includes(page.path))) {
    test(`${p.path} fits without horizontal overflow`, async ({page, context, consoleErrors}) => {
      await checkPhoneViewport(page, context, consoleErrors, p);
    });
  }
});

test.describe('phone viewport (390px), registered user', () => {
  test.use({...IPHONE, storageState: STORAGE_STATE});

  test('/dashboard fits without horizontal overflow', async ({page, context, consoleErrors}) => {
    await checkPhoneViewport(page, context, consoleErrors, {path: '/dashboard', mapbox: true});
  });

  // The drawer is parked off-canvas at this width, so the walk above never sees the layout the breakpoint
  // actually authors: a full-bleed panel over the map. Opening it is the only way to measure that, and it
  // doubles as proof the reopen control is wired — it is built at map-ready, well before the label feed lands.
  test('/dashboard fits with the filter drawer open', async ({page, context, consoleErrors}) => {
    await loadAndSettle(page, context, {path: '/dashboard', mapbox: true});

    await page.locator('#filter-sidebar-open').click();
    await expect(page.locator('#filter-sidebar')).toBeVisible();

    const report = await horizontalOverflowReport(page);
    expect(report.offenders, `open filter drawer: ${report.offenderCount} element(s) overflow the ` +
      `${report.viewportWidth}px viewport`).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
