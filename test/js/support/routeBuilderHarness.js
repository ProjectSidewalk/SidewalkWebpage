/**
 * Shared setup for the RouteBuilder suites (#5840). Mapbox GL can't run under jsdom (no WebGL), so the map is a
 * double that records what it was asked to do and lets a test fire its events. The page's other parts (save modal,
 * saved-route cards, address fields, route menu, leave guard, toasts, confirm dialog) are stand-ins that record their
 * calls and hand back the callbacks RouteBuilder gave them. The street graph (RouteGraph), the undo history, and turf
 * are the real ones, so routing and the route's derived state are what the page would really compute.
 *
 * The streets form a small network near (0, 0), each street ~111 m long:
 *
 *   A(0,0) --1-- B(0.001,0)                F(0.01,0) --9-- G(0.011,0)   (9 touches nothing else)
 *                    |
 *                    2
 *                    |
 *                D(0.001,0.001) --3-- E(0.002,0.001)
 *
 * Streets 1 and 2 are in region 1 ("Downtown"), street 3 in region 2 ("Uptown"), street 9 in region 1.
 */

import { loadModules, mockModule, useUtil } from '../loader.js';

export const A = { lng: 0, lat: 0 };
export const B = { lng: 0.001, lat: 0 };
export const D = { lng: 0.001, lat: 0.001 };
export const E = { lng: 0.002, lat: 0.001 };
export const F = { lng: 0.01, lat: 0 };
// Over a kilometer from every street, past the snap distance.
export const NOWHERE = { lng: 0.005, lat: 0.02 };

/** What the fakes share with the test: reset by `setupRouteBuilder`, read and steered by the test. */
export const world = {};

/** Builds a GeoJSON street feature. */
function street(id, from, to, regionId) {
  return {
    type: 'Feature',
    properties: { street_edge_id: id, region_id: regionId },
    geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
  };
}

/** @returns {GeoJSON.FeatureCollection} The street network drawn in the header. */
export function streetData() {
  return {
    type: 'FeatureCollection',
    features: [street(1, A, B, 1), street(2, B, D, 1), street(3, D, E, 2), street(9, F, { lng: 0.011, lat: 0 }, 1)],
  };
}

/** Builds a square region polygon. */
function region(id, name, [w, s, e, n]) {
  return {
    type: 'Feature',
    properties: { region_id: id, name },
    geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
  };
}

/** @returns {GeoJSON.FeatureCollection} The two regions the streets sit in. */
export function regionData() {
  return {
    type: 'FeatureCollection',
    features: [region(1, 'Downtown', [-0.001, -0.001, 0.0015, 0.0015]), region(2, 'Uptown', [0.0015, 0, 0.003, 0.002])],
  };
}

/** A GeoJSON source double: holds whatever data it was last given. */
class FakeSource {
  constructor(data) {
    this.data = data;
  }

  setData(data) {
    this.data = data;
  }
}

/**
 * A mapbox-gl Map double. The camera is plain state that easeTo/flyTo/jumpTo set at once (firing 'zoom' as the real
 * map does), and `rendered` says what queryRenderedFeatures finds on each layer.
 */
class FakeMap {
  constructor(options) {
    this.options = options;
    this.zoom = options.zoom;
    this.center = { lng: options.center[0], lat: options.center[1] };
    this.loaded = false; // Until 'load' fires, the style can't take sources, layers or images, as with the real map.
    this.handlers = [];
    this.sources = {};
    this.layers = {};
    this.images = {};
    this.featureState = new Map();
    this.paint = {};
    this.layout = {};
    this.rendered = {};
    this.camera = []; // Every easeTo/flyTo/jumpTo/fitBounds call, in order: [method, options].
    this.framed = null; // What cameraForBounds answers.
    this.styleLayers = [];
    this.layerOrder = []; // Layer ids in the order moveLayer brought each to the top.
    this.container = document.createElement('div');
    this.canvas = document.createElement('canvas');
    world.map = this;
  }

  addControl() {}

  on(event, layerOrHandler, maybeHandler) {
    const [layer, handler] = maybeHandler ? [layerOrHandler, maybeHandler] : [null, layerOrHandler];
    this.handlers.push({ event, layer, handler });
  }

  once(event, handler) {
    const wrapped = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    this.on(event, wrapped);
  }

