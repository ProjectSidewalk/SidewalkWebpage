/**
 * Tests that Validate's start-up (frontend/js/validate/Main.js) hooks everything that describes a label to
 * LabelContainer's `onLabelReady`, `onLabelShown` and `onLoadingChange` events (#5648). Every LabelContainer suite re-creates that
 * wiring by hand, so none would notice a subscriber Main stopped building or built after the first label rendered.
 *
 * The real Main drives the real container and subscribers on the Expert Validate desktop layout, the one with every
 * subscriber; each listener's body is stubbed, since what it does with the label is its own suite's business.
 */

import { loadModules, loadVendored, mockModule, useUtil } from './loader.js';
import { fakeTracker } from './fakes.js';

/** @type {Record<string, any>} The heavy collaborators' stand-ins, by export name; the mocks hand them to Main. */
let fakes = {};

/** Every module Main builds a faked collaborator from, path to the export it takes. The subscribers stay real. */
const FAKED_EXPORTS = {
  'frontend/js/common/BadgeAchievements.js': 'BadgeAchievements',
  'frontend/js/common/ImmersiveMode.js': 'ImmersiveMode',
  'frontend/js/common/LabelCardView.js': 'LabelCardView',
  'frontend/js/common/LabelVisibilityToggle.js': 'LabelVisibilityToggle',
  'frontend/js/common/MissionStartTutorial.js': 'MissionStartTutorial',
  'frontend/js/common/PanoImageAdjustments.js': 'PanoImageAdjustments',
  'frontend/js/common/PanoImageAdjustmentsPopover.js': 'PanoImageAdjustmentsPopover',
  'frontend/js/common/Toast.js': 'Toast',
  'frontend/js/common/pano-viewer/Infra3dViewer.js': 'Infra3dViewer',
  'frontend/js/common/pano-viewer/PanoImageCache.js': 'PanoImageCache',
  'frontend/js/common/pano-viewer/PanoInfoPopover.js': 'PanoInfoPopover',
  'frontend/js/common/pano-viewer/PanoStore.js': 'PanoStore',
  'frontend/js/validate/Tracker.js': 'Tracker',
  'frontend/js/validate/data/Form.js': 'Form',
  'frontend/js/validate/label/Label.js': 'Label',
  'frontend/js/validate/modal/ModalMission.js': 'ModalMission',
  'frontend/js/validate/modal/ModalMissionComplete.js': 'ModalMissionComplete',
  'frontend/js/validate/modal/ModalNoNewMission.js': 'ModalNoNewMission',
  'frontend/js/validate/panorama/PanoControlMenu.js': 'PanoControlMenu',
  'frontend/js/validate/panorama/PanoLoadingStatus.js': 'PanoLoadingStatus',
  'frontend/js/validate/panorama/PanoManager.js': 'PanoManager',
  'frontend/js/validate/panorama/PanoOverlay.js': 'PanoOverlay',
  'frontend/js/validate/status/StatusField.js': 'StatusField',
  'frontend/js/validate/util/MissionLiveMarker.js': 'MissionLiveMarker',
};
for (const [path, name] of Object.entries(FAKED_EXPORTS)) mockModule(path, () => ({ [name]: fakes[name] }));

/**
 * The desktop view's elements, trimmed to what the real subscribers need to build: the verdict menu's buttons and
 * boxes, the label card and its toggles, the speed-limit sign, the zoom buttons and the admin popover. Elements
 * Main collects that only the faked modules read are left out and come back null, as they do on the phone.
 */
