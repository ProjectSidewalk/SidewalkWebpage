/**
 * Stand-ins for the imagery libraries the pano viewers drive (#5840): Google's Street View service and panorama,
 * Pannellum, and Photo Sphere Viewer with the Panoramax API behind it. Each records what the viewer asked of it and
 * answers the way the real library does in the cases the viewers depend on, so a suite reads outcomes rather than
 * calls. Nothing here reaches a network or builds a billable Google object.
 */

import fs from 'fs';
import path from 'path';
import * as turf from '@turf/turf';
import { mockModule, REPO_ROOT } from '../loader.js';

/**
 * Stamps the pano ranking weights onto <html> the way main.scala.html does (minus the file's `_` notes), so the
 * Panoramax picker scores candidates with the production numbers.
 */
export function stampPanoScoring() {
  const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'conf/pano-scoring.json'), 'utf8'));
  document.documentElement.dataset.panoScoring = JSON.stringify(
    Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith('_'))),
  );
}

/**
 * @param {{lat: number, lng: number}} origin - Where to measure from.
 * @param {number} meters - How far to go.
 * @param {number} [bearing=90] - Which way, in degrees clockwise from north.
 * @returns {{lat: number, lng: number}} The point that far from `origin`.
 */
export function metersFrom(origin, meters, bearing = 90) {
  const [lng, lat] = turf.destination(turf.point([origin.lng, origin.lat]), meters / 1000, bearing)
    .geometry.coordinates;
  return { lat, lng };
}

// ---- Google Street View -------------------------------------------------------------------------------------------

/** google.maps.LatLng as the viewer reads it: accessor methods, not fields. */
export class FakeLatLng {
  /**
   * @param {number} lat
   * @param {number} lng
   */
  constructor(lat, lng) {
    this._lat = lat;
    this._lng = lng;
  }

  /** @returns {number} */
  lat() {
    return this._lat;
  }

  /** @returns {number} */
  lng() {
    return this._lng;
  }
}

/**
 * A getPanorama() reply with the fields GsvViewer reads.
 * @param {string} pano - Pano id.
 * @param {{lat: number, lng: number}} position - Where the camera stood.
 * @param {object} [extra] - Replaces any of `links`, `time`, `copyright`, `imageDate` in the reply's data.
 * @returns {{data: object}} The reply.
 */
export function gsvReply(pano, { lat, lng }, extra = {}) {
  return {
    data: {
      location: { pano, latLng: new FakeLatLng(lat, lng), shortDescription: '1 Main St' },
      copyright: '© 2024 Google',
      imageDate: '2024-05',
      links: [],
      time: [],
      tiles: {
        worldSize: { width: 16384, height: 8192 },
        tileSize: { width: 512, height: 512 },
        originHeading: 90,
        originPitch: -2,
      },
      ...extra,
    },
  };
}

/**
 * Installs a fake `google.maps` for GsvViewer: a StreetViewService whose getPanorama answers a by-id request from
 * `panos` (ZERO_RESULTS otherwise; a test overrides it for location searches), and a StreetViewPanorama that fires
 * `pano_changed` and `position_changed` a tick after each setPano, as Google's does once a pano has loaded.
 * @param {Record<string, {data: object}>} [panos] - Replies by pano id.
 * @returns {{getPanorama: import('vitest').Mock, panoramas: object[], trigger: import('vitest').Mock}} The service's
 *   lookup, every panorama built, and google.maps.event.trigger.
 */
export function installFakeGoogleMaps(panos = {}) {
  const panoramas = [];
  const getPanorama = vi.fn(async (request) => {
    if (request.pano && panos[request.pano]) return panos[request.pano];
    throw Object.assign(new Error('ZERO_RESULTS'), { code: 'ZERO_RESULTS' });
  });

  /** google.maps.StreetViewService. */
  class StreetViewService {
    getPanorama = getPanorama;
  }

  /** google.maps.StreetViewPanorama, holding the pano, POV and options it was set to. */
  class StreetViewPanorama {
    /**
     * @param {HTMLElement} el - The mount.
     * @param {object} opts - The options it was built with.
     */
    constructor(el, opts) {
      this.el = el;
      this.opts = opts;
      this.listeners = {};
      this.values = {};
      this.pov = { heading: 0, pitch: 0, zoom: 1 };
      this.panoProvider = null;
      this.setPano = vi.fn((id) => {
        this.pano = id;
        Promise.resolve().then(() => {
          this.fire('pano_changed');
          this.fire('position_changed');
        });
      });
      this.setPov = vi.fn((pov) => {
        this.pov = pov;
        this.fire('pov_changed');
      });
      panoramas.push(this);
    }

    /** @param {Function} provider - Answers a custom pano id with its data, or null. */
    registerPanoProvider(provider) {
      this.panoProvider = provider;
    }

    /**
     * @param {string} event
     * @param {Function} handler
     * @returns {{remove: Function}} What google.maps.event.removeListener takes.
     */
    addListener(event, handler) {
      (this.listeners[event] ??= new Set()).add(handler);
      return { remove: () => this.listeners[event].delete(handler) };
    }

    /** @param {string} event - Calls every handler for it, as Google does. */
    fire(event) {
      for (const handler of [...(this.listeners[event] ?? [])]) handler();
    }

    /** @returns {string} */
    getPano() {
      return this.pano;
    }

    /** @returns {object} */
    getPov() {
      return this.pov;
    }

    /**
     * @param {string} key
     * @param {any} value
     */
    set(key, value) {
      this.values[key] = value;
    }
  }

  const trigger = vi.fn();
  vi.stubGlobal('google', {
    maps: {
      importLibrary: vi.fn(async (name) => (name === 'core'
        ? { LatLng: FakeLatLng }
        : { StreetViewService, StreetViewPanorama })),
      LatLng: FakeLatLng,
      Size: class {
        constructor(width, height) {
          this.width = width;
          this.height = height;
        }
      },
      StreetViewSource: { OUTDOOR: 'outdoor' },
      event: { removeListener: (handle) => handle.remove(), trigger },
    },
  });
  return { getPanorama, panoramas, trigger };
}

