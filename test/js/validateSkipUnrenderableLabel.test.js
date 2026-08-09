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

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/panorama/PanoManager.js');
const PANO_MARKER_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/PanoMarker.js');
const LABEL_CONTAINER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/label/LabelContainer.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/util/throttle.js');

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
  const LABEL_TYPE_ID = 3;
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

    global.util = {isMobile: () => false};
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
   * @param {number} [labelsNeeded] How many labels the mission still needs (defaults to however many were handed over,
   *      i.e. the normal case where the backend supplied a full queue).
   * @returns {Promise<LabelContainer>}
   */
  function buildContainer(labelList = threeLabels(), labelsNeeded = labelList.length) {
    return LabelContainer.create(labelList, {
      label_type_id: LABEL_TYPE_ID,
      labels_validated: labelsNeeded,
      labels_progress: 0,
    });
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

    await labelContainer.undoLabel();

    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(1);
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
    expect(topUpBodies[0].label_type_id).toBe(LABEL_TYPE_ID);
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

  test('running out with nothing dropped is still the plain no-more-labels case', async () => {
    const labelContainer = await buildContainer([{labelId: 1, panoId: 'panoA'}]);

    await labelContainer.moveToNextLabel();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(svv.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: false});
  });

  // The backend drops labels whose imagery its own check can't confirm, so the list a mission starts with can arrive
  // short of what that mission needs — the same failure, one layer up. It is owed replacements from the outset.

  test('a list that arrives short of what the mission needs asks for the difference', async () => {
    const labelContainer = await buildContainer([{labelId: 1, panoId: 'panoA'}], 3);
    topUpQueue.push([{labelId: 7, panoId: 'panoG'}, {labelId: 8, panoId: 'panoH'}]);

    await labelContainer.moveToNextLabel();

    expect(topUpBodies[0].labels_needed).toBe(2);
    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(7);
    expect(svv.modalNoNewMission.show).not.toHaveBeenCalled();
  });

  test('a resumed mission counts only the labels it still needs, not a whole mission', async () => {
    // 10-label mission, 7 already validated in an earlier session, and only 2 of the 3 remaining came back.
    const labelContainer = await LabelContainer.create(
      [{labelId: 1, panoId: 'panoA'}, {labelId: 2, panoId: 'panoB'}],
      {label_type_id: LABEL_TYPE_ID, labels_validated: 10, labels_progress: 7},
    );
    topUpQueue.push([{labelId: 9, panoId: 'panoI'}]);

    await labelContainer.moveToNextLabel();
    await labelContainer.moveToNextLabel();

    expect(topUpBodies[0].labels_needed).toBe(1);
  });

  test('a short list with nothing to replace it reads as no labels left, not an imagery failure', async () => {
    const labelContainer = await buildContainer([{labelId: 1, panoId: 'panoA'}], 3);

    await labelContainer.moveToNextLabel();

    expect(topUpBodies).toHaveLength(1);
    expect(svv.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: false});
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
