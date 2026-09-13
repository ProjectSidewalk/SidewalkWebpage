/**
 * Pins the contract of test/e2e/fixtures/google-maps-stub.js, the fake `google.maps` the browser suite loads in
 * place of Google's API (#5129).
 *
 * The browser suite only shows that the app runs against the stub; it can't show that the stub behaves like the
 * API in the ways the app depends on — the loader hand-off, event ordering, the pano contract that decides which
 * imagery path Validate takes, and the map's bounds/zoom math that Explore's overlays do pixel arithmetic against.
 * A stub that drifted from the API in one of those would let the suite pass on behaviour production never sees,
 * which is exactly the failure a fake invites. So each of those is a test here.
 *
 * The stub is a browser IIFE that reads its callback name from `document.currentScript.src`; installing it means
 * pointing that at a loader-shaped URL and evaluating the source in the jsdom window, the way a `<script>` would.
 */

const fs = require('fs');
const path = require('path');

const STUB_SRC = fs.readFileSync(path.resolve(__dirname, '..', 'e2e', 'fixtures', 'google-maps-stub.js'), 'utf8');
const LOADER_URL = 'https://maps.googleapis.com/maps/api/js?key=DUMMY&v=weekly&callback=google.maps.__ib__';

/**
 * Evaluates the stub in the jsdom window as the app's inline loader would have loaded it.
 * @param {{options?: object, url?: string, callback?: Function}} [p] `options` becomes `window.googleMapsStubOptions`
 *   (the init-script knob), `url` the script's `src`, `callback` the loader's resolver parked at `google.maps.__ib__`.
 * @returns {{maps: object, callback: Function}} The installed namespace and the resolver.
 */
function install({ options, url = LOADER_URL, callback = jest.fn() } = {}) {
  if (options) window.googleMapsStubOptions = options;
  // The loader's state when the script lands: the namespace exists and holds only the parked resolver.
  window.google = { maps: { __ib__: callback } };
  const script = document.createElement('script');
  script.src = url;
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
  window.eval(STUB_SRC);
  return { maps: window.google.maps, callback };
}

/** Settles every `setTimeout(0)` the stub scheduled, plus the promise reactions behind them. */
async function flush() {
  jest.runOnlyPendingTimers();
  await Promise.resolve();
}

/** Whether `bounds` covers both corners of `inner` — the stub's LatLngBounds deliberately has no contains(). */
function covers(bounds, inner) {
  const sw = bounds.getSouthWest(); const ne = bounds.getNorthEast();
  const isw = inner.getSouthWest(); const ine = inner.getNorthEast();
  return isw.lat() >= sw.lat() && isw.lng() >= sw.lng() && ine.lat() <= ne.lat() && ine.lng() <= ne.lng();
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  delete window.google;
  delete window.googleMapsStubOptions;
  delete document.currentScript;
});

describe('loader hand-off', () => {
  test('installs importLibrary and the stub marker before releasing the loader', () => {
    const seen = {};
    const callback = jest.fn(() => {
      seen.importLibrary = typeof window.google.maps.importLibrary;
      seen.version = window.google.maps.version;
    });
    install({ callback });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({ importLibrary: 'function', version: 'stub' });
  });

  test('tolerates a script URL with no callback', () => {
    expect(() => install({ url: 'https://maps.googleapis.com/maps/api/js', callback: undefined })).not.toThrow();
    expect(window.google.maps.version).toBe('stub');
  });

  test('importLibrary resolves the four libraries the app imports and rejects any other', async () => {
    const { maps } = install();
    await expect(maps.importLibrary('core')).resolves.toMatchObject({ LatLng: expect.any(Function) });
    await expect(maps.importLibrary('maps')).resolves.toMatchObject({
      Map: expect.any(Function), MapTypeId: expect.any(Object), RenderingType: expect.any(Object),
    });
    await expect(maps.importLibrary('streetView')).resolves.toMatchObject({
      StreetViewPanorama: expect.any(Function), StreetViewService: expect.any(Function),
    });
    await expect(maps.importLibrary('marker')).resolves.toMatchObject({ AdvancedMarkerElement: expect.any(Function) });
    await expect(maps.importLibrary('places')).rejects.toThrow('no library "places"');
  });

  test('reads its options from the init-script global and exposes what it read', () => {
    expect(install().maps.__stub.options).toEqual({ serveAnyPano: false });
    delete window.google;
    expect(install({ options: { serveAnyPano: true } }).maps.__stub.options).toEqual({ serveAnyPano: true });
  });
});

