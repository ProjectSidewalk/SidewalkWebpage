/**
 * Tests for Validate's handling of a label whose imagery no viewer can render (issue #4810), across
 * public/js/validate/src/panorama/PanoManager.js (`setPanorama` / `#clearViewer`) and
 * public/js/validate/src/label/LabelContainer.js (`renderCurrentLabel` / `#loadPanoForCurrentLabel`).
 *
 * The failure this pins down is silent by nature: neither viewer clears itself when a load fails, so the validator
 * was left looking at the *previous* label's panorama with the new label's marker drawn on it, and asked whether
 * that label was correct. So the assertions are about what is NOT there — no stale canvas, no marker over it, and
 * no label card / validation menu for a label nobody can see.
 *
 * The PanoManager suite drives the REAL `PanoManager.create` factory and the REAL `PanoMarker` class against a fake
 * viewer whose `setPano` can be made to reject; the LabelContainer suite drives the REAL container against a fake
 * PanoManager, since what it needs from one is exactly the `PanoData | null` contract the first suite pins.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub } = require('./loadGlobalScript');

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/panorama/PanoManager.js');
const PANO_MARKER_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/PanoMarker.js');
const LABEL_CONTAINER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/label/LabelContainer.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/util/throttle.js');
const UTILITIES_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/utilities.js');

/**
 * Load a bare `class` declaration out of a production file. The Grunt bundle concatenates these into page scope,
 * so wrap the source in an IIFE that returns the named class (same trick as validateMarkerPulse.test.js).
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClassFromFile(filePath, className) {
  const src = fs.readFileSync(filePath, 'utf8');
  return (0, eval)('(() => {\n' + src + '\nreturn ' + className + ';\n})()');
}

/** @returns {object} A fake jQuery wrapper with the handful of methods Validate calls on its UI elements. */
function fakeJqueryElement() {
  return {addClass: jest.fn(), removeClass: jest.fn(), toggleClass: jest.fn(), css: jest.fn()};
}

