/**
 * Builds Explore's modules in one place, so every dependency is visible, then starts the first mission or tutorial.
 */

import { ImmersiveMode } from '../common/ImmersiveMode.js';
import { Gate } from '../common/Gate.js';
import { LabelCardView } from '../common/LabelCardView.js';
import { MissionStartTutorial } from '../common/MissionStartTutorial.js';
import { PanoImageAdjustments } from '../common/PanoImageAdjustments.js';
import { PanoImageAdjustmentsPopover } from '../common/PanoImageAdjustmentsPopover.js';
import { ProgressBar } from '../common/ProgressBar.js';
import { SpeedLimit } from '../common/SpeedLimit.js';
import { Toast } from '../common/Toast.js';
import { GsvViewer } from '../common/pano-viewer/GsvViewer.js';
import { PanoInfoPopover } from '../common/pano-viewer/PanoInfoPopover.js';
import { PanoStore } from '../common/pano-viewer/PanoStore.js';
import { util } from '../common/utilities.js';
import { AiGuidance } from './alert/AiGuidance.js';
import { AlertController } from './alert/AlertController.js';
import { JumpAlert } from './alert/JumpAlert.js';
import { KeyboardShortcutAlert } from './alert/KeyboardShortcutAlert.js';
import { PopUpMessage } from './alert/PopUpMessage.js';
import { RatingReminderAlert } from './alert/RatingReminderAlert.js';
import { ReauditNotice } from './alert/ReauditNotice.js';
import { StuckAlert } from './alert/StuckAlert.js';
import { ZoomShortcutAlert } from './alert/ZoomShortcutAlert.js';
import { Canvas } from './canvas/Canvas.js';
import { CanvasFrame } from './canvas/CanvasFrame.js';
import { ContextMenu } from './canvas/ContextMenu.js';
import { PanoOverlayControls } from './controls/PanoOverlayControls.js';
import { Form } from './data/Form.js';
import { TemporaryStorage } from './data/Storage.js';
import { Tracker } from './data/Tracker.js';
import { AudioEffect } from './game/AudioEffect.js';
import { KeyboardManager } from './keyboard/KeyboardManager.js';
import { Label } from './label/Label.js';
import { LabelContainer } from './label/LabelContainer.js';
import { LabelModes } from './menu/LabelModes.js';
import { RibbonMenu } from './menu/RibbonMenu.js';
import { MissionContainer } from './mission/MissionContainer.js';
import { MissionController } from './mission/MissionController.js';
import { MissionModel } from './mission/MissionModel.js';
import { FeedbackModal } from './modal/FeedbackModal.js';
import { ModalMissionComplete } from './modal/ModalMissionComplete.js';
import { ModalMissionCompleteMap } from './modal/ModalMissionCompleteMap.js';
import { ModalSurvey } from './modal/ModalSurvey.js';
import { Compass } from './navigation/Compass.js';
import { ExploreUrlSync } from './navigation/ExploreUrlSync.js';
import { ForwardCrumbs } from './navigation/ForwardCrumbs.js';
import { Minimap } from './navigation/Minimap.js';
import { MinimapLegend } from './navigation/MinimapLegend.js';
import { MinimapMissionProgress } from './navigation/MinimapMissionProgress.js';
import { NavigationService } from './navigation/NavigationService.js';
import { StreetSweep } from './navigation/StreetSweep.js';
import { ObservedArea } from './navigation/ObservedArea.js';
import { Peg } from './navigation/Peg.js';
import { RouteOverview } from './navigation/RouteOverview.js';
import { InitialMissionInstruction } from './onboarding/InitialMissionInstruction.js';
import { Onboarding } from './onboarding/Onboarding.js';
import { OnboardingStates } from './onboarding/OnboardingStates.js';
import { TutorialIntro } from './onboarding/TutorialIntro.js';
import { NavArrows } from './panorama/NavArrows.js';
import { PanoDateNote } from './panorama/PanoDateNote.js';
import { PanoManager } from './panorama/PanoManager.js';
import { Region } from './region/Region.js';
import { RegionModel } from './region/RegionModel.js';
import { BadgeProgress } from './sidebar/BadgeProgress.js';
import { MissionPanel } from './sidebar/MissionPanel.js';
import { OverallStats } from './sidebar/OverallStats.js';
import { RegionProgressBar } from './sidebar/RegionProgressBar.js';
import { Task } from './task/Task.js';
import { StreetProgress } from './task/StreetProgress.js';
import { TaskContainer } from './task/TaskContainer.js';
import { ZoomControl } from './zoom/ZoomControl.js';
import '../common/pano-viewer/panoUtilities.js';
import '../common/utilitiesMath.js';
import '../common/utilitiesSidewalk.js';

/**
 * What the page was opened with, read once.
 * @typedef {object} ExploreConfig
 * @property {boolean} isOnboarding - Whether this session is the tutorial.
 * @property {boolean} isExploreAddressMode - Free exploration at a searched address (#4451): labeling works
 *   normally, there is no route or mission to finish, and the server credits each street from the coverage the
 *   client posts rather than from a completed flag (#5733).
 * @property {number} regionId - The region being explored.
 * @property {?number} routeId - The route being walked, if any.
 * @property {?number} userRouteId - The user's walk of that route, if any.
 * @property {?string} routeName - The route's name, if any.
 * @property {boolean} userHasCompletedAMission - Whether the user has ever finished a mission.
 * @property {string} userRole - The user's role, as the server names it ('Anonymous', 'Registered', ...).
 * @property {boolean} makeCrops - Whether a placed label's imagery is cropped and uploaded.
 * @property {import('./label/Label.js').LatLngEstimation} latLngEstimation - The label lat/lng estimator's
 *   constants, owned by the backend (PanoDataService.LatLngEstimation) and used by Label.toLatLng.
 * @property {import('./task/Task.js').StreetCoverage} streetCoverage - Free exploration's street-credit rule
 *   (#5733), owned by the backend (StreetCoverage).
 * @property {string} mapboxApiKey
 * @property {string} countryId - The city's country, for the speed limit sign.
 * @property {string} language - The page's language code.
 * @property {typeof import('../common/pano-viewer/PanoViewer.js').PanoViewer} viewerType - The viewer class for
 *   the city's imagery; the tutorial always uses GSV, whose panos it ships.
 * @property {string} viewerAccessToken - The token the viewer loads imagery with.
 */

