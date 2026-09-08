/**
 * Behavior tests for the AccessScore tool (/accessScore, #5217): the page scores the streets it is given, a slider
 * move re-scores them without a server round trip, the unit switch swaps the layers, and the insights dock's
 * histogram brush, scope, rank list, and URL state stay linked to the map.
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
  const feature = (id, auditCount, severityCounts) => ({
    type: 'Feature',
    geometry: line(id),
    properties: {
      street_edge_id: id, osm_way_id: 1, region_id: 1, score: null, audit_count: auditCount, length_meters: 100,
      label_count: 0, cluster_counts: {}, sub_scores: {}, severity_counts: severityCounts, tag_adjustments: tags,
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
  await context.route('**/neighborhoods', (route) => route.fulfill({json: REGIONS}));
  await context.route('**/neighborhoods/completionRate*', (route) => route.fulfill({json: COMPLETION}));
  await context.route('**/v3/api/labelClusters*', (route) =>
    route.fulfill({json: {type: 'FeatureCollection', features: []}}));
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

  test('a weight slider re-scores in the browser and flips the preset to custom', async ({page, context}) => {
    const scoreRequests = [];
    await context.route('**/v3/api/accessScoreStreets*', (route) => {
      scoreRequests.push(route.request().url());
      return route.fulfill({json: streetsFixture()});
    });
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);
    const requestsAfterLoad = scoreRequests.length;

    // The weights start collapsed so the panel reads simply; open them, then zero the curb-ramp weight: street 1
    // falls to the neutral 0.5.
    await page.locator('#acs-weights-details summary').click();
    await page.locator('#acs-weight-CurbRamp').fill('0');
    await page.locator('#acs-weight-CurbRamp').dispatchEvent('input');
    await page.locator('#acs-weight-CurbRamp').dispatchEvent('change');
    expect(await scoreOf(page, 1)).toBeCloseTo(0.5, 6);
    await expect(page.locator('#acs-preset')).toHaveValue('custom');
    expect(scoreRequests.length).toBe(requestsAfterLoad);

    // The URL carries the custom weights, so the view is shareable.
    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('w')))
      .toContain('CurbRamp:0');

    // Reset restores the default preset and the score.
    await page.locator('#acs-reset').click();
    expect(await scoreOf(page, 1)).toBeCloseTo(0.8176, 3);
    await expect(page.locator('#acs-preset')).toHaveValue('default');
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
    await expect(page.locator('#acs-region-options')).toBeVisible();
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
      await expect(bins).toHaveCount(20);
      // Street 1 scores 0.818 (bin 16) and street 2 scores 0.119 (bin 2): brushing bin 16 keeps 1, dims 2 — and the
      // unaudited street 3 with it.
      await bins.nth(16).click();
      await expect(bins.nth(16)).toHaveAttribute('aria-pressed', 'true');
      await expect(bins.nth(2)).toHaveClass(/acs-histogram__bin--out/);
      expect(await dimOf(page, 'acs-streets', 1)).toBe(false);
      expect(await dimOf(page, 'acs-streets', 2)).toBe(true);
      expect(await dimOf(page, 'acs-streets', 3)).toBe(true);
      await expect(page.locator('#acs-dock-brush')).toBeVisible();
      await expect.poll(() => urlParam(page, 'b')).toBe('80-85');

      // The cluster view is computed over the brush: only street 1's two curb ramps remain.
      await expect(page.locator('.acs-clusters__row[data-type="CurbRamp"] .acs-clusters__count')).toHaveText('2');
      await expect(page.locator('.acs-clusters__row[data-type="Obstacle"] .acs-clusters__count')).toHaveText('0');

      await bins.nth(16).click();
      await expect(bins.nth(16)).toHaveAttribute('aria-pressed', 'false');
      // The pointer still rests on the bin, and a hovered bin dims the map on its own; leave it first.
      await page.mouse.move(5, 5);
      expect(await dimOf(page, 'acs-streets', 2)).toBe(false);
      await expect(page.locator('#acs-dock-brush')).toBeHidden();
      await expect.poll(() => urlParam(page, 'b')).toBeNull();

      // Keyboard: Enter on a focused bin brushes it, Escape clears it.
      await bins.nth(2).focus();
      await page.keyboard.press('Enter');
      await expect(bins.nth(2)).toHaveAttribute('aria-pressed', 'true');
      expect(await dimOf(page, 'acs-streets', 1)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(bins.nth(2)).toHaveAttribute('aria-pressed', 'false');

      // Scope and brush are browser-side arithmetic, like the sliders.
      await page.locator('input[name="acs-scope"][value="viewport"]').check();
      await expect(page.locator('#acs-dock-scope-caption')).toContainText('In view');
      expect(scoreRequests.length).toBe(requestsAfterLoad);
    });

  test('in the neighborhoods unit the brush dims regions, a rank click selects and flies, and the selection marks the histogram',
    async ({page}) => {
      await page.goto('/accessScore');
      await waitForAppReady(page);
      await waitForTool(page);
      await page.locator('input[name="acs-unit"][value="regions"]').check();
      // The Selected scope only means something for a street's neighborhood, so it is not offered here.
      await expect(page.locator('#acs-scope-selection-option')).toBeHidden();

      // The region scores 0.468 (bin 9): a brush on bin 3 dims it, one on bin 9 keeps it.
      const bins = page.locator('.acs-histogram__bin');
      await bins.nth(3).click();
      expect(await dimOf(page, 'acs-regions', 1)).toBe(true);
      await bins.nth(9).click();
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
    });

  test('a Map view scope follows the camera, and the dock state round-trips through the URL', async ({page}) => {
    await page.goto('/accessScore?dock=0&scope=viewport&b=80-85');
    await waitForAppReady(page);
    await waitForTool(page);
    await expect(page.locator('#acs-dock')).toHaveClass(/acs-dock--collapsed/);
    await expect(page.locator('#acs-dock-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('input[name="acs-scope"][value="viewport"]')).toBeChecked();
    expect(await page.evaluate(() => window.accessScore.dock.state)).toEqual({
      open: false, scope: 'viewport', brush: {from: 16, to: 17},
    });

    await page.locator('#acs-dock-toggle').click();
    await expect(page.locator('#acs-dock-body')).toBeVisible();
    await expect(page.locator('.acs-histogram__bin').nth(16)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#acs-dock-scope-caption')).toContainText('3 streets');

    // Moving the camera off the fixture empties the scope once the map settles; moving back refills it.
    await page.evaluate(() => window.accessScore.map.jumpTo({center: [-74.2, 41.0], zoom: 14}));
    await expect(page.locator('#acs-dock-scope-caption')).toContainText('0 streets');
    await expect(page.locator('.acs-histogram__empty')).toBeVisible();
    await page.evaluate(() => window.accessScore.map.jumpTo({center: [-74.009, 40.8805], zoom: 14}));
    await expect(page.locator('#acs-dock-scope-caption')).toContainText('3 streets');
    await expect.poll(() => urlParam(page, 'dock')).toBeNull();
  });
});
