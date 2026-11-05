/**
 * Tests that Validate goes straight to the Pannellum fallback for a label whose pano the backend already knows is
 * gone from the provider (issue #5561), across frontend/js/validate/label/Label.js (the `expired` flag),
 * frontend/js/validate/label/LabelContainer.js (passing it on) and frontend/js/validate/panorama/PanoManager.js
 * (`setPanorama` acting on it). `create` loads no pano (#5581), so the first label of a mission goes through the same
 * `setPanorama` as every other and takes the same shortcut.
 *
 * Asking the provider for an expired pano costs a metadata round trip that ends in the rejection the flag predicted,
 * on every such label, and only then does the backup start downloading — on a phone that is seconds of dead time
 * between the tap and the next pano. The flag is advisory: a label flagged expired without a backup still asks the
 * provider, since that is its only chance, and an unflagged label is asked for as before.
 *
 * Fake viewers throughout, in the shape validateSkipUnrenderableLabel.test.js uses; no imagery is involved.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker, fakePanoOverlays } from './fakes.js';
import { FakeLabel, fakeLabelContainerDeps, buildLabelContainer } from './support/labelContainerHarness.js';

const i18next = { t: (key) => key };
mockModule('i18next', () => ({ default: i18next }));

/** The backup viewer the PanoManager suite hands its subject; the logo and attribution are fakes for the file. */
let PannellumViewer;
fakePanoOverlays();
mockModule('frontend/js/common/pano-viewer/PannellumViewer.js', () => ({ PannellumViewer }));

mockModule('frontend/js/validate/label/Label.js', () => ({ Label: FakeLabel }));

/** @type {Function} The LabelContainer class under test. */
let LabelContainer;

/** @type {Record<string, any>} The collaborators the container under test is built over. */
let deps;

