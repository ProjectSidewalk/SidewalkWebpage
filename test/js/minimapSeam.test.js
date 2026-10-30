/**
 * The contract between Minimap and everything that draws on it (#5429).
 *
 * Minimap is the only class that names the map library; the peg, label icons, crumbs, flags, and Task's street lines
 * all reach the map through a handful of methods. These tests pin the parts of that seam a caller relies on but can't
 * see:
 *
 * - what a marker is to assistive tech and to the pointer, which follows from the options it was given. A marker with
 *   neither a handler nor a title must be click-through: the peg sits on top of the crumbs nearest the user (#2561).
 * - that however many streets change in a frame, the map receives one upload. A region's worth of Task.render() calls
 *   on load would otherwise re-tile the source once per street.
 * - that creating the minimap never waits on the tile host, a third party Explore must be able to start without, and
 *   never rejects: a browser without WebGL2 gets Explore with a minimap that says it can't draw.
 * - the zoom model: whole-level steps within fixed bounds, from the level being animated to rather than the fraction
 *   on screen, and an overview whose lower floor is lowered before fitting and raised only after returning.
 * - that the credits MapLibre opens on its own are closed once, and only once.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker, fakePanoManager } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key, language: 'pt-BR' } }));

// jsdom has no 2D canvas; the chevron's pixels aren't under test.
mockModule('frontend/js/explore/navigation/MinimapStyle.js', async (importOriginal) => {
  const actual = await importOriginal();
  actual.MinimapStyle.chevronImage = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
  return { ...actual };
});

// The class MapLibre's compact attribution carries while its credits are showing.
const CREDITS_SHOWN = 'maplibregl-compact-show';

const PANO = { lat: 47.6, lng: -122.33 };

/**
 * Stands in for maplibregl.Map: records the calls Minimap makes on it, in order, and fires 'style.load' but never
 * 'load'. Its zoom only moves when a test says so, the way a real one sits mid-animation after easeTo returns.
 */
class FakeMap {
  static instances = [];

  /** When true, 'style.load' waits for a test to fire it. */
  static holdStyle = false;

  constructor(options) {
    this.options = options;
    this.layers = [];
    this.calls = [];
    this.zoom = options.zoom;
    this.source = { setData: vi.fn() };
    this.handlers = {};
    this.onceHandlers = {};
    this.canvas = document.createElement('canvas');
    this.dragPan = {
      enabled: true,
      enable: () => { this.dragPan.enabled = true; },
      disable: () => { this.dragPan.enabled = false; },
    };
    // Where project() puts the pano; a test moves it to simulate a pan.
    this.panoPoint = { x: 100, y: 100 };
    FakeMap.instances.push(this);
  }

  getCanvas() {
    return this.canvas;
  }

  getContainer() {
    return document.getElementById(this.options.container);
  }

  project() {
    return this.panoPoint;
  }

  /**
   * @param {string} name
   * @param {object} [event] - What MapLibre would pass, e.g. `{ error }` for 'error'.
   */
  fire(name, event) {
    const once = this.onceHandlers[name] ?? [];
    this.onceHandlers[name] = [];
    [...(this.handlers[name] ?? []), ...once].forEach((handler) => handler(event));
  }

  addImage() {}

  addSource() {}

  getSource() {
    return this.source;
  }

  addLayer(layer, beforeId) {
    this.layers.push({ ...layer, beforeId });
  }

  getStyle() {
    return { ...this.options.style, layers: [...this.options.style.layers, ...this.layers] };
  }

  setLayoutProperty(...args) {
    this.calls.push(['setLayoutProperty', ...args]);
  }

  getZoom() {
    return this.zoom;
  }

  easeTo(options) {
    this.calls.push(['easeTo', options]);
  }

  jumpTo(options) {
    this.calls.push(['jumpTo', options]);
  }

  setMinZoom(zoom) {
    this.calls.push(['setMinZoom', zoom]);
  }

  cameraForBounds(bounds, options) {
    this.calls.push(['cameraForBounds', bounds, options]);
    return { center: [bounds.points[0][0], bounds.points[0][1]], zoom: 13.7 };
  }

  remove() {
    this.calls.push(['remove']);
  }

  on(name, handler) {
    (this.handlers[name] ??= []).push(handler);
  }

