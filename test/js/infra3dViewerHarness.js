/**
 * Test helper: the real Infra3dViewer (over the real PanoViewer base and PanoData), plus the fixtures its suites share.
 */

import { loadModules, mockModule } from './loader.js';

/**
 * What the viewer gets as its SDK chunk (sdk/infra3d.js): proj4 as a no-op, and whatever `infra3dapi` a suite
 * installs before it builds a viewer.
 */
const infra3dSdk = { infra3dapi: {}, proj4: () => [0, 0] };

/**
 * Loads Infra3dViewer fresh with its SDK chunk already "fetched", so a suite can bypass create() and still use the SDK.
 * @returns {Promise<Function>} The class.
 */
async function loadInfra3dViewer() {
  mockModule('frontend/js/common/pano-viewer/sdk/infra3d.js', () => infra3dSdk);
  const { Infra3dViewer } = await loadModules('frontend/js/common/pano-viewer/Infra3dViewer.js');
  await Infra3dViewer.preloadLibrary();
  return Infra3dViewer;
}

/** A JWT-shaped token whose payload carries only the expiry (base64url, unpadded, like Cognito's). */
const jwtExpiringAt = (expiryMs) => {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expiryMs / 1000) }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `hdr.${payload}.sig`;
};

/** An Infra3d node with the fields #finishRecordingMetadata reads. */
const nodeFor = (id) => ({
  cameraType: 'cubemap',
  frame: {
    id,
    timestamp: 0,
    framedatameta: { imagewidth: 1, imageheight: 1, tilesize: 1 },
    latitude: 47.413137835,
    longitude: 8.4747970537,
    omega: 0,
    phi: 0,
  },
  spatialEdges: { cached: true, edges: [] },
});

/**
 * An Infra3d SDK whose viewer can do everything initialize() and the camera calls touch: moves answer from `nodes` by
 * key (any key, if absent), events are recorded so a test can fire them, and the camera view is a plain object.
 * Installs itself as the SDK's `infra3dapi` for the next create().
 * @param {{nodes?: Record<string, object>}} [options]
 * @returns {{manager: object, viewer: object, sdkViewer: object, emit: Function}} The SDK's manager, its viewer
 *     wrapper and the mapillary-js-fork viewer inside it, and `emit(target, event, e)` to fire an SDK event.
 */
function fakeInfra3dSdk({ nodes = {} } = {}) {
  const listeners = { viewer: {}, sdkViewer: {} };
  const record = (target) => (event, fn) => { (listeners[target][event] ??= []).push(fn); };
  const nodeAt = (key) => nodes[key] ?? nodeFor(key);
  const sdkViewer = {
    setFilter: vi.fn(async () => {}),
    on: record('sdkViewer'),
    moveToKey: vi.fn(async (key) => nodeAt(key)),
    movePosition: vi.fn(async () => nodeAt('NEAR')),
    activateComponent: vi.fn(),
    deactivateComponent: vi.fn(),
    resize: vi.fn(),
    _navigator: { graphService: {}, _api: {} },
    _container: { scene: { engine: { requestTexture: vi.fn() } } },
  };
  const viewer = {
    _sdk_viewer: sdkViewer,
    on: record('viewer'),
    cameraView: { type: 'pano', lat: 0, lon: 0, fov: 60 },
    getCameraView() { return this.cameraView; },
    setCameraView: vi.fn(),
  };
  const manager = { initViewer: vi.fn(async () => viewer), setTokens: vi.fn() };
  infra3dSdk.infra3dapi = { init: vi.fn(async () => manager) };
  const emit = async (target, event, e) => {
    await Promise.all((listeners[target][event] ?? []).map((fn) => fn(e)));
  };
  return { manager, viewer, sdkViewer, emit };
}

export { infra3dSdk, loadInfra3dViewer, jwtExpiringAt, nodeFor, fakeInfra3dSdk };
