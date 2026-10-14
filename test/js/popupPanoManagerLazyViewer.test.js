/**
 * Tests for PopupPanoManager's lazily built primary viewer (frontend/js/common/label-detail/PopupPanoManager.js, #5128).
 *
 * Google bills every StreetViewPanorama constructed, visible or not, and most visits to a page hosting the label
 * popup never open a label. So the manager must not build its viewer until a label needs live imagery; once built it
 * must be reused; and a build that fails must fall back to the label's crop and be retried by the next label rather
 * than leaving the popup imagery-less for the rest of the page.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakePanoOverlays } from './fakes.js';

const POV = { heading: 10, pitch: 0, zoom: 1 };

/** A stand-in for a GSV/Mapillary viewer: records the panos it was asked for and otherwise does nothing. */
function fakeViewer() {
  return {
    panos: [],
    setPano: vi.fn(function setPano(panoId) { this.panos.push(panoId); return Promise.resolve(); }),
    addListener: vi.fn(),
    getPanoId: () => 'pano-1',
    resize: vi.fn(),
    setPov: vi.fn(),
    getPov: () => ({ ...POV }),
  };
}

// The overlay the manager shows and hides is what the attribution test asserts on.
let attributionOverlay;
// Pannellum needs WebGL; the expired-label test only needs a viewer that resolves.
mockModule('frontend/js/common/pano-viewer/PannellumViewer.js', () => ({
  PannellumViewer: { create: vi.fn(() => Promise.resolve(fakeViewer())) },
}));

