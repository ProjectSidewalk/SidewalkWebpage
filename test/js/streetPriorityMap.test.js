/**
 * Tests for the Imagery page's segment map (#4908).
 *
 * The map is the page's headline, and everything interesting about it is arranged before a tile is ever drawn: the
 * bounds it opens on, the paint expressions that turn a tier into a color, the hover/click plumbing that
 * brushes a region across the rest of the page, and the popup that explains one street's priority. Mapbox GL cannot
 * run under jsdom (no WebGL), so this stands up a `mapboxgl` double that records what the map was asked to do — the
 * arrangement is ours to get right, the rendering is Mapbox's.
 *
 * Runs under jsdom (jest.config.js). StreetPriorityMap is a bare top-level class in a concatenated bundle, so it is
 * eval'd into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard');

/** Loads AdminShell (the popup escapes through it) and returns the map class. */
function loadMap() {
  const shell = fs.readFileSync(path.join(JS_DIR, 'AdminShell.js'), 'utf8');
  const map = fs.readFileSync(path.join(JS_DIR, 'StreetPriorityMap.js'), 'utf8');
  return (0, eval)(`${shell}\nglobalThis.AdminShell = AdminShell;\n${map}\n`
    + 'globalThis.StreetPriorityTiers = StreetPriorityTiers;\nStreetPriorityMap;');
}

const StreetPriorityMap = loadMap();

/** A minimal `mapboxgl` double: records layers, sources, feature states and handlers instead of drawing. */
function stubMapbox() {
  const state = {
    options: null,
    mapInstance: null,
    sources: {},
    layers: {},
    handlers: [],
    featureStates: [],
    controls: [],
    popup: null,
    cursor: '',
  };

  class FakeMap {
    constructor(options) {
      state.options = options;
      state.mapInstance = this;
      this.loadCallbacks = [];
    }

    addControl(control, position) { state.controls.push({ control, position }); }

    on(event, layerOrHandler, maybeHandler) {
      if (event === 'load') { this.loadCallbacks.push(layerOrHandler); return; }
      state.handlers.push({ event, layer: layerOrHandler, handler: maybeHandler });
    }

    addSource(id, source) { state.sources[id] = source; }

    addLayer(layer) { state.layers[layer.id] = layer; }

    setFeatureState(target, value) { state.featureStates.push({ target, value }); }

    getCanvas() { return { style: { set cursor(v) { state.cursor = v; }, get cursor() { return state.cursor; } } }; }

    /** Fires the 'load' handlers, standing in for the style finishing its first render. */
    finishLoad() { this.loadCallbacks.forEach((cb) => cb()); }
  }

  class FakePopup {
    constructor(options) { this.options = options; this.html = null; this.lngLat = null; this.attached = false; }

    setLngLat(lngLat) { this.lngLat = lngLat; return this; }

    setHTML(html) { this.html = html; return this; }

    addTo() { this.attached = true; return this; }

    remove() { this.attached = false; return this; }
  }

  class FakeNavigationControl {}

  global.mapboxgl = {
    accessToken: null,
    Map: FakeMap,
    Popup: class extends FakePopup {
      constructor(options) { super(options); state.popup = this; }
    },
    NavigationControl: FakeNavigationControl,
  };
  return state;
}

/** A two-segment FeatureCollection shaped the way ImageryPage's join hands it over. */
function geojson() {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[-122.35, 47.6], [-122.34, 47.61]] },
        properties: {
          street_edge_id: 1, region_id: 7, region_name: 'Downtown', priority: 1, priority_tier: 'unaudited',
          fresh_good_count: 0, outdated_good_count: 0, bad_count: 0, last_audit_date: null,
          median_newest_capture: null,
        },
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[-122.4, 47.55], [-122.39, 47.66]] },
        properties: {
          street_edge_id: 2, region_id: 8, region_name: 'Ballard', priority: 0.5, priority_tier: 'reaudit',
          fresh_good_count: 0, outdated_good_count: 2, bad_count: 1, last_audit_date: '2022-04-05',
          median_newest_capture: '2025-08-01',
        },
      },
    ],
  };
}

describe('StreetPriorityMap.init', () => {
  afterEach(() => { delete global.mapboxgl; });

  test('refuses to start without a Mapbox token rather than rendering a blank box', () => {
    stubMapbox();
    document.body.innerHTML = '<div id="priority-map"></div>';
    const map = new StreetPriorityMap('priority-map', {});
    expect(() => map.init(geojson())).toThrow(/Mapbox access token/);
  });

  test('opens on a bounds box covering every segment', () => {
    const state = stubMapbox();
    document.body.innerHTML = '<div id="priority-map"></div>';
    new StreetPriorityMap('priority-map', { mapboxToken: 'pk.test' }).init(geojson());
    // Both corners come from different features, so a bounds box built from only the first would fail here.
    expect(state.options.bounds).toEqual([[-122.4, 47.55], [-122.34, 47.66]]);
    expect(state.options.container).toBe('priority-map');
    expect(global.mapboxgl.accessToken).toBe('pk.test');
  });

  test('resolves only once the style has loaded, so callers cannot draw into a map that has no layers', async () => {
    const state = stubMapbox();
    document.body.innerHTML = '<div id="priority-map"></div>';
    const map = new StreetPriorityMap('priority-map', { mapboxToken: 'pk.test' });
    let resolved = false;
    const ready = map.init(geojson()).then(() => { resolved = true; });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(Object.keys(state.layers)).toHaveLength(0);

    state.mapInstance.finishLoad();
    await ready;
    expect(resolved).toBe(true);
    expect(Object.keys(state.layers)).toHaveLength(2);
  });
});

