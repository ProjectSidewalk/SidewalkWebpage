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
 * What it implements: exactly the surface `public/js` touches (grep `google\.maps\.` there, build output excluded),
 * with the event semantics the app relies on — `Map` fires `bounds_changed` + `idle` after every change,
 * `StreetViewPanorama.setPano()` resolves through a registered pano provider (Explore's tutorial) or the fake
 * `StreetViewService` registry and fires `pano_changed` / `position_changed` / `links_changed` / `status_changed`,
 * and an unknown pano id rejects with `ZERO_RESULTS` so Validate's backup-imagery fallback is exercised the way an
 * expired pano exercises it in production. Nothing renders; each widget mounts an empty, labelled `<div>`.
 *
 * Contract with the app's inline loader (app/views/common/main.scala.html): that snippet appends this script with
 * `?callback=google.maps.__ib__`, then re-invokes `google.maps.importLibrary(name)` expecting the loaded script to
 * have replaced it — so this file installs its own `importLibrary` *before* calling the callback.
 *
 * This is plain browser JS served as a string by test/e2e/fixtures.js (stubGoogleMaps); it is not a module.
 */
(() => {
  'use strict';
  const google = (window.google = window.google || {});
  const maps = (google.maps = google.maps || {});
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
    constructor(target, name, fn) { this.target = target; this.name = name; this.fn = fn; }
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
      const handle = event.addListener(target, name, (...args) => { handle.remove(); fn(...args); });
      return handle;
    },
    removeListener(handle) { if (handle && typeof handle.remove === 'function') handle.remove(); },
    clearListeners(target, name) { listenersFor(target).delete(name); },
    clearInstanceListeners(target) { listeners.delete(target); },
    trigger(target, name, ...args) {
      const byName = listenersFor(target).get(name);
      if (byName) for (const fn of [...byName]) fn(...args);
    },
  };
  /** Fires an event on the next macrotask, the way the real API's state events arrive after the call returns. */
  const emitAsync = (target, name, ...args) => setTimeout(() => event.trigger(target, name, ...args), 0);

  /** Base class with the get/set/addListener trio every Maps object exposes. */
  class MVCObject {
    #values = new NativeMap();
    get(key) { return this.#values.get(key); }
    set(key, value) { this.#values.set(key, value); emitAsync(this, `${key}_changed`); }
    setValues(values) { for (const [k, v] of Object.entries(values || {})) this.set(k, v); }
    addListener(name, fn) { return event.addListener(this, name, fn); }
  }

  // ── Geometry ────────────────────────────────────────────────────────────────────────────────────────────────────
  const toLatLngLiteral = (v) => (v instanceof LatLng ? { lat: v.lat(), lng: v.lng() } : { lat: +v.lat, lng: +v.lng });
  class LatLng {
    #lat; #lng;
    constructor(lat, lng) {
      const lit = typeof lat === 'object' ? toLatLngLiteral(lat) : { lat: +lat, lng: +lng };
      this.#lat = lit.lat; this.#lng = lit.lng;
    }
    lat() { return this.#lat; }
    lng() { return this.#lng; }
    equals(o) { return !!o && this.lat() === o.lat() && this.lng() === o.lng(); }
    toJSON() { return { lat: this.#lat, lng: this.#lng }; }
    toString() { return `(${this.#lat}, ${this.#lng})`; }
    toUrlValue(p = 6) { return `${this.#lat.toFixed(p)},${this.#lng.toFixed(p)}`; }
  }
  class LatLngBounds {
    #sw = null; #ne = null;
    constructor(sw, ne) { if (sw) this.extend(sw); if (ne) this.extend(ne); }
    isEmpty() { return this.#sw === null; }
    extend(point) {
      const { lat, lng } = toLatLngLiteral(point);
      if (this.isEmpty()) { this.#sw = { lat, lng }; this.#ne = { lat, lng }; return this; }
      this.#sw = { lat: Math.min(this.#sw.lat, lat), lng: Math.min(this.#sw.lng, lng) };
      this.#ne = { lat: Math.max(this.#ne.lat, lat), lng: Math.max(this.#ne.lng, lng) };
      return this;
    }
    union(other) { if (!other.isEmpty()) { this.extend(other.getSouthWest()); this.extend(other.getNorthEast()); } return this; }
    contains(point) {
      if (this.isEmpty()) return false;
      const { lat, lng } = toLatLngLiteral(point);
      return lat >= this.#sw.lat && lat <= this.#ne.lat && lng >= this.#sw.lng && lng <= this.#ne.lng;
    }
    getSouthWest() { return this.isEmpty() ? null : new LatLng(this.#sw); }
    getNorthEast() { return this.isEmpty() ? null : new LatLng(this.#ne); }
    getCenter() {
      return this.isEmpty() ? null : new LatLng((this.#sw.lat + this.#ne.lat) / 2, (this.#sw.lng + this.#ne.lng) / 2);
    }
    toJSON() { return this.isEmpty() ? null : { south: this.#sw.lat, west: this.#sw.lng, north: this.#ne.lat, east: this.#ne.lng }; }
  }
  class Size { constructor(width, height) { this.width = width; this.height = height; } equals(o) { return !!o && o.width === this.width && o.height === this.height; } }
  class Point { constructor(x, y) { this.x = x; this.y = y; } equals(o) { return !!o && o.x === this.x && o.y === this.y; } }

  // Web Mercator on the 256px world the Maps API uses at zoom 0, so pixel math against getZoom() comes out right.
  const PROJECTION = {
    fromLatLngToPoint(latLng) {
      const { lat, lng } = toLatLngLiteral(latLng);
      const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
      return new Point(256 * (0.5 + lng / 360), 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)));
    },
    fromPointToLatLng(point) {
      const lng = (point.x / 256 - 0.5) * 360;
      const n = Math.PI - (2 * Math.PI * point.y) / 256;
      return new LatLng((180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng);
    },
  };

  // ── Map ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Mounts a labelled placeholder so tests (and humans looking at a trace) can see where a widget went. */
  const mount = (el, kind) => {
    if (!el) return el;
    el.dataset.googleMapsStub = kind;
    el.innerHTML = `<div style="width:100%;height:100%;background:#e5e3df" aria-hidden="true"></div>`;
    return el;
  };
  class Map extends MVCObject {
    #div; #center; #zoom; #bounds = null; #options;
    constructor(el, options = {}) {
      super();
      this.#div = mount(el, 'map');
      this.#options = { ...options };
      this.#center = options.center ? new LatLng(options.center) : new LatLng(0, 0);
      this.#zoom = options.zoom ?? 8;
      this.#settle();
    }
    /** Every change settles into `bounds_changed` then `idle`, which is what the app awaits after creating a map. */
    #settle() { emitAsync(this, 'bounds_changed'); emitAsync(this, 'idle'); }
    getDiv() { return this.#div; }
    getCenter() { return this.#center; }
    setCenter(c) { this.#center = new LatLng(c); emitAsync(this, 'center_changed'); this.#settle(); }
    panTo(c) { this.setCenter(c); }
    panBy() { this.#settle(); }
    getZoom() { return this.#zoom; }
    setZoom(z) { this.#zoom = z; emitAsync(this, 'zoom_changed'); this.#settle(); }
    /** Bounds follow the container's pixel size at the current zoom, like the real map's after `idle`. */
    getBounds() {
      if (this.#bounds) return this.#bounds;
      const scale = 2 ** this.#zoom;
      const w = (this.#div?.clientWidth || 300) / scale / 2;
      const h = (this.#div?.clientHeight || 300) / scale / 2;
      const c = PROJECTION.fromLatLngToPoint(this.#center);
      return new LatLngBounds(
        PROJECTION.fromPointToLatLng(new Point(c.x - w, c.y + h)), PROJECTION.fromPointToLatLng(new Point(c.x + w, c.y - h)),
      );
    }
    fitBounds(bounds) {
      this.#bounds = bounds;
      if (!bounds.isEmpty()) this.#center = bounds.getCenter();
      this.#settle();
    }
    setOptions(options) { Object.assign(this.#options, options || {}); if (options?.center) this.setCenter(options.center); if (options?.zoom !== undefined) this.setZoom(options.zoom); }
    getMapTypeId() { return this.#options.mapTypeId; }
    setMapTypeId(id) { this.#options.mapTypeId = id; }
    getProjection() { return PROJECTION; }
    getRenderingType() { return this.#options.renderingType || 'RASTER'; }
  }
  const MapTypeId = { ROADMAP: 'roadmap', SATELLITE: 'satellite', HYBRID: 'hybrid', TERRAIN: 'terrain' };
  const RenderingType = { RASTER: 'RASTER', VECTOR: 'VECTOR', UNINITIALIZED: 'UNINITIALIZED' };

  class Polyline extends MVCObject {
    #options;
    constructor(options = {}) { super(); this.#options = { ...options }; }
    getMap() { return this.#options.map || null; }
    setMap(map) { this.#options.map = map; }
    getPath() { return this.#options.path || []; }
    setPath(path) { this.#options.path = path; }
    getVisible() { return this.#options.visible !== false; }
    setVisible(v) { this.#options.visible = v; }
    setOptions(o) { Object.assign(this.#options, o || {}); }
  }

  /** The legacy marker: only its map/position/visibility plumbing is ever called. */
  class Marker extends MVCObject {
    #options;
    constructor(options = {}) { super(); this.#options = { ...options }; }
    getMap() { return this.#options.map || null; }
    setMap(map) { this.#options.map = map; }
    getPosition() { return this.#options.position ? new LatLng(this.#options.position) : null; }
    setPosition(p) { this.#options.position = p; emitAsync(this, 'position_changed'); }
    getVisible() { return this.#options.visible !== false; }
    setVisible(v) { this.#options.visible = v; }
    setIcon(icon) { this.#options.icon = icon; }
    setZIndex(z) { this.#options.zIndex = z; }
    getZIndex() { return this.#options.zIndex; }
    setTitle(t) { this.#options.title = t; }
    setOptions(o) { Object.assign(this.#options, o || {}); }
  }
  Marker.MAX_ZINDEX = 1000000;

  /** The `marker` library's element: a plain object with the same writable properties. */
  class AdvancedMarkerElement extends MVCObject {
    constructor(options = {}) {
      super();
      this.position = options.position ?? null;
      this.map = options.map ?? null;
      this.content = options.content ?? null;
      this.zIndex = options.zIndex ?? null;
      this.title = options.title ?? '';
      this.gmpClickable = !!options.gmpClickable;
      this.gmpDraggable = !!options.gmpDraggable;
      this.collisionBehavior = options.collisionBehavior ?? null;
      this.element = document.createElement('div');
      this.element.className = 'gmp-advanced-marker-stub';
    }
  }
  class PinElement { constructor(options = {}) { Object.assign(this, options); this.element = document.createElement('div'); } }

  // ── Street View ─────────────────────────────────────────────────────────────────────────────────────────────────
  const StreetViewStatus = { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS', UNKNOWN_ERROR: 'UNKNOWN_ERROR' };
  const StreetViewSource = { DEFAULT: 'default', OUTDOOR: 'outdoor', GOOGLE: 'google' };
  const StreetViewPreference = { NEAREST: 'nearest', BEST: 'best' };

  /**
   * The fake world's panos. A location search mints one at the requested point; a lookup by an id nobody has seen
   * resolves too, at a null-island position, because the app's server (which vouches for pano availability before a
   * page asks for one) is real in every environment this stub runs in — a pano the server just handed out must
   * exist, or Validate has nothing to fall back to. A test that wants the expired-imagery path calls
   * `google.maps.__stub.expire([...ids])` first, and those ids then answer ZERO_RESULTS like Google does.
   */
  const panoRegistry = new NativeMap();
  const expiredPanos = new Set();
  const mintPanoData = (latLng, description = 'stub street', pano = null) => {
    const id = pano || `stub-pano-${latLng.lat().toFixed(5)}-${latLng.lng().toFixed(5)}`;
    if (!panoRegistry.has(id)) {
      panoRegistry.set(id, {
        location: { pano: id, latLng, description, shortDescription: description },
        links: [],
        imageDate: '2020-01',
        copyright: 'Imagery (c) google-maps-stub',
        tiles: {
          tileSize: new Size(512, 256), worldSize: new Size(1024, 512),
          centerHeading: 0, originHeading: 0, originPitch: 0,
          getTileUrl: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        },
        time: [],
      });
    }
    return panoRegistry.get(id);
  };
  const lookupPano = (id) => (expiredPanos.has(id) ? null : panoRegistry.get(id) || mintPanoData(new LatLng(0, 0), 'stub pano', id));
  const zeroResults = (what) => Object.assign(new Error(`${what}: ZERO_RESULTS`), { code: StreetViewStatus.ZERO_RESULTS });

  class StreetViewService {
    /** Mirrors the promise form of the real API: resolves `{data}`, rejects with `{code}` on a miss. */
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

  class StreetViewPanorama extends MVCObject {
    #div; #pano = null; #pov; #zoom = 1; #position = null; #links = []; #status = null; #visible = true; #provider = null;
    #options;
    constructor(el, options = {}) {
      super();
      this.#div = mount(el, 'streetview');
      this.#options = { ...options };
      this.#pov = { heading: 0, pitch: 0, ...(options.pov || {}) };
      if (options.zoom !== undefined) this.#zoom = options.zoom;
      if (options.pano) this.setPano(options.pano);
      else if (options.position) this.setPosition(options.position);
    }
    /** The id property the real panorama exposes alongside getPano(). */
    get pano() { return this.#pano; }
    registerPanoProvider(provider) { this.#provider = provider; }
    #lookup(panoId) {
      const custom = this.#provider ? this.#provider(panoId) : null;
      return custom || lookupPano(panoId);
    }
    /** Loads a pano and fires the events GsvViewer waits on; an unknown id lands in ZERO_RESULTS with no move. */
    setPano(panoId) {
      const data = this.#lookup(panoId);
      if (!data) { this.#status = StreetViewStatus.ZERO_RESULTS; emitAsync(this, 'status_changed'); return; }
      this.#pano = panoId;
      this.#position = new LatLng(data.location.latLng);
      this.#links = data.links || [];
      this.#status = StreetViewStatus.OK;
      emitAsync(this, 'pano_changed');
      emitAsync(this, 'position_changed');
      emitAsync(this, 'links_changed');
      emitAsync(this, 'status_changed');
    }
    getPano() { return this.#pano; }
    setPosition(latLng) { this.setPano(mintPanoData(new LatLng(latLng)).location.pano); }
    getPosition() { return this.#position; }
    getStatus() { return this.#status; }
    getLinks() { return this.#links; }
    getLocation() { return this.#pano ? this.#lookup(this.#pano)?.location ?? null : null; }
    getPov() { return { ...this.#pov }; }
    setPov(pov) { this.#pov = { ...this.#pov, ...pov }; emitAsync(this, 'pov_changed'); }
    getZoom() { return this.#zoom; }
    setZoom(z) { this.#zoom = z; emitAsync(this, 'zoom_changed'); }
    getVisible() { return this.#visible; }
    setVisible(v) { this.#visible = v; emitAsync(this, 'visible_changed'); }
    getPhotographerPov() { return { ...this.#pov }; }
    setOptions(options) { Object.assign(this.#options, options || {}); if (options?.pov) this.setPov(options.pov); if (options?.pano) this.setPano(options.pano); }
    getContainer() { return this.#div; }
    focus() {}
    controls = [];
  }

  // ── Namespace + loader hand-off ─────────────────────────────────────────────────────────────────────────────────
  const core = { event, LatLng, LatLngBounds, Size, Point, MVCObject, StreetViewSource };
  const mapsLib = { Map, MapTypeId, RenderingType, Polyline, Marker, StreetViewPanorama, StreetViewService, StreetViewStatus, StreetViewSource };
  const streetView = { StreetViewPanorama, StreetViewService, StreetViewStatus, StreetViewSource, StreetViewPreference };
  const marker = { AdvancedMarkerElement, PinElement, Marker };
  const libraries = { core, maps: mapsLib, streetView, marker, geometry: {}, places: {}, visualization: {}, drawing: {} };

  Object.assign(maps, core, mapsLib, streetView, { marker, version: 'stub', StreetViewPreference });
  maps.importLibrary = (name) => (
    libraries[name] ? Promise.resolve(libraries[name]) : Promise.reject(new Error(`google-maps-stub: no library "${name}"`))
  );
  // Test-side controls: `expire(ids)` makes those panos answer ZERO_RESULTS (the expired-imagery path), `panos`
  // exposes what the fake service has minted so far.
  maps.__stub = { expire: (ids) => ids.forEach((id) => expiredPanos.add(id)), restore: (ids) => ids.forEach((id) => expiredPanos.delete(id)), panos: panoRegistry };

  // The loader passed its resolver as `callback=google.maps.__ib__`; calling it releases every pending importLibrary.
  const callbackName = new URL(document.currentScript?.src || 'https://maps.googleapis.com/maps/api/js').searchParams.get('callback');
  const callback = callbackName ? callbackName.split('.').reduce((o, k) => (o ? o[k] : undefined), window) : null;
  if (typeof callback === 'function') callback();
})();