  // Only the style ever becomes ready: awaiting tiles ('load', 'idle') would hang, as Explore would. Set holdStyle
  // to fire 'style.load' by hand.
  once(name, handler) {
    if (name === 'style.load' && !FakeMap.holdStyle) setTimeout(handler, 0);
    else (this.onceHandlers[name] ??= []).push(handler);
  }

  off(name, handler) {
    for (const registry of [this.handlers, this.onceHandlers]) {
      registry[name] = (registry[name] ?? []).filter((registered) => registered !== handler);
    }
  }

  /**
   * @param {...string} names - Methods to keep.
   * @returns {Array<Array>} The recorded calls to those methods, oldest first.
   */
  callsTo(...names) {
    return this.calls.filter(([name]) => names.includes(name));
  }
}

/** Stands in for maplibregl.Marker. */
class FakeMarker {
  constructor(options) {
    this.options = options;
  }

  setLngLat(lngLat) {
    this.lngLat = lngLat;
    return this;
  }

  addTo() {
    return this;
  }

  remove() {
    this.removed = true;
  }
}

/** Stands in for maplibregl.LngLatBounds: collects the points it was extended by. */
class FakeLngLatBounds {
  points = [];

  extend(point) {
    this.points.push(point);
    return this;
  }

  isEmpty() {
    return this.points.length === 0;
  }
}

/**
 * Stands in for maplibregl.AttributionControl in its compact form: a <details> whose <summary> toggles the credits
 * the way MapLibre 6's own click handler does, class and `open` attribute together, and only once MapLibre has made it
 * compact. Until then it carries no credits, and MapLibre's stylesheet hides it (`maplibregl-attrib-empty`).
 */
class FakeAttributionControl {
  constructor(options) {
    this.options = options;
  }

  onAdd() {
    const details = document.createElement('details');
    details.className = 'maplibregl-ctrl maplibregl-ctrl-attrib';
    const summary = document.createElement('summary');
    summary.className = 'maplibregl-ctrl-attrib-button';
    details.appendChild(summary);
    summary.addEventListener('click', (e) => {
      // Keeps jsdom's own <details> toggle out of it, so `open` changes only as MapLibre changes it.
      e.preventDefault();
      if (!details.classList.contains('maplibregl-compact')) return;
      if (details.classList.contains(CREDITS_SHOWN)) {
        details.classList.remove(CREDITS_SHOWN);
        details.removeAttribute('open');
      } else {
        details.classList.add(CREDITS_SHOWN);
        details.setAttribute('open', '');
      }
    });
    return details;
  }
}

/** The page markup Minimap looks up by id, as in explore.scala.html. */
function buildDom() {
  document.body.innerHTML = `
    <div id="minimap-holder">
      <div id="minimap" style="width: 200px; height: 200px"></div>
      <p id="minimap-unavailable-message" role="status" hidden></p>
    </div>
    <button id="minimap-recenter" type="button" hidden></button>
    <button id="minimap-zoom-fit" type="button"></button>
    <button id="minimap-zoom-in" type="button"></button>
    <button id="minimap-zoom-out" type="button"></button>`;
}

/** The tracker every Minimap built by createMinimap logs through. */
let tracker;
let Minimap;
let MinimapBasemapStyle;

const ARCHIVE_URL = '/basemap/basemap-20261015-1760572800.pmtiles';
const GLYPHS_URL = '/basemap/glyphs/{fontstack}/{range}.pbf';

/** Builds a Minimap over the page's holder, centered on the pano, reading the given archive. */
const createMinimap = (tilesUrl = ARCHIVE_URL) => Minimap.create(
  { holder: document.getElementById('minimap-holder') }, PANO, fakePanoManager({ getPosition: () => PANO }), tracker,
  { tilesUrl, glyphsUrl: GLYPHS_URL },
);

/** The stand-ins for MapLibre and pmtiles, as the sources import them; refilled by setUpGlobals. */
let maplibregl;
let pmtiles;

