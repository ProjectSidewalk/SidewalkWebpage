/**
 * Tests for Validate's handling of a label whose imagery no viewer can render (issue #4810), across
 * frontend/js/validate/panorama/PanoManager.js (`setPanorama` / `#clearViewer`) and
 * frontend/js/validate/label/LabelContainer.js (`renderCurrentLabel` / `#loadPanoForCurrentLabel`).
 *
 * The failure this pins down is silent by nature: neither viewer clears itself when a load fails, so the validator
 * was left looking at the *previous* label's panorama with the new label's marker drawn on it, and asked whether
 * that label was correct. So the assertions are about what is NOT there — no stale canvas, no marker over it, and
 * no label card / validation menu for a label nobody can see.
 *
 * The PanoManager suite drives the REAL `PanoManager.create` factory and the REAL `PanoMarker` class against a fake
 * viewer whose `setPano` can be made to reject; the LabelContainer suite drives the REAL container against a fake
 * PanoManager, since what it needs from one is exactly the `{panoData, reason}` contract the first suite pins.
 *
 * A pano that exists but loaded too slowly is not unrenderable (#5581): its label goes to the back of the queue once
 * and is dropped only if it is slow again, so a slow CDN no longer ends missions at the imagery-unavailable modal.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker, fakePanoOverlays } from './fakes.js';
import { FakeLabel, fakeLabelContainerDeps, buildLabelContainer } from './support/labelContainerHarness.js';

fakePanoOverlays();

mockModule('frontend/js/validate/label/Label.js', () => ({Label: FakeLabel}));

/** @type {Function} The LabelContainer class under test. */
let LabelContainer;

/** @type {Record<string, any>} The collaborators the container under test is built over. */
let deps;

/** @returns {HTMLElement} A stand-in for an element Validate dims or re-cursors. */
function fakeElement() {
  return document.createElement('div');
}

/** @returns {boolean} Whether the busy state has been taken off every element it covers, cursor included. */
function uiReleased() {
  return deps.ui.busyRegion.every((el) => !el.classList.contains('validate-disabled'))
    && deps.ui.holder.style.cursor === '';
}

