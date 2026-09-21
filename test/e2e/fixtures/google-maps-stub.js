/**
 * A stand-in for the Google Maps JavaScript API, served to the browser suite in place of
 * https://maps.googleapis.com/maps/api/js so that no test ever reaches Google (issue #5129).
 *
 * Why it exists: Google bills the "Dynamic Street View" SKU per `new google.maps.StreetViewPanorama(...)`, tiles or
 * no tiles. Explore's tutorial pano and the label-detail popup that /labelMap, /gallery, /dashboard and /stories
 * build at page load each fire one, so a run of the smoke suite against the real API was ~20 billable events — and the suite's job is to catch *our* runtime errors, not Google's.
 * With this file routed in, the CI project needs no key at all and the suite is deterministic offline.
 *
 * What it implements: only the surface `public/js` touches, so a member found here is known to be load-bearing and
 * a new Google call in the app fails here first rather than "working" against a fake the real API doesn't match.
 * The inventory is `grep -rn 'google\.maps\.' public/js app/views | grep -v /build/` plus the members destructured
 * from `importLibrary()` and the methods called on what those return (`gsvPano.*`); re-run it before adding
 * anything. Events arrive on the next macrotask, as the real API's do. Nothing renders; the panorama mounts an
 * empty, labelled `<div>`.
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

  // ── Events ──────────────────────────────────────────────────────────────────────────────────────────────────────
  // Listeners are stored per target object in a WeakMap so plain objects (and DOM nodes) can be targets too.
  const listeners = new WeakMap();
  const listenersFor = (target) => {
    if (!listeners.has(target)) listeners.set(target, new Map());
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
    #values = new Map();
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
  /** Pixel dimensions, as in GsvViewer's tutorial pano data. */
  class Size {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
  }

  // ── Street View ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** Mounts a labelled placeholder so tests (and humans looking at a trace) can see where a widget went. */
  const mount = (el, kind) => {
    if (!el) return el;
    el.dataset.googleMapsStub = kind;
    el.innerHTML = '<div style="width:100%;height:100%;background:#e5e3df" aria-hidden="true"></div>';
    return el;
  };
  const StreetViewStatus = { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS', UNKNOWN_ERROR: 'UNKNOWN_ERROR' };
  const StreetViewSource = { DEFAULT: 'default', OUTDOOR: 'outdoor', GOOGLE: 'google' };

  /**
   * Everything a location search has minted, keyed by an id derived from the point so the same search finds the
   * same pano and a later lookup by that id succeeds. Under `serveAnyPano` an unseen id is minted at null island.
   */
  const panoRegistry = new Map();
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
  const core = { event, LatLng, Size, MVCObject };
  const streetView = { StreetViewPanorama, StreetViewService, StreetViewStatus, StreetViewSource };
  const libraries = { core, streetView };

  Object.assign(maps, core, streetView, { version: 'stub' });
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
