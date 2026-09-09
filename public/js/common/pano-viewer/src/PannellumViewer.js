/**
 * Pannellum implementation of the panorama viewer. Used to display self-hosted equirectangular panoramas served from
 * the /backupImage/:panoId route, typically as a fallback for panos that have expired from their original source
 * (GSV/Mapillary) but were captured during a prior audit.
 *
 * Docs: https://pannellum.org/documentation/api/
 *
 * Unlike GsvViewer/MapillaryViewer, this viewer cannot search by lat/lng or follow pano links. Callers that need to
 * switch panos must call loadPano() with the new pano's metadata, since this viewer has no external API to fetch it
 * from. Callers supply full pano metadata via panoOptions.panoMetadata on initialize().
 *
 * Internally, the viewer is initialized in Pannellum's tour mode (default + scenes config) so that loadPano() can
 * swap panos via addScene()/loadScene() without destroying and recreating the WebGL context.
 */
/**
 * The widest equirectangular panorama this device can actually render, or null if that can't be determined.
 *
 * Pannellum uploads an equirect as two halves, so its own refusal test is `max(width / 2, height) > MAX_TEXTURE_SIZE`
 * — twice the texture limit, which is why a device advertising 8192 renders a 16384-wide pano and most hardware needs
 * no downscaled copy at all. Asking the GPU is the only honest answer here; guessing a fixed cap server-side either
 * downscales for devices that never needed it or fails on the ones that did.
 *
 * Cached because it costs a throwaway WebGL context, and released immediately so it doesn't count against the
 * browser's small per-page context budget.
 *
 * @returns {?number} Maximum renderable panorama width in pixels, or null when WebGL is unavailable.
 */
let cachedMaxPanoWidth;
const deviceMaxPanoWidth = () => {
  if (cachedMaxPanoWidth !== undefined) return cachedMaxPanoWidth;
  cachedMaxPanoWidth = null;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      cachedMaxPanoWidth = 2 * gl.getParameter(gl.MAX_TEXTURE_SIZE);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // A blocked or unavailable context tells us nothing; fall through to the native image and let Pannellum decide.
  }
  return cachedMaxPanoWidth;
};

/**
 * The URL to hand Pannellum for a panorama, asking the server for a smaller copy only when this device can't texture
 * the stored one (#5256). Every device that can render it as stored gets it untouched.
 *
 * @param {object} metadata Pano metadata; uses `imageUrl` and `width`.
 * @returns {string} The image URL, with `maxWidth` appended when a copy is needed.
 */
const panoramaUrlFor = (metadata) => {
  const cap = deviceMaxPanoWidth();
  if (!cap || !metadata.width || metadata.width <= cap) return metadata.imageUrl;
  return withMaxWidth(metadata.imageUrl, cap);
};

/** @returns {string} `url` with a maxWidth the server will honour. */
const withMaxWidth = (url, width) => `${url}${url.includes('?') ? '&' : '?'}maxWidth=${width}`;

/** The narrowest copy worth asking for; below this the server's allowlist snaps up anyway. */
const MIN_FALLBACK_WIDTH = 2048;

/**
 * The URLs to try for a panorama, widest first.
 *
 * The first is what the GPU's advertised limit calls for, and on nearly all hardware it is the only one used. The
 * rest exist because that limit is a promise about dimensions, not about memory: a device can report a size it
 * cannot actually allocate — 16384 x 8192 is two 8192-square textures, half a gigabyte of RGBA — and a phone under
 * memory pressure fails a load its own `MAX_TEXTURE_SIZE` said would work. Nothing readable from the page predicts
 * that, so the fallback is to be told by the failure and ask for half as much.
 *
 * @param {object} metadata Pano metadata; uses `imageUrl` and `width`.
 * @returns {string[]} Candidate URLs, in the order they should be tried.
 */
const panoramaUrlCandidates = (metadata) => {
  const urls = [panoramaUrlFor(metadata)];
  const cap = deviceMaxPanoWidth();
  const start = cap || metadata.width || 0;
  // Two retries: a device that can't hold a quarter of what it advertised is not going to be rescued by an eighth.
  for (let w = Math.floor(start / 2); w >= MIN_FALLBACK_WIDTH && urls.length < 3; w = Math.floor(w / 2)) {
    urls.push(withMaxWidth(metadata.imageUrl, w));
  }
  return urls;
};

class PannellumViewer extends PanoViewer {
  /** The `pano_data.source` value, so code outside the viewer can name this source without holding the class. */
  static SOURCE = 'pannellum';

  /** @type {object} The underlying pannellum viewer instance. */
  #viewer = undefined;

  /** @type {number} Cached cameraHeading for the current pano (degrees, wrt true north). */
  #cameraHeading = 0;

