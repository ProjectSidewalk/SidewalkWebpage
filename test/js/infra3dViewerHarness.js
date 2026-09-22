/**
 * Test helper: loads the real Infra3dViewer (over the real PanoViewer base and panoUtilities) into the jsdom global
 * scope, plus the fixtures its suites share. Infra3dViewer is a top-level `class` written for the Grunt-concatenation
 * world, so its source is eval'd rather than required, with stubs for the globals it closes over.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');

/**
 * Loads Infra3dViewer and returns the class.
 * @returns {typeof Infra3dViewer}
 */
function loadInfra3dViewer() {
  const source = (file) => fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  // utilities.js builds a Bowser parser at load time; nothing here consults it.
  window.bowser = {
    getParser: () => ({
      getBrowserName: () => 'Test', getBrowserVersion: () => '1',
      getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
  };
  loadGlobalScript('public/js/common/utilities.js');
  loadGlobalScript('public/js/common/utilitiesMath.js');
  loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');
  window.eval(`
    class GsvViewer {}
    class MapillaryViewer {}
    class PannellumViewer {}
    class PanoramaxViewer {}
    class PanoData {
      constructor(params) { this.params = params; }
      getPanoId() { return this.params.panoId; }
      getProperty(key) { return this.params[key]; }
    }
    const proj4 = () => [0, 0];
    const moment = (timestamp) => timestamp;
    ${source('NoImageryError.js')}
    ${source('PanoViewer.js')}
    ${source('Infra3dViewer.js')}
    window.Infra3dViewer = Infra3dViewer;
  `);
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
