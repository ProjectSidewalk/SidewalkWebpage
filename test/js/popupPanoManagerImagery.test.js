/**
 * Tests for which imagery the label card's pano manager lands on, and how the label's marker follows it
 * (frontend/js/common/label-detail/PopupPanoManager.js): the self-hosted copy when the live pano is gone, the "no
 * imagery" panel, a type change redrawn on the markers, and the hide state carried from one marker to the next.
 * The viewers are stand-ins, since every real one wants a provider SDK or WebGL (#5840).
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakePanoOverlays } from './fakes.js';
import { flush, routeFetch, sentRequests } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (k) => k } }));

const POV = { heading: 10, pitch: 0, zoom: 1 };

/**
 * A stand-in for any pano viewer: records what it was asked to show and calls back its listeners on demand.
 * @param {string} [panoId] - The pano it reports showing.
 * @param {string} [type] - The imagery it reports being.
 * @returns {object}
 */
function fakeViewer(panoId = 'pano-1', type = 'gsv') {
  const listeners = {};
  return {
    listeners,
    setPano: vi.fn(() => Promise.resolve()),
    loadPano: vi.fn(() => Promise.resolve()),
    addListener: vi.fn((event, fn) => { (listeners[event] ??= []).push(fn); }),
    removeListener: vi.fn(),
    getPanoId: vi.fn(() => panoId),
    getViewerType: () => type,
    resize: vi.fn(),
    setPov: vi.fn(),
    getPov: () => ({ ...POV }),
  };
}

/** The Pannellum stand-in the manager builds for a self-hosted copy; replaced per test. */
let pannellum;
const pannellumCreate = vi.fn(async () => pannellum);
mockModule('frontend/js/common/pano-viewer/PannellumViewer.js', () => ({ PannellumViewer: { create: pannellumCreate } }));
// Only its identity matters: the manager asks Mapillary for instant transitions by comparing the viewer type to it.
const mapillaryType = { SOURCE: 'mapillary', create: vi.fn(), preloadLibrary: vi.fn() };
mockModule('frontend/js/common/pano-viewer/MapillaryViewer.js', () => ({ MapillaryViewer: mapillaryType }));

/** What the panzoom stand-in was handed, so a test can fire its transform event. */
let panzoomOn;

/**
 * The label as LabelDetail hands it over.
 * @param {object} [overrides]
 * @returns {Record<string, any>}
 */
const popupLabel = (overrides = {}) => ({
  labelId: 1, label_type: 'CurbRamp', canvasX: 360, canvasY: 240, originalCanvasWidth: 720,
  originalCanvasHeight: 480, panoSource: 'gsv', pov: POV, streetEdgeId: 5, aiGenerated: false, cropMarker: null,
  ...overrides,
});

