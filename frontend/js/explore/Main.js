/**
 * Main module of SVLabel. Bootstraps the Explore/Audit tool: constructs all the modules, loads data, and starts the
 * first mission or the onboarding tutorial.
 */

import { svl } from './svl.js';
import { ImmersiveMode } from '../common/ImmersiveMode.js';
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
import { ContextMenu } from './canvas/ContextMenu.js';
import { PanoOverlayControls } from './controls/PanoOverlayControls.js';
import { Form } from './data/Form.js';
import { TemporaryStorage } from './data/Storage.js';
import { Tracker } from './data/Tracker.js';
import { AudioEffect } from './game/AudioEffect.js';
import { KeyboardManager } from './keyboard/KeyboardManager.js';
import { Label } from './label/Label.js';
import { LabelContainer } from './label/LabelContainer.js';
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
import { NavigationService } from './navigation/NavigationService.js';
import { ObservedArea } from './navigation/ObservedArea.js';
import { Peg } from './navigation/Peg.js';
import { RouteOverview } from './navigation/RouteOverview.js';
import { InitialMissionInstruction } from './onboarding/InitialMissionInstruction.js';
import { Onboarding } from './onboarding/Onboarding.js';
import { OnboardingStates } from './onboarding/OnboardingStates.js';
import { TutorialIntro } from './onboarding/TutorialIntro.js';
import { PanoDateNote } from './panorama/PanoDateNote.js';
import { PanoManager } from './panorama/PanoManager.js';
import { Region } from './region/Region.js';
import { RegionModel } from './region/RegionModel.js';
import { BadgeProgress } from './sidebar/BadgeProgress.js';
import { MissionPanel } from './sidebar/MissionPanel.js';
import { OverallStats } from './sidebar/OverallStats.js';
import { RegionProgressBar } from './sidebar/RegionProgressBar.js';
import { Task } from './task/Task.js';
import { TaskContainer } from './task/TaskContainer.js';
import { User } from './user/User.js';
import { ZoomControl } from './zoom/ZoomControl.js';
import '../common/pano-viewer/panoUtilities.js';
import '../common/utilitiesMath.js';
import '../common/utilitiesSidewalk.js';

export class Main {
  // sessionStorage key for an unresolvable-?routeId= notice waiting out the tutorial (#5156).
  static #ROUTE_UNAVAILABLE_KEY = 'sidewalk.routeUnavailable';

  #params;

  // Initialize things that need data loading.
  #loadingTasksCompleted = false;
  #loadingMissionsCompleted = false;
  #loadLabelTags = false;

  #onboardingStates = null;

  /**
   * @param {Record<string, any>} params - Page params injected by explore.scala.html.
   */
  constructor(params) {
    this.#params = params;

    svl.onboarding = null;
    svl.isOnboarding = () => this.#params.mission.mission_type === 'auditOnboarding';
    // Free exploration at a searched address (#4451): labeling works normally, but the task/mission never complete.
    svl.isExploreAddressMode = () => this.#params.mission.mission_type === 'exploreAddress';
    svl.regionId = params.regionId;

    // All three are derived from the displayed pano's size and refreshed by applyExploreScale() below. They start at
    // their scale-1, boxed values because the tool renders at scale 1 until that first call (#4838, #5085).
    svl.CANVAS_FRAME = { width: util.EXPLORE_CANVAS_WIDTH, height: util.EXPLORE_CANVAS_HEIGHT };
    svl.LABEL_ICON_RADIUS = util.labelIconRadius(1);
    svl.LABEL_HIT_MARGIN = util.labelHitMargin(1);
    /**
     * The horizontal fov the pano viewer renders at a zoom for the current frame, which the projection has to be fed
     * off 3:2 because GSV clamps its vertical field on wide viewports (#5083, #5085).
     * @param {number} zoom - The viewer zoom.
     * @returns {number} Degrees.
     */
    svl.renderedHFov = (zoom) => util.pano.renderedHFov(
      zoom, svl.CANVAS_FRAME.width / svl.CANVAS_FRAME.height, svl.panoViewer.getViewerType(),
    );
    svl.TUTORIAL_PANO_HEIGHT = 6656;
    svl.TUTORIAL_PANO_WIDTH = 13312;
    svl.TUTORIAL_PANO_SCALE_FACTOR = 3.25;
    // Pano search radius in meters. GsvViewer also rejects any reply farther than this, since Google's radius is only
    // a hint (#5114); tools/city/check_streets_for_imagery.py and Task.ON_STREET_MAX_DISTANCE_M mirror it.
    svl.STREETVIEW_MAX_DISTANCE = 25;
    svl.CLOSE_TO_ROUTE_THRESHOLD = 0.05; // 50 meters.
    svl.CONNECTED_TASK_THRESHOLD = 0.025; // 25 meters.

    // Gets all the text on the explore page for the correct language.
    // TODO this should really happen in explore.scala.html before we call Main().
    window.appManager.ready(() => {
      this.#initUI();
      this.#init();
    });
  }