/** Loads the sources and the globals they read, against a fresh DOM and a fresh stand-in for MapLibre. */
async function setUpGlobals(frames) {
  FakeMap.instances = [];
  FakeMap.holdStyle = false;
  buildDom();
  window.requestAnimationFrame = (callback) => frames.push(callback);
  maplibregl = {
    Map: FakeMap, Marker: FakeMarker, AttributionControl: FakeAttributionControl, LngLatBounds: FakeLngLatBounds,
    addProtocol: vi.fn(), setWorkerUrl: vi.fn(),
  };
  pmtiles = {
    Protocol: class {
      static options = [];

      constructor(options) {
        pmtiles.Protocol.options.push(options);
      }

      tile() {}
    },
  };
  mockModule('maplibre-gl', () => maplibregl);
  mockModule('pmtiles', () => pmtiles);
  mockModule('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'maplibre-gl-worker.js' }));
  tracker = fakeTracker();
  ({ Minimap, MinimapBasemapStyle } = await loadModules('frontend/js/explore/navigation/Minimap.js',
    'frontend/js/explore/navigation/MinimapBasemapStyle.js'));
}

describe('Minimap seam', () => {
  let minimap;
  let map;
  let frames;

  const flushFrame = () => frames.splice(0).forEach((callback) => callback());
  const click = (id) => document.getElementById(id).click();
  const tracked = (eventName) => tracker.push.mock.calls.filter(([name]) => name === eventName);

  beforeEach(async () => {
    frames = [];
    await setUpGlobals(frames);
    minimap = await createMinimap();
    [map] = FakeMap.instances;
  });

  test('creation resolves once the style is ready, without waiting for basemap tiles', () => {
    // Reaching this line is the assertion: FakeMap never fires 'load' or 'idle'.
    expect(map.options.center).toEqual([PANO.lng, PANO.lat]);
    expect(minimap.isAvailable()).toBe(true);
  });

  describe('map errors', () => {
    beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
    const tileError = (url) => ({ error: new Error(`AJAXError: Not Found (404): ${url}`) });

    test('each kind of error is logged once, whatever tile it came from, and every one reaches the console', () => {
      map.fire('error', tileError('https://example.org/basemap/a.pmtiles?z=1'));
      map.fire('error', tileError('https://example.org/basemap/a.pmtiles?z=2'));
      map.fire('error', { error: new Error('Worker failed to load. Check that the worker URL is correct.') });

      expect(tracked('Minimap_Error')).toEqual([
        ['Minimap_Error', { error: 'AJAXError: Not Found (404): <url>' }],
        ['Minimap_Error', { error: 'Worker failed to load. Check that the worker URL is correct.' }],
      ]);
      expect(console.error).toHaveBeenCalledTimes(3);
      expect(minimap.isAvailable()).toBe(true);
    });

    test('a page logs at most ten different errors', () => {
      for (let i = 0; i < 12; i++) map.fire('error', { error: new Error(`failure ${i}`) });
      expect(tracked('Minimap_Error')).toHaveLength(10);
    });

    test('an error with no message is logged as text, not as an empty note', () => {
      map.fire('error', { error: 'tile request aborted' });
      map.fire('error', { error: new Error('') });
      expect(tracked('Minimap_Error')).toEqual([
        ['Minimap_Error', { error: 'tile request aborted' }],
        ['Minimap_Error', { error: 'Error' }],
      ]);
    });
  });

  describe('panning', () => {
    // jsdom lays nothing out, so the container reports the size the map's CSS would give it.
    beforeEach(() => {
      const container = document.getElementById('minimap');
      Object.defineProperty(container, 'clientWidth', { value: 200 });
      Object.defineProperty(container, 'clientHeight', { value: 200 });
    });
    const recenter = () => document.getElementById('minimap-recenter');

    test('drag pans; nothing else moves the map, and the canvas is not a tab stop', () => {
      expect(map.options).toMatchObject({
        interactive: true, dragPan: true, scrollZoom: false, boxZoom: false, doubleClickZoom: false,
        dragRotate: false, keyboard: false, touchZoomRotate: false, touchPitch: false,
      });
      expect(map.getCanvas().getAttribute('tabindex')).toBe('-1');
    });

    test('a finished drag is logged', () => {
      map.fire('dragend');
      expect(tracked('Minimap_Pan')).toHaveLength(1);
    });

    test('the recenter button shows only while the pano is off the map\'s center, and returns to it', () => {
      map.fire('move');
      expect(recenter().hidden).toBe(true);

      map.panoPoint = { x: 150, y: 60 };
      map.fire('move');
      expect(recenter().hidden).toBe(false);

      click('minimap-zoom-in');
      map.calls.length = 0;
      click('minimap-recenter');
      expect(map.callsTo('easeTo')).toEqual([['easeTo', { center: [PANO.lng, PANO.lat], zoom: 17 }]]);
      expect(tracked('Click_MinimapRecenter')).toHaveLength(1);

      map.panoPoint = { x: 102, y: 99 };
      map.fire('move');
      expect(recenter().hidden).toBe(true);
    });

    test('the recenter button stays hidden in the overview, whose own button leads back', () => {
      minimap.setOverviewStreets(
        () => [{ getGeoJSON: () => ({ geometry: { coordinates: [[-122.3, 47.6], [-122.31, 47.61]] } }) }],
      );
      map.panoPoint = { x: 10, y: 10 };
      minimap.enterOverview();
      map.fire('move');
      expect(recenter().hidden).toBe(true);
    });

    test('the tutorial\'s hidden basemap also stops panning, which would slide the map off its screenshot', () => {
      minimap.setBasemapVisible(false);
      expect(map.dragPan.enabled).toBe(false);
      minimap.setBasemapVisible(true);
      expect(map.dragPan.enabled).toBe(true);
    });
  });

  test('the basemap is read from the city\'s archive through the pmtiles protocol, registered once', async () => {
    expect(map.options.style.sources[MinimapBasemapStyle.SOURCE_ID].url)
      .toBe(`pmtiles://${new URL(ARCHIVE_URL, window.location.href).href}`);
    expect(map.options.style.glyphs).toBe(GLYPHS_URL);
    await createMinimap();
    expect(maplibregl.addProtocol.mock.calls.map(([name]) => name)).toEqual(['pmtiles']);
    expect(pmtiles.Protocol.options).toEqual([{ metadata: true }]);
  });

  test('a city with no archive yet gets a background-only basemap, and the streets still draw', async () => {
    FakeMap.instances = [];
    await createMinimap(null);
    const [bare] = FakeMap.instances;
    expect(bare.options.style.sources).toEqual({});
    expect(bare.options.style.layers.map((layer) => layer.id)).toEqual(['background']);
    expect(bare.layers.map((layer) => layer.id)).toContain('street-remaining');
  });

  test('the map names its canvas and credits button in the user\'s language', () => {
    expect(map.options.locale).toEqual({
      'Map.Title': 'audit:right-ui.minimap.map-title',
      'AttributionControl.ToggleAttribution': 'audit:right-ui.minimap.attribution-toggle',
    });
  });

  test('road and water names are in the UI language where the tiles have it, else the local name', () => {
    const nameLayers = map.options.style.layers.filter((layer) => layer.type === 'symbol');
    expect(nameLayers.map((layer) => layer.id)).toEqual([
      'road-name-minor', 'road-name-major', 'waterway-name', 'water-name',
    ]);
    nameLayers.forEach((layer) => {
      expect(layer.layout['text-field']).toEqual(['coalesce', ['get', 'name:pt'], ['get', 'name']]);
    });
  });

  test('Chinese names are the script the UI reads, since the tiles carry no plain name:zh', () => {
    const textField = (language) => MinimapBasemapStyle.build(47.6, language, ARCHIVE_URL, GLYPHS_URL).layers
      .find((layer) => layer.id === 'road-name-minor').layout['text-field'];
    expect(textField('zh-TW')).toEqual(['coalesce', ['get', 'name:zh-Hant'], ['get', 'name']]);
    expect(textField('zh-CN')).toEqual(['coalesce', ['get', 'name:zh-Hans'], ['get', 'name']]);
  });

  test('living streets draw as minor roads, and disused rail doesn\'t draw', () => {
    const layers = MinimapBasemapStyle.build(47.6, 'en', ARCHIVE_URL, GLYPHS_URL).layers;
    const filterOf = (id) => JSON.stringify(layers.find((layer) => layer.id === id).filter);
    expect(filterOf('road-minor')).toContain('living_street');
    expect(filterOf('rail')).toContain('"light_rail"');
    expect(filterOf('rail')).not.toContain('disused');
  });

  test('street lines go over the whole basemap, road names included, so a name never hides the route', () => {
    expect(map.layers.length).toBeGreaterThan(0);
    map.layers.forEach((layer) => expect(layer.beforeId).toBeUndefined());
    // Bottom to top: context streets, a planned jump's connector, the route's casing and lines, then the chevrons.
    expect(map.layers.map((layer) => layer.id)).toEqual([
      'street-other', 'street-completed', 'street-jump', 'street-casing', 'street-audited', 'street-remaining',
      'street-remaining-chevrons',
    ]);
  });

  describe('zoom', () => {
    const easedZooms = () => map.callsTo('easeTo').map(([, options]) => options.zoom);

    test('the map starts at street level, bounded to 15..19 for manual zooming', () => {
      // ObservedArea's REFERENCE_ZOOM is pinned to the default; its fog is sized for that level.
      expect(map.options).toMatchObject({ zoom: 17, minZoom: 15, maxZoom: 19 });
    });

    test('the zoom buttons step a whole level at a time, centered on the pano, and stop at the bounds', () => {
      click('minimap-zoom-in');
      click('minimap-zoom-in');
      click('minimap-zoom-in');
      expect(easedZooms()).toEqual([18, 19]);
      map.callsTo('easeTo').forEach(([, options]) => expect(options.center).toEqual([PANO.lng, PANO.lat]));

      for (let i = 0; i < 5; i++) click('minimap-zoom-out');
      expect(easedZooms()).toEqual([18, 19, 18, 17, 16, 15]);
    });

    test('a step taken mid-animation counts from the level being animated to, not the fraction on screen', () => {
      click('minimap-zoom-in');
      map.zoom = 17.4;
      click('minimap-zoom-in');
      expect(easedZooms()).toEqual([18, 19]);
    });

    test('the tutorial\'s fixed minimap does not zoom', () => {
      document.getElementById('minimap-holder').classList.add('minimap-tutorial');
      click('minimap-zoom-in');
      click('minimap-zoom-fit');
      expect(map.calls).toEqual([]);
    });

    test('moving to a new pano mid-zoom lands on the level being animated to, never a fraction', () => {
      click('minimap-zoom-in');
      map.zoom = 17.4; // The ease is still running when the pano changes.
      const next = { lat: 47.61, lng: -122.34 };
      minimap.setMinimapLocation(next);

      const [, jump] = map.callsTo('jumpTo').at(-1);
      expect(jump).toEqual({ center: [next.lng, next.lat], zoom: 18 });
    });
  });

  describe('overview', () => {
    const ROUTE = [[-122.34, 47.60], [-122.33, 47.61]];

    beforeEach(() => {
      minimap.setOverviewStreets(() => [{ getGeoJSON: () => ({ geometry: { coordinates: ROUTE } }) }]);
    });

    const zoomCalls = () => map.callsTo('setMinZoom', 'cameraForBounds', 'jumpTo').map(([name, arg]) => [name, arg]);

    test('entering lowers the zoom floor before fitting, so the fit isn\'t clamped to street level', () => {
      click('minimap-zoom-fit');

      const calls = zoomCalls();
      expect(calls.map(([name]) => name)).toEqual(['setMinZoom', 'cameraForBounds', 'jumpTo']);
      expect(calls[0][1]).toBe(11);
      expect(calls[1][1].points).toEqual(ROUTE);
      expect(document.getElementById('minimap-holder').classList.contains('minimap-overview')).toBe(true);
      expect(tracked('Click_MinimapFitRoute')).toEqual([
        ['Click_MinimapFitRoute', { mode: 'overview', trigger: 'fit-button' }],
      ]);
    });

    test('the fit leaves room for a flag on any edge and lands on a whole zoom level', () => {
      click('minimap-zoom-fit');

      const [, , { padding }] = map.callsTo('cameraForBounds').at(-1);
      expect(padding.top).toBeGreaterThan(padding.bottom);
      expect(padding.left).toBeGreaterThan(padding.bottom);
      expect(padding.left).toBe(padding.right);
      expect(map.callsTo('jumpTo').at(-1)[1]).toEqual({ center: ROUTE[0], zoom: 13 });
    });

    test('leaving jumps back to street level before raising the floor again', () => {
      click('minimap-zoom-fit');
      map.calls = [];
      click('minimap-zoom-fit');

      // Raising the floor first would have MapLibre clamp the zoom itself, around the overview's center.
      expect(zoomCalls()).toEqual([
        ['jumpTo', { zoom: 17, center: [PANO.lng, PANO.lat] }],
        ['setMinZoom', 15],
      ]);
      expect(document.getElementById('minimap-holder').classList.contains('minimap-overview')).toBe(false);
      expect(tracked('MinimapOverview_End')).toEqual([['MinimapOverview_End', { trigger: 'fit-button' }]]);
    });

    test('leaving returns to the default level, whatever level the user had zoomed to before', () => {
      click('minimap-zoom-in');
      click('minimap-zoom-in');
      click('minimap-zoom-fit');
      click('minimap-zoom-fit');
      map.calls = [];

      click('minimap-zoom-in');
      expect(map.callsTo('easeTo').map(([, options]) => options.zoom)).toEqual([18]);
    });

    test('a zoom button while fitted goes back to street level instead of zooming the overview', () => {
      click('minimap-zoom-fit');
      map.calls = [];
      click('minimap-zoom-out');

      expect(map.callsTo('easeTo')).toEqual([]);
      expect(zoomCalls().map(([name]) => name)).toEqual(['jumpTo', 'setMinZoom']);
      expect(tracked('MinimapOverview_End')).toEqual([['MinimapOverview_End', { trigger: 'zoom' }]]);
    });

    test('reaching a new pano while fitted goes back to street level there', () => {
      click('minimap-zoom-fit');
      minimap.setMinimapLocation({ lat: 47.61, lng: -122.34 });

      expect(tracked('MinimapOverview_End')).toEqual([['MinimapOverview_End', { trigger: 'pano-changed' }]]);
      const [, jump] = map.callsTo('jumpTo').at(-1);
      expect(jump).toEqual({ center: [-122.34, 47.61], zoom: 17 });
    });

    test('with no street geometry loaded yet there is nothing to fit, so the mode doesn\'t change', () => {
      minimap.setOverviewStreets(() => []);
      minimap.enterOverview();
      expect(map.calls).toEqual([]);
      expect(document.getElementById('minimap-holder').classList.contains('minimap-overview')).toBe(false);
    });
  });

  describe('credits', () => {
    const credits = () => document.querySelector('#minimap-attribution .maplibregl-ctrl-attrib');
    const creditsButton = () => document.querySelector('#minimap-attribution .maplibregl-ctrl-attrib-button');
    const isShown = () => credits().classList.contains(CREDITS_SHOWN);
    /** What MapLibre does when the tile source first reports its credits: makes them compact and opens them. */
    const autoOpen = () => {
      credits().classList.add('maplibregl-compact', CREDITS_SHOWN);
      credits().setAttribute('open', '');
    };
    // MutationObserver callbacks run as a microtask.
    const observed = () => Promise.resolve();

    test('are mounted beside the map in their compact form', () => {
      expect(document.getElementById('minimap-attribution').parentElement.id).toBe('minimap-holder');
      expect(credits()).not.toBeNull();
    });

    test('MapLibre\'s first automatic open is undone, in both the class and the announced state', async () => {
      autoOpen();
      await observed();

      expect(isShown()).toBe(false);
      expect(credits().hasAttribute('open')).toBe(false);
      expect(tracked('Click_MinimapAttribution')).toEqual([]);
    });

    test('once closed, a user\'s open stays open, and each toggle is logged with the state it left', async () => {
      autoOpen();
      await observed();

      creditsButton().click();
      await observed();
      expect(isShown()).toBe(true);
      expect(credits().hasAttribute('open')).toBe(true);

      creditsButton().click();
      await observed();
      expect(isShown()).toBe(false);

      expect(tracked('Click_MinimapAttribution')).toEqual([
        ['Click_MinimapAttribution', { action: 'open', trigger: 'button' }],
        ['Click_MinimapAttribution', { action: 'close', trigger: 'button' }],
      ]);
    });

    test('open credits close on a press elsewhere or on Esc, but not on a press inside them', async () => {
      autoOpen();
      await observed();
      const openByUser = async () => {
        creditsButton().click();
        await observed();
      };
      const press = (el) => el.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      await openByUser();
      press(creditsButton());
      expect(isShown()).toBe(true);
      press(document.body);
      expect(isShown()).toBe(false);
      expect(credits().hasAttribute('open')).toBe(false);

      await openByUser();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(isShown()).toBe(false);

      // Already closed: another outside press is not a second close.
      press(document.body);
      expect(tracked('Click_MinimapAttribution').map(([, note]) => note)).toEqual([
        { action: 'open', trigger: 'button' },
        { action: 'close', trigger: 'outside' },
        { action: 'open', trigger: 'button' },
        { action: 'close', trigger: 'escape' },
      ]);
    });
  });

  test('hiding the basemap hides the background and basemap layers only, leaving the streets drawn', () => {
    const basemapLayerIds = map.options.style.layers
      .filter((layer) => layer.type === 'background' || layer.source === MinimapBasemapStyle.SOURCE_ID)
      .map((layer) => layer.id);
    expect(basemapLayerIds).toContain('background');

    minimap.setBasemapVisible(false);
    const hidden = map.callsTo('setLayoutProperty');
    expect(hidden.map(([, id]) => id)).toEqual(basemapLayerIds);
    hidden.forEach(([, , property, value]) => expect([property, value]).toEqual(['visibility', 'none']));
    expect(hidden.some(([, id]) => id.startsWith('street-'))).toBe(false);

    map.calls = [];
    minimap.setBasemapVisible(true);
    expect(map.callsTo('setLayoutProperty').map(([, id, , value]) => [id, value]))
      .toEqual(basemapLayerIds.map((id) => [id, 'visible']));
  });

  describe('addMarker', () => {
    test('a marker with a click handler is a named button that click and Enter activate', () => {
      const onClick = vi.fn();
      const { element } = minimap.addMarker(PANO, document.createElement('div'), { onClick, title: 'Go' });

      expect(element.getAttribute('role')).toBe('button');
      expect(element.getAttribute('tabindex')).toBe('0');
      expect(element.getAttribute('aria-label')).toBe('Go');

      element.click();
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(onClick).toHaveBeenCalledTimes(2);
    });

    test('Space does not activate a marker: it is Explore\'s step-forward key, and would fire both', () => {
      const onClick = vi.fn();
      const { element } = minimap.addMarker(PANO, document.createElement('div'), { onClick, title: 'Go' });

      const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true });
      element.dispatchEvent(space);
      expect(onClick).not.toHaveBeenCalled();
      // Left for the global handler to act on.
      expect(space.defaultPrevented).toBe(false);
    });

    test('a marker with only a title is a named image, not a tab stop', () => {
      const { element } = minimap.addMarker(PANO, document.createElement('img'), { title: 'Route start' });

      expect(element.getAttribute('role')).toBe('img');
      expect(element.getAttribute('aria-label')).toBe('Route start');
      expect(element.getAttribute('data-ps-tooltip')).toBe('Route start');
      expect(element.hasAttribute('title')).toBe(false);
      expect(element.hasAttribute('tabindex')).toBe(false);
      expect(element.classList.contains('minimap-marker-decorative')).toBe(false);
    });

    test('a marker with neither is decoration: hidden from assistive tech and click-through', () => {
      const { element } = minimap.addMarker(PANO, document.createElement('div'));

      expect(element.getAttribute('aria-hidden')).toBe('true');
      expect(element.classList.contains('minimap-marker-decorative')).toBe(true);
      // Every marker states its own role: MapLibre makes one that doesn't a button named "Map marker".
      expect(element.hasAttribute('role')).toBe(true);
      expect(element.hasAttribute('aria-label')).toBe(true);
    });

    test('the map positions a wrapper, leaving the content\'s own transform alone', () => {
      const content = document.createElement('div');
      content.style.transform = 'rotate(90deg)';
      const marker = minimap.addMarker(PANO, content);

      expect(marker.element).not.toBe(content);
      expect(marker.element.contains(content)).toBe(true);
      expect(marker.content).toBe(content);
    });

    test('setVisible hides a marker without removing it', () => {
      const marker = minimap.addMarker(PANO, document.createElement('div'));
      marker.setVisible(false);
      expect(marker.element.hidden).toBe(true);
      marker.setVisible(true);
      expect(marker.element.hidden).toBe(false);
    });
  });

  describe('street lines', () => {
    const line = (kind, ...coordinates) => ({ kind, coordinates });
    const uploaded = () => map.source.setData.mock.calls.at(-1)[0].features;

    test('many streets changing in one frame reach the map as a single upload', () => {
      for (let streetEdgeId = 1; streetEdgeId <= 50; streetEdgeId++) {
        minimap.setStreetLines(`street-${streetEdgeId}`, [line('other', [0, 0], [1, 1])]);
      }
      expect(map.source.setData).not.toHaveBeenCalled();

      flushFrame();
      expect(map.source.setData).toHaveBeenCalledTimes(1);
      expect(uploaded()).toHaveLength(50);
    });

    test('setting a key replaces what it drew before', () => {
      minimap.setStreetLines('street-7', [line('remaining', [0, 0], [1, 1])]);
      minimap.setStreetLines('street-7', [line('audited', [0, 0], [1, 1]), line('remaining', [1, 1], [2, 2])]);
      flushFrame();

      expect(uploaded().map((feature) => feature.properties.kind)).toEqual(['audited', 'remaining']);
    });

    test('one street walked twice on a route draws both passes, each under its own key', () => {
      // An out-and-back route visits the same street edge on the way out and on the way back.
      minimap.setStreetLines('route-street-1', [line('audited', [0, 0], [1, 1])]);
      minimap.setStreetLines('route-street-2', [line('remaining', [1, 1], [0, 0])]);
      flushFrame();
      expect(uploaded().map((feature) => feature.properties.kind)).toEqual(['audited', 'remaining']);

      minimap.setStreetLines('route-street-1', []);
      flushFrame();
      expect(uploaded().map((feature) => feature.properties.kind)).toEqual(['remaining']);
    });

    test('a half sliced down to a single point is dropped rather than sent as a degenerate line', () => {
      minimap.setStreetLines('street-7', [line('audited', [0, 0]), line('remaining', [0, 0], [1, 1])]);
      flushFrame();

      expect(uploaded().map((feature) => feature.properties.kind)).toEqual(['remaining']);
    });

    test('a street drawn with no lines comes off the map', () => {
      minimap.setStreetLines('street-7', [line('other', [0, 0], [1, 1])]);
      flushFrame();

      minimap.setStreetLines('street-7', []);
      flushFrame();
      expect(uploaded()).toHaveLength(0);
    });
  });
});

