/**
 * Explore leaves Mapillary's attribution pill where the SDK renders it and publishes its height from there (issue
 * #5600), in public/js/explore/src/panorama/PanoManager.js.
 *
 * MapillaryJS patches the pill in place from its own render root, so a pill moved out of it goes stale. Explore still
 * needs the pill's height, as --bottom-left-links-clearance, so the date, info button and logo sit above it. The SDK
 * renders the pill only once its first image is up, which can be after PanoManager is set up, so the hand-off has to
 * wait for the in-place node rather than find it at creation. The clickability half lives in svl.css and is guarded by
 * test/e2e/mapillary-attribution-stacking.spec.js.
 *
 * Drives the REAL PanoManager against a fake viewer and an SDK-shaped DOM; no imagery is involved. jsdom has no
 * ResizeObserver, so a recording stub stands in for it.
 */

const fs = require('fs');
const path = require('path');

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'public/js/explore/src/panorama/PanoManager.js');

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

describe('Explore publishes the links clearance from Mapillary\'s in-place pill (issue #5600)', () => {
  let observedNodes; // every element handed to a ResizeObserver, in order
  let PanoManager;

  /**
   * An SDK-shaped attribution pill, as MapillaryJS renders it once the first image is up.
   * @returns {{renderer: HTMLElement, container: HTMLElement}} The renderer root and the pill inside it.
   */
  function renderSdkAttribution() {
    const dom = document.createElement('div');
    dom.className = 'mapillary-dom';
    const renderer = document.createElement('div');
    renderer.className = 'mapillary-dom-renderer';
    const container = document.createElement('div');
    container.className = 'mapillary-attribution-container';
    container.textContent = 'image by first-creator, Nov 11, 2024';
    renderer.appendChild(container);
    dom.appendChild(renderer);
    document.getElementById('pano').appendChild(dom);
    return {renderer, container};
  }

  /** Sets up Explore's PanoManager on the Mapillary viewer type. */
  async function createPanoManager() {
    await PanoManager.create(global.MapillaryViewer, 'token', {});
    await flushObservers();
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="tool-ui">
        <div id="pano" class="window-streetview mapillary-viewer"></div>
        <div id="user-control-layer"><div id="view-control-layer"></div></div>
        <svg><g id="arrow-group"></g></svg>
      </div>`;

    observedNodes = [];
    global.ResizeObserver = class {
      observe(node) { observedNodes.push(node); }
      disconnect() {}
    };

    global.util = {localIsoDate: () => '2024-11'};
    global.i18next = {t: (key) => key};
    global.NoImageryFlagGuard = {reset: jest.fn()};
    global.NoImageryError = class NoImageryError extends Error {};
    global.createPanoViewerLogo = jest.fn(() => ({showPrimaryLogo: jest.fn()}));
    global.GsvViewer = class GsvViewer {};

    const panoData = {getPanoId: () => 'pano1', getProperty: () => 0};
    const fakeViewer = {
      addListener: jest.fn(),
      getPov: () => ({heading: 0, pitch: 0, zoom: 1}),
      setPov: jest.fn(),
      getLinkedPanos: () => [],
      currPanoData: panoData,
      initialSeed: 'pano',
    };
    // The viewer type IS the MapillaryViewer global, so every Mapillary-only path in PanoManager runs.
    global.MapillaryViewer = class MapillaryViewer {
      static create() { return Promise.resolve(fakeViewer); }
    };
    global.svl = {
      tracker: {push: jest.fn()},
      panoStore: {addPanoMetadata: jest.fn()},
      stuckAlert: {panoVisited: jest.fn()},
      ui: {streetview: {
        navArrows: document.getElementById('arrow-group'),
        viewControlLayer: document.getElementById('view-control-layer'),
      }},
    };

    PanoManager = loadClassFromFile(PANO_MANAGER_PATH, 'PanoManager');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    for (const name of ['ResizeObserver', 'util', 'i18next', 'NoImageryFlagGuard', 'NoImageryError',
      'createPanoViewerLogo', 'GsvViewer', 'MapillaryViewer', 'svl']) {
      delete global[name];
    }
  });

  test('a pill the SDK rendered before setup is measured where it is and left there', async () => {
    const {renderer, container} = renderSdkAttribution();
    await createPanoManager();

    expect(observedNodes).toEqual([container]);
    expect(container.parentElement).toBe(renderer);
  });

  test('a pill the SDK renders after setup is handed over once it appears, in place', async () => {
    await createPanoManager();
    expect(observedNodes).toEqual([]);

    const {renderer, container} = renderSdkAttribution();
    await flushObservers();

    expect(observedNodes).toEqual([container]);
    expect(container.parentElement).toBe(renderer);
  });

  test('the hand-off happens once, not on every later render inside the pano', async () => {
    await createPanoManager();
    const {renderer} = renderSdkAttribution();
    await flushObservers();

    // The SDK renders into the pano on every image; none of that should re-measure or touch the pill.
    renderer.appendChild(document.createElement('div'));
    await flushObservers();

    expect(observedNodes).toHaveLength(1);
  });
});
