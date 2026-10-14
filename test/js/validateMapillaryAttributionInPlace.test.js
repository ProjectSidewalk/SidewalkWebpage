/**
 * Validate leaves Mapillary's attribution pill where the SDK renders it (issue #5600), in
 * frontend/js/validate/panorama/PanoManager.js.
 *
 * MapillaryJS renders the pill through virtual-dom and patches it by walking child indices down from its own
 * `div.mapillary-dom-renderer` root. A pill moved out of that root never receives another patch, so it kept showing an
 * earlier pano's creator and capture date for as long as the session went without a resize. In place it sits under
 * the transparent control layer, accurate but not clickable, which is the trade the maintainer chose. This suite
 * exists so the move cannot quietly come back.
 *
 * Drives the REAL PanoManager against a fake viewer and an SDK-shaped DOM; no imagery is involved.
 */

import { loadModules, mockModule } from './loader.js';
import { fakePanoOverlays, fakeTracker } from './fakes.js';

/** The viewer type IS the MapillaryViewer the manager imports, so every Mapillary-only path in PanoManager runs. */
let MapillaryViewer;
mockModule('frontend/js/common/pano-viewer/MapillaryViewer.js', () => ({ MapillaryViewer }));
fakePanoOverlays();

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

    vi.stubGlobal('i18next', {language: 'en'});

    const fakeViewer = {addListener: vi.fn(), resize: vi.fn(), setPov: vi.fn(), getPov: () => ({})};
    MapillaryViewer = class MapillaryViewer {
      static create() { return Promise.resolve(fakeViewer); }
    };

    const { PanoManager } = await loadModules('frontend/js/validate/panorama/PanoManager.js');
    const viewerUi = {date: {textContent: ''}, controlLayer: document.getElementById('view-control-layer')};
    await PanoManager.create('token', viewerUi, {viewerType: MapillaryViewer, labelRadius: 10},
      {addPanoMetadata: vi.fn()}, {}, fakeTracker());
    await flushObservers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
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
