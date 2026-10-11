/**
 * Tests that Validate's start-up (frontend/js/validate/Main.js) hooks everything that describes a label to
 * LabelContainer's `onLabelShown` and `onLoadingChange` events (#5648). Every LabelContainer suite re-creates that
 * wiring by hand, so none would notice a subscriber Main stopped building or built after the first label rendered.
 *
 * The real Main drives the real container and subscribers on the Expert Validate desktop layout, the one with every
 * subscriber; each listener's body is stubbed, since what it does with the label is its own suite's business.
 */

const { assetPathStub, installEscapeHTML, installUtilitiesMisc, loadModules, loadVendored } = require('./loadGlobalScript');

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
let KeyboardLock;
let UndoValidation;

beforeAll(() => {
  window.matchMedia = () => /** @type {MediaQueryList} */ ({ matches: true }); // jsdom has none; act as a mouse.
  window.structuredClone ??= (v) => JSON.parse(JSON.stringify(v)); // Missing from this jsdom.
  loadVendored('tom-select'); // The tag box, which the Expert Validate menu builds in its constructor.
  window.util = {
    assetPath: assetPathStub,
    isMobile: () => false,
    uiScale: () => 1,
    applyToolScale: () => 1,
    camelToKebab: (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
    anchorPanelToLabel: jest.fn(),
    placePopover: jest.fn(),
    getImage: () => Promise.resolve(''),
  };
  installUtilitiesMisc();
  installEscapeHTML();
  window.i18next = { t: (key) => key, isInitialized: false, language: 'en' };

  // Only the surface the container and the subscribers' constructors read off a label.
  window.Label = class {
    constructor(params) {
      this.auditProps = params;
      this.props = {};
    }

    getAuditProperty(key) { return this.auditProps[key] ?? null; }
    getProperty(key) { return this.props[key]; }
    setProperty(key, value) { this.props[key] = value; }
  };

  // The heavy collaborators, faked down to the calls Main and the real subscribers make while building.
  window.BadgeAchievements = { seedCounts: jest.fn() };
  window.Toast = { show: jest.fn(), repositionAll: jest.fn() };
  window.ImmersiveMode = class { isActive() { return false; } logRestored() {} };
  window.MissionStartTutorial = class {};
  window.PanoImageAdjustments = class { isDefault() { return true; } onChange() {} values() { return {}; } };
  window.PanoImageAdjustmentsPopover = class {};
  window.PanoControlMenu = class { setCollapsedIndicator() {} };
  window.PanoImageCache = class {};
  window.PanoStore = class { addPanoMetadata() {} getPanoData() { return { getProperty: () => null }; } };
  window.PanoInfoPopover = class {};
  window.Form = class {};
  window.ModalMission = class { setMissionMessage() {} };
  window.ModalMissionComplete = class { isShowing() { return false; } show() {} };
  window.ModalNoNewMission = class { isShowing() { return false; } show() {} };
  window.PanoLoadingStatus = class { begin() {} setMessage() {} end() {} };
  window.PanoOverlay = class {};
  window.PinchZoomDetector = class {};
  window.StatusField = class {
    reset() {}
    updateLabelText() {}
    incrementLabelCounts() {}
    decrementLabelCounts() {}
    setProgressBar() {}
    setProgressText() {}
    getCompletedValidations() { return 0; }
  };
  window.MissionLiveMarker = class { takeUnexpectedUnload() { return null; } markLive() {} };
  window.LabelVisibilityToggle = class { setVisible() {} isVisible() { return true; } };
  window.LabelCardView = class {};
  window.Infra3dViewer = class {};

  // One load for the lot, so the classes Main builds are the very ones the spies below are put on.
  ({ Main, LabelCard, LabelVisibilityControl, DesktopValidationMenu, AdminInfo, SpeedLimit, ZoomControl, KeyboardLock,
    UndoValidation } = loadModules(
    'frontend/js/validate/Main.js',
    'frontend/js/validate/label/LabelCard.js',
    'frontend/js/validate/label/LabelVisibilityControl.js',
    'frontend/js/validate/menu/DesktopValidationMenu.js',
    'frontend/js/validate/status/AdminInfo.js',
    'frontend/js/common/SpeedLimit.js',
    'frontend/js/validate/zoom/ZoomControl.js',
    'frontend/js/validate/keyboard/KeyboardLock.js',
    'frontend/js/validate/menu/UndoValidation.js',
  ));
});

describe('Main hooks what describes a label to the label container', () => {
  let panoManager;
  let tracker;
  /** @type {Record<string, jest.SpyInstance>} Each subscriber's listener, by the subscriber's name. */
  let shown;
  /** @type {Record<string, jest.SpyInstance>} What the loading events switch. */
  let loading;

  beforeEach(() => {
    document.body.innerHTML = FIXTURE;
    tracker = { push: jest.fn(), flushSoon: jest.fn(), trackMissions: jest.fn(), trackPano: jest.fn(), onFlush: jest.fn() };
    window.Tracker = class { constructor() { return tracker; } };

    panoManager = {
      setPanorama: jest.fn((panoId) => Promise.resolve({ panoData: { panoId } })),
      renderPanoMarker: jest.fn(),
      prefetchPano: jest.fn(),
      prefetchBackups: jest.fn(),
      blanksPanoWhileLoading: () => false,
      getActiveViewerName: () => 'Default',
      revealPendingCanvas: jest.fn(),
      replayMarkerPulse: jest.fn(),
      setMarkerScale: jest.fn(),
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
      onMarkerCreated: jest.fn(),
      onMarkerDrawn: jest.fn(),
      getPanoMarker: () => null,
      styleMarkerForLabel: jest.fn(),
      panoViewer: {
        resize: jest.fn(),
        repaint: jest.fn(),
        addListener: jest.fn(),
        getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
        getPosition: () => ({ lat: 47.6, lng: -122.3 }),
        getPanoId: () => 'pano1',
        getViewerType: () => 'gsv',
      },
    };
    window.PanoManager = class { static create() { return Promise.resolve(panoManager); } };

    // The listeners' bodies are stubbed: each is pinned by its own suite, and here only the hook is under test.
    const stub = (proto, method) => jest.spyOn(proto, method).mockImplementation(() => {});
    shown = {
      labelCard: stub(LabelCard.prototype, 'render'),
      labelVisibilityControl: stub(LabelVisibilityControl.prototype, 'unhideLabel'),
      cardOnLoad: stub(LabelVisibilityControl.prototype, 'openCardOnLoad'),
      validationMenu: stub(DesktopValidationMenu.prototype, 'resetMenu'),
      adminInfo: stub(AdminInfo.prototype, 'updateAdminInfo'),
      speedLimit: stub(SpeedLimit.prototype, 'refresh'),
      zoomControl: stub(ZoomControl.prototype, 'updateZoomAvailability'),
    };
    loading = {
      keyboardOff: jest.spyOn(KeyboardLock.prototype, 'disableKeyboard'),
      keyboardOn: jest.spyOn(KeyboardLock.prototype, 'enableKeyboard'),
      undoOff: jest.spyOn(UndoValidation.prototype, 'disableUndo'),
      undoOn: jest.spyOn(UndoValidation.prototype, 'enableUndo'),
      cardHidden: stub(LabelVisibilityControl.prototype, 'hideLabelCard'),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    for (const [name, listener] of Object.entries(shown)) {
      // The sign reads the viewer once as it is built, before any label is up; the second read is the hook's.
      const expected = name === 'speedLimit' ? 2 : 1;
      // Keyed by name, so the failure says which subscriber Main stopped hooking rather than just "expected 1".
      expect({ [name]: listener.mock.calls.length }).toEqual({ [name]: expected });
    }
    expect(shown.labelCard).toHaveBeenCalledWith(label);
    expect(shown.validationMenu).toHaveBeenCalledWith(label);
    expect(shown.adminInfo).toHaveBeenCalledWith(label);
  });

  test('the same listeners fire again for each later label, from the subscription and not from the build', async () => {
    const { labelContainer } = await start();
    for (const listener of Object.values(shown)) listener.mockClear();

    await labelContainer.moveToNextLabel();

    const label = labelContainer.getCurrentLabel();
    expect(label.getAuditProperty('labelId')).toBe(2);
    for (const [name, listener] of Object.entries(shown)) {
      expect({ [name]: listener.mock.calls.length }).toEqual({ [name]: 1 });
    }
    expect(shown.labelCard).toHaveBeenCalledWith(label);
    expect(shown.validationMenu).toHaveBeenCalledWith(label);
    expect(shown.adminInfo).toHaveBeenCalledWith(label);
  });

  test('the listeners are told once the pano faces the label, not before', async () => {
    const { labelContainer } = await start();
    for (const listener of Object.values(shown)) listener.mockClear();
    panoManager.renderPanoMarker.mockClear();

    await labelContainer.moveToNextLabel();

    for (const listener of Object.values(shown)) {
      expect(lastCallOrder(listener)).toBeGreaterThan(lastCallOrder(panoManager.renderPanoMarker));
    }
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
    expect(lastCallOrder(loading.keyboardOn)).toBeGreaterThan(lastCallOrder(shown.labelCard));
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
    expect(shown.labelCard).toHaveBeenCalledTimes(1);
  });
});
