/**
 * PannellumViewer (frontend/js/common/pano-viewer/PannellumViewer.js), the viewer for our own copy of a pano the
 * provider has dropped: the scene it opens on, what happens when a pano won't load at any size, the keys it keeps
 * from Pannellum, the POV polling that stands in for an event Pannellum lacks, and swapping panos in place. Pannellum
 * is the pano viewer harness's fake. The width ladder and the image cache have suites of their own (#5840).
 */

import { loadModules } from './loader.js';
import { installFakePannellum } from './support/panoViewerHarness.js';

let PannellumViewer;
let util;
let mount;

/**
 * Backup-pano metadata as the server sends it for /backupImage.
 * @param {string} panoId
 * @param {object} [extra] - Fields to replace.
 * @returns {object} The metadata.
 */
const metadata = (panoId, extra = {}) => ({
  pano_id: panoId, image_url: `/backupImage/${panoId}`, width: 16384, height: 8192, camera_heading: 100,
  lat: 47.6, lng: -122.3, capture_date: '2023-05', ...extra,
});

/**
 * Builds a viewer the way Validate and the label popup do, through create().
 * @param {object} [extra] - panoOptions to add.
 * @returns {Promise<object>} The viewer.
 */
const create = (extra = {}) => PannellumViewer.create(mount, {
  panoMetadata: metadata('p1'), startPanoId: 'p1', ...extra,
});

