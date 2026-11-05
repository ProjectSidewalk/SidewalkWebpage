/**
 * The map inside Explore's mission-complete screen (frontend/js/explore/modal/ModalMissionCompleteMap.js) (#5840):
 * how it is built from the city's map settings, the three street tiers and label dots it draws and clears between
 * missions, how it frames the mission, and the flags, direction chevrons and walking explorer a finished route gets.
 *
 * Mapbox is a stand-in that keeps its sources, layers, images and markers; the label layers come from the real
 * addLabelsToMap. The explorer's frames are driven by hand, and jsdom's canvas and image decoding are stubbed.
 */

import * as turf from '@turf/turf';
import { loadModules, mockModule } from './loader.js';
import { routeFetch, flush } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

/** A Mapbox map stand-in that keeps what is added to it and can be told when it has loaded. */
class FakeMap {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.sources = new Map();
    this.layers = [];
    this.images = new Set();
    this.controls = [];
    this.handlers = {};
    this.isLoaded = FakeMap.loadedAtOnce;
    this.fitBounds = vi.fn();
    this.resize = vi.fn();
    this.setFilter = vi.fn();
    this.setLayoutProperty = vi.fn();
    FakeMap.instances.push(this);
  }

  /** Whether a map says it has already loaded when asked, or waits to fire 'load'. */
  static loadedAtOnce = true;

  loaded() { return this.isLoaded; }

  on(event, handler) { this.handlers[event] = handler; }

  fireLoad() {
    this.isLoaded = true;
    this.handlers.load?.();
  }

  addControl(control, position) { this.controls.push({ control, position }); }

  // Mapbox throws on a second source, layer or image under one id, so a redraw that forgets to clear up fails here too.
  addSource(id, spec) {
    if (this.sources.has(id)) throw new Error(`source ${id} already exists`);
    this.sources.set(id, { ...spec, setData: vi.fn() });
  }

  getSource(id) { return this.sources.get(id); }

  removeSource(id) { this.sources.delete(id); }

  addLayer(spec) {
    if (this.getLayer(spec.id)) throw new Error(`layer ${spec.id} already exists`);
    this.layers.push(spec);
  }

  getLayer(id) { return this.layers.find((layer) => layer.id === id); }

  removeLayer(id) { this.layers = this.layers.filter((layer) => layer.id !== id); }

  hasImage(id) { return this.images.has(id); }

  addImage(id) {
    if (this.images.has(id)) throw new Error(`image ${id} already exists`);
    this.images.add(id);
  }
}

class FakeMarker {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.remove = vi.fn();
    FakeMarker.instances.push(this);
  }

  setLngLat(lngLat) { this.lngLat = lngLat; return this; }

  addTo(map) { this.map = map; return this; }
}

class FakeLanguage {
  constructor(options) { this.options = options; }
}

const mapboxgl = { Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, accessToken: null };
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));
mockModule('@mapbox/mapbox-gl-language', () => ({ default: FakeLanguage }));

const CITY = {
  city_center: { lat: 47.6, lng: -122.33 },
  default_zoom: 12,
  southwest_boundary: { lat: 47.4, lng: -122.5 },
  northeast_boundary: { lat: 47.8, lng: -122.2 },
};

