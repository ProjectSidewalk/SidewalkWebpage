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
 * The label detail card gets its own block at the end, measured against itself: the page walk never opens the
 * modal, and its `overflow-y: auto` would exempt it from that walk anyway.
 *
 * Lives apart from explore-validate.spec.js on purpose: that file skips wholesale without a real Google Maps
 * key (absent on fork PRs), and nothing here needs one.
 */
const {test, expect, stubMapbox, waitForAppReady, loadAndSettle, horizontalOverflowReport, PHONE_DEVICE,
  STORAGE_STATE} = require('./fixtures');

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
// so it joins with its #4875 phase-2 conversion. Caveat: CI's seed is short content, so overflow driven by volume
// or by an unusually long username or story title is still only exercised against a full local DB.
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
  {path: '/v3/api-docs/rawLabels', mapbox: true},
];

test.describe('phone viewport (390px)', () => {
  test.use(PHONE_DEVICE);

  for (const p of PAGES) {
    test(`${p.path} fits without horizontal overflow`, async ({page, context, consoleErrors}) => {
      await checkPhoneViewport(page, context, consoleErrors, p);
    });
  }
});

// The card grids' minimums only bind below ~368px, so the 390px block above cannot see them (#4691) — the
// community pages' 320px track floor, and the Gallery's 280px card track in a 300px content box. The seed puts
// real cards behind /routes and /gallery, so those tracks are measured rather than an empty shell; /stories has no
// seeded rows, so it still renders the empty shell that fits at any width.
test.describe('narrow phone viewport (320px)', () => {
  test.use({...PHONE_DEVICE, viewport: {width: 320, height: 653}});

  const NARROW_PATHS = ['/routes', '/stories', '/gallery'];
  for (const p of PAGES.filter((page) => NARROW_PATHS.includes(page.path))) {
    test(`${p.path} fits without horizontal overflow`, async ({page, context, consoleErrors}) => {
      await checkPhoneViewport(page, context, consoleErrors, p);
    });
  }
});

// A long-but-real street address, written into the card below so the shrinkable cell is always measured at a
// width worth testing instead of at whatever this database's chosen label happens to carry.
const LONG_ADDRESS = '1234 Northwest Martin Luther King Jr Boulevard';

/**
 * Finds the label near the city center that these tests measure.
 *
 * @param {import('@playwright/test').Page} page - The test's page, used only for its request context.
 * @returns {Promise<Object|null>} The lowest-numbered label's GeoJSON feature, or null when the database has none
 *   near the city center.
 */
let cachedLabelFeature; // The feed fetch dominates these tests' runtime on a seeded dev DB; one fetch serves all.
async function findLabelFeature(page) {
  if (cachedLabelFeature !== undefined) return cachedLabelFeature;
  const {city_center: center} = await (await page.request.get('/cityMapParams')).json();
  const pad = 0.05;
  const bbox = [center.lng - pad, center.lat - pad, center.lng + pad, center.lat + pad].join(',');
  const feed = await (await page.request.get(`/labels/all?bbox=${bbox}`)).json();
  // Lowest label_id rather than whatever the feed lists first: the endpoint imposes no order, so features[0]
  // picked a different label per run, and the card's width follows the label (#5025).
  const features = feed.features ?? [];
  cachedLabelFeature = features.length
    ? features.reduce((lowest, f) => (f.properties.label_id < lowest.properties.label_id ? f : lowest))
    : null;
  return cachedLabelFeature;
}

/**
 * Opens a label's detail card by deep link and asserts it doesn't scroll sideways.
 *
 * Measured against the card rather than the viewport: horizontalOverflowReport exempts the descendants of a
 * horizontal scroller, and the card's `overflow-y: auto` computes `overflow-x` to `auto` on the same box. The
 * meta strip is measured too — it is the row that overflows first, its cells fixed-width but for the address.
 *
 * Skips when the database has no label to open near the city center.
 *
 * @param {import('@playwright/test').Page} page - The test's page, already at a phone viewport.
 * @param {Object} [opts] - Options.
 * @param {boolean} [opts.withoutAddress=false] - Measure with the address cell hidden: the state a label whose
 *   imagery is gone lands in, leaving no shrinkable cell to absorb a narrow card. Otherwise the cell is shown
 *   carrying LONG_ADDRESS.
 */
