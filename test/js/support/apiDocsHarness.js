/**
 * Shared setup for the API docs suites (#5840). Mapbox GL and Chart.js both draw on a canvas jsdom can't render, so
 * each is a double that records what a preview asked it to draw and lets a test fire the map's events. Everything
 * between the API response and those two (the previews themselves, ApiDocsMap, the legends and popups) is real.
 *
 * Call `stubApiDocsLibraries()` once at the top of a suite, before its first `loadModules`.
 */

import { mockModule } from '../loader.js';

/** What the doubles share with the test: reset by `resetWorld`, read by the test. */
export const world = { maps: [], charts: [], popups: [] };

/** Empties `world`, and makes the next map build load, or fail with `mapError`. */
export function resetWorld({ mapError = null } = {}) {
  world.maps = [];
  world.charts = [];
  world.popups = [];
  world.mapError = mapError;
}

/** mapboxgl.LngLatBounds, enough for geoBounds.js: the box grown around every point it's given. */
export class FakeBounds {
  constructor() {
    this.box = null;
  }

  extend(point) {
    if (point instanceof FakeBounds) {
      point.box?.forEach((corner) => this.extend(corner));
      return this;
    }
    const [lng, lat] = point;
    if (!this.box) this.box = [[lng, lat], [lng, lat]];
    this.box = [
      [Math.min(this.box[0][0], lng), Math.min(this.box[0][1], lat)],
      [Math.max(this.box[1][0], lng), Math.max(this.box[1][1], lat)],
    ];
    return this;
  }

  isEmpty() {
    return !this.box;
  }

  toArray() {
    return this.box;
  }
}

/**
 * A mapbox-gl Map double. It reports itself loaded at once (or fails, per `world.mapError`), adds a control's element
 * to its container the way the real map does, and keeps every source, layer and handler for the test to inspect.
 */
export class FakeMap {
  constructor(options) {
    this.options = options;
    this.container = options.container;
    this.sources = {};
    this.layers = {};
    this.layerOrder = [];
    this.handlers = [];
    this.featureState = new Map();
    this.paint = {};
    this.props = new Map();
    this.removed = false;
    this.panned = [];
    this.canvas = document.createElement('canvas');
    world.maps.push(this);
  }

  addControl(control) {
    if (control.onAdd) this.container.appendChild(control.onAdd(this));
  }

  loaded() {
    return !world.mapError;
  }

  on(event, layerOrHandler, maybeHandler) {
    const [layer, handler] = maybeHandler ? [layerOrHandler, maybeHandler] : [null, layerOrHandler];
    this.handlers.push({ event, layer, handler });
    return this;
  }

  once(event, handler) {
    this.on(event, handler);
    // A build set to fail reports it the way Mapbox does: an `error` event, after the caller has subscribed.
    if (event === 'error' && world.mapError) queueMicrotask(() => this.fire('error', { error: world.mapError }));
    return this;
  }

  off(event, handler) {
    this.handlers = this.handlers.filter((h) => !(h.event === event && h.handler === handler));
    return this;
  }

  /** Calls an event's handlers; `layer` picks the layer-scoped ones, null the map-wide ones. */
  fire(event, payload = {}, layer = null) {
    this.handlers.filter((h) => h.event === event && h.layer === layer).forEach((h) => h.handler(payload));
  }

  /** Fires a layer event at the given features, as a pointer over them would. */
  fireOn(layer, event, features, lngLat = { lng: 0, lat: 0 }) {
    this.fire(event, { features, lngLat, point: { x: 0, y: 0 }, originalEvent: {} }, layer);
  }

  /** @returns {boolean} Whether anything listens for this event on this layer. */
  listens(event, layer = null) {
    return this.handlers.some((h) => h.event === event && h.layer === layer);
  }

  addSource(id, source) {
    this.sources[id] = source;
  }

  getSource(id) {
    return this.sources[id];
  }

  addLayer(layer) {
    this.layers[layer.id] = layer;
    this.layerOrder.push(layer.id);
  }

  getLayer(id) {
    return this.layers[id];
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

  getCanvas() {
    return this.canvas;
  }

  getContainer() {
    return this.container;
  }

  panBy(offset) {
    this.panned.push(offset);
  }

  remove() {
    this.removed = true;
  }
}

/** A mapbox-gl Popup double: records where it opened and what it holds, and renders the HTML for queries. */
export class FakePopup {
  constructor(options) {
    this.options = options;
    this.element = document.createElement('div');
    this.handlers = {};
    world.popups.push(this);
  }

