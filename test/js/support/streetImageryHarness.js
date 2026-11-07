/**
 * Test helper: a fake mapillary-js SDK for MapillaryViewer's suites, and the real Graph API shapes its searches read,
 * so a suite can bring a viewer up through initialize() and walk it around without a browser or a network (#5840).
 */

import fs from 'fs';
import path from 'path';
import { loadModules, mockModule, REPO_ROOT } from '../loader.js';

/**
 * Stamps conf/pano-scoring.json on <html> the way main.scala.html does, since the viewer ranks candidates with it.
 */
function stampPanoScoring() {
  const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'conf/pano-scoring.json'), 'utf8'));
  const stamped = Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith('_')));
  document.documentElement.dataset.panoScoring = JSON.stringify(stamped);
}

/**
 * A value an RxJS-style stream replays to every subscriber, as the SDK's hot replayed observables do.
 * @param {*} value - What each subscriber is handed at once.
 * @returns {{subscribe: (next: Function) => {unsubscribe: Function}}} The stream.
 */
const replaying = (value) => ({ subscribe: (next) => { next(value); return { unsubscribe: () => {} }; } });

/**
 * A mapillary-js Viewer: records what it was built with and asked to do, and lets a test fire its events and
 * render-camera ticks. moveTo answers from `images` by id (seeded from the static `images`) unless a test swaps it.
 */
class FakeMapillaryViewer {
  /** @type {FakeMapillaryViewer[]} Every viewer built, newest last. */
  static instances = [];

  /** @type {Record<string, object>} The images the next viewer built can move to, by id. */
  static images = {};

  /** @param {object} options - What MapillaryViewer handed the constructor. */
  constructor(options) {
    FakeMapillaryViewer.instances.push(this);
    this.options = options;
    this.listeners = {};
    /** @type {Record<string, object>} The images moveTo can reach, by id. */
    this.images = { ...FakeMapillaryViewer.images };
    this.center = [0.5, 0.5];
    this.fov = 70;
    this.renderCameraListeners = [];
    this.setFilter = vi.fn();
    this.moveTo = vi.fn(async (id) => {
      if (!this.images[id]) throw new Error(`MLY image ${id} not found`);
      return this.images[id];
    });
    this.getCenter = vi.fn(async () => this.center);
    this.getFieldOfView = vi.fn(async () => this.fov);
    this.setCenter = vi.fn();
    this.setFieldOfView = vi.fn();
    this.activateComponent = vi.fn();
    this.deactivateComponent = vi.fn();
    this.resize = vi.fn();
    this.graph = { hasNode: (id) => id in this.images, getNode: (id) => this.images[id] };
    this.cacheImage$ = vi.fn(() => ({ subscribe: vi.fn() }));
    this._navigator = {
      _api: { _data: { _accessToken: options.dataProvider?.options?.accessToken } },
      stateService: { getCenter: () => replaying(this.center) },
      graphService: { _graph$: replaying(this.graph), cacheImage$: this.cacheImage$ },
    };
    this._container = {
      renderService: {
        renderCamera$: { subscribe: (next) => { this.renderCameraListeners.push(next); } },
      },
    };
  }

  /**
   * @param {string} event - The SDK event name.
   * @param {Function} fn - The listener.
   */
  on(event, fn) { (this.listeners[event] ??= []).push(fn); }

  /**
   * @param {string} event - The SDK event name.
   * @param {Function} fn - The listener to drop.
   */
  off(event, fn) { this.listeners[event] = (this.listeners[event] ?? []).filter((f) => f !== fn); }

  /**
   * Fires one of the SDK's events, and waits for async listeners to finish.
   * @param {string} event - The event name, e.g. 'image'.
   * @param {object} [e] - The event object.
   * @returns {Promise<void>}
   */
  async emit(event, e = {}) {
    await Promise.all((this.listeners[event] ?? []).map((fn) => fn(e)));
  }

  /**
   * Ticks the render camera.
   * @param {number} fov - The vertical fov it renders at.
   * @param {number} aspect - The container's width:height.
   * @param {string} [imageId] - The image it is on.
   */
  renderCamera(fov, aspect, imageId) {
    this.renderCameraListeners.forEach((next) => next({ perspective: { fov, aspect }, _currentImageId: imageId }));
  }
}

/** The SDK's data provider: keeps its options, and answers each getSpatialImages batch with one entry per id. */
class FakeGraphDataProvider {
  /** @param {object} options - The provider's options. */
  constructor(options) {
    this.options = options;
    this.batches = [];
  }

  /**
   * @param {string[]} ids - The image ids asked for in one request.
   * @returns {Promise<object[]>} One spatial image per id.
   */
  async getSpatialImages(ids) {
    this.batches.push(ids);
    return ids.map((id) => ({ node_id: id }));
  }
}

/** What MapillaryViewer gets as its SDK chunk (sdk/mapillary.js). */
const mapillarySdk = {
  Viewer: FakeMapillaryViewer,
  GraphDataProvider: FakeGraphDataProvider,
  TransitionMode: { Default: 0, Instantaneous: 1 },
};

/**
 * Loads MapillaryViewer fresh over the fake SDK, with the pano-scoring stamp on the page.
 * @returns {Promise<object>} The viewer class, NoImageryError, and the SDK's fake Viewer class.
 */
async function loadMapillaryViewer() {
  stampPanoScoring();
  FakeMapillaryViewer.instances = [];
  mockModule('frontend/js/common/pano-viewer/sdk/mapillary.js', () => mapillarySdk);
  const classes = await loadModules('frontend/js/common/pano-viewer/MapillaryViewer.js',
    'frontend/js/common/pano-viewer/NoImageryError.js', 'frontend/js/common/pano-viewer/PanoViewer.js');
  return { ...classes, FakeMapillaryViewer };
}

/**
 * A mapillary-js Image with the fields the viewer reads off a loaded pano.
 * @param {string} id - The image id.
 * @param {object} [overrides] - Fields to replace, e.g. `{ compassAngle: 90 }`.
 * @returns {object} The image.
 */
function mapillaryImage(id, overrides = {}) {
  return {
    id,
    compassAngle: 0,
    capturedAt: Date.UTC(2024, 5, 1),
    width: 4096,
    height: 2048,
    lngLat: { lat: 37.5407, lng: -77.4360 },
    rotation: [Math.PI / 2, 0, 0],
    creatorUsername: 'someone',
    sequenceId: 'seq1',
    _cache: { _spatialEdges: { cached: true, edges: [] } },
    ...overrides,
  };
}

/**
 * One image from the Graph API's /images search, in the fields MapillaryViewer asks for.
 * @param {string} id - The image id.
 * @param {[number, number]} lngLat - Where its camera is, [lng, lat].
 * @param {object} [overrides] - Fields to replace or add, e.g. `{ computed_geometry: … }`.
 * @returns {object} The search result.
 */
function graphImage(id, lngLat, overrides = {}) {
  return {
    id,
    geometry: { type: 'Point', coordinates: lngLat },
    captured_at: Date.UTC(2024, 5, 1),
    sequence: 'seq1',
    width: 8192,
    camera_type: 'spherical',
    computed_rotation: [Math.PI / 2, 0, 0],
    ...overrides,
  };
}

export { loadMapillaryViewer, mapillaryImage, graphImage, mapillarySdk };
