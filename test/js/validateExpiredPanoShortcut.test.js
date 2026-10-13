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

import path from 'path';

import { assetPathStub, loadModules, fakeImport, stubUtil } from './loadGlobalScript.js';
import { fakeTracker } from './fakes.js';

fakeImport('frontend/js/common/pano-viewer/GsvViewer.js', 'GsvViewer');
fakeImport('frontend/js/common/pano-viewer/PannellumViewer.js', 'PannellumViewer');
fakeImport('frontend/js/common/pano-viewer/PanoAttribution.js', 'createPanoAttribution');
fakeImport('frontend/js/common/pano-viewer/PanoLoadTimeoutError.js', 'PanoLoadTimeoutError');
fakeImport('frontend/js/common/pano-viewer/PanoViewerLogo.js', 'createPanoViewerLogo');
fakeImport('frontend/js/common/utilitiesSidewalk.js', 'buildBackupImageData');
fakeImport('frontend/js/validate/label/Label.js', 'Label');


const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PANO_MANAGER_PATH = path.join(REPO_ROOT, 'frontend/js/validate/panorama/PanoManager.js');
const LABEL_CONTAINER_PATH = path.join(REPO_ROOT, 'frontend/js/validate/label/LabelContainer.js');
const LABEL_PATH = path.join(REPO_ROOT, 'frontend/js/validate/label/Label.js');
const THROTTLE_PATH = path.join(REPO_ROOT, 'frontend/js/validate/util/throttle.js');

/**
 * Load a bare `class` declaration out of a production file, wrapped in an IIFE that returns it.
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
async function loadClassFromFile(filePath, className) {
  return (await loadModules(filePath))[className];
}

/** @type {Function} The LabelContainer class under test. */
let LabelContainer;

/** @type {Record<string, any>} The collaborators the container under test is built over. */
let deps;

/**
 * Fills in the collaborators LabelContainer takes that the suite has no opinion on.
 * @param {Record<string, any>} suiteDeps - The suite's own fakes, which win where they overlap.
 */
function completeDeps(suiteDeps) {
  const mission = {updateValidationResult: vi.fn(), isComplete: () => true, getProperty: () => 1};
  deps = {
    config: {validateParams: {}, source: 'Validate', canvasWidth: () => 720, canvasHeight: () => 480, labelRadius: 10},
    panoLoadingStatus: {begin: vi.fn(), setMessage: vi.fn(), end: vi.fn()},
    modalMissionComplete: {isShowing: () => false},
    missionContainer: {getCurrentMission: () => mission, updateAMission: vi.fn()},
    ...suiteDeps,
  };
  deps.tracker.flushSoon ??= vi.fn();
  deps.modalNoNewMission.isShowing ??= () => false;
  Object.assign(deps.panoManager, {
    blanksPanoWhileLoading: () => false,
    getActiveViewerName: () => 'Default',
    revealPendingCanvas: vi.fn(),
    prefetchBackups: deps.panoManager.prefetchBackups ?? vi.fn(),
    panoViewer: {getViewerType: () => 'gsv'},
  });
}

/**
 * Builds a container over the fakes, with the card and menu listening the way Main.js wires them.
 * @param {Array} labelList - Label metadata to start with.
 * @param {string} labelType - The mission's label type.
 * @returns {object} The container, before its first render.
 */
function newLabelContainer(labelList, labelType) {
  const labelContainer = new LabelContainer(labelList, labelType, deps.ui, deps.config, deps.panoManager,
    deps.panoLoadingStatus, deps.modalMissionComplete, deps.modalNoNewMission, deps.missionContainer, deps.tracker);
  labelContainer.onLabelReady((label) => deps.labelCard.render(label));
  labelContainer.onLabelReady((label) => deps.validationMenu.resetMenu(label));
  return labelContainer;
}

/**
 * @param {Array} labelList - Label metadata to start with.
 * @param {string} labelType - The mission's label type.
 * @returns {Promise<object>} The container with its first label rendered.
 */
async function buildLabelContainer(labelList, labelType) {
  const labelContainer = newLabelContainer(labelList, labelType);
  await labelContainer.renderCurrentLabel();
  return labelContainer;
}

