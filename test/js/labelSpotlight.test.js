/**
 * The spotlight tying the label popup to its dot (frontend/js/ps-map/labelSpotlight.js, #4572) (#5840), used by
 * LabelMap and AccessScore: where the camera parks the dot beside or below the dialog, the beacon over it and the
 * flash after the popup closes, the chat-bubble tail from the dialog to the dot, and the filter bypass that keeps
 * an asked-for label visible. Mapbox needs WebGL, which jsdom lacks, so the map and marker are stand-ins and the
 * dialog's and dot's screen positions are set by each test.
 */

import { loadModules, mockModule } from './loader.js';

/** Every beacon marker made, newest last. */
let markers = [];

/** A Mapbox marker stand-in that remembers its element, position, and whether it was taken off. */
class FakeMarker {
  /** @param {{element: HTMLElement}} options - Marker options. */
  constructor({ element }) {
    this.element = element;
    this.removed = false;
    markers.push(this);
  }

  /** @param {Array<number>} lngLat - Position. @returns {FakeMarker} This marker. */
  setLngLat(lngLat) {
    this.lngLat = lngLat;
    return this;
  }

  /** @param {object} map - The map. @returns {FakeMarker} This marker. */
  addTo(map) {
    this.map = map;
    return this;
  }

  /** @returns {HTMLElement} The marker's element. */
  getElement() { return this.element; }

  remove() { this.removed = true; }
}

mockModule('frontend/js/common/mapboxgl.js', () => ({ default: { Marker: FakeMarker } }));

/** The callback the module handed ResizeObserver, so a test can play a dialog resize. */
let resizeCallback = null;

/**
 * A Mapbox map stand-in filling the window, whose projected dot position each test sets.
 * @param {object} [options]
 * @param {object} [options.padding] - What getPadding reports.
 * @param {number} [options.zoom] - What getZoom reports.
 * @param {boolean} [options.inBounds] - Whether the label is inside the visible bounds.
 * @returns {object} The map.
 */
function fakeMap({ padding = { left: 0, right: 0, top: 0, bottom: 0 }, zoom = 14, inBounds = true } = {}) {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({
    left: 0, top: 0, width: window.innerWidth, height: window.innerHeight,
  });
  return {
    dot: { x: 0, y: 0 },
    filters: {},
    project() { return this.dot; },
    getContainer: () => container,
    getPadding: () => padding,
    getZoom: () => zoom,
    getBounds: () => ({ contains: () => inBounds }),
    getLayer: (id) => id === 'labels-CurbRamp',
    setFilter(id, expr) { this.filters[id] = expr; },
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
  };
}

/**
 * Sets the window size jsdom reports.
 * @param {number} width - innerWidth.
 * @param {number} height - innerHeight.
 */
function setWindow(width, height) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

/**
 * Where `coords` sits relative to a camera's center, in screen pixels, by the same web-mercator math Mapbox draws
 * with, so a test can say where the dot ends up on screen.
 * @param {Array<number>} coords - [lng, lat].
 * @param {{center: Array<number>, zoom: number}} camera - The camera the module asked for.
 * @returns {{x: number, y: number}} The dot's offset from the map's center.
 */
function offsetFromCenter(coords, camera) {
  const worldSize = 512 * (2 ** camera.zoom);
  const px = ([lng, lat]) => {
    const sin = Math.sin(lat * Math.PI / 180);
    const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
    return { x: ((lng + 180) / 360) * worldSize, y: y * worldSize };
  };
  const a = px(coords);
  const b = px(camera.center);
  return { x: a.x - b.x, y: a.y - b.y };
}

/** @returns {Array<Array<number>>} The tail triangle's three corners, as [x, y] pairs. */
const tailPoints = () => document.querySelector('.labelmap-tail polygon').getAttribute('points')
  .split(' ').map((p) => p.split(',').map(Number));

/** @returns {boolean} Whether the tail is showing. */
const tailShown = () => document.querySelector('.labelmap-tail').style.display === 'block';

/**
 * The CSS color jsdom stores for a hex color, which it rewrites as rgb().
 * @param {string} hex - The color.
 * @returns {string} What `style.background` reads back as.
 */
function cssColor(hex) {
  const el = document.createElement('div');
  el.style.background = hex;
  return el.style.background;
}

const COORDS = [-122.33, 47.61];
const CURB_RAMP = window.labelTypes.find((lt) => lt.name === 'CurbRamp');

