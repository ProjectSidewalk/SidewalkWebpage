/**
 * Runs Explore's start-up (frontend/js/explore/Main.js) over recording stand-ins for every module it builds (#5648,
 * #5840). Each stand-in keeps its constructor arguments and answers any method with a mock, so a suite can read what
 * Main handed each module and drive the callbacks Main wired. The gates are real, so a held one behaves as on the page.
 */

import { loadModules, mockModule, useUtil } from '../loader.js';

/** The i18next stand-in: `t` is a mock, so a suite can read the key and options a message was built from. */
export const i18n = { t: vi.fn((key) => key), language: 'en' };
mockModule('i18next', () => ({ default: i18n }));

/** What the suite can read after a start: the stand-ins Main built by name, and the order it built them in. */
export const exploreMain = {
  /** @type {Record<string, any>} */
  built: {},
  /** @type {string[]} */
  buildOrder: [],
  /** @type {Record<string, any>} The stand-ins by export name, which the module mocks hand to Main. */
  fakes: {},
  /** @type {?typeof import('../../../frontend/js/common/Gate.js').Gate} The real gate class, once loaded. */
  Gate: null,
};

/** Every module Main builds its collaborators from, path to the export it takes. Gate stays real. */
const FAKED_EXPORTS = {
  'frontend/js/common/ImmersiveMode.js': 'ImmersiveMode',
  'frontend/js/common/LabelCardView.js': 'LabelCardView',
  'frontend/js/common/MissionStartTutorial.js': 'MissionStartTutorial',
  'frontend/js/common/PanoImageAdjustments.js': 'PanoImageAdjustments',
  'frontend/js/common/PanoImageAdjustmentsPopover.js': 'PanoImageAdjustmentsPopover',
  'frontend/js/common/ProgressBar.js': 'ProgressBar',
  'frontend/js/common/SpeedLimit.js': 'SpeedLimit',
  'frontend/js/common/Toast.js': 'Toast',
  'frontend/js/common/pano-viewer/PanoInfoPopover.js': 'PanoInfoPopover',
  'frontend/js/common/pano-viewer/PanoStore.js': 'PanoStore',
  'frontend/js/explore/alert/AiGuidance.js': 'AiGuidance',
  'frontend/js/explore/alert/AlertController.js': 'AlertController',
  'frontend/js/explore/alert/JumpAlert.js': 'JumpAlert',
  'frontend/js/explore/alert/KeyboardShortcutAlert.js': 'KeyboardShortcutAlert',
  'frontend/js/explore/alert/PopUpMessage.js': 'PopUpMessage',
  'frontend/js/explore/alert/RatingReminderAlert.js': 'RatingReminderAlert',
  'frontend/js/explore/alert/ReauditNotice.js': 'ReauditNotice',
  'frontend/js/explore/alert/StuckAlert.js': 'StuckAlert',
  'frontend/js/explore/alert/ZoomShortcutAlert.js': 'ZoomShortcutAlert',
  'frontend/js/explore/canvas/Canvas.js': 'Canvas',
  'frontend/js/explore/canvas/CanvasFrame.js': 'CanvasFrame',
  'frontend/js/explore/canvas/ContextMenu.js': 'ContextMenu',
  'frontend/js/explore/controls/PanoOverlayControls.js': 'PanoOverlayControls',
  'frontend/js/explore/data/Form.js': 'Form',
  'frontend/js/explore/data/Storage.js': 'TemporaryStorage',
  'frontend/js/explore/data/Tracker.js': 'Tracker',
  'frontend/js/explore/game/AudioEffect.js': 'AudioEffect',
  'frontend/js/explore/keyboard/KeyboardManager.js': 'KeyboardManager',
  'frontend/js/explore/label/Label.js': 'Label',
  'frontend/js/explore/label/LabelContainer.js': 'LabelContainer',
  'frontend/js/explore/menu/LabelModes.js': 'LabelModes',
  'frontend/js/explore/menu/RibbonMenu.js': 'RibbonMenu',
  'frontend/js/explore/mission/MissionContainer.js': 'MissionContainer',
  'frontend/js/explore/mission/MissionController.js': 'MissionController',
  'frontend/js/explore/mission/MissionModel.js': 'MissionModel',
  'frontend/js/explore/modal/FeedbackModal.js': 'FeedbackModal',
  'frontend/js/explore/modal/ModalMissionComplete.js': 'ModalMissionComplete',
  'frontend/js/explore/modal/ModalMissionCompleteMap.js': 'ModalMissionCompleteMap',
  'frontend/js/explore/modal/ModalSurvey.js': 'ModalSurvey',
  'frontend/js/explore/navigation/Compass.js': 'Compass',
  'frontend/js/explore/navigation/ExploreUrlSync.js': 'ExploreUrlSync',
  'frontend/js/explore/navigation/ForwardCrumbs.js': 'ForwardCrumbs',
  'frontend/js/explore/navigation/Minimap.js': 'Minimap',
  'frontend/js/explore/navigation/MinimapLegend.js': 'MinimapLegend',
  'frontend/js/explore/navigation/MinimapMissionProgress.js': 'MinimapMissionProgress',
  'frontend/js/explore/navigation/NavigationService.js': 'NavigationService',
  'frontend/js/explore/navigation/ObservedArea.js': 'ObservedArea',
  'frontend/js/explore/navigation/Peg.js': 'Peg',
  'frontend/js/explore/navigation/RouteOverview.js': 'RouteOverview',
  'frontend/js/explore/navigation/StreetSweep.js': 'StreetSweep',
  'frontend/js/explore/navigation/WalkPlanLayer.js': 'WalkPlanLayer',
  'frontend/js/explore/onboarding/InitialMissionInstruction.js': 'InitialMissionInstruction',
  'frontend/js/explore/onboarding/Onboarding.js': 'Onboarding',
  'frontend/js/explore/onboarding/OnboardingStates.js': 'OnboardingStates',
  'frontend/js/explore/onboarding/TutorialIntro.js': 'TutorialIntro',
  'frontend/js/explore/panorama/NavArrows.js': 'NavArrows',
  'frontend/js/explore/panorama/PanoDateNote.js': 'PanoDateNote',
  'frontend/js/explore/panorama/PanoManager.js': 'PanoManager',
  'frontend/js/explore/region/Region.js': 'Region',
  'frontend/js/explore/region/RegionModel.js': 'RegionModel',
  'frontend/js/explore/sidebar/BadgeProgress.js': 'BadgeProgress',
  'frontend/js/explore/sidebar/MissionPanel.js': 'MissionPanel',
  'frontend/js/explore/sidebar/OverallStats.js': 'OverallStats',
  'frontend/js/explore/sidebar/RegionProgressBar.js': 'RegionProgressBar',
  'frontend/js/explore/task/StreetProgress.js': 'StreetProgress',
  'frontend/js/explore/task/Task.js': 'Task',
  'frontend/js/explore/task/TaskContainer.js': 'TaskContainer',
  'frontend/js/explore/zoom/ZoomControl.js': 'ZoomControl',
};
for (const [path, name] of Object.entries(FAKED_EXPORTS)) {
  mockModule(path, () => ({ [name]: exploreMain.fakes[name] }));
}

