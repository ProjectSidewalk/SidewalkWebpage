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

export { infra3dSdk, loadInfra3dViewer, jwtExpiringAt, nodeFor };
