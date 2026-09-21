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
    properties: {region_id: 1, name: 'Fixture'},
  }],
};
const COMPLETION = [{region_id: 1, name: 'Fixture', rate: 1, total_distance_m: 300, completed_distance_m: 200, outdated_distance_m: 0}];

/** Every validation the stubbed `/labelmap/validate` received in the current test, as parsed JSON bodies. */
const VALIDATIONS = [];

/** Serves the fixture in place of the city's feeds. */
async function stubFeeds(context) {
  VALIDATIONS.length = 0;
  await context.route('**/labelmap/validate', (route) => {
    VALIDATIONS.push(route.request().postDataJSON());
    return route.fulfill({json: {}});
  });
  await context.route('**/v3/api/accessScoreStreets*', (route) => route.fulfill({json: streetsFixture()}));
  await context.route('**/v3/api/accessScoreIntersections*', (route) =>
    route.fulfill({json: {type: 'FeatureCollection', features: []}}));
  await context.route((url) => url.pathname === '/regions', (route) => route.fulfill({json: REGIONS}));
  await context.route((url) => url.pathname === '/regions/completionRates',
    (route) => route.fulfill({json: COMPLETION}));
  await context.route('**/v3/api/labelClusters*', (route) => route.fulfill({json: clustersFixture()}));
  // Stubbed for every test, not only the places ones: the live server has whatever its last refresh fetched, and the
  // sidebar's rows and counts would otherwise depend on it.
  await context.route('**/v3/api/places*', (route) => route.fulfill({json: placesFixture()}));
  await context.route('**/label/id/*', (route) => {
    const id = Number(route.request().url().split('/').pop());
    // Label 11 carries a (stubbed) crop so its chips are live; the rest have no picture to judge by. 12 and 13 are
    // the obstacle cluster's labels; the strip shows a cluster by its newest, 13.
    return route.fulfill({json: {label_id: id, label_type: id >= 12 ? 'Obstacle' : 'CurbRamp',
      severity: id >= 12 ? 3 : 1, crop_url: id === 11 ? '/assets/images/icons/label_type_icons/CurbRamp_small.svg' : null,
      backup_image_url: null, tags: [], num_agree: 2, num_disagree: 0, num_unsure: 0, user_validation: null,
      from_current_user: false, heading: 10, pitch: -5, zoom: 1, canvas_x: 300, canvas_y: 200}});
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

/** Three places: a school on street 1, a library with no street near it, and a bus stop on the unaudited street 3. */
function placesFixture() {
  const place = (id, category, name, lng, lat, streetId, distance) => ({
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [lng, lat]},
    properties: {
      place_id: id, category, name, source: 'osm', osm_type: 'node', osm_id: 1000 + id,
      osm_url: `https://www.openstreetmap.org/node/${1000 + id}`, region_id: 1, region_name: 'Fixture',
      nearest_street_edge_id: streetId, nearest_street_distance_m: distance, fetched_at: '2026-09-17T09:00:00Z',
    },
  });
  return {
    type: 'FeatureCollection',
    features: [
      place(1, 'school', 'Fixture High School', -74.0089, 40.8805, 1, 12.5),
      place(2, 'library', 'Fixture Library', -74.015, 40.885, null, null),
      place(3, 'transit', null, -74.0069, 40.8805, 3, 4.2),
    ],
  };
}

/** Waits for the page to expose its model and map. */
async function waitForTool(page) {
  await page.waitForFunction(() => Boolean(window.accessScore && window.accessScore.model));
}

/**
 * Makes the fixture city a sampled one (#5223): the slope controls and the map's legend classes exist only where
 * the config carries a gradient block. Only street 1 gets a slope, a 12% steepest stretch — past the 8.3% ramp
 * limit, so the engine's own settings take the whole weight off it.
 * @param {import('@playwright/test').BrowserContext} context - The test's context, whose routes are added to.
 */
async function stubGradient(context) {
  await context.route('**/v3/api/accessScoreConfig', async (route) => {
    const config = await (await route.fetch()).json();
    config.gradient = {
      walking_surface_limit: 0.05, ramp_limit: 1 / 12, map_class_breaks: [1 / 48, 0.05, 1 / 12, 0.125],
      sources: [{dem_source: 'fixture-dem', title: 'Fixture DEM', credit: 'Elevation: Fixture Survey',
        licence: 'Public domain', url: 'https://example.org/dem', street_count: 1}],
    };
    return route.fulfill({json: config});
  });
  await context.route('**/v3/api/accessScoreStreets*', (route) => {
    const streets = streetsFixture();
    Object.assign(streets.features[0].properties, {
      mean_grade: 0.1, max_grade: 0.12, net_grade: 0.1, total_climb_meters: 10, total_descent_meters: 0,
      meters_over_5pct: 100, meters_over_8pct: 100, grade_confidence: 'high', grade_quality: 'measured',
      dem_source: 'fixture-dem', slope_term: -1,
    });
    return route.fulfill({json: streets});
  });
  await context.route('**/v3/api/streetGradientProfile*', (route) => route.fulfill({json: {
    street_edge_id: 1, profile: {spacing_meters: 50, elevations_meters: [100, 105, 110]},
  }}));
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

/**
 * Stands in for picking a search suggestion. `retrieve` is the event Search JS fires with the chosen feature and is
 * the whole contract between the SDK and our code — typing into the box instead would exercise Mapbox's network
 * protocol (which stubMapbox answers 204 for), not the pin behavior under test. The value is set first, as the SDK
 * does, so its own ✕ shows.
 */
const selectPlace = (page) => page.evaluate(() => {
  const box = document.querySelector('mapbox-search-box');
  box.value = 'Fixture Library';
  // The SDK only re-evaluates its ✕'s visibility around a request; an input event starts one (stubbed to 204).
  box.querySelector('input[role="combobox"]').dispatchEvent(new Event('input', {bubbles: true}));
  box.dispatchEvent(new CustomEvent('retrieve', {
    detail: {features: [{
      geometry: {type: 'Point', coordinates: [-74.0105, 40.8805]},
      properties: {name: 'Fixture Library', full_address: '1 Cedar Ln, Teaneck, NJ 07666'},
    }]},
  }));
});

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

  test('a weight slider re-scores in the browser and marks the weights custom', async ({page, context, consoleErrors}) => {
    const scoreRequests = [];
    await context.route('**/v3/api/accessScoreStreets*', (route) => {
      scoreRequests.push(route.request().url());
      return route.fulfill({json: streetsFixture()});
    });
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);
    const requestsAfterLoad = scoreRequests.length;

    // The sliders start folded away; a link with custom weights opens the fold itself (checked below).
    const fold = page.locator('#acs-weights-toggle');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#acs-weights')).toBeHidden();
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');

    // Zero the curb-ramp weight: street 1 falls to the neutral 0.5.
    await page.locator('#acs-weight-CurbRamp').fill('0');
    await page.locator('#acs-weight-CurbRamp').dispatchEvent('input');
    await page.locator('#acs-weight-CurbRamp').dispatchEvent('change');
    expect(await scoreOf(page, 1)).toBeCloseTo(0.5, 6);
    await expect(page.locator('#acs-reset')).toBeVisible();
    await expect(page.locator('#acs-weights-summary')).toHaveText('Custom');
    expect(scoreRequests.length).toBe(requestsAfterLoad);

    // The URL carries the custom weights, so the view is shareable.
    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('w')))
      .toContain('CurbRamp:0');

    // Reset restores the engine's weights, the score, and drops the weights from the URL.
    await page.locator('#acs-reset').click();
    expect(await scoreOf(page, 1)).toBeCloseTo(0.8176, 3);
    await expect(page.locator('#acs-reset')).toBeHidden();
    await expect(page.locator('#acs-weights-summary')).toBeEmpty();
    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.has('w'))).toBe(false);

    await page.goto('/accessScore?w=CurbRamp:0');
    await waitForAppReady(page);
    await waitForTool(page);
    await expect(page.locator('#acs-weights-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#acs-weights')).toBeVisible();
    // The fold's click reports no state; the page must not try to apply one.
    expect(consoleErrors).toEqual([]);
  });

  test('switching to regions shows the choropleth and rolls the streets up', async ({page}) => {
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

  test('in the regions unit the brush dims regions, a rank click selects and flies, and the selection marks the histogram',
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

  test('in the streets unit the rank list is the street leaderboard, and a click selects that street (#5223)',
    async ({page}) => {
      await page.goto('/accessScore');
      await waitForAppReady(page);
      await waitForTool(page);
      await expect(page.locator('#acs-dock-rank-title')).toHaveText('Streets ranked');
      const order = page.locator('#acs-rank-order');
      await expect(order).toBeVisible();
      await expect(order).toHaveText('Show worst 20');

      // Best first: the top row outscores the bottom one, and the toggle turns the list around.
      const scores = () => page.locator('.acs-rank__score').allTextContents();
      const asNumbers = (texts) => texts.map((t) => Number.parseFloat(t));
      const best = asNumbers(await scores());
      expect(best).toEqual([...best].sort((a, b) => b - a));
      await order.click();
      await expect(order).toHaveText('Show best 20');
      const worst = asNumbers(await scores());
      expect(worst).toEqual([...worst].sort((a, b) => a - b));
      expect(worst[0]).toBeLessThanOrEqual(best[0]);
      await order.click();

      // A row is the street: clicking it selects that street on the map, popup and URL included.
      const row = page.locator('.acs-rank__row').first();
      const zoomBefore = await page.evaluate(() => window.accessScore.map.getZoom());
      const streetId = await row.getAttribute('data-row-id');
      await row.click();
      await expect(row).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('.acs-popup')).toBeVisible();
      await expect.poll(() => urlParam(page, 'sel')).toBe(streetId);
      await expect.poll(() => page.evaluate(() => window.accessScore.map.getZoom())).not.toBe(zoomBefore);
      // The rows in What's here only read: nothing in them is a button.
      await expect(page.locator('.acs-whats-here__row button')).toHaveCount(0);
    });

  test('selecting a street fades the streets outside its region, and the collapsed band keeps the legend',
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
      // In the regions unit the swatch is the hatch, since the no-score case there is the completion floor.
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

  test('coloring by slope swaps the paint and the legend, reaches the URL, and the popup draws the profile (#5223)',
    async ({page, context, consoleErrors}) => {
      // The slope controls only exist in a sampled city, so the live config gains a gradient block, streets 1 and 3
      // gain slope fields (3 is unaudited: slope needs no labels), and the per-street profile is stubbed.
      await context.route('**/v3/api/accessScoreConfig', async (route) => {
        const config = await (await route.fetch()).json();
        config.gradient = {
          walking_surface_limit: 0.05, ramp_limit: 1 / 12, map_class_breaks: [1 / 48, 0.05, 1 / 12, 0.125],
          sources: [{dem_source: 'fixture-dem', title: 'Fixture DEM', credit: 'Elevation: Fixture Survey',
            licence: 'Public domain', url: 'https://example.org/dem', street_count: 2}],
        };
        return route.fulfill({json: config});
      });
      const slope = (mean, max) => ({
        mean_grade: mean, max_grade: max, net_grade: -mean, total_climb_meters: 0.5, total_descent_meters: 6.5,
        meters_over_5pct: 40, meters_over_8pct: 0, grade_confidence: 'high', grade_quality: 'measured',
        dem_source: 'fixture-dem',
      });
      await context.route('**/v3/api/accessScoreStreets*', (route) => {
        const streets = streetsFixture();
        Object.assign(streets.features[0].properties, slope(0.062, 0.081));
        Object.assign(streets.features[2].properties, slope(0.01, 0.015));
        return route.fulfill({json: streets});
      });
      await context.route('**/v3/api/streetGradientProfile*', (route) => route.fulfill({json: {
        street_edge_id: 1, profile: {spacing_meters: 50, elevations_meters: [104, 101.5, 98]},
      }}));

      await page.goto('/accessScore');
      await waitForAppReady(page);
      await waitForTool(page);
      const lineColor = () => page.evaluate(() => window.accessScore.map.getPaintProperty('acs-streets', 'line-color'));
      expect(JSON.stringify(await lineColor())).toContain('interpolate');
      await expect(page.locator('.acs-map-legend__grade')).toBeHidden();

      await page.locator('#acs-show-grade').check();
      expect(JSON.stringify(await lineColor())).toContain('step');
      await expect(page.locator('.acs-map-legend__grade')).toBeVisible();
      await expect(page.locator('.acs-map-legend__class')).toHaveCount(6);
      await expect(page.locator('.acs-map-legend__score')).toBeHidden();
      // The classes are a named list, not an image: a screen reader reaches each row's grades.
      const classes = page.getByRole('group', {name: 'Street slope'}).getByRole('listitem');
      await expect(classes).toHaveCount(6);
      await expect(classes.first()).toHaveText(/Under 2\.1%/);
      // Slope is drawn for every street, so the toggle that would decide nothing is off until the score returns.
      await expect(page.locator('#acs-show-unaudited')).toBeDisabled();
      await expect.poll(() => urlParam(page, 'grade')).toBe('1');
      // The credit rides on the street source, so Mapbox's own attribution control carries it.
      await expect(page.locator('.mapboxgl-ctrl-attrib')).toContainText('Elevation: Fixture Survey');

      // Regions have no slope: the ramp comes back with the unit, and the toggle leaves with it.
      await page.locator('label[for="acs-unit-regions"]').click();
      await expect(page.locator('.acs-map-legend__score')).toBeVisible();
      await expect(page.locator('#acs-grade-option')).toBeHidden();
      await page.locator('label[for="acs-unit-streets"]').click();
      await expect(page.locator('.acs-map-legend__grade')).toBeVisible();

      // A shared link opens on the slope coloring with the street's card up, profile and credit included.
      await page.goto('/accessScore?grade=1&sel=1');
      await waitForAppReady(page);
      await waitForTool(page);
      await expect(page.locator('#acs-show-grade')).toBeChecked();
      await expect(page.locator('.acs-map-legend__grade')).toBeVisible();
      const popup = page.locator('.acs-popup');
      await expect(popup).toContainText('Average 6.2% · steepest stretch 8.1%');
      await expect(popup.locator('svg.acs-profile__chart')).toBeVisible();
      await expect(popup.locator('.acs-popup__credit')).toHaveText('Elevation: Fixture Survey');

      await page.locator('#acs-show-grade').uncheck();
      await expect(page.locator('#acs-show-unaudited')).toBeEnabled();
      expect(JSON.stringify(await lineColor())).toContain('interpolate');
      await expect.poll(() => urlParam(page, 'grade')).toBeNull();
      expect(consoleErrors).toEqual([]);
    });

  test('the Slope section weighs slope into the score, makes a steep street a barrier, and rides in the URL (#5223)',
    async ({page, context, consoleErrors}) => {
      await stubGradient(context);
      await page.goto('/accessScore');
      await waitForAppReady(page);
      await waitForTool(page);

      // Folded, at the engine's own settings, and with nothing to reset. Street 1 already carries the whole weight
      // before anything is touched.
      await expect(page.locator('#acs-slope-section')).toBeVisible();
      await expect(page.locator('#acs-slope')).toBeHidden();
      await page.locator('#acs-slope-toggle').click();
      await expect(page.locator('#acs-slope-weight')).toHaveValue('1');
      await expect(page.locator('#acs-slope-weight-value')).toHaveText('×1.00');
      await expect(page.locator('#acs-slope-statistic')).toHaveValue('max_grade');
      await expect(page.locator('#acs-slope-reset')).toBeHidden();
      await expect(page.locator('#acs-slope-impact')).toHaveText('Affects 1 of 2 scored streets · 1 at the full penalty');
      const weighed = await scoreOf(page, 1);
      // Street 2 has no slope at all, so it is scored from its labels whatever the settings say.
      expect(await scoreOf(page, 2)).toBeCloseTo(0.119, 2);

      // A weight of 0 is how slope leaves the score, and the control says "Off" rather than "×0.00".
      await page.locator('#acs-slope-weight').fill('0');
      await expect(page.locator('#acs-slope-weight-value')).toHaveText('Off');
      await expect(page.locator('#acs-slope-weight-row')).toHaveClass(/acs-weight--off/);
      const flat = await scoreOf(page, 1);
      expect(flat).toBeCloseTo(0.818, 2);
      expect(weighed).toBeCloseTo(1 / (1 + Math.exp(-(Math.log(flat / (1 - flat)) - 1))), 6);
      await expect(page.locator('#acs-slope-summary')).not.toBeEmpty();
      await expect.poll(() => urlParam(page, 'slope')).toBe('w:0');
      // The counts describe what the settings reach, the same street whether or not it costs anything.
      await expect(page.locator('#acs-slope-impact')).toHaveText('Affects 1 of 2 scored streets · 1 at the full penalty');
      // And a settled change says how many streets it moved, since the map repaints with no motion of its own.
      await expect(page.locator('#acs-slope-flash')).toHaveText('Updated · 1 street changed');
      await page.locator('#acs-slope-weight').fill('1');

      // The over-limit measure uses fixed limits, so the thresholds switch off and say why.
      await page.locator('#acs-slope-statistic').selectOption('meters_over_limit');
      await expect(page.locator('#acs-slope-low')).toBeDisabled();
      await expect(page.getByRole('status').filter({hasText: 'accessibility limits of 5% and 8.3%'})).toBeVisible();
      await page.locator('#acs-slope-statistic').selectOption('max_grade');

      // The table that explains the score has a row for what slope took off it.
      await page.goto('/accessScore?sel=1');
      await waitForAppReady(page);
      await waitForTool(page);
      await expect(page.locator('.acs-popup__table')).toContainText(/Slope\s*—\s*−1\.00/);

      // A barrier at the default 12.5% leaves a street whose steepest stretch is 12% alone; at 10% it scores 0.
      await page.locator('#acs-slope-toggle').click();
      await page.locator('#acs-slope-barrier').check();
      await expect.poll(() => urlParam(page, 'slope')).toBe('b:0.125');
      expect(await scoreOf(page, 1)).toBeGreaterThan(0);
      await page.locator('#acs-slope-barrier-threshold').fill('10');
      await page.locator('#acs-slope-barrier-threshold').blur();
      await expect.poll(() => scoreOf(page, 1)).toBe(0);
      await expect.poll(() => urlParam(page, 'slope')).toBe('b:0.1');
      await expect(page.locator('#acs-slope-impact')).toContainText('1 scored 0');

      // The link restores the settings, opens the fold, and the popup says what slope did.
      await page.goto('/accessScore?slope=b:0.1&sel=1');
      await waitForAppReady(page);
      await waitForTool(page);
      await expect(page.locator('#acs-slope')).toBeVisible();
      await expect(page.locator('#acs-slope-barrier')).toBeChecked();
      await expect(page.locator('.acs-popup')).toContainText('The segment scores 0: steeper than the 10% barrier.');
      await expect(page.locator('.acs-popup__table')).toContainText('barrier: 0');

      await page.locator('#acs-slope-reset').click();
      await expect.poll(() => scoreOf(page, 1)).toBeCloseTo(weighed, 9);
      await expect.poll(() => urlParam(page, 'slope')).toBeNull();
      expect(consoleErrors).toEqual([]);
    });

  test('the map legend\'s slope classes brush the map, with ctrl-click for more, and ride in the URL (#5223)',
    async ({page, context, consoleErrors}) => {
      await stubGradient(context);
      await page.goto('/accessScore');
      await waitForAppReady(page);
      await waitForTool(page);

      // The classes only stand in for the score ramp while the streets are colored by slope.
      const classes = page.locator('.acs-map-legend__class');
      await expect(page.locator('.acs-map-legend__grade')).toBeHidden();
      await page.locator('#acs-show-grade').check();
      await expect(page.locator('.acs-map-legend__grade')).toBeVisible();
      // Five classes from four breaks, plus the row for a street with no slope at all.
      await expect(classes).toHaveCount(6);
      // The title names the statistic the score is on, so the colors cannot claim a grade the score is not using.
      await expect(page.locator('.acs-map-legend__title')).toHaveText('Street slope · Steepest stretch');

      // Street 1's steepest stretch is 12%, in the 8.3%–12.5% class; clicking it brushes the map on that class.
      const steep = classes.nth(3);
      await steep.click();
      await expect(steep).toHaveAttribute('aria-pressed', 'true');
      await expect(classes.nth(0)).toHaveClass(/acs-map-legend__class--out/);
      await expect(page.locator('#acs-dock-brush')).toBeVisible();
      await expect(page.locator('#acs-dock-brush-text')).toContainText('8.3% – 12.5%');
      await expect(page.locator('#acs-dock-brush-text')).toContainText('1 street');
      await expect.poll(() => urlParam(page, 'gc')).toBe('3');

      // Ctrl-click adds the no-slope class without dropping the first.
      await classes.nth(5).click({modifiers: ['Control']});
      await expect(classes.nth(5)).toHaveAttribute('aria-pressed', 'true');
      await expect(steep).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => urlParam(page, 'gc')).toBe('n,3');
      await expect(page.locator('#acs-dock-brush-text')).toContainText('3 streets');

      // The dock's own Clear lifts it, and the legend's rows follow.
      await page.locator('#acs-dock-brush-clear').click();
      await expect(steep).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => urlParam(page, 'gc')).toBeNull();

      // A shared link restores the selection; brushing a score range then takes the brush over.
      await page.goto('/accessScore?grade=1&gc=3');
      await waitForAppReady(page);
      await waitForTool(page);
      await expect(page.locator('.acs-map-legend__class').nth(3)).toHaveAttribute('aria-pressed', 'true');
      await page.locator('.acs-histogram__bin').nth(8).click();
      await expect(page.locator('.acs-map-legend__class').nth(3)).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => urlParam(page, 'gc')).toBeNull();
      await expect.poll(() => urlParam(page, 'b')).toBe('80-90');
      expect(consoleErrors).toEqual([]);
    });

  test('what\'s here counts the whole city, and the photo strip shows the worst clusters of the scope', async ({page}) => {
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);
    // The needle names the city the backend serves and calls the number what it is: the city's average.
    await expect(page.locator('.acs-histogram__needle-label')).toHaveText(/\S.* average: \d+$/);
    // Citywide: two curb ramps (good) and two obstacles (severe) from the fixture streets.
    await expect(page.locator('.acs-whats-here__caption')).toHaveText('citywide');
    await expect(page.locator('.acs-whats-here__row[data-type="CurbRamp"] .acs-whats-here__count')).toHaveText('2');
    await expect(page.locator('.acs-whats-here__row[data-type="Obstacle"] .acs-whats-here__count')).toHaveText('2');
    await expect(page.locator('.acs-whats-here__row[data-type="Obstacle"] .acs-whats-here__segment[data-bucket="3"]'))
      .toBeVisible();
    // Nothing selected: the strip reads the lowest-scoring region — the fixture's only one — and says so.
    await expect(page.locator('.acs-photos__caption')).toHaveText('Photos from Fixture (lowest scoring)');
    const items = page.locator('.acs-photos__item');
    await expect(items).toHaveCount(2);
    // Worst first: the severity-3 obstacle cluster, shown by its newest label, ahead of the good curb ramps; no
    // crops locally → placeholders.
    await expect(items.nth(0)).toHaveAttribute('data-label-id', '13');
    await expect(items.nth(0).locator('.lmc__placeholder')).toBeVisible();
    await expect(items.nth(0).locator('.lmc__open')).toHaveAttribute('data-ps-tooltip', /Obstacle in Path, High/);
    // With no picture there is nothing to judge, so its chips are locked.
    await expect(items.nth(0).locator('.lmc__vote--agree')).toBeDisabled();
    // A street selection narrows the strip to that street's clusters.
    await page.evaluate(() => window.accessScore.dock.setSelection({unit: 'streets', id: 1}));
    await expect(page.locator('.acs-photos__caption')).toHaveText('Photos from Cedar Lane · Street 1');
    await expect(items).toHaveCount(1);
    await expect(items.nth(0)).toHaveAttribute('data-label-id', '11');
    await expect(page.locator('.acs-whats-here__caption')).toHaveText('on Cedar Lane');
    // A vote from the thumbnail's chips lands as a static-crop validation and shows at once.
    const agree = items.nth(0).locator('.lmc__vote--agree');
    await expect(agree.locator('.lmc__vote-count')).toHaveText('2');
    await agree.click();
    await expect(agree).toHaveAttribute('aria-pressed', 'true');
    await expect(agree.locator('.lmc__vote-count')).toHaveText('3');
    await expect.poll(() => VALIDATIONS.length).toBe(1);
    expect(VALIDATIONS[0]).toMatchObject({
      label_id: 11, validation_result: 'Agree', viewer_type: 'StaticCrop', source: 'AccessScoreStrip', undone: false,
      canvas_width: 720, canvas_height: 480, canvas_x: 300, canvas_y: 200,
    });
    // The same chip again clears the vote.
    await agree.click();
    await expect(agree).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => VALIDATIONS.length).toBe(2);
    expect(VALIDATIONS[1]).toMatchObject({validation_result: 'Agree', undone: true});
    // A thumbnail opens the shared label card.
    await items.nth(0).locator('.lmc__open').click();
    await expect(page.locator('#label-modal')).toBeVisible();
  });

  test('reset everything returns the weights, the selection, the brush and the URL to the opening state', async ({page}) => {
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);
    await page.locator('#acs-weights-toggle').click();
    await page.locator('#acs-weight-CurbRamp').fill('0');
    await page.locator('#acs-weight-CurbRamp').dispatchEvent('input');
    await page.locator('#acs-weight-CurbRamp').dispatchEvent('change');
    await page.evaluate(() => window.accessScore.dock.setSelection({unit: 'streets', id: 1}));
    await page.evaluate(() => window.accessScore.mapView.setSelection({unit: 'streets', id: 1}));
    await page.locator('.acs-histogram__bin').nth(1).click();
    await selectPlace(page);
    await expect(page.locator('.ps-search-pin')).toHaveCount(1);
    await expect.poll(() => urlParam(page, 'w')).toContain('CurbRamp:0');
    await expect.poll(() => urlParam(page, 'b')).toBe('10-20');
    await page.locator('#acs-reset-all').click();
    expect(await scoreOf(page, 1)).toBeCloseTo(0.8176, 3);
    await expect(page.locator('#acs-reset')).toBeHidden();
    await expect(page.locator('.acs-popup')).toHaveCount(0);
    await expect(page.locator('#acs-dock-brush')).toBeHidden();
    // The searched place is part of "everything" (#5321).
    await expect(page.locator('.ps-search-pin')).toHaveCount(0);
    await expect(page.locator('#labelmap-search-box input[role="combobox"]')).toHaveValue('');
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
    await expect(items.nth(0)).toHaveAttribute('data-label-id', '13');
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
    expect(await page.evaluate(() => window.accessScore.dock.state))
      .toEqual({open: false, brush: {kind: 'score', from: 8, to: 9}, focus: null});

    await page.locator('#acs-dock-toggle').click();
    await expect(page.locator('#acs-dock-body')).toBeVisible();
    await expect(page.locator('.acs-histogram__bin').nth(8)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#acs-dock-caption')).toContainText('3 streets');
    await expect.poll(() => urlParam(page, 'dock')).toBeNull();
  });

  test('a searched place can be taken back off the map (#5321)', async ({page}) => {
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);

    const pin = page.locator('.ps-search-pin');
    const input = page.locator('#labelmap-search-box input[role="combobox"]');
    await selectPlace(page);
    await expect(pin).toHaveCount(1);
    await expect(pin).toHaveAccessibleName('Fixture Library');

    // The search box's own ✕ is the pointer route: it drops the pin along with the text.
    await page.locator('mapbox-search-box [aria-label="Clear"]').click();
    await expect(pin).toHaveCount(0);
    await expect(input).toHaveValue('');

    // Escape is the keyboard route to the same clear, and it works with focus in the search field.
    await selectPlace(page);
    await expect(pin).toHaveCount(1);
    await input.focus();
    await page.keyboard.press('Escape');
    await expect(pin).toHaveCount(0);
  });

  test('the pin opens the invitation and focuses its button; only the button leaves for Explore (#5321)',
    async ({page}) => {
      await page.goto('/accessScore');
      await waitForAppReady(page);
      await waitForTool(page);
      await selectPlace(page);

      const pin = page.locator('.ps-search-pin');
      const button = page.locator('.ps-explore-here-popup .explore-here-button');
      await pin.click();
      await expect(button).toBeVisible();
      await expect(button).toBeFocused();
      await expect(page).toHaveURL(/\/accessScore/);

      // Escape steps back out to the pin, leaving the place in place.
      await page.keyboard.press('Escape');
      await expect(button).toHaveCount(0);
      await expect(pin).toBeFocused();

      await pin.click();
      await button.click();
      // The server re-encodes the space on its way in, so match either spelling.
      await expect(page).toHaveURL(/\/explore\?lat=40\.8805&lng=-74\.0105&placeName=Fixture(%20|\+)Library/);
    });

  test('Escape that closes the search suggestions keeps the searched place (#5321)', async ({page, context}) => {
    // Registered after beforeEach's stubMapbox, so it wins over the 204 catch-all for suggest requests only. Typing
    // is the point here: the list has to be opened by the real Search JS for its own Escape handler to be in play.
    await context.route(/https:\/\/api\.mapbox\.com\/search\/searchbox\/v1\/suggest.*/, (route) => route.fulfill({
      json: {
        suggestions: [{name: 'Second Library', mapbox_id: 'fixture-2', feature_type: 'poi',
          place_formatted: 'Teaneck, NJ', full_address: '2 Cedar Ln, Teaneck, NJ 07666'}],
        attribution: 'fixture', url: 'fixture',
      },
    }));
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);

    await selectPlace(page);
    const pin = page.locator('.ps-search-pin');
    await expect(pin).toHaveCount(1);

    const input = page.locator('#labelmap-search-box input[role="combobox"]');
    // Typed over the selected text rather than after emptying the box: the SDK treats an emptied box as its ✕.
    await input.selectText();
    await input.pressSequentially('Second Lib', {delay: 40});
    const option = page.locator('[role="option"]').filter({hasText: 'Second Library'});
    await expect(option).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(option).toBeHidden();
    await expect(pin).toHaveCount(1);
    await expect(input).toHaveValue('Second Lib');

    // The list is closed now, so the next Escape is the clear.
    await page.keyboard.press('Escape');
    await expect(pin).toHaveCount(0);
  });

  test('the places layer starts folded and off, and its toggles reach the map and the URL (#5311)', async ({page, consoleErrors}) => {
    await page.goto('/accessScore');
    await waitForAppReady(page);
    await waitForTool(page);
    await page.waitForFunction(() => document.querySelector('.acs-place-row[data-category="transit"] .acs-place__count')?.textContent === '1');

    // Folded like the weights, and nothing on: the scores are the map until a reader adds places.
    const fold = page.locator('#acs-places-toggle');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#acs-place-categories')).toBeHidden();
    await expect(page.locator('#acs-places-summary')).toHaveText('');
    const visibility = () => page.evaluate(() => ({
      school: window.accessScore.map.getLayoutProperty('acs-places-school', 'visibility'),
      transit: window.accessScore.map.getLayoutProperty('acs-places-transit', 'visibility'),
    }));
    expect(await visibility()).toEqual({school: 'none', transit: 'none'});
    expect(await urlParam(page, 'pc')).toBeNull();

    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    const rows = page.locator('.acs-place-row');
    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toHaveAttribute('data-category', 'school');
    await expect(rows.first().locator('.acs-place__count')).toHaveText('1');
    await expect(rows.nth(1).locator('.acs-place__count')).toHaveText('0');
    await expect(page.locator('#acs-place-transit')).not.toBeChecked();

    // A ticked category shows at whatever zoom the map is at: the tool opens at city scale, and a reader who asks
    // for transit stops there should see them.
    await page.locator('#acs-place-transit').check();
    expect(await visibility()).toEqual({school: 'none', transit: 'visible'});
    await expect.poll(() => urlParam(page, 'pc')).toBe('transit');
    await expect(page.locator('#acs-places-summary')).toHaveText('1 of 7');

    // "Only" turns every other row off in one click; the heading's action reads "Select all" until every row is
    // on, and "Deselect all" then.
    const toggleAll = page.locator('#acs-places-toggle-all');
    await expect(toggleAll).toHaveText('Select all');
    await page.locator('.acs-place-row[data-category="school"]').hover();
    await page.locator('.acs-place-row[data-category="school"] .filter-sidebar__only').click();
    expect(await visibility()).toEqual({school: 'visible', transit: 'none'});
    await expect.poll(() => urlParam(page, 'pc')).toBe('school');
    await toggleAll.click();
    expect(await visibility()).toEqual({school: 'visible', transit: 'visible'});
    await expect.poll(() => urlParam(page, 'pc')).toBe('all');
    await expect(toggleAll).toHaveText('Deselect all');
    await expect(page.locator('#acs-places-summary')).toHaveText('7 of 7');

    await toggleAll.click();
    expect(await visibility()).toEqual({school: 'none', transit: 'none'});
    await expect(page.locator('#acs-place-school')).not.toBeChecked();
    await expect.poll(() => urlParam(page, 'pc')).toBeNull();
    await expect(toggleAll).toHaveText('Select all');

    // A link with places on opens the fold, as one with custom weights opens the sliders.
    await page.goto('/accessScore?pc=school,transit');
    await waitForAppReady(page);
    await waitForTool(page);
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#acs-place-transit')).toBeChecked();
    await expect.poll(visibility).toEqual({school: 'visible', transit: 'visible'});
    await page.locator('#acs-reset-all').click();
    await expect.poll(visibility).toEqual({school: 'none', transit: 'none'});
    await expect.poll(() => urlParam(page, 'pc')).toBeNull();
    expect(consoleErrors).toEqual([]);
  });

  test('a place card is its nearest street\'s card headed by the place, and round-trips through the URL (#5311)',
    async ({page, consoleErrors}) => {
      await page.goto('/accessScore');
      await waitForAppReady(page);
      await waitForTool(page);
      await page.waitForFunction(() => window.accessScore.placesLayer.place(1) !== null);

      await page.evaluate(() => window.accessScore.selectPlace(1));
      const card = page.locator('.acs-popup');
      await expect(card.locator('.acs-popup__title')).toHaveText('Fixture High School');
      // The street card's shape, headed by the place: the street, the score, and what drives it.
      await expect(card.locator('.acs-popup__subtitle').first()).toHaveText('Cedar Lane · Street 1');
      await expect(card.locator('.acs-popup__score')).toHaveText('81.8');
      await expect(card.locator('.acs-popup__subtitle').nth(1)).toHaveText('What drives this score');
      await expect(card.locator('table')).toBeVisible();
      await expect(card.locator('[data-acs-hop="ExploreHere"]')).toHaveAttribute('href', '/explore?lat=40.88050&lng=-74.00890');
      // A place is not a street selection: it never lands in `sel`, and the dock keeps its city scope.
      await expect.poll(() => urlParam(page, 'place')).toBe('40.88050,-74.00890');
      await expect.poll(() => urlParam(page, 'placeName')).toBe('Fixture High School');
      expect(await urlParam(page, 'sel')).toBeNull();

      await page.locator('#acs-weights-toggle').click();
      await page.locator('#acs-weight-CurbRamp').fill('0');
      await expect(card.locator('.acs-popup__score')).toHaveText('50.0');
      expect(await urlParam(page, 'sel')).toBeNull();

      // A place with no street near it says so; an unnamed one is titled by its category, and one on an unaudited
      // street has no score and no table.
      await page.evaluate(() => window.accessScore.selectPlace(3));
      await expect(page.locator('.acs-popup .acs-popup__title')).toHaveText('Transit stops');
      await expect(page.locator('.acs-popup .acs-popup__meta').first()).toHaveText('Fixture');
      await expect(page.locator('.acs-popup .acs-popup__score')).toHaveText('Not yet audited');
      await expect(page.locator('.acs-popup table')).toHaveCount(0);
      await page.evaluate(() => window.accessScore.selectPlace(2));
      await expect(page.locator('.acs-popup')).toContainText('No street within 250 m.');
      await expect(page.locator('.acs-popup .acs-popup__score')).toHaveCount(0);

      // A shared link reopens the marker's card without a click, and draws its category so the card sits on a marker.
      await page.goto('/accessScore?place=40.88050,-74.00890&placeName=Fixture+High+School');
      await waitForAppReady(page);
      await waitForTool(page);
      await expect(page.locator('.acs-popup .acs-popup__title')).toHaveText('Fixture High School');
      await expect(page.locator('#acs-place-school')).toBeChecked();
      await expect.poll(() => urlParam(page, 'pc')).toBe('school');
      expect(consoleErrors).toEqual([]);
    });
});