describe('PanoManager clears the pano when no viewer can render it (issue #4810)', () => {
  let panoManager;
  let fakeViewer;
  let panoData;
  let PanoLoadTimeoutError;

  beforeEach(async () => {
    document.body.innerHTML
      = '<div id="pano-holder"><div id="svv-panorama"></div></div><div id="view-control-layer"></div>';

    // jsdom has no WebGL, so PanoMarker falls back to the 2d projection; where the marker lands is irrelevant here.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    window.i18next = {t: () => 'Curb ramp'};

    panoData = {getPanoId: () => 'pano1', getProperty: () => new Date(2026, 5)};
    fakeViewer = {
      setPano: vi.fn(() => Promise.resolve(panoData)),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      resize: vi.fn(),
      setPov: vi.fn(),
      getPov: () => ({heading: 0, pitch: 0, zoom: 1}),
      getViewerType: () => 'gsv',
    };
    const FakeViewerType = class FakeViewerType {
      static create() { return Promise.resolve(fakeViewer); }
    };

    // Loaded together so the timeout error the test throws is the class PanoManager checks for.
    const modules = await loadModules('frontend/js/validate/panorama/PanoManager.js',
      'frontend/js/common/pano-viewer/PanoLoadTimeoutError.js');
    PanoLoadTimeoutError = modules.PanoLoadTimeoutError;
    const viewerUi = {date: {textContent: ''}, controlLayer: document.getElementById('view-control-layer')};
    panoManager = await modules.PanoManager.create('token', viewerUi, {viewerType: FakeViewerType, labelRadius: 10},
      {addPanoMetadata: vi.fn()}, {}, fakeTracker());
  });

  afterEach(() => {
    document.body.innerHTML = '';
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
      getProperty: (key) => (key === 'newLabelType' ? auditProps.labelType : undefined),
      getIconUrl: () => '/assets/fake-icon.svg',
      getIconColor: () => '#abcdef', // arbitrary test value, not a real label-type color
    };
  }

  test('creating the manager loads no pano, so the first label\'s setPanorama is its only load (#5581)', async () => {
    // A load here as well would make the first label pay two deadlines on a slow network before anything shows.
    expect(fakeViewer.setPano).not.toHaveBeenCalled();

    await panoManager.setPanorama('pano1', null);
    expect(fakeViewer.setPano).toHaveBeenCalledTimes(1);
  });

  test('a load both viewers fail reports failure rather than passing off the pano that is still up', async () => {
    fakeViewer.setPano = vi.fn(() => Promise.reject(new Error('imagery unavailable')));

    // No backup image, so Pannellum is never tried either.
    await expect(panoManager.setPanorama('pano2', null)).resolves.toEqual({panoData: null, reason: 'no-imagery'});
    expect(panoManager.getProperty('panoLoaded')).toBe(false);
  });

  test('the previous label\'s imagery and marker are taken down, not left under the next label', async () => {
    panoManager.renderPanoMarker(makeLabel());
    expect(document.getElementById('validate-pano-marker')).not.toBeNull();

    fakeViewer.setPano = vi.fn(() => Promise.reject(new Error('imagery unavailable')));
    await panoManager.setPanorama('pano2', null);

    expect(document.getElementById('svv-panorama').style.display).toBe('none');
    expect(document.getElementById('svv-panorama-pannellum').style.display).toBe('none');
    expect(document.getElementById('validate-pano-marker')).toBeNull();
  });

  test('a primary load that timed out on a pano that exists is reported as slow, not as no imagery', async () => {
    fakeViewer.setPano = vi.fn(() => Promise.reject(new PanoLoadTimeoutError('pano2', 12000)));

    await expect(panoManager.setPanorama('pano2', null)).resolves.toEqual({panoData: null, reason: 'slow'});
  });

  test('prefetchPano is handed to the primary viewer', () => {
    fakeViewer.prefetchPano = vi.fn();
    panoManager.prefetchPano('pano9');
    expect(fakeViewer.prefetchPano).toHaveBeenCalledWith('pano9');
  });

  test('the next label that does load brings the pano back', async () => {
    fakeViewer.setPano = vi.fn(() => Promise.reject(new Error('imagery unavailable')));
    await panoManager.setPanorama('pano2', null);

    fakeViewer.setPano = vi.fn(() => Promise.resolve(panoData));
    await expect(panoManager.setPanorama('pano3', null)).resolves.toEqual({panoData});

    expect(document.getElementById('svv-panorama').style.display).toBe('');
    expect(panoManager.getProperty('panoLoaded')).toBe(true);
  });
});