describe('StreetPriorityMap layers', () => {
  let state;
  let map;

  beforeEach(async () => {
    state = stubMapbox();
    document.body.innerHTML = '<div id="priority-map"></div>';
    map = new StreetPriorityMap('priority-map', {
      mapboxToken: 'pk.test',
      onRegionClick: jest.fn(),
      onRegionHover: jest.fn(),
      onRegionHoverEnd: jest.fn(),
    });
    const ready = map.init(geojson());
    state.mapInstance.finishLoad();
    await ready;
  });

  afterEach(() => { delete global.mapboxgl; });

  test('promotes street_edge_id so feature state can be addressed by the id the rest of the page uses', () => {
    const source = state.sources['imagery-priority-streets'];
    expect(source.type).toBe('geojson');
    expect(source.promoteId).toBe('street_edge_id');
  });

  test('colors segments by tier through the shared palette', () => {
    const paint = state.layers['imagery-priority-line'].paint;
    expect(paint['line-color']).toEqual(StreetPriorityTiers.mapboxExpression());
  });

  test('carries the tier in color alone, so no second channel can disagree with the legend', () => {
    const paint = state.layers['imagery-priority-line'].paint;
    expect(paint['line-dasharray']).toBeUndefined();
    expect(JSON.stringify(paint['line-width'])).not.toContain('priority_tier');
  });

  test('draws segments wide enough for the palette to separate against the basemap, and thickens them on hover', () => {
    // Below ~2px the tier hues collapse into the basemap's own grey roads, which is what the palette assumes.
    const width = state.layers['imagery-priority-line'].paint['line-width'];
    expect(width[0]).toBe('case');
    expect(width[1]).toEqual(['boolean', ['feature-state', 'hover'], false]);
    expect(width[3]).toBeGreaterThanOrEqual(2);
    expect(width[2]).toBeGreaterThan(width[3]);
  });

  test('draws the pinned outline from feature state, not from a filtered second source', () => {
    const selected = state.layers['imagery-priority-selected'];
    expect(selected.paint['line-color']).toBe(StreetPriorityTiers.SELECTED);
    expect(selected.paint['line-width'])
      .toEqual(['case', ['boolean', ['feature-state', 'selected'], false], 5, 0]);
    expect(selected.source).toBe('imagery-priority-streets');
  });
});

describe('StreetPriorityMap interactions', () => {
  let state;
  let map;
  let hooks;

  /** Fires a recorded map handler for the street layer. */
  const fire = (event, payload) => {
    const entry = state.handlers.find((h) => h.event === event && h.layer === 'imagery-priority-line');
    entry.handler(payload);
  };

  const hoverEvent = (feature) => ({ features: [feature], lngLat: { lng: -122.3, lat: 47.6 } });

  beforeEach(async () => {
    state = stubMapbox();
    document.body.innerHTML = '<div id="priority-map"></div>';
    hooks = { onRegionClick: jest.fn(), onRegionHover: jest.fn(), onRegionHoverEnd: jest.fn() };
    map = new StreetPriorityMap('priority-map', { mapboxToken: 'pk.test', ...hooks });
    const ready = map.init(geojson());
    state.mapInstance.finishLoad();
    await ready;
    state.featureStates.length = 0;
  });

  afterEach(() => { delete global.mapboxgl; });

  test('brushes the hovered segment\'s region and thickens the segment itself', () => {
    fire('mousemove', hoverEvent({ id: 2, properties: geojson().features[1].properties }));
    expect(hooks.onRegionHover).toHaveBeenCalledWith(8);
    expect(state.featureStates).toContainEqual({
      target: { source: 'imagery-priority-streets', id: 2 }, value: { hover: true },
    });
    expect(state.cursor).toBe('pointer');
  });

  test('does not re-fire the brush while the pointer stays on one segment', () => {
    const event = hoverEvent({ id: 2, properties: geojson().features[1].properties });
    fire('mousemove', event);
    fire('mousemove', event);
    fire('mousemove', event);
    // Mapbox emits mousemove continuously; re-brushing per pixel would re-render the tables on every mouse motion.
    expect(hooks.onRegionHover).toHaveBeenCalledTimes(1);
  });

  test('clears the previous segment\'s hover state when the pointer moves to another', () => {
    fire('mousemove', hoverEvent({ id: 2, properties: geojson().features[1].properties }));
    fire('mousemove', hoverEvent({ id: 1, properties: geojson().features[0].properties }));
    expect(state.featureStates).toContainEqual({
      target: { source: 'imagery-priority-streets', id: 2 }, value: { hover: false },
    });
    expect(hooks.onRegionHover).toHaveBeenLastCalledWith(7);
  });

  test('drops the brush and the popup when the pointer leaves the layer', () => {
    fire('mousemove', hoverEvent({ id: 2, properties: geojson().features[1].properties }));
    expect(state.popup.attached).toBe(true);
    fire('mouseleave', {});
    expect(hooks.onRegionHoverEnd).toHaveBeenCalled();
    expect(state.popup.attached).toBe(false);
    expect(state.cursor).toBe('');
  });

  test('pins the clicked segment\'s region', () => {
    fire('click', { features: [{ id: 2, properties: geojson().features[1].properties }] });
    expect(hooks.onRegionClick).toHaveBeenCalledWith(8);
  });

  test('ignores a click that hit no feature', () => {
    fire('click', { features: [] });
    expect(hooks.onRegionClick).not.toHaveBeenCalled();
  });
});

