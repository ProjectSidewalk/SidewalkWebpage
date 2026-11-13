/**
 * Tests for the street layer every street-drawing map shares, frontend/js/ps-map/addStreetsToMap.js (#5840).
 *
 * The layer is how a mapper sees which streets still need work, so these pin its colors and dashes per audit state,
 * the counts the sidebar reports, and the hover and click behavior: one street lit at a time, the re-audit card for
 * an outdated street, the Explore popup, and the logged click on that popup's link.
 */

import { loadModules, mockModule } from './loader.js';
import { FakeMap, fakeMapboxgl } from './support/psMapHarness.js';

const mapboxgl = fakeMapboxgl();
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));
mockModule('i18next', () => ({ default: { t: (key, opts) => `${key}:${opts?.streetId}` } }));

/** The re-audit card the layer was built with, newest last. */
const cards = [];
mockModule('frontend/js/ps-map/StreetReauditCard.js', () => ({
  StreetReauditCard: class {
    constructor(map, options) {
      this.options = options;
      this.showingFor = null;
      this.isShowingFor = (id) => id === this.showingFor;
      this.scheduleFor = vi.fn();
      this.cancelScheduled = vi.fn();
      this.scheduleHide = vi.fn();
      cards.push(this);
    }
  },
}));

const { addStreetsToMap } = await loadModules('frontend/js/ps-map/addStreetsToMap.js');

/**
 * One street feature, as /contribution/streets and the label map's street feed send it.
 * @param {number} id - Its street_edge_id.
 * @param {object} [state] - Its `audited` and `outdated` flags.
 * @returns {GeoJSON.Feature} The feature.
 */
const street = (id, state = {}) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[-122.3, 47.6], [-122.31, 47.61]] },
  properties: { street_edge_id: id, audited: false, ...state },
});

/** @returns {GeoJSON.FeatureCollection} An audited, an outdated, and two unaudited streets. */
const streets = () => ({
  type: 'FeatureCollection',
  features: [street(1, { audited: true }), street(2, { outdated: true }), street(3), street(4)],
});

/**
 * A pointer event over one street of the layer, as Mapbox hands it to a layer handler.
 * @param {GeoJSON.Feature} feature - The street under the pointer.
 * @returns {object} The event.
 */
const over = (feature) => ({ features: [{ ...feature, layer: { id: 'streets' } }], lngLat: { lng: 1, lat: 2 } });

