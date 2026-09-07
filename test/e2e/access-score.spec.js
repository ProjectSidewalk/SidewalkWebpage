/**
 * Behavior tests for the AccessScore tool (/accessScore, #5217): the page scores the streets it is given, a slider
 * move re-scores them without a server round trip, and the unit switch swaps the layers.
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
  await context.route('**/labels/all*', (route) =>
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
});