describe('PanoManager skips the provider for a pano it knows is gone (issue #5561)', () => {
  const backupImage = { pano_id: 'backup-pano', camera_heading: 90 };
  let PanoManager;
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
    tracker = { push: vi.fn(), trackPano: vi.fn() };

    stubUtil({});
    Object.assign(window, await loadModules(THROTTLE_PATH));
    util.isMobile = () => false;
    window.createPanoViewerLogo = vi.fn(() => ({ showPrimaryLogo: vi.fn(), showSourceLogo: vi.fn() }));
    window.createPanoAttribution = vi.fn(() => ({ show: vi.fn(), hide: vi.fn() }));
    window.GsvViewer = class GsvViewer {};
    window.MapillaryViewer = class MapillaryViewer {};
    window.PanoLoadTimeoutError = class PanoLoadTimeoutError extends Error {};

    // A Date, as PanoData carries since #5549 replaced moment: the desktop callback formats it for the date badge.
    panoData = { getPanoId: () => 'pano1', getProperty: () => new Date(2026, 5, 1) };
    window.i18next = { language: 'en' };
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
    window.PannellumViewer = class PannellumViewer {
      static create = vi.fn(() => Promise.resolve(pannellumViewer));
    };
    FakeViewerType = class FakeViewerType {
      static create() { return Promise.resolve(primaryViewer); }
    };
    PanoManager = await loadClassFromFile(PANO_MANAGER_PATH, 'PanoManager');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    for (const name of ['util', 'i18next', 'createPanoViewerLogo', 'createPanoAttribution', 'GsvViewer',
      'MapillaryViewer', 'PanoLoadTimeoutError', 'PannellumViewer']) {
      delete global[name];
    }
  });

  /** The fallback path, taken: Pannellum holds the pano and the primary viewer was never involved. */
  function expectFallbackWithoutAskingPrimary(panoManager, loaded) {
    expect(loaded).toEqual({ panoData });
    expect(window.PannellumViewer.create).toHaveBeenCalledTimes(1);
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
    expect(window.PannellumViewer.create).not.toHaveBeenCalled();
  });

  test('a label not flagged expired asks the provider first, backup or not', async () => {
    const panoManager = await createPanoManager();

    await panoManager.setPanorama('pano2', backupImage);

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano2');
    expect(window.PannellumViewer.create).not.toHaveBeenCalled();
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
    window.PannellumViewer.create = vi.fn(() => Promise.reject(new Error('503: no copy could be cut')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const loaded = await panoManager.setPanorama('pano2', backupImage, { expired: true });

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano2');
    expect(loaded).toEqual({ panoData });
    expect(panoManager.panoViewer).toBe(primaryViewer);
    expect(panoManager.getProperty('panoLoaded')).toBe(true);
  });

  test.each([
    ['a timeout', () => new window.PanoLoadTimeoutError('slow'), 'slow'],
    ['a missing pano', () => new Error('not found'), 'no-imagery'],
  ])('when backup and last-resort provider both fail, %s on the provider sets the reason', async (_, makeErr, why) => {
    const panoManager = await createPanoManager();
    window.PannellumViewer.create = vi.fn(() => Promise.reject(new Error('503: no copy could be cut')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    primaryViewer.setPano.mockImplementation(() => Promise.reject(makeErr()));

    const loaded = await panoManager.setPanorama('pano2', backupImage, { expired: true });

    expect(primaryViewer.setPano).toHaveBeenCalledTimes(1);
    expect(loaded).toEqual({ panoData: null, reason: why });
    expect(panoManager.getProperty('panoLoaded')).toBe(false);
  });

  test('a first label whose backup fails does not take Validate down with it', async () => {
    window.PannellumViewer.create = vi.fn(() => Promise.reject(new Error('503: no copy could be cut')));
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
    stubUtil({ isMobile: () => false, assetPath: assetPathStub });
    window.i18next = { t: vi.fn((key) => key) };
    window.Label = class Label {
      constructor(params) {
        this.auditProps = params;
        this.props = {};
      }

      getAuditProperty(key) { return this.auditProps[key]; }
      setProperty(key, value) { this.props[key] = value; }
      getProperty(key) { return this.props[key]; }
    };
    const el = () => document.createElement('div');
    completeDeps({
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
    LabelContainer = await loadClassFromFile(LABEL_CONTAINER_PATH, 'LabelContainer');
  });

  afterEach(() => {
    for (const name of ['util', 'i18next', 'Label']) delete global[name];
  });

  test('each label is loaded with its own expired flag', async () => {
    const backup = { pano_id: 'panoB' };
    const labelContainer = await buildLabelContainer([
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
    stubUtil({ isMobile: () => false });
    window.moment = vi.fn(() => ({}));
    window.buildBackupImageData = vi.fn(() => null);
    Label = await loadClassFromFile(LABEL_PATH, 'Label');
  });

  afterEach(() => {
    delete window.util;
    delete window.moment;
    delete window.buildBackupImageData;
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
