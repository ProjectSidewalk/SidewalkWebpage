/**
 * Tests that Explore's start-up (frontend/js/explore/Main.js) builds its modules in dependency order, hands each one
 * what it subscribes to, and wires the one policy that spans them: what a pop-up stops (#5648). No module's own suite
 * would notice one built before what it is handed exists. Every module is a recording stand-in (constructor args
 * kept, any method a mock); the gates are real, so the pop-up policy is checked by holding the lock.
 */

import { assetPathStub, loadModules, fakeImport, stubUtil } from './loader.js';

fakeImport('frontend/js/common/ImmersiveMode.js', 'ImmersiveMode');
fakeImport('frontend/js/common/LabelCardView.js', 'LabelCardView');
fakeImport('frontend/js/common/MissionStartTutorial.js', 'MissionStartTutorial');
fakeImport('frontend/js/common/PanoImageAdjustments.js', 'PanoImageAdjustments');
fakeImport('frontend/js/common/PanoImageAdjustmentsPopover.js', 'PanoImageAdjustmentsPopover');
fakeImport('frontend/js/common/ProgressBar.js', 'ProgressBar');
fakeImport('frontend/js/common/SpeedLimit.js', 'SpeedLimit');
fakeImport('frontend/js/common/Toast.js', 'Toast');
fakeImport('frontend/js/common/pano-viewer/PanoInfoPopover.js', 'PanoInfoPopover');
fakeImport('frontend/js/common/pano-viewer/PanoStore.js', 'PanoStore');
fakeImport('frontend/js/explore/alert/AiGuidance.js', 'AiGuidance');
fakeImport('frontend/js/explore/alert/AlertController.js', 'AlertController');
fakeImport('frontend/js/explore/alert/JumpAlert.js', 'JumpAlert');
fakeImport('frontend/js/explore/alert/KeyboardShortcutAlert.js', 'KeyboardShortcutAlert');
fakeImport('frontend/js/explore/alert/PopUpMessage.js', 'PopUpMessage');
fakeImport('frontend/js/explore/alert/RatingReminderAlert.js', 'RatingReminderAlert');
fakeImport('frontend/js/explore/alert/ReauditNotice.js', 'ReauditNotice');
fakeImport('frontend/js/explore/alert/StuckAlert.js', 'StuckAlert');
fakeImport('frontend/js/explore/alert/ZoomShortcutAlert.js', 'ZoomShortcutAlert');
fakeImport('frontend/js/explore/canvas/Canvas.js', 'Canvas');
fakeImport('frontend/js/explore/canvas/CanvasFrame.js', 'CanvasFrame');
fakeImport('frontend/js/explore/canvas/ContextMenu.js', 'ContextMenu');
fakeImport('frontend/js/explore/controls/PanoOverlayControls.js', 'PanoOverlayControls');
fakeImport('frontend/js/explore/data/Form.js', 'Form');
fakeImport('frontend/js/explore/data/Storage.js', 'TemporaryStorage');
fakeImport('frontend/js/explore/data/Tracker.js', 'Tracker');
fakeImport('frontend/js/explore/game/AudioEffect.js', 'AudioEffect');
fakeImport('frontend/js/explore/keyboard/KeyboardManager.js', 'KeyboardManager');
fakeImport('frontend/js/explore/label/Label.js', 'Label');
fakeImport('frontend/js/explore/label/LabelContainer.js', 'LabelContainer');
fakeImport('frontend/js/explore/menu/LabelModes.js', 'LabelModes');
fakeImport('frontend/js/explore/menu/RibbonMenu.js', 'RibbonMenu');
fakeImport('frontend/js/explore/mission/MissionContainer.js', 'MissionContainer');
fakeImport('frontend/js/explore/mission/MissionController.js', 'MissionController');
fakeImport('frontend/js/explore/mission/MissionModel.js', 'MissionModel');
fakeImport('frontend/js/explore/modal/FeedbackModal.js', 'FeedbackModal');
fakeImport('frontend/js/explore/modal/ModalMissionComplete.js', 'ModalMissionComplete');
fakeImport('frontend/js/explore/modal/ModalMissionCompleteMap.js', 'ModalMissionCompleteMap');
fakeImport('frontend/js/explore/modal/ModalSurvey.js', 'ModalSurvey');
fakeImport('frontend/js/explore/navigation/Compass.js', 'Compass');
fakeImport('frontend/js/explore/navigation/ExploreUrlSync.js', 'ExploreUrlSync');
fakeImport('frontend/js/explore/navigation/ForwardCrumbs.js', 'ForwardCrumbs');
fakeImport('frontend/js/explore/navigation/Minimap.js', 'Minimap');
fakeImport('frontend/js/explore/navigation/MinimapLegend.js', 'MinimapLegend');
fakeImport('frontend/js/explore/navigation/MinimapMissionProgress.js', 'MinimapMissionProgress');
fakeImport('frontend/js/explore/navigation/NavigationService.js', 'NavigationService');
fakeImport('frontend/js/explore/navigation/ObservedArea.js', 'ObservedArea');
fakeImport('frontend/js/explore/navigation/Peg.js', 'Peg');
fakeImport('frontend/js/explore/navigation/RouteOverview.js', 'RouteOverview');
fakeImport('frontend/js/explore/panorama/NavArrows.js', 'NavArrows');
fakeImport('frontend/js/explore/panorama/PanoDateNote.js', 'PanoDateNote');
fakeImport('frontend/js/explore/panorama/PanoManager.js', 'PanoManager');
fakeImport('frontend/js/explore/region/Region.js', 'Region');
fakeImport('frontend/js/explore/region/RegionModel.js', 'RegionModel');
fakeImport('frontend/js/explore/sidebar/BadgeProgress.js', 'BadgeProgress');
fakeImport('frontend/js/explore/sidebar/MissionPanel.js', 'MissionPanel');
fakeImport('frontend/js/explore/sidebar/OverallStats.js', 'OverallStats');
fakeImport('frontend/js/explore/sidebar/RegionProgressBar.js', 'RegionProgressBar');
fakeImport('frontend/js/explore/task/Task.js', 'Task');
fakeImport('frontend/js/explore/task/TaskContainer.js', 'TaskContainer');
fakeImport('frontend/js/explore/zoom/ZoomControl.js', 'ZoomControl');
fakeImport('frontend/js/common/Gate.js', 'Gate');


