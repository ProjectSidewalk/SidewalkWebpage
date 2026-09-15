/**
 * Abstract base class defining the common panorama viewer interface.
 */
class PanoViewer {
  /**
   * The type of panorama viewer.
   * @type {string}
   */
  viewerType;

  /**
   * The class name for the canvas that shows the image. Used for taking screenshots.
   * @type {string}
   */
  canvasClass;

  /**
   * A list of functions to execute (in order) after moving to a new pano.
   * @type {Function[]}
   */
  panoChangedListeners = [];

  /**
   * A list of functions to execute (in order) after the pov changes.
   * @type {Function[]}
   */
  povChangedListeners = [];

  /**
   * Which initial seed successfully placed the viewer: 'pano' when startPanoId loaded, 'latLng' when a
   * startLatLng/backupLatLngs candidate did. Undefined until _moveToInitialLocation() succeeds.
   * @type {('pano'|'latLng'|undefined)}
   */
  initialSeed;

  /**
   * The element the viewer renders into. create() sets this before initialize() runs so that it is available to
   * any code the initialization path calls (e.g. an early getPov()). _viewportAspect() measures it to derive the
   * live aspect ratio for fov↔zoom conversion (#4852).
   * @type {(Element|undefined)}
   */
  canvasElem;

  /**
   * Private constructor to prevent direct instantiation.
   */
  constructor() {
    if (new.target === PanoViewer) {
      throw new Error('Cannot instantiate abstract class directly');
    }
    this.viewerType = new.target.SOURCE;
    if (new.target === GsvViewer) {
      this.canvasClass = 'widget-scene-canvas';
    } else if (new.target === MapillaryViewer) {
      this.canvasClass = 'mapillary-canvas';
    } else if (new.target === Infra3dViewer) {
      this.canvasClass = 'infra3dsdk-canvas';
    } else if (new.target === PannellumViewer) {
      this.canvasClass = 'pannellum-canvas';
    } else if (new.target === PanoramaxViewer) {
      this.canvasClass = 'psv-canvas';
    }
  }

  /**
   * Initializes the panorama viewer with the given canvas element and options.
   * @param {Element} _canvasElem
   * @param {object} _panoOptions - Object containing initialization options
   * @param {string} [_panoOptions.startPanoId] - Pano to start at; either this or startLatLng is required
   * @param {{lat: number, lng: number}} [_panoOptions.startLatLng] - Start loc; either this or startPanoId is required
   * @param {boolean} [_panoOptions.preloadNeighbors=false] - Pre-download panos linked to the current one, so that
   *     moving to them is fast. Only supported by Mapillary; other viewers ignore it.
   * @returns {Promise<void>}
   * @abstract
   */
  initialize(_canvasElem, _panoOptions = {}) {
    return Promise.reject(new Error('Subclasses must implement initialize()'));
  }

  /**
   * Factory method to create and initialize instances. Ex: `const viewer = await GsvViewer.create(canvasElem);`.
   * @param {Element} canvasElem
   * @param {object} panoOptions - Object containing initialization options
   * @param {string} [panoOptions.startPanoId] - Pano to start at; either this or startLatLng is required
   * @param {{lat: number, lng: number}} [panoOptions.startLatLng] - Start loc; either this or startPanoId is required
   * @returns {Promise<PanoViewer>}
   * @static
   */
  static async create(canvasElem, panoOptions = {}) {
    // Mapillary (and the Infra3d fork of it) style their render canvas `position: absolute` with no offsets, so
    // it sits at its *static position* — which an inherited `text-align: center` places at the middle of the
    // line box. Under a centering ancestor (mobile Validate's body/.tool-ui) that shifted the canvas right by
    // half the mount's width, leaving the left half blank (#4999). The mount hosts SDK-positioned chrome, never
    // flowed text, so pinning it left is safe for every provider and spares each page from knowing about this.
    canvasElem.style.textAlign = 'left';
    const newViewer = new this();
    newViewer.canvasElem = canvasElem;
    await newViewer.initialize(canvasElem, panoOptions);
    return newViewer;
  }