// ---- Pannellum ----------------------------------------------------------------------------------------------------

/**
 * Installs a fake `pannellum` (sdk/pannellum.js) whose viewers settle a scene's load on the next microtask, by
 * whether its URL is on a failing list, and hold the view a test can read back or move.
 * @param {Set<string>} [failingUrls] - Panorama URLs whose load fires `error` instead of `load`.
 * @param {object} [opts]
 * @param {?string} [opts.errorMessage='load failed'] - What a failed load hands its `error` handlers.
 * @param {boolean} [opts.renderCanvas=false] - Whether a viewer draws Pannellum's render canvas into its mount.
 * @returns {{attempted: string[], loaded: string[], viewers: object[], webgl: {lost: boolean}}} Every URL a load was
 *   tried for, the ones that succeeded, every viewer built, and the WebGL context every viewer reports holding, which
 *   a test flips to `lost` to stand in for a GPU reset.
 */
export function installFakePannellum(
  failingUrls = new Set(), { errorMessage = 'load failed', renderCanvas = false } = {},
) {
  const attempted = [];
  const loaded = [];
  const viewers = [];
  const webgl = { lost: false };
  mockModule('frontend/js/common/pano-viewer/sdk/pannellum.js', () => ({ pannellum: {
    viewer: vi.fn((container, config) => {
      const handlers = { load: new Set(), error: new Set() };
      const scenes = { ...config.scenes };
      const first = scenes[config.default.firstScene];
      const view = { yaw: first.yaw, pitch: first.pitch, hfov: first.hfov };
      const settle = (url) => Promise.resolve().then(() => {
        attempted.push(url);
        if (failingUrls.has(url)) {
          [...handlers.error].forEach((h) => h(errorMessage));
        } else {
          loaded.push(url);
          [...handlers.load].forEach((h) => h());
        }
      });
      if (renderCanvas) container.innerHTML = '<div class="pnlm-render-container"><canvas></canvas></div>';
      settle(first.panorama);
      const viewer = {
        config,
        scenes,
        view,
        on: (event, handler) => handlers[event].add(handler),
        off: (event, handler) => handlers[event].delete(handler),
        addScene: vi.fn((id, scene) => { scenes[id] = scene; }),
        loadScene: vi.fn((id, pitch, yaw, hfov) => {
          Object.assign(view, { pitch, yaw, hfov });
          settle(scenes[id].panorama);
        }),
        removeScene: vi.fn(() => true),
        destroy: vi.fn(() => { container.innerHTML = ''; }),
        resize: vi.fn(),
        // The viewer reads its WebGL context's state off Pannellum's own canvas: renderer, canvas, context.
        getRenderer: () => ({ getCanvas: () => ({ getContext: () => ({ isContextLost: () => webgl.lost }) }) }),
        getYaw: () => view.yaw,
        getPitch: () => view.pitch,
        getHfov: () => view.hfov,
        setYaw: vi.fn((yaw) => { view.yaw = yaw; }),
        setPitch: vi.fn((pitch) => { view.pitch = pitch; }),
        setHfov: vi.fn((hfov) => { view.hfov = hfov; }),
      };
      viewers.push(viewer);
      return viewer;
    }),
  } }));
  return { attempted, loaded, viewers, webgl };
}

// ---- Panoramax ----------------------------------------------------------------------------------------------------

/**
 * Installs a fake Photo Sphere Viewer (sdk/photoSphereViewer.js). Its zoom level runs 0-100 from `maxFov` down to
 * `minFov` in vertical degrees, as PSV's does, so a POV the viewer sets reads back through getPov(). setPanorama
 * resolves true (loaded) unless a test replaces it.
 * @returns {{viewers: object[]}} Every viewer built; each has `config`, `state`, `setPanorama` and `dispatch(type, e)`.
 */