  off(event, handler) {
    this.handlers = this.handlers.filter((h) => !(h.event === event && h.handler === handler));
  }

  /**
   * Calls the handlers for an event, as the map would.
   * @param {string} event
   * @param {object} [payload]
   * @param {?string} [layer] - The layer for a layer-scoped handler; null for the map-wide ones.
   */
  fire(event, payload = {}, layer = null) {
    if (event === 'load') this.loaded = true;
    this.handlers.filter((h) => h.event === event && h.layer === layer).forEach((h) => h.handler(payload));
  }

  /** Throws what mapbox-gl throws when the style is changed before it has loaded. */
  #requireLoaded() {
    if (!this.loaded) throw new Error('Style is not done loading.');
  }

  addSource(id, source) {
    this.#requireLoaded();
    this.sources[id] = new FakeSource(source.data);
  }

  getSource(id) {
    return this.sources[id];
  }

  addLayer(layer) {
    this.#requireLoaded();
    this.layers[layer.id] = layer;
  }

  getLayer(id) {
    return this.layers[id];
  }

  moveLayer(id) {
    this.layerOrder.push(id);
  }

  addImage(id) {
    this.#requireLoaded();
    this.images[id] = true;
  }

  setFeatureState({ source, id }, state) {
    const key = `${source}:${id}`;
    this.featureState.set(key, { ...this.featureState.get(key), ...state });
  }

  /** @returns {object} The feature state of one feature, or {} if none was ever set. */
  stateOf(source, id) {
    return this.featureState.get(`${source}:${id}`) ?? {};
  }

  setPaintProperty(layer, prop, value) {
    this.paint[`${layer}.${prop}`] = value;
  }

  setLayoutProperty(layer, prop, value) {
    this.layout[`${layer}.${prop}`] = value;
  }

  getStyle() {
    return { layers: this.styleLayers };
  }

  getCanvas() {
    return this.canvas;
  }

  getContainer() {
    return this.container;
  }

  queryRenderedFeatures(_geometry, { layers }) {
    return layers.flatMap((id) => this.rendered[id] ?? []);
  }

  project({ lng, lat }) {
    return { x: lng * 1e5, y: -lat * 1e5 };
  }

  cameraForBounds() {
    return this.framed;
  }

  getZoom() {
    return this.zoom;
  }

  getCenter() {
    return this.center;
  }

  getBearing() {
    return 0;
  }

  getPitch() {
    return 0;
  }

  #move(method, opts) {
    this.camera.push([method, opts]);
    if (opts.center) this.center = { lng: opts.center[0], lat: opts.center[1] };
    if (opts.zoom !== undefined && opts.zoom !== this.zoom) {
      this.zoom = opts.zoom;
      this.fire('zoom');
    }
  }

  easeTo(opts) {
    this.#move('easeTo', opts);
  }

  flyTo(opts) {
    this.#move('flyTo', opts);
  }

  jumpTo(opts) {
    this.#move('jumpTo', opts);
  }

  fitBounds(bounds, opts) {
    this.camera.push(['fitBounds', { bounds, ...opts }]);
  }

  /** Moves the camera to a zoom the way the scroll wheel would. */
  zoomTo(zoom) {
    this.#move('scroll', { zoom });
  }
}

/** A mapbox-gl Popup double, recorded in `world.popups`. */
class FakePopup {
  constructor(options) {
    this.options = options;
    this.text = null;
    this.lngLat = null;
    this.open = false;
    world.popups.push(this);
  }

  setLngLat(lngLat) {
    this.lngLat = lngLat;
    return this;
  }

  setText(text) {
    this.text = text;
    return this;
  }

  trackPointer() {
    return this;
  }

  addTo() {
    this.open = true;
    return this;
  }

  remove() {
    this.open = false;
    return this;
  }

  isOpen() {
    return this.open;
  }
}

/** The open popups with a given class name (the next-step hint is 'rb-map-hint', the guide 'rb-cursor-guide'). */
export function openPopups(className) {
  return world.popups.filter((p) => p.open && p.options.className === className);
}

