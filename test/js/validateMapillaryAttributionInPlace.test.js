/**
 * Validate leaves Mapillary's attribution pill where the SDK renders it (issue #5600), in
 * public/js/validate/src/panorama/PanoManager.js.
 *
 * MapillaryJS renders the pill through virtual-dom and patches it by walking child indices down from its own
 * `div.mapillary-dom-renderer` root. A pill moved out of that root never receives another patch, so it kept showing an
 * earlier pano's creator and capture date for as long as the session went without a resize. In place it sits under
 * the transparent control layer, accurate but not clickable, which is the trade the maintainer chose. This suite
 * exists so the move cannot quietly come back.
 *
 * Drives the REAL PanoManager against a fake viewer and an SDK-shaped DOM; no imagery is involved.
 */

const fs = require('fs');
const path = require('path');

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/panorama/PanoManager.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/util/throttle.js');

/**
 * Load a bare `class` declaration out of a production file, the way the Grunt bundle puts it in page scope.
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClassFromFile(filePath, className) {
  const src = fs.readFileSync(filePath, 'utf8');
  return (0, eval)('(() => {\n' + src + '\nreturn ' + className + ';\n})()');
}

/** Let MutationObserver callbacks, which run as microtasks, fire. */
const flushObservers = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Validate leaves Mapillary\'s attribution pill in the SDK\'s DOM (issue #5600)', () => {
  let renderer;
  let attributionContainer;

  beforeEach(async () => {
    // The SDK's shape: one renderer root, created at viewer construction and patched by reference from then on.
    document.body.innerHTML = `
      <div id="svv-panorama-holder">
        <div id="svv-panorama" class="mapillary-viewer">
          <div class="mapillary-dom">
            <div class="mapillary-dom-renderer">
              <div class="mapillary-attribution-container">image by first-creator, Sep 26, 2024</div>
            </div>
          </div>
        </div>
        <div id="view-control-layer"></div>
      </div>`;
    renderer = document.querySelector('.mapillary-dom-renderer');
    attributionContainer = document.querySelector('.mapillary-attribution-container');

    global.util = {};
    global.i18next = {language: 'en'};
    (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8'));
    util.isMobile = () => false;

    global.createPanoViewerLogo = jest.fn(() => ({showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn()}));
    global.createPanoAttribution = jest.fn(() => ({show: jest.fn(), hide: jest.fn()}));
    global.GsvViewer = class GsvViewer {};
    global.PannellumViewer = class PannellumViewer {};
    global.svv = {
      tracker: {push: jest.fn()},
      panoStore: {addPanoMetadata: jest.fn()},
      ui: {viewer: {date: {textContent: ''}, controlLayer: document.getElementById('view-control-layer')}},
    };

    const fakeViewer = {addListener: jest.fn(), resize: jest.fn(), setPov: jest.fn(), getPov: () => ({})};
    // The viewer type IS the MapillaryViewer global, so every Mapillary-only path in PanoManager runs.
    global.MapillaryViewer = class MapillaryViewer {
      static create() { return Promise.resolve(fakeViewer); }
    };

    const PanoManager = loadClassFromFile(PANO_MANAGER_PATH, 'PanoManager');
    await PanoManager.create(global.MapillaryViewer, 'token');
    await flushObservers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete global.util;
    delete global.i18next;
    delete global.createPanoViewerLogo;
    delete global.createPanoAttribution;
    delete global.GsvViewer;
    delete global.MapillaryViewer;
    delete global.PannellumViewer;
    delete global.svv;
  });

  test('the pill stays under the SDK\'s renderer root after the viewer is set up', () => {
    expect(attributionContainer.parentElement).toBe(renderer);
  });

  test('the pill stays put when the SDK renders more into the pano', async () => {
    // Any render inside the canvas is what re-triggered the move; the SDK does this on every image.
    renderer.appendChild(document.createElement('div'));
    await flushObservers();

    expect(attributionContainer.parentElement).toBe(renderer);
    expect(document.getElementById('view-control-layer').querySelector('.mapillary-attribution-container')).toBeNull();
  });
});
