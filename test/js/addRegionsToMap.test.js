/**
 * Tests frontend/js/ps-map/addRegionsToMap.js, which draws the neighborhood polygons on the home page, /labelMap and
 * the dashboards. The home page colors them by how much is explored and shows a hover popup that invites people to
 * help (or re-explore, #4384), and its "click here" links are logged so we can tell which pitch worked (#5840).
 */

import { loadModules, mockModule, useUtil } from './loader.js';

// Each key comes back as a readable marker carrying the number it was given; the "click" calls build a real link so
// the logging tests can click it.
mockModule('i18next', () => ({ default: {
  t: (key, opts = {}) => {
    if (key.includes('click-to')) return `<a class="region-selection-trigger" regionId="${opts.regionId}">${key}</a>`;
    const n = opts.n ?? opts.count ?? opts.percent;
    return n === undefined ? key : `${key}=${n}`;
  },
} }));

/** The popups built, newest last, so a test can read what the hover popup showed. */
let popups;

/** A mapboxgl.Popup stand-in that keeps its HTML in a real element with a close button, as Mapbox renders it. */
class FakePopup {
  /** Builds the popup's content element with the close button the code wires up. */
  constructor() {
    this._content = document.createElement('div');
    this.html = '';
    this.added = false;
    popups.push(this);
  }

  /**
   * @param {string} html - The popup's markup.
   * @returns {FakePopup} This popup, for chaining.
   */
  setHTML(html) {
    this.html = html;
    this._content.innerHTML = `${html}<button class="mapboxgl-popup-close-button"></button>`;
    return this;
  }

  /**
   * @param {{lng: number, lat: number}} lngLat - Where the popup sits.
   * @returns {FakePopup} This popup, for chaining.
   */
  setLngLat(lngLat) {
    this.lngLat = lngLat;
    return this;
  }

  /** @returns {FakePopup} This popup, now shown. */
  addTo() {
    this.added = true;
    return this;
  }

  /** Hides the popup. */
  remove() {
    this.added = false;
  }
}

/**
 * A map that records its sources, layers, handlers and hover state, with a real container for clicks to bubble to.
 * @param {object} [options]
 * @param {boolean} [options.layersReady=true] - Whether getLayer finds the region layers right away.
 * @returns {object} The fake map; `handlers` is keyed `type` or `type:layer`, `hover` is region id to hover state.
 */
function makeFakeMap({ layersReady = true } = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const layers = new Map();
  const map = {
    handlers: {},
    hover: {},
    sources: {},
    layers,
    ready: layersReady,
    addSource(id, source) { this.sources[id] = source; },
    addLayer(layer) { layers.set(layer.id, layer); },
    getLayer(id) { return this.ready ? layers.get(id) : undefined; },
    on(type, layerOrCb, maybeCb) { this.handlers[maybeCb ? `${type}:${layerOrCb}` : type] = maybeCb || layerOrCb; },
    setFeatureState({ id }, { hover }) { this.hover[id] = hover; },
    getContainer() { return container; },
  };
  return map;
}

/**
 * A square region polygon as /regions serves it.
 * @param {number} regionId - The region's id.
 * @param {string} [name] - Its display name.
 * @returns {GeoJSON.Feature} The feature.
 */
function regionFeature(regionId, name = `Region ${regionId}`) {
  return {
    type: 'Feature',
    properties: { region_id: regionId, name },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
  };
}

/**
 * One row of /regions/completionRates.
 * @param {number} regionId - The region's id.
 * @param {object} fields - rate (0–1), and distances in meters.
 * @returns {object} The completion rate row.
 */
function rate(regionId, { rate: r, total = 10000, completed = total * r, outdated }) {
  const row = { region_id: regionId, rate: r, total_distance_m: total, completed_distance_m: completed };
  if (outdated !== undefined) row.outdated_distance_m = outdated;
  return row;
}

