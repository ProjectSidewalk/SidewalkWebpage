/**
 * Map credit links open in a new tab rather than leaving Project Sidewalk (#5856).
 *
 * The fix keys on Mapbox's `.mapboxgl-ctrl-attrib` class, which isn't public API, so this catches an upgrade that
 * renames it; the fix would otherwise stop working without an error.
 */
const {test, expect, stubMapbox, stubMapBaseLayers, waitForAppReady} = require('./fixtures');

// Mapbox only credits a source some layer draws from, so unlike the shared stub style this one has a layer.
const STYLE = {
  version: 8,
  name: 'ci-stub-credits',
  sources: {composite: {type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8'}},
  glyphs: 'https://api.mapbox.com/fonts/v1/ci-stub/{fontstack}/{range}.pbf',
  layers: [{id: 'road', type: 'line', source: 'composite', 'source-layer': 'road'}],
};

// Mapbox Streets' real credits.
const TILEJSON = {
  tilejson: '2.2.0',
  name: 'ci-stub-credits',
  tiles: ['https://api.mapbox.com/v4/ci-stub/{z}/{x}/{y}.vector.pbf'],
  vector_layers: [{id: 'road', fields: {}}],
  attribution: [
    '<a href="https://www.mapbox.com/about/maps/" target="_blank" title="Mapbox">&copy; Mapbox</a>',
    '<a href="https://www.openstreetmap.org/about/" target="_blank" title="OpenStreetMap">&copy; OpenStreetMap</a>',
    '<a class="mapbox-improve-map" href="https://www.mapbox.com/contribute/" target="_blank"',
    'title="Improve this map">Improve this map</a>',
  ].join(' '),
};

test.describe('map credit links', () => {
  test.beforeEach(async ({context}) => {
    await stubMapbox(context);
    // Registered after stubMapbox, so these win over its style and TileJSON routes.
    await context.route(/https:\/\/api\.mapbox\.com\/v4\/.*\.json.*/, (route) => route.fulfill({json: TILEJSON}));
    await context.route(/https:\/\/api\.mapbox\.com\/styles\/v1\/.*/, (route) => route.fulfill({json: STYLE}));
    await stubMapBaseLayers(context);
    await context.route('**/labels/all*', (route) =>
      route.fulfill({json: {type: 'FeatureCollection', features: []}}));
    // The new tab never reaches the real sites.
    await context.route(/^https:\/\/(www\.openstreetmap\.org|www\.mapbox\.com|apps\.mapbox\.com)\//, (route) =>
      route.fulfill({contentType: 'text/html', body: '<!doctype html><title>stub</title>'}));
  });

  for (const name of ['© OpenStreetMap', '© Mapbox', 'Improve this map']) {
    test(`"${name}" opens in a new tab and leaves the map where it was`, async ({page, context}) => {
      await page.goto('/labelMap');
      await waitForAppReady(page);
      const link = page.locator('.mapboxgl-ctrl-attrib a', {hasText: name});
      await expect(link).toBeAttached();
      // A narrow map collapses the credits behind an "i" button.
      const toggle = page.locator('.mapboxgl-ctrl-attrib-button');
      if (await toggle.isVisible()) await toggle.click();

      const [newTab] = await Promise.all([context.waitForEvent('page'), link.click()]);

      await newTab.waitForLoadState();
      expect(new URL(newTab.url()).host).toBe(new URL(await link.getAttribute('href')).host);
      expect(new URL(page.url()).pathname).toBe('/labelMap');
      await newTab.close();
    });
  }
});