describe('PanoManager skips the provider for a pano it knows is gone (issue #5561)', () => {
  const backupImage = { pano_id: 'backup-pano', camera_heading: 90 };
  let PanoManager;
  let PanoLoadTimeoutError;
  let FakeViewerType;
  let primaryViewer;
  let pannellumViewer;
  let panoData;
  let tracker;

  /** @returns {Promise<PanoManager>} A manager over the fake viewers, wired the way Main.js wires it. */
  function createPanoManager() {
    const viewerUi = { date: { textContent: '' }, controlLayer: document.createElement('div') };
    return PanoManager.create(
      'token', viewerUi, { viewerType: FakeViewerType, labelRadius: 10 }, { addPanoMetadata: vi.fn() }, {}, tracker,
    );
  }

  beforeEach(async () => {
    document.body.innerHTML = '<div id="pano-holder"><div id="svv-panorama"></div></div>';
    tracker = fakeTracker();


    // A Date, as PanoData carries since #5549 replaced moment: the desktop callback formats it for the date badge.
    panoData = { getPanoId: () => 'pano1', getProperty: () => new Date(2026, 5, 1) };
    Object.assign(i18next, { language: 'en' });
    const fakeViewer = () => ({
      setPano: vi.fn(() => Promise.resolve(panoData)),
      addListener: vi.fn(),
      resize: vi.fn(),
      setPov: vi.fn(),
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
    });
    primaryViewer = fakeViewer();
    pannellumViewer = fakeViewer();
    pannellumViewer.currPanoData = panoData;
    pannellumViewer.loadPano = vi.fn(() => Promise.resolve(panoData));
    PannellumViewer = class PannellumViewer {
      static create = vi.fn(() => Promise.resolve(pannellumViewer));
    };
    FakeViewerType = class FakeViewerType {
      static create() { return Promise.resolve(primaryViewer); }
    };
    // The error class from the same load, so the manager's `instanceof` sees the one the test throws.
    ({ PanoManager, PanoLoadTimeoutError } = await loadModules('frontend/js/validate/panorama/PanoManager.js',
      'frontend/js/common/pano-viewer/PanoLoadTimeoutError.js'));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** The fallback path, taken: Pannellum holds the pano and the primary viewer was never involved. */
  function expectFallbackWithoutAskingPrimary(panoManager, loaded) {
    expect(loaded).toEqual({ panoData });
    expect(PannellumViewer.create).toHaveBeenCalledTimes(1);
    expect(panoManager.panoViewer).toBe(pannellumViewer);
    expect(document.getElementById('svv-panorama').style.display).toBe('none');
  }

  test('an expired label with a backup loads the backup without asking the provider', async () => {
    const panoManager = await createPanoManager();

    const loaded = await panoManager.setPanorama('pano2', backupImage, { expired: true });

    expect(primaryViewer.setPano).not.toHaveBeenCalled();
    expectFallbackWithoutAskingPrimary(panoManager, loaded);
    expect(panoManager.getProperty('panoLoaded')).toBe(true);
  });

  test('an expired label with no backup still asks the provider, since that is its only chance', async () => {
    const panoManager = await createPanoManager();

    const loaded = await panoManager.setPanorama('pano2', null, { expired: true });

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano2');
    expect(loaded).toEqual({ panoData });
    expect(PannellumViewer.create).not.toHaveBeenCalled();
  });

  test('a label not flagged expired asks the provider first, backup or not', async () => {
    const panoManager = await createPanoManager();

    await panoManager.setPanorama('pano2', backupImage);

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano2');
    expect(PannellumViewer.create).not.toHaveBeenCalled();
  });

  test('the first label of a mission takes the same shortcut', async () => {
    const panoManager = await createPanoManager();
    // Nothing is loaded before the first label's own setPanorama, so no provider request can slip in there.
    expect(primaryViewer.setPano).not.toHaveBeenCalled();

    const loaded = await panoManager.setPanorama('pano1', backupImage, { expired: true });

    expect(primaryViewer.setPano).not.toHaveBeenCalled();
    expectFallbackWithoutAskingPrimary(panoManager, loaded);
    expect(panoManager.getActiveViewerName()).toBe('Pannellum');
  });

  test('a backup that fails under a stale expired flag still gets the provider as a last resort', async () => {
    const panoManager = await createPanoManager();
    PannellumViewer.create = vi.fn(() => Promise.reject(new Error('503: no copy could be cut')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const loaded = await panoManager.setPanorama('pano2', backupImage, { expired: true });

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano2');
    expect(loaded).toEqual({ panoData });
    expect(panoManager.panoViewer).toBe(primaryViewer);
    expect(panoManager.getProperty('panoLoaded')).toBe(true);
  });

  test.each([
    ['a timeout', () => new PanoLoadTimeoutError('slow'), 'slow'],
    ['a missing pano', () => new Error('not found'), 'no-imagery'],
  ])('when backup and last-resort provider both fail, %s on the provider sets the reason', async (_, makeErr, why) => {
    const panoManager = await createPanoManager();
    PannellumViewer.create = vi.fn(() => Promise.reject(new Error('503: no copy could be cut')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    primaryViewer.setPano.mockImplementation(() => Promise.reject(makeErr()));

    const loaded = await panoManager.setPanorama('pano2', backupImage, { expired: true });

    expect(primaryViewer.setPano).toHaveBeenCalledTimes(1);
    expect(loaded).toEqual({ panoData: null, reason: why });
    expect(panoManager.getProperty('panoLoaded')).toBe(false);
  });

  test('a first label whose backup fails does not take Validate down with it', async () => {
    PannellumViewer.create = vi.fn(() => Promise.reject(new Error('503: no copy could be cut')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const panoManager = await createPanoManager();
    const loaded = await panoManager.setPanorama('pano1', backupImage, { expired: true });

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano1');
    expect(loaded).toEqual({ panoData });
    expect(panoManager.getActiveViewerName()).not.toBe('Pannellum');
  });

  test('a live label after an expired one hands the pano back to the provider', async () => {
    const panoManager = await createPanoManager();
    await panoManager.setPanorama('pano1', backupImage, { expired: true });
    expect(panoManager.panoViewer).toBe(pannellumViewer);

    const loaded = await panoManager.setPanorama('pano3', null);

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano3');
    expect(loaded).toEqual({ panoData });
    expect(panoManager.panoViewer).toBe(primaryViewer);
    expect(document.getElementById('svv-panorama').style.display).toBe('');
  });
});

describe('LabelContainer hands the flag to the PanoManager (issue #5561)', () => {

  beforeEach(async () => {
    Object.assign(i18next, { t: vi.fn((key) => key) });
    const el = () => document.createElement('div');
    deps = fakeLabelContainerDeps({
      tracker: fakeTracker(),
      labelCard: { render: vi.fn() },
      validationMenu: { resetMenu: vi.fn() },
      undoValidation: { enableUndo: vi.fn() },
      labelVisibilityControl: {
        hideLabelCard: vi.fn(),
        unhideLabel: vi.fn(),
        openCardOnLoad: vi.fn(),
        isVisible: () => true,
      },
      modalNoNewMission: { show: vi.fn() },
      validateParams: {},
      ui: { holder: el(), busyRegion: [el()], viewer: { controlLayer: el() } },
      panoManager: {
        renderPanoMarker: vi.fn(),
        setPanorama: vi.fn((panoId) => Promise.resolve({ panoData: { panoId } })),
        prefetchPano: vi.fn(),
      },
    });
    ({ LabelContainer } = await loadModules('frontend/js/validate/label/LabelContainer.js'));
  });

  test('each label is loaded with its own expired flag', async () => {
    const backup = { pano_id: 'panoB' };
    const labelContainer = await buildLabelContainer(LabelContainer, deps, [
      { labelId: 1, panoId: 'panoA', backupImage: null, expired: false },
      { labelId: 2, panoId: 'panoB', backupImage: backup, expired: true },
      { labelId: 3, panoId: 'panoC', backupImage: null },
    ], 'CurbRamp');
    await labelContainer.moveToNextLabel();
    await labelContainer.moveToNextLabel();

    expect(deps.panoManager.setPanorama.mock.calls).toEqual([
      ['panoA', null, { expired: false }],
      ['panoB', backup, { expired: true }],
      ['panoC', null, { expired: false }],
    ]);
  });
});

describe('Label reads the flag off the backend payload (issue #5561)', () => {
  let Label;

  beforeEach(async () => {
    ({ Label } = await loadModules('frontend/js/validate/label/Label.js'));
  });

  test.each([
    [{ expired: true }, true],
    [{ expired: false }, false],
    [{ expired: null }, false],
    [{}, false],
  ])('%j reads as %s', (params, expected) => {
    expect(new Label({ label_type: 'CurbRamp', tags: [], ...params }, {}).getAuditProperty('expired')).toBe(expected);
  });
});