describe('addRegionsToMap', () => {
  let addRegionsToMap;
  let metric;

  beforeEach(async () => {
    document.body.innerHTML = '';
    popups = [];
    metric = true;
    window.logWebpageActivity = vi.fn();
    useUtil({ isMetric: () => metric });
    mockModule('frontend/js/common/mapboxgl.js', () => ({ default: { Popup: FakePopup } }));
    ({ addRegionsToMap } = await loadModules('frontend/js/ps-map/addRegionsToMap.js'));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.logWebpageActivity;
  });

  /**
   * Draws the given regions on a fresh fake map.
   * @param {Array<[GeoJSON.Feature, object]>} pairs - Each region with its completion rate row.
   * @param {object} [params] - Overrides for the home page's settings.
   * @param {object} [mapOptions] - Passed to makeFakeMap.
   * @returns {{map: object, geojson: GeoJSON.FeatureCollection, done: Promise<void>}} The map, the (mutated) regions,
   *   and the promise addRegionsToMap returned.
   */
  function draw(pairs, params = {}, mapOptions = {}) {
    const map = makeFakeMap(mapOptions);
    const geojson = { type: 'FeatureCollection', features: pairs.map(([f]) => f) };
    const done = addRegionsToMap(map, geojson, pairs.map(([, r]) => r), {
      mapName: 'home-map', regionFillMode: 'completionRate', regionTooltip: 'completionRate', logClicks: true,
      ...params,
    });
    return { map, geojson, done };
  }

  /**
   * Hovers the mouse over a region.
   * @param {object} map - The fake map.
   * @param {GeoJSON.Feature} feature - The region under the mouse.
   */
  const hover = (map, feature) => map.handlers['mousemove:region-polygons']({ features: [feature] });

  describe('coloring', () => {
    test('home colors each region darker the more of it is explored, and near-black when done', () => {
      const regions = [
        [regionFeature(1), rate(1, { rate: 0.05 })],
        [regionFeature(2), rate(2, { rate: 0.55 })],
        [regionFeature(3), rate(3, { rate: 1 })],
      ];
      const { geojson } = draw(regions);
      const props = geojson.features.map((f) => f.properties);
      expect(props.map((p) => p.fillColor)).toEqual(['#c6dbef', '#4292c6', '#03152f']);
      expect(props[0].fillOpacity).toBeCloseTo(0.37);
      expect(props[2].fillOpacity).toBeCloseTo(0.75);
    });

    test('an over-credited region (rate above 1) counts as exactly done', () => {
      const { geojson } = draw([[regionFeature(1), rate(1, { rate: 1.2, completed: 10000 })]]);
      expect(geojson.features[0].properties.completionRate).toBe(100);
      expect(geojson.features[0].properties.fillColor).toBe('#03152f');
    });

    test('/labelMap paints every region one flat color', () => {
      const { geojson } = draw([[regionFeature(1), rate(1, { rate: 0.3 })]],
        { regionFillMode: 'singleColor', regionFillColor: '#808080', regionFillOpacity: 0.25 });
      expect(geojson.features[0].properties).toMatchObject({ fillColor: '#808080', fillOpacity: 0.25 });
    });

    test('adds the region source keyed by region id, a fill layer, and an outline layer', () => {
      const { map } = draw([[regionFeature(1), rate(1, { rate: 0.3 })]]);
      expect(map.sources['region-polygons']).toMatchObject({ type: 'geojson', promoteId: 'region_id' });
      expect(map.layers.get('region-polygons').type).toBe('fill');
      expect(map.layers.get('region-polygons-outline').type).toBe('line');
    });
  });

  describe('distance left', () => {
    test('is in kilometers for a metric city', () => {
      const { geojson } = draw([[regionFeature(1), rate(1, { rate: 0.5, outdated: 2000 })]]);
      expect(geojson.features[0].properties.dist_remaining_converted).toBeCloseTo(5);
      expect(geojson.features[0].properties.outdated_dist_converted).toBeCloseTo(2);
    });

    test('is in miles for an imperial city', () => {
      metric = false;
      const { geojson } = draw([[regionFeature(1), rate(1, { rate: 0.5, outdated: 2000 })]]);
      expect(geojson.features[0].properties.dist_remaining_converted).toBeCloseTo(3.107, 3);
      expect(geojson.features[0].properties.outdated_dist_converted).toBeCloseTo(1.243, 3);
    });

    test('a row without a re-audit distance counts none', () => {
      const { geojson } = draw([[regionFeature(1), rate(1, { rate: 0.5 })]]);
      expect(geojson.features[0].properties.outdated_distance_m).toBe(0);
    });
  });

  describe('the returned promise', () => {
    test('resolves at once when the layers are already on the map', async () => {
      const { done } = draw([[regionFeature(1), rate(1, { rate: 0.3 })]]);
      await expect(done).resolves.toBeUndefined();
    });

    test('waits for the source to load before resolving', async () => {
      const { map, done } = draw([[regionFeature(1), rate(1, { rate: 0.3 })]], {}, { layersReady: false });
      let settled = false;
      done.then(() => { settled = true; });
      map.handlers.sourcedataloading();
      await Promise.resolve();
      expect(settled).toBe(false);
      map.ready = true;
      map.handlers.sourcedataloading();
      await done;
      expect(settled).toBe(true);
    });
  });

  describe('hover popup', () => {
    test('a partly explored region shows its percent, the distance left, and an invite to help', () => {
      const [feature] = [regionFeature(7, 'Fremont')];
      const { map } = draw([[feature, rate(7, { rate: 0.426, total: 10000 })]]);
      hover(map, feature);
      const popup = popups[0];
      expect(map.hover[7]).toBe(true);
      expect(popup.added).toBe(true);
      expect(popup.html).toContain('<strong>Fremont</strong>');
      expect(popup.html).toContain('common:map.percent-complete=42');
      expect(popup.html).toContain('common:map.distance-left=6');
      expect(popup.html).toContain('common:map.click-to-help');
      expect(popup.html).not.toContain('needs-reaudit');
      expect(popup.lngLat).toEqual({ lng: expect.closeTo(1), lat: expect.closeTo(1) });
    });

    test('escapes the region name', () => {
      const feature = regionFeature(7, '<b>Fremont</b>');
      const { map } = draw([[feature, rate(7, { rate: 0.4 })]]);
      hover(map, feature);
      expect(popups[0].html).toContain('&lt;b&gt;Fremont&lt;/b&gt;');
    });

    test('a region with under one unit left says so instead of rounding to zero', () => {
      const feature = regionFeature(7);
      const { map } = draw([[feature, rate(7, { rate: 0.99, total: 10000 })]]);
      hover(map, feature);
      expect(popups[0].html).toContain('common:map.less-than-one-unit-left');
      expect(popups[0].html).not.toContain('distance-left');
    });

    test('a fully explored region with nothing to re-audit invites help', () => {
      const feature = regionFeature(7);
      const { map } = draw([[feature, rate(7, { rate: 1 })]]);
      hover(map, feature);
      expect(popups[0].html).toContain('common:map.100-percent-complete');
      expect(popups[0].html).toContain('common:map.click-to-help');
    });

    test('a fully explored region with streets to re-audit invites re-exploring instead (#4384)', () => {
      const feature = regionFeature(7);
      const { map } = draw([[feature, rate(7, { rate: 1, outdated: 2500 })]]);
      hover(map, feature);
      expect(popups[0].html).toContain('common:map.needs-reaudit=2.5');
      expect(popups[0].html).toContain('common:map.click-to-reaudit');
      expect(popups[0].html).not.toContain('click-to-help');
    });

    test('a re-audit distance of 10 or more rounds to a whole number', () => {
      const feature = regionFeature(7);
      const { map } = draw([[feature, rate(7, { rate: 0.5, total: 40000, outdated: 12400 })]]);
      hover(map, feature);
      expect(popups[0].html).toContain('common:map.needs-reaudit=12<br>');
    });

    test('a re-audit distance that rounds to zero is left out', () => {
      const feature = regionFeature(7);
      const { map } = draw([[feature, rate(7, { rate: 0.5, outdated: 10 })]]);
      hover(map, feature);
      expect(popups[0].html).not.toContain('needs-reaudit');
    });

    test('a region the user finished thanks them', () => {
      const feature = regionFeature(7);
      feature.properties.user_completed = true;
      const { map } = draw([[feature, rate(7, { rate: 0.6 })]]);
      hover(map, feature);
      expect(popups[0].html).toContain('common:map.thanks');
      expect(popups[0].html).not.toContain('click-to');
    });

    test('a region the user finished that now needs re-auditing also invites them back', () => {
      const feature = regionFeature(7);
      feature.properties.user_completed = true;
      const { map } = draw([[feature, rate(7, { rate: 0.6, outdated: 3000 })]]);
      hover(map, feature);
      expect(popups[0].html).toContain('common:map.thanks');
      expect(popups[0].html).toContain('common:map.click-to-reaudit');
    });

    test('moving within the same region leaves the popup alone', () => {
      const feature = regionFeature(7);
      const { map } = draw([[feature, rate(7, { rate: 0.4 })]]);
      hover(map, feature);
      const spy = vi.spyOn(popups[0], 'setHTML');
      hover(map, feature);
      expect(spy).not.toHaveBeenCalled();
    });

    test('moving to another region moves the highlight and the popup', () => {
      const a = regionFeature(7, 'Fremont');
      const b = regionFeature(8, 'Ballard');
      const { map } = draw([[a, rate(7, { rate: 0.4 })], [b, rate(8, { rate: 0.4 })]]);
      hover(map, a);
      hover(map, b);
      expect(map.hover).toEqual({ 7: false, 8: true });
      expect(popups[0].html).toContain('Ballard');
    });

    test('the maps without a popup still highlight the region under the mouse', () => {
      const feature = regionFeature(7);
      const { map } = draw([[feature, rate(7, { rate: 0.4 })]], { regionTooltip: 'none' });
      hover(map, feature);
      expect(map.hover[7]).toBe(true);
      expect(popups[0].added).toBe(false);
    });

    test('the close button hides the popup and the highlight', () => {
      const feature = regionFeature(7);
      const { map } = draw([[feature, rate(7, { rate: 0.4 })]]);
      hover(map, feature);
      popups[0]._content.querySelector('.mapboxgl-popup-close-button').onclick();
      expect(popups[0].added).toBe(false);
      expect(map.hover[7]).toBe(false);
    });
  });

  describe('leaving a region', () => {
    let map;
    let feature;

    beforeEach(() => {
      vi.useFakeTimers();
      feature = regionFeature(7);
      ({ map } = draw([[feature, rate(7, { rate: 0.4 })]]));
      hover(map, feature);
    });

    const leave = (toElement) => map.handlers['mouseleave:region-polygons']({ originalEvent: { toElement } });

    test('onto the plain map hides the popup after a short delay', () => {
      leave(document.body);
      vi.advanceTimersByTime(499);
      expect(popups[0].added).toBe(true);
      vi.advanceTimersByTime(1);
      expect(popups[0].added).toBe(false);
      expect(map.hover[7]).toBe(false);
    });

    test('when the page loses focus hides the popup too', () => {
      map.handlers['mouseleave:region-polygons']({});
      vi.advanceTimersByTime(500);
      expect(popups[0].added).toBe(false);
    });

    test('onto the popup keeps it open so its link can be clicked', () => {
      const popupEl = document.createElement('div');
      popupEl.className = 'mapboxgl-popup';
      const inner = document.createElement('span');
      popupEl.append(inner);
      document.body.append(popupEl);
      leave(inner);
      vi.advanceTimersByTime(1000);
      expect(popups[0].added).toBe(true);
    });

    test('and coming back before the delay keeps the popup', () => {
      leave(document.body);
      map.handlers['mouseenter:region-polygons']();
      vi.advanceTimersByTime(1000);
      expect(popups[0].added).toBe(true);
    });

    test('a second leave after the popup closed does nothing', () => {
      leave(document.body);
      vi.advanceTimersByTime(500);
      popups[0].addTo();
      leave(document.body);
      vi.advanceTimersByTime(500);
      expect(popups[0].added).toBe(true);
    });

    test('the mouse resting on the popup holds it open; leaving the popup hides it', () => {
      leave(document.body);
      popups[0]._content.onmouseenter();
      vi.advanceTimersByTime(1000);
      expect(popups[0].added).toBe(true);
      popups[0]._content.onmouseleave();
      vi.advanceTimersByTime(200);
      expect(popups[0].added).toBe(false);
      expect(map.hover[7]).toBe(false);
    });
  });

  describe('logging popup link clicks', () => {
    /**
     * Hovers a region and clicks the popup's link, as it sits in the map container.
     * @param {object} rateFields - The region's completion rate fields.
     * @param {object} [params] - addRegionsToMap overrides.
     */
    function clickLink(rateFields, params = {}) {
      const feature = regionFeature(7);
      const { map } = draw([[feature, rate(7, rateFields)]], params);
      hover(map, feature);
      map.getContainer().append(popups[0]._content);
      popups[0]._content.querySelector('.region-selection-trigger').click();
    }

    test.each([
      ['0', { rate: 1 }],
      ['<1', { rate: 0.99 }],
      ['1', { rate: 0.9 }],
      ['>1', { rate: 0.5 }],
    ])('records distanceLeft=%s', (expected, fields) => {
      clickLink(fields);
      expect(window.logWebpageActivity).toHaveBeenCalledWith(
        `Click_module=home-map_regionId=7_distanceLeft=${expected}_needsReaudit=false_target=audit`);
    });

    test('records whether the region needed re-auditing (#4384)', () => {
      clickLink({ rate: 1, outdated: 3000 });
      expect(window.logWebpageActivity).toHaveBeenCalledWith(
        'Click_module=home-map_regionId=7_distanceLeft=0_needsReaudit=true_target=audit');
    });

    test('records nothing on a map that does not log clicks', () => {
      clickLink({ rate: 0.5 }, { logClicks: false });
      expect(window.logWebpageActivity).not.toHaveBeenCalled();
    });
  });
});
