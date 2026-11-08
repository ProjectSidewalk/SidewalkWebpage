/**
 * Pannellum implementation of the panorama viewer. Used to display self-hosted equirectangular panoramas served from
 * the /backupImage/:panoId route, typically as a fallback for panos that have expired from their original source
 * (GSV/Mapillary) but were captured during a prior audit.
 *
 * Docs: https://pannellum.org/documentation/api/
 *
 * Unlike GsvViewer/MapillaryViewer, this viewer cannot search by lat/lng or follow pano links, so findPanoNear()
 * keeps the base class's null answer and Explore draws no forward crumbs on it. Callers that need to switch panos
 * must call loadPano() with the new pano's metadata, since this viewer has no external API to fetch it from. Callers
 * supply full pano metadata via panoOptions.panoMetadata on initialize().
 *
 * Internally, the viewer is initialized in Pannellum's tour mode (default + scenes config) so that loadPano() can
 * swap panos via addScene()/loadScene() without destroying and recreating the WebGL context. The exception is a pano
 * that fails to load at every size: that tears the Pannellum instance down, and the next loadPano() builds a fresh
 * one, so a context the browser has lost (#5939) is replaced rather than retried.
 */

import { PanoData } from './PanoData.js';
import { PanoViewer } from './PanoViewer.js';
import { util } from '../utilities.js';
import './panoUtilities.js';
/** @typedef {import('./PanoImageCache.js').PanoImageCache} PanoImageCache */

/** Pannellum, from sdk/pannellum.js, once preloadLibrary() has fetched it. */
let sdk;

/**
 * A load that failed because the WebGL context under Pannellum is lost or could not be had (#5939), as opposed to
 * a pano that would not load at that size. Nothing renders in the instance that raised it.
 */
class PanoContextLostError extends Error {
  /**
   * @param {string} panoId - The pano that was loading.
   * @param {Error} cause - What Pannellum reported.
   */
  constructor(panoId, cause) {
    super(`WebGL context lost or unavailable while loading pano ${panoId}`, { cause });
    this.name = 'PanoContextLostError';
  }
}

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
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) {
      cachedMaxPanoWidth = null;
    } else if (!gl.isContextLost()) {
      cachedMaxPanoWidth = 2 * gl.getParameter(gl.MAX_TEXTURE_SIZE);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    // A context handed out already lost, which a GPU reset leaves behind for a while, reads every parameter as null
    // and says nothing about the device. It is left uncached, so the next load asks again once the GPU is back
    // (#5939); until then there is no cap, the same answer as no WebGL at all.
  } catch {
    // A blocked or unavailable context tells us nothing; fall through to the native image and let Pannellum decide.
    cachedMaxPanoWidth = null;
  }
  return cachedMaxPanoWidth ?? null;
};

/**
 * The widest panorama a phone is handed, whatever its GPU advertises (#5561).
 *
 * `deviceMaxPanoWidth` answers "can it be textured", and on an iPhone that answer is 32768: the GPU advertises 16384,
 * so the native 16384 x 8192 file is served untouched. What the answer leaves out is everything else the load costs.
 * The decoded bitmap is ~512 MB of RGBA, on top of the two 8192-square textures Pannellum cuts it into (another
 * ~512 MB), and on a phone that is the per-process ceiling: iOS kills the tab and reloads it, mid-mission. Nothing in
 * the page sees that happen (no `error`, no `webglcontextlost`), so the #5256 ladder below, which only steps down on
 * a failure it is told about, can never rescue it. 8192 is the largest `PanoDisplayCopyService.AllowedWidths` member,
 * cuts the peak to about a quarter, and is already ~2x a phone's device pixels at zoom 1; only max zoom reads a
 * little softer than the native file would.
 */
const MOBILE_MAX_PANO_WIDTH = 8192;

/**
 * The cap that applies on this device: the GPU's, lowered to MOBILE_MAX_PANO_WIDTH on a phone.
 * @returns {?number} Maximum panorama width in pixels, or null when nothing bounds it.
 */
const effectiveMaxPanoWidth = () => {
  const gpuCap = deviceMaxPanoWidth();
  if (!util.isMobile()) return gpuCap;
  return gpuCap ? Math.min(gpuCap, MOBILE_MAX_PANO_WIDTH) : MOBILE_MAX_PANO_WIDTH;
};

