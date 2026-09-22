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
 *
 * The sources are top-level `class` declarations written for the Grunt-concatenation world, so they are eval'd into
 * the jsdom global scope against a stand-in for the MapLibre global.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const NAVIGATION_DIR = 'public/js/explore/src/navigation';
const SOURCES = ['MinimapStyle', 'MinimapBasemapStyle', 'Minimap'];

// The class MapLibre's compact attribution carries while its credits are showing.
const CREDITS_SHOWN = 'maplibregl-compact-show';

const PANO = { lat: 47.6, lng: -122.33 };

/**
 * Stands in for maplibregl.Map: records the calls Minimap makes on it, in order, and fires 'style.load' but never
 * 'load'. Its zoom only moves when a test says so, the way a real one sits mid-animation after easeTo returns.
 */
class FakeMap {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.layers = [];
    this.images = [];
    this.calls = [];
    this.zoom = options.zoom;
    this.source = { setData: jest.fn() };
    this.handlers = {};
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

  /** Fires a map event at every handler registered for it. */
  fire(name) {
    (this.handlers[name] ?? []).forEach((handler) => handler());
  }

  addImage(id) {
    this.images.push(id);
  }

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

  fitBounds(bounds, options) {
    this.calls.push(['fitBounds', bounds, options]);
  }

  remove() {
    this.calls.push(['remove']);
  }

  on(name, handler) {
    (this.handlers[name] ??= []).push(handler);
  }

