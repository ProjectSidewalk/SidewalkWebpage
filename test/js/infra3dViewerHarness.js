/**
 * Test helper: loads the real Infra3dViewer (over the real PanoViewer base and panoUtilities) into the jsdom global
 * scope, plus the fixtures its suites share. Infra3dViewer is a top-level `class` written for the Grunt-concatenation
 * world's stubs for the globals it closes over.
 */

const path = require('path');
const { loadModules, realUtil } = require('./loadGlobalScript');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'frontend/js/common/pano-viewer');

/**
 * Loads Infra3dViewer and returns the class.
 * @returns {typeof Infra3dViewer}
 */
function loadInfra3dViewer() {
  // utilities.js builds a Bowser parser at load time; nothing here consults it.
  window.bowser = {
    getParser: () => ({
      getBrowserName: () => 'Test', getBrowserVersion: () => '1',
      getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
  };
  window.util = realUtil();
  loadModules('frontend/js/common/utilitiesMath.js', 'frontend/js/common/pano-viewer/panoUtilities.js');
  window.PanoData = class PanoData {
    constructor(params) { this.params = params; }
    getPanoId() { return this.params.panoId; }
    getProperty(key) { return this.params[key]; }
  };
  window.proj4 = () => [0, 0];
  Object.assign(window, loadModules(path.join(SRC_DIR, 'Infra3dViewer.js')));
  return window.Infra3dViewer;
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

module.exports = { loadInfra3dViewer, jwtExpiringAt, nodeFor };