describe('StreetPriorityMap popup', () => {
  let state;

  const showPopupFor = (properties) => {
    const entry = state.handlers.find((h) => h.event === 'mousemove');
    entry.handler({ features: [{ id: properties.street_edge_id, properties }], lngLat: { lng: 0, lat: 0 } });
    return state.popup.html;
  };

  beforeEach(async () => {
    state = stubMapbox();
    document.body.innerHTML = '<div id="priority-map"></div>';
    const map = new StreetPriorityMap('priority-map', { mapboxToken: 'pk.test' });
    const ready = map.init(geojson());
    state.mapInstance.finishLoad();
    await ready;
  });

  afterEach(() => { delete global.mapboxgl; });

  test('explains a street\'s tier with the counts that produced it', () => {
    const html = showPopupFor(geojson().features[1].properties);
    expect(html).toContain('Street 2');
    expect(html).toContain('Needs re-audit');
    expect(html).toContain('0.500');
    expect(html).toContain('Ballard');
    expect(html).toContain('0 current, 2 outdated, 1 low quality');
    expect(html).toContain('2022-04-05');
    expect(html).toContain('2025-08-01');
  });

  test('says a street has never been audited or polled rather than leaving the rows blank', () => {
    const html = showPopupFor(geojson().features[0].properties);
    expect(html).toContain('never');
    expect(html).toContain('not polled');
  });

  test('renders a non-numeric priority as an em dash instead of crashing on toFixed', () => {
    // Mapbox serializes feature properties through its own tile encoding, so a value can arrive as a string.
    const html = showPopupFor({ ...geojson().features[0].properties, priority: 'unknown' });
    expect(html).toContain('<dd>—</dd>');
  });

  test('escapes a region name rather than interpolating it into the popup markup', () => {
    const html = showPopupFor({ ...geojson().features[0].properties, region_name: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('StreetPriorityMap.highlightSegments', () => {
  let state;
  let map;

  beforeEach(async () => {
    state = stubMapbox();
    document.body.innerHTML = '<div id="priority-map"></div>';
    map = new StreetPriorityMap('priority-map', { mapboxToken: 'pk.test' });
    const ready = map.init(geojson());
    state.mapInstance.finishLoad();
    await ready;
    state.featureStates.length = 0;
  });

  afterEach(() => { delete global.mapboxgl; });

  test('selects exactly the given segments', () => {
    map.highlightSegments([1, 2]);
    expect(state.featureStates).toEqual([
      { target: { source: 'imagery-priority-streets', id: 1 }, value: { selected: true } },
      { target: { source: 'imagery-priority-streets', id: 2 }, value: { selected: true } },
    ]);
  });

  test('touches only what changed when the highlight moves', () => {
    map.highlightSegments([1, 2]);
    state.featureStates.length = 0;
    map.highlightSegments([2, 3]);
    // A city's region can hold thousands of segments; re-setting every id on each hover is the difference between a
    // brush that keeps up with the pointer and one that does not.
    expect(state.featureStates).toEqual([
      { target: { source: 'imagery-priority-streets', id: 1 }, value: { selected: false } },
      { target: { source: 'imagery-priority-streets', id: 3 }, value: { selected: true } },
    ]);
  });

  test('accepts ids as strings, which is how a table row\'s dataset hands them over', () => {
    map.highlightSegments(['1']);
    expect(state.featureStates).toEqual([
      { target: { source: 'imagery-priority-streets', id: 1 }, value: { selected: true } },
    ]);
  });

  test('clearHighlight deselects everything it had selected', () => {
    map.highlightSegments([1, 2]);
    state.featureStates.length = 0;
    map.clearHighlight();
    expect(state.featureStates).toEqual([
      { target: { source: 'imagery-priority-streets', id: 1 }, value: { selected: false } },
      { target: { source: 'imagery-priority-streets', id: 2 }, value: { selected: false } },
    ]);
    state.featureStates.length = 0;
    map.clearHighlight();
    expect(state.featureStates).toEqual([]);
  });
});