describe('PopupPanoManager builds its viewer lazily', () => {
  let PopupPanoManager;
  let viewerType;
  let idleCallbacks;
  let svHolder;
  let buttonHolder;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="sv-holder"></div><div id="button-holder"></div>';
    svHolder = document.getElementById('sv-holder');
    buttonHolder = document.getElementById('button-holder');
    idleCallbacks = [];

    window.panzoom = () => ({ on: vi.fn(), zoomAbs: vi.fn(), moveTo: vi.fn(), getTransform: () => ({}) });
    // The preload is scheduled for idle time; the test runs it by hand to show it is the only thing scheduled.
    useUtil({ afterLoadIdle: (fn) => idleCallbacks.push(fn) });
    window.i18next = { t: (k) => k };
    attributionOverlay = fakePanoOverlays().attribution;
    // No self-hosted backup for any pano, so a failed live attempt lands on the crop.
    window.fetch = vi.fn(() => Promise.resolve({ ok: false }));
    // A failed build is logged on purpose; keep it out of the test output.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    viewerType = {
      create: vi.fn(() => Promise.resolve(fakeViewer())),
      preloadLibrary: vi.fn(() => Promise.resolve()),
    };

    ({ PopupPanoManager } = await loadModules('frontend/js/common/label-detail/PopupPanoManager.js'));
  });


  /** Builds a manager the way LabelDetail does. */
  const createManager = () => PopupPanoManager.create(svHolder, buttonHolder, false, viewerType, 'token');

  test('create() builds the DOM but no viewer, and schedules only the free library preload', async () => {
    const manager = await createManager();

    expect(viewerType.create).not.toHaveBeenCalled();
    expect(manager.panoViewer).toBeUndefined();
    expect(svHolder.querySelector('#pano')).not.toBeNull();

    expect(viewerType.preloadLibrary).not.toHaveBeenCalled();
    expect(idleCallbacks).toHaveLength(1);
    idleCallbacks[0]();
    expect(viewerType.preloadLibrary).toHaveBeenCalledTimes(1);
    expect(viewerType.create).not.toHaveBeenCalled();
  });

  test('the first live label builds the viewer once, in the pano canvas; later labels reuse it', async () => {
    const manager = await createManager();

    await expect(manager.setPano('pano-1', POV, null)).resolves.toBe(true);
    expect(viewerType.create).toHaveBeenCalledTimes(1);
    expect(viewerType.create.mock.calls[0][0]).toBe(svHolder.querySelector('#pano'));
    expect(manager.activeViewerName).toBe('Default');
    const viewer = manager.panoViewer;
    expect(viewer.panos).toEqual(['pano-1']);

    await manager.setPano('pano-2', POV, null);
    expect(viewerType.create).toHaveBeenCalledTimes(1);
    expect(manager.panoViewer).toBe(viewer);
    expect(viewer.panos).toEqual(['pano-1', 'pano-2']);
  });

  test('warmUp() builds the viewer ahead of the label, never rejects, and the label then reuses it', async () => {
    const manager = await createManager();

    await expect(manager.warmUp()).resolves.toBeUndefined();
    expect(viewerType.create).toHaveBeenCalledTimes(1);
    await manager.setPano('pano-1', POV, null);
    expect(viewerType.create).toHaveBeenCalledTimes(1);

    viewerType.create.mockImplementationOnce(() => Promise.reject(new Error('quota')));
    const broken = await createManager();
    await expect(broken.warmUp()).resolves.toBeUndefined();
    expect(broken.panoViewer).toBeUndefined();
  });

  test('labels opened while the viewer is still building share the one build', async () => {
    const manager = await createManager();

    await Promise.all([manager.setPano('pano-1', POV, null), manager.setPano('pano-2', POV, null)]);
    expect(viewerType.create).toHaveBeenCalledTimes(1);
  });

  test('a label known to be expired never builds the viewer', async () => {
    const manager = await createManager();

    await expect(manager.setPano('pano-gone', POV, 'https://example.test/crop.png', true)).resolves.toBe(true);
    expect(viewerType.create).not.toHaveBeenCalled();
    expect(manager.activeViewerName).toBe('StaticCrop');
    expect(manager.panoViewer).toBeUndefined();
  });

  test('the imagery attribution shows over the crop and hides again when live imagery takes over', async () => {
    // The crop is Project Sidewalk's own copy of the imagery, so it carries the label's attribution line (#4865);
    // the provider's live viewer draws its own, so the pill must go when it shows.
    const manager = await createManager();
    const line = { holder: '© 2025 Google', provider: null, license: null, license_url: null };

    await manager.setPano('pano-gone', POV, 'https://example.test/crop.png', true, null, line);
    expect(attributionOverlay.show).toHaveBeenCalledTimes(1);
    expect(attributionOverlay.show).toHaveBeenLastCalledWith(line);

    await manager.setPano('pano-1', POV, null);
    expect(manager.activeViewerName).toBe('Default');
    expect(attributionOverlay.hide).toHaveBeenCalledTimes(1);
  });

  test('a viewer that fails to build falls back to the crop, and the next label tries the build again', async () => {
    viewerType.create
      .mockImplementationOnce(() => Promise.reject(new Error('quota')))
      .mockImplementationOnce(() => Promise.resolve(fakeViewer()));
    const manager = await createManager();

    await expect(manager.setPano('pano-1', POV, 'https://example.test/crop.png')).resolves.toBe(true);
    expect(manager.activeViewerName).toBe('StaticCrop');
    expect(manager.panoViewer).toBeUndefined();

    await expect(manager.setPano('pano-1', POV, null)).resolves.toBe(true);
    expect(viewerType.create).toHaveBeenCalledTimes(2);
    expect(manager.activeViewerName).toBe('Default');
  });

  test('without a crop, a failed build reports no imagery instead of throwing', async () => {
    viewerType.create.mockImplementation(() => Promise.reject(new Error('no key')));
    const manager = await createManager();

    await expect(manager.setPano('pano-1', POV, null)).resolves.toBe(false);
    expect(svHolder.querySelector('#pano-not-avail').style.display).toBe('flex');
  });

  test('a build that keeps failing is abandoned: later labels go to the crop without another billable attempt',
    async () => {
      viewerType.create.mockImplementation(() => Promise.reject(new Error('quota')));
      const manager = await createManager();

      for (let i = 0; i < 5; i++) await manager.setPano(`pano-${i}`, POV, 'https://example.test/crop.png');
      expect(viewerType.create).toHaveBeenCalledTimes(3);
      expect(console.error).toHaveBeenCalledTimes(3);
      expect(manager.activeViewerName).toBe('StaticCrop');
    });

  test('a build resolving late does not hijack the Pannellum viewer showing an expired label', async () => {
    let finishBuild;
    viewerType.create.mockImplementation(() => new Promise((resolve) => {
      finishBuild = () => resolve(fakeViewer());
    }));
    const manager = await createManager();
    const backupImage = { pano_id: 'pano-old', width: 1, height: 1 };

    manager.warmUp(); // What showLabel() does before it knows the label is expired.
    await expect(manager.setPano('pano-old', POV, null, true, backupImage)).resolves.toBe(true);
    const pannellum = manager.panoViewer;
    expect(manager.activeViewerName).toBe('Pannellum');

    finishBuild();
    await manager.warmUp();
    expect(manager.panoViewer).toBe(pannellum);
    expect(manager.activeViewerName).toBe('Pannellum');
  });

  test('the viewer gets exactly one pano_changed listener across warmUp() and setPano()', async () => {
    const manager = await createManager();

    await Promise.all([manager.warmUp(), manager.setPano('pano-1', POV, null)]);
    await manager.setPano('pano-2', POV, null);
    expect(manager.panoViewer.addListener).toHaveBeenCalledTimes(1);
    expect(manager.panoViewer.addListener.mock.calls[0][0]).toBe('pano_changed');
  });

  test('getPov() is null for a viewer with no pano loaded, not a crash', async () => {
    viewerType.create.mockImplementation(() => Promise.resolve({ ...fakeViewer(), getPov: () => null }));
    const manager = await createManager();

    expect(manager.getPov()).toBeNull();
    await manager.setPano('pano-1', POV, null);
    expect(manager.getPov()).toBeNull();
  });

  test('warmUp(maxWaitMs) lets a host carry on when the build never settles', async () => {
    viewerType.create.mockImplementation(() => new Promise(() => {}));
    const manager = await createManager();

    const started = Date.now();
    await manager.warmUp(50);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(manager.panoViewer).toBeUndefined();
  });
});