const FIXTURE = `
  <div id="page-loading"></div>
  <div class="tool-ui ps-invisible">
    <div id="svv-application-holder">
      <h1 id="mission-title"></h1>
      <div id="admin-info-section">
        <button type="button" id="admin-info-button"></button>
        <div id="admin-info-popover"></div>
      </div>
      <template id="admin-info-template"><div id="admin-info-content"></div></template>
      <div id="svv-panorama-holder">
        <div id="view-control-layer"></div>
        <div id="label-card"><button type="button" id="label-visibility-button-on-label"></button></div>
        <div id="speed-limit-sign"><span id="speed-limit"></span><span id="speed-limit-sub"></span></div>
        <button type="button" id="label-visibility-control-button"></button>
        <button type="button" id="zoom-in-button"></button>
        <button type="button" id="zoom-out-button"></button>
        <div id="svv-panorama-date-holder"><span id="svv-panorama-date"></span></div>
      </div>
      <div id="validation-menu-holder">
        <h2 id="main-validate-header"></h2>
        <button type="button" id="validate-yes-button"></button>
        <button type="button" id="validate-no-button"></button>
        <button type="button" id="validate-unsure-button"></button>
        <div id="validate-label-type-section"><div id="label-type-picker"></div></div>
        <template id="current-tag-template"><div class="current-tag"></div></template>
        <div id="validate-tags-section">
          <div id="current-tags-list"></div>
          <div id="sidewalk-ai-suggestions-block"><template id="sidewalk-ai-suggested-tag-template"><div></div></template></div>
          <select id="select-tag"></select>
        </div>
        <div id="validate-severity-section"><div id="severity-radio-holder"></div></div>
        <div id="validate-optional-comment-section"><input id="add-optional-comment"></div>
        <div id="validate-why-no-section"><div id="no-reason-options">
          <button type="button" id="no-button-1" class="validation-reason-button"></button>
          <input id="add-disagree-comment">
        </div></div>
        <div id="validate-why-unsure-section"><div id="unsure-reason-options">
          <button type="button" id="unsure-button-1" class="validation-reason-button"></button>
          <input id="add-unsure-comment">
        </div></div>
        <button type="button" id="validate-undo-button"></button>
        <button type="button" id="validate-submit-button" disabled></button>
      </div>
    </div>
  </div>`;

/** The page's session scalars, as the view's page-data block carries them. */
const PARAM = {
  validateParams: { admin_version: true },
  viewerType: class FakeViewerType {},
  tagList: [{ label_type: 'Obstacle', tag_name: 'pole' }],
  dataStoreUrl: '/validate/store',
  viewerAccessToken: 'token',
  language: 'en',
  countryId: 'usa',
  missionUrl: '/validationTask/mission',
};

/** @returns {Record<string, any>} What /validationTask/mission answers for a mission of three Obstacle labels. */
function firstMission() {
  return {
    has_mission_available: true,
    mission: {
      mission_id: 7, mission_type: 'validation', label_type: 'Obstacle', labels_progress: 0, labels_validated: 3,
      completed: false,
    },
    labels: [1, 2, 3].map((n) => ({ labelId: n, panoId: `pano${n}`, labelType: 'Obstacle' })),
    progress: { agree_count: 0, disagree_count: 0, unsure_count: 0 },
    completed_validations: 0,
  };
}

let Main;
let LabelCard;
let LabelVisibilityControl;
let DesktopValidationMenu;
let AdminInfo;
let SpeedLimit;
let ZoomControl;
let Gate;
let UndoValidation;
/** @type {{takeUnexpectedUnload: import('vitest').Mock, markLive: import('vitest').Mock}} The live marker Main builds, per test. */
let marker;
/** @type {boolean} Set as the fake PanoManager's create() runs, so the fake Form can say which came first. */
let viewerCreated;
/** @type {boolean} What the fake Form found when Main built it. */
let formBuiltBeforeViewer;
/**
 * @type {?{holdsTaken: string[], hooks: Record<string, any>}} The keyboard holds already taken when Main built the
 * mission-start tutorial, and the hooks it was handed.
 */
let tutorialBuilt;

/** @type {Record<string, any>} The tracker Main builds, per test. */
let tracker;
/** @type {Record<string, any>} The pano manager Main's viewer load answers with, per test. */
let panoManager;