/** @type {Record<string, any>} Every stand-in Main built, by module name, in the order built. */
let built;
/** @type {string[]} The module names in construction order. */
let buildOrder;

/**
 * Builds a class whose instances record their constructor arguments and answer any method with a mock. The few
 * calls Main needs a real answer from come from `answers`.
 * @param {string} name
 * @param {Record<string, any>} [answers] - Properties the stand-in should carry instead of a mock.
 * @param {Record<string, any>} [statics] - Static members, for the classes Main calls without building.
 * @returns {Function}
 */
function standIn(name, answers = {}, statics = {}) {
  const Fake = class {
    constructor(...args) {
      const instance = { ctorArgs: args, ...answers };
      const proxied = new Proxy(instance, {
        get(target, key) {
          // A `then` that is a mock would make the stand-in a thenable that never settles, hanging any await on it.
          if (key in target || typeof key !== 'string' || key === 'then') return target[key];
          target[key] = vi.fn();
          return target[key];
        },
      });
      built[name] = proxied;
      buildOrder.push(name);
      return proxied;
    }
  };
  Object.assign(Fake, statics);
  return Fake;
}

/** A pano, a task, a mission and a region, as the data Main reads off them. */
const PANO_DATA = { getPanoId: () => 'pano1', getProperty: () => '2024-05' };
const makeTask = () => ({
  getStreetEdgeId: () => 42,
  getMidpoint: () => ({ lat: 47.6, lng: -122.3 }),
  getProperty: () => 9,
  setProperty: vi.fn(),
  updateTheFurthestPointReached: vi.fn(),
  recordVisit: vi.fn(),
  getFeature: () => ({ geometry: { coordinates: [] } }),
});
const MISSION = {
  getProperty: (key) => ({ missionType: 'audit', distanceProgress: 0, missionId: 7 })[key],
  getDistance: () => 1,
  getRoute: () => [],
};
const REGION = { getRegionId: () => 5, getProperty: () => 'Ballard' };

