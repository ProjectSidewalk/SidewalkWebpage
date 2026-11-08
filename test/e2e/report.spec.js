/**
 * Behavior tests for the neighborhood report (/report/neighborhood/<slug>, #5876, with the worst-problems map of #5889
 * and the per-map "Places" switch and community stories of #5900). pages.spec.js covers the bare load; this checks
 * what the page does: its maps come up, each map's "Places" switch is its own, the worst map's key agrees with its
 * dots, a weight slider reopens the report under the new weights, a street's map and cards light each other, and the
 * stories section appears only where the region has stories.
 *
 * Nothing here is stubbed: the report's maps run on the city's own tile archive and glyphs, so no Mapbox or Google
 * request is ever made, and the specs read the page's own embedded `#report-data` JSON to learn what the server put
 * on it. The region under test is discovered from `/v3/api/regions` rather than hardcoded, so the same spec runs
 * against a dev database holding any city and against CI's one-region seed, skipping (with a reason) whatever that
 * seed does not carry. CI's seed has no label clusters, places or stories, so there the worst-problems key, the street
 * cards, the fixes, the places half of the map test and the score-change check all skip; what CI holds the page to is
 * its load, its maps and the weights round trip. The `googleMapsLeaks` fixture fails any test whose page asks Google.
 */
const {test, expect, waitForAppReady} = require('./fixtures');

/** The report address, found once per worker: the region with the most labels, by id (the server redirects to its slug). */
let reportPath = null;

/**
 * Picks the region whose report has the most to show. The id address is used so the spec never needs to know how the
 * server slugs a name; the 302 lands on the slug, which the load helper asserts.
 * @param {import('@playwright/test').APIRequestContext} request - The test's API context.
 * @returns {Promise<?string>} The report path, or null if the city has no region.
 */
async function discoverReportPath(request) {
  if (reportPath !== null) return reportPath;
  const response = await request.get('/v3/api/regions');
  expect(response.ok(), `/v3/api/regions responded ${response.status()}`).toBe(true);
  const {features} = await response.json();
  if (!features.length) return null;
  const [best] = [...features].sort((a, b) => b.properties.label_count - a.properties.label_count);
  reportPath = `/report/neighborhood/${best.properties.region_id}`;
  return reportPath;
}

/**
 * Loads the report and reads what the server drew it from.
 *
 * A city whose AccessScores are being computed for the first time since a deploy answers 503 with a Retry-After, after
 * holding the request up to 45 s; two short retries cover it, so the test gets triple the usual time.
 * @param {import('@playwright/test').Page} page - The test's page.
 * @param {import('@playwright/test').APIRequestContext} request - The test's API context, for region discovery.
 * @param {string} [query=''] - A query string to open the report with, `?w=…` for custom weights.
 * @returns {Promise<{data: Record<string, any>}>} The page's `#report-data` JSON.
 */