  async #init() {
    const params = this.#params;

    // Record any params that are important enough to attach directly to the svl object.
    svl.missionsCompleted = 0; // Just since loading the page.
    svl.userHasCompletedAMission = params.hasCompletedAMission;
    svl.routeId = params.routeId;
    svl.userRouteId = params.userRouteId;
    svl.routeName = params.routeName;
    svl.makeCrops = params.makeCrops;
    // Lat/lng estimator constants, owned by the backend (PanoDataService.LatLngEstimation) and used by Label.toLatLng.
    svl.latLngEstimation = params.latLngEstimation;

    svl.mapboxApiKey = params.mapboxApiKey;
    svl.storage = new TemporaryStorage(JSON);
    svl.tracker = new Tracker();
    svl.user = new User(params.user);

    // Models
    svl.regionModel = new RegionModel();
    svl.regionModel.setAsRouteOrRegion(svl.userRouteId ? 'route' : 'region');
    svl.missionModel = new MissionModel();

    svl.alertController = new AlertController();
    svl.stuckAlert = new StuckAlert(svl.alertController);

    // The task's current position is the default start; an explicit seed (an admin auditing a street from a given
    // pano/lat-lng, or an address drop-in per #4451) takes precedence. A pano seed keeps the lat/lng alongside it as
    // the fallback for a pano that fails to load (#4635).
    const startLat = params.startLat ?? params.task.properties.current_lat;
    const startLng = params.startLng ?? params.task.properties.current_lng;
    svl.panoStore = new PanoStore();
    svl.viewerType = svl.isOnboarding() ? GsvViewer : params.viewerType;

    // Set up the PanoManager and PanoViewer.
    const isTutorialTask = params.task.properties.street_edge_id === params.tutorialStreetId;
    const newTask = new Task(params.task, isTutorialTask);
    let initParams;
    if (isTutorialTask) initParams = { startPanoId: 'tutorial' };
    else initParams = { startPanoId: params.startPanoId, startLat, startLng, startPov: params.startPov };
    const errorParams = { task: newTask, missionId: params.mission.mission_id };
    svl.panoManager = await PanoManager.create(svl.viewerType, params.viewerAccessToken, initParams, errorParams);
    // No viewer means PanoManager found no usable imagery and has already scheduled a redirect; stop initializing
    // so nothing dereferences the missing viewer while the navigation lands.
    if (!svl.panoViewer) return;

    // Arriving here from a load that gave up on its street: that reload is the only thing the labeler saw, and it
    // took the banner explaining the move down with it, so the explanation is delivered on arrival instead (#4918).
    // The reported street stays in the pool and assignment picks at random, so the fresh one can be the same street
    // again (#4922) — announce the move only when the labeler actually landed somewhere else.
    const skippedStreetId = PanoManager.consumeStreetSkippedNotice();
    if (skippedStreetId !== null && skippedStreetId !== newTask.getStreetEdgeId()) {
      svl.stuckAlert.announceSkippedStreetNear(newTask.getMidpoint(), params.mapboxApiKey);
    }
    const currLatLng = svl.panoViewer.getPosition();
    newTask.updateTheFurthestPointReached(currLatLng);

    svl.minimap = await Minimap.create(currLatLng);
    svl.peg = await Peg.create(svl.minimap.getMap(), currLatLng);

    svl.ribbon = new RibbonMenu(svl.tracker);
    svl.canvas = new Canvas(svl.ribbon);
    // The shared populator for the hover card's content; Label.#updateHoverCard re-points it per label (#4730).
    // Explore truncates the description because clicking the label reopens the full text in an editable field.
    svl.labelCardView = new LabelCardView(svl.ui.canvas.hoverCard, { descriptionMaxLength: 90 });

    // Warm the label-icon cache up front so canvas renders draw icons in the right order. See Label.preloadIcons.
    svl.iconsPreloaded = Label.preloadIcons();

    svl.navigationService = new NavigationService(svl.regionModel, svl.ui.streetview);

    svl.taskContainer = new TaskContainer(svl.regionModel, svl, svl.tracker);
    svl.taskContainer._tasks.push(newTask);
    svl.taskContainer.setCurrentTask(newTask);
    svl.labelContainer = new LabelContainer(params.nextTemporaryLabelId);

    // Set map parameters and instantiate it.
    svl.compass = new Compass(svl.navigationService, svl.taskContainer);
    svl.keyboardShortcutAlert = new KeyboardShortcutAlert(svl.alertController);
    svl.ratingReminderAlert = new RatingReminderAlert(svl.alertController);
    svl.zoomShortcutAlert = new ZoomShortcutAlert(svl.alertController);
    svl.jumpAlert = new JumpAlert(svl.alertController);