describe('addStreetsToMap', () => {
  let map;
  let logged;

  beforeEach(() => {
    document.body.innerHTML = '<div id="streets-map"><canvas class="mapboxgl-canvas"></canvas></div>';
    document.documentElement.style.setProperty('--color-street-audited', '#111111');
    document.documentElement.style.setProperty('--color-street-unaudited', '#eeeeee');
    map = new FakeMap({ container: 'streets-map' });
    cards.length = 0;
    mapboxgl.popups.length = 0;
    logged = [];
    vi.stubGlobal('logWebpageActivity', (activity) => logged.push(activity));
  });

  test('draws the streets hidden until the sidebar shows them, colored from the street tokens', async () => {
    await addStreetsToMap(map, streets(), { mapName: 'streets-map', differentiateUnauditedStreets: true });
    const layer = map.layers.streets;
    expect(map.sources.streets.promoteId).toBe('street_edge_id');
    expect(layer.layout.visibility).toBe('none');
    expect(layer.paint['line-color'].slice(2)).toEqual(['#eeeeee', '#111111']);
    // Each per-state test starts with the map's own opt-in, so a map that doesn't opt in draws every street alike.
    expect(layer.paint['line-color'][1][1]).toBe(true);
    expect(layer.paint['line-dasharray'][1][1]).toBe(true);
  });

  test('a map that does not differentiate streets switches every per-state style off', async () => {
    await addStreetsToMap(map, streets(), { mapName: 'streets-map', differentiateUnauditedStreets: false });
    expect(map.layers.streets.paint['line-color'][1][1]).toBe(false);
    expect(map.layers.streets.paint['line-dasharray'][1][1]).toBe(false);
  });

  test('resolves with how many streets fall in each audit state', async () => {
    const counts = await addStreetsToMap(map, streets(), { mapName: 'streets-map' });
    expect(counts).toEqual({ audited: 1, outdated: 1, unaudited: 2 });
  });

  test('waits for the layer to exist before resolving, if the style has not taken it yet', async () => {
    map.addLayer = () => {};
    let resolved = false;
    const done = addStreetsToMap(map, streets(), { mapName: 'streets-map' }).then(() => { resolved = true; });
    await map.fire('sourcedataloading');
    expect(resolved).toBe(false);
    map.layers.streets = { id: 'streets' };
    await map.fire('sourcedataloading');
    await done;
    expect(resolved).toBe(true);
  });

  test('a map without interactive streets binds no hover or click', async () => {
    await addStreetsToMap(map, streets(), { mapName: 'streets-map' });
    expect(Object.keys(map.handlers)).toEqual([]);
    expect(cards).toHaveLength(0);
  });

  describe('with interactive streets', () => {
    /**
     * @param {object} [params] - Extra createPSMap params.
     * @returns {Promise<object>} The street counts.
     */
    const addInteractive = (params = {}) => addStreetsToMap(map, streets(),
      { mapName: 'streets-map', interactiveStreets: true, logClicks: true, ...params });
    const canvasCursor = () => document.querySelector('.mapboxgl-canvas').style.cursor;

    test('clicking a street opens a popup linking to Explore on it', async () => {
      await addInteractive();
      await map.fire('click:streets', over(street(3)));
      const [popup] = mapboxgl.popups;
      expect(popup.open).toBe(true);
      expect(popup.lngLat).toEqual({ lng: 1, lat: 2 });
      expect(popup.html).toBe('common:explore-street-link:3');
    });

    test('no popup opens over a street whose re-audit card already shows the Explore link', async () => {
      await addInteractive();
      cards[0].showingFor = 2;
      await map.fire('click:streets', over(street(2, { outdated: true })));
      expect(mapboxgl.popups[0].open).toBe(false);
    });

    test('hovering lights one street at a time and shows the pointer', async () => {
      await addInteractive();
      await map.fire('mousemove:streets', over(street(3)));
      expect(map.stateOf(3)).toEqual({ hover: true });
      expect(canvasCursor()).toBe('pointer');

      await map.fire('mousemove:streets', over(street(3)));
      expect(map.featureStates).toHaveLength(1);

      await map.fire('mousemove:streets', over(street(4)));
      expect(map.stateOf(3)).toEqual({ hover: false });
      expect(map.stateOf(4)).toEqual({ hover: true });
    });

    test('hovering an outdated street schedules its re-audit card; any other street lets it go', async () => {
      await addInteractive();
      const card = cards[0];
      expect(card.options).toEqual({ mapName: 'streets-map', logClicks: true });

      await map.fire('mousemove:streets', over(street(2, { outdated: true })));
      expect(card.scheduleFor).toHaveBeenCalledWith(2, { lng: 1, lat: 2 });

      await map.fire('mousemove:streets', over(street(3)));
      expect(card.cancelScheduled).toHaveBeenCalled();
      expect(card.scheduleHide).toHaveBeenCalled();
    });

    test('leaving the layer unlights the street, restores the cursor, and lets the card go', async () => {
      await addInteractive();
      await map.fire('mousemove:streets', over(street(2, { outdated: true })));
      await map.fire('mouseleave:streets');
      expect(map.stateOf(2)).toEqual({ hover: false });
      expect(canvasCursor()).toBe('');
      expect(cards[0].scheduleHide).toHaveBeenCalledTimes(1);
    });

    test('a leave with nothing hovered, as a filter change fires, still restores the cursor', async () => {
      await addInteractive();
      await map.fire('mouseleave:streets');
      expect(map.featureStates).toEqual([]);
      expect(canvasCursor()).toBe('');
    });

    test('clicking the popup link logs the street and its audit state', async () => {
      await addInteractive();
      map.getContainer().insertAdjacentHTML('beforeend', '<a class="street-selection-trigger" streetId="2"></a>');
      map.getContainer().querySelector('.street-selection-trigger').click();
      expect(logged).toEqual(['Click_module=streets-map_streetId=2_audited=false_outdated=true_target=explore']);
    });

    test('with click logging off, the popup link logs nothing and the card is told so', async () => {
      await addInteractive({ logClicks: false });
      map.getContainer().insertAdjacentHTML('beforeend', '<a class="street-selection-trigger" streetId="2"></a>');
      map.getContainer().querySelector('.street-selection-trigger').click();
      expect(logged).toEqual([]);
      expect(cards[0].options.logClicks).toBe(false);
    });
  });
});