/** The page's session scalars and the visit's session, trimmed to what Main reads. */
const PARAMS = {
  user: { role: 'Registered' },
  tutorialStreetId: 1,
  dataStoreUrl: '/explore/store',
  viewerType: class FakeViewer { static SOURCE = 'gsv'; },
  streetCoverage: { max_uncovered_m: 50 },
  mapboxApiKey: 'token',
  countryId: 'usa',
  language: 'en',
};
const SESSION = {
  mission: { mission_type: 'audit', mission_id: 7, current_audit_task_id: 9 },
  task: { properties: { street_edge_id: 42, current_lat: 47.6, current_lng: -122.3 } },
  region_id: 5,
  region_name: 'Ballard',
  has_completed_mission: true,
  next_temporary_label_id: 1,
  start_pano_id: 'pano1',
};

/** The elements Main reaches for by id outside its UI object. */
const FIXTURE = `
  <div id="page-loading"></div>
  <div class="tool-ui"><div id="pano"></div><div id="ribbon-menu-holder"></div></div>
  <div id="mission-progress-group"></div><div id="compass-message-holder"></div>
  <div id="explore-control-image"></div><div id="pano-image-adjustments"></div>`;

let Main;
let Gate;

beforeAll(async () => {
  ({ Gate } = await loadModules('frontend/js/common/Gate.js'));
  stubUtil({
    assetPath: assetPathStub,
    applyToolScale: () => 1,
    exploreDisplayScale: () => 1,
    localIsoDate: (date) => date,
    math: { kmsToMeters: (km) => km * 1000 },
    misc: { PRIMARY_LABEL_TYPES: ['CurbRamp'] },
  });
  window.i18next = { t: (key) => key };
  window.Toast = { show: vi.fn(), repositionAll: vi.fn() };
});