    svl.badgeProgress = new BadgeProgress();
    svl.overallStats = new OverallStats();
    svl.missionProgressBar = new ProgressBar(
      'status-current-mission-completion-bar-filler', 'status-current-mission-completion-rate',
    );
    svl.missionProgressBar.update(0);
    svl.regionProgressBar = new RegionProgressBar();
    svl.missionPanel = new MissionPanel();

    svl.contextMenu = new ContextMenu(svl.ui.contextMenu);

    // Game effects
    svl.audioEffect = new AudioEffect(svl.storage);

    const region = new Region({
      regionId: params.regionId, geoJSON: params.regionGeoJSON, name: params.regionName,
    });
    svl.regionModel.setCurrentRegion(region);

    svl.observedArea = new ObservedArea(svl.ui.minimap);
    svl.minimapLegend = new MinimapLegend(svl.ui.minimap, svl.tracker);
    svl.routeOverview = new RouteOverview(svl.ui.minimap, svl.tracker);
    svl.forwardCrumbs = new ForwardCrumbs(svl.navigationService, svl.tracker);

    // Mission
    svl.missionContainer = new MissionContainer(svl.missionPanel, svl.missionModel);
    svl.missionController = new MissionController(svl.missionModel, svl.regionModel,
      svl.missionContainer, svl.tracker);
    svl.missionModel.createAMission(params.mission); // create current mission and set as current
    svl.form = new Form(svl.labelContainer, svl.missionModel, svl.missionContainer, svl.panoStore,
      svl.taskContainer, svl.tracker, params.dataStoreUrl);
    if (params.mission.current_audit_task_id) {
      const currTask = svl.taskContainer.getCurrentTask();
      const currTaskId = currTask.getProperty('auditTaskId');
      if (!currTaskId) currTask.setProperty('auditTaskId', params.mission.current_audit_task_id);
    } else {
      await svl.form.submitData(); // Get an audit_task_id from the back end.
    }
    svl.popUpMessage = new PopUpMessage(svl.taskContainer, svl.tracker);
    svl.aiGuidance = new AiGuidance(svl.tracker, svl.popUpMessage);
    svl.reauditNotice = new ReauditNotice(svl.tracker);

    // Logs when the page's focus changes.
    const logPageFocus = () => {
      if (document.hasFocus()) {
        svl.tracker.push('PageGainedFocus');
      } else {
        svl.tracker.push('PageLostFocus');
      }
    };
    window.addEventListener('focus', () => logPageFocus());
    window.addEventListener('blur', () => logPageFocus());
    logPageFocus();

    // Modals
    const modalMissionCompleteMap = new ModalMissionCompleteMap('modal-mission-complete-map', params.mapboxApiKey);
    svl.modalMissionComplete = new ModalMissionComplete(svl.missionContainer, svl.missionModel,
      svl.taskContainer, modalMissionCompleteMap);
    svl.modalMissionComplete.hide();

    svl.feedbackModal = new FeedbackModal(svl, svl.tracker, svl.ribbon, svl.taskContainer);
    svl.panoOverlayControls = new PanoOverlayControls(svl.tracker, svl.navigationService, svl.stuckAlert,
      svl.keyboardShortcutAlert);
    // svl.relayout is assigned once the tool is laid out (below) and svl.urlSync once the URL is handed over
    // (#syncURL, #5480); the arrows look them up at toggle time.
    svl.immersiveMode = new ImmersiveMode({
      tracker: svl.tracker,
      bodyClass: 'svl-immersive',
      relayout: () => svl.relayout?.(),
      isDisabled: () => svl.isOnboarding(),
      // The hover card and context menu are anchored against the frame that is about to change shape.
      beforeToggle: () => {
        if (svl.contextMenu.isOpen()) svl.contextMenu.hide();
        svl.canvas.showLabelHoverInfo(undefined);
      },
      frame: () => svl.CANVAS_FRAME,
      hintReference: () => document.getElementById('pano'),
      urlParam: 'immersive',
      onChange: () => svl.urlSync?.request(),
    });