beforeEach(async () => {
  // No WebGL in jsdom, so the width cap is unknown and rung 0 is the native file.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  ({ PannellumViewer, util } = await loadModules('frontend/js/common/pano-viewer/PannellumViewer.js',
    'frontend/js/common/utilities.js'));
  mount = document.createElement('div');
  document.body.append(mount);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('opening a pano', () => {
  test('starts Pannellum in tour mode on the pano, facing the start heading against the camera\'s', async () => {
    const pannellum = installFakePannellum();
    const viewer = await create({ startHeading: 130, startPitch: -5, startZoom: 2 });

    const { config } = pannellum.viewers[0];
    expect(config.default).toMatchObject({ firstScene: 'p1', autoLoad: true, showControls: false, mouseZoom: true });
    expect(config.scenes.p1).toMatchObject({
      panorama: '/backupImage/p1', yaw: 30, pitch: -5, hfov: util.pano.zoomToFov(2), northOffset: 100,
    });
    expect(viewer.getPanoId()).toBe('p1');
    expect(viewer.getPosition()).toEqual({ lat: 47.6, lng: -122.3 });
    expect(viewer.getLinkedPanos()).toEqual([]);
  });

  test('wheel zoom can be switched off', async () => {
    const pannellum = installFakePannellum();
    await create({ zoomControl: false });
    expect(pannellum.viewers[0].config.default.mouseZoom).toBe(false);
  });

  test('tags the canvas Pannellum renders into, so a screenshot can find it', async () => {
    installFakePannellum(new Set(), { renderCanvas: true });
    await create();
    expect(mount.querySelector('canvas').classList.contains('pannellum-canvas')).toBe(true);
  });

  test('a pano that fails at every size rejects with the last failure, and no half-built viewer is left',
    async () => {
      const urls = ['/backupImage/p1', '/backupImage/p1?maxWidth=8192', '/backupImage/p1?maxWidth=4096'];
      const pannellum = installFakePannellum(new Set(urls));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(create()).rejects.toThrow('load failed');

      expect(pannellum.attempted).toEqual(urls);
      expect(pannellum.viewers.every((v) => v.destroy.mock.calls.length === 1)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(2);
    });

  test('a failure Pannellum gives no reason for still rejects with one', async () => {
    const urls = ['/backupImage/p1', '/backupImage/p1?maxWidth=8192', '/backupImage/p1?maxWidth=4096'];
    installFakePannellum(new Set(urls), { errorMessage: null });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(create()).rejects.toThrow('Pannellum failed to load image');
  });
});

describe('keys', () => {
  /**
   * Presses a key on an element and says whether the page's own handlers heard it.
   * @param {Element} target - Where the key is pressed.
   * @param {string} code - The key's `code`.
   * @returns {boolean} Whether a document listener got the event.
   */
  function pageHears(target, code) {
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    document.removeEventListener('keydown', heard);
    return heard.mock.calls.length > 0;
  }

  test('the arrows and Space never reach Pannellum, except in a text field', async () => {
    installFakePannellum();
    await create();
    const field = document.createElement('textarea');
    document.body.append(field);

    expect(pageHears(document.body, 'ArrowUp')).toBe(false);
    expect(pageHears(document.body, 'Space')).toBe(false);
    expect(pageHears(document.body, 'KeyW')).toBe(true);
    expect(pageHears(field, 'Space')).toBe(true);
  });
});

describe('the point of view', () => {
  test('is polled each frame and reported only when it changed, and not mid-swap', async () => {
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
    const pannellum = installFakePannellum();
    const viewer = await create();
    const heard = vi.fn();
    viewer.addListener('pov_changed', heard);
    // Viewers from earlier tests keep their own frame loops going and queue here too. A tick starts every waiting
    // frame at once, as a browser would, so none of them gives the swap a chance to finish before this viewer looks.
    const tick = () => Promise.all(frames.splice(0).map((frame) => frame()));

    await tick();
    expect(heard).toHaveBeenCalledTimes(1); // The first frame always reports.
    await tick();
    expect(heard).toHaveBeenCalledTimes(1);
    pannellum.viewers[0].view.yaw = 15;
    await tick();
    expect(heard).toHaveBeenCalledTimes(2);

    const swap = viewer.loadPano('p2', metadata('p2'), { heading: 300, pitch: 0, zoom: 1 });
    pannellum.viewers[0].view.yaw = -40;
    await tick();
    expect(heard).toHaveBeenCalledTimes(2);
    await swap;
    await tick();
    expect(heard).toHaveBeenCalledTimes(3);
  });

  test('a POV without a zoom turns the view and leaves the zoom alone', async () => {
    const pannellum = installFakePannellum();
    const viewer = await create();

    viewer.setPov({ heading: 160, pitch: 10 });

    const shown = pannellum.viewers[0];
    expect(shown.setYaw).toHaveBeenCalledWith(60, false);
    expect(shown.setPitch).toHaveBeenCalledWith(10, false);
    expect(shown.setHfov).not.toHaveBeenCalled();
    expect(viewer.getPov()).toMatchObject({ heading: 160, pitch: 10 });
  });

  test('a resize is passed to Pannellum', async () => {
    const pannellum = installFakePannellum();
    const viewer = await create();
    viewer.resize();
    expect(pannellum.viewers[0].resize).toHaveBeenCalled();
  });
});

describe('switching panos', () => {
  test('a POV missing parts opens the next pano level, at its camera\'s heading, zoomed out', async () => {
    const pannellum = installFakePannellum();
    const viewer = await create();

    await viewer.loadPano('p2', metadata('p2', { camera_heading: 50 }), {});

    const shown = pannellum.viewers[0];
    expect(shown.loadScene).toHaveBeenCalledWith('p2', 0, 0, util.pano.zoomToFov(1));
    expect(shown.removeScene).toHaveBeenCalledWith('p1');
    expect(viewer.getPov().heading).toBe(50);
  });

  test('after a pano fails at every size, the next one loads without trying to drop it', async () => {
    const urls = ['/backupImage/p2', '/backupImage/p2?maxWidth=8192', '/backupImage/p2?maxWidth=4096'];
    const pannellum = installFakePannellum(new Set(urls), { errorMessage: null });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const viewer = await create();

    await expect(viewer.loadPano('p2', metadata('p2'), { heading: 0, pitch: 0, zoom: 1 }))
      .rejects.toThrow('Pannellum failed to load scene');
    await viewer.loadPano('p3', metadata('p3'), { heading: 0, pitch: 0, zoom: 1 });

    expect(pannellum.viewers[0].removeScene).not.toHaveBeenCalled();
    expect(viewer.getPanoId()).toBe('p3');
  });

  test('setPano only accepts the pano already shown, since it carries no metadata to load another', async () => {
    installFakePannellum();
    const viewer = await create();

    await expect(viewer.setPano('p1')).resolves.toBe(viewer.currPanoData);
    await expect(viewer.setPano('p2')).rejects.toThrow('only accepts the current pano ID');
    await expect(viewer.setLocation({ lat: 0, lng: 0 })).rejects.toThrow('does not support setLocation()');
  });
});
