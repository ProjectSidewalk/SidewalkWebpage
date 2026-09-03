/**
 * A stand-in for the Google Maps JavaScript API, served to the browser suite in place of
 * https://maps.googleapis.com/maps/api/js so that no test ever reaches Google (issue #5129).
 *
 * Why it exists: Google bills the "Dynamic Street View" SKU per `new google.maps.StreetViewPanorama(...)`, tiles or
 * no tiles, and "Dynamic Maps" per `new google.maps.Map(...)`. Explore's tutorial pano and the label-detail popup
 * that /labelMap, /gallery, /dashboard and /stories build at page load each fire one, so a run of the smoke suite
 * against the real API was ~20 billable events — and the suite's job is to catch *our* runtime errors, not Google's.
 * With this file routed in, the CI project needs no key at all and the suite is deterministic offline.
 *
 * What it implements: only the surface `public/js` touches, so a member found here is known to be load-bearing and
 * a new Google call in the app fails here first rather than "working" against a fake the real API doesn't match.
 * The inventory is `grep -rn 'google\.maps\.' public/js app/views | grep -v /build/` plus the methods called on what
 * those return (`gsvPano.*`, `getMap().*`, the marker properties); re-run it before adding anything. Events arrive
 * on the next macrotask, as the real API's do. Nothing renders; each widget mounts an empty, labelled `<div>`.
 *
 * Pano contract — the same as Google's: a `location` search always finds a pano; a `pano` lookup succeeds only for
 * an id this stub has seen (minted by a search, or vouched for by the panorama's registered provider), and any other
 * id answers `ZERO_RESULTS` the way an expired pano does in production. That lets the server's own expiry verdict
 * drive the app's fallback chain (Pannellum + committed backups) on the CI seed, whose panoramas are all expired. A
 * spec that wants the primary-viewer path instead sets `window.googleMapsStubOptions = { serveAnyPano: true }`
 * before the page loads (fixtures.js exports `serveAnyPano(context)`), and every id resolves the way Google keeps
 * serving panoramas our metadata check has retired.
 *
 * Contract with the app's inline loader (app/views/common/main.scala.html): that snippet appends this script with
 * `?callback=google.maps.__ib__`, then re-invokes `google.maps.importLibrary(name)` expecting the loaded script to
 * have replaced it — so this file installs its own `importLibrary` *before* calling the callback.
 *
 * This is plain browser JS served as a string by test/e2e/fixtures.js (stubGoogleMaps); it is not a module.
 * test/js/googleMapsStub.test.js pins the contract above.
 */
