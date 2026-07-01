/**
 * Main module of SVLabel
 * @param params
 * @returns {{className: string}}
 * @constructor
 */
function Main (params) {
    var self = { className: 'Main' };

    // Initialize things that needs data loading.
    var loadingTasksCompleted = false;
    var loadingMissionsCompleted = false;
    var loadLabelTags = false;

    svl.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';
    svl.onboarding = null;
    svl.isOnboarding = function() {
        return params.mission.mission_type === 'auditOnboarding';
    };
    svl.regionId = params.regionId;

    svl.LABEL_ICON_RADIUS = 17;
    svl.TUTORIAL_PANO_HEIGHT = 6656;
    svl.TUTORIAL_PANO_WIDTH = 13312;
    svl.TUTORIAL_PANO_SCALE_FACTOR = 3.25;
    svl.STREETVIEW_MAX_DISTANCE = 25; // 25 meters.
    svl.CLOSE_TO_ROUTE_THRESHOLD = 0.05; // 50 meters.
    svl.CONNECTED_TASK_THRESHOLD = 0.025; // 25 meters.

    async function _init (params) {
        params = params || {};

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

        svl.alert = new Alert();
        svl.stuckAlert = new StuckAlert(svl.alert);

        const startLat = params.task.properties.current_lat;
        const startLng = params.task.properties.current_lng;
        svl.panoStore = new PanoStore();
        svl.viewerType = svl.isOnboarding() ? GsvViewer : params.viewerType;

        // Set up the PanoManager and PanoViewer.
        const isTutorialTask = params.task.properties.street_edge_id === params.tutorialStreetId;
        const newTask = new Task(params.task, isTutorialTask);
        const initParams = isTutorialTask ? { startPanoId: 'tutorial' } : { startLat: startLat, startLng: startLng };
        const errorParams = { task: newTask, missionId: params.mission.mission_id };
        svl.panoManager = await PanoManager.create(svl.viewerType, params.viewerAccessToken, initParams, errorParams);
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
        svl.keyboardShortcutAlert = new KeyboardShortcutAlert(svl.alert);
        svl.ratingReminderAlert = new RatingReminderAlert(svl.alert);
        svl.zoomShortcutAlert = new ZoomShortcutAlert(svl.alert);
        svl.jumpAlert = new JumpAlert(svl.alert);

        svl.badgeProgress = new BadgeProgress();
        svl.overallStats = new OverallStats();
        svl.missionProgressBar = new ProgressBar(
            'status-current-mission-completion-bar-filler', 'status-current-mission-completion-rate'
        );
        svl.missionProgressBar.update(0);
        svl.neighborhoodProgressBar = new NeighborhoodProgressBar();
        svl.missionPanel = new MissionPanel();

        svl.contextMenu = new ContextMenu(svl.ui.contextMenu);

        // Game effects
        svl.audioEffect = new AudioEffect(svl.rootDirectory, svl.storage);

        const neighborhood = new Neighborhood({ regionId: params.regionId, geoJSON: params.regionGeoJSON, name: params.regionName });
        svl.neighborhoodModel.setCurrentNeighborhood(neighborhood);

        svl.observedArea = new ObservedArea(svl.ui.minimap);

        // Mission
        svl.missionContainer = new MissionContainer(svl.missionPanel, svl.missionModel);
        svl.missionController = new MissionController(svl.missionModel, svl.neighborhoodModel,
            svl.missionContainer, svl.tracker);
        svl.missionFactory = new MissionFactory (svl.missionModel);

        svl.missionModel.trigger("MissionFactory:create", params.mission); // create current mission and set as current
        svl.form = new Form(svl.labelContainer, svl.missionModel, svl.missionContainer, svl.panoStore,
            svl.taskContainer, svl.tracker, params.dataStoreUrl);
        if (params.mission.current_audit_task_id) {
            const currTask = svl.taskContainer.getCurrentTask();
            const currTaskId = currTask.getProperty('auditTaskId');
            if (!currTaskId) currTask.setProperty("auditTaskId", params.mission.current_audit_task_id);
        } else {
            await svl.form.submitData(); // Get an audit_task_id from the back end.
        }
        svl.popUpMessage = new PopUpMessage(svl.form, svl.taskContainer, svl.tracker, svl.user);
        svl.aiGuidance = new AiGuidance(svl.tracker, svl.popUpMessage);

        // Logs when the page's focus changes.
        function logPageFocus() {
            if (document.hasFocus()) {
                svl.tracker.push("PageGainedFocus");
            } else {
                svl.tracker.push("PageLostFocus");
            }
        }
        window.addEventListener("focus", function(event) {
            logPageFocus();
        });
        window.addEventListener("blur", function(event) {
            logPageFocus();
        });
        logPageFocus();

        // Modals
        var modalMissionCompleteMap = new ModalMissionCompleteMap('modal-mission-complete-map', params.mapboxApiKey);
        svl.modalMissionComplete = new ModalMissionComplete(svl.missionContainer, svl.missionModel,
            svl.taskContainer, modalMissionCompleteMap);
        svl.modalMissionComplete.hide();

        svl.feedbackModal = new FeedbackModal(svl, svl.tracker, svl.ribbon, svl.taskContainer);
        svl.panoOverlayControls = new PanoOverlayControls(svl.tracker, svl.navigationService, svl.stuckAlert,
            svl.keyboardShortcutAlert);

        svl.infoPopover = new PanoInfoPopover(svl.ui.streetview.dateHolder, svl.panoViewer, svl.panoViewer.getPosition,
            svl.panoViewer.getPanoId, () => svl.taskContainer.getCurrentTaskStreetEdgeId(),
            svl.neighborhoodModel.currentNeighborhood().getRegionId,
            function() { return svl.panoStore.getPanoData(svl.panoViewer.getPanoId()).getProperty('captureDate'); },
            function() { return svl.panoStore.getPanoData(svl.panoViewer.getPanoId()).getProperty('address'); },
            svl.panoViewer.getPov, true,
            function() { svl.tracker.push('PanoInfoButton_Click'); },
            function() { svl.tracker.push('PanoInfoCopyToClipboard_Click'); },
            function() { svl.tracker.push('PanoInfoViewInPano_Click'); }
        );

        // Speed limit
        svl.speedLimit = new SpeedLimit(svl.panoViewer, svl.panoViewer.getPosition, svl.isOnboarding, null, null);

        // Survey for select users
        svl.modalSurvey = new ModalSurvey();

        svl.zoomControl = new ZoomControl(svl.canvas, svl.tracker);
        svl.keyboard = new Keyboard(svl, svl.canvas, svl.contextMenu, svl.navigationService, svl.ribbon, svl.zoomControl);
        loadData(svl.taskContainer, svl.missionModel, svl.neighborhoodModel, svl.contextMenu);

        $("#navbar-retake-tutorial-btn").on('click', function () {
            window.location.replace('/explore?retakeTutorial=true');
        });

        $('#sign-in-modal-container').on('hide.bs.modal', function () {
            svl.popUpMessage.enableInteractions();
            $(".tool-ui").css('opacity', 1);
        });
        $('#sign-in-modal-container').on('show.bs.modal', function () {
            svl.popUpMessage.disableInteractions();
            $(".tool-ui").css('opacity', 0.5);
        });
        $('#sign-in-button').on('click', function(){
            $("#sign-in-modal").removeClass("hidden");
            $("#sign-up-modal").addClass("hidden");
            $(".tool-ui").css('opacity', 0.5);
        });

        // Ribbon-button tooltip attributes are set in RibbonMenu (which owns those buttons); this just initializes them.
        $('[data-toggle="tooltip"]').tooltip({
            delay: { "show": 500, "hide": 100 },
            html: true,
            container: 'body'
        });

        // Clean up the URL in the address bar.
        _updateURL();
    }

    function loadData(taskContainer, missionModel, neighborhoodModel, contextMenu) {
        // If in the tutorial, we already have the tutorial task. If not, get the rest of the tasks in the neighborhood.
        if (svl.isOnboarding()) {
            loadingTasksCompleted = true;
            handleDataLoadComplete();
        } else {
            taskContainer.fetchTasks().then(() => {
                loadingTasksCompleted = true;
                handleDataLoadComplete();
            });
        }

        // Fetch the user's completed missions.
        missionModel.fetchCompletedMissionsInNeighborhood(function () {
            loadingMissionsCompleted = true;
            handleDataLoadComplete();
        });

        contextMenu.fetchLabelTags(function () {
            loadLabelTags = true;
            handleDataLoadComplete();
        })
    }

    var onboardingHandAnimation = null;
    var onboardingStates = null;
    function startOnboarding () {
        // TODO probably have a GET endpoint to get onboarding mission..?
        //hide any alerts
        svl.alert.hideAlert();

        if (!onboardingHandAnimation) {
            onboardingHandAnimation = new HandAnimation(svl.rootDirectory, svl.ui.onboarding);
            onboardingStates = new OnboardingStates(svl.contextMenu, svl.compass, svl.panoManager);
        }

        if (!("onboarding" in svl && svl.onboarding)) {
            svl.onboarding = new Onboarding(svl, svl.compass, onboardingHandAnimation, svl.navigationService,
                svl.missionContainer, svl.panoOverlayControls, onboardingStates, svl.ribbon, svl.tracker, svl.canvas,
                svl.ui.canvas, svl.contextMenu, svl.ui.onboarding, svl.zoomControl);
        }
        svl.onboarding.start();
    }

    function startTheMission(mission, neighborhood) {
        svl.ui.minimap.holder.css('backgroundColor', '#e5e3df');

        // Popup the message explaining the goal of the current mission.
        if (svl.missionContainer.isTheFirstMission()) {
            neighborhood = svl.neighborhoodModel.currentNeighborhood();
            svl.initialMissionInstruction = new InitialMissionInstruction(svl.compass, svl.navigationService, svl.popUpMessage,
                svl.taskContainer, svl.labelContainer, svl.aiGuidance, svl.tracker);
            svl.initialMissionInstruction.start(neighborhood);
        } else {
            // Show AI guidance message for the first street. Handled by InitialMissionInstruction if 1st mission.
            svl.aiGuidance.showAiGuidanceMessage();
        }

        svl.missionModel.updateMissionProgress(mission, neighborhood);
        svl.missionPanel.setMessage(mission);

        svl.labelContainer.fetchLabelsToResumeMission(neighborhood.getRegionId(), function (result) {
            svl.canvas.setOnlyLabelsOnPanoAsVisible(svl.panoViewer.getPanoId());
            // Wait for the icon cache before this first paint (resolves immediately if already warm).
            svl.iconsPreloaded.then(function() { svl.canvas.render(); });
        });

        svl.taskContainer.renderAllTasks();
        var distance = svl.taskContainer.getCompletedTaskDistance();
        svl.overallStats.setNeighborhoodAuditedDistance(distance);

        // Prefetch Mapillary data on images along the street to improve load times for images along the street.
        svl.navigationService.prefetchAlongStreet(svl.taskContainer.getCurrentTask().getFeature())
    }

    // This is a callback function that is executed after every loading process is done.
    function handleDataLoadComplete () {
        if (loadingTasksCompleted && loadingMissionsCompleted && loadLabelTags) {

            // Mark neighborhood as complete if there are no streets left with max priority (= 1).
            if(!svl.taskContainer.hasMaxPriorityTask()) {
                svl.neighborhoodModel.setNeighborhoodCompleteAcrossAllUsers();
            }

            // Set up a few initial views now that everything has loaded.
            svl.panoManager.setPovToRouteDirection();
            svl.minimap.setMinimapLocation(svl.panoViewer.getPosition());
            svl.observedArea.panoChanged();
            svl.observedArea.update();
            svl.compass.update();
            svl.compass.enableCompassClick();

            // Remove the loading cover page and make the tool visible.
            $("#page-loading").css({"visibility": "hidden"});
            $(".tool-ui").css({"visibility": "visible"});
            $(".visible").css({"visibility": "visible"});

            // Check if the user has completed the onboarding tutorial.
            var mission = svl.missionContainer.getCurrentMission();
            if (mission.getProperty("missionType") === "auditOnboarding") {
                startOnboarding();
            } else {
                _calculateAndSetTasksMissionsOffset();

                // Initialize explore mission screens focused on a randomized label type, though users can switch between them.
                var currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
                const potentialLabelTypes = util.misc.PRIMARY_LABEL_TYPES;
                const labelType = potentialLabelTypes[Math.floor(Math.random() * potentialLabelTypes.length)];
                const missionStartTutorial = new MissionStartTutorial('audit', labelType, {
                    nLength: svl.missionContainer.getCurrentMission().getDistance("miles"),
                    neighborhood: currentNeighborhood.getProperty('name')
                }, svl, params.language);

                startTheMission(mission, currentNeighborhood);
            }

            // Update the observed area now that everything has loaded.
            svl.observedArea.panoChanged();
            svl.observedArea.update();

            // Uniformly scale the whole tool to fit the viewport (like browser zoom) using var(--ui-scale).
            const applyExploreScale = () => util.applyToolScale(
                ['--pano-base-width', '--sidebar-base-gap', '--sidebar-base-width'],
                ['--ribbon-base-top', '--ribbon-base-height', '--pano-base-height']
            );
            applyExploreScale();
            // The canvas was rasterized at scale 1 during init; re-raster it at the chosen scale.
            if (svl.canvas) svl.canvas.resize();
            if (svl.observedArea) svl.observedArea.update();
            // Redraw fog of war after the rescale. Minimap does this async, so we have to listen on this event.
            if (svl.observedArea && svl.minimap) {
                google.maps.event.addListenerOnce(svl.minimap.getMap(), 'bounds_changed',
                    () => svl.observedArea.update());
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

    function _calculateAndSetTasksMissionsOffset() {
        var completedTasksDistance = util.math.kmsToMeters(svl.taskContainer.getCompletedTaskDistance({ units: 'kilometers' }));
        var completedMissionsDistance = svl.missionContainer.getCompletedMissionDistance();
        var curMission = svl.missionContainer.getCurrentMission();
        var missProgress = curMission.getProperty("distanceProgress") ? curMission.getProperty("distanceProgress") : 0;

        svl.missionContainer.setTasksMissionsOffset(completedMissionsDistance - completedTasksDistance + missProgress);
    }

    /**
     * Cleans up URL in address bar by removing query params that aren't necessary, changing /audit to /explore. etc.
     * @private
     */
    function _updateURL() {
        var newURL = `${window.location.protocol}//${window.location.host}/explore`;
        if (window.location.search.includes('retakeTutorial=true')) {
            newURL += '?retakeTutorial=true';
        }
        if (newURL !== window.location.href) {
            window.history.pushState({ },'', newURL);
        }
    }

    /**
     * Store jQuery DOM elements under svl.ui
     * Todo. Once we update all the modules to take ui elements as injected arguments, get rid of the svl.ui namespace and everything in it.
     * @private
     */
    function _initUI () {
        svl.ui = {};

        // Minimap DOMs.
        svl.ui.minimap = {};
        svl.ui.minimap.holder = $("#minimap-holder");
        svl.ui.minimap.overlay = $("#minimap-overlay");
        svl.ui.minimap.message = $("#minimap-message");
        svl.ui.minimap.fogOfWar = $("#minimap-fog-of-war-canvas");
        svl.ui.minimap.fov = $("#minimap-fov-canvas");
        svl.ui.minimap.progressCircle = $("#minimap-progress-circle-canvas");
        svl.ui.minimap.percentObserved = $("#minimap-percent-observed");

        // Street view area DOM elements.
        svl.ui.streetview = {};
        svl.ui.streetview.canvas = $("canvas#labelCanvas");
        svl.ui.streetview.drawingLayer = $("div#labelDrawingLayer");
        svl.ui.streetview.pano = $("div#pano");
        svl.ui.streetview.viewControlLayer = $("div#view-control-layer");
        svl.ui.streetview.modeSwitchWalk = $("#mode-switch-button-walk");
        svl.ui.streetview.navArrows = $("#arrow-group");
        svl.ui.streetview.dateHolder = $("#svl-panorama-date-holder");
        svl.ui.streetview.date = $("#svl-panorama-date");

        // Canvas for the labeling area.
        svl.ui.canvas = {};
        svl.ui.canvas.drawingLayer = $("#labelDrawingLayer");
        svl.ui.canvas.deleteIconHolder = $("#delete-icon-holder");
        svl.ui.canvas.severityIconHolder = $("#severity-icon-holder");
        svl.ui.canvas.deleteIcon = $("#label-delete-icon");
        svl.ui.canvas.severityIcon = $("#severity-icon");
        svl.ui.canvas.hoverInfoHolder = $("#label-hover-info");
        svl.ui.canvas.hoverInfoType = $("#label-hover-info-type");
        svl.ui.canvas.hoverInfoSeverity = $("#label-hover-info-severity");
        svl.ui.canvas.hoverInfoSeverityIcon = $("#label-hover-info-severity-icon");
        svl.ui.canvas.hoverInfoSeverityText = $("#label-hover-info-severity-text");

        // Context menu.
        svl.ui.contextMenu = {};
        svl.ui.contextMenu.holder = $("#context-menu-holder");
        svl.ui.contextMenu.severityMenu = $("#severity-menu");
        svl.ui.contextMenu.severityRadioHolder = $("#severity-radio-holder");
        svl.ui.contextMenu.radioButtons = $("input[name='label-severity']");
        svl.ui.contextMenu.tagHolder = $("#context-menu-tag-holder");
        svl.ui.contextMenu.tags = $("button[name='tag']");
        svl.ui.contextMenu.textBox = $("#context-menu-description-text-box");
        svl.ui.contextMenu.closeButton = $("#context-menu-close-button");

        // Tutorial.
        svl.ui.onboarding = {};
        svl.ui.onboarding.holder = $("#onboarding-holder");
        svl.ui.onboarding.messageHolder = $("#onboarding-message-holder");
        svl.ui.onboarding.background = $("#onboarding-background");
        svl.ui.onboarding.foreground = $("#onboarding-foreground");
        svl.ui.onboarding.canvas = $("#onboarding-canvas");
        svl.ui.onboarding.handGestureHolder = $("#hand-gesture-holder");

    }

    // Gets all the text on the explore page for the correct language.
    // TODO this should really happen in explore.scala.html before we call Main().
    window.appManager.ready(function() {
        _initUI();
        _init(params);
    });

    self.loadData = loadData;

    return self;
}