describe('createLabelSpotlight', () => {
  let createLabelSpotlight;
  let CreateMapLayerTracker;
  let dialog;
  let map;
  let mapData;
  let coords;
  let types;

  /**
   * Builds the spotlight over the current map, label tables and dialog.
   * @param {object} [extra] - Further host members (getFreeBox, or a getMapData override).
   * @returns {object} The spotlight.
   */
  const build = (extra = {}) => createLabelSpotlight({
    dialog,
    getMap: () => map,
    getMapData: () => mapData,
    getCoords: (id) => coords[id] ?? null,
    getLabelType: (id) => types[id] ?? null,
    ...extra,
  });

  /**
   * Opens the dialog at a given screen rectangle.
   * @param {number} left - Left edge.
   * @param {number} top - Top edge.
   * @param {number} right - Right edge.
   * @param {number} bottom - Bottom edge.
   */
  const openDialogAt = (left, top, right, bottom) => {
    dialog.setAttribute('open', '');
    dialog.getBoundingClientRect = () => ({ left, top, right, bottom });
  };

  beforeEach(async () => {
    document.body.innerHTML = '<dialog id="label-modal"></dialog>';
    dialog = document.getElementById('label-modal');
    markers = [];
    resizeCallback = null;
    window.ResizeObserver = class {
      /** @param {Function} cb - Called on a resize. */
      constructor(cb) { resizeCallback = cb; }

      observe() {}
    };
    setWindow(1600, 900);
    ({ createLabelSpotlight, CreateMapLayerTracker } = await loadModules(
      'frontend/js/ps-map/psMapUtilities.js', 'frontend/js/ps-map/labelSpotlight.js'));
    map = fakeMap();
    mapData = CreateMapLayerTracker();
    mapData.layerNames.CurbRamp = 'labels-CurbRamp';
    coords = { 7: COORDS };
    types = { 7: 'CurbRamp' };
  });

  describe('camera placement', () => {
    test('on a wide screen the dot is parked mid-way across the gutter right of the dialog', () => {
      openDialogAt(475, 100, 1125, 800);
      build().spotlight(7, true);

      const camera = map.jumpTo.mock.calls[0][0];
      const off = offsetFromCenter(COORDS, camera);
      // Gutter runs 1125–1600, so its middle is 1362.5; the map's center is at 800.
      expect(off.x).toBeCloseTo(562.5, 3);
      expect(off.y).toBeCloseTo(0, 3);
      expect(camera.zoom).toBe(16); // Zoomed in to street level from the map's 14.
      expect(map.easeTo).not.toHaveBeenCalled();
    });

    test('without a jump the camera eases there instead', () => {
      openDialogAt(475, 100, 1125, 800);
      build().spotlight(7);

      expect(map.jumpTo).not.toHaveBeenCalled();
      expect(offsetFromCenter(COORDS, map.easeTo.mock.calls[0][0]).x).toBeCloseTo(562.5, 3);
    });

    test('a map already zoomed past street level keeps its zoom', () => {
      map = fakeMap({ zoom: 18 });
      openDialogAt(475, 100, 1125, 800);
      build().spotlight(7, true);

      expect(map.jumpTo.mock.calls[0][0].zoom).toBe(18);
    });

    test('a drawer covering the right side sends the dot to the left gutter instead', () => {
      openDialogAt(475, 100, 1125, 800);
      build({ getFreeBox: () => ({ left: 0, top: 0, right: 1300, bottom: 900 }) }).spotlight(7, true);

      // Right gutter shrinks to 175px, so the 475px left one wins; its middle is 237.5.
      expect(offsetFromCenter(COORDS, map.jumpTo.mock.calls[0][0]).x).toBeCloseTo(237.5 - 800, 3);
    });

    test('map padding moves the center the dot is measured from', () => {
      map = fakeMap({ padding: { left: 400, right: 0, top: 0, bottom: 0 } });
      openDialogAt(475, 100, 1125, 800);
      build().spotlight(7, true);

      // Mapbox centers within the padded area, 400–1600, so its center is at 1000.
      expect(offsetFromCenter(COORDS, map.jumpTo.mock.calls[0][0]).x).toBeCloseTo(1362.5 - 1000, 3);
    });

    test('on a phone the dot is parked in the space below the dialog', () => {
      setWindow(400, 800);
      openDialogAt(10, 50, 390, 500);
      build().spotlight(7, true);

      const off = offsetFromCenter(COORDS, map.jumpTo.mock.calls[0][0]);
      // Below the dialog runs 500–800, so its middle is 650; the center is at 400.
      expect(off.x).toBeCloseTo(0, 3);
      expect(off.y).toBeCloseTo(250, 3);
    });

    test('a dialog leaving no room on any side just centers the dot', () => {
      openDialogAt(10, 10, 1590, 890);
      build().spotlight(7, true);

      const off = offsetFromCenter(COORDS, map.jumpTo.mock.calls[0][0]);
      expect(off.x).toBeCloseTo(0, 3);
      expect(off.y).toBeCloseTo(0, 3);
    });

    test('before the dialog opens, the gutter is planned around a dialog of the usual width', () => {
      build().spotlight(7, true);

      // A 650px dialog centered in 1600px ends at 1125, the same gutter as when it is open there.
      expect(offsetFromCenter(COORDS, map.jumpTo.mock.calls[0][0]).x).toBeCloseTo(562.5, 3);
    });

    test('nothing moves before the map exists or for a label with no known position', () => {
      const realMap = map;
      map = null;
      build().spotlight(7, true);
      map = realMap;
      build().spotlight(99, true);

      expect(realMap.jumpTo).not.toHaveBeenCalled();
      expect(markers).toEqual([]);
    });
  });

  describe('beacon', () => {
    test('a spotlighted label gets a beacon on its dot, filled with its type\'s color', () => {
      const spotlight = build();
      spotlight.spotlight(7, true);

      const [beacon] = markers;
      expect(beacon.lngLat).toEqual(COORDS);
      expect(beacon.map).toBe(map);
      expect(beacon.element.className).toBe('labelmap-beacon labelmap-beacon--spotlight');
      expect(beacon.element.querySelector('.labelmap-beacon__dot').style.background).toBe(cssColor(CURB_RAMP.color));
      expect(spotlight.spotlightedLabelId()).toBe(7);
    });

    test('a label whose type isn\'t known yet gets a beacon with no colored center', () => {
      types = {};
      build().spotlight(7, true);

      expect(markers[0].element.querySelector('.labelmap-beacon__dot')).toBeNull();
    });

    test('moving to another label replaces the beacon rather than adding a second one', () => {
      coords[8] = [-122.34, 47.62];
      const spotlight = build();
      spotlight.spotlight(7, true);
      spotlight.spotlight(8, true);

      expect(markers[0].removed).toBe(true);
      expect(markers[1].lngLat).toEqual(coords[8]);
    });

    test('after a type edit the beacon is rebuilt in the new type\'s color', () => {
      const spotlight = build();
      spotlight.spotlight(7, true);
      types[7] = 'Obstacle';
      spotlight.refreshBeacon(7);

      const obstacle = window.labelTypes.find((lt) => lt.name === 'Obstacle');
      expect(markers[0].removed).toBe(true);
      expect(markers[1].element.querySelector('.labelmap-beacon__dot').style.background).toBe(cssColor(obstacle.color));
    });

    test('an edit to a label that isn\'t spotlighted leaves the beacon alone', () => {
      const spotlight = build();
      spotlight.spotlight(7, true);
      spotlight.refreshBeacon(8);

      expect(markers).toHaveLength(1);
    });

    test('an edit after a refetch dropped the label\'s position keeps the beacon where it was', () => {
      const spotlight = build();
      spotlight.spotlight(7, true);
      delete coords[7];
      spotlight.refreshBeacon(7);

      expect(markers).toHaveLength(1);
      expect(markers[0].removed).toBe(false);
    });
  });

  describe('closing the popup', () => {
    beforeEach(() => vi.useFakeTimers());

    test('flashes the dot once, then takes the beacon off and lets the filters hide it again', () => {
      const spotlight = build();
      spotlight.spotlight(7, true);
      spotlight.pulse(7);

      const flash = markers[1];
      expect(flash.element.className).toBe('labelmap-beacon labelmap-beacon--flash');
      expect(spotlight.spotlightedLabelId()).toBeNull();
      expect(mapData.spotlightLabelId).toBe(7);

      vi.advanceTimersByTime(2600);

      expect(flash.removed).toBe(true);
      expect(mapData.spotlightLabelId).toBeNull();
    });

    test('a dot the map has scrolled away from is brought back into view first', () => {
      map = fakeMap({ inBounds: false });
      build().pulse(7);

      expect(map.easeTo).toHaveBeenCalledWith({ center: COORDS, zoom: 16 });
    });

    test('a dot still in view is flashed where it is', () => {
      build().pulse(7);

      expect(map.easeTo).not.toHaveBeenCalled();
      expect(markers).toHaveLength(1);
    });

    test('reopening the popup during the flash keeps the new beacon past the flash\'s end', () => {
      const spotlight = build();
      spotlight.pulse(7);
      spotlight.spotlight(7, true);

      vi.advanceTimersByTime(5000);

      expect(markers[1].removed).toBe(false);
      expect(mapData.spotlightLabelId).toBe(7);
    });

    test('nothing flashes before the map exists or for a label with no known position', () => {
      const realMap = map;
      map = null;
      build().pulse(7);
      map = realMap;
      build().pulse(99);

      expect(markers).toEqual([]);
    });
  });

  describe('filter bypass', () => {
    test('the spotlighted label is let through every label layer\'s filter', () => {
      build().spotlight(7, true);

      expect(map.filters['labels-CurbRamp']).toEqual(['any', expect.anything(), ['==', ['get', 'label_id'], 7]]);
    });

    test('spotlighting the same label again doesn\'t rebuild the filters', () => {
      const spotlight = build();
      spotlight.spotlight(7, true);
      map.filters = {};
      spotlight.refreshBeacon(7);

      expect(map.filters).toEqual({});
    });

    test('a page without label layers still gets the beacon', () => {
      build({ getMapData: () => null }).spotlight(7, true);

      expect(markers).toHaveLength(1);
      expect(map.filters).toEqual({});
    });
  });

  describe('tail', () => {
    let spotlight;

    beforeEach(() => {
      openDialogAt(475, 100, 1125, 800);
      spotlight = build();
    });

    test('points from the dialog\'s right edge to a dot in the right gutter, stopping short of the dot', () => {
      map.dot = { x: 1362, y: 450 };
      spotlight.spotlight(7, true);

      expect(tailShown()).toBe(true);
      const [a, b, tip] = tailPoints();
      expect(a).toEqual([1124, 450 - 26]);
      expect(b).toEqual([1124, 450 + 26]);
      expect(tip).toEqual([1362 - 18, 450]);
    });

    test('a dot to the left gets a tail from the left edge, its base kept clear of the corners', () => {
      map.dot = { x: 200, y: 120 };
      spotlight.spotlight(7, true);

      const [a, b] = tailPoints();
      expect(a[0]).toBe(476);
      expect((a[1] + b[1]) / 2).toBe(100 + 48);
    });

    test('a dot below the dialog gets a tail from the bottom edge', () => {
      map.dot = { x: 800, y: 880 };
      spotlight.spotlight(7, true);

      const [a, b, tip] = tailPoints();
      expect([a[1], b[1]]).toEqual([799, 799]);
      expect([a[0], b[0]]).toEqual([800 - 26, 800 + 26]);
      expect(tip[1]).toBeCloseTo(880 - 18, 6);
    });

    test('a dot above the dialog gets a tail from the top edge', () => {
      map.dot = { x: 1100, y: 40 };
      spotlight.spotlight(7, true);

      const [a] = tailPoints();
      expect(a[1]).toBe(101);
      expect(a[0]).toBe(1125 - 48 - 26); // The base stops 48px short of the corner, then spreads 26px either way.
    });

    test('a dot off the screen still gets a tail, cut off at the screen\'s edge', () => {
      map.dot = { x: 3000, y: 450 };
      spotlight.spotlight(7, true);
      expect(tailPoints()[2]).toEqual([1600 - 6, 450]);

      map.dot = { x: -900, y: -900 };
      spotlight.updateTail();
      const tip = tailPoints()[2];
      expect(Math.min(...tip)).toBeCloseTo(6, 6);
    });

    test('a dot just beside the dialog gets a thin tail rather than none', () => {
      map.dot = { x: 1147, y: 450 };
      spotlight.spotlight(7, true);

      const [a, b] = tailPoints();
      expect(b[1] - a[1]).toBe(8); // The narrowest base, 4px either side.
    });

    test('no tail for a dot behind the dialog, or one too close to its edge to draw', () => {
      map.dot = { x: 800, y: 450 };
      spotlight.spotlight(7, true);
      expect(tailShown()).toBe(false);

      map.dot = { x: 1362, y: 450 };
      spotlight.updateTail();
      expect(tailShown()).toBe(true);

      map.dot = { x: 1140, y: 450 };
      spotlight.updateTail();
      expect(tailShown()).toBe(false);
    });

    test('the tail goes when the popup closes, and follows the dialog when it or the window resizes', () => {
      map.dot = { x: 1362, y: 450 };
      spotlight.spotlight(7, true);

      dialog.getBoundingClientRect = () => ({ left: 475, top: 100, right: 1025, bottom: 800 });
      resizeCallback();
      expect(tailPoints()[0][0]).toBe(1024);

      dialog.getBoundingClientRect = () => ({ left: 475, top: 100, right: 925, bottom: 800 });
      window.dispatchEvent(new Event('resize'));
      expect(tailPoints()[0][0]).toBe(924);

      spotlight.pulse(7);
      expect(tailShown()).toBe(false);
    });

    test('no tail while the dialog is shut or before the map exists', () => {
      map.dot = { x: 1362, y: 450 };
      spotlight.spotlight(7, true);
      dialog.removeAttribute('open');
      spotlight.updateTail();
      expect(tailShown()).toBe(false);

      dialog.setAttribute('open', '');
      map = null;
      spotlight.updateTail();
      expect(tailShown()).toBe(false);
    });
  });
});