beforeEach(async () => {
  document.body.innerHTML = FIXTURE;
  built = {};
  buildOrder = [];
  const task = makeTask();

  const fakes = {
    Gate,
    Tracker: standIn('tracker'),
    TemporaryStorage: standIn('storage'),
    RegionModel: standIn('regionModel', { isRoute: false, currentRegion: () => REGION }),
    MissionModel: standIn('missionModel', { fetchCompletedMissionsInRegion: (done) => done() }),
    AlertController: standIn('alertController'),
    StuckAlert: standIn('stuckAlert'),
    PanoStore: standIn('panoStore', { getPanoData: () => PANO_DATA }),
    PanoManager: standIn('panoManager', {
      ready: Promise.resolve(true),
      panning: new Gate(),
      getPosition: () => ({ lat: 47.6, lng: -122.3 }),
      getPanoId: () => 'pano1',
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
      panoViewer: { resize: vi.fn(), repaint: vi.fn() },
    }, { consumeStreetSkippedNotice: () => null }),
    Task: standIn('task', task),
    Minimap: class {
      static create(...args) {
        const minimap = new (standIn('minimap'))(...args);
        return Promise.resolve(minimap);
      }
    },
    Peg: standIn('peg'),
    BadgeProgress: standIn('badgeProgress'),
    OverallStats: standIn('overallStats'),
    MissionPanel: standIn('missionPanel'),
    TaskContainer: standIn('taskContainer', {
      getCurrentTask: () => task,
      fetchTasks: vi.fn(() => Promise.resolve()),
      hasMaxPriorityTask: () => true,
      getCompletedTaskDistance: () => 0,
    }),
    MissionContainer: standIn('missionContainer', {
      getCurrentMission: () => MISSION,
      isTheFirstMission: () => false,
      getCompletedMissionDistance: () => 0,
    }),
    LabelContainer: standIn('labelContainer'),
    Form: standIn('form', { submitData: vi.fn(() => Promise.resolve()) }),
    Region: standIn('region'),
    Label: class { static preloadIcons() { return Promise.resolve([]); } },
    AudioEffect: standIn('audioEffect'),
    KeyboardShortcutAlert: standIn('keyboardShortcutAlert'),
    RatingReminderAlert: standIn('ratingReminderAlert'),
    ZoomShortcutAlert: standIn('zoomShortcutAlert'),
    JumpAlert: standIn('jumpAlert'),
    PopUpMessage: standIn('popUpMessage'),
    AiGuidance: standIn('aiGuidance'),
    ReauditNotice: standIn('reauditNotice'),
    NavArrows: standIn('navArrows'),
    NavigationService: standIn('navigationService', { walking: new Gate(), isHeadingSettling: () => false }),
    Compass: standIn('compass'),
    LabelModes: standIn('labelModes', { switching: new Gate() }),
    RibbonMenu: standIn('ribbon'),
    ContextMenu: standIn('contextMenu', { isOpen: () => false, fetchLabelTags: (done) => done() }),
    LabelCardView: standIn('labelCardView'),
    Canvas: standIn('canvas', { labeling: new Gate() }),
    ZoomControl: standIn('zoomControl'),
    RouteOverview: standIn('routeOverview'),
    ObservedArea: standIn('observedArea'),
    MinimapLegend: standIn('minimapLegend'),
    ForwardCrumbs: standIn('forwardCrumbs'),
    MinimapMissionProgress: standIn('minimapMissionProgress'),
    ProgressBar: standIn('missionProgressBar'),
    RegionProgressBar: standIn('regionProgressBar'),
    ModalMissionCompleteMap: standIn('modalMissionCompleteMap'),
    ModalMissionComplete: standIn('modalMissionComplete'),
    FeedbackModal: standIn('feedbackModal'),
    PanoOverlayControls: standIn('panoOverlayControls'),
    ModalSurvey: standIn('modalSurvey'),
    MissionController: standIn('missionController'),
    ImmersiveMode: standIn('immersiveMode', { isActive: () => false }),
    PanoImageAdjustments: standIn('imageAdjustments', { isDefault: () => true }),
    PanoImageAdjustmentsPopover: standIn('imageAdjustmentsPopover'),
    PanoInfoPopover: standIn('panoInfoPopover'),
    PanoDateNote: standIn('panoDateNote'),
    SpeedLimit: standIn('speedLimit'),
    KeyboardManager: standIn('keyboard'),
    MissionStartTutorial: standIn('missionStartTutorial'),
    ExploreUrlSync: standIn('urlSync', {}, { pinTutorialUrl: vi.fn() }),
    CanvasFrame: standIn('frame', { width: 720, height: 480 }),
    GsvViewer: class { static SOURCE = 'gsv'; },
  };
  Object.assign(window, fakes);
  ({ Main } = await loadModules('frontend/js/explore/Main.js'));
  await new Main(PARAMS, SESSION).start();
});

/** The keyboard lock and the pop-up lock, which Main builds as plain gates and hands to what holds them. */
const keyboardLock = () => built.keyboard.ctorArgs[0];
const interactionLock = () => built.popUpMessage.ctorArgs[1];

