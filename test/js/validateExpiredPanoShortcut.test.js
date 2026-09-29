/**
 * Tests that Validate goes straight to the Pannellum fallback for a label whose pano the backend already knows is
 * gone from the provider (issue #5561), across public/js/validate/src/label/Label.js (the `expired` flag),
 * public/js/validate/src/label/LabelContainer.js (passing it on) and public/js/validate/src/panorama/PanoManager.js
 * (`setPanorama` / `create` acting on it).
 *
 * Asking the provider for an expired pano costs a metadata round trip that ends in the rejection the flag predicted,
 * on every such label, and only then does the backup start downloading — on a phone that is seconds of dead time
 * between the tap and the next pano. The flag is advisory: a label flagged expired without a backup still asks the
 * provider, since that is its only chance, and an unflagged label is asked for as before.
 *
 * Fake viewers throughout, in the shape validateSkipUnrenderableLabel.test.js uses; no imagery is involved.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub } = require('./loadGlobalScript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PANO_MANAGER_PATH = path.join(REPO_ROOT, 'public/js/validate/src/panorama/PanoManager.js');
const LABEL_CONTAINER_PATH = path.join(REPO_ROOT, 'public/js/validate/src/label/LabelContainer.js');
const LABEL_PATH = path.join(REPO_ROOT, 'public/js/validate/src/label/Label.js');
const THROTTLE_PATH = path.join(REPO_ROOT, 'public/js/validate/src/util/throttle.js');

/**
 * Load a bare `class` declaration out of a production file, wrapped in an IIFE that returns it.
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClassFromFile(filePath, className) {
  const src = fs.readFileSync(filePath, 'utf8');
  return (0, eval)('(() => {\n' + src + '\nreturn ' + className + ';\n})()');
}

describe('PanoManager skips the provider for a pano it knows is gone (issue #5561)', () => {
  const backupImage = { panoId: 'backup-pano', cameraHeading: 90 };
  let PanoManager;
  let FakeViewerType;
  let primaryViewer;
  let pannellumViewer;
  let panoData;

  beforeEach(() => {
    document.body.innerHTML = '<div id="pano-holder"><div id="svv-panorama"></div></div>';

    global.util = {};
    (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8'));
    util.isMobile = () => false;
    global.createPanoViewerLogo = jest.fn(() => ({ showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() }));
    global.createPanoAttribution = jest.fn(() => ({ show: jest.fn(), hide: jest.fn() }));
    global.GsvViewer = class GsvViewer {};
    global.MapillaryViewer = class MapillaryViewer {};
    global.svv = {
      tracker: { push: jest.fn() },
      panoStore: { addPanoMetadata: jest.fn() },
      ui: { viewer: { date: { textContent: '' } } },
    };

    // A Date, as PanoData carries since #5549 replaced moment: the desktop callback formats it for the date badge.
    panoData = { getPanoId: () => 'pano1', getProperty: () => new Date(2026, 5, 1) };
    global.i18next = { language: 'en' };
    const fakeViewer = () => ({
      setPano: jest.fn(() => Promise.resolve(panoData)),
      addListener: jest.fn(),
      resize: jest.fn(),
      setPov: jest.fn(),
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
    });
    primaryViewer = fakeViewer();
    pannellumViewer = fakeViewer();
    pannellumViewer.currPanoData = panoData;
    pannellumViewer.loadPano = jest.fn(() => Promise.resolve(panoData));
    global.PannellumViewer = class PannellumViewer {
      static create = jest.fn(() => Promise.resolve(pannellumViewer));
    };
    FakeViewerType = class FakeViewerType {
      static create() { return Promise.resolve(primaryViewer); }
    };
    PanoManager = loadClassFromFile(PANO_MANAGER_PATH, 'PanoManager');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    for (const name of ['util', 'i18next', 'createPanoViewerLogo', 'createPanoAttribution', 'GsvViewer',
      'MapillaryViewer', 'svv', 'PannellumViewer']) {
      delete global[name];
    }
  });

  /** The fallback path, taken: Pannellum holds the pano and the primary viewer was never involved. */
  function expectFallbackWithoutAskingPrimary(loaded) {
    expect(loaded).toBe(panoData);
    expect(global.PannellumViewer.create).toHaveBeenCalledTimes(1);
    expect(svv.panoViewer).toBe(pannellumViewer);
    expect(document.getElementById('svv-panorama').style.display).toBe('none');
  }

  test('an expired label with a backup loads the backup without asking the provider', async () => {
    const panoManager = await PanoManager.create(FakeViewerType, 'token', 'pano1');
    primaryViewer.setPano.mockClear();

    const loaded = await panoManager.setPanorama('pano2', backupImage, { expired: true });

    expect(primaryViewer.setPano).not.toHaveBeenCalled();
    expectFallbackWithoutAskingPrimary(loaded);
    expect(panoManager.getProperty('panoLoaded')).toBe(true);
  });

  test('an expired label with no backup still asks the provider, since that is its only chance', async () => {
    const panoManager = await PanoManager.create(FakeViewerType, 'token', 'pano1');
    primaryViewer.setPano.mockClear();

    const loaded = await panoManager.setPanorama('pano2', null, { expired: true });

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano2');
    expect(loaded).toBe(panoData);
    expect(global.PannellumViewer.create).not.toHaveBeenCalled();
  });

  test('a label not flagged expired asks the provider first, backup or not', async () => {
    const panoManager = await PanoManager.create(FakeViewerType, 'token', 'pano1');
    primaryViewer.setPano.mockClear();

    await panoManager.setPanorama('pano2', backupImage);

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano2');
    expect(global.PannellumViewer.create).not.toHaveBeenCalled();
  });

  test('the first label of a mission takes the same shortcut', async () => {
    const panoManager = await PanoManager.create(FakeViewerType, 'token', 'pano1', backupImage, true);

    expect(primaryViewer.setPano).not.toHaveBeenCalled();
    expect(global.PannellumViewer.create).toHaveBeenCalledTimes(1);
    expect(svv.panoViewer).toBe(pannellumViewer);
    expect(panoManager.getActiveViewerName()).toBe('Pannellum');
  });

  test('a live label after an expired one hands the pano back to the provider', async () => {
    const panoManager = await PanoManager.create(FakeViewerType, 'token', 'pano1', backupImage, true);

    const loaded = await panoManager.setPanorama('pano3', null);

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano3');
    expect(loaded).toBe(panoData);
    expect(svv.panoViewer).toBe(primaryViewer);
    expect(document.getElementById('svv-panorama').style.display).toBe('');
  });
});