/**
 * The URL to hand Pannellum for a panorama, asking the server for a smaller copy only when this device can't texture
 * the stored one (#5256), or is a phone that shouldn't hold it (#5561). Every other device gets it untouched.
 *
 * @param {Record<string, any>} metadata - Pano metadata; uses `image_url` and `width`.
 * @param {?number} [cap] - The device's cap, when the caller has read it already. While the GPU is down every
 *     reading costs a WebGL context the browser may count against its per-page budget, so a load reads it once.
 * @returns {string} The image URL, with `maxWidth` appended when a copy is needed.
 */
export const panoramaUrlFor = (metadata, cap = effectiveMaxPanoWidth()) => {
  if (!cap || !metadata.width || metadata.width <= cap) return metadata.image_url;
  return panoUrlWithMaxWidth(metadata.image_url, cap);
};

/** @returns {string} `url` with a maxWidth the server will honour. */
const panoUrlWithMaxWidth = (url, width) => `${url}${url.includes('?') ? '&' : '?'}maxWidth=${width}`;

/** The narrowest copy worth asking for; below this the server's allowlist snaps up anyway. */
const PANO_MIN_FALLBACK_WIDTH = 2048;

/**
 * The URLs to try for a panorama, widest first.
 *
 * The first is what the GPU's advertised limit calls for, and on nearly all hardware it is the only one used. The
 * rest exist because that limit is a promise about dimensions, not about memory: a device can report a size it
 * cannot actually allocate — 16384 x 8192 is two 8192-square textures, half a gigabyte of RGBA — and a phone under
 * memory pressure fails a load its own `MAX_TEXTURE_SIZE` said would work. Nothing readable from the page predicts
 * that, so the fallback is to be told by the failure and ask for half as much.
 *
 * The ladder steps down from the width the first candidate is actually served at, which is the pano's own width
 * whenever that is under the cap. Stepping down from the cap instead spends rungs on widths at or above the pano,
 * and the server answers those with the native file — so the "retry" re-fetches, re-decodes and re-uploads the
 * image that just failed, making the next allocation likelier to fail rather than less.
 *
 * @param {Record<string, any>} metadata - Pano metadata; uses `image_url` and `width`.
 * @returns {string[]} Candidate URLs, in the order they should be tried.
 */
export const panoramaUrlCandidates = (metadata) => {
  const cap = effectiveMaxPanoWidth();
  const urls = [panoramaUrlFor(metadata, cap)];
  const start = Math.min(cap || Infinity, metadata.width || Infinity);
  // With neither a cap nor a width there is nothing to step down from, and a guess would ask for a width the
  // allowlist would only snap back up.
  if (!Number.isFinite(start)) return urls;
  // Two retries: a device that can't hold a quarter of what it advertised is not going to be rescued by an eighth.
  for (let w = Math.floor(start / 2); w >= PANO_MIN_FALLBACK_WIDTH && urls.length < 3; w = Math.floor(w / 2)) {
    urls.push(panoUrlWithMaxWidth(metadata.image_url, w));
  }
  return urls;
};

export class PannellumViewer extends PanoViewer {
  /** The `pano_data.source` value, so code outside the viewer can name this source without holding the class. */
  static SOURCE = 'pannellum';
  /** The class the provider's library puts on the canvas it draws into. */
  static CANVAS_CLASS = 'pannellum-canvas';

  /**
   * How long a load waits for a prefetch of the same image that is still downloading, in milliseconds. Long enough
   * to cover a backup pano on cellular; a prefetch stalled past this is abandoned in favour of a fresh request.
   */
  static PREFETCH_WAIT_MS = 10000;

  /** @type {any} The underlying pannellum viewer instance; null between a failed load and the next one. */
  #viewer = undefined;

  /** @type {HTMLElement} Where Pannellum draws; kept so a fresh instance can be built in it after a failed load. */
  #mount;

  /** @type {boolean} Whether mouse-wheel zoom is enabled, for every Pannellum instance this viewer builds. */
  #zoomControl = true;

  /** @type {?{heading: number, pitch: number, zoom: number}} What getPov() answers while there is no instance. */
  #parkedPov = null;

