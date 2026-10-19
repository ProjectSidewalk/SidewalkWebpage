/**
 * Explore leaves Mapillary's attribution pill where the SDK renders it and publishes its height from there (issue
 * #5600), in frontend/js/explore/panorama/PanoManager.js.
 *
 * MapillaryJS patches the pill in place from its own render root, so a pill moved out of it goes stale. Explore still
 * needs the pill's height, as --bottom-left-links-clearance, so the date, info button and logo sit above it. The SDK
 * renders the pill only once its first image is up, which can be after PanoManager is set up, so the hand-off has to
 * wait for the in-place node rather than find it at creation.
 *
 * Drives the REAL PanoManager against a fake viewer and an SDK-shaped DOM; no imagery is involved. jsdom has no
 * ResizeObserver, so a recording stub stands in for it.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';

let fakeViewer;

// The viewer type the config names must be the very class PanoManager imports, so every Mapillary-only path runs.
class MapillaryViewer {
  static create() { return Promise.resolve(fakeViewer); }
}
mockModule('frontend/js/common/pano-viewer/MapillaryViewer.js', () => ({ MapillaryViewer }));
mockModule('frontend/js/common/pano-viewer/GsvViewer.js', () => ({ GsvViewer: class GsvViewer {} }));
mockModule('frontend/js/common/pano-viewer/PanoViewerLogo.js', () => ({
  createPanoViewerLogo: () => ({ showPrimaryLogo: () => {} }),
}));
mockModule('frontend/js/explore/panorama/NoImageryFlagGuard.js', () => ({ NoImageryFlagGuard: { reset() {} } }));

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

  /** Sets up Explore's PanoManager on the Mapillary viewer type and loads its viewer. */
  async function createPanoManager() {
    const ui = {
      pano: document.getElementById('pano'),
      viewControlLayer: document.getElementById('view-control-layer'),
    };
    const config = { viewerType: MapillaryViewer, viewerAccessToken: 'token' };
    const panoManager = new PanoManager(ui, config, { addPanoMetadata: vi.fn() },
      fakeTracker(), {}, {}, {});
    await panoManager.ready;
    await flushObservers();
  }

  beforeEach(async () => {
    document.body.innerHTML = `
      <div class="tool-ui">
        <div id="pano" class="window-streetview mapillary-viewer"></div>
        <div id="user-control-layer"><div id="view-control-layer"></div></div>
      </div>`;

    observedNodes = [];
    vi.stubGlobal('ResizeObserver', class {
      observe(node) { observedNodes.push(node); }
      disconnect() {}
    });

    window.i18next = {t: (key) => key};

    const panoData = {getPanoId: () => 'pano1', getProperty: () => 0};
    fakeViewer = {
      addListener: vi.fn(),
      getPov: () => ({heading: 0, pitch: 0, zoom: 1}),
      setPov: vi.fn(),
      getLinkedPanos: () => [],
      currPanoData: panoData,
      initialSeed: 'pano',
    };
    ({ PanoManager } = await loadModules('frontend/js/explore/panorama/PanoManager.js'));
  });

  afterEach(() => {
    document.body.innerHTML = '';
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
