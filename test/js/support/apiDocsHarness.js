/**
 * Shared setup for the API docs suites (#5840). jsdom can't draw Mapbox maps or Chart.js charts, so both are fakes
 * that record what they were asked to draw; everything else is real. Call `stubApiDocsLibraries()` before loading.
 */

import { mockModule } from '../loader.js';
import { flush, routeFetch as routeFetchBy, textOf } from './routeFetch.js';

/** Every map, chart and popup made so far, for the test to read. */
export const world = { maps: [], charts: [], popups: [] };

/** Empties `world`; a `mapError` makes the next maps fail to load. */
export function resetWorld({ mapError = null } = {}) {
  world.maps = [];
  world.charts = [];
  world.popups = [];
  world.mapError = mapError;
}

/** Enough of mapboxgl.LngLatBounds for geoBounds.js. */
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

/** A fake Mapbox map: loads at once (or fails, per `world.mapError`) and keeps its sources, layers and handlers. */
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
    // Mapbox reports a failed load as an `error` event, after the caller has subscribed.
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

  /** Fires a layer event at the given features, as the pointer would. */
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

/** A fake Mapbox popup, with its HTML rendered so a test can query it. */
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

/** A fake Chart.js chart, keeping its config. */
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

/** Swaps in the fakes, and an i18next that answers with the key plus any values filled in. */
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
 * Answers `fetch` by URL prefix, ignoring the tracking param the previews add.
 * @param {Record<string, any>} routes - URL prefix (path plus any query) to the answer.
 * @returns {import('vitest').Mock} The stub, whose calls are the URLs asked for.
 */
export function routeFetch(routes) {
  return routeFetchBy(routes, (url) => url.replace(/[?&]utm_source=apiDocs$/, ''));
}

export { flush, textOf };

/** Sets the color tokens the previews read, which jsdom has no stylesheet for. */
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
