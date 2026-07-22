/**
 * Main module of SVLabel. Bootstraps the Explore/Audit tool: constructs all the modules, loads data, and starts the
 * first mission or the onboarding tutorial.
 */
class Main {
  #params;

  // Initialize things that need data loading.
  #loadingTasksCompleted = false;
  #loadingMissionsCompleted = false;
  #loadLabelTags = false;

  #onboardingHandAnimation = null;
  #onboardingStates = null;

  /**
   * @param {Object} params - Page params injected by explore.scala.html.
   */
  constructor(params) {
    this.#params = params;

    svl.imageDirectory = ('imageDirectory' in params) ? params.imageDirectory : '/';
    svl.audioDirectory = ('audioDirectory' in params) ? params.audioDirectory : '/';
    svl.onboarding = null;
    svl.isOnboarding = () => this.#params.mission.mission_type === 'auditOnboarding';
    // Free exploration at a searched address (#4451): labeling works normally, but the task/mission never complete.
    svl.isExploreAddressMode = () => this.#params.mission.mission_type === 'exploreAddress';
    svl.regionId = params.regionId;

    svl.LABEL_ICON_RADIUS = 17;
    svl.TUTORIAL_PANO_HEIGHT = 6656;
    svl.TUTORIAL_PANO_WIDTH = 13312;
    svl.TUTORIAL_PANO_SCALE_FACTOR = 3.25;
    svl.STREETVIEW_MAX_DISTANCE = 25; // 25 meters.
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
    svl.makeCrops = params.makeCrops;

    svl.storage = new TemporaryStorage(JSON);
    svl.tracker = new Tracker();
    svl.user = new User(params.user);

    // Models
    svl.neighborhoodModel = new NeighborhoodModel();
    svl.neighborhoodModel.setAsRouteOrNeighborhood(svl.userRouteId ? 'route' : 'neighborhood');
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
    const currLatLng = svl.panoViewer.getPosition();
    newTask.updateTheFurthestPointReached(currLatLng);

    svl.minimap = await Minimap.create(currLatLng);
    svl.peg = await Peg.create(svl.minimap.getMap(), currLatLng);

    svl.ribbon = new RibbonMenu(svl.tracker);
    svl.canvas = new Canvas(svl.ribbon);

    // Warm the label-icon cache up front so canvas renders draw icons in the right order. See Label.preloadIcons.
    svl.iconsPreloaded = Label.preloadIcons();

    svl.navigationService = new NavigationService(svl.neighborhoodModel, svl.ui.streetview);

    svl.taskContainer = new TaskContainer(svl.neighborhoodModel, svl, svl.tracker);
    svl.taskContainer._tasks.push(newTask);
    svl.taskContainer.setCurrentTask(newTask);
    svl.labelContainer = new LabelContainer($, params.nextTemporaryLabelId);

    // Set map parameters and instantiate it.
    svl.compass = new Compass(svl, svl.navigationService, svl.taskContainer);
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
    svl.neighborhoodProgressBar = new NeighborhoodProgressBar();
    svl.missionPanel = new MissionPanel();

    svl.contextMenu = new ContextMenu(svl.ui.contextMenu);

    // Game effects
    svl.audioEffect = new AudioEffect(svl.audioDirectory, svl.storage);

    const neighborhood = new Neighborhood({
      regionId: params.regionId, geoJSON: params.regionGeoJSON, name: params.regionName,
    });
    svl.neighborhoodModel.setCurrentNeighborhood(neighborhood);

    svl.observedArea = new ObservedArea(svl.ui.minimap);
    svl.minimapLegend = new MinimapLegend(svl.ui.minimap, svl.tracker);
    svl.routeOverview = new RouteOverview(svl.ui.minimap, svl.tracker);

    // Mission
    svl.missionContainer = new MissionContainer(svl.missionPanel, svl.missionModel);
    svl.missionController = new MissionController(svl.missionModel, svl.neighborhoodModel,
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

    svl.infoPopover = new PanoInfoPopover(svl.ui.streetview.dateHolder, svl.panoViewer, svl.panoViewer.getPosition,
      svl.panoViewer.getPanoId, () => svl.taskContainer.getCurrentTaskStreetEdgeId(),
      () => svl.neighborhoodModel.currentNeighborhood().getRegionId(),
      () => svl.panoStore.getPanoData(svl.panoViewer.getPanoId()).getProperty('captureDate'),
      () => svl.panoStore.getPanoData(svl.panoViewer.getPanoId()).getProperty('address'),
      svl.panoViewer.getPov, true,
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

    // Speed limit
    svl.speedLimit = new SpeedLimit(svl.panoViewer, svl.panoViewer.getPosition, svl.isOnboarding, null, null);

    // Survey for select users
    svl.modalSurvey = new ModalSurvey();

    svl.zoomControl = new ZoomControl(svl.canvas, svl.tracker);
    svl.keyboard = new KeyboardManager(
      svl, svl.canvas, svl.contextMenu, svl.navigationService, svl.ribbon, svl.zoomControl,
    );
    this.#loadData(svl.taskContainer, svl.missionModel, svl.neighborhoodModel, svl.contextMenu);

    $('#navbar-retake-tutorial-btn').on('click', () => {
      window.location.replace('/explore?retakeTutorial=true');
    });

    // The auth dialog is absent when signed in; dim the tool UI while it's open (events from common/Modal.js).
    const signInModal = document.getElementById('sign-in-modal-container');
    signInModal?.addEventListener('ps:modal:hidden', () => {
      svl.popUpMessage.enableInteractions();
      $('.tool-ui').css('opacity', 1);
    });
    signInModal?.addEventListener('ps:modal:show', () => {
      svl.popUpMessage.disableInteractions();
      $('.tool-ui').css('opacity', 0.5);
    });

    // Ribbon-button tooltip attributes are set in RibbonMenu (which owns those buttons); this just initializes them.
    $('[data-toggle="tooltip"]').tooltip({
      delay: { show: 500, hide: 100 },
      html: true,
      container: 'body',
    });

    // Clean up the URL in the address bar.
    this.#updateURL();
  }

  #loadData(taskContainer, missionModel, neighborhoodModel, contextMenu) {
    // If in the tutorial, we already have the tutorial task. If not, get the rest of the tasks in the neighborhood.
    if (svl.isOnboarding()) {
      this.#loadingTasksCompleted = true;
      this.#handleDataLoadComplete();
    } else {
      taskContainer.fetchTasks().then(() => {
        this.#loadingTasksCompleted = true;
        this.#handleDataLoadComplete();
      });
    }

    // Fetch the user's completed missions.
    missionModel.fetchCompletedMissionsInNeighborhood(() => {
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

    if (!this.#onboardingHandAnimation) {
      this.#onboardingHandAnimation = new HandAnimation(svl.imageDirectory, svl.ui.onboarding);
      this.#onboardingStates = new OnboardingStates(svl.contextMenu, svl.compass, svl.panoManager);
    }

    if (!('onboarding' in svl && svl.onboarding)) {
      svl.onboarding = new Onboarding(svl, svl.compass, this.#onboardingHandAnimation, svl.navigationService,
        svl.missionContainer, svl.panoOverlayControls, this.#onboardingStates, svl.ribbon, svl.tracker, svl.canvas,
        svl.ui.canvas, svl.contextMenu, svl.ui.onboarding, svl.zoomControl);
    }
    svl.onboarding.start();
  }

  #startTheMission(mission, neighborhood) {
    svl.ui.minimap.holder.css('backgroundColor', '#e5e3df');

    // Popup the message explaining the goal of the current mission.
    if (svl.missionContainer.isTheFirstMission()) {
      neighborhood = svl.neighborhoodModel.currentNeighborhood();
      svl.initialMissionInstruction = new InitialMissionInstruction(
        svl.compass, svl.navigationService, svl.popUpMessage,
        svl.taskContainer, svl.labelContainer, svl.aiGuidance, svl.tracker,
      );
      svl.initialMissionInstruction.start(neighborhood);
    } else {
      // Show AI guidance message for the first street. Handled by InitialMissionInstruction if 1st mission.
      svl.aiGuidance.showAiGuidanceMessage();
    }

    svl.missionModel.updateMissionProgress(mission, neighborhood);
    svl.missionPanel.setMessage(mission);
    svl.minimap.updateMissionProgress(mission);

    svl.labelContainer.fetchLabelsToResumeMission(neighborhood.getRegionId(), () => {
      svl.canvas.setOnlyLabelsOnPanoAsVisible(svl.panoViewer.getPanoId());
      // Wait for the icon cache before this first paint (resolves immediately if already warm).
      svl.iconsPreloaded.then(() => {
        svl.canvas.render();
      });
    });

    svl.taskContainer.renderAllTasks();
    const distance = svl.taskContainer.getCompletedTaskDistance();
    svl.overallStats.setNeighborhoodAuditedDistance(distance);

    // Prefetch Mapillary data on images along the street to improve load times for images along the street.
    svl.navigationService.prefetchAlongStreet(svl.taskContainer.getCurrentTask().getFeature());
  }

  // This is a callback function that is executed after every loading process is done.
  #handleDataLoadComplete() {
    if (this.#loadingTasksCompleted && this.#loadingMissionsCompleted && this.#loadLabelTags) {
      // Mark neighborhood as complete if there are no streets left with max priority (= 1).
      if (!svl.taskContainer.hasMaxPriorityTask()) {
        svl.neighborhoodModel.setNeighborhoodCompleteAcrossAllUsers();
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

      // Remove the loading cover page and make the tool visible.
      $('#page-loading').css({ visibility: 'hidden' });
      $('.tool-ui').removeClass('ps-invisible');

      // Check if the user has completed the onboarding tutorial.
      const mission = svl.missionContainer.getCurrentMission();
      if (mission.getProperty('missionType') === 'auditOnboarding') {
        this.#startTutorialIntro();
      } else {
        this.#calculateAndSetTasksMissionsOffset();

        const currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
        if (svl.isExploreAddressMode()) {
          // Free exploration (#4451): hide the mission progress UI, and skip the mission-start modal (its copy
          // interpolates a mission distance, which this mission type doesn't have).
          document.getElementById('mission-progress-group').classList.add('ps-hidden');
          document.getElementById('compass-message-holder').classList.add('ps-hidden');
          svl.tracker.push('ExploreAddress_SessionStart');
          // Name the place when the search supplied one — "dropped near Teaneck High School" orients the user far
          // better than a generic greeting. The name comes from a URL param and lands in innerHTML, so it must stay
          // an i18next interpolation: the default escapeValue escapes it, while the <b> in the string itself renders.
          const placeName = this.#params.startPlaceName;
          const startMessage = placeName
            ? i18next.t('popup.free-explore-start-named', { placeName })
            : i18next.t('popup.free-explore-start');
          svl.alertController.showAlert(startMessage, 'exploreAddressStart', true);
        } else {
          // Initialize explore mission screens focused on a randomized label type, though users can switch between
          // them.
          const potentialLabelTypes = util.misc.PRIMARY_LABEL_TYPES;
          const labelType = potentialLabelTypes[Math.floor(Math.random() * potentialLabelTypes.length)];
          new MissionStartTutorial('audit', labelType, {
            nLength: svl.missionContainer.getCurrentMission().getDistance('miles'),
            neighborhood: currentNeighborhood.getProperty('name'),
          }, svl, this.#params.language);
        }

        this.#startTheMission(mission, currentNeighborhood);

        // On a designated route, open fitted to the whole route so the user sees its shape before street-level detail
        // takes over (auto-exits on first pano interaction). A neighborhood audit has no bounded route to frame — its
        // "route" is just the current street at this point — so it opens at street level with the fog visible (#4639).
        if (svl.neighborhoodModel.isRoute) svl.minimap.enterOverview(true);
      }

      // Update the observed area now that everything has loaded.
      svl.observedArea.panoChanged();
      svl.observedArea.update();

      // Uniformly scale the whole tool to fit the viewport (like browser zoom) using var(--ui-scale).
      const applyExploreScale = () => util.applyToolScale(
        ['--pano-base-width', '--sidebar-base-gap', '--sidebar-base-width'],
        ['--ribbon-base-top', '--ribbon-base-height', '--pano-base-height'],
      );
      applyExploreScale();
      // The canvas was rasterized at scale 1 during init; re-raster it at the chosen scale.
      if (svl.canvas) svl.canvas.resize();
      if (svl.observedArea) svl.observedArea.update();
      // Redraw fog of war after the rescale. Minimap does this async, so we have to listen on this event.
      if (svl.observedArea && svl.minimap) {
        google.maps.event.addListenerOnce(svl.minimap.getMap(), 'bounds_changed', () => svl.observedArea.update());
      }
      window.dispatchEvent(new Event('resize'));

      let resizeRasterTimer;
      window.addEventListener('resize', () => {
        applyExploreScale();
        clearTimeout(resizeRasterTimer);
        resizeRasterTimer = setTimeout(() => {
          if (svl.canvas) svl.canvas.resize();
          if (svl.observedArea) svl.observedArea.update();
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
   * Cleans up the URL in the address bar: normalizes /audit to /explore and drops query params that aren't needed.
   * For a drop-in session it keeps the seed params so a refresh — or a copied/shared link — resumes at the same
   * place and camera rather than falling back to a normal audit mission (#4451, #4637).
   */
  #updateURL() {
    let newURL = `${window.location.protocol}//${window.location.host}/explore`;
    if (window.location.search.includes('retakeTutorial=true')) {
      newURL += '?retakeTutorial=true';
    } else if (svl.isExploreAddressMode()) {
      // Carry the whole drop-in seed, not just the coordinates: the label card's "Explore here" hop (#4637) also
      // seeds a point of view and pano, so keeping them lets a refreshed or shared link land on the exact view the
      // card pointed at instead of only the spot. An expired pano still falls back to the lat/lng (#4635).
      const params = this.#params;
      const urlParams = new URLSearchParams({ lat: params.startLat, lng: params.startLng });
      if (params.startPov) {
        urlParams.set('heading', params.startPov.heading);
        urlParams.set('pitch', params.startPov.pitch);
        urlParams.set('zoom', params.startPov.zoom);
      }
      if (params.startPanoId) urlParams.set('panoId', params.startPanoId);
      if (params.startPlaceName) urlParams.set('placeName', params.startPlaceName);
      newURL += `?${urlParams.toString()}`;
    }
    if (newURL !== window.location.href) {
      window.history.pushState({ }, '', newURL);
    }
  }

  /**
   * Store jQuery DOM elements under svl.ui.
   * Todo. Once we update all the modules to take ui elements as injected arguments, get rid of the svl.ui namespace.
   */
  #initUI() {
    svl.ui = {};

    // Minimap DOMs.
    svl.ui.minimap = {};
    svl.ui.minimap.holder = $('#minimap-holder');
    svl.ui.minimap.overlay = $('#minimap-overlay');
    svl.ui.minimap.fogOfWar = $('#minimap-fog-of-war-canvas');
    svl.ui.minimap.fov = $('#minimap-fov-canvas');
    svl.ui.minimap.progressCircle = $('#minimap-progress-circle-canvas');
    svl.ui.minimap.percentObserved = $('#minimap-percent-observed');
    svl.ui.minimap.missionProgress = $('#minimap-mission-progress');
    svl.ui.minimap.missionProgressFill = $('#minimap-mission-progress-fill');
    svl.ui.minimap.missionProgressPercent = $('#minimap-mission-progress-percent');
    svl.ui.minimap.missionProgressDistance = $('#minimap-mission-progress-distance');
    svl.ui.minimap.coach = $('#minimap-coach');
    svl.ui.minimap.coachDismiss = $('#minimap-coach-dismiss');
    svl.ui.minimap.legendToggle = $('#minimap-legend-toggle');
    svl.ui.minimap.legendCard = $('#minimap-legend-card');
    svl.ui.minimap.legendClose = $('#minimap-legend-close');
    svl.ui.minimap.routeOverview = $('#minimap-route-overview');
    svl.ui.minimap.routeOverviewCanvas = $('#minimap-route-overview-canvas');

    // Street view area DOM elements.
    svl.ui.streetview = {};
    svl.ui.streetview.drawingLayer = $('div#label-drawing-layer');
    svl.ui.streetview.pano = $('div#pano');
    svl.ui.streetview.viewControlLayer = $('div#view-control-layer');
    svl.ui.streetview.modeSwitchWalk = $('#mode-switch-button-walk');
    svl.ui.streetview.navArrows = $('#arrow-group');
    svl.ui.streetview.dateHolder = $('#svl-panorama-date-holder');
    svl.ui.streetview.date = $('#svl-panorama-date');

    // Canvas for the labeling area.
    svl.ui.canvas = {};
    svl.ui.canvas.drawingLayer = $('#label-drawing-layer');
    svl.ui.canvas.deleteIconHolder = $('#delete-icon-holder');
    svl.ui.canvas.severityIconHolder = $('#severity-icon-holder');
    svl.ui.canvas.deleteIcon = $('#label-delete-icon');
    svl.ui.canvas.severityIcon = $('#severity-icon');
    svl.ui.canvas.hoverInfoHolder = $('#label-hover-info');
    svl.ui.canvas.hoverInfoType = $('#label-hover-info-type');
    svl.ui.canvas.hoverInfoSeverity = $('#label-hover-info-severity');
    svl.ui.canvas.hoverInfoSeverityIcon = $('#label-hover-info-severity-icon');
    svl.ui.canvas.hoverInfoSeverityText = $('#label-hover-info-severity-text');

    // Context menu.
    svl.ui.contextMenu = {};
    svl.ui.contextMenu.holder = $('#context-menu-holder');
    svl.ui.contextMenu.severityMenu = $('#severity-menu');
    svl.ui.contextMenu.severityRadioHolder = $('#severity-radio-holder');
    svl.ui.contextMenu.radioButtons = $('input[name=\'label-severity\']');
    svl.ui.contextMenu.tagHolder = $('#context-menu-tag-holder');
    svl.ui.contextMenu.tags = $('button[name=\'tag\']');
    svl.ui.contextMenu.textBox = $('#context-menu-description-text-box');
    svl.ui.contextMenu.closeButton = $('#context-menu-close-button');

    // Tutorial.
    svl.ui.onboarding = {};
    svl.ui.onboarding.holder = $('#onboarding-holder');
    svl.ui.onboarding.messageHolder = $('#onboarding-message-holder');
    svl.ui.onboarding.background = $('#onboarding-background');
    svl.ui.onboarding.foreground = $('#onboarding-foreground');
    svl.ui.onboarding.canvas = $('#onboarding-canvas');
    svl.ui.onboarding.handGestureHolder = $('#hand-gesture-holder');
  }
}