/**
 * The minimap's elements.
 * @typedef {object} MinimapUi
 * @property {HTMLElement} holder
 * @property {HTMLElement} overlay
 * @property {HTMLCanvasElement} fogOfWar
 * @property {HTMLCanvasElement} fov
 * @property {HTMLCanvasElement} progressCircle
 * @property {HTMLElement} percentObserved
 * @property {HTMLElement} missionProgress
 * @property {HTMLElement} missionProgressFill
 * @property {HTMLElement} missionProgressPercent
 * @property {HTMLElement} missionProgressDistance
 * @property {HTMLElement} coach
 * @property {HTMLElement} coachDismiss
 * @property {HTMLElement} legendToggle
 * @property {HTMLElement} legendCard
 * @property {HTMLElement} legendClose
 * @property {HTMLInputElement} legendEarlierLabels
 * @property {HTMLElement} routeOverview
 * @property {HTMLCanvasElement} routeOverviewCanvas
 */

/**
 * The pano area's layers and the bottom-left corner.
 * @typedef {object} StreetviewUi
 * @property {HTMLElement} drawingLayer - Where a click places a label; on top while a label type is armed.
 * @property {HTMLElement} pano - The viewer's mount.
 * @property {HTMLElement} viewControlLayer - Where a drag pans; on top while walking.
 * @property {HTMLElement} modeSwitchWalk
 * @property {SVGElement} navArrows - The `<g>` the navigation arrows are drawn into.
 * @property {HTMLElement} navArrowsContainer - What hides and shows the whole arrow set.
 * @property {HTMLElement} dateHolder
 * @property {HTMLElement} datePill
 * @property {HTMLElement} date
 */

/**
 * The label canvas's drawing layer and the hover card's elements.
 * @typedef {object} CanvasUi
 * @property {HTMLElement} drawingLayer
 * @property {HTMLElement} hoverCard
 * @property {HTMLElement} hoverCardDelete
 * @property {HTMLElement} hoverCardEdit
 * @property {?HTMLElement} hoverCardShare
 */

/**
 * The context menu's elements.
 * @typedef {object} ContextMenuUi
 * @property {HTMLElement} holder
 * @property {HTMLElement} severityMenu
 * @property {HTMLElement} severityRadioHolder
 * @property {HTMLInputElement[]} radioButtons
 * @property {HTMLElement} tagSection
 * @property {HTMLElement} tagHolder
 * @property {HTMLInputElement} textBox
 * @property {HTMLElement} closeButton
 */

/**
 * The tutorial's elements.
 * @typedef {object} OnboardingUi
 * @property {HTMLElement} holder
 * @property {HTMLElement} messageHolder
 * @property {HTMLElement} background
 * @property {HTMLCanvasElement} canvas
 * @property {HTMLElement} handGestureHolder
 */

/**
 * The tool's DOM elements, collected once.
 * @typedef {object} ExploreUi
 * @property {MinimapUi} minimap
 * @property {StreetviewUi} streetview
 * @property {CanvasUi} canvas
 * @property {ContextMenuUi} contextMenu
 * @property {OnboardingUi} onboarding
 */

/**
 * The handle pages/explore.js puts on `window.svl` for the console and e2e tests. Nothing in the app reads it.
 * @typedef {object} ExploreHandle
 * @property {ExploreConfig} config
 * @property {PanoManager} [panoManager]
 * @property {TaskContainer} [taskContainer]
 * @property {LabelContainer} [labelContainer]
 * @property {MissionContainer} [missionContainer]
 * @property {NavigationService} [navigationService]
 * @property {StreetProgress} [streetProgress]
 */

export class Main {
  // sessionStorage key for an unresolvable-?routeId= notice waiting out the tutorial (#5156).
  static #ROUTE_UNAVAILABLE_KEY = 'sidewalk.routeUnavailable';

  #params;

  // The session this visit opens on, as /explore/session answered: the task, mission, region, route and pano seed.
  #session;

  /** @type {ExploreConfig} */
  #config;

  /** @type {ExploreUi} */
  #ui;

  /** @type {CanvasFrame} */
  #frame;

  // Initialize things that need data loading.
  #loadingTasksCompleted = false;
  #loadingMissionsCompleted = false;
  #loadLabelTags = false;

  /** @type {?Onboarding} The tutorial, once it has started. */
  #onboarding = null;

  /** @type {?ExploreUrlSync} Set once the URL is handed over (#syncURL, #5480); the immersive toggle looks it up. */
  #urlSync = null;

  /** @type {?(() => void)} Set once the tool is laid out; the immersive toggle looks it up at toggle time. */
  #relayout = null;

  // Whether the user clicked through to a route that is still waiting for them past the tutorial; the intro says so.
  #tutorialRouteWaiting = false;

  /**
   * The modules start-up's later steps act on, kept since the data load finishes well after they are built.
   * @type {?{tracker: Tracker, keyboardLock: Gate, alertController: AlertController, regionModel: RegionModel,
   *   missionModel: MissionModel, panoManager: PanoManager, navArrows: NavArrows, minimap: Minimap,
   *   minimapMissionProgress: MinimapMissionProgress, taskContainer: TaskContainer,
   *   missionContainer: MissionContainer, labelContainer: LabelContainer, form: Form, canvas: Canvas,
   *   contextMenu: ContextMenu, navigationService: NavigationService, streetSweep: StreetSweep, compass: Compass,
   *   observedArea: ObservedArea, forwardCrumbs: ForwardCrumbs, routeOverview: RouteOverview, zoomControl: ZoomControl,
   *   overallStats: OverallStats, missionPanel: MissionPanel, popUpMessage: PopUpMessage, aiGuidance: AiGuidance,
   *   reauditNotice: ReauditNotice, panoOverlayControls: PanoOverlayControls, labelModes: LabelModes,
   *   ribbon: RibbonMenu,
   *   missionProgressBar: ProgressBar, immersiveMode: ImmersiveMode, keyboard: KeyboardManager,
   *   iconsPreloaded: Promise<void[]>}}
   */
  #modules = null;