  /**
   * The live width:height aspect ratio of the element the pano renders in, for fov↔zoom conversion (#4852).
   *
   * Falls back to the fixed Explore-canvas ratio when the element has no measurable box yet (not laid out, or
   * `display: none` — e.g. the label-detail popup pano while hidden), which keeps the conversion stable until a
   * real measurement exists.
   *
   * Measures the mount container, which every call site can treat as the render canvas because they all pass
   * `disableDefaultUi: true`. A viewer showing in-container chrome (Infra3D's topbar/toolbar/cockpit) renders
   * into a shorter canvas than this, and would need to measure `canvasElem.querySelector('.' + canvasClass)`.
   *
   * @returns {number} The viewport aspect ratio, or util.EXPLORE_CANVAS_ASPECT_RATIO if it can't be measured.
   * @protected
   */
  _viewportAspect() {
    const rect = this.canvasElem?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? rect.width / rect.height : util.EXPLORE_CANVAS_ASPECT_RATIO;
  }

  /**
   * Moves to the first initial location with usable imagery: startPanoId if given, falling back to startLatLng
   * followed by each point in backupLatLngs. Called from subclasses' initialize() implementations.
   * @param {object} panoOptions - Object containing initialization options
   * @param {string} [panoOptions.startPanoId] - Pano to start at; tried before the lat/lngs
   * @param {{lat: number, lng: number}} [panoOptions.startLatLng] - Preferred starting location
   * @param {Array<{lat: number, lng: number}>} [panoOptions.backupLatLngs=[]] - Fallback locations, tried in order
   * @returns {Promise<void>} Rejects only when every given seed fails. The rejection is a NoImageryError only when
   *     every candidate location answered "nothing here"; if any failed for another reason, that error is rethrown
   *     as-is so callers can tell "this street is empty" from "we couldn't ask" (#4918)
   * @protected
   */
  async _moveToInitialLocation(panoOptions) {
    if (panoOptions.startPanoId) {
      try {
        await this.setPano(panoOptions.startPanoId);
        this.initialSeed = 'pano';
        return;
      } catch (err) {
        // A dead pano says nothing about the street (#4635), so fall through to the lat/lngs when we have them.
        if (!panoOptions.startLatLng) throw err;
      }
    }
    if (panoOptions.startLatLng) {
      const candidates = [panoOptions.startLatLng, ...(panoOptions.backupLatLngs ?? [])];
      const failures = [];
      for (const latLng of candidates) {
        try {
          await this.setLocation(latLng);
          this.initialSeed = 'latLng';
          return;
        } catch (err) {
          failures.push(err);
        }
      }
      // One candidate that failed for a non-imagery reason leaves the stretch of street it covered unknown, not
      // empty, so its error wins over the emptiness the other candidates found. Surfacing the first such failure
      // rather than the last keeps the root cause (e.g. the maps library never loaded) at the top of the chain.
      if (!NoImageryError.allNoImagery(failures)) {
        throw failures.find((err) => !(err instanceof NoImageryError));
      }
      throw new NoImageryError(
        `No imagery at any of the ${candidates.length} candidate points along the street.`,
        { cause: failures[failures.length - 1] },
      );
    }
  }

  /**
   * Gets the current viewer type.
   * @returns {string} The current viewer type.
   */
  getViewerType() {
    return this.viewerType;
  }

  /**
   * The provider's public-site link for viewing a pano — the one URL shape every surface that links out to the
   * provider shares (PanoInfoPopover's view-in-pano link, the label card's address link).
   * @param {string} _panoId - The pano/image ID to link to.
   * @param {object} [_opts]
   * @param {number} [_opts.heading] - Camera heading to open the viewer at (GSV).
   * @param {number} [_opts.pitch] - Camera pitch to open the viewer at (GSV).
   * @param {Array<number>} [_opts.center] - Normalized [x, y] view center to open the viewer at (Mapillary).
   * @returns {?{url: string, i18nKey: string}} The URL plus the i18n key naming the destination, or null for
   *     providers without a public viewer (e.g. Infra3d).
   */
  publicViewerLink(_panoId, _opts) {
    return null;
  }