describe('LabelContainer drops labels it cannot show (issue #4810)', () => {
  const LABEL_TYPE = 'Obstacle';
  let unrenderablePanoIds;
  let slowLoadsLeft; // Per pano, how many more loads come back slow before one succeeds.
  let topUpQueue;   // Successive `labels` arrays the /moreLabels endpoint answers with.
  let topUpBodies;  // Request bodies it was asked with, so the exclusion list can be asserted.

  beforeEach(async () => {
    unrenderablePanoIds = new Set();
    slowLoadsLeft = new Map();
    topUpQueue = [];
    topUpBodies = [];

    vi.stubGlobal('fetch', vi.fn((url, options) => {
      topUpBodies.push(JSON.parse(options.body));
      return Promise.resolve({ok: true, json: () => Promise.resolve({labels: topUpQueue.shift() ?? []})});
    }));
    window.i18next = {t: vi.fn((key) => key)};

    deps = fakeLabelContainerDeps({
      adminVersion: false,
      tracker: fakeTracker(),
      labelCard: {render: vi.fn()},
      validationMenu: {resetMenu: vi.fn()},
      undoValidation: {enableUndo: vi.fn(), disableUndo: vi.fn()},
      labelVisibilityControl: {
        hideLabelCard: vi.fn(),
        unhideLabel: vi.fn(),
        openCardOnLoad: vi.fn(),
        isVisible: () => true,
      },
      modalNoNewMission: {show: vi.fn()},
      validateParams: {admin_version: false, unvalidated_only: false},
      ui: {
        holder: fakeElement(),
        busyRegion: [fakeElement(), fakeElement()],
        viewer: {controlLayer: fakeElement()},
      },
      panoManager: {
        renderPanoMarker: vi.fn(),
        prefetchPano: vi.fn(),
        setPanorama: vi.fn((panoId) => {
          if (unrenderablePanoIds.has(panoId)) return Promise.resolve({panoData: null, reason: 'no-imagery'});
          if (slowLoadsLeft.get(panoId) > 0) {
            slowLoadsLeft.set(panoId, slowLoadsLeft.get(panoId) - 1);
            return Promise.resolve({panoData: null, reason: 'slow'});
          }
          return Promise.resolve({panoData: {panoId}});
        }),
      },
      panoLoadingStatus: {begin: vi.fn(), setMessage: vi.fn(), end: vi.fn()},
    });

    ({ LabelContainer } = await loadModules('frontend/js/validate/label/LabelContainer.js'));
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
    return buildLabelContainer(LabelContainer, deps, labelList, LABEL_TYPE);
  }

  /** @returns {Array<number>} The label ids the validation UI was actually asked to render, in order. */
  function renderedLabelIds() {
    return deps.panoManager.renderPanoMarker.mock.calls.map(([label]) => label.getAuditProperty('labelId'));
  }

  test('the unrenderable label is passed over and the next one is shown in its place', async () => {
    unrenderablePanoIds.add('panoB');
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();

    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(3);
    expect(renderedLabelIds()).toEqual([1, 3]);
    // Nothing about the dropped label reaches the UI that asks for a verdict on it.
    expect(deps.labelCard.render).toHaveBeenCalledTimes(2);
    expect(deps.validationMenu.resetMenu).toHaveBeenCalledTimes(2);
  });

  test('dropping a label is logged, since it is invisible to the user by design', async () => {
    unrenderablePanoIds.add('panoB');
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();

    expect(deps.tracker.push).toHaveBeenCalledWith('LabelSkipped_NoImagery', {labelId: 2, panoId: 'panoB'});
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
    // Label 1 was validated, so it isn't a label the mission is short of: nothing is dropped or owed for it.
    expect(deps.tracker.push)
      .toHaveBeenCalledWith('ValidateUndo_ImageryUnavailable', {labelId: 1, panoId: 'panoA', reason: 'no-imagery'});
    expect(deps.tracker.push).not.toHaveBeenCalledWith('LabelSkipped_NoImagery', expect.anything());
  });

  test('a dropped label is replaced, so the queue never runs short of what the mission needs', async () => {
    unrenderablePanoIds.add('panoC');
    topUpQueue.push([{labelId: 4, panoId: 'panoD'}]);
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel(); // label 2
    await labelContainer.moveToNextLabel(); // label 3 is unrenderable; its replacement comes back instead

    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(4);
    expect(renderedLabelIds()).toEqual([1, 2, 4]);
    expect(deps.modalNoNewMission.show).not.toHaveBeenCalled();
  });

  test('the replacement request names the mission\'s label type and every label it has held', async () => {
    unrenderablePanoIds.add('panoC');
    topUpQueue.push([{labelId: 4, panoId: 'panoD'}]);
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();
    await labelContainer.moveToNextLabel();

    expect(window.fetch).toHaveBeenCalledWith('/validationTask/moreLabels', expect.objectContaining({method: 'POST'}));
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
    expect(deps.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: true});
  });

  test('when the backend has no replacement to give, the modal says imagery, not "nothing left"', async () => {
    unrenderablePanoIds.add('panoA');
    unrenderablePanoIds.add('panoB');
    unrenderablePanoIds.add('panoC');

    await buildContainer();

    expect(deps.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: true});
    expect(deps.panoManager.renderPanoMarker).not.toHaveBeenCalled();
    expect(deps.labelCard.render).not.toHaveBeenCalled();
  });

  test('a failed replacement request falls back to the modal instead of throwing', async () => {
    unrenderablePanoIds.add('panoC');
    window.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();
    await labelContainer.moveToNextLabel();

    expect(deps.tracker.push).toHaveBeenCalledWith('LabelTopUpFailed', {error: 'offline'});
    expect(deps.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: true});
  });

  // Only a dropped label buys a replacement request. A queue that empties on its own — including one the backend
  // handed over short — means the backend has nothing more to give, so asking again would just repeat the question.

  test('running out with nothing dropped asks for nothing and reads as no labels left', async () => {
    const labelContainer = await buildContainer([{labelId: 1, panoId: 'panoA'}]);

    await labelContainer.moveToNextLabel();

    expect(window.fetch).not.toHaveBeenCalled();
    expect(deps.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: false});
  });

  // A label is dropped as soon as its imagery fails, which is usually mid-queue, but the queue only empties — and the
  // modal only appears — some labels later. The reason for the dead end has to survive that gap.
  test('a label dropped earlier in the mission still reads as an imagery problem at the end', async () => {
    unrenderablePanoIds.add('panoB');
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel(); // Drops label 2 and shows label 3 in its place.
    await labelContainer.moveToNextLabel(); // Nothing left, and the backend has no replacement to give.

    expect(topUpBodies).toHaveLength(1);
    expect(deps.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: true});
  });

  // On desktop the modals are rendered inside #svv-application-holder, which renderCurrentLabel covers with
  // `validate-disabled` (pointer-events: none) while a label loads. Every exit has to hand the UI back or the modal's
  // own button is dead.

  test('the UI is released before a modal is shown, so its button can be clicked', async () => {
    unrenderablePanoIds.add('panoA');
    unrenderablePanoIds.add('panoB');
    unrenderablePanoIds.add('panoC');

    await buildContainer();

    expect(uiReleased()).toBe(true);
    expect(deps.modalNoNewMission.show).toHaveBeenCalled();
  });

  test('the UI is released on the ordinary path too', async () => {
    await buildContainer();

    expect(uiReleased()).toBe(true);
  });

  test('a render that throws before the marker is drawn reveals the loaded pano before the tool unlocks', async () => {
    // Otherwise a canvas held unpainted for the reveal (#5582) stays blank under a tool that accepts verdicts again.
    deps.panoManager.revealPendingCanvas = vi.fn();
    deps.labelCard.render = vi.fn(() => { throw new Error('card broke'); });

    await expect(buildContainer()).rejects.toThrow('card broke');

    expect(deps.panoManager.revealPendingCanvas).toHaveBeenCalled();
    expect(uiReleased()).toBe(true);
  });

  test('a marker that fails to draw still hands the label to the card and the menu', async () => {
    // The tool unlocks either way; a menu left on the previous label's verdict would skip this one on the next click.
    deps.panoManager.renderPanoMarker = vi.fn(() => Promise.reject(new Error('draw broke')));

    await expect(buildContainer()).rejects.toThrow('draw broke');

    expect(deps.labelCard.render).toHaveBeenCalled();
    expect(deps.validationMenu.resetMenu).toHaveBeenCalled();
    expect(uiReleased()).toBe(true);
  });

  test('a status that comes into view is logged against the label loading under it', async () => {
    // How prod counts loads slow enough to be seen that still succeed (#5581).
    deps.panoLoadingStatus.begin = vi.fn((onShown) => onShown());

    await buildContainer();

    expect(deps.tracker.push).toHaveBeenCalledWith('PanoLoadingStatus_Shown', {labelId: 1, panoId: 'panoA'});
  });

  test('no loading status starts while the mission-complete modal covers the pano', async () => {
    deps.modalMissionComplete.isShowing = () => true;
    await buildContainer();
    expect(deps.panoLoadingStatus.begin).not.toHaveBeenCalled();

    // Once the modal is gone the next load gets its status again.
    deps.modalMissionComplete.isShowing = () => false;
    deps.panoLoadingStatus.begin.mockClear();
    const labelContainer = await buildContainer();
    await labelContainer.moveToNextLabel();
    expect(deps.panoLoadingStatus.begin).toHaveBeenCalled();
  });

  test('the next two labels\' panos are prefetched once a label is on screen', async () => {
    const labelContainer = await buildContainer();
    expect(deps.panoManager.prefetchPano.mock.calls.map(([panoId]) => panoId)).toEqual(['panoB', 'panoC']);

    deps.panoManager.prefetchPano.mockClear();
    await labelContainer.moveToNextLabel();
    // The queue ends at C, so only it is left to warm; nothing is fetched past the end.
    expect(deps.panoManager.prefetchPano.mock.calls.map(([panoId]) => panoId)).toEqual(['panoC']);
  });
});