export function installFakePhotoSphereViewer() {
  const viewers = [];

  /** @photo-sphere-viewer/core's Viewer, cut down to what PanoramaxViewer calls. */
  class Viewer {
    /** @param {object} config - The options it was built with. */
    constructor(config) {
      this.config = { ...config };
      this.listeners = {};
      this.position = { yaw: 0, pitch: 0 };
      this.state = { vFov: config.maxFov, aspect: 1.5 };
      this.setPanorama = vi.fn(async () => true);
      this.autoSize = vi.fn();
      this.setOptions = vi.fn((opts) => Object.assign(this.config, opts));
      this.dataHelper = {
        fovToZoomLevel: (fov) => (100 * (this.config.maxFov - fov)) / (this.config.maxFov - this.config.minFov),
      };
      viewers.push(this);
    }

    /**
     * @param {string} type
     * @param {Function} handler
     */
    addEventListener(type, handler) {
      (this.listeners[type] ??= []).push(handler);
    }

    /**
     * Fires an event the way PSV does when the user drags or zooms.
     * @param {string} type
     * @param {object} event
     */
    dispatch(type, event) {
      for (const handler of this.listeners[type] ?? []) handler(event);
    }

    /** @returns {{yaw: number, pitch: number}} */
    getPosition() {
      return { ...this.position };
    }

    /** @param {{yaw: number, pitch: number}} position */
    rotate({ yaw, pitch }) {
      this.position = { yaw, pitch };
    }

    /** @param {number} level - 0 (widest) to 100 (narrowest). */
    zoom(level) {
      this.state.vFov = this.config.maxFov - (level / 100) * (this.config.maxFov - this.config.minFov);
    }
  }

  mockModule('frontend/js/common/pano-viewer/sdk/photoSphereViewer.js',
    () => ({ Viewer, EquirectangularTilesAdapter: { name: 'EquirectangularTilesAdapter' } }));
  return { viewers };
}

/** The meta-catalog PanoramaxViewer asks. */
export const PANORAMAX_API = 'https://api.panoramax.xyz/api';

/**
 * A STAC item as Panoramax serves a 360° picture, with its tile pyramid and its sequence links.
 * @param {string} id - Picture id.
 * @param {{lat: number, lng: number}} position - Where the camera stood.
 * @param {object} [opts]
 * @param {string} [opts.collection='seq-1'] - The sequence it belongs to.
 * @param {string} [opts.datetime] - Capture time, ISO; a day ago by default.
 * @param {object} [opts.properties] - Replaces or adds to the item's properties.
 * @param {Array<{rel: string, href: string}>} [opts.links] - The item's links.
 * @returns {object} The item.
 */
export function stacItem(id, { lat, lng }, {
  collection = 'seq-1', datetime = new Date(Date.now() - 86400000).toISOString(), properties = {}, links = [],
} = {}) {
  return {
    id,
    collection,
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: {
      datetime,
      'view:azimuth': 0,
      'pers:interior_orientation': { sensor_array_dimensions: [7680, 3840] },
      'tiles:tile_matrix_sets': {
        geovisio: { tileMatrix: [{ matrixWidth: 8, matrixHeight: 4, tileWidth: 960, tileHeight: 960 }] },
      },
      ...properties,
    },
    asset_templates: { tiles: { href: `https://pics.example/${id}/tiled/{TileCol}_{TileRow}.jpg` } },
    assets: { sd: { href: `https://pics.example/${id}/sd.jpg` } },
    links,
  };
}

/**
 * A sequence link from one picture to another, as STAC writes it.
 * @param {'next'|'prev'} rel
 * @param {string} id - The picture it leads to.
 * @returns {{rel: string, href: string}}
 */
export const sequenceLink = (rel, id) => ({ rel, href: `${PANORAMAX_API}/collections/seq-1/items/${id}` });

/**
 * `routeFetch` routes for the Panoramax API over a fixed set of pictures: a search answers with the ones inside its
 * bbox, and a picture fetch with the item, or a 404 for an id it doesn't hold.
 * @param {() => object[]} getItems - The pictures the API holds, read on every request.
 * @returns {Record<string, Function>} The routes.
 */
export function panoramaxRoutes(getItems) {
  return {
    [`${PANORAMAX_API}/search`]: (url) => {
      const [west, south, east, north] = new URL(url).searchParams.get('bbox').split(',').map(Number);
      const features = getItems().filter(({ geometry: { coordinates: [lng, lat] } }) => (
        lng >= west && lng <= east && lat >= south && lat <= north));
      return { features };
    },
    [`${PANORAMAX_API}/pictures/`]: (url) => {
      const item = getItems().find((i) => url.endsWith(`/pictures/${i.id}`));
      return item ?? { status: 404, body: { message: 'not found' } };
    },
  };
}