(() => {
  'use strict';
  const google = (window.google = window.google || {});
  const maps = (google.maps = google.maps || {});
  const options = { serveAnyPano: false, ...(window.googleMapsStubOptions || {}) };
  // The fake `Map` class below shadows the built-in for the rest of this scope; keep the real one reachable.
  const NativeMap = globalThis.Map;

  // ── Events ──────────────────────────────────────────────────────────────────────────────────────────────────────
  // Listeners are stored per target object in a WeakMap so plain objects (and DOM nodes) can be targets too.
  const listeners = new WeakMap();
  const listenersFor = (target) => {
    if (!listeners.has(target)) listeners.set(target, new NativeMap());
    return listeners.get(target);
  };
  /** A listener handle in the shape google.maps.event.removeListener() accepts. */
  class MapsEventListener {
    constructor(target, name, fn) {
      this.target = target;
      this.name = name;
      this.fn = fn;
    }
    remove() {
      const byName = listenersFor(this.target).get(this.name);
      if (byName) byName.delete(this.fn);
    }
  }
  const event = {
    addListener(target, name, fn) {
      const byName = listenersFor(target);
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(fn);
      return new MapsEventListener(target, name, fn);
    },
    addListenerOnce(target, name, fn) {
      const handle = event.addListener(target, name, (...args) => {
        handle.remove();
        fn(...args);
      });
      return handle;
    },
    removeListener(handle) {
      if (handle && typeof handle.remove === 'function') handle.remove();
    },
    trigger(target, name, ...args) {
      const byName = listenersFor(target).get(name);
      // Copied first so a listener that removes itself (addListenerOnce) doesn't disturb the iteration.
      if (byName) for (const fn of [...byName]) fn(...args);
    },
  };
  /** Fires events on the next macrotask, in order, the way the real API's state events arrive after a call returns. */
  const emitAsync = (target, ...names) => setTimeout(() => names.forEach((name) => event.trigger(target, name)), 0);

  /** Base class with the get/set/addListener trio every Maps object exposes. */
  class MVCObject {
    #values = new NativeMap();
    get(key) {
      return this.#values.get(key);
    }
    set(key, value) {
      this.#values.set(key, value);
      emitAsync(this, `${key}_changed`);
    }
    addListener(name, fn) {
      return event.addListener(this, name, fn);
    }
  }

  // ── Geometry ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Accepts a LatLng or a `{lat, lng}` literal, the two forms every Maps constructor takes. */
  const toLatLngLiteral = (v) => (v instanceof LatLng ? { lat: v.lat(), lng: v.lng() } : { lat: +v.lat, lng: +v.lng });
  /** `lat()`/`lng()` are methods, as on the real one — the shape GsvViewer's pano-data packaging reads. */
  class LatLng {
    #lat;
    #lng;
    constructor(lat, lng) {
      const lit = typeof lat === 'object' ? toLatLngLiteral(lat) : { lat: +lat, lng: +lng };
      this.#lat = lit.lat;
      this.#lng = lit.lng;
    }
    lat() {
      return this.#lat;
    }
    lng() {
      return this.#lng;
    }
    toJSON() {
      return { lat: this.#lat, lng: this.#lng };
    }
  }
  /** Built by extend() (Minimap) and read back by corner (ObservedArea, RouteOverview). */
  class LatLngBounds {
    #sw = null;
    #ne = null;
    constructor(sw, ne) {
      if (sw) this.extend(sw);
      if (ne) this.extend(ne);
    }
    isEmpty() {
      return this.#sw === null;
    }
    extend(point) {
      const { lat, lng } = toLatLngLiteral(point);
      if (this.isEmpty()) {
        this.#sw = { lat, lng };
        this.#ne = { lat, lng };
        return this;
      }
      this.#sw = { lat: Math.min(this.#sw.lat, lat), lng: Math.min(this.#sw.lng, lng) };
      this.#ne = { lat: Math.max(this.#ne.lat, lat), lng: Math.max(this.#ne.lng, lng) };
      return this;
    }
    getSouthWest() {
      return this.isEmpty() ? null : new LatLng(this.#sw);
    }
    getNorthEast() {
      return this.isEmpty() ? null : new LatLng(this.#ne);
    }
    getCenter() {
      if (this.isEmpty()) return null;
      return new LatLng((this.#sw.lat + this.#ne.lat) / 2, (this.#sw.lng + this.#ne.lng) / 2);
    }
  }
  /** Pixel dimensions, as in GsvViewer's tutorial pano data. */
  class Size {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
  }
  /** A world-coordinate point. */
  class Point {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
  }

  // Web Mercator on the 256px world the Maps API uses at zoom 0, so pixel math against getZoom() comes out right.
  const WORLD_PX = 256;
  const PROJECTION = {
    fromLatLngToPoint(latLng) {
      const { lat, lng } = toLatLngLiteral(latLng);
      const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
      return new Point(
        WORLD_PX * (0.5 + lng / 360), WORLD_PX * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
      );
    },
    fromPointToLatLng(point) {
      const lng = (point.x / WORLD_PX - 0.5) * 360;
      const n = Math.PI - (2 * Math.PI * point.y) / WORLD_PX;
      return new LatLng((180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng);
    },
  };

  // ── Map ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Mounts a labelled placeholder so tests (and humans looking at a trace) can see where a widget went. */
  const mount = (el, kind) => {
    if (!el) return el;
    el.dataset.googleMapsStub = kind;
    el.innerHTML = '<div style="width:100%;height:100%;background:#e5e3df" aria-hidden="true"></div>';
    return el;
  };
  // The real API's zoom range; fitBounds and setZoom clamp to it and to the map's own minZoom/maxZoom.
  const ZOOM_MIN = 0;
  const ZOOM_MAX = 22;
  const DEFAULT_CONTAINER_PX = 300;
  /** Explore's minimap. Bounds derive from center + zoom + container, never cached, so they track getZoom(). */
  class Map extends MVCObject {
    #div;
    #center;
    #zoom;
    #options;
    #settling = false;
    constructor(el, options = {}) {
      super();
      this.#div = mount(el, 'map');
      this.#options = { ...options };
      this.#center = options.center ? new LatLng(options.center) : new LatLng(0, 0);
      this.#zoom = this.#clampZoom(options.zoom ?? 8);
      this.#settle();
    }
    /**
     * Every change settles into `bounds_changed` then `idle`, which the app awaits. A synchronous burst (Minimap's
     * `setZoom` + `setCenter` reset) settles once, as the real map does: each `idle` redraws Explore's overlays.
     */
    #settle() {
      if (this.#settling) return;
      this.#settling = true;
      setTimeout(() => {
        this.#settling = false;
        event.trigger(this, 'bounds_changed');
        event.trigger(this, 'idle');
      }, 0);
    }
    #clampZoom(z) {
      const lo = Math.max(ZOOM_MIN, this.#options.minZoom ?? ZOOM_MIN);
      const hi = Math.min(ZOOM_MAX, this.#options.maxZoom ?? ZOOM_MAX);
      return Math.min(hi, Math.max(lo, z));
    }
    #containerSize() {
      return {
        width: this.#div?.clientWidth || DEFAULT_CONTAINER_PX,
        height: this.#div?.clientHeight || DEFAULT_CONTAINER_PX,
      };
    }
    getCenter() {
      return this.#center;
    }
    setCenter(c) {
      this.#center = new LatLng(c);
      emitAsync(this, 'center_changed');
      this.#settle();
    }
    getZoom() {
      return this.#zoom;
    }
    setZoom(z) {
      this.#zoom = this.#clampZoom(z);
      emitAsync(this, 'zoom_changed');
      this.#settle();
    }
    /** The container's pixels at the current zoom, centred on the centre. */
    getBounds() {
      const scale = 2 ** this.#zoom;
      const { width, height } = this.#containerSize();
      const c = PROJECTION.fromLatLngToPoint(this.#center);
      const halfW = width / scale / 2;
      const halfH = height / scale / 2;
      return new LatLngBounds(
        PROJECTION.fromPointToLatLng(new Point(c.x - halfW, c.y + halfH)),
        PROJECTION.fromPointToLatLng(new Point(c.x + halfW, c.y - halfH)),
      );
    }
    /**
     * Recentres and picks the largest integer zoom at which the bounds fit inside the padded container, clamped to
     * the zoom range — as the real map does, so the overlays' pixel math against getZoom() stays consistent.
     * @param {LatLngBounds} bounds The area to show.
     * @param {number|{top?: number, right?: number, bottom?: number, left?: number}} [padding=0] Pixels to keep clear.
     */
    fitBounds(bounds, padding = 0) {
      if (bounds.isEmpty()) return;
      const pad = typeof padding === 'number'
        ? { top: padding, right: padding, bottom: padding, left: padding }
        : { top: 0, right: 0, bottom: 0, left: 0, ...padding };
      const { width, height } = this.#containerSize();
      const sw = PROJECTION.fromLatLngToPoint(bounds.getSouthWest());
      const ne = PROJECTION.fromLatLngToPoint(bounds.getNorthEast());
      const worldW = Math.max(ne.x - sw.x, Number.EPSILON);
      const worldH = Math.max(sw.y - ne.y, Number.EPSILON);
      const fit = Math.min(
        (width - pad.left - pad.right) / worldW, (height - pad.top - pad.bottom) / worldH,
      );
      this.#zoom = this.#clampZoom(Math.floor(Math.log2(Math.max(fit, 1))));
      this.#center = bounds.getCenter();
      emitAsync(this, 'zoom_changed', 'center_changed');
      this.#settle();
    }
    setOptions(o) {
      Object.assign(this.#options, o || {});
      // A narrowed range applies to the current zoom too, as on the real map.
      this.#zoom = this.#clampZoom(o?.zoom ?? this.#zoom);
      if (o?.center) this.#center = new LatLng(o.center);
      this.#settle();
    }
    getProjection() {
      return PROJECTION;
    }
  }
  const MapTypeId = { ROADMAP: 'roadmap', SATELLITE: 'satellite', HYBRID: 'hybrid', TERRAIN: 'terrain' };
  const RenderingType = { RASTER: 'RASTER', VECTOR: 'VECTOR', UNINITIALIZED: 'UNINITIALIZED' };

  /** A route segment on the minimap (Task.js); only constructed and attached, never read back. */
  class Polyline extends MVCObject {
    #options;
    constructor(options = {}) {
      super();
      this.#options = { ...options };
    }
    setMap(map) {
      this.#options.map = map;
    }
  }

  /**
   * The `marker` library's element: a plain object with writable properties (Peg moves it by assigning `position`,
   * `remove()` by assigning `map = null`) that also emits `gmp-click` through the shared event system.
   */
  class AdvancedMarkerElement extends MVCObject {
    constructor(options = {}) {
      super();
      Object.assign(this, { position: null, map: null, content: null, zIndex: null }, options);
      this.element = document.createElement('div');
      this.element.className = 'gmp-advanced-marker-stub';
    }
  }

  // ── Street View ─────────────────────────────────────────────────────────────────────────────────────────────────
  const StreetViewStatus = { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS', UNKNOWN_ERROR: 'UNKNOWN_ERROR' };
  const StreetViewSource = { DEFAULT: 'default', OUTDOOR: 'outdoor', GOOGLE: 'google' };

  /**
   * Everything a location search has minted, keyed by an id derived from the point so the same search finds the
   * same pano and a later lookup by that id succeeds. Under `serveAnyPano` an unseen id is minted at null island.
   */
  const panoRegistry = new NativeMap();
  const mintPanoData = (latLng, id = `stub-pano-${latLng.lat().toFixed(5)}-${latLng.lng().toFixed(5)}`) => {
    if (!panoRegistry.has(id)) {
      panoRegistry.set(id, {
        location: { pano: id, latLng, description: 'stub street', shortDescription: 'stub street' },
        links: [],
        imageDate: '2020-01',
        copyright: 'Imagery (c) google-maps-stub',
        tiles: {
          tileSize: new Size(512, 256),
          worldSize: new Size(1024, 512),
          centerHeading: 0,
          originHeading: 0,
          originPitch: 0,
          getTileUrl: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        },
        time: [],
      });
    }
    return panoRegistry.get(id);
  };
  const lookupPano = (id) => (
    panoRegistry.get(id) || (options.serveAnyPano ? mintPanoData(new LatLng(0, 0), id) : null)
  );
  const zeroResults = (what) => (
    Object.assign(new Error(`${what}: ZERO_RESULTS`), { code: StreetViewStatus.ZERO_RESULTS })
  );

  /** Mirrors the promise form of the real API: resolves `{data}`, rejects with `{code}` on a miss. */
  class StreetViewService {
    getPanorama(request, callback) {
      const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
          if (request.pano) {
            const data = lookupPano(request.pano);
            return data ? resolve({ data }) : reject(zeroResults(`pano ${request.pano}`));
          }
          if (request.location) return resolve({ data: mintPanoData(new LatLng(request.location)) });
          reject(zeroResults('empty request'));
        }, 0);
      });
      if (callback) promise.then((r) => callback(r.data, StreetViewStatus.OK), (e) => callback(null, e.code));
      return promise;
    }
  }

  /**
   * A constructor-supplied pano loads on the next macrotask, as on the real widget, so a provider registered right
   * after construction (Google's own custom-panorama pattern) still gets to answer for it.
   */
  class StreetViewPanorama extends MVCObject {
    #pano = null;
    #pov;
    #position = null;
    #status = null;
    #provider = null;
    constructor(el, options = {}) {
      super();
      mount(el, 'streetview');
      this.#pov = { heading: 0, pitch: 0, zoom: 1, ...(options.pov || {}) };
      if (options.pano) setTimeout(() => this.setPano(options.pano), 0);
    }
    /** The id property the real panorama exposes alongside getPano(). */
    get pano() {
      return this.#pano;
    }
    registerPanoProvider(provider) {
      this.#provider = provider;
    }
    #lookup(panoId) {
      const custom = this.#provider ? this.#provider(panoId) : null;
      return custom || lookupPano(panoId);
    }
    /** Loads a pano and fires the events GsvViewer waits on; an id nobody vouches for is ZERO_RESULTS, and no move. */
    setPano(panoId) {
      const data = this.#lookup(panoId);
      if (!data) {
        this.#status = StreetViewStatus.ZERO_RESULTS;
        emitAsync(this, 'status_changed');
        return;
      }
      this.#pano = panoId;
      this.#position = new LatLng(data.location.latLng);
      this.#status = StreetViewStatus.OK;
      emitAsync(this, 'pano_changed', 'position_changed', 'links_changed', 'status_changed');
    }
    getPano() {
      return this.#pano;
    }
    getPosition() {
      return this.#position;
    }
    getStatus() {
      return this.#status;
    }
    getPov() {
      return { ...this.#pov };
    }
    setPov(pov) {
      this.#pov = { ...this.#pov, ...pov };
      emitAsync(this, 'pov_changed');
    }
  }

  // ── Namespace + loader hand-off ─────────────────────────────────────────────────────────────────────────────────
  const core = { event, LatLng, LatLngBounds, Size, Point, MVCObject };
  const mapsLib = { Map, MapTypeId, RenderingType, Polyline };
  const streetView = { StreetViewPanorama, StreetViewService, StreetViewStatus, StreetViewSource };
  const marker = { AdvancedMarkerElement };
  const libraries = { core, maps: mapsLib, streetView, marker };

  Object.assign(maps, core, mapsLib, streetView, { marker, version: 'stub' });
  maps.importLibrary = (name) => (
    libraries[name]
      ? Promise.resolve(libraries[name])
      : Promise.reject(new Error(`google-maps-stub: no library "${name}"`))
  );
  // Test-side introspection: the options this install read, and what the fake service has minted so far.
  maps.__stub = { options, panos: panoRegistry };

  // The loader passed its resolver as `callback=google.maps.__ib__`; calling it releases every pending importLibrary.
  const scriptUrl = document.currentScript?.src || 'https://maps.googleapis.com/maps/api/js';
  const callbackName = new URL(scriptUrl).searchParams.get('callback');
  const callback = callbackName ? callbackName.split('.').reduce((o, k) => (o ? o[k] : undefined), window) : null;
  if (typeof callback === 'function') callback();
})();