  /** @type {Promise<unknown>} The load in progress, settled, which the next load waits for; see loadPano(). */
  #loads = Promise.resolve();

  /** @type {number} Cached cameraHeading for the current pano (degrees, wrt true north). */
  #cameraHeading = 0;

  /** @type {string|undefined} Scene ID currently loaded in the Pannellum viewer. */
  #currentSceneId = undefined;

  /**
   * How many loads are queued or in progress. The rAF POV-tracking loop skips ticks while any is, to avoid firing
   * pov_changed with mid-transition values under the wrong camera calibration; counted from the call rather than
   * from the load's turn in the queue, so the pause covers the wait as well.
   * @type {number}
   */
  #loadsInFlight = 0;

  #lastYaw = NaN;
  #lastPitch = NaN;
  #lastHfov = NaN;

  /** @type {?PanoImageCache} Where a pano's bytes may already be waiting, when the page prefetches (#5562). */
  #imageCache = null;

  /**
   * Whether the last load's first attempt came out of the image cache rather than the network. Null until a load
   * has run with a cache attached, so a page without one reads as "not applicable" rather than as a miss.
   * @type {?boolean}
   */
  lastLoadPrefetched = null;

  constructor() {
    super();
    this.canvasClass = 'pannellum-canvas';
    this.currPanoData = undefined;
  }

  /**
   * See PanoViewer.preloadLibrary(); the chunk is sdk/pannellum.js.
   * @returns {Promise<void>}
   */
  static async preloadLibrary() {
    sdk ??= await util.importOrReload(() => import('./sdk/pannellum.js'));
  }

