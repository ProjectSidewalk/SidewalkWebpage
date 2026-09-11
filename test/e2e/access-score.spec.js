/**
 * Behavior tests for the AccessScore tool (/accessScore, #5217): the page scores the streets it is given, a slider
 * move re-scores them without a server round trip, the unit switch swaps the layers, and the insights dock's
 * histogram brush, rank list, and URL state stay linked to the map.
 *
 * The data feeds are intercepted with a three-street fixture so the checks read the same against a seeded dev
 * schema and CI's empty one; the engine config is the real endpoint's (it carries no data). The pages.spec.js smoke
 * test covers the unstubbed load.
 */
const {test, expect, stubMapbox, stubMapBaseLayers, waitForAppReady} = require('./fixtures');

/** Three streets in one region: two audited (one all curb ramps, one all obstacles), one unaudited. */
function streetsFixture() {
  const zero = {'1': 0, '2': 0, '3': 0, 'null': 0};
  const counts = (over) => ({
    CurbRamp: zero, NoCurbRamp: zero, Obstacle: zero, SurfaceProblem: zero, Crosswalk: zero, Signal: zero,
    NoSidewalk: zero, ...over,
  });
  const tags = {CurbRamp: 0, NoCurbRamp: 0, Obstacle: 0, SurfaceProblem: 0, Crosswalk: 0, Signal: 0, NoSidewalk: 0};
  const line = (k) => ({type: 'LineString', coordinates: [[-74.01 + k * 0.001, 40.88], [-74.01 + k * 0.001, 40.881]]});
  // Two named streets and one unnamed way, so both title forms are exercised.
  const names = {1: 'Cedar Lane', 2: 'Teaneck Road'};
  const feature = (id, auditCount, severityCounts) => ({
    type: 'Feature',
    geometry: line(id),
    properties: {
      street_edge_id: id, osm_way_id: 1, street_name: names[id] ?? null, region_id: 1, score: null,
      audit_count: auditCount, length_meters: 100, label_count: 0, cluster_counts: {}, sub_scores: {},
      severity_counts: severityCounts, tag_adjustments: tags,
    },
  });
  return {
    type: 'FeatureCollection',
    features: [
      feature(1, 1, counts({CurbRamp: {'1': 2, '2': 0, '3': 0, 'null': 0}})),
      feature(2, 1, counts({Obstacle: {'1': 0, '2': 0, '3': 2, 'null': 0}})),
      feature(3, 0, counts({})),
    ],
  };
}

const REGIONS = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: {type: 'MultiPolygon', coordinates: [[[[-74.02, 40.87], [-74.0, 40.87], [-74.0, 40.89], [-74.02, 40.89], [-74.02, 40.87]]]]},
    properties: {region_id: 1, region_name: 'Fixture'},
  }],
};
const COMPLETION = [{region_id: 1, name: 'Fixture', rate: 1, total_distance_m: 300, completed_distance_m: 200, outdated_distance_m: 0}];

/** Serves the fixture in place of the city's feeds. */
async function stubFeeds(context) {
  await context.route('**/v3/api/accessScoreStreets*', (route) => route.fulfill({json: streetsFixture()}));
  await context.route('**/v3/api/accessScoreIntersections*', (route) =>
    route.fulfill({json: {type: 'FeatureCollection', features: []}}));
  await context.route('**/neighborhoods', (route) => route.fulfill({json: REGIONS}));
  await context.route('**/neighborhoods/completionRate*', (route) => route.fulfill({json: COMPLETION}));
  await context.route('**/v3/api/labelClusters*', (route) => route.fulfill({json: clustersFixture()}));
  await context.route('**/label/id/*', (route) => {
    const id = Number(route.request().url().split('/').pop());
    return route.fulfill({json: {label_id: id, label_type: id === 12 ? 'Obstacle' : 'CurbRamp',
      severity: id === 12 ? 3 : 1, crop_url: null, backup_image_url: null, tags: []}});
  });
}

