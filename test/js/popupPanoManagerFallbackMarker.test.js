/**
 * Tests for where the label popup draws its marker on the static crop it falls back to when no pano can be shown
 * (frontend/js/common/label-detail/PopupPanoManager.js, issue #2660).
 *
 * The crop behind the fallback is either the browser's snapshot of the Explore canvas, where the label is at its
 * canvas fraction, or the window the nightly crop job cut around the label, where it is wherever `label_crop` says
 * (the centre, unless the window shifted off a pole). The label payload carries that as `cropMarker`; these pin that
 * the fallback marker follows it when present and the canvas fraction otherwise.
 *
 * The fallback is reached by marking the imagery expired with no self-hosted copy: the popup's path for an old label
 * whose pano Google has dropped.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakePanoOverlays } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (k) => k } }));

fakePanoOverlays();

const POV = { heading: 10, pitch: 0, zoom: 1 };

/** The label as LabelDetail hands it over: a click at 1/4, 3/4 of the 720x480 canvas. */
function popupLabel(cropMarker) {
  return {
    labelId: 1, label_type: 'CurbRamp', canvasX: 180, canvasY: 360, originalCanvasWidth: 720,
    originalCanvasHeight: 480, pov: POV, streetEdgeId: 5, aiGenerated: false, cropMarker,
  };
}

describe('PopupPanoManager fallback marker', () => {
  let PopupPanoManager;
  let svHolder;

  beforeEach(async () => {
    document.body.innerHTML = `
            <div class="label-detail__pano-wrap">
              <div id="sv-holder" class="label-detail__pano"></div>
              <div class="label-detail__pano-loading" hidden></div>
            </div>
            <div id="button-holder"></div>
            <a id="explore-street"></a>`;
    svHolder = document.getElementById('sv-holder');

    // Identity transform: the marker lands at the fraction of the container's size, nothing else.
    mockModule('panzoom', () => ({ default: () => ({
      on: vi.fn(), zoomAbs: vi.fn(), moveTo: vi.fn(), getTransform: () => ({ x: 0, y: 0, scale: 1 }),
    }) }));
    // The library preload would otherwise fire on a timer after the test is over.
    useUtil({ afterLoadIdle: () => {} });
    window.fetch = vi.fn(() => Promise.resolve({ ok: false }));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    ({ PopupPanoManager } = await loadModules('frontend/js/common/label-detail/PopupPanoManager.js'));
  });

  /**
     * Builds a manager whose fallback container has a layout, since jsdom gives every element a 0x0 box and the
     * marker is only placed on a box with a size.
     */
  async function createManager() {
    const viewerType = { create: vi.fn(), preloadLibrary: vi.fn() };
    const manager = await PopupPanoManager.create(svHolder, document.getElementById('button-holder'), false,
      viewerType, 'token');
    const container = document.getElementById('pano-fallback-container');
    Object.defineProperty(container, 'clientWidth', { value: 720 });
    Object.defineProperty(container, 'clientHeight', { value: 480 });
    return manager;
  }

  /** Shows the crop fallback for the label and returns the marker's inline offsets in px. */
  async function markerAfterFallback(cropMarker) {
    const manager = await createManager();
    manager.setLabel(popupLabel(cropMarker));
    await expect(manager.setPano('pano-gone', POV, '/cropImage/CurbRamp/1', true, null)).resolves.toBe(true);
    const marker = document.getElementById('pano-fallback-marker');
    return { left: parseFloat(marker.style.left), top: parseFloat(marker.style.top) };
  }

  test('places the marker where the crop says its label is', async () => {
    await expect(markerAfterFallback({ x: 0.5, y: 0.62 })).resolves.toEqual({ left: 360, top: 297.6 });
  });

  test('places the marker at the canvas fraction for a crop nothing has recorded yet', async () => {
    await expect(markerAfterFallback(null)).resolves.toEqual({ left: 180, top: 360 });
  });

  describe('a signed crop that expired while the page was open (#5861)', () => {
    const crop = (exp) => `/cropImage/CurbRamp/1?exp=${exp}&sig=c${exp}`;
    const flush = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };

    /** Answers the crop metadata endpoint with `freshUrl`, or a 404 when null. */
    const answerCropMetadata = (freshUrl) => {
      window.fetch = vi.fn((url) => Promise.resolve(url.startsWith('/cropImage') && freshUrl
        ? { ok: true, json: () => Promise.resolve({ image_url: freshUrl }) }
        : { ok: false, status: 404 }));
    };

    test('a crop that fails to load is re-signed once, then gives way to the not-available panel', async () => {
      answerCropMetadata(crop(2));
      const manager = await createManager();
      manager.setLabel(popupLabel(null));
      await manager.setPano('pano-gone', POV, crop(1), true, null);
      const image = document.getElementById('pano-fallback-image');

      image.dispatchEvent(new Event('error'));
      await flush();
      expect(image.getAttribute('src')).toBe(crop(2));

      image.dispatchEvent(new Event('error'));
      await flush();
      expect(document.getElementById('pano-fallback-container').style.display).toBe('none');
      expect(svHolder.querySelector('.pano-not-avail').style.display).toBe('flex');
    });

    test('a crop given up after setPano resolved tells the host, which locks what it unlocked', async () => {
      answerCropMetadata(null);
      const manager = await createManager();
      manager.onFallbackLost = vi.fn();
      manager.setLabel(popupLabel(null));
      await expect(manager.setPano('pano-gone', POV, crop(1), true, null)).resolves.toBe(true);

      document.getElementById('pano-fallback-image').dispatchEvent(new Event('error'));
      await flush();

      expect(manager.onFallbackLost).toHaveBeenCalledTimes(1);
    });

    test('a re-signed crop that answers after the next label took over is dropped', async () => {
      const pending = {};
      window.fetch = vi.fn((url) => new Promise((resolve) => { pending[url] = resolve; }));
      const manager = await createManager();
      manager.setLabel({ ...popupLabel(null), labelId: 1 });
      const first = manager.setPano('pano-1', POV, crop(1), true, null);
      await flush();
      pending['/backupImage/pano-1/metadata']({ ok: false, status: 404 });
      await expect(first).resolves.toBe(true);
      document.getElementById('pano-fallback-image').dispatchEvent(new Event('error'));
      await flush();

      manager.setLabel({ ...popupLabel(null), labelId: 2 });
      manager.setPano('pano-2', POV, null, true, null);
      const fresh = { ok: true, json: () => Promise.resolve({ image_url: crop(2) }) };
      pending['/cropImage/CurbRamp/1/metadata'](fresh);
      await flush();

      expect(document.getElementById('pano-fallback-image').getAttribute('src')).not.toBe(crop(2));
    });
  });
});
