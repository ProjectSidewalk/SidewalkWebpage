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
   * Private constructor to prevent direct instantiation.
   */
  constructor() {
    if (new.target === PanoViewer) {
      throw new Error('Cannot instantiate abstract class directly');
    } else if (new.target === GsvViewer) {
      this.viewerType = 'gsv';
      this.canvasClass = 'widget-scene-canvas';
    } else if (new.target === MapillaryViewer) {
      this.viewerType = 'mapillary';
      this.canvasClass = 'mapillary-canvas';
    } else if (new.target === Infra3dViewer) {
      this.viewerType = 'infra3d';
      this.canvasClass = 'infra3dsdk-canvas';
    } else if (new.target === PannellumViewer) {
      this.viewerType = 'pannellum';
      this.canvasClass = 'pannellum-canvas';
    }
  }

  /**
   * Initializes the panorama viewer with the given canvas element and options.
   * @param {Element} canvasElem
   * @param {object} panoOptions Object containing initialization options
   * @param {string} [panoOptions.startPanoId] Pano to start at; either this or startLatLng is required
   * @param {{lat: number, lng: number}} [panoOptions.startLatLng] Starting loc; either this or startLatLng is required
   * @returns {Promise<void>}
   */
  initialize(_canvasElem, _panoOptions = {}) {
    return Promise.reject(new Error('Subclasses must implement initialize()'));
  }

  /**
   * Factory method to create and initialize instances. Ex: `const viewer = await GsvViewer.create(canvasElem);`.
   * @param {Element} canvasElem
   * @param {object} panoOptions Object containing initialization options
   * @param {string} [panoOptions.startPanoId] Pano to start at; either this or startLatLng is required
   * @param {{lat: number, lng: number}} [panoOptions.startLatLng] Starting loc; either this or startLatLng is required
   * @returns {Promise<PanoViewer>}
   * @static
   */
  static async create(canvasElem, panoOptions = {}) {
    const newViewer = new this();
    await newViewer.initialize(canvasElem, panoOptions);
    return newViewer;
  }

  /**
   * Moves to the first initial location with usable imagery: startPanoId if given, falling back to startLatLng
   * followed by each point in backupLatLngs. Called from subclasses' initialize() implementations.
   * @param {object} panoOptions Object containing initialization options
   * @param {string} [panoOptions.startPanoId] Pano to start at; tried before the lat/lngs
   * @param {{lat: number, lng: number}} [panoOptions.startLatLng] Preferred starting location
   * @param {Array<{lat: number, lng: number}>} [panoOptions.backupLatLngs=[]] Fallback locations, tried in order
   * @returns {Promise<void>} Rejects only when every given seed fails: with the last setLocation() error when
   *     locations were given, otherwise with the setPano() error
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
      let lastError;
      for (const latLng of candidates) {
        try {
          await this.setLocation(latLng);
          this.initialSeed = 'latLng';
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
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
   * @param {string} panoId - The pano/image ID to link to.
   * @param {Object} [opts]
   * @param {number} [opts.heading] - Camera heading to open the viewer at (GSV).
   * @param {number} [opts.pitch] - Camera pitch to open the viewer at (GSV).
   * @param {Array<number>} [opts.center] - Normalized [x, y] view center to open the viewer at (Mapillary).
   * @returns {?{url: string, i18nKey: string}} The URL plus the i18n key naming the destination, or null for
   *     providers without a public viewer (e.g. Infra3d).
   */
  publicViewerLink() {
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
   */
  getPanoId() {
    throw new Error('getPanoId() must be implemented by subclass');
  }

  /**
   * Gets the lat/lng location of the current panorama.
   * @returns {{lat: number, lng: number}} The current location with lat and lng properties.
   */
  getPosition() {
    throw new Error('getPov() must be implemented by subclass');
  }

  /**
   * Sets the panorama to the location closest to the specified lat/lng.
   * @param {{lat: number, lng: number}} latLng The desired location to move to.
   * @param {Set<PanoData>} [excludedPanos=new Set()] Set of PanoData objects that are not valid images to move to.
   * @returns {Promise<PanoData>} The panorama data object. Rejects if closest image is in excludedPanos or none found.
   */
  setLocation(_latLng, _excludedPanos = new Set()) {
    return Promise.reject(new Error('setLocation(latLng, excludedPanos) must be implemented by subclass'));
  }

  /**
   * Prefetches images near a location to reduce latency on a subsequent setLocation() call.
   * No-op by default; override in subclasses that support prefetching.
   * @param {{lat: number, lng: number}} latLng
   */
  prefetchLocation(_latLng) {}

  /**
   * Clears all prefetched image search results. Call when moving to a new street.
   * No-op by default; override in subclasses that support prefetching.
   */
  clearPrefetchCache() {}

  /**
   * Moves the current panorama to the specified panorama ID.
   * @param panoId The panorama ID to set.
   * @returns {Promise<PanoData>} The panorama data object.
   */
  setPano(_panoId) {
    return Promise.reject(new Error('setPano(panoId) must be implemented by subclass'));
  }

  /**
   * Gets the panos that are linked to the current one, to be used with navigation arrows.
   * @returns {Promise<Array<{panoId: string, heading: number}>>}
   */
  getLinkedPanos() {
    throw new Error('getLinkedPanos() must be implemented by subclass');
  }

  /**
   * Gets the current point of view (POV) of the panorama.
   * @returns {{heading: number, pitch: number, zoom: number}} The current POV.
   */
  getPov() {
    throw new Error('getPov() must be implemented by subclass');
  }

  /**
   * Sets the camera view to the specified heading, pitch, and zoom.
   *
   * @param {object} pov - Object containing the desired heading, pitch, and zoom
   * @param {number} pov.heading - Desired heading in degrees (0-360, where 0 is true north)
   * @param {number} pov.pitch - Desired pitch in degrees (-90 to 90, where 0 is horizontal)
   * @param {number} pov.zoom - Desired zoom (1, 2, or 3)
   * @returns {void}
   */
  setPov(_pov) {
    throw new Error('setPov() must be implemented by subclass');
  }

  /**
   * Hides the navigation arrows in the panorama viewer.
   * @returns {void}
   */
  hideNavigationArrows() {
    throw new Error('hideNavigationArrows() must be implemented by subclass');
  }

  /**
   * Shows the navigation arrows in the panorama viewer.
   * @returns {void}
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
   * @param event One of ['pano_changed', 'pov_changed']
   * @param handler The function to call when the event occurs.
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
   * @param {string} event One of ['pano_changed', 'pov_changed']
   * @param {function} handler The function to call when the event occurs.
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