async function openReport(page, request, query = '') {
  test.slow();
  const path = await discoverReportPath(request);
  test.skip(path === null, 'this database has no region to report on');
  let response = await page.goto(path + query);
  for (let attempt = 0; attempt < 2 && response.status() === 503; attempt++) {
    await page.waitForTimeout(10_000);
    response = await page.goto(path + query);
  }
  expect(response.status(), `${path} responded ${response.status()}`).toBeLessThan(400);
  // The id redirects to the slug, never digits alone. A slug keeps any letter (ReportSlug.of), so a Taipei or Kyiv one
  // arrives percent-encoded; only the path separators are ruled out.
  expect(page.url()).toMatch(/\/report\/neighborhood\/(?!\d+(?:[?#]|$))[^/?#]+(?:[?#]|$)/);
  await waitForAppReady(page);
  const data = await readReportData(page);
  // CI's seed has streets, so the map and weights tests must not quietly skip there.
  if (process.env.CI) expect(data.streets.length, 'CI\'s seed region reported no streets').toBeGreaterThan(0);
  return {data};
}

/**
 * @param {import('@playwright/test').Page} page - A loaded report.
 * @returns {Promise<Record<string, any>>} The page's `#report-data` JSON, as report.js reads it.
 */
function readReportData(page) {
  return page.evaluate(() => JSON.parse(document.getElementById('report-data').textContent));
}

/**
 * Brings a map host into view and waits for MapLibre's canvas: the maps are built only as they near the viewport
 * (ReportPage watches them with an IntersectionObserver), and a street section's map only while it is near.
 * @param {import('@playwright/test').Locator} host - The `.report-map` element.
 * @returns {Promise<void>}
 */
async function expectLiveMap(host) {
  await host.scrollIntoViewIfNeeded();
  const canvas = host.locator('canvas.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);
  const box = await canvas.boundingBox();
  expect(box.width, 'the map canvas has no width').toBeGreaterThan(0);
  expect(box.height, 'the map canvas has no height').toBeGreaterThan(0);
}

/**
 * @param {import('@playwright/test').Locator} element - An element whose text carries one formatted count.
 * @returns {Promise<number>} The count, read past the locale's grouping separators.
 */
async function countIn(element) {
  const text = await element.textContent();
  return Number(text.replace(/[^\d]/g, ''));
}

test.describe('/report/neighborhood', () => {
  // The contents column gives way at `width <= 1280px` (report.css), and Desktop Chrome's viewport is exactly 1280 wide.
  test.use({viewport: {width: 1440, height: 900}});

  test('loads clean, its contents link to real sections, and its columns are sticky', async ({page, request, consoleErrors}) => {
    await openReport(page, request);
    // Settle window for late async work: the config fetch that reveals the weights, the first maps.
    await page.waitForTimeout(1000);

    // Every contents link targets an element on the page.
    const missing = await page.evaluate(() => [...document.querySelectorAll('#report-toc a[href^="#"]')]
      .map((a) => a.getAttribute('href').slice(1))
      .filter((id) => !document.getElementById(id)));
    expect(missing, 'contents links whose target id is not on the page').toEqual([]);
    expect(await page.locator('#report-toc a[href^="#"]').count()).toBeGreaterThan(0);

    // The controls on the left and the contents on the right ride along with the reader.
    for (const id of ['report-sidebar', 'report-toc']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
      expect(await page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).position), `#${id}`).toBe('sticky');
    }
    // report.js reveals the sidebar's JavaScript-only pieces once it has run.
    await expect(page.locator('#report-map-controls')).toBeVisible();
    await expect(page.locator('#report-actions')).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('each live map draws a MapLibre canvas, and the Places switch hides only its own map\'s places',
    async ({page, request, consoleErrors}) => {
      const {data} = await openReport(page, request);
      // The region map comes with its ranked streets, the worst map with its worst locations.
      test.skip(data.streets.length === 0 && data.worst.length === 0, 'the region has nothing to map');

      const maps = [];
      if (await page.locator('#report-region-map').count()) maps.push(page.locator('#report-region-map'));
      if (data.worst.length) maps.push(page.locator('#report-worst-map'));
      if (data.streets.length) maps.push(page.locator(`.report-street[data-street="${data.streets[0].id}"] [data-street-map]`));
      expect(maps.length, 'a region with streets has at least one map').toBeGreaterThan(0);
      for (const host of maps) await expectLiveMap(host);
      expect(consoleErrors).toEqual([]);

      test.skip(data.places.length === 0, 'the region has no important places, so no map carries the switch');
      // Every live map got every place and its own switch (#5900).
      for (const host of maps) {
        await expect(host.locator('.report-map-toggle__input')).toBeChecked();
        await expect(host.locator('button.report-map-place')).toHaveCount(data.places.length);
        await expect(host.locator('button.report-map-place[hidden]')).toHaveCount(0);
      }
      test.skip(maps.length < 2, 'one map only: nothing to show the switch is per map');

      const [first, second] = maps;
      await first.locator('.report-map-toggle__input').uncheck();
      await expect(first.locator('button.report-map-place[hidden]')).toHaveCount(data.places.length);
      // Unchecking scrolled the first map into view, which can unmount a street section's map further down; bring the
      // second back so its toggle exists before asserting on it.
      await expectLiveMap(second);
      // The other map's places stay, so a reader's choice on one map is not made for them on the rest.
      await expect(second.locator('button.report-map-place[hidden]')).toHaveCount(0);
      await expect(second.locator('.report-map-toggle__input')).toBeChecked();

      await expectLiveMap(first);
      await first.locator('.report-map-toggle__input').check();
      await expect(first.locator('button.report-map-place[hidden]')).toHaveCount(0);
      expect(consoleErrors).toEqual([]);
    });

  test('the worst-problems key counts what the map dots, and a key row lights up', async ({page, request}) => {
    const {data} = await openReport(page, request);
    test.skip(data.worst.length === 0, 'the region has no location rated worst, so the section is an empty note');

    const rows = page.locator('.report-worst__type');
    const byType = new Map();
    for (const dot of data.worst) byType.set(dot.labelType, (byType.get(dot.labelType) ?? 0) + 1);
    await expect(rows).toHaveCount(byType.size);
    for (const row of await rows.all()) {
      const labelType = await row.getAttribute('data-label-type');
      expect(byType.has(labelType), `key row for ${labelType} has no dots`).toBe(true);
      expect(await countIn(row.locator('.report-worst__count')), labelType).toBe(byType.get(labelType));
      // The count links to the labels, and the bar is a share of the biggest type's count.
      await expect(row.locator('.report-worst__count')).toHaveAttribute('href', /^\/gallery\?/);
      expect(Number(await row.locator('.report-worst__bar').getAttribute('data-share'))).toBeGreaterThan(0);
    }
    expect(await countIn(page.locator('#report-worst-key-title'))).toBe(data.worst.length);

    // A key row under the pointer is lit (its dots on the map fade the rest; the row is the DOM-visible half).
    await rows.first().scrollIntoViewIfNeeded();
    await rows.first().dispatchEvent('mouseenter');
    await expect(rows.first()).toHaveClass(/is-highlighted/);
    await rows.first().dispatchEvent('mouseleave');
    await expect(rows.first()).not.toHaveClass(/is-highlighted/);
  });

  test('letting go of a weight slider reopens the report under those weights, scored on the server',
    async ({page, request}) => {
      const {data} = await openReport(page, request);
      expect(data.weights.custom).toBe(false);
      await expect(page.locator('#report-custom-stamp')).toHaveCount(0);

      // The panel needs the engine config, so report.js reveals it; it starts folded, with every scored type's slider.
      await expect(page.locator('#report-weights-control')).toBeVisible();
      const fold = page.locator('#acs-weights-toggle');
      await expect(fold).toHaveAttribute('aria-expanded', 'false');
      await fold.click();
      await expect(fold).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#acs-weights input[type="range"]')).not.toHaveCount(0);
      const slider = page.locator('#acs-weight-CurbRamp');
      await expect(slider).toBeVisible();

      // The report never scores in the browser: the tool's street feed is never asked for, before or after.
      const scoreFeedRequests = [];
      page.on('request', (r) => {
        if (r.url().includes('/v3/api/accessScoreStreets')) scoreFeedRequests.push(r.url());
      });
      // fill() fires the range's input and change itself; another change would reopen the report a second time.
      await slider.fill('0');
      await page.waitForURL(/[?&]w=[^&]*CurbRamp:0/);
      await waitForAppReady(page);
      const after = await readReportData(page);
      expect(after.weights.custom).toBe(true);
      expect(after.weights.types.CurbRamp).toBe(0);
      expect(scoreFeedRequests).toEqual([]);

      // The page says the numbers are not the engine's, opens the panel on the weights in force, and offers the way back.
      const stamp = page.locator('#report-custom-stamp');
      await expect(stamp).toBeVisible();
      await expect(page.locator('#acs-weights-toggle')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#acs-weight-CurbRamp')).toHaveValue('0');
      const plain = new URL(page.url()).pathname;
      await expect(page.locator('#report-custom-reset')).toHaveAttribute('href', plain);

      // Where curb ramps weigh on the scores, taking their weight off moves at least one street's score.
      if ((data.contributions?.CurbRamp ?? 0) !== 0) {
        const before = new Map(data.edges.map((e) => [e.id, e.score]));
        expect(after.edges.some((e) => e.score !== before.get(e.id)), 'no street score changed').toBe(true);
      }

      await page.locator('#report-custom-reset').click();
      await page.waitForURL((url) => !url.searchParams.has('w'));
      await waitForAppReady(page);
      await expect(page.locator('#report-custom-stamp')).toHaveCount(0);
      expect((await readReportData(page)).weights.custom).toBe(false);
    });

  test('a street\'s cards and its map markers light each other', async ({page, request}) => {
    const {data} = await openReport(page, request);
    test.skip(data.streets.length === 0, 'the region has no ranked street, so there is no street section');
    const [street] = data.streets;
    const section = page.locator(`.report-street[data-street="${street.id}"]`);
    await expect(section).toHaveCount(1);
    await expectLiveMap(section.locator('[data-street-map]'));
    test.skip(street.cards.length === 0, 'the first street has no location to card');

    // The cards arrive as the section nears the viewport, from Gallery's own endpoint; one marker per shown card.
    const cards = section.locator('.report-card:not([hidden])');
    await expect(cards.first()).toBeVisible();
    await expect(section.locator('.report-map-marker')).toHaveCount(street.cards.length);
    // Gallery drops a label whose imagery it can't confirm, so a card may be missing, never one the street lacks.
    const clusterIds = new Set(street.cards.map((c) => String(c.clusterId)));
    const rendered = await cards.evaluateAll((els) => els.map((el) => el.dataset.clusterId));
    expect(rendered.length).toBeLessThanOrEqual(Math.min(street.cards.length, 12));
    expect(rendered.filter((id) => !clusterIds.has(id)), 'cards for locations the street lacks').toEqual([]);

    const card = cards.first();
    const clusterId = await card.getAttribute('data-cluster-id');
    const marker = section.locator(`.report-map-marker[data-cluster-id="${clusterId}"]`);
    await expect(marker).toHaveCount(1);
    // The card's own strip names the label city-qualified (#5876), since label ids repeat across cities.
    const labelId = street.cards.find((c) => String(c.clusterId) === clusterId).labelId;
    const reference = card.locator(`.report-card__host a[href="/label/${labelId}"]`);
    await expect(reference).toContainText(`${data.cityId}:${labelId}`);

    await card.dispatchEvent('mouseenter');
    await expect(marker).toHaveClass(/is-lit/);
    await expect(card).toHaveClass(/is-lit/);
    await card.dispatchEvent('mouseleave');
    await expect(marker).not.toHaveClass(/is-lit/);
    await expect(card).not.toHaveClass(/is-lit/);

    await marker.dispatchEvent('mouseenter');
    await expect(card).toHaveClass(/is-lit/);
    await marker.dispatchEvent('mouseleave');
    await expect(card).not.toHaveClass(/is-lit/);
  });

  test('the fixes get their photos and map stills', async ({page, request}) => {
    const {data} = await openReport(page, request);
    test.skip(data.fixes.length === 0, 'the region has no fix clear enough to list');
    const fixes = page.locator('.report-fix');
    await expect(fixes).toHaveCount(data.fixes.length);
    for (const fix of data.fixes) {
      await expect(page.locator(`.report-fix[data-label-id="${fix.labelId}"]`)).toHaveCount(1);
    }
    await fixes.first().scrollIntoViewIfNeeded();
    // The photo pane fills with the crop, or the mini card's placeholder where the label has none; never Street View.
    const photo = fixes.first().locator('[data-fix-photo]');
    await expect(photo.locator(':scope > img, .lmc__placeholder').first()).toBeAttached();
    await expect(photo.locator('img[src*="streetview"]')).toHaveCount(0);
    // The map pane shows the spot: as a still once the map has drawn, and as the sketch until then and if it never does.
    await expect(fixes.first().locator('[data-fix-map] .report-fix__still, [data-fix-map] .report-map__sketch').first())
      .toBeAttached();
  });

  test('the stories section is there exactly when the region has stories, each linking to its label',
    async ({page, request}) => {
      await openReport(page, request);
      const stories = page.locator('.report-story');
      const count = await stories.count();
      if (count === 0) {
        // No story: no empty section, and no contents link to one.
        await expect(page.locator('#report-stories')).toHaveCount(0);
        await expect(page.locator('#report-toc a[href="#report-stories"]')).toHaveCount(0);
        test.skip(true, 'the region has no story on one of its labels');
      }
      await expect(page.locator('#report-toc a[href="#report-stories"]')).toHaveCount(1);

      for (const story of await stories.all()) {
        const storyId = await story.getAttribute('data-story-id');
        const link = story.locator('.report-story__label');
        await expect(link).toHaveAttribute('href', new RegExp(`^/label/\\d+\\?storyId=${storyId}$`));
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(story.locator('.report-story__text')).not.toBeEmpty();
      }
    });
});