  /**
   * @param {Record<string, any>} params - The page's session scalars, from the view's page-data block.
   * @param {Record<string, any>} session - The visit's session, as /explore/session answered.
   */
  constructor(params, session) {
    this.#params = params;
    this.#session = session;

    const isOnboarding = session.mission.mission_type === 'auditOnboarding';
    this.#config = Object.freeze({
      isOnboarding,
      isExploreAddressMode: session.mission.mission_type === 'exploreAddress',
      regionId: session.region_id,
      routeId: session.route_id ?? null,
      userRouteId: session.user_route_id ?? null,
      routeName: session.route_name ?? null,
      userHasCompletedAMission: session.has_completed_mission,
      userRole: params.user.role,
      makeCrops: params.makeCrops,
      latLngEstimation: params.latLngEstimation,
      streetCoverage: params.streetCoverage,
      mapboxApiKey: params.mapboxApiKey,
      countryId: params.countryId,
      language: params.language,
      viewerType: isOnboarding ? GsvViewer : params.viewerType,
      viewerAccessToken: params.viewerAccessToken,
    });
  }

  /**
   * Builds the tool's modules and starts it.
   * @returns {Promise<ExploreHandle>} The console handle, once the tool is wired.
   */
  start() {
    this.#ui = Main.#collectUi();
    this.#frame = new CanvasFrame(this.#config.viewerType.SOURCE);
    return this.#init();
  }

  /**
   * Builds the modules in dependency order; what is built later subscribes to what came first. Only policy that
   * spans modules is wired here: what a pop-up stops.
   * @returns {Promise<ExploreHandle>}
   */
  async #init() {
    const params = this.#params;
    const session = this.#session;
    const config = this.#config;
    const ui = this.#ui;
    const frame = this.#frame;

    const storage = new TemporaryStorage(JSON);
    const tracker = new Tracker();
    const keyboardLock = new Gate();
    const interactionLock = new Gate();

    const regionModel = new RegionModel(config.userRouteId, tracker);
    const missionModel = new MissionModel(config.regionId);
    const alertController = new AlertController(storage);
    const panoStore = new PanoStore();

    // The task's current position is the default start; an explicit seed (an admin auditing a street from a given
    // pano/lat-lng, or an address drop-in per #4451) takes precedence. A pano seed keeps the lat/lng alongside it as
    // the fallback for a pano that fails to load (#4635).
    const startLat = session.start_lat ?? session.task.properties.current_lat;
    const startLng = session.start_lng ?? session.task.properties.current_lng;
    const isTutorialTask = session.task.properties.street_edge_id === params.tutorialStreetId;
    const newTask = new Task(session.task, config.streetCoverage, isTutorialTask);
    const seed = isTutorialTask
      ? { startPanoId: 'tutorial' }
      : { startPanoId: session.start_pano_id, startLat, startLng, startPov: session.start_pov };
    // The viewer and the minimap load side by side; what needs neither is built meanwhile.
    const panoManager = new PanoManager(ui.streetview, config, panoStore, tracker, alertController, seed,
      { task: newTask, missionId: session.mission.mission_id });
    const minimapLoading = Minimap.create(ui.minimap, { lat: startLat, lng: startLng }, panoManager, tracker);
    const stuckAlert = new StuckAlert(alertController, panoManager);

    const badgeProgress = new BadgeProgress();
    const overallStats = new OverallStats(config, badgeProgress);
    const missionPanel = new MissionPanel(config, regionModel, tracker);
    const audioEffect = new AudioEffect(storage);
    const keyboardShortcutAlert = new KeyboardShortcutAlert(config, alertController);
    const ratingReminderAlert = new RatingReminderAlert(config, alertController);
    const zoomShortcutAlert = new ZoomShortcutAlert(config, alertController);
    const jumpAlert = new JumpAlert(alertController);
    const labelModes = new LabelModes(tracker);
    // Warm the label-icon cache up front so canvas renders draw icons in the right order. See Label.preloadIcons.
    const iconsPreloaded = Label.preloadIcons();

    const [loaded, minimap] = await Promise.all([panoManager.ready, minimapLoading]);
    // No viewer means PanoManager found no usable imagery and has already scheduled a redirect; stop initializing
    // so nothing dereferences the missing viewer while the navigation lands.
    if (!loaded) return { config };

    // Arriving here from a load that gave up on its street: that reload is the only thing the labeler saw, and it
    // took the banner explaining the move down with it, so the explanation is delivered on arrival instead (#4918).
    // The reported street stays in the pool and assignment picks at random, so the fresh one can be the same street
    // again (#4922) — announce the move only when the labeler actually landed somewhere else.
    const skippedStreetId = PanoManager.consumeStreetSkippedNotice();
    if (skippedStreetId !== null && skippedStreetId !== newTask.getStreetEdgeId()) {
      stuckAlert.announceSkippedStreetNear(newTask.getMidpoint(), config.mapboxApiKey);
    }
    const currLatLng = panoManager.getPosition();
    newTask.updateTheFurthestPointReached(currLatLng);
    // The drop-in pano is the first one seen of its street (#5733).
    if (config.isExploreAddressMode) newTask.recordVisit(currLatLng);
    minimap.setMinimapLocation(currLatLng);
    const peg = new Peg(minimap, panoManager);

    // The containers subscribe to one another, so the first mission is created only once all three exist.
    const taskContainer = new TaskContainer(newTask, config, regionModel, minimap, panoManager, overallStats, tracker);
    const missionContainer = new MissionContainer(config, missionPanel, missionModel, storage, taskContainer,
      panoManager);
    const labelContainer = new LabelContainer(session.next_temporary_label_id, config, frame, panoStore, minimap,
      missionContainer, panoManager, storage, overallStats, tracker);
    const form = new Form(params.dataStoreUrl, config, labelContainer, missionModel, missionContainer, panoStore,
      taskContainer, panoManager, tracker);
    tracker.onFlush(() => form.submitData());

    regionModel.setCurrentRegion(new Region({ regionId: session.region_id, name: session.region_name }));
    missionModel.createAMission(session.mission); // create current mission and set as current
    if (session.mission.current_audit_task_id) {
      const currTask = taskContainer.getCurrentTask();
      if (!currTask.getProperty('auditTaskId')) {
        currTask.setProperty('auditTaskId', session.mission.current_audit_task_id);
      }
    } else {
      await form.submitData(); // Get an audit_task_id from the back end.
    }

    const popUpMessage = new PopUpMessage(config, interactionLock, taskContainer, tracker);
    const aiGuidance = new AiGuidance(config, taskContainer, popUpMessage, tracker);
    const reauditNotice = new ReauditNotice(taskContainer, tracker);

    // The arrows announce their clicks, since the service that answers them is built after.
    const navArrows = new NavArrows(ui.streetview.navArrows, ui.streetview.navArrowsContainer, config, taskContainer,
      panoManager);
    const streetSweep = new StreetSweep(config, missionContainer, taskContainer, panoStore, panoManager,
      alertController, stuckAlert, form, tracker);
    const navigationService = new NavigationService(ui.streetview, panoStore, panoManager, streetSweep,
      labelContainer, labelModes, navArrows, keyboardLock, alertController);
    const streetProgress = new StreetProgress(config, regionModel, missionModel, missionContainer, taskContainer,
      panoManager, navigationService, streetSweep, jumpAlert, tracker);
    navArrows.onLinkClick((panoId) => navigationService.moveToPano(panoId));
    navArrows.onRouteForwardClick(() => {
      tracker.push('Click_RouteForwardArrow');
      navigationService.moveForward()
        .then(() => tracker.push('RouteForwardArrow_Success'))
        .catch(() => tracker.push('RouteForwardArrow_PanoNotAvailable'));
    });
    navArrows.reset();
    const compass = new Compass(config, regionModel, taskContainer, panoManager, navigationService, streetProgress,
      stuckAlert, tracker);

    const ribbon = new RibbonMenu(labelModes, keyboardShortcutAlert, tracker);
    const contextMenu = new ContextMenu(ui.contextMenu, config, frame, labelContainer, labelModes, navigationService,
      ratingReminderAlert, form, tracker);
    // The shared populator for the hover card's content (#4730). Explore truncates the description because clicking
    // the label reopens the full text in an editable field.
    const labelCardView = new LabelCardView(ui.canvas.hoverCard, { descriptionMaxLength: 90 });
    const canvas = new Canvas(ui.canvas, ui.streetview, config, frame, labelCardView, labelModes, contextMenu,
      labelContainer, missionContainer, taskContainer, panoManager, navigationService, form, audioEffect, tracker);
    const zoomControl = new ZoomControl(ui.streetview.viewControlLayer, canvas, panoManager, zoomShortcutAlert,
      tracker);

    const routeOverview = new RouteOverview(ui.minimap, regionModel, taskContainer, panoManager, minimap, tracker);
    const observedArea = new ObservedArea(ui.minimap, config, storage, frame, panoManager, minimap, peg,
      routeOverview, navigationService, regionModel, tracker);
    new MinimapLegend(ui.minimap, labelContainer, tracker);
    const forwardCrumbs = new ForwardCrumbs(config, panoManager, taskContainer, compass, minimap, observedArea,
      navigationService, navArrows, tracker);
    const minimapMissionProgress = new MinimapMissionProgress(ui.minimap, config, regionModel, taskContainer,
      missionContainer, minimap);
    // What the ⛶ button fits: a route's every street; a region audit's mission streets plus the one being walked.
    minimap.setOverviewStreets(() => {
      if (regionModel.isRoute) return taskContainer.getTasks();
      const tasks = (missionContainer.getCurrentMission()?.getRoute() ?? []).slice();
      const current = taskContainer.getCurrentTask();
      if (current && !tasks.includes(current)) tasks.push(current);
      return tasks;
    });

    const missionProgressBar = new ProgressBar(
      'status-current-mission-completion-bar-filler', 'status-current-mission-completion-rate',
    );
    missionProgressBar.update(0);
    const regionProgressBar = new RegionProgressBar({
      fill: 'region-progress-fill',
      you: 'region-progress-you',
      community: 'region-progress-community',
      rate: 'region-progress-rate',
    }, regionModel, taskContainer);
    const modalMissionCompleteMap = new ModalMissionCompleteMap('modal-mission-complete-map', config.mapboxApiKey,
      regionModel, taskContainer);
    const modalMissionComplete = new ModalMissionComplete(missionContainer, missionModel, taskContainer, regionModel,
      labelContainer, overallStats, missionPanel, missionProgressBar, minimapMissionProgress, audioEffect,
      panoManager, interactionLock, modalMissionCompleteMap);
    new FeedbackModal(interactionLock, missionContainer, taskContainer, panoManager, navigationService, tracker);
    const panoOverlayControls = new PanoOverlayControls(tracker, navigationService, stuckAlert, keyboardShortcutAlert);
    const modalSurvey = new ModalSurvey(interactionLock, zoomControl);
    new MissionController(config, missionModel, regionModel, missionContainer, taskContainer, form,
      modalMissionComplete, modalSurvey, alertController, compass, navigationService, streetProgress, panoManager,
      observedArea, overallStats, regionProgressBar, missionProgressBar, minimapMissionProgress, tracker);

    const immersiveMode = new ImmersiveMode({
      tracker,
      bodyClass: 'svl-immersive',
      relayout: () => this.#relayout?.(),
      isDisabled: () => config.isOnboarding,
      // The hover card and context menu are anchored against the frame that is about to change shape.
      beforeToggle: () => {
        if (contextMenu.isOpen()) contextMenu.hide();
        canvas.showLabelHoverInfo(undefined);
      },
      frame: () => ({ width: frame.width, height: frame.height }),
      hintReference: () => document.getElementById('pano'),
      urlParam: 'immersive',
      onChange: () => this.#urlSync?.request(),
    });

    // Shadows/brightness/contrast as a display-only filter on the pano mount (#3136); crops read the raw canvas, so
    // they never carry it. The shortcuts are paused while the panel is open, which keeps Arrow keys on the focused
    // slider instead of panning the pano.
    const imageAdjustments = new PanoImageAdjustments(document.getElementById('pano'));
    // Settings carried in from an earlier visit (or from Validate) change what the labeler sees before they touch the
    // panel, so the load records them; ImageAdjustments_Change only covers edits made on this page.
    if (!imageAdjustments.isDefault()) {
      tracker.push('ImageAdjustments_Restored', imageAdjustments.values());
    }
    new PanoImageAdjustmentsPopover(imageAdjustments,
      document.getElementById('explore-control-image'), document.getElementById('pano-image-adjustments'), {
        // The pills form a row, so opening to the right would cover Sound and Feedback; full screen stacks them in a
        // column, where the right is clear and below would cover them instead.
        placement: () => (immersiveMode.isActive() ? 'right' : 'below'),
        onOpen: () => {
          tracker.push('Click_ImageAdjustments_Open');
          keyboardLock.hold('image-adjustments');
        },
        onClose: (via) => {
          tracker.push('Click_ImageAdjustments_Close', { via });
          keyboardLock.release('image-adjustments');
        },
        onChange: (values) => tracker.push('ImageAdjustments_Change', values),
        onReset: () => tracker.push('Click_ImageAdjustments_Reset'),
      });
    // The Image pill hides in the chevron's menu, so mirror its active state onto the chevron while the menu is closed.
    panoOverlayControls.setCollapsedIndicator(!imageAdjustments.isDefault());
    imageAdjustments.onChange(() => panoOverlayControls.setCollapsedIndicator(!imageAdjustments.isDefault()));

    // Mounted inside the date pill rather than beside it: what the button explains is the imagery, so between the
    // capture date and the audit note is the one place it would read as belonging to neither (#5413).
    new PanoInfoPopover(ui.streetview.datePill, () => panoManager.panoViewer,
      () => panoManager.getPosition(), () => panoManager.getPanoId(),
      () => taskContainer.getCurrentTaskStreetEdgeId(),
      () => regionModel.currentRegion().getRegionId(),
      () => panoStore.getPanoData(panoManager.getPanoId()).getProperty('captureDate'),
      () => panoStore.getPanoData(panoManager.getPanoId()).getProperty('address'),
      () => panoManager.getPov(), true,
      () => tracker.push('PanoInfoButton_Click'),
      () => tracker.push('PanoInfoCopyToClipboard_Click'),
      () => tracker.push('PanoInfoViewInPano_Click'),
    );
    new PanoDateNote(ui.streetview.dateHolder, ui.streetview.datePill, ui.streetview.date, panoManager, panoStore,
      taskContainer, tracker);
    new SpeedLimit(() => panoManager.panoViewer, () => panoManager.getPosition(), () => config.isOnboarding,
      config.countryId, { taskContainer });

    // Last, so no shortcut acts before the tool is wired.
    const keyboard = new KeyboardManager(keyboardLock, canvas, contextMenu, navigationService, labelModes, zoomControl,
      panoManager, compass, immersiveMode, tracker);

    this.#modules = {
      tracker, keyboardLock, alertController, regionModel, missionModel, panoManager, navArrows, minimap,
      minimapMissionProgress, taskContainer, missionContainer, labelContainer, form, canvas, contextMenu,
      navigationService, streetSweep, compass, observedArea, forwardCrumbs, routeOverview, zoomControl, overallStats,
      missionPanel, popUpMessage, aiGuidance, reauditNotice, panoOverlayControls, labelModes, ribbon,
      missionProgressBar, immersiveMode, keyboard, iconsPreloaded,
    };

    // A pop-up stops the tool under it until it closes.
    const stopped = [navigationService.walking, panoManager.panning, canvas.labeling, labelModes.switching,
      keyboardLock];
    interactionLock.onChanged((held) => {
      for (const gate of stopped) {
        if (held) gate.hold('interaction');
        else gate.release('interaction');
      }
    });
    // Absent when signed in; the tool dims under it (events from common/Modal.js).
    const signInModal = document.getElementById('sign-in-modal-container');
    const toolUi = document.querySelectorAll('.tool-ui');
    signInModal?.addEventListener('ps:modal:hidden', () => {
      interactionLock.release('sign-in');
      toolUi.forEach((el) => el.style.opacity = '1');
    });
    signInModal?.addEventListener('ps:modal:show', () => {
      interactionLock.hold('sign-in');
      toolUi.forEach((el) => el.style.opacity = '0.5');
    });
    // Some viewers (Infra3D) fire pano_changed before their metadata names the new pano, so the URL could read the
    // old one; by now every viewer's metadata is current.
    panoManager.onPanoChanged(() => this.#urlSync?.request());

    this.#loadData();

    document.getElementById('navbar-retake-tutorial-btn')?.addEventListener('click', () => {
      window.location.replace('/explore?retakeTutorial=true');
    });

    // Hand the address bar to the labeler's position from here on (#5480).
    this.#syncURL();

    return { config, panoManager, taskContainer, labelContainer, missionContainer, navigationService, streetProgress };
  }

  /** Fetches the region's tasks and missions, or in the tutorial just the mission that frames it. */
  #loadData() {
    const { taskContainer, missionModel, missionContainer, regionModel, contextMenu, minimapMissionProgress }
      = this.#modules;

    // If in the tutorial, we already have the tutorial task. If not, get the rest of the tasks in the region.
    if (this.#config.isOnboarding) {
      this.#loadingTasksCompleted = true;
      this.#handleDataLoadComplete();
    } else {
      taskContainer.fetchTasks(missionContainer.getCurrentMission()).then(() => {
        this.#loadingTasksCompleted = true;
        this.#handleDataLoadComplete();
        // Plant start/finish flags on the minimap so a route walk shows where it begins and ends.
        if (regionModel.isRoute) {
          const endpoints = taskContainer.getRouteEndpoints();
          if (endpoints) minimapMissionProgress.showRouteEndpoints(endpoints.start, endpoints.finish);
        }
      });
    }

    // Fetch the user's completed missions.
    missionModel.fetchCompletedMissionsInRegion(() => {
      this.#loadingMissionsCompleted = true;
      this.#handleDataLoadComplete();
    });

    contextMenu.fetchLabelTags(() => {
      this.#loadLabelTags = true;
      this.#handleDataLoadComplete();
    });
  }

  /**
   * Show the pre-tutorial intro walkthrough. Only once the user picks "Start Mission" does the tutorial itself begin;
   * "Skip" bypasses it. This runs before #startOnboarding so the intro is not part of the onboarding state machine.
   */
  #startTutorialIntro() {
    new TutorialIntro(this.#tutorialRouteWaiting, this.#modules.tracker, {
      onStart: () => this.#startOnboarding(),
      onSkip: () => this.#skipTutorial(),
    }).show();
  }

  /**
   * Holds an unresolvable-?routeId= notice (#5156) over the tutorial, which is where a first-time visitor following
   * a stale share link lands.
   *
   * Saying it now would be saying it into the tutorial intro and then throwing it away: onboarding takes over the
   * whole session and ends by reloading a bare /explore, which carries no trace of the route that was asked for.
   * Waiting is also what a *valid* route does here — its walk is set up, suppressed for the tutorial's sake (#4816),
   * and picked up on that same reload. sessionStorage rather than a field because of that reload; per tab, so a
   * notice never outlives the browsing session that earned it.
   */
  #parkRouteUnavailableNotice() {
    if (!this.#session.route_unavailable) return;
    try {
      window.sessionStorage.setItem(Main.#ROUTE_UNAVAILABLE_KEY, '1');
    } catch {
      // Storage throws outright in some privacy modes. A notice that can't cross the reload is lost; it must never
      // be the thing that breaks Explore.
    }
  }

  /**
   * Whether this load owes the user the unresolvable-?routeId= notice — this visit's own, or one held over the
   * tutorial by [[#parkRouteUnavailableNotice]]. Consumed as it is read, so it shows once.
   *
   * A held notice is dropped once a route has resolved: the user asked again and got one, so the earlier failure is
   * news about a route they have already moved past — and reporting it would take the place of the resume toast,
   * which belongs to the route they are actually in.
   *
   * @returns {boolean} True when the toast should be shown.
   */
  #takeRouteUnavailableNotice() {
    const asked = Boolean(this.#session.route_unavailable);
    try {
      const parked = window.sessionStorage.getItem(Main.#ROUTE_UNAVAILABLE_KEY) === '1';
      if (parked) window.sessionStorage.removeItem(Main.#ROUTE_UNAVAILABLE_KEY);
      return asked || (parked && !this.#session.route_id);
    } catch {
      return asked;
    }
  }

  /**
   * Skip the onboarding tutorial from the intro: mark the onboarding mission skipped/complete, submit, and reload into
   * a real Explore mission. Mirrors how the onboarding itself ends on skip.
   */
  #skipTutorial() {
    const { tracker, missionContainer, form } = this.#modules;
    tracker.push('Onboarding_Skip');
    const mission = missionContainer.getCurrentMission();
    mission.setProperty('skipped', true);
    mission.setProperty('isComplete', true);
    form.submitData().then(() => window.location.replace('/explore'));
  }

  #startOnboarding() {
    const m = this.#modules;
    // TODO probably have a GET endpoint to get onboarding mission..?
    m.alertController.hideAlert();

    if (!this.#onboarding) {
      const onboardingStates = new OnboardingStates(m.contextMenu, m.compass, m.panoManager, this.#ui.minimap);
      this.#onboarding = new Onboarding(this.#ui, this.#frame, onboardingStates, m.minimap, m.panoManager,
        m.navArrows, m.compass, m.navigationService, m.missionContainer, m.labelContainer, m.observedArea, m.form,
        m.missionProgressBar, m.panoOverlayControls, m.labelModes, m.ribbon, m.canvas, m.contextMenu, m.zoomControl,
        m.tracker);
    }
    this.#onboarding.start();
  }

  #startTheMission(mission, region) {
    const m = this.#modules;
    // Popup the message explaining the goal of the current mission.
    if (m.missionContainer.isTheFirstMission()) {
      region = m.regionModel.currentRegion();
      new InitialMissionInstruction(
        m.compass, m.navigationService, m.popUpMessage, m.taskContainer, m.labelContainer, m.aiGuidance, m.minimap,
        m.panoManager, m.observedArea, m.tracker,
      ).start(region);
    } else {
      // Show AI guidance message for the first street. Handled by InitialMissionInstruction if 1st mission.
      m.aiGuidance.showAiGuidanceMessage();
    }

    m.missionModel.updateMissionProgress(mission, region);
    m.missionPanel.setMessage(mission);
    m.minimapMissionProgress.update(mission);

    m.labelContainer.fetchLabelsToResumeMission(region.getRegionId(), this.#config.userRouteId, () => {
      m.canvas.setOnlyLabelsOnPanoAsVisible(m.panoManager.getPanoId());
      // Wait for the icon cache before this first paint (resolves immediately if already warm).
      m.iconsPreloaded.then(() => {
        m.canvas.render();
      });
    });

    m.taskContainer.renderAllTasks();
    // The route overview inset's explored/ahead colors follow the streets (routes only; no-op otherwise).
    m.routeOverview.render();
    const distance = m.taskContainer.getCompletedTaskDistance();
    m.overallStats.setRegionAuditedDistance(distance);

    // Prefetch Mapillary data on images along the street to improve load times for images along the street.
    m.streetSweep.prefetchAlongStreet(m.taskContainer.getCurrentTask().getFeature());
  }

  // This is a callback function that is executed after every loading process is done.
  #handleDataLoadComplete() {
    if (!(this.#loadingTasksCompleted && this.#loadingMissionsCompleted && this.#loadLabelTags)) return;
    const m = this.#modules;
    const config = this.#config;

    // Mark region as complete if there are no streets left with max priority (= 1).
    if (!m.taskContainer.hasMaxPriorityTask()) {
      m.regionModel.setRegionCompleteAcrossAllUsers();
    }

    // Set up a few initial views now that everything has loaded. A seeded POV (the labeler's stored view from the
    // label card's "Explore here" hop, #4637) wins over the default route-facing camera; the zoom buttons already
    // follow the seeded zoom (ZoomControl).
    if (!this.#session.start_pov) m.compass.faceRoute();
    m.minimap.setMinimapLocation(m.panoManager.getPosition());
    m.observedArea.panoChanged();
    m.observedArea.update();
    m.compass.update();
    // The first task was set before the crumbs existed, so draw the ones ahead now (#4669).
    m.forwardCrumbs.refresh();
    // Re-render the nav arrows now that the compass and task exist, so the route-forward arrow is highlighted on
    // the very first pano too (#4671).
    m.navArrows.reset();

    document.getElementById('page-loading').style.visibility = 'hidden';
    document.querySelectorAll('.tool-ui').forEach((el) => el.classList.remove('ps-invisible'));

    const mission = m.missionContainer.getCurrentMission();
    if (mission.getProperty('missionType') === 'auditOnboarding') {
      this.#parkRouteUnavailableNotice();
      this.#startTutorialIntro();
    } else {
      this.#calculateAndSetTasksMissionsOffset();

      const currentRegion = m.regionModel.currentRegion();
      if (config.isExploreAddressMode) {
        // Free exploration (#4451): hide the mission progress UI, and skip the mission-start modal (its copy
        // interpolates a mission distance, which this mission type doesn't have).
        document.getElementById('mission-progress-group').classList.add('ps-hidden');
        document.getElementById('compass-message-holder').classList.add('ps-hidden');
        m.tracker.push('ExploreAddress_SessionStart');
        // Name the place when the search supplied one — "dropped near Teaneck High School" orients the user far
        // better than a generic greeting. The name comes from a URL param and the alert banner renders its
        // message as HTML, so the value is escaped here while the <b> in the string itself renders.
        const placeName = this.#session.start_place_name;
        const startMessage = placeName
          ? i18next.t('popup.free-explore-start-named', { placeName, interpolation: { escapeValue: true } })
          : i18next.t('popup.free-explore-start');
        m.alertController.showAlert(startMessage, 'exploreAddressStart', true);
        m.reauditNotice.showForTask(m.taskContainer.getCurrentTask());
      } else {
        this.#showMissionStart(currentRegion);
      }

      this.#startTheMission(mission, currentRegion);
    }

    // Update the observed area now that everything has loaded.
    m.observedArea.panoChanged();
    m.observedArea.update();

    this.#layOut();
  }

  /**
   * Raises the mission-start screen, with the one toast this visit may owe queued behind it.
   * @param {Region} currentRegion
   */
  #showMissionStart(currentRegion) {
    const m = this.#modules;
    // Initialize explore mission screens focused on a randomized label type, though users can switch between them.
    const potentialLabelTypes = util.misc.PRIMARY_LABEL_TYPES;
    const labelType = potentialLabelTypes[Math.floor(Math.random() * potentialLabelTypes.length)];
    const currentMission = m.missionContainer.getCurrentMission();
    const missionProgressM = currentMission.getProperty('distanceProgress') || 0;
    // A pre-existing in-progress street also counts as resuming — the server sets audit_task_id on the task
    // only when handing one back — since a labeler mid-street may have zero mission distance banked.
    const resuming = currentMission.getProperty('missionType') === 'audit'
      && (missionProgressM > 0 || Boolean(this.#session.task.properties.audit_task_id));
    // The screen's Done hands the shortcuts back (TutorialHooks.keyboard).
    m.keyboardLock.hold('tutorial');
    new MissionStartTutorial('audit', labelType, {
      nLength: currentMission.getDistance('miles'),
      region: currentRegion.getProperty('name'),
      resuming,
    }, {
      tracker: m.tracker,
      keyboard: { enableKeyboard: () => m.keyboardLock.release('tutorial') },
      missionContainer: m.missionContainer,
    }, this.#config.language);

    // Toasts for a visit that resumed something (#4833) or didn't go where the URL asked: a route that couldn't
    // open (#5156), or a neighborhood already done (#5692). They wait for the mission-start screen to close so
    // they aren't hidden under it, and only one shows; "didn't go where asked" wins over a resume note. `Toast`
    // queues the re-audit notice (#4895) behind whichever one shows.
    const toastOnDone = (event, options) => {
      document.addEventListener('ps:mission-start-tutorial:done', () => {
        m.tracker.push(event);
        Toast.show({ reference: document.getElementById('pano'), dark: true, duration: 10000, ...options });
      }, { once: true });
    };
    if (this.#takeRouteUnavailableNotice()) {
      toastOnDone('RouteUnavailableToast_Shown', { message: i18next.t('right-ui.route-unavailable.message') });
    } else if (this.#session.region_finished) {
      toastOnDone('RegionFinishedToast_Shown', {
        message: i18next.t('right-ui.region-finished.message', { regionName: currentRegion.getProperty('name') }),
      });
    } else if (this.#config.userRouteId && this.#session.route_resumed) {
      toastOnDone('RouteResumeToast_Shown', {
        message: i18next.t('right-ui.route-resume.message', { routeName: this.#config.routeName }),
        button: {
          label: i18next.t('right-ui.route-resume.exit'),
          onClick: () => {
            m.tracker.push('Click_ExitRoute', { source: 'toast' });
            window.location.href = '/explore?resumeRoute=false';
          },
        },
      });
    } else if (!this.#config.userRouteId && resuming) {
      toastOnDone('MissionResumeToast_Shown', {
        message: i18next.t('right-ui.mission-resume.message', {
          regionName: currentRegion.getProperty('name'),
          distanceLeft: Math.max(currentMission.getDistance('meters') - missionProgressM, 0),
        }),
      });
    }
    document.addEventListener('ps:mission-start-tutorial:done', () => {
      m.reauditNotice.showForTask(m.taskContainer.getCurrentTask());
    }, { once: true });
  }

  /**
   * Scales the whole tool to fit the viewport (like browser zoom) using var(--ui-scale), now and on every resize.
   */
  #layOut() {
    const m = this.#modules;
    const frame = this.#frame;

    const applyExploreScale = () => {
      // Immersive mode (#5085) sizes the pano with CSS and floats the controls over it, so the scale fits only the
      // pano-wide ribbon and its own height into the whole window, with no page margins to keep clear of.
      const immersive = m.immersiveMode.isActive();
      util.applyToolScale(
        immersive ? ['--pano-base-width'] : ['--pano-base-width', '--sidebar-base-gap', '--sidebar-base-width'],
        ['--ribbon-base-top', '--ribbon-base-height', '--pano-base-height'],
        immersive ? { maxScale: 3, hMargin: 0, bottomReserve: 0 } : {},
      );
      // The logical frame follows the displayed pano's aspect (#5085), and the label icon and its click target are
      // capped in screen px, so they depend on the pano's display scale (#4838), which is --ui-scale in the boxed
      // tool but not in a fill-window one.
      const displayScale = util.exploreDisplayScale();
      frame.refresh(displayScale);
      // Toasts float 10% down the pano, which in immersive mode is where the label-type strip is; keep them under it.
      const pano = document.getElementById('pano');
      const ribbon = document.getElementById('ribbon-menu-holder');
      if (immersive && pano && ribbon) {
        pano.style.setProperty('--toast-min-top', `${ribbon.getBoundingClientRect().bottom + 8 * displayScale}px`);
      } else if (pano) {
        pano.style.removeProperty('--toast-min-top');
      }
    };
    /** Re-rasters the canvases for the box they now have, and tells the viewer its element changed size. */
    const refit = () => {
      // The pano was painted at scale 1 and its box has just changed size, which is exactly what can leave GSV
      // black until the camera moves (#2468): tell the viewer its box moved, then have it force a frame. The
      // workaround lives in the viewer (PanoViewer.repaint()) so only the provider that needs it does anything.
      m.panoManager.panoViewer.resize();
      m.panoManager.panoViewer.repaint();
      m.canvas.resize();
      this.#onboarding?.resize();
      // The minimap resizes itself a moment later and redraws the fog of war again once it has (see Minimap's move
      // handler); this pass keeps the overlay from sitting at the wrong size in between.
      m.observedArea.update();
    };
    /**
     * Re-lays out the tool for its current box: rescale, then re-raster the canvases and tell the pano viewer its
     * element changed size. Synchronous, so a layout switch (immersive mode, #5085) lands in one frame.
     */
    this.#relayout = () => {
      applyExploreScale();
      // A live toast is anchored to the pano's old box; nothing else tells it the box moved.
      Toast.repositionAll();
      refit();
    };
    this.#relayout();
    window.dispatchEvent(new Event('resize'));

    // Attached below the synthetic resize above, so page load never logs one: nothing was resized there, and the
    // rescale, re-raster and repaint that event stands in for have just been run inline.
    let resizeRasterTimer;
    window.addEventListener('resize', () => {
      applyExploreScale();
      clearTimeout(resizeRasterTimer);
      resizeRasterTimer = setTimeout(() => {
        // The viewer hears about the settled size, after the rescale above has changed its box: told per event it
        // would measure the box it already had, and the last event of a drag would go unanswered. It also keeps the
        // providers whose resize() is a full re-measure (Mapillary, Infra3d, Panoramax) off the event stream.
        refit();
        // Logged on the settled size rather than per event, so a window drag is one line (#5367). The repaint
        // above bypasses the POV path that logs POV_Changed, so none follows this one.
        m.tracker.push('Window_Resized', {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        });
      }, 150);
    });
  }

  #calculateAndSetTasksMissionsOffset() {
    const { taskContainer, missionContainer } = this.#modules;
    const completedTasksDistance = util.math.kmsToMeters(
      taskContainer.getCompletedTaskDistance({ units: 'kilometers' }),
    );
    const completedMissionsDistance = missionContainer.getCompletedMissionDistance();
    const curMission = missionContainer.getCurrentMission();
    const missProgress = curMission.getProperty('distanceProgress') ? curMission.getProperty('distanceProgress') : 0;

    missionContainer.setTasksMissionsOffset(completedMissionsDistance - completedTasksDistance + missProgress);
  }

  /**
   * Puts the address bar in step with the labeler (#5480): from here on ExploreUrlSync rewrites it with the current
   * pano and view, so it is always a shareable link to this spot, and a refresh or a copied link lands on the exact
   * view rather than only the seed the page opened with (#4451, #4637). The load-time params — the mission's own
   * (`routeId`, `resumeRoute`, …) and the drop-in greeting's `placeName` — have done their work by now and go; what
   * stays is this mission's id, which the server honors for its owner alone, so the labeler's own reloads resume
   * the mission while a recipient of the link lands in free exploration. A free-exploration session writes no id:
   * the `?lat&lng` path already resumes the user's own open drop-in mission.
   *
   * The tutorial is the exception: its pano is synthetic, so its URL is only pinned (ExploreUrlSync.pinTutorialUrl).
   */
  #syncURL() {
    const { panoManager, immersiveMode, missionContainer } = this.#modules;
    if (this.#config.isOnboarding) {
      // The tutorial intro says "your route is still waiting" to a user who clicked through to one; that fact
      // lives only in the URL about to be pinned, and a route that failed to resolve (#5156) is not waiting.
      this.#tutorialRouteWaiting = new URLSearchParams(window.location.search).has('routeId')
        && !this.#session.route_unavailable;
      ExploreUrlSync.pinTutorialUrl();
      return;
    }
    // Read at write time: a mission completes and its successor arrives in-page, and the URL has to name the one
    // the labeler is in now for the server to seed their reload.
    const sessionParams = () => (this.#config.isExploreAddressMode
      ? {}
      : { missionId: missionContainer.getCurrentMission().getProperty('missionId') });
    this.#urlSync = new ExploreUrlSync(panoManager.panoViewer, () => immersiveMode.isActive(), sessionParams);
    this.#urlSync.start();
  }

  /**
   * Collects the tool's DOM elements.
   * @returns {ExploreUi}
   */
  static #collectUi() {
    const byId = (id) => document.getElementById(id);
    return {
      minimap: {
        holder: byId('minimap-holder'),
        overlay: byId('minimap-overlay'),
        fogOfWar: /** @type {HTMLCanvasElement} */ (byId('minimap-fog-of-war-canvas')),
        fov: /** @type {HTMLCanvasElement} */ (byId('minimap-fov-canvas')),
        progressCircle: /** @type {HTMLCanvasElement} */ (byId('minimap-progress-circle-canvas')),
        percentObserved: byId('minimap-percent-observed'),
        missionProgress: byId('minimap-mission-progress'),
        missionProgressFill: byId('minimap-mission-progress-fill'),
        missionProgressPercent: byId('minimap-mission-progress-percent'),
        missionProgressDistance: byId('minimap-mission-progress-distance'),
        coach: byId('minimap-coach'),
        coachDismiss: byId('minimap-coach-dismiss'),
        legendToggle: byId('minimap-legend-toggle'),
        legendCard: byId('minimap-legend-card'),
        legendClose: byId('minimap-legend-close'),
        legendEarlierLabels: /** @type {HTMLInputElement} */ (byId('minimap-legend-earlier-labels')),
        routeOverview: byId('minimap-route-overview'),
        routeOverviewCanvas: /** @type {HTMLCanvasElement} */ (byId('minimap-route-overview-canvas')),
      },
      streetview: {
        drawingLayer: byId('label-drawing-layer'),
        pano: byId('pano'),
        viewControlLayer: byId('view-control-layer'),
        modeSwitchWalk: byId('mode-switch-button-walk'),
        navArrows: /** @type {SVGElement} */ (/** @type {unknown} */ (byId('arrow-group'))),
        navArrowsContainer: byId('nav-arrows-container'),
        dateHolder: byId('svl-panorama-date-holder'),
        datePill: byId('svl-panorama-date-pill'),
        date: byId('svl-panorama-date'),
      },
      canvas: {
        drawingLayer: byId('label-drawing-layer'),
        hoverCard: byId('label-hover-card'),
        hoverCardDelete: byId('label-hover-card-delete'),
        hoverCardEdit: byId('label-hover-card-edit'),
        hoverCardShare: byId('label-hover-card-share'),
      },
      contextMenu: {
        holder: byId('context-menu-holder'),
        severityMenu: byId('severity-menu'),
        severityRadioHolder: byId('severity-radio-holder'),
        radioButtons: Array.from(document.querySelectorAll('input[name=\'label-severity\']')),
        tagSection: byId('context-menu-tag-section'),
        tagHolder: byId('context-menu-tag-holder'),
        textBox: /** @type {HTMLInputElement} */ (byId('context-menu-description-text-box')),
        closeButton: byId('context-menu-close-button'),
      },
      onboarding: {
        holder: byId('onboarding-holder'),
        messageHolder: byId('onboarding-message-holder'),
        background: byId('onboarding-background'),
        canvas: /** @type {HTMLCanvasElement} */ (byId('onboarding-canvas')),
        handGestureHolder: byId('hand-gesture-holder'),
      },
    };
  }
}