describe('events', () => {
  test('addListener / trigger / removeListener on any object', () => {
    const { maps } = install();
    const target = {};
    const fn = jest.fn();
    const handle = maps.event.addListener(target, 'ping', fn);
    maps.event.trigger(target, 'ping', 1, 2);
    expect(fn).toHaveBeenCalledWith(1, 2);
    maps.event.removeListener(handle);
    maps.event.trigger(target, 'ping');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(() => maps.event.removeListener(undefined)).not.toThrow();
  });

  test('addListenerOnce fires once, even when other listeners share the event', () => {
    const { maps } = install();
    const target = {};
    const once = jest.fn();
    const always = jest.fn();
    maps.event.addListenerOnce(target, 'idle', once);
    maps.event.addListener(target, 'idle', always);
    maps.event.trigger(target, 'idle');
    maps.event.trigger(target, 'idle');
    expect(once).toHaveBeenCalledTimes(1);
    expect(always).toHaveBeenCalledTimes(2);
  });

  test('MVCObject.set stores the value and fires <key>_changed on the next macrotask', async () => {
    const { maps } = install();
    const obj = new maps.MVCObject();
    const fn = jest.fn();
    obj.addListener('linksControl_changed', fn);
    obj.set('linksControl', false);
    expect(obj.get('linksControl')).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('geometry', () => {
  test('LatLng takes numbers or a literal and answers through methods', () => {
    const { maps } = install();
    const a = new maps.LatLng(47.6, -122.3);
    const b = new maps.LatLng({ lat: '47.6', lng: '-122.3' });
    expect([a.lat(), a.lng()]).toEqual([47.6, -122.3]);
    expect(b.toJSON()).toEqual({ lat: 47.6, lng: -122.3 });
  });

  test('LatLngBounds grows by extend() and reports its corners and centre', () => {
    const { maps } = install();
    const bounds = new maps.LatLngBounds();
    expect(bounds.isEmpty()).toBe(true);
    expect(bounds.getCenter()).toBeNull();
    bounds.extend(new maps.LatLng(1, 10)).extend({ lat: -1, lng: 12 });
    expect(bounds.getSouthWest().toJSON()).toEqual({ lat: -1, lng: 10 });
    expect(bounds.getNorthEast().toJSON()).toEqual({ lat: 1, lng: 12 });
    expect(bounds.getCenter().toJSON()).toEqual({ lat: 0, lng: 11 });
  });

  test('the projection round-trips and puts null island at the centre of the 256px world', () => {
    const { maps } = install();
    const map = new maps.Map(document.createElement('div'));
    const projection = map.getProjection();
    expect(projection.fromLatLngToPoint(new maps.LatLng(0, 0))).toMatchObject({ x: 128, y: 128 });
    const back = projection.fromPointToLatLng(projection.fromLatLngToPoint(new maps.LatLng(47.6, -122.3)));
    expect(back.lat()).toBeCloseTo(47.6, 9);
    expect(back.lng()).toBeCloseTo(-122.3, 9);
  });
});

describe('Map', () => {
  /** A container the stub can measure — jsdom lays nothing out, so the size is stubbed on the element. */
  function container(width = 300, height = 200) {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: width });
    Object.defineProperty(el, 'clientHeight', { value: height });
    return el;
  }

  test('mounts a labelled placeholder and settles into bounds_changed then idle', async () => {
    const { maps } = install();
    const el = container();
    const order = [];
    const map = new maps.Map(el, { center: { lat: 47.6, lng: -122.3 }, zoom: 16 });
    maps.event.addListener(map, 'bounds_changed', () => order.push('bounds_changed'));
    maps.event.addListener(map, 'idle', () => order.push('idle'));
    expect(el.dataset.googleMapsStub).toBe('map');
    await flush();
    expect(order).toEqual(['bounds_changed', 'idle']);
  });

  test('a synchronous burst of changes settles once, not once per setter', async () => {
    const { maps } = install();
    const map = new maps.Map(container(), { center: { lat: 47.6, lng: -122.3 }, zoom: 16 });
    await flush();
    const idle = jest.fn();
    maps.event.addListener(map, 'idle', idle);
    map.setZoom(15);
    map.setCenter({ lat: 47.61, lng: -122.31 });
    map.setOptions({ minZoom: 14 });
    await flush();
    expect(idle).toHaveBeenCalledTimes(1);
    expect(map.getZoom()).toBe(15);
    expect(map.getCenter().toJSON()).toEqual({ lat: 47.61, lng: -122.31 });
  });

  test('bounds follow the container size and the zoom, and halve when the zoom goes up one', () => {
    const { maps } = install();
    const map = new maps.Map(container(300, 200), { center: { lat: 47.6, lng: -122.3 }, zoom: 16 });
    const at16 = map.getBounds();
    const width16 = at16.getNorthEast().lng() - at16.getSouthWest().lng();
    expect(at16.getCenter().lng()).toBeCloseTo(-122.3, 9);
    map.setZoom(17);
    const at17 = map.getBounds();
    expect(at17.getNorthEast().lng() - at17.getSouthWest().lng()).toBeCloseTo(width16 / 2, 9);
    // 300px at zoom 16 on a 256px world: 300 / 2^16 of 360 degrees.
    expect(width16).toBeCloseTo((300 / 2 ** 16 / 256) * 360, 9);
  });

  test('fitBounds recentres and picks the largest zoom at which the bounds still fit', () => {
    const { maps } = install();
    const map = new maps.Map(container(300, 200), { center: { lat: 0, lng: 0 }, zoom: 16 });
    const route = new maps.LatLngBounds(new maps.LatLng(47.60, -122.34), new maps.LatLng(47.61, -122.33));
    map.fitBounds(route);
    const zoom = map.getZoom();
    expect(Number.isInteger(zoom)).toBe(true);
    expect(map.getCenter().toJSON()).toEqual(route.getCenter().toJSON());
    expect(covers(map.getBounds(), route)).toBe(true);
    map.setZoom(zoom + 1);
    expect(covers(map.getBounds(), route)).toBe(false);
  });

  test('fitBounds honours padding and the map\'s own zoom range', () => {
    const { maps } = install();
    const route = new maps.LatLngBounds(new maps.LatLng(47.60, -122.34), new maps.LatLng(47.61, -122.33));
    const plain = new maps.Map(container(300, 200), { zoom: 16 });
    plain.fitBounds(route);
    const padded = new maps.Map(container(300, 200), { zoom: 16 });
    padded.fitBounds(route, 60);
    expect(padded.getZoom()).toBeLessThan(plain.getZoom());
    const clamped = new maps.Map(container(300, 200), { zoom: 16, minZoom: 12, maxZoom: 13 });
    clamped.fitBounds(route);
    expect(clamped.getZoom()).toBe(13);
    clamped.fitBounds(new maps.LatLngBounds(new maps.LatLng(-60, -170), new maps.LatLng(60, 170)));
    expect(clamped.getZoom()).toBe(12);
  });

  test('narrowing the zoom range through setOptions moves the current zoom into it', () => {
    const { maps } = install();
    const map = new maps.Map(container(), { zoom: 16, minZoom: 10, maxZoom: 18 });
    map.setOptions({ minZoom: 17 });
    expect(map.getZoom()).toBe(17);
    map.setZoom(19);
    expect(map.getZoom()).toBe(18);
  });

  test('a Polyline attaches to a map and an AdvancedMarkerElement carries its options and clicks', () => {
    const { maps } = install();
    const map = new maps.Map(container());
    expect(() => new maps.Polyline({ path: [], strokeColor: '#fff' }).setMap(map)).not.toThrow();
    const content = document.createElement('div');
    const marker = new maps.marker.AdvancedMarkerElement({ map, content, position: { lat: 1, lng: 2 }, zIndex: 3 });
    // Identity checks: a deep match would walk the map and the DOM node.
    expect(marker.map).toBe(map);
    expect(marker.content).toBe(content);
    expect(marker.position).toEqual({ lat: 1, lng: 2 });
    expect(marker.zIndex).toBe(3);
    expect(marker.element).toBeInstanceOf(window.HTMLElement);
    const click = jest.fn();
    marker.addListener('gmp-click', click);
    maps.event.trigger(marker, 'gmp-click');
    expect(click).toHaveBeenCalledTimes(1);
    marker.map = null;
    expect(marker.map).toBeNull();
  });
});

describe('StreetViewService', () => {
  test('a location search mints a pano at the point, stably, and the id is then known', async () => {
    const { maps } = install();
    const service = new maps.StreetViewService();
    const first = service.getPanorama({ location: { lat: 47.6, lng: -122.3 }, radius: 50 });
    await flush();
    const { data } = await first;
    expect(data.location.latLng.lat()).toBe(47.6);
    expect(data.tiles.worldSize.width).toBeGreaterThan(0);
    const again = service.getPanorama({ location: new maps.LatLng(47.6, -122.3) });
    await flush();
    expect((await again).data.location.pano).toBe(data.location.pano);
    const byId = service.getPanorama({ pano: data.location.pano });
    await flush();
    expect((await byId).data).toBe(data);
    expect(maps.__stub.panos.has(data.location.pano)).toBe(true);
  });

  test('an id nobody has seen is ZERO_RESULTS, in both the promise and the callback form', async () => {
    const { maps } = install();
    const service = new maps.StreetViewService();
    const rejected = service.getPanorama({ pano: 'expired-pano' });
    rejected.catch(() => {}); // Observed below; this keeps the runner from reporting it as unhandled meanwhile.
    await flush();
    await expect(rejected).rejects.toMatchObject({ code: 'ZERO_RESULTS' });
    const callback = jest.fn();
    service.getPanorama({ pano: 'expired-pano' }, callback).catch(() => {});
    await flush();
    await flush();
    expect(callback).toHaveBeenCalledWith(null, 'ZERO_RESULTS');
    expect(maps.__stub.panos.has('expired-pano')).toBe(false);
  });

  test('an empty request is ZERO_RESULTS too', async () => {
    const { maps } = install();
    const rejected = new maps.StreetViewService().getPanorama({});
    rejected.catch(() => {});
    await flush();
    await expect(rejected).rejects.toMatchObject({ code: 'ZERO_RESULTS' });
  });

  test('serveAnyPano resolves an unseen id at null island instead', async () => {
    const { maps } = install({ options: { serveAnyPano: true } });
    const service = new maps.StreetViewService();
    const callback = jest.fn();
    const resolved = service.getPanorama({ pano: 'retired-but-served' }, callback);
    await flush();
    const { data } = await resolved;
    expect(data.location.pano).toBe('retired-but-served');
    expect(data.location.latLng.toJSON()).toEqual({ lat: 0, lng: 0 });
    await flush();
    expect(callback).toHaveBeenCalledWith(data, 'OK');
  });
});

describe('StreetViewPanorama', () => {
  /** Listens for every event GsvViewer waits on and records the order they arrive in. */
  function recordEvents(pano) {
    const order = [];
    for (const name of ['pano_changed', 'position_changed', 'links_changed', 'status_changed', 'pov_changed']) {
      pano.addListener(name, () => order.push(name));
    }
    return order;
  }

  test('setPano on a known id moves there and fires the load events in order', async () => {
    const { maps } = install();
    const el = document.createElement('div');
    const pano = new maps.StreetViewPanorama(el, { pov: { heading: 90, pitch: 5 } });
    expect(el.dataset.googleMapsStub).toBe('streetview');
    const service = new maps.StreetViewService();
    const search = service.getPanorama({ location: { lat: 47.6, lng: -122.3 } });
    await flush();
    const id = (await search).data.location.pano;
    const order = recordEvents(pano);
    pano.setPano(id);
    expect(order).toEqual([]);
    await flush();
    expect(order).toEqual(['pano_changed', 'position_changed', 'links_changed', 'status_changed']);
    expect(pano.pano).toBe(id);
    expect(pano.getPano()).toBe(id);
    expect(pano.getPosition().toJSON()).toEqual({ lat: 47.6, lng: -122.3 });
    expect(pano.getStatus()).toBe('OK');
    expect(pano.getPov()).toEqual({ heading: 90, pitch: 5, zoom: 1 });
  });

  test('setPano on an unknown id reports ZERO_RESULTS without moving', async () => {
    const { maps } = install();
    const pano = new maps.StreetViewPanorama(document.createElement('div'));
    const order = recordEvents(pano);
    pano.setPano('expired-pano');
    await flush();
    expect(order).toEqual(['status_changed']);
    expect(pano.getStatus()).toBe('ZERO_RESULTS');
    expect(pano.getPano()).toBeNull();
    expect(pano.getPosition()).toBeNull();
  });

  test('a registered pano provider answers for its ids, ahead of the fake world', async () => {
    const { maps } = install();
    const pano = new maps.StreetViewPanorama(document.createElement('div'));
    const provider = jest.fn((id) => (
      id === 'tutorial' ? { location: { pano: id, latLng: { lat: 38.94, lng: -77.07 } }, links: [] } : null
    ));
    pano.registerPanoProvider(provider);
    pano.setPano('tutorial');
    await flush();
    expect(provider).toHaveBeenCalledWith('tutorial');
    expect(pano.getPosition().toJSON()).toEqual({ lat: 38.94, lng: -77.07 });
    pano.setPano('not-a-tutorial-pano');
    await flush();
    expect(pano.getStatus()).toBe('ZERO_RESULTS');
    expect(pano.getPano()).toBe('tutorial');
  });

  test('a pano given to the constructor loads after a provider registered right after construction', async () => {
    const { maps } = install({ options: { serveAnyPano: true } });
    const pano = new maps.StreetViewPanorama(document.createElement('div'), { pano: 'tutorial' });
    pano.registerPanoProvider((id) => (
      id === 'tutorial' ? { location: { pano: id, latLng: { lat: 38.94, lng: -77.07 } } } : null
    ));
    expect(pano.getPano()).toBeNull();
    await flush();
    await flush();
    expect(pano.getPosition().toJSON()).toEqual({ lat: 38.94, lng: -77.07 });
    // Had the constructor resolved synchronously, serveAnyPano would have minted 'tutorial' at null island here.
    expect(maps.__stub.panos.has('tutorial')).toBe(false);
  });

  test('setPov merges into the current view and fires pov_changed; set() drives the MVC properties', async () => {
    const { maps } = install();
    const pano = new maps.StreetViewPanorama(document.createElement('div'));
    const order = recordEvents(pano);
    pano.setPov({ heading: 180 });
    pano.set('linksControl', false);
    await flush();
    expect(pano.getPov()).toEqual({ heading: 180, pitch: 0, zoom: 1 });
    expect(order).toEqual(['pov_changed']);
    expect(pano.get('linksControl')).toBe(false);
  });
});