/**
 * Builds a class whose instances record their constructor arguments and answer any method with a mock. The few
 * calls Main needs a real answer from come from `answers`.
 * @param {string} name - What `exploreMain.built` files the instance under.
 * @param {Record<string, any>} [answers] - Properties the stand-in should carry instead of a mock.
 * @param {Record<string, any>} [statics] - Static members, for the classes Main calls without building.
 * @returns {Function} The class.
 */
export function standIn(name, answers = {}, statics = {}) {
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
      exploreMain.built[name] = proxied;
      exploreMain.buildOrder.push(name);
      return proxied;
    }
  };
  Object.assign(Fake, statics);
  return Fake;
}

/** A pano, as the data Main reads off it. */
export const PANO_DATA = { getPanoId: () => 'pano1', getProperty: () => '2024-05' };

/**
 * @param {Record<string, any>} [props] - What `getProperty` answers by key; `auditTaskId` is 9 unless given.
 * @returns {object} A task, as the data Main reads off it.
 */
export const makeTask = (props = {}) => ({
  getStreetEdgeId: () => 42,
  getMidpoint: () => ({ lat: 47.6, lng: -122.3 }),
  getProperty: (key) => ({ auditTaskId: 9, ...props })[key],
  setProperty: vi.fn(),
  updateTheFurthestPointReached: vi.fn(),
  recordVisit: vi.fn(),
  getFeature: () => ({ geometry: { coordinates: [] } }),
});

/**
 * @param {Record<string, any>} [props] - Properties to answer differently from an untouched audit mission.
 * @returns {object} A mission, as the data Main reads off it.
 */
export const makeMission = (props = {}) => ({
  getProperty: (key) => ({ missionType: 'audit', distanceProgress: 0, missionId: 7, ...props })[key],
  getDistance: () => 1,
  getRoute: () => [],
  setProperty: vi.fn(),
});

/** A region, as the data Main reads off it. */
export const REGION = { getRegionId: () => 5, getProperty: () => 'Ballard' };

/** The page's session scalars, trimmed to what Main reads. */
export const PARAMS = {
  user: { role: 'Registered' },
  tutorialStreetId: 1,
  dataStoreUrl: '/explore/store',
  viewerType: class FakeViewer { static SOURCE = 'gsv'; },
  streetCoverage: { max_uncovered_m: 50 },
  mapboxApiKey: 'token',
  countryId: 'usa',
  language: 'en',
};