async function checkLabelCardFits(page, {withoutAddress = false} = {}) {
  // Slow from the first step: these load map + modal + pano late in a full run, when the shared browser is heaviest.
  test.slow();
  const feature = await findLabelFeature(page);
  test.skip(!feature, 'the connected database has no labels near the city center');
  // The page's own feed is stubbed to just this label: the card needs only its one marker, and rendering a
  // full-city feed can crash the 320px tab outright.
  await page.route('**/labels/all*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({type: 'FeatureCollection', features: [feature]}),
  }));
  await page.goto(`/labelMap?labelId=${feature.properties.label_id}`);
  await waitForAppReady(page);
  await expect(page.locator('#label-modal')).toBeVisible({timeout: 30_000});
  // Both cases author the address cell rather than accepting whatever the imagery resolved: whether an address
  // arrives at all, and how long it is, varies by label and by run, and the strip's width follows it. Authored
  // through the DOM rather than stubbed out of the metadata because the loaded imagery re-supplies an address
  // either way; these are the states #showAddress itself reaches.
  //
  // Authoring, re-fitting and measuring share one retry because #showAddress runs again when the pano resolves,
  // which is network-timed and can land between any two of those steps. Holding the state briefly and then
  // measuring outside the retry loses that race whenever the pano settles in the gap. Once it has run there is
  // nothing left to rewrite the cell, so the block converges rather than spinning.
  let fit;
  await expect(async () => {
    await page.evaluate(({hide, address}) => {
      const cell = document.querySelector('.label-detail__meta-cell--address');
      cell.hidden = hide;
      document.querySelector('.label-detail__meta-divider--address').hidden = hide;
      if (!hide) document.querySelector('.label-detail__address').textContent = address;
    }, {hide: withoutAddress, address: LONG_ADDRESS});

    // Those writes reach the DOM but not the fitter: #fitMetaRow runs from a ResizeObserver on the meta row, and
    // toggling that row's own children never changes its box. Unfitted, the strip keeps whatever trims the real
    // address left on it — the per-run variance this helper exists to pin. A 1px viewport round-trip is the
    // resize path production takes on rotation, and lands back on the width under test.
    const viewport = page.viewportSize();
    await page.setViewportSize({...viewport, width: viewport.width - 1});
    await page.setViewportSize(viewport);
    // ResizeObserver callbacks land before paint, so two frames covers the re-fit and its relayout.
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));

    fit = await page.evaluate(() => {
      const card = document.getElementById('label-modal');
      const row = card.querySelector('.label-detail__meta-row');
      return {
        cardScrollWidth: card.scrollWidth,
        cardClientWidth: card.clientWidth,
        rowScrollWidth: row.scrollWidth,
        rowClientWidth: row.clientWidth,
        rowClasses: row.className,
        addressHidden: card.querySelector('.label-detail__meta-cell--address').hidden,
        addressText: card.querySelector('.label-detail__address').textContent,
      };
    });

    expect(fit.addressHidden, `the address cell left the state under test: ${JSON.stringify(fit)}`)
      .toBe(withoutAddress);
    if (!withoutAddress) {
      expect(fit.addressText, `the authored address was overwritten: ${JSON.stringify(fit)}`).toBe(LONG_ADDRESS);
      // LONG_ADDRESS fits no phone-width strip, so the row it is measured on must be in the trimmed state. The
      // width assertions can't check that: the address cell ellipsizes any length on its own, fitted or not.
      expect(fit.rowClasses, `the meta strip was never re-fitted: ${JSON.stringify(fit)}`)
        .toContain('label-detail__meta-row--no-time');
    }
  }).toPass({timeout: 30_000});

  // Outside the retry: once the state above holds, a card that still scrolls sideways is a real overflow, not a
  // race, and re-measuring it until the timeout would only delay the report.
  expect(fit.cardScrollWidth, `the label card scrolls sideways: ${JSON.stringify(fit)}`)
    .toBeLessThanOrEqual(fit.cardClientWidth + 1);
  expect(fit.rowScrollWidth, `the meta strip overflows its row: ${JSON.stringify(fit)}`)
    .toBeLessThanOrEqual(fit.rowClientWidth + 1);
}

// The label detail card (#4572) is a modal over the map, so the page walk above never opens it. Three cases,
// because the strip runs out of room two ways: with an address it shrinks that cell and then wraps; without one
// there is nothing to shrink and the fixed facts have to be trimmed. Same seed caveat as the card grids — with
// no labels in the database there is nothing to open, and these skip.
test.describe('phone viewport (390px), label detail card', () => {
  test.use(PHONE_DEVICE);

  test('an open label card fits', async ({page, context}) => {
    await stubMapbox(context);
    await checkLabelCardFits(page);
  });

  // The reported case (#5021): the fixed facts needed 388px in a 317px strip, scrolling the whole card ~50px
  // sideways with its title, section headings and footer buttons clipped off the left edge.
  test('an open label card fits with no address to shrink', async ({page, context}) => {
    await stubMapbox(context);
    await checkLabelCardFits(page, {withoutAddress: true});
  });
});

test.describe('narrow phone viewport (320px), label detail card', () => {
  test.use({...PHONE_DEVICE, viewport: {width: 320, height: 653}});

  test('an open label card fits', async ({page, context}) => {
    await stubMapbox(context);
    await checkLabelCardFits(page);
  });
});

test.describe('phone viewport (390px), registered user', () => {
  test.use({...PHONE_DEVICE, storageState: STORAGE_STATE});

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
