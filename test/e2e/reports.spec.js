/**
 * Behavior tests for the city reports page (/reports, #6041). pages.spec.js covers the bare load and axe; this checks
 * what the page does: its map comes up, one selection is shared by the table and the profile panel, the lens recolors
 * the map and moves the table's marked column, the filter hides rows, sorting keeps unscored neighborhoods last, a row
 * leads to its neighborhood report, and on a phone the table becomes cards with nothing scrolling sideways.
 *
 * Nothing here is stubbed: the map runs on the city's own tile archive, so no Mapbox or Google request is made, and the
 * `googleMapsLeaks` fixture fails any test whose page asks Google. The specs read the page's embedded `#reports-data`
 * JSON to learn what the server put on it, so they run against any dev city and against CI's one-region seed,
 * skipping (with a reason) what a city with too few neighborhoods can't show.
 */
const {test, expect, waitForAppReady} = require('./fixtures');

/**
 * Loads the page and reads what the server drew it from. The first load after a deploy may wait out AccessScore's
 * cold start, so the test gets triple the usual time.
 * @param {import('@playwright/test').Page} page - The test's page.
 * @returns {Promise<Record<string, any>>} The page's `#reports-data` JSON.
 */
async function openReports(page) {
  test.slow();
  const response = await page.goto('/reports');
  expect(response.status(), `/reports responded ${response.status()}`).toBe(200);
  await waitForAppReady(page);
  const data = await page.evaluate(() => JSON.parse(document.getElementById('reports-data').textContent));
  if (process.env.CI) expect(data.rows.length, 'CI\'s seed has no region to list').toBeGreaterThan(0);
  test.skip(data.rows.length === 0, 'this database has no region to list');
  return data;
}

/**
 * @param {import('@playwright/test').Page} page - A loaded page.
 * @returns {Promise<number[]>} The visible rows' region ids, top to bottom.
 */
function visibleRowIds(page) {
  return page.locator('#reports-table tbody tr:not([hidden])')
    .evaluateAll((rows) => rows.map((r) => Number(r.dataset.regionId)));
}

/**
 * Collects what the page logs, as the activity strings it posts.
 * @param {import('@playwright/test').Page} page - The test's page, before it loads.
 * @returns {string[]} Filled as the page logs.
 */
function logged(page) {
  const activities = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/userapi/logWebpageActivity')) activities.push(JSON.parse(request.postData()));
  });
  return activities;
}