describe('LabelContainer defers a label whose pano is slow rather than dropping it (issue #5581)', () => {
  const LABEL_TYPE = 'Obstacle';
  let slowLoadsLeft; // Per pano, how many more loads come back slow before one succeeds.
  let topUpBodies;

  beforeEach(async () => {
    slowLoadsLeft = new Map();
    topUpBodies = [];

    vi.stubGlobal('fetch', vi.fn((url, options) => {
      topUpBodies.push(JSON.parse(options.body));
      return Promise.resolve({ok: true, json: () => Promise.resolve({labels: []})});
    }));
    window.i18next = {t: vi.fn((key) => key)};
    deps = fakeLabelContainerDeps({
      adminVersion: false,
      tracker: fakeTracker(),
      labelCard: {render: vi.fn()},
      validationMenu: {resetMenu: vi.fn()},
      undoValidation: {enableUndo: vi.fn(), disableUndo: vi.fn()},
      labelVisibilityControl: {
        hideLabelCard: vi.fn(),
        unhideLabel: vi.fn(),
        openCardOnLoad: vi.fn(),
        isVisible: () => true,
      },
      modalNoNewMission: {show: vi.fn()},
      validateParams: {admin_version: false, unvalidated_only: false},
      ui: {
        holder: fakeElement(),
        busyRegion: [fakeElement(), fakeElement()],
        viewer: {controlLayer: fakeElement()},
      },
      panoManager: {
        renderPanoMarker: vi.fn(),
        prefetchPano: vi.fn(),
        setPanorama: vi.fn((panoId) => {
          if (slowLoadsLeft.get(panoId) > 0) {
            slowLoadsLeft.set(panoId, slowLoadsLeft.get(panoId) - 1);
            return Promise.resolve({panoData: null, reason: 'slow'});
          }
          return Promise.resolve({panoData: {panoId}});
        }),
      },
      panoLoadingStatus: {begin: vi.fn(), setMessage: vi.fn(), end: vi.fn()},
    });

    ({ LabelContainer } = await loadModules('frontend/js/validate/label/LabelContainer.js'));
  });

  /** @returns {Promise<LabelContainer>} A container over three labels, one per pano, with its first label shown. */
  function buildContainer() {
    return buildLabelContainer(LabelContainer, deps,
        [{labelId: 1, panoId: 'panoA'}, {labelId: 2, panoId: 'panoB'}, {labelId: 3, panoId: 'panoC'}], LABEL_TYPE);
  }

  /** @returns {Array<number>} The label ids the validation UI was actually asked to render, in order. */
  function renderedLabelIds() {
    return deps.panoManager.renderPanoMarker.mock.calls.map(([label]) => label.getAuditProperty('labelId'));
  }

  /** @returns {Array<string>} The tracker events pushed so far, by name. */
  function events() {
    return deps.tracker.push.mock.calls.map(([name]) => name);
  }

  test('a slow label goes to the back of the queue, and the next label is shown in its place', async () => {
    slowLoadsLeft.set('panoB', 1);
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();
    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(3);

    await labelContainer.moveToNextLabel();
    // It came back at the end and loaded on the second try, so the mission never lost it.
    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(2);
    expect(renderedLabelIds()).toEqual([1, 3, 2]);
  });

  test('deferring is logged, owes nothing, and keeps the provider working on the pano', async () => {
    slowLoadsLeft.set('panoB', 1);
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();

    expect(deps.tracker.push)
      .toHaveBeenCalledWith('LabelDeferred_SlowImagery', {labelId: 2, panoId: 'panoB', attempt: 1});
    expect(events()).not.toContain('LabelSkipped_NoImagery');
    expect(events()).not.toContain('LabelSkipped_SlowImagery');
    expect(deps.panoManager.prefetchPano).toHaveBeenCalledWith('panoB');
    expect(window.fetch).not.toHaveBeenCalled(); // No replacement is asked for: the label is still in the mission.
  });

  test('the validator is told the tool is moving on, not left watching a frozen pano', async () => {
    slowLoadsLeft.set('panoB', 1);
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel();

    expect(deps.panoLoadingStatus.setMessage).toHaveBeenCalledWith('validate:pano-loading.skipping');
    expect(deps.panoLoadingStatus.end).toHaveBeenCalled();
  });

  test('a label slow a second time is dropped as slow and replaced like any other dropped label', async () => {
    slowLoadsLeft.set('panoB', 2);
    const labelContainer = await buildContainer();

    await labelContainer.moveToNextLabel(); // Defers label 2, shows label 3.
    await labelContainer.moveToNextLabel(); // Label 2 again, slow again: dropped, and the backend has no replacement.

    expect(deps.tracker.push).toHaveBeenCalledWith('LabelSkipped_SlowImagery', {labelId: 2, panoId: 'panoB'});
    expect(events()).not.toContain('LabelSkipped_NoImagery');
    expect(topUpBodies).toHaveLength(1);
    expect(topUpBodies[0].labels_needed).toBe(1);
    expect(deps.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: true});
  });

  test('the last label left comes straight back without claiming to try another', async () => {
    slowLoadsLeft.set('panoC', 1);
    const labelContainer = await buildContainer();
    await labelContainer.moveToNextLabel();

    await labelContainer.moveToNextLabel(); // Label 3 is slow, and nothing is queued behind it.

    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(3);
    expect(deps.panoLoadingStatus.setMessage).not.toHaveBeenCalled();
  });

  test('when every pano is slow twice the mission still ends at the imagery modal', async () => {
    slowLoadsLeft.set('panoA', 2);
    slowLoadsLeft.set('panoB', 2);
    slowLoadsLeft.set('panoC', 2);

    await buildContainer();

    // The third slow load in a row opens the breaker: from then on, slow labels are dropped on their first try.
    expect(events().filter((name) => name === 'LabelDeferred_SlowImagery')).toHaveLength(2);
    expect(events().filter((name) => name === 'LabelSkipped_SlowImagery')).toHaveLength(3);
    // Replacements would come from the network that just failed every load, so none are asked for.
    expect(window.fetch).not.toHaveBeenCalled();
    expect(deps.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: true});
    expect(deps.panoManager.renderPanoMarker).not.toHaveBeenCalled();
  });

  test('the third slow load in a row is dropped on its first try instead of deferred', async () => {
    slowLoadsLeft.set('panoA', 1);
    slowLoadsLeft.set('panoB', 1);
    slowLoadsLeft.set('panoC', 1);

    const labelContainer = await buildContainer();

    // A and B are deferred; C, the third slow load with nothing loading in between, is dropped at once and owed.
    expect(deps.tracker.push).toHaveBeenCalledWith('LabelSkipped_SlowImagery', {labelId: 3, panoId: 'panoC'});
    expect(events().filter((name) => name === 'LabelDeferred_SlowImagery')).toHaveLength(2);
    // Deferred labels still get their second try: A loads on it, which is the success that ends the streak.
    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(1);
  });

  test('a load that succeeds resets the slow streak, so the next slow label is deferred again', async () => {
    slowLoadsLeft.set('panoB', 1);
    slowLoadsLeft.set('panoC', 1);
    slowLoadsLeft.set('panoE', 1);
    const labelContainer = await buildLabelContainer(LabelContainer, deps, [
      {labelId: 1, panoId: 'panoA'}, {labelId: 2, panoId: 'panoB'}, {labelId: 3, panoId: 'panoC'},
      {labelId: 4, panoId: 'panoD'}, {labelId: 5, panoId: 'panoE'},
    ], LABEL_TYPE);

    await labelContainer.moveToNextLabel(); // B and C are slow (a streak of two), then D loads and ends it.
    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(4);
    await labelContainer.moveToNextLabel(); // E is slow: one in a row, so deferred rather than dropped.

    expect(deps.tracker.push).toHaveBeenCalledWith('LabelDeferred_SlowImagery', {labelId: 5, panoId: 'panoE', attempt: 1});
    expect(events()).not.toContain('LabelSkipped_SlowImagery');
  });

  test('an undo into a slow label is abandoned: the validated label is never deferred, owed or served again', async () => {
    const labelContainer = await buildContainer();
    await labelContainer.moveToNextLabel(); // Label 1 validated, label 2 on screen.
    slowLoadsLeft.set('panoA', 1);

    expect(await labelContainer.undoLabel()).toBe(false);

    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(2);
    expect(deps.tracker.push)
      .toHaveBeenCalledWith('ValidateUndo_ImageryUnavailable', {labelId: 1, panoId: 'panoA', reason: 'slow'});
    expect(events()).not.toContain('LabelDeferred_SlowImagery');
    expect(deps.panoLoadingStatus.setMessage).not.toHaveBeenCalledWith('validate:pano-loading.skipping');

    await labelContainer.moveToNextLabel(); // Label 3.
    await labelContainer.moveToNextLabel(); // The end: label 1 doesn't come back, and nothing was owed.
    expect(renderedLabelIds()).toEqual([1, 2, 2, 3]);
    expect(window.fetch).not.toHaveBeenCalled();
    expect(deps.modalNoNewMission.show).toHaveBeenCalledWith({imageryUnavailable: false});
  });
});
