/**
 * The deployment-cities layer on /cities, the home page and the API docs (frontend/js/ps-map/addCitiesToMap.js, #5840).
 *
 * The popup's stat reads are pinned in addCitiesToMapPopup.test.js; these cover the rest of what a visitor sees: which
 * deployments get a dot, the hover highlight, the world view the map opens on, and a popup that stays right when a
 * stats request fails or a slow one is overtaken by a later click.
 */

import { metricDistanceUtil } from './fakes.js';
import { loadModules, mockModule, useUtil } from './loader.js';
import { flush, routeFetch } from './support/routeFetch.js';
import { FakeMap, fakeMapboxgl } from './support/psMapHarness.js';

const mapboxgl = fakeMapboxgl();
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));
mockModule('i18next', () => ({ default: { t: (key, opts) => (opts?.val === undefined ? key : String(opts.val)) } }));
useUtil(metricDistanceUtil);

const { addCitiesToMap } = await loadModules('frontend/js/ps-map/addCitiesToMap.js');

// Mirrors app/views/common/cityPopupTemplate.scala.html, only the parts the JS touches.
const POPUP_TEMPLATE = `
  <template id="city-popup-template">
    <h3 class="popup-title"></h3>
    <div class="popup-stats-grid">
      <div data-stat="distance">-</div><div data-stat="labels">-</div><div data-stat="validations">-</div>
    </div>
    <a href="#" class="popup-link city-selection-trigger"></a>
  </template>`;

/**
 * One city as /v3/api/cities?filetype=geojson sends it.
 * @param {string} id - Its city_id.
 * @param {[number, number]} coordinates - Its [lng, lat].
 * @param {object} [props] - Properties to add or replace.
 * @returns {GeoJSON.Feature<GeoJSON.Point>} The feature.
 */
const city = (id, coordinates, props = {}) => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates },
  properties: {
    city_id: id, city_name_short: id, city_name_formatted: `${id}, XX`, url: `https://${id}.example.org`,
    visibility: 'public', ...props,
  },
});

/** @returns {GeoJSON.FeatureCollection<GeoJSON.Point>} Two public cities and one study deployment. */
const cities = () => ({
  type: 'FeatureCollection',
  features: [city('seattle', [-122.3, 47.6]), city('chicago', [-87.6, 41.9]), city('crowdstudy', [0, 0])],
});

/**
 * @param {GeoJSON.Feature} feature - The city under the pointer.
 * @returns {object} A Mapbox layer event over it.
 */
const over = (feature) => ({ features: [feature] });