test.describe('/reports', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('loads clean, reveals its controls, draws its map and links every neighborhood\'s report',
    async ({page, consoleErrors}) => {
      const data = await openReports(page);
      await expect(page.locator('#reports-controls')).toBeVisible();
      const canvas = page.locator('#reports-map canvas.maplibregl-canvas');
      await expect(canvas).toHaveCount(1);
      const box = await canvas.boundingBox();
      expect(box.width * box.height, 'the map canvas has no area').toBeGreaterThan(0);

      const hrefs = await page.locator('#reports-table a[data-city-event="OpenReport"]')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
      expect(hrefs).toEqual(expect.arrayContaining(data.rows.map((r) => r.report)));
      expect(hrefs.length).toBe(data.rows.length);
      // The panel opens on the server's choice.
      await expect(page.locator('#reports-panel-name')).toHaveText(data.rows.find((r) => r.id === data.selected).name);
      // Settle window for late async work: the polygons, the basemap's first tiles.
      await page.waitForTimeout(1000);
      expect(consoleErrors).toEqual([]);
    });

  test('fits the page from 1280px wide, links column included, with nothing to scroll sideways', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await openReports(page);
    const scroller = page.locator('#reports-table-scroll');
    const {client, scroll} = await scroller.evaluate((s) => ({client: s.clientWidth, scroll: s.scrollWidth}));
    expect(scroll, 'the table scrolls sideways on a desktop').toBeLessThanOrEqual(client);
    // Nothing to scroll, so no tab stop that scrolls nothing.
    await expect(scroller).not.toHaveAttribute('tabindex');
    // The links column ends inside the scroller, not past its right edge.
    const link = await page.locator('#reports-table tbody tr:first-child a[data-city-event="OpenReport"]').boundingBox();
    const box = await scroller.boundingBox();
    expect(link.x + link.width, 'the links column is cut off').toBeLessThanOrEqual(box.x + box.width);
  });

  // Between the phone layout and a wide desktop (a tablet, or a desktop zoomed to 125-150%) the table may be wider than
  // the page. Then it scrolls inside its own box and the page stays put, whatever in the table is absolutely placed.
  test('scrolls only the table from 769px to 1199px', async ({page}) => {
    await page.setViewportSize({width: 769, height: 900});
    await openReports(page);
    const scroller = page.locator('#reports-table-scroll');
    for (const width of [769, 900, 1016, 1100]) {
      await page.setViewportSize({width, height: 900});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `the page scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
      const scrolls = await scroller.evaluate((s) => s.scrollWidth > s.clientWidth);
      // A keyboard can scroll it exactly where it scrolls.
      if (scrolls) await expect(scroller, `${width}px`).toHaveAttribute('tabindex', '0');
      else await expect(scroller, `${width}px`).not.toHaveAttribute('tabindex');
    }
  });

  test('picking a neighborhood in the table shows it in the panel and marks its row', async ({page}) => {
    const activities = logged(page);
    const data = await openReports(page);
    test.skip(data.rows.length < 2, 'the city has one neighborhood, so there is nothing else to pick');
    const other = data.rows.find((r) => r.id !== data.selected);
    const button = page.locator(`#reports-table tr[data-region-id="${other.id}"] .reports-table__select`);
    await button.click();
    await expect(page.locator('#reports-panel-name')).toHaveText(other.name);
    await expect(page.locator('#reports-panel')).toHaveAttribute('data-region-id', String(other.id));
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`#reports-table tr[data-region-id="${other.id}"]`)).toHaveClass(/is-selected/);
    await expect(page.locator(`#reports-table tr[data-region-id="${data.selected}"]`)).not.toHaveClass(/is-selected/);
    // The panel's own link leads to the same report the row does.
    await expect(page.locator('#reports-panel a[data-city-event="OpenReport"]')).toHaveAttribute('href', other.report);
    // A screen reader hears the pick once, by name, rather than the whole panel again.
    await expect(page.locator('#reports-panel-status')).toContainText(other.name);
    await expect(page.locator('#reports-panel')).not.toHaveAttribute('aria-live');
    await expect.poll(() => activities).toContain(`Report_City_Select_Region=${other.id}_From=Table`);
  });

  test('a lens swaps the legend and the table\'s marked column', async ({page}) => {
    const activities = logged(page);
    await openReports(page);
    const lenses = {score: 'score', explored: 'explored', problem: 'why'};
    for (const [lens, column] of Object.entries(lenses)) {
      await page.locator(`button[data-lens="${lens}"]`).click();
      await expect(page.locator(`button[data-lens="${lens}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`.reports-legend[data-lens="${lens}"]`)).toBeVisible();
      await expect(page.locator('.reports-legend:not([hidden])')).toHaveCount(1);
      await expect(page.locator(`#reports-table thead th[data-column="${column}"]`)).toHaveClass(/is-lens/);
      await expect(page.locator('#reports-table thead th.is-lens')).toHaveCount(1);
    }
    // Score is the lens the page opens on, so only the two changes are logged.
    await expect.poll(() => activities).toEqual(expect.arrayContaining(
      ['Report_City_Lens_Explored', 'Report_City_Lens_Problem']));
  });

  test('the filter hides the rows it leaves out, and sorting by score keeps unscored ones last', async ({page}) => {
    const activities = logged(page);
    const data = await openReports(page);
    const scored = data.rows.filter((r) => r.scored).map((r) => r.id);
    const unscored = data.rows.filter((r) => !r.scored).map((r) => r.id);

    await page.locator('button[data-filter="scored"]').click();
    expect((await visibleRowIds(page)).sort()).toEqual([...scored].sort());
    await page.locator('button[data-filter="unscored"]').click();
    expect((await visibleRowIds(page)).sort()).toEqual([...unscored].sort());
    await page.locator('button[data-filter="all"]').click();
    expect((await visibleRowIds(page)).length).toBe(data.rows.length);

    const header = page.locator('#reports-table thead th[data-column="score"]');
    // With scores, the page opens in Score order, lowest first, and says so; a first click turns it around.
    if (data.scoresReady) await expect(header).toHaveAttribute('aria-sort', 'ascending');
    else await expect(header).not.toHaveAttribute('aria-sort');
    const dirs = data.scoresReady ? ['descending', 'ascending'] : ['ascending', 'descending'];
    for (const dir of dirs) {
      await header.locator('button[data-sort]').click();
      await expect(header).toHaveAttribute('aria-sort', dir);
      const order = await visibleRowIds(page);
      expect(order.slice(scored.length).sort(), `unscored rows last, ${dir}`).toEqual([...unscored].sort());
      const scores = order.slice(0, scored.length).map((id) => data.rows.find((r) => r.id === id).score);
      const sorted = [...scores].sort((a, b) => (dir === 'ascending' ? a - b : b - a));
      expect(scores, `scored rows ${dir}`).toEqual(sorted);
    }
    await expect.poll(() => activities).toEqual(expect.arrayContaining(['Report_City_Filter_Scored',
      'Report_City_Filter_Unscored', 'Report_City_Filter_All',
      `Report_City_Sort_Column=score_Dir=${data.scoresReady ? 'desc' : 'asc'}`]));
  });

  test('a row\'s link opens its neighborhood report', async ({page}) => {
    const activities = logged(page);
    const data = await openReports(page);
    const row = data.rows[0];
    await page.locator(`#reports-table tr[data-region-id="${row.id}"] a[data-city-event="OpenReport"]`).click();
    await page.waitForURL((url) => url.pathname === new URL(row.report, 'http://x').pathname, {timeout: 90_000});
    expect(activities).toContain(`Report_City_OpenReport_Region=${row.id}`);
    // The report leads back.
    await expect(page.locator('a[data-report-event="Report_OpenCity"]')).toHaveAttribute('href', '/reports');
  });
});

test.describe('/reports on a phone', () => {
  test.use({viewport: {width: 390, height: 844}});

  test('the table becomes labeled cards and nothing scrolls sideways', async ({page}) => {
    await openReports(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
    const label = await page.locator('#reports-table tbody tr:first-child td[data-column="explored"]')
      .evaluate((td) => getComputedStyle(td, '::before').content);
    expect(label, 'a card cell names its column').not.toBe('none');
    // The scroller has nothing to scroll here, so it is no tab stop.
    await expect(page.locator('#reports-table-scroll')).not.toHaveAttribute('tabindex');
  });

  test('keeps every sort button visible, so focus can be seen and the cards can still be sorted', async ({page}) => {
    await openReports(page);
    await expect(page.locator('.reports-sort-label')).toBeVisible();
    for (const button of await page.locator('#reports-table button[data-sort]').all()) {
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box.height, 'a sort button is too small to take a tap').toBeGreaterThanOrEqual(24);
    }
    const explored = page.locator('#reports-table thead th[data-column="explored"]');
    await explored.locator('button').focus();
    await page.keyboard.press('Enter');
    await expect(explored).toHaveAttribute('aria-sort', 'ascending');
  });
});
