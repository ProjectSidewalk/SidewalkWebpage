/**
 * Tests for the shared map builder behind /labelMap, /cities, home, about, Access Score and the dashboards,
 * frontend/js/ps-map/createPSMap.js (#5840).
 *
 * Each layer module has its own suite, so these stand them in and pin the wiring: the map built from the city's
 * own center and bounds, which feeds are fetched (and which are not), the order the layers land in, the early hooks
 * a page mounts its UI from, and the two ways labels arrive.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { flush, routeFetch } from './support/routeFetch.js';
import { fakeMapboxgl } from './support/psMapHarness.js';

const mapboxgl = fakeMapboxgl();
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));
mockModule('i18next', () => ({ default: { t: (key) => key } }));
mockModule('@mapbox/mapbox-gl-language', () => ({
  default: class {
    constructor(options) { this.options = options; }
  },
}));

const drawers = [];
mockModule('frontend/js/ps-map/MapSidebarDrawer.js', () => ({
  MapSidebarDrawer: class {
    constructor(map, sidebar, options) {
      Object.assign(this, { map, sidebar, options });
      drawers.push(this);
    }
  },
}));

const loaders = [];
mockModule('frontend/js/ps-map/ViewportLabelLoader.js', () => ({
  ViewportLabelLoader: class {
    constructor(map, url, options) {
      Object.assign(this, { map, url, options, started: false });
      loaders.push(this);
    }

    onData(fn) { this.deliver = fn; }

    start() { this.started = true; }
  },
}));

/** The order the layer modules were called in, by name. */
const calls = [];
const layers = {
  addCitiesToMap: vi.fn(() => { calls.push('cities'); }),
  addRegionsToMap: vi.fn(() => { calls.push('regions'); }),
  addStreetsToMap: vi.fn(async () => { calls.push('streets'); return { audited: 1, outdated: 0, unaudited: 2 }; }),
  addLabelsToMap: vi.fn(async () => { calls.push('labels'); return { layerNames: {} }; }),
  setLabelData: vi.fn(),
  fetchLabelFeed: vi.fn(async () => LABELS),
};
mockModule('frontend/js/ps-map/addCitiesToMap.js', () => ({ addCitiesToMap: layers.addCitiesToMap }));
mockModule('frontend/js/ps-map/addRegionsToMap.js', () => ({ addRegionsToMap: layers.addRegionsToMap }));
mockModule('frontend/js/ps-map/addStreetsToMap.js', () => ({ addStreetsToMap: layers.addStreetsToMap }));
mockModule('frontend/js/ps-map/addLabelsToMap.js',
  () => ({ addLabelsToMap: layers.addLabelsToMap, setLabelData: layers.setLabelData }));
mockModule('frontend/js/ps-map/psMapUtilities.js', () => ({ fetchLabelFeed: layers.fetchLabelFeed }));

const { createPSMap } = await loadModules('frontend/js/ps-map/createPSMap.js');

/** /cityMapParams for a city, as ConfigController sends it. */
const CITY_PARAMS = {
  city_center: { lat: 47.6, lng: -122.3 },
  southwest_boundary: { lat: 47.4, lng: -122.5 },
  northeast_boundary: { lat: 47.8, lng: -122.1 },
  default_zoom: 12,
};

/**
 * A one-feature collection.
 * @param {GeoJSON.Geometry} geometry - Its feature's geometry.
 * @returns {GeoJSON.FeatureCollection} The collection.
 */
const collection = (geometry) => ({
  type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: {} }],
});

const REGIONS = collection({ type: 'Polygon', coordinates: [[[-122.4, 47.5], [-122.2, 47.5], [-122.2, 47.7]]] });
const STREETS = collection({ type: 'LineString', coordinates: [[-122.45, 47.55], [-122.3, 47.75]] });
const LABELS = collection({ type: 'Point', coordinates: [-122.3, 47.6] });
const CITIES = collection({ type: 'Point', coordinates: [-87.6, 41.9] });
const EMPTY = { type: 'FeatureCollection', features: [] };

/** What the stubbed fetch answers each feed with. */
const ROUTES = {
  '/cityMapParams': CITY_PARAMS,
  '/regions': REGIONS,
  '/rates': [],
  '/streets': STREETS,
  '/v3/api/cities?filetype=geojson': CITIES,
};

/**
 * Starts a map and lets the style finish loading.
 * @param {object} params - createPSMap's params, over a bare `mapName`.
 * @param {object} [options]
 * @param {boolean} [options.loadedAtOnce=false] - Whether the map reports itself loaded as soon as it is built.
 * @returns {Promise<{map: import('./support/psMapHarness.js').FakeMap, result: Array}>} The map and what the
 *   all-loaded promise resolved with.
 */
