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
    var loadNeighborhoodsCompleted = false;
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
    svl.STREETVIEW_MAX_DISTANCE = 40; // 40 meters.
    svl.CLOSE_TO_ROUTE_THRESHOLD = 0.05; // 50 meters.

    async function _init (params) {
        params = params || {};

        // Record any params that are important enough to attach directly to the svl object.
        svl.missionsCompleted = 0; // Just since loading the page.
        svl.userHasCompletedAMission = params.hasCompletedAMission;
        svl.routeId = params.routeId;
        svl.userRouteId = params.userRouteId;
        svl.cityId = params.cityId;
        svl.cityName = params.cityName;
        svl.cityNameShort = params.cityNameShort;
        svl.makeCrops = params.makeCrops;
        svl.mapillaryToken = params.mapillaryToken;
        svl.infra3dToken = params.infra3dToken;


        svl.storage = new TemporaryStorage(JSON);
        svl.tracker = new Tracker();
        svl.user = new User(params.user);

        // Models
        svl.neighborhoodModel = new NeighborhoodModel();
        svl.neighborhoodModel.setAsRouteOrNeighborhood(svl.userRouteId ? 'route' : 'neighborhood');
        svl.modalModel = new ModalModel();
        svl.missionModel = new MissionModel();
        svl.gameEffectModel = new GameEffectModel();
        svl.statusModel = new StatusModel();
        svl.taskModel = new TaskModel();
        svl.onboardingModel = new OnboardingModel();

        svl.alert = new Alert();
        svl.stuckAlert = new StuckAlert(svl.alert);

        const startLat = params.task.properties.current_lat;
        const startLng = params.task.properties.current_lng;
        svl.panoStore = new PanoStore();
        const viewerType = svl.isOnboarding() ? GsvViewer : Infra3dViewer;
        // TODO when we set up passing in a starting pano, could pass in tutorial when appropriate too. Then remove checks from PanoManager.js.
        svl.panoManager = await PanoManager(viewerType, { startLat: startLat, startLng: startLng });
        svl.minimap = new Minimap();

        svl.ribbon = new RibbonMenu(svl.tracker, svl.ui.ribbonMenu);
        svl.canvas = new Canvas(svl.ribbon);
        svl.navigationService = new NavigationService(svl.neighborhoodModel, svl.ui.streetview);

        svl.taskContainer = new TaskContainer(svl.neighborhoodModel, svl.streetViewService, svl, svl.tracker);
        svl.taskModel._taskContainer = svl.taskContainer;
        const isTutorialTask = params.task.properties.street_edge_id === params.tutorialStreetId;
        const newTask = new Task(params.task, isTutorialTask, startLat, startLng);
        svl.taskContainer._tasks.push(newTask);
        svl.taskContainer.setCurrentTask(newTask);
        svl.labelContainer = new LabelContainer($, params.nextTemporaryLabelId);

        // Set map parameters and instantiate it.
        svl.compass = new Compass(svl, svl.navigationService, svl.taskContainer, svl.ui.compass);
        svl.keyboardShortcutAlert = new KeyboardShortcutAlert(svl.alert);
        svl.ratingReminderAlert = new RatingReminderAlert(svl.alert);
        svl.zoomShortcutAlert = new ZoomShortcutAlert(svl.alert);
        svl.jumpModel = new JumpModel();
        svl.jumpAlert = new JumpAlert(svl.alert, svl.jumpModel);

        svl.statusField = new StatusField(svl.ui.status);
        svl.statusFieldOverall = new StatusFieldOverall(svl.ui.status);
        svl.statusFieldNeighborhood = new StatusFieldNeighborhood(svl.neighborhoodModel, svl.user, svl.ui.status);
        svl.statusFieldMissionProgressBar = new StatusFieldMissionProgressBar(svl.modalModel, svl.statusModel, svl.ui.status);
        svl.statusFieldMission = new StatusFieldMission(svl.modalModel, svl.ui.status);

        svl.labelCounter = new LabelCounter(d3);
        svl.contextMenu = new ContextMenu(svl.ui.contextMenu);

        // Game effects
        svl.audioEffect = new AudioEffect(svl.gameEffectModel, svl.ui.leftColumn, svl.rootDirectory, svl.storage);

        var neighborhood;
        svl.neighborhoodContainer = new NeighborhoodContainer(svl.neighborhoodModel);
        svl.neighborhoodModel._neighborhoodContainer = svl.neighborhoodContainer;

        neighborhood = new Neighborhood({ regionId: params.regionId, geoJSON: params.regionGeoJSON, name: params.regionName });
        svl.neighborhoodContainer.add(neighborhood);
        svl.neighborhoodContainer.setCurrentNeighborhood(neighborhood);

        svl.observedArea = new ObservedArea(svl.ui.minimap);

        // Mission
        svl.missionContainer = new MissionContainer(svl.statusFieldMission, svl.missionModel);
        svl.missionProgress = new MissionProgress(svl, svl.missionModel, svl.modalModel, svl.neighborhoodModel,
            svl.statusModel, svl.missionContainer, svl.neighborhoodContainer, svl.tracker);
        svl.missionFactory = new MissionFactory (svl.missionModel);

        svl.missionModel.trigger("MissionFactory:create", params.mission); // create current mission and set as current
        svl.form = new Form(svl.labelContainer, svl.missionModel, svl.missionContainer, svl.panoStore,
            svl.taskContainer, svl.navigationService, svl.compass, svl.tracker, params.dataStoreUrl);
        if (params.mission.current_audit_task_id) {
            var currTask = svl.taskContainer.getCurrentTask();
            var currTaskId = currTask.getProperty('auditTaskId');
            if (!currTaskId) currTask.setProperty("auditTaskId", params.mission.current_audit_task_id);
        } else {
            svl.tracker.initTaskId();
        }
        svl.popUpMessage = new PopUpMessage(svl.form, svl.taskContainer, svl.tracker, svl.user, svl.onboardingModel, svl.ui.popUpMessage);
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
        var modalMissionCompleteMap = new ModalMissionCompleteMap(svl.ui.modalMissionComplete, params.mapboxApiKey);
        var modalMissionCompleteProgressBar = new ModalMissionCompleteProgressBar(svl.ui.modalMissionComplete);
        svl.modalMissionComplete = new ModalMissionComplete(svl, svl.missionContainer, svl.missionModel,
            svl.taskContainer, modalMissionCompleteMap, modalMissionCompleteProgressBar, svl.ui.modalMissionComplete,
            svl.modalModel, svl.statusModel, svl.onboardingModel);
        svl.modalMissionComplete.hide();

        svl.modalComment = new ModalComment(svl, svl.tracker, svl.ribbon, svl.taskContainer, svl.ui.leftColumn, svl.ui.modalComment, svl.onboardingModel);
        svl.modalSkip = new ModalSkip(svl.form, svl.onboardingModel, svl.ribbon, svl.taskContainer, svl.tracker, svl.ui.leftColumn, svl.ui.modalSkip);

        svl.infoPopover = new PanoInfoPopover(svl.ui.streetview.dateHolder, svl.panoViewer, svl.panoViewer.getPosition,
            svl.panoViewer.getPanoId, svl.taskContainer.getCurrentTaskStreetEdgeId,
            svl.neighborhoodContainer.getCurrentNeighborhood().getRegionId, svl.panoViewer.getPov, svl.cityName, true,
            function() { svl.tracker.push('PanoInfoButton_Click'); },
            function() { svl.tracker.push('PanoInfoCopyToClipboard_Click'); },
            function() { svl.tracker.push('PanoInfoViewInPano_Click'); }
        );

        // Speed limit
        svl.speedLimit = new SpeedLimit(svl.panoViewer, svl.panoViewer.getPosition, svl.isOnboarding, null, null);

        // Survey for select users
        svl.modalSurvey = new ModalSurvey(svl.ui.modalSurvey);

        svl.zoomControl = new ZoomControl(svl.canvas, svl.tracker, svl.ui.zoomControl);
        svl.keyboard = new Keyboard(svl, svl.canvas, svl.contextMenu, svl.navigationService, svl.ribbon, svl.zoomControl);
        loadData(svl.taskContainer, svl.missionModel, svl.neighborhoodModel, svl.contextMenu);
        var task = svl.taskContainer.getCurrentTask();
        if (!svl.isOnboarding() && task && typeof google != "undefined") {
          google.maps.event.addDomListener(window, 'load', task.render);
        }

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

        $(svl.ui.ribbonMenu.buttons).each(function() {
            var val = $(this).attr('val');

            if(val !== 'Walk' && val !== 'Other') {
                $(this).attr({
                    'data-toggle': 'tooltip',
                    'data-placement': 'top',
                    'title': i18next.t('top-ui.press-key', {key: util.misc.getLabelDescriptions(val)['keyChar']})
                });
            }
        });

        $(svl.ui.ribbonMenu.subcategories).each(function() {
            var val = $(this).attr('val');

            if(val !== 'Walk' && val !== 'Other') {
                $(this).attr({
                    'data-toggle': 'tooltip',
                    'data-placement': 'left',
                    'title': i18next.t('top-ui.press-key', {key: util.misc.getLabelDescriptions(val)['keyChar']})
                });
            }
        });

        $('[data-toggle="tooltip"]').tooltip({
            delay: { "show": 500, "hide": 100 },
            html: true
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
            taskContainer.fetchTasks(function () {
                loadingTasksCompleted = true;
                handleDataLoadComplete();
            });
        }

        // Fetch the user's completed missions.
        missionModel.fetchCompletedMissionsInNeighborhood(function () {
            loadingMissionsCompleted = true;
            handleDataLoadComplete();
        });

        neighborhoodModel.fetchNeighborhoods(function () {
            loadNeighborhoodsCompleted = true;
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
        //hide footer
        svl.ui.footer.css("visibility", "hidden");

        if (!onboardingHandAnimation) {
            onboardingHandAnimation = new HandAnimation(svl.rootDirectory, svl.ui.onboarding);
            onboardingStates = new OnboardingStates(svl.contextMenu, svl.compass, svl.panoManager);
        }

        if (!("onboarding" in svl && svl.onboarding)) {
            svl.onboarding = new Onboarding(svl, svl.audioEffect, svl.compass, svl.form, onboardingHandAnimation,
                svl.navigationService, svl.missionContainer, svl.modalComment, svl.modalSkip, svl.onboardingModel,
                onboardingStates, svl.ribbon, svl.statusField, svl.tracker, svl.canvas, svl.ui.canvas, svl.contextMenu,
                svl.ui.onboarding, svl.ui.leftColumn, svl.user, svl.zoomControl);
        }
        svl.onboarding.start();
    }

    function startTheMission(mission, neighborhood) {
        svl.ui.minimap.holder.css('backgroundColor', '#e5e3df');

        // Popup the message explaining the goal of the current mission.
        if (svl.missionContainer.isTheFirstMission()) {
            neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
            svl.initialMissionInstruction = new InitialMissionInstruction(svl.compass, svl.navigationService, svl.popUpMessage,
                svl.taskContainer, svl.labelContainer, svl.aiGuidance, svl.tracker);
            svl.initialMissionInstruction.start(neighborhood);
        } else {
            // Show AI guidance message for the first street. Handled by InitialMissionInstruction if 1st mission.
            svl.aiGuidance.showAiGuidanceMessage();
        }

        svl.missionModel.updateMissionProgress(mission, neighborhood);
        svl.statusFieldMission.setMessage(mission);

        svl.labelContainer.fetchLabelsToResumeMission(neighborhood.getRegionId(), function (result) {
            svl.statusFieldNeighborhood.setLabelCount(svl.labelContainer.countLabels());
            svl.canvas.setOnlyLabelsOnPanoAsVisible(svl.panoViewer.getPanoId());

            // Count the labels of each label type to initialize the current mission label counts.
            var counter = {'CurbRamp': 0, 'NoCurbRamp': 0, 'Obstacle': 0, 'SurfaceProblem': 0, 'NoSidewalk': 0, 'Other': 0};
            for (var i = 0, len = result.labels.length; i < len; i++) {
                var currLabel = result.labels[i];
                if (currLabel.missionId === mission.getProperty('missionId')) {
                    if (Object.keys(counter).indexOf(currLabel.labelType) !== -1) {
                        counter[currLabel.labelType] += 1;
                    } else {
                        counter['Other'] += 1;
                    }
                }
            }
            Object.keys(counter).forEach(function (key) {
                svl.labelCounter.set(key, counter[key]);
            });
        });

        svl.taskContainer.renderAllTasks();
        var unit = {units: i18next.t('common:unit-distance')};
        var distance = svl.taskContainer.getCompletedTaskDistance();
        svl.statusFieldNeighborhood.setAuditedDistance(distance, unit);
        svl.statusFieldOverall.setNeighborhoodAuditedDistance(distance);
    }

    // This is a callback function that is executed after every loading process is done.
    function handleDataLoadComplete () {
        if (loadingTasksCompleted && loadingMissionsCompleted && loadNeighborhoodsCompleted && loadLabelTags) {

            // Mark neighborhood as complete if there are no streets left with max priority (= 1).
            if(!svl.taskContainer.hasMaxPriorityTask()) {
                svl.neighborhoodModel.setNeighborhoodCompleteAcrossAllUsers();
            }
            // Check if the user has completed the onboarding tutorial.
            var mission = svl.missionContainer.getCurrentMission();
            $("#page-loading").css({"visibility": "hidden"});
            $(".tool-ui").css({"visibility": "visible"});
            $(".visible").css({"visibility": "visible"});

            if (mission.getProperty("missionType") === "auditOnboarding") {
                svl.ui.footer.css("visibility", "hidden");
                startOnboarding();
            } else {
                _calculateAndSetTasksMissionsOffset();
                svl.ui.footer.css("visibility", "visible");

                // Initialize explore mission screens focused on a randomized label type, though users can switch between them.
                var currentNeighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
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

            // Use CSS zoom to scale the UI for users with high resolution screens.
            // Has only been tested on Chrome and Safari. Firefox doesn't support CSS zoom.
            if (bowser.safari) {
                svl.cssZoom = util.scaleUI();
                window.addEventListener('resize', (e) => { svl.cssZoom = util.scaleUI(); });
            }
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
        svl.ui.counterHolder = $("#counter-holder");
        svl.ui.labelCounter = $("#label-counter");

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
        svl.ui.streetview.dateHolder = $("#svl-panorama-date-holder");
        svl.ui.streetview.date = $("#svl-panorama-date");

        // Canvas for the labeling area.
        svl.ui.canvas = {};
        svl.ui.canvas.drawingLayer = $("#labelDrawingLayer");
        svl.ui.canvas.deleteIconHolder = $("#delete-icon-holder");
        svl.ui.canvas.severityIconHolder = $("#severity-icon-holder");
        svl.ui.canvas.deleteIcon = $("#label-delete-icon");
        svl.ui.canvas.severityIcon = $("#severity-icon");

        // Status holder.
        svl.ui.status = {};
        svl.ui.status.holder = $("#status-holder");
        svl.ui.status.overallDistance = $("#status-overall-audited-distance");
        svl.ui.status.overallLabelCount = $("#status-overall-label-count");
        svl.ui.status.overallAccuracyRow = $('#accuracy-status-row');
        svl.ui.status.overallAccuracy = $("#status-overall-accuracy");
        svl.ui.status.neighborhoodName = $("#status-holder-neighborhood-name");
        svl.ui.status.neighborhoodLink = $("#status-neighborhood-link");
        svl.ui.status.neighborhoodLabelCount = $("#status-neighborhood-label-count");
        svl.ui.status.currentMissionHeader = $("#current-mission-header");
        svl.ui.status.currentMissionDescription = $("#current-mission-description");
        svl.ui.status.auditedDistance = $("#status-audited-distance");

        // MissionDescription DOMs.
        svl.ui.statusMessage = {};
        svl.ui.statusMessage.holder = $("#current-status-holder");
        svl.ui.statusMessage.title = $("#current-status-title");
        svl.ui.statusMessage.description = $("#current-status-description");

        // Pop up message.
        svl.ui.popUpMessage = {};
        svl.ui.popUpMessage.holder = $("#pop-up-message-holder");
        svl.ui.popUpMessage.foreground = $("#pop-up-message-foreground");
        svl.ui.popUpMessage.background = $("#pop-up-message-background");
        svl.ui.popUpMessage.title = $("#pop-up-message-title");
        svl.ui.popUpMessage.content = $("#pop-up-message-content");
        svl.ui.popUpMessage.imageHolder = $("#pop-up-message-img-holder");
        svl.ui.popUpMessage.buttonHolder = $("#pop-up-message-button-holder");

        // Ribbon menu DOMs.
        svl.ui.ribbonMenu = {};
        svl.ui.ribbonMenu.holder = $("#ribbon-menu-label-type-button-holder");
        svl.ui.ribbonMenu.streetViewHolder = $("#street-view-holder");
        svl.ui.ribbonMenu.buttons = $('.label-type-button-holder');
        svl.ui.ribbonMenu.connector = $("#ribbon-street-view-connector");
        svl.ui.ribbonMenu.subcategoryHolder = $("#ribbon-menu-other-subcategory-holder");
        svl.ui.ribbonMenu.subcategories = $(".ribbon-menu-other-subcategory");

        // Context menu.
        svl.ui.contextMenu = {};
        svl.ui.contextMenu.holder = $("#context-menu-holder");
        svl.ui.contextMenu.severityMenu = $("#severity-menu");
        svl.ui.contextMenu.radioButtons = $("input[name='label-severity']");
        svl.ui.contextMenu.tagHolder = $("#context-menu-tag-holder");
        svl.ui.contextMenu.tags = $("button[name='tag']");
        svl.ui.contextMenu.textBox = $("#context-menu-description-text-box");
        svl.ui.contextMenu.closeButton = $("#context-menu-close-button");

        // Modal.
        svl.ui.modalSkip = {};
        svl.ui.modalSkip.holder = $("#modal-skip-holder");
        svl.ui.modalSkip.background = $("#modal-skip-background");
        svl.ui.modalSkip.box = $("#modal-skip-box");
        svl.ui.modalSkip.continueNeighborhood = $("#modal-skip-continue-neighborhood");
        svl.ui.modalSkip.newNeighborhood = $("#modal-skip-new-neighborhood");
        svl.ui.modalSkip.cancel = $("#modal-skip-cancel-button");
        svl.ui.modalComment = {};
        svl.ui.modalComment.holder = $("#modal-comment-holder");
        svl.ui.modalComment.ok = $("#modal-comment-ok-button");
        svl.ui.modalComment.cancel = $("#modal-comment-cancel-button");
        svl.ui.modalComment.textarea = $("#modal-comment-textarea");
        svl.ui.modalSurvey = {};
        svl.ui.modalSurvey.container = $("#survey-modal-container");
        svl.ui.modalSurvey.form = $("#survey-form");
        svl.ui.modalSurvey.skipButton = $('#survey-skip-button')

        // Modal Mission Complete.
        svl.ui.modalMissionComplete = {};
        svl.ui.modalMissionComplete.holder = $("#modal-mission-complete-holder");
        svl.ui.modalMissionComplete.foreground = $("#modal-mission-complete-foreground");
        svl.ui.modalMissionComplete.background = $("#modal-mission-complete-background");
        svl.ui.modalMissionComplete.missionTitle = $("#modal-mission-complete-title");
        svl.ui.modalMissionComplete.message = $("#modal-mission-complete-message");
        svl.ui.modalMissionComplete.map = $("#modal-mission-complete-map");
        svl.ui.modalMissionComplete.mapLegendLabel1 = $("#modal-mission-complete-map-legend-label-1");
        svl.ui.modalMissionComplete.mapLegendLabel2 = $("#modal-mission-complete-map-legend-label-2");
        svl.ui.modalMissionComplete.mapLegendLabel3 = $("#modal-mission-complete-map-legend-label-3");
        svl.ui.modalMissionComplete.curbRampCount = $("#modal-mission-complete-curb-ramp-count");
        svl.ui.modalMissionComplete.noCurbRampCount = $("#modal-mission-complete-no-curb-ramp-count");
        svl.ui.modalMissionComplete.obstacleCount = $("#modal-mission-complete-obstacle-count");
        svl.ui.modalMissionComplete.surfaceProblemCount = $("#modal-mission-complete-surface-problem-count");
        svl.ui.modalMissionComplete.noSidewalk = $("#modal-mission-complete-no-sidewalk-count");
        svl.ui.modalMissionComplete.otherCount = $("#modal-mission-complete-other-count");
        svl.ui.modalMissionComplete.progressTitle = $("#modal-mission-complete-progress-title");
        svl.ui.modalMissionComplete.completeBar = $("#modal-mission-complete-complete-bar");
        svl.ui.modalMissionComplete.missionDistance = $("#modal-mission-complete-mission-distance");
        svl.ui.modalMissionComplete.progressYou = $("#modal-mission-complete-progress-you");
        svl.ui.modalMissionComplete.totalAuditedDistance = $("#modal-mission-complete-total-audited-distance");
        svl.ui.modalMissionComplete.progressOthers = $("#modal-mission-complete-progress-others");
        svl.ui.modalMissionComplete.othersAuditedDistance = $("#modal-mission-complete-others-distance");
        svl.ui.modalMissionComplete.progressRemaining = $("#modal-mission-complete-progress-remaining");
        svl.ui.modalMissionComplete.remainingDistance = $("#modal-mission-complete-remaining-distance");
        svl.ui.modalMissionComplete.closeButtonPrimary = $("#modal-mission-complete-close-button-primary");
        svl.ui.modalMissionComplete.closeButtonSecondary = $("#modal-mission-complete-close-button-secondary");

        // Zoom control.
        svl.ui.zoomControl = {};
        svl.ui.zoomControl.zoomIn = $("#left-column-zoom-in-button");
        svl.ui.zoomControl.zoomOut = $("#left-column-zoom-out-button");

        // Form/logging.
        svl.ui.form = {};
        svl.ui.form.skipButton = $("#skip-button");
        svl.ui.form.submitButton = $("#submit-button");

        svl.ui.leftColumn = {};
        svl.ui.leftColumn.sound = $("#left-column-sound-button");
        svl.ui.leftColumn.muteIcon = $("#left-column-mute-icon");
        svl.ui.leftColumn.soundIcon = $("#left-column-sound-icon");
        svl.ui.leftColumn.jump = $("#left-column-jump-button");
        svl.ui.leftColumn.stuck = $("#left-column-stuck-button");
        svl.ui.leftColumn.feedback = $("#left-column-feedback-button");

        // Navigation compass.
        svl.ui.compass = {};
        svl.ui.compass.messageHolder = $("#compass-message-holder");
        svl.ui.compass.message = $("#compass-message");

        // Interaction viewer.
        svl.ui.task = {};

        // Tutorial.
        svl.ui.onboarding = {};
        svl.ui.onboarding.holder = $("#onboarding-holder");
        svl.ui.onboarding.messageHolder = $("#onboarding-message-holder");
        svl.ui.onboarding.background = $("#onboarding-background");
        svl.ui.onboarding.foreground = $("#onboarding-foreground");
        svl.ui.onboarding.canvas = $("#onboarding-canvas");
        svl.ui.onboarding.handGestureHolder = $("#hand-gesture-holder");

        // Neighborhood / route complete overlays.
        svl.ui.areaComplete = {};
        svl.ui.areaComplete.overlay = $("#area-completion-overlay-wrapper");
        svl.ui.areaComplete.title = $("#area-completion-title");
        svl.ui.areaComplete.body = $("#area-completion-body");

        svl.ui.footer = $("#mini-footer-audit");
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