describe('PopupPanoManager imagery and markers', () => {
  let PopupPanoManager;
  let util;
  let overlays;
  let viewerType;
  let primary;

  beforeEach(async () => {
    document.body.innerHTML = `
      <div class="label-detail__pano-wrap">
        <div id="sv-holder" class="label-detail__pano"></div>
        <div class="label-detail__pano-loading" hidden></div>
      </div>
      <div id="button-holder"></div>`;
    mockModule('panzoom', () => ({
      default: () => ({
        on: (event, fn) => { panzoomOn = fn; },
        zoomAbs: vi.fn(), moveTo: vi.fn(), getTransform: () => ({ x: 0, y: 0, scale: 1 }),
      }),
    }));
    useUtil({ afterLoadIdle: () => {} });
    overlays = fakePanoOverlays();
    pannellum = fakeViewer('pano-old', 'pannellum');
    primary = fakeViewer();
    viewerType = { SOURCE: 'gsv', create: vi.fn(async () => primary), preloadLibrary: vi.fn() };
    ({ PopupPanoManager, util } = await loadModules(
      'frontend/js/common/utilities.js', 'frontend/js/common/label-detail/PopupPanoManager.js'));
  });

  /**
   * Builds a manager the way LabelDetail does, label first.
   * @param {object} [label] - Overrides on the label.
   * @param {object} [type] - The viewer type to build with.
   * @returns {Promise<object>}
   */
  async function createManager(label = {}, type = viewerType) {
    const manager = await PopupPanoManager.create(document.getElementById('sv-holder'),
      document.getElementById('button-holder'), false, type, 'token');
    manager.setLabel(popupLabel(label));
    return manager;
  }

  const byId = (id) => document.getElementById(id);
  const markersIn = (id) => [...byId(id).querySelectorAll('.label-detail__marker')];

  test('Mapillary is asked to jump between panos rather than animate the turn', async () => {
    mapillaryType.create.mockResolvedValue(primary);
    const manager = await createManager({}, mapillaryType);
    await manager.setPano('pano-1', POV, null);
    expect(mapillaryType.create.mock.calls[0][1]).toMatchObject({ instantTransitions: true });

    const gsv = await createManager();
    await gsv.setPano('pano-1', POV, null);
    expect(viewerType.create.mock.calls[0][1]).not.toHaveProperty('instantTransitions');
  });

  test('a live pano that is gone falls back to the self-hosted copy, credited and marked on its canvas', async () => {
    primary.setPano.mockRejectedValue(new Error('no pano'));
    const backup = { pano_id: 'pano-old', width: 1, height: 1, attribution: { holder: '© Google' } };
    const fetch = routeFetch({ '/backupImage/pano-old/metadata': backup });
    const manager = await createManager();

    await expect(manager.setPano('pano-old', POV, null)).resolves.toBe(true);
    expect(sentRequests(fetch).map((r) => r.url)).toEqual(['/backupImage/pano-old/metadata']);
    expect(manager.activeViewerName).toBe('Pannellum');
    expect(manager.panoViewer).toBe(pannellum);
    expect(overlays.logo.showSourceLogo).toHaveBeenCalled();
    expect(overlays.attribution.show).toHaveBeenLastCalledWith(backup.attribution);
    expect(markersIn('pano-pannellum')).toHaveLength(1);
    expect(markersIn('pano')).toHaveLength(0);
  });

  test('a backup the host already has is used without asking the server for it again', async () => {
    primary.setPano.mockRejectedValue(new Error('no pano'));
    const fetch = routeFetch({});
    const manager = await createManager();

    await manager.setPano('pano-old', POV, null, false, { pano_id: 'pano-old' });
    expect(fetch).not.toHaveBeenCalled();
    expect(manager.activeViewerName).toBe('Pannellum');
  });

  test('a second expired label loads into the Pannellum viewer the first one built', async () => {
    const manager = await createManager();

    await manager.setPano('pano-a', POV, null, true, { pano_id: 'pano-a' });
    await manager.setPano('pano-b', POV, null, true, { pano_id: 'pano-b' });
    expect(pannellumCreate).toHaveBeenCalledTimes(1);
    expect(pannellum.loadPano).toHaveBeenCalledWith('pano-b', { pano_id: 'pano-b' }, POV);
  });

  test('a load overtaken while it looked for a backup leaves the panel to the label that replaced it', async () => {
    let answerFirst;
    routeFetch({
      '/backupImage/pano-a/metadata': () => new Promise((resolve) => { answerFirst = resolve; }),
      '/backupImage/pano-b/metadata': () => new Promise(() => {}),
    });
    const manager = await createManager();

    const first = manager.setPano('pano-a', POV, null, true);
    await flush();
    manager.setPano('pano-b', POV, null, true);
    await flush();
    answerFirst({ status: 404 });

    await expect(first).resolves.toBe(false);
    expect(byId('pano-not-avail').style.display).not.toBe('flex');
    expect(document.querySelector('.label-detail__pano-loading').hidden).toBe(false);
  });

  test('the no-imagery panel offers Explore on the label\'s street, except on a phone', async () => {
    routeFetch({ '/backupImage/': { status: 404 } });
    const manager = await createManager({ streetEdgeId: 77 });

    await expect(manager.setPano('pano-gone', POV, null, true)).resolves.toBe(false);
    const cta = byId('explore-street');
    expect(cta.getAttribute('href')).toBe('/explore?streetEdgeId=77');
    expect(cta.hidden).toBe(false);
    expect(byId('button-holder').style.display).toBe('none');

    useUtil({ afterLoadIdle: () => {}, isMobile: () => true });
    await manager.setPano('pano-gone', POV, null, true);
    expect(cta.hidden).toBe(true);
  });

  test('a self-hosted copy that will not load falls through to the crop, and says why in the console', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    pannellumCreate.mockRejectedValueOnce(new Error('no WebGL'));
    const manager = await createManager();

    await expect(manager.setPano('pano-old', POV, '/crop.png', true, { pano_id: 'pano-old' })).resolves.toBe(true);
    expect(manager.activeViewerName).toBe('StaticCrop');
    expect(byId('pano-pannellum').style.display).toBe('none');
    expect(error).toHaveBeenCalledWith('PannellumViewer failed to load; falling back to crop:', expect.any(Error));
  });

  test('the label\'s original direction is where its marker is drawn', async () => {
    const manager = await createManager({ canvasX: 360, canvasY: 240 });
    // A click at the canvas centre points straight down the label's own POV.
    const { heading, pitch } = manager.getOriginalPosition();
    expect(heading).toBeCloseTo(POV.heading);
    expect(pitch).toBeCloseTo(POV.pitch);
  });

  test('a backup lookup that cannot reach the server lands on the crop', async () => {
    routeFetch({ '/backupImage/': new TypeError('offline') });
    const manager = await createManager();

    await expect(manager.setPano('pano-gone', POV, '/crop.png', true)).resolves.toBe(true);
    expect(manager.activeViewerName).toBe('StaticCrop');
  });

  test('a type change redraws the pano marker and the crop marker in the new type\'s icon and colour', async () => {
    const manager = await createManager();
    await manager.setPano('pano-1', POV, null);

    manager.setLabelType('Obstacle');
    const [marker] = markersIn('pano');
    const icon = util.misc.getIconImagePaths('Obstacle').iconImagePath;
    expect(marker.style.getPropertyValue('--label-icon')).toBe(`url(${icon})`);
    expect(marker.style.getPropertyValue('--label-color')).toBe(util.misc.getLabelColors('Obstacle'));
    const fallback = byId('pano-fallback-marker');
    expect(fallback.style.getPropertyValue('--label-icon')).toBe(`url(${icon})`);
    expect(fallback.style.getPropertyValue('--label-color')).toBe(util.misc.getLabelColors('Obstacle'));
  });

  test('hiding the label carries to the marker drawn for the next one, and an AI label wears its badge', async () => {
    const manager = await createManager();
    await manager.setPano('pano-1', POV, null);
    manager.setLabelsHidden(true);
    expect(markersIn('pano')[0].classList.contains('label-marker--hidden')).toBe(true);
    expect(byId('pano-fallback-marker').classList.contains('label-marker--hidden')).toBe(true);

    manager.clearLabels();
    manager.setLabel(popupLabel({ labelId: 2, aiGenerated: true }));
    await manager.setPano('pano-2', POV, null);
    const [marker] = markersIn('pano');
    expect(marker.classList.contains('label-marker--hidden')).toBe(true);
    expect(marker.querySelectorAll('.admin-ai-icon-marker')).toHaveLength(1);
  });

  test('an admin walking to another pano sees the marker only on the pano it belongs to', async () => {
    const manager = await createManager();
    await manager.setPano('pano-1', POV, null);
    const [marker] = markersIn('pano');

    primary.getPanoId.mockReturnValue('pano-next');
    primary.listeners.pano_changed.forEach((fn) => fn());
    expect(marker.style.display).toBe('none');

    primary.getPanoId.mockReturnValue('pano-1');
    primary.listeners.pano_changed.forEach((fn) => fn());
    expect(marker.style.display).toBe('block');
  });

  test('a label with no recorded imagery source is projected with the fov of the viewer showing it', async () => {
    const hFov = vi.spyOn(util.pano, 'renderedHFov');
    primary.getViewerType = () => 'mapillary';
    const manager = await createManager({ panoSource: undefined });
    await manager.setPano('pano-1', POV, null);

    expect(hFov).toHaveBeenCalledWith(POV.zoom, 720 / 480, 'mapillary');
  });

  test('the crop marker stays put while the crop is not on screen or has no size yet', async () => {
    routeFetch({ '/backupImage/': { status: 404 } });
    const manager = await createManager();
    const marker = byId('pano-fallback-marker');
    panzoomOn();
    expect(marker.style.left).toBe('');

    // jsdom lays nothing out, so the container is 0x0: the closed-dialog case.
    await manager.setPano('pano-gone', POV, '/crop.png', true, null);
    expect(marker.style.display).toBe('block');
    expect(marker.style.left).toBe('');
  });
});