/** Two clusters in the one region: the curb ramps on street 1 and the obstacles on street 2. */
function clustersFixture() {
  const cluster = (id, type, street, severity, labelIds) => ({
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [-74.01 + street * 0.001, 40.8805]},
    properties: {
      label_cluster_id: id, label_type: type, street_edge_id: street, intersection_id: null, region_id: 1,
      region_name: 'Fixture', median_severity: severity, cluster_size: labelIds.length, label_ids: labelIds,
      agree_count: 0, disagree_count: 0, unsure_count: 0,
    },
  });
  return {
    type: 'FeatureCollection',
    features: [cluster(1, 'CurbRamp', 1, 1, [11]), cluster(2, 'Obstacle', 2, 3, [12, 13])],
  };
}

/** Waits for the page to expose its model and map. */
async function waitForTool(page) {
  await page.waitForFunction(() => Boolean(window.accessScore && window.accessScore.model));
}

const scoreOf = (page, id) => page.evaluate((streetId) => {
  const s = window.accessScore.model.explainStreet(streetId);
  return s.score;
}, id);

/** A feature's `dim` feature-state after the map view's next frame, read as the paint expressions see it. */
const dimOf = (page, source, id) => page.evaluate(([src, fid]) => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() =>
    resolve(window.accessScore.map.getFeatureState({source: src, id: fid}).dim === true)));
}), [source, id]);

const urlParam = (page, name) => page.evaluate((n) => new URL(window.location.href).searchParams.get(n), name);