async function start(params, { loadedAtOnce = false } = {}) {
  mapboxgl.Map.prototype.loaded = () => loadedAtOnce;
  const done = createPSMap({ mapName: 'ps-map', ...params });
  await flush();
  const map = mapboxgl.maps.at(-1);
  if (!loadedAtOnce) await map.fire('load');
  return { map, result: await done };
}

describe('createPSMap', () => {
  let fetches;
  let resizeObservers;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="page-loading"></div>
      <div id="ps-map">
        <div class="mapboxgl-ctrl-bottom-left"><div class="logo-holder"><a class="mapboxgl-ctrl-logo"></a></div></div>
        <div class="mapboxgl-ctrl-bottom-right"><div class="mapboxgl-ctrl-attrib"></div></div>
        <div class="mapboxgl-ctrl-top-right"></div>
      </div>`;
    fetches = routeFetch(ROUTES);
    useUtil({ isMobile: () => false });
    mapboxgl.maps.length = 0;
    drawers.length = 0;
    loaders.length = 0;
    calls.length = 0;
    resizeObservers = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; resizeObservers.push(this); }

      observe(target) { this.target = target; }
    });
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  const fetched = () => fetches.mock.calls.map(([url]) => url);

  test('builds the map on the city, with the default controls and gestures', async () => {
    const { map } = await start({ mapStyle: 'style.json', mapboxApiKey: 'pk.test' });
    expect(mapboxgl.accessToken).toBe('pk.test');
    expect(map.options).toEqual(expect.objectContaining({
      container: 'ps-map',
      style: 'style.json',
      center: [-122.3, 47.6],
      zoom: 12,
      maxBounds: [[-122.5, 47.4], [-122.1, 47.8]],
      scrollZoom: true,
      locale: { 'TouchPanBlocker.Message': 'common:map-two-finger-pan' },
    }));
    expect(map.controls.map((c) => c.position)).toEqual([undefined, 'top-left']);
    expect(map.controls[0].control.options).toEqual({ defaultLanguage: 'common:mapbox-language-code' });
    expect(document.getElementById('page-loading').style.display).toBe('none');
  });

  test('applies the zoom correction, the control corner and the scroll-zoom choice a page asks for', async () => {
    const { map } = await start({
      zoomCorrection: -0.5, navigationControlPosition: 'top-right', scrollWheelZoom: false,
    });
    expect(map.options.zoom).toBe(11.5);
    expect(map.options.scrollZoom).toBe(false);
    expect(map.controls[1].position).toBe('top-right');
  });

  test('on a phone, a zoomed-in start opens on a few blocks rather than the whole city', async () => {
    useUtil({ isMobile: () => true });
    const { map } = await start({ mobileZoomedStart: true });
    expect(map.options.zoom).toBe(14);
  });

  test('a zoomed-in start changes nothing on a desktop', async () => {
    const { map } = await start({ mobileZoomedStart: true });
    expect(map.options.zoom).toBe(12);
  });

  test('a map that is already loaded when built is ready without waiting for its load event', async () => {
    const { result } = await start({}, { loadedAtOnce: true });
    expect(result[0]).toBe(mapboxgl.maps[0]);
  });

  describe('the Mapbox logo', () => {
    const logoCorner = () => document.querySelector('.logo-holder').parentElement.className;

    test('stays put in the bottom-left corner by default', async () => {
      await start({});
      expect(logoCorner()).toBe('mapboxgl-ctrl-bottom-left');
    });

    test('moves above the attribution when it shares the attribution corner', async () => {
      await start({ mapboxLogoLocation: 'bottom-right' });
      const corner = document.querySelector('.mapboxgl-ctrl-bottom-right');
      expect([...corner.children].map((c) => c.className)).toEqual(['logo-holder', 'mapboxgl-ctrl-attrib']);
    });

    test('moves into an empty corner on its own', async () => {
      await start({ mapboxLogoLocation: 'top-right' });
      expect(logoCorner()).toBe('mapboxgl-ctrl-top-right');
    });
  });

  test('resizes the map, once per frame, whenever its container changes size', async () => {
    const { map } = await start({});
    const [observer] = resizeObservers;
    expect(observer.target).toBe(document.getElementById('ps-map'));
    observer.callback();
    expect(map.resizes).toBe(1);
  });

  test('a container that is not on the page watches nothing', async () => {
    document.getElementById('ps-map').id = 'elsewhere';
    await start({});
    expect(resizeObservers).toEqual([]);
  });

  describe('the filter sidebar', () => {
    beforeEach(() => {
      document.body.insertAdjacentHTML('beforeend', '<div id="filter-sidebar" class="ps-invisible"></div>');
    });

    test('shows in its loading state, with a drawer, before the data arrives', async () => {
      const { map } = await start({});
      const sidebar = document.getElementById('filter-sidebar');
      expect([...sidebar.classList]).toEqual(['filter-sidebar--loading']);
      expect(drawers).toHaveLength(1);
      expect(drawers[0].map).toBe(map);
      expect(drawers[0].options).toEqual({ startCollapsed: false });
    });

    test('starts the drawer closed when the page asks', async () => {
      await start({ sidebarStartsCollapsed: true });
      expect(drawers[0].options).toEqual({ startCollapsed: true });
    });
  });

  test('hands the page the map before any data layer lands', async () => {
    const onMapReady = vi.fn(() => expect(calls).toEqual([]));
    const { map } = await start({ onMapReady, streetsURL: '/streets' });
    expect(onMapReady).toHaveBeenCalledWith(map);
    expect(calls).toEqual(['streets']);
  });

  test('a page whose ready hook throws still gets its layers', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('search box failed');
    await start({ onMapReady: () => { throw failure; }, streetsURL: '/streets' });
    expect(consoleError).toHaveBeenCalledWith('onMapReady callback failed', failure);
    expect(calls).toEqual(['streets']);
  });

  test('regions without their completion rates are not fetched, nor any feed left unnamed', async () => {
    const { result } = await start({ regionsURL: '/regions' });
    expect(fetched()).toEqual(['/cityMapParams']);
    expect(result.slice(1)).toEqual([undefined, undefined, undefined, undefined]);
  });

  test('fills in the defaults the layer modules read', async () => {
    await start({ streetsURL: '/streets' });
    expect(layers.addStreetsToMap.mock.calls[0][2]).toEqual(expect.objectContaining({
      logClicks: true, regionTooltip: 'none', differentiateUnauditedStreets: false,
    }));
  });

  test('keeps the choices a page made over the defaults', async () => {
    await start({ streetsURL: '/streets', logClicks: false, regionTooltip: 'completionRate',
      differentiateUnauditedStreets: true });
    expect(layers.addStreetsToMap.mock.calls[0][2]).toEqual(expect.objectContaining({
      logClicks: false, regionTooltip: 'completionRate', differentiateUnauditedStreets: true,
    }));
  });

  test('draws regions before streets, and the deployment cities from the cities API', async () => {
    const { map } = await start({
      regionsURL: '/regions', completionRatesURL: '/rates', streetsURL: '/streets', loadCities: true,
    });
    expect(layers.addRegionsToMap).toHaveBeenCalledWith(map, REGIONS, [], expect.any(Object));
    expect(layers.addCitiesToMap).toHaveBeenCalledWith(map, CITIES, expect.any(Object));
    expect(calls.indexOf('regions')).toBeLessThan(calls.indexOf('streets'));
  });

  test('loads the whole label feed at once, then parks the street counts on the tracker', async () => {
    const { map, result } = await start({ streetsURL: '/streets', labelsURL: '/labels/all' });
    expect(layers.fetchLabelFeed).toHaveBeenCalledWith('/labels/all');
    expect(layers.addLabelsToMap).toHaveBeenCalledWith(map, LABELS, expect.any(Object));
    expect(calls).toEqual(['streets', 'labels']);
    expect(result[4].streetCounts).toEqual({ audited: 1, outdated: 0, unaudited: 2 });
    expect(loaders).toEqual([]);
  });

  describe('with viewport label loading', () => {
    const viewport = { labelsURL: '/labels/all', viewportLabelLoading: true };

    test('builds empty label layers and lets the loader fill them as the map moves', async () => {
      const options = { minFetchZoom: 13 };
      const { map, result } = await start({ ...viewport, streetsURL: '/streets', viewportLabelOptions: options });
      expect(layers.fetchLabelFeed).not.toHaveBeenCalled();
      expect(layers.addLabelsToMap).toHaveBeenCalledWith(map, EMPTY, expect.any(Object));
      const [loader] = loaders;
      expect(loader.url).toBe('/labels/all');
      expect(loader.options.minFetchZoom).toBe(13);
      expect(loader.started).toBe(true);
      expect(result[4].labelLoader).toBe(loader);
      expect(result[4].streetCounts).toEqual({ audited: 1, outdated: 0, unaudited: 2 });

      loader.deliver(LABELS);
      expect(layers.setLabelData).toHaveBeenCalledWith(map, result[4], LABELS);
    });

    test('tells the loader the extent the streets and regions cover, so it stops once that is loaded', async () => {
      await start({ ...viewport, regionsURL: '/regions', completionRatesURL: '/rates', streetsURL: '/streets' });
      expect(loaders[0].options.dataBounds.toArray()).toEqual([[-122.45, 47.5], [-122.2, 47.75]]);
    });

    test('with empty feeds, gives the loader no extent to stop at', async () => {
      routeFetch({ ...ROUTES, '/regions': EMPTY, '/streets': EMPTY });
      await start({ ...viewport, regionsURL: '/regions', completionRatesURL: '/rates', streetsURL: '/streets' });
      expect(loaders[0].options.dataBounds).toBeNull();
    });
  });
});
