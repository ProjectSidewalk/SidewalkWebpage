/**
 * Test helper: the real Infra3dViewer (over the real PanoViewer base and PanoData), plus the fixtures its suites share.
 */

import { loadModules } from './loader.js';

/**
 * Loads Infra3dViewer fresh, with the vendored proj4 it reaches for as a page global stubbed.
 * @returns {Promise<Function>} The class.
 */
async function loadInfra3dViewer() {
  window.proj4 = () => [0, 0];
  return (await loadModules('frontend/js/common/pano-viewer/Infra3dViewer.js')).Infra3dViewer;
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

export { loadInfra3dViewer, jwtExpiringAt, nodeFor };