    // Shadows/brightness/contrast as a display-only filter on the pano mount (#3136); crops read the raw canvas, so
    // they never carry it. svl.keyboard is built later, hence the lookups at call time. Suspending the shortcuts
    // while the panel is open keeps Arrow keys on the focused slider instead of panning the pano; the suspension is
    // only undone if the panel was what suspended them, since a pop-up can disable the keyboard while it is open.
    svl.imageAdjustments = new PanoImageAdjustments(document.getElementById('pano'));
    // Settings carried in from an earlier visit (or from Validate) change what the labeler sees before they touch the
    // panel, so the load records them; ImageAdjustments_Change only covers edits made on this page.
    if (!svl.imageAdjustments.isDefault()) {
      svl.tracker.push('ImageAdjustments_Restored', svl.imageAdjustments.values());
    }
    let panelSuspendedKeyboard = false;
    svl.imageAdjustmentsPopover = new PanoImageAdjustmentsPopover(svl.imageAdjustments,
      document.getElementById('explore-control-image'), document.getElementById('pano-image-adjustments'), {
        // The pills form a row, so opening to the right would cover Sound and Feedback; full screen stacks them in a
        // column, where the right is clear and below would cover them instead.
        placement: () => (svl.immersiveMode.isActive() ? 'right' : 'below'),
        onOpen: () => {
          svl.tracker.push('Click_ImageAdjustments_Open');
          panelSuspendedKeyboard = !!svl.keyboard && !svl.keyboard.getStatus('disableKeyboard');
          if (panelSuspendedKeyboard) svl.keyboard.disableKeyboard();
        },
        onClose: (via) => {
          svl.tracker.push('Click_ImageAdjustments_Close', { via });
          if (panelSuspendedKeyboard) svl.keyboard.enableKeyboard();
          panelSuspendedKeyboard = false;
        },
        onChange: (values) => svl.tracker.push('ImageAdjustments_Change', values),
        onReset: () => svl.tracker.push('Click_ImageAdjustments_Reset'),
      });
    // The Image pill hides in the chevron's menu, so mirror its active state onto the chevron while the menu is closed.
    svl.panoOverlayControls.setCollapsedIndicator(!svl.imageAdjustments.isDefault());
    svl.imageAdjustments.onChange(() =>
      svl.panoOverlayControls.setCollapsedIndicator(!svl.imageAdjustments.isDefault()));

    // Mounted inside the date pill rather than beside it: what the button explains is the imagery, so between the
    // capture date and the audit note is the one place it would read as belonging to neither (#5413).
    svl.infoPopover = new PanoInfoPopover(svl.ui.streetview.datePill, () => svl.panoViewer,
      () => svl.panoViewer.getPosition(), () => svl.panoViewer.getPanoId(),
      () => svl.taskContainer.getCurrentTaskStreetEdgeId(),
      () => svl.regionModel.currentRegion().getRegionId(),
      () => svl.panoStore.getPanoData(svl.panoViewer.getPanoId()).getProperty('captureDate'),
      () => svl.panoStore.getPanoData(svl.panoViewer.getPanoId()).getProperty('address'),
      () => svl.panoViewer.getPov(), true,
      () => {
        svl.tracker.push('PanoInfoButton_Click');
      },
      () => {
        svl.tracker.push('PanoInfoCopyToClipboard_Click');
      },
      () => {
        svl.tracker.push('PanoInfoViewInPano_Click');
      },
    );

    svl.panoDateNote = new PanoDateNote(svl.tracker, svl.ui.streetview.dateHolder,
      svl.ui.streetview.datePill, svl.ui.streetview.date);
    // The first pano and the first task both land before this line, so their own updates find no note to draw on and
    // the corner stays empty until the labeler's first step (#4671 closed the same gap for the nav arrows).
    const initialCaptureDate = svl.panoStore.getPanoData(svl.panoViewer.getPanoId())?.getProperty('captureDate');
    svl.panoDateNote.update(
      initialCaptureDate ? util.localIsoDate(initialCaptureDate) : null,
      svl.taskContainer.getCurrentTask(),
    );

    // Speed limit
    svl.speedLimit = new SpeedLimit(() => svl.panoViewer, () => svl.panoViewer.getPosition(), svl.isOnboarding,
      params.countryId, { taskContainer: svl.taskContainer });

    // Survey for select users
    svl.modalSurvey = new ModalSurvey();

    svl.zoomControl = new ZoomControl(svl.canvas, svl.tracker);
    svl.keyboard = new KeyboardManager(
      svl, svl.canvas, svl.contextMenu, svl.navigationService, svl.ribbon, svl.zoomControl,
    );
    this.#loadData(svl.taskContainer, svl.missionModel, svl.regionModel, svl.contextMenu);

    document.getElementById('navbar-retake-tutorial-btn')?.addEventListener('click', () => {
      window.location.replace('/explore?retakeTutorial=true');
    });

    // The auth dialog is absent when signed in; dim the tool UI while it's open (events from common/Modal.js).
    const signInModal = document.getElementById('sign-in-modal-container');
    const toolUi = document.querySelectorAll('.tool-ui');
    signInModal?.addEventListener('ps:modal:hidden', () => {
      svl.popUpMessage.enableInteractions();
      toolUi.forEach((el) => el.style.opacity = '1');
    });
    signInModal?.addEventListener('ps:modal:show', () => {
      svl.popUpMessage.disableInteractions();
      toolUi.forEach((el) => el.style.opacity = '0.5');
    });