describe('LabelContainer hands the flag to the PanoManager (issue #5561)', () => {
  let LabelContainer;

  beforeEach(() => {
    global.util = { isMobile: () => false, assetPath: assetPathStub };
    global.i18next = { t: jest.fn((key) => key) };
    global.Label = class Label {
      constructor(params) {
        this.auditProps = params;
        this.props = {};
      }

      getAuditProperty(key) { return this.auditProps[key]; }
      setProperty(key, value) { this.props[key] = value; }
      getProperty(key) { return this.props[key]; }
    };
    const el = () => document.createElement('div');
    global.svv = {
      adminVersion: false,
      tracker: { push: jest.fn() },
      labelCard: { render: jest.fn() },
      validationMenu: { resetMenu: jest.fn() },
      undoValidation: { enableUndo: jest.fn() },
      labelVisibilityControl: { hideLabelCard: jest.fn(), unhideLabel: jest.fn(), isVisible: () => true },
      modalNoNewMission: { show: jest.fn() },
      form: { getValidateParams: () => ({}) },
      ui: { holder: el(), busyRegion: [el()], viewer: { controlLayer: el() } },
      panoManager: {
        renderPanoMarker: jest.fn(),
        setPanorama: jest.fn((panoId) => Promise.resolve({ panoId })),
      },
    };
    LabelContainer = loadClassFromFile(LABEL_CONTAINER_PATH, 'LabelContainer');
  });

  afterEach(() => {
    for (const name of ['util', 'i18next', 'Label', 'svv']) delete global[name];
  });

  test('each label is loaded with its own expired flag', async () => {
    const backup = { panoId: 'panoB' };
    const labelContainer = await LabelContainer.create([
      { labelId: 1, panoId: 'panoA', backupImage: null, expired: false },
      { labelId: 2, panoId: 'panoB', backupImage: backup, expired: true },
      { labelId: 3, panoId: 'panoC', backupImage: null },
    ], 'CurbRamp');
    await labelContainer.moveToNextLabel();
    await labelContainer.moveToNextLabel();

    expect(svv.panoManager.setPanorama.mock.calls).toEqual([
      ['panoA', null, { expired: false }],
      ['panoB', backup, { expired: true }],
      ['panoC', null, { expired: false }],
    ]);
  });
});

describe('Label reads the flag off the backend payload (issue #5561)', () => {
  let Label;

  beforeEach(() => {
    global.util = { isMobile: () => false };
    global.moment = jest.fn(() => ({}));
    global.buildBackupImageData = jest.fn(() => null);
    Label = loadClassFromFile(LABEL_PATH, 'Label');
  });

  afterEach(() => {
    delete global.util;
    delete global.moment;
    delete global.buildBackupImageData;
  });

  test.each([
    [{ expired: true }, true],
    [{ expired: false }, false],
    [{ expired: null }, false],
    [{}, false],
  ])('%j reads as %s', (params, expected) => {
    expect(new Label({ label_type: 'CurbRamp', tags: [], ...params }).getAuditProperty('expired')).toBe(expected);
  });
});