describe('addCitiesToMap', () => {
  let map;

  beforeEach(() => {
    document.body.innerHTML = POPUP_TEMPLATE;
    map = new FakeMap();
    mapboxgl.popups.length = 0;
  });

  test('draws a dot per deployment, leaving out the study deployments that cover real ones', async () => {
    const data = cities();
    await addCitiesToMap(map, data, { mapName: 'cities-map' });
    expect(map.sources.cities.data.features.map((f) => f.id)).toEqual(['seattle', 'chicago']);
    expect(map.sources.cities.promoteId).toBe('city_id');
    expect(map.layers.cities.type).toBe('circle');
  });

  test('opens on the world view, fitted to every city and animated by default', async () => {
    await addCitiesToMap(map, cities(), { mapName: 'cities-map' });
    expect(map.view).toEqual({ minZoom: null, maxZoom: 10, projection: 'mercator', maxBounds: null });
    expect(map.fits).toEqual([{ bounds: [[-122.3, 41.9], [-87.6, 47.6]], options: { padding: 50, animate: true } }]);
  });

  test('a page that builds the map mid-scroll gets the world view without the flight', async () => {
    await addCitiesToMap(map, cities(), { mapName: 'cities-map', animateCityFit: false });
    expect(map.fits[0].options.animate).toBe(false);
  });

  test('with no cities to show, opens the world view without fitting to nothing', async () => {
    await addCitiesToMap(map, { type: 'FeatureCollection', features: [] }, { mapName: 'cities-map' });
    expect(map.view.maxZoom).toBe(10);
    expect(map.fits).toEqual([]);
  });

  test('waits for the layer to exist before resolving, if the style has not taken it yet', async () => {
    map.addLayer = () => {};
    let resolved = false;
    const done = addCitiesToMap(map, cities(), { mapName: 'cities-map' }).then(() => { resolved = true; });
    await map.fire('sourcedataloading');
    await flush();
    expect(resolved).toBe(false);
    map.layers.cities = { id: 'cities' };
    await map.fire('sourcedataloading');
    await done;
    expect(resolved).toBe(true);
  });

  test('hovering lights one city at a time; leaving puts it and the cursor back', async () => {
    const data = cities();
    await addCitiesToMap(map, data, { mapName: 'cities-map' });
    const [seattle, chicago] = data.features;

    await map.fire('mousemove:cities', over(seattle));
    expect(map.stateOf('seattle')).toEqual({ hover: true });
    expect(map.getCanvas().style.cursor).toBe('pointer');

    await map.fire('mousemove:cities', over(seattle));
    expect(map.featureStates).toHaveLength(1);

    await map.fire('mousemove:cities', over(chicago));
    expect(map.stateOf('seattle')).toEqual({ hover: false });
    expect(map.stateOf('chicago')).toEqual({ hover: true });

    await map.fire('mouseleave:cities');
    expect(map.stateOf('chicago')).toEqual({ hover: false });
    expect(map.getCanvas().style.cursor).toBe('');

    // A second leave, with nothing lit, changes nothing.
    const statesBefore = map.featureStates.length;
    await map.fire('mouseleave:cities');
    expect(map.featureStates).toHaveLength(statesBefore);
  });

  describe('the city popup', () => {
    const cell = (stat) => mapboxgl.popups[0].content.querySelector(`[data-stat="${stat}"]`).textContent;

    test('shows a loading line at once, then the city name and its Explore link', async () => {
      routeFetch({ 'https://seattle.example.org/v3/api/overallStats': { validations: {} } });
      await addCitiesToMap(map, cities(), { mapName: 'cities-map' });
      const click = map.fire('click:cities', over(city('seattle', [-122.3, 47.6])));
      expect(mapboxgl.popups[0].html).toBe('<div class="popup-loading">common:cities-map.loading-stats</div>');
      expect(mapboxgl.popups[0].lngLat).toEqual([-122.3, 47.6]);
      await click;

      const content = mapboxgl.popups[0].content;
      expect(content.querySelector('.popup-title').textContent).toBe('seattle, XX');
      const link = content.querySelector('.popup-link');
      expect(link.getAttribute('href')).toBe('https://seattle.example.org/explore');
      expect(link.getAttribute('cityId')).toBe('seattle');
    });

    test('a city with no stats yet reads zero everywhere, its small distance to a decimal place', async () => {
      routeFetch({ 'https://seattle.example.org/v3/api/overallStats': { validations: {} } });
      await addCitiesToMap(map, cities(), { mapName: 'cities-map' });
      await map.fire('click:cities', over(city('seattle', [-122.3, 47.6])));
      expect([cell('distance'), cell('labels'), cell('validations')]).toEqual(['0.0 km', '0', '0']);
    });

    test('when the stats request fails, the popup still opens with its placeholders', async () => {
      routeFetch({ 'https://seattle.example.org/v3/api/overallStats': { status: 500 } });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      await addCitiesToMap(map, cities(), { mapName: 'cities-map' });
      await map.fire('click:cities', over(city('seattle', [-122.3, 47.6])));
      expect(consoleError).toHaveBeenCalledWith('Failed to fetch city stats:', expect.any(Error));
      expect(cell('labels')).toBe('-');
    });

    test('a slow answer for one city does not overwrite the popup of a city clicked after it', async () => {
      let answerSeattle;
      routeFetch({
        'https://seattle.example.org/': () => new Promise((resolve) => { answerSeattle = resolve; }),
        'https://chicago.example.org/': { km_explored: 250, labels: { count: 9 }, validations: {} },
      });
      await addCitiesToMap(map, cities(), { mapName: 'cities-map' });
      const first = map.fire('click:cities', over(city('seattle', [-122.3, 47.6])));
      await map.fire('click:cities', over(city('chicago', [-87.6, 41.9])));
      answerSeattle({ km_explored: 1, labels: { count: 1 }, validations: {} });
      await first;
      expect(mapboxgl.popups[0].content.querySelector('.popup-title').textContent).toBe('chicago, XX');
      expect(cell('distance')).toBe('250 km');
    });
  });
});