mockModule('frontend/js/common/mapboxgl.js', () => ({
  default: { Map: FakeMap, Popup: FakePopup, NavigationControl: class {} },
}));
mockModule('@mapbox/mapbox-gl-language', () => ({ default: class {} }));
// The key, then its arguments, so assertions can read which message was chosen and what filled it.
mockModule('i18next', () => ({
  default: {
    t: (key, opts) => {
      const args = Object.entries(opts ?? {});
      return args.length === 0 ? key : `${key} ${args.map(([k, v]) => `${k}=${v}`).join(' ')}`;
    },
  },
}));
mockModule('frontend/js/common/Toast.js', () => ({
  Toast: {
    show: (opts) => {
      const toast = { ...opts, dismissed: false, dismiss() { this.dismissed = true; } };
      world.toasts.push(toast);
      return toast;
    },
  },
}));
mockModule('frontend/js/common/ConfirmDialog.js', () => ({
  ConfirmDialog: {
    confirm: (opts) => {
      world.confirms.push(opts);
      return Promise.resolve(world.confirmAnswer);
    },
  },
}));
mockModule('frontend/js/common/UnsavedChangesGuard.js', () => ({
  UnsavedChangesGuard: class {
    constructor(opts) {
      world.guard = opts;
    }
  },
}));
mockModule('frontend/js/route-builder/SaveModal.js', () => ({
  SaveModal: class {
    static consumePendingRoute() {
      return world.pendingRoute;
    }

    constructor(opts) {
      this.opts = opts;
      this.shown = false;
      this.open = vi.fn(() => { this.shown = true; });
      this.hide = vi.fn(() => { this.shown = false; });
      this.isOpen = () => this.shown;
      world.saveModal = this;
    }
  },
}));
mockModule('frontend/js/route-builder/SavedRoutesPanel.js', () => ({
  SavedRoutesPanel: class {
    constructor(opts) {
      this.opts = opts;
      this.refresh = vi.fn();
      this.markActive = vi.fn();
      this.recordGuestRoute = vi.fn();
      world.savedRoutes = this;
    }
  },
}));
mockModule('frontend/js/route-builder/DirectionsPanel.js', () => ({
  DirectionsPanel: class {
    constructor(opts) {
      this.opts = opts;
      this.updateFromRoute = vi.fn();
      this.updateStart = vi.fn();
      this.setEndVisible = vi.fn();
      this.clearFields = vi.fn();
      this.getEndpointStreetNames = () => world.streetNames;
      world.directions = this;
    }
  },
}));
mockModule('frontend/js/route-builder/RoutePopover.js', () => ({
  RoutePopover: class {
    constructor(map, onReverse, onDelete) {
      this.onReverse = onReverse;
      this.onDelete = onDelete;
      this.isOpen = () => false;
      this.open = vi.fn();
      this.close = vi.fn();
      this.scheduleHoverClose = vi.fn();
      this.cancelHoverClose = vi.fn();
      world.popover = this;
    }
  },
}));
useUtil({ longDistanceToString: (km, precision) => `${km.toFixed(precision)} km` });

export const { RouteBuilder } = await loadModules('frontend/js/route-builder/RouteBuilder.js');

// The page's server-rendered markup that RouteBuilder looks up by id.
const PAGE = `
  <div id="routebuilder-panel" data-state="empty">
    <div id="route-stats" hidden>
      <span id="route-length-val"></span>
      <span id="route-time-val" tabindex="0"></span>
      <span id="route-time-tip" hidden></span>
      <span id="route-stats-caption"></span>
    </div>
    <button id="undo-button"></button>
    <button id="cancel-button"></button>
    <button id="new-route-button"></button>
    <button id="save-button">Save route</button>
    <button id="preview-button"></button>
    <input id="poi-toggle-checkbox" type="checkbox" checked>
  </div>
  <div id="routebuilder-map"></div>
  <div id="delete-route-modal-backdrop" style="visibility: hidden">
    <h2 id="delete-route-title">Delete route?</h2>
    <p id="delete-route-explanation">Your route will be lost.</p>
    <button id="delete-route-button">Delete</button>
    <button id="cancel-delete-route-button">Keep</button>
  </div>
  <input id="some-text-field">
`;

/** The city the map opens on: zoomed out to the overview. */
const MAP_PARAMS = {
  city_center: { lng: 0.001, lat: 0.0005 },
  default_zoom: 12,
  southwest_boundary: { lng: -0.05, lat: -0.05 },
  northeast_boundary: { lng: 0.05, lat: 0.05 },
};