  // Only the style ever becomes ready: a test that awaited tiles ('load', 'idle') would hang, as Explore would.
  once(name, handler) {
    if (name === 'style.load') setTimeout(handler, 0);
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

/**
 * The slice of jQuery Minimap calls on svl.ui.minimap.holder.
 * @param {HTMLElement} element
 * @returns {object}
 */
function fakeJQuery(element) {
  const wrapped = {
    hasClass: (name) => element.classList.contains(name),
    addClass: (name) => { element.classList.add(name); return wrapped; },
    removeClass: (name) => { element.classList.remove(name); return wrapped; },
  };
  return wrapped;
}

/** Loads the sources and the globals they read, against a fresh DOM and a fresh stand-in for MapLibre. */
function setUpGlobals(frames) {
  FakeMap.instances = [];
  buildDom();
  window.requestAnimationFrame = (callback) => frames.push(callback);
  window.util = { assetPath: (logicalPath) => logicalPath };
  window.i18next = { t: (key) => key };
  window.maplibregl = {
    Map: FakeMap, Marker: FakeMarker, AttributionControl: FakeAttributionControl, LngLatBounds: FakeLngLatBounds,
  };
  window.svl = {
    ui: { minimap: { holder: fakeJQuery(document.getElementById('minimap-holder')) } },
    tracker: { push: jest.fn() },
    panoViewer: { getPosition: () => PANO },
  };
  for (const name of SOURCES) {
    window.eval(`${readSrc(`${NAVIGATION_DIR}/${name}.js`)}; window.${name} = ${name};`);
  }
  // jsdom has no 2D canvas; the icons' pixels aren't under test.
  window.MinimapStyle.chevronImage = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
  window.MinimapStyle.landmarkIcon = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
  window.eval(`${readSrc('public/js/common/PlaceCategoryIcons.js')}; window.PlaceCategoryIcons = PlaceCategoryIcons;`);
}

describe('Minimap seam', () => {
  let minimap;
  let map;
  let frames;

  const flushFrame = () => frames.splice(0).forEach((callback) => callback());
  const click = (id) => document.getElementById(id).click();
  const tracked = (eventName) => window.svl.tracker.push.mock.calls.filter(([name]) => name === eventName);

  beforeEach(async () => {
    frames = [];
    setUpGlobals(frames);
    minimap = await window.Minimap.create(PANO);
    [map] = FakeMap.instances;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('creation resolves once the style is ready, without waiting for basemap tiles', () => {
    // Reaching this line is the assertion: FakeMap never fires 'load' or 'idle'.
    expect(map.options.center).toEqual([PANO.lng, PANO.lat]);
    expect(minimap.isAvailable()).toBe(true);
  });

  test('landmarks load each category\'s icon once, before the places that need it are drawn', async () => {
    // jsdom has no Image.decode; a resolved one stands in for a loaded glyph.
    window.HTMLImageElement.prototype.decode = () => Promise.resolve();
    const place = (category) => ({ type: 'Feature', properties: { category }, geometry: null });
    const first = { type: 'FeatureCollection', features: [place('school'), place('school'), place('government')] };
    await minimap.setLandmarks(first);
    await minimap.setLandmarks({ type: 'FeatureCollection', features: [place('school')] });

    expect(map.images.filter((id) => id.startsWith('minimap-place-')))
      .toEqual(['minimap-place-school', 'minimap-place-government']);
    delete window.HTMLImageElement.prototype.decode;
    expect(map.source.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [place('school')] });
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
      window.svl.regionModel = { isRoute: true };
      window.svl.taskContainer = {
        getTasks: () => [{ getGeoJSON: () => ({ geometry: { coordinates: [[-122.3, 47.6], [-122.31, 47.61]] } }) }],
      };
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

  test('the map names its canvas and credits button in the user\'s language', () => {
    expect(map.options.locale).toEqual({
      'Map.Title': 'audit:right-ui.minimap.map-title',
      'AttributionControl.ToggleAttribution': 'audit:right-ui.minimap.attribution-toggle',
    });
  });

  test('street lines go over the whole basemap, road names and landmarks included, so nothing hides the route', () => {
    expect(map.layers.length).toBeGreaterThan(0);
    map.layers.forEach((layer) => expect(layer.beforeId).toBeUndefined());
    // Bottom to top: landmarks, context streets, then the route's casing, its lines, and the chevrons over everything.
    expect(map.layers.map((layer) => layer.id)).toEqual([
      'landmarks', 'street-other', 'street-completed', 'street-casing', 'street-audited', 'street-remaining',
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
      window.svl.regionModel = { isRoute: true };
      window.svl.taskContainer = { getTasks: () => [{ getGeoJSON: () => ({ geometry: { coordinates: ROUTE } }) }] };
    });

    const zoomCalls = () => map.callsTo('setMinZoom', 'fitBounds', 'jumpTo').map(([name, arg]) => [name, arg]);

    test('entering lowers the zoom floor before fitting, so the fit isn\'t clamped to street level', () => {
      click('minimap-zoom-fit');

      const calls = zoomCalls();
      expect(calls.map(([name]) => name)).toEqual(['setMinZoom', 'fitBounds']);
      expect(calls[0][1]).toBe(11);
      expect(calls[1][1].points).toEqual(ROUTE);
      expect(document.getElementById('minimap-holder').classList.contains('minimap-overview')).toBe(true);
      expect(tracked('Click_MinimapFitRoute')).toEqual([
        ['Click_MinimapFitRoute', { mode: 'overview', trigger: 'fit-button' }],
      ]);
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
      window.svl.taskContainer = { getTasks: () => [] };
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
      .filter((layer) => layer.type === 'background' || layer.source === window.MinimapBasemapStyle.SOURCE_ID)
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
      const onClick = jest.fn();
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
      const onClick = jest.fn();
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

      minimap.clearStreetLines('route-street-1');
      flushFrame();
      expect(uploaded().map((feature) => feature.properties.kind)).toEqual(['remaining']);
    });

    test('a half sliced down to a single point is dropped rather than sent as a degenerate line', () => {
      minimap.setStreetLines('street-7', [line('audited', [0, 0]), line('remaining', [0, 0], [1, 1])]);
      flushFrame();

      expect(uploaded().map((feature) => feature.properties.kind)).toEqual(['remaining']);
    });

    test('clearing a street removes it, and clearing one that was never drawn uploads nothing', () => {
      minimap.setStreetLines('street-7', [line('other', [0, 0], [1, 1])]);
      flushFrame();

      minimap.clearStreetLines('street-99');
      expect(frames).toHaveLength(0);

      minimap.clearStreetLines('street-7');
      flushFrame();
      expect(uploaded()).toHaveLength(0);
    });
  });
});

describe('Minimap without a map', () => {
  let frames;

  beforeEach(() => {
    frames = [];
    setUpGlobals(frames);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const holder = () => document.getElementById('minimap-holder');
  const message = () => document.getElementById('minimap-unavailable-message');
  const unavailableEvents = () => window.svl.tracker.push.mock.calls.filter(([name]) => name === 'Minimap_Unavailable');

  test('with no WebGL2, creation still resolves, and the minimap says it can\'t draw', async () => {
    window.maplibregl.Map = class {
      constructor() {
        throw new Error('Failed to initialize WebGL');
      }
    };

    const minimap = await window.Minimap.create(PANO);

    expect(minimap.isAvailable()).toBe(false);
    expect(holder().classList.contains('minimap-unavailable')).toBe(true);
    expect(message().hidden).toBe(false);
    expect(unavailableEvents()).toEqual([['Minimap_Unavailable', { error: 'Failed to initialize WebGL' }]]);
  });

  test('callers keep working against it without special cases, and nothing is queued for a map', async () => {
    window.maplibregl.Map = class {
      constructor() {
        throw new Error('Failed to initialize WebGL');
      }
    };
    const minimap = await window.Minimap.create(PANO);

    const onClick = jest.fn();
    const marker = minimap.addMarker(PANO, document.createElement('div'), { onClick, title: 'Go' });
    expect(() => {
      marker.setLatLng({ lat: 47.61, lng: -122.34 });
      marker.setVisible(false);
      marker.remove();
      minimap.setStreetLines('street-1', [{ kind: 'other', coordinates: [[0, 0], [1, 1]] }]);
      minimap.clearStreetLines('street-1');
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
    window.maplibregl.Map = class extends FakeMap {
      addImage() {
        throw new Error('WebGL context lost');
      }
    };

    const minimap = await window.Minimap.create(PANO);
    const [map] = FakeMap.instances;

    expect(minimap.isAvailable()).toBe(false);
    expect(map.callsTo('remove')).toHaveLength(1);
    expect(document.getElementById('minimap-attribution')).toBeNull();
    expect(unavailableEvents()).toEqual([['Minimap_Unavailable', { error: 'WebGL context lost' }]]);
  });

  test('with no MapLibre loaded and no preload link to import it from, the reason names the link', async () => {
    delete window.maplibregl;

    const minimap = await window.Minimap.create(PANO);

    expect(minimap.isAvailable()).toBe(false);
    const [[, { error }]] = unavailableEvents();
    expect(error).toContain('#maplibre-module');
  });
});