describe('Explore Main builds in dependency order', () => {
  it('starts the viewer and the minimap side by side, and builds what needs neither meanwhile', () => {
    const before = (a, b) => expect(buildOrder.indexOf(a)).toBeLessThan(buildOrder.indexOf(b));
    before('panoManager', 'minimap');
    // The peg is the first thing that needs the pano on screen.
    for (const viewerFree of ['stuckAlert', 'overallStats', 'missionPanel', 'audioEffect', 'labelModes']) {
      before('panoManager', viewerFree);
      before(viewerFree, 'peg');
    }
    // Centered on the seed while loading, then on the pano that actually landed.
    expect(built.minimap.ctorArgs[1]).toEqual({ lat: 47.6, lng: -122.3 });
    expect(built.minimap.setMinimapLocation).toHaveBeenCalledWith({ lat: 47.6, lng: -122.3 });
  });

  it('creates the first mission only once all three containers can hear about it', () => {
    const { missionModel } = built;
    const containers = ['taskContainer', 'missionContainer', 'labelContainer'].map((name) => buildOrder.indexOf(name));
    expect(containers.every((index) => index >= 0)).toBe(true);
    expect(missionModel.createAMission).toHaveBeenCalledWith(SESSION.mission);
    expect(buildOrder.indexOf('form')).toBeGreaterThan(Math.max(...containers));
  });

  it('hands the Tracker its flush once the Form exists', () => {
    expect(built.tracker.onFlush).toHaveBeenCalledWith(expect.any(Function));
    expect(buildOrder.indexOf('form')).toBeLessThan(built.tracker.onFlush.mock.invocationCallOrder[0]);
  });

  it('builds the arrows before the service that answers them, and the keyboard after everything it drives', () => {
    expect(buildOrder.indexOf('navArrows')).toBeLessThan(buildOrder.indexOf('navigationService'));
    const keyboard = buildOrder.indexOf('keyboard');
    for (const driven of ['canvas', 'contextMenu', 'navigationService', 'ribbon', 'zoomControl', 'compass']) {
      expect(buildOrder.indexOf(driven)).toBeLessThan(keyboard);
    }
    expect(built.navArrows.onLinkClick).toHaveBeenCalledWith(expect.any(Function));
    expect(built.navArrows.onRouteForwardClick).toHaveBeenCalledWith(expect.any(Function));
  });

  it('hands each module what it subscribes to', () => {
    const m = built;
    expect(m.navigationService.ctorArgs).toEqual(expect.arrayContaining(
      [m.labelContainer, m.labelModes, m.navArrows, keyboardLock(), m.form]));
    expect(m.canvas.ctorArgs).toEqual(expect.arrayContaining(
      [m.labelModes, m.contextMenu, m.labelContainer, m.panoManager, m.navigationService]));
    expect(m.compass.ctorArgs).toEqual(expect.arrayContaining([m.taskContainer, m.panoManager, m.navigationService]));
    expect(m.contextMenu.ctorArgs).toEqual(expect.arrayContaining([m.labelModes, m.navigationService]));
    expect(m.forwardCrumbs.ctorArgs).toEqual(expect.arrayContaining([m.navigationService, m.navArrows]));
    expect(m.missionController.ctorArgs).toEqual(expect.arrayContaining(
      [m.compass, m.navigationService, m.panoManager]));
    expect(m.modalMissionComplete.ctorArgs).toEqual(expect.arrayContaining([interactionLock()]));
    expect(m.ribbon.ctorArgs).toEqual(expect.arrayContaining([m.labelModes]));
    expect(m.stuckAlert.ctorArgs).toEqual(expect.arrayContaining([m.panoManager]));
    expect(m.reauditNotice.ctorArgs).toEqual(expect.arrayContaining([m.taskContainer]));
    expect(m.panoDateNote.ctorArgs).toEqual(expect.arrayContaining([m.panoManager, m.taskContainer]));
    expect(m.peg.ctorArgs).toEqual(expect.arrayContaining([m.minimap, m.panoManager]));
  });
});

describe('Explore Main wires what a pop-up stops', () => {
  it('a pop-up holds walking, panning, labeling, mode switching and the shortcuts, and lets all of them go', () => {
    const { navigationService, panoManager, canvas, labelModes } = built;
    const gates = [navigationService.walking, panoManager.panning, canvas.labeling, labelModes.switching,
      keyboardLock()];

    interactionLock().hold('popup');
    expect(gates.every((gate) => gate.isHeld())).toBe(true);
    interactionLock().release('popup');
    // The mission-start screen still holds the shortcuts; nothing else should.
    expect(gates.some((gate) => gate.isHeldExcept('tutorial'))).toBe(false);
  });

  it('the sign-in dialog is one of those pop-ups', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="sign-in-modal-container"></div>');
    // Registered on the element at start-up, so the dialog has to exist before Main runs.
    return (async () => {
      built = {};
      buildOrder = [];
      await new Main(PARAMS, SESSION).start();
      const modal = document.getElementById('sign-in-modal-container');
      modal.dispatchEvent(new Event('ps:modal:show'));
      expect(built.navigationService.walking.isHeld()).toBe(true);
      modal.dispatchEvent(new Event('ps:modal:hidden'));
      expect(built.navigationService.walking.isHeld()).toBe(false);
    })();
  });

  it('pauses the shortcuts under the mission-start screen until it is dismissed', () => {
    const { missionStartTutorial } = built;
    expect(keyboardLock().isHeld()).toBe(true);
    missionStartTutorial.ctorArgs[3].keyboard.enableKeyboard();
    expect(keyboardLock().isHeld()).toBe(false);
  });
});