/** Every listener added to the document or window since the last setup, as [target, ...addEventListener args]. */
const pageListeners = [];

/**
 * Takes the previous test's page listeners off and records this test's. Each RouteBuilder listens on the shared
 * document and window, so an earlier test's instance would otherwise still answer this test's key presses.
 */
function trackPageListeners() {
  pageListeners.splice(0).forEach(([target, ...args]) => target.removeEventListener(...args));
  for (const target of [document, window]) {
    const add = target.addEventListener;
    vi.spyOn(target, 'addEventListener').mockImplementation(function (...args) {
      pageListeners.push([target, ...args]);
      return add.apply(this, args);
    });
  }
}

/** Lets pending promise chains (fetches, confirms, icon rasterizing) run to completion. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Builds the page and a RouteBuilder on it with the map loaded and both layers rendered, as the page is once its
 * three requests land.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.signedIn=true]
 * @param {number} [opts.minutesPer100m=2]
 * @param {string} [opts.url='/routeBuilder'] - The page's address, e.g. with a `?preview=` deep link.
 * @param {?object} [opts.pendingRoute=null] - What SaveModal.consumePendingRoute hands back.
 * @param {boolean} [opts.dataBeforeMap=false] - Whether the regions and streets arrive before the map has loaded.
 * @returns {Promise<{rb: object, map: FakeMap}>}
 */
export async function setupRouteBuilder({
  signedIn = true, minutesPer100m = 2, url = '/routeBuilder', pendingRoute = null, dataBeforeMap = false,
} = {}) {
  for (const key of Object.keys(world)) delete world[key];
  Object.assign(world, {
    toasts: [], confirms: [], popups: [], confirmAnswer: true, pendingRoute, streetNames: { start: null, end: null },
  });
  document.body.innerHTML = PAGE;
  window.history.replaceState(null, '', url);
  window.logWebpageActivity = vi.fn();
  // Runs the queued animation frames only when the test calls `world.frame()`, so throttled work is steppable.
  world.frames = new Map();
  let nextFrameId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    world.frames.set(nextFrameId, cb);
    return nextFrameId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => world.frames.delete(id));
  world.frame = (now = 0) => {
    const due = [...world.frames.values()];
    world.frames.clear();
    due.forEach((cb) => cb(now));
  };
  // The flag icons rasterize through an <img> and a canvas, neither of which jsdom can draw.
  HTMLImageElement.prototype.decode = () => Promise.resolve();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({}) });

  trackPageListeners();
  const rb = new RouteBuilder('pk.test', MAP_PARAMS, signedIn, minutesPer100m);
  const map = world.map;
  if (!dataBeforeMap) map.fire('load');
  rb.renderRegions(regionData());
  rb.renderStreets(streetData());
  if (dataBeforeMap) map.fire('load');
  await flush();
  return { rb, map };
}

/**
 * Clicks the map at a point, as a user would: the screen point is where the map projects it.
 * @param {FakeMap} map
 * @param {{lng: number, lat: number}} lngLat
 */
export function clickMap(map, lngLat) {
  map.fire('click', { lngLat, point: map.project(lngLat) });
}

/**
 * Zooms in past the overview and clicks out a route through the given points.
 * @param {FakeMap} map
 * @param {...{lng: number, lat: number}} points
 */
export function buildRoute(map, ...points) {
  if (map.getZoom() < RouteBuilder.PLACE_ZOOM) map.zoomTo(RouteBuilder.PLACE_ZOOM);
  points.forEach((p) => clickMap(map, p));
}

/** @returns {Array<[number, boolean]>} The drawn route as [street id, reversed] pairs in walking order. */
export function drawnRoute(map) {
  return map.getSource('streets-chosen').data.features.map((f) => [f.properties.street_edge_id, f.properties.reverse]);
}

/** @returns {Array<[string, number[]]>} The endpoint flags as [kind, coordinate] pairs. */
export function flags(map) {
  return map.getSource('route-endpoints').data.features.map((f) => [f.properties.kind, f.geometry.coordinates]);
}

/** @returns {string[]} The activity-log lines the page wrote, in order. */
export function logged() {
  return window.logWebpageActivity.mock.calls.map(([line]) => line);
}