  setLngLat(lngLat) {
    this.lngLat = lngLat;
    return this;
  }

  setHTML(html) {
    this.html = html;
    this.element.innerHTML = html;
    return this;
  }

  getLngLat() {
    return this.lngLat;
  }

  addTo(map) {
    this.map = map;
    return this;
  }

  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }

  getElement() {
    return this.element;
  }

  isOpen() {
    return !this.removed;
  }

  remove() {
    this.removed = true;
    this.handlers.close?.();
    return this;
  }

  /** @returns {string} The popup's text, whitespace collapsed. */
  text() {
    return this.element.textContent.replace(/\s+/g, ' ').trim();
  }
}

/** A Chart.js double: keeps the config and the canvas it was drawn on. */
export class FakeChart {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.data = config.data;
    this.options = config.options;
    this.destroyed = false;
    this.updates = 0;
    world.charts.push(this);
  }

  update() {
    this.updates++;
  }

  destroy() {
    this.destroyed = true;
  }
}

/**
 * Replaces mapbox-gl, its language plugin, Chart.js and i18next for whatever the suite loads next. i18next answers
 * with the key, plus any interpolated values, so a test can see both what was asked for and what filled it.
 */
export function stubApiDocsLibraries() {
  mockModule('frontend/js/common/mapboxgl.js', () => ({
    default: {
      Map: FakeMap,
      Popup: FakePopup,
      LngLatBounds: FakeBounds,
      NavigationControl: class {},
      accessToken: '',
    },
  }));
  mockModule('@mapbox/mapbox-gl-language', () => ({ default: class {} }));
  mockModule('frontend/js/api-docs/apiDocsChart.js', () => ({ Chart: FakeChart }));
  mockModule('i18next', () => ({
    default: {
      t: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),
      exists: () => true,
      language: 'en',
    },
  }));
}

/**
 * Answers `fetch` from a table of URL prefixes, ignoring the `utm_source` marker the docs add. A route's value is
 * the JSON body, or `{ status, body }` (a numeric status and nothing else) for an error, or a function of the URL
 * returning either. Anything unrouted fails the test with the URL it asked for. The stub is undone before the next
 * test, so one that forgets to route its own requests hits setup.js's throwing fetch, not this test's routes.
 *
 * @param {Record<string, any>} routes - URL prefix (path plus any query) to the answer.
 * @returns {import('vitest').Mock} The stub, whose calls are the URLs asked for.
 */
export function routeFetch(routes) {
  const stub = vi.fn(async (input) => {
    const url = String(input).replace(/[?&]utm_source=apiDocs$/, '');
    const prefix = Object.keys(routes).sort((a, b) => b.length - a.length).find((p) => url.startsWith(p));
    if (prefix === undefined) throw new Error(`unrouted fetch: ${url}`);
    let answer = routes[prefix];
    if (typeof answer === 'function') answer = answer(url);
    if (answer instanceof Error) throw answer;
    const { status = 200, body } = isErrorSpec(answer) ? answer : { body: answer };
    return {
      ok: status < 400,
      status,
      json: async () => {
        if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return structuredClone(body);
      },
    };
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}

/** @returns {boolean} Whether a route's answer is `{ status, body }`, rather than a body that has a `status` field. */
function isErrorSpec(answer) {
  return typeof answer?.status === 'number' && Object.keys(answer).every((key) => key === 'status' || key === 'body');
}

/** Lets pending promise callbacks (fetches, map loads) run. */
export const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** @returns {string} An element's text, whitespace collapsed. */
export const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim();

/** Sets the main.css color tokens the previews read, so a color reads as itself rather than an empty string. */
export function stampColorTokens() {
  const style = document.documentElement.style;
  ['white', 'black', '300', '500', '800'].forEach((shade, i) => {
    style.setProperty(`--color-neutral-${shade}`, `#${String(i + 1).repeat(6)}`);
  });
}

/** @returns {GeoJSON.Feature} A square polygon region around (0, 0). */
export function regionFeature(properties = { region_id: 7, name: 'Fremont' }) {
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] },
  };
}