  /**
   * Gets the CSS class for the canvas that shows the image. Used for taking screenshots.
   * @returns {string} The CSS class for the canvas that shows the image.
   */
  getCanvasClass() {
    return this.canvasClass;
  }

  /**
   * Gets the unique identifier of the current panorama.
   * @returns {string} The current panorama ID.
   * @abstract
   */
  getPanoId() {
    throw new Error('getPanoId() must be implemented by subclass');
  }

  /**
   * Gets the lat/lng location of the current panorama.
   * @returns {{lat: number, lng: number}} The current location with lat and lng properties.
   * @abstract
   */
  getPosition() {
    throw new Error('getPosition() must be implemented by subclass');
  }

  /**
   * Sets the panorama to the location closest to the specified lat/lng.
   * @param {{lat: number, lng: number}} _latLng - The desired location to move to.
   * @param {Set<PanoData>} [_excludedPanos=new Set()] - Set of PanoData objects that are not valid images to move to.
   * @returns {Promise<PanoData>} The panorama data object. Rejects if closest image is in excludedPanos or none found.
   * @abstract
   */
  setLocation(_latLng, _excludedPanos = new Set()) {
    return Promise.reject(new Error('setLocation(latLng, excludedPanos) must be implemented by subclass'));
  }

  /**
   * Prefetches images near a location to reduce latency on a subsequent setLocation() call.
   * No-op by default; override in subclasses that support prefetching.
   * @param {{lat: number, lng: number}} _latLng
   */
  prefetchLocation(_latLng) {}

  /**
   * Clears all prefetched image search results. Call when moving to a new street.
   * No-op by default; override in subclasses that support prefetching.
   */
  clearPrefetchCache() {}

  /**
   * Pre-downloads the pano that setLocation() would pick near the given location, so a subsequent move there
   * doesn't wait on the network. No-op by default; override in subclasses that support preloading.
   * @param {{lat: number, lng: number}} _latLng - The location the next move is expected to target.
   * @param {Set<PanoData>} [_excludedPanos] - Panos the next move is expected to exclude.
   * @returns {Promise<void>}
   */
  async preloadPanoNear(_latLng, _excludedPanos = new Set()) {}

  /**
   * Finds the pano that setLocation() would move to near a location, without moving. A metadata-only lookup for
   * callers that want to know where imagery is before the user goes there: Explore's forward crumbs on the minimap
   * (#4669), which mark the panos ahead on the street being audited even where the provider's link graph dead-ends.
   *
   * Runs the same provider search + scoring as setLocation() and honours the same exclusions, so the answer is the
   * pano a move to `latLng` would land on. Must not change what the viewer shows or any current/previous pano state,
   * and must not fire pano_changed. Providers that prefetch searches (prefetchLocation) answer from that cache when
   * one covers the point, so sampling a street that prefetchAlongStreet() already primed costs no network.
   *
   * @param {{lat: number, lng: number}} _latLng - The location to look near; the radius is setLocation()'s.
   * @param {Set<PanoData>} [_excludedPanos] - Panos that don't count (already visited, stuck), as in setLocation().
   * @returns {Promise<?{panoId: string, lat: number, lng: number}>} The pano's id and camera position, or null when
   *     the search completed and found nothing usable, the cases setLocation() rejects with NoImageryError. Rejects
   *     only when the provider couldn't be asked (network, SDK, timeout), so a caller can tell "empty" from
   *     "unknown" (#4918). The default resolves null: a provider with no location search (Pannellum) simply has no
   *     crumbs to offer.
   */
  findPanoNear(_latLng, _excludedPanos = new Set()) {
    return Promise.resolve(null);
  }

  /**
   * Budget for one findPanoNear() lookup, in ms. Generous, since a slow answer is still an answer; the point is that
   * a lookup which never settles can't hold up the sampler that issued it alongside dozens of others.
   * @type {number}
   */
  static FIND_PANO_TIMEOUT_MS = 10000;