  /** @type {string|undefined} Scene ID currently loaded in the Pannellum viewer. */
  #currentSceneId = undefined;

  /**
   * True while a scene transition is in progress. The rAF POV-tracking loop skips ticks while loading to avoid
   * firing pov_changed with mid-transition values under the wrong camera calibration.
   * @type {boolean}
   */
  #loading = false;

  #lastYaw = NaN;
  #lastPitch = NaN;
  #lastHfov = NaN;

  constructor() {
    super();
    this.canvasClass = 'pannellum-canvas';
    this.currPanoData = undefined;
  }

  /**
   * @param {Element} canvasElem Container element to mount the viewer into.
   * @param {object} panoOptions
   * @param {string} [panoOptions.startPanoId] The pano ID to load. Falls back to panoMetadata.panoId.
   * @param {object} panoOptions.panoMetadata Required. Metadata for the pano (see PanoData fields).
   * @param {number} [panoOptions.startHeading] Initial heading wrt true north; defaults to cameraHeading.
   * @param {number} [panoOptions.startPitch=0] Initial pitch in degrees.
   * @param {number} [panoOptions.startZoom=1] Initial zoom level (1, 2, or 3).
   * @param {boolean} [panoOptions.zoomControl=true] Whether mouse-wheel zoom is enabled.
   * @returns {Promise<void>}
   */
  async initialize(canvasElem, panoOptions = {}) {
    const metadata = panoOptions.panoMetadata;
    if (!metadata) throw new Error('PannellumViewer requires panoOptions.panoMetadata');

    const panoId = panoOptions.startPanoId || metadata.panoId;
    if (!panoId) throw new Error('PannellumViewer requires startPanoId or panoMetadata.panoId');

    this.#cameraHeading = metadata.cameraHeading || 0;
    this.currPanoData = this.#buildPanoData(panoId, metadata);
    this.#currentSceneId = panoId;

    const startHeading = panoOptions.startHeading ?? this.#cameraHeading;
    const startPitch = panoOptions.startPitch ?? 0;
    const startZoom = panoOptions.startZoom ?? 1;
    const zoomControl = 'zoomControl' in panoOptions ? panoOptions.zoomControl : true;

    // Tour-mode config (default + scenes). Required for addScene()/loadScene() — Pannellum only maintains the
    // scenes map in tour mode, so switching panos w/out recreating the viewer isn't possible in single-pano mode.
    const pannellumConfig = {
      default: {
        firstScene: panoId,
        autoLoad: true,
        showControls: false,
        showZoomCtrl: false,
        showFullscreenCtrl: false,
        compass: false,
        keyboardZoom: false,
        mouseZoom: zoomControl,
        friction: 1,
        touchPanSpeedCoeffFactor: 0.4,
        minHfov: util.pano.zoomToFov(3), // zoom 3 → smallest HFOV (most zoomed in)
        maxHfov: util.pano.zoomToFov(1), // zoom 1 → largest HFOV
      },
      scenes: {
        [panoId]: {
          type: 'equirectangular',
          panorama: panoramaUrlFor(metadata),
          haov: 360,
          vaov: 180,
          yaw: this.#headingToYaw(startHeading),
          pitch: startPitch,
          hfov: util.pano.zoomToFov(startZoom),
          northOffset: this.#cameraHeading, // Only used by Pannellum's compass UI, which we keep hidden.
        },
      },
    };

    const candidates = panoramaUrlCandidates(metadata);
    for (let attempt = 0; attempt < candidates.length; attempt++) {
      pannellumConfig.scenes[panoId].panorama = candidates[attempt];
      try {
        await new Promise((resolve, reject) => {
          this.#viewer = pannellum.viewer(canvasElem, pannellumConfig);
          const onLoad = () => {
            this.#viewer.off('load', onLoad);
            this.#viewer.off('error', onError);
            resolve();
          };
          const onError = (err) => {
            this.#viewer.off('load', onLoad);
            this.#viewer.off('error', onError);
            reject(new Error(err || 'Pannellum failed to load image'));
          };
          this.#viewer.on('load', onLoad);
          this.#viewer.on('error', onError);
        });
        break;
      } catch (e) {
        // The viewer holds a WebGL context and a half-built scene either way, so it goes before the next attempt.
        try {
          this.#viewer?.destroy();
        } catch {
          // Already torn down by the failure itself; nothing left to release.
        }
        this.#viewer = null;
        if (attempt === candidates.length - 1) throw e;
        console.warn(`Pano ${panoId} failed to load; retrying at a smaller size.`, e);
      }
    }

    // Tag the rendered canvas so the screenshot helper (Canvas.js) can find it via getCanvasClass().
    const renderedCanvas = canvasElem.querySelector('.pnlm-render-container canvas');
    if (renderedCanvas) renderedCanvas.classList.add(this.canvasClass);

    // Suppress arrow keys / spacebar at the window level (matches GsvViewer/Infra3dViewer behavior).
    const preventShortcuts = (e) => {
      if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'].indexOf(e.code) > -1) {
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', preventShortcuts, { capture: true });

    // Pannellum does not emit a "view changed" event, so we poll yaw/pitch/hfov each frame and fire pov_changed
    // when any of them change. The cost is one cheap comparison per frame.
    this.#startPovTracking();

    for (const listener of this.panoChangedListeners) await listener();
  };

  /**
   * Loads a new panorama into the existing viewer, reusing the WebGL context rather than  recreating the viewer.
   *
   * @param {string} panoId
   * @param {object} metadata Metadata for the new pano (same shape as panoOptions.panoMetadata in initialize()).
   * @param {{heading: number, pitch: number, zoom: number}} pov Initial POV for the new pano.
   * @returns {Promise<PanoData>}
   */
  loadPano = async (panoId, metadata, pov) => {
    const oldSceneId = this.#currentSceneId;

    if (panoId === oldSceneId) {
      // Same pano — update calibration (e.g. if metadata was re-fetched) and reposition.
      this.#cameraHeading = metadata.cameraHeading || 0;
      this.currPanoData = this.#buildPanoData(panoId, metadata);
      this.setPov(pov);
      for (const listener of this.panoChangedListeners) await listener();
      return this.currPanoData;
    }

    // Compute Pannellum-space pitch/yaw/hfov using the new pano's calibration, before updating the instance fields
    // (which #headingToYaw and #yawToHeading read from). The instance fields are updated after the load resolves so
    // the rAF loop doesn't emit pov_changed with a mismatched cameraHeading during the transition.
    const newCameraHeading = metadata.cameraHeading || 0;
    const pitch = pov.pitch ?? 0;
    const yaw = this.#headingToYaw(pov.heading ?? newCameraHeading, newCameraHeading);
    const hfov = util.pano.zoomToFov(pov.zoom ?? 1);

    // Pause the rAF POV-tracking loop for the duration of the transition to avoid emitting pov_changed events
    // with values that mix the old scene's calibration with the new scene's yaw/pitch.
    this.#loading = true;
    try {
      const candidates = panoramaUrlCandidates(metadata);
      for (let attempt = 0; attempt < candidates.length; attempt++) {
        this.#viewer.addScene(panoId, {
          type: 'equirectangular',
          panorama: candidates[attempt],
          haov: 360,
          vaov: 180,
          northOffset: newCameraHeading,
        });
        try {
          await new Promise((resolve, reject) => {
            const onLoad = () => {
              this.#viewer.off('load', onLoad);
              this.#viewer.off('error', onError);
              resolve();
            };
            const onError = (err) => {
              this.#viewer.off('load', onLoad);
              this.#viewer.off('error', onError);
              reject(new Error(err || 'Pannellum failed to load scene'));
            };
            this.#viewer.on('load', onLoad);
            this.#viewer.on('error', onError);
            this.#viewer.loadScene(panoId, pitch, yaw, hfov);
          });
          break;
        } catch (e) {
          // The failed scene keeps its URL, so it has to go before the same id can be added at a smaller size.
          try {
            this.#viewer.removeScene(panoId);
          } catch {
            // Pannellum throws when the scene isn't there, which is fine -- we only wanted it gone.
          }
          if (attempt === candidates.length - 1) throw e;
          console.warn(`Pano ${panoId} failed to load; retrying at a smaller size.`, e);
        }
      }
    } finally {
      this.#loading = false;
    }

