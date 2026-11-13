/**
 * A recording `mapboxgl` for the ps-map suites (#5840). Mapbox GL needs WebGL, which jsdom lacks, so the fake map
 * keeps what it was asked to do (sources, layers, filters, feature states, fits) for a test to read back, and lets a
 * test fire the map's events the way a pointer or the style loader would.
 */

import { FakeLngLatBounds } from '../lngLatBoundsStub.js';

/** A map that records instead of drawing. */
export class FakeMap {
  /**
   * @param {object} [options] - What `new mapboxgl.Map` was given; `container` is a DOM id, as the pages pass it.
   */
  constructor(options = {}) {
    this.options = options;
    this.sources = {};
    this.layers = {};
    this.handlers = {};
    this.controls = [];
    this.featureStates = [];
    this.filters = {};
    this.layout = {};
    this.paint = {};
    this.fits = [];
    this.view = {};
    this.isLoaded = false;
    this.resizes = 0;
    this.canvas = { style: { cursor: '' } };
    this.container = document.getElementById(options.container) ?? document.createElement('div');
  }

  /**
   * Records a handler under `event` or `event:layer`, as Mapbox keys a layer-scoped one.
   * @param {string} event - The event name.
   * @param {string|Function} layerOrHandler - The layer id, or the handler for a map-wide event.
   * @param {Function} [handler] - The handler, for a layer-scoped event.
   */
  on(event, layerOrHandler, handler) {
    const key = handler ? `${event}:${layerOrHandler}` : event;
    (this.handlers[key] ??= []).push(handler ?? layerOrHandler);
  }

  /**
   * Calls every handler for an event, as Mapbox would when it happens.
   * @param {string} key - `event` or `event:layer`.
   * @param {object} [e] - The event object handed to each handler.
   * @returns {Promise<void>} Settles once every (possibly async) handler has.
   */
  async fire(key, e = {}) {
    await Promise.all((this.handlers[key] ?? []).map((fn) => fn(e)));
  }

  addControl(control, position) { this.controls.push({ control, position }); }

  addSource(id, source) { this.sources[id] = source; }

  addLayer(layer) { this.layers[layer.id] = layer; }

  getLayer(id) { return this.layers[id]; }

  loaded() { return this.isLoaded; }

  resize() { this.resizes += 1; }

  getCanvas() { return this.canvas; }

  getContainer() { return this.container; }

  setFeatureState(target, value) { this.featureStates.push({ target, value }); }

  setFilter(layer, expression) { this.filters[layer] = expression; }

  setLayoutProperty(layer, name, value) { this.layout[`${layer}.${name}`] = value; }

  setPaintProperty(layer, name, value) { this.paint[`${layer}.${name}`] = value; }

  fitBounds(bounds, options) { this.fits.push({ bounds: bounds.toArray(), options }); }

  setMinZoom(zoom) { this.view.minZoom = zoom; }

  setMaxZoom(zoom) { this.view.maxZoom = zoom; }

  setProjection(projection) { this.view.projection = projection; }

  setMaxBounds(bounds) { this.view.maxBounds = bounds; }

  /**
   * @param {string|number} id - A feature id.
   * @returns {object} Every feature state set for that id, later ones over earlier.
   */
  stateOf(id) {
    return Object.assign({}, ...this.featureStates.filter((f) => f.target.id === id).map((f) => f.value));
  }
}

/** A popup that remembers its position, content, and whether it is open. */
export class FakePopup {
  /** @param {object} [options] - What `new mapboxgl.Popup` was given. */
  constructor(options = {}) {
    this.options = options;
    this.lngLat = null;
    this.html = null;
    this.content = null;
    this.open = false;
  }

  setLngLat(lngLat) { this.lngLat = lngLat; return this; }

  setHTML(html) { this.html = html; return this; }

  setDOMContent(content) { this.content = content; return this; }

  addTo() { this.open = true; return this; }
}

/**
 * Builds a fresh `mapboxgl` stand-in that keeps every map and popup it makes.
 * @returns {{Map: Function, Popup: Function, NavigationControl: Function, LngLatBounds: Function, maps: FakeMap[],
 *   popups: FakePopup[], accessToken: ?string}} The stand-in, to hand out as the mock's default export.
 */
export function fakeMapboxgl() {
  const maps = [];
  const popups = [];
  return {
    accessToken: null,
    maps,
    popups,
    Map: class extends FakeMap {
      constructor(options) { super(options); maps.push(this); }
    },
    Popup: class extends FakePopup {
      constructor(options) { super(options); popups.push(this); }
    },
    NavigationControl: class {
      constructor(options) { this.options = options; }
    },
    LngLatBounds: FakeLngLatBounds,
  };
}