    // Hand the address bar to the labeler's position from here on (#5480).
    this.#syncURL();
  }

  #loadData(taskContainer, missionModel, regionModel, contextMenu) {
    // If in the tutorial, we already have the tutorial task. If not, get the rest of the tasks in the region.
    if (svl.isOnboarding()) {
      this.#loadingTasksCompleted = true;
      this.#handleDataLoadComplete();
    } else {
      taskContainer.fetchTasks().then(() => {
        this.#loadingTasksCompleted = true;
        this.#handleDataLoadComplete();
        // Plant start/finish flags on the minimap so a route walk shows where it begins and ends.
        if (svl.regionModel.isRoute) {
          const endpoints = taskContainer.getRouteEndpoints();
          if (endpoints) svl.minimap.showRouteEndpoints(endpoints.start, endpoints.finish);
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
    svl.tutorialIntro = new TutorialIntro(svl.tracker, {
      onStart: () => this.#startOnboarding(),
      onSkip: () => this.#skipTutorial(),
    });
    svl.tutorialIntro.show();
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
    if (!this.#params.routeUnavailable) return;
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
    const asked = Boolean(this.#params.routeUnavailable);
    try {
      const parked = window.sessionStorage.getItem(Main.#ROUTE_UNAVAILABLE_KEY) === '1';
      if (parked) window.sessionStorage.removeItem(Main.#ROUTE_UNAVAILABLE_KEY);
      return asked || (parked && !this.#params.routeId);
    } catch {
      return asked;
    }
  }

  /**
   * Skip the onboarding tutorial from the intro: mark the onboarding mission skipped/complete, submit, and reload into
   * a real Explore mission. Mirrors how the onboarding itself ends on skip.
   */
  #skipTutorial() {
    svl.tracker.push('Onboarding_Skip');
    const mission = svl.missionContainer.getCurrentMission();
    mission.setProperty('skipped', true);
    mission.setProperty('isComplete', true);
    svl.form.submitData().then(() => window.location.replace('/explore'));
  }

  #startOnboarding() {
    // TODO probably have a GET endpoint to get onboarding mission..?
    // hide any alerts
    svl.alertController.hideAlert();

    if (!this.#onboardingStates) {
      this.#onboardingStates = new OnboardingStates(svl.contextMenu, svl.compass, svl.panoManager);
    }

    if (!('onboarding' in svl && svl.onboarding)) {
      svl.onboarding = new Onboarding(svl, svl.compass, svl.navigationService, svl.missionContainer,
        svl.panoOverlayControls, this.#onboardingStates, svl.ribbon, svl.tracker, svl.canvas, svl.ui.canvas,
        svl.contextMenu, svl.ui.onboarding, svl.zoomControl);
    }
    svl.onboarding.start();
  }

  #startTheMission(mission, region) {
    // Popup the message explaining the goal of the current mission.
    if (svl.missionContainer.isTheFirstMission()) {
      region = svl.regionModel.currentRegion();
      svl.initialMissionInstruction = new InitialMissionInstruction(
        svl.compass, svl.navigationService, svl.popUpMessage,
        svl.taskContainer, svl.labelContainer, svl.aiGuidance, svl.tracker,
      );
      svl.initialMissionInstruction.start(region);
    } else {
      // Show AI guidance message for the first street. Handled by InitialMissionInstruction if 1st mission.
      svl.aiGuidance.showAiGuidanceMessage();
    }

    svl.missionModel.updateMissionProgress(mission, region);
    svl.missionPanel.setMessage(mission);
    svl.minimap.updateMissionProgress(mission);

    svl.labelContainer.fetchLabelsToResumeMission(region.getRegionId(), svl.userRouteId ?? null, () => {
      svl.canvas.setOnlyLabelsOnPanoAsVisible(svl.panoViewer.getPanoId());
      // Wait for the icon cache before this first paint (resolves immediately if already warm).
      svl.iconsPreloaded.then(() => {
        svl.canvas.render();
      });
    });

    svl.taskContainer.renderAllTasks();
    const distance = svl.taskContainer.getCompletedTaskDistance();
    svl.overallStats.setRegionAuditedDistance(distance);

    // Prefetch Mapillary data on images along the street to improve load times for images along the street.
    svl.navigationService.prefetchAlongStreet(svl.taskContainer.getCurrentTask().getFeature());
  }

  // This is a callback function that is executed after every loading process is done.
  #handleDataLoadComplete() {
    if (this.#loadingTasksCompleted && this.#loadingMissionsCompleted && this.#loadLabelTags) {
      // Mark region as complete if there are no streets left with max priority (= 1).
      if (!svl.taskContainer.hasMaxPriorityTask()) {
        svl.regionModel.setRegionCompleteAcrossAllUsers();
      }

      // Set up a few initial views now that everything has loaded. A seeded POV (the labeler's stored view from the
      // label card's "Explore here" hop, #4637) wins over the default route-facing camera.
      if (this.#params.startPov) {
        // The seed set the pano zoom straight on the viewer, before ZoomControl existed — sync its buttons to that
        // zoom so zoom-out isn't left dead (#4637).
        svl.zoomControl.syncButtonsToZoom(svl.panoViewer.getPov().zoom);
      } else {
        svl.panoManager.setPovToRouteDirection();
      }
      svl.minimap.setMinimapLocation(svl.panoViewer.getPosition());
      svl.observedArea.panoChanged();
      svl.observedArea.update();
      svl.compass.update();
      svl.compass.enableCompassClick();
      // The first task was set before the crumbs existed, so draw the ones ahead now (#4669).
      svl.forwardCrumbs.refresh();
      // Re-render the nav arrows now that the compass and task exist, so the route-forward arrow is highlighted on
      // the very first pano too — PanoManager's own initial resetNavArrows ran before those were wired up. (#4671)
      svl.panoManager.resetNavArrows();

      // Remove the loading cover page and make the tool visible.
      document.getElementById('page-loading').style.visibility = 'hidden';
      document.querySelectorAll('.tool-ui').forEach((el) => el.classList.remove('ps-invisible'));

      // Check if the user has completed the onboarding tutorial.
      const mission = svl.missionContainer.getCurrentMission();
      if (mission.getProperty('missionType') === 'auditOnboarding') {
        this.#parkRouteUnavailableNotice();
        this.#startTutorialIntro();
      } else {
        this.#calculateAndSetTasksMissionsOffset();

        const currentRegion = svl.regionModel.currentRegion();
        if (svl.isExploreAddressMode()) {
          // Free exploration (#4451): hide the mission progress UI, and skip the mission-start modal (its copy
          // interpolates a mission distance, which this mission type doesn't have).
          document.getElementById('mission-progress-group').classList.add('ps-hidden');
          document.getElementById('compass-message-holder').classList.add('ps-hidden');
          svl.tracker.push('ExploreAddress_SessionStart');
          // Name the place when the search supplied one — "dropped near Teaneck High School" orients the user far
          // better than a generic greeting. The name comes from a URL param and the alert banner renders its
          // message as HTML, so the value is escaped here while the <b> in the string itself renders.
          const placeName = this.#params.startPlaceName;
          const startMessage = placeName
            ? i18next.t('popup.free-explore-start-named', { placeName, interpolation: { escapeValue: true } })
            : i18next.t('popup.free-explore-start');
          svl.alertController.showAlert(startMessage, 'exploreAddressStart', true);
          svl.reauditNotice.showForTask(svl.taskContainer.getCurrentTask());
        } else {
          // Initialize explore mission screens focused on a randomized label type, though users can switch between
          // them.
          const potentialLabelTypes = util.misc.PRIMARY_LABEL_TYPES;
          const labelType = potentialLabelTypes[Math.floor(Math.random() * potentialLabelTypes.length)];
          const currentMission = svl.missionContainer.getCurrentMission();
          const missionProgressM = currentMission.getProperty('distanceProgress') || 0;
          // A pre-existing in-progress street also counts as resuming — the server sets audit_task_id on the task
          // only when handing one back — since a labeler mid-street may have zero mission distance banked.
          const resuming = currentMission.getProperty('missionType') === 'audit'
            && (missionProgressM > 0 || Boolean(this.#params.task.properties.audit_task_id));
          new MissionStartTutorial('audit', labelType, {
            nLength: currentMission.getDistance('miles'),
            region: currentRegion.getProperty('name'),
            resuming,
          }, svl, this.#params.language);

          // Toasts telling the user this visit resumed something in progress (#4833), or that the route the URL
          // asked for could not be opened (#5156), deferred until the mission-start screen closes so they aren't
          // missed underneath it. At most one of these three shows: the dropped-route news outranks a resume note the
          // sidebar's route name already carries. The re-audit notice (#4895) is raised alongside them and `Toast`
          // queues it behind whichever took the spot, so no duration arithmetic is needed here.
          if (this.#takeRouteUnavailableNotice()) {
            document.addEventListener('ps:mission-start-tutorial:done', () => {
              svl.tracker.push('RouteUnavailableToast_Shown');
              Toast.show({
                message: i18next.t('right-ui.route-unavailable.message'),
                reference: document.getElementById('pano'),
                dark: true,
                duration: 10000,
              });
            }, { once: true });
          } else if (svl.userRouteId && this.#params.routeResumed) {
            document.addEventListener('ps:mission-start-tutorial:done', () => {
              svl.tracker.push('RouteResumeToast_Shown');
              Toast.show({
                message: i18next.t('right-ui.route-resume.message', { routeName: svl.routeName }),
                button: {
                  label: i18next.t('right-ui.route-resume.exit'),
                  onClick: () => {
                    svl.tracker.push('Click_ExitRoute', { source: 'toast' });
                    window.location.href = '/explore?resumeRoute=false';
                  },
                },
                reference: document.getElementById('pano'),
                dark: true,
                duration: 10000,
              });
            }, { once: true });
          } else if (!svl.userRouteId && resuming) {
            document.addEventListener('ps:mission-start-tutorial:done', () => {
              svl.tracker.push('MissionResumeToast_Shown');
              Toast.show({
                message: i18next.t('right-ui.mission-resume.message', {
                  regionName: currentRegion.getProperty('name'),
                  distanceLeft: Math.max(currentMission.getDistance('meters') - missionProgressM, 0),
                }),
                reference: document.getElementById('pano'),
                dark: true,
                duration: 10000,
              });
            }, { once: true });
          }
          document.addEventListener('ps:mission-start-tutorial:done', () => {
            svl.reauditNotice.showForTask(svl.taskContainer.getCurrentTask());
          }, { once: true });
        }

        this.#startTheMission(mission, currentRegion);
      }

      // Update the observed area now that everything has loaded.
      svl.observedArea.panoChanged();
      svl.observedArea.update();

      // Uniformly scale the whole tool to fit the viewport (like browser zoom) using var(--ui-scale).
      const applyExploreScale = () => {
        // Immersive mode (#5085) sizes the pano with CSS and floats the controls over it, so the scale fits only the
        // pano-wide ribbon and its own height into the whole window, with no page margins to keep clear of.
        const immersive = svl.immersiveMode?.isActive() ?? false;
        util.applyToolScale(
          immersive ? ['--pano-base-width'] : ['--pano-base-width', '--sidebar-base-gap', '--sidebar-base-width'],
          ['--ribbon-base-top', '--ribbon-base-height', '--pano-base-height'],
          immersive ? { maxScale: 3, hMargin: 0, bottomReserve: 0 } : {},
        );
        // The logical frame follows the displayed pano's aspect (#5085), and the label icon and its click target are
        // capped in screen px, so they depend on the pano's display scale (#4838), which is --ui-scale in the boxed
        // tool but not in a fill-window one. Cached rather than computed per render: they're read once per label per
        // canvas render, and per label on every mousemove, and each read would otherwise force a style recalculation.
        const displayScale = util.exploreDisplayScale();
        svl.CANVAS_FRAME = util.exploreCanvasFrame();
        svl.LABEL_ICON_RADIUS = util.labelIconRadius(displayScale);
        svl.LABEL_HIT_MARGIN = util.labelHitMargin(displayScale);
        // Toasts float 10% down the pano, which in immersive mode is where the label-type strip is; keep them under it.
        const pano = document.getElementById('pano');
        const ribbon = document.getElementById('ribbon-menu-holder');
        if (immersive && pano && ribbon) {
          pano.style.setProperty('--toast-min-top', `${ribbon.getBoundingClientRect().bottom + 8 * displayScale}px`);
        } else if (pano) {
          pano.style.removeProperty('--toast-min-top');
        }
      };
      /**
       * Re-lays out the tool for its current box: rescale, then re-raster the canvases and tell the pano viewer its
       * element changed size. Synchronous, so a layout switch (immersive mode, #5085) lands in one frame.
       */
      svl.relayout = () => {
        applyExploreScale();
        // A live toast is anchored to the pano's old box; nothing else tells it the box moved.
        Toast.repositionAll();
        // The pano was painted at scale 1 and its box has just changed size, which is exactly what can leave GSV
        // black until the camera moves (#2468): tell the viewer its box moved, then have it force a frame. The
        // workaround lives in the viewer (PanoViewer.repaint()) so only the provider that needs it does anything.
        svl.panoViewer?.resize();
        svl.panoViewer?.repaint();
        // The canvas was rasterized at scale 1 during init; re-raster it at the chosen scale.
        if (svl.canvas) svl.canvas.resize();
        if (svl.onboarding) svl.onboarding.resize();
        if (svl.observedArea) svl.observedArea.update();
      };
      svl.relayout();
      // Redraw fog of war after the rescale. Minimap does this async, so we have to listen on this event.
      if (svl.observedArea && svl.minimap) {
        google.maps.event.addListenerOnce(svl.minimap.getMap(), 'bounds_changed', () => svl.observedArea.update());
      }
      window.dispatchEvent(new Event('resize'));

      // Attached below the synthetic resize above, so page load never logs one: nothing was resized there, and the
      // rescale, re-raster and repaint that event stands in for have just been run inline.
      let resizeRasterTimer;
      window.addEventListener('resize', () => {
        applyExploreScale();
        clearTimeout(resizeRasterTimer);
        resizeRasterTimer = setTimeout(() => {
          // The viewer hears about the settled size, after the rescale above has changed its box — telling it per
          // event would describe the box it already had, and the last event of a drag would go unanswered. It also
          // keeps the providers whose resize() is a full re-measure (Mapillary, Infra3d, Panoramax) off the event
          // firehose. The repaint is GSV's #2468 workaround; PanoViewer.repaint() is a no-op elsewhere.
          svl.panoViewer.resize();
          svl.panoViewer.repaint();
          if (svl.canvas) svl.canvas.resize();
          if (svl.onboarding) svl.onboarding.resize();
          if (svl.observedArea) svl.observedArea.update();
          // Logged on the settled size rather than per event, so a window drag is one line (#5367). The repaint
          // above bypasses the POV path that logs POV_Changed, so none follows this one.
          svl.tracker.push('Window_Resized', {
            width: document.documentElement.clientWidth,
            height: document.documentElement.clientHeight,
          });
        }, 150);
      });
    }
  }

  #calculateAndSetTasksMissionsOffset() {
    const completedTasksDistance = util.math.kmsToMeters(
      svl.taskContainer.getCompletedTaskDistance({ units: 'kilometers' }),
    );
    const completedMissionsDistance = svl.missionContainer.getCompletedMissionDistance();
    const curMission = svl.missionContainer.getCurrentMission();
    const missProgress = curMission.getProperty('distanceProgress') ? curMission.getProperty('distanceProgress') : 0;

    svl.missionContainer.setTasksMissionsOffset(completedMissionsDistance - completedTasksDistance + missProgress);
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
    if (svl.isOnboarding()) {
      // The tutorial intro says "your route is still waiting" to a user who clicked through to one; that fact
      // lives only in the URL about to be pinned, and a route that failed to resolve (#5156) is not waiting.
      svl.tutorialRouteWaiting = new URLSearchParams(window.location.search).has('routeId')
        && !this.#params.routeUnavailable;
      ExploreUrlSync.pinTutorialUrl();
      return;
    }
    // Read at write time: a mission completes and its successor arrives in-page, and the URL has to name the one
    // the labeler is in now for the server to seed their reload.
    const sessionParams = () => (svl.isExploreAddressMode()
      ? {}
      : { missionId: svl.missionContainer.getCurrentMission().getProperty('missionId') });
    svl.urlSync = new ExploreUrlSync(
      svl.panoViewer, () => svl.immersiveMode?.isActive() ?? false, sessionParams,
    );
    svl.urlSync.start();
  }

  /**
   * Store DOM elements under svl.ui.
   * Todo. Once we update all the modules to take ui elements as injected arguments, get rid of the svl.ui namespace.
   */
  #initUI() {
    const byId = (id) => document.getElementById(id);
    svl.ui = {};

    // Minimap DOMs.
    svl.ui.minimap = {
      holder: byId('minimap-holder'),
      overlay: byId('minimap-overlay'),
      fogOfWar: byId('minimap-fog-of-war-canvas'),
      fov: byId('minimap-fov-canvas'),
      progressCircle: byId('minimap-progress-circle-canvas'),
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
      legendEarlierLabels: byId('minimap-legend-earlier-labels'),
      routeOverview: byId('minimap-route-overview'),
      routeOverviewCanvas: byId('minimap-route-overview-canvas'),
    };

    // Street view area DOM elements.
    svl.ui.streetview = {
      drawingLayer: byId('label-drawing-layer'),
      pano: byId('pano'),
      viewControlLayer: byId('view-control-layer'),
      modeSwitchWalk: byId('mode-switch-button-walk'),
      navArrows: byId('arrow-group'),
      dateHolder: byId('svl-panorama-date-holder'),
      datePill: byId('svl-panorama-date-pill'),
      date: byId('svl-panorama-date'),
    };

    // Canvas for the labeling area.
    svl.ui.canvas = {
      drawingLayer: byId('label-drawing-layer'),
      hoverCard: byId('label-hover-card'),
      hoverCardDelete: byId('label-hover-card-delete'),
      hoverCardEdit: byId('label-hover-card-edit'),
      hoverCardShare: byId('label-hover-card-share'),
    };

    // Context menu.
    svl.ui.contextMenu = {
      holder: byId('context-menu-holder'),
      severityMenu: byId('severity-menu'),
      severityRadioHolder: byId('severity-radio-holder'),
      radioButtons: Array.from(document.querySelectorAll('input[name=\'label-severity\']')),
      tagSection: byId('context-menu-tag-section'),
      tagHolder: byId('context-menu-tag-holder'),
      textBox: byId('context-menu-description-text-box'),
      closeButton: byId('context-menu-close-button'),
    };

    // Tutorial.
    svl.ui.onboarding = {
      holder: byId('onboarding-holder'),
      messageHolder: byId('onboarding-message-holder'),
      background: byId('onboarding-background'),
      canvas: byId('onboarding-canvas'),
      handGestureHolder: byId('hand-gesture-holder'),
    };
  }
}