test.describe('/accessScore', () => {
  test.beforeEach(async ({context}) => {
    await stubMapbox(context);
    await stubMapBaseLayers(context);
    await stubFeeds(context);
  });

  test('scores the fixture streets on load and writes them into the map as feature-state', async ({page}) => {
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);

    // Two good curb ramps: sigmoid(1.5) ≈ 0.818; two severe obstacles: sigmoid(−2) ≈ 0.119; unaudited: none.
    expect(await scoreOf(page, 1)).toBeCloseTo(0.8176, 3);
    expect(await scoreOf(page, 2)).toBeCloseTo(0.1192, 3);
    expect(await scoreOf(page, 3)).toBeNull();

    const state = await page.evaluate(() => {
      const {map} = window.accessScore;
      return new Promise((resolve) => requestAnimationFrame(() => resolve({
        one: map.getFeatureState({source: 'acs-streets', id: 1}).score,
        three: map.getFeatureState({source: 'acs-streets', id: 3}).score,
      })));
    });
    expect(state.one).toBeCloseTo(0.8176, 3);
    expect(state.three).toBeUndefined();

    // The sidebar rendered one slider per scored type, in the engine's order, and the drawer is live.
    await expect(page.locator('#acs-weights input[type="range"]')).toHaveCount(7);
    await expect(page.locator('#acs-weights .acs-weight').first()).toHaveAttribute('data-type', 'CurbRamp');
    await expect(page.locator('#filter-sidebar')).not.toHaveClass(/filter-sidebar--loading/);
  });

  test('a weight slider re-scores in the browser and marks the weights custom', async ({page, context}) => {
    const scoreRequests = [];
    await context.route('**/v3/api/accessScoreStreets*', (route) => {
      scoreRequests.push(route.request().url());
      return route.fulfill({json: streetsFixture()});
    });
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);
    const requestsAfterLoad = scoreRequests.length;

    // Zero the curb-ramp weight: street 1 falls to the neutral 0.5.
    await page.locator('#acs-weight-CurbRamp').fill('0');
    await page.locator('#acs-weight-CurbRamp').dispatchEvent('input');
    await page.locator('#acs-weight-CurbRamp').dispatchEvent('change');
    expect(await scoreOf(page, 1)).toBeCloseTo(0.5, 6);
    await expect(page.locator('#acs-weights-summary')).toHaveText('Custom weights');
    expect(scoreRequests.length).toBe(requestsAfterLoad);

    // The URL carries the custom weights, so the view is shareable.
    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('w')))
      .toContain('CurbRamp:0');

    // Reset restores the engine's weights, the score, and drops the weights from the URL.
    await page.locator('#acs-reset').click();
    expect(await scoreOf(page, 1)).toBeCloseTo(0.8176, 3);
    await expect(page.locator('#acs-weights-summary')).toHaveText('Default weights');
    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.has('w'))).toBe(false);
  });

  test('switching to neighborhoods shows the choropleth and rolls the streets up', async ({page}) => {
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);

    await page.locator('input[name="acs-unit"][value="regions"]').check();
    const visibility = await page.evaluate(() => ({
      fill: window.accessScore.map.getLayoutProperty('acs-regions-fill', 'visibility'),
      streets: window.accessScore.map.getLayoutProperty('acs-streets', 'visibility'),
    }));
    expect(visibility).toEqual({fill: 'visible', streets: 'none'});

    const region = await page.evaluate(() => window.accessScore.model.explainRegion(1));
    // Length-weighted mean of the two audited 100 m streets.
    expect(region.score).toBeCloseTo((0.8176 + 0.1192) / 2, 3);
    expect(region.belowFloor).toBe(false);
    // The unaudited-streets toggle only means something for streets, so it steps aside here.
    await expect(page.locator('#acs-street-options')).toBeHidden();
  });

  test('brushing the histogram dims the streets outside the range, clears on a second click, and never refetches',
    async ({page, context}) => {
      const scoreRequests = [];
      await context.route('**/v3/api/accessScoreStreets*', (route) => {
        scoreRequests.push(route.request().url());
        return route.fulfill({json: streetsFixture()});
      });
      await page.goto('/accessScore');
      await waitForAppReady(page);
      await waitForTool(page);
      const requestsAfterLoad = scoreRequests.length;

      const bins = page.locator('.acs-histogram__bin');
      await expect(bins).toHaveCount(10);
      // Street 1 scores 0.818 (bin 8) and street 2 scores 0.119 (bin 1): brushing bin 8 keeps 1, dims 2 — and the
      // unaudited street 3 with it.
      await bins.nth(8).click();
      await expect(bins.nth(8)).toHaveAttribute('aria-pressed', 'true');
      await expect(bins.nth(1)).toHaveClass(/acs-histogram__bin--out/);
      expect(await dimOf(page, 'acs-streets', 1)).toBe(false);
      expect(await dimOf(page, 'acs-streets', 2)).toBe(true);
      expect(await dimOf(page, 'acs-streets', 3)).toBe(true);
      await expect(page.locator('#acs-dock-brush')).toBeVisible();
      await expect.poll(() => urlParam(page, 'b')).toBe('80-90');

      // What's here is counted over the brush: only street 1's two curb ramps remain, both rated good.
      const ramps = page.locator('.acs-whats-here__row[data-type="CurbRamp"]');
      await expect(ramps.locator('.acs-whats-here__count')).toHaveText('2');
      await expect(ramps.locator('.acs-whats-here__segment[data-bucket="1"]')).toBeVisible();
      await expect(page.locator('.acs-whats-here__row[data-type="Obstacle"] .acs-whats-here__count')).toHaveText('0');
      await expect(page.locator('.acs-whats-here__caption')).toHaveText('citywide · scores 80–90');

      await bins.nth(8).click();
      await expect(bins.nth(8)).toHaveAttribute('aria-pressed', 'false');
      // The pointer still rests on the bin, and a hovered bin dims the map on its own; leave it first.
      await page.mouse.move(5, 5);
      expect(await dimOf(page, 'acs-streets', 2)).toBe(false);
      await expect(page.locator('#acs-dock-brush')).toBeHidden();
      await expect.poll(() => urlParam(page, 'b')).toBeNull();

      // Keyboard: Enter on a focused bin brushes it, Escape clears it.
      await bins.nth(1).focus();
      await page.keyboard.press('Enter');
      await expect(bins.nth(1)).toHaveAttribute('aria-pressed', 'true');
      expect(await dimOf(page, 'acs-streets', 1)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(bins.nth(1)).toHaveAttribute('aria-pressed', 'false');

      // The brush is browser-side arithmetic, like the sliders.
      expect(scoreRequests.length).toBe(requestsAfterLoad);
    });

  test('in the neighborhoods unit the brush dims regions, a rank click selects and flies, and the selection marks the histogram',
    async ({page}) => {
      await page.goto('/accessScore');
      await waitForAppReady(page);
      await waitForTool(page);
      await page.locator('input[name="acs-unit"][value="regions"]').check();

      // The region scores 0.468 (bin 4): a brush on bin 1 dims it, one on bin 4 keeps it.
      const bins = page.locator('.acs-histogram__bin');
      await bins.nth(1).click();
      expect(await dimOf(page, 'acs-regions', 1)).toBe(true);
      await bins.nth(4).click();
      expect(await dimOf(page, 'acs-regions', 1)).toBe(false);
      await page.locator('#acs-dock-brush-clear').click();

      const row = page.locator('.acs-rank__row').first();
      await expect(row).toContainText('Fixture');
      const zoomBefore = await page.evaluate(() => window.accessScore.map.getZoom());
      await row.click();
      await expect(row).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('.acs-popup')).toBeVisible();
      await expect.poll(() => urlParam(page, 'sel')).toBe('1');
      await expect.poll(() => page.evaluate(() => window.accessScore.map.getZoom())).not.toBe(zoomBefore);
      // Selection marks; it does not filter: the histogram stays city-wide with a caret at the region's score.
      const caret = page.locator('.acs-histogram__caret--selection');
      await expect(caret).toBeVisible();
      expect(Number.parseFloat(await caret.evaluate((el) => el.style.left))).toBeCloseTo(46.8, 0);
      await expect(page.locator('.acs-histogram__bin[aria-pressed="true"]')).toHaveCount(0);
      // The selected region stays bright; with one region in the fixture, nothing else is there to fade.
      expect(await dimOf(page, 'acs-regions', 1)).toBe(false);
    });

  test('selecting a street fades the streets outside its neighborhood, and the collapsed band keeps the legend',
    async ({page}) => {
      await page.goto('/accessScore');
      await waitForAppReady(page);
      await waitForTool(page);
      // The stubbed style draws no hit-testable line at this zoom, so select through the dock's own entry point.
      await page.evaluate(() => window.accessScore.dock.setSelection({unit: 'streets', id: 1}));
      // Every fixture street is in the one region, so none fades; the caret marks the street's score.
      expect(await dimOf(page, 'acs-streets', 2)).toBe(false);
      const caret = page.locator('.acs-histogram__caret--selection');
      await expect(caret).toBeVisible();
      expect(Number.parseFloat(await caret.evaluate((el) => el.style.left))).toBeCloseTo(81.8, 0);

      await page.locator('#acs-dock-toggle').click();
      await expect(page.locator('#acs-dock-strip')).toBeVisible();
      await expect(page.locator('.acs-dock__strip-caret')).toBeVisible();
      await expect(page.locator('#acs-dock-body')).toBeHidden();

      // The map's own legend sits beside the zoom buttons in every dock state, its caret at the selection's score
      // (the dock's entry point above bypasses the page's select(), so the map view is told directly).
      await page.evaluate(() => window.accessScore.mapView.setSelection({unit: 'streets', id: 1}));
      const legend = page.locator('.acs-map-legend');
      await expect(legend).toBeVisible();
      await expect(legend.locator('.acs-map-legend__swatch--unaudited')).toBeVisible();
      const legendCaret = legend.locator('.acs-map-legend__caret');
      await expect(legendCaret).toBeVisible();
      expect(Number.parseFloat(await legendCaret.evaluate((el) => el.style.left))).toBeCloseTo(81.8, 0);
      const [legendBox, zoomBox] = await Promise.all([
        legend.boundingBox(), page.locator('.mapboxgl-ctrl-zoom-in').boundingBox()]);
      expect(legendBox.x + legendBox.width).toBeLessThanOrEqual(zoomBox.x);
      expect(Math.abs(legendBox.y - zoomBox.y)).toBeLessThan(2);
      // In the neighborhoods unit the swatch is the hatch, since the no-score case there is the completion floor.
      await page.locator('input[name="acs-unit"][value="regions"]').check({force: true});
      await expect(legend.locator('.acs-map-legend__swatch--hatch')).toBeVisible();
    });

  test('a street popup shows the headline over its three components', async ({page}) => {
    await page.goto('/accessScore?sel=1');
    await waitForAppReady(page);
    await waitForTool(page);
    const popup = page.locator('.acs-popup');
    await expect(popup).toBeVisible();
    await expect(popup.locator('.acs-popup__score')).toHaveText('81.8');
    // The stubbed intersections feed is empty, so the headline is the segment alone and both crossings read "—".
    await expect(popup.locator('.acs-popup__components'))
      .toHaveText(/Segment 81\.8 · Start crossing — · End crossing —/);
  });

  test('what\'s here counts the whole city, and the photo strip shows the worst clusters of the scope', async ({page}) => {
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);
    // Citywide: two curb ramps (good) and two obstacles (severe) from the fixture streets.
    await expect(page.locator('.acs-whats-here__caption')).toHaveText('citywide');
    await expect(page.locator('.acs-whats-here__row[data-type="CurbRamp"] .acs-whats-here__count')).toHaveText('2');
    await expect(page.locator('.acs-whats-here__row[data-type="Obstacle"] .acs-whats-here__count')).toHaveText('2');
    await expect(page.locator('.acs-whats-here__row[data-type="Obstacle"] .acs-whats-here__segment[data-bucket="3"]'))
      .toBeVisible();
    // Nothing selected: the strip reads the lowest-scoring neighborhood — the fixture's only one — and says so.
    await expect(page.locator('.acs-photos__caption')).toHaveText('Photos from Fixture (lowest scoring)');
    const items = page.locator('.acs-photos__item');
    await expect(items).toHaveCount(2);
    // Worst first: the severity-3 obstacle cluster ahead of the good curb ramps; no crops locally → placeholders.
    await expect(items.nth(0)).toHaveAttribute('data-label-id', '12');
    await expect(items.nth(0).locator('.acs-sheet__placeholder')).toBeVisible();
    await expect(items.nth(0)).toHaveAttribute('data-ps-tooltip', /Obstacle in Path · High · Fixture/);
    // A street selection narrows the strip to that street's clusters.
    await page.evaluate(() => window.accessScore.dock.setSelection({unit: 'streets', id: 1}));
    await expect(page.locator('.acs-photos__caption')).toHaveText('Photos from Cedar Lane · Street 1');
    await expect(items).toHaveCount(1);
    await expect(items.nth(0)).toHaveAttribute('data-label-id', '11');
    await expect(page.locator('.acs-whats-here__caption')).toHaveText('on Cedar Lane');
    // A thumbnail opens the shared label card.
    await items.nth(0).click();
    await expect(page.locator('#label-modal')).toBeVisible();
  });

  test('reset everything returns the weights, the selection, the brush and the URL to the opening state', async ({page}) => {
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);
    await page.locator('#acs-weight-CurbRamp').fill('0');
    await page.locator('#acs-weight-CurbRamp').dispatchEvent('input');
    await page.locator('#acs-weight-CurbRamp').dispatchEvent('change');
    await page.evaluate(() => window.accessScore.dock.setSelection({unit: 'streets', id: 1}));
    await page.evaluate(() => window.accessScore.mapView.setSelection({unit: 'streets', id: 1}));
    await page.locator('.acs-histogram__bin').nth(1).click();
    await expect.poll(() => urlParam(page, 'w')).toContain('CurbRamp:0');
    await expect.poll(() => urlParam(page, 'b')).toBe('10-20');
    await page.locator('#acs-reset-all').click();
    expect(await scoreOf(page, 1)).toBeCloseTo(0.8176, 3);
    await expect(page.locator('#acs-weights-summary')).toHaveText('Default weights');
    await expect(page.locator('.acs-popup')).toHaveCount(0);
    await expect(page.locator('#acs-dock-brush')).toBeHidden();
    for (const name of ['w', 'sel', 'b', 'unit', 'dock']) {
      await expect.poll(() => urlParam(page, name)).toBeNull();
    }
  });

  test('with nothing selected, the photo strip follows the area in view once zoomed in', async ({page}) => {
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);
    await expect(page.locator('.acs-photos__caption')).toHaveText('Photos from Fixture (lowest scoring)');
    // A reader's own move (eventData stands in for the pointer event) over the fixture region, zoomed to street level.
    await page.evaluate(() => window.accessScore.map.jumpTo(
      {center: [-74.009, 40.8805], zoom: 15}, {originalEvent: {type: 'test'}}));
    await expect(page.locator('.acs-photos__caption')).toHaveText('Photos from the area in view');
    // Both fixture clusters sit inside this view; worst first, as everywhere.
    const items = page.locator('.acs-photos__item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAttribute('data-label-id', '12');
    // A selection outranks the view.
    await page.evaluate(() => window.accessScore.dock.setSelection({unit: 'streets', id: 2}));
    await expect(page.locator('.acs-photos__caption')).toHaveText('Photos from Teaneck Road · Street 2');
    await expect(items).toHaveCount(1);
  });

  test('the dark basemap comes from the URL, and the toggle swaps it live without leaving the page', async ({page}) => {
    await page.goto('/accessScore?dark=1');
    await waitForAppReady(page);
    await waitForTool(page);
    await expect(page.locator('#acs-map-holder')).toHaveClass(/acs-map-holder--dark/);
    await expect(page.locator('#acs-dark-map')).toBeChecked();
    // The map wears the dark stepping (pale jade at the top) while the band keeps the light ramp's deep jade.
    // Mid-swap the layer is gone (setStyle drops it, remount brings it back), so a missing layer reads as ''.
    const streetTopStop = () => page.evaluate(() => {
      const map = window.accessScore.map;
      if (!map.getLayer('acs-streets')) return '';
      return JSON.stringify(map.getPaintProperty('acs-streets', 'line-color')).toUpperCase();
    });
    expect(await streetTopStop()).toContain('#A5E0C0');
    expect(await page.locator('#acs-dock-strip .acs-dock__strip-bar').evaluate((el) => el.style.background))
      .toMatch(/rgb\(57, 94, 73\)|#395E49/i);

    // Toggling off is a live style swap: the page object survives and the layers come back on the light ramp.
    await page.evaluate(() => { window.__acsMarker = 1; });
    await page.locator('#acs-dark-map').uncheck();
    await expect(page.locator('#acs-map-holder')).not.toHaveClass(/acs-map-holder--dark/);
    await expect.poll(streetTopStop).toContain('#395E49');
    expect(await page.evaluate(() => window.__acsMarker)).toBe(1);
    await expect.poll(() => urlParam(page, 'dark')).toBeNull();
    // Scores are written again after the remount: street 1 keeps its color state.
    await expect.poll(() => scoreOf(page, 1)).toBeCloseTo(0.8176, 3);
  });

  test('the dock state round-trips through the URL', async ({page}) => {
    await page.goto('/accessScore?dock=0&b=80-90');
    await waitForAppReady(page);
    await waitForTool(page);
    await expect(page.locator('#acs-dock')).toHaveClass(/acs-dock--collapsed/);
    await expect(page.locator('#acs-dock-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => window.accessScore.dock.state)).toEqual({open: false, brush: {from: 8, to: 9}});

    await page.locator('#acs-dock-toggle').click();
    await expect(page.locator('#acs-dock-body')).toBeVisible();
    await expect(page.locator('.acs-histogram__bin').nth(8)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#acs-dock-caption')).toContainText('3 streets');
    await expect.poll(() => urlParam(page, 'dock')).toBeNull();
  });
});