beforeAll(async () => {
  window.matchMedia = () => /** @type {MediaQueryList} */ ({ matches: true }); // jsdom has none; act as a mouse.
  window.structuredClone ??= (v) => JSON.parse(JSON.stringify(v)); // Missing from this jsdom.
  loadVendored('tom-select'); // The tag box, which the Expert Validate menu builds in its constructor.
  useUtil({
    // jsdom lays nothing out, so the real one would size the tool from empty computed styles.
    applyToolScale: () => 1,
    // The real one fetches the severity icons over the network.
    getImage: () => Promise.resolve(''),
  });
  window.i18next = { t: (key) => key, isInitialized: false, language: 'en' };

  fakes = {
    // Only the surface the container and the subscribers' constructors read off a label.
    Label: class {
      constructor(params) {
        this.auditProps = params;
        this.props = {};
      }

      getAuditProperty(key) { return this.auditProps[key] ?? null; }
      getProperty(key) { return this.props[key]; }
      setProperty(key, value) { this.props[key] = value; }
    },
    // The heavy collaborators, faked down to the calls Main and the real subscribers make while building. Those
    // built per test read the current test's object as Main builds them.
    BadgeAchievements: { seedCounts: vi.fn() },
    Toast: { show: vi.fn(), repositionAll: vi.fn() },
    ImmersiveMode: class { isActive() { return false; } logRestored() {} },
    MissionStartTutorial: class {
      constructor(missionType, labelType, data, hooks) {
        // The test spies on the prototype before start(), so the calls so far are on the spy.
        const hold = /** @type {import('vitest').MockInstance} */ (/** @type {unknown} */ (Gate.prototype.hold));
        tutorialBuilt = { holdsTaken: hold.mock.calls.map((call) => call[0]), hooks };
      }
    },
    PanoImageAdjustments: class { isDefault() { return true; } onChange() {} values() { return {}; } },
    PanoImageAdjustmentsPopover: class {},
    PanoControlMenu: class { setCollapsedIndicator() {} },
    PanoImageCache: class {},
    PanoStore: class { addPanoMetadata() {} getPanoData() { return { getProperty: () => null }; } },
    PanoInfoPopover: class {},
    Form: class {
      constructor() { formBuiltBeforeViewer = !viewerCreated; }
      attachSession() {}
    },
    ModalMission: class { setMissionMessage() {} },
    ModalMissionComplete: class { isShowing() { return false; } show() {} },
    ModalNoNewMission: class { isShowing() { return false; } show() {} },
    PanoLoadingStatus: class { begin() {} setMessage() {} end() {} },
    PanoOverlay: class {},
    StatusField: class {
      reset() {}
      updateLabelText() {}
      incrementLabelCounts() {}
      decrementLabelCounts() {}
      setProgressBar() {}
      setProgressText() {}
      getCompletedValidations() { return 0; }
    },
    MissionLiveMarker: class { constructor() { return marker; } },
    LabelVisibilityToggle: class { setVisible() {} isVisible() { return true; } },
    LabelCardView: class {},
    Infra3dViewer: class {},
    Tracker: class { constructor() { return tracker; } },
    PanoManager: class { static create() { viewerCreated = true; return Promise.resolve(panoManager); } },
  };

  // One load for the lot, so the classes Main builds are the very ones the spies below are put on.
  ({ Main, LabelCard, LabelVisibilityControl, DesktopValidationMenu, AdminInfo, SpeedLimit, ZoomControl, Gate,
    UndoValidation } = await loadModules(
    'frontend/js/validate/Main.js',
    'frontend/js/validate/label/LabelCard.js',
    'frontend/js/validate/label/LabelVisibilityControl.js',
    'frontend/js/validate/menu/DesktopValidationMenu.js',
    'frontend/js/validate/status/AdminInfo.js',
    'frontend/js/common/SpeedLimit.js',
    'frontend/js/validate/zoom/ZoomControl.js',
    'frontend/js/common/Gate.js',
    'frontend/js/validate/menu/UndoValidation.js',
  ));
});