describe('Minimap without a map', () => {
  let frames;

  beforeEach(async () => {
    frames = [];
    await setUpGlobals(frames);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const holder = () => document.getElementById('minimap-holder');
  const message = () => document.getElementById('minimap-unavailable-message');
  const unavailableEvents = () => tracker.push.mock.calls.filter(([name]) => name === 'Minimap_Unavailable');

  test('with no WebGL2, creation still resolves, and the minimap says it can\'t draw', async () => {
    maplibregl.Map = class {
      constructor() {
        throw new Error('Failed to initialize WebGL');
      }
    };

    const minimap = await createMinimap();

    expect(minimap.isAvailable()).toBe(false);
    expect(holder().classList.contains('minimap-unavailable')).toBe(true);
    expect(message().hidden).toBe(false);
    expect(unavailableEvents()).toEqual([['Minimap_Unavailable', { error: 'Failed to initialize WebGL' }]]);
  });

  test('callers keep working against it without special cases, and nothing is queued for a map', async () => {
    maplibregl.Map = class {
      constructor() {
        throw new Error('Failed to initialize WebGL');
      }
    };
    const minimap = await createMinimap();

    const onClick = vi.fn();
    const marker = minimap.addMarker(PANO, document.createElement('div'), { onClick, title: 'Go' });
    expect(() => {
      marker.setLatLng({ lat: 47.61, lng: -122.34 });
      marker.setVisible(false);
      marker.remove();
      minimap.setStreetLines('street-1', [{ kind: 'other', coordinates: [[0, 0], [1, 1]] }]);
      minimap.setMinimapLocation({ lat: 47.61, lng: -122.34 });
      minimap.setBasemapVisible(false);
      minimap.toggleOverview('fit-button');
      minimap.enterOverview();
    }).not.toThrow();
    expect(frames).toHaveLength(0);
    // The marker keeps its role, so a caller that builds one before the failure is known still gets a real element.
    expect(marker.element.getAttribute('role')).toBe('button');
  });

  test('a failure after the map exists takes the map and its credits down with it', async () => {
    maplibregl.Map = class extends FakeMap {
      addImage() {
        throw new Error('WebGL context lost');
      }
    };

    const minimap = await createMinimap();
    const [map] = FakeMap.instances;

    expect(minimap.isAvailable()).toBe(false);
    expect(map.callsTo('remove')).toHaveLength(1);
    expect(document.getElementById('minimap-attribution')).toBeNull();
    expect(unavailableEvents()).toEqual([['Minimap_Unavailable', { error: 'WebGL context lost' }]]);
  });

  test('an error before the style is ready ends the wait and says the map can\'t draw', async () => {
    FakeMap.holdStyle = true;
    const creating = createMinimap();
    const [map] = FakeMap.instances;
    map.fire('error', { error: new Error('layers.background: missing required property "type"') });
    const minimap = await creating;

    expect(minimap.isAvailable()).toBe(false);
    expect(map.callsTo('remove')).toHaveLength(1);
    expect(unavailableEvents()).toEqual(
      [['Minimap_Unavailable', { error: 'layers.background: missing required property "type"' }]]);
    expect(tracker.push.mock.calls.filter(([name]) => name === 'Minimap_Error')).toEqual([]);
  });

});