const line = (...coords) => (
  { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
);
const fc = (...features) => ({ type: 'FeatureCollection', features });
const EMPTY_TIERS = { thisMission: fc(), previous: fc(), community: fc() };
const MISSION_LINE = line([-122.33, 47.6], [-122.32, 47.6]);
const ROUTE_PATH = [[-122.33, 47.6], [-122.32, 47.6], [-122.32, 47.61]];

describe('ModalMissionCompleteMap', () => {
  let ModalMissionCompleteMap;
  let regionModel;
  let endpoints;
  let routeCoords;
  let taskContainer;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="mc-map"></div>';
    document.documentElement.style.setProperty('--mc-line-community', '#cccccc');
    document.documentElement.style.setProperty('--mc-line-previous', '#888888');
    document.documentElement.style.setProperty('--mc-line-this-mission', '#ff0000');
    FakeMap.instances = [];
    FakeMap.loadedAtOnce = true;
    FakeMarker.instances = [];
    routeFetch({ '/cityMapParams': CITY });
    regionModel = { isRoute: false };
    endpoints = { start: { lat: 47.6, lng: -122.33 }, finish: { lat: 47.61, lng: -122.32 } };
    routeCoords = ROUTE_PATH;
    taskContainer = { getRouteEndpoints: () => endpoints, getRoutePathCoordinates: () => routeCoords };
    ({ ModalMissionCompleteMap } = await loadModules('frontend/js/explore/modal/ModalMissionCompleteMap.js'));
  });

  const build = async () => {
    const component = new ModalMissionCompleteMap('mc-map', 'pk.test', regionModel, taskContainer);
    await flush();
    return { component, map: FakeMap.instances[0] };
  };

  describe('building the map', () => {
    it('centers and bounds the map on the city, in the page\'s language, with zoom buttons', async () => {
      const { map } = await build();

      expect(mapboxgl.accessToken).toBe('pk.test');
      expect(map.options).toEqual(expect.objectContaining({
        container: 'mc-map', center: [-122.33, 47.6], zoom: 12,
        maxBounds: [[-122.5, 47.4], [-122.2, 47.8]],
      }));
      expect(map.controls[0].control).toBeInstanceOf(FakeLanguage);
      expect(map.controls[0].control.options.defaultLanguage).toBe('common:mapbox-language-code');
      expect(map.controls[1].position).toBe('bottom-right');
    });

    it('waits for a map still loading before drawing on it', async () => {
      FakeMap.loadedAtOnce = false;
      const { component, map } = await build();

      const updated = component.update(EMPTY_TIERS, fc());
      await flush();
      expect(map.layers).toEqual([]);

      map.fireLoad();
      await updated;
      expect(map.layers.length).toBeGreaterThan(0);
    });

    it('resizes the map once it has one', async () => {
      const { component, map } = await build();
      component.resize();
      await flush();
      expect(map.resize).toHaveBeenCalled();
    });
  });

  describe('drawing a mission', () => {
    it('draws the community, earlier and current streets bottom to top in the legend colors, then labels', async () => {
      const { component, map } = await build();
      const tiers = { thisMission: fc(MISSION_LINE), previous: fc(line([0, 0], [1, 1])), community: fc() };

      await component.update(tiers, fc());

      const streetLayers = map.layers.filter((layer) => layer.type === 'line');
      expect(streetLayers.map((layer) => layer.id))
        .toEqual(['mc-street-community', 'mc-street-previous', 'mc-street-this-mission']);
      expect(streetLayers.map((layer) => layer.paint['line-color'])).toEqual(['#cccccc', '#888888', '#ff0000']);
      expect(map.getSource('mc-street-this-mission').data).toBe(tiers.thisMission);
      expect(map.getSource('mc-street-previous').data).toBe(tiers.previous);
      const dotLayers = map.layers.filter((layer) => layer.type === 'circle').map((layer) => layer.id);
      expect(dotLayers).toContain('labels-CurbRamp');
    });

    it('frames the mission\'s streets, leaving room for the cards over the map', async () => {
      const { component, map } = await build();

      await component.update({ ...EMPTY_TIERS, thisMission: fc(MISSION_LINE) }, fc());

      expect(map.fitBounds).toHaveBeenCalledWith([-122.33, 47.6, -122.32, 47.6],
        { padding: { top: 60, bottom: 30, left: 210, right: 210 }, animate: false });
    });

    it('frames all the worked streets when the mission has none to show', async () => {
      const { component, map } = await build();

      await component.update({
        thisMission: fc(),
        previous: fc(line([-122.33, 47.6], [-122.32, 47.6])),
        community: fc(line([-122.31, 47.62], [-122.30, 47.62])),
      }, fc());

      expect(map.fitBounds.mock.calls[0][0]).toEqual([-122.33, 47.6, -122.30, 47.62]);
    });

    it('leaves the city view alone with nothing to frame', async () => {
      const { component, map } = await build();
      await component.update(EMPTY_TIERS, fc());
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('clears the last mission\'s streets and labels before drawing the next', async () => {
      const { component, map } = await build();
      await component.update({ ...EMPTY_TIERS, thisMission: fc(MISSION_LINE) }, fc());
      const before = map.layers.length;

      await component.update({ ...EMPTY_TIERS, previous: fc(MISSION_LINE) }, fc());

      expect(map.layers.length).toBe(before);
      expect(map.getSource('mc-street-this-mission').data.features).toEqual([]);
      expect(map.getSource('mc-street-previous').data.features).toEqual([MISSION_LINE]);
    });

    it('plants no flags and draws no direction off a route', async () => {
      const { component, map } = await build();
      await component.update(EMPTY_TIERS, fc());
      expect(FakeMarker.instances).toEqual([]);
      expect(map.getLayer('mc-route-arrows')).toBeUndefined();
    });
  });

  describe('on a route', () => {
    let ctx;

    beforeEach(() => {
      regionModel.isRoute = true;
      ctx = {
        scale: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), drawImage: vi.fn(),
        getImageData: vi.fn((x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })),
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
      HTMLImageElement.prototype.decode = () => Promise.resolve();
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(30);
      vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(60);
      window.requestAnimationFrame = vi.fn(() => 1);
      window.cancelAnimationFrame = vi.fn();
    });

    afterEach(() => { delete HTMLImageElement.prototype.decode; });

    it('plants RouteBuilder\'s start and finish flags at the route\'s ends, by their poles', async () => {
      const { component, map } = await build();

      await component.update(EMPTY_TIERS, fc());

      const [start, finish] = FakeMarker.instances;
      expect(start.lngLat).toEqual([-122.33, 47.6]);
      expect(start.options.anchor).toBe('bottom');
      expect(start.options.element.src).toContain('/assets/images/icons/routebuilder/flag-start.svg');
      expect(start.options.element.alt).toBe('');
      expect(start.options.element.style.width).toBe('27px');
      expect(finish.lngLat).toEqual([-122.32, 47.61]);
      expect(finish.options.element.src).toContain('/assets/images/icons/routebuilder/flag-end.svg');
      expect(finish.map).toBe(map);
    });

    it('plants nothing when the route has no known ends', async () => {
      endpoints = null;
      const { component } = await build();
      await component.update(EMPTY_TIERS, fc());
      expect(FakeMarker.instances).toEqual([]);
    });

    it('draws direction chevrons along the walk and registers the icons once', async () => {
      const { component, map } = await build();

      await component.update(EMPTY_TIERS, fc());

      expect(map.images).toEqual(new Set(['mc-route-explorer-icon', 'mc-route-arrow']));
      expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 40, 80);
      expect(map.getLayer('mc-route-arrows').layout).toEqual(expect.objectContaining({
        'symbol-placement': 'line', 'icon-image': 'mc-route-arrow',
      }));
      expect(map.getSource('mc-route-path').data.geometry.coordinates).toBe(ROUTE_PATH);

      const imagesAdded = ctx.getImageData.mock.calls.length;
      await component.update(EMPTY_TIERS, fc());
      expect(ctx.getImageData.mock.calls.length).toBe(imagesAdded);
      expect(map.getLayer('mc-route-arrows')).toBeDefined();
    });

    it('tries the icons again on the next draw when their first load fails', async () => {
      HTMLImageElement.prototype.decode = vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(undefined);
      const { component, map } = await build();

      await expect(component.update(EMPTY_TIERS, fc())).rejects.toThrow('offline');
      expect(map.images.size).toBe(0);

      await component.update(EMPTY_TIERS, fc());
      expect(map.images).toEqual(new Set(['mc-route-explorer-icon', 'mc-route-arrow']));
      expect(map.getLayer('mc-route-arrows')).toBeDefined();
    });

    it('draws no direction for a route with fewer than two points', async () => {
      routeCoords = [[-122.33, 47.6]];
      const { component, map } = await build();
      await component.update(EMPTY_TIERS, fc());
      expect(map.getLayer('mc-route-arrows')).toBeUndefined();
      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('walks the explorer from start to finish at an even pace, lingers, then takes it away', async () => {
      const { component, map } = await build();
      await component.update(EMPTY_TIERS, fc());
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const explorer = map.getSource('mc-route-explorer');
      const frame = (now) => window.requestAnimationFrame.mock.calls.at(-1)[0](now);
      const position = () => explorer.setData.mock.calls.at(-1)[0].features[0].geometry.coordinates;

      frame(1000);
      expect(position()).toEqual(ROUTE_PATH[0]);
      // Halfway through the walk is halfway along the route's length, which on this route is past its corner; by
      // vertex count it would be the corner itself.
      frame(1000 + 1250);
      const route = turf.lineString(ROUTE_PATH);
      const [midLng, midLat] = turf.along(route, turf.length(route) / 2).geometry.coordinates;
      expect(position()[0]).toBeCloseTo(midLng, 4);
      expect(position()[1]).toBeCloseTo(midLat, 4);
      frame(1000 + 2500);
      expect(position()).toEqual(ROUTE_PATH[2]);
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(3);

      vi.advanceTimersByTime(700);
      expect(explorer.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
    });

    it('stops a walk in progress when the next mission is drawn', async () => {
      const { component, map } = await build();
      await component.update(EMPTY_TIERS, fc());
      window.requestAnimationFrame.mock.calls[0][0](0);

      await component.update(EMPTY_TIERS, fc());

      expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
      expect(map.getSource('mc-route-explorer').setData).not.toHaveBeenCalled();
    });

    it('does not clear an explorer whose map has already moved on', async () => {
      const { component, map } = await build();
      await component.update(EMPTY_TIERS, fc());
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const explorer = map.getSource('mc-route-explorer');
      window.requestAnimationFrame.mock.calls[0][0](0);
      window.requestAnimationFrame.mock.calls[1][0](2500);
      map.removeSource('mc-route-explorer');

      vi.advanceTimersByTime(700);

      expect(explorer.setData).toHaveBeenCalledTimes(2);
    });

    it('drops a finished walk\'s linger when the next mission is drawn first', async () => {
      const { component, map } = await build();
      await component.update(EMPTY_TIERS, fc());
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const explorer = map.getSource('mc-route-explorer');
      window.requestAnimationFrame.mock.calls[0][0](0);
      window.requestAnimationFrame.mock.calls[1][0](2500);

      await component.update(EMPTY_TIERS, fc());
      vi.advanceTimersByTime(700);

      expect(explorer.setData).toHaveBeenCalledTimes(2);
    });

    it('starts a route that repeats its first point without stalling on the zero-length step', async () => {
      routeCoords = [ROUTE_PATH[0], ROUTE_PATH[0], ROUTE_PATH[1]];
      const { component, map } = await build();
      await component.update(EMPTY_TIERS, fc());

      window.requestAnimationFrame.mock.calls[0][0](0);

      const [feature] = map.getSource('mc-route-explorer').setData.mock.calls[0][0].features;
      expect(feature.geometry.coordinates).toEqual(ROUTE_PATH[0]);
    });

    it('does not walk a route whose points are all the same place', async () => {
      routeCoords = [[-122.33, 47.6], [-122.33, 47.6]];
      const { component } = await build();
      await component.update(EMPTY_TIERS, fc());
      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    });
  });
});
