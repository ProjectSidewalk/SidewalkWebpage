/**
 * Doubles for the admin map and chart suites (#5840): a `mapboxgl` that records what a map was asked to do instead
 * of drawing (Mapbox GL needs WebGL, which jsdom lacks), and a `vega-embed` whose charts a test can click and hover.
 */

import { FakeLngLatBounds } from '../lngLatBoundsStub.js';

/**
 * Fills a suite's `mapboxgl` stand-in with fresh doubles.
 * @param {object} mapboxgl - The object the suite's mock of frontend/js/common/mapboxgl.js hands out.
 * @returns {object} What the newest map was asked to do: `options`, `sources`, `layers`, `featureStates`, `filters`,
 *   `fits`, the newest `popup`, the canvas `cursor`, plus `load()` to finish loading and `fire(event, layer, e)`.
 */
export function stubMapbox(mapboxgl) {
  const state = {
    options: null,
    sources: {},
    layers: {},
    handlers: {},
    loadCallbacks: [],
    featureStates: [],
    filters: {},
    fits: [],
    popup: null,
    cursor: '',
    load() { state.loadCallbacks.forEach((cb) => cb()); },
    fire(event, layer, e = {}) { state.handlers[`${event}:${layer}`](e); },
    /** @returns {object} The feature state last set for a feature id, merged over every earlier one. */
    stateOf(id) {
      return Object.assign({}, ...state.featureStates.filter((f) => f.target.id === id).map((f) => f.value));
    },
  };

  class FakeMap {
    constructor(options) { state.options = options; }

    addControl() {}

    on(event, layerOrHandler, handler) {
      if (event === 'load') state.loadCallbacks.push(layerOrHandler);
      else state.handlers[`${event}:${layerOrHandler}`] = handler;
    }

    addSource(id, source) { state.sources[id] = source; }

    addLayer(layer) { state.layers[layer.id] = layer; }

    setFeatureState(target, value) { state.featureStates.push({ target, value }); }

    setFilter(layer, expression) { state.filters[layer] = expression; }

    fitBounds(bounds, options) { state.fits.push({ bounds: bounds.toArray(), options }); }

    getCanvas() {
      return { style: { set cursor(v) { state.cursor = v; }, get cursor() { return state.cursor; } } };
    }
  }

  class FakePopup {
    constructor(options) {
      this.options = options;
      this.html = null;
      this.lngLat = null;
      this.open = false;
      state.popup = this;
    }

    setLngLat(lngLat) { this.lngLat = lngLat; return this; }

    setHTML(html) { this.html = html; return this; }

    addTo() { this.open = true; return this; }

    remove() { this.open = false; return this; }
  }

  Object.assign(mapboxgl, {
    accessToken: null,
    Map: FakeMap,
    Popup: FakePopup,
    NavigationControl: class {},
    LngLatBounds: FakeLngLatBounds,
  });
  return state;
}

/**
 * A `vega-embed` double. Each embed records its target and spec and hands back a view whose listeners a test can
 * fire, so a chart's clicks and hovers are tested without Vega drawing anything.
 * @returns {{embed: import('vitest').Mock, charts: object[]}} The mock to install as the package's default export,
 *   and every chart it drew, newest last: `{ target, spec, listeners, signals, finalized, fire(type, datum) }`.
 */
export function fakeVegaEmbed() {
  const charts = [];
  const embed = vi.fn(async (target, spec) => {
    const chart = { target, spec, listeners: {}, signals: [], finalized: false };
    chart.fire = (type, datum) => chart.listeners[type]?.({}, datum === undefined ? undefined : { datum });
    const view = {
      addEventListener: (type, fn) => { chart.listeners[type] = fn; },
      signal(name, value) { chart.signals.push({ name, value }); return { run() {} }; },
    };
    charts.push(chart);
    return { view, finalize: () => { chart.finalized = true; } };
  });
  return { embed, charts };
}