  /**
   * Races a provider promise against a timeout so a lookup that never settles can't wedge a sampler. The underlying
   * request is left running (it may be a shared prefetch promise another caller is waiting on); only this caller
   * gives up. Underscore-prefixed rather than #private so subclasses can use it.
   * @template T
   * @param {Promise<T>} promise - The provider call.
   * @param {number} ms - How long to wait before giving up.
   * @param {string} what - Names the operation in the rejection message.
   * @returns {Promise<T>} Resolves/rejects with the promise, or rejects with a "Timed out" Error after `ms`.
   * @protected
   */
  static _withTimeout(promise, ms, what) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${what}`)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  /**
   * Downloads the provider's viewer code ahead of create(), so a viewer built later on a user action doesn't wait on
   * the network. Must not construct a viewer: for providers that bill per viewer instance (GSV), that is the whole
   * point of deferring create() (#5128). No-op by default; override in providers that load code on demand.
   * @returns {Promise<void>}
   */
  static async preloadLibrary() {}

  /**
   * Moves the current panorama to the specified panorama ID.
   * @param {string} _panoId - The panorama ID to set.
   * @returns {Promise<PanoData>} The panorama data object.
   * @abstract
   */
  setPano(_panoId) {
    return Promise.reject(new Error('setPano(panoId) must be implemented by subclass'));
  }

  /**
   * Gets the panos that are linked to the current one, to be used with navigation arrows.
   * @returns {Promise<Array<{panoId: string, heading: number}>>}
   * @abstract
   */
  getLinkedPanos() {
    throw new Error('getLinkedPanos() must be implemented by subclass');
  }

  /**
   * Gets the current point of view (POV) of the panorama.
   * @returns {{heading: number, pitch: number, zoom: number}} The current POV.
   * @abstract
   */
  getPov() {
    throw new Error('getPov() must be implemented by subclass');
  }

  /**
   * Sets the camera view to the specified heading, pitch, and zoom.
   *
   * @param {object} _pov - Object containing the desired heading, pitch, and zoom
   * @param {number} _pov.heading - Desired heading in degrees (0-360, where 0 is true north)
   * @param {number} _pov.pitch - Desired pitch in degrees (-90 to 90, where 0 is horizontal)
   * @param {number} _pov.zoom - Desired zoom (1, 2, or 3)
   * @returns {void}
   * @abstract
   */
  setPov(_pov) {
    throw new Error('setPov() must be implemented by subclass');
  }

  /**
   * Hides the navigation arrows in the panorama viewer.
   * @returns {void}
   * @abstract
   */
  hideNavigationArrows() {
    throw new Error('hideNavigationArrows() must be implemented by subclass');
  }

  /**
   * Shows the navigation arrows in the panorama viewer.
   * @returns {void}
   * @abstract
   */
  showNavigationArrows() {
    throw new Error('showNavigationArrows() must be implemented by subclass');
  }

  /**
   * Notifies the viewer that its container has been resized. Call this after any layout change that affects the
   * container's dimensions so the viewer can re-measure and re-render at the correct size.
   * No-op by default; override in subclasses that support a resize API.
   * @returns {void}
   */
  resize() {}

  /**
   * Adds an event listener for the specified event type.
   * @param {string} event - One of ['pano_changed', 'pov_changed']
   * @param {Function} handler - The function to call when the event occurs.
   * @returns {void}
   */
  addListener(event, handler) {
    if (event === 'pano_changed') {
      this.panoChangedListeners.push(handler);
    } else if (event === 'pov_changed') {
      this.povChangedListeners.push(handler);
    }
  }

  /**
   * Removes an event listener for the specified event type.
   * @param {string} event - One of ['pano_changed', 'pov_changed']
   * @param {Function} handler - The function to call when the event occurs.
   * @returns {void}
   */
  removeListener(event, handler) {
    if (event === 'pano_changed') {
      this.panoChangedListeners = this.panoChangedListeners.filter((func) => func !== handler);
    } else if (event === 'pov_changed') {
      this.povChangedListeners = this.povChangedListeners.filter((func) => func !== handler);
    }
  }
}