describe('PanoManager clears the pano when no viewer can render it (issue #4810)', () => {
  let panoManager;
  let fakeViewer;
  let panoData;

  beforeEach(async () => {
    document.body.innerHTML
      = '<div id="pano-holder"><div id="svv-panorama"></div></div><div id="view-control-layer"></div>';

    global.util = {};
    // utilities.js builds a Bowser parser at load time; the overrides below replace everything read from it.
    global.bowser = { getParser: () => ({ getBrowserName: () => 'Chrome', getBrowserVersion: () => '1',
        getOSName: () => 'Linux', getPlatformType: () => 'desktop' }) };
    // Real utilities, for the marker sizing rule util.cappedMarkerDiameter uses (#4838).
    (0, eval)(fs.readFileSync(UTILITIES_PATH, 'utf8'));
    (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8')); // real throttle; #init wires it to pov_changed
    util.isMobile = () => false;
    util.uiScale = () => 1;
    util.camelToKebab = (str) => str.toLowerCase();
    // jsdom has no WebGL, so PanoMarker falls back to the 2d projection; where the marker lands is irrelevant here.
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    util.pano = {
      centeredPovToCanvasCoord2d: () => ({x: 0, y: 0}),
      centeredPovToCanvasCoord: () => ({x: 0, y: 0}),
    };

    global.PanoMarker = loadClassFromFile(PANO_MARKER_PATH, 'PanoMarker');
    global.i18next = {t: () => 'Curb ramp'};
    global.createPanoViewerLogo = jest.fn(() => ({showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn()}));
    global.GsvViewer = class GsvViewer {};             // distinct from FakeViewerType, so the GSV-only
    global.MapillaryViewer = class MapillaryViewer {}; // and Mapillary-only attribution paths are skipped
    global.svv = {
      tracker: {push: jest.fn()},
      panoStore: {addPanoMetadata: jest.fn()},
      ui: {viewer: {date: {text: jest.fn()}}},
      labelRadius: 10,
    };

    panoData = {getPanoId: () => 'pano1', getProperty: () => ({format: () => 'Jun 2026'})};
    fakeViewer = {
      setPano: jest.fn(() => Promise.resolve(panoData)),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      resize: jest.fn(),
      setPov: jest.fn(),
      getPov: () => ({heading: 0, pitch: 0, zoom: 1}),
    };
    const FakeViewerType = class FakeViewerType {
      static create() { return Promise.resolve(fakeViewer); }
    };

    const PanoManager = loadClassFromFile(PANO_MANAGER_PATH, 'PanoManager');
    panoManager = await PanoManager.create(FakeViewerType, 'token', 'pano1');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete global.util;
    delete global.PanoMarker;
    delete global.i18next;
    delete global.createPanoViewerLogo;
    delete global.GsvViewer;
    delete global.MapillaryViewer;
    delete global.svv;
  });

  /**
   * Build a minimal fake validate Label with just the surface renderPanoMarker reads.
   * @returns {object} The fake label.
   */
  function makeLabel() {
    const auditProps = {heading: 10, pitch: 5, zoom: 1, labelType: 'CurbRamp', aiGenerated: false};
    return {
      getOriginalPov: () => ({heading: 10, pitch: 5, zoom: 1}),
      getAuditProperty: (key) => auditProps[key],
      getIconUrl: () => '/assets/fake-icon.svg',
      getIconColor: () => '#abcdef', // arbitrary test value, not a real label-type color
    };
  }

  test('a load both viewers fail reports failure rather than passing off the pano that is still up', async () => {
    fakeViewer.setPano = jest.fn(() => Promise.reject(new Error('imagery unavailable')));

    // No backup image, so Pannellum is never tried either.
    await expect(panoManager.setPanorama('pano2', null)).resolves.toBeNull();
    expect(panoManager.getProperty('panoLoaded')).toBe(false);
  });

  test('the previous label\'s imagery and marker are taken down, not left under the next label', async () => {
    panoManager.renderPanoMarker(makeLabel());
    expect(document.getElementById('validate-pano-marker')).not.toBeNull();

    fakeViewer.setPano = jest.fn(() => Promise.reject(new Error('imagery unavailable')));
    await panoManager.setPanorama('pano2', null);

    expect(document.getElementById('svv-panorama').style.display).toBe('none');
    expect(document.getElementById('svv-panorama-pannellum').style.display).toBe('none');
    expect(document.getElementById('validate-pano-marker')).toBeNull();
  });

  test('the next label that does load brings the pano back', async () => {
    fakeViewer.setPano = jest.fn(() => Promise.reject(new Error('imagery unavailable')));
    await panoManager.setPanorama('pano2', null);

    fakeViewer.setPano = jest.fn(() => Promise.resolve(panoData));
    await expect(panoManager.setPanorama('pano3', null)).resolves.toBe(panoData);

    expect(document.getElementById('svv-panorama').style.display).toBe('');
    expect(panoManager.getProperty('panoLoaded')).toBe(true);
  });
});

describe('LabelContainer drops labels it cannot show (issue #4810)', () => {
  const LABEL_TYPE = 'Obstacle';
  let LabelContainer;
  let unrenderablePanoIds;
  let topUpQueue;   // Successive `labels` arrays the /moreLabels endpoint answers with.
  let topUpBodies;  // Request bodies it was asked with, so the exclusion list can be asserted.

  beforeEach(() => {
    unrenderablePanoIds = new Set();
    topUpQueue = [];
    topUpBodies = [];

    global.fetch = jest.fn((url, options) => {
      topUpBodies.push(JSON.parse(options.body));
      return Promise.resolve({ok: true, json: () => Promise.resolve({labels: topUpQueue.shift() ?? []})});
    });

    global.util = {isMobile: () => false, assetPath: assetPathStub};
    global.i18next = {t: jest.fn((key) => key)};
    // The bundle's Label class; only the accessors LabelContainer and its collaborators touch.
    global.Label = class Label {
      constructor(params) {
        this.auditProps = params;
        this.props = {};
      }

      getAuditProperty(key) { return this.auditProps[key]; }
      setProperty(key, value) { this.props[key] = value; }
      getProperty(key) { return this.props[key]; }
    };

    global.svv = {
      adminVersion: false,
      tracker: {push: jest.fn()},
      labelCard: {render: jest.fn()},
      validationMenu: {resetMenu: jest.fn()},
      undoValidation: {enableUndo: jest.fn()},
      labelVisibilityControl: {hideLabelCard: jest.fn(), unhideLabel: jest.fn(), isVisible: () => true},
      modalNoNewMission: {show: jest.fn()},
      form: {getValidateParams: () => ({admin_version: false, unvalidated_only: false})},
      ui: {
        holder: fakeJqueryElement(),
        validationMenu: {holder: fakeJqueryElement()},
        viewer: {holder: fakeJqueryElement(), controlLayer: fakeJqueryElement()},
      },
      panoManager: {
        renderPanoMarker: jest.fn(),
        setPanorama: jest.fn((panoId) => Promise.resolve(
          unrenderablePanoIds.has(panoId) ? null : {panoId},
        )),
      },
    };

    LabelContainer = loadClassFromFile(LABEL_CONTAINER_PATH, 'LabelContainer');
  });

  afterEach(() => {
    delete global.fetch;
    delete global.util;
    delete global.i18next;
    delete global.Label;
    delete global.svv;
  });

  /** @returns {Array} Three labels' worth of metadata, one per pano. */
  function threeLabels() {
    return [
      {labelId: 1, panoId: 'panoA'},
      {labelId: 2, panoId: 'panoB'},
      {labelId: 3, panoId: 'panoC'},
    ];
  }

  /**
   * Builds a container with its first label rendered.
   * @param {Array} [labelList] Label metadata to start with.
   * @returns {Promise<LabelContainer>}
   */
  function buildContainer(labelList = threeLabels()) {
    return LabelContainer.create(labelList, LABEL_TYPE);
  }

  /** @returns {Array<number>} The label ids the validation UI was actually asked to render, in order. */
  function renderedLabelIds() {
    return svv.panoManager.renderPanoMarker.mock.calls.map(([label]) => label.getAuditProperty('labelId'));
  }

  test('the unrenderable label is passed over and the next one is shown in its place', async () => {
    unrenderablePanoIds.add('panoB');
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();

    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(3);
    expect(renderedLabelIds()).toEqual([1, 3]);
    // Nothing about the dropped label reaches the UI that asks for a verdict on it.
    expect(svv.labelCard.render).toHaveBeenCalledTimes(2);
    expect(svv.validationMenu.resetMenu).toHaveBeenCalledTimes(2);
  });

  test('dropping a label is logged, since it is invisible to the user by design', async () => {
    unrenderablePanoIds.add('panoB');
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();

    expect(svv.tracker.push).toHaveBeenCalledWith('LabelSkipped_NoImagery', {labelId: 2, panoId: 'panoB'});
  });

  test('undo still lands on the label the user actually saw, not the dropped one', async () => {
    unrenderablePanoIds.add('panoB');
    const labelContainer = await buildContainer();
    await labelContainer.moveToNextLabel();

    expect(await labelContainer.undoLabel()).toBe(true);
    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(1);
  });

  // Mission progress is rolled back by the caller only when the undo it asked for actually happened, so an undo into
  // imagery that has since died has to report itself as not taken.
  test('an undo whose label has become unrenderable reports failure and leaves the user where they were', async () => {
    const labelContainer = await buildContainer();
    await labelContainer.moveToNextLabel();
    unrenderablePanoIds.add('panoA'); // The label being undone back to dies between showing it and returning to it.

    expect(await labelContainer.undoLabel()).toBe(false);
    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(2);
  });

  test('a dropped label is replaced, so the queue never runs short of what the mission needs', async () => {
    unrenderablePanoIds.add('panoC');
    topUpQueue.push([{labelId: 4, panoId: 'panoD'}]);
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel(); // label 2
    await labelContainer.moveToNextLabel(); // label 3 is unrenderable; its replacement comes back instead

    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(4);
    expect(renderedLabelIds()).toEqual([1, 2, 4]);
    expect(svv.modalNoNewMission.show).not.toHaveBeenCalled();
  });

  test('the replacement request names the mission\'s label type and every label it has held', async () => {
    unrenderablePanoIds.add('panoC');
    topUpQueue.push([{labelId: 4, panoId: 'panoD'}]);
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();
    await labelContainer.moveToNextLabel();

    expect(global.fetch).toHaveBeenCalledWith('/validationTask/moreLabels', expect.objectContaining({method: 'POST'}));
    expect(topUpBodies).toHaveLength(1);
    expect(topUpBodies[0].label_type).toBe(LABEL_TYPE);
    expect(topUpBodies[0].labels_needed).toBe(1);
    // Including the ones already answered: those validations may not have reached the database yet.
    expect(topUpBodies[0].excluded_label_ids.sort()).toEqual([1, 2, 3]);
  });

  test('a replacement that also fails is itself replaced, up to a bounded number of rounds', async () => {
    unrenderablePanoIds.add('panoC');
    unrenderablePanoIds.add('panoD');
    unrenderablePanoIds.add('panoE');
    topUpQueue.push([{labelId: 4, panoId: 'panoD'}]);
    topUpQueue.push([{labelId: 5, panoId: 'panoE'}]);
    topUpQueue.push([{labelId: 6, panoId: 'panoF'}]);
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();
    await labelContainer.moveToNextLabel();

    // Two rounds of replacements, both unrenderable, then it stops asking rather than churning the queue.
    expect(topUpBodies).toHaveLength(2);
    expect(labelContainer.getCurrentLabel()).toBeUndefined();
    expect(svv.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: true});
  });

  test('when the backend has no replacement to give, the modal says imagery, not "nothing left"', async () => {
    unrenderablePanoIds.add('panoA');
    unrenderablePanoIds.add('panoB');
    unrenderablePanoIds.add('panoC');

    await buildContainer();

    expect(svv.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: true});
    expect(svv.panoManager.renderPanoMarker).not.toHaveBeenCalled();
    expect(svv.labelCard.render).not.toHaveBeenCalled();
  });

  test('a failed replacement request falls back to the modal instead of throwing', async () => {
    unrenderablePanoIds.add('panoC');
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();
    await labelContainer.moveToNextLabel();

    expect(svv.tracker.push).toHaveBeenCalledWith('LabelTopUpFailed', {error: 'offline'});
    expect(svv.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: true});
  });

  // Only a dropped label buys a replacement request. A queue that empties on its own — including one the backend
  // handed over short — means the backend has nothing more to give, so asking again would just repeat the question.

  test('running out with nothing dropped asks for nothing and reads as no labels left', async () => {
    const labelContainer = await buildContainer([{labelId: 1, panoId: 'panoA'}]);

    await labelContainer.moveToNextLabel();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(svv.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: false});
  });

  // A label is dropped as soon as its imagery fails, which is usually mid-queue, but the queue only empties — and the
  // modal only appears — some labels later. The reason for the dead end has to survive that gap.
  test('a label dropped earlier in the mission still reads as an imagery problem at the end', async () => {
    unrenderablePanoIds.add('panoB');
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel(); // Drops label 2 and shows label 3 in its place.
    await labelContainer.moveToNextLabel(); // Nothing left, and the backend has no replacement to give.

    expect(topUpBodies).toHaveLength(1);
    expect(svv.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: true});
  });

  // The modals are rendered inside #svv-application-holder, which renderCurrentLabel covers with `validate-disabled`
  // (pointer-events: none) while a label loads. Every exit has to hand the UI back or the modal's own button is dead.

  test('the UI is released before a modal is shown, so its button can be clicked', async () => {
    unrenderablePanoIds.add('panoA');
    unrenderablePanoIds.add('panoB');
    unrenderablePanoIds.add('panoC');

    await buildContainer();

    expect(svv.ui.viewer.holder.toggleClass).toHaveBeenLastCalledWith('validate-disabled', false);
    expect(svv.ui.validationMenu.holder.toggleClass).toHaveBeenLastCalledWith('validate-disabled', false);
    expect(svv.ui.holder.css).toHaveBeenLastCalledWith('cursor', '');
    expect(svv.modalNoNewMission.show).toHaveBeenCalled();
  });

  test('the UI is released on the ordinary path too', async () => {
    await buildContainer();

    expect(svv.ui.viewer.holder.toggleClass).toHaveBeenLastCalledWith('validate-disabled', false);
    expect(svv.ui.holder.css).toHaveBeenCalledWith('cursor', '');
  });
});