  /**
   * @param {HTMLElement} canvasElem - Container element to mount the viewer into.
   * @param {object} panoOptions
   * @param {string} [panoOptions.startPanoId] - The pano ID to load. Falls back to panoMetadata.pano_id.
   * @param {Record<string, any>} panoOptions.panoMetadata - Metadata for the pano (see PanoData fields).
   * @param {number} [panoOptions.startHeading] - Initial heading wrt true north; defaults to camera_heading.
   * @param {number} [panoOptions.startPitch=0] - Initial pitch in degrees.
   * @param {number} [panoOptions.startZoom=1] - Initial zoom level (1, 2, or 3).
   * @param {boolean} [panoOptions.zoomControl=true] - Whether mouse-wheel zoom is enabled.
   * @param {PanoImageCache} [panoOptions.imageCache] - Prefetched pano bytes to load from before the network (#5562).
   * @returns {Promise<void>}
   */
  async initialize(canvasElem, panoOptions) {
    await PannellumViewer.preloadLibrary();
    const metadata = panoOptions.panoMetadata;
    this.#imageCache = panoOptions.imageCache ?? null;
    this.#mount = canvasElem;
    this.#zoomControl = 'zoomControl' in panoOptions ? panoOptions.zoomControl : true;

    const panoId = panoOptions.startPanoId || metadata.pano_id;
    const cameraHeading = metadata.camera_heading || 0;
    await this.#openViewer(panoId, metadata, this.#viewFor({
      heading: panoOptions.startHeading, pitch: panoOptions.startPitch, zoom: panoOptions.startZoom,
    }, cameraHeading));
    this.#showing(panoId, metadata);

    // Suppress arrow keys / spacebar at the window level (matches GsvViewer/Infra3dViewer behavior).
    const preventShortcuts = (e) => {
      if (util.pano.keyBelongsToPage(e.target)) return;
      if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'].indexOf(e.code) > -1) {
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', preventShortcuts, { capture: true });

    // Pannellum does not emit a "view changed" event, so we poll yaw/pitch/hfov each frame and fire pov_changed
    // when any of them change. The cost is one cheap comparison per frame.
    this.#startPovTracking();

    for (const listener of this.panoChangedListeners) await listener();
  }

  /**
   * Loads a new panorama, into the existing Pannellum instance when there is one and otherwise into a fresh one.
   *
   * Loads run one at a time. Both callers can start a second load while one is in flight (a validator paging fast
   * through the label card, Validate's overlapping loads), and since a failed load tears the instance down, a load
   * sharing it would trip over that: a rung on a null instance, handlers on an instance destroy() will never fire
   * for, or two instances built in one mount. Waiting costs the later load the earlier one's remaining rungs at
   * most, and the earlier one ran anyway.
   *
   * @param {string} panoId
   * @param {Record<string, any>} metadata - Metadata for the new pano, shaped like panoOptions.panoMetadata.
   * @param {{heading: number, pitch: number, zoom: number}} pov - Initial POV for the new pano.
   * @returns {Promise<PanoData>}
   */
  loadPano = (panoId, metadata, pov) => {
    this.#loadsInFlight += 1;
    const load = this.#loads
      .then(() => this.#loadPanoNow(panoId, metadata, pov))
      .finally(() => {
        this.#loadsInFlight -= 1;
      });
    this.#loads = load.catch(() => {});
    return load;
  };

  /**
   * The load itself; see loadPano(), which runs these one at a time.
   *
   * @param {string} panoId
   * @param {Record<string, any>} metadata - Metadata for the new pano, shaped like panoOptions.panoMetadata.
   * @param {{heading: number, pitch: number, zoom: number}} pov - Initial POV for the new pano.
   * @returns {Promise<PanoData>}
   */
  async #loadPanoNow(panoId, metadata, pov) {
    if (panoId === this.#currentSceneId) {
      // Same pano — update calibration (e.g. if metadata was re-fetched) and reposition. Nothing is fetched or
      // decoded, so there is no prefetch outcome to report: without this the previous load's verdict would be
      // logged a second time (Validate asks for the first label's pano twice at init, once from PanoManager's
      // own start-up and once from the first render).
      this.lastLoadPrefetched = null;
      this.#cameraHeading = metadata.camera_heading || 0;
      this.currPanoData = this.#buildPanoData(panoId, metadata);
      this.setPov(pov);
      for (const listener of this.panoChangedListeners) await listener();
      return this.currPanoData;
    }

    // Compute Pannellum-space pitch/yaw/hfov using the new pano's calibration, before updating the instance fields
    // (which #headingToYaw and #yawToHeading read from). The instance fields are updated after the load resolves so
    // the rAF loop doesn't emit pov_changed with a mismatched cameraHeading during the transition.
    const oldSceneId = this.#currentSceneId;
    const newCameraHeading = metadata.camera_heading || 0;
    const view = this.#viewFor(pov, newCameraHeading);

    // A failed load leaves no instance behind (#attemptEach), so the pano after it opens a fresh one, and with it
    // a fresh WebGL context.
    if (!this.#viewer) {
      await this.#openViewer(panoId, metadata, view);
    } else {
      try {
        await this.#loadScene(panoId, metadata, view, newCameraHeading);
      } catch (e) {
        if (!(e instanceof PanoContextLostError)) throw e;
        // The instance's context died under it, and the browser may be handing out working ones again. The same
        // pano gets one try in a fresh instance before it is given up; the ladder begins at the same URL, so no
        // server cut is involved, and on a context that is also dead it ends at its first rung like this one did.
        console.warn(`Pano ${panoId}: rebuilding Pannellum on a new WebGL context.`);
        await this.#openViewer(panoId, metadata, view);
      }
    }

    // Update instance calibration only after the new scene is fully loaded so getPov()/setPov() are consistent.
    this.#showing(panoId, metadata);

    // Safe unguarded: removeScene returns false for an id it won't drop rather than throwing, and the one id it
    // refuses is the current scene, which by here is the new pano rather than this one.
    if (oldSceneId) this.#viewer.removeScene(oldSceneId);

    for (const listener of this.panoChangedListeners) await listener();
    return this.currPanoData;
  }

  /**
   * A POV in Pannellum's terms, against a pano's camera heading. A part the caller left out opens the pano level, at
   * its camera's heading, zoomed out.
   *
   * @param {{heading?: number, pitch?: number, zoom?: number}} pov - A POV wrt true north.
   * @param {number} cameraHeading - The pano's camera heading, which yaw is measured from.
   * @returns {{yaw: number, pitch: number, hfov: number}} The view, as Pannellum's scene config and loadScene take it.
   */
  #viewFor(pov, cameraHeading) {
    return {
      yaw: this.#headingToYaw(pov.heading ?? cameraHeading, cameraHeading),
      pitch: pov.pitch ?? 0,
      hfov: util.pano.zoomToFov(pov.zoom ?? 1),
    };
  }

  /**
   * Records the pano now on screen, once its load has settled, so getPov()/setPov() read against its calibration.
   * @param {string} panoId
   * @param {Record<string, any>} metadata - The pano's metadata, shaped like panoOptions.panoMetadata.
   */
  #showing(panoId, metadata) {
    this.#cameraHeading = metadata.camera_heading || 0;
    this.currPanoData = this.#buildPanoData(panoId, metadata);
    this.#currentSceneId = panoId;
  }

  /**
   * Builds a Pannellum instance in the mount, open on `panoId`: for the first pano, and again for the pano after a
   * load that failed, since that tears the instance down.
   *
   * Tour-mode config (default + scenes) throughout. It is what addScene()/loadScene() need: Pannellum only keeps the
   * scenes map in tour mode, so a pano can't be swapped in without it. Every rung of the ladder builds its own
   * instance, because Pannellum has no way to retry the first scene in place.
   *
   * @param {string} panoId
   * @param {Record<string, any>} metadata - The pano's metadata; uses `image_url`, `width` and `camera_heading`.
   * @param {{yaw: number, pitch: number, hfov: number}} view - Where the pano opens, in Pannellum's terms.
   * @returns {Promise<void>} Resolves once the pano has rendered; rejects, with no instance left, when it never did.
   */
  async #openViewer(panoId, metadata, view) {
    const cameraHeading = metadata.camera_heading || 0;
    const pannellumConfig = {
      default: {
        firstScene: panoId,
        autoLoad: true,
        showControls: false,
        showZoomCtrl: false,
        showFullscreenCtrl: false,
        compass: false,
        keyboardZoom: false,
        mouseZoom: this.#zoomControl,
        friction: 1,
        touchPanSpeedCoeffFactor: 0.4,
        minHfov: util.pano.zoomToFov(3), // zoom 3 → smallest HFOV (most zoomed in)
        maxHfov: util.pano.zoomToFov(1), // zoom 1 → largest HFOV
      },
      scenes: {
        [panoId]: {
          type: 'equirectangular',
          panorama: undefined, // Set per rung.
          haov: 360,
          vaov: 180,
          yaw: view.yaw,
          pitch: view.pitch,
          hfov: view.hfov,
          northOffset: cameraHeading, // Only used by Pannellum's compass UI, which we keep hidden.
        },
      },
    };

    await this.#attemptEach(panoId, metadata, (url) => new Promise((resolve, reject) => {
      pannellumConfig.scenes[panoId].panorama = url;
      this.#viewer = sdk.pannellum.viewer(this.#mount, pannellumConfig);
      this.#settleOn(resolve, reject, 'Pannellum failed to load image');
    }), { instancePerRung: true });

    // Tag the rendered canvas so the screenshot helper (Canvas.js) can find it via getCanvasClass().
    this.#mount.querySelector('.pnlm-render-container canvas')?.classList.add(this.canvasClass);
  }

  /**
   * Loads a pano into the existing Pannellum instance as a new scene, keeping its WebGL context.
   *
   * @param {string} panoId
   * @param {Record<string, any>} metadata - The pano's metadata; uses `image_url` and `width`.
   * @param {{yaw: number, pitch: number, hfov: number}} view - Where the pano opens, in Pannellum's terms.
   * @param {number} cameraHeading - The pano's camera heading, for Pannellum's (hidden) compass.
   * @returns {Promise<void>} Resolves once the pano has rendered; rejects, with no instance left, when it never did.
   */
  async #loadScene(panoId, metadata, view, cameraHeading) {
    // No teardown between rungs: addScene overwrites the entry, and removeScene would refuse anyway, since loadScene
    // has already made this the current scene and Pannellum will not remove that one.
    await this.#attemptEach(panoId, metadata, (url) => new Promise((resolve, reject) => {
      this.#viewer.addScene(panoId, {
        type: 'equirectangular',
        panorama: url,
        haov: 360,
        vaov: 180,
        northOffset: cameraHeading,
      });
      this.#settleOn(resolve, reject, 'Pannellum failed to load scene');
      this.#viewer.loadScene(panoId, view.pitch, view.yaw, view.hfov);
    }));
  }

  /**
   * Resolves on the Pannellum instance's next `load` and rejects on its next `error`, detaching both either way.
   *
   * @param {() => void} resolve
   * @param {(reason: Error) => void} reject
   * @param {string} fallbackMessage - What to reject with when Pannellum gives no reason.
   */
  #settleOn(resolve, reject, fallbackMessage) {
    const viewer = this.#viewer;
    const onLoad = () => {
      viewer.off('load', onLoad);
      viewer.off('error', onError);
      resolve();
    };
    const onError = (err) => {
      viewer.off('load', onLoad);
      viewer.off('error', onError);
      reject(new Error(err || fallbackMessage));
    };
    viewer.on('load', onLoad);
    viewer.on('error', onError);
  }

  /**
   * Runs the #5256 ladder: `load` once per candidate URL, widest first, until one renders.
   *
   * A rung that fails on a working WebGL context is followed by a narrower copy. One that fails on a context the
   * browser has lost, which is what a GPU driver reset leaves behind, ends the ladder at once: nothing textures on a
   * dead context at any width, and every further rung would have the server cut a copy for nothing (#5939). Either
   * way, an instance whose last rung failed goes with it. Pannellum leaves it in its error state, where the window
   * resize handler throws because the failed init deleted the shader program, and nothing can be shown in it again
   * without a load anyway. The next load builds a fresh instance, and with it a fresh context, which after a GPU
   * reset is the only thing that renders.
   *
   * @param {string} panoId - For the console.
   * @param {Record<string, any>} metadata - Pano metadata; uses `image_url` and `width`.
   * @param {(url: string) => Promise<void>} load - Loads one candidate into `#viewer`, rejecting when Pannellum does.
   * @param {object} [opts]
   * @param {boolean} [opts.instancePerRung=false] - Whether `load` builds a new Pannellum instance each time, so a
   *     failed one has to go before the next is built in the same mount.
   * @returns {Promise<void>} Resolves once a rung rendered; rejects with the last failure when none did.
   */
  async #attemptEach(panoId, metadata, load, { instancePerRung = false } = {}) {
    const { urls, cacheKey, held } = await this.#attemptUrls(metadata);
    // Should the ladder fail, the instance goes with it, and getPov() answers for the view as it stands here, after
    // the wait for a prefetch (the user may have panned during it) and before the first rung turns it to the new pano.
    this.#parkedPov = this.getPov();
    try {
      for (let attempt = 0; attempt < urls.length; attempt++) {
        try {
          await load(urls[attempt]);
          this.#recordPrefetchOutcome(held, attempt);
          return;
        } catch (e) {
          const contextGone = this.#contextGone();
          const last = attempt === urls.length - 1;
          if (contextGone || last || instancePerRung) this.#discardViewer();
          if (contextGone) {
            console.warn(`Pano ${panoId} failed to load: the WebGL context is lost, so no size would render.`, e);
            throw new PanoContextLostError(panoId, e);
          }
          if (last) throw e;
          console.warn(`Pano ${panoId} failed to load; retrying at a smaller size.`, e);
        }
      }
    } finally {
      this.#imageCache?.release(cacheKey);
    }
  }

  /**
   * Whether the current Pannellum instance is without a working WebGL context: the one it holds is lost, or the
   * browser refused it one (which it does after enough GPU crashes). Pannellum reports the first as a size limit of
   * 0px and the second as missing WebGL support; neither is about the pano, and no width renders in either case.
   *
   * Read from Pannellum's own canvas, not a throwaway one: after a GPU reset the browser may be handing out live
   * contexts again while the one Pannellum holds stays dead, and that is the one the next rung would render on.
   * Pannellum builds its renderer only once an image has decoded, and asks the canvas for a context in the same
   * breath, with the id used here, so this never creates one. No renderer means the image itself never decoded (a
   * 404, a 503 refusal), which says nothing about WebGL and leaves the ladder to step down.
   *
   * @returns {boolean}
   */
  #contextGone() {
    const canvas = this.#viewer?.getRenderer()?.getCanvas();
    if (!canvas) return false;
    const gl = canvas.getContext('experimental-webgl');
    return !gl || gl.isContextLost();
  }

  /**
   * Tears the Pannellum instance down. Its destroy() drops the window listeners and empties the mount, so a fresh
   * instance can take the mount over. The scene id goes too, or a later load of the same pano would take the
   * "already shown" path over an empty mount.
   */
  #discardViewer() {
    if (!this.#viewer) return;
    try {
      this.#viewer.destroy();
    } catch {
      // Already torn down by the failure itself; nothing left to release.
    }
    this.#viewer = null;
    this.#currentSceneId = undefined;
  }

  /**
   * The URLs to try for a pano, with a prefetched copy standing in for the first (#5562).
   *
   * Rung 0 of the ladder is the URL the page's image cache was asked to fetch, so it is the key looked up here and
   * the one released once the load has settled. The later rungs stay network URLs on purpose: a held copy that
   * fails is the same bytes failing to decode or texture, so the next attempt should be a smaller copy, not the
   * download that produced them.
   *
   * A download of rung 0 still in flight is waited for, up to `PREFETCH_WAIT_MS`: a second download of the same bytes
   * beside it would only slow both down.
   *
   * @param {Record<string, any>} metadata - Pano metadata; uses `image_url` and `width`.
   * @returns {Promise<{urls: string[], cacheKey: string, held: boolean}>} The attempts in order, the key to release
   *     afterwards, and whether rung 0 is a held copy.
   */
  async #attemptUrls(metadata) {
    const candidates = panoramaUrlCandidates(metadata);
    const cacheKey = candidates[0];
    const held = this.#imageCache
      ? await this.#imageCache.settle(cacheKey, PannellumViewer.PREFETCH_WAIT_MS)
      : undefined;
    return { urls: held ? [held, ...candidates.slice(1)] : candidates, cacheKey, held: held !== undefined };
  }

  /**
   * Records what the load just made says about the prefetch: a hit only when the held copy itself rendered.
   *
   * A held copy that fails to decode or texture is followed by a smaller network copy, and that load paid for the
   * network after all, so it is a miss however the bytes were obtained. Null without a cache: the question doesn't
   * arise.
   *
   * @param {boolean} held - Whether rung 0 was a held copy.
   * @param {number} attempt - The rung that rendered.
   */
  #recordPrefetchOutcome(held, attempt) {
    this.lastLoadPrefetched = this.#imageCache ? held && attempt === 0 : null;
  }

  /**
   * Builds a PanoData object from a metadata blob supplied by the caller.
   * @param {string} panoId
   * @param {Record<string, any>} metadata - Fields matching PanoData's constructor params.
   * @returns {PanoData}
   */
  #buildPanoData(panoId, metadata) {
    return new PanoData({
      panoId,
      source: this.getViewerType(),
      captureDate: util.parseDate(metadata.capture_date || Date.now()),
      width: metadata.width,
      height: metadata.height,
      tileWidth: metadata.tile_width || metadata.width,
      tileHeight: metadata.tile_height || metadata.height,
      lat: metadata.lat,
      lng: metadata.lng,
      cameraHeading: metadata.camera_heading,
      cameraPitch: metadata.camera_pitch ?? undefined,
      cameraRoll: metadata.camera_roll ?? undefined,
      address: metadata.address,
      copyright: metadata.copyright,
      linkedPanos: [],
      history: metadata.history || [],
    });
  }

  /**
   * Converts a heading (0 = true north, clockwise) to Pannellum's yaw (0 = image center, range [-180, 180]).
   * @param {number} heading
   * @param {number} [cameraHeading] - Defaults to the current scene's cameraHeading. Pass explicitly when computing
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
      // No instance between a failed load and the next: nothing to read, and nothing has moved.
      if (this.#loadsInFlight === 0 && this.#viewer) {
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
    // A caller that kept this viewer active through a failed load (Validate does, while it decides what to show
    // instead) reads the view the torn-down instance was left at, rather than a TypeError.
    if (!this.#viewer) return { ...(this.#parkedPov ?? { heading: this.#cameraHeading, pitch: 0, zoom: 1 }) };
    return {
      heading: this.#yawToHeading(this.#viewer.getYaw()),
      pitch: this.#viewer.getPitch(),
      zoom: util.pano.fovToZoom(this.#viewer.getHfov()),
    };
  };

  setPov = (pov) => {
    if (!this.#viewer) {
      this.#parkedPov = { ...this.getPov(), ...pov };
      return;
    }
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
    this.#viewer?.resize();
  };
}