/** The visit's session, as /explore/session answers for a plain audit mission already under way. */
export const SESSION = {
  mission: { mission_type: 'audit', mission_id: 7, current_audit_task_id: 9 },
  task: { properties: { street_edge_id: 42, current_lat: 47.6, current_lng: -122.3 } },
  region_id: 5,
  region_name: 'Ballard',
  has_completed_mission: true,
  next_temporary_label_id: 1,
  start_pano_id: 'pano1',
};

/** The elements Main reaches for by id outside its UI object. */
export const FIXTURE = `
  <div id="page-loading"></div>
  <div class="tool-ui"><div id="pano"></div><div id="ribbon-menu-holder"></div></div>
  <div id="mission-progress-group"></div><div id="compass-message-holder"></div>
  <div id="explore-control-image"></div><div id="pano-image-adjustments"></div>`;

/**
 * The stand-ins for one start, answering as a plain audit session would.
 * @param {typeof import('../../../frontend/js/common/Gate.js').Gate} Gate - The real gate class.
 * @param {object} task - What the Task stand-in and the task container answer with.
 * @param {object} mission - What the mission container answers with.
 * @returns {Record<string, any>} The stand-ins by export name.
 */
function defaultFakes(Gate, task, mission) {
  return {
    Toast: { show: vi.fn(), repositionAll: vi.fn() },
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
      getTasks: () => [task],
      fetchTasks: vi.fn(() => Promise.resolve()),
      hasMaxPriorityTask: () => true,
      getCompletedTaskDistance: () => 0,
      getRouteEndpoints: () => null,
    }),
    MissionContainer: standIn('missionContainer', {
      getCurrentMission: () => mission,
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
    StreetSweep: standIn('streetSweep'),
    NavigationService: standIn('navigationService', {
      walking: new Gate(), isHeadingSettling: () => false, moveForward: vi.fn(() => Promise.resolve()),
    }),
    StreetProgress: standIn('streetProgress'),
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
    WalkPlanLayer: standIn('walkPlanLayer', { getPreviewedTasks: () => [] }),
    ProgressBar: standIn('missionProgressBar'),
    RegionProgressBar: standIn('regionProgressBar'),
    ModalMissionCompleteMap: standIn('modalMissionCompleteMap'),
    ModalMissionComplete: standIn('modalMissionComplete'),
    FeedbackModal: standIn('feedbackModal'),
    PanoOverlayControls: standIn('panoOverlayControls'),
    ModalSurvey: standIn('modalSurvey'),
    MissionController: standIn('missionController'),
    ImmersiveMode: standIn('immersiveMode', { isActive: () => false }),
    PanoImageAdjustments: standIn('imageAdjustments', { isDefault: () => true, values: () => ({}) }),
    PanoImageAdjustmentsPopover: standIn('imageAdjustmentsPopover'),
    PanoInfoPopover: standIn('panoInfoPopover'),
    PanoDateNote: standIn('panoDateNote'),
    SpeedLimit: standIn('speedLimit'),
    KeyboardManager: standIn('keyboard'),
    MissionStartTutorial: standIn('missionStartTutorial'),
    ExploreUrlSync: standIn('urlSync', {}, { pinTutorialUrl: vi.fn() }),
    CanvasFrame: standIn('frame', { width: 720, height: 480 }),
    InitialMissionInstruction: standIn('initialMissionInstruction'),
    TutorialIntro: standIn('tutorialIntro'),
    Onboarding: standIn('onboarding'),
    OnboardingStates: standIn('onboardingStates'),
  };
}

/**
 * Starts Main over fresh stand-ins and waits for its start-up to finish. The page fixture is the suite's to set.
 * @param {object} [options]
 * @param {Record<string, any>} [options.params] - The page's session scalars; `PARAMS` by default.
 * @param {Record<string, any>} [options.session] - The visit's session; `SESSION` by default.
 * @param {object} [options.task] - What the Task stand-in and the task container answer with.
 * @param {object} [options.mission] - What the mission container answers with.
 * @param {(fakes: Record<string, any>) => void} [options.adjust] - Edits the stand-ins before Main is loaded.
 * @returns {Promise<object>} The console handle Main's start resolves with.
 */
export async function startExploreMain({
  params = PARAMS, session = SESSION, task = makeTask(), mission = makeMission(), adjust = () => {},
} = {}) {
  const { Gate } = await loadModules('frontend/js/common/Gate.js');
  // jsdom lays nothing out, so the real one would size the tool from empty computed styles.
  useUtil({ applyToolScale: () => 1 });
  exploreMain.Gate = Gate;
  exploreMain.built = {};
  exploreMain.buildOrder = [];
  exploreMain.fakes = defaultFakes(Gate, task, mission);
  adjust(exploreMain.fakes);
  const { Main } = await loadModules('frontend/js/explore/Main.js');
  return new Main(params, session).start();
}