describe('Main hooks what describes a label to the label container', () => {
  /** @type {Record<string, import('vitest').MockInstance>} Each onLabelReady subscriber's listener, by the subscriber's name. */
  let ready;
  /** @type {Record<string, import('vitest').MockInstance>} Each onLabelShown subscriber's listener, by the subscriber's name. */
  let shown;
  /** @type {Record<string, import('vitest').MockInstance>} What the loading events switch. */
  let loading;

  beforeEach(() => {
    document.body.innerHTML = FIXTURE;
    tracker = fakeTracker();
    marker = { takeUnexpectedUnload: vi.fn(() => null), markLive: vi.fn() };
    tutorialBuilt = null;

    panoManager = {
      setPanorama: vi.fn((panoId) => Promise.resolve({ panoData: { panoId } })),
      renderPanoMarker: vi.fn(),
      prefetchPano: vi.fn(),
      prefetchBackups: vi.fn(),
      blanksPanoWhileLoading: () => false,
      getActiveViewerName: () => 'Default',
      revealPendingCanvas: vi.fn(),
      replayMarkerPulse: vi.fn(),
      setMarkerScale: vi.fn(),
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
      onMarkerCreated: vi.fn(),
      onMarkerDrawn: vi.fn(),
      getPanoMarker: () => null,
      styleMarkerForLabel: vi.fn(),
      panoViewer: {
        resize: vi.fn(),
        repaint: vi.fn(),
        addListener: vi.fn(),
        getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
        getPosition: () => ({ lat: 47.6, lng: -122.3 }),
        getPanoId: () => 'pano1',
        getViewerType: () => 'gsv',
      },
    };
    viewerCreated = false;

    // The listeners' bodies are stubbed: each is pinned by its own suite, and here only the hook is under test.
    const stub = (proto, method) => vi.spyOn(proto, method).mockImplementation(() => {});
    ready = {
      labelCard: stub(LabelCard.prototype, 'render'),
      validationMenu: stub(DesktopValidationMenu.prototype, 'resetMenu'),
      adminInfo: stub(AdminInfo.prototype, 'updateAdminInfo'),
    };
    shown = {
      labelVisibilityControl: stub(LabelVisibilityControl.prototype, 'unhideLabel'),
      cardOnLoad: stub(LabelVisibilityControl.prototype, 'openCardOnLoad'),
      speedLimit: stub(SpeedLimit.prototype, 'refresh'),
      zoomControl: stub(ZoomControl.prototype, 'updateZoomAvailability'),
    };
    loading = {
      keyboardOff: vi.spyOn(Gate.prototype, 'hold'),
      keyboardOn: vi.spyOn(Gate.prototype, 'release'),
      undoOff: vi.spyOn(UndoValidation.prototype, 'disableUndo'),
      undoOn: vi.spyOn(UndoValidation.prototype, 'enableUndo'),
      cardHidden: stub(LabelVisibilityControl.prototype, 'hideLabelCard'),
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** @returns {Promise<Record<string, any>>} The console handle, with the first label on screen. */
  function start() {
    return new Main(PARAM, firstMission()).start();
  }

  /** @returns {number} The order in which a spy's last call landed among all spies' calls. */
  const lastCallOrder = (spy) => spy.mock.invocationCallOrder.at(-1);

  test('every subscriber hears the first label, which renders only once they are all listening', async () => {
    const { labelContainer } = await start();
    const label = labelContainer.getCurrentLabel();

    expect(label.getAuditProperty('labelId')).toBe(1);
    for (const [name, listener] of Object.entries({ ...ready, ...shown })) {
      // The sign reads the viewer once as it is built, before any label is up; the second read is the hook's.
      const expected = name === 'speedLimit' ? 2 : 1;
      // Keyed by name, so the failure says which subscriber Main stopped hooking rather than just "expected 1".
      expect({ [name]: listener.mock.calls.length }).toEqual({ [name]: expected });
    }
    expect(ready.labelCard).toHaveBeenCalledWith(label);
    expect(ready.validationMenu).toHaveBeenCalledWith(label);
    expect(ready.adminInfo).toHaveBeenCalledWith(label);
  });

  test('the same listeners fire again for each later label, from the subscription and not from the build', async () => {
    const { labelContainer } = await start();
    for (const listener of Object.values({ ...ready, ...shown })) listener.mockClear();

    await labelContainer.moveToNextLabel();

    const label = labelContainer.getCurrentLabel();
    expect(label.getAuditProperty('labelId')).toBe(2);
    for (const [name, listener] of Object.entries({ ...ready, ...shown })) {
      expect({ [name]: listener.mock.calls.length }).toEqual({ [name]: 1 });
    }
    expect(ready.labelCard).toHaveBeenCalledWith(label);
    expect(ready.validationMenu).toHaveBeenCalledWith(label);
    expect(ready.adminInfo).toHaveBeenCalledWith(label);
  });

  test('the card, menu and admin panel reset before the marker is drawn; what needs the marker waits for it', async () => {
    const { labelContainer } = await start();
    for (const listener of Object.values({ ...ready, ...shown })) listener.mockClear();
    panoManager.renderPanoMarker.mockClear();

    await labelContainer.moveToNextLabel();

    for (const listener of Object.values(ready)) {
      expect(lastCallOrder(listener)).toBeLessThan(lastCallOrder(panoManager.renderPanoMarker));
    }
    for (const listener of Object.values(shown)) {
      expect(lastCallOrder(listener)).toBeGreaterThan(lastCallOrder(panoManager.renderPanoMarker));
    }
  });

  // The Form owns the exit flush, so a page closed mid-load keeps what it logged only if the Form already exists.
  test('the Form is built before the viewer loads', async () => {
    await start();

    expect(formBuiltBeforeViewer).toBe(true);
  });

  test('a load pauses the keyboard and closes the card, and the keyboard comes back once the label is up', async () => {
    const { labelContainer } = await start();
    for (const spy of Object.values(loading)) spy.mockClear();

    const move = labelContainer.moveToNextLabel();

    // Synchronously, before the pano is even asked for: the next label is already "current" by then (#5211).
    expect(loading.keyboardOff).toHaveBeenCalledTimes(1);
    expect(loading.cardHidden).toHaveBeenCalledTimes(1);
    expect(loading.keyboardOn).not.toHaveBeenCalled();

    await move;

    expect(loading.keyboardOn).toHaveBeenCalledTimes(1);
    expect(lastCallOrder(loading.keyboardOn)).toBeGreaterThan(lastCallOrder(shown.cardOnLoad));
  });

  test('the undo button follows the loads: off for the first label, on once there is one to go back to', async () => {
    const { labelContainer } = await start();
    const undoButton = document.getElementById('validate-undo-button');

    expect(loading.undoOff).toHaveBeenCalled();
    expect(loading.undoOn).not.toHaveBeenCalled();
    expect(undoButton.disabled).toBe(true);

    await labelContainer.moveToNextLabel();

    expect(loading.undoOn).toHaveBeenCalledTimes(1);
    expect(undoButton.disabled).toBe(false);
  });

  test('the tool is revealed only after the first label has been described', async () => {
    const holder = document.querySelector('.tool-ui');
    const loadingOverlay = document.getElementById('page-loading');

    await start();

    expect(holder.classList.contains('ps-invisible')).toBe(false);
    expect(loadingOverlay.style.visibility).toBe('hidden');
    expect(ready.labelCard).toHaveBeenCalledTimes(1);
  });

  test('the shortcuts are wired only once the tool is on screen, so no key acts on the loading screen', async () => {
    const loadingOverlay = document.getElementById('page-loading');
    let overlayWhenWired;
    const addEventListener = window.addEventListener;
    vi.spyOn(window, 'addEventListener').mockImplementation(function (type, ...rest) {
      if (type === 'keydown') overlayWhenWired = loadingOverlay.style.visibility;
      return addEventListener(type, ...rest);
    });

    await start();

    expect(overlayWhenWired).toBe('hidden');
  });

  test('the keyboard is paused when the mission-start tutorial goes up over the first label', async () => {
    await start();

    expect(tutorialBuilt.holdsTaken).toContain('tutorial');
    expect(loading.keyboardOn).not.toHaveBeenCalled();
  });

  // Every mission starts through the briefing screen, which desktop never shows, so a hold of its own there would
  // stand for the whole session: the tutorial's Done is the one release desktop gets.
  test('the tutorial’s Done frees the keyboard: nothing built on the way holds it', async () => {
    await start();
    const lock = /** @type {InstanceType<typeof Gate>} */ (loading.keyboardOff.mock.instances[0]);
    expect(lock.isHeld()).toBe(true);

    tutorialBuilt.hooks.keyboard.enableKeyboard();

    expect(lock.isHeld()).toBe(false);
  });

  test('an unexpected end to the last page life is reported once the first label is up, against the first mission', async () => {
    const report = { missionId: 3, ageSec: 40, navType: 'reload' };
    marker.takeUnexpectedUnload.mockReturnValue(report);

    await start();

    expect(tracker.push).toHaveBeenCalledWith('Validate_UnexpectedUnload', report);
    // Taken only after the first label rendered, so a page killed during that load still leaves the marker for the
    // next life, and just before the mission is marked live, so the row is filed under it when the buffer drains.
    expect(lastCallOrder(marker.takeUnexpectedUnload)).toBeGreaterThan(lastCallOrder(panoManager.renderPanoMarker));
    expect(lastCallOrder(marker.markLive)).toBeGreaterThan(lastCallOrder(marker.takeUnexpectedUnload));
    expect(marker.markLive).toHaveBeenCalledWith(7);
  });
});