    // Update instance calibration only after the new scene is fully loaded so getPov()/setPov() are consistent.
    this.#cameraHeading = newCameraHeading;
    this.currPanoData = this.#buildPanoData(panoId, metadata);
    this.#currentSceneId = panoId;

    if (oldSceneId) {
      try {
        this.#viewer.removeScene(oldSceneId);
      } catch {
        // Pannellum throws if the scene doesn't exist; safe to ignore since we only wanted it gone anyway.
      }
    }

    for (const listener of this.panoChangedListeners) await listener();
    return this.currPanoData;
  };

  /**
   * Builds a PanoData object from a metadata blob supplied by the caller.
   * @param {string} panoId
   * @param {object} metadata Fields matching PanoData's constructor params.
   * @returns {PanoData}
   */
  #buildPanoData(panoId, metadata) {
    return new PanoData({
      panoId,
      source: this.getViewerType(),
      captureDate: metadata.captureDate instanceof moment
        ? metadata.captureDate
        : moment(metadata.captureDate || Date.now()),
      width: metadata.width,
      height: metadata.height,
      tileWidth: metadata.tileWidth || metadata.width,
      tileHeight: metadata.tileHeight || metadata.height,
      lat: metadata.lat,
      lng: metadata.lng,
      cameraHeading: metadata.cameraHeading,
      cameraPitch: metadata.cameraPitch ?? undefined,
      cameraRoll: metadata.cameraRoll ?? undefined,
      address: metadata.address,
      copyright: metadata.copyright,
      linkedPanos: [],
      history: metadata.history || [],
    });
  }

  /**
   * Converts a heading (0 = true north, clockwise) to Pannellum's yaw (0 = image center, range [-180, 180]).
   * @param {number} heading
   * @param {number} [cameraHeading] Defaults to the current scene's cameraHeading. Pass explicitly when computing
   *     yaw for a scene that hasn't been loaded yet (e.g. inside loadPano() before calibration fields are updated).
   * @returns {number}
   */
  #headingToYaw = (heading, cameraHeading = this.#cameraHeading) => {
    return ((heading - cameraHeading + 540) % 360) - 180;
  };

  /**
   * Inverse of #headingToYaw — converts Pannellum yaw to a true-north heading in [0, 360).
   * @param {number} yaw
   * @returns {number}
   */
  #yawToHeading = (yaw) => {
    return (this.#cameraHeading + yaw + 360) % 360;
  };

  /**
   * Begins a requestAnimationFrame loop that fires pov_changed listeners whenever yaw, pitch, or hfov change.
   */
  #startPovTracking = () => {
    const tick = async () => {
      if (!this.#viewer) return;
      if (!this.#loading) {
        const yaw = this.#viewer.getYaw();
        const pitch = this.#viewer.getPitch();
        const hfov = this.#viewer.getHfov();
        if (yaw !== this.#lastYaw || pitch !== this.#lastPitch || hfov !== this.#lastHfov) {
          this.#lastYaw = yaw;
          this.#lastPitch = pitch;
          this.#lastHfov = hfov;
          for (const listener of this.povChangedListeners) await listener();
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  getPanoId = () => {
    return this.currPanoData.getPanoId();
  };

  getPosition = () => {
    return { lat: this.currPanoData.getProperty('lat'), lng: this.currPanoData.getProperty('lng') };
  };

  /**
   * Not supported — PannellumViewer cannot search by lat/lng; rejects unconditionally.
   */
  setLocation = () => {
    return Promise.reject(
      new Error('PannellumViewer does not support setLocation(); reinitialize with new panoMetadata instead.'),
    );
  };

  /**
   * No-op if panoId matches the currently loaded pano; rejects otherwise. To switch panos, call loadPano() with
   * the new pano's metadata — the PanoViewer.setPano() interface does not carry metadata.
   * @param {string} panoId
   * @returns {Promise<PanoData>}
   */
  setPano = (panoId) => {
    if (panoId === this.currPanoData.getPanoId()) {
      return Promise.resolve(this.currPanoData);
    }
    return Promise.reject(
      new Error('PannellumViewer.setPano() only accepts the current pano ID; call loadPano() to switch panos.'),
    );
  };

  getLinkedPanos = () => {
    return this.currPanoData.getProperty('linkedPanos');
  };

  // Heading is calibrated against cameraHeading but pitch is not, and the asymmetry is real: a pano's column 0
  // sits at an arbitrary bearing, so yaw needs a reference, while row panoHeight/2 is the horizon by construction.
  // povToPanoCoord, calculatePovFromPanoXY and CropGeometry all agree on that, and the stored images really are
  // gravity-aligned — a label's pano_x/pano_y reads back onto the labelled feature. Subtracting cameraPitch here
  // displaced the label marker by that angle, nonzero on ~98% of panos (#5174).
  getPov = () => {
    return {
      heading: this.#yawToHeading(this.#viewer.getYaw()),
      pitch: this.#viewer.getPitch(),
      zoom: util.pano.fovToZoom(this.#viewer.getHfov()),
    };
  };

  setPov = (pov) => {
    // Second arg `false` disables Pannellum's animation; we want the change to apply immediately.
    this.#viewer.setYaw(this.#headingToYaw(pov.heading), false);
    this.#viewer.setPitch(pov.pitch, false);
    if (pov.zoom !== null && pov.zoom !== undefined) {
      this.#viewer.setHfov(util.pano.zoomToFov(pov.zoom), false);
    }
  };

  // No navigation arrows in this viewer — linked panos are not available for self-hosted images.
  hideNavigationArrows = () => {};
  showNavigationArrows = () => {};

  resize = () => {
    if (this.#viewer) this.#viewer.resize();
  };
}
