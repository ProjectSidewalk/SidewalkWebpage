function hideBrowserVersionAlert(){
    document.getElementById("unsupported-browser-alert").style.visibility="hidden";
}

document.addEventListener('DOMContentLoaded', function() {

    if(!bowser.chrome && !bowser.firefox && !bowser.safari){
        document.getElementById("unsupported-browser-alert").style.visibility="visible";
    }
}, false);

/** @namespace */
var svl = svl || {};

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
    var loadDifficultNeighborhoodsCompleted = false;
    var loadLabelTags = false;


    svl.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';
    svl.onboarding = null;
    svl.isOnboarding = function () {
        return params.mission.mission_type === 'auditOnboarding';
    };
    svl.missionsCompleted = params.missionSetProgress;
    svl.canvasWidth = 720;
    svl.canvasHeight = 480;
    svl.svImageHeight = 6656;
    svl.svImageWidth = 13312;
    svl.alpha_x = 4.6;
    svl.alpha_y = -4.65;
    svl.zoomFactor = {
        1: 1,
        2: 2.1,
        3: 4,
        4: 8,
        5: 16
    };

    function _init (params) {
        params = params || {};

        svl.userHasCompletedAMission = params.hasCompletedAMission;
        var SVLat = parseFloat(params.initLat), SVLng = parseFloat(params.initLng);
        // Models
        if (!("navigationModel" in svl)) svl.navigationModel = new NavigationModel();
        if (!("neighborhoodModel" in svl)) svl.neighborhoodModel = new NeighborhoodModel();
        svl.modalModel = new ModalModel();
        svl.missionModel = new MissionModel();
        svl.gameEffectModel = new GameEffectModel();
        svl.statusModel = new StatusModel();
        if (!("taskModel" in svl)) svl.taskModel = new TaskModel();
        svl.onboardingModel = new OnboardingModel();

        if (!("tracker" in svl)) svl.tracker = new Tracker();

        if (!("storage" in svl)) svl.storage = new TemporaryStorage(JSON);
        svl.labelContainer = new LabelContainer($);
        svl.panoramaContainer = new PanoramaContainer(svl.streetViewService);


        svl.overlayMessageBox = new OverlayMessageBox(svl.modalModel, svl.ui.overlayMessage);
        svl.ribbon = new RibbonMenu(svl.overlayMessageBox, svl.tracker, svl.ui.ribbonMenu);
        svl.canvas = new Canvas(svl.ribbon);
        svl.advancedOverlay = params.advancedOverlay;


        // Set map parameters and instantiate it.
        var mapParam = { lat: SVLat, lng: SVLng, panoramaPov: { heading: 0, pitch: -10, zoom: 1 } };
        svl.map = new MapService(svl.canvas, svl.neighborhoodModel, svl.ui.map, mapParam);
        svl.compass = new Compass(svl, svl.map, svl.taskContainer, svl.ui.compass);
        svl.alert = new Alert();
        svl.keyboardShortcutAlert = new KeyboardShortcutAlert(svl.alert);
        svl.ratingReminderAlert = new RatingReminderAlert(svl.alert);
        svl.zoomShortcutAlert = new ZoomShortcutAlert(svl.alert);
        svl.jumpModel = new JumpModel();
        svl.jumpAlert = new JumpAlert(svl.alert, svl.jumpModel);
        svl.stuckAlert = new StuckAlert(svl.alert);
        svl.navigationModel._mapService = svl.map;

        svl.statusField = new StatusField(svl.ui.status);
        svl.statusFieldOverall = new StatusFieldOverall(svl.ui.status);
        svl.statusFieldNeighborhood = new StatusFieldNeighborhood(svl.neighborhoodModel, svl.userModel, svl.ui.status);
        svl.statusFieldMissionProgressBar = new StatusFieldMissionProgressBar(svl.modalModel, svl.statusModel, svl.ui.status);
        svl.statusFieldMission = new StatusFieldMission(svl.modalModel, svl.ui.status);

        svl.labelCounter = new LabelCounter(d3);
        svl.labelFactory = new LabelFactory(svl, params.nextTemporaryLabelId);
        svl.contextMenu = new ContextMenu(svl.ui.contextMenu);

        // Game effects
        svl.audioEffect = new AudioEffect(svl.gameEffectModel, svl.ui.leftColumn, svl.rootDirectory, svl.storage);


        var neighborhood;
        svl.neighborhoodContainer = new NeighborhoodContainer(svl.neighborhoodModel);
        svl.neighborhoodModel._neighborhoodContainer = svl.neighborhoodContainer;

        svl.neighborhoodFactory = new NeighborhoodFactory(svl.neighborhoodModel);
        neighborhood = svl.neighborhoodFactory.create(params.regionId, params.regionLayer, params.regionName);
        svl.neighborhoodContainer.add(neighborhood);
        svl.neighborhoodContainer.setCurrentNeighborhood(neighborhood);

        if (!("taskFactory" in svl && svl.taskFactory)) svl.taskFactory = new TaskFactory(svl.taskModel);
        if (!("taskContainer" in svl && svl.taskContainer)) {
            svl.taskContainer = new TaskContainer(svl.navigationModel, svl.neighborhoodModel, svl.streetViewService, svl, svl.tracker);
        }
        svl.taskModel._taskContainer = svl.taskContainer;

        svl.observedArea = new ObservedArea(svl.ui.minimap);

        // Mission
        svl.missionContainer = new MissionContainer(svl.statusFieldMission, svl.missionModel);
        svl.missionProgress = new MissionProgress(svl, svl.gameEffectModel, svl.missionModel, svl.modalModel,
            svl.neighborhoodModel, svl.statusModel, svl.missionContainer, svl.neighborhoodContainer, svl.tracker);
        svl.missionFactory = new MissionFactory (svl.missionModel);

        svl.missionModel.trigger("MissionFactory:create", params.mission); // create current mission and set as current
        svl.form = new Form(svl.labelContainer, svl.missionModel, svl.missionContainer, svl.navigationModel,
            svl.panoramaContainer, svl.taskContainer, svl.map, svl.compass, svl.tracker, params.form);
        if (params.mission.current_audit_task_id) {
            var currTask = svl.taskContainer.getCurrentTask();
            currTask.setProperty("auditTaskId", params.mission.current_audit_task_id);
        } else {
            svl.tracker.initTaskId();
        }
        svl.popUpMessage = new PopUpMessage(svl.form, svl.storage, svl.taskContainer, svl.tracker, svl.user, svl.onboardingModel, svl.ui.popUpMessage);

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
        var modalMissionCompleteMap = new ModalMissionCompleteMap(svl.ui.modalMissionComplete);
        var modalMissionCompleteProgressBar = new ModalMissionCompleteProgressBar(svl.ui.modalMissionComplete);
        svl.modalMissionComplete = new ModalMissionComplete(svl, svl.missionContainer, svl.missionModel,
            svl.taskContainer, modalMissionCompleteMap, modalMissionCompleteProgressBar, svl.ui.modalMissionComplete,
            svl.modalModel, svl.statusModel, svl.onboardingModel, svl.userModel);
        svl.modalMissionComplete.hide();

        svl.modalComment = new ModalComment(svl, svl.tracker, svl.ribbon, svl.taskContainer, svl.ui.leftColumn, svl.ui.modalComment, svl.onboardingModel);
        svl.modalMission = new ModalMission(svl.missionContainer, svl.neighborhoodContainer, svl.ui.modalMission, svl.modalModel, svl.onboardingModel, svl.userModel);
        svl.modalSkip = new ModalSkip(svl.form, svl.onboardingModel, svl.ribbon, svl.taskContainer, svl.tracker, svl.ui.leftColumn, svl.ui.modalSkip);
        svl.modalExample = new ModalExample(svl.modalModel, svl.onboardingModel, svl.ui.modalExample);

        svl.infoPopover = new GSVInfoPopover(svl.ui.dateHolder, svl.panorama, svl.map.getPosition, svl.map.getPanoId,
            svl.taskContainer.getCurrentTask().getStreetEdgeId, svl.taskContainer.getCurrentTask().getRegionId,
            svl.map.getPov, true, function() { svl.tracker.push('GSVInfoButton_Click'); },
            function() { svl.tracker.push('GSVInfoCopyToClipboard_Click'); },
            function() { svl.tracker.push('GSVInfoViewInGSV_Click'); }
        );

        // Survey for select users
        svl.surveyModalContainer = $("#survey-modal-container").get(0);

        svl.zoomControl = new ZoomControl(svl.canvas, svl.map, svl.tracker, svl.ui.zoomControl);
        svl.keyboard = new Keyboard(svl, svl.canvas, svl.contextMenu, svl.map, svl.ribbon, svl.zoomControl);
        loadData(svl.taskContainer, svl.missionModel, svl.neighborhoodModel, svl.contextMenu);
        var task = svl.taskContainer.getCurrentTask();
        if (!svl.isOnboarding() && task && typeof google != "undefined") {
          google.maps.event.addDomListener(window, 'load', task.render);
        }

        $("#navbar-retake-tutorial-btn").on('click', function () {
            window.location.replace('/audit?retakeTutorial=true');
        });

        $('#survey-modal-container').on('show.bs.modal', function () {
            svl.popUpMessage.disableInteractions();
            svl.ribbon.disableModeSwitch();
            svl.zoomControl.disableZoomIn();
            svl.zoomControl.disableZoomOut();
        });
        $('#survey-modal-container').on('hide.bs.modal', function () {
            svl.popUpMessage.enableInteractions();
            svl.ribbon.enableModeSwitch();
            svl.zoomControl.enableZoomIn();
            svl.zoomControl.enableZoomOut();
        });

        $('#survey-modal-container').keydown(function(e) {
            e.stopPropagation();
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
    }

    function loadData(taskContainer, missionModel, neighborhoodModel, contextMenu) {
        // If in the tutorial, we already have the tutorial task. If not, get the rest of the tasks in the neighborhood.
        if (params.mission.mission_type === 'auditOnboarding') {
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

        neighborhoodModel.fetchDifficultNeighborhoods(function () {
            loadDifficultNeighborhoodsCompleted = true;
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
        $("#mini-footer-audit").css("visibility", "hidden");

        if (!onboardingHandAnimation) {
            onboardingHandAnimation = new HandAnimation(svl.rootDirectory, svl.ui.onboarding);
            onboardingStates = new OnboardingStates(svl.contextMenu, svl.compass, svl.map, svl.statusModel, svl.tracker);
        }

        if (!("onboarding" in svl && svl.onboarding)) {

            // TODO It should pass UserModel instead of User (i.e., svl.user)

            svl.onboarding = new Onboarding(svl, svl.audioEffect, svl.compass, svl.form, onboardingHandAnimation,
                svl.map, svl.missionContainer, svl.modalComment, svl.modalSkip, svl.onboardingModel, onboardingStates,
                svl.ribbon, svl.statusField, svl.tracker, svl.canvas, svl.ui.canvas, svl.contextMenu, svl.ui.onboarding,
                svl.ui.leftColumn, svl.user, svl.zoomControl);
        }
        svl.onboarding.start();
    }

    function startTheMission(mission, neighborhood) {
        svl.ui.minimap.holder.css('backgroundColor', '#e5e3df');
        if(params.init !== "noInit") {
            // Popup the message explaining the goal of the current mission.
            if (svl.missionContainer.isTheFirstMission()) {
                neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
                svl.initialMissionInstruction = new InitialMissionInstruction(svl.compass, svl.map, svl.popUpMessage,
                    svl.taskContainer, svl.labelContainer, svl.tracker);
                svl.modalMission.setMissionMessage(mission, neighborhood, null, function () {
                    svl.initialMissionInstruction.start(neighborhood);
                });
            } else {
                svl.modalMission.setMissionMessage(mission, neighborhood);
            }
            svl.modalMission.show();
        }
        svl.missionModel.updateMissionProgress(mission, neighborhood);
        svl.statusFieldMission.setMessage(mission);

        svl.labelContainer.fetchLabelsToResumeMission(neighborhood.getProperty('regionId'), function (result) {
            svl.statusFieldNeighborhood.setLabelCount(svl.labelContainer.countLabels());
            svl.canvas.setVisibilityBasedOnLocation('visible', svl.map.getPanoId());

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

        svl.taskContainer.renderTasksFromPreviousSessions();
        var unit = {units: i18next.t('common:unit-distance')};
        var distance = svl.taskContainer.getCompletedTaskDistance();
        svl.statusFieldNeighborhood.setAuditedDistance(distance, unit);
        svl.statusFieldOverall.setNeighborhoodAuditedDistance(distance);
    }

    // This is a callback function that is executed after every loading process is done.
    function handleDataLoadComplete () {
        if (loadingTasksCompleted && loadingMissionsCompleted && loadNeighborhoodsCompleted &&
            loadDifficultNeighborhoodsCompleted && loadLabelTags) {

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
                $("#mini-footer-audit").css("visibility", "hidden");
                startOnboarding();
            } else {
                _calculateAndSetTasksMissionsOffset();
                var currentNeighborhood = svl.neighborhoodContainer.getStatus("currentNeighborhood");
                $("#mini-footer-audit").css("visibility", "visible");

                var regionId = currentNeighborhood.getProperty("regionId");
                var difficultRegionIds = svl.neighborhoodModel.difficultRegionIds;
                if(difficultRegionIds.includes(regionId) && !svl.advancedOverlay) {
                    $('#advanced-overlay').show();
                }
                startTheMission(mission, currentNeighborhood);
            }
        }
    }

    function _calculateAndSetTasksMissionsOffset() {
        var completedTasksDistance = util.math.kilometersToMeters(svl.taskContainer.getCompletedTaskDistance({ units: 'kilometers' }));
        var completedMissionsDistance = svl.missionContainer.getCompletedMissionDistance();
        var curMission = svl.missionContainer.getCurrentMission();
        var missProgress = curMission.getProperty("distanceProgress") ? curMission.getProperty("distanceProgress") : 0;

        svl.missionContainer.setTasksMissionsOffset(completedMissionsDistance - completedTasksDistance + missProgress);
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

        // Map DOMs
        svl.ui.map = {};
        svl.ui.map.canvas = $("canvas#labelCanvas");
        svl.ui.map.drawingLayer = $("div#labelDrawingLayer");
        svl.ui.map.pano = $("div#pano");
        svl.ui.map.viewControlLayer = $("div#view-control-layer");
        svl.ui.map.modeSwitchWalk = $("#mode-switch-button-walk");
        svl.ui.minimap = {};
        svl.ui.minimap.holder = $("#minimap-holder");
        svl.ui.minimap.overlay = $("#minimap-overlay");
        svl.ui.minimap.message = $("#minimap-message");
        svl.ui.minimap.fogOfWar = $("#minimap-fog-of-war-canvas");
        svl.ui.minimap.fov = $("#minimap-fov-canvas");
        svl.ui.minimap.progressCircle = $("#minimap-progress-circle-canvas");
        svl.ui.minimap.percentObserved = $("#minimap-percent-observed");
        svl.ui.dateHolder = $("#svl-panorama-date-holder");

        // Status holder
        svl.ui.status = {};
        svl.ui.status.holder = $("#status-holder");
        svl.ui.status.overallDistance = $("#status-overall-audited-distance");
        svl.ui.status.overallLabelCount = $("#status-overall-label-count");
        svl.ui.status.overallAccuracyRow = $('#accuracy-status-row');
        svl.ui.status.overallAccuracy = $("#status-overall-accuracy");
        svl.ui.status.neighborhoodName = $("#status-holder-neighborhood-name");
        svl.ui.status.neighborhoodLink = $("#status-neighborhood-link");
        svl.ui.status.neighborhoodLabelCount = $("#status-neighborhood-label-count");
        svl.ui.status.currentMissionDescription = $("#current-mission-description");
        svl.ui.status.currentMissionReward = $("#current-mission-reward");
        svl.ui.status.totalMissionReward = $("#total-mission-reward");
        svl.ui.status.auditedDistance = $("#status-audited-distance");

        // MissionDescription DOMs
        svl.ui.statusMessage = {};
        svl.ui.statusMessage.holder = $("#current-status-holder");
        svl.ui.statusMessage.title = $("#current-status-title");
        svl.ui.statusMessage.description = $("#current-status-description");

        // OverlayMessage
        svl.ui.overlayMessage = {};
        svl.ui.overlayMessage.holder = $("#overlay-message-holder");
        svl.ui.overlayMessage.holder.append("<span id='overlay-message-box'>" +
            "<span id='overlay-message'>Walk</span><span id='overlay-message-help-link' class='underline bold'></span></span>");
        svl.ui.overlayMessage.box = $("#overlay-message-box");
        svl.ui.overlayMessage.message = $("#overlay-message");

        // Pop up message
        svl.ui.popUpMessage = {};
        svl.ui.popUpMessage.holder = $("#pop-up-message-holder");
        svl.ui.popUpMessage.foreground = $("#pop-up-message-foreground");
        svl.ui.popUpMessage.background = $("#pop-up-message-background");
        svl.ui.popUpMessage.title = $("#pop-up-message-title");
        svl.ui.popUpMessage.content = $("#pop-up-message-content");
        svl.ui.popUpMessage.imageHolder = $("#pop-up-message-img-holder");
        svl.ui.popUpMessage.buttonHolder = $("#pop-up-message-button-holder");

        // Ribbon menu DOMs
        svl.ui.ribbonMenu = {};
        svl.ui.ribbonMenu.holder = $("#ribbon-menu-label-type-button-holder");
        svl.ui.ribbonMenu.streetViewHolder = $("#street-view-holder");
        svl.ui.ribbonMenu.buttons = $('.label-type-button-holder');
        svl.ui.ribbonMenu.connector = $("#ribbon-street-view-connector");
        svl.ui.ribbonMenu.subcategoryHolder = $("#ribbon-menu-other-subcategory-holder");
        svl.ui.ribbonMenu.subcategories = $(".ribbon-menu-other-subcategory");

        // Context menu
        svl.ui.contextMenu = {};
        svl.ui.contextMenu.holder = $("#context-menu-holder");
        svl.ui.contextMenu.connector = $("#context-menu-vertical-connector");
        svl.ui.contextMenu.severityMenu = $("#severity-menu");
        svl.ui.contextMenu.radioButtons = $("input[name='label-severity']");
        svl.ui.contextMenu.temporaryLabelCheckbox = $("#context-menu-temporary-problem-checkbox");
        svl.ui.contextMenu.tagHolder = $("#context-menu-tag-holder");
        svl.ui.contextMenu.tags = $("button[name='tag']");
        svl.ui.contextMenu.textBox = $("#context-menu-problem-description-text-box");
        svl.ui.contextMenu.closeButton = $("#context-menu-close-button");

        // Modal
        svl.ui.modalSkip = {};
        svl.ui.modalSkip.holder = $("#modal-skip-holder");
        svl.ui.modalSkip.firstBox = $("#modal-skip-box");
        svl.ui.modalSkip.unavailable = $("#modal-skip-unavailable");
        svl.ui.modalSkip.continueNeighborhood = $("#modal-skip-continue-neighborhood");
        svl.ui.modalSkip.cancelFirst = $("#modal-skip-cancel-first-button");
        svl.ui.modalSkip.secondBox = $("#modal-skip-box-neighborhood");
        svl.ui.modalSkip.redirect = $("#modal-skip-redirect-jump");
        svl.ui.modalSkip.explore = $("#modal-skip-explore");
        svl.ui.modalSkip.cancelSecond = $("#modal-skip-cancel-second-button");
        svl.ui.modalComment = {};
        svl.ui.modalComment.holder = $("#modal-comment-holder");
        svl.ui.modalComment.ok = $("#modal-comment-ok-button");
        svl.ui.modalComment.cancel = $("#modal-comment-cancel-button");
        svl.ui.modalComment.textarea = $("#modal-comment-textarea");

        svl.ui.modalExample = {};
        svl.ui.modalExample.background = $(".modal-background");
        svl.ui.modalExample.close = $(".modal-example-close-buttons");
        svl.ui.modalExample.curbRamp = $("#modal-curb-ramp-example");
        svl.ui.modalExample.noCurbRamp = $("#modal-no-curb-ramp-example");
        svl.ui.modalExample.obstacle = $("#modal-obstacle-example");
        svl.ui.modalExample.surfaceProblem = $("#modal-surface-problem-example");

        svl.ui.modalMission = {};
        svl.ui.modalMission.holder = $("#modal-mission-holder");
        svl.ui.modalMission.foreground = $("#modal-mission-foreground");
        svl.ui.modalMission.background = $("#modal-mission-background");
        svl.ui.modalMission.missionTitle = $("#modal-mission-header");
        svl.ui.modalMission.rewardText = $("#modal-mission-reward-text");
        svl.ui.modalMission.instruction = $("#modal-mission-instruction");
        svl.ui.modalMission.closeButton = $("#modal-mission-close-button");


        // Modal Mission Complete
        svl.ui.modalMissionComplete = {};
        svl.ui.modalMissionComplete.holder = $("#modal-mission-complete-holder");
        svl.ui.modalMissionComplete.foreground = $("#modal-mission-complete-foreground");
        svl.ui.modalMissionComplete.background = $("#modal-mission-complete-background");
        svl.ui.modalMissionComplete.missionTitle = $("#modal-mission-complete-title");
        svl.ui.modalMissionComplete.message = $("#modal-mission-complete-message");
        svl.ui.modalMissionComplete.map = $("#modal-mission-complete-map");
        svl.ui.modalMissionComplete.completeBar = $('#modal-mission-complete-complete-bar');
        svl.ui.modalMissionComplete.closeButtonPrimary = $("#modal-mission-complete-close-button-primary");
        svl.ui.modalMissionComplete.closeButtonSecondary = $("#modal-mission-complete-close-button-secondary");
        svl.ui.modalMissionComplete.totalAuditedDistance = $("#modal-mission-complete-total-audited-distance");
        svl.ui.modalMissionComplete.othersAuditedDistance = $("#modal-mission-complete-others-distance");
        svl.ui.modalMissionComplete.missionDistance = $("#modal-mission-complete-mission-distance");
        svl.ui.modalMissionComplete.missionReward = $("#modal-mission-complete-mission-reward");
        svl.ui.modalMissionComplete.remainingDistance = $("#modal-mission-complete-remaining-distance");
        svl.ui.modalMissionComplete.curbRampCount = $("#modal-mission-complete-curb-ramp-count");
        svl.ui.modalMissionComplete.noCurbRampCount = $("#modal-mission-complete-no-curb-ramp-count");
        svl.ui.modalMissionComplete.obstacleCount = $("#modal-mission-complete-obstacle-count");
        svl.ui.modalMissionComplete.surfaceProblemCount = $("#modal-mission-complete-surface-problem-count");
        svl.ui.modalMissionComplete.noSidewalk = $("#modal-mission-complete-no-sidewalk-count");
        svl.ui.modalMissionComplete.otherCount = $("#modal-mission-complete-other-count");
        svl.ui.modalMissionComplete.generateConfirmationButton = $("#modal-mission-complete-generate-confirmation-button").get(0);

        // Zoom control
        svl.ui.zoomControl = {};
        svl.ui.zoomControl.zoomIn = $("#left-column-zoom-in-button");
        svl.ui.zoomControl.zoomOut = $("#left-column-zoom-out-button");

        // Form
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

        // Navigation compass
        svl.ui.compass = {};
        svl.ui.compass.messageHolder = $("#compass-message-holder");
        svl.ui.compass.message = $("#compass-message");

        // Canvas for the labeling area
        svl.ui.canvas = {};
        svl.ui.canvas.drawingLayer = $("#labelDrawingLayer");
        svl.ui.canvas.deleteIconHolder = $("#delete-icon-holder");
        svl.ui.canvas.severityIconHolder = $("#severity-icon-holder");
        svl.ui.canvas.deleteIcon = $("#label-delete-icon");
        svl.ui.canvas.severityIcon = $("#severity-icon");

        // Interaction viewer
        svl.ui.task = {};

        svl.ui.onboarding = {};
        svl.ui.onboarding.holder = $("#onboarding-holder");
        svl.ui.onboarding.messageHolder = $("#onboarding-message-holder");
        svl.ui.onboarding.background = $("#onboarding-background");
        svl.ui.onboarding.foreground = $("#onboarding-foreground");
        svl.ui.onboarding.canvas = $("#onboarding-canvas");
        svl.ui.onboarding.handGestureHolder = $("#hand-gesture-holder");
    }

    // Gets all the text on the audit page for the correct language.
    i18next.use(i18nextXHRBackend);
    i18next.init({
        backend: { loadPath: '/assets/locales/{{lng}}/{{ns}}.json' },
        fallbackLng: 'en',
        ns: ['audit', 'common'],
        defaultNS: 'audit',
        lng: params.language,
        debug: false
    }, function(err, t) {
        if(params.init !== "noInit") {
            _initUI();
            _init(params);
        }
    });

    self.loadData = loadData;

    return self;
}

/**
 * This module controls the message shown at the top of the Street View pane.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function OverlayMessageBox (modalModel, uiOverlayMessage) {
    var $helpLink = uiOverlayMessage.holder.find("#overlay-message-help-link");

    this._properties = { 'visibility' : 'visible' };

    this._handleHelpLinkClick = function (e) {
        var labelType = $helpLink.children(0).attr("val");
        var labelTypes = ["CurbRamp", "NoCurbRamp", "SurfaceProblem", "Obstacle"];
        if (labelType != undefined && labelTypes.indexOf(labelType) >= 0) {
            modalModel.showModalExample(labelType);
        }
        svl.tracker.push("ExplainThis_Click", {
            labelType: labelType
        });
    };

    this.setHelpLink = function (labelType) {
        var labelTypes = ["CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem"];

        if (labelTypes.indexOf(labelType) >= 0) {
            $helpLink.html("<span val='" + labelType + "'>" + i18next.t('top-ui.instruction.explain') + "</span>");
        } else {
            $helpLink.html("");
        }
    };

    /**
     * Set the message in the overlay box
     * @param mode
     * @returns {*}
     */
    this.setMessage =function (mode) {
        var instruction = i18next.t('top-ui.instruction.' + util.camelToKebab(mode));
        uiOverlayMessage.message.html(`<strong>${instruction}</strong>`);
        uiOverlayMessage.message.find(".overlay-message-label-type").on('click', function () {
            var labelType = $(this).attr("val");
            modalModel.showModalExample(labelType);
        });
    };

    this.setMessage('Walk');

    $helpLink.on('click', this._handleHelpLinkClick);
}

/**
 * Set the visibility to visible or hidden.
 * @param val
 * @returns {setVisibility}
 */
OverlayMessageBox.prototype.setVisibility = function (val) {
    if (val === 'visible' || val === 'hidden') {
        this._properties.visibility = val;
    }
    return this;
};

/**
 *
 * @param form
 * @param storage
 * @param taskContainer
 * @param tracker
 * @param user
 * @param onboardingModel
 * @param uiPopUpMessage
 * @returns {{className: string}}
 * @constructor
 */
function PopUpMessage (form, storage, taskContainer, tracker, user, onboardingModel, uiPopUpMessage) {
    var self = this;
    var status = { haveAskedToSignIn: false, signUp: false, isVisible: false};
    var buttons = [];

    onboardingModel.on("Onboarding:startOnboarding", function () {
        self.hide();
    });
    this.getStatus = function (key){
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    };

    function disableInteractions () {
        svl.panorama.set('linksControl', false);//disable arrows
        svl.map.disableWalking();
        svl.map.unlockDisablePanning();
        svl.map.disablePanning();
        svl.canvas.disableLabeling();
        svl.keyboard.disableKeyboard();
    }
    function enableInteractions () {
        svl.panorama.set('linksControl', true);//enable arrows
        svl.map.enableWalking();
        svl.map.enablePanning();
        svl.canvas.enableLabeling();
        svl.keyboard.enableKeyboard();
    }
    function _attachCallbackToClickOK (callback) {
        $("#pop-up-message-ok-button").one('click', callback);
    }

    function appendHTML (htmlDom, callback) {
        var $html = $(htmlDom);
        uiPopUpMessage.content.append($html);

        if (callback) {
            $html.on("click", callback);
        }
        $html.on('click', self.hide);
        buttons.push($html);
    }

    this._appendButton = function (buttonDom, callback) {
        var $button = $(buttonDom);
        $button.css({ margin: '0 10 10 0' });
        $button.addClass('button');
        uiPopUpMessage.buttonHolder.append($button);

        if (callback) {
            $button.one('click', callback);
        }
        $button.one('click', self.hide);
        buttons.push($button);
    };

    this._appendOKButton = function () {
        var OKButton = '<button id="pop-up-message-ok-button">OK</button>';
        function handleClickOK () {
            tracker.push('PopUpMessage_ClickOk');
            enableInteractions();
            $("#pop-up-message-ok-button").remove();
            $("#pop-up-message-image").remove();
        }
        self._appendButton(OKButton, handleClickOK);


        $(document).keyup(function (e){
            e = e || window.event; //Handle IE
            //enter
            if (e.keyCode == 13 && !svl.modalMission._status.isOpen) {
                tracker.push('KeyboardShortcut_ClickOk');
                $("#pop-up-message-ok-button").trigger("click", {lowLevelLogging: false});
            }
        });
    };

    this.haveAskedToSignIn = function () {
        return status.haveAskedToSignIn;
    };

    /**
     * Hides the message box.
     */
    this.hide = function () {
        uiPopUpMessage.holder.removeClass('visible');
        uiPopUpMessage.holder.addClass('hidden');
        if (!status.signUp){
            enableInteractions();
        }
        self.hideBackground();  // hide background
        self.reset();  // reset all the parameters
        status.isVisible = false;
        return this;
    };

    /**
     * Hides the background
     */
    this.hideBackground = function () {
        uiPopUpMessage.holder.css({ width: '', height: '' });
    };

    /**
     * Prompt a user who's not logged in to sign up/sign in.
     * Todo. I should move this to either User.js or a new module (e.g., SignUp.js?).
     */
    this.promptSignIn = function () {
        uiPopUpMessage.buttonHolder.html("");
        self._setTitle(i18next.t('popup.signup-title'));
        self._setMessage(i18next.t('popup.signup-body'));
        disableInteractions(); //disable interactions while msg up
        self._appendButton('<button id="pop-up-message-sign-up-button" class="float" style = "margin-right:10px">' + i18next.t('popup.signup-button-signup') + '</button>', function () {
            // Store the data in LocalStorage.
            var task = taskContainer.getCurrentTask();

            tracker.push('PopUpMessage_SignUpClickYes', {
                "auditTaskId": task.getAuditTaskId(),
                "auditStreetEdgeId": task.getStreetEdgeId()
            });
            var data = form.compileSubmissionData(task);
            var staged = storage.get("staged");
            staged.push(data);
            storage.set("staged", staged);
            disableInteractions();
            status.signUp = true;
            $("#sign-in-modal").addClass("hidden");
            $("#sign-up-modal").removeClass("hidden");
            $('#sign-in-modal-container').modal('show');
        });
        self._appendButton('<button id="pop-up-message-cancel-button" class="float">' + i18next.t('popup.signup-button-no') + '</button>', function () {

            // Submit the data as an anonymous user.
            user.setProperty('firstTask', false);

            var task = taskContainer.getCurrentTask();
            tracker.push('PopUpMessage_SignUpClickNo', {
                "auditTaskId": task.getAuditTaskId(),
                "auditStreetEdgeId": task.getStreetEdgeId()
            });

            var data = form.compileSubmissionData(task);
            form.submit(data, task);
        });
        appendHTML('<br class="clearBoth"/><p><a id="pop-up-message-sign-in">' +
            '<small><span style="text-decoration: underline; cursor: pointer;">' + i18next.t('popup.signup-button-signin') + '</span></small>' +
            '</a></p>', function () {

            var task = taskContainer.getCurrentTask();

            tracker.push('PopUpMessage_SignInClick', {
                "auditTaskId": task.getAuditTaskId(),
                "auditStreetEdgeId": task.getStreetEdgeId()
            });
            var data = form.compileSubmissionData(task);
            var staged = storage.get("staged");
            staged.push(data);
            storage.set("staged", staged);

            $("#sign-in-modal").removeClass("hidden");
            $("#sign-up-modal").addClass("hidden");
            $('#sign-in-modal-container').modal('show');
        });
        self._setPosition(48, 260, 640);
        self.show(true);
        status.haveAskedToSignIn = true;
    };

    /**
     * Notification
     * @param title
     * @param message
     * @param callback
     */
    this.notify = function (title, message, callback) {
        self._setPosition(48, 260, 640);
        self.show();
        self._setTitle(title);
        self._setMessage(message);
        self._appendOKButton();

        if (callback) {
            _attachCallbackToClickOK(callback);
        }
    };

    /**
     * Notification with image
     * @param title
     * @param image
     * @param callback
     */
    this.notifyWithImage = function (title, message, width, height, x, image, callback) {
        self._setPosition(48, 147, 640);
        self.show();
        self._setTitle(title);
        self._setMessage(message);
        self._setImage(image, width, height, x);
        self._appendOKButton();

        if (callback) {
            _attachCallbackToClickOK(callback);
        }
    };

    /**
     * Reset all the parameters.
     */
    this.reset = function () {
        uiPopUpMessage.holder.css({ width: '', height: '' });
        uiPopUpMessage.imageHolder.css({ width: '', height: '', left: '' });
        uiPopUpMessage.foreground.css({
                    left: '',
                    top: '',
                    width: '',
                    height: '',
                    zIndex: ''
                });

        uiPopUpMessage.foreground.css('padding-bottom', '');

        for (var i = 0; i < buttons.length; i++ ){
            try {
                buttons[i].remove();
            } catch (e) {
                console.warning("Button does not exist.", e);
            }
        }
        buttons = [];
        status.signUp = false;
    };

    /**
     * This method shows a message box on the page.
     */
    this.show = function (disableOtherInteraction) {
        disableInteractions();
        self._showBackground();

        uiPopUpMessage.holder.removeClass('hidden');
        uiPopUpMessage.holder.addClass('visible');
        status.isVisible = true;
        return this;
    };

    /**
     * Show a semi-transparent background to block people to interact with
     * other parts of the interface.
     */
    this._showBackground = function () {
        uiPopUpMessage.holder.css({ width: '100%', height: '100%'});
    };

    /**
     * Sets the title
     */
    this._setTitle = function (title) {
        uiPopUpMessage.title.html(title);
    };

    /**
     * Sets the message.
     */
    this._setMessage = function (message) {
        uiPopUpMessage.content.html(message);
    };
    /**
     * Adds an image to the pop-up window
     */
    this._setImage = function (image, width, height, x) {
        var imageHtml = `<img src = ` + `${image} id="pop-up-message-image" />`;
        var $img = $(imageHtml);
        $img.css({ cursor: 'default', width: width, height: height, left: x });
        $img.addClass('img');
        uiPopUpMessage.imageHolder.append($img);
    };

    /*
     * Sets the position of the message.
     */
    this._setPosition = function  (x, y, width, height) {
        uiPopUpMessage.foreground.css({
            left: x,
            top: y,
            width: width,
            height: height,
            zIndex: 2
        });
        return this;
    };
    self.disableInteractions = disableInteractions;
    self.enableInteractions = enableInteractions;

}

/**
 * Storage module. This is a wrapper around web browser's Local Storage. It allows you to store data on the user's
 * browser using a set method, and you can retrieve the data using the get method.
 *
 * References:
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
 *
 * @param JSON
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TemporaryStorage(JSON) {
    var self = {'className': 'Storage'};
    self.storage = window.localStorage;

    function _init() {
        // Create an array to store staged submission data (if there hasn't been one)
        if (!get("staged")) {
            set("staged", []);
        }

        if (!get("completedFirstMission")){
            set("completedFirstMission", null);
        }

        if (!get("muted")) {
            set("muted", false);
        }
    }

    /**
     * Returns the item specified by the key.
     * @param key
     */
    function get(key) {
        return JSON.parse(self.storage.getItem(key));
    }

    /**
     * Stores a key value pair.
     * @param key
     * @param value
     */
    function set(key, value) {
        self.storage.setItem(key, JSON.stringify(value));
    }

    self.get = get;
    self.set = set;

    _init();
    return self;
}
/**
 *
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Tracker() {
    var self = this;
    var actions = [];
    var prevActions = [];

    var currentLabel = null;
    var updatedLabels = [];
    var currentAuditTask = null;

    this.init = function() {
        this.trackWindowEvents();
    };

    this.getCurrentLabel = function() {
        return currentLabel;
    };

    this.setAuditTaskID = function(taskID) {
        currentAuditTask = taskID;
    };

    this.trackWindowEvents = function() {
        var prefix = "LowLevelEvent_";

        // track all mouse related events
        $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', function(e, extra) {
            if (extra) {
                if (typeof extra.lowLevelLogging !== "undefined" && !extra.lowLevelLogging) { // {lowLevelLogging: false}
                    return;
                }
            }

            self.push(prefix + e.type, {
                cursorX: 'pageX' in e ? e.pageX : null,
                cursorY: 'pageY' in e ? e.pageY : null
            });
        });

        // keyboard related events
        $(document).on('keydown keyup', function(e) {
            self.push(prefix + e.type, {
                keyCode: 'keyCode' in e ? e.keyCode : null
            });
        });
    };

    this._isCanvasInteraction = function(action) {
        return action.indexOf("LabelingCanvas") >= 0;
    };

    this._isContextMenuAction = function(action) {
        return action.indexOf("ContextMenu") >= 0;
    };

    this._isContextMenuClose = function(action) {
        return action === "ContextMenu_Close";
    };

    this._isDeleteLabelAction = function(action) {
        return action.indexOf("RemoveLabel") >= 0;
    };

    this._isClickLabelDeleteAction = function(action) {
        return action.indexOf("Click_LabelDelete") >= 0;
    };

    this._isTaskStartAction = function(action) {
        return action.indexOf("TaskStart") >= 0;
    };

    this._isSeverityShortcutAction = function(action) {
        return action.indexOf("KeyboardShortcut_Severity") >= 0;
    };

    this._isFinishLabelingAction = function(action) {
        return action.indexOf("LabelingCanvas_FinishLabeling") >= 0;
    };

    /** Returns actions */
    this.getActions = function () {
        return actions;
    };

    this._notesToString = function(param) {
        if (!param) return "";

        var note = "";
        for (var key in param) {
            if (note.length > 0)
                note += ",";
            note += key + ':' + param[key];
        }
        return note;
    };

    /**
     * This function pushes action type, time stamp, current pov, and current panoId into actions list.
     */

    this.create = function(action, notes, extraData) {
        if (!notes) notes = {};
        if (!extraData) extraData = {};

        var pov, latlng, panoId, audit_task_id;

        var note = this._notesToString(notes);

        if ('canvas' in svl && svl.canvas.getCurrentLabel()) {
            audit_task_id = svl.canvas.getCurrentLabel().getProperties().audit_task_id;
        } else {
            audit_task_id = currentAuditTask;
        }

        if ('temporaryLabelId' in extraData) {
            if (currentLabel !== null) {
                updatedLabels.push(currentLabel);
                svl.labelContainer.addUpdatedLabel(currentLabel);
            }
            currentLabel = extraData['temporaryLabelId'];
        }

        // Initialize variables. Note you cannot get pov, panoid, or position
        // before the map and SV load.
        try {
            pov = svl.map.getPov();
        } catch (err) {
            pov = {
                heading: null,
                pitch: null,
                zoom: null
            }
        }

        try {
            latlng = svl.map.getPosition();
        } catch (err) {
            latlng = {
                lat: null,
                lng: null
            };
        }
        if (!latlng) {
            latlng = {
                lat: null,
                lng: null
            };
        }

        try {
            panoId = svl.map.getPanoId();
        } catch (err) {
            panoId = null;
        }

        var timestamp = new Date().getTime();

        return {
            action : action,
            gsv_panorama_id: panoId,
            lat: latlng.lat,
            lng: latlng.lng,
            heading: pov.heading,
            pitch: pov.pitch,
            zoom: pov.zoom,
            note: note,
            temporary_label_id: currentLabel,
            audit_task_id: audit_task_id,
            timestamp: timestamp
        };
    };

    /**
     * @param action: the action to be stored in the database
     * @param notes: (optional) the notes field in the database
     * @param extraData: (optional) extra data that should not be stored in the notes field in db
     */
    this.push = function (action, notes, extraData) {
        if (self._isContextMenuAction(action) || self._isSeverityShortcutAction(action)) {
            var labelProperties = svl.contextMenu.getTargetLabel().getProperties();
            currentLabel = labelProperties.temporary_label_id;

            if (notes === null || typeof (notes) === 'undefined') {
                notes = {'auditTaskId': labelProperties.audit_task_id};
            } else {
                notes['auditTaskId'] = labelProperties.audit_task_id;
            }

            // Reset currentLabel to null if this is a context menu event that fired after the menu already closed.
            if (svl.contextMenu.isOpen()) {
                updatedLabels.push(currentLabel);
                svl.labelContainer.addUpdatedLabel(currentLabel);
            } else {
                currentLabel = null;
            }

        } else if (self._isClickLabelDeleteAction(action)) {
            var labelProperties = svl.canvas.getCurrentLabel().getProperties();
            currentLabel = labelProperties.temporary_label_id;
            updatedLabels.push(currentLabel);
            svl.labelContainer.addUpdatedLabel(currentLabel);

            if (notes === null || typeof(notes) === 'undefined') {
                notes = {'auditTaskId' : labelProperties.audit_task_id};
            } else {
                notes['auditTaskId'] = labelProperties.audit_task_id;
            }
        }

        var item = self.create(action, notes, extraData);
        actions.push(item);
        var contextMenuLabel = true;

        if (self._isFinishLabelingAction(action) && (notes['labelType'] === 'NoSidewalk' || notes['labelType'] === 'Occlusion')) {
            contextMenuLabel = false;
        }

        //we are no longer interacting with a label, set currentLabel to null
        if (self._isContextMenuClose(action) || self._isDeleteLabelAction(action) || !contextMenuLabel) {
            currentLabel = null;
        }

        // Submit the data collected thus far if actions is too long.
        if (actions.length > 200 && !self._isCanvasInteraction(action) && !self._isContextMenuAction(action)) {
            self.submitForm();
        }

        return this;
    };

    this.submitForm = function() {
        if (svl.hasOwnProperty('taskContainer')) {
            var task = svl.taskContainer.getCurrentTask();
            var data = svl.form.compileSubmissionData(task);
            svl.form.submit(data, task);
        }
    };

    this.initTaskId = function() {
        self.submitForm();
    };

    /**
     * Put the previous labeling actions into prevActions. Then refresh the current actions.
     */
    this.refresh = function() {
        prevActions = prevActions.concat(actions);
        actions = [];

        updatedLabels = [];
        if (currentLabel !== null) {
            updatedLabels.push(currentLabel);
            svl.labelContainer.addUpdatedLabel(currentLabel);
        }

        self.push("RefreshTracker");
    };

    this.init();
}

/**
 * Alert Module
 * @constructor
 */
function Alert() {
    var self = {};

    function init() {
        self.ui = {
            holder: $("#alert-holder"),
            message: $("#alert-message"),
            close: $("#alert-close"),
            dontShow: $("#alert-dont-show")
        };

        self.ui.close.on('click', function() {
            self.hideAlert();
        });

        self.ui.dontShow.on('click', function() {
            self.dontShowClicked();
        });

        self.dontShowList = svl.storage.get("alertDontShowList") || [];
    }

    /**
     *
     * @param msg: the message in the alert
     * @param type: is a string, used to identifying message types
     * @param dontShow: boolean, whether the don't show link is enabled or not
     * @param callback callback to run after showing alert
     */
    function showAlert(msg, type, dontShow, callback) {
        if (!dontShow) dontShow = false;

        if(type == null || !(self.dontShowList.indexOf(type) >= 0)) {
            if(dontShow)
                self.ui.dontShow.show();
            else
                self.ui.dontShow.hide();

            self.hideAlert(function() {
                self.ui.message.html(msg);
                self.lastMessageType = type;
                self.ui.holder.fadeIn(300, callback);
            });

            self.hideTimeout = setTimeout(function() {
                self.hideAlert();
            }, 15000);
        }
    }

    function hideAlert(callback) {
        self.ui.holder.fadeOut(300, callback);
        clearTimeout(self.hideTimeout);
    }

    function dontShowClicked() {
        if(self.lastMessageType != null) {
            self.dontShowList.push(self.lastMessageType);
            svl.storage.set("alertDontShowList", self.dontShowList);
            self.hideAlert();
        }
    }

    init();

    self.showAlert = showAlert;
    self.hideAlert = hideAlert;
    self.dontShowClicked = dontShowClicked;

    return self;
}

/*
 * Defines triggers to display jump tip message after the jump operation happens
 */
function JumpAlert(alertHandler, jumpModel) {
    var self = this;
    var _jumpModel = jumpModel;

    this.showJumpTipMessage = function (message) {
        alertHandler.showAlert(message, 'jumpTipMessage' , true);
    };

    _jumpModel.on("JumpAlert:clickJumpMsg", function () {
        self.showJumpTipMessage(i18next.t('popup.jump'));
    });

    _jumpModel.on("JumpAlert:tooFar", function () {
        self.showJumpTipMessage(i18next.t('popup.jump-auto'));
    });

}
/**
 * Created by manaswi on 12/1/16.
 */
function JumpModel () {
    var self = this;
}
_.extend(JumpModel.prototype, Backbone.Events);

JumpModel.prototype.triggerTooFarFromJumpLocation = function () {
    this.trigger("JumpAlert:tooFar");
};

JumpModel.prototype.triggerUserClickJumpMessage = function () {
    this.trigger("JumpAlert:clickJumpMsg");
};

function KeyboardShortcutAlert(alertHandler) {
    var self = {
        'clickCount': {}
    };
    var MINIMUM_CLICKS_BEFORE_ALERT = 10;

    function modeSwitchButtonClicked(labelType) {
        if(labelType === 'Walk')
            return;

        if (labelType in self['clickCount'])
            self['clickCount'][labelType]++;
        else
            self['clickCount'][labelType] = 1;

        if (self['clickCount'][labelType] >= MINIMUM_CLICKS_BEFORE_ALERT &&
            (svl.isOnboarding() === false)) {
            var labelDescription = util.misc.getLabelDescriptions(labelType);
            if ('keyChar' in labelDescription) {
                var shortcut = labelDescription['keyChar'];
                var translationKey = `popup.label-shortcuts-${ util.camelToKebab(labelType) }`;
                alertHandler.showAlert(i18next.t(translationKey, { key: shortcut }), labelType, true);
                self['clickCount'][labelType] = 0;
            }
        }
    }

    self.modeSwitchButtonClicked = modeSwitchButtonClicked;
    return self;
}

function RatingReminderAlert(alertHandler) {
    var self = {
        'ratingCount': {}
    };
    var MINIMUM_NO_RATING_BEFORE_ALERT = 4; //consecutive

    function ratingClicked(severity) {
        if (severity == null) {
            if (self['ratingCount'] > 0) {
                self['ratingCount']++;
            } else {
                self['ratingCount'] = 1;
            }
        }//check if user picked a severity
        else {
            self['ratingCount'] = 0;
        }//reset counter if user labels once
        if (self['ratingCount'] >= MINIMUM_NO_RATING_BEFORE_ALERT && !svl.isOnboarding()) {

            alertHandler.showAlert(i18next.t('popup.severity-shortcuts'), 'reminderMessage', true);
            self['ratingCount'] = 0;

        }//not in tutorial screen

        //Remember to rate the passableness for each area you label!
    }

    self.ratingClicked = ratingClicked;
    return self;
}
/*
 * Creates the alerts you may see when clicking the Stuck button.
 */
function StuckAlert(alertHandler) {
    var that = this;
    var _recentPanos = [];

    function stuckClicked() {
        alertHandler.showAlert(i18next.t('popup.still-stuck'), 'stuck' , true);
    }

    function stuckSkippedStreet() {
        alertHandler.showAlert(i18next.t('popup.stuck-skipped-street'), 'stuckStreetSkipped' , true);
    }

    // Check if the user has visited the same pano multiple times recently. If so, show an alert bc they might be stuck.
    function panoVisited(panoId) {
        _recentPanos.push(panoId);

        // Only keep track of the 25 most recent panos visited.
        if (_recentPanos.length > 25) _recentPanos.shift();

        // If this is their 3rd time visiting the pano recently, show an alert.
        if (_recentPanos.filter(x => x === panoId).length > 2) {
            alertHandler.showAlert(i18next.t('popup.stuck-suggestion'), 'stuckSuggestion', true);
        }
    }

    // If the user clicks on the compass or stuck button, make sure that we don't try to teach them about it right now.
    function compassOrStuckClicked() {
        _recentPanos = [];
    }

    that.stuckClicked = stuckClicked;
    that.stuckSkippedStreet = stuckSkippedStreet;
    that.panoVisited = panoVisited;
    that.compassOrStuckClicked = compassOrStuckClicked;
    return that;
}

function ZoomShortcutAlert(alertHandler) {
    var self = {
        'zoomCount': {}
    };
    var MINIMUM_ZOOM_CLICKS_BEFORE_ALERT = 5;

    function zoomClicked() {
      if (self['zoomCount'] > 0) {
          self['zoomCount']++;
      } else {
          self['zoomCount'] = 1;
      }

        if (self['zoomCount'] >= MINIMUM_ZOOM_CLICKS_BEFORE_ALERT && svl.isOnboarding() == false) {
                alertHandler.showAlert(i18next.t('popup.zoom-shortcuts'), 'zoomMessage', true);
                self['zoomCount'] = 0;
        }
    }

    self.zoomClicked = zoomClicked;
    return self;
}

/**
 * Canvas Module.
 * @param ribbon
 * @returns {{className: string}}
 * @constructor
 */
function Canvas(ribbon) {
    var self = {className: 'Canvas'};

    // Mouse status and mouse event callback functions
    var mouseStatus = {
        currX: 0,
        currY: 0,
        prevX: 0,
        prevY: 0,
        leftDownX: 0,
        leftDownY: 0,
        leftUpX: 0,
        leftUpY: 0,
        isLeftDown: false,
        prevMouseDownTime: 0,
        prevMouseUpTime: 0
    };
    // Properties
    var properties = {
        drawingMode: "point",
        radiusThresh: 7,
        showDeleteMenuTimeOutToken: undefined,
        tempPointRadius: 5
    };

    var pointParameters = {
        'fillStyleInnerCircle': 'rgba(0,0,0,1)', // labelColor.fillStyle,
        'iconImagePath': undefined, // iconImagePath,
        'radiusInnerCircle': 5, //13,
        'radiusOuterCircle': 6, //14
    };

    var status = {
        currentLabel: null,
        disableLabelDelete: false,
        disableLabelEdit: false,
        disableLabeling: false,
        disableWalking: false,
        drawing: false,

        lockCurrentLabel: false,
        lockDisableLabelDelete: false,
        lockDisableLabelEdit: false,
        lockDisableLabeling: false,
        svImageCoordinatesAdjusted: false,
        totalLabelCount: 0,
        'visibilityMenu': 'hidden'
    };

    var lock = {
        showLabelTag: false
    };

    // Canvas context
    var canvasProperties = {'height': 0, 'width': 0};
    var ctx;

    var tempPath = [];

    // Initialization
    function _init() {
        var el = document.getElementById("label-canvas");
        if (!el) {
            return false;
        }
        ctx = el.getContext('2d');
        canvasProperties.width = el.width;
        canvasProperties.height = el.height;

        // Attach listeners to dom elements
        if (svl.ui.canvas.drawingLayer) {
            svl.ui.canvas.drawingLayer.bind('mousedown', handleDrawingLayerMouseDown);
            svl.ui.canvas.drawingLayer.bind('mouseup', handleDrawingLayerMouseUp);
            svl.ui.canvas.drawingLayer.bind('mousemove', handleDrawingLayerMouseMove);
            $("#interaction-area-holder").on('mouseleave', handleDrawingLayerMouseOut);
        }
        if (svl.ui.canvas.deleteIcon) {
            svl.ui.canvas.deleteIcon.bind("click", labelDeleteIconClick);
        }

        // Point radius
        if (properties.drawingMode == 'path') {
            properties.pointInnerCircleRadius = 5;
            properties.pointOuterCircleRadius = 6;
        } else {
            properties.pointInnerCircleRadius = 17;
            properties.pointOuterCircleRadius = 14;
        }
    }

    /**
     * Finish up labeling.
     * Clean this method when I get a chance.....
     */
    function closeLabelPath() {
        var labelType = ribbon.getStatus('selectedLabelType');
        var labelColor = util.misc.getLabelColors()[labelType],
            labelDescription = util.misc.getLabelDescriptions(labelType),
            iconImagePath = util.misc.getIconImagePaths(labelDescription.id).iconImagePath;

        pointParameters.fillStyleInnerCircle = labelColor.fillStyle;
        pointParameters.iconImagePath = iconImagePath;
        pointParameters.radiusInnerCircle = properties.pointInnerCircleRadius;
        pointParameters.radiusOuterCircle = properties.pointOuterCircleRadius;

        var points = [], pov = svl.map.getPov();

        for (var i = 0, pathLen = tempPath.length; i < pathLen; i++) {
            points.push(new Point(svl, tempPath[i].x, tempPath[i].y, pov, pointParameters));
        }

        var path = new Path(svl, points, {});
        var latlng = svl.map.getPosition();
        var param = {
            canvasWidth: svl.canvasWidth,
            canvasHeight: svl.canvasHeight,
            canvasDistortionAlphaX: svl.alpha_x,
            canvasDistortionAlphaY: svl.alpha_y,
            tutorial: svl.missionContainer.getCurrentMission().getProperty("missionType") === "auditOnboarding",
            labelType: labelDescription.id,
            labelDescription: labelDescription.text,
            labelFillStyle: labelColor.fillStyle,
            panoId: svl.map.getPanoId(),
            panoramaLat: latlng.lat,
            panoramaLng: latlng.lng,
            panoramaHeading: pov.heading,
            panoramaPitch: pov.pitch,
            panoramaZoom: parseInt(pov.zoom, 10),
            svImageWidth: svl.svImageWidth,
            svImageHeight: svl.svImageHeight,
            svMode: 'html4'
        };
        if (("panorama" in svl) && ("getPhotographerPov" in svl.panorama)) {
            var photographerPov = svl.panorama.getPhotographerPov();
            param.photographerHeading = photographerPov.heading;
            param.photographerPitch = photographerPov.pitch;
        }

        status.currentLabel = svl.labelFactory.create(path, param);
        svl.labelContainer.push(status.currentLabel);


        // TODO Instead of calling the contextMenu show, throw an Canvas:closeLabelPath event.
        if ('contextMenu' in svl) {
            svl.contextMenu.show(tempPath[0].x, tempPath[0].y, {
                targetLabel: status.currentLabel,
                targetLabelColor: labelColor.fillStyle
            });
        }

        svl.tracker.push('LabelingCanvas_FinishLabeling', {
            labelType: labelDescription.id,
            canvasX: tempPath[0].x,
            canvasY: tempPath[0].y
        }, {
            temporaryLabelId: status.currentLabel.getProperty('temporary_label_id')
        });

        // Sound effect.
        if ('audioEffect' in svl) {
            svl.audioEffect.play('drip');
        }

        // Initialize the tempPath.
        tempPath = [];
        ribbon.backToWalk();

    }

    function handleDrawingLayerMouseOut(e) {
        svl.tracker.push('LabelingCanvas_MouseOut');
        if (!svl.isOnboarding() && !_mouseIsOverAnOverlayLink(e) && !_mouseIsOverAnOverlayMessageBox(e)) {
            ribbon.backToWalk();
        }
    }

    /**
     * Reference
     * http://stackoverflow.com/questions/8813051/determine-which-element-the-mouse-pointer-is-on-top-of-in-javascript
     * @param e
     * @private
     */
    function _mouseIsOverAnOverlayLink(e) {
        var x = e.clientX, y = e.clientY;
        var elementMouseIsOver = document.elementFromPoint(x, y);
        return $(elementMouseIsOver).text() == i18next.t('top-ui.instruction.explain');
    }

    function _mouseIsOverAnOverlayMessageBox(e) {
        var x = e.clientX, y = e.clientY;
        var elementMouseIsOver = document.elementFromPoint(x, y);
        return $(elementMouseIsOver).attr("id") == "overlay-message-box";
    }

    /**
     * This function is fired when at the time of mouse-down
     * @param e
     */
    function handleDrawingLayerMouseDown(e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = util.mouseposition(e, this).x;
        mouseStatus.leftDownY = util.mouseposition(e, this).y;

        svl.tracker.push('LabelingCanvas_MouseDown', {x: mouseStatus.leftDownX, y: mouseStatus.leftDownY});

        mouseStatus.prevMouseDownTime = new Date().getTime();
    }

    /**
     * This function is fired when at the time of mouse-up
     */
    function handleDrawingLayerMouseUp(e) {
        var currTime;

        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = util.mouseposition(e, this).x;
        mouseStatus.leftUpY = util.mouseposition(e, this).y;

        currTime = new Date().getTime();

        if (!status.disableLabeling && currTime - mouseStatus.prevMouseUpTime > 300) {
            if (properties.drawingMode == "point") {
                tempPath.push({x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
                closeLabelPath();
            }
            // NOT being used now in this tool
            else if (properties.drawingMode == "path") {
                // Path labeling.

                // Define point parameters to draw
                if (!status.drawing) {
                    // Start drawing a path if a user hasn't started to do so.
                    status.drawing = true;
                    if ('tracker' in svl && svl.tracker) {
                        svl.tracker.push('LabelingCanvas_StartLabeling');
                    }
                    tempPath.push({x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
                } else {
                    // Close the current path if there are more than 2 points in the tempPath and
                    // the user clicks on a point near the initial point.
                    var closed = false;
                    if (tempPath.length > 2) {
                        var r = Math.sqrt(Math.pow((tempPath[0].x - mouseStatus.leftUpX), 2) + Math.pow((tempPath[0].y - mouseStatus.leftUpY), 2));
                        if (r < properties.radiusThresh) {
                            closed = true;
                            status.drawing = false;
                            closeLabelPath();
                        }
                    }

                    // Otherwise add a new point
                    if (!closed) {
                        tempPath.push({x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
                    }
                }

            }

            clear();
            setVisibilityBasedOnLocation('visible', svl.map.getPanoId());
            render2();
        }
        // NOT being used now in this tool
        else if (currTime - mouseStatus.prevMouseUpTime < 400) {
            if (properties.drawingMode == "path") {
                // This part is executed for a double click event
                // If the current status.drawing = true, then close the current path.
                if (status.drawing && tempPath.length > 2) {
                    status.drawing = false;

                    closeLabelPath();
                    self.clear();
                    self.setVisibilityBasedOnLocation('visible', svl.map.getPanoId());
                    self.render2();
                }
            }
        }


        svl.tracker.push('LabelingCanvas_MouseUp', {x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
        mouseStatus.prevMouseUpTime = new Date().getTime();
        mouseStatus.prevMouseDownTime = 0;
    }

    /**
     * This function is fired when mouse cursor moves over the drawing layer.
     */
    function handleDrawingLayerMouseMove(e) {
        var mousePosition = mouseposition(e, this);
        mouseStatus.currX = mousePosition.x;
        mouseStatus.currY = mousePosition.y;

        // Change a cursor according to the label type.
        var iconImagePaths = util.misc.getIconImagePaths();
        var labelType = ribbon.getStatus('mode');
        if (labelType) {
            var iconImagePath = iconImagePaths[labelType].iconImagePath;
            var cursorUrl = "url(" + iconImagePath + ") 19 19, auto";
            $(this).css('cursor', ''); //should first reset the cursor, otherwise safari strangely does not update the cursor
            $(this).css('cursor', cursorUrl);
        }


        if (!status.drawing) {
            var ret = isOn(mouseStatus.currX, mouseStatus.currY);
            if (ret && ret.className === 'Path') {
                showLabelTag(status.currentLabel);
                ret.renderBoundingBox(ctx);
            } else {
                showLabelTag(undefined);
            }
        }
        clear();
        render2();
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     */
    function imageCoordinates2String(coordinates) {
        if (!(coordinates instanceof Array)) {
            throw self.className + '.imageCoordinates2String() expects Array as an input';
        }
        if (coordinates.length === 0) {
            throw self.className + '.imageCoordinates2String(): Empty array';
        }
        var ret = '';
        var i;
        var len = coordinates.length;

        for (i = 0; i < len; i += 1) {
            ret += parseInt(coordinates[i].x) + ' ' + parseInt(coordinates[i].y) + ' ';
        }

        return ret;
    }

    /**
     * This is called when a user clicks a delete icon.
     */
    function labelDeleteIconClick() {
        if (!status.disableLabelDelete) {
            svl.tracker.push('Click_LabelDelete', {labelType: self.getCurrentLabel().getProperty('labelType')});
            var currLabel = self.getCurrentLabel();
            if (!currLabel) {
                // TODO is the case described below still ever used? -- Mikey, Oct 2022
                // Sometimes (especially during ground truth insertion if you force a delete icon to show up all the time),
                // currLabel would not be set properly. In such a case, find a label underneath the delete icon.
                var x = svl.ui.canvas.deleteIconHolder.css('left');
                var y = svl.ui.canvas.deleteIconHolder.css('top');
                x = x.replace("px", "");
                y = y.replace("px", "");
                x = parseInt(x, 10) + 5;
                y = parseInt(y, 10) + 5;
                var item = isOn(x, y);
                if (item && item.className === "Point") {
                    var path = item.belongsTo();
                    currLabel = path.belongsTo();
                } else if (item && item.className === "Label") {
                    currLabel = item;
                } else if (item && item.className === "Path") {
                    currLabel = item.belongsTo();
                }
            }

            if (currLabel) {
                svl.labelContainer.removeLabel(currLabel);
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');

                // If showLabelTag is blocked by GoldenInsertion (or by any other object), unlock it as soon as
                // a label is deleted.
                if (lock.showLabelTag) {
                    self.unlockShowLabelTag();
                }
            }
        }
    }

    /**
     * Render a temporary path while the user is drawing.
     */
    function renderTempPath() {
        var pathLen = tempPath.length,
            labelColor = util.misc.getLabelColors()[ribbon.getStatus('selectedLabelType')],
            pointFill = labelColor.fillStyle,
            curr, prev, r;
        pointFill = util.color.changeAlphaRGBA(pointFill, 0.5);


        // Draw the first line.
        ctx.strokeStyle = 'rgba(255,255,255,1)';
        ctx.lineWidth = 2;
        if (pathLen > 1) {
            curr = tempPath[1];
            prev = tempPath[0];
            r = Math.sqrt(Math.pow((tempPath[0].x - mouseStatus.currX), 2) + Math.pow((tempPath[0].y - mouseStatus.currY), 2));

            // Change the circle radius of the first point depending on the distance between a mouse cursor and the point coordinate.
            if (r < properties.radiusThresh && pathLen > 2) {
                util.shape.lineWithRoundHead(ctx, prev.x, prev.y, 2 * properties.tempPointRadius, curr.x, curr.y, properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
            } else {
                util.shape.lineWithRoundHead(ctx, prev.x, prev.y, properties.tempPointRadius, curr.x, curr.y, properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
            }
        }

        // Draw the lines in between
        for (var i = 2; i < pathLen; i++) {
            curr = tempPath[i];
            prev = tempPath[i - 1];
            util.shape.lineWithRoundHead(ctx, prev.x, prev.y, 5, curr.x, curr.y, 5, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
        }

        if (r < properties.radiusThresh && pathLen > 2) {
            util.shape.lineWithRoundHead(ctx, tempPath[pathLen - 1].x, tempPath[pathLen - 1].y, properties.tempPointRadius, tempPath[0].x, tempPath[0].y, 2 * properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
        } else {
            util.shape.lineWithRoundHead(ctx, tempPath[pathLen - 1].x, tempPath[pathLen - 1].y, properties.tempPointRadius, mouseStatus.currX, mouseStatus.currY, properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'stroke', 'rgba(255,255,255,1)', pointFill);
        }
    }

    /**
     * Cancel drawing while use is drawing a label
     * @method
     */
    function cancelDrawing() {
        // This method clears a tempPath and cancels drawing. This method is called by Keyboard when esc is pressed.
        if ('tracker' in svl && svl.tracker && status.drawing) {
            svl.tracker.push("LabelingCanvas_CancelLabeling");
        }

        tempPath = [];
        status.drawing = false;
        self.clear().render2();
        return this;
    }

    /**
     * Clear what's on the canvas.
     * @method
     */
    function clear() {
        // Clears the canvas
        if (ctx) {
            ctx.clearRect(0, 0, canvasProperties.width, canvasProperties.height);
        } else {
            console.warn('The ctx is not set.')
        }
        return this;
    }

    /**
     *
     * @method
     */
    function disableLabelDelete() {
        if (!status.lockDisableLabelDelete) {
            status.disableLabelDelete = true;
            return this;
        }
        return false;
    }

    /**
     * @method
     * @return {boolean}
     */
    function disableLabelEdit() {
        if (!status.lockDisableLabelEdit) {
            status.disableLabelEdit = true;
            return this;
        }
        return false;
    }

    /**
     * Disable labeling
     * @method
     */
    function disableLabeling() {
        // Check right-click-menu visibility
        // If any of menu is visible, disable labeling
        if (!status.lockDisableLabeling) {
            status.disableLabeling = true;
            return this;
        }
        return false;
    }

    /**
     * Enable deleting labels
     * @method
     */
    function enableLabelDelete() {
        if (!status.lockDisableLabelDelete) {
            status.disableLabelDelete = false;
            return this;
        }
        return false;
    }

    /**
     * Enables editing labels
     * @method
     */
    function enableLabelEdit() {
        if (!status.lockDisableLabelEdit) {
            status.disableLabelEdit = false;
            return this;
        }
        return false;
    }

    /**
     * Enables labeling
     * @method
     */
    function enableLabeling() {
        if (!status.lockDisableLabeling) {
            status.disableLabeling = false;
            return this;
        }
        return false;
    }

    /**
     * Returns the label of the current focus
     * @method
     */
    function getCurrentLabel() {
        return status.currentLabel;
    }

    /**
     * Returns a lock that corresponds to the key.
     * TODO replace the various locking methods with just this one.
     * @method
     */
    function getLock(key) {
        return lock[key];
    }

    /**
     * Returns a status
     * @method
     */
    function getStatus(key) {
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    }

    /**
     * This method returns the current status drawing.
     * @method
     * @return {boolean}
     */
    function isDrawing() {
        return status.drawing;
    }

    /**
     * This function takes cursor coordinates x and y on the canvas. Then returns an object right below the cursor.
     * If a cursor is not on anything, return false.
     * @method
     */
    function isOn(x, y) {
        var i, ret = false,
            labels = svl.labelContainer.getCanvasLabels(),
            lenLabels = labels.length;

        for (i = 0; i < lenLabels; i += 1) {
            // Check labels, paths, and points to see if they are under a mouse cursor
            ret = labels[i].isOn(x, y);
            if (ret) {
                status.currentLabel = labels[i];
                return ret;
            }
        }
        return false;
    }

    /**
     * @method
     */
    function lockCurrentLabel() {
        status.lockCurrentLabel = true;
        return this;
    }

    /**
     * Lock disable label delete
     * @method
     */
    function lockDisableLabelDelete() {
        status.lockDisableLabelDelete = true;
        return this;
    }

    /**
     * Lock disable label edit
     * @method
     */
    function lockDisableLabelEdit() {
        status.lockDisableLabelEdit = true;
        return this;
    }

    /**
     * Lock disable labeling
     * @method
     */
    function lockDisableLabeling() {
        status.lockDisableLabeling = true;
        return this;
    }

    /**
     * This method locks showLabelTag
     * @method
     */
    function lockShowLabelTag() {
        lock.showLabelTag = true;
        return this;
    }

    /**
     * @method
     */
    function pushLabel(label) {
        status.currentLabel = label;
        svl.labelContainer.push(label);
        return this;
    }


    /**
     * Renders labels
     * @method
     */
    function render2() {
        if (!ctx) {
            return this;
        }
        var i, j, label, lenLabels,
            labels = svl.labelContainer.getCanvasLabels();
        status.totalLabelCount = 0;
        var pov = svl.map.getPov();

        var povChange = svl.map.getPovChangeStatus();
        // For the condition, when the interface loads for the first time
        // The pov is changed. Prevents the conversion function to be called
        // for the initial rendering pipeline
        if (labels.length === 0 && povChange["status"]) {
            povChange["status"] = false;
        }

        var points, pointsLen, pointData, svImageCoordinate, deltaHeading, deltaPitch, x, y;
        // The image coordinates of the points in system labels shift as the projection parameters
        // (i.e., heading and pitch) that
        // you can get from Street View API change. So adjust the image coordinate
        // Note that this adjustment happens only once
        if (!status.svImageCoordinatesAdjusted) {
            var currentPhotographerPov = svl.panorama.getPhotographerPov();
            if (currentPhotographerPov && 'heading' in currentPhotographerPov && 'pitch' in currentPhotographerPov) {
                lenLabels = labels.length;
                for (i = 0; i < lenLabels; i += 1) {
                    // Check if the label comes from current SV panorama
                    label = labels[i];
                    points = label.getPoints(true);
                    pointsLen = points.length;

                    for (j = 0; j < pointsLen; j++) {
                        pointData = points[j].getProperties();
                        svImageCoordinate = points[j].getGSVImageCoordinate();
                        if ('photographerHeading' in pointData && pointData.photographerHeading) {
                            deltaHeading = currentPhotographerPov.heading - pointData.photographerHeading;
                            deltaPitch = currentPhotographerPov.pitch - pointData.photographerPitch;
                            x = (svImageCoordinate.x + (deltaHeading / 360) * svl.svImageWidth + svl.svImageWidth) % svl.svImageWidth;
                            y = svImageCoordinate.y + (deltaPitch / 90) * svl.svImageHeight;
                            points[j].resetSVImageCoordinate({x: x, y: y})
                        }
                    }
                }
                status.svImageCoordinatesAdjusted = true;
            }
        }

        // Render user labels. First check if the label comes from current SV panorama
        lenLabels = labels.length;
        for (i = 0; i < lenLabels; i += 1) {
            label = labels[i];
            label.render(ctx, pov);

            if (label.isVisible() && !label.isDeleted()) {
                status.totalLabelCount += 1;
            }
        }
        povChange["status"] = false;

        // Draw a temporary path from the last point to where a mouse cursor is.
        if (status.drawing) {
            renderTempPath();
        }

        // Update the opacity of Zoom In and Zoom Out buttons.
        if (svl.zoomControl) {
            svl.zoomControl.updateOpacity();
        }

        return this;
    }

    /**
     * @method
     */
    function renderBoundingBox(path) {
        path.renderBoundingBox(ctx);
        return this;
    }

    /**
     * @method
     */
    function setCurrentLabel(label) {
        if (!status.lockCurrentLabel) {
            status.currentLabel = label;
            return this;
        }
        return false;
    }

    /**
     * This sets the status of the canvas object
     * @param key
     * @param value
     * @returns {*}
     */
    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    /**
     * @method
     */
    /**
     * This function sets the passed label's tagVisiblity to 'visible' and all the others to 'hidden'
     * @param label
     * @returns {showLabelTag}
     */
    function showLabelTag(label) {
        if (!lock.showLabelTag) {
            var i,
                labels = svl.labelContainer.getCanvasLabels(),
                labelLen = labels.length;
            var isAnyVisible = false;
            for (i = 0; i < labelLen; i += 1) {
                labels[i].setTagVisibility('hidden');
                labels[i].resetTagCoordinate();
            }
            if (label) {
                label.setTagVisibility('visible');
                isAnyVisible = true;
            } else {
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
            }
            // If any of the tags is visible, show a deleting icon on it.
            if (!isAnyVisible) {
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
            }

            self.clear();
            self.render2();
            return this;
        }
    }

    /**
     * @method
     */
    function setTagVisibility(labelIn) {
        return self.showLabelTag(labelIn);
    }

    /**
     * @method
     */
    function setVisibility(visibility) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].unlockVisibility();
            labels[i].setVisibility('visible');
        }
        return this;
    }

    /**
     * Set the visibility of the labels based on pano id.
     */
    function setVisibilityBasedOnLocation(visibility, panoramaId) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibilityBasedOnLocation(visibility, panoramaId);
        }
        return this;
    }

    /**
     * Hide labels that are not in LabelerIds
     * @method
     */
    function setVisibilityBasedOnLabelerId(visibility, LabelerIds, included) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibilityBasedOnLabelerId(visibility, LabelerIds, included);
        }
        return this;
    }

    /**
     * @method
     */
    function setVisibilityBasedOnLabelerIdAndLabelTypes(visibility, table, included) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;
        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibilityBasedOnLabelerIdAndLabelTypes(visibility, table, included);
        }
        return this;
    }

    /**
     * @method
     */
    function unlockCurrentLabel() {
        status.lockCurrentLabel = false;
        return this;
    }

    /**
     * @method
     */
    function unlockDisableLabelDelete() {
        status.lockDisableLabelDelete = false;
        return this;
    }

    /**
     * @method
     */
    function unlockDisableLabelEdit() {
        status.lockDisableLabelEdit = false;
        return this;
    }

    /**
     * @method
     */
    function unlockDisableLabeling() {
        status.lockDisableLabeling = false;
        return this;
    }

    /**
     * @method
     */
    function unlockShowLabelTag() {
        // This method locks showLabelTag
        lock.showLabelTag = false;
        return this;
    }

    // Initialization
    _init();

    // Put public methods to self and return them.
    self.cancelDrawing = cancelDrawing;
    self.clear = clear;
    self.disableLabelDelete = disableLabelDelete;
    self.disableLabelEdit = disableLabelEdit;
    self.disableLabeling = disableLabeling;
    self.enableLabelDelete = enableLabelDelete;
    self.enableLabelEdit = enableLabelEdit;
    self.enableLabeling = enableLabeling;
    self.getCurrentLabel = getCurrentLabel;
    self.getLock = getLock;
    self.getStatus = getStatus;
    self.isDrawing = isDrawing;
    self.isOn = isOn;
    self.lockCurrentLabel = lockCurrentLabel;
    self.lockDisableLabelDelete = lockDisableLabelDelete;
    self.lockDisableLabelEdit = lockDisableLabelEdit;
    self.lockDisableLabeling = lockDisableLabeling;
    self.lockShowLabelTag = lockShowLabelTag;
    self.pushLabel = pushLabel;
    self.render = render2;
    self.render2 = render2;
    self.renderBoundingBox = renderBoundingBox;
    self.setCurrentLabel = setCurrentLabel;
    self.setStatus = setStatus;
    self.showLabelTag = showLabelTag;
    self.setTagVisibility = setTagVisibility;
    self.setVisibility = setVisibility;
    self.setVisibilityBasedOnLocation = setVisibilityBasedOnLocation;
    self.setVisibilityBasedOnLabelerId = setVisibilityBasedOnLabelerId;
    self.setVisibilityBasedOnLabelerIdAndLabelTypes = setVisibilityBasedOnLabelerIdAndLabelTypes;
    self.unlockCurrentLabel = unlockCurrentLabel;
    self.unlockDisableLabelDelete = unlockDisableLabelDelete;
    self.unlockDisableLabelEdit = unlockDisableLabelEdit;
    self.unlockDisableLabeling = unlockDisableLabeling;
    self.unlockShowLabelTag = unlockShowLabelTag;

    return self;
}

function ContextMenu (uiContextMenu) {

    var self = { className: "ContextMenu" },
        status = {
            targetLabel: null,
            visibility: 'hidden',
            disableTagging: false
        };
    var $menuWindow = uiContextMenu.holder,
        $connector = uiContextMenu.connector,
        $severityMenu = uiContextMenu.severityMenu,
        $radioButtons = uiContextMenu.radioButtons,
        $temporaryLabelCheckbox = uiContextMenu.temporaryLabelCheckbox,
        $descriptionTextBox = uiContextMenu.textBox,
        windowWidth = $menuWindow.width(),
        windowHeight = $menuWindow.outerHeight();
    var $OKButton = $menuWindow.find("#context-menu-ok-button");
    var $radioButtonLabels = $menuWindow.find(".radio-button-labels");
    var $tags = uiContextMenu.tags;
    var lastShownLabelColor;

    var context_menu_el = document.getElementById('context-menu-holder');
    document.addEventListener('mousedown', function(event) {
        //event.stopPropagation();
        var clicked_out = !(context_menu_el.contains(event.target));
        if (isOpen()) {
            if (clicked_out) {
             svl.tracker.push('ContextMenu_CloseClickOut');
            handleSeverityPopup();
            }
            hide();
        }
    }); //handles clicking outside of context menu holder
    //document.addEventListener("mousedown", hide);

    $menuWindow.on('mousedown', handleMenuWindowMouseDown);
    $radioButtons.on('change', _handleRadioChange);
    $temporaryLabelCheckbox.on('change', handleTemporaryLabelCheckboxChange);
    $descriptionTextBox.on('change', handleDescriptionTextBoxChange);
    $descriptionTextBox.on('focus', handleDescriptionTextBoxFocus);
    $descriptionTextBox.on('blur', handleDescriptionTextBoxBlur);
    uiContextMenu.closeButton.on('click', handleCloseButtonClick);
    $OKButton.on('click', _handleOKButtonClick);
    $radioButtonLabels.on('mouseenter', _handleRadioButtonLabelMouseEnter);
    $radioButtonLabels.on('mouseleave', _handleRadioButtonLabelMouseLeave);
    $tags.on('click', _handleTagClick);

    var down = {};
    var lastKeyPressed = 0;
    var lastKeyCmd = false;
    onkeydown = onkeyup = function (e) {
        e = e || event; // to deal with IE
        var isMac = navigator.platform.indexOf('Mac') > -1;
        down[e.keyCode] = e.type == 'keydown';

        // Code to highlight description box on command+A or ctrl+A (depending on OS)
        if (isMac) {
            if (lastKeyCmd && down[91] && isOpen() && down[65]) {
                $descriptionTextBox.select();
                down[65] = false; //reset A key
            }//A key, menu shown

        }//mac
        else {
            if (lastKeyPressed == 17 && isOpen() && down[65]) {
                $descriptionTextBox.select();
            }//ctrl+A while context menu open
        }//windows

        // Log last keypresses
        if (e.type == 'keydown') {
            lastKeyPressed = e.keyCode;
            lastKeyCmd = e.metaKey;
        } else {
            lastKeyPressed = 0;
            lastKeyCmd = false;
        }

    }; //handles both key down and key up events

    function checkRadioButton (value) {
        uiContextMenu.radioButtons.filter(function() {return this.value == value}).prop("checked", true).trigger("click", {lowLevelLogging: false});
    }

    function getContextMenuUI() {
        return uiContextMenu;
    }

    /**
     * Returns a the value in status given a key
     * @param key The key to find in status
     * @returns The value in status if it exists. If it doesn't, returns null
     */
    function getStatus (key) {
        return (key in status) ? status[key] : null;
    }

    function getTargetLabel() {
        return getStatus('targetLabel');
    }

    /**
     * Combined with document.addEventListener("mousedown", hide), this method will close the context menu window
     * when user clicks somewhere on the window except for the area on the context menu window.
     * @param e
     */
    function handleMenuWindowMouseDown (e) {
        e.stopPropagation();
    }

    function handleDescriptionTextBoxChange(e) {
        var description = $(this).val(),
            label = getTargetLabel();
        svl.tracker.push('ContextMenu_TextBoxChange', { Description: description });
        if (label) {
            label.setProperty('description', description);
        }
    }

    function handleDescriptionTextBoxBlur() {
        svl.tracker.push('ContextMenu_TextBoxBlur');
        svl.ribbon.enableModeSwitch();
        svl.keyboard.setStatus('focusOnTextField', false);
    }

    function handleDescriptionTextBoxFocus() {
        svl.tracker.push('ContextMenu_TextBoxFocus');
        svl.ribbon.disableModeSwitch();
        svl.keyboard.setStatus('focusOnTextField', true);
    }

    function handleCloseButtonClick() {
        svl.tracker.push('ContextMenu_CloseButtonClick');
        handleSeverityPopup();
        hide();

    }

    function _handleOKButtonClick() {
        svl.tracker.push('ContextMenu_OKButtonClick');
        handleSeverityPopup();
        hide();

    }

    function handleSeverityPopup() {
        var labels = svl.labelContainer.getCurrentLabels();
        var prev_labels = svl.labelContainer.getPreviousLabels();
        if (labels.length === 0) {
            labels = prev_labels;
        }
        if (labels.length > 0) {
            var last_label = labels[labels.length - 1];
            var prop = last_label.getProperties();
            svl.ratingReminderAlert.ratingClicked(prop.severity);
        }
    }

    /**
     *
     * @param e
     */
    function _handleRadioChange (e) {
        var severity = parseInt($(this).val(), 10);
        var label = getTargetLabel();
        svl.tracker.push('ContextMenu_RadioChange', { LabelType: label.getProperty("labelType"), RadioValue: severity });

        self.updateRadioButtonImages();
        if (label) {
            label.setProperty('severity', severity);
            svl.canvas.clear().render2();
        }
    }

    function _handleRadioButtonLabelMouseEnter() {
        var radioValue = parseInt($(this).find("input").attr("value"), 10);
        self.updateRadioButtonImages(radioValue);
    }

    function _handleRadioButtonLabelMouseLeave() {
        self.updateRadioButtonImages();
    }

    self.fetchLabelTags = function (callback) {
        $.when($.ajax({
            contentType: 'application/json; charset=utf-8',
            url: "/label/tags",
            type: 'get',
            success: function (json) {
                self.labelTags = json;
            },
            error: function (result) {
                throw result;
            }
        })).done(callback);
    };

    self.updateRadioButtonImages = function (hoveredRadioButtonValue) {
        var $radioButtonImages = $radioButtonLabels.find("input + img");
        var $selectedRadioButtonImage;
        var $hoveredRadioButtonImage;
        var imageURL;

        $radioButtonImages.each(function (i, element) {
            imageURL = $(element).attr("default-src");
            $(element).attr("src", imageURL);
        });

        // Update the hovered radio button image
        if (hoveredRadioButtonValue && hoveredRadioButtonValue > 0 && hoveredRadioButtonValue <= 5) {
            $hoveredRadioButtonImage = $radioButtonLabels.find("input[value='" + hoveredRadioButtonValue + "'] + img");
            imageURL = $hoveredRadioButtonImage.attr("default-src");
            imageURL = imageURL.replace("_BW.png", ".png");
            $hoveredRadioButtonImage.attr("src", imageURL);
        }

        // Update the selected radio button image
        $selectedRadioButtonImage = $radioButtonLabels.find("input:checked + img");
        if ($selectedRadioButtonImage.length > 0) {
            imageURL = $selectedRadioButtonImage.attr("default-src");
            imageURL = imageURL.replace("_BW.png", ".png");
            $selectedRadioButtonImage.attr("src", imageURL);
        }
    };

    /**
     * Records tag ID when clicked and updates tag color
     */
    function _handleTagClick (e) {
        var label = getTargetLabel();
        var labelType = label.getLabelType();
        var labelTags = label.getProperty('tagIds');

        // Use position of cursor to determine whether or not the click came from the mouse, or from a keyboard shortcut
        var wasClickedByMouse = e.hasOwnProperty("originalEvent") && e.originalEvent.clientX != 0 && e.originalEvent.clientY != 0;

        $("body").unbind('click').on('click', 'button', function (e) {
            if (e.target.name == 'tag') {
                // Get the tag_id from the clicked tag's class name (e.g., "tag-id-9").
                var currTagId = parseInt($(e.target).attr('class').split(" ").filter(c => c.search(/tag-id-\d+/) > -1)[0].match(/\d+/)[0], 10);
                var tag = self.labelTags.filter(tag => tag.tag_id === currTagId)[0];

                // Adds or removes tag from the label's current list of tags.
                if (!labelTags.includes(tag.tag_id)) {
                    // Deals with 'no alternate route' and 'alternate route present' being mutually exclusive.
                    var alternateRoutePresentId = self.labelTags.filter(tag => tag.tag === 'alternate route present')[0].tag_id;
                    var noAlternateRouteId = self.labelTags.filter(tag => tag.tag === 'no alternate route')[0].tag_id;
                    // Automatically deselect one of the tags above if the other one is selected.
                    if (currTagId === alternateRoutePresentId) {
                        labelTags = autoRemoveAlternateLabelAndUpdateUI(noAlternateRouteId, labelTags);
                    } else if (currTagId === noAlternateRouteId) {
                        labelTags = autoRemoveAlternateLabelAndUpdateUI(alternateRoutePresentId, labelTags);
                    }

                    // Deals with 'street has a sidewalk' and 'street has no sidewalks' being mutually exclusive.
                    var streetHasOneSidewalkId = self.labelTags.filter(tag => tag.tag === 'street has a sidewalk')[0].tag_id;
                    var streetHasNoSidewalksId = self.labelTags.filter(tag => tag.tag === 'street has no sidewalks')[0].tag_id;
                    // Automatically deselect one of the tags above if the other one is selected.
                    if (currTagId === streetHasOneSidewalkId) {
                        labelTags = autoRemoveAlternateLabelAndUpdateUI(streetHasNoSidewalksId, labelTags);
                    } else if (currTagId === streetHasNoSidewalksId) {
                        labelTags = autoRemoveAlternateLabelAndUpdateUI(streetHasOneSidewalkId, labelTags);
                    }

                    labelTags.push(tag.tag_id);
                    if (wasClickedByMouse) {
                        svl.tracker.push('ContextMenu_TagAdded',
                            {tagId: tag.tag_id, tagName: tag.tag});
                    } else {
                        svl.tracker.push('KeyboardShortcut_TagAdded',
                            {tagId: tag.tag_id, tagName: tag.tag});
                    }
                } else {
                    var index = labelTags.indexOf(tag.tag_id);
                    labelTags.splice(index, 1);
                    if (wasClickedByMouse) {
                        svl.tracker.push('ContextMenu_TagRemoved',
                            {tagId: tag.tag_id, tagName: tag.tag});
                    } else {
                        svl.tracker.push('KeyboardShortcut_TagRemoved',
                            {tagId: tag.tag_id, tagName: tag.tag});
                    }
                }
                _toggleTagColor(labelTags, tag.tag_id, e.target);
                label.setProperty('tagIds', labelTags);
                e.target.blur();
                getContextMenuUI().tagHolder.trigger('tagIds-updated'); // For events that depend on up-to-date tagIds.
            }
        });
    }

    /**
     * Remove the alternate label, update UI, and add the selected label.
     * @param {*} tagId     The name of the label to be removed.
     * @param {*} labelTags     List of tags that the current label has.
     */
    function autoRemoveAlternateLabelAndUpdateUI(tagId, labelTags) {
        // Find the tag that has the class named "tag-id-<tagId>" and change it's background color.
        $tags.each((index, tag) => {
            var classWithTagId = tag.className.split(" ").filter(c => c.search(/tag-id-\d+/) > -1)[0];
            if (classWithTagId !== undefined && parseInt(classWithTagId.match(/\d+/)[0], 10) === tagId) {
                tag.style.backgroundColor = "white";
            }
        });

        // Remove tag from list of tags and log the automated removal.
        self.labelTags.forEach(tag => {
            if (tag.tag_id === tagId && labelTags.includes(tagId)) {
                labelTags.splice(labelTags.indexOf(tag.tag_id), 1);
                svl.tracker.push('ContextMenu_TagAutoRemoved',
                    { tagId: tag.tag_id, tagName: tag.tag });
            }
        });
        return labelTags;
    }

    /**
     *
     * @param e
     */
    function handleTemporaryLabelCheckboxChange (e) {
        var checked = $(this).is(":checked"),
            label = getTargetLabel();
        svl.tracker.push('ContextMenu_CheckboxChange', { checked: checked });

        if (label) {
            label.setProperty('temporaryLabel', checked);
        }
    }

    /**
     * Hide the context menu
     * @returns {hide}
     */
    function hide() {
        if (isOpen()) {
            $descriptionTextBox.blur(); // force the blur event before the ContextMenu close event
            svl.tracker.push('ContextMenu_Close');
        }

        $menuWindow.css('visibility', 'hidden');
        $connector.css('visibility', 'hidden');
        setBorderColor('black');
        setStatus('visibility', 'hidden');
        return this;
    }

    /**
     * Unhide the context menu
     * @returns {hide}
     */
    function unhide() {
        $menuWindow.css('visibility', 'visible');
        if (lastShownLabelColor) {
            setBorderColor(lastShownLabelColor);
        }
        setStatus('visibility', 'visible');
        return this;
    }

    /**
     * Checks if the menu is open or not
     * @returns {boolean}
     */
    function isOpen() {
        return getStatus('visibility') === 'visible';
    }

    /**
     * Set the border color of the menu window
     * @param color
     */
    function setBorderColor(color) {
        $menuWindow.css('border-color', color);
        $connector.css('background-color', color);
    }

    /**
     * Sets a status
     * @param key
     * @param value
     * @returns {setStatus}
     */
    function setStatus (key, value) {
        status[key] = value;
        return this;
    }

    /**
     * Disable tagging. Adds the disabled visual effects to the
     * tags on current context menu.
     */
    function disableTagging() {
        setStatus('disableTagging', true);
        $("body").find("button[name=tag]").each(function(t) {
            $(this).addClass('disabled');
        });
    }

    /**
     * Enable tagging. Removes the disabled visual effects to the
     * tags on current context menu.
     */
    function enableTagging() {
        setStatus('disableTagging', false);
        $("body").find("button[name=tag]").each(function(t) {
            $(this).removeClass('disabled');
        });
    }

    /**
     * Returns true if tagging is currently disabled.
     */
    function isTagDisabled() {
        return getStatus('disableTagging');
    }

    /**
     * Sets the color of a label's tags based off of tags that were previously chosen.
     * @param label     Current label being modified.
     */
    function setTagColor(label) {
        var labelTags = label.getProperty('tagIds');
        $("body").find("button[name=tag]").each(function(t) {
            var buttonText = $(this).text();
            if (buttonText) {
                var tagId = parseInt($(this).attr('class').split(" ").filter(c => c.search(/tag-id-\d+/) > -1)[0].match(/\d+/)[0], 10);

                // Sets color to be white or gray if the label tag has been selected.
                if (labelTags.includes(tagId)) {
                    $(this).css('background-color', 'rgb(200, 200, 200)');
                } else {
                    $(this).css('background-color', 'white');
                }
            }
        });
    }

    /**
     * Sets the description and value of the tag based on the label type.
     * @param label Current label being modified.
     */
    function setTags(label) {
        var maxTags = 16;
        if (label) {
            var labelTags = self.labelTags;
            if (labelTags) {
                var count = 0;
                var tagHolder = getContextMenuUI().tagHolder;

                // Go through each label tag, modify each button to display tag.
                labelTags.forEach(function (tag) {
                    if (tag.label_type === label.getProperty('labelType')) {
                        var buttonIndex = count; // Save index in a separate var b/c tooltips are added asynchronously.

                        // Remove all leftover tags from last labeling.
                        // Warning to future devs: will remove any other classes you add to the tags.
                        tagHolder.find("button[id=" + buttonIndex + "]").attr('class', 'context-menu-tag');

                        // Add tag id as a class so that finding the element is easier later.
                        tagHolder.find("button[id=" + buttonIndex + "]").addClass("tag-id-" + tag.tag_id);

                        // Set tag texts to new underlined version as defined in the util label description map.
                        var tagText = util.misc.getLabelDescriptions(tag.label_type)['tagInfo'][tag.tag]['text'];
                        tagHolder.find("button[id=" + buttonIndex + "]").html(tagText);

                        tagHolder.find("button[id=" + buttonIndex + "]").css({
                            visibility: 'inherit',
                            position: 'inherit'
                        });

                        // Remove old tooltip for that button.
                        tagHolder.find("button[id=" + buttonIndex + "]").tooltip("destroy");

                        // Add tooltip with tag example if we have an example image to show.
                        var imageUrl = `/assets/javascripts/SVLabel/img/label_tag_popups/${tag.tag_id}.png`;
                        util.getImage(imageUrl).then(img => {
                            // Convert the first letter of tag text to uppercase and get keyboard shortcut character.
                            const underlineClassOffset = 15;
                            var keyChar;
                            var tooltipHeader;
                            // If first letter is used for shortcut, the string will start with "<tag-underline".
                            if (tagText[0] === '<') {
                                keyChar = tagText[underlineClassOffset];
                                tooltipHeader = tagText.substring(0,underlineClassOffset) +
                                    tagText[underlineClassOffset].toUpperCase() +
                                    tagText.substring(underlineClassOffset + 1);
                            } else {
                                let underlineIndex = tagText.indexOf('<');
                                keyChar = tagText[underlineIndex + underlineClassOffset];
                                tooltipHeader = tagText[0].toUpperCase() + tagText.substring(1);
                            }
                            var tooltipFooter = i18next.t('center-ui.context-menu.label-popup-shortcuts', {c: keyChar});
                            var tooltipImage = `<img src="${img}" height="125"/>`

                            // Create the tooltip.
                            tagHolder.find("button[id=" + buttonIndex + "]").tooltip(({
                                placement: 'top',
                                html: true,
                                delay: {"show": 300, "hide": 10},
                                height: '130',
                                title: `${tooltipHeader}<br/>${tooltipImage}<br/> <i>${tooltipFooter}</i>`
                            })).tooltip("show").tooltip("hide");
                        });

                        count += 1;
                    }
                });

                // If number of tags is less than the max number of tags, hide button.
                var i = count;
                for (i; i < maxTags; i++) {
                    $("body").find("button[id=" + i + "]").css({
                        visibility: 'hidden',
                        position: 'absolute',
                        top: '0px',
                        left: '0px'
                    });
                }
            }
        }
    }

    /**
     * Set context menu severity tooltips to the correct text/images for the given label type.
     *
     * @param labelType
     * @private
     */
    function _setSeverityTooltips(labelType) {
        var sevTooltipOne = $('#severity-one');
        var sevTooltipThree = $('#severity-three');
        var sevTooltipFive = $('#severity-five');
        var sevImgUrlOne = `/assets/javascripts/SVLabel/img/severity_popups/${labelType}_Severity1.png`
        var sevImgUrlThree = `/assets/javascripts/SVLabel/img/severity_popups/${labelType}_Severity3.png`
        var sevImgUrlFive = `/assets/javascripts/SVLabel/img/severity_popups/${labelType}_Severity5.png`

        // Remove old tooltips.
        sevTooltipOne.tooltip('destroy');
        sevTooltipThree.tooltip('destroy');
        sevTooltipFive.tooltip('destroy');

        // Add severity tooltips for the current label type if we have images for them.
        util.getImage(sevImgUrlOne).then(img => {
            var tooltipHeader = i18next.t('center-ui.context-menu.severity-example', { n: 1 });
            var tooltipFooter = `<i>${i18next.t('center-ui.context-menu.severity-shortcuts')}</i>`
            sevTooltipOne.tooltip({
                placement: "top", html: true, delay: {"show": 300, "hide": 10},
                title: `${tooltipHeader}<br/><img src=${img} height="110"/><br/>${tooltipFooter}`
            });
        });
        util.getImage(sevImgUrlThree).then(img => {
            var tooltipHeader = i18next.t('center-ui.context-menu.severity-example', { n: 3 });
            var tooltipFooter = `<i>${i18next.t('center-ui.context-menu.severity-shortcuts')}</i>`
            sevTooltipThree.tooltip({
                placement: "top", html: true, delay: {"show": 300, "hide": 10},
                title: `${tooltipHeader}<br/><img src=${img} height="110"/><br/>${tooltipFooter}`
            });
        });
        util.getImage(sevImgUrlFive).then(img => {
            var tooltipHeader = i18next.t('center-ui.context-menu.severity-example', { n: 5 });
            var tooltipFooter = `<i>${i18next.t('center-ui.context-menu.severity-shortcuts')}</i>`
            sevTooltipFive.tooltip({
                placement: "top", html: true, delay: {"show": 300, "hide": 10},
                title: `${tooltipHeader}<br/><img src=${img} height="110"/><br/>${tooltipFooter}`
            });
        });
    }

    /**
     * Show the context menu
     * @param x x-coordinate on the canvas pane
     * @param y y-coordinate on the canvas pane
     * @param param a parameter object
     */
    function show (x, y, param) {
        setStatus('targetLabel', null);
        $radioButtons.prop('checked', false);
        $temporaryLabelCheckbox.prop('checked', false);
        $descriptionTextBox.val(null);
        if (x && y && ('targetLabel' in param)) {
            var labelType = param.targetLabel.getLabelType();
            if (labelType !== 'Occlusion') {
                setStatus('targetLabel', param.targetLabel);
                setTags(param.targetLabel);
                setTagColor(param.targetLabel);
                if (getStatus('disableTagging')) { disableTagging(); }
                windowHeight = $('#context-menu-holder').outerHeight();

                // Determine coordinates for context menu when displayed below the label.
                var topCoordinate = y + 20;
                var connectorCoordinate = -5;

                // Determine coordinates for context menu when displayed above the label.
                if (y + windowHeight + 22 > 480) {
                    topCoordinate = y - windowHeight - 22;
                    connectorCoordinate = windowHeight;
                }

                if (param) {
                    if ('targetLabelColor' in param) {
                        setBorderColor(param.targetLabelColor);
                        lastShownLabelColor = param.targetLabelColor;
                    }
                }

                // Set the menu value if label has it's value set.
                var severity = param.targetLabel.getProperty('severity'),
                    temporaryLabel = param.targetLabel.getProperty('temporaryLabel'),
                    description = param.targetLabel.getProperty('description');
                if (severity) {
                    $radioButtons.each(function (i, v) {
                       if (severity === i + 1) { $(this).prop("checked", true); }
                    });
                }

                $temporaryLabelCheckbox.prop("checked", temporaryLabel);

                $menuWindow.css({
                    visibility: 'visible',
                    left: x - windowWidth / 2,
                    top: topCoordinate
                });

                $connector.css({
                    visibility: 'visible',
                    top: topCoordinate + connectorCoordinate,
                    left: x - 3
                });

                // Hide the severity menu for the Pedestrian Signal label type.
                if (labelType === 'Signal') {
                    $severityMenu.css({visibility: 'hidden', height: '0px'});
                } else {
                    $severityMenu.css({visibility: 'inherit', height: '50px'});
                }

                setStatus('visibility', 'visible');

                if (description) {
                    $descriptionTextBox.val(description);
                } else {
                    var defaultText = i18next.t('center-ui.context-menu.description');
                    $descriptionTextBox.prop("placeholder", defaultText);
                }
                var labelProperties = self.getTargetLabel().getProperties();

                // Don't push event on Occlusion labels; they don't open ContextMenus.
                svl.tracker.push('ContextMenu_Open', {'auditTaskId': labelProperties.audit_task_id}, {'temporaryLabelId': labelProperties.temporary_label_id});
            }
            if (labelType !== 'Occlusion' && labelType !== 'Signal') {
                self.updateRadioButtonImages();
                _setSeverityTooltips(labelType);
            }
        }
    }

    /**
     * Toggles the color of the tag when selected/deselected.
     * @param labelTags     List of tags that the current label has.
     * @param id
     * @param target        Tag button that is being modified.
     */
    function _toggleTagColor(labelTags, id, target) {
        if (labelTags.includes(id)) {
            target.style.backgroundColor = 'rgb(200, 200, 200)';
        } else {
            target.style.backgroundColor = "white";
        }
    }

    self.getContextMenuUI = getContextMenuUI;
    self.checkRadioButton = checkRadioButton;
    self.getTargetLabel = getTargetLabel;
    self.handleSeverityPopup = handleSeverityPopup;
    self.hide = hide;
    self.unhide = unhide;
    self.isOpen = isOpen;
    self.show = show;
    self.disableTagging = disableTagging;
    self.enableTagging = enableTagging;
    self.isTagDisabled = isTagDisabled;
    return self;
}

/**
 *
 * @param labelContainer
 * @param missionModel
 * @param missionContainer
 * @param navigationModel
 * @param panoramaContainer
 * @param taskContainer
 * @param mapService
 * @param compass
 * @param tracker
 * @param params
 * @returns {{className: string}}
 * @constructor
 */
function Form (labelContainer, missionModel, missionContainer, navigationModel, panoramaContainer, taskContainer, mapService, compass, tracker, params) {
    var self = this;
    let properties = {
        dataStoreUrl : undefined,
        beaconDataStoreUrl : undefined,
        lastPriorityUpdateTime : new Date().getTime() // Assumes that priorities are up-to-date when the page loads.
    };

    missionModel.on("MissionProgress:complete", function (parameters) {
        self.submitData(true);
    });

    /**
     * This method gathers all the data needed for submission.
     * @returns {{}}
     */
    this.compileSubmissionData = function (task) {
        var data = {};

        data.amt_assignment_id = svl.amtAssignmentId;

        var mission = missionContainer.getCurrentMission();
        var missionId = mission.getProperty("missionId");
        mission.updateDistanceProgress();
        data.mission = {
            mission_id: missionId,
            distance_progress: Math.min(mission.getProperty("distanceProgress"), mission.getProperty("distance")),
            completed: mission.getProperty("isComplete"),
            audit_task_id: task.getAuditTaskId(),
            skipped: mission.getProperty("skipped")
        };

        data.audit_task = {
            street_edge_id: task.getStreetEdgeId(),
            task_start: task.getProperty("taskStart").getTime(),
            audit_task_id: task.getAuditTaskId(),
            completed: task.isComplete(),
            current_lat: navigationModel.getPosition().lat,
            current_lng: navigationModel.getPosition().lng,
            start_point_reversed: task.getProperty("startPointReversed"),
            current_mission_start: task.getMissionStart(missionId),
            last_priority_update_time: properties.lastPriorityUpdateTime,
            // Request updated street priorities if we are at least 60% of the way through the current street.
            request_updated_street_priority: !svl.isOnboarding() && (task.getAuditedDistance() / task.lineDistance()) > 0.6
        };

        data.environment = {
            browser: util.getBrowser(),
            browser_version: util.getBrowserVersion(),
            browser_width: $(window).width(),
            browser_height: $(window).height(),
            screen_width: screen.width,
            screen_height: screen.height,
            avail_width: screen.availWidth,              // total width - interface (taskbar)
            avail_height: screen.availHeight,            // total height - interface };
            operating_system: util.getOperatingSystem(),
            language: i18next.language
        };

        data.interactions = tracker.getActions();
        tracker.refresh();

        data.labels = [];
        var labels = labelContainer.getCurrentLabels();
        for(var i = 0, labelLen = labels.length; i < labelLen; i += 1) {
            var label = labels[i];
            var prop = label.getProperties();
            var points = label.getPath().getPoints();
            var labelLatLng = label.toLatLng();
            var tempLabelId = label.getProperty('temporary_label_id');
            var auditTaskId = label.getProperty('audit_task_id');

            // If this label is a new label, get the timestamp of its creation from the corresponding interaction.
            var associatedInteraction = data.interactions.find(interaction =>
                interaction.action === 'LabelingCanvas_FinishLabeling' && interaction.temporary_label_id === tempLabelId
                && interaction.audit_task_id === auditTaskId);
            var timeCreated = associatedInteraction ? associatedInteraction.timestamp : null;

            var temp = {
                deleted : label.isDeleted(),
                label_id : label.getLabelId(),
                label_type : label.getLabelType(),
                photographer_heading : prop.photographerHeading,
                photographer_pitch : prop.photographerPitch,
                panorama_lat: prop.panoramaLat,
                panorama_lng: prop.panoramaLng,
                temporary_label_id: tempLabelId,
                audit_task_id: auditTaskId,
                gsv_panorama_id : prop.panoId,
                label_points : [],
                severity: label.getProperty('severity'),
                temporary: label.getProperty('temporaryLabel'),
                tag_ids: label.getProperty('tagIds'),
                description: label.getProperty('description') ? label.getProperty('description') : null,
                time_created: timeCreated,
                tutorial: prop.tutorial
            };

            for (var j = 0, pathLen = points.length; j < pathLen; j += 1) {
                var point = points[j],
                    gsvImageCoordinate = point.getGSVImageCoordinate(),
                    pointParam = {
                        sv_image_x : gsvImageCoordinate.x,
                        sv_image_y : gsvImageCoordinate.y,
                        canvas_x: point.originalCanvasCoordinate.x,
                        canvas_y: point.originalCanvasCoordinate.y,
                        heading: point.panoramaPov.heading,
                        pitch: point.panoramaPov.pitch,
                        zoom : point.panoramaPov.zoom,
                        canvas_height : prop.canvasHeight,
                        canvas_width : prop.canvasWidth,
                        alpha_x : prop.canvasDistortionAlphaX,
                        alpha_y : prop.canvasDistortionAlphaY,
                        lat : null,
                        lng : null
                    };

                if (labelLatLng) {
                    pointParam.lat = labelLatLng.lat;
                    pointParam.lng = labelLatLng.lng;
                    pointParam.computation_method = labelLatLng.latLngComputationMethod;
                }
                temp.label_points.push(pointParam);
            }

            data.labels.push(temp)
        }

        // Keep Street View meta data. This is particularly important to keep track of the date when the images were taken (i.e., the date of the accessibility attributes).
        data.gsv_panoramas = [];

        var temp;
        var panoramaData;
        var link;
        var links;
        var panoramas = panoramaContainer.getStagedPanoramas();
        for (var i = 0, panoramaLen = panoramas.length; i < panoramaLen; i++) {
            panoramaData = panoramas[i].data();
            links = [];
            if ("links" in panoramaData) {
                for (j = 0; j < panoramaData.links.length; j++) {
                    link = panoramaData.links[j];
                    links.push({
                        target_gsv_panorama_id: ("pano" in link) ? link.pano : "",
                        yaw_deg: ("heading" in link) ? link.heading : 0.0,
                        description: ("description" in link) ? link.description : ""
                    });
                }
            }
            temp = {
                panorama_id: ("location" in panoramaData && "pano" in panoramaData.location) ? panoramaData.location.pano : "",
                image_date: "imageDate" in panoramaData ? panoramaData.imageDate : "",
                image_width: panoramaData.tiles.worldSize.width,
                image_height: panoramaData.tiles.worldSize.height,
                tile_width: panoramaData.tiles.tileSize.width,
                tile_height: panoramaData.tiles.tileSize.height,
                links: links,
                copyright: "copyright" in panoramaData ? panoramaData.copyright : ""
            };
            data.gsv_panoramas.push(temp);
            panoramas[i].setProperty("submitted", true);
        }

        return data;
    };

    this._prepareSkipData = function (issueDescription) {
        var position = navigationModel.getPosition();
        return {
            issue_description: issueDescription,
            lat: position.lat,
            lng: position.lng
        };
    };

    this.skip = function (task, skipReasonLabel) {
        var data = self._prepareSkipData(skipReasonLabel);

        if (skipReasonLabel === "GSVNotAvailable") {
            taskContainer.endTask(task);
            missionContainer.getCurrentMission().pushATaskToTheRoute(task);
            util.misc.reportNoStreetView(task.getStreetEdgeId());
        } else {
            // Set the tasksMissionsOffset so that the mission progress bar remains the same after the jump.
            var currTaskDist = util.math.kilometersToMeters(taskContainer.getCurrentTaskDistance());
            var oldOffset = missionContainer.getTasksMissionsOffset();
            missionContainer.setTasksMissionsOffset(oldOffset + currTaskDist);
        }

        task.eraseFromMinimap();
        self.skipSubmit(data, task);

        // If the jump was clicked in the middle of the beforeJumpTask,
        // reset the beforeJump tracking parameters
        var jumpListenerStatus = mapService.getLabelBeforeJumpListenerStatus();
        if (jumpListenerStatus) {
            mapService.setLabelBeforeJumpListenerStatus(false);
            compass.resetBeforeJump();
            mapService.finishCurrentTaskBeforeJumping();
        }

        taskContainer.getFinishedAndInitNextTask(task);
    };

    /**
     * Submit the data collected so far and move to another location.
     *
     * @param dataIn An object that has issue_description, lat, and lng as fields.
     * @param task
     * @returns {boolean}
     */
    this.skipSubmit = function (dataIn, task) {
        tracker.push('TaskSkip');

        var data = self.compileSubmissionData(task);
        data.incomplete = dataIn;

        self.submit(data, task);
        return false;
    };

    /**
     * Submit the data via an AJAX post request.
     * @param data
     * @param task
     * @param async
     */
    this.submit = function (data, task, async) {
        if (typeof async === "undefined") { async = true; }
        if (data.constructor !== Array) { data = [data]; }

        if ('interactions' in data[0] && data[0].constructor === Array) {
            var action = tracker.create("TaskSubmit");
            data[0].interactions.push(action);
        }

        labelContainer.refresh();

        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: properties.dataStoreUrl,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                if (result) {
                    var taskId = result.audit_task_id;
                    task.setProperty("auditTaskId", taskId);
                    svl.tracker.setAuditTaskID(taskId);

                    // If the back-end says it is time to switch to validations, then do it immediately (mostly to
                    // prevent turkers from modifying JS variables to prevent switching to validation).
                    if (result.switch_to_validation) window.location.replace('/validate');

                    // If a new mission was sent and we aren't in onboarding, create an object for it on the front-end.
                    if (result.mission && !svl.isOnboarding()) missionModel.createAMission(result.mission);

                    // Update the priority of streets audited by other users that are auditing at the same time.
                    if (result.updated_streets) {
                        properties.lastPriorityUpdateTime = result.updated_streets.last_priority_update_time;
                        taskContainer.updateTaskPriorities(result.updated_streets.updated_street_priorities);
                    }
                }
            },
            error: function (result) {
                console.error(result);
            }
        });
    };

    properties.dataStoreUrl = params.dataStoreUrl;
    properties.beaconDataStoreUrl = params.beaconDataStoreUrl;

    $(window).on('beforeunload', function () {
        tracker.push("Unload");

        // // April 17, 2019
        // // What we want here is type: 'application/json'. Can't do that quite yet because the
        // // feature has been disabled, but we should switch back when we can.
        //
        // // For now, we send plaintext and the server converts it to actual JSON
        //
        // // Source for fix and ongoing discussion is here:
        // // https://bugs.chromium.org/p/chromium/issues/detail?id=490015
        var task = taskContainer.getCurrentTask();
        var data = [self.compileSubmissionData(task)];
        var jsonData = JSON.stringify(data);
        navigator.sendBeacon(properties.beaconDataStoreUrl, jsonData);
    });

    /**
     * Manually triggers form submission from other functions.
     * @param async     Whether data should be submitted asynchronously or not (if undefined,
     *                  then submits asynchronously by default)
     */
    this.submitData = function (async) {
        if (typeof async === "undefined") { async = true; }
        var task = taskContainer.getCurrentTask();
        var data = self.compileSubmissionData(task);
        self.submit(data, task, async);
    }
}

/**
 * Audio Effect module.
 * @returns {{className: string}}
 * @constructor
 */
function AudioEffect (gameEffectModel, uiSoundButton, fileDirectory, storage) {
    var self = { className: 'AudioEffect' };

    var _self = this;
    this._model = gameEffectModel;


    if (typeof Audio == "undefined") Audio = function HTMLAudioElement () {}; // I need this for testing as PhantomJS does not support HTML5 Audio.

    var audios = {
        drip: new Audio(fileDirectory + 'audio/drip.mp3'),
        success: new Audio(fileDirectory + 'audio/success.mp3')
    };
    audios.drip.volume = 0.25;
    audios.success.volume = 0.05;
    var blinkInterval;

    uiSoundButton.sound.on('click', toggleSound);

    this._model.on("loadAudio", function (parameter) {
        load(parameter.audioType);
    });

    this._model.on("play", function (parameter) {
        play(parameter.audioType);
    });

    this._model.on("playAudio", function (parameter) {
        play(parameter.audioType);
    });

    /**
     * Blink
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiSoundButton.sound.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Callback for button click
     */
    function toggleSound() {
        if (storage.get("muted"))
            unmute();
        else
            mute();
    }

    function mute() {
        uiSoundButton.soundIcon.addClass('hidden');
        uiSoundButton.muteIcon.removeClass('hidden');
        storage.set("muted", true);
    }

    function unmute() {
        uiSoundButton.muteIcon.addClass('hidden');
        uiSoundButton.soundIcon.removeClass('hidden');
        storage.set("muted", false);
    }

    /**
     * Load a sound effect.
     * @param name Name of the sound effect
     * @returns {load}
     */
    function load(name) {
        if (name in audios && typeof audios[name].load == "function") {
            audios[name].load();
        }
        return this;
    }

    /**
     * Play a sound effect
     * @param name Name of the sound effect
     * @returns {play}
     */
    function play (name) {
        if (name in audios && !storage.get("muted") && typeof audios[name].play == "function") {
            audios[name].play();
        }
        return this;
    }

    /**
     * Stop blinking the button
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        uiSoundButton.sound.removeClass("highlight-50");
    }

    // To add the appropriate style to the sound button based on the storage when the document is loaded
    if(storage.get("muted"))
        mute();
    else
        unmute();

    self.blink = blink;
    self.load = load;
    self.play = play;
    self.stopBlinking = stopBlinking;
    return self;
}

/**
 *
 * @constructor
 */
function GameEffectModel () {
    var self = this;
}
_.extend(GameEffectModel.prototype, Backbone.Events);

GameEffectModel.prototype.loadAudio = function (parameters) {
    this.trigger("loadAudio", parameters);
};

GameEffectModel.prototype.play = function (parameters) {
    this.trigger("play", parameters);
};

GameEffectModel.prototype.playAudio = function (parameters) {
    this.trigger("playAudio", parameters);
};
/**
 * A Keyboard module.
 *

 * @returns {{className: string}}
 * @constructor
 */
function Keyboard (svl, canvas, contextMenu, googleMap, ribbon, zoomControl) {
    var self = this;

    /**
     * fix for the shift-getting-stuck bug.
     * this is a documented issue, see here:
     * https://stackoverflow.com/questions/11225694/why-are-onkeyup-events-not-firing-in-javascript-game
     * essentially what's going on is that JS sometimes fires a final keydown after a keyup.
     * (usually happens when multiple events are fired)
     * so the log would look like keydown:shift, keydown: shift, keyup: shift, keydown: shift.
     * To fix this, we note the last time that shift was let go, then
     * ignore any keydown events that were made BEFORE shift was let go, but are executing AFTER.
     *
     * also, we added a buffer to the z key to fix inconsistent behavior when shift and z were pressed at the same time.
     * sometimes, the shift up was detected before the z up. Adding the 100ms buffer fixed this issue.
     */
    var lastShiftKeyUpTimestamp = new Date(0).getTime();
    var status = {
        focusOnTextField: false,
        isOnboarding: false,
        shiftDown: false,
        disableKeyboard: false,
        moving: false,
        disableMovement: false
    };

    this.disableKeyboard = function (){
        status.disableKeyboard = true;
    };
    this.enableKeyboard = function (){
        status.disableKeyboard = false;
    };
    // Move in the direction of a link closest to a given angle.
    // Todo: Get rid of dependency to svl.panorama. Inject a streetViewMap into this module and use its interface.
    // Todo. Make the method name more descriptive.
    this._movePano = function (angle) {
        if (googleMap.getStatus("disableWalking")) return;
        // take the cosine of the difference for each link to the current heading in radians and stores them to an array
        var cosines = svl.panorama.links.map(function(link) {
            var headingAngleOffset = util.math.toRadians(svl.panorama.pov.heading + angle) - util.math.toRadians(link.heading);
            return Math.cos(headingAngleOffset);
        });
        var maxVal = Math.max.apply(null, cosines);
        var maxIndex = cosines.indexOf(maxVal);
        if(cosines[maxIndex] > 0.5){
            var panoramaId = svl.panorama.links[maxIndex].pano;
            googleMap.setPano(panoramaId);
            return true;
        } else {
            return false;
        }
    };

    /*
       Move user in specific angle relative to current view for a specific moveTime.
     */
    function timedMove(angle, moveTime){
        if (status.moving || svl.popUpMessage.getStatus("isVisible")){
            svl.panorama.set("linksControl", false);
            return;
        }
        svl.contextMenu.hide();
        svl.ui.canvas.deleteIconHolder.css("visibility", "hidden");
        var moveSuccess = self._movePano(angle);
        if (moveSuccess) {
            //prevent user input of walking commands
            svl.map.timeoutWalking();
            //restore user ability to walk after param moveTime
            setTimeout(svl.map.resetWalking, moveTime);
            //additional check to hide arrows after the fact
            //pop-up may become visible during timeout period
            if (svl.popUpMessage.getStatus('isVisible')){
                svl.panorama.set('linksControl', false);//disable arrows
            }
        }
    }

    this._moveForward = function (){
        timedMove(0, svl.map.getMoveDelay());
    };

    this._moveBackward = function (){
        timedMove(180, svl.map.getMoveDelay());
    };



    /**
     * Change the heading of the current panorama point of view by a particular degree value
     * Todo. Change the method name so it is more descriptive.
     * @param degree
     */
    this._rotatePov = function (degree){
        if (!svl.map.getStatus("disablePanning")){
            svl.contextMenu.hide();
            //panning hide label tag and delete icon
            var labels = svl.labelContainer.getCanvasLabels(),
                labelLen = labels.length;
            for (var i=0; i<labelLen; i++){
                labels[i].setTagVisibility('hidden');
                labels[i].resetTagCoordinate();
            }
            svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
            var heading =  svl.panorama.pov.heading;
            var pitch = svl.panorama.pov.pitch;
            var zoom = svl.panorama.pov.zoom;
            heading = (heading + degree + 360) % 360;
            var pov = svl.map.restrictViewPort({
                heading: heading,
                pitch: pitch,
                zoom: zoom
            });
            svl.panorama.setPov({heading: pov.heading, pitch: pov.pitch, zoom: pov.zoom});
        }
    };

    /**
     * This is a callback for a key down event
     * @param {object} e An event object
     * @private
     */
    this._documentKeyDown = function (e) {
        // Prevent Google's default panning and moving using arrow keys and WASD.
        // https://stackoverflow.com/a/66069717/9409728
        if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(e.code) > -1) {
            e.stopPropagation();
        }

        if (!status.focusOnTextField && !status.disableKeyboard) {
            // Only set shift if the event was made after the keyup.
            if (e.timeStamp > lastShiftKeyUpTimestamp) {
                status.shiftDown = e.shiftKey;
            }
        }

        if (!status.disableKeyboard && !status.focusOnTextField) {
            if (contextMenu.isOpen()) {
                var label;
                if (e.keyCode >= 49 && e.keyCode <= 53) {
                    const severity = e.keyCode - 48; // "1" - "5"
                    contextMenu.checkRadioButton(severity);
                    label = contextMenu.getTargetLabel();
                    if (label) {
                        label.setProperty('severity', severity);
                        svl.tracker.push("KeyboardShortcut_Severity_" + severity, {
                            keyCode: e.keyCode
                        });
                        svl.canvas.clear().render2();
                    }
                }
            } else {
                switch (e.keyCode) {
                    case 37:  // "ArrowLeft"
                        self._rotatePov(-2);
                        break;
                    case 39:  // "ArrowRight"
                        self._rotatePov(2);
                        break;
                }
                if (!status.disableMovement) {
                    switch (e.keyCode) {
                        case 38: // "ArrowUp"
                            self._moveForward();
                            break;
                        case 40:  // "ArrowDown"
                            self._moveBackward();
                            break;
                    }
                }
            }
        }
    };

    /**
     * This is a callback for a key up event when focus is not on ContextMenu's textbox.
     * @param {object} e An event object
     * @private
     */
    this._documentKeyUp = function (e) {
        if (!status.disableKeyboard) {
            status.shiftDown = e.shiftKey;
            if (!status.focusOnTextField) {
                // e: Walk, c: CurbRamp, m: NoCurbRamp, o: Obstacle, s: SurfaceProblem: n: NoSidewalk, w: Crosswalk,
                // p: Signal, b: Occlusion
                for (const mode of ['Walk', 'CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'NoSidewalk', 'Crosswalk', 'Signal', 'Occlusion']) {
                    if (e.key.toUpperCase() === util.misc.getLabelDescriptions(mode)['keyChar']) {
                        if (mode !== 'Walk') _closeContextMenu(e.keyCode);
                        ribbon.modeSwitch(mode);
                        svl.tracker.push("KeyboardShortcut_ModeSwitch_" + mode, {
                            keyCode: e.keyCode
                        });
                    }
                }
                switch(e.keyCode) {
                    // Zoom Hotkeys
                    case 16: // Shift
                        // Store the timestamp here so that we can check if the z-up event is in the buffer range.
                        lastShiftKeyUpTimestamp = e.timeStamp;
                        break;
                    case 90:
                        if (contextMenu.isOpen()) {
                            svl.tracker.push("KeyboardShortcut_CloseContextMenu");
                            contextMenu.hide();
                        }
                        // "z" for zoom. By default, it will zoom in. If "shift" is down, it will zoom out.
                        // if shift was down w/in 100 ms of the z up, then it will also zoom out.
                        // This is to catch the scenarios where shift up is detected before the z up.
                        if (status.shiftDown || (e.timeStamp - lastShiftKeyUpTimestamp) < 100) {
                            // Zoom out
                            zoomControl.zoomOut();
                            svl.tracker.push("KeyboardShortcut_ZoomOut", {
                                keyCode: e.keyCode
                            });
                        } else {
                            // Zoom in
                            zoomControl.zoomIn();
                            svl.tracker.push("KeyboardShortcut_ZoomIn", {
                                keyCode: e.keyCode
                            });
                        }
                }

                // Hotkeys for tag selection.
                if (contextMenu.getTargetLabel() != null && contextMenu.isOpen() && !contextMenu.isTagDisabled()) {
                    var labelType = contextMenu.getTargetLabel().getProperty('labelType');
                    var tags = contextMenu.labelTags.filter(tag => tag.label_type === labelType);
                    for (const tag of tags) {
                        if (e.key.toUpperCase() === util.misc.getLabelDescriptions(labelType)['tagInfo'][tag.tag]['keyChar']) {
                            $('.tag-id-' + tag.tag_id).first().trigger("click", {lowLevelLogging: false});
                        }
                    }
                }
            }

            switch (e.keyCode) {
                case 13:
                    // "Enter"
                    if(contextMenu.isOpen()) {
                        svl.tracker.push("KeyboardShortcut_CloseContextMenu");
                        contextMenu.handleSeverityPopup();
                        svl.tracker.push("ContextMenu_ClosePressEnter");
                        contextMenu.hide();
                    }
                    break;
                case 27:
                    // "Escape"
                    if(contextMenu.isOpen()) {
                        svl.tracker.push("KeyboardShortcut_CloseContextMenu");
                        svl.tracker.push("ContextMenu_CloseKeyboardShortcut");
                        contextMenu.hide();
                    }

                    if (canvas.getStatus('drawing')) {
                        canvas.cancelDrawing();
                        svl.tracker.push("KeyboardShortcut_CancelDrawing");
                    } else {
                        ribbon.backToWalk();
                    }
                    svl.modalExample.hide();
                    break;
            }

            contextMenu.updateRadioButtonImages();
        }
    };

    function _closeContextMenu(key) {
        if (contextMenu.isOpen()) {
            svl.tracker.push("KeyboardShortcut_CloseContextMenu");
            svl.tracker.push("ContextMenu_CloseKeyboardShortcut", {
                keyCode: key
            });
            contextMenu.hide();
        }
    }


    /**
     * Get status
     * @param {string} key Field name
     * @returns {*}
     */
    this.getStatus = function  (key) {
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    };

    /**
     * Set status
     * @param key Field name
     * @param value Field value
     * @returns {setStatus}
     */
    this.setStatus = function (key, value) {
        if (key in status) {
            status[key] = value;
        }
    };


    // Add the keyboard event listeners. We need { capture: true } for keydown to disable StreetView's shortcuts.
    window.addEventListener('keydown', this._documentKeyDown, { capture: true });
    window.addEventListener('keyup', this._documentKeyUp);
}

/**
 * A Label module.
 * @param svl
 * @param pathIn
 * @param params
 * @returns {*}
 * @constructor
 * @memberof svl
 */
function Label (svl, pathIn, params) {
    var self = { className: 'Label' };

    var path, googleMarker;

    // Parameters determined from a series of linear regressions. Here links to the analysis and relevant Github issues:
    // https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2374
    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2362
    var LATLNG_ESTIMATION_PARAMS = {
        1: {
            headingIntercept: -51.2401711,
            headingCanvasXSlope: 0.1443374,
            distanceIntercept: 18.6051843,
            distanceSvImageYSlope: 0.0138947,
            distanceCanvasYSlope: 0.0011023
        },
        2: {
            headingIntercept: -27.5267447,
            headingCanvasXSlope: 0.0784357,
            distanceIntercept: 20.8794248,
            distanceSvImageYSlope: 0.0184087,
            distanceCanvasYSlope: 0.0022135
        },
        3: {
            headingIntercept: -13.5675945,
            headingCanvasXSlope: 0.0396061,
            distanceIntercept: 25.2472682,
            distanceSvImageYSlope: 0.0264216,
            distanceCanvasYSlope: 0.0011071
        }
    };

    var properties = {
        canvasWidth: undefined,
        canvasHeight: undefined,
        canvasDistortionAlphaX: undefined,
        canvasDistortionAlphaY: undefined,
        labelerId : 'DefaultValue',
        labelId: 'DefaultValue',
        missionId: undefined,
        labelType: undefined,
        labelDescription: undefined,
        labelFillStyle: undefined,
        labelLat: undefined,
        labelLng: undefined,
        latLngComputationMethod: undefined,
        panoId: undefined,
        panoramaLat: undefined,
        panoramaLng: undefined,
        panoramaHeading: undefined,
        panoramaPitch: undefined,
        panoramaZoom: undefined,
        photographerHeading: undefined,
        photographerPitch: undefined,
        svImageWidth: undefined,
        svImageHeight: undefined,
        svMode: undefined,
        tagHeight: 20,
        tagIds: [],
        tagWidth: 1,
        tagX: -1,
        tagY: -1,
        severity: null,
        tutorial: null,
        temporary_label_id: null,
        temporaryLabel: false,
        description: null
    };

    var status = {
        deleted : false,
        tagVisibility : 'visible',
        visibility : 'visible'
    };

    var lock = {
        tagVisibility: false,
        visibility : false
    };

    var tagProperties = util.misc.getSeverityDescription();

    function _init (param, pathIn) {
            if (!pathIn) {
                throw 'The passed "path" is empty.';
            } else {
                path = pathIn;
            }

            for (var attrName in param) {
                properties[attrName] = param[attrName];
            }

            // Set belongs to of the path.
            path.setBelongsTo(self);

            if (param && param.labelType && typeof google !== "undefined" && google && google.maps) {
                googleMarker = createMinimapMarker(param.labelType);
                googleMarker.setMap(svl.map.getMap());
            }
    }

    /**
     * Blink (highlight and fade) the color of this label. If fade is true, turn the label into gray.
     * @param numberOfBlinks
     * @param fade
     * @returns {blink}
     */
    function blink (numberOfBlinks, fade) {
        if (!numberOfBlinks) {
            numberOfBlinks = 3;
        } else if (numberOfBlinks < 0) {
            numberOfBlinks = 0;
        }
        var interval;
        var highlighted = true;
        var path = getPath();
        var points = path.getPoints();

        var i;
        var len = points.length;

        var fillStyle = 'rgba(200,200,200,0.1)';
        var fillStyleHighlight = path.getFillStyle();

        interval = setInterval(function () {
            if (numberOfBlinks > 0) {
                if (highlighted) {
                    highlighted = false;
                    path.setFillStyle(fillStyle);
                    for (i = 0; i < len; i++) {
                        points[i].setFillStyle(fillStyle);
                    }
                    svl.canvas.clear().render2();
                } else {
                    highlighted = true;
                    path.setFillStyle(fillStyleHighlight);
                    for (i = 0; i < len; i++) {
                        points[i].setFillStyle(fillStyleHighlight);
                    }
                    svl.canvas.clear().render2();
                    numberOfBlinks -= 1;
                }
            } else {
                if (fade) {
                    path.setFillStyle(fillStyle);
                    for (i = 0; i < len; i++) {
                        points[i].setFillStyle(fillStyle);
                    }
                    svl.canvas.clear().render2();
                }

                setAlpha(0.05);
                svl.canvas.clear().render2();
                window.clearInterval(interval);
            }
        }, 500);

        return this;
    }

    /**
     * This method creates a Google Maps marker.
     * https://developers.google.com/maps/documentation/javascript/markers
     * https://developers.google.com/maps/documentation/javascript/examples/marker-remove
     * @returns {google.maps.Marker}
     */
    function createMinimapMarker (labelType) {
        if (typeof google !== "undefined") {
            var latlng = toLatLng();
            var googleLatLng = new google.maps.LatLng(latlng.lat, latlng.lng);

            var imagePaths = util.misc.getIconImagePaths(),
                url = imagePaths[labelType].minimapIconImagePath;

            return new google.maps.Marker({
                position: googleLatLng,
                map: svl.map.getMap(),
                title: "Hi!",
                icon: url,
                size: new google.maps.Size(20, 20)
            });
        }
    }

    /**
     * This method changes the fill color of the path and points that constitute the path.
     * @param fillColor
     * @returns {fill}
     */
    function fill (fillColor) {
        var path = getPath(), points = path.getPoints(), len = points.length;
        path.setFillStyle(fillColor);
        for (var i = 0; i < len; i++) { points[i].setFillStyle(fillColor); }
        return this;
    }

    /**
     * This method returns the bounding box of the label's outline.
     * @param pov
     * @returns {*}
     */
    function getBoundingBox (pov) {
        return path.getBoundingBox(pov);
    }

    /**
     * This function returns the coordinate of a point.
     * @returns {*}
     */
    function getCoordinate () {
        if (path && path.points.length > 0) {
            var pov = svl.map.getPov();
            return $.extend(true, {}, path.points[0].getCanvasCoordinate(pov));
        }
        return path;
    }

    /**
     * This function return the coordinate of a point in the GSV image coordinate.
     * @returns {*}
     */
    function getGSVImageCoordinate () {
        if (path && path.points.length > 0) {
            return path.points[0].getGSVImageCoordinate();
        }
    }

    /**
     * This function returns labelId property
     * @returns {string}
     */
    function getLabelId () {
        return properties.labelId;
    }

    /**
     * This function returns labelType property
     * @returns {*}
     */
    function getLabelType () { return properties.labelType; }

    /**
     * This function returns panoId property
     * @returns {*}
     */
    function getPanoId () { return properties.panoId; }

    /**
     * This function returns the coordinate of a point.
     * If reference is true, return a reference to the path instead of a copy of the path
     * @param reference
     * @returns {*}
     */
    function getPath (reference) {
        if (path) {
            return reference ? path : $.extend(true, {}, path);
        }
        return false;
    }

    /**
     * This function returns the coordinate of the first point in the path.
     * @returns {*}
     */
    function getPoint () { return (path && path.points.length > 0) ? path.points[0] : path; }

    /**
     * This function returns the point objects that constitute the path
     * If reference is set to true, return the reference to the points
     * @param reference
     * @returns {*}
     */
    function getPoints (reference) { return path ? path.getPoints(reference) : false; }

    /**
     * This method returns the pov of this label
     * @returns {{heading: Number, pitch: Number, zoom: Number}}
     */
    function getLabelPov () {
        var heading, pitch = parseInt(properties.panoramaPitch, 10),
            zoom = parseInt(properties.panoramaZoom, 10),
            points = getPoints(),
            svImageXs = points.map(function(point) { return point.svImageCoordinate.x; }),
            labelSvImageX;

        if (svImageXs.max() - svImageXs.min() > (svl.svImageWidth / 2)) {
            svImageXs = svImageXs.map(function (x) {
                if (x < (svl.svImageWidth / 2)) {
                    x += svl.svImageWidth;
                }
                return x;
            });
            labelSvImageX = parseInt(svImageXs.mean(), 10) % svl.svImageWidth;
        } else {
            labelSvImageX = parseInt(svImageXs.mean(), 10);
        }
        heading = parseInt((labelSvImageX / svl.svImageWidth) * 360, 10) % 360;

        return {
            heading: parseInt(heading, 10),
            pitch: pitch,
            zoom: zoom
        };
    }

    /**
     * Return deep copy of properties obj, so one can only modify props from setProperties() (not yet implemented).
     * JavaScript Deepcopy
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties () { return $.extend(true, {}, properties); }

    /**
     * Get a property
     * @param propName
     * @returns {boolean}
     */
    function getProperty (propName) { return (propName in properties) ? properties[propName] : false; }

    /**
     * Get a status
     * @param key
     * @returns {*}
     */
    function getStatus (key) {
        return status[key];
    }

    function getVisibility () { return status.visibility; }

    /**
     * This method changes the fill color of the path and points to orange.
     */
    function highlight () { return fill('rgba(255,165,0,0.8)'); }

    /**
     * Check if the label is deleted
     * @returns {boolean}
     */
    function isDeleted () { return status.deleted; }


    /**
     * Check if a path is under a cursor
     * @param x
     * @param y
     * @returns {boolean}
     */
    function isOn (x, y) {
        if (status.deleted || status.visibility === 'hidden') {  return false; }
        var result = path.isOn(x, y);
        return result ? result : false;
    }

    /**
     * This method returns the visibility of this label.
     * @returns {boolean}
     */
    function isVisible () {
        return status.visibility === 'visible';
    }

    /**
     * Lock tag visibility
     * @returns {lockTagVisibility}
     */
    function lockTagVisibility () {
        lock.tagVisibility = true;
        return this;
    }

    /**
     * Lock visibility
     * @returns {lockVisibility}
     */
    function lockVisibility () {
        lock.visibility = true;
        return this;
    }

    /**
     * Remove the label (it does not actually remove, but hides the label and set its status to 'deleted').
     */
    function remove () {
        setStatus('deleted', true);
        setStatus('visibility', 'hidden');
    }

    /**
     * This function removes the path and points in the path.
     */
    function removePath () {
        path.removePoints();
        path = undefined;
    }

    /**
     * This method renders this label on a canvas.
     * @param ctx
     * @param pov
     * @returns {self}
     */
    function render(ctx, pov) {
        if (!status.deleted && status.visibility === 'visible') {
            // Render a tag -- triggered by mouse hover event.
            // Get a text to render (e.g, attribute type), and canvas coordinate to render the tag.
            if(status.tagVisibility === 'visible') {
                renderTag(ctx);
                // path.renderBoundingBox(ctx);
                showDelete();
            }

            // Renders the label image.
            path.render2(ctx, pov);

            // Draws label outline.
            ctx.lineWidth = .7;
            ctx.beginPath();
            ctx.arc(getCoordinate().x, getCoordinate().y, 15.3, 0, 2 * Math.PI);
            ctx.strokeStyle = 'black';
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(getCoordinate().x, getCoordinate().y, 16.2, 0, 2 * Math.PI);
            ctx.strokeStyle = 'white';
            ctx.stroke();

            // Only render severity warning if there's a severity option.
            if (properties.labelType !== 'Occlusion' && properties.labelType !== 'Signal') {
                if (properties.severity === null) {
                    showSeverityAlert(ctx);
                }
            }
        }

        // Show a label on the google maps pane.
        if (!isDeleted()) {
            if (googleMarker && !googleMarker.map) {
                googleMarker.setMap(svl.map.getMap());
            }
        } else {
            if (googleMarker && googleMarker.map) {
                googleMarker.setMap(null);
            }
        }
        return this;
    }

    /**
     * This function renders a tag on a canvas to show a property of the label.
     *
     * NOTE "tag" here means the box that is shown when hovering over a label. This doesn't refer to tags for a label.
     * @param ctx
     * @returns {boolean}
     */
    function renderTag(ctx) {
        if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
            return false;
        }

        // labelCoordinate represents the upper left corner of the tag.
        var labelCoordinate = getCoordinate(),
            cornerRadius = 3,
            hasSeverity = (properties.labelType !== 'Occlusion' && properties.labelType !== 'Signal'),
            i, height,
            width = 0,
            labelRows = 1,
            severityImage = new Image(),
            severityImagePath = undefined,
            severityMessage = i18next.t('center-ui.context-menu.severity'),
            msg = i18next.t(util.camelToKebab(properties.labelType) + '-description'),
            messages = msg.split('\n'),
            padding = { left: 12, right: 5, bottom: 0, top: 18 };

        if (hasSeverity) {
            labelRows = 2;
            if (properties.severity !== null) {
                severityImagePath = tagProperties[properties.severity].severityImage;
                severityImage.src = severityImagePath;
                severityMessage = tagProperties[properties.severity].message;
            }
        }

        if (properties.labelerId !== 'DefaultValue') {
            messages.push('Labeler: ' + properties.labelerId);
        }

        // Set rendering properties and draw a tag.
        ctx.save();
        ctx.font = '13px Open Sans';

        height = properties.tagHeight * labelRows;

        for (i = 0; i < messages.length; i += 1) {
            // Width of the tag is determined by the width of the longest row.
            var firstRow = ctx.measureText(messages[i]).width;
            var secondRow = -1;

            // Do additional adjustments on tag width to make room for smiley icon.
            if (hasSeverity) {
                secondRow = ctx.measureText(severityMessage).width;
                if (severityImagePath != undefined) {
                    if (firstRow - secondRow > 0 && firstRow - secondRow < 15) {
                        width += 15 - firstRow + secondRow;
                    } else if (firstRow - secondRow < 0) {
                        width += 20;
                    }
                }
            }

            width += Math.max(firstRow, secondRow) + 5;
        }
        properties.tagWidth = width;

        ctx.lineCap = 'square';
        ctx.lineWidth = 2;
        ctx.fillStyle = util.misc.getLabelColors(getProperty('labelType'));
        ctx.strokeStyle = 'rgba(255,255,255,1)';


        // Tag background
        ctx.beginPath();
        ctx.moveTo(labelCoordinate.x + cornerRadius, labelCoordinate.y);
        ctx.lineTo(labelCoordinate.x + width + padding.left + padding.right - cornerRadius, labelCoordinate.y);
        ctx.arc(labelCoordinate.x + width + padding.left + padding.right, labelCoordinate.y + cornerRadius, cornerRadius, 3 * Math.PI / 2, 0, false); // Corner
        ctx.lineTo(labelCoordinate.x + width + padding.left + padding.right + cornerRadius, labelCoordinate.y + height + padding.bottom);
        ctx.arc(labelCoordinate.x + width + padding.left + padding.right, labelCoordinate.y + height + cornerRadius, cornerRadius, 0, Math.PI / 2, false); // Corner
        ctx.lineTo(labelCoordinate.x + cornerRadius, labelCoordinate.y + height + 2 * cornerRadius);
        ctx.arc(labelCoordinate.x + cornerRadius, labelCoordinate.y + height + cornerRadius, cornerRadius, Math.PI / 2, Math.PI, false);
        ctx.lineTo(labelCoordinate.x, labelCoordinate.y + cornerRadius);
        ctx.fill();
        ctx.stroke();
        ctx.closePath();

        // Tag text and image
        ctx.fillStyle = '#ffffff';
        ctx.fillText(messages[0], labelCoordinate.x + padding.left, labelCoordinate.y + padding.top);
        if (hasSeverity) {
            ctx.fillText(severityMessage, labelCoordinate.x + padding.left, labelCoordinate.y + properties.tagHeight + padding.top);
            if (properties.severity !== null) {
              ctx.drawImage(severityImage, labelCoordinate.x + padding.left + ctx.measureText(severityMessage).width + 5, labelCoordinate.y + 25, 16, 16);
            }
        }

        ctx.restore();
    }

    /**
     * This method turn the fill color of associated Path and Points into their original color.
     * @returns {resetFillStyle}
     */
    function resetFillStyle () {
        var path = getPath(), points = path.getPoints(),
            i, len = points.length;
        path.resetFillStyle();
        for (i = 0; i < len; i++) {
            points[i].resetFillStyle();
        }
        return this;
    }

    /**
     * This function sets properties.tag.x and properties.tag.y to 0
     * @returns {resetTagCoordinate}
     */
    function resetTagCoordinate () {
        properties.tagX = 0;
        properties.tagY = 0;
        return this;
    }

    /**
     * This method changes the alpha channel of the fill color of the path and points that constitute the path.
     * @param alpha
     * @returns {setAlpha}
     */
    function setAlpha (alpha) {
        var path = getPath(),
            points = path.getPoints(),
            len = points.length,
            fillColor = path.getFill();
        alpha = alpha ? alpha : 0.3;
        fillColor = util.color.changeAlphaRGBA(fillColor, alpha);
        path.setFillStyle(fillColor);
        for (var i = 0; i < len; i++) {
            points[i].setFillStyle(fillColor);
        }
        return this;
    }

    /**
     * This function sets the icon path of the point this label holds.
     * @param iconPath
     * @returns {*}
     */
    function setIconPath (iconPath) {
        if (path && path.points[0]) {
            var point = path.points[0];
            point.setIconPath(iconPath);
            return this;
        }
        return false;
    }

    /**
     * Set the labeler id
     * @param labelerIdIn
     * @returns {setLabelerId}
     */
    function setLabelerId (labelerIdIn) {
        properties.labelerId = labelerIdIn;
        return this;
    }

    /**
     * Sets a property
     * @param key
     * @param value
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Set status
     * @param key
     * @param value
     */
    function setStatus (key, value) {
        if (key in status) {
            if (key === 'visibility' && (value === 'visible' || value === 'hidden')) {
                setVisibility(value);
            } else if (key === 'tagVisibility' && (value === 'visible' || value === 'hidden')) {
                setTagVisibility(value);
            } else if (key === 'deleted' && typeof value === 'boolean') {
                status[key] = value;
            } else if (key === 'severity') {
                status[key] = value;
            }
        }
    }

    /**
     * Set the visibility of the tag
     * @param visibility {string} visible or hidden
     * @returns {setTagVisibility}
     */
    function setTagVisibility (visibility) {
        if (!lock.tagVisibility) {
            if (visibility === 'visible' || visibility === 'hidden') {
                status['tagVisibility'] = visibility;
            }
        }
        return this;
    }

    /**
     * This function sets the sub label type of this label. E.g. for a NoCurbRamp there are "Missing Curb Ramp"
     * @param labelType
     * @returns {setSubLabelDescription}
     */
    function setSubLabelDescription (labelType) {
        var labelDescriptions = util.misc.getLabelDescriptions();
        properties.labelProperties.subLabelDescription = labelDescriptions[labelType].text;
        return this;
    }

    /**
     * Set this label's visibility to the passed visibility
     * @param visibility
     * @param labelerIds
     * @param included
     * @returns {setVisibilityBasedOnLabelerId}
     */
    function setVisibilityBasedOnLabelerId (visibility, labelerIds, included) {
        if (included === undefined) {
            if (labelerIds.indexOf(properties.labelerId) !== -1) {
                unlockVisibility().setVisibility(visibility).lockVisibility();
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                unlockVisibility().setVisibility(visibility).lockVisibility();
            }
        } else {
            if (included) {
                if (labelerIds.indexOf(properties.labelerId) !== -1) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            } else {
                if (labelerIds.indexOf(properties.labelerId) === -1) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            }
        }

        return this;
    }

    /**
     * Set the visibility of the label
     * @param visibility
     * @returns {setVisibility}
     */
    function setVisibility (visibility) {
        if (!lock.visibility) { status.visibility = visibility; }
        return this;
    }

    /**
     * Set visibility of labels
     * @param visibility
     * @param panoramaId
     * @returns {setVisibilityBasedOnLocation}
     */
    function setVisibilityBasedOnLocation (visibility, panoramaId) {
        if (!status.deleted) {
            if (panoramaId === properties.panoId) {
                setVisibility(visibility);
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                setVisibility(visibility);
            }
        }
        return this;
    }

    /**
     *
     * @param visibility
     * @param tables
     * @param included
     */
    function setVisibilityBasedOnLabelerIdAndLabelTypes (visibility, tables, included) {
        var tablesLen = tables.length, matched = false;

        for (var i = 0; i < tablesLen; i += 1) {
            if (tables[i].userIds.indexOf(properties.labelerId) !== -1) {
                if (tables[i].labelTypesToRender.indexOf(properties.labelProperties.labelType) !== -1) {
                    matched = true;
                }
            }
        }
        if (included === undefined) {
            if (matched) {
                unlockVisibility().setVisibility(visibility).lockVisibility();
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                unlockVisibility().setVisibility(visibility).lockVisibility();
            }
        } else {
            if (included) {
                if (matched) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            } else {
                if (!matched) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            }
        }
    }

    /**
     * Show the delete button
     */
    function showDelete() {
        if (status.tagVisibility !== 'hidden') {
            var boundingBox = path.getBoundingBox(),
                x = boundingBox.x + boundingBox.width - 20,
                y = boundingBox.y;

            // Show a delete button.
            $("#delete-icon-holder").css({
                visibility: 'visible',
                left : x + 25, // + width - 5,
                top : y - 20
            });
        }
    }

    /**
     * Renders a question mark if a label has an unmarked severity
     * @param ctx   Rendering tool for severity (2D context)
     */
    function showSeverityAlert(ctx) {
        var labelCoordinate = getCoordinate();
        var x = labelCoordinate.x;
        var y = labelCoordinate.y;

        // Draws circle
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = 'rgb(160, 45, 50, 0.9)';
        ctx.ellipse(x - 15, y - 10.5, 8, 8, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.closePath();

        // Draws text
        ctx.beginPath();
        ctx.font = "12px Open Sans";
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.fillText('?', x - 17.5, y - 6);
        ctx.closePath();
        ctx.restore();
    }

    /**
     * Get the label latlng position
     * @returns {labelLatLng}
     */
    function toLatLng() {
        if (!properties.labelLat) {
            // Estimate the latlng point from the camera position and the heading angle when the point cloud data is not available.
            var panoLat = getProperty("panoramaLat");
            var panoLng = getProperty("panoramaLng");
            var panoHeading = getProperty("panoramaHeading");
            var zoom = getProperty("panoramaZoom");
            var canvasX = getPath().getPoints()[0].originalCanvasCoordinate.x;
            var canvasY = getPath().getPoints()[0].originalCanvasCoordinate.y;
            var svImageY = getPath().getPoints()[0].getGSVImageCoordinate().y;

            // Estimate heading diff and distance from pano using output from a regression analysis.
            // https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
            var estHeadingDiff =
                LATLNG_ESTIMATION_PARAMS[zoom].headingIntercept +
                LATLNG_ESTIMATION_PARAMS[zoom].headingCanvasXSlope * canvasX;
            var estDistanceFromPanoKm = Math.max(0,
                LATLNG_ESTIMATION_PARAMS[zoom].distanceIntercept +
                LATLNG_ESTIMATION_PARAMS[zoom].distanceSvImageYSlope * svImageY +
                LATLNG_ESTIMATION_PARAMS[zoom].distanceCanvasYSlope * canvasY
            ) / 1000.0;
            var estHeading = panoHeading + estHeadingDiff;
            var startPoint = turf.point([panoLng, panoLat]);

            // Use the pano location, distance from pano estimate, and heading estimate, calculate label location.
            var destination = turf.destination(startPoint, estDistanceFromPanoKm, estHeading, { units: 'kilometers' });
            var latlng = {
                lat: destination.geometry.coordinates[1],
                lng: destination.geometry.coordinates[0],
                latLngComputationMethod: 'approximation2'
            };
            setProperty('labelLat', latlng.lat);
            setProperty('labelLng', latlng.lng);
            setProperty('latLngComputationMethod', latlng.latLngComputationMethod);
            return latlng;
        } else {
            // Return the cached value.
            return {
                lat: getProperty('labelLat'),
                lng: getProperty('labelLng'),
                latLngComputationMethod: getProperty('latLngComputationMethod')
            };
        }

    }

    /**
     * Unlock status.visibility
     * @returns {unlockVisibility}
     */
    function unlockVisibility () {
        lock.visibility = false;
        return this;
    }

    /**
     * Unlock status.tagVisibility
     * @returns {unlockTagVisibility}
     */
    function unlockTagVisibility () {
        lock.tagVisibility = false;
        return this;
    }

    self.resetFillStyle = resetFillStyle;
    self.blink = blink;
    self.getBoundingBox = getBoundingBox;
    self.getGSVImageCoordinate = getGSVImageCoordinate;
    self.getLabelId = getLabelId;
    self.getLabelType = getLabelType;
    self.getPanoId = getPanoId;
    self.getPath = getPath;
    self.getPoint = getPoint;
    self.getPoints = getPoints;
    self.getLabelPov = getLabelPov;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getstatus = getStatus;
    self.getVisibility = getVisibility;
    self.fill = fill;
    self.isDeleted = isDeleted;
    self.isOn = isOn;
    self.isVisible = isVisible;
    self.highlight = highlight;
    self.lockTagVisibility = lockTagVisibility;
    self.lockVisibility = lockVisibility;
    self.removePath = removePath;
    self.render = render;
    self.remove = remove;
    self.resetTagCoordinate = resetTagCoordinate;
    self.setAlpha = setAlpha;
    self.setIconPath = setIconPath;
    self.setLabelerId = setLabelerId;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.setTagVisibility = setTagVisibility;
    self.setSubLabelDescription = setSubLabelDescription;
    self.setVisibility = setVisibility;
    self.setVisibilityBasedOnLocation = setVisibilityBasedOnLocation;
    self.setVisibilityBasedOnLabelerId = setVisibilityBasedOnLabelerId;
    self.setVisibilityBasedOnLabelerIdAndLabelTypes = setVisibilityBasedOnLabelerIdAndLabelTypes;
    self.unlockTagVisibility = unlockTagVisibility;
    self.unlockVisibility = unlockVisibility;
    self.toLatLng = toLatLng;

    _init(params, pathIn);
    return self;
}

/**
 * Label Container module. This is responsible for storing the label objects that were created in the current session.
 * @param $ jQuery object
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelContainer($) {
    var self = this;
    var currentCanvasLabels = {};
    var prevCanvasLabels = {};

    this.countLabels = function() {
        var allLabels = self.getCurrentLabels().concat(self.getPreviousLabels());
        return allLabels.filter(l => { return !l.isDeleted(); }).length;
    };

    this.fetchLabelsToResumeMission = function (regionId, callback) {
        $.getJSON('/label/resumeMission', { regionId: regionId }, function (result) {
            let labelArr = result.labels;
            let len = labelArr.length;
            for (let i = 0; i < len; i++) {
                let povChange = svl.map.getPovChangeStatus();

                // Temporarily change pov change status to true so that we can use util function to calculate the canvas
                // coordinate to place label upon rerender. This is so the labels appear in the correct location
                // relative to the initial POV.
                povChange["status"] = true;

                let originalCanvasCoord = {
                    x: labelArr[i].canvasX,
                    y: labelArr[i].canvasY
                };

                let originalPov = {
                    heading: labelArr[i].panoramaHeading,
                    pitch: labelArr[i].panoramaPitch,
                    zoom: labelArr[i].panoramaZoom
                };

                let originalPointPov = {
                    originalPov: util.panomarker.calculatePointPov(labelArr[i].canvasX, labelArr[i].canvasY, originalPov)
                };

                let rerenderCanvasCoord = util.panomarker.getCanvasCoordinate(
                    originalCanvasCoord, originalPointPov.originalPov, svl.map.getPov()
                );

                // Return the status to original.
                povChange["status"] = false;

                let iconImagePath = util.misc.getIconImagePaths(labelArr[i].labelType).iconImagePath;
                let labelFillStyle = util.misc.getLabelColors()[labelArr[i].labelType].fillStyle;

                var pointParameters = {
                    'originalPov': originalPointPov.originalPov,
                    'fillStyleInnerCircle': labelFillStyle,
                    'iconImagePath': iconImagePath,
                    'radiusInnerCircle': 17,
                    'radiusOuterCircle': 14
                };

                let labelPoint = new Point(
                    svl, rerenderCanvasCoord.x, rerenderCanvasCoord.y, svl.map.getPov(), pointParameters
                );

                let path = new Path(svl, [labelPoint]);
                let label = svl.labelFactory.create(path, labelArr[i]);
                label.setProperty("audit_task_id", labelArr[i].audit_task_id);
                label.setProperty("labelLat", labelArr[i].labelLat);
                label.setProperty("labelLng", labelArr[i].labelLng);
                label.setProperty("labelFillStyle", labelFillStyle);

                // Prevent tag from being rendered initially
                label.setTagVisibility('hidden');

                if (!(label.getPanoId() in prevCanvasLabels)) {
                    prevCanvasLabels[label.getPanoId()] = [];
                }

                prevCanvasLabels[label.getPanoId()].push(label);
            }

            if (callback) callback(result);
        });
    }

    /**
     * Returns canvas labels of the current pano ID.
     */
    this.getCanvasLabels = function () {
        let panoId = svl.map.getPanoId();
        let prev = prevCanvasLabels[panoId] ? prevCanvasLabels[panoId] : [];
        let curr = currentCanvasLabels[panoId] ? currentCanvasLabels[panoId] : [];
        return prev.concat(curr);
    };

    /**
     * Get current labels.
     * Note that this grabs labels from all panoIds in current session.
     */
    this.getCurrentLabels = function () {
        return Object.keys(currentCanvasLabels).reduce(function (r, k) {
            return r.concat(currentCanvasLabels[k]);
        }, []);
    };

    /**
     * Get previous labels.
     * Note that this grabs labels from all panoIds in current session.
     */
    this.getPreviousLabels = function () {
        return Object.keys(prevCanvasLabels).reduce(function (r, k) {
            return r.concat(prevCanvasLabels[k]);
        }, []);
    };

    // Find most recent instance of label with matching temporary ID.
    this.findLabelByTempId = function (tempId) {
        var matchingLabels =  _.filter(svl.labelContainer.getCanvasLabels(),
            function(label) {
                return label.getProperty("temporary_label_id") === tempId;
            });

        if (matchingLabels.length === 0) {
            return null;
        }

        // Returns most recent version of label.
        return matchingLabels[matchingLabels.length - 1];
    };

    // Remove old versions of this label, add updated label.
    this.addUpdatedLabel = function (tempId) {
        // All labels that don't have the specified tempId reduced to an array.
        var otherLabels = _.filter(this.getCurrentLabels(),
            function(label) {
                return label.getProperty("temporary_label_id") !== tempId;
            });

        // If there are no temporary labels with this ID in currentCanvasLabels then add it to that list.
        // Otherwise get rid of all old instances in currentCanvasLabels and add the updated label.

        var match = this.findLabelByTempId(tempId);

        // Label with this id doesn't exist in currentCanvasLabels as the
        // filtered vs unfiltered arrays are the same length.
        if (otherLabels.length === this.getCurrentLabels().length) {
            if (!(match.getPanoId() in currentCanvasLabels)) {
                currentCanvasLabels[match.getPanoId()] = [];
            }
            // Add updated label.
            currentCanvasLabels[match.getPanoId()].push(match);
        } else {
            for (let key in currentCanvasLabels) {
                currentCanvasLabels[key] = currentCanvasLabels[key].filter(label => label.getProperty("temporary_label_id") !== tempId);
            }
            if (match !== null) {
                if (!(match.getPanoId() in currentCanvasLabels)) {
                    currentCanvasLabels[match.getPanoId()] = [];
                }
                // Add updated label.
                currentCanvasLabels[match.getPanoId()].push(match);
            }
        }
    };

    /**
     * Push a label into canvasLabels
     * @param label
     */
    this.push = function (label) {
        if (!(label.getPanoId() in currentCanvasLabels)) {
            currentCanvasLabels[label.getPanoId()] = [];
        }

        currentCanvasLabels[label.getPanoId()].push(label);
        svl.labelCounter.increment(label.getProperty("labelType"));

        // Keep pano metadata, esp the date when the StreetView img was taken to keep track of when the problem existed.
        var panoramaId = label.getProperty("panoId");
        if ("panoramaContainer" in svl && svl.panoramaContainer && panoramaId && !svl.panoramaContainer.getPanorama(panoramaId)) {
            svl.panoramaContainer.fetchPanoramaMetaData(panoramaId);
        }
    };

    /** Refresh */
    this.refresh = function () {
        for (let key in currentCanvasLabels) {
            if (!(key in prevCanvasLabels)) {
                prevCanvasLabels[key] = currentCanvasLabels[key];
            } else {
                for (var i = 0; i < currentCanvasLabels[key].length; i++) {
                    // Remove any old versions of the label and add the new one.
                    var currLabel = currentCanvasLabels[key][i];
                    prevCanvasLabels[key] = prevCanvasLabels[key].filter(function (l) {
                        return l.getProperty("temporary_label_id") !== currLabel.getProperty("temporary_label_id");
                    });
                    prevCanvasLabels[key].push(currLabel);
                }
            }
        }
        currentCanvasLabels = {};
    };

    /**
     * This function removes a passed label, updates the canvas, and updates label counts.
     * @method
     */
    this.removeLabel = function (label) {
        if (!label) { return false; }
        svl.tracker.push('RemoveLabel', {labelType: label.getProperty('labelType')});
        svl.labelCounter.decrement(label.getProperty("labelType"));
        label.remove();
        svl.canvas.clear();
        svl.canvas.render();
        return this;
    };
}

/**
 * LabelFactory module.
 * @param svl Todo. Try to get rid of svl dependency
 * @param nextTemporaryLabelId
 * @constructor
 */
function LabelFactory (svl, nextTemporaryLabelId) {
    var temporaryLabelId = nextTemporaryLabelId ? nextTemporaryLabelId : 1;

    this.create = function (path, param) {
        if (path) {
            var label = new Label(svl, path, param);
            if (label) {
                if (!('labelId' in param)) {
                    var currentTask = svl.taskContainer.getCurrentTask();
                    label.setProperty("audit_task_id", currentTask.getAuditTaskId());
                    label.setProperty("temporary_label_id", temporaryLabelId);
                    temporaryLabelId++;
                }
                return label;
            }
        } else {
            path = new Path(svl, [new Point(svl, 0, 0, {}, {})]);
            return new Label(svl, path, param);
        }
    };
}
/**
 * Path module. A Path instance holds and array of Point instances.
 * @param svl
 * @param points
 * @param params
 * @returns {{className: string, points: undefined}}
 * @constructor
 * @memberof svl
 */
function Path (svl, points, params) {
    var self = { className : 'Path', points : undefined };
    var parent;
    var properties = {
        fillStyle: 'rgba(255,255,255,0.5)',
        lineCap : 'round', // ['butt','round','square']
        lineJoin : 'round', // ['round','bevel','miter']
        lineWidth : '3',
        numPoints: points.length,
        originalFillStyle: 'rgba(255,255,255,0.5)',
        originalStrokeStyle: 'rgba(255,255,255,1)',
        strokeStyle : 'rgba(255,255,255,1)',
        strokeStyle_bg : 'rgba(255,255,255,1)' //potentially delete
    };
    var status = {
        visibility: 'visible'
    };

    function _init(points, params) {
        var lenPoints;
        var i;
        self.points = points;
        lenPoints = points.length;

        // Set belongs to of the points
        for (i = 0; i < lenPoints; i += 1) {
            points[i].setBelongsTo(self);
        }

        if (params) {
            for (var attr in params) {
                if (attr in properties) {
                    properties[attr] = params[attr];
                }
            }
        }
        properties.fillStyle = util.color.changeAlphaRGBA(points[0].getProperty('fillStyleInnerCircle'), 0.5);
        properties.originalFillStyle = properties.fillStyle;
        properties.originalStrokeStyle = properties.strokeStyle;
    }

    /**
     * This method returns the Label object that this path belongs to.
     * @returns {object|null} Label object.
     */
    function belongsTo () {
        return parent ? parent : null;
    }

    /**
     * This function checks if a mouse cursor is on any of a points and return
     * @param povIn
     * @returns {{x: number, y: number, width: number, height: number}}
     */
    function getBoundingBox(povIn) {
        var pov = povIn ? povIn : svl.map.getPov();
        var canvasCoords = getCanvasCoordinates(pov);
        var xMin, xMax, yMin, yMax, width, height;
        if (points.length > 2) {
            xMax = -1;
            xMin = 1000000;
            yMax = -1;
            yMin = 1000000;

            for (var j = 0; j < canvasCoords.length; j += 1) {
                var coord = canvasCoords[j];
                if (coord.x < xMin) { xMin = coord.x; }
                if (coord.x > xMax) { xMax = coord.x; }
                if (coord.y < yMin) { yMin = coord.y; }
                if (coord.y > yMax) { yMax = coord.y; }
            }
            width = xMax - xMin;
            height = yMax - yMin;
        } else {
            xMin = canvasCoords[0].x;
            yMin = canvasCoords[0].y;
            // xMin = points[0].getCanvasCoordinate(pov);
            // yMin = points[0].getCanvasCoordinate(pov);
            width = 0;
            height = 0;
        }

        return { x: xMin, y: yMin, width: width, height: height };
    }

    /**
     * Returns fill color of the path
     * @returns {string}
     */
    function getFill() {
        return properties.fillStyle;
    }

    /**
     * Get canvas coordinates of points that constitute the path
     * using the new label rendering algorithm
     * @param pov
     * @returns {Array}
     */

    function getCanvasCoordinates(pov) {
        var points = getPoints();
        var i;
        var len = points.length;
        var canvasCoord;
        var canvasCoords = [];

        for (i = 0; i < len; i += 1) {
            canvasCoord = points[i].calculateCanvasCoordinate(pov);
            canvasCoords.push(canvasCoord);
        }
        return canvasCoords;
    }

    /**
     * Returns the line width
     * @returns {string}
     */
    function getLineWidth () {
        return properties.lineWidth;
    }

    /**
     * This function returns points.
     */
    function getPoints (reference) {
        if (!reference) {
            reference = false;
        }

        if (reference) {
            // return self.points;
            return points;
        } else {
            // return $.extend(true, [], self.points);
            return $.extend(true, [], points);
        }
    }

    /**
     * This method returns a property
     * @param key The field name of the property
     * @returns {*}
     */
    function getProperty (key) {
        return properties[key];
    }

    /**
     * This method returns the status of the field
     * @param key {string} The field name
     */
    function getStatus (key) {
        return status[key];
    }

    /**
     * This function checks if a mouse cursor is on any of a points and return a point if the cursor is indeed on the
     * point. Otherwise, this function checks if the mouse cursor is on a bounding box of this path. If the cursor is
     * on the bounding box, then this function returns this path object.
     * @param x
     * @param y
     * @returns {*}
     */
    function isOn (x, y) {
        var boundingBox, j, point, pointsLen, result;

        // Check if the passed point (x, y) is on any of points.
        pointsLen = self.points.length;
        for (j = 0; j < pointsLen; j += 1) {
            point = self.points[j];
            result = point.isOn(x, y);
            if (result) {
                return result;
            }
        }

        // Check if the passed point (x, y) is on a path bounding box
        boundingBox = getBoundingBox();
        if (boundingBox.x < x &&
            boundingBox.x + boundingBox.width > x &&
            boundingBox.y < y &&
            boundingBox.y + boundingBox.height > y) {
            return this;
        } else {
            return false;
        }
    }

    /**
     * This method remove all the points in the list points.
     */
    function removePoints () {
        self.points = undefined;
    }

    /**
     * This method renders a path.
     * @param pov
     * @param ctx
     */
    function render (pov, ctx) {
        if (status.visibility === 'visible') {
            var j, pathLen, point, currCoord, prevCoord;

            pathLen = self.points.length;

            // Get canvas coordinates to render a path.
            var canvasCoords = getCanvasCoordinates(pov);

            // Set the fill color
            point = self.points[0];
            ctx.save();
            ctx.beginPath();
            if (!properties.fillStyle) {
                properties.fillStyle = util.color.changeAlphaRGBA(point.getProperty('fillStyleInnerCircle'), 0.5);
                properties.originalFillStyle = properties.fillStyle;
                ctx.fillStyle = properties.fillStyle;
            } else {
                ctx.fillStyle = properties.fillStyle;
            }

            if (pathLen > 1) {
                // Render fill
                ctx.moveTo(canvasCoords[0].x, canvasCoords[0].y);
                for (j = 1; j < pathLen; j += 1) {
                    ctx.lineTo(canvasCoords[j].x, canvasCoords[j].y);
                }
                ctx.lineTo(canvasCoords[0].x, canvasCoords[0].y);
                ctx.fill();
                ctx.closePath();
                ctx.restore();
            }

            /**
             * This is the main part for the current sidewalk.umiacs.umd.edu
             * interface
             */
            // Start
            // Render points
            for (j = 0; j < pathLen; j += 1) {
                point = self.points[j];
                point.render(pov, ctx);
            }
            // End of the main part

            if (pathLen > 1) {
                // Render segments
                for (j = 0; j < pathLen; j += 1) {
                    if (j > 0) {
                        currCoord = canvasCoords[j];
                        prevCoord = canvasCoords[j - 1];
                    } else {
                        currCoord = canvasCoords[j];
                        prevCoord = canvasCoords[pathLen - 1];
                    }
                    var r = point.getProperty('radiusInnerCircle');
                    ctx.save();
                    ctx.strokeStyle = properties.strokeStyle;
                    util.shape.lineWithRoundHead(ctx, prevCoord.x, prevCoord.y, r, currCoord.x, currCoord.y, r);
                    ctx.restore();
                }
            }
        }
    }

    function render2 (ctx, pov) {
        return render(pov, ctx);
    }

    /**
     * This method renders a bounding box around a path.
     * @param ctx
     */
    function renderBoundingBox (ctx) {
        // This function takes a bounding box returned by a method getBoundingBox()
        var boundingBox = getBoundingBox();

        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,1)';
        ctx.beginPath();
        ctx.moveTo(boundingBox.x, boundingBox.y);
        ctx.lineTo(boundingBox.x + boundingBox.width, boundingBox.y);
        ctx.lineTo(boundingBox.x + boundingBox.width, boundingBox.y + boundingBox.height);
        ctx.lineTo(boundingBox.x, boundingBox.y + boundingBox.height);
        ctx.lineTo(boundingBox.x, boundingBox.y);
        ctx.stroke();
        ctx.closePath();
        ctx.restore();
    }
    
    /**
     * This method changes the value of fillStyle to its original fillStyle value
     * @returns {self}
     */
    function resetFillStyle () {
        properties.fillStyle = properties.originalFillStyle;
        return this;
    }

    /**
     * This method resets the strokeStyle to its original value
     * @returns {self}
     */
    function resetStrokeStyle () {
        properties.strokeStyle = properties.originalStrokeStyle;
        return this;
    }

    /**
     * This method sets the parent object
     * @param obj
     * @returns {setBelongsTo}
     */
    function setBelongsTo (obj) {
        parent = obj;
        return this;
    }

    /**
     * Sets fill color of the path
     * @param fill
     */
    function setFill(fill) {
        if(fill.substring(0,4) == 'rgba'){
            properties.fillStyle = fill;
        } else{
            fill = 'rgba'+fill.substring(3,fill.length-1)+',0.5)';
            properties.fillStyle = fill;
        }
        return this;
    }

    function setFillStyle (fill) {
        // This method sets the fillStyle of the path
        if(fill!=undefined){
            properties.fillStyle = fill;
        }
        return this;
    }

    /**
     * This method sets the line width.
     * @param lineWidth {number} Line width
     * @returns {setLineWidth}
     */
    function setLineWidth (lineWidth) {
        if(!isNaN(lineWidth)){
            properties.lineWidth  = '' + lineWidth;
        }
        return this;
    }

    /**
     * This method sets the strokeStyle of the path
     * @param stroke {string} Stroke style
     * @returns {setStrokeStyle}
     */
    function setStrokeStyle (stroke) {
        properties.strokeStyle = stroke;
        return this;
    }

    /**
     * This method sets the visibility of a path
     * @param visibility {string} Visibility (visible or hidden)
     * @returns {setVisibility}
     */
    function setVisibility (visibility) {
        if (visibility === 'visible' || visibility === 'hidden') status.visibility = visibility;
        return this;
    }

    self.belongsTo = belongsTo;
    self.getBoundingBox = getBoundingBox;
    self.getLineWidth = getLineWidth;
    self.getFill = getFill;
    self.getPoints = getPoints;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.isOn = isOn;
    self.removePoints = removePoints;
    self.render2 = render2;
    self.render = render;
    self.renderBoundingBox = renderBoundingBox;
    self.resetFillStyle = resetFillStyle;
    self.resetStrokeStyle = resetStrokeStyle;
    self.setFill = setFill;
    self.setBelongsTo = setBelongsTo;
    self.setLineWidth = setLineWidth;
    self.setFillStyle = setFillStyle;
    self.setStrokeStyle = setStrokeStyle;
    self.setVisibility = setVisibility;

    // Initialize
    _init(points, params);

    return self;
}

/**
 *
 * @param svl
 * @param x
 * @param y
 * @param pov
 * @param params
 * @returns {{className: string, svImageCoordinate: undefined, canvasCoordinate: undefined, originalCanvasCoordinate: undefined, pov: undefined, originalPov: undefined}}
 * @constructor
 */
function Point (svl, x, y, pov, params) {
    'use strict';

    if(params.fillStyle==undefined){
        params.fillStyle = 'rgba(255,255,255,0.5)';
    }
    var self = {
            className : 'Point',
            svImageCoordinate : undefined,
            canvasCoordinate : undefined,
            originalCanvasCoordinate : undefined,
            pov : undefined,
            originalPov : undefined,
            panoramaPov : undefined
        };
    var belongsTo;
    var properties = {
        fillStyleInnerCircle: params.fillStyle,
        iconImagePath: undefined,
        originalFillStyleInnerCircle: undefined,
        radiusInnerCircle: 17,
        radiusOuterCircle: 14
    };
    var status = {
            'deleted' : false,
            'visibility' : 'visible',
            'visibilityIcon' : 'visible'
    };

    function _init (x, y, pov, params) {
        // Keep the original canvas coordinate and canvas pov just in case.
        self.canvasCoordinate = {
            x : x,
            y : y
        };
        self.originalCanvasCoordinate = {
            x : x,
            y : y
        };
        self.panoramaPov = {
            heading: pov.heading,
            pitch: pov.pitch,
            zoom: pov.zoom
        };

        // Calculate the POV of the label
        var pointPOV;
        if (!jQuery.isEmptyObject(pov)){
            pointPOV = calculatePointPov(x, y, pov);
        }
        else {
            pointPOV = pov;
        }

        self.pov = {
            heading : pointPOV.heading,
            pitch : pointPOV.pitch,
            zoom : pointPOV.zoom
        };

        if (params.originalPov) {
            self.originalPov = params.originalPov;
        } else {
            self.originalPov = {
                heading: pointPOV.heading,
                pitch: pointPOV.pitch,
                zoom: pointPOV.zoom
            };
        }

        // Convert a canvas coordinate (x, y) into a sv image coordinate
        // Note, svImageCoordinate.x varies from 0 to svImageWidth and
        // svImageCoordinate.y varies from -(svImageHeight/2) to svImageHeight/2.

        var svImageWidth = svl.svImageWidth;
        // var svImageHeight = svl.svImageHeight;

        // Adjust the zoom level
        /* old calculation
        var zoom = pov.zoom;
        var zoomFactor = svl.zoomFactor[zoom];
        self.svImageCoordinate = {};
        self.svImageCoordinate.x = svImageWidth * pov.heading / 360 + (svl.alpha_x * (x - (svl.canvasWidth / 2)) / zoomFactor);
        self.svImageCoordinate.y = (svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (y - (svl.canvasHeight / 2)) / zoomFactor);
        // svImageCoordinate.x could be negative, so adjust it.
        if (self.svImageCoordinate.x < 0) {
            self.svImageCoordinate.x = self.svImageCoordinate.x + svImageWidth;
        }
        */

        var svImageCoord = util.panomarker.calculateImageCoordinateFromPointPov(self.originalPov);

        if (svImageCoord.x < 0) {
            svImageCoord.x = svImageCoord.x + svImageWidth;
        }
        self.svImageCoordinate = svImageCoord;

        // Set properties
        for (var propName in properties) {
            // It is ok if iconImagePath is not specified
            if(propName === "iconImagePath") {
                if (params.iconImagePath) {
                    properties.iconImagePath = params.iconImagePath;
                } else {
                    continue;
                }
            }

            if (propName in params) {
                properties[propName] = params[propName];
            }
        }

        properties.originalFillStyleInnerCircle = properties.fillStyleInnerCircle;
        return true;
    }

    /** Get x canvas coordinate */
    function getCanvasX () { return self.canvasCoordinate.x; }

    /** Get y canvas coordinate */
    function getCanvasY () { return self.canvasCoordinate.y; }

    /** return the fill color of this point */
    function getFill () { return properties.fillStyleInnerCircle; }

    /** Get POV
     * This method returns the pov of this label
     * @returns {{heading: Number, pitch: Number, zoom: Number}}
     */

    function getPOV () {
        return $.extend(true, {}, self.pov);
    }

    /** Get the initial pov */
    function getOriginalPov(){
        return $.extend(true, {}, self.originalPov);
    }

    /** Returns an object directly above this object. */
    function getParent () { return belongsTo ? belongsTo : null; }

    /**
     * Get the fill style.
     * @returns {*}
     */
    function getFillStyle () { return  getFill(); }

    function getCanvasCoordinate () { return $.extend(true, {}, self.canvasCoordinate); }

    function getGSVImageCoordinate () { return $.extend(true, {}, self.svImageCoordinate); }

    function getProperty (name) { return (name in properties) ? properties[name] : null; }

    function getProperties () { return $.extend(true, {}, properties); }

    function isOn (x, y) {
        var margin = properties.radiusOuterCircle / 2 + 3;
        if (x < self.canvasCoordinate.x + margin &&
            x > self.canvasCoordinate.x - margin &&
            y < self.canvasCoordinate.y + margin &&
            y > self.canvasCoordinate.y - margin) {
            return this;
        } else {
            return false;
        }
    }

    function calculateCanvasCoordinate(pov){
        var canvasCoord = getCanvasCoordinate();
        var origPov = getOriginalPov();
        self.canvasCoordinate =  util.panomarker.getCanvasCoordinate(canvasCoord, origPov, pov);
        return self.canvasCoordinate;
    }

    function calculatePointPov(x, y, pov){
        return util.panomarker.calculatePointPov(x, y, pov);
    }

    /**
     * Renders label image icon
     * @param pov
     * @param ctx
     */
    function render (pov, ctx) {
        if (status.visibility === 'visible') {
            var coord = calculateCanvasCoordinate(pov),
                x = coord.x,
                y = coord.y,
                r = properties.radiusInnerCircle;

            // Update the new pov of the label
            if (coord.x < 0){
                self.pov = {};
            }
            else {
                self.pov = calculatePointPov(coord.x, coord.y, pov);
            }

            // ctx.arc(x, y, properties.radiusOuterCircle, 2 * Math.PI, 0, true);

            // Render an icon
            var imagePath = getProperty("iconImagePath");
            if (imagePath) {
                var imageObj, imageHeight, imageWidth, imageX, imageY;
                imageObj = new Image();
                imageHeight = imageWidth = 2 * r - 3;
                imageX =  x - r + 2;
                imageY = y - r + 2;

                imageObj.src = imagePath;

                try {
                    ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);
                } catch (e) {
                    // console.debug(e);
                }

                //ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);
            }
            ctx.restore();
        }
    }

    /**
     * This method reverts the fillStyle property to its original value
     * @returns {resetFillStyle}
     */
    function resetFillStyle () {
        properties.fillStyleInnerCircle = properties.originalFillStyleInnerCircle;
        return this;
    }

    /**
     * Set the svImageCoordinate
     * @param coord
     * @returns {self}
     */
    function resetSVImageCoordinate (coord) {
        self.svImageCoordinate = coord;
        self.canvasCoordinate = {x : 0, y: 0};
        return this;
    }

    /**
     * This function sets which object (Path)
     * @param obj
     * @returns {self}
     */
    function setBelongsTo (obj) {
        belongsTo = obj;
        return this;
    }

    /**
     * This method sets the fill style of inner circle to the specified value
     * @param value
     * @returns {self}
     */
    function setFillStyle (value) {
        properties.fillStyleInnerCircle = value;
        return this;
    }

    function setIconPath (iconPath) {
        properties.iconImagePath = iconPath;
        return this;
    }

    /**
     * this method sets the photographerHeading and photographerPitch
     * @param heading
     * @param pitch
     * @returns {self}
     */
    function setPhotographerPov (heading, pitch) {
        properties.photographerHeading = heading;
        properties.photographerPitch = pitch;
        return this;
    }

    function setVisibility(visibility) {
        // This method sets the visibility of a path (and points that cons
        if (visibility === 'visible' || visibility === 'hidden') {
            status.visibility = visibility;
        }
        return this;
    }

    self.belongsTo = getParent;
    self.calculateCanvasCoordinate = calculateCanvasCoordinate;
    self.getCanvasX = getCanvasX;
    self.getCanvasY = getCanvasY;
    self.getCanvasCoordinate = getCanvasCoordinate;
    self.getPOV = getPOV;
    self.getOriginalPov = getOriginalPov;
    self.getFill = getFill;
    self.getFillStyle = getFillStyle;
    self.getGSVImageCoordinate = getGSVImageCoordinate;
    self.getProperty = getProperty;
    self.getProperties = getProperties;
    self.isOn = isOn;
    self.render = render;
    self.resetFillStyle = resetFillStyle;
    self.resetSVImageCoordinate = resetSVImageCoordinate;
    self.setBelongsTo = setBelongsTo;
    self.setFillStyle = setFillStyle;
    self.setIconPath = setIconPath;
    self.setPhotographerPov = setPhotographerPov;
    self.setVisibility = setVisibility;

    _init(x, y, pov, params);
    return self;
}

function LeftMenu (menuModel) {
    var self = this;
}
/**
 * Mission module
 * Todo. Needs clean up
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Mission(parameters) {
    var self = this;
    var properties = {
            missionId: null,
            missionType: null,
            regionId: null,
            isComplete: false,
            pay: null,
            paid: null,
            distance: null,
            distanceProgress: null,
            skipped: false
        },
        _tasksForTheMission = [],
        labelCountsAtCompletion;

    function _init(parameters) {
        if ("missionId" in parameters) setProperty("missionId", parameters.missionId);
        if ("missionType" in parameters) setProperty("missionType", parameters.missionType);
        if ("regionId" in parameters) setProperty("regionId", parameters.regionId);
        if ("isComplete" in parameters) setProperty("isComplete", parameters.isComplete);
        if ("pay" in parameters) setProperty("pay", parameters.pay);
        if ("paid" in parameters) setProperty("paid", parameters.paid);
        if ("distance" in parameters) setProperty("distance", parameters.distance);
        if ("distanceProgress" in parameters) setProperty("distanceProgress", parameters.distanceProgress);
        if ("skipped" in parameters) setProperty("skipped", parameters.skipped);
    }

    /**
     * Set the isComplete property to true.
     */
    function complete() {
        // Play the animation and audio effect after task completion.

        setProperty("isComplete", true);

        // Set distanceProgress to be at most the distance for the mission, subtract the difference from the offset.
        if (getProperty("missionType") === "audit") {
            var distanceOver = getProperty("distanceProgress") - getProperty("distance");
            var oldOffset = svl.missionContainer.getTasksMissionsOffset();
            var newOffset = oldOffset - distanceOver;
            svl.missionContainer.setTasksMissionsOffset(newOffset);
        }

        // Reset the label counter
        if ('labelCounter' in svl) {
            labelCountsAtCompletion = {
                "CurbRamp": svl.labelCounter.countLabel("CurbRamp"),
                "NoCurbRamp": svl.labelCounter.countLabel("NoCurbRamp"),
                "Obstacle": svl.labelCounter.countLabel("Obstacle"),
                "SurfaceProblem": svl.labelCounter.countLabel("SurfaceProblem"),
                "NoSidewalk": svl.labelCounter.countLabel("NoSidewalk"),
                "Other": svl.labelCounter.countLabel("Other")
            };
            svl.labelCounter.reset();
        }

        if (!svl.isOnboarding()){
            svl.storage.set('completedFirstMission', true);
        }
    }

    /**
     * This method returns the label count object
     * @returns {*}
     */
    function getLabelCount () {
        return labelCountsAtCompletion;
    }

    /**
     * Compute and return the mission completion rate
     * @returns {number}
     */
    function getMissionCompletionRate () {
        updateDistanceProgress();
        if ("taskContainer" in svl && getProperty("missionType") !== "auditOnboarding") {
            var distanceProgress = getProperty("distanceProgress");
            var targetDistance = getDistance('meters');

            return Math.min(Math.max(distanceProgress / targetDistance, 0), 1);
        } else {
            return 0;
        }
    }

    /**
     * Updates the distanceProgress for this audit mission.
     */
    function updateDistanceProgress() {
        if ("taskContainer" in svl
            && getProperty("missionType") !== "auditOnboarding"
            && svl.missionContainer.getTasksMissionsOffset() !== null) {

            var currentMissionCompletedDistance;
            if (isComplete()) {
                currentMissionCompletedDistance = getDistance("meters");
            } else {
                var taskDistance = util.math.kilometersToMeters(svl.taskContainer.getCompletedTaskDistance({units: 'kilometers'}));
                var offset = svl.missionContainer.getTasksMissionsOffset();
                offset = offset ? offset : 0;

                var missionDistance = svl.missionContainer.getCompletedMissionDistance();
                currentMissionCompletedDistance = taskDistance - missionDistance + offset;
                // Hotfix for an issue where the mission completion distance was negative. Need to find root cause.
                // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2120
                if (currentMissionCompletedDistance < 0) {
                    svl.missionContainer.setTasksMissionsOffset(offset - currentMissionCompletedDistance);
                    console.error(`Mission progress was set to ${currentMissionCompletedDistance}, resetting to 0.`);
                    currentMissionCompletedDistance = 0;
                }
            }
            setProperty("distanceProgress", currentMissionCompletedDistance);
        }
    }

    /** Returns a property */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Get an array of tasks for this mission
     * @returns {Array}
     */
    function getRoute() {
        return _tasksForTheMission;
    }

    /**
     * Check if the mission is completed or not
     *
     * @returns {boolean}
     */
    function isComplete () {
        return getProperty("isComplete");
    }

    /**
     * Push a completed task into `_tasksForTheMission`.
     * @param task
     */
    function pushATaskToTheRoute(task) {
        var streetEdgeIds = _tasksForTheMission.map(function (task) {
            return task.getStreetEdgeId();
        });
        if (streetEdgeIds.indexOf(task.getStreetEdgeId()) < 0) {
            _tasksForTheMission.push(task);
        }
    }

    /**
     * Sets a property
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Return a string describing this data
     * @returns {string}
     */
    function toString () {
        return "Mission ID: " + getProperty("missionId") + ", Mission Type: " + getProperty("missionType") +
            ", Region Id: " + getProperty("regionId") + ", Complete: " + getProperty("isComplete") +
            ", Distance: " + getDistance("meters") + "\n";
    }

    /**
     * Total line distance in this mission.
     * @param unit
     */
    function getDistance(unit) {
        if (unit === undefined) unit = "meters";

        if (unit === "miles")           return util.math.metersToMiles(getProperty("distance"));
        else if (unit === "feet")       return util.math.metersToFeet(getProperty("distance"));
        else if (unit === "kilometers") return util.math.metersToKilometers(getProperty("distance"));
        else if (unit === "meters")     return getProperty("distance");
        else {
            console.error("Unit must be miles, feet, kilometers, or meters. Given: " + unit);
            return getProperty("distance");
        }
    }

    _init(parameters);

    self.complete = complete;
    self.getLabelCount = getLabelCount;
    self.getProperty = getProperty;
    self.getRoute = getRoute;
    self.getMissionCompletionRate = getMissionCompletionRate;
    self.updateDistanceProgress = updateDistanceProgress;
    self.isComplete = isComplete;
    self.pushATaskToTheRoute = pushATaskToTheRoute;
    self.setProperty = setProperty;
    self.toString = toString;
    self.getDistance = getDistance;
}
/**
 * MissionContainer module
 * @param statusFieldMission.  TODO The module should communicate with the statusFieldMission via StatusModel.
 * @param missionModel. Mission model object.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionContainer (statusFieldMission, missionModel) {
    var self = this;
    this._completedMissions = [];
    this._currentMission = null;

    /*
    This variable keeps the distance of completed missions minus completed audits to fix the problem that
    is discussed here: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/297#issuecomment-259697107
     */
    var tasksMissionsOffset = null;

    var _missionModel = missionModel;

    _missionModel.on("MissionProgress:complete", function (parameters) {
        var mission = parameters.mission;
        self.addToCompletedMissions(mission);
    });

    _missionModel.on("MissionContainer:addAMission", function (mission) {
        if (mission.getProperty("isComplete")) {
            self._completedMissions.push(mission);
        } else {
            self.setCurrentMission(mission);
            self.notifyMissionLoaded(mission);
        }
    });

    /** Push the completed mission */
    this.addToCompletedMissions = function (mission) {
        var existingMissionIds = self._completedMissions.map(function (m) { return m.getProperty("missionId")});
        var currentMissionId = mission.getProperty("missionId");
        if (existingMissionIds.indexOf(currentMissionId) < 0) {
            mission.setProperty("distanceProgress", mission.getDistance());
            self._completedMissions.push(mission);
        } else {
            console.log("Oops, we are trying to add to completed missions array multiple times. Plz fix.")
        }
    };

    /** Get current mission */
    function getCurrentMission() {
        return self._currentMission;
    }

    /**
     * Get all the completed missions
     */
    function getCompletedMissions() {
        return self._completedMissions;
    }

    /**
     * Get the sum of the distance of all the user's completed missions in this neighborhood.
     * @param unit
     * @returns {number}
     */
    function getCompletedMissionDistance(unit) {
        if (!unit) unit = "meters";
        var completedDistance = 0;
        for (var missionIndex = 0; missionIndex < self._completedMissions.length; missionIndex++)
            completedDistance += self._completedMissions[missionIndex].getDistance(unit);
        return completedDistance;
    }

    /**
     * Checks if this is the first mission or not.
     * @returns {boolean}
     */
    function isTheFirstMission () {
        return getCompletedMissions().length === 0 && !svl.storage.get("completedFirstMission");
    }

    /**
     * This method sets the current mission
     * @param mission {object} A Mission object
     * @returns {setCurrentMission}
     */
    this.setCurrentMission = function (mission) {
        self._currentMission = mission;
        statusFieldMission.setMessage(mission);
        var currTask = svl.taskContainer.getCurrentTask();
        var missionId = mission.getProperty('missionId');
        currTask.setProperty('currentMissionId', missionId);

        // If this is the start of a new mission, mark the location along the street that the user is at when the
        // mission starts. This will be used later to draw their route on the mission complete map.
        if (mission.getProperty('distanceProgress') < 1.0 && !currTask.getProperty('tutorialTask')) {
            // Snap the current location to the nearest point on the street, and use that as the mission start.
            var currPos = turf.point([svl.map.getPosition().lng, svl.map.getPosition().lat]);
            var missionStart = turf.nearestPointOnLine(currTask.getFeature(), currPos).geometry.coordinates;
            currTask.setMissionStart(missionId, { lat: missionStart[1], lng: missionStart[0]});
        }
        return this;
    };

    function setTasksMissionsOffset(value) {
        tasksMissionsOffset = value;
    }

    function getTasksMissionsOffset() {
        // See issue https://github.com/ProjectSidewalk/SidewalkWebpage/issues/297
        // Check pull request for more details
        return tasksMissionsOffset;
    }

    self.getCompletedMissions = getCompletedMissions;
    self.getCompletedMissionDistance = getCompletedMissionDistance;
    self.getCurrentMission = getCurrentMission;
    self.isTheFirstMission = isTheFirstMission;
    self.setTasksMissionsOffset = setTasksMissionsOffset;
    self.getTasksMissionsOffset = getTasksMissionsOffset;
}
_.extend(MissionContainer.prototype, Backbone.Events);

MissionContainer.prototype.notifyMissionLoaded = function(mission) {
    this.trigger("MissionContainer:missionLoaded", mission);
};

/**
 * MissionFactory module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 * @param missionModel
 */
function MissionFactory (missionModel) {
    var self = this;
    var _missionModel = missionModel;

    _missionModel.on("MissionFactory:create", function (parameters) {
        // Makes any necessary changes from snake_case to camelCase since we get the values from JSON.
        if (!parameters.hasOwnProperty("missionId") && parameters.hasOwnProperty("mission_id"))
            parameters.missionId = parameters.mission_id;
        if (!parameters.hasOwnProperty("missionType") && parameters.hasOwnProperty("mission_type"))
            parameters.missionType = parameters.mission_type;
        if (!parameters.hasOwnProperty("regionId") && parameters.hasOwnProperty("region_id"))
            parameters.regionId = parameters.region_id;
        if (!parameters.hasOwnProperty("isComplete") && parameters.hasOwnProperty("completed"))
            parameters.isComplete = parameters.completed;
        if (!parameters.hasOwnProperty("isComplete") && parameters.hasOwnProperty("is_complete"))
            parameters.isComplete = parameters.is_complete;
        if (!parameters.hasOwnProperty("distance") && parameters.hasOwnProperty("distanceMeters"))
            parameters.distance = parameters.distanceMeters;
        if (!parameters.hasOwnProperty("distance") && parameters.hasOwnProperty("distance_meters"))
            parameters.distance = parameters.distance_meters;
        if (!parameters.hasOwnProperty("distanceProgress") && parameters.hasOwnProperty("distance_progress"))
            parameters.distanceProgress = parameters.distance_progress;

        var mission = self.create(parameters.missionId, parameters.missionType, parameters.regionId,
            parameters.isComplete, parameters.pay, parameters.paid, parameters.distance, parameters.distanceProgress,
            parameters.skipped);
        _missionModel.addAMission(mission);
    });
}

/**
 * Create an instance of a mission object
 *
 * @param missionId
 * @param missionType
 * @param regionId
 * @param isComplete
 * @param pay
 * @param paid
 * @param distance
 * @param distanceProgress
 * @param skipped
 * @returns {svl.Mission}
 */
MissionFactory.prototype.create = function (missionId, missionType, regionId, isComplete, pay, paid, distance, distanceProgress, skipped) {
    return new Mission({
        missionId: missionId,
        missionType: missionType,
        regionId: regionId,
        isComplete: isComplete,
        pay: pay,
        paid: paid,
        distance: distance,
        distanceProgress: distanceProgress,
        skipped: skipped
    });
};

/**
 * MissionModel constructor.
  * @constructor
 */
function MissionModel () {
    var self = this;

    this.fetchCompletedMissionsInNeighborhood = function (callback) {
        function _onFetch (missions) {
            for (var i = 0, len = missions.length; i < len; i++) {
                self.createAMission(missions[0]);
            }
        }

        if (callback) {
            $.when($.ajax("/neighborhoodMissions")).done(_onFetch).done(callback);
        } else {
            $.when($.ajax("/neighborhoodMissions")).done(_onFetch);
        }
    };


}
_.extend(MissionModel.prototype, Backbone.Events);

MissionModel.prototype.addAMission = function (mission) {
    this.trigger("MissionContainer:addAMission", mission);
};

MissionModel.prototype.completeMission = function (mission) {
    this.trigger("MissionProgress:complete", { mission: mission });
};

MissionModel.prototype.createAMission = function (parameters) {
    this.trigger("MissionFactory:create", parameters);
};

/**
 * Notify the mission modules with MissionProgress:update
 */
MissionModel.prototype.updateMissionProgress = function (mission, neighborhood) {
    this.trigger("MissionProgress:update", { mission: mission, neighborhood: neighborhood });
};

/**
 * MissionProgress module.
 * Todo. Rename this... Probably some of these features should be moved to status/StatusFieldMission.js
 * Todo. Get rid of neighborhoodContainer dependency. Instead, communicate with them through neighborhoodModel and taskModel.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionProgress (svl, gameEffectModel, missionModel, modalModel, neighborhoodModel, statusModel,
                          missionContainer, neighborhoodContainer, tracker) {
    var self = this;
    var _gameEffectModel = gameEffectModel;
    var _missionModel = missionModel;
    var _modalModel = modalModel;
    var _neighborhoodModel = neighborhoodModel;

    _missionModel.on("MissionProgress:update", function (parameters) {
        var mission = parameters.mission;
        var neighborhood = parameters.neighborhood;
        self.update(mission, neighborhood);
    });

    _neighborhoodModel.on("Neighborhood:completed", function () {
        // When the user has complete auditing all the streets in the neighborhood,
        // show the 100% coverage mission completion message.

        var mission = missionContainer.getCurrentMission();
        var neighborhood = neighborhoodContainer.getCurrentNeighborhood();

        self._completeTheCurrentMission(mission, neighborhood);
        _modalModel.updateModalMissionComplete(mission, neighborhood);
        _modalModel.showModalMissionComplete();
    });


    /**
     * Finish the mission.
     * @param mission
     * @param neighborhood
     */
    this._completeTheCurrentMission = function (mission, neighborhood) {
        tracker.push(
            "MissionComplete",
            {
                missionId: mission.getProperty("missionId"),
                missionType: mission.getProperty("missionType"),
                distanceMeters: Math.round(mission.getDistance("meters")),
                regionId: neighborhood.getProperty("regionId")
            }
        );
        mission.complete();

        // TODO Audio should listen to MissionProgress instead of MissionProgress telling what to do.
        _gameEffectModel.loadAudio({audioType: "success"});
        _gameEffectModel.playAudio({audioType: "success"});

        _missionModel.completeMission(mission);

        svl.missionsCompleted += 1;
    };

    this._checkMissionComplete = function (mission, neighborhood) {
        if (mission.getMissionCompletionRate() > 0.999) {
            this._completeTheCurrentMission(mission, neighborhood);

            // While the mission complete modal is open, after the **neighborhood** is 100% audited,
            // the user is jumped to the next neighborhood, that causes the modalmodel to be updated
            // and it changes the modal's neighborhood information while it is open.
            if (svl.modalMissionComplete.isOpen())
                return;

            _modalModel.updateModalMissionComplete(mission, neighborhood);
            _modalModel.showModalMissionComplete();
        }
    };

    /**
     * This method updates audited distance and mission completion rate in the right sidebar.
     */
    this.update = function (currentMission, currentRegion) {
        if (svl.isOnboarding()) return;

        // Update audited distance in both Overall and Neighborhood stats in right sidebar.
        var distance = svl.taskContainer.getCompletedTaskDistance();
        svl.statusFieldNeighborhood.setAuditedDistance(distance);
        svl.statusFieldOverall.setNeighborhoodAuditedDistance(distance);

        // Update mission completion rate in right sidebar.
        var completionRate = currentMission.getMissionCompletionRate();
        statusModel.setMissionCompletionRate(completionRate);
        statusModel.setProgressBar(completionRate);
        this._checkMissionComplete(currentMission, currentRegion);

        // Survey prompt. Modal should display survey if
        // 1. User has completed numMissionsBeforeSurvey number of missions
        // 2. The user has just completed more than 60% of the current mission
        // 3. The user has not been shown the survey before
        if (completionRate > 0.6 && completionRate < 0.9) {
            $.ajax({
                async: true,
                url: '/survey/display',
                type: 'get',
                success: function (data) {
                    if (data.displayModal) {
                        $('#survey-modal-container').modal({
                            backdrop: 'static',
                            keyboard: false
                        });

                        //we will log in the webpage activity table if the survey has been shown
                        var activity = "SurveyShown";
                        var url = "/userapi/logWebpageActivity";
                        var async = true;
                        $.ajax({
                            async: async,
                            contentType: 'application/json; charset=utf-8',
                            url: url,
                            type: 'post',
                            data: JSON.stringify(activity),
                            dataType: 'json',
                            success: function (result) {
                            },
                            error: function (result) {
                                console.error(result);
                            }
                        });
                    }
                },
                error: function (xhr, ajaxOptions, thrownError) {
                    console.log(thrownError);
                }
            });
        }

    };
}

/**
 * ModalComment module.
 * @param svl
 * @param tracker
 * @param ribbon
 * @param taskContainer
 * @param uiLeftColumn
 * @param uiModalComment
 * @param onboardingModel
 * @constructor
 */
function ModalComment (svl, tracker, ribbon, taskContainer, uiLeftColumn, uiModalComment, onboardingModel) {
    var self = this;
    var status = {
        disableClickOK: true
    };
    var blinkInterval;

    var _uiModalComment = uiModalComment;
    var _uiLeftColumn = uiLeftColumn;  // This should not be this module's responsibility.

    // Initializing feedback popover 
    _uiLeftColumn.feedback.popover();

    onboardingModel.on("Onboarding:startOnboarding", function () {
        self.hide();
    });

    /**
     * Blink the feedback button on the left
     */
    self.blink = function () {
        self.stopBlinking();
        blinkInterval = window.setInterval(function () {
            _uiLeftColumn.feedback.toggleClass("highlight-50");
        }, 500);
    };

    /**
     * A callback function for clicking the feedback button on the left
     * @param e
     */
    function handleClickFeedback (e) {
        tracker.push("ModalComment_ClickFeedback");
        showCommentMenu();
    }

    function handleClickOK (e) {
        e.preventDefault();
        tracker.push("ModalComment_ClickOK");

        var task = taskContainer.getCurrentTask();
        var panoramaId = svl.map.getPanoId();
        var latlng = svl.map.getPosition();
        var pov = svl.map.getPov();
        var data;

        data = self._prepareCommentData(panoramaId, latlng.lat, latlng.lng, pov, task);
        self._submitComment(data);
        self.hide();
    }

    function handleClickCancel (e) {
        tracker.push("ModalComment_ClickCancel");
        e.preventDefault();
        self.hide();
    }

    /**
     * Handles changes in the comment field
     */
    function handleTextareaChange () {
        var comment = _uiModalComment.textarea.val();
        if (comment.length > 0) {
            enableClickOK();
        } else {
            self._disableClickOK();
        }
    }

    function handleTextareaBlur() {
        ribbon.enableModeSwitch();
    }

    function handleTextareaFocus() {
        ribbon.disableModeSwitch();
    }

    this.hide = function () {
        svl.modalSkip.hideSkipMenu();
        _uiModalComment.holder.addClass('hidden');
        svl.popUpMessage.enableInteractions();
        self.hideBackground();
    };

    function showCommentMenu () {
        _uiModalComment.textarea.val("");
        _uiModalComment.holder.removeClass('hidden');
        _uiModalComment.ok.addClass("disabled");
        self._disableClickOK();
        svl.popUpMessage.disableInteractions();
        self.showBackground();
    }

    this.hideBackground = function (){
        $('#modal-comment-background').css({ width: '', height: ''})
    };

    this.showBackground = function (){
        $('#modal-comment-background').css("background-color", "white");
        $('#modal-comment-background').css({
            width: '100%',
            height: '100%',
            opacity: '0.5',
            visibility: 'visible'
        });
    };

    self._disableClickOK = function () {
        _uiModalComment.ok.attr("disabled", true);
        _uiModalComment.ok.addClass("disabled");
        status.disableClickOK = true;
    };

    function enableClickOK () {
        _uiModalComment.ok.attr("disabled", false);
        _uiModalComment.ok.removeClass("disabled");
        status.disableClickOK = false;
    }

    /**
     * Stop blinking the feedback button on the left column
     */
    self.stopBlinking = function () {
        window.clearInterval(blinkInterval);
        _uiLeftColumn.feedback.removeClass("highlight-50");
    };

    /**
     * Submit the comment.
     */
    this._submitComment = function (data) {
        var url = "/audit/comment";
        var async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                _uiLeftColumn.feedback.popover('toggle');
                setTimeout(function(){ _uiLeftColumn.feedback.popover('toggle'); }, 1500);
            },
            error: function (result) {
                console.error(result);
            }
        });
    };

    this._prepareCommentData = function (panoramaId, lat, lng, pov, task) {
        var streetEdgeId = task.getStreetEdgeId(),
            comment = _uiModalComment.textarea.val();

        return {
            comment: comment,
            gsv_panorama_id: panoramaId,
            heading: pov ? pov.heading : null,
            lat: lat,
            lng: lng,
            pitch: pov ? pov.pitch : null,
            street_edge_id: streetEdgeId,
            audit_task_id: task.getAuditTaskId(),
            mission_id: svl.missionContainer.getCurrentMission().getProperty('missionId'),
            zoom: pov ? pov.zoom : null
        };
    };


    self._disableClickOK();
    _uiModalComment.ok.on("click", handleClickOK);
    _uiModalComment.cancel.on("click", handleClickCancel);
    _uiLeftColumn.feedback.on("click", handleClickFeedback);
    _uiModalComment.textarea.on("focus", handleTextareaFocus);
    _uiModalComment.textarea.on("blur", handleTextareaBlur);
    _uiModalComment.textarea.on("input", handleTextareaChange);
}
/**
 * Modal windows for the examples of accessibility attributes
 * @returns {{className: string}}
 * @constructor
 */
function ModalExample (modalModel, onboardingModel, uiModalExample) {
    var self = this;

    modalModel.on("ModalExample:show", function (labelType) {
        self.show(labelType);
    });

    onboardingModel.on("Onboarding:startOnboarding", function () {
        self.hide();
    });

    this._handleBackgroundClick = function () {
        self.hide();
    };

    this._handleCloseButtonClick = function () {
        self.hide();
    };

    this.hide = function () {
        uiModalExample.curbRamp.addClass("hidden");
        uiModalExample.noCurbRamp.addClass("hidden");
        uiModalExample.obstacle.addClass("hidden");
        uiModalExample.surfaceProblem.addClass("hidden");
    };

    this.show = function (key) {
        this.hide();
        switch (key) {
            case "CurbRamp":
                uiModalExample.curbRamp.removeClass("hidden");
                break;
            case "NoCurbRamp":
                uiModalExample.noCurbRamp.removeClass("hidden");
                break;
            case "Obstacle":
                uiModalExample.obstacle.removeClass("hidden");
                break;
            case "SurfaceProblem":
                uiModalExample.surfaceProblem.removeClass("hidden");
                break;
        }
    };

    uiModalExample.close.on("click", this._handleCloseButtonClick);
    uiModalExample.background.on("click", this._handleBackgroundClick);
}
/**
 * ModalMission module
 * @param missionContainer
 * @param neighborhoodContainer
 * @param uiModalMission
 * @param modalModel
 * @param onboardingModel
 * @param userModel
 * @returns {{className: string}}
 * @constructor
 */
function ModalMission (missionContainer, neighborhoodContainer, uiModalMission, modalModel, onboardingModel, userModel) {
    var self = this;
    var _missionContainer = missionContainer;
    var _neighborhoodContainer = neighborhoodContainer;
    var _modalModel = modalModel;
    var _userModel = userModel;

    this._status = {
        isOpen: false
    };

    _modalModel.on("ModalMission:setMissionMessage", function (parameters) {
        self.setMissionMessage(parameters.mission, parameters.neighborhood, parameters.parameters, parameters.callback);
        self.show();
    });

    _modalModel.on("ModalMissionComplete:closed", function () {
        var mission = _missionContainer.getCurrentMission();
        var neighborhood = _neighborhoodContainer.getCurrentNeighborhood();
        self.setMissionMessage (mission, neighborhood);
        self.show();
    });

    onboardingModel.on("Onboarding:startOnboarding", function () {
        self.hide();
    });


    var initialMissionHTML = '<figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + i18next.t('mission-start.body-first') + '</p>\
        <div class="spacer10"></div>';

    var distanceMissionHTML = ' <figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + i18next.t('mission-start.body') + '</p>\
        <div class="spacer10"></div>';

    var returningToMissionHTML = ' <figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + i18next.t('mission-start.title-continue') + '</p>\
        <div class="spacer10"></div>';

    this._handleBackgroundClick = function () {
        self.hide();
    };

    this._handleCloseButtonClick = function () {
        mission = _missionContainer.getCurrentMission();

        // Check added so that if a user begins a mission, leaves partway through, and then resumes the mission later, another
        // MissionStart will not be triggered
        if(mission.getProperty("distanceProgress") < 0.0001) {
            svl.tracker.push(
                "MissionStart",
                {
                    missionId: mission.getProperty("missionId"),
                    missionType: mission.getProperty("missionType"),
                    distanceMeters: Math.round(mission.getDistance("meters")),
                    regionId: mission.getProperty("regionId")
                }
            );
        }
        self.hide();
    };

    /**
     * Hide a mission
     */
    this.hide = function () {
        self._status.isOpen = false;
        uiModalMission.holder.css('visibility', 'hidden');
        uiModalMission.foreground.css('visibility', 'hidden');
        uiModalMission.background.css('visibility', 'hidden');
        svl.popUpMessage.enableInteractions();
    };

    /** Show a mission */
    this.show = function () {
        self._status.isOpen = true;
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.background.css('visibility', 'visible');
        //svl.popUpMessage.disableInteractions();
    };

    /**
     *  This method takes in an integer feet and converts it to meters, truncating all decimals.
     *  @param feet to convert to meters
     *  @return
     */
    this.convertToMetric = function(feet, unitAbbreviation) {
        return Math.trunc(feet * 0.3048) + " " + unitAbbreviation;
    };

    /**
     * Set the mission message in the modal window, then show the modal window.
     * @param mission
     * @param neighborhood
     * @param parameters
     * @param callback
     */
    this.setMissionMessage = function (mission, neighborhood, parameters, callback) {
        // Set the title and the instruction of this mission.

        var missionType = mission.getProperty("missionType");
        var missionTitle = i18next.t('mission-start.title');
        var templateHTML;

        svl.popUpMessage.disableInteractions();
        if (missionType === "audit") {
            var distanceString;
            templateHTML = distanceMissionHTML;

            if (mission.getProperty("distanceProgress") > 0) { // In-progress mission
                missionTitle = i18next.t('mission-start.title-return');
                templateHTML = returningToMissionHTML;

                // Set returning-to-mission specific css
                uiModalMission.closeButton.html(i18next.t('mission-start.button-resume'));
                uiModalMission.instruction.css('text-align', 'center');
                uiModalMission.closeButton.css('font-size', '24px');
                uiModalMission.closeButton.css('width', '40%');
                uiModalMission.closeButton.css('margin-right', '30%');
                uiModalMission.closeButton.css('margin-left', '30%');
                uiModalMission.closeButton.css('margin-top', '30px');
            } else if (missionContainer.isTheFirstMission()) {
                missionTitle = i18next.t('mission-start.title-first') + missionTitle;
                templateHTML = initialMissionHTML;
            } else {
                // We have to reset the css from the resuming screen, otherwise the button will remain as set
                uiModalMission.closeButton.html('OK');
                uiModalMission.instruction.css('text-align', 'left');
                uiModalMission.closeButton.css('font-size', '');
                uiModalMission.closeButton.css('width', '');
                uiModalMission.closeButton.css('margin-right', '');
                uiModalMission.closeButton.css('margin-left', '');
                uiModalMission.closeButton.css('margin-top', '');
            }

            distanceString = this._distanceToString(mission.getDistance("miles"), "miles");

            missionTitle = missionTitle.replace("__DISTANCE_PLACEHOLDER__", distanceString);
            missionTitle = missionTitle.replace("__NEIGHBORHOOD_PLACEHOLDER__", neighborhood.getProperty("name"));

            templateHTML = templateHTML.replace("__DISTANCE_PLACEHOLDER__", distanceString);
            templateHTML = templateHTML.replace("__NEIGHBORHOOD_PLACEHOLDER__", neighborhood.getProperty("name"));

            uiModalMission.missionTitle.html(missionTitle);
            uiModalMission.instruction.html(templateHTML);
            $("#mission-target-distance").html(distanceString);
            // TODO check for this using tasks
        } else {
            templateHTML = initialMissionHTML;
            uiModalMission.instruction.html(templateHTML);
            uiModalMission.missionTitle.html(missionTitle);
        }

        // Update the reward HTML if the user is a turker.
        if (_userModel.getUser().getProperty("role") === "Turker") {
            var missionReward = mission.getProperty("pay");
            var missionRewardText = i18next.t('common:mission-start-turk-reward') + '<span class="bold" style="color: forestgreen;">$__REWARD_PLACEHOLDER__</span>';
            missionRewardText = missionRewardText.replace("__REWARD_PLACEHOLDER__", missionReward.toFixed(2));
            svl.ui.status.currentMissionReward.html(i18next.t('common:right-ui-turk-current-reward') + "<span style='color:forestgreen'>$" + missionReward.toFixed(2)) + "</span>";
            uiModalMission.rewardText.html(missionRewardText);

            $.ajax({
                async: true,
                url: '/rewardEarned',
                type: 'get',
                success: function(rewardData) {
                    svl.ui.status.totalMissionReward.html(i18next.t('common:right-ui-turk-total-reward') + "<span style='color:forestgreen'>$" + rewardData.reward_earned.toFixed(2)) + "</span>";
                },
                error: function (xhr, ajaxOptions, thrownError) {
                    console.log(thrownError);
                }
            })
        }

        if (callback) {
            $("#modal-mission-close-button").one("click", function () {
                self.hide();
                callback();
            });
        } else {
            $("#modal-mission-close-button").one("click", self.hide);
            $("#modal-mission-holder").find(".ok-button").one("click", self.hide);
        }

        $(document).keyup(function (e){
            e = e || window.event;
            //enter key
            if (e.keyCode == 13 && self._status.isOpen){
                svl.tracker.push("KeyboardShortcut_ModalMissionOk");
                $("#modal-mission-close-button").trigger("click", {lowLevelLogging: false});
            }
        });
    };

    uiModalMission.background.on("click", this._handleBackgroundClick);
    uiModalMission.closeButton.on("click", this._handleCloseButtonClick);
}

ModalMission.prototype._distanceToString = function  (distance, unit) {
    if (!unit) unit = "kilometers";

    // Convert to meters.
    if (unit === "feet") distance = util.math.feetToMeters(distance);
    else if (unit === "miles") distance = util.math.milesToMeters(distance);
    else if (unit === "kilometers") distance = util.math.kilometersToMeters(distance);

    var distanceType = i18next.t('common:measurement-system');
    var unitAbbreviation = i18next.t('common:unit-abbreviation-mission-distance');

    if (distanceType === "metric") return util.math.roundToTwentyFive(distance) + " " + unitAbbreviation;
    else return util.math.roundToTwentyFive(util.math.metersToFeet(distance)) + " " + unitAbbreviation;
};

ModalMission.prototype.isOpen = function () {
    return this._status.isOpen;
};

/**
 *
 * @param svl. Todo. Get rid of this dependency eventually.
 * @param missionContainer
 * @param missionModel
 * @param taskContainer
 * @param modalMissionCompleteMap
 * @param modalMissionProgressBar
 * @param uiModalMissionComplete
 * @param modalModel
 * @param statusModel
 * @param onboardingModel
 * @param userModel
 * @returns {{className: string}}
 * @constructor
 */
function ModalMissionComplete (svl, missionContainer, missionModel, taskContainer, modalMissionCompleteMap,
                               modalMissionProgressBar, uiModalMissionComplete, modalModel, statusModel,
                               onboardingModel, userModel) {
    var self = this;
    var _missionModel = missionModel;
    var _missionContainer = missionContainer;
    var _modalModel = modalModel;
    this._userModel = userModel;

    this._properties = {
        boxTop: 180,
        boxLeft: 45,
        boxWidth: 640
    };
    this._status = {
        isOpen: false
    };
    this._closeModalClicked = false;
    this.showingMissionCompleteScreen = false;
    this._canShowContinueButton = false;

    this._uiModalMissionComplete = uiModalMissionComplete;
    this._modalMissionCompleteMap = modalMissionCompleteMap;

    _modalModel.on("ModalMissionComplete:update", function (parameters) {
        self.update(parameters.mission, parameters.neighborhood);
    });

    _modalModel.on("ModalMissionComplete:show", function () {
        self.show();
    });

    _modalModel.on("ModalMissionComplete:one", function (parameters) {
        self.one(parameters.uiComponent, parameters.eventType, parameters.callback);
    });

    onboardingModel.on("Onboarding:startOnboarding", function () {
        self.hide();
    });

    svl.neighborhoodModel.on("Neighborhood:completed", function() {
        var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
        var neighborhoodName = neighborhood.getProperty("name");
        self.setMissionTitle("Bravo! You completed the " + neighborhoodName + " neighborhood!");
        uiModalMissionComplete.closeButtonPrimary.html('Explore Another Neighborhood');
        self._canShowContinueButton = true;
        if (self.showingMissionCompleteScreen) {
            self._enableContinueButton();
        }
    });

    _missionModel.on("MissionProgress:complete", function (parameters) {
        self._canShowContinueButton = false;
    });

    _missionContainer.on("MissionContainer:missionLoaded", function(mission) {
        self._canShowContinueButton = true;
        if (self.showingMissionCompleteScreen) {
            self._enableContinueButton();
        }
    });

    // Enables clicking of continue button. Only enabled when next mission loaded mission complete modal shown.
    this._enableContinueButton = function() {
        uiModalMissionComplete.closeButtonPrimary.on("click", { button: 'primary' }, self._handleCloseButtonClick);
        uiModalMissionComplete.closeButtonSecondary.on("click", { button: 'secondary' }, self._handleCloseButtonClick);

        uiModalMissionComplete.closeButtonPrimary.removeClass('btn-loading');
        uiModalMissionComplete.closeButtonPrimary.addClass('btn-primary');

        uiModalMissionComplete.closeButtonSecondary.removeClass('btn-loading');
        uiModalMissionComplete.closeButtonSecondary.addClass('btn-secondary');
    };

    // Disables clicking of continue button. Only enabled when next mission loaded mission complete modal shown.
    this._disableContinueButton = function() {
        uiModalMissionComplete.closeButtonPrimary.off('click');
        uiModalMissionComplete.closeButtonSecondary.off('click');

        uiModalMissionComplete.closeButtonPrimary.removeClass('btn-primary');
        uiModalMissionComplete.closeButtonPrimary.addClass('btn-loading');

        uiModalMissionComplete.closeButtonSecondary.removeClass('btn-secondary');
        uiModalMissionComplete.closeButtonSecondary.addClass('btn-loading');
    };

    // TODO maybe deal with lost connection causing modal to not close
    this._handleCloseButtonClick = function (event) {
        self._closeModalClicked = true;
        self._closeModal(event);
    };

    /**
     * Closes mission complete modal. Either starts a new mission or loads the validation page.
     *
     * If the user clicks the 'Start validating' button send them to the validation page (only shows up if this was
     * their third audit mission in a row or they are not a turker and this is their first audit mission ever). If they
     * just finished a neighborhood, reload the audit page. Otherwise start a new audit mission like normal.
     * @param event
     * @private
     */
    this._closeModal = function (event) {
        var isTurker = self._userModel.getUser().getProperty("role") === "Turker";
        var firstMission = !svl.userHasCompletedAMission && svl.missionsCompleted === 1;
        if (event.data.button === 'primary' && ((!isTurker && firstMission) || svl.missionsCompleted % 3 === 0)) {
            window.location.replace('/validate');
        } else if (svl.neighborhoodModel.isNeighborhoodCompleted) {
            // Reload the page to load another neighborhood.
            window.location.replace('/audit');
        } else {
            var nextMission = missionContainer.getCurrentMission();
            _modalModel.triggerMissionCompleteClosed( { nextMission: nextMission } );
            svl.map.unlockDisableWalking();
            svl.map.enableWalking();
            self.hide();
        }
    };

    // Hides all the pieces of the mission complete modal.
    this.hide = function () {
        this._status.isOpen = false;
        this._uiModalMissionComplete.holder.css('visibility', 'hidden');
        this._uiModalMissionComplete.foreground.css('visibility', "hidden");
        this._uiModalMissionComplete.background.css('visibility', "hidden");
        this._uiModalMissionComplete.closeButtonPrimary.css('visibility', "hidden");
        this._uiModalMissionComplete.closeButtonSecondary.css('visibility', "hidden");
        this._uiModalMissionComplete.closeButtonPrimary.off('click');
        this._uiModalMissionComplete.closeButtonSecondary.off('click');

        this._modalMissionCompleteMap.hide();
        statusModel.setProgressBar(0);
        statusModel.setMissionCompletionRate(0);
        if (this._uiModalMissionComplete.confirmationText !== null
            && this._uiModalMissionComplete.confirmationText !== undefined) {
            this._uiModalMissionComplete.confirmationText.empty();
            this._uiModalMissionComplete.confirmationText.remove();
            delete this._uiModalMissionComplete.confirmationText;
            delete svl.confirmationCode;
        }
        self.showingMissionCompleteScreen = false;
    };

    /**
     * Shows all components of mission complete modal. Decides which continue button(s) to show (audit or validation).
     */
    this.show = function () {
        this._status.isOpen = true;
        svl.map.disableWalking();
        svl.map.lockDisableWalking();
        uiModalMissionComplete.holder.css('visibility', 'visible');
        uiModalMissionComplete.foreground.css('visibility', "visible");
        uiModalMissionComplete.background.css('visibility', "visible");
        uiModalMissionComplete.background.off("click");
        uiModalMissionComplete.closeButtonPrimary.css('visibility', "visible");

        // If the user just completed their first audit mission ever (and they aren't a turker) or they finished their
        // third in a row, make the primary button they see a 'Start validating' button. If they are not a turker, then
        // also show a secondary button that lets them continue auditing. On any other mission just show a 'Continue'
        // button that has them audit more.
        var isTurker = self._userModel.getUser().getProperty("role") === "Turker";
        var firstMission = !svl.userHasCompletedAMission && svl.missionsCompleted === 1;
        if ((!isTurker && firstMission) || svl.missionsCompleted % 3 === 0) {
            uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.button-start-validating'));

            if (self._userModel.getUser().getProperty("role") === 'Turker') {
                uiModalMissionComplete.closeButtonPrimary.css('width', "100%");
                uiModalMissionComplete.closeButtonSecondary.css('visibility', "hidden");
            } else {
                uiModalMissionComplete.closeButtonPrimary.css('width', "50%");
                uiModalMissionComplete.closeButtonSecondary.css('visibility', "visible");
                uiModalMissionComplete.closeButtonSecondary.css('width', "48%");
                uiModalMissionComplete.closeButtonSecondary.html(i18next.t('mission-complete.button-keep-exploring'));
            }
        } else {
            uiModalMissionComplete.closeButtonPrimary.css('width', "100%");
            uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.button-continue'));
            uiModalMissionComplete.closeButtonSecondary.css('visibility', "hidden");
        }

        self.showingMissionCompleteScreen = true;
        if (self._canShowContinueButton) {
            self._enableContinueButton();
        } else {
            self._disableContinueButton();
        }
        // horizontalBarMissionLabel.style("visibility", "visible");
        modalMissionCompleteMap.show();

        // If the user has completed their first mission then display the confirmation code and show the confirmation
        // code text in the navbar.
        if (uiModalMissionComplete.generateConfirmationButton !== null
            && uiModalMissionComplete.generateConfirmationButton !== undefined) {
            var data = {
                amt_assignment_id: svl.amtAssignmentId,
                completed: true
            };

            $.ajax({
                async: true,
                contentType: 'application/json; charset=utf-8',
                url: "/amtAssignment",
                type: 'post',
                data: JSON.stringify(data),
                dataType: 'json',
                success: function (result) {
                },
                error: function (result) {
                    console.error(result);
                }
            });

            var confirmationCodeElement = document.createElement("h3");
            confirmationCodeElement.innerHTML = "<img src='/assets/javascripts/SVLabel/img/icons/Icon_OrangeCheckmark.png'  \" +\n" +
                "                \"alt='Confirmation Code icon' align='middle' style='top:-1px;position:relative;width:18px;height:18px;'> " +
                i18next.t('common:mission-complete-confirmation-code') +
                svl.confirmationCode;
            confirmationCodeElement.setAttribute("id", "modal-mission-complete-confirmation-text");
            confirmationCodeElement.style.marginTop = "-10px";
            confirmationCodeElement.style.marginBottom = "1px";
            uiModalMissionComplete.generateConfirmationButton.after(confirmationCodeElement);
            uiModalMissionComplete.confirmationText = $("#modal-mission-complete-confirmation-text");
            uiModalMissionComplete.generateConfirmationButton.remove();
            delete uiModalMissionComplete.generateConfirmationButton;

            $('#mturk-confirmation-code-text').text(i18next.t('common:mturk-code', { code: svl.confirmationCode }));
            $("#mturk-confirmation-code").css('visibility', '');
        }
    };

    this.update = function (mission, neighborhood) {
        // Update the horizontal bar chart to show the distance the user has audited.
        var unit = {units: i18next.t('common:unit-distance')};

        var missionDistance = mission.getDistance(unit.units);
        var missionPay = mission.getProperty("pay");
        var userAuditedDistance = neighborhood.completedLineDistance(unit);
        var allAuditedDistance = neighborhood.completedLineDistanceAcrossAllUsersUsingPriority();
        var otherAuditedDistance = allAuditedDistance - userAuditedDistance;
        var remainingDistance = neighborhood.totalLineDistanceInNeighborhood(unit) - allAuditedDistance;

        var userCompletedTasks = taskContainer.getCompletedTasks();
        var allCompletedTasks = taskContainer.getCompletedTasksAllUsersUsingPriority();
        mission.pushATaskToTheRoute(taskContainer.getCurrentTask());
        var missionTasks = mission.getRoute();
        var totalLineDistance = taskContainer.totalLineDistanceInNeighborhood(unit);
        var missionDistanceRate = missionDistance / totalLineDistance;
        var userAuditedDistanceRate = Math.max(0, userAuditedDistance / totalLineDistance - missionDistanceRate);
        var otherAuditedDistanceRate = Math.max(0, otherAuditedDistance / totalLineDistance);

        var labelCount = mission.getLabelCount(),
            curbRampCount = labelCount ? labelCount["CurbRamp"] : 0,
            noCurbRampCount = labelCount ? labelCount["NoCurbRamp"] : 0 ,
            obstacleCount = labelCount ? labelCount["Obstacle"] : 0,
            surfaceProblemCount = labelCount ? labelCount["SurfaceProblem"] : 0,
            noSidewalkCount = labelCount ? labelCount["NoSidewalk"] : 0,
            otherCount = labelCount ? labelCount["Other"] : 0;

        var neighborhoodName = neighborhood.getProperty("name");
        this.setMissionTitle(neighborhoodName + ": " + i18next.t('mission-complete.title'));

        modalMissionCompleteMap.updateStreetSegments(missionTasks, userCompletedTasks, allCompletedTasks, mission.getProperty('missionId'));
        modalMissionProgressBar.update(missionDistanceRate, userAuditedDistanceRate, otherAuditedDistanceRate);

        this._updateMissionProgressStatistics(missionDistance, missionPay, userAuditedDistance, otherAuditedDistance, remainingDistance);
        this._updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, noSidewalkCount, otherCount);
    };

    uiModalMissionComplete.closeButtonPrimary.on("click", { button: 'primary' }, this._handleCloseButtonClick);
    this.hide();
}



ModalMissionComplete.prototype.getProperty = function (key) {
    return key in this._properties ? this._properties[key] : null;
};

ModalMissionComplete.prototype.isOpen = function () {
    return this._status.isOpen;
};

ModalMissionComplete.prototype.one = function (uiComponent, eventType, callback) {
    this._uiModalMissionComplete[uiComponent].one(eventType, callback);
};

ModalMissionComplete.prototype.setMissionTitle = function (missionTitle) {
    this._uiModalMissionComplete.missionTitle.html(missionTitle);
};

ModalMissionComplete.prototype._updateMissionProgressStatistics = function (missionDistance, missionReward, userTotalDistance, othersAuditedDistance, remainingDistance) {
    var distanceType = i18next.t('mission-complete.distance-type-display-string');
    if(remainingDistance > 0.00 && remainingDistance <= 0.10){
        remainingDistance = 0.1;
    }
    var positiveRemainingDistance = Math.max(remainingDistance, 0);
    var positiveOthersAuditedDistance = Math.max(othersAuditedDistance, 0);
    this._uiModalMissionComplete.missionDistance.html(missionDistance.toFixed(1) + " " + distanceType);
    this._uiModalMissionComplete.totalAuditedDistance.html(userTotalDistance.toFixed(1) + " " + distanceType);
    this._uiModalMissionComplete.othersAuditedDistance.html(positiveOthersAuditedDistance.toFixed(1) + " " + distanceType);
    this._uiModalMissionComplete.remainingDistance.html(positiveRemainingDistance.toFixed(1) + " " + distanceType);

    // Update the reward HTML if the user is a turker.
    if (this._userModel.getUser().getProperty("role") === "Turker") {
        svl.ui.modalMissionComplete.missionReward.html("<span style='color:forestgreen'>$"+missionReward.toFixed(2)+"</span>");
    }
};

ModalMissionComplete.prototype._updateMissionLabelStatistics = function (curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, noSidewalkCount, otherCount) {
    this._uiModalMissionComplete.curbRampCount.html(curbRampCount);
    this._uiModalMissionComplete.noCurbRampCount.html(noCurbRampCount);
    this._uiModalMissionComplete.obstacleCount.html(obstacleCount);
    this._uiModalMissionComplete.surfaceProblemCount.html(surfaceProblemCount);
    this._uiModalMissionComplete.noSidewalk.html(noSidewalkCount);
    this._uiModalMissionComplete.otherCount.html(otherCount);
};

function ModalMissionCompleteMap(uiModalMissionComplete) {
    // Map visualization
    L.mapbox.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var self = this;

    // These two are defined globally so that they can be added in show and removed in hide.
    this._overlayPolygon = null;
    this._overlayPolygonLayer = null;
    this._ui = uiModalMissionComplete;
    this._completedTasksLayer = [];
    this.neighborhoodBounds = null;

    this._map = L.mapbox.map(uiModalMissionComplete.map.get(0), null, {
        maxZoom: 19,
        minZoom: 10,
        style: 'mapbox://styles/projectsidewalk/civfm8qwi000l2iqo9ru4uhhj',
        zoomSnap: 0.25
    }).addLayer(L.mapbox.styleLayer('mapbox://styles/mapbox/light-v10'));

    // Set the city-specific default zoom, location, and max bounding box to prevent the user from panning away.
    $.getJSON('/cityMapParams', function(data) {
        var southWest = L.latLng(data.southwest_boundary.lat, data.southwest_boundary.lng);
        var northEast = L.latLng(data.northeast_boundary.lat, data.northeast_boundary.lng);
        self._map.setMaxBounds(L.latLngBounds(southWest, northEast));

        // Gray out a large area around the city with the neighborhood cut out to highlight the neighborhood.
        var largeBoundary = [
            [data.southwest_boundary.lng + 5,data.southwest_boundary.lat - 5],
            [data.southwest_boundary.lng + 5,data.southwest_boundary.lat + 5],
            [data.southwest_boundary.lng - 5, data.southwest_boundary.lat + 5],
            [data.southwest_boundary.lng - 5,data.southwest_boundary.lat - 5]
        ];

        // Add a small buffer around the neighborhood because it looks prettier.
        var neighborhoodGeom = svl.neighborhoodContainer.getCurrentNeighborhood().getGeoJSON();
        var neighborhoodBuffer = turf.buffer(neighborhoodGeom, 0.04, { units: 'miles' });
        self._overlayPolygon = {
            'type': 'FeatureCollection',
            'features': [{
                'type': 'Feature',
                'geometry': {'type': 'Polygon', 'coordinates': [largeBoundary, neighborhoodBuffer.geometry.coordinates[0]]}
            }]};
        self._overlayPolygonLayer = L.geoJson(self._overlayPolygon);
        self._overlayPolygonLayer.setStyle({ 'opacity': 0, 'fillColor': 'rgb(110, 110, 110)', 'fillOpacity': 0.25});
        self._overlayPolygonLayer.addTo(self._map);

        // Zoom/pan the map to the neighborhood.
        self.neighborhoodBounds = L.geoJson(neighborhoodBuffer).getBounds();
        self._map.fitBounds(self.neighborhoodBounds);
    });

    this._addMissionTasksAndAnimate = function(completedTasks, missionId) {
        var route;
        var i, j;
        var path;
        var missionStart;
        var features = [];
        for (i = 0; i < completedTasks.length; i++) {
            var latlngs = [];

            // If only part of this street was completed during the mission, get the corresponding subset of the
            // coordinates for the street, otherwise we can just use the full route.
            missionStart = completedTasks[i].getMissionStart(missionId);
            if (missionStart || !completedTasks[i].isComplete()) {
                var start = missionStart ? missionStart : completedTasks[i].getStartCoordinate();
                var end;
                if (completedTasks[i].isComplete()) {
                    end = completedTasks[i].getLastCoordinate();
                } else {
                    var farthestPoint = completedTasks[i].getFurthestPointReached().geometry.coordinates;
                    end = { lat: farthestPoint[1], lng: farthestPoint[0] };
                }
                route = completedTasks[i].getSubsetOfCoordinates(start.lat, start.lng, end.lat, end.lng)
            } else {
                route = completedTasks[i].getGeometry().coordinates;
            }

            // Take the list of coordinates and put it in the format needed to make polylines.
            for (j = 0; j < route.length; j++) {
                latlngs.push(new L.LatLng(route[j][1], route[j][0]));
            }
            path = L.polyline(latlngs, { color: 'rgb(20,220,120)', opacity: 1, weight: 4, snakingSpeed: 20 });
            features.push(path);
        }
        // Add the list of lines to the map and animate them with snakeIn().
        var featureGroup = L.featureGroup(features);
        self._completedTasksLayer.push(featureGroup);
        self._map.addLayer(featureGroup);
        featureGroup.snakeIn();
    };

    /**
     * This method takes tasks that has been completed in the current mission and *all* the tasks completed in the
     * current neighborhood so far.
     * WARNING: `completedTasks` include tasks completed in the current mission too.
     *
     * @param missionTasks
     * @param completedTasks
     * @param allCompletedTasks
     * @param missionId
     * @private
     */
    this.updateStreetSegments = function (missionTasks, completedTasks, allCompletedTasks, missionId) {
        var i;
        var leafletLine;
        var layer;
        var completedTaskAllUsersLayerStyle = { color: 'rgb(100,100,100)', opacity: 1, weight: 3 };
        var completedTaskLayerStyle = { color: 'rgb(70,130,180)', opacity: 1, weight: 4 };
        var leafletMap = this._map;

        // Reset map zoom to show the whole neighborhood.
        self._map.fitBounds(self.neighborhoodBounds);

        // Remove previous tasks.
        _.each(this._completedTasksLayer, function(element) {
            leafletMap.removeLayer(element);
        });

        // If the current street is long enough that the user started their mission mid-street and finished their
        // mission before completing the street, then we add to `completedTasks` so that we can draw the old part.
        var currTask = missionTasks.filter(function (t) { return !t.isComplete() && t.getMissionStart(missionId); })[0];
        if (currTask) completedTasks.push(currTask);

        var newStreets = missionTasks.map( function (t) { return t.getStreetEdgeId(); });
        var userOldStreets = completedTasks.map( function(t) { return t.getStreetEdgeId(); });

        // Add the other users' tasks layer
        for (i = 0; i < allCompletedTasks.length; i++) {
            var otherUserStreet = allCompletedTasks[i].getStreetEdgeId();
            if(userOldStreets.indexOf(otherUserStreet) === -1 && newStreets.indexOf(otherUserStreet) === -1){
                leafletLine = L.geoJson(allCompletedTasks[i].getFeature());
                layer = leafletLine.addTo(this._map);
                layer.setStyle(completedTaskAllUsersLayerStyle);
                this._completedTasksLayer.push(layer);
            }
        }

        // Add the completed task layer.
        for (i = 0; i < completedTasks.length; i++) {
            leafletLine = null;
            // If the street was not part of this mission, draw the full street.
            var newStreetIdx = newStreets.indexOf(completedTasks[i].getStreetEdgeId());
            if (newStreetIdx === -1) {
                leafletLine = L.geoJson(completedTasks[i].getFeature());
            } else {
                // If a nontrivial part of a street in this mission was completed in a previous mission (say, 3 meters),
                // draw the part that was completed in previous missions.
                var currStreet = missionTasks[newStreetIdx];
                var missionStart = currStreet ? currStreet.getMissionStart(missionId) : null;
                var streetStart = currStreet ? currStreet.getStartCoordinate() : null;
                var distFromStart = null;
                if (missionStart && streetStart) {
                    distFromStart = turf.distance(turf.point([streetStart.lng, streetStart.lat]),
                                                  turf.point([missionStart.lng, missionStart.lat]));
                }
                if (missionStart && streetStart && distFromStart > 0.003) {
                    var route = currStreet.getSubsetOfCoordinates(streetStart.lat, streetStart.lng, missionStart.lat, missionStart.lng);
                    var reversedRoute = [];
                    route.forEach(coord => reversedRoute.push([coord[1], coord[0]]));
                    leafletLine = L.polyline(reversedRoute);
                }
            }

            // If we made a layer to draw, then draw it.
            if (leafletLine) {
                layer = leafletLine.addTo(this._map);
                layer.setStyle(completedTaskLayerStyle);
                this._completedTasksLayer.push(layer);
            }
        }

        // Add the current mission animation layer.
        self._addMissionTasksAndAnimate(missionTasks, missionId);
    };
}

/**
 * Hide the leaflet map
 */
ModalMissionCompleteMap.prototype.hide = function () {
    this._ui.map.css('top', 500);
    this._ui.map.css('left', -500);
    $('.leaflet-clickable').css('visibility', 'hidden');
    $('.leaflet-control-attribution').remove();
    $('.g-bar-chart').css('visibility', 'hidden');
    $('.leaflet-zoom-animated path').css('visibility', 'hidden');
};

/**
 * Show the leaflet map
 */
ModalMissionCompleteMap.prototype.show = function () {
    this._ui.map.css('top', 0);  // Leaflet map overlaps with the ViewControlLayer
    this._ui.map.css('left', 15);

    $('.leaflet-clickable').css('visibility', 'visible');
    $('.g-bar-chart').css('visibility', 'visible');
    $('.leaflet-zoom-animated path').css('visibility', 'visible');
};

function ModalMissionCompleteProgressBar (uiModalMissionComplete) {
    var $completeBar = uiModalMissionComplete.holder.find("#modal-mission-complete-complete-bar");
    var svgCoverageBarWidth = 370,
        svgCoverageBarHeight = 20;
    var svgCoverageBar = d3.select($completeBar.get(0))
        .append("svg")
        .attr("width", svgCoverageBarWidth)
        .attr("height", svgCoverageBarHeight);

    var gBackground = svgCoverageBar.append("g").attr("class", "g-background");
    var horizontalBarBackground = gBackground.selectAll("rect")
        .data([1])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(220, 220, 220, 1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", svgCoverageBarWidth);

    var gBarChart = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarOtherContribution = gBarChart.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr('id', 'gray-bar')
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(80,80,80,1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);

    var gBarChart2 = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarPreviousContribution = gBarChart2.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr('id', 'blue-bar')
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(70,130,180,1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);

    var gBarChart3 = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarMission = gBarChart3.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr('id', 'green-bar')
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(20,220,120,1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);
    var horizontalBarMissionLabel = gBarChart3.selectAll("text")
        .data([""])
        .enter().append("text")
        .attr('id', 'bar-text')
        .attr("x", 3)
        .attr("y", 15)
        .attr("dx", 0)
        .attr("fill", "white")
        .attr("font-size", "10pt")
        .text(function (d) {
            return d;
        })
        .style("visibility", "hidden");

    /**
     * Update the bar graph visualization
     * @param missionDistanceRate
     * @param userAuditedDistanceRate
     * @param otherAuditedDistanceRate
     * @private
     */
    this.update = function (missionDistanceRate, userAuditedDistanceRate, otherAuditedDistanceRate) {

        // Round the rates to 0.01 accuracy.
        var roundedMissionDistanceRate = parseFloat(missionDistanceRate.toFixed(3));
        var roundedUserAuditedDistanceRate = parseFloat(userAuditedDistanceRate.toFixed(3));
        var roundedOtherAuditedDistanceRate = parseFloat(otherAuditedDistanceRate.toFixed(3));

        horizontalBarOtherContribution.attr("width", 0)
            .transition()
            .delay(200)
            .duration(600)
            .attr("width", roundedOtherAuditedDistanceRate * svgCoverageBarWidth);

        horizontalBarPreviousContribution.attr("width", 0)
            .attr("x", roundedOtherAuditedDistanceRate * svgCoverageBarWidth)
            .transition()
            .delay(800)
            .duration(600)
            .attr("width", roundedUserAuditedDistanceRate * svgCoverageBarWidth);

        horizontalBarMission.attr("width", 0)
            .attr("x", (roundedOtherAuditedDistanceRate + roundedUserAuditedDistanceRate) * svgCoverageBarWidth)
            .transition()
            .delay(1400)
            .duration(600)
            .attr("width", Math.max(1, roundedMissionDistanceRate * svgCoverageBarWidth));
        horizontalBarMissionLabel.text(parseInt(((roundedUserAuditedDistanceRate + roundedMissionDistanceRate) * 100).toString(), 10) + "%");
    };
}
function ModalModel () {
    var self = this;
}

_.extend(ModalModel.prototype, Backbone.Events);

ModalModel.prototype.showModalExample = function (labelType) {
    this.trigger("ModalExample:show", labelType);
};

ModalModel.prototype.showModalMissionComplete = function () {
    this.trigger("ModalMissionComplete:show");
};

ModalModel.prototype.triggerMissionCompleteClosed = function (parameters) {
    this.trigger("ModalMissionComplete:closed", parameters);
};

ModalModel.prototype.updateModalMissionComplete = function (mission, neighborhood) {
    this.trigger("ModalMissionComplete:update", { mission: mission, neighborhood: neighborhood });
};
/**
 * ModalSkip module.
 * Todo. Too many dependencies. Break down the features.
 * Todo. handling uiLeftColumn (menu on the left side of the interface) should be LeftMenu's responsibility
 * @constructor
 */
function ModalSkip(form, onboardingModel, ribbonMenu, taskContainer, tracker, uiLeftColumn, uiModalSkip) {
    var self = this;
    var blinkInterval;

    onboardingModel.on("Onboarding:startOnboarding", function() {
        self.hideSkipMenu();
    });

    /**
     * Callback for clicking jump button.
     * @param e
     */
    this._handleClickJump = function(e) {
        e.preventDefault();
        tracker.push('ModalSkip_ClickJump');
        svl.modalComment.hide();
        self.showSkipMenu();
    };

    this.enableStuckButton = function() {
        uiLeftColumn.stuck.on('click', this._handleClickStuck);
    }

    this.disableStuckButton = function() {
        uiLeftColumn.stuck.off('click');
    }

    /**
     * Callback for clicking stuck button.
     *
     * The algorithm searches for available GSV imagery along the street you are assigned to. If the pano you are put in
     * doesn't help, you can click the Stuck button again; we save the attempted panos so we'll try something new. If we
     * can't find anything along the street, we just mark it as complete and move you to a new street.
     */
    this._handleClickStuck = function(e) {
        e.preventDefault();
        svl.stuckAlert.compassOrStuckClicked();
        tracker.push('ModalStuck_ClickStuck');
        svl.map.moveForward('ModalStuck_Unstuck', 'ModalStuck_GSVNotAvailable', svl.stuckAlert.stuckClicked);
    }

    /**
     * This method handles a click Unavailable event.
     * @param e
     */
    this._handleClickUnavailable = function(e) {
        tracker.push("ModalSkip_ClickUnavailable");
        var task = taskContainer.getCurrentTask();
        form.skip(task, "GSVNotAvailable");

        ribbonMenu.backToWalk();
        self.hideSkipMenu();
    };

    /**
     * This method handles a click Continue Neighborhood event.
     * @param e
     */
    this._handleClickContinueNeighborhood = function(e) {
        tracker.push("ModalSkip_ClickContinueNeighborhood");
        uiModalSkip.secondBox.hide();
        uiModalSkip.firstBox.show();
        var task = taskContainer.getCurrentTask();
        form.skip(task, "IWantToExplore");

        ribbonMenu.backToWalk();
        self.hideSkipMenu();
    };

    /**
     * This method handles a click Redirect event.
     * @param e
     */
     this._handleClickRedirect = function(e) {
        tracker.push("ModalSkip_ClickRedirect");
         window.location.replace('/audit?nextRegion=regular');
     };

    /**
     * This method handles a click Explore event.
     * @param e
     */
     this._handleClickExplore = function(e) {
        tracker.push("ModalSkip_ClickExplore");
         uiModalSkip.firstBox.hide();
         uiModalSkip.secondBox.show();
     };

    /**
     * This method handles a click Cancel event on the first jump screen.
     * @param e
     */
    this._handleClickCancelFirst = function(e) {
        tracker.push("ModalSkip_ClickCancelFirst");
        self.hideSkipMenu();
    };

    /**
     * This method handles a click Cancel event on the second jump screen.
     * @param e
     */
    this._handleClickCancelSecond = function(e) {
        tracker.push("ModalSkip_ClickCancelSecond");
        uiModalSkip.secondBox.hide();
        uiModalSkip.firstBox.show();
        self.hideSkipMenu();
    };

    /**
     * Blink the stuck button.
     * Todo. This should be moved LeftMenu.js
     */
    this.blink = function() {
        self.stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiLeftColumn.stuck.toggleClass("highlight-100");
        }, 500);
    };

    /**
     * Hide the skip menu.
     */
    this.hideSkipMenu = function() {
        uiModalSkip.holder.addClass('hidden');
        svl.popUpMessage.enableInteractions();
        self.hideBackground();
    };

    /**
     * Show the skip menu.
     */
    this.showSkipMenu = function() {
        uiModalSkip.holder.removeClass('hidden');
        svl.popUpMessage.disableInteractions();
        self.showBackground();
    };

    this.hideBackground = function() {
        $('#modal-skip-background').css({ width: '', height: ''})
    };

    this.showBackground = function() {
        $('#modal-skip-background').css("background-color", "white");
        $('#modal-skip-background').css({
            width: '100%',
            height: '100%',
            opacity: '0.5',
            visibility: 'visible'
        });
    };

    /**
     * Stop blinking the jump button.
     * Todo. This should be moved to LeftMenu.js
     */
    this.stopBlinking = function() {
        window.clearInterval(blinkInterval);
        uiLeftColumn.stuck.removeClass("highlight-100");
    };

    // Initialize
    uiModalSkip.unavailable.bind("click", this._handleClickUnavailable);
    uiModalSkip.continueNeighborhood.bind("click", this._handleClickContinueNeighborhood);
    uiModalSkip.cancelFirst.bind("click", this._handleClickCancelFirst);
    uiModalSkip.cancelSecond.bind("click", this._handleClickCancelSecond);
    uiModalSkip.redirect.bind("click", this._handleClickRedirect);
    uiModalSkip.explore.bind("click", this._handleClickExplore);
    uiLeftColumn.jump.on('click', this._handleClickJump);
    self.enableStuckButton();
}

/**
 * Compass module
 * @param svl SVL name space. Need this for rootDirectory.
 * @param mapService MapService module
 * @param taskContainer TaskContainer module
 * @param uiCompass ui elements. // Todo. Future work. Just pass the top level ui element.
 * @constructor
 */
function Compass (svl, mapService, taskContainer, uiCompass) {
    var self = {className: 'Compass'};
    var blinkInterval;
    var blinkTimer;

    var imageDirectories = {
        leftTurn: svl.rootDirectory + 'img/icons/ArrowLeftTurn.png',
        rightTurn: svl.rootDirectory + 'img/icons/ArrowRightTurn.png',
        slightLeft: svl.rootDirectory + 'img/icons/ArrowSlightLeft.png',
        slightRight: svl.rootDirectory + 'img/icons/ArrowSlightRight.png',
        straight: svl.rootDirectory + 'img/icons/ArrowStraight.png',
        uTurn: svl.rootDirectory + 'img/icons/ArrowUTurn.png'
    };

    /**
     * Blink the compass message
     */
    function blink() {
        self.stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiCompass.messageHolder.toggleClass("white-background-75");
            uiCompass.messageHolder.toggleClass("highlight-50");
        }, 500);
    }

    function getCompassMessageHolder() {
        return uiCompass;
    }

    /**
     * Get the angle to the next goal.
     * @returns {number}
     */
    function getTargetAngle() {
        var task = taskContainer.getCurrentTask();
        var latlng = mapService.getPosition();
        var geometry = task.getGeometry();  // get the street geometry of the current task
        var coordinates = geometry.coordinates;  // get the latlng coordinates of the streets
        var distArray = coordinates.map(function(o) {
            return Math.sqrt(_norm(latlng.lat, latlng.lng, o[1], o[0]));
        });
        var minimum = Math.min.apply(Math, distArray);
        var argmin = distArray.indexOf(minimum);
        var argTarget;
        argTarget = (argmin < (coordinates.length - 1)) ? argmin + 1 : geometry.coordinates.length - 1;

        return util.math.toDegrees(Math.atan2(coordinates[argTarget][0] - latlng.lng, coordinates[argTarget][1] - latlng.lat));
    }

    /**
     * Check if the user is following the route that we specified
     * @param threshold
     * @param unit
     * @returns {boolean}
     */
    function _checkEnRoute (threshold, unit) {
        var task = taskContainer.getCurrentTask();
        if (!unit) unit = {units: 'kilometers'};
        if (!threshold) threshold = 0.05;  // 50 m

        if (task) {
            var geojson = task.getGeoJSON(),
                latlng = mapService.getPosition(),
                line = geojson.features[0],
                currentPoint = turf.point([latlng.lng, latlng.lat]),
                snapped = turf.nearestPointOnLine(line, currentPoint);
            return turf.distance(currentPoint, snapped, unit) < threshold;
        }
        return true;
    }

    function _jumpBackToTheRoute() {
        var task = taskContainer.getCurrentTask();
        var coordinate = task.getStartCoordinate();
        mapService.preparePovReset();
        mapService.setPosition(coordinate.lat, coordinate.lng);
        mapService.setPovToRouteDirection();
    }

    function enableCompassClick() {
        uiCompass.messageHolder.on('click', _handleCompassClick);
        uiCompass.messageHolder.css('cursor', 'pointer');
    }

    function disableCompassClick() {
        uiCompass.messageHolder.off('click', _handleCompassClick);
        uiCompass.messageHolder.css('cursor', 'default');
    }

    /*
     * Part of the new jump mechanism
     */
    //  ** start **

    function cancelTimer() {
        window.clearTimeout(blinkTimer);
    }

    function resetBeforeJump () {
        cancelTimer();
        removeLabelBeforeJumpMessage();
        mapService.resetBeforeJumpLocationAndListener();
    }

    function _jumpToTheNewRoute () {

        svl.tracker.push('LabelBeforeJump_Jump');
        // Finish the current task
        mapService.finishCurrentTaskBeforeJumping();

        // Finish clean up tasks before jumping
        resetBeforeJump();

        var task = taskContainer.getBeforeJumpNewTask();
        taskContainer.setCurrentTask(task);
        mapService.moveToTheTaskLocation(task);
        svl.jumpModel.triggerUserClickJumpMessage();
    }

    function _makeTheLabelBeforeJumpMessageBoxClickable () {
        uiCompass.messageHolder.on('click', _jumpToTheNewRoute);
        uiCompass.messageHolder.css('cursor', 'pointer');
    }

    function _makeTheLabelBeforeJumpMessageBoxUnclickable () {
        uiCompass.messageHolder.off('click', _jumpToTheNewRoute);
        uiCompass.messageHolder.css('cursor', 'default');
    }

    function showLabelBeforeJumpMessage () {
        // Start blinking after 15 seconds
        blinkTimer = window.setTimeout(function () {
            svl.tracker.push('LabelBeforeJump_Blink');
            self.blink();
        }, 15000);
        self.disableCompassClick();
        _makeTheLabelBeforeJumpMessageBoxClickable();
        self.setLabelBeforeJumpMessage();
    }

    function removeLabelBeforeJumpMessage () {
        self.stopBlinking();
        _makeTheLabelBeforeJumpMessageBoxUnclickable();
        self.enableCompassClick();
    }
    // ** end **

    /**
     * Get the compass angle
     * @returns {number}
     */
    function _getCompassAngle () {
        var heading = mapService.getPov().heading;
        var targetAngle = getTargetAngle();
        return (heading - targetAngle) % 360;
    }

    /**
     * Mapping from a direction to an image path of direction icons.
     * @param direction
     * @returns {string|*}
     */
    function directionToImagePath (direction) {
        switch (direction) {
            case "straight":
                return imageDirectories.straight;
            case "slight-right":
                return imageDirectories.slightRight;
            case "slight-left":
                return imageDirectories.slightLeft;
            case "right":
                return imageDirectories.rightTurn;
            case "left":
                return imageDirectories.leftTurn;
            case "u-turn":
                return imageDirectories.uTurn;
            default:
        }
    }

    /**
     * Hide a message
     */
    function hideMessage () {
        uiCompass.messageHolder.removeClass("fadeInUp").addClass("fadeOutDown");
        uiCompass.messageHolder.css('pointer-events', 'none');
    }

    /**
     * Set the compass message.
     */
    function setTurnMessage () {
        var image,
            message,
            angle = _getCompassAngle(),
            direction = _angleToDirection(angle);

        image = "<img src='" + directionToImagePath(direction) + "' class='compass-turn-images' alt='Turn icon' />";
        message =  "<span class='compass-message-small'>" + i18next.t('center-ui.compass.unlabeled-problems') + "</span><br/>" +
            image + "<span class='bold'>" + _directionToDirectionMessage(direction) + "</span>";
        uiCompass.message.html(message);
    }

    function setLabelBeforeJumpMessage () {
        uiCompass.message.html("<div style='width: 20%'>" + i18next.t('center-ui.compass.end-of-route') + "</div>");
    }

    function _setBackToRouteMessage() {
        uiCompass.message.html(i18next.t('center-ui.compass.far-away'));
    }

    /**
     * Show a message
     */
    function showMessage () {
        uiCompass.messageHolder.removeClass("fadeOutDown").addClass("fadeInUp");
        uiCompass.messageHolder.css('pointer-events', 'auto');
    }

    /**
     * Stop blinking the compass message.
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        blinkInterval = null;
        uiCompass.messageHolder.addClass("white-background-75");
        uiCompass.messageHolder.removeClass("highlight-50");
    }

    /**
     * Update the compass message.
     */
    function update () {
        if (!mapService.getLabelBeforeJumpListenerStatus() && !svl.isOnboarding()) {
            if (_checkEnRoute()) {
                self.stopBlinking();
                self.setTurnMessage();
            } else {
                self.blink();
                _setBackToRouteMessage();
            }
        }

    }

    /**
     * Mapping from an angle to a direction
     * @param angle
     * @returns {*}
     */
    function _angleToDirection (angle) {
        angle = (angle + 360) % 360;
        if (angle < 20 || angle > 340)
            return "straight";
        else if (angle >= 20 && angle < 45)
            return "slight-left";
        else if (angle <= 340 && angle > 315)
            return "slight-right";
        else if (angle >= 35 && angle < 150)
            return "left";
        else if (angle <= 315 && angle > 210)
            return "right";
        else if (angle <= 210 && angle >= 150) {
            return "u-turn";
        }
        else {
            console.debug("It shouldn't reach here.");
        }
    }

    /**
     * Mapping from direction to a description of the direction
     * @param direction
     * @returns {*}
     */
    function _directionToDirectionMessage (direction) {
        switch (direction) {
            case "straight":
                return i18next.t('center-ui.compass.straight');
            case "slight-right":
                return i18next.t('center-ui.compass.slight-right');
            case "slight-left":
                return i18next.t('center-ui.compass.slight-left');
            case "right":
                return i18next.t('center-ui.compass.right');
            case "left":
                return i18next.t('center-ui.compass.left');
            case "u-turn":
                return i18next.t('center-ui.compass.u-turn');
            default:
        }
    }


    /**
     * Return the sum of square of lat and lng diffs
     * */
    function _norm(lat1, lng1, lat2, lng2) {
        return Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2);
    }

    /**
     * Update the message
     * @param streetName
     */
    function updateMessage(streetName) {
        self.setTurnMessage(streetName);
    }

    // Performs the action written in the compass message for the user (turning, moving ahead, jumping).
    function _handleCompassClick() {
        if (_checkEnRoute()) {
            svl.stuckAlert.compassOrStuckClicked();

            var angle = _getCompassAngle();
            var direction = _angleToDirection(angle);
            svl.tracker.push(`Click_Compass_Direction=${direction}`);

            if (direction === 'straight') {
                mapService.moveForward('CompassMove_Success', 'CompassMove_GSVNotAvailable', null);
            } else {
                mapService.setPovToRouteDirection(250);
            }
        } else {
            svl.tracker.push('Click_Compass_FarFromRoute');
            _jumpBackToTheRoute();
        }
    }
    enableCompassClick();

    self.blink = blink;
    self.directionToImagePath = directionToImagePath;
    self.resetBeforeJump = resetBeforeJump;
    self.getCompassMessageHolder = getCompassMessageHolder;
    self.getTargetAngle = getTargetAngle;
    self.hideMessage = hideMessage;
    self.setTurnMessage = setTurnMessage;
    self.enableCompassClick = enableCompassClick;
    self.disableCompassClick = disableCompassClick;
    self.setLabelBeforeJumpMessage = setLabelBeforeJumpMessage;
    self.stopBlinking = stopBlinking;
    self.showMessage = showMessage;
    self.showLabelBeforeJumpMessage = showLabelBeforeJumpMessage;
    self.removeLabelBeforeJumpMessage = removeLabelBeforeJumpMessage;
    self.update = update;
    self.updateMessage = updateMessage;

    return self;
}
/**
 * Todo. This module needs to be cleaned up.
 * Todo. Separate the Google Maps component (UI and logic) and Street View component (UI and logic).
 * @param canvas
 * @param neighborhoodModel
 * @param uiMap
 * @param params
 * @returns {{className: string}}
 * @constructor
 */
function MapService (canvas, neighborhoodModel, uiMap, params) {
    var self = { className: 'Map' },
        _canvas = canvas,
        prevPanoId = undefined,
        properties = {
            browser : 'unknown',
            latlng : {
                lat : undefined,
                lng : undefined
            },
            panoramaPov : {
                heading : 359,
                pitch : -10,
                zoom : 1
            },
            map: null,
            maxPitch: 0,
            minPitch: -35,
            minHeading: undefined,
            maxHeading: undefined,
            isInternetExplore: undefined
        },
        status = {
            currentPanoId: undefined,
            disablePanning: false,
            disableWalking : false,
            hideNonavailablePanoLinks : false,
            lockDisablePanning: false,
            lockDisableWalking : false,
            panoLinkListenerSet: false,
            bottomLinksClickable: false,
            svLinkArrowsLoaded : false,
            labelBeforeJumpListenerSet: false,
            jumpMsgShown: false,
            jumpImageryNotFoundStatus: undefined
        },
        listeners = {
            beforeJumpListenerHandle: undefined
        },
        jumpLocation = undefined,
        missionJump = undefined,
        contextMenuWasOpen = false,
        _stuckPanos = [];

    var initialPositionUpdate = true,
        panoramaOptions,
        STREETVIEW_MAX_DISTANCE = 50,
        END_OF_STREET_THRESHOLD = 25, // Distance from the endpoint of the street when we consider it complete (meters).
        minimapPaneBlinkInterval,
        moveDelay = 800; //delayed move
    //Move delay exists because too quick navigation causes rendering issues/black screens with no panos
    //No current solution to check that pano view is completely loaded before navigating
    //Hard delay is 2nd best option.

    // Used while calculation of canvas coordinates during rendering of labels
    // TODO: Refactor it to be included in the status variable above so that we can use
    // svl.map.setStatus("povChange", true); Instead of povChange["status"] = true;
    var povChange = {
        status: false
    };

    // Mouse status and mouse event callback functions
    var mouseStatus = {
        currX: 0,
        currY: 0,
        prevX: 0,
        prevY: 0,
        leftDownX: 0,
        leftDownY: 0,
        leftUpX: 0,
        leftUpY: 0,
        isLeftDown: false
    };

    // Maps variables
    var fenway, map, mapOptions, mapStyleOptions;

    // Map UI setting
    // http://www.w3schools.com/googleAPI/google_maps_controls.asp
    if (params.panoramaPov) {
        properties.panoramaPov = params.panoramaPov;
    } else {
        properties.panoramaPov = {
            heading: 0,
            pitch: 0,
            zoom: 1
        };
    }
    if (params.latlng) {
        properties.latlng = params.latlng;
    } else if (('lat' in params) && ('lng' in params)) {
        properties.latlng = {'lat': params.lat, 'lng': params.lng};
    } else {
        throw self.className + ': latlng not defined.';
    }

    // fenway = new google.maps.LatLng(params.targetLat, params.targetLng);
    fenway = typeof google != "undefined" ? new google.maps.LatLng(properties.latlng.lat, properties.latlng.lng) : null;

    mapOptions = {
        center: fenway,
        mapTypeControl:false,
        mapTypeId: typeof google != "undefined" ? google.maps.MapTypeId.ROADMAP : null,
        maxZoom : 20,
        minZoom : 14,
        overviewMapControl:false,
        panControl:false,
        rotateControl:false,
        scaleControl:false,
        streetViewControl:true,
        zoomControl:false,
        zoom: 18,
        backgroundColor: "none",
        disableDefaultUI: true
    };

    var mapCanvas = document.getElementById("minimap");
    map = typeof google != "undefined" ? new google.maps.Map(mapCanvas, mapOptions) : null;

    // Styling google map.
    // http://stackoverflow.com/questions/8406636/how-to-remove-all-from-google-map
    // http://gmaps-samples-v3.googlecode.com/svn/trunk/styledmaps/wizard/index.html
    mapStyleOptions = [
        {
            featureType: "all",
            stylers: [
                { visibility: "off" }
            ]
        },
        {
            featureType: "road",
            stylers: [
                { visibility: "on" }
            ]
        },
        {
            "elementType": "labels",
            "stylers": [
                { "visibility": "off" }
            ]
        }
    ];

    if (map) map.setOptions({styles: mapStyleOptions});

    function _init(params) {
        params = params || {};

        self.properties = properties; // Make properties public.
        properties.browser = util.getBrowser();

        // Set GSV panorama options
        // To not show StreetView controls, take a look at the following gpage
        // http://blog.mridey.com/2010/05/controls-in-maps-javascript-api-v3.html
        // Set 'mode' to 'html4' in the SV panoramaOption.
        // https://groups.google.com/forum/?fromgroups=#!topic/google-maps-js-api-v3/q-SjeW19TJw
        if (params.lat && params.lng) {
            fenway = new google.maps.LatLng(params.lat, params.lng);
            panoramaOptions = {
                mode : 'html4',
                position: fenway,
                pov: properties.panoramaPov,
                showRoadLabels: false,
                motionTracking: false,
                motionTrackingControl: false
            };
        } else {
            console.warn(self.className + ' init(): The pano id nor panorama position is given. Cannot initialize the panorama.');
        }

        var panoCanvas = document.getElementById('pano');
        svl.panorama = typeof google != "undefined" ? new google.maps.StreetViewPanorama(panoCanvas, panoramaOptions) : null;

        svl.panorama.registerPanoProvider(function(pano) {
            if (pano === 'tutorial' || pano === 'afterWalkTutorial') {
                return getCustomPanorama(pano);
            }
            return null;
        });

        if (svl.panorama) {
            svl.panorama.set('addressControl', false);
            svl.panorama.set('clickToGo', false);
            svl.panorama.set('disableDefaultUI', true);
            svl.panorama.set('linksControl', true);
            svl.panorama.set('navigationControl', false);
            svl.panorama.set('showRoadLabels', true);
            svl.panorama.set('panControl', false);
            svl.panorama.set('scrollwheel', false);
            svl.panorama.set('zoomControl', false);
            svl.panorama.set('keyboardShortcuts', true);
        }

        // Attach listeners to dom elements
        uiMap.viewControlLayer.bind('mousedown', handlerViewControlLayerMouseDown);
        uiMap.viewControlLayer.bind('mouseup', handlerViewControlLayerMouseUp);
        uiMap.viewControlLayer.bind('mousemove', handlerViewControlLayerMouseMove);
        uiMap.viewControlLayer.bind('mouseleave', handlerViewControlLayerMouseLeave);

        uiMap.viewControlLayer[0].onselectstart = function () { return false; };

        // Issue: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2468
        // This line of code is here to fix the bug when zooming with ctr +/-, the screen turns black.
        // We are updating the pano POV slightly to simulate an update the gets rid of the black pano.
        $(window).on('resize', function() {
            updatePov(.01,.01);
        });

        // Add listeners to the SV panorama
        // https://developers.google.com/maps/documentation/javascript/streetview#StreetViewEvents
        if (typeof google != "undefined") {
            google.maps.event.addListener(svl.panorama, "pov_changed", handlerPovChange);
            google.maps.event.addListener(svl.panorama, "position_changed", handlerPositionUpdate);
            google.maps.event.addListener(svl.panorama, "pano_changed", handlerPanoramaChange);
            google.maps.event.addListenerOnce(svl.panorama, "pano_changed", switchToExploreMode);
            google.maps.event.addListener(svl.panorama, "zoom_changed", handlerZoomChange);
        }

        // Connect the map view and panorama view.
        if (map && svl.panorama) map.setStreetView(svl.panorama);

        // For Internet Explore, append an extra canvas in view-control-layer.
        properties.isInternetExplore = $.browser['msie'];
        if (properties.isInternetExplore) {
            uiMap.viewControlLayer.append('<canvas width="720px" height="480px"  class="window-streetview" style=""></canvas>');
        }

    }

    /**
     * If the user is going through the tutorial, it will return the custom/stored panorama for either the initial
     * tutorial view or the "after walk" view.
     * @param pano - the pano ID/name of the wanted custom panorama.
     * @returns custom Google Street View panorama.
     * */
    function getCustomPanorama(pano) {
        if (pano === 'tutorial') {
            return {
                location: {
                    pano: 'tutorial',
                    latLng: new google.maps.LatLng(38.94042608, -77.06766133)
                },
                links: [],
                copyright: 'Imagery (c) 2010 Google',
                tiles: {
                    tileSize: new google.maps.Size(2048, 1024),
                    worldSize: new google.maps.Size(4096, 2048),
                    centerHeading: 51,
                    getTileUrl: function(pano, zoom, tileX, tileY) {
                        return svl.rootDirectory + "img/onboarding/tiles/tutorial/" + zoom + "-" + tileX + "-" + tileY + ".jpg";
                    }
                }
            };
        } else if (pano === 'afterWalkTutorial') {
            return {
                location: {
                    pano: 'afterWalkTutorial',
                    latLng: new google.maps.LatLng(38.94061618, -77.06768201)
                },
                links: [],
                copyright: 'Imagery (c) 2010 Google',
                tiles: {
                    tileSize: new google.maps.Size(1700, 850),
                    worldSize: new google.maps.Size(3400, 1700),
                    centerHeading: 344,
                    getTileUrl: function(pano, zoom, tileX, tileY) {
                        return svl.rootDirectory + "img/onboarding/tiles/afterwalktutorial/" + zoom + "-" + tileX + "-" + tileY + ".jpg";
                    }
                }
            };
        }
    }

    /**
     * Disable walking thoroughly and indicate that user is moving.
     */
    function timeoutWalking() {
        svl.panorama.set('linksControl', false);
        svl.keyboard.setStatus("disableKeyboard", true);
        disableWalking();
        svl.keyboard.setStatus("moving", true);
    }

    /**
     * Enable walking and indicate that user has finished moving.
     */
    function resetWalking() {
        svl.panorama.set('linksControl', true);
        svl.keyboard.setStatus("disableKeyboard", false);
        enableWalking();
        svl.keyboard.setStatus("moving", false);
    }

    /*
     * Get the status of the labelBeforeJump listener.
     */
    function getLabelBeforeJumpListenerStatus() {
        return status.labelBeforeJumpListenerSet;
    }

    /*
     * Set the status of the labelBeforeJump listener.
     */
    function setLabelBeforeJumpListenerStatus(statusToSet) {
        status.labelBeforeJumpListenerSet = statusToSet;
    }

    /**
     * A helper function to move a user to the task location.
     * @param task
     * @param caller
     * @private
     */
    function moveToTheTaskLocation(task, caller) {
        // Reset all jump parameters.
        if (status.labelBeforeJumpListenerSet) {
            setLabelBeforeJumpListenerStatus(false);
            resetBeforeJumpLocationAndListener();
        }

        var callback = function (data, status) {
            if (status !== google.maps.StreetViewStatus.OK) {
                util.misc.reportNoStreetView(task.getStreetEdgeId());
                svl.taskContainer.endTask(task);

                // Get a new task and repeat.
                task = svl.taskContainer.nextTask(task);
                svl.taskContainer.setCurrentTask(task);
                if (caller !== undefined) {
                    moveToTheTaskLocation(task, caller);
                }
                else {
                    moveToTheTaskLocation(task);
                }
            }
            self.preparePovReset();
        };

        var geometry = task.getGeometry();
        // Jump to the new location if it's really far away.
        var lat = geometry.coordinates[0][1],
            lng = geometry.coordinates[0][0],
            currentLatLng = getPosition(),
            newTaskPosition = turf.point([lng, lat]),
            currentPosition = turf.point([currentLatLng.lng, currentLatLng.lat]),
            distance = turf.distance(newTaskPosition, currentPosition, {units: 'kilometers'});
        if (distance > 0.1) {
            self.setPosition(lat, lng, callback);

            if (caller === "jumpImageryNotFound") {
                status.jumpImageryNotFoundStatus = true;
            }
        } else {
            if (caller === "jumpImageryNotFound") {
                status.jumpImageryNotFoundStatus = false;
            }
        }
    }

    /**
     * Blink google maps pane.
     */
    function blinkMinimap() {
        stopBlinkingMinimap();
        minimapPaneBlinkInterval = window.setInterval(function () {
            svl.ui.minimap.overlay.toggleClass("highlight-50");
        }, 500);
    }

    function hideMinimap() {
        svl.ui.minimap.holder.hide();
    }

    svl.neighborhoodModel.on("Neighborhood:completed", function() {
        hideMinimap();
    });

    /**
     * Disable panning on Street View
     * @returns {disablePanning}
     */
    function disablePanning() {
        if (!status.lockDisablePanning) {
            status.disablePanning = true;
        }
        return this;
    }

    /**
     * This method disables walking by hiding links towards other Street View panoramas.
     * @returns {disableWalking}
     */
    function disableWalking() {
        if (!status.lockDisableWalking) {
            // Disable clicking links and changing POV.
            hideLinks();
            uiMap.modeSwitchWalk.css('opacity', 0.5);
            status.disableWalking = true;
            // Disable forward and backwards keys
            svl.keyboard.setStatus("disableMovement", true);
        }
        return this;
    }

    /**
     * Enable panning on Street View.
     * @returns {enablePanning}
     */
    function enablePanning() {
        if (!status.lockDisablePanning) {
            status.disablePanning = false;
        }
        return this;
    }

    /**
     * This method enables walking to other panoramas by showing links.
     */
    function enableWalking() {
        // This method shows links on SV and enables users to walk.
        if (!status.lockDisableWalking) {
            // Enable clicking links and changing POV.
            showNavigationArrows();
            uiMap.modeSwitchWalk.css('opacity', 1);
            status.disableWalking = false;
            // Enable forward and backward keys
            svl.keyboard.setStatus("disableMovement", false);
        }
        return this;
    }

    /**
     * Get the google map.
     * @returns {null}
     */
    function getMap() {
        return map;
    }

    /**
     * Get the current panorama id.
     * @returns {string} Google Street View panorama id
     */
    function getPanoId () {
        return svl.panorama.getPano();
    }

    /**
     * Get the current latlng coordinate.
     * @returns {{lat: number, lng: number}}
     */
    function getPosition() {
        var pos = svl.panorama.getPosition();
        return { 'lat' : pos.lat(), 'lng' : pos.lng() };
    }

    /**
     * Get the current point of view.
     * @returns {object} pov
     */
    function getPov() {
        if ("panorama" in svl) {
            var pov = svl.panorama.getPov();

            // Pov can be less than 0. So adjust it.
            while (pov.heading < 0) {
                pov.heading += 360;
            }

            // Pov can be more than 360. Adjust it.
            while (pov.heading > 360) {
                pov.heading -= 360;
            }
            return pov;
        }
    }

    /**
     * This method returns a value of a specified property.
     * @param prop
     * @returns {*}
     */
    function getProperty(prop) {
        return (prop in properties) ? properties[prop] : false;
    }

    /**
     * Get svg element (arrows) in Street View.
     * @returns {*}
     */
    function getNavArrowsLayer() {
        return uiMap.pano.find('svg').parent();
    }

    self.getStatus = function (key) {
        return status[key];
    };

    function _jumpToNewTask(task, caller) {
        svl.taskContainer.setCurrentTask(task);
        if (caller === undefined) {
            moveToTheTaskLocation(task);
        }
        else {
            moveToTheTaskLocation(task, caller);
        }
    }

    function _jumpToNewLocation() {
        // Finish the current task.
        var currentMission = svl.missionContainer.getCurrentMission();
        if (currentMission) {
            finishCurrentTaskBeforeJumping(currentMission);

            // Get a new task and jump to the new task location.
            var currentTask = svl.taskContainer.getCurrentTask();
            var newTask = svl.taskContainer.nextTask(currentTask);
            if (newTask) {
                _jumpToNewTask(newTask, "jumpImageryNotFound");
            } else {
                // Complete current neighborhood if no new task available.
                finishNeighborhood();
                status.jumpImageryNotFoundStatus = true;
            }
        } else {
            console.error("Mission is not set!");
        }
    }

    /**
     *  Callback for when there is no panorama imagery found.
     *  A popup message is shown. When the user clicks okay, the user is moved to a new location.
     *  Issue #537
     */
    function jumpImageryNotFound() {
        self.preparePovReset();
        var currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
        var currentNeighborhoodName = currentNeighborhood.getProperty("name");

        var title = "Error in Google Street View";
        var message = "Uh-oh, something went wrong with Google Street View. This is not your fault, but we will need " +
            "to move you to another place in the " + currentNeighborhoodName + " neighborhood. Keep up the good work!";
        svl.panorama.set('linksControl', false); // Disable navigation arrows.
        disableWalking();
        disablePanning();
        svl.canvas.disableLabeling();

        var callback = function () {
            enableWalking();
            enablePanning();
            svl.canvas.enableLabeling();

            _jumpToNewLocation();
            var afterJumpStatus = status.jumpImageryNotFoundStatus;

            if (!afterJumpStatus) {
                // Find another location.
                _jumpToNewLocation();
                status.jumpImageryNotFoundStatus = undefined; // Reset variable after the jump.
            }
            else {
                status.jumpImageryNotFoundStatus = undefined; // Reset variable after the jump.
            }
            svl.panorama.set('linksControl', true); // Enable navigation arrows.
            svl.panorama.setVisible(true);
        };

        svl.popUpMessage.notify(title, message, callback);
    }

    /**
     * Initiate imagery not found mechanism.
     */
    function handleImageryNotFound(panoId, panoStatus) {
        var currentTask = svl.taskContainer.getCurrentTask();
        if (currentTask) {
            util.misc.reportNoStreetView(currentTask.getStreetEdgeId());
            console.error("Error Type: " + JSON.stringify(panoStatus) +
                "\nNo Street View found at this location: " + panoId + " street " + currentTask.getStreetEdgeId() +
                "\nNeed to move to a new location.");
        }

        svl.tracker.push("PanoId_NotFound", {'TargetPanoId': panoId});

        // Move to a new location
        jumpImageryNotFound();
    }

    /**
     * Callback for pano_changed event (https://developers.google.com/maps/documentation/javascript/streetview).
     * Update the map pane, and also query data for the new panorama.
     */
    function handlerPanoramaChange() {
        if (svl.panorama) {
            var panoId = getPanoId();

            if (typeof panoId === "undefined" || panoId.length == 0) {
                if ('compass' in svl) {
                    svl.compass.update();
                }
                return;
            }

            // Checks if pano_id is the same as the previous one. Google Maps API triggers pano_changed event twice:
            // once moving between pano_ids and once for setting the new pano_id.
            if (svl.streetViewService && panoId.length > 0 && panoId !== prevPanoId) {
                // Check if panorama exists.
                svl.streetViewService.getPanorama({pano: panoId},
                    function (data, panoStatus) {
                        if (panoStatus === google.maps.StreetViewStatus.OK) {
                            // Mark that we visited this pano so that we can tell if they've gotten stuck.
                            svl.stuckAlert.panoVisited(panoId);

                            // Updates the date overlay to match when the current panorama was taken.
                            document.getElementById("svl-panorama-date").innerText = moment(data.imageDate).format('MMM YYYY');
                            var panoramaPosition = svl.panorama.getPosition(); // Current position.
                            map.setCenter(panoramaPosition);

                            povChange["status"] = true;
                            _canvas.clear();
                            _canvas.setVisibilityBasedOnLocation('visible', panoId);
                            _canvas.render2();
                            povChange["status"] = false;

                            svl.tracker.push("PanoId_Changed");
                            prevPanoId = panoId;

                        } else if (panoId === "tutorial" || panoId === "afterWalkTutorial") {
                            document.getElementById("svl-panorama-date").innerText = "May 2014";
                        } else {
                            handleImageryNotFound(panoId, panoStatus);
                        }
                    }
                );
            }
            if ('compass' in svl) {
                svl.compass.update();
            }
        } else {
            throw self.className + ' handlerPanoramaChange(): panorama not defined.';
        }
    }

    function finishNeighborhood() {
        var currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
        var currentNeighborhoodId = currentNeighborhood.getProperty("regionId");
        svl.neighborhoodModel.neighborhoodCompleted();
        svl.tracker.push("NeighborhoodComplete_ByUser", { 'RegionId': currentNeighborhoodId });
    }

    function finishCurrentTaskBeforeJumping(mission, nextTask) {
        if (mission === undefined) {
            mission = missionJump;
        }
        // Finish the current task.
        var currentTask = svl.taskContainer.getCurrentTask();
        svl.taskContainer.endTask(currentTask, nextTask);
        mission.pushATaskToTheRoute(currentTask);
    }

    function _endTheCurrentTask(task, mission) {

        if (!status.labelBeforeJumpListenerSet) {

            // Get a new task and check if it's disconnected from the current task. If yes, then finish the current task
            // after the user has labeling the current location.

            missionJump = mission;
            var nextTask = svl.taskContainer.nextTask(task);

            if (nextTask && !task.isConnectedTo(nextTask)) {
                // Check if the interface jumped the user to another discontinuous location. If the user has indeed
                // jumped, [UPDATE] before jumping, let the user know to label the location before proceeding.

                // Set the newTask before jumping
                svl.taskContainer.setBeforeJumpNewTask(nextTask);
                status.labelBeforeJumpListenerSet = true;

                // Store before jump location for tracking pre-jump actions when the user leaves their location.
                setBeforeJumpLocation();

                // Listener activated for tracking before-jump actions
                try {
                    listeners.beforeJumpListenerHandle = google.maps.event.addListener(svl.panorama,
                        "pano_changed", trackBeforeJumpActions);
                } catch (err) {}
            }
            else {
                finishCurrentTaskBeforeJumping(missionJump, nextTask);

                // Move to the new task if the neighborhood has not finished
                if (nextTask) {
                    svl.taskContainer.setCurrentTask(nextTask);
                    moveToTheTaskLocation(nextTask);
                }
            }
            if (!nextTask) {
                finishNeighborhood();
            }
        }
    }

    /**
     * Callback to track when user moves away from their current location.
     */
    function trackBeforeJumpActions() {
        if (status.labelBeforeJumpListenerSet) {
            var currentLatLng = getPosition(),
                currentPosition = turf.point([currentLatLng.lng, currentLatLng.lat]),
                jumpPosition = turf.point([jumpLocation.lng, jumpLocation.lat]),
                distance = turf.distance(jumpPosition, currentPosition, {units: 'kilometers'});

            // Jump to the new location if it's really far away from his location.
            if (!status.jumpMsgShown && distance >= 0.01) {

                // Show message to the user instructing them to label the current location.
                svl.tracker.push('LabelBeforeJump_ShowMsg');
                svl.compass.showLabelBeforeJumpMessage();
                status.jumpMsgShown = true

            }
            else if (distance > 0.07) {
                svl.tracker.push('LabelBeforeJump_AutoJump');

                // Finish the current task
                finishCurrentTaskBeforeJumping();

                // Reset jump parameters before jumping
                svl.compass.resetBeforeJump();

                // Jump to the new task
                var newTask = svl.taskContainer.getBeforeJumpNewTask();
                _jumpToNewTask(newTask);
                svl.jumpModel.triggerTooFarFromJumpLocation();
            }
        }
    }

    /**
     * Reset before JumpLocation and Jump Task listener
     */
    function resetBeforeJumpLocationAndListener () {
        jumpLocation = undefined;
        status.jumpMsgShown = false;
        google.maps.event.removeListener(listeners.beforeJumpListenerHandle);
    }

    /**
     *
     * Sets before JumpLocation
     */
    function setBeforeJumpLocation () {
        // Set user's current location
        jumpLocation = getPosition();
    }

    // Todo. Wrote this ad-hoc. Clean up and test later.
    var positionUpdateCallbacks = [];
    self.bindPositionUpdate = function (callback) {
        if (typeof callback == 'function') {
            positionUpdateCallbacks.push(callback);
        }
    };
    self.unbindPositionUpdate = function (callback) {
        var callbackIndex = positionUpdateCallbacks.indexOf(callback);
        if (callbackIndex >= 0) {
            positionUpdateCallbacks.splice(callbackIndex, 1);
        }
    };

    /**
     * A callback for position_change.
     */
    function handlerPositionUpdate () {
        var isOnboarding = svl.isOnboarding()
        var position = svl.panorama.getPosition();
        var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
        var currentMission = svl.missionContainer.getCurrentMission();
        // Takes care of position_changed happening after the map has already been set
        map.setCenter(position);

        // Hide context menu if walking started
        if (svl.contextMenu.isOpen()) {
            svl.contextMenu.hide();
        }

        // Position updated, set delay until user can walk again to properly update canvas
        if (!isOnboarding && !svl.keyboard.getStatus("moving")) {
            timeoutWalking();
            setTimeout(resetWalking, moveDelay);
        }
        updateCanvas();
        if (currentMission && neighborhood) {
            if ("compass" in svl) {
                svl.compass.update();
            }
            if (!isOnboarding && "taskContainer" in svl && svl.taskContainer.tasksLoaded()) {
                svl.taskContainer.update();

                // End of the task if the user is close enough to the end point and we aren't in the tutorial.
                var task = svl.taskContainer.getCurrentTask();
                if (!isOnboarding && task && task.isAtEnd(position.lat(), position.lng(), END_OF_STREET_THRESHOLD)) {
                    _endTheCurrentTask(task, currentMission);
                }
            }
            if ("observedArea" in svl) {
                svl.observedArea.panoChanged();
            }
            svl.missionModel.updateMissionProgress(currentMission, neighborhood);
        }

        // Set the heading angle when the user is dropped to the new position.
        if (initialPositionUpdate && 'compass' in svl) {
            setPovToRouteDirection();
            initialPositionUpdate = false;
        }

        // Calling callbacks for position_changed event.
        for (var i = 0, len = positionUpdateCallbacks.length; i < len; i++) {
            var callback = positionUpdateCallbacks[i];
            if (typeof callback == 'function') {
                callback();
            }
        }
    }

    /**
     * Callback for pov update.
     */
    function handlerPovChange() {
        povChange["status"] = true;
        updateCanvas();
        povChange["status"] = false;

        if ("compass" in svl) { svl.compass.update(); }
        if ("observedArea" in svl) { svl.observedArea.update(); }

        svl.tracker.push("POV_Changed");
    }

    /**
     * Callback for zoom update.
     */
     function handlerZoomChange () {
        if ("observedArea" in svl) { svl.observedArea.update(); }

        svl.tracker.push("Zoom_Changed");
    }

    /**
     * Callback that is fired with the mousedown event on the view control layer (where you control street view angle).
     * @param e
     */
    function handlerViewControlLayerMouseDown(e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = mouseposition(e, this).x;
        mouseStatus.leftDownY = mouseposition(e, this).y;
        svl.tracker.push('ViewControl_MouseDown', {x: mouseStatus.leftDownX, y:mouseStatus.leftDownY});
        setViewControlLayerCursor('ClosedHand');

        // This is necessary for supporting touch devices, because there is no mouse hover.
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * Callback on mouse up event on the view control layer (where you change the Google Street view angle).
     * @param e
     */
    function handlerViewControlLayerMouseUp(e) {
        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = mouseposition(e, this).x;
        mouseStatus.leftUpY = mouseposition(e, this).y;
        svl.tracker.push('ViewControl_MouseUp', {x:mouseStatus.leftUpX, y:mouseStatus.leftUpY});
        setViewControlLayerCursor('OpenHand');
        var currTime = new Date().getTime();

        var point = _canvas.isOn(mouseStatus.currX, mouseStatus.currY);
        if (point && point.className === "Point") {
            var path = point.belongsTo(),
                selectedLabel = path.belongsTo(),
                canvasCoordinate = point.getCanvasCoordinate(getPov());

            _canvas.setCurrentLabel(selectedLabel);

            if ('contextMenu' in svl) {
                if (contextMenuWasOpen) {
                    svl.contextMenu.hide();
                } else {
                    svl.contextMenu.show(canvasCoordinate.x, canvasCoordinate.y, {
                        targetLabel: selectedLabel,
                        targetLabelColor: selectedLabel.getProperty("labelFillStyle")
                    });
                }
                contextMenuWasOpen = false;
            }
        } else if (currTime - mouseStatus.prevMouseUpTime < 300) {
            // Continue logging double click. We don't have any features for it now, but it's good to know how
            // frequently people are trying to double-click. They might be trying to zoom?
            svl.tracker.push('ViewControl_DoubleClick');
        }
        setViewControlLayerCursor('OpenHand');
        mouseStatus.prevMouseUpTime = currTime;
    }

    function handlerViewControlLayerMouseLeave(e) {
        setViewControlLayerCursor('OpenHand');
        mouseStatus.isLeftDown = false;
    }

    /**
     * Callback that is fired when a user moves a mouse on the view control layer where you change the pov.
     */
    function handlerViewControlLayerMouseMove(e) {
        mouseStatus.currX = mouseposition(e, this).x;
        mouseStatus.currY = mouseposition(e, this).y;

        // Show/hide navigation arrows.
        if (!status.disableWalking) {
            showNavigationArrows();
        } else {
            hideLinks();
        }

        if (mouseStatus.isLeftDown && status.disablePanning === false) {
            // If a mouse is being dragged on the control layer, move the sv image.
            var dx = mouseStatus.currX - mouseStatus.prevX;
            var dy = mouseStatus.currY - mouseStatus.prevY;
            var pov = getPov();
            var zoom = Math.round(pov.zoom);
            var zoomLevel = svl.zoomFactor[zoom];
            dx = dx / (2 * zoomLevel);
            dy = dy / (2 * zoomLevel);
            dx *= 1.5;
            dy *= 1.5;
            updatePov(dx, dy);
        }

        // Show label delete menu.
        var item = _canvas.isOn(mouseStatus.currX, mouseStatus.currY);
        if (item && item.className === "Point") {
            var path = item.belongsTo();
            var selectedLabel = path.belongsTo();

            _canvas.setCurrentLabel(selectedLabel);
            _canvas.showLabelTag(selectedLabel);
            _canvas.clear();
            _canvas.render2();
        } else if (item && item.className === "Label") {
            var selectedLabel = item;
            _canvas.setCurrentLabel(selectedLabel);
            _canvas.showLabelTag(selectedLabel);
        } else if (item && item.className === "Path") {
            var label = item.belongsTo();
            _canvas.clear();
            _canvas.render2();
            _canvas.showLabelTag(label);
        }
        else {
            _canvas.showLabelTag(undefined);
            _canvas.setCurrentLabel(undefined);
        }

        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }


    /**
     * This method hides links to neighboring Street View images by changing the svg path elements.
     *
     * @returns {hideLinks} This object.
     */
    function hideLinks() {
        var $paths = $("#view-control-layer").find('path');
        $paths.css('visibility', 'hidden');
        $paths.css('pointer-events', 'none');
        return this;
    }

    /**
     * Lock disable panning.
     * @returns {lockDisablePanning}
     */
    function lockDisablePanning() {
        status.lockDisablePanning = true;
        return this;
    }

    /**
     * This method locks status.disableWalking.
     * @returns {lockDisableWalking}
     */
    function lockDisableWalking() {
        status.lockDisableWalking = true;
        return this;
    }

    /**
     * This method brings the links (<, >) to the view control layer so that a user can click them to walk around.
     */
    function makeArrowsAndLinksClickable() {
        // Bring the links on the bottom of GSV and the mini map to the top layer so they are clickable.
        var bottomLinks = $('.gm-style-cc');
        if (!status.bottomLinksClickable && bottomLinks.length > 7) {
            status.bottomLinksClickable = true;
            bottomLinks[0].remove(); // Remove GSV keyboard shortcuts link.
            bottomLinks[4].remove(); // Remove mini map keyboard shortcuts link.
            bottomLinks[5].remove(); // Remove mini map copyright text (duplicate of GSV).
            bottomLinks[7].remove(); // Remove mini map terms of use link (duplicate of GSV).
            uiMap.viewControlLayer.append($(bottomLinks[1]).parent().parent());
            svl.ui.minimap.overlay.append($(bottomLinks[8]).parent().parent());
        }

        // Bring the layer with arrows forward.
        var $navArrows = getNavArrowsLayer();
        uiMap.viewControlLayer.append($navArrows);

        // Add an event listener to the nav arrows to log their clicks.
        if (!status.panoLinkListenerSet && $navArrows.length > 0) {
            // TODO We are adding click events to extra elements that don't need it, we shouldn't do that :)
            $navArrows[0].addEventListener('click', function (e) {
                var targetPanoId = e.target.getAttribute('pano');
                if (targetPanoId) {
                    svl.tracker.push('WalkTowards', {'TargetPanoId': targetPanoId});
                }
            });
            status.panoLinkListenerSet = true;
        }

        if (properties.browser === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            uiMap.viewControlLayer.append(uiMap.canvas);
        } else if (properties.browser === 'msie') {
            uiMap.viewControlLayer.insertBefore(uiMap.drawingLayer);
        }
    }

    // Moves label drawing layer to the top and hides navigation arrows.
    function switchToLabelingMode() {
        uiMap.drawingLayer.css('z-index','1');
        uiMap.viewControlLayer.css('z-index', '0');

        if (properties.browser === 'mozilla') {
            uiMap.drawingLayer.append(uiMap.canvas);
        }
        hideLinks();
    }

    // Moves label drawing layer to the bottom. Shows navigation arrows if walk is enabled.
    function switchToExploreMode() {
        uiMap.viewControlLayer.css('z-index', '1');
        uiMap.drawingLayer.css('z-index','0');
        if (!status.disableWalking) {
            // Show the navigation arrows on top of the panorama and make arrows clickable.
            showNavigationArrows();
            makeArrowsAndLinksClickable();
        }
    }

    /**
     * @param panoramaId
     * @param force: force to change pano, even if walking is disabled
     * @returns {setPano}
     */
    function setPano(panoramaId, force) {
        if (force == undefined) force = false;

        if (!status.disableWalking || force == true) {
            svl.panorama.setPano(panoramaId);
        }
        return this;
    }

    /**
     * Set map position.
     * @param lat
     * @param lng
     * @param callback
     */
    function setPosition(lat, lng, callback) {
        if (!status.disableWalking) {
            // Check the presence of the Google Street View. If it exists, then set the location. Other wise error.
            var gLatLng = new google.maps.LatLng(lat, lng);
            svl.streetViewService.getPanorama({location: gLatLng, radius: STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR},
                function (streetViewPanoramaData, status) {
                    if (status === google.maps.StreetViewStatus.OK) {

                        self.enableWalking();

                        // Sets new panorama.
                        var newPano = streetViewPanoramaData.location.pano;
                        self.setPano(newPano);
                        map.setCenter(gLatLng);

                        self.disableWalking();
                        window.setTimeout(function() { self.enableWalking(); }, 1000);
                    } else {
                        console.error("Street View does not exist at (lat, lng) = (" + lat + ", " + lng + ")");
                    }
                    if (callback) callback(streetViewPanoramaData, status);
                });
        }
        return this;
    }

    // For setting the position when the exact panorama is known.
    function setPositionByIdAndLatLng(panoId, lat, lng) {
        // Only set the location if walking is enabled
        if (!status.disableWalking) {
            var gLatLng = new google.maps.LatLng(lat, lng);

            self.enableWalking();
            self.setPano(panoId);
            map.setCenter(gLatLng);

            self.disableWalking();
            window.setTimeout(function() { self.enableWalking(); }, 1000);
        }
        return this;
    }

    function stopBlinkingMinimap() {
        window.clearInterval(minimapPaneBlinkInterval);
        svl.ui.minimap.overlay.removeClass("highlight-50");
    }

    function updateCanvas() {
        _canvas.clear();
        if (status.currentPanoId !== getPanoId()) {
            _canvas.setVisibilityBasedOnLocation('visible', getPanoId());
        }
        status.currentPanoId = getPanoId();
        _canvas.render2();
    }

    function setViewControlLayerCursor(type) {
        switch(type) {
            case 'OpenHand':
                uiMap.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/openhand.cur) 4 4, move");
                break;
            case 'ClosedHand':
                uiMap.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/closedhand.cur) 4 4, move");
                break;
            default:
                uiMap.viewControlLayer.css("cursor", "default");
        }
    }

    /**
     * Show navigation arrow links (<, >) for walking.
     */
    function showNavigationArrows() {
        // A bit redundant, but as long as the link arrows have not been moved to user control layer, keep calling the
        // makeArrowsAndLinksClickable() to bring arrows to the top layer. Once loaded, set svLinkArrowsLoaded to true.
        if (!status.svLinkArrowsLoaded) {
            var numPath = uiMap.viewControlLayer.find("path").length;
            if (numPath === 0) {
                makeArrowsAndLinksClickable();
            } else {
                status.svLinkArrowsLoaded = true;
            }
        }
        $(".gmnoprint path").css('visibility', 'visible');
        $(".gmnoprint path").css('pointer-events', 'all');
    }

    /**
     * Make navigation arrows blink.
     */
    function blinkNavigationArrows() {
        setTimeout(() => {
            const arrows = document.querySelector("div.gmnoprint.SLHIdE-sv-links-control").querySelector("svg").querySelectorAll("path[fill-opacity='1']");
            // Obtain interval id to allow for the interval to be cleaned up after the arrow leaves document context.
            const intervalId = window.setInterval(function () {
                // Blink logic.
                arrows.forEach((arrow) => {
                    arrow.setAttribute("fill", (arrow.getAttribute("fill") === "white" ? "yellow" : "white"));

                    // Once the arrow is removed from the document, stop the interval for all arrows.
                    if (!document.body.contains(arrow)) window.clearInterval(intervalId);
                });
            }, 500);
        }, 500);
    }

    /*
     * Gets the pov change tracking variable.
     */
    function getPovChangeStatus() {
        return povChange;
    }

    /**
     * Prevents users from looking at the sky or straight to the ground. Restrict heading angle if specified in props.
     */
    function restrictViewPort(pov) {
        if (pov.pitch > properties.maxPitch) {
            pov.pitch = properties.maxPitch;
        } else if (pov.pitch < properties.minPitch) {
            pov.pitch = properties.minPitch;
        }
        if (properties.minHeading && properties.maxHeading) {
            if (properties.minHeading <= properties.maxHeading) {
                if (pov.heading > properties.maxHeading) {
                    pov.heading = properties.maxHeading;
                } else if (pov.heading < properties.minHeading) {
                    pov.heading = properties.minHeading;
                }
            } else {
                if (pov.heading < properties.minHeading &&
                    pov.heading > properties.maxHeading) {
                    if (Math.abs(pov.heading - properties.maxHeading) < Math.abs(pov.heading - properties.minHeading)) {
                        pov.heading = properties.maxHeading;
                    } else {
                        pov.heading = properties.minHeading;
                    }
                }
            }
        }
        return pov;
    }

    /**
     * Update POV of Street View as a user drags their mouse cursor.
     * @param dx
     * @param dy
     */
    function updatePov(dx, dy) {
        if (svl.panorama) {
            var pov = svl.panorama.getPov();
            var alpha = 0.25;
            pov.heading -= alpha * dx;
            pov.pitch += alpha * dy;

            // View port restriction.
            pov = restrictViewPort(pov);

            // Update the status of pov change.
            povChange["status"] = true;

            // Set the property this object, then update the Street View image.
            properties.panoramaPov = pov;
            svl.panorama.setPov(pov);
        } else {
            throw self.className + ' updatePov(): panorama not defined!';
        }
    }

    /**
     * Set the minimum and maximum heading angle that users can adjust the Street View camera.
     * @param range
     * @returns {setHeadingRange}
     */
    function setHeadingRange(range) {
        properties.minHeading = range[0];
        properties.maxHeading = range[1];
        return this;
    }

    /**
     * Changes the Street View pov. If a transition duration is given, smoothly updates the pov over that time.
     * @param pov Target pov
     * @param durationMs Transition duration in milli-seconds
     * @param callback Callback function executed after updating pov.
     * @returns {setPov}
     */
    function setPov(pov, durationMs, callback) {
        if (('panorama' in svl) && svl.panorama) {
            var currentPov = svl.panorama.getPov();
            var interval;

            pov.heading = parseInt(pov.heading, 10);
            pov.pitch = parseInt(pov.pitch, 10);
            pov.zoom = parseInt(pov.zoom, 10);

            // Pov restriction.
            restrictViewPort(pov);

            if (durationMs) {
                var timeSegment = 25; // 25 milliseconds.

                // Get how much angle you change over timeSegment of time.
                var cw = (pov.heading - currentPov.heading + 360) % 360;
                var ccw = 360 - cw;
                var headingIncrement;
                if (cw < ccw) {
                    headingIncrement = cw * (timeSegment / durationMs);
                } else {
                    headingIncrement = (-ccw) * (timeSegment / durationMs);
                }

                var pitchIncrement;
                var pitchDelta = pov.pitch - currentPov.pitch;
                pitchIncrement = pitchDelta * (timeSegment / durationMs);

                interval = window.setInterval(function () {
                    var headingDelta = (pov.heading - currentPov.heading + 360) % 360;
                    if (headingDelta > 1 && headingDelta < 359) {
                        // Update heading angle and pitch angle.
                        currentPov.heading += headingIncrement;
                        currentPov.pitch += pitchIncrement;
                        currentPov.heading = (currentPov.heading + 360) % 360;
                        svl.panorama.setPov(currentPov);
                    } else {
                        // Set the pov to adjust zoom level, then clear the interval. Invoke a callback if there is one.
                        if (!pov.zoom) {
                            pov.zoom = 1;
                        }

                        svl.panorama.setZoom(pov.zoom);
                        window.clearInterval(interval);
                        if (callback) {
                            callback();
                        }
                    }
                }, timeSegment);
            } else {
                svl.panorama.setPov(pov);
            }
        }
        return this;
    }

    function _turfPointToGoogleLatLng(point) {
        return new google.maps.LatLng(point.geometry.coordinates[1], point.geometry.coordinates[0]);
    }

    /**
     * Attempts to move the user forward in GSV by incrementally checking for imagery every few meters along the route.
     * @param successLogMessage [String] internal logging when imagery is found; different for stuck button v compass.
     * @param failLogMessage [String] internal logging when imagery is not found; different for stuck button v compass.
     * @param alertFunc [Function] An optional function that would alert the user upon successfully finding imagery.
     */
    function moveForward(successLogMessage, failLogMessage, alertFunc) {
        svl.modalComment.hide();
        svl.modalSkip.disableStuckButton();
        svl.compass.disableCompassClick();
        var enableClicksCallback = function() {
            svl.modalSkip.enableStuckButton();
            svl.compass.enableCompassClick();
        };
        // TODO show loading icon. Add when resolving issue #2403.

        // Grab street geometry and current location.
        var currentTask = svl.taskContainer.getCurrentTask();
        var streetEdge = currentTask.getFeature();
        var currentPano = getPanoId();
        var point = getPosition();
        var currPos = turf.point([point.lng, point.lat]);
        var streetEndpoint = turf.point([currentTask.getLastCoordinate().lng, currentTask.getLastCoordinate().lat]);

        // Remove the part of the street geometry that you've already passed using lineSlice.
        var remainder = turf.lineSlice(currPos, streetEndpoint, streetEdge);
        currPos = turf.point([remainder.geometry.coordinates[0][0], remainder.geometry.coordinates[0][1]]);
        var gLatLng = _turfPointToGoogleLatLng(currPos);

        // Save the current pano ID as one that you're stuck at.
        if (!_stuckPanos.includes(currentPano)) _stuckPanos.push(currentPano);

        // Set radius around each attempted point for which you'll accept GSV imagery to 10 meters.
        var MAX_DIST = 10;
        // Set how far to move forward along the street for each new attempt at finding imagery to 10 meters.
        var DIST_INCREMENT = 0.01;

        var GSV_SRC = google.maps.StreetViewSource.OUTDOOR;
        var GSV_OK = google.maps.StreetViewStatus.OK;
        var line;
        var end;

        // Callback function when querying GSV for imagery using streetViewService.getPanorama. If we don't find imagery
        // here, recursively call getPanorama with this callback function to test another 10 meters down the street.
        var callback = function(streetViewPanoData, status) {
            // If there is no imagery here that we haven't already been stuck in, either try further down the street,
            // try with a larger radius, or just jump to a new street if all else fails.
            if (status !== GSV_OK || _stuckPanos.includes(streetViewPanoData.location.pano)) {

                // If there is room to move forward then try again, recursively calling getPanorama with this callback.
                if (turf.length(remainder) > 0) {
                    // Save the current pano ID as one that doesn't work.
                    if (status === GSV_OK) {
                        _stuckPanos.push(streetViewPanoData.location.pano);
                    }
                    // Set `currPos` to be `DIST_INCREMENT` further down the street. Use `lineSliceAlong` to find that
                    // next point, and use `lineSlice` to remove the piece we just moved past from `remainder`.
                    line = turf.lineSliceAlong(remainder, 0, DIST_INCREMENT);
                    end = line.geometry.coordinates.length - 1;
                    currPos = turf.point([line.geometry.coordinates[end][0], line.geometry.coordinates[end][1]]);
                    remainder = turf.lineSlice(currPos, streetEndpoint, remainder);
                    gLatLng = _turfPointToGoogleLatLng(currPos);
                    svl.streetViewService.getPanorama({ location: gLatLng, radius: MAX_DIST, source: GSV_SRC }, callback);
                } else if (MAX_DIST === 10 && status !== GSV_OK) {
                    // If we get to the end of the street, increase the radius a bit to try and drop them at the end.
                    MAX_DIST = 25;
                    gLatLng = _turfPointToGoogleLatLng(currPos);
                    svl.streetViewService.getPanorama({ location: gLatLng, radius: MAX_DIST, source: GSV_SRC }, callback);
                } else {
                    // If all else fails, jump to a new street.
                    svl.tracker.push(failLogMessage);
                    svl.form.skip(currentTask, "GSVNotAvailable");
                    svl.stuckAlert.stuckSkippedStreet();
                    window.setTimeout(enableClicksCallback, 1000);
                }
            } else if (status === GSV_OK) {
                // Save current pano ID as one that doesn't work in case they try to move before clicking 'stuck' again.
                _stuckPanos.push(streetViewPanoData.location.pano);
                // Move them to the new pano we found.
                setPositionByIdAndLatLng(
                    streetViewPanoData.location.pano,
                    currPos.geometry.coordinates[1],
                    currPos.geometry.coordinates[0]
                );
                svl.tracker.push(successLogMessage);
                if (alertFunc !== null) alertFunc();
                window.setTimeout(enableClicksCallback, 1000);
            }
        };

        // Initial call to getPanorama with using the recursive callback function.
        svl.streetViewService.getPanorama({ location: gLatLng, radius: MAX_DIST, source: GSV_SRC }, callback);
    }

    /**
     * This function sets the current status of the instantiated object.
     * @param key
     * @param value
     * @returns {*}
     */
    function setStatus(key, value) {
        if (key in status) {
            // if the key is disableWalking, invoke walk disabling/enabling function
            if (key === "disableWalking") {
                if (typeof value === "boolean") {
                    if (value) {
                        disableWalking();
                    } else {
                        enableWalking();
                    }
                } else {
                    return false
                }
            } else {
                status[key] = value;
            }
            return this;
        }
        return false;
    }

    /**
     * Unlock disable panning.
     * @returns {unlockDisablePanning}
     */
    function unlockDisablePanning() {
        status.lockDisablePanning = false;
        return this;
    }

    /**
     * Unlock disable walking.
     * @returns {unlockDisableWalking}
     */
    function unlockDisableWalking() {
        status.lockDisableWalking = false;
        return this;
    }

    function setZoom(zoomLevel) {
        svl.panorama.setZoom(zoomLevel);
    }

    // Set a flag that triggers the POV being reset into the route direction upon the position changing.
    function preparePovReset() {
        initialPositionUpdate = true;
    }

    // Set the POV in the same direction as the route.
    function setPovToRouteDirection(durationMs) {
        var pov = svl.panorama.getPov();
        var newPov = {
            heading: parseInt(svl.compass.getTargetAngle() + 360, 10) % 360,
            pitch: pov.pitch,
            zoom: pov.zoom
        }
        setPov(newPov, durationMs);
    }

    function getMoveDelay() {
        return moveDelay;
    }

    self.blinkMinimap = blinkMinimap;
    self.stopBlinkingMinimap = stopBlinkingMinimap;
    self.blinkNavigationArrows = blinkNavigationArrows;
    self.disablePanning = disablePanning;
    self.disableWalking = disableWalking;
    self.enablePanning = enablePanning;
    self.enableWalking = enableWalking;
    self.finishCurrentTaskBeforeJumping = finishCurrentTaskBeforeJumping;
    self.getLabelBeforeJumpListenerStatus = getLabelBeforeJumpListenerStatus;
    self.getMap = getMap;
    self.getPanoId = getPanoId;
    self.getProperty = getProperty;
    self.getPosition = getPosition;
    self.getPov = getPov;
    self.getPovChangeStatus = getPovChangeStatus;
    self.hideLinks = hideLinks;
    self.lockDisablePanning = lockDisablePanning;
    self.lockDisableWalking = lockDisableWalking;
    self.switchToLabelingMode = switchToLabelingMode;
    self.switchToExploreMode = switchToExploreMode;
    self.moveToTheTaskLocation = moveToTheTaskLocation;
    self.resetBeforeJumpLocationAndListener = resetBeforeJumpLocationAndListener;
    self.restrictViewPort = restrictViewPort;
    self.setBeforeJumpLocation = setBeforeJumpLocation;
    self.setHeadingRange = setHeadingRange;
    self.setLabelBeforeJumpListenerStatus = setLabelBeforeJumpListenerStatus;
    self.setPano = setPano;
    self.setPosition = setPosition;
    self.setPositionByIdAndLatLng = setPositionByIdAndLatLng;
    self.setPov = setPov;
    self.moveForward = moveForward;
    self.setStatus = setStatus;
    self.unlockDisableWalking = unlockDisableWalking;
    self.unlockDisablePanning = unlockDisablePanning;
    self.setZoom = setZoom;
    self.preparePovReset = preparePovReset;
    self.setPovToRouteDirection = setPovToRouteDirection;
    self.timeoutWalking = timeoutWalking;
    self.resetWalking = resetWalking;
    self.getMoveDelay = getMoveDelay;

    _init(params);
    return self;
}

function NavigationModel () {
    this._mapService = null;  // Todo. Should a map service be under NavigationModel?
}

_.extend(NavigationModel.prototype, Backbone.Events);

NavigationModel.prototype.disableWalking = function () {
    if (this._mapService) this._mapService.disableWalking();
};

NavigationModel.prototype.enableWalking = function () {
    if (this._mapService) this._mapService.enableWalking();
};

NavigationModel.prototype.getPosition = function () {
    return this._mapService ? this._mapService.getPosition() : null;
};

NavigationModel.prototype.setPosition = function (lat, lng, callback) {
    if (this._mapService) this._mapService.setPosition(lat, lng, callback);
};

NavigationModel.prototype.preparePovReset = function(){
    if (this._mapService) this._mapService.preparePovReset();
};

/**
 * ObservedArea module.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ObservedArea(uiMiniMap) {
    let angle = null;  // User's angle.
    let leftAngle = null;  // Left-most angle of the user's FOV.
    let rightAngle = null;  // Right-most angle of the user's FOV.
    let observedAreas = [];  // List of observed areas (panoId, latLng, minAngle, maxAngle).
    let currArea = {}; // Current observed area (panoId, latLng, minAngle, maxAngle).
    let fractionObserved = 0;  // User's current fraction of 360 degrees observed.
    const radius = 40;  // FOV radius in pixels.
    const width = uiMiniMap.fogOfWar.width();  // Canvas width.
    const height = uiMiniMap.fogOfWar.height();  // Canvas height.
    // Get canvas context for the various components of the fog of war view on the mini map.
    const fogOfWarCtx = uiMiniMap.fogOfWar[0].getContext('2d');
    const fovCtx = uiMiniMap.fov[0].getContext('2d');
    const progressCircleCtx = uiMiniMap.progressCircle[0].getContext('2d');

    this.initialize = function() {
        // Set up some ctx stuff that never changes here so that we don't do it repeatedly.
        uiMiniMap.percentObserved.css('color', '#404040')
        fogOfWarCtx.fillStyle = '#888888';
        fogOfWarCtx.filter = 'blur(5px)';
        fovCtx.fillStyle = '#8080ff';
        progressCircleCtx.fillStyle = '#8080ff';
        progressCircleCtx.lineCap = 'round';
        progressCircleCtx.lineWidth = 2;
    };

    /**
     * Resets the user's angle and adds user's new pano to 'observedAreas'. Called when the user takes a step.
     */
     this.panoChanged = function() {
        angle = null;
        leftAngle = null;
        rightAngle = null;
        const panoId = svl.panorama.getPano();
        currArea = observedAreas.find(area => area.panoId === panoId);

        if (!currArea) {
            currArea = { panoId: panoId, latLng: svl.map.getPosition(), minAngle: null, maxAngle: null };
            observedAreas.push(currArea);
        }
    }

    /**
     * Converts degrees to radians.
     * @param degrees
     * @returns {number}
     */
    function toRadians(degrees) {
        return degrees / 180 * Math.PI;
    }

    /**
     * Converts a latitude and longitude to pixel xy-coordinates.
     * @param latLng
     * @returns {number, number}
     */
    function latLngToPixel(latLng) {
        const projection = svl.map.getMap().getProjection();
        const bounds = svl.map.getMap().getBounds();
        const topRight = projection.fromLatLngToPoint(bounds.getNorthEast());
        const bottomLeft = projection.fromLatLngToPoint(bounds.getSouthWest());
        const scale = Math.pow(2, svl.map.getMap().getZoom());
        const worldPoint = projection.fromLatLngToPoint(latLng);
        return {x: Math.floor((worldPoint.x - bottomLeft.x) * scale),
                y: Math.floor((worldPoint.y - topRight.y) * scale)};
    }

    /**
     * Updates all the angle variables necessary to keep track of the user's observed area.
     */
    function updateAngles() {
        const pov = svl.map.getPov();
        let heading = pov.heading;
        const fov = PanoMarker.get3dFov(pov.zoom);
        if (angle) {
            if (heading - angle > 180) {
                heading -= 360;
            }
            if (heading - angle < -180) {
                heading += 360;
            }
        }
        angle = heading;
        leftAngle = angle - fov / 2;
        rightAngle = angle + fov / 2;
        if (!currArea.minAngle || leftAngle < currArea.minAngle) {
            currArea.minAngle = leftAngle;
        }
        if (!currArea.maxAngle || rightAngle > currArea.maxAngle) {
            currArea.maxAngle = rightAngle;
        }
        fractionObserved = Math.min(currArea.maxAngle - currArea.minAngle, 360) / 360;
    }

    /**
     * Renders the fog of war.
     */
    function renderFogOfWar() {
        fogOfWarCtx.fillRect(0, 0, width, height);
        fogOfWarCtx.globalCompositeOperation = 'destination-out';
        for (const observedArea of observedAreas) {
            const center = latLngToPixel(observedArea.latLng);
            fogOfWarCtx.beginPath();
            if (observedArea.maxAngle - observedArea.minAngle < 360) {
                fogOfWarCtx.moveTo(center.x, center.y);
            }
            fogOfWarCtx.arc(center.x, center.y, radius,
                toRadians(observedArea.minAngle - 90), toRadians(observedArea.maxAngle - 90));
                fogOfWarCtx.fill();
        }
        fogOfWarCtx.globalCompositeOperation = 'source-over';
    }

    /**
     * Renders the user's FOV.
     */
    function renderFov() {
        const center = latLngToPixel(currArea.latLng);
        fovCtx.clearRect(0, 0, width, height);
        fovCtx.beginPath();
        fovCtx.moveTo(center.x, center.y);
        fovCtx.arc(center.x, center.y, radius, toRadians(leftAngle - 90), toRadians(rightAngle - 90));
        fovCtx.fill();
    }

    /**
     * Renders the user's percentage of 360 degrees observed progress bar. Gray until 100%, then switches to green.
     */
    function renderProgressCircle() {
        progressCircleCtx.clearRect(0, 0, width, height);
        progressCircleCtx.strokeStyle = fractionObserved === 1 ? '#00dd00' : '#404040';
        progressCircleCtx.beginPath();
        progressCircleCtx.arc(width - 20, 20, 16, toRadians(-90), toRadians(fractionObserved * 360 - 90));
        progressCircleCtx.stroke();
    }

    /**
     * Updates everything relevant to the user's observed area.
     */
    this.update = function() {
        if (observedAreas.length > 0) {
            updateAngles();
            renderFogOfWar();
            renderFov();
            renderProgressCircle();
            uiMiniMap.percentObserved.text(Math.floor(100 * fractionObserved) + '%');
            if (fractionObserved === 1) {
                uiMiniMap.message.text(i18next.t('right-ui.minimap.follow-red-line'));
            } else {
                uiMiniMap.message.text(i18next.t('right-ui.minimap.explore-current-location'));
            }
        }
    }

    this.initialize();
}

/**
 * Neighborhood module.
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Neighborhood (parameters) {
    var self = { className: "Neighborhood"};
    var properties = {
        layer: null,
        name: null,
        regionId: null
    };

    /**
     * Initialize
     */
    function _init (parameters) {
        if ('regionId' in parameters) {
            setProperty("regionId", parameters.regionId);
            self.regionId = parameters.regionId;  // for debugging
        }
        if ("layer" in parameters) setProperty("layer", parameters.layer);
        if ("name" in parameters) {
            setProperty("name", parameters.name);
        }
    }

    /**
     * Return the center of this polygon
     * @returns {null}
     */
    function center () {
        return properties.layer ? turf.center(parameters.layer.toGeoJSON()) : null;
    }
    
    function completedLineDistance(unit) {
        if (!unit) unit = {units: 'kilometers'};
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.getCompletedTaskDistance(unit);
        } else {
            return null;
        }
    }

    function completedLineDistanceAcrossAllUsersUsingPriority() {
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.getCompletedTaskDistanceAcrossAllUsersUsingPriority();
        } else {
            return null;
        }
    }

    /** Get property */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /** Set property */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    function totalLineDistanceInNeighborhood (unit) {
        if (!unit) unit = {units: 'kilometers'};
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.totalLineDistanceInNeighborhood(unit);
        } else {
            return null;
        }
    }

    function getGeoJSON(){
        var layer = properties.layer;
        if (layer){
            // return layer.getLayers()[0].feature;
            return layer.feature;
        } else {
            return null;
        }
    }
    _init(parameters);

    self.center = center;
    self.completedLineDistance = completedLineDistance;
    self.completedLineDistanceAcrossAllUsersUsingPriority = completedLineDistanceAcrossAllUsersUsingPriority;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.totalLineDistanceInNeighborhood = totalLineDistanceInNeighborhood;
    self.getGeoJSON = getGeoJSON;
    return self;
}

/**
 * NeighborhoodContainer module
 * @param neighborhoodModel NeighborhoodModel object
 * @constructor
 */
function NeighborhoodContainer (neighborhoodModel) {
    var self = this;
    this._neighborhoodModel = neighborhoodModel;

    this._neighborhoods = {};
    this._status = {
        currentNeighborhood: null
    };

    this._neighborhoodModel.on("NeighborhoodContainer:add", function (neighborhood) {
        self.add(neighborhood);
    });
}


NeighborhoodContainer.prototype.add = function (neighborhood) {
    var id = neighborhood.getProperty("regionId");
    this._neighborhoods[id] = neighborhood;
};

NeighborhoodContainer.prototype.get = function (neighborhoodId) {
    return neighborhoodId in this._neighborhoods ? this._neighborhoods[neighborhoodId] : null;
};

NeighborhoodContainer.prototype.getCurrentNeighborhood = function () {
    return this.getStatus('currentNeighborhood');
};

NeighborhoodContainer.prototype.getStatus = function (key) {
    return this._status[key];
};

NeighborhoodContainer.prototype.setCurrentNeighborhood = function (newNeighborhood) {
    this.setStatus('currentNeighborhood', newNeighborhood);
    this._neighborhoodModel.trigger("NeighborhoodContainer:setNeighborhood", newNeighborhood);
};

NeighborhoodContainer.prototype.setStatus = function (key, value) {
    this._status[key] = value;
};

/**
 * Neighborhood factory module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function NeighborhoodFactory (neighborhoodModel) {
    var self = this;
    this._neighborhoodModel = neighborhoodModel;

    this._neighborhoodModel.on("NeighborhoodFactory:create", function (parameters) {
        var neighborhood = self.create(parameters.regionId, parameters.layer, parameters.name);
        self._neighborhoodModel.add(neighborhood);
    });
}

NeighborhoodFactory.prototype.create = function (regionId, layer, name) {
    if (layer && "_layers" in layer) {
        layer = layer.getLayers()[0];
    }
    return new Neighborhood({regionId: regionId, layer: layer, name: name });
};

function NeighborhoodModel () {
    var self = this;
    this._neighborhoodContainer = null;
    this.isNeighborhoodCompleted = false;
    this.isNeighborhoodCompletedAcrossAllUsers = null;
    this.difficultRegionIds = [];

    this._handleFetchComplete = function (geojson) {
        var geojsonLayer = L.geoJson(geojson);
        var leafletLayers = geojsonLayer.getLayers();
        var layer, regionId, regionName;
        for (var i = 0, len = leafletLayers.length; i < len; i++) {
            layer = leafletLayers[i];
            regionId = layer.feature.properties.region_id;
            regionName = layer.feature.properties.region_name;
            // TODO: Add an isComplete property
            self.create(regionId, layer, regionName);
        }
    };

    this.fetchNeighborhoods = function (callback) {
        if (callback) {
            $.when($.ajax("/neighborhoods")).done(self._handleFetchComplete).done(callback);
        } else {
            $.when($.ajax("/neighborhoods")).done(self._handleFetchComplete)
        }
    };

    this.fetchDifficultNeighborhoods = function (callback) {
        $.when($.ajax({
            contentType: 'application/json; charset=utf-8',
            url: "/neighborhoods/difficult",
            type: 'get',
            success: function (json) {
                self.difficultRegionIds = json.regionIds;
            },
            error: function (result) {
                throw result;
            }
        })).done(callback);
    };
}
_.extend(NeighborhoodModel.prototype, Backbone.Events);

NeighborhoodModel.prototype.add = function (neighborhood) {
    this.trigger("NeighborhoodContainer:add", neighborhood);
};

NeighborhoodModel.prototype.create = function (regionId, layer, name) {
    var parameters = { regionId: regionId, layer: layer, name: name };
    this.trigger("NeighborhoodFactory:create", parameters);
};

NeighborhoodModel.prototype.currentNeighborhood = function () {
    if (!this._neighborhoodContainer) return null;
    return this._neighborhoodContainer.getCurrentNeighborhood();
};

NeighborhoodModel.prototype.getNeighborhoodCompleteAcrossAllUsers = function () {
    return this.isNeighborhoodCompletedAcrossAllUsers;
};

NeighborhoodModel.prototype.setNeighborhoodCompleteAcrossAllUsers = function () {
    this.isNeighborhoodCompletedAcrossAllUsers = true;
};

NeighborhoodModel.prototype.neighborhoodCompleted = function () {
    if (!this._neighborhoodContainer) return;
    this.trigger("Neighborhood:completed");
    this.isNeighborhoodCompleted = true;
};

function HandAnimation (rootDirectory, uiOnboarding) {
    var layer;
    var stage = null;
    var OpenHand;
    var ClosedHand;
    var OpenHandReady = false;
    var ClosedHandReady = false;
    var ImageObjOpenHand = new Image();
    var ImageObjClosedHand = new Image();
    var $handGestureHolder = uiOnboarding.holder.find('#hand-gesture-holder');
    var onboardingImageDirectory = rootDirectory + "img/onboarding/";

    this.initializeHandAnimation = function () {
        if ($handGestureHolder.length == 1) {
            this.hideGrabAndDragAnimation();

            if (!stage) {
                stage = new Kinetic.Stage({
                    container: $handGestureHolder.get(0),
                    width: 720,
                    height: 200
                });
                layer = new Kinetic.Layer();
                stage.add(layer);

                ImageObjOpenHand.onload = function () {
                    OpenHand = new Kinetic.Image({
                        x: 0,
                        y: stage.getHeight() / 2 - 59,
                        image: ImageObjOpenHand,
                        width: 128,
                        height: 128
                    });
                    OpenHand.hide();
                    layer.add(OpenHand);
                    OpenHandReady = true;
                };
                ImageObjOpenHand.src = onboardingImageDirectory + "HandOpen.png";

                ImageObjClosedHand.onload = function () {
                    ClosedHand = new Kinetic.Image({
                        x: 300,
                        y: stage.getHeight() / 2 - 59,
                        image: ImageObjClosedHand,
                        width: 96,
                        height: 96
                    });
                    ClosedHand.hide();
                    layer.add(ClosedHand);
                    ClosedHandReady = true;
                };
                ImageObjClosedHand.src = onboardingImageDirectory + "HandClosed.png";
            }
        }
    };

    /**
     * References:
     * Kineticjs callback: http://www.html5canvastutorials.com/kineticjs/html5-canvas-transition-callback-with-kineticjs/
     * Setposition: http://www.html5canvastutorials.com/labs/html5-canvas-animals-on-the-beach-game-with-kineticjs/
     */
    this.animateHand = function (direction) {
        if (direction === 'left-to-right') {
            ClosedHand.hide();
            OpenHand.setPosition(350,100);
            OpenHand.show();
            OpenHand.transitionTo({
                x: 350,
                y: 30,
                duration : 0.5,
                callback : function () {
                    setTimeout(function () {
                        OpenHand.hide();
                        ClosedHand.setPosition(400, 60);
                        ClosedHand.show();
                        ClosedHand.transitionTo({
                            x: 550,
                            y: 60,
                            duration: 1
                        });
                    }, 300);
                }
            });
        } else {
            ClosedHand.hide();
            OpenHand.setPosition(200,100);
            OpenHand.show();
            OpenHand.transitionTo({
                x: 200,
                y: 0,
                duration : 0.5,
                callback : function () {
                    setTimeout(function () {
                        OpenHand.hide();
                        ClosedHand.setPosition(200, 30);
                        ClosedHand.show();
                        ClosedHand.transitionTo({
                            x: 0,
                            y: 30,
                            duration: 1
                        });
                    }, 300);
                }
            });
        }
    };

    this.showGrabAndDragAnimation = function (parameters) {
        if (ClosedHandReady && OpenHandReady) {
            uiOnboarding.handGestureHolder.css("visibility", "visible");
            this.animateHand("left-to-right");
            return setInterval(this.animateHand.bind(null, "left-to-right"), 2000);
        }
    };

    this.hideGrabAndDragAnimation = function (interval) {
        // clearInterval(handAnimationInterval);
        clearInterval(interval);
        uiOnboarding.handGestureHolder.css("visibility", "hidden");
    }
}
function InitialMissionInstruction(compass, mapService, popUpMessage, taskContainer, labelContainer, tracker) {
    var self = this;
    var initialHeading;
    var lookingAroundInterval;
    var overallAngleViewed = 0;
    var initialPanoId;
    var maxAngleMousePan = 135; //TODO - Once panorama is resizable, the max panning angle needs to be updated

    this._finishedInstructionToStart = function () {
        if (!svl.isOnboarding()) {
            mapService.bindPositionUpdate(self._instructToCheckSidewalks);
        }
    };

    this._instructToCheckSidewalks = function () {
        if (!svl.isOnboarding()) {
            // Instruct a user to audit both sides of the streets once they have walked for 25 meters.
            var distance = taskContainer.getCompletedTaskDistance({units: 'kilometers'});
            if (distance >= 0.1) {
                var title = i18next.t('popup.both-sides-title');
                var message = i18next.t('popup.both-sides-body');
                var width = '450px';
                var height = '291px';
                var x = '50px';
                var image = "/assets/images/examples/lookaround-example.gif";
                tracker.push('PopUpShow_CheckBothSides');

                popUpMessage.notifyWithImage(title, message, width, height, x, image, function() {
                    mapService.unbindPositionUpdate(self._instructToCheckSidewalks);
                    mapService.bindPositionUpdate(self._instructForGSVLabelDisappearing);
                });
            }
        }
    };

    this._finishedInstructionForGSVLabelDisappearing = function () {
        mapService.stopBlinkingMinimap();

        if (!svl.isOnboarding()) {
            mapService.unbindPositionUpdate(self._instructForGSVLabelDisappearing);
        }
    };

    this._instructForGSVLabelDisappearing = function () {
        if (!svl.isOnboarding()) {
            // Instruct the user about GSV labels disappearing when they have labeled and walked for the first time
            var labels = labelContainer.getCurrentLabels();
            var prev_labels = labelContainer.getPreviousLabels();
            if (labels.length === 0) {
                labels = prev_labels;
            }
            var labelCount = labels.length;
            var nOnboardingLabels = 7;
            if (labelCount > 0) {
                if (svl.missionContainer.isTheFirstMission() && labelCount != nOnboardingLabels) {
                    var title = i18next.t('popup.labels-disappear-title');
                    var message = i18next.t('popup.labels-disappear-body');
                    tracker.push('PopUpShow_GSVLabelDisappear');

                    popUpMessage.notify(title, message, self._finishedInstructionForGSVLabelDisappearing);
                    mapService.blinkMinimap();
                }
            }
        }
    };

    this._instructToFollowTheGuidance = function () {
        if (!svl.isOnboarding()) {
            var title = i18next.t('popup.step-title');
            var message = i18next.t('popup.step-body');
            tracker.push('PopUpShow_LookAroundIntersection');

            popUpMessage.notify(title, message, function () {
                self._stopBlinkingNavigationComponents();
            });
            compass.blink();
            mapService.blinkMinimap();
        }
    };
    /*
    This function calculates raw difference in angle relative to previous heading angle.
     */
    this._transformAngle = function (angle) {
        var difference = angle - initialHeading;
        //135 is max degree swipe in panorama
        //if an impossible raw difference is calculated
        if (Math.abs(difference) >= maxAngleMousePan){
            //calculate difference in other direction of rotation
            if (initialHeading > 180){
                difference = 360 - initialHeading + angle;
            }
            else{
                difference = -360 + angle - initialHeading;
            }
        }

        return difference;
    };

    this._pollLookingAroundHasFinished = function () {

        //check the panoId to make sure the user hasn't walked
        if (mapService.getPanoId() == initialPanoId) {
            var currentHeadingAngle = mapService.getPov().heading;
            var transformedCurrent = self._transformAngle(currentHeadingAngle);

            // An explanation of why/how this code was changed to fix a bug can be found here:
            // https://github.com/ProjectSidewalk/SidewalkWebpage/pull/398#issuecomment-259284249
            overallAngleViewed = overallAngleViewed + transformedCurrent;
            initialHeading = currentHeadingAngle; //update heading angle previous

            //Absolute value of total angle viewed by user is more than 330 degrees
            if (Math.abs(overallAngleViewed) >= 330) {
                clearInterval(lookingAroundInterval);
                self._instructToFollowTheGuidance();
            }
        }
    };

    this._stopBlinkingNavigationComponents = function () {
        compass.stopBlinking();
        mapService.stopBlinkingMinimap();
    };

    this.start = function (neighborhood) {
        if (!svl.isOnboarding()) {
            $.getJSON('/cityShortNameParam', function(data) {
                var cityShortName = data.city_short_name;
                var title = i18next.t('popup.start-title');
                var message = i18next.t('popup.start-body',
                    { neighborhood: neighborhood.getProperty("name"), city: cityShortName });
                tracker.push('PopUpShow_LetsGetStarted');

                popUpMessage.notify(title, message, self._finishedInstructionToStart);

                initialHeading = mapService.getPov().heading;
                // lastHeadingTransformed = self._transformAngle(mapService.getPov().heading);
                initialPanoId = mapService.getPanoId();
                lookingAroundInterval = setInterval(self._pollLookingAroundHasFinished, 1);
            });
        }
    };

}
/**
 * Onboarding module.
 * Todo. So many dependencies! If possible, break the module down into pieces.
 * @param svl
 * @param audioEffect
 * @param compass
 * @param form
 * @param handAnimation
 * @param mapService
 * @param missionContainer
 * @param modalComment
 * @param modalSkip
 * @param onboardingModel
 * @param onboardingStates
 * @param ribbon
 * @param statusField
 * @param tracker
 * @param canvas
 * @param uiCanvas
 * @param contextMenu
 * @param uiOnboarding
 * @param uiLeft
 * @param user
 * @param zoomControl
 * @returns {{className: string}}
 * @constructor
 */
function Onboarding(svl, audioEffect, compass, form, handAnimation, mapService, missionContainer, modalComment,
                    modalSkip, onboardingModel, onboardingStates, ribbon, statusField, tracker, canvas, uiCanvas,
                    contextMenu, uiOnboarding, uiLeft, user, zoomControl) {
    var self = this;
    var ctx;
    var canvasWidth = 720;
    var canvasHeight = 480;
    var blink_timer = 0;
    var blink_function_identifier = [];
    var states = onboardingStates.get();

    var _mouseDownCanvasDrawingHandler;
    var currentLabelState;
    var map = svl.map.getMap();

    this.start = function () {
        tracker.push('Onboarding_Start');

        adjustMap();

        $("#navbar-retake-tutorial-btn").css("display", "none");

        var canvasUI = uiOnboarding.canvas.get(0);
        if (canvasUI) ctx = canvasUI.getContext('2d');
        uiOnboarding.holder.css("visibility", "visible");

        canvas.unlockDisableLabelDelete();
        canvas.disableLabelDelete();
        canvas.lockDisableLabelDelete();

        mapService.unlockDisableWalking();
        mapService.disableWalking();
        mapService.lockDisableWalking();

        zoomControl.unlockDisableZoomIn();
        zoomControl.disableZoomIn();
        zoomControl.lockDisableZoomIn();

        zoomControl.unlockDisableZoomOut();
        zoomControl.disableZoomOut();
        zoomControl.lockDisableZoomOut();

        ribbon.unlockDisableModeSwitch();
        ribbon.disableModeSwitch();
        ribbon.lockDisableModeSwitch();

        ribbon.unlockDisableMode();

        uiLeft.jump.addClass('disabled');
        uiLeft.stuck.addClass('disabled');

        compass.hideMessage();
        compass.disableCompassClick();

        _visit(getState("initialize"));
        handAnimation.initializeHandAnimation();

        onboardingModel.triggerStartOnboarding();
    };

    /**
     * Sets the mini map to be transparent for everything except for yellow pin.
     */
    function adjustMap() {
        map.setOptions({styles: [{ featureType: "all", stylers: [{ visibility: "off" }] }]});
        svl.ui.minimap.holder.css('backgroundImage', `url('${svl.rootDirectory}img/onboarding/TutorialMiniMap.jpg')`);
    }

    /**
     * Clear the onboarding canvas.
     * @returns {clear}
     */
    function clear() {
        if (ctx) ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        return this;
    }

    /**
     * Draw an arrow on the onboarding canvas
     * @param x1 {number} Starting x coordinate
     * @param y1 {number} Starting y coordinate
     * @param x2 {number} Ending x coordinate
     * @param y2 {number} Ending y coordinate
     * @param parameters {object} parameters
     * @returns {drawArrow}
     */
    function drawArrow(x1, y1, x2, y2, parameters) {
        if (ctx) {
            var lineWidth = parameters.lineWidth,
                fill = parameters.fill,
                lineCap = parameters.lineCap,
                arrowWidth = parameters.arrowWidth,
                strokeStyle  = parameters.strokeStyle,
                dx, dy, theta;

            if (!parameters.fill) {
                fill = 'rgba(255,255,255,1)';
            }

            dx = x2 - x1;
            dy = y2 - y1;
            theta = Math.atan2(dy, dx);

            ctx.save();
            ctx.fillStyle = fill;
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = lineCap;

            ctx.translate(x1, y1);
            ctx.beginPath();
            ctx.moveTo(arrowWidth * Math.sin(theta), -arrowWidth * Math.cos(theta));
            ctx.lineTo(dx + arrowWidth * Math.sin(theta), dy - arrowWidth * Math.cos(theta));

            // Draw an arrow head
            ctx.lineTo(dx + 3 * arrowWidth * Math.sin(theta), dy - 3 * arrowWidth * Math.cos(theta));
            ctx.lineTo(dx + 3 * arrowWidth * Math.cos(theta), dy + 3 * arrowWidth * Math.sin(theta));
            ctx.lineTo(dx - 3 * arrowWidth * Math.sin(theta), dy + 3 * arrowWidth * Math.cos(theta));

            ctx.lineTo(dx - arrowWidth * Math.sin(theta), dy + arrowWidth * Math.cos(theta));
            ctx.lineTo(-arrowWidth * Math.sin(theta), +arrowWidth * Math.cos(theta));

            ctx.fill();
            ctx.stroke();
            ctx.closePath();

            ctx.restore();
        }
        return this;
    }

    function drawBlinkingArrow(x1, y1, x2, y2, parameters, blink_frequency_modifier) {
        var max_frequency = 60 * blink_frequency_modifier;
        var blink_period = 0.5;
        var originalFillColor = parameters.fill;

        function helperBlinkingArrow() {
            blink_timer = (blink_timer + 1) % max_frequency;
            var param;
            if (blink_timer < blink_period * max_frequency) {
                parameters["fill"] = originalFillColor;
            } else {
                parameters["fill"] = "white";
            }
            param = parameters;
            drawArrow(x1, y1, x2, y2, param);

            //requestAnimationFrame usually calls the function argument at the refresh rate of the screen (max_frequency)
            //Assume this is 60fps. We want to have an arrow flashing period of 0.5s (blink period)
            var function_identifier = window.requestAnimationFrame(helperBlinkingArrow);
            blink_function_identifier.push(function_identifier);
        }
        helperBlinkingArrow();
    }

    function _removeFlashingFromArrow() {
        while (blink_function_identifier.length !== 0) {
            window.cancelAnimationFrame(blink_function_identifier.pop());
        }
    }

    function _stopAllBlinking() {
        mapService.stopBlinkingMinimap();
        compass.stopBlinking();
        statusField.stopBlinking();
        zoomControl.stopBlinking();
        audioEffect.stopBlinking();
        modalSkip.stopBlinking();
        modalComment.stopBlinking();
    }

    function _drawAnnotations(state) {
        var imX,
            imY,
            lineLength,
            lineAngle,
            x1,
            x2,
            y1,
            y2,
            origPointPov,
            canvasCoordinate;

        var currentPov = mapService.getPov();
        var povChange = svl.map.getPovChangeStatus();

        povChange["status"] = true;

        clear();

        var blink_frequency_modifier = 0;
        for (var i = 0, len = state.annotations.length; i < len; i++) {
            if (state.annotations[i].type === "arrow") {
                blink_frequency_modifier = blink_frequency_modifier + 1;
            }
        }

        for (var i = 0, len = state.annotations.length; i < len; i++) {
            imX = state.annotations[i].x;
            imY = state.annotations[i].y;
            origPointPov = null;

            // Setting the original POV and mapping an image coordinate to a canvas coordinate.
            if (currentPov.heading < 180) {
                if (imX > svl.svImageWidth - 3328 && imX > 3328) {
                    imX -= svl.svImageWidth;
                }
            } else {
                if (imX < 3328 && imX < svl.svImageWidth - 3328) {
                    imX += svl.svImageWidth;
                }
            }
            origPointPov = util.panomarker.calculatePointPovFromImageCoordinate(imX, imY, currentPov);
            canvasCoordinate = util.panomarker.getCanvasCoordinate(canvasCoordinate, origPointPov, currentPov);

            if (state.annotations[i].type === "arrow") {
                lineLength = state.annotations[i].length;
                lineAngle = state.annotations[i].angle;
                x2 = canvasCoordinate.x;
                y2 = canvasCoordinate.y;
                x1 = x2 - lineLength * Math.sin(util.math.toRadians(lineAngle));
                y1 = y2 - lineLength * Math.cos(util.math.toRadians(lineAngle));

                // The color of the arrow will by default alternate between white and the fill specified in annotation.
                var parameters = {
                    lineWidth: 1,
                    fill: state.annotations[i].fill,
                    lineCap: 'round',
                    arrowWidth: 6,
                    strokeStyle: 'rgba(96, 96, 96, 1)'
                };

                if (state.annotations[i].fill == null || state.annotations[i].fill === "white") {
                    drawArrow(x1, y1, x2, y2, parameters);
                }
                else {
                    drawBlinkingArrow(x1, y1, x2, y2, parameters, blink_frequency_modifier);
                }
            }
        }
        povChange["status"] = false;
    }

    function getState(stateIndex) {
        return states[stateIndex];
    }

    /**
     * Hide the message box.
     */
    function hideMessage() {
        if (uiOnboarding.messageHolder.is(":visible")) uiOnboarding.messageHolder.hide();
    }

    /**
     * Transition to the next state.
     * @param nextState
     * @param params Optional parameters that might be used by transition function.
     */
    function next(nextState, params) {
        if (typeof nextState === "function") {
            _visit(getState(nextState.call(this, params)));
        } else if (nextState in states) {
            _visit(getState(nextState));
        } else {
            _visit(null);
        }
    }

    /**
     * Show a message box.
     * @param parameters
     */
    function showMessage(parameters) {
        var message = parameters.message;

        uiOnboarding.messageHolder.toggleClass("yellow-background");
        setTimeout(function () {
            uiOnboarding.messageHolder.toggleClass("yellow-background");
        }, 100);

        uiOnboarding.messageHolder.css({
            top: 0,
            left: 0,
            width: 300
        });

        uiOnboarding.messageHolder.removeClass("animated fadeIn fadeInLeft fadeInRight fadeInDown fadeInUp");
        uiOnboarding.messageHolder.removeClass("callout top bottom left right lower-right");

        if (!uiOnboarding.messageHolder.is(":visible")) uiOnboarding.messageHolder.show();

        uiOnboarding.background.css("visibility", "hidden");
        if (parameters) {
            if ("width" in parameters) {
                uiOnboarding.messageHolder.css("width", parameters.width);
            }

            if ("left" in parameters) {
                uiOnboarding.messageHolder.css("left", parameters.left);
            }

            if ("top" in parameters) {
                uiOnboarding.messageHolder.css("top", parameters.top);
            }

            if ("background" in parameters && parameters.background) {
                uiOnboarding.background.css("visibility", "visible");
            }

            if ("arrow" in parameters) {
                uiOnboarding.messageHolder.addClass("callout " + parameters.arrow);
            }

            if ("fade-direction" in parameters) {
                uiOnboarding.messageHolder.addClass("animated " + parameters["fade-direction"]);
            }
        }

        uiOnboarding.messageHolder.html((typeof message === "function" ? message() : message));
    }

    function _endTheOnboarding(skip) {
        var mapStyleOptions = [
            {
                featureType: "all",
                stylers: [
                    { visibility: "off" }
                ]
            },
            {
                featureType: "road",
                stylers: [
                    { visibility: "on" }
                ]
            },
            {
                "elementType": "labels",
                "stylers": [
                    { "visibility": "off" }
                ]
            }
        ];
        if (map) map.setOptions({styles: mapStyleOptions});
        map.setOptions({styles: mapStyleOptions});
        if (skip) {
            tracker.push("Onboarding_Skip");
            missionContainer.getCurrentMission().setProperty("skipped", true);
        }
        tracker.push('Onboarding_End');
        missionContainer.getCurrentMission().setProperty("isComplete", true);

        // Redirects to the audit page and submits all data through Form.js.
        svl.form.submitData(false);
        window.location.replace('/audit');
    }

    function _onboardingStateAnnotationExists(state) {
        return "annotations" in state && state.annotations;
    }

    function _onboardingStateMessageExists(state) {
        return "message" in state && state.message;
    }

    function getCurrentLabelState() {
        return currentLabelState;
    }

    function blinkInterface(state) {
        // Blink parts of the interface.
        if ("blinks" in state.properties && state.properties.blinks) {
            var len = state.properties.blinks.length;
            for (var i = 0; i < len; i++) {
                switch (state.properties.blinks[i]) {
                    case "minimap":
                        mapService.blinkMinimap();
                        break;
                    case "compass":
                        compass.blink();
                        break;
                    case "status-field":
                        statusField.blink();
                        break;
                    case "zoom":
                        zoomControl.blink();
                        break;
                    case "sound":
                        audioEffect.blink();
                        break;
                    case "stuck":
                        modalSkip.blink();
                        break;
                    case "feedback":
                        modalComment.blink();
                        break;
                    case "movement-arrow":
                        mapService.blinkNavigationArrows();
                        break;
                }
            }
        }
    }

    /**
     * Execute an instruction based on the current state.
     * @param state
     */
    function _visit(state) {
        var annotationListener;

        clear(); // Clear what ever was rendered on the onboarding-canvas in the previous state.
        _removeFlashingFromArrow();

        // End the onboarding if there is no transition state is specified. Move to the actual task
        if ("end-onboarding" in state) {
            _endTheOnboarding(state["end-onboarding"]["skip"]);
            return;
        } else {
            hideMessage();
        }

        // Show user a message box.
        if (_onboardingStateMessageExists(state)) {
            showMessage(state.message);
        }

        // Draw arrows to annotate target accessibility attributes
        if (_onboardingStateAnnotationExists(state)) {
            _drawAnnotations(state);
            if (typeof google != "undefined") {
                annotationListener = google.maps.event.addListener(svl.panorama, "pov_changed", function () {
                    //Stop the animation for the blinking arrows
                    _removeFlashingFromArrow();
                    _drawAnnotations(state);
                });
            }
        }

        // Change behavior based on the current state.
        if ("properties" in state) {
            // Remove blinking if necessary.
            if (state.properties.stopBlinking) {
                _stopAllBlinking();
            }

            if (state.properties.constructor === Array) {
                // Restrict panning.
                mapService.setHeadingRange([state.properties[0].minHeading, state.properties[0].maxHeading]);

                // Ideally we need a for loop that goes through every element of the property array and calls the
                // corresponding action's handler. Not just the label accessibility attribute's handler.
                if (state.properties[0].action === "LabelAccessibilityAttribute") {
                    _visitLabelAccessibilityAttributeState(state, annotationListener);
                }
            }
            else {
                // Restrict panning.
                mapService.setHeadingRange([state.properties.minHeading, state.properties.maxHeading]);
                if (state.properties.action === "Introduction") {
                    _visitIntroduction(state, annotationListener);
                } else if (state.properties.action === "SelectLabelType" || state.properties.action === "RedoSelectLabelType") {
                    _visitSelectLabelTypeState(state, annotationListener);
                } else if (state.properties.action === "DeleteAccessibilityAttribute") {
                    _visitDeleteAccessibilityAttributeState(state, annotationListener);
                } else if (state.properties.action === "Zoom") {
                    _visitZoomState(state, annotationListener);
                } else if (state.properties.action === "RateSeverity" || state.properties.action === "RedoRateSeverity") {
                    _visitRateSeverity(state, annotationListener);
                } else if (state.properties.action === "AddTag" || state.properties.action === "RedoAddTag") {
                    _visitAddTag(state, annotationListener);
                } else if (state.properties.action === "AdjustHeadingAngle") {
                    _visitAdjustHeadingAngle(state, annotationListener);
                } else if (state.properties.action === "WalkTowards") {
                    _visitWalkTowards(state, annotationListener);
                } else if (state.properties.action === "Instruction") {
                    _visitInstruction(state, annotationListener);
                }
            }
        }
    }

    function _visitIntroduction(state, listener) {
        var pov = {
                heading: state.properties.heading,
                pitch: state.properties.pitch,
                zoom: state.properties.zoom
            },
            googleTarget,
            googleCallback,
            $target;

        // I need to nest callbacks due to the bug in Street View; I have to first set panorama, and set POV
        // once the panorama is loaded. Here I let the panorama load while the user is reading the instruction.
        // When they click OK, then the POV changes.
        if (typeof google != "undefined") {
            googleCallback = function () {
                mapService.setPano(state.panoId, true);
                google.maps.event.removeListener(googleTarget);
            };

            googleTarget = google.maps.event.addListener(svl.panorama, "position_changed", googleCallback);

            $target = $("#onboarding-message-holder").find(".onboarding-transition-trigger");
            $(".onboarding-transition-trigger").css({
                'cursor': 'pointer'
            });
            function callback () {
                if (listener) google.maps.event.removeListener(listener);
                $target.off("click", callback);
                next.call(this, state.transition);
                mapService.setPano(state.panoId, true);
                mapService.setPov(pov);
                mapService.setPosition(state.properties.lat, state.properties.lng);

                compass.hideMessage();
            }

            $target.on("click", callback);
        }
    }

    function _visitWalkTowards(state, listener) {
        var nextPanoId = 'afterWalkTutorial';
        // Add a link to the second pano so that the user can click on it.
        svl.panorama.setLinks([{
            description: nextPanoId,
            heading: 340,
            pano: nextPanoId
        }]);
        mapService.unlockDisableWalking();
        mapService.enableWalking();
        mapService.lockDisableWalking();

        // Allow clicking on the navigation message to move to the next pano.
        var clickToNextPano = function() {
            mapService.setPano(nextPanoId, true);
        }
        svl.ui.compass.messageHolder.on('click', clickToNextPano);
        svl.ui.compass.messageHolder.css('cursor', 'pointer');

        blinkInterface(state);

        var $target;
        var callback = function () {
            var panoId = mapService.getPanoId();
            if (state.properties.panoId === panoId) {
                window.setTimeout(function () {
                    mapService.unlockDisableWalking().disableWalking().lockDisableWalking();
                }, 1000);
                svl.ui.compass.messageHolder.off('click', clickToNextPano);
                svl.ui.compass.messageHolder.css('cursor', 'default');
                if (typeof google != "undefined") google.maps.event.removeListener($target);
                if (listener) google.maps.event.removeListener(listener);
                next(state.transition);
            } else {
                console.error("Pano mismatch. Shouldn't reach here");
                // Force the interface to go to the correct position.
                mapService.setPano(nextPanoId, true);
            }
        };

        // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
        if (typeof google != "undefined") $target = google.maps.event.addListener(svl.panorama, "position_changed", callback);
    }

    function _visitAdjustHeadingAngle(state, listener) {
        var $target;
        var interval;
        interval = handAnimation.showGrabAndDragAnimation({direction: "left-to-right"});

        var callback = function () {
            var pov = mapService.getPov();
            if ((360 + state.properties.heading - pov.heading) % 360 < state.properties.tolerance) {
                if (typeof google != "undefined") google.maps.event.removeListener($target);
                if (listener) google.maps.event.removeListener(listener);
                handAnimation.hideGrabAndDragAnimation(interval);
                next(state.transition);
            }
        };

        if (typeof google != "undefined") $target = google.maps.event.addListener(svl.panorama, "pov_changed", callback);
    }

    function _visitRateSeverity(state, listener) {
        contextMenu.disableTagging();
        var $target = contextMenu.getContextMenuUI().radioButtons;
        var callback = function () {
            if (listener) google.maps.event.removeListener(listener);
            $target.off("click", callback);
            contextMenu.enableTagging();
            next.call(this, state.transition);
        };
        $target.on("click", callback);
    }
    function _visitAddTag(state, listener) {
        var $target = contextMenu.getContextMenuUI().tagHolder; // Grab tag holder so we can add an event listener.
        var callback = function () {
            if (listener) {
                google.maps.event.removeListener(listener);
            }
            $target.off("tagIds-updated", callback);
            next.call(contextMenu.getTargetLabel(), state.transition);
        };
        // We use a custom event here to ensure that this is triggered after the tags have been updated.
        $target.on("tagIds-updated", callback);
    }

    function _visitInstruction(state, listener) {
        if (state === getState("outro")) {
            $("#mini-footer-audit").css("visibility", "hidden");
        }
        blinkInterface(state);

        if (!("okButton" in state) || state.okButton) {
            // Insert an ok button.
            var okButtonText = 'OK';
            if (state.okButtonText) {
                okButtonText = state.okButtonText;
            }
            uiOnboarding.messageHolder.append("<br/><button id='onboarding-ok-button' class='button width-50'>" +
                okButtonText + "</button>");
        }

        var $target = $("#onboarding-ok-button");
        var callback = function () {
            if (listener) google.maps.event.removeListener(listener);
            $target.off("click", callback);
            if ("blinks" in state.properties && state.properties.blinks) {
                _stopAllBlinking();
            }
            next.call(this, state.transition);
        };
        $target.on("click", callback);
    }

    /**
     * Blink the given label type and nudge them to click one of the buttons in the ribbon menu.
     * Move on to the next state if they click the button.
     * @param state
     * @param listener
     * @private
     */
    function _visitSelectLabelTypeState(state, listener) {
        var labelType = state.properties.labelType;
        var subcategory = "subcategory" in state.properties ? state.properties.subcategory : null;
        var event;

        if (subcategory) {
            event = subcategory
        } else {
            event = labelType
        }

        if (state === getState("select-label-type-1")) {
            $("#mini-footer-audit").css("visibility", "visible");
        }
        ribbon.enableMode(labelType, subcategory);
        ribbon.startBlinking(labelType, subcategory);

        // To handle when user presses ESC - disable mode only when the user places the label
        _mouseDownCanvasDrawingHandler = function () {
            ribbon.disableMode(labelType, subcategory);
        };

        var callback = function () {
            ribbon.enableMode("Walk");

            // Disable only when the user places the label
            uiCanvas.drawingLayer.on("mousedown", _mouseDownCanvasDrawingHandler);

            ribbon.stopBlinking();
            $(document).off('ModeSwitch_' + event, callback);
            if (listener) google.maps.event.removeListener(listener);
            next(state.transition);
        };

        $(document).on('ModeSwitch_' + event, callback);
    }

    /**
     * Tell the user to zoom in/out.
     * @param state
     * @param listener
     * @private
     */
    function _visitZoomState(state, listener) {
        var zoomType = state.properties.type;
        var event;

        if (zoomType === "in") {
            event = 'ZoomIn';
            zoomControl.blinkZoomIn();
            zoomControl.unlockDisableZoomIn();
            zoomControl.enableZoomIn();
            zoomControl.lockDisableZoomIn();

        } else {
            event = 'ZoomOut';
            zoomControl.blinkZoomOut();

            // Enable zoom-out
            zoomControl.unlockDisableZoomOut();
            zoomControl.enableZoomOut();
            zoomControl.lockDisableZoomOut();
        }

        var callback = function () {
            zoomControl.stopBlinking();
            if (zoomType === "in") {
                // Disable zoom-in
                zoomControl.unlockDisableZoomIn();
                zoomControl.disableZoomIn();
                zoomControl.lockDisableZoomIn();
            }
            else {
                // Disable zoom-out
                zoomControl.unlockDisableZoomOut();
                zoomControl.disableZoomOut();
                zoomControl.lockDisableZoomOut();
            }
            ribbon.enableMode("Walk");
            $(document).off(event, callback);

            if (listener) google.maps.event.removeListener(listener);
            next(state.transition);
        };

        $(document).on(event, callback);
    }

    /**
     * Tell the user to label the multiple possible target attributes.
     * @param state
     * @param listener
     * @private
     */
    function _visitLabelAccessibilityAttributeState(state, listener) {
        var $target = uiCanvas.drawingLayer;
        var properties = state.properties;
        var transition = state.transition;

        var callback = function (e) {
            var i = 0;
            var labelAppliedCorrectly = false;
            var distance = []; // Keeps track of how far away the label is from each possible label.

            while (i < properties.length && !labelAppliedCorrectly) {
                var imageX = properties[i].imageX;
                var imageY = properties[i].imageY;
                var tolerance = properties[i].tolerance;

                var clickCoordinate = mouseposition(e, this);
                var pov = mapService.getPov();
                var canvasX = clickCoordinate.x;
                var canvasY = clickCoordinate.y;
                var imageCoordinate = util.panomarker.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov);

                distance[i] = (imageX - imageCoordinate.x) * (imageX - imageCoordinate.x) +
                    (imageY - imageCoordinate.y) * (imageY - imageCoordinate.y);
                currentLabelState = state;
                i = i + 1;
            }

            var indexOfClosest = distance.indexOf(Math.min(...distance));
            if (distance[indexOfClosest] < tolerance * tolerance) {
                // Disable deleting of label
                canvas.unlockDisableLabelDelete();
                canvas.disableLabelDelete();
                canvas.lockDisableLabelDelete();

                // Disable labeling mode
                ribbon.disableMode(properties[indexOfClosest].labelType, properties[indexOfClosest].subcategory);
                ribbon.enableMode("Walk");
                uiCanvas.drawingLayer.off("mousedown", _mouseDownCanvasDrawingHandler);

                if (listener) google.maps.event.removeListener(listener);
                next(transition[indexOfClosest], { accurate: true });
            } else {
                next(transition[indexOfClosest], { accurate: false });
            }
            $target.off("click", callback);
        };
        $target.on("click", callback);
    }

    /**
     * Tell the user to delete the label they placed that is far away from where they were supposed to place it.
     *
     * @param state
     * @param listener
     * @private
     */
    function _visitDeleteAccessibilityAttributeState(state, listener) {
        ribbon.disableMode(state.properties.labelType, state.properties.subcategory);
        ribbon.enableMode("Walk");
        canvas.unlockDisableLabelDelete();
        canvas.enableLabelDelete();
        canvas.lockDisableLabelDelete();

        // Callback for deleted label.
        var deleteLabelCallback = function () {
            if (listener) google.maps.event.removeListener(listener);
            $(document).off('RemoveLabel', deleteLabelCallback);
            clear();
            _removeFlashingFromArrow(); // TODO remove this if it turns out that we don't need it.
            next(state.transition);
        };
        $(document).on('RemoveLabel', deleteLabelCallback);
    }

    self.clear = clear;
    self.next = next;
}

function OnboardingModel () {
}

OnboardingModel.prototype.triggerStartOnboarding = function (parameters) {
    this.trigger("Onboarding:startOnboarding");
};

_.extend(OnboardingModel.prototype, Backbone.Events);

function OnboardingStates (contextMenu, compass, mapService, statusModel, tracker) {
    var numSteps = 41;
    var panoId = "tutorial";
    var afterWalkPanoId = "afterWalkTutorial";
    var headingRanges = {
        "stage-1": [238, 242],
        "stage-2-adjust": [197, 242],
        "stage-2": [197, 209],
        "stage-3-adjust": [98, 197],
        "stage-3": [98, 108],
        "stage-4-adjust": [359, 108],
        "stage-4": [355, 1],
        "stage-5-adjust": [315, 1],
        "stage-5": [315, 343],
        "stage-6": [281, 14]
    };

    function _updateProgressBar(stepNumber) {
        var completedRate = stepNumber / numSteps;
        statusModel.setMissionCompletionRate(completedRate);
        statusModel.setProgressBar(completedRate);
    }

    this.states = {
        "initialize": {
            "properties": {
                "action": "Introduction",
                "heading": 241,
                "pitch": -6,
                "zoom": 1,
                "lat": 38.9404982935884,
                "lng": -77.06762207994893
            },
            "message": {
                "message": function () {
                    var dom = document.getElementById("onboarding-initial-instruction");
                    return dom ? dom.innerHTML : "";
                },
                "width": 1000,
                "top": -50,
                "left": -70,
                "padding": "100px 10px 100px 10px",
                "background": true
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "initialize", step: 0});
                var value = this.getAttribute("value");
                // If "Let's get started!" button is clicked.
                if (value === "OK") {
                    _updateProgressBar(1);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-1", step: 1});
                    return "select-label-type-1";
                } else {
                    return "end-onboarding-skip";
                }
            }
        },
        "end-onboarding-skip": {
            "end-onboarding": {
                "skip": true
            }
        },
        "select-label-type-1": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-1'),
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": function () {
                _updateProgressBar(2);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-1", step: 2});
                return "label-attribute-1";
            }
        },
        "label-attribute-1": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 9730,
                "imageY": -350,
                "tolerance": 300,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-1'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(3);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-1", step: 3});
                    return "rate-severity-1";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-1"});
                    return "delete-attribute-1";
                }
            }]
        },
        "delete-attribute-1": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-1"});
                return "redo-select-label-type-1";
            }
        },
        "redo-select-label-type-1": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-1"});
                return "label-attribute-1";
            }
        },
        "rate-severity-1": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-1') +
                    '<br><img src="' + svl.rootDirectory + 'img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" ' +
                    'class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 2, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(4);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-1", step: 4});
                    return "adjust-heading-angle-1";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-1"});
                    return "redo-rate-attribute-1";
                }
            }
        },
        "redo-rate-attribute-1": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 2,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 2, somewhat passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(4);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-1", step: 4});
                    return "adjust-heading-angle-1";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-1"});
                    return "redo-rate-attribute-1";
                }
            }
        },
        "adjust-heading-angle-1": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 210,
                "tolerance": 20,
                "minHeading": headingRanges["stage-2-adjust"][0],
                "maxHeading": headingRanges["stage-2-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-1'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(5);
                tracker.push('Onboarding_Transition', {onboardingTransition: "zoom-in", step: 5});
                return "zoom-in";
            }
        },
        "zoom-in": {
            "properties": {
                "action": "Zoom",
                "type": "in",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.zoom-in'),
                "fade-direction": "fadeInRight",
                "arrow": "left",
                "top": -53
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(6);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-2", step: 6});
                return "select-label-type-2";
            }
        },
        "select-label-type-2": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-2'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 8180,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                _updateProgressBar(7);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-2", step: 7});
                return "label-attribute-2";
            }
        },
        "label-attribute-2": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 8180,
                "imageY": -340,
                "tolerance": 300,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.common.label-curb-ramp'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 8180,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(8);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-2", step: 8});
                    return "rate-severity-2";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-2"});
                    return "delete-attribute-2";
                }
            }]
        },
        "delete-attribute-2": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 8180,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-2"});
                return "redo-select-label-type-2";
            }
        },
        "redo-select-label-type-2": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 8180,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-2"});
                return "label-attribute-2";
            }
        },
        "rate-severity-2": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": 2,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-2') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" + '" ' +
                'class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 2, somewhat passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 2) {
                    _updateProgressBar(9);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-2", step: 9});
                    return "tag-attribute-2";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-2"});
                    return "redo-rate-attribute-2";
                }
            }
        },
        "redo-rate-attribute-2": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 2,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-2') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 2, ' +
                'somewhat passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 2) {
                    _updateProgressBar(9);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-2", step: 9});
                    return "tag-attribute-2";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-2"});
                    return "redo-rate-attribute-2";
                }
            }
        },
        "tag-attribute-2": {
            "properties": {
                "action": "AddTag",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-2') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'points into traffic\' tag">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(23) && tags.length === 1) { // 23 is the id of the "not enough landing space" tag.
                    contextMenu.hide();
                    _updateProgressBar(10);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-3", step: 10});
                    return "select-label-type-3";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-2"});
                    return "redo-tag-attribute-2";
                }
            }
        },
        "redo-tag-attribute-2": {
            "properties": {
                "action": "RedoAddTag",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-2') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'points into traffic\' tag">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(23) && tags.length === 1) { // 23 is the id of the "not enough landing space" tag.
                    contextMenu.hide();
                    _updateProgressBar(10);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-3", step: 10});
                    return "select-label-type-3";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-2"});
                    return "redo-tag-attribute-2";
                }
            }
        },
        "select-label-type-3": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-3'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7800,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                _updateProgressBar(11);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-3", step: 11});
                return "label-attribute-3";
            }
        },
        "label-attribute-3": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "NoCurbRamp",
                "imageX": 7800,
                "imageY": -340,
                "tolerance": 300,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-3'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7800,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(12);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-3", step: 12});
                    return "rate-severity-3";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-3"});
                    return "delete-attribute-3";
                }
            }]
        },
        "delete-attribute-3": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7800,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-3"});
                return "redo-select-label-type-3";
            }
        },
        "redo-select-label-type-3": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('NoCurbRamp-description')}),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7800,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-3"});
                return "label-attribute-3";
            }
        },
        "rate-severity-3": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "NoCurbRamp",
                "severity": 3,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-3') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as ' +
                    '3, a slightly severe problem">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    _updateProgressBar(13);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-3", step: 13});
                    return "tag-attribute-3";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-3"});
                    return "redo-rate-attribute-3";
                }
            }
        },
        "redo-rate-attribute-3": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "NoCurbRamp",
                "severity": 3,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-3') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as 3, ' +
                'a slightly severe problem">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    _updateProgressBar(13);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-3", step: 13});
                    return "tag-attribute-3";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-3"});
                    return "redo-rate-attribute-3";
                }
            }
        },
        "tag-attribute-3": {
            "properties": {
                "action": "AddTag",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-3') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'alternate route present\' tag">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(5) && tags.length === 1) { // 5 is the id of the "alternate route present" tag.
                    contextMenu.hide();
                    _updateProgressBar(14);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "zoom-out", step: 14});
                    return "zoom-out";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-3"});
                    return "redo-tag-attribute-3";
                }
            }
        },
        "redo-tag-attribute-3": {
            "properties": {
                "action": "RedoAddTag",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-3') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'alternate route present\' tag">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(5) && tags.length === 1) { // 5 is the id of the "alternate route present" tag.
                    contextMenu.hide();
                    _updateProgressBar(14);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "zoom-out", step: 14});
                    return "zoom-out";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-3"});
                    return "redo-tag-attribute-3";
                }
            }
        },
        "zoom-out": {
            "properties": {
                "action": "Zoom",
                "type": "out",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.zoom-out'),
                "fade-direction": "fadeInRight",
                "arrow": "left",
                "top": 7
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(15);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-2", step: 15});
                return "adjust-heading-angle-2";
            }
        },
        "adjust-heading-angle-2": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 177,
                "tolerance": 20,
                "minHeading": headingRanges["stage-3-adjust"][0],
                "maxHeading": headingRanges["stage-3-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-2'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(16);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-3", step: 16});
                return "adjust-heading-angle-3";
            }
        },
        "adjust-heading-angle-3": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 115,
                "tolerance": 20,
                "minHeading": headingRanges["stage-3-adjust"][0],
                "maxHeading": headingRanges["stage-3-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-3'),
                "width": 190
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(17);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-4", step: 17});
                return "select-label-type-4";
            }
        },
        "select-label-type-4": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-4'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "fill": "white"
                },
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": "white"
                }
            ],
            "transition": function () {
                _updateProgressBar(18);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-both-curbs", step: 18});
                return "label-both-curbs";
            }
        },
        "label-both-curbs": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 4920,
                "imageY": -720,
                "tolerance": 300,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 3900,
                "imageY": -840,
                "tolerance": 300
            }],
            "message": {
                "message": i18next.t('tutorial.label-both-curbs'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                },
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(19);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-4", step: 19});
                    return "rate-severity-4";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-4"});
                    return "delete-attribute-4";
                }
            }, function (params) {
                if (params.accurate) {
                    _updateProgressBar(19);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-5-goto-4", step: 19});
                    return "rate-severity-5-goto-4";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-4"});
                    return "delete-attribute-4";
                }
            }]
        },
        "delete-attribute-4": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                },
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-4"});
                return "redo-select-label-type-4";
            }
        },
        "redo-select-label-type-4": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "fill": "white"
                },
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": "white"
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-both-curbs"});
                return "label-both-curbs";
            }
        },
        "rate-severity-4": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-4') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(20);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-5", step: 20});
                    return "select-label-type-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4"});
                    return "redo-rate-attribute-4";
                }
            }
        },
        "redo-rate-attribute-4": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(20);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-5", step: 20});
                    return "select-label-type-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4"});
                    return "redo-rate-attribute-4";
                }
            }
        },
        "select-label-type-5": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.select-label-type-second-curb-ramp'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": "white"
                }
            ],
            "transition": function () {
                _updateProgressBar(21);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-5", step: 21});
                return "label-attribute-5";
            }
        },
        "label-attribute-5": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 3900,
                "imageY": -840,
                "tolerance": 300,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.common.label-curb-ramp'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(22);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-5", step: 22});
                    return "rate-severity-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-5"});
                    return "delete-attribute-5";
                }
            }]
        },
        "delete-attribute-5": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-5"});
                return "redo-select-label-type-5";
            }
        },
        "redo-select-label-type-5": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-5"});
                return "label-attribute-5";
            }
        },
        "rate-severity-5": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-curb-ramp') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(23);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6", step: 23});
                    return "select-label-type-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5"});
                    return "redo-rate-attribute-5";
                }
            }
        },
        "redo-rate-attribute-5": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(23);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6", step: 23});
                    return "select-label-type-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5"});
                    return "redo-rate-attribute-5";
                }
            }
        },
        "select-label-type-4-after-5": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.select-label-type-second-curb-ramp'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "fill": "white"
                }

            ],
            "transition": function () {
                _updateProgressBar(21);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-4-after-5", step: 21});
                return "label-attribute-4-after-5";
            }
        },
        "label-attribute-4-after-5": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 4920,
                "imageY": -720,
                "tolerance": 300,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.common.label-curb-ramp'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(22);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-4-after-5", step: 22});
                    return "rate-severity-4-after-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-4-after-5"});
                    return "delete-attribute-4-after-5";
                }
            }]
        },
        "delete-attribute-4-after-5": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-4-after-5"});
                return "redo-select-label-type-4-after-5";
            }
        },
        "redo-select-label-type-4-after-5": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-4-after-5"});
                return "label-attribute-4-after-5";
            }
        },
        "rate-severity-4-after-5": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-4') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(23);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6", step: 23});
                    return "select-label-type-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4-after-5"});
                    return "redo-rate-attribute-4-after-5";
                }
            }
        },
        "redo-rate-attribute-4-after-5": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(23);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6", step: 23});
                    return "select-label-type-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4-after-5"});
                    return "redo-rate-attribute-4-after-5";
                }
            }
        },
        "rate-severity-5-goto-4": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-curb-ramp') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(20);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-4-after-5", step: 20});
                    return "select-label-type-4-after-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5-goto-4"});
                    return "redo-rate-attribute-5-goto-4";
                }
            }
        },
        "redo-rate-attribute-5-goto-4": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(20);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-4-after-5", step: 20});
                    return "select-label-type-4-after-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5-goto-4"});
                    return "redo-rate-attribute-5-goto-4";
                }
            }
        },
        "select-label-type-6": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-6'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 2776,
                    "y": -500,
                    "length": 50,
                    "angle": 0,
                    "fill": "white"
                }
            ],
            "transition": function () {
                _updateProgressBar(24);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-6", step: 24});
                return "label-attribute-6";
            }
        },
        "label-attribute-6": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "NoSidewalk",
                "imageX": 2776,
                "imageY": -500,
                "tolerance": 300,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-6'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 2776,
                    "y": -500,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(25);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-6", step: 25});
                    return "rate-severity-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-6"});
                    return "delete-attribute-6";
                }
            }]
        },
        "delete-attribute-6": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 2776,
                    "y": -500,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-6"});
                return "redo-select-label-type-6";
            }
        },
        "redo-select-label-type-6": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('NoSidewalk-description')}),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 2776,
                    "y": -500,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-6"});
                return "label-attribute-6";
            }
        },
        "rate-severity-6": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "NoSidewalk",
                "severity": 3,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no sidewalk quality ' +
                    'as 3, a slightly severe problem">',
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    _updateProgressBar(26);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-6", step: 26});
                    return "tag-attribute-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-6"});
                    return "redo-rate-attribute-6";
                }
            }
        },
        "redo-rate-attribute-6": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "NoSidewalk",
                "severity": 3,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no sidewalk quality ' +
                    'as 3, a slightly severe problem">',
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    _updateProgressBar(26);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-6", step: 26});
                    return "tag-attribute-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-6"});
                    return "redo-rate-attribute-6";
                }
            }
        },
        "tag-attribute-6": {
            "properties": {
                "action": "AddTag",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'ends abruptly\' and \'street has a sidewalk\' tags">',
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.length === 2 && tags.includes(20) && tags.includes(21)) {
                    // We have both tags correct, so lets continue.
                    contextMenu.hide();
                    _updateProgressBar(28);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-4", step: 28});
                    return "adjust-heading-angle-4";
                } else if (tags.length === 1 && (tags.includes(20) || tags.includes(21))) {
                    // We have one of the two tags so far, so stay in this state.
                    _updateProgressBar(27);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-6", step: 27});
                    return "tag-attribute-6";
                } else {
                    // A mistake was made, move to the redo state.
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-6"});
                    return "redo-tag-attribute-6";
                }
            }
        },
        "redo-tag-attribute-6": {
            "properties": {
                "action": "RedoAddTag",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'ends abruptly\' and \'street has a sidewalk\' tags">',
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.length === 2 && tags.includes(20) && tags.includes(21)) {
                    // We have both tags correct, so lets continue.
                    _updateProgressBar(28);
                    contextMenu.hide();
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-4", step: 28});
                    return "adjust-heading-angle-4";
                } else if (tags.includes(20) || tags.includes(21)) {
                    // We have at least one of the two tags so far, but not both. Move progress bar, stay in this state.
                    _updateProgressBar(27);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-6", step: 27});
                    return "redo-tag-attribute-6";
                } else {
                    // We don't have any correct tags, don't move progress bar forward, stay in same state.
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-6"});
                    return "redo-tag-attribute-6";
                }
            }
        },
        "adjust-heading-angle-4": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 0,
                "tolerance": 20,
                "minHeading": headingRanges["stage-4-adjust"][0],
                "maxHeading": headingRanges["stage-4-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-4'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(29);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-7", step: 29});
                return "select-label-type-7";
            }
        },
        "select-label-type-7": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-7'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 750,
                    "y": -670,
                    "length": 50,
                    "angle": 0,
                    "fill": "white"
                }
            ],
            "transition": function () {
                _updateProgressBar(30);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-7", step: 30});
                return "label-attribute-7";
            }
        },
        "label-attribute-7": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 750,
                "imageY": -670,
                "tolerance": 250,
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-7'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 750,
                    "y": -670,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(31);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-7", step: 31});
                    return "rate-severity-7";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-7"});
                    return "delete-attribute-7";
                }
            }]
        },
        "delete-attribute-7": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 750,
                    "y": -670,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-7"});
                return "redo-select-label-type-7";
            }
        },
        "redo-select-label-type-7": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 750,
                    "y": -670,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-7"});
                return "label-attribute-7";
            }
        },
        "rate-severity-7": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-curb-ramp') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(32);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-5", step: 32});
                    return "adjust-heading-angle-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-7"});
                    return "redo-rate-attribute-7";
                }
            }
        },
        "redo-rate-attribute-7": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(32);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-5", step: 32});
                    return "adjust-heading-angle-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-7"});
                    return "redo-rate-attribute-7";
                }
            }
        },
        "adjust-heading-angle-5": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 346,
                "tolerance": 20,
                "minHeading": headingRanges["stage-5-adjust"][0],
                "maxHeading": headingRanges["stage-5-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-5'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(33);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-1", step: 33});
                return "walk-1";
            }
        },
        "walk-1": {
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
                "blinks": ["minimap"]
            },
            "message": {
                "message": i18next.t('tutorial.walk-1'),
                "fade-direction": "fadeInLeft",
                "arrow": "right",
                "top": 270,
                "left": 405
            },
            "panoId": panoId,
            "transition": function () {
                _updateProgressBar(34);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-2", step: 34});

                // Set Compass Message
                var uiCompassMessageHolder = compass.getCompassMessageHolder();
                var image = "<img src='" + compass.directionToImagePath("straight") + "' class='compass-turn-images' alt='Turn icon' />";
                var message =  "<span class='compass-message-small'>" + i18next.t('center-ui.compass.unlabeled-problems') +
                    "</span><br/>" + image + "<span class='bold'>" + i18next.t('center-ui.compass.straight') + "</span>";
                uiCompassMessageHolder.message.html(message);
                compass.showMessage();
                return "walk-2";
            }
        },
        "walk-2": {
            "properties": {
                "action": "Instruction",
                "blinks": ["compass"],
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1]
            },
            "message": {
                "message": i18next.t('tutorial.walk-2'),
                "fade-direction": "fadeInDown",
                "arrow": "bottom",
                "top": 225,
                "left": 405
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(35);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-3", step: 35});
                return "walk-3";
            }
        },
        "walk-3": {
            "properties": {
                "action": "WalkTowards",
                "blinks": ["compass", "movement-arrow"],
                "panoId": afterWalkPanoId,
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
                "fade-direction": "fadeIn"
            },
            "message": {
                "message": i18next.t('tutorial.walk-3'),
                "parameters": null
            },
            "panoId": panoId,
            "transition": function () {
                _updateProgressBar(36);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-4", step: 36});
                mapService.setPov({heading: 330, pitch: 0, zoom: 1});
                svl.ui.minimap.holder.css('backgroundImage', `url('${svl.rootDirectory}img/onboarding/afterWalkTutorialMiniMap.jpg')`);
                return "walk-4";
            }
        },
        "walk-4": {
            "properties": {
                "action": "Instruction",
                "stopBlinking": true,
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1],
                "blinks": ["minimap"]
            },
            "message": {
                "message": i18next.t('tutorial.walk-4'),
                "width": 350,
                "arrow": "right",
                "fade-direction": "fadeInLeft",
                "top": 254,
                "left": 350
            },
            "panoId": afterWalkPanoId,
            "annotations": null,
            // okButtonText: "Yes! I see the missing curb ramps.",
            "transition": function () {
                _updateProgressBar(37);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-5", step: 37});
                return "walk-5";
            }
        },
        "walk-5": {
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1]
            },
            "message": {
                "message": i18next.t('tutorial.walk-5-1'),
                "width": 400,
                "fade-direction": "fadeIn"
            },
            "panoId": afterWalkPanoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 200,
                    "y": -600,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                },
                {
                    "type": "arrow",
                    "x": -2530,
                    "y": -470,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }

            ],
            okButtonText: i18next.t('tutorial.walk-5-2'),
            "transition": function () {
                _updateProgressBar(38);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-6", step: 38});
                return "walk-6";
            }
         },
        "walk-6": {
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1]
            },
            "message": {
                "message": i18next.t('tutorial.walk-6-1') +
                '<img src="' + svl.rootDirectory + 'img/icons/NoCurbRamp_small.png" style="width: 8%; height:auto" alt="Missing Curb Ramp Label">. ' +
                    i18next.t('tutorial.walk-6-2'),
                "width": 400,
                "fade-direction": "fadeIn"
            },
            "panoId": afterWalkPanoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 200,
                    "y": -600,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                },
                {
                    "type": "arrow",
                    "x": -2530,
                    "y": -470,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }

            ],
            "transition": function () {
                _updateProgressBar(39);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-1", step: 39});
                return "instruction-1";
            }
        },
        "instruction-1": {
            "properties": {
                "action": "Instruction",
                "blinks": ["minimap"],
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1]
            },
            "message": {
                "message": i18next.t('tutorial.instruction-1'),
                "arrow": "right",
                "fade-direction": "fadeInLeft",
                "top": 270,
                "left": 405
            },
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(40);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-2", step: 40});
                return "instruction-2";
            }
        },
        "instruction-2": {
            "properties": {
                "action": "Instruction",
                "blinks": ["stuck"],
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1]
            },
            "message": {
                "message": i18next.t('tutorial.instruction-2'),
                "fade-direction": "fadeInRight",
                "arrow": "left",
                "top": 245,
                "left": 5
            },
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(41);
                tracker.push('Onboarding_Transition', {onboardingTransition: "outro", step: 41});
                return "outro";
            }
        },
        "outro": {
            "properties": {
                "action": "Instruction",
                "heading": 280,
                "pitch": -6,
                "zoom": 1,
                "minHeading": undefined,
                "maxHeading": undefined
            },
            "message": {
                "message": function () {
                    return document.getElementById("onboarding-outro").innerHTML;
                },
                "width": 1000,
                "top": -50,
                "left": -70,
                "padding": "100px 10px 100px 10px",
                "background": true
            },
            "okButton": false,
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": function () {
                return "end-onboarding";
            }
        },
        "end-onboarding": {
            "end-onboarding": {
                "skip": false
            }
        }
    };

    this.get = function () { return this.states; };
}

function Panorama(data) {
    var self = { className: "Panorama" };
    var _data = data;
    var properties = { submitted: _data.submitted ? _data.submitted : false };

    function getData () {
        return _data;
    }

    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    function setProperty (key, value) {
        properties[key] = value;
    }

    self.data = getData;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    return self;
}
function PanoramaContainer (streetViewService) {
    var self = { className: "PanoramaContainer" },
        container = {};

    /**
     * This method adds panorama data into the container
     * @param panoramaId
     * @param panorama
     */
    function add(panoramaId, panorama) {
        if (!(panoramaId in container)) {
            container[panoramaId] = panorama;
        }
    }

    /**
     * This method returns the existing panorama data
     * @param panoramaId
     * @returns {null}
     */
    function getPanorama (panoramaId) {
        return panoramaId in container ? container[panoramaId] : null;
    }

    /**
     * Get all the panorama instances stored in the container
     * @returns {Array}
     */
    function getPanoramas () {
        return Object.keys(container).map(function (panoramaId) { return container[panoramaId]; });
    }

    /**
     * Get panorama instances that have not been submitted to the server
     * @returns {Array}
     */
    function getStagedPanoramas () {
        var panoramas = getPanoramas();
        panoramas = panoramas.filter(function (pano) { return !pano.getProperty("submitted"); });
        return panoramas;
    }

    /**
     * Request the panorama meta data.
     */
    function fetchPanoramaMetaData(panoramaId) {
        // Shows tutorial panoramas as already submitted to server, no need to add to server.
        if (panoramaId === "tutorial" || panoramaId === "tutorialAfterWalk") {
            add(panoramaId, new Panorama({ submitted: true }));
        } else {
            streetViewService.getPanorama({ pano: panoramaId }, function (data, status) {
                if (status === google.maps.StreetViewStatus.OK) {
                    add(data.location.pano, new Panorama(data))
                } else {
                    console.error("Error retrieving Panorama: " + status);
                    svl.tracker.push("PanoId_NotFound", {'TargetPanoId': panoramaId});
                }
            });
        }
    }

    self.getPanorama = getPanorama;
    self.getPanoramas = getPanoramas;
    self.getStagedPanoramas = getStagedPanoramas;
    self.fetchPanoramaMetaData = fetchPanoramaMetaData;
    return self;
}


/**
 * RibbonMenu module
 * Todo. Split the RibbonMenu UI component and the label type switching logic
 * Todo. Consider moving this under menu instead of ribbon.
 * @param overlayMessageBox
 * @param tracker
 * @param uiRibbonMenu
 * @returns {{className: string}}
 * @constructor
 */
function RibbonMenu(overlayMessageBox, tracker, uiRibbonMenu) {
    var self = {className: 'RibbonMenu'},
        properties = {
            buttonDefaultBorderColor: "transparent",
            originalBorderColor: "transparent"
        },
        status = {
            disableModeSwitch: false,
            lockDisableModeSwitch: false,
            disableMode: {
                Walk: false,
                CurbRamp: false,
                NoCurbRamp: false,
                Obstacle: false,
                SurfaceProblem: false,
                OuterOther: false,
                Occlusion: false,
                NoSidewalk: false,
                Crosswalk: false,
                Signal: false,
                Other: false,
            },
            lockDisableMode: false,
            mode: 'Walk',
            selectedLabelType: undefined
        },
        blinkInterval;

    function _init() {
        // Initialize the jQuery DOM elements
        if (uiRibbonMenu) {
            setLabelTypeButtonBorderColors(status.mode);

            uiRibbonMenu.buttons.bind({
                click: handleModeSwitchClickCallback,
                mouseenter: handleModeSwitchMouseEnter,
                mouseleave: handleModeSwitchMouseLeave
            });
            uiRibbonMenu.subcategories.on({
                click: handleSubcategoryClick
            });
        }

        // Disable mode switch when sign in modal is opened.
        // TODO this doesn't seem to be necessary for some reason?
        if ($("#sign-in-modal-container").length !== 0) {
            var $signInModalTextBoxes = $("#sign-in-modal-container input[type='text']"),
                $signInModalPassword = $("#sign-in-modal-container input[type='password']");
            $signInModalTextBoxes.on('focus', disableModeSwitch);
            $signInModalTextBoxes.on('blur', enableModeSwitch);
            $signInModalPassword.on('focus', disableModeSwitch);
            $signInModalPassword.on('blur', enableModeSwitch);
        }
    }

    /**
     * This is a callback method that is invoked with a ribbon menu button click
     * @param mode
     */
    function modeSwitch(mode) {
        var labelType = (typeof mode === 'string') ? mode : $(this).attr("val"); // Do I need this???
        tracker.push('ModeSwitch_' + labelType);

        if (status.disableModeSwitch === false || status.disableMode[labelType] === false) {
            // Used to trigger onboarding states
            $(document).trigger('ModeSwitch_' + labelType);

            var labelColors, borderColor;

            // Whenever the ribbon menu is clicked, cancel drawing.
            if ('canvas' in svl && svl.canvas && svl.canvas.isDrawing()) {
                svl.canvas.cancelDrawing();
            }

            labelColors = util.misc.getLabelColors();
            borderColor = labelColors[labelType].fillStyle;

            if (labelType === 'Walk') {
                // Switch to walking mode.
                setStatus('mode', 'Walk');
                setStatus('selectedLabelType', undefined);
                if (svl.map) {
                    svl.map.switchToExploreMode();
                }
            } else {
                // Switch to labeling mode.
                setStatus('mode', labelType);
                setStatus('selectedLabelType', labelType);
                if (svl.map) {
                    svl.map.switchToLabelingMode();
                }

                // Change cursor before mouse is moved.
                if (svl.ui.canvas.drawingLayer) {
                    svl.ui.canvas.drawingLayer.triggerHandler('mousemove');
                }

                // Loads the audio for when a label is placed. Safari requires audios to be loaded each time before being played.
                // Since this takes time, it is done early (when user selects label type) so that it is ready for when the label is placed.
                if ('audioEffect' in svl) {
                    svl.audioEffect.load('drip');
                }
            }

            if (uiRibbonMenu) {
                setLabelTypeButtonBorderColors(labelType);

                var connectorWidth = parseInt(uiRibbonMenu.connector.css('border-left-width'));
                var panoBorderWidth = parseInt(uiRibbonMenu.streetViewHolder.css('border-left-width'));
                var selectedType = mode === 'Occlusion' ? 'Other' : mode;
                var currLabelType;
                $.each(uiRibbonMenu.buttons, function (i, v) {
                    currLabelType = $(v).attr('val');
                    if (currLabelType === selectedType) {
                        var buttonLeft = $(this).position().left;
                        var buttonWidth = $(this).width();
                        var connectorLeft = buttonLeft + buttonWidth / 2 - panoBorderWidth - connectorWidth / 2;
                        uiRibbonMenu.connector.css("left", connectorLeft);
                    }
                });
                uiRibbonMenu.connector.css("border-left-color", borderColor);
                uiRibbonMenu.streetViewHolder.css({
                    "border-color": borderColor,
                    "background-color": borderColor
                });
            }

            // Set the instructional message
            overlayMessageBox.setMessage(labelType);
            overlayMessageBox.setHelpLink(labelType);
        }
    }

    // TODO
    function handleSubcategoryClick(e) {
        e.stopPropagation();
        var subcategory = $(this).attr("val");
        if (status.disableMode[subcategory] === false) {
            tracker.push('Click_Subcategory_' + subcategory);
            svl.keyboardShortcutAlert.modeSwitchButtonClicked(subcategory);
            modeSwitch(subcategory);
            hideSubcategories();
        }
    }

    function handleModeSwitchClickCallback() {
        var labelType = $(this).attr('val');
        if (status.disableModeSwitch === false || status.disableMode[labelType] === false) {

            // If allowedMode is not null/undefined, only accept the specified mode (e.g., 'walk')
            if (status.allowedMode && status.allowedMode !== labelType) {
                return false;
            }

            // Track the user action
            tracker.push('Click_ModeSwitch_' + labelType);
            svl.keyboardShortcutAlert.modeSwitchButtonClicked(labelType);
            modeSwitch(labelType);
        }
    }

    function handleModeSwitchMouseEnter() {
        var labelType = $(this).attr("val");

        var modeDisabled;
        if(svl.isOnboarding() && labelType === "Other") {
            modeDisabled = status.disableMode["OuterOther"];
        } else {
            modeDisabled = status.disableMode[labelType];
        }

        if (status.disableModeSwitch === false || !modeDisabled) {
            // Change the border color of menu buttons.

            // If allowedMode is not null/undefined, only accept the specified mode (e.g., 'walk').
            if (status.allowedMode && status.allowedMode !== labelType) {
                return false;
            }
            setLabelTypeButtonBorderColors(labelType);

            if (labelType === "Other") {
                showSubcategories();
            }
        }
    }

    function handleModeSwitchMouseLeave() {
        // Always activate during onboarding as everything is disabled
        // So will only be useful for 'Other' dropdown
        if (status.disableModeSwitch === false || svl.isOnboarding()) {
            setLabelTypeButtonBorderColors(status.mode);
            hideSubcategories();
        }
    }

    function hideSubcategories() {
        uiRibbonMenu.subcategoryHolder.css('visibility', 'hidden');
    }

    function setLabelTypeButtonBorderColors(selectedLabelType) {
        if (uiRibbonMenu) { // TODO is this check necessary?
            var labelColors = util.misc.getLabelColors();
            var selectedBorderColor = labelColors[selectedLabelType].fillStyle;
            var currLabelType;
            $.each(uiRibbonMenu.buttons, function (i, v) {
                currLabelType = $(v).attr("val");
                if (currLabelType === selectedLabelType) {
                    $(this).find('.label-type-icon').css({
                        'border-color': selectedBorderColor,
                        'background-color': selectedBorderColor
                    });
                } else {
                    // Change border/background color if the label type is not the currently selected type.
                    $(this).find('.label-type-icon').css({ 'border-color': properties.buttonDefaultBorderColor });
                    $(this).find('.label-type-icon').css({ 'background-color': properties.buttonDefaultBorderColor });
                }
            });
        }
        return this;
    }

    function showSubcategories() {
        uiRibbonMenu.subcategoryHolder.css('visibility', 'visible');
    }

    /**
     * Changes the mode to "walk"
     * @returns {backToWalk}
     */
    function backToWalk() {
        modeSwitch('Walk');
        return this;
    }

    /**
     * Disable switching modes
     * @returns {disableModeSwitch}
     */
    function disableModeSwitch() {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = true;
            status.disableMode = {
                Walk: true,
                CurbRamp: true,
                NoCurbRamp: true,
                Obstacle: true,
                SurfaceProblem: true,
                OuterOther: true,
                Occlusion: true,
                NoSidewalk: true,
                Crosswalk: true,
                Signal: true,
                Other: true
            };
            if (uiRibbonMenu) {
                uiRibbonMenu.buttons.css('opacity', 0.4);
                uiRibbonMenu.buttons.css('cursor', 'default');

                uiRibbonMenu.subcategories.css('opacity', 0.4);
                uiRibbonMenu.subcategories.css('cursor', 'default');
            }
        }
        return this;
    }

    /**
     * This method disables a specific label type
     * @param labelType
     * @param subLabelType
     */
    function disableMode(labelType, subLabelType) {
        if (!status.lockDisableMode) {
            var button = uiRibbonMenu.holder.find('[val="' + labelType + '"]').get(0),
                dropdown;

            // So that outer category Other is disabled
            if (labelType === "Other") {
                status.disableMode["OuterOther"] = true;
            } else {
                status.disableMode[labelType] = true;
            }

            if (subLabelType) {
                status.disableMode[subLabelType] = true;
                dropdown = uiRibbonMenu.subcategoryHolder.find('[val="' + subLabelType + '"]').get(0);
            }

            if (button) {
                $(button).css('opacity', 0.4);
                $(button).css('cursor', 'default');
                if (dropdown) {
                    $(dropdown).css('opacity', 0.4);
                    $(dropdown).css('cursor', 'default');
                }
            }
        }
    }

    /**
     * This method enables mode switch.
     * @returns {enableModeSwitch}
     */
    function enableModeSwitch() {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = false;
            status.disableMode = {
                Walk: false,
                CurbRamp: false,
                NoCurbRamp: false,
                Obstacle: false,
                SurfaceProblem: false,
                OuterOther: false,
                Occlusion: false,
                NoSidewalk: false,
                Crosswalk: false,
                Signal: false,
                Other: false
            };
            if (uiRibbonMenu) {
                uiRibbonMenu.buttons.css('opacity', 1);
                uiRibbonMenu.buttons.css('cursor', 'pointer');

                uiRibbonMenu.subcategories.css('opacity', 1);
                uiRibbonMenu.subcategories.css('cursor', 'pointer');
            }
        }
        return this;
    }

    /**
     * This method enables a specific label type
     * @param labelType
     * @param subLabelType
     */
    function enableMode(labelType, subLabelType) {
        if (!status.lockDisableMode) {
            var button = uiRibbonMenu.holder.find('[val="' + labelType + '"]').get(0),
                dropdown;

            // So that sub category Other is not enabled
            if (labelType === "Other") {
                status.disableMode["OuterOther"] = false;
            } else {
                status.disableMode[labelType] = false;
            }

            if (subLabelType) {
                status.disableMode[subLabelType] = false;
                dropdown = uiRibbonMenu.subcategoryHolder.find('[val="' + subLabelType + '"]').get(0);
            }

            if (button) {
                $(button).css('opacity', 1);
                $(button).css('cursor', 'pointer');

                if (dropdown) {
                    $(dropdown).css('opacity', 1);
                    $(dropdown).css('cursor', 'pointer');
                }
            }
        }

    }

    function lockDisableModeSwitch() {
        status.lockDisableModeSwitch = true;
        return this;
    }

    function lockDisableMode() {
        status.lockDisableMode = true;
        return this;
    }

    function getStatus(key, subkey) {
        if (key in status) {
            if (subkey) {
                return status[key][subkey];
            } else {
                return status[key];
            }
        } else {
            console.warn(self.className, 'You cannot access a property "' + key + '".');
            return undefined;
        }
    }

    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    function setAllowedMode(mode) {
        // This method sets the allowed mode.
        status.allowedMode = mode;
        return this;
    }

    function setStatus(name, value, subname) {
        try {
            if (name in status) {
                if (name === 'disableModeSwitch') {
                    if (typeof value === 'boolean') {
                        if (value) {
                            disableModeSwitch();
                        } else {
                            enableModeSwitch();
                        }
                        return this;
                    } else {
                        return false
                    }
                } else {
                    if (subname) {
                        status[name][subname] = value;
                    } else {
                        status[name] = value;
                    }
                    return this;
                }
            } else {
                var errMsg = '"' + name + '" is not a modifiable status.';
                throw errMsg;
            }
        } catch (e) {
            console.error(self.className, e);
            return false;
        }

    }

    function startBlinking(labelType, subLabelType) {
        var highlighted = false;
        var button = uiRibbonMenu.holder.find('[val="' + labelType + '"]').get(0).children[0];
        var dropdown;

        if (subLabelType) {
            dropdown = uiRibbonMenu.subcategoryHolder.find('[val="' + subLabelType + '"]').get(0);
        }

        stopBlinking();
        if (button) {
            blinkInterval = window.setInterval(function () {
                if (highlighted) {
                    highlighted = !highlighted;
                    $(button).css("border-color", "rgba(255, 255, 0, 1)");
                    if (dropdown) {
                        $(dropdown).css("background", "rgba(255, 255, 0, 1)");
                    }
                } else {
                    highlighted = !highlighted;
                    $(button).css("border-color", getProperty("originalBorderColor"));
                    if (dropdown) {
                        $(dropdown).css("background", "white");
                    }
                }
            }, 500);
        }
    }

    function stopBlinking() {
        clearInterval(blinkInterval);
        $.each(uiRibbonMenu.buttons, function (i, v) {
            $(v.children[0]).css("border-color", getProperty("originalBorderColor"));
        });
        uiRibbonMenu.subcategories.css("background", "white");
    }

    function unlockDisableModeSwitch() {
        status.lockDisableModeSwitch = false;
        return this;
    }

    function unlockDisableMode() {
        status.lockDisableMode = false;
        return this;
    }

    self.backToWalk = backToWalk;
    self.disableModeSwitch = disableModeSwitch;
    self.disableMode = disableMode;
    self.enableModeSwitch = enableModeSwitch;
    self.enableMode = enableMode;
    self.lockDisableMode = lockDisableMode;
    self.lockDisableModeSwitch = lockDisableModeSwitch;
    self.modeSwitch = modeSwitch;
    self.modeSwitchClick = modeSwitch;
    self.getStatus = getStatus;
    self.setAllowedMode = setAllowedMode;
    self.setStatus = setStatus;
    self.startBlinking = startBlinking;
    self.stopBlinking = stopBlinking;
    self.unlockDisableMode = unlockDisableMode;
    self.unlockDisableModeSwitch = unlockDisableModeSwitch;


    _init();

    return self;
}

/**
 * Label Counter module.
 * @param d3 d3 module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelCounter (d3) {
    var self = this;

    var svgWidth = 200;
    var svgHeight = 120;
    var margin = {top: 10, right: 10, bottom: 10, left: 0};
    var padding = {left: 5, top: 15};
    var width = 200 - margin.left - margin.right;
    var height = 34 - margin.top - margin.bottom;
    var colorScheme = util.misc.getLabelColors();
    var imageWidth = 18;
    var imageHeight = 18;
    var rightColumn = 1.8;

    // Prepare a group to store svg elements, and declare a text
    var dotPlots = {
        "CurbRamp": {
            id: "CurbRamp",
            description: i18next.t('curb-ramp'),
            descriptionPlural: i18next.t('curb-ramps'),
            left: margin.left,
            top: margin.top,
            fillColor: colorScheme["CurbRamp"].fillStyle,
            imagePath: svl.rootDirectory + "/img/icons/CurbRamp_small.png",
            count: 0,
            data: []
        },
        "NoCurbRamp": {
            id: "NoCurbRamp",
            description: i18next.t('missing-curb-ramp'),
            descriptionPlural: i18next.t('missing-curb-ramps'),
            left: margin.left,
            top: (2 * margin.top) + margin.bottom + height,
            // top: 2 * margin.top + margin.bottom + height,
            fillColor: colorScheme["NoCurbRamp"].fillStyle,
            imagePath: svl.rootDirectory + "/img/icons/NoCurbRamp_small.png",
            count: 0,
            data: []
        },
        "Obstacle": {
            id: "Obstacle",
            description: i18next.t('obstacle'),
            descriptionPlural: i18next.t('obstacles'),
            left: margin.left,
            // top: 3 * margin.top + 2 * margin.bottom + 2 * height,
            top: (3 * margin.top) + (2 * margin.bottom) + (2 * height),
            fillColor: colorScheme["Obstacle"].fillStyle,
            imagePath: svl.rootDirectory + "/img/icons/Obstacle_small.png",
            count: 0,
            data: []
        },
        "SurfaceProblem": {
            id: "SurfaceProblem",
            description: i18next.t('surface-problem'),
            descriptionPlural: i18next.t('surface-problems'),
            left: margin.left + (width/rightColumn),
            //top: 4 * margin.top + 3 * margin.bottom + 3 * height,
            top: margin.top,
            fillColor: colorScheme["SurfaceProblem"].fillStyle,
            imagePath: svl.rootDirectory + "/img/icons/SurfaceProblem_small.png",
            count: 0,
            data: []
        },
        "NoSidewalk": {
            id: "NoSidewalk",
            description: i18next.t('no-sidewalk'),
            descriptionPlural: i18next.t('no-sidewalks'),
            left: margin.left + (width/rightColumn),
            top: (2 * margin.top) + margin.bottom + height,
            fillColor: colorScheme["NoSidewalk"].fillStyle,
            imagePath: svl.rootDirectory + "/img/icons/NoSidewalk_small.png",
            count: 0,
            data: []
        },
        "Other": {
            id: "Other",
            description: i18next.t('other'),
            descriptionPlural: i18next.t('others'),
            left: margin.left + (width/rightColumn),
            top: (3 * margin.top) + (2 * margin.bottom) + (2 * height),
            fillColor: colorScheme["Other"].fillStyle,
            imagePath: svl.rootDirectory + "/img/icons/Other_small.png",
            count: 0,
            data: []
        }
    };

    var keys = Object.keys(dotPlots);

    var x = d3.scale.linear()
              .domain([0, 20])
              .range([0, width]);

    var y = d3.scale.linear()
            .domain([0, 20])
            .range([height, 0]);

    var svg = d3.select('#label-counter')
                  .append('svg')
                  .attr('width', svgWidth)
                  .attr('height', svgHeight);

    var chart = svg.append('g')
                  .attr('width', svgWidth)
                  .attr('height', svgHeight)
                  .attr('class', 'chart')
                  .attr('transform', function () {
                     return 'translate(0,0)';
                  });

    for (var key in dotPlots) {
        dotPlots[key].g = chart.append('g')
                    .attr('transform', 'translate(' + dotPlots[key].left + ',' + dotPlots[key].top + ')')
                    .attr('width', width)
                    .attr('height', height)
                    .attr('class', 'main');

        dotPlots[key].label = dotPlots[key].g.selectAll("text.label")
            .data([0])
            .enter()
            .append("text")
            .text(function () {
                var ret = dotPlots[key].count + " ";
                ret += dotPlots[key].count > 1 ? dotPlots[key].descriptionPlural : dotPlots[key].description;
                return ret;
            })
            .style("font-size", "8px")
            .attr("class", "visible")
            .attr('transform', 'translate(0,' + (imageHeight + 3) + ')');

        dotPlots[key].plot = dotPlots[key].g.append("g")
            .attr('transform', 'translate(' + (padding.left + imageWidth) + ',' + 7 + ')');

        dotPlots[key].g.append("image")
            .attr("xlink:href", dotPlots[key].imagePath)
            .attr("width", imageWidth)
            .attr("height", imageHeight)
            .attr('transform', 'translate(0,-8)');
    }


    this.countLabel = function (labelType) {
        return labelType in dotPlots ? dotPlots[labelType].count : null;
    };

    /**
     * Set label counts to 0
     */
    this.reset = function () {
        for (var key in dotPlots) {
            self.set(key, 0);
        }
    };

    /**
     * Update the label count visualization.
     * @param key {string} Label type
     */
    function update(key) {
        // If a key is given, update the dot plot for that specific data.
        // Otherwise update all.
        if (key) {
          _update(key)
        } else {
          for (var key in dotPlots) {
            _update(key);
          }
        }

        // Actual update function
        function _update(key) {
            if (keys.indexOf(key) === -1) { key = "Other"; }

            var hundredCircles = parseInt(dotPlots[key].count / 100);
            var fiftyCircles = parseInt((dotPlots[key].count % 100) / 50);
            var tenCircles = parseInt((dotPlots[key].count % 50) / 10);
            var oneCircles = dotPlots[key].count % 10;
            var count = hundredCircles + fiftyCircles + tenCircles + oneCircles;
            var multiplier = Math.max(0.5, 1.0 - parseInt(dotPlots[key].count) / 1500.0);
            var radius = 0.2 * multiplier;
            var dR = radius / 3;

            // The code of these three functions was being used so much I decided to separately declare them.
            // The d3 calls look much cleaner now. :)
            function setCX(d, i){
               if (i < hundredCircles && hundredCircles != 0) {
                   return x(i * 5.33 * radius + 2 * dR)
               }
               else if (i < hundredCircles + fiftyCircles && fiftyCircles != 0) {
                   return x(hundredCircles * 5.33 * radius);
               }
               else if (i < hundredCircles + fiftyCircles + tenCircles && tenCircles != 0) {
                   return x(hundredCircles * 2.6 * radius) + x(fiftyCircles * 3.3 * radius) +
                     x((i - fiftyCircles) * 2 * (radius + dR));
               }
               else {
                   return x(hundredCircles * 3.2 * radius) + x(fiftyCircles * 1.3 * radius) +
                     x(tenCircles * 1.95 * (radius + dR))+ x((i - tenCircles) * 2 * radius);
               }
            }

            function setCY(d, i){
              if (i < hundredCircles && hundredCircles != 0) {
                return 0;
              }
              else if (i < hundredCircles + fiftyCircles && fiftyCircles != 0) {
                return x(2 * dR);
              }
              else if (i < hundredCircles + fiftyCircles + tenCircles && tenCircles != 0) {
                return x(radius + dR);
              }
              else {
                return x(2 * radius);
              }
            }

            function setR(d, i){
              if (i < hundredCircles && hundredCircles != 0) {
                return x(2 * (radius + dR));
              }
              else if (i < hundredCircles + fiftyCircles && fiftyCircles != 0) {
                return x(2 * radius);
              }
              else if (i < hundredCircles + fiftyCircles + tenCircles && tenCircles != 0) {
                return x(radius + dR);
              }
              else {
                return x(radius);
              }
            }

            // Update the dot plot
            if (dotPlots[key].data.length >= count) {
              // Remove dots
              dotPlots[key].data = dotPlots[key].data.slice(0, count);

                dotPlots[key].plot.selectAll("circle")
                  .transition().duration(500)
                  .attr("r", setR)
                  .attr("cy", setCY)
                  .attr("cx", setCX);

                dotPlots[key].plot.selectAll("circle")
                  .data(dotPlots[key].data)
                  .exit()
                  .transition()
                  .duration(500)
                  .attr("cx", function () {
                    return 0;
                  })
                  .attr("r", 0)
                  .remove();
            } else {
              // Add dots
              var len = dotPlots[key].data.length;
              for (var i = 0; i < count - len; i++) {
                  dotPlots[key].data.push([len + i, 0, radius])
              }
              dotPlots[key].plot.selectAll("circle")
                .attr("r", setR)
                .attr("cy", setCY)
                .attr("cx", setCX)
                .data(dotPlots[key].data)
                .enter().append("circle")
                .attr("cx", x(0))
                .attr("cy", setCY)
                .attr("r", radius)
                .style("fill", dotPlots[key].fillColor)
                .transition().duration(1000)
                .attr("cx", setCX)
                .attr("cy", setCY)
                .attr("r", setR);
            }
            dotPlots[key].label.text(function () {
                var ret = dotPlots[key].count + " ";
                ret += dotPlots[key].count > 1 ? dotPlots[key].descriptionPlural : dotPlots[key].description;
                return ret;
            });
        }
    }

    /**
     * Decrement the label count
     * @param key {string} Label type
     */
    this.decrement = function (key) {
        if (svl.isOnboarding()) {
            $(document).trigger('RemoveLabel');
        }

        if (keys.indexOf(key) === -1) { key = "Other"; }
        if (key in dotPlots && dotPlots[key].count > 0) {
            dotPlots[key].count -= 1;
        }
        update(key);

        svl.statusFieldOverall.decrementLabelCount();
        svl.statusFieldNeighborhood.decrementLabelCount();

    };

    /**
     * Increment the label count
     * @param key {string} Label type
     */
    this.increment = function (key) {
        if (keys.indexOf(key) === -1) { key = "Other"; }
        if (key in dotPlots) {
            dotPlots[key].count += 1;
            update(key);
        }

        svl.statusFieldOverall.incrementLabelCount();
        svl.statusFieldNeighborhood.incrementLabelCount();
    };

    /**
     * Set the number of label count
     * @param key {string} Label type
     * @param num {number} Label type count
     */
    this.set = function (key, num) {
        dotPlots[key].count = num;
        update(key);
    };

    // Initialize
    update();
    // self.countLabel = countLabel;
    // self.increment = increment;
    // self.decrement = decrement;
    // self.set = set;
    // self.reset = reset;
}

/**
 * StatusField constructor
 * @param uiStatusField
 * @constructor
 */
function StatusField (uiStatusField) {
    var self = this;
    var _blinkInterval;

    // Blink the status field
    this.blink = function  () {
        self.stopBlinking();
        _blinkInterval = window.setInterval(function () {
            uiStatusField.holder.toggleClass("highlight-50");
        }, 500);
    };

    // Stop blinking
    this.stopBlinking = function () {
        window.clearInterval(_blinkInterval);
        uiStatusField.holder.removeClass("highlight-50");
    };

    this.hide = function() {
        uiStatusField.holder.hide();
    };

    svl.neighborhoodModel.on("Neighborhood:completed", function() {
        svl.statusField.hide();
    });
}


function StatusFieldMission (modalModel, uiStatusField) {
    var self = this;
    var $missionDescription = uiStatusField.holder.find("#current-mission-description");

    modalModel.on("ModalMissionComplete:closed", function (param) {
        self.setMessage(param.nextMission);
    });

    /**
     * This method takes a Mission object and sets the appropriate text for the mission status field in
     * @param mission
     */
    this.setMessage = function (mission) {
        var missionType = mission.getProperty("missionType");

        var missionMessage;
        if (missionType === "auditOnboarding") {
            missionMessage = i18next.t('tutorial.mission-message');
        } else if (svl.missionContainer.isTheFirstMission()) {
            missionMessage = i18next.t('right-ui.current-mission.message-first-mission');
        } else {
            missionMessage = i18next.t('right-ui.current-mission.message');
        }

        if (missionType === "audit") {
            var distanceString = this._distanceToString(mission.getDistance("miles"), "miles");
            missionMessage = missionMessage.replace("__PLACEHOLDER__", distanceString);
        }

        $missionDescription.html(missionMessage);
    };

    /**
     *  This method takes in an integer feet and converts it to meters, truncating all decimals.
     *  @param feet to convert to meters
     *  @return
     */
    this.convertToMetric = function(feet, unitAbbreviation) {
        return Math.trunc(feet * 0.3048) + " " + unitAbbreviation;
    };
}

StatusFieldMission.prototype._distanceToString = function (distance, unit) {
    if (!unit) unit = "kilometers";

    // Convert to meters.
    if (unit === "feet") distance = util.math.feetToMeters(distance);
    else if (unit === "miles") distance = util.math.milesToMeters(distance);
    else if (unit === "kilometers") distance = util.math.kilometersToMeters(distance);

    var distanceType = i18next.t('common:measurement-system');
    var unitAbbreviation = i18next.t('common:unit-abbreviation-mission-distance');

    if (distanceType === "metric") return util.math.roundToTwentyFive(distance) + " " + unitAbbreviation;
    else return util.math.roundToTwentyFive(util.math.metersToFeet(distance)) + " " + unitAbbreviation;
};

function StatusFieldMissionProgressBar (modalModel, statusModel, uiStatusField) {
    var self = this;
    var $completionRate = uiStatusField.holder.find("#status-current-mission-completion-rate");
    var $progressBar = uiStatusField.holder.find("#status-current-mission-completion-bar");
    var $progressBarFiller = uiStatusField.holder.find("#status-current-mission-completion-bar-filler");

    modalModel.on("ModalMissionComplete:close", function (parameters) {
        self.setBar(parameters.misisonCompletionRate);
    });

    statusModel.on("StatusFieldMissionProgressBar:setBar", function (completionRate) {
        self.setBar(completionRate);
    });

    statusModel.on("StatusFieldMissionProgressBar:setCompletionRate", function (completionRate) {
        self.setCompletionRate(completionRate);
    });

    this.setBar = function (completionRate) {
        var color = completionRate < 1 ? 'rgba(0, 161, 203, 1)' : 'rgba(0, 222, 38, 1)';
        completionRate *=  100;
        if (completionRate > 100) completionRate = 100;

        completionRate = completionRate.toFixed(0);
        completionRate = completionRate + "%";
        $progressBarFiller.css({
            background: color,
            width: completionRate
        });
    };

    this.setCompletionRate = function (completionRate) {
        completionRate *= 100;
        // if check exists since the user could audit more than the
        // expected amount for the mission (e.g. the user audits 503 ft
        // even though the mission is to audit 500 ft)
        if (completionRate > 100) completionRate = 100;
        else if (completionRate < 100 && completionRate >= 99.5) completionRate = 99;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% " + i18next.t('common:complete');
        $completionRate.html(completionRate);
    };

    this.setBar(0);
    this.setCompletionRate(0);
}
function StatusFieldNeighborhood (neighborhoodModel, userModel, uiStatus) {
    var self = this;
    this._neighborhoodModel = neighborhoodModel;
    this._userModel = userModel;
    var labelCount = 0;

    this._neighborhoodModel.on("NeighborhoodContainer:setNeighborhood", function (newNeighborhood) {
        self.setNeighborhoodName(newNeighborhood.getProperty("name"));

        var user = self._userModel.getUser();
        if (user && user.getProperty("role") !== "Anonymous") {
            var href = "/dashboard" + "?regionId=" + newNeighborhood.getProperty("regionId");
            self.setHref(href);
        }
    });

    this.setAuditedDistance = function (distance) {
        uiStatus.auditedDistance.html(i18next.t('common:format-number', { val: distance.toFixed(2) }));
    };

    this.incrementLabelCount = function () {
        labelCount += 1;
        self.setLabelCount(labelCount);
    }

    this.decrementLabelCount = function () {
        labelCount -= 1;
        self.setLabelCount(labelCount);
    }

    this.setLabelCount = function (count) {
        labelCount = count;
        uiStatus.neighborhoodLabelCount.html(i18next.t('common:format-number', { val: count }));
    };

    /**
     * Set the href attribute of the link
     * @param hrefString
     */
    this.setHref = function (hrefString) {
        if (uiStatus.neighborhoodLink) {
            uiStatus.neighborhoodLink.attr("href", hrefString)
        }
    };

    this.setNeighborhoodName = function (name) {
        uiStatus.neighborhoodName.html(name + ", ");
    };
}

/**
 * StatusFieldOverall constructor. Holds overall stats for user in right sidebar.
 * @param uiStatus Holds jquery references to UI elements in right sidebar.
 * @constructor
 */
function StatusFieldOverall(uiStatus) {
    var self = this;
    var sessionStartTotalDist = null;
    var sessionStartNeighborhoodDist = null;
    var stats = {
        distance: 0.0,
        labelCount: 0,
        accuracy: null
    }

    this.incrementLabelCount = function () {
        stats.labelCount += 1;
        uiStatus.overallLabelCount.html(i18next.t('common:format-number', { val: stats.labelCount }));
    }

    this.decrementLabelCount = function () {
        stats.labelCount -= 1;
        uiStatus.overallLabelCount.html(i18next.t('common:format-number', { val: stats.labelCount }));
    }

    this.setNeighborhoodAuditedDistance = function (neighborhoodDistance) {
        if (!sessionStartNeighborhoodDist) sessionStartNeighborhoodDist = neighborhoodDistance;
        stats.distance = sessionStartTotalDist - sessionStartNeighborhoodDist + neighborhoodDistance;
        uiStatus.overallDistance.html(i18next.t('common:format-number', { val: stats.distance.toFixed(2) }));
    }

    // Query backend for user stats, store in HTML elements.
    $.getJSON('/userapi/basicStats', function (result) {
        sessionStartTotalDist = result.distance_audited;
        uiStatus.overallDistance.html(i18next.t('common:format-number', { val: sessionStartTotalDist.toFixed(2) }));
        stats.labelCount += result.label_count;
        uiStatus.overallLabelCount.html(i18next.t('common:format-number', { val: stats.labelCount }));

        var tooltipText;
        if (result.accuracy !== null) {
            stats.accuracy = 100 * result.accuracy;
            uiStatus.overallAccuracy.html(`${i18next.t('common:format-number', {val: stats.accuracy.toFixed(2)})}%`);
            tooltipText = i18next.t('right-ui.accuracy-tooltip');
        } else {
            uiStatus.overallAccuracy.html('N/A');
            tooltipText = i18next.t('right-ui.no-accuracy-tooltip');
        }

        // Initialize the tooltip popover on the accuracy rating. It should remain open when hovering over the tooltip.
        // https://stackoverflow.com/a/19684440/9409728
        uiStatus.overallAccuracyRow.popover({
            trigger: 'manual',
            html: true,
            placement: 'top',
            template: "<div class='popover' id='accuracy-rating-tooltip' role='tooltip'><div class='arrow'></div><div class='popover-content'></div></div>",
            content: tooltipText
        }).on('mouseenter', function() {
            var _this = this;
            $(this).popover('show');
            $('.popover').on('mouseleave', function() {
                $(_this).popover('hide');
            });
            // Log clicks to the link on to the User Dashboard.
            if (result.accuracy !== null) {
                $('#tooltip-dashboard-link').on('click', function() {
                    svl.tracker.push('Click_AccuracyTooltipToDashboard');
                });
            }
        }).on('mouseleave', function() {
            var _this = this;
            setTimeout(function() {
                if (!$(".popover:hover").length) {
                    $(_this).popover('hide');
                }
            }, 400);
        });
    });

}

function StatusModel () { }

_.extend(StatusModel.prototype, Backbone.Events);

StatusModel.prototype.setMissionCompletionRate = function (completionRate) {
    this.trigger("StatusFieldMissionProgressBar:setCompletionRate", completionRate);
};

StatusModel.prototype.setProgressBar = function (completionRate) {
    this.trigger("StatusFieldMissionProgressBar:setBar", completionRate);
};
/**
 * Task module.
 * @param geojson
 * @param tutorialTask
 * @param currentLat
 * @param currentLng
 * @param startPointReversed
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Task (geojson, tutorialTask, currentLat, currentLng, startPointReversed) {
    var self = this;
    var _geojson;
    var _furthestPoint;

    var paths;
    var missionStarts = {};
    var status = {
        isComplete: false
    };
    var properties = {
        auditTaskId: null,
        streetEdgeId: null,
        completedByAnyUser: null,
        priority: null,
        taskStart: null,
        currentMissionId: null,
        currentLat: currentLat,
        currentLng: currentLng,
        startPointReversed: startPointReversed,
        finishedReversing: false,
        tutorialTask: tutorialTask
    };

    /**
     * This method takes a task parameters and set up the current task.
     * @param geojson Description of the next task in json format.
     * @param currentLat Current latitude
     * @param currentLng Current longitude
     */
    this.initialize = function (geojson, currentLat, currentLng) {
        _geojson = geojson;
        var currMissionId = _geojson.features[0].properties.current_mission_id;
        var currMissionStart = _geojson.features[0].properties.currentMissionStart;

        self.setProperty("streetEdgeId", _geojson.features[0].properties.street_edge_id);
        self.setProperty("completedByAnyUser", _geojson.features[0].properties.completed_by_any_user);
        self.setProperty("priority", _geojson.features[0].properties.priority);
        self.setProperty("currentMissionId", currMissionId);
        self.setProperty("taskStart", new Date(`${_geojson.features[0].properties.task_start} UTC`));
        if (_geojson.features[0].properties.completed) {
            status.isComplete = true;
        }
        if (currMissionId && currMissionStart) {
            self.setMissionStart(currMissionId, { lat: currMissionStart[0], lng: currMissionStart[1] });
        }
        if (currentLat && currentLng) {
            this.setStreetEdgeDirection(currentLat, currentLng);
        }

        paths = null;
    };

    this.setStreetEdgeDirection = function (currentLat, currentLng) {
        var len = geojson.features[0].geometry.coordinates.length - 1,
            lat1 = geojson.features[0].geometry.coordinates[0][1],
            lng1 = geojson.features[0].geometry.coordinates[0][0],
            lat2 = geojson.features[0].geometry.coordinates[len][1],
            lng2 = geojson.features[0].geometry.coordinates[len][0];
        // Continuing from the previous task (i.e., currentLat and currentLng exist).
        var d1 = util.math.haversine(lat1, lng1, currentLat, currentLng),
            d2 = util.math.haversine(lat2, lng2, currentLat, currentLng);

        // If we already set reversed to true or we are at the 2nd endpoint, reverse the coordinates.
        if (properties.startPointReversed
            || ((properties.startPointReversed === null || properties.startPointReversed === undefined) && d2 < d1)) {
            // Only reverse if we haven't already reversed.
            if (!properties.finishedReversing) {
                self.reverseCoordinates();
                properties.finishedReversing = true;
                properties.startPointReversed = true;
                _furthestPoint = turf.point([lng2, lat2]);
            }
        } else {
            properties.startPointReversed = false;
            _furthestPoint = turf.point([lng1, lat1]);
        }
    };

    /**
     * This method creates Google Maps Polyline objects to render on the google maps.
     * @param lat
     * @param lng
     * @returns {Array|*[]}
     * @private
     */
    this.getGooglePolylines = function (lat, lng) {
        var auditedCoordinates = this._getPointsOnAuditedSegments();
        var unauditedCoordinates = this._getPointsOnUnauditedSegments();
        var completedPath = [];
        var incompletePath = [];

        for (var i = 0, len = auditedCoordinates.length; i < len; i++) {
            completedPath.push(new google.maps.LatLng(auditedCoordinates[i][1], auditedCoordinates[i][0]));
        }

        for (var i = 0, len = unauditedCoordinates.length; i < len; i++) {
            incompletePath.push(new google.maps.LatLng(unauditedCoordinates[i][1], unauditedCoordinates[i][0]));
        }

        return [
            new google.maps.Polyline({
                path: completedPath,
                geodesic: true,
                strokeColor: '#00ff00',
                strokeOpacity: 1.0,
                strokeWeight: 2
            }),
            new google.maps.Polyline({
                path: incompletePath,
                geodesic: true,
                strokeColor: '#ff0000',
                strokeOpacity: 1.0,
                strokeWeight: 2
            })
        ];
    };

    this._coordinatesToSegments = function (coordinates) {
        var returnSegments = [];
        for (var i = 1, len = coordinates.length; i < len; i++) {
            returnSegments.push(turf.lineString([
                [coordinates[i - 1][0], coordinates[i - 1][1]],
                [coordinates[i][0], coordinates[i][1]]
            ]));
        }
        return returnSegments;
    };

    this._getPointsOnAuditedSegments = function () {
        var startCoord = this.getStartCoordinate();
        var endCoord = this.getFurthestPointReached().geometry.coordinates;
        return this.getSubsetOfCoordinates(startCoord.lat, startCoord.lng, endCoord[1], endCoord[0]);
    };

    this._getPointsOnUnauditedSegments = function () {
        var startCoord = this.getFurthestPointReached().geometry.coordinates;
        var endCoord = this.getLastCoordinate();
        return this.getSubsetOfCoordinates(startCoord[1], startCoord[0], endCoord.lat, endCoord.lng);
    };

    this.getSubsetOfCoordinates = function(fromLat, fromLng, toLat, toLng) {
        var startPoint = turf.point([fromLng, fromLat]);
        var endPoint = turf.point([toLng, toLat]);
        var slicedLine = turf.lineSlice(startPoint, endPoint, _geojson.features[0]);

        var coordinates = slicedLine.geometry.coordinates;
        // If the linestring just has two identical points, `turf.cleanCoords` doesn't work, so just return a point.
        if (coordinates.length === 2 && coordinates[0] === coordinates[1]) {
            return [coordinates[0]];
        } else {
            return turf.cleanCoords(slicedLine).geometry.coordinates
        }
    };

    this._getSegmentsToAPoint = function (lat, lng) {
        var startCoord = this.getStartCoordinate();
        var coordinates = this.getSubsetOfCoordinates(startCoord.lat, startCoord.lng, lat, lng);
        if (coordinates.length > 1) {
            return this._coordinatesToSegments(coordinates);
        } else {
            // console.error("`Task._getSegmentsToAPoint` returned only 1 coordinate");
            return [];
        }
    };

    this._hasAdvanced = function (currentLat, currentLng) {
        if (typeof _furthestPoint === "undefined") return false;
        var latFurthest = _furthestPoint.geometry.coordinates[1];
        var lngFurthest = _furthestPoint.geometry.coordinates[0];
        var distanceAtTheFurthestPoint = this.getDistanceFromStart(latFurthest, lngFurthest);
        var distanceAtCurrentPoint = this.getDistanceFromStart(currentLat, currentLng);

        var streetEdge =  _geojson.features[0];
        var currentPosition = turf.point([currentLng, currentLat]);
        var snappedPosition = turf.nearestPointOnLine(streetEdge, currentPosition);

        return (distanceAtTheFurthestPoint < distanceAtCurrentPoint) &&
            turf.distance(currentPosition, snappedPosition) < 0.025;
    };

    /**
     * Set the isComplete status to true.
     * @returns {complete}
     */
    this.complete = function () {
        status.isComplete = true;
        properties.completedByAnyUser = true;
        properties.priority = 1 / (1 + (1 / properties.priority));
        return this;
    };

    this.getAuditTaskId = function () {
        return properties.auditTaskId;
    };

    /**
     * Get a geojson feature
     * @returns {null}
     */
    this.getFeature = function () {
        return _geojson ? _geojson.features[0] : null;
    };

    /**
     * Get geojson
     * @returns {*}
     */
    this.getGeoJSON = function () {
        return _geojson;
    };

    /**
     * Get geometry
     */
    this.getGeometry = function () {
        return _geojson ? _geojson.features[0].geometry : null;
    };

    /**
     * Get the last coordinate in the geojson.
     * @returns {{lat: *, lng: *}}
     */
    this.getLastCoordinate = function () {
        var len = geojson.features[0].geometry.coordinates.length - 1,
            lat = _geojson.features[0].geometry.coordinates[len][1],
            lng = _geojson.features[0].geometry.coordinates[len][0];
        return { lat: lat, lng: lng };
    };

    /**
     * Return the property
     * @param key Field name
     * @returns {null}
     */
    this.getProperty = function (key) {
        return key in properties ? properties[key] : null;
    };

    /**
     * Get the first coordinate in the geojson
     * @returns {{lat: *, lng: *}}
     */
    this.getStartCoordinate = function () {
        var lat = _geojson.features[0].geometry.coordinates[0][1],
            lng = _geojson.features[0].geometry.coordinates[0][0];
        return { lat: lat, lng: lng };
    };

    this.getCurrentLatLng = function() {
        return { lat: properties.currentLat, lng: properties.currentLng };
    };

    /**
     * Returns the street edge id of the current task.
     */
    this.getStreetEdgeId = function () {
        return _geojson.features[0].properties.street_edge_id;
    };

    this.getRegionId = function () {
        return _geojson.features[0].properties.region_id;
    }

    this.streetCompletedByAnyUser = function () {
        return properties.completedByAnyUser;
    };

    this.getStreetPriority = function () {
        return properties.priority;
    };

    /**
     * Returns an integer in the range 0 to n-1, where larger n means higher priority.
     *
     * Explanation:
     * We want to split the range [0,1] into n = 4 ranges, each sub-range has a length of 1 / n = 1 / 4 = 0.25.
     * To get the discretized order, we take the floor(priority / 0.25), which brings [0,0.25) -> 0, [0.25,0.5) -> 1,
     * [0.5,0.75) -> 2, [0.75,1) -> 3, and 1 -> 4. But we really want [0.75-1] -> 3, so instead of
     * floor(priority / (1 / n)), we have min(floor(priority / (1 / n)), n - 1).
     * @returns {number}
     */
    this.getStreetPriorityDiscretized = function() {
        var n = 4;
        return Math.min(Math.floor(_geojson.features[0].properties.priority / (1 / n)), n - 1);
    };

    this.getAuditedDistance = function (unit) {
        if (typeof _furthestPoint === "undefined") return 0;
        if (!unit) unit = {units: 'kilometers'};
        var latFurthest = _furthestPoint.geometry.coordinates[1];
        var lngFurthest = _furthestPoint.geometry.coordinates[0];
        return this.getDistanceFromStart(latFurthest, lngFurthest, unit);
    };

    /**
     * Get the cumulative distance
     * Reference:
     * turf-line-distance: https://github.com/turf-junkyard/turf-line-distance
     *
     * @params {units} String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in meters
     */
    this.getDistanceFromStart = function (lat, lng, unit) {
        if (!unit) unit = {units: 'kilometers'};
        var distance = 0;
        var walkedSegments = this._getSegmentsToAPoint(lat, lng);

        for (var i = 0, len = walkedSegments.length; i < len; i++) {
            distance += turf.length(walkedSegments[i], unit);
        }
        return distance;
    };


    /**
     * This method checks if the task is completed by comparing the
     * current position and the ending point.
     *
     * @param lat
     * @param lng
     * @param threshold
     * @returns {boolean}
     */
    this.isAtEnd = function (lat, lng, threshold) {
        if (_geojson) {
            var d, len = _geojson.features[0].geometry.coordinates.length - 1,
                latEnd = _geojson.features[0].geometry.coordinates[len][1],
                lngEnd = _geojson.features[0].geometry.coordinates[len][0];

            if (!threshold) threshold = 10; // 10 meters
            d = util.math.haversine(lat, lng, latEnd, lngEnd);
            return d < threshold;
        }
    };

    /**
     * Returns if the task was completed or not.
     * @returns {boolean}
     */
    this.isComplete = function () {
        return status.isComplete;
    };

    /**
     * Checks if the current task is connected to the given task
     * @param task
     * @param threshold
     * @param unit
     * @returns {boolean}
     */
    this.isConnectedTo = function (task, threshold, unit) {
        if (!threshold) threshold = 0.01;
        if (!unit) unit = {units: 'kilometers'};

        var lastCoordinate = self.getLastCoordinate(),
            targetCoordinate1 = task.getStartCoordinate(),
            targetCoordinate2 = task.getLastCoordinate(),
            p = turf.point([lastCoordinate.lng, lastCoordinate.lat]),
            p1 = turf.point([targetCoordinate1.lng, targetCoordinate1.lat]),
            p2 = turf.point([targetCoordinate2.lng, targetCoordinate2.lat]);
        return turf.distance(p, p1, unit) < threshold || turf.distance(p, p2, unit) < threshold;
    };

    /**
     * Get the line distance of the task street edge
     * @param unit
     * @returns {*}
     */
    this.lineDistance = function (unit) {
        if (!unit) unit = {units: 'kilometers'};
        return turf.length(_geojson.features[0], unit);
    };

    /**
     * Todo. This should go to the MapService or its submodule.
     */
    this.eraseFromMinimap = function () {
        if ('map' in svl && google && paths) {
            for (var i = 0; i < paths.length; i++) {
                paths[i].setMap(null);
            }
        }
    };

    /**
     * Render the task path on the Google Maps pane.
     * Todo. This should go to the MapService or its submodule
     * Reference:
     * https://developers.google.com/maps/documentation/javascript/shapes#polyline_add
     * https://developers.google.com/maps/documentation/javascript/examples/polyline-remove
     */
    this.render = function () {
        if ('map' in svl && google) {
            self.eraseFromMinimap();
            if (self.isComplete()) {
                // If the task has been completed already, set the paths to a green polyline
                var gCoordinates = _geojson.features[0].geometry.coordinates.map(function (coord) {
                    return new google.maps.LatLng(coord[1], coord[0]);
                });
                paths = [
                    new google.maps.Polyline({
                        path: gCoordinates,
                        geodesic: true,
                        strokeColor: '#00ff00',
                        strokeOpacity: 1.0,
                        strokeWeight: 2
                    })
                ];
            } else {
                var latlng = svl.map.getPosition();
                paths = self.getGooglePolylines(latlng.lat, latlng.lng);
            }

            for (var i = 0, len = paths.length; i < len; i++) {
                paths[i].setMap(svl.map.getMap());
            }
        }
    };

    /**
     * Flip the coordinates of the line string if the last point is closer to the end point of the current street segment.
     */
    this.reverseCoordinates = function() {
        _geojson.features[0].geometry.coordinates.reverse();
    };

    this.setProperty = function(key, value) {
        properties[key] = value;
    };

    this.getMissionStart = function(missionId) {
        return missionStarts[missionId];
    }

    this.setMissionStart = function(missionId, missionStart) {
        missionStarts[missionId] = missionStart;
    }

    this.getFurthestPointReached = function() {
        return _furthestPoint;
    };

    this.updateTheFurthestPointReached = function(currentLat, currentLng) {
        if (this._hasAdvanced(currentLat, currentLng)) {
            _furthestPoint = turf.point([currentLng, currentLat]);
        }
    };

    this.initialize(geojson, currentLat, currentLng);
}

/**
 * TaskContainer module.
 *
 * TODO This module needs to be cleaned up.
 * TODO Split the responsibilities. Storing tasks should remain here, but other things like fetching data from the server (should go to TaskModel) and rendering segments on a map.
 * @param navigationModel
 * @param neighborhoodModel
 * @param streetViewService
 * @param svl
 * @param tracker
 */
function TaskContainer (navigationModel, neighborhoodModel, streetViewService, svl, tracker) {
    var self = this;

    var previousTasks = [];
    var currentTask = null;
    var beforeJumpNewTask = null;
    var tasksFinishedLoading = false;

    self._tasks = [];

    self.tasksLoaded = function() {
        return tasksFinishedLoading;
    }

    self.getFinishedAndInitNextTask = function (finished) {
        var newTask = self.nextTask(finished);
        if (!newTask) {
            var currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
            var currentNeighborhoodId = currentNeighborhood.getProperty("regionId");
            svl.neighborhoodModel.neighborhoodCompleted();
            tracker.push("NeighborhoodComplete_ByUser", {'RegionId': currentNeighborhoodId});
        } else {
            svl.taskContainer.initNextTask(newTask);
        }
        return newTask;
    };

    self.initNextTask = function (nextTaskIn) {
        var geometry;
        var lat;
        var lng;

        var currentPosition = navigationModel.getPosition();
        nextTaskIn.setStreetEdgeDirection(currentPosition.lat, currentPosition.lng);

        geometry = nextTaskIn.getGeometry();
        lat = geometry.coordinates[0][1];
        lng = geometry.coordinates[0][0];

        var STREETVIEW_MAX_DISTANCE = 25;
        var latLng = new google.maps.LatLng(lat, lng);

        navigationModel.disableWalking();

        if (streetViewService) {
            streetViewService.getPanorama({location: latLng, radius: STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR},
                function (streetViewPanoramaData, status) {
                    navigationModel.enableWalking();
                    if (status === google.maps.StreetViewStatus.OK) {
                        lat = streetViewPanoramaData.location.latLng.lat();
                        lng = streetViewPanoramaData.location.latLng.lng();
                        self.setCurrentTask(nextTaskIn);
                        navigationModel.setPosition(lat, lng, function(){
                            navigationModel.preparePovReset();
                        });
                    } else {
                        console.error("Error loading Street View imagery");
                        svl.tracker.push("PanoId_NotFound", {'Location': JSON.stringify(latLng)});
                        nextTaskIn.complete();
                        // no street view available in this range.
                        self.getFinishedAndInitNextTask(nextTaskIn);
                    }
                });
        }
    };

    /**
     * End the current task.
     */
    function endTask(task, nextTask) {
        if (tracker) tracker.push("TaskEnd");
        task.complete();
        // Go through the tasks and mark the completed task as isComplete=true
        for (var i = 0, len = self._tasks.length;  i < len; i++) {
            if (task.getStreetEdgeId() === self._tasks[i].getStreetEdgeId()) {
                // Check if the reference passed in from the method parameter and the array are the same.
                // This is needed because otherwise we could update a reference to the same task twice.
                if (task !== self._tasks[i]) {
                    self._tasks[i].complete();
                }
            }
        }

        // Update the audited distance in the right sidebar.
        updateAuditedDistance();

        if (!('user' in svl) || (svl.user.getProperty('role') === "Anonymous" &&
            getCompletedTaskDistance({units: 'kilometers'}) > 0.15 &&
            !svl.popUpMessage.haveAskedToSignIn())) {
            svl.popUpMessage.promptSignIn();
        }

        // Submit the data.
        var data = svl.form.compileSubmissionData(task),
            staged = svl.storage.get("staged");

        if (staged.length > 0) {
            staged.push(data);
            svl.form.submit(staged, task);
            svl.storage.set("staged", []);  // Empty the staged data.
        } else {
            svl.form.submit(data, task);
        }

        pushATask(task); // Push the data into previousTasks.

        // Updates the segments that the user has already explored.
        self.update();
        // Renders the next street that the user will explore.
        if(nextTask) nextTask.render();

        return task;
    }

    /**
     * Request the server to populate tasks
     * TODO Move this to somewhere else. TaskModel?
     * @param callback A callback function
     * @param async {boolean}
     */
    self.fetchTasks = function (callback, async) {
        if (typeof async == "undefined") async = true;
        var currMission = svl.missionContainer.getCurrentMission();
        var currMissionId = currMission.getProperty('missionId');

        $.ajax({
            url: "/tasks?regionId=" + svl.neighborhoodModel.currentNeighborhood().getProperty("regionId"),
            async: async,
            type: 'get',
            success: function (result) {
                var task;
                for (var i = 0; i < result.length; i++) {
                    task = svl.taskFactory.create(result[i], false);
                    if ((result[i].features[0].properties.completed)) task.complete();
                    // Skip the task that we were given to start with so that we don't add a duplicate.
                    if (task.getStreetEdgeId() !== getCurrentTask().getStreetEdgeId()) {
                        self._tasks.push(task);
                        // If the street was part of the curr mission, add it to the list!
                        if (task.getProperty('currentMissionId') === currMissionId) {
                            currMission.pushATaskToTheRoute(task);
                        }
                    }
                }
                tasksFinishedLoading = true;

                if (callback) callback();
            },
            error: function (result) {
                console.error(result);
            }
        });
    };

    /**
     * Updates the task priorities for the given set of streets. These should be updates from other users' audits.
     * @param updatedPriorities
    */
    function updateTaskPriorities(updatedPriorities) {
        // Loop through all updatedPriorities and update self._tasks with the new priorities.
        updatedPriorities.forEach(function (newPriority) {
            const index = self._tasks.findIndex((s) => { return s.getStreetEdgeId() === newPriority.streetEdgeId; });
            self._tasks[index].setProperty('priority', newPriority.priority);
        });
    }

    /**
     * Find incomplete tasks (i.e., street edges) that are connected to the given task.
     *
     * @param taskIn {object} Task
     * @param acrossAllUsers
     * @param threshold {number} Distance threshold
     * @param unit {string} Distance unit
     * @returns {Array}
     * @private
     */
    self._findConnectedTasks = function (taskIn, acrossAllUsers, threshold, unit) {
        var tasks = self.getTasks();

        if (acrossAllUsers) {
            tasks = tasks.filter(function (t) { return t.streetCompletedByAnyUser(); });
        }

        if (tasks) {
            var connectedTasks = [];
            if (!threshold) threshold = 0.01;  // 0.01 km.
            if (!unit) unit = {units: 'kilometers'};

            tasks = tasks.filter(function (t) { return !t.isComplete(); });

            if (taskIn) {
                tasks = tasks.filter(function (t) { return t.getStreetEdgeId() !== taskIn.getStreetEdgeId(); });

                for (var i = 0, len = tasks.length; i < len; i++) {
                    if (taskIn.isConnectedTo(tasks[i], threshold, unit)) {
                        connectedTasks.push(tasks[i]);
                    }
                }
                return connectedTasks;
            } else {
                return util.shuffle(tasks);
            }
        } else {
            return [];
        }
    };

    /**
     * Get the total distance of completed segments
     * @params {unit} String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in unit.
     */
    function getCompletedTaskDistance(unit) {
        if (!unit) unit = { units: i18next.t('common:unit-distance') };
        var completedTasks = getCompletedTasks(),
            geojson,
            feature,
            distance = 0;

        if (completedTasks) {
            for (var i = 0, len = completedTasks.length; i < len; i++) {
                geojson = completedTasks[i].getGeoJSON();
                feature = geojson.features[0];
                distance += turf.length(feature, unit);
            }
        }
        if (!currentTask.isComplete()) distance += getCurrentTaskDistance(unit);

        return distance;
    }

    /**
     * Get the total distance of segments completed by any user.
     *
     * @returns {number} distance in unit.
     */
    function getCompletedTaskDistanceAcrossAllUsersUsingPriority() {
        var unit = { units: i18next.t('common:unit-distance') };
        var tasks = self.getTasks().filter(function(t) { return t.getStreetPriority() < 1; });
        var geojson;
        var feature;
        var distance = 0;

        if (tasks) {
            for (var i = 0; i < tasks.length; i++) {
                geojson = tasks[i].getGeoJSON();
                feature = geojson.features[0];
                distance += turf.length(feature, unit);
            }
        }
        return distance;
    }

    /**
     *
     * @param unit {string} Distance unit
     * @returns {*}
     */
    function getCurrentTaskDistance(unit) {
        if (!unit) unit = {units: 'kilometers'};

        if (currentTask) {
            var currentLatLng = navigationModel.getPosition();
            currentTask.updateTheFurthestPointReached(currentLatLng.lat, currentLatLng.lng);
            return currentTask.getAuditedDistance(unit);
        }
        return 0;
    }

    /**
     * This method returns the completed tasks.
     * @returns {Array}
     */
    function getCompletedTasks() {
        return self._tasks.filter(function (task) { return task.isComplete(); });
    }

    /**
     * Return list of tasks completed by any user.
     * @returns {Array of tasks}
     */
    function getCompletedTasksAllUsersUsingPriority() {
        return self._tasks.filter(function (task) { return task.getStreetPriority() < 1; });
    }

    /**
     * Get the current task
     * @returns {*}
     */
    function getCurrentTask () {
        return currentTask;
    }

    /**
     * Get the before jump task
     * @returns {*}
     */
    function getBeforeJumpTask () {
        return beforeJumpNewTask;
    }

    /**
     * Used to set target distance for Mission Progress
     *
     * @param unit {string} Distance unit
     */
    self.getIncompleteTaskDistance = function (unit) {
        var incompleteTasks = self.getIncompleteTasks();
        var taskDistances = incompleteTasks.map(function (task) { return task.lineDistance(unit); });
        return taskDistances.reduce(function (a, b) { return a + b; }, 0);
    };

    /**
     * Find incomplete tasks by the user.
     */
    self.getIncompleteTasks = function () {
        return self._tasks.filter(function (task) { return !task.isComplete(); });
    };

    /**
     * Find incomplete tasks across all users.
     */
    self.getIncompleteTasksAcrossAllUsersUsingPriority = function () {
        var incompleteTasksByUser = self._tasks.filter(function (task) { return !task.isComplete(); });

        var incompleteTasksAcrossAllUsers = [];
        if (incompleteTasksByUser.length > 0) {
            incompleteTasksAcrossAllUsers = incompleteTasksByUser.filter(function (t) {
                return t.getStreetPriority() === 1;
            });
        }

        return incompleteTasksAcrossAllUsers;
    };

    this.getTasks = function () {
        return self._tasks;
    };

    /**
     * Check if the current task is the first task in this session
     * @returns {boolean}
     */
    function isFirstTask () {
        return length() === 0;
    }

    /**
     * Get the length of the previous tasks
     * @returns {*|Number}
     */
    function length () {
        return previousTasks.length;
    }

    /**
     * Checks if finishedTask makes the neighborhood complete across all users; if so, it displays the relevant overlay.
     *
     * @param finishedTask
     */
    function updateNeighborhoodCompleteAcrossAllUsersStatus(finishedTask) {
        var wasNeighborhoodCompleteAcrossAllUsers = neighborhoodModel.getNeighborhoodCompleteAcrossAllUsers();

        // Only run this code if the neighborhood was set as incomplete
        if (!wasNeighborhoodCompleteAcrossAllUsers) {
            var candidateTasks = self.getIncompleteTasksAcrossAllUsersUsingPriority().filter(function (t) {
                return (t.getStreetEdgeId() !== (finishedTask ? finishedTask.getStreetEdgeId() : null));
            });
            // Indicates neighborhood is complete
            if (candidateTasks.length === 0) {
                // TODO: Remove the console.log statements if issue #1449 has been resolved.
                console.error('finished neighborhood screen has appeared, logging debug info');
                console.trace();
                console.log('incompleteTasks.length:' +
                    self.getIncompleteTasksAcrossAllUsersUsingPriority().length);
                console.log('finishedTask streetEdgeId: ' + finishedTask.getStreetEdgeId());

                neighborhoodModel.setNeighborhoodCompleteAcrossAllUsers();
                $('#neighborhood-completion-overlay').show();
                var currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
                var currentNeighborhoodId = currentNeighborhood.getProperty("regionId");

                console.log('neighborhood: ' + currentNeighborhoodId + ": " + currentNeighborhood);

                tracker.push("NeighborhoodComplete_AcrossAllUsers", {'RegionId': currentNeighborhoodId})
            }
        }
    }

    /**
     * Get the next task and set it as a current task.
     *
     * Procedure:
     * Get the list of the highest priority streets that this user has not audited
     * - If the street you just audited connects to any of those, pick the highest priority one
     * - O/w jump to the highest priority street
     *
     * @param finishedTask The task that has been finished.
     * @returns {*} Next task
     */
    this.nextTask = function (finishedTask) {
        var newTask;
        var userCandidateTasks = null;

        // Check if this task finishes the neighborhood across all users, if so, shows neighborhood complete overlay.
        updateNeighborhoodCompleteAcrossAllUsersStatus(finishedTask);

        // Find the highest priority task not audited by the user.
        var tasksNotCompletedByUser = self.getTasks().filter(function (t) {
            return !t.isComplete() && t.getStreetEdgeId() !== (finishedTask ? finishedTask.getStreetEdgeId() : null);
        }).sort(function(t1, t2) {
            return t2.getStreetPriority() - t1.getStreetPriority();
        });
        if (tasksNotCompletedByUser.length === 0) { // user has audited entire region
            return null;
        }
        var highestPriorityTask = tasksNotCompletedByUser[0];

        // If any of the connected tasks has max discretized priority, pick the highest priority one, o/w take the
        // highest priority task in the region.
        userCandidateTasks = self._findConnectedTasks(finishedTask, false, null, null);

        userCandidateTasks = userCandidateTasks.filter(function(t) {
            return !t.isComplete() && t.getStreetPriorityDiscretized() === highestPriorityTask.getStreetPriorityDiscretized();
        }).sort(function(t1,t2) {
            return t2.getStreetPriority() - t1.getStreetPriority();
        });

        if (userCandidateTasks.length > 0) {
            newTask = userCandidateTasks[0];
        } else {
            newTask = highestPriorityTask;
        }

        // Return the new task. Change the starting point and start time of the new task accordingly.
        if (finishedTask) {
            var coordinate = finishedTask.getLastCoordinate();
            newTask.setStreetEdgeDirection(coordinate.lat, coordinate.lng);
            newTask.setProperty('taskStart', new Date());
        }

        return newTask;
    };

    /**
     * Push a task to previousTasks
     * @param task
     */
    function pushATask (task) {
        if (previousTasks.indexOf(task) < 0) {
            previousTasks.push(task);
        }
    }

    /**
     * Pop a task at the end of previousTasks
     * @returns {*}
     */
    function pop () {
        return previousTasks.pop();
    }

    /**
     * Set the current task
     * @param task
     */
    this.setCurrentTask = function (task) {
        currentTask = task;
        if ('missionContainer' in svl) {
            var currMissionId = svl.missionContainer.getCurrentMission().getProperty('missionId');
            currentTask.setProperty('currentMissionId', currMissionId);
        }
        if (tracker) tracker.push('TaskStart');

        if ('compass' in svl) {
            svl.compass.setTurnMessage();
            svl.compass.showMessage();
            if (!svl.map.getLabelBeforeJumpListenerStatus()) svl.compass.update();
        }

        if ('form' in svl){
            svl.form.submit(svl.form.compileSubmissionData(currentTask), currentTask);
        }
    };

    /**
     * Store the before jump new task
     * @param task
     */
    this.setBeforeJumpNewTask = function (task) {
        beforeJumpNewTask = task;
    };

    /**
     *
     * @param unit {string} Distance unit
     */
    function totalLineDistanceInNeighborhood(unit) {
        if (!unit) unit = {units: 'kilometers'};
        var tasks = self.getTasks();

        if (tasks) {
            var distanceArray = tasks.map(function (t) { return t.lineDistance(unit); });
            return distanceArray.sum();
        } else {
            return null;
        }
    }

    /**
     * This method is called from Map.handlerPositionUpdate() to update the color of audited and unaudited street
     * segments on Google Maps.
     * TODO This should be done somewhere else.
     */
    function update () {
        for (var i = 0, len = previousTasks.length; i < len; i++) {
            previousTasks[i].render();
        }

        var currentLatLng = navigationModel.getPosition();
        currentTask.updateTheFurthestPointReached(currentLatLng.lat, currentLatLng.lng);
        currentTask.render();
    }

    /**
     * Update the audited distance in the right sidebar using the length of the streets in the current neighborhood.
     * @returns {updateAuditedDistance}
     */
    function updateAuditedDistance() {
        var distance = 0;
        var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();

        if (neighborhood) {
            distance = getCompletedTaskDistance({ units: i18next.t('common:unit-distance') });
        }
        svl.statusFieldNeighborhood.setAuditedDistance(distance);
        svl.statusFieldOverall.setNeighborhoodAuditedDistance(distance);
        return this;
    }

    /**
     * Checks if there are any max priority tasks remaining (proxy for neighborhood being complete across all users.
     * @returns {null|boolean}
     */
    function hasMaxPriorityTask() {
        return self._tasks.filter(function (task) { return task.getStreetPriority() === 1; }).length > 0;
    }

    /**
     * Renders all previously completed tasks. Should be called at page load so it does not render redundantly.
     */
    function renderTasksFromPreviousSessions() {
        var completedTasks = getCompletedTasks();
        if (completedTasks) {
            for (let i = 0; i < completedTasks.length; ++i) {
                completedTasks[i].render();
            }
        }
    }

    self.endTask = endTask;
    self.getCompletedTasks = getCompletedTasks;
    self.getCompletedTasksAllUsersUsingPriority = getCompletedTasksAllUsersUsingPriority;
    self.getCurrentTaskDistance = getCurrentTaskDistance;
    self.getCompletedTaskDistance = getCompletedTaskDistance;
    self.getCompletedTaskDistanceAcrossAllUsersUsingPriority = getCompletedTaskDistanceAcrossAllUsersUsingPriority;
    self.getCurrentTask = getCurrentTask;
    self.getBeforeJumpNewTask = getBeforeJumpTask;
    self.isFirstTask = isFirstTask;
    self.length = length;
    self.push = pushATask;
    self.renderTasksFromPreviousSessions = renderTasksFromPreviousSessions;
    self.hasMaxPriorityTask = hasMaxPriorityTask;
    self.totalLineDistanceInNeighborhood = totalLineDistanceInNeighborhood;
    self.update = update;
    self.updateAuditedDistance = updateAuditedDistance;
    self.updateTaskPriorities = updateTaskPriorities;
}

/**
 * TaskFactory module.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TaskFactory () {
    /**
     * Create a new task instance
     * @param geojson
     * @param tutorialTask
     * @param lat
     * @param lng
     * @param startPointReversed
     * @returns {svl.Task}
     */
    this.create = function (geojson, tutorialTask, lat, lng, startPointReversed) {
        return new Task(geojson, tutorialTask, lat, lng, startPointReversed);
    };
}
function TaskModel() {
}

_.extend(TaskModel.prototype, Backbone.Events);

/**
 * User module
 * @param param
 * @returns {{className: string}}
 * @constructor
 */
function User (param) {
    var properties = {
        username: param.username,
        role: param.role
    };

    /**
     * Get a property
     * @param key
     * @returns {*}
     */
    this.getProperty = function (key) {
        return properties[key]; 
    };

    /**
     * Set a property
     * @param key
     * @param value
     */
    this.setProperty = function (key, value) {
        properties[key] = value;
    };
}

function UserModel () {
    this._user = null;
}

_.extend(UserModel.prototype, Backbone.Events);

UserModel.prototype.getUser = function () {
    return this._user;
};
/**
 * Todo. Separate the UI component and the logic component
 * @param canvas
 * @param mapService
 * @param canvas
 * @param mapService
 * @param tracker
 * @param uiZoomControl
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ZoomControl (canvas, mapService, tracker, uiZoomControl) {
    var self = { 'className' : 'ZoomControl' },
        properties = {
            maxZoomLevel: 3,
            minZoomLevel: 1
        },
        status = {
            disableZoomIn: false,
            disableZoomOut: true
        },
        lock = {
            disableZoomIn: false,
            disableZoomOut: false
        },
        zoomBlink = {
          isBlinking: false
        },
        blinkInterval;


    /**
     * Get the zoom in UI control
     */
    function getZoomInUI () {
        return uiZoomControl.zoomIn;
    }

    /**
     * Get the zoom out UI control
     */
    function getZoomOutUI () {
        return uiZoomControl.zoomOut;
    }

    /**
     * Blink the zoom in and zoom-out buttons
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiZoomControl.zoomIn.toggleClass("highlight-50");
            uiZoomControl.zoomOut.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Blink the zoom in button
     */
    function blinkZoomIn () {
        stopBlinking();
        zoomBlink.isBlinking = true;
        blinkInterval = window.setInterval(function () {
            uiZoomControl.zoomIn.toggleClass("highlight-100");
        }, 500);
    }

    /**
     * Blink the zoom out button
     */
    function blinkZoomOut () {
        stopBlinking();
        zoomBlink.isBlinking = true;
        blinkInterval = window.setInterval(function () {
            uiZoomControl.zoomOut.toggleClass("highlight-100");
        }, 500);
    }

    /**
     * Disables zooming in
     * @method
     * @returns {self}
     */
    function disableZoomIn () {
        if (!lock.disableZoomIn) {
            status.disableZoomIn = true;
            if (uiZoomControl) {
                uiZoomControl.zoomIn.addClass('disabled');
            }
        }
        return this;
    }

    /**
     * Disables zoom out
     */
    function disableZoomOut () {
        if (!lock.disableZoomOut) {
            status.disableZoomOut = true;
            if (uiZoomControl) {
                uiZoomControl.zoomOut.addClass('disabled');
            }
        }
        return this;
    }

    /**
     * Enable zoom in
     */
    function enableZoomIn () {
        if (!lock.disableZoomIn) {
            status.disableZoomIn = false;
            if (uiZoomControl) {
                uiZoomControl.zoomIn.removeClass('disabled');
            }
        }
        return this;
    }

    /**
     * Enable zoom out
     */
    function enableZoomOut () {
        if (!lock.disableZoomOut) {
            status.disableZoomOut = false;
            if (uiZoomControl) {
                uiZoomControl.zoomOut.removeClass('disabled');
            }
        }
        return this;
    }

    /**
     * Get status
     * @param name
     * @returns {*}
     */
    function getStatus (name) {
        if (name in status) {
            return status[name];
        } else {
            throw 'You cannot access a property "' + name + '".';
        }
    }

    /** Get a property.*/
    function getProperty (name) {
        if (name in properties) {
            return properties[name];
        } else {
            throw 'You cannot access a property "' + name + '".';
        }
    }

    /** Lock zoom in */
    function lockDisableZoomIn () {
        lock.disableZoomIn = true;
        return this;
    }

    /** Lock zoom out */
    function lockDisableZoomOut () {
        lock.disableZoomOut = true;
        return this;
    }

    /**
     * This is a callback function for zoom-in button. This function increments a sv zoom level.
     */
    function _handleZoomInButtonClick () {
        if (tracker)  tracker.push('Click_ZoomIn');

        var pov = mapService.getPov();

        if (pov.zoom < properties.maxZoomLevel && zoomBlink.isBlinking === false) {
          svl.zoomShortcutAlert.zoomClicked();
        }

        if (!status.disableZoomIn) {
            var povChange = mapService.getPovChangeStatus();

            setZoom(pov.zoom + 1);
            povChange["status"] = true;
            canvas.clear();
            canvas.render2();
            $(document).trigger('ZoomIn');
        }
    }

    /**
     * This is a callback function for zoom-out button. This function decrements a sv zoom level.
     */
    function _handleZoomOutButtonClick () {
        if (tracker) tracker.push('Click_ZoomOut');

        var pov = mapService.getPov();

        if (pov.zoom > properties.minZoomLevel && zoomBlink.isBlinking === false) {
          svl.zoomShortcutAlert.zoomClicked();
        }

        if (!status.disableZoomOut) {
            var povChange = mapService.getPovChangeStatus();
            setZoom(pov.zoom - 1);
            povChange["status"] = true;
            canvas.clear();
            canvas.render2();
            $(document).trigger('ZoomOut');
        }
    }

    /**
     * These functions are called when the keyboard shortcut for zoomIn/Out is used.
     */

    /** Zoom in */
    function zoomIn () {
        if (!status.disableZoomIn) {

            var povChange = mapService.getPovChangeStatus();
            var pov = mapService.getPov();

            setZoom(pov.zoom + 1);
            povChange["status"] = true;
            canvas.clear();
            canvas.render2();
            $(document).trigger('ZoomIn');
            return this;
        } else {
            return false;
        }
    }

    /** Zoom out */
    function zoomOut () {
        // This method is called from outside this class to zoom out from a GSV image.
        if (!status.disableZoomOut) {

            var povChange = mapService.getPovChangeStatus();
            var pov = mapService.getPov();

            setZoom(pov.zoom - 1);
            povChange["status"] = true;
            canvas.clear();
            canvas.render2();
            $(document).trigger('ZoomOut');
            return this;
        } else {
            return false;
        }
    }

    /**
     * This method sets the zoom level of the Street View.
     */
    function setZoom (zoomLevelIn) {
        if (typeof zoomLevelIn !== "number") { return false; }

        // Cancel drawing when zooming in or out.
        if ('canvas' in svl) { canvas.cancelDrawing(); }

        // Set the zoom level and change the panorama properties.
        var zoomLevel = undefined;
        zoomLevelIn = parseInt(zoomLevelIn);
        if (zoomLevelIn <= properties.minZoomLevel) {
            zoomLevel = properties.minZoomLevel;
            enableZoomIn();
            disableZoomOut();
        } else if (zoomLevelIn >= properties.maxZoomLevel) {
            zoomLevel = properties.maxZoomLevel;
            disableZoomIn();
            enableZoomOut();
        } else {
            zoomLevel = zoomLevelIn;
            enableZoomIn();
            enableZoomOut();
        }
        mapService.setZoom(zoomLevel);
        var i,
            labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;
        for (i = 0; i < labelLen; i += 1) {
            labels[i].setTagVisibility('hidden');
            labels[i].resetTagCoordinate();
        }
        svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
        svl.canvas.clear();
        svl.canvas.render2();
        return zoomLevel;
    }

    /**
     * Stop blinking the zoom-in and zoom-out buttons
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        zoomBlink.isBlinking = false;
        if (uiZoomControl) {
            uiZoomControl.zoomIn.removeClass("highlight-50");
            uiZoomControl.zoomOut.removeClass("highlight-50");

            uiZoomControl.zoomIn.removeClass("highlight-100");
            uiZoomControl.zoomOut.removeClass("highlight-100");
        }
    }



    /**
     * This method sets the maximum zoom level.
     */
    function setMaxZoomLevel (zoomLevel) {
        properties.maxZoomLevel = zoomLevel;
        return this;
    }

    /** This method sets the minimum zoom level. */
    function setMinZoomLevel (zoomLevel) {
        properties.minZoomLevel = zoomLevel;
        return this;
    }

    /** Lock zoom in */
    function unlockDisableZoomIn () {
        lock.disableZoomIn = false;
        return this;
    }

    /** Lock zoom out */
    function unlockDisableZoomOut () {
        lock.disableZoomOut = false;
        return this;
    }

    /**
     * Change the opacity of zoom buttons
     * @returns {updateOpacity}
     */
    function updateOpacity () {
        var pov = mapService.getPov();

        if (pov && uiZoomControl) {
            var zoom = pov.zoom;
            // Change opacity
            if (zoom >= properties.maxZoomLevel) {
                uiZoomControl.zoomIn.css('opacity', 0.5);
                uiZoomControl.zoomOut.css('opacity', 1);
            } else if (zoom <= properties.minZoomLevel) {
                uiZoomControl.zoomIn.css('opacity', 1);
                uiZoomControl.zoomOut.css('opacity', 0.5);
            } else {
                uiZoomControl.zoomIn.css('opacity', 1);
                uiZoomControl.zoomOut.css('opacity', 1);
            }
        }

        // If zoom in and out are disabled, fade them out anyway.
        if (status.disableZoomIn) { uiZoomControl.zoomIn.css('opacity', 0.5); }
        if (status.disableZoomOut) { uiZoomControl.zoomOut.css('opacity', 0.5); }
        return this;
    }

    self.blink = blink;
    self.blinkZoomIn = blinkZoomIn;
    self.blinkZoomOut = blinkZoomOut;
    self.disableZoomIn = disableZoomIn;
    self.disableZoomOut = disableZoomOut;
    self.enableZoomIn = enableZoomIn;
    self.enableZoomOut = enableZoomOut;
    self.getStatus = getStatus;
    self.getProperties = getProperty; // Todo. Change getProperties to getProperty.
    self.getZoomInUI = getZoomInUI;
    self.getZoomOutUI = getZoomOutUI;
    self.lockDisableZoomIn = lockDisableZoomIn;
    self.lockDisableZoomOut = lockDisableZoomOut;
    self.stopBlinking = stopBlinking;
    self.updateOpacity = updateOpacity;
    self.setMaxZoomLevel = setMaxZoomLevel;
    self.setMinZoomLevel = setMinZoomLevel;
    self.unlockDisableZoomIn = unlockDisableZoomIn;
    self.unlockDisableZoomOut = unlockDisableZoomOut;
    self.zoomIn = zoomIn;
    self.zoomOut = zoomOut;

    uiZoomControl.zoomIn.bind('click', _handleZoomInButtonClick);
    uiZoomControl.zoomOut.bind('click', _handleZoomOutButtonClick);
    return self;
}

/**
 * Source:
 * https://github.com/marmat/google-maps-api-addons/blob/master/panomarker/src/panomarker.js
 *
 * PanoMarker
 * Version 1.0
 *
 * @author kaktus621@gmail.com (Martin Matysiak)
 * @fileoverview A marker that can be placed inside custom StreetView panoramas.
 * Regular markers inside StreetViewPanoramas can only be shown vertically
 * centered and aligned to LatLng coordinates.
 *
 * Custom StreetView panoramas usually do not have any geographical information
 * (e.g. inside views), thus a different method of positioning the marker has to
 * be used. This class takes simple heading and pitch values from the panorama's
 * center in order to move the marker correctly with the user's viewport
 * changes.
 *
 * Since something like that is not supported natively by the Maps API, the
 * marker actually sits on top of the panorama, DOM-wise outside of the
 * actual map but still inside the map container.
 */

/**
 * @license Copyright 2014 — 2015 Martin Matysiak.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * PanoMarkerOptions
 *
 * {google.maps.Point} anchor The point (in pixels) to which objects will snap.
 * {string} className The class name which will be assigned to the
 *    created div node.
 * {HTMLDivElement} container The container holding the panorama.
 * {string} icon URL to an image file that shall be used.
 * {string} id A unique identifier that will be assigned to the
 *    created div-node.
 * {google.maps.StreetViewPanorama} pano Panorama in which to display marker.
 * {google.maps.StreetViewPov} position Marker position.
 * {google.maps.Size} size The size of the marker in pixels.
 * {string} title Rollover text.
 * {boolean} visible If true, the marker is visible.
 * {number} zIndex The marker's z-index.
 */


(function(global, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else if (typeof define === 'function' && typeof define.amd === 'object') {
        define(['goog!maps,3,other_params:[sensor=false&libraries=visualization]'],
            factory);
    } else {
        if (typeof google !== 'object' || typeof google.maps !== 'object') {
            throw new Error('PanoMarker requires google maps library');
        }
        global.PanoMarker = factory();
    }
}(typeof window !== 'undefined' ? window : this, function() {

    /**
     * Creates a PanoMarker with the options specified. If a panorama is specified,
     * the marker is added to the map upon construction. Note that the position must
     * be set for the marker to display.
     *
     * Important: do not use the inherited method <code>setMap()</code> to change
     * the panorama, but use <code>setPano()</code> instead, otherwise a proper
     * functionality is not guaranteed.
     *
     * @constructor
     * @param {PanoMarkerOptions} opts A set of parameters to customize the marker.
     * @extends google.maps.OverlayView
     */
    var PanoMarker = function(opts) {

        // In case no options have been given at all, fallback to {} so that the
        // following won't throw errors.
        opts = opts || {};

        // panorama.getContainer has been deprecated in the Google Maps API. The user
        // now explicity needs to pass in the container for the panorama.
        if (!opts.container) {
            throw 'A panorama container needs to be defined.';
        }

        /** @private @type {HTMLDivElement} */
        this.container_ = opts.container;

        /**
         * Currently only Chrome is rendering panoramas in a 3D sphere. The other
         * browsers are just showing the raw panorama tiles and pan them around.
         *
         * @private
         * @type {function(StreetViewPov, StreetViewPov, number, Element): Object}
         */

        // Original code:
        // this.povToPixel_ = (!!window.chrome || isMobile()) ? PanoMarker.povToPixel3d :
        //     PanoMarker.povToPixel2d;

        // New code (April 17, 2019) -- modified by Aileen
        // Source: https://github.com/marmat/google-maps-api-addons/issues/36#issuecomment-342774699
        this.povToPixel_ = PanoMarker.povToPixel2d;
        var pixelCanvas = document.createElement("canvas");

        if (pixelCanvas && (pixelCanvas.getContext("experimental-webgl") || pixelCanvas.getContext("webgl"))) {
            this.povToPixel_ = PanoMarker.povToPixel3d;
        }

        /** @private @type {google.maps.Point} */
        this.anchor_ = opts.anchor || new google.maps.Point(16, 16);

        /** @private @type {?string} */
        this.className_ = opts.className || null;

        /** @private @type {boolean} */
        this.clickable_ = opts.clickable || true;

        /** @private @type {?string} */
        this.icon_ = opts.icon || null;

        /** @private @type {?string} */
        this.id_ = opts.id || null;

        /** @private @ŧype {?HTMLDivElement} */
        this.marker_ = null;

        /** @private @type {?google.maps.StreetViewPanorama} */
        this.pano_ = null;

        /** @private @type {number} */
        this.pollId_ = -1;

        /** @private @type {google.maps.StreetViewPov} */
        this.position_ = opts.position || {heading: 0, pitch: 0};

        /** @private @type {Object} */
        this.povListener_ = null;

        /** @private @type {Object} */
        this.zoomListener_ = null;

        /** @private @type {google.maps.Size} */
        this.size_ = opts.size || new google.maps.Size(32, 32);

        /** @private @type {string} */
        this.title_ = opts.title || '';

        /** @private @type {boolean} */
        this.visible_ = (typeof opts.visible === 'boolean') ? opts.visible : true;

        /** @private @type {number} */
        this.zIndex_ = opts.zIndex || 1;

        /** @private @type {Object} */
        this.markerContainer_ = opts.markerContainer || null;

        /** @private @type {boolean} */
        this.toggleDescription_ = false;

        // At last, call some methods which use the initialized parameters
        this.setPano(opts.pano || null, opts.container);
    };

    PanoMarker.prototype = new google.maps.OverlayView();


//// Static helper methods for the position calculation ////


    /**
     * According to the documentation (goo.gl/WT4B57), the field-of-view angle
     * should precisely follow the curve of the form 180/2^zoom. Unfortunately, this
     * is not the case in practice in the 3D environment. From experiments, the
     * following FOVs seem to be more correct:
     *
     *        Zoom | best FOV | documented FOV
     *       ------+----------+----------------
     *          0  | 126.5    | 180
     *          1  | 90       | 90
     *          2  | 53       | 45
     *          3  | 28       | 22.5
     *          4  | 14.25    | 11.25
     *          5  | 7.25     | not specified
     *
     * Because of this, we are doing a linear interpolation for zoom values <= 2 and
     * then switch over to an inverse exponential. In practice, the produced
     * values are good enough to result in stable marker positioning, even for
     * intermediate zoom values.
     *
     * @return {number} The (horizontal) field of view angle for the given zoom.
     */
    PanoMarker.get3dFov = function(zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    };


    /**
     * Given the current POV, this method calculates the Pixel coordinates on the
     * given viewport for the desired POV. All credit for the math this method goes
     * to user3146587 on StackOverflow: http://goo.gl/0GGKi6
     *
     * My own approach to explain what is being done here (including figures!) can
     * be found at http://martinmatysiak.de/blog/view/panomarker
     *
     * @param {StreetViewPov} targetPov The point-of-view whose coordinates are
     *     requested.
     * @param {StreetViewPov} currentPov POV of the viewport center.
     * @param {number} zoom The current zoom level.
     * @param {Element} viewport The current viewport containing the panorama.
     * @return {Object} Top and Left offsets for the given viewport that point to
     *     the desired point-of-view.
     */
    PanoMarker.povToPixel3d = function(targetPov, currentPov, zoom, viewport) {

        // Gather required variables and convert to radians where necessary
        var width = viewport.offsetWidth;
        var height = viewport.offsetHeight;

        // Adjusts the width and height for when placing PanoMarkers on mobile phones.
        if (isMobile()) {
            width = window.innerWidth;
            height = window.innerHeight;
        }

        var target = {
            left: width / 2,
            top: height / 2
        };

        var DEG_TO_RAD = Math.PI / 180.0;
        var fov = PanoMarker.get3dFov(zoom) * DEG_TO_RAD;
        var h0 = currentPov.heading * DEG_TO_RAD;
        var p0 = currentPov.pitch * DEG_TO_RAD;
        var h = targetPov.heading * DEG_TO_RAD;
        var p = targetPov.pitch * DEG_TO_RAD;

        // f = focal length = distance of current POV to image plane
        var f = (width / 2) / Math.tan(fov / 2);

        // our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0)
        // calculate 3d coordinates of viewport center and target
        var cos_p = Math.cos(p);
        var sin_p = Math.sin(p);

        var cos_h = Math.cos(h);
        var sin_h = Math.sin(h);

        var x = f * cos_p * sin_h;
        var y = f * cos_p * cos_h;
        var z = f * sin_p;

        var cos_p0 = Math.cos(p0);
        var sin_p0 = Math.sin(p0);

        var cos_h0 = Math.cos(h0);
        var sin_h0 = Math.sin(h0);

        var x0 = f * cos_p0 * sin_h0;
        var y0 = f * cos_p0 * cos_h0;
        var z0 = f * sin_p0;

        var nDotD = x0 * x + y0 * y + z0 * z;
        var nDotC = x0 * x0 + y0 * y0 + z0 * z0;

        // nDotD == |targetVec| * |currentVec| * cos(theta)
        // nDotC == |currentVec| * |currentVec| * 1
        // Note: |currentVec| == |targetVec| == f

        // Sanity check: the vectors shouldn't be perpendicular because the line
        // from camera through target would never intersect with the image plane
        if (Math.abs(nDotD) < 1e-6) {
            return null;
        }

        // t is the scale to use for the target vector such that its end
        // touches the image plane. It's equal to 1/cos(theta) ==
        //     (distance from camera to image plane through target) /
        //     (distance from camera to target == f)
        var t = nDotC / nDotD;

        // Sanity check: it doesn't make sense to scale the vector in a negative
        // direction. In fact, it should even be t >= 1.0 since the image plane
        // is always outside the pano sphere (except at the viewport center)
        if (t < 0.0) {
            return null;
        }

        // (tx, ty, tz) are the coordinates of the intersection point between a
        // line through camera and target with the image plane
        var tx = t * x;
        var ty = t * y;
        var tz = t * z;

        // u and v are the basis vectors for the image plane
        var vx = -sin_p0 * sin_h0;
        var vy = -sin_p0 * cos_h0;
        var vz = cos_p0;

        var ux = cos_h0;
        var uy = -sin_h0;
        var uz = 0;

        // normalize horiz. basis vector to obtain orthonormal basis
        var ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        ux /= ul;
        uy /= ul;
        uz /= ul;

        // project the intersection point t onto the basis to obtain offsets in
        // terms of actual pixels in the viewport
        var du = tx * ux + ty * uy + tz * uz;
        var dv = tx * vx + ty * vy + tz * vz;

        // use the calculated pixel offsets
        target.left += du;
        target.top -= dv;
        return target;
    };


    /**
     * Helper function that converts the heading to be in the range [-180,180).
     *
     * @param {number} heading The heading to convert.
     */
    PanoMarker.wrapHeading = function(heading) {
        // We shift to the range [0,360) because of the way JS behaves for modulos of
        // negative numbers.
        heading = (heading + 180) % 360;

        // Determine if we have to wrap around
        if (heading < 0) {
            heading += 360;
        }

        return heading - 180;
    };


    /**
     * A simpler version of povToPixel2d which does not have to do the spherical
     * projection because the raw StreetView tiles are just panned around when the
     * user changes the viewport position.
     *
     * @param {StreetViewPov} targetPov The point-of-view whose coordinates are
     *     requested.
     * @param {StreetViewPov} currentPov POV of the viewport center.
     * @param {number} zoom The current zoom level.
     * @param {Element} viewport The current viewport containing the panorama.
     * @return {Object} Top and Left offsets for the given viewport that point to
     *     the desired point-of-view.
     */
    PanoMarker.povToPixel2d = function(targetPov, currentPov, zoom, viewport) {
        // Gather required variables
        var width = viewport.offsetWidth;
        var height = viewport.offsetHeight;

        var target = {
            left: width / 2,
            top: height / 2
        };

        // In the 2D environment, the FOV follows the documented curve.
        var hfov = 180 / Math.pow(2, zoom);
        var vfov = hfov * (height / width);
        var dh = PanoMarker.wrapHeading(targetPov.heading - currentPov.heading);
        var dv = targetPov.pitch - currentPov.pitch;

        target.left += dh / hfov * width;
        target.top -= dv / vfov * height;
        return target;
    };


//// Implementations for abstract methods inherited from g.m.OverlayView ////


    /** @override */
    PanoMarker.prototype.onAdd = function() {
        if (!!this.marker_) {
            // Sometimes the maps API does trigger onAdd correctly. We have to prevent
            // duplicate execution of the following code by checking if the marker node
            // has already been created.
            return;
        }

        var marker = document.createElement('div');
        marker.classList.add('icon-outline');

        // Basic style attributes for every marker
        marker.style.position = 'absolute';
        marker.style.cursor = 'inherit';    // To keep the mouseover icon open hand. See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1393
        marker.style.width = this.size_.width + 'px';
        marker.style.height = this.size_.height + 'px';
        marker.style.display = this.visible_ ? 'block' : 'none';
        marker.style.zIndex = this.zIndex_;

        // Set other css attributes based on the given parameters
        if (this.id_) { marker.id = this.id_; }
        if (this.className_) { marker.className = this.className_; }
        if (this.title_) { marker.title = this.title_; }
        if (this.icon_) { marker.style.backgroundImage = 'url(' + this.icon_ + ')'; }

        // If neither icon, class nor id is specified, assign the basic google maps
        // marker image to the marker (otherwise it will be invisible)
        if (!(this.id_ || this.className_ || this.icon_)) {
            marker.style.backgroundImage = 'url(https://www.google.com/intl/en_us/' +
                'mapfiles/ms/micons/red-dot.png)';
        }

        this.marker_ = marker;

        // Add marker to viewControlLayer if on validate page.
        if (this.markerContainer_ == null) {
            this.markerContainer_ = this.getPanes().overlayMouseTarget;
        }

        this.markerContainer_.appendChild(marker);

        // Attach to some global events
        window.addEventListener('resize', this.draw.bind(this));
        this.povListener_ = google.maps.event.addListener(this.getMap(),
            'pov_changed', this.draw.bind(this));
        this.zoomListener_ = google.maps.event.addListener(this.getMap(),
            'zoom_changed', this.draw.bind(this));

        var eventName = 'click';

        // Make clicks possible
        if (window.PointerEvent) {
            eventName = 'pointerdown';
        } else if (window.MSPointerEvent) {
            eventName = 'MSPointerDown';
        }

        marker.addEventListener(eventName, this.onClick.bind(this), false);

        // If this is a validation label, we want to add mouse-hovering event
        // for popped up hide/show label.
        if (this.id_ === "validate-pano-marker") {
            if (isMobile()) {
                marker.addEventListener('touchstart', function () {
                    let labelDescriptionBox = $("#label-description-box");
                    let desBox = labelDescriptionBox[0];
                    if (!this.toggleDescription_) {
                        desBox.style.right = (svv.canvasWidth - parseFloat(marker.style.left) - (parseFloat(marker.style.width) / 2)) + 'px';
                        desBox.style.top = (parseFloat(marker.style.top) + (parseFloat(marker.style.height) / 2)) + 'px';
                        desBox.style.zIndex = 2;
                        desBox.style.visibility = 'visible';
                        this.toggleDescription_ = true;
                    } else {
                        desBox.style.visibility = 'hidden';
                        this.toggleDescription_ = false;
                    }
                }.bind(this), false);
            } else {
                marker.addEventListener("mouseover", function () {
                    svv.labelVisibilityControl.showTagsAndDeleteButton();
                });

                marker.addEventListener("mouseout", function () {
                    svv.labelVisibilityControl.hideTagsAndDeleteButton();
                });
            }
        }

        this.draw();

        // Fire 'add' event once the marker has been created.
        google.maps.event.trigger(this, 'add', this.marker_);
    };


    /** @override */
    PanoMarker.prototype.draw = function() {
        if (!this.pano_) {
            return;
        }

        if (this.toggleDescription_) {
            let labelDescriptionBox = $("#label-description-box");
            let desBox = labelDescriptionBox[0];
            desBox.style.visibility = 'hidden';
            this.toggleDescription_ = false;
        }

        // Calculate the position according to the viewport. Even though the marker
        // doesn't sit directly underneath the panorama container, we pass it on as
        // the viewport because it has the actual viewport dimensions.
        var offset = this.povToPixel_(this.position_,
            this.pano_.getPov(),
            typeof this.pano_.getZoom() !== 'undefined' ? this.pano_.getZoom() : 1,
            this.container_);
        if (this.marker_) {
            if (offset !== null) {
                this.marker_.style.left = (offset.left - this.anchor_.x) + 'px';
                this.marker_.style.top = (offset.top - this.anchor_.y) + 'px';
            } else {
                // If offset is null, the marker is "behind" the camera,
                // therefore we position the marker outside of the viewport
                this.marker_.style.left = -(9999 + this.size_.width) + 'px';
                this.marker_.style.top = '0';
            }
        }
    };


    /** @param {Object} event The event object. */
    PanoMarker.prototype.onClick = function(event) {
        if (this.clickable_) {
            google.maps.event.trigger(this, 'click');
        }

        // don't let the event bubble up
        event.cancelBubble = true;
        if (event.stopPropagation) { event.stopPropagation(); }
    };


    /** @override */
    PanoMarker.prototype.onRemove = function() {
        if (!this.marker_) {
            // Similar to onAdd, we have to prevent duplicate onRemoves as well.
            return;
        }

        google.maps.event.removeListener(this.povListener_);
        google.maps.event.removeListener(this.zoomListener_);
        this.marker_.parentNode.removeChild(this.marker_);
        this.marker_ = null;

        // Fire 'remove' event once the marker has been destroyed.
        google.maps.event.trigger(this, 'remove');
    }

//// Getter to be roughly equivalent to the regular google.maps.Marker ////


    /** @return {google.maps.Point} The marker's anchor. */
    PanoMarker.prototype.getAnchor = function() { return this.anchor_; };


    /** @return {string} The className or null if not set upon marker creation. */
    PanoMarker.prototype.getClassName = function() { return this.className_; };


    /** @return {boolean} Whether the marker is clickable. */
    PanoMarker.prototype.getClickable = function() { return this.clickable_; };


    /** @return {string} The current icon, if any. */
    PanoMarker.prototype.getIcon = function() { return this.icon_; };


    /** @return {string} The identifier or null if not set upon marker creation. */
    PanoMarker.prototype.getId = function() { return this.id_; };

    /** @return {google.maps.StreetViewPanorama} The current panorama. */
    PanoMarker.prototype.getPano = function() { return this.pano_; };


    /** @return {google.maps.StreetViewPov} The marker's current position. */
    PanoMarker.prototype.getPosition = function() { return this.position_; };


    /** @return {google.maps.Size} The marker's size. */
    PanoMarker.prototype.getSize = function() { return this.size_; };


    /** @return {string} The marker's rollover text. */
    PanoMarker.prototype.getTitle = function() { return this.title_; };


    /** @return {boolean} Whether the marker is currently visible. */
    PanoMarker.prototype.getVisible = function() { return this.visible_; };


    /** @return {number} The marker's z-index. */
    PanoMarker.prototype.getZIndex = function() { return this.zIndex_; };

//// Setter for the properties mentioned above ////


    /** @param {google.maps.Point} anchor The marker's new anchor. */
    PanoMarker.prototype.setAnchor = function(anchor) {
        this.anchor_ = anchor;
        this.draw();
    };


    /** @param {string} className The new className. */
    PanoMarker.prototype.setClassName = function(className) {
        this.className_ = className;
        if (!!this.marker_) {
            this.marker_.className = className;
        }
    };


    /** @param {boolean} clickable Whether the marker shall be clickable. */
    PanoMarker.prototype.setClickable = function(clickable) {
        this.clickable_ = clickable;
    };


    /** @param {?string} icon URL to a new icon, or null in order to remove it. */
    PanoMarker.prototype.setIcon = function(icon) {
        this.icon_ = icon;
        if (!!this.marker_) {
            this.marker_.style.backgroundImage = !!icon ? 'url(' + icon + ')' : '';
        }
    };


    /** @param {string} id The new id. */
    PanoMarker.prototype.setId = function(id) {
        this.id_ = id;
        if (!!this.marker_) {
            this.marker_.id = id;
        }
    };


    /**
     * It turns out OverlayViews can be used with StreetViewPanoramas as well.
     * However, we have to fire onAdd and onRemove calls manually as they are not
     * triggered automatically for some reason if the object given to setMap is a
     * StreetViewPanorama.
     *
     * @param {google.maps.StreetViewPanorama} pano The panorama in which to show
     *    the marker.
     * @param {HTMLDivElement} container The container holding the panorama.
     */
    PanoMarker.prototype.setPano = function(pano, container) {
        // In contrast to regular OverlayViews, we are disallowing the usage on
        // regular maps
        if (!!pano && !(pano instanceof google.maps.StreetViewPanorama)) {
            throw 'PanoMarker only works inside a StreetViewPanorama.';
        }

        // Remove the marker if it previously was on a panorama
        if (!!this.pano_) {
            this.onRemove();
        }

        // Call method from superclass
        this.setMap(pano);
        this.pano_ = pano;
        this.container_ = container;

        // Fire the onAdd Event manually as soon as the pano is ready
        if (!!pano) {
            var promiseFn = function(resolve) {
                // Poll for panes to become available
                var pollCallback = function() {
                    if (!!this.getPanes()) {
                        window.clearInterval(this.pollId_);
                        this.onAdd();
                        if (resolve) { resolve(this); }
                    }
                };

                this.pollId_ = window.setInterval(pollCallback.bind(this), 10);
            };

            // Best case, the promiseFn can be wrapped in a Promise so the consumer knows when the pano is set
            // Otherwise just call the function immediately
            if (typeof Promise !== 'undefined') {
                return new Promise(promiseFn.bind(this));
            } else {
                promiseFn.call(this);
            }
        }
    };


    /** @param {google.maps.StreetViewPov} position The desired position. */
    PanoMarker.prototype.setPosition = function(position) {
        this.position_ = position;
        this.draw();
    };


    /** @param {google.maps.Size} size The new size. */
    PanoMarker.prototype.setSize = function(size) {
        this.size_ = size;
        if (!!this.marker_) {
            this.marker_.style.width = size.width + 'px';
            this.marker_.style.height = size.height + 'px';
            this.draw();
        }
    };


    /** @param {string} title The new rollover text. */
    PanoMarker.prototype.setTitle = function(title) {
        this.title_ = title;
        if (!!this.marker_) {
            this.marker_.title = title;
        }
    };


    /** @param {boolean} show Whether the marker shall be visible. */
    PanoMarker.prototype.setVisible = function(show) {
        this.visible_ = show;
        if (!!this.marker_) {
            this.marker_.style.display = show ? 'block' : 'none';
        }
    };


    /** @param {number} zIndex The new z-index. */
    PanoMarker.prototype.setZIndex = function(zIndex) {
        this.zIndex_ = zIndex;
        if (!!this.marker_) {
            this.marker_.style.zIndex = zIndex;
        }
    };

    return PanoMarker;
}));


var util = util || {};

// A cross-browser function to capture a mouse position.
function mouseposition(e, dom) {
    var mx, my;
    mx = e.pageX - $(dom).offset().left;
    my = e.pageY - $(dom).offset().top;
    return {'x': parseInt(mx, 10) , 'y': parseInt(my, 10) };
}
util.mouseposition = mouseposition;

// Object prototype
// http://www.smipple.net/snippet/insin/jQuery.fn.disableTextSelection
if (typeof Object.create !== 'function') {
    Object.create = function (o) {
        var F = function () {};
        F.prototype = o;
        return new F();
    };
}

// Trim function
// Based on a code on: http://stackoverflow.com/questions/498970/how-do-i-trim-a-string-in-javascript
if(typeof(String.prototype.trim) === "undefined")
{
    String.prototype.trim = function()
    {
        return String(this).replace(/^\s+|\s+$/g, '');
    };
}

// Based on a snipped posted by Eric Scheid ("ironclad") on November 17, 2000 at:
// http://www.evolt.org/article/Javascript_to_Parse_URLs_in_the_Browser/17/14435/
function getURLParameter(argName) {
    // Get the value of one of the URL parameters. For example, if this were called with the URL
    // http://your.server.name/foo.html?bar=123 then getURLParameter("bar") would return the string "123". If the
    // parameter is not found, this will return an empty string, "".

    var argString = location.search.slice(1).split('&');
    var r = '';
    for (var i = 0; i < argString.length; i++) {
        if (argString[i].slice(0,argString[i].indexOf('=')) == argName) {
            r = argString[i].slice(argString[i].indexOf('=')+1);
            break;
        }
    }
    r = (r.length > 0  ? unescape(r).split(',') : '');
    r = (r.length == 1 ? r[0] : '');
    return r;
}
util.getURLParameter = getURLParameter;

// Converts a blob that we get from `fetch` into base64. Necessary to display images acquired through `fetch`.
function convertBlobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            resolve(reader.result);
        };
        reader.readAsDataURL(blob);
    });
}
util.convertBlobToBase64 = convertBlobToBase64;

// Asynchronously acquire an image using `fetch` and convert it into base64. Returns a promise.
function getImage(imageUrl) {
    return fetch(imageUrl)
        .then(response => {
            if (response.status === 404) throw new Error('Image not found');
            else if (!response.ok) throw new Error('Other network error');
            return response.blob();
        }).then(myBlob => {
            return convertBlobToBase64(myBlob);
        });
}
util.getImage = getImage;

// Array Remove - By John Resig (MIT Licensed)
// http://stackoverflow.com/questions/500606/javascript-array-delete-elements
Array.prototype.remove = function(from, to) {
    // var rest = this.slice((to || from) + 1 || this.length);
    var rest = this.slice(parseInt(to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

// Array min/max
// http://stackoverflow.com/questions/1669190/javascript-min-max-array-values
Array.prototype.max = function() {
    return Math.max.apply(null, this)
};

Array.prototype.min = function() {
    return Math.min.apply(null, this)
};

Array.prototype.sum = function () {
    return this.reduce(function(a, b) { return a + b;});
};

Array.prototype.mean = function () {
    return this.sum() / this.length;
};

/*
 json2.js
 2011-10-19

 Public Domain.

 NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.

 See http://www.JSON.org/js.html
 ...

 Check Douglas Crockford's code for a more recent version of json2.js
 https://github.com/douglascrockford/JSON-js/blob/master/json2.js
 */
if(typeof JSON!=="object"){JSON={}}(function(){"use strict";function f(e){return e<10?"0"+e:e}function quote(e){escapable.lastIndex=0;return escapable.test(e)?'"'+e.replace(escapable,function(e){var t=meta[e];return typeof t==="string"?t:"\\u"+("0000"+e.charCodeAt(0).toString(16)).slice(-4)})+'"':'"'+e+'"'}function str(e,t){var n,r,i,s,o=gap,u,a=t[e];if(a&&typeof a==="object"&&typeof a.toJSON==="function"){a=a.toJSON(e)}if(typeof rep==="function"){a=rep.call(t,e,a)}switch(typeof a){case"string":return quote(a);case"number":return isFinite(a)?String(a):"null";case"boolean":case"null":return String(a);case"object":if(!a){return"null"}gap+=indent;u=[];if(Object.prototype.toString.apply(a)==="[object Array]"){s=a.length;for(n=0;n<s;n+=1){u[n]=str(n,a)||"null"}i=u.length===0?"[]":gap?"[\n"+gap+u.join(",\n"+gap)+"\n"+o+"]":"["+u.join(",")+"]";gap=o;return i}if(rep&&typeof rep==="object"){s=rep.length;for(n=0;n<s;n+=1){if(typeof rep[n]==="string"){r=rep[n];i=str(r,a);if(i){u.push(quote(r)+(gap?": ":":")+i)}}}}else{for(r in a){if(Object.prototype.hasOwnProperty.call(a,r)){i=str(r,a);if(i){u.push(quote(r)+(gap?": ":":")+i)}}}}i=u.length===0?"{}":gap?"{\n"+gap+u.join(",\n"+gap)+"\n"+o+"}":"{"+u.join(",")+"}";gap=o;return i}}if(typeof Date.prototype.toJSON!=="function"){Date.prototype.toJSON=function(e){return isFinite(this.valueOf())?this.getUTCFullYear()+"-"+f(this.getUTCMonth()+1)+"-"+f(this.getUTCDate())+"T"+f(this.getUTCHours())+":"+f(this.getUTCMinutes())+":"+f(this.getUTCSeconds())+"Z":null};String.prototype.toJSON=Number.prototype.toJSON=Boolean.prototype.toJSON=function(e){return this.valueOf()}}var cx=/[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,escapable=/[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,gap,indent,meta={"\b":"\\b","	":"\\t","\n":"\\n","\f":"\\f","\r":"\\r",'"':'\\"',"\\":"\\\\"},rep;if(typeof JSON.stringify!=="function"){JSON.stringify=function(e,t,n){var r;gap="";indent="";if(typeof n==="number"){for(r=0;r<n;r+=1){indent+=" "}}else if(typeof n==="string"){indent=n}rep=t;if(t&&typeof t!=="function"&&(typeof t!=="object"||typeof t.length!=="number")){throw new Error("JSON.stringify")}return str("",{"":e})}}if(typeof JSON.parse!=="function"){JSON.parse=function(text,reviver){function walk(e,t){var n,r,i=e[t];if(i&&typeof i==="object"){for(n in i){if(Object.prototype.hasOwnProperty.call(i,n)){r=walk(i,n);if(r!==undefined){i[n]=r}else{delete i[n]}}}}return reviver.call(e,t,i)}var j;text=String(text);cx.lastIndex=0;if(cx.test(text)){text=text.replace(cx,function(e){return"\\u"+("0000"+e.charCodeAt(0).toString(16)).slice(-4)})}if(/^[\],:{}\s]*$/.test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,"@").replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,"]").replace(/(?:^|:|,)(?:\s*\[)+/g,""))){j=eval("("+text+")");return typeof reviver==="function"?walk({"":j},""):j}throw new SyntaxError("JSON.parse")}}})()


// Get what browser the user is using.
// This code was taken from an answer in the following SO page:
// http://stackoverflow.com/questions/3303858/distinguish-chrome-from-safari-using-jquery-browser
// addendum 6-21-2017: chrome detection now supports iOS devices, added edge recognition
var userAgent = navigator.userAgent.toLowerCase();

// Figure out what browser is being used
jQuery.browser = {
    version: (userAgent.match( /.+(?:rv|it|ra|ie|me)[\/: ]([\d.]+)/ ) || [])[1],
    edge: /edge/.test( userAgent ),
    chrome: /chrome/.test( userAgent ) || /crios/.test( userAgent ),
    safari: /webkit/.test( userAgent ) && !/chrome/.test( userAgent ) && !/crios/.test( userAgent ),
    opera: /opera/.test( userAgent ),
    msie: /msie/.test( userAgent ) && !/opera/.test( userAgent ),
    mozilla: /mozilla/.test( userAgent ) && !/(compatible|webkit)/.test( userAgent )
};

/**
 * This method identifies the type of the user's browser
 *
 * @returns {*}
 */
function getBrowser() {
    // Return a browser name
    var b;
    for (b in $.browser) {
        if($.browser[b] === true) {
            return b;
        }
    }
    return undefined;
}
util.getBrowser = getBrowser;

function getBrowserVersion () {
    // Return a browser version
    return $.browser.version;
}
util.getBrowserVersion = getBrowserVersion;

function getOperatingSystem () {
    var OSName="Unknown OS";
    if (navigator.appVersion.indexOf("Win")!=-1) OSName="Windows";
    if (navigator.appVersion.indexOf("Mac")!=-1) OSName="MacOS";
    if (navigator.appVersion.indexOf("X11")!=-1) OSName="UNIX";
    if (navigator.appVersion.indexOf("Linux")!=-1) OSName="Linux";
    if (navigator.appVersion.indexOf("Android")!=-1) OSName="Android";
    if (navigator.appVersion.indexOf("iPad")!=-1 ||
        navigator.appVersion.indexOf("iPhone")!=-1 ||
        navigator.appVersion.indexOf("iPod")!=-1) OSName="iOS";
    return OSName;
}
util.getOperatingSystem = getOperatingSystem;

// Changes a string in camelCase to kebab-case.
function camelToKebab (theString) {
    return theString.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
util.camelToKebab = camelToKebab;

var util = util || {};

/**
 * Color utilities
 * @constructor
 * @memberof svl
 */
function UtilitiesColor () {
    var self = { className: "UtilitiesColor" };

    function changeAlphaRGBA(rgba, alpha) {
        // This function updates alpha value of the given rgba value. Example: if the input is rgba(200, 200, 200, 0.5)
        // and alpha 0.8, the output will be rgba(200, 200, 200, 0.8).
        var rgbaList = rgba.replace('rgba(','').replace(')','').split(",");
        if (rgbaList.length === 4 && !isNaN(parseInt(alpha))) {
            var newRgba;
            newRgba = 'rgba(' +
                rgbaList[0].trim() + ',' +
                rgbaList[1].trim() + ',' +
                rgbaList[2].trim() + ',' +
                alpha + ')';
            return newRgba;
        } else {
            return rgba;
        }
    }

    /**
     * Converts an RGB color value to HSV. Conversion formula adapted from http://en.wikipedia.org/wiki/HSV_color_space.
     * Assumes r, g, and b are contained in the set [0, 255] and returns h, s, and v in the set [0, 1].
     *
     * @param r
     * @param g
     * @param b
     */
    function rgbToHsv(r, g, b){
        r = r / 255;
        g = g / 255;
        b = b / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var h, s, v = max;

        var d = max - min;
        s = max === 0 ? 0 : d / max;

        if(max == min){
            h = 0; // achromatic
        }else{
            switch(max){
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return [h, s, v];
    }

    /**
     * Converts an HSV color value to RGB. Conversion formula adapted from http://en.wikipedia.org/wiki/HSV_color_space.
     * Assumes h, s, and v are contained in the set [0, 1] and returns r, g, and b in the set [0, 255].
     *
     * @param h
     * @param s
     * @param v
     */
    function hsvToRgb(h, s, v){
        var r, g, b;

        var i = Math.floor(h * 6);
        var f = h * 6 - i;
        var p = v * (1 - s);
        var q = v * (1 - f * s);
        var t = v * (1 - (1 - f) * s);

        switch(i % 6){
            case 0: r = v, g = t, b = p; break;
            case 1: r = q, g = v, b = p; break;
            case 2: r = p, g = v, b = t; break;
            case 3: r = p, g = q, b = v; break;
            case 4: r = t, g = p, b = v; break;
            case 5: r = v, g = p, b = q; break;
        }

        return [r * 255, g * 255, b * 255];
    }

    self.changeAlphaRGBA = changeAlphaRGBA;
    self.rgbToHsv = rgbToHsv;
    self.hsvToRgb = hsvToRgb;

    return self;
}
util.color = UtilitiesColor();

var util = util || {};
util.math = {};

/**
 * This method takes an angle value in radians and returns a value in degrees.
 * http://stackoverflow.com/questions/9705123/how-can-i-get-sin-cos-and-tan-to-return-degrees-instead-of-radians
 * @param angleInRadian
 * @returns {number}
 */
function toDegrees(angleInRadian) { return angleInRadian * (180 / Math.PI); }
util.math.toDegrees = toDegrees;

/**
 * This function takes an angle in degree and returns a value in radian.
 * http://stackoverflow.com/questions/9705123/how-can-i-get-sin-cos-and-tan-to-return-degrees-instead-of-radians
 * @param angleInDegree
 * @returns {number}
 */
function toRadians(angleInDegree) {
    return angleInDegree * (Math.PI / 180);
}
util.math.toRadians = toRadians;

/**
 * This function takes two pairs of latlng positions and returns distance in meters.
 * http://rosettacode.org/wiki/Haversine_formula#JavaScript
 *
 * @param lat1
 * @param lon1
 * @param lat2
 * @param lon2
 * @returns {number} A distance in meters.
 */
function haversine(lat1, lon1, lat2, lon2) {
    lat1 = toRadians(lat1);
    lon1 = toRadians(lon1);
    lat2 = toRadians(lat2);
    lon2 = toRadians(lon2);
    var R = 6372800; // Earth radius in m.
    var dLat = lat2 - lat1;
    var dLon = lon2 - lon1;
    var a = Math.sin(dLat / 2) * Math.sin(dLat /2) + Math.sin(dLon / 2) * Math.sin(dLon /2) * Math.cos(lat1) * Math.cos(lat2);
    var c = 2 * Math.asin(Math.sqrt(a));
    return R * c;
}
util.math.haversine = haversine;

function roundToTwentyFive(num) { return Math.round(num / 25) * 25; }
util.math.roundToTwentyFive = roundToTwentyFive;

function metersToMiles(dist) { return dist / 1609.34; }
function metersToKilometers(dist) { return dist / 1000; }
function metersToFeet(dist) { return dist * 3.28084; }
function milesToMeters(dist) { return dist * 1609.34; }
function milesToKilometers(dist) { return dist * 1.60934; }
function milesToFeet(dist) { return dist * 5280; }
function kilometersToMeters(dist) { return dist * 1000; }
function kilometersToMiles(dist) { return dist / 1.60934; }
function kilometersToFeet(dist) { return dist * 3280.84; }
function feetToMeters(dist) { return dist / 3.28084; }
function feetToMiles(dist) { return dist / 5280; }
function feetToKilometers(dist) { return dist / 3280.84; }
util.math.metersToMiles = metersToMiles;
util.math.metersToKilometers = metersToKilometers;
util.math.metersToFeet = metersToFeet;
util.math.milesToMeters = milesToMeters;
util.math.milesToKilometers = milesToKilometers;
util.math.milesToFeet = milesToFeet;
util.math.kilometersToMeters = kilometersToMeters;
util.math.kilometersToMiles = kilometersToMiles;
util.math.kilometersToFeet = kilometersToFeet;
util.math.feetToMeters = feetToMeters;
util.math.feetToMiles = feetToMiles;
util.math.feetToKilometers = feetToKilometers;

/** @namespace */
var util = util || {};
util.panomarker = {};

/**
 * 3D projection related functions
 *
 * These functions are for positioning the markers when the view is panned.
 * The library used is adapted from: https://martinmatysiak.de/blog/view/panomarker/en
 * The math used is from:
 * http://stackoverflow.com/questions/21591462/get-heading-and-pitch-from-pixels-on-street-view/21753165?noredirect=1#comment72346716_21753165
 */

function get3dFov(zoom) {
    return zoom <= 2 ?
    126.5 - zoom * 36.75 :  // linear descent
    195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
}

/**
 * sgn( a ) is +1 if a >= 0 else -1.
 * @param x
 * @returns {number}
 */
function sgn(x) {
    return x >= 0 ? 1 : -1;
}

/**
 * This method returns the pov of a point on the canvas based on panorama's POV
 * and the canvas coordinate
 *
 * @param canvasX
 * @param canvasY
 * @param pov
 * @returns {{heading: number, pitch: number, zoom: Number}}
 */
function calculatePointPov(canvasX, canvasY, pov) {
    var heading = parseInt(pov.heading, 10),
        pitch = parseInt(pov.pitch, 10),
        zoom = parseInt(pov.zoom, 10);

    var PI = Math.PI;
    var cos = Math.cos;
    var sin = Math.sin;
    var tan = Math.tan;
    var sqrt = Math.sqrt;
    var atan2 = Math.atan2;
    var asin = Math.asin;

    var fov = get3dFov(zoom) * PI / 180.0;
    var width = svl.canvasWidth;
    var height = svl.canvasHeight;

    var h0 = heading * PI / 180.0;
    var p0 = pitch * PI / 180.0;

    var f = 0.5 * width / tan(0.5 * fov);

    var x0 = f * cos(p0) * sin(h0);
    var y0 = f * cos(p0) * cos(h0);
    var z0 = f * sin(p0);

    var du = canvasX - width / 2;
    var dv = height / 2 - canvasY;

    var ux = sgn(cos(p0)) * cos(h0);
    var uy = -sgn(cos(p0)) * sin(h0);
    var uz = 0;

    var vx = -sin(p0) * sin(h0);
    var vy = -sin(p0) * cos(h0);
    var vz = cos(p0);

    var x = x0 + du * ux + dv * vx;
    var y = y0 + du * uy + dv * vy;
    var z = z0 + du * uz + dv * vz;

    var R = sqrt(x * x + y * y + z * z);
    var h = atan2(x, y);
    var p = asin(z / R);

    return {
        heading: h * 180.0 / PI,
        pitch: p * 180.0 / PI,
        zoom: zoom
    };
}
util.panomarker.calculatePointPov = calculatePointPov;

/**
 * Calculate POV
 * This method returns the pov of this label based on panorama's POV using
 * panorama image coordinates
 *
 * @param imageX
 * @param imageY
 * @param pov
 * @returns {{heading: Number, pitch: Number, zoom: Number}}
 */
function calculatePointPovFromImageCoordinate(imageX, imageY, pov) {
    var heading, pitch,
        zoom = parseInt(pov.zoom, 10);

    var zoomFactor = svl.zoomFactor[zoom];
    var svImageWidth = svl.svImageWidth * zoomFactor;
    var svImageHeight = svl.svImageHeight * zoomFactor;

    imageX = imageX * zoomFactor;
    imageY = imageY * zoomFactor;

    heading = parseInt((imageX / svImageWidth) * 360, 10) % 360;
    pitch = parseInt((imageY / (svImageHeight/2)) * 90 , 10);

    return {
        heading: parseInt(heading, 10),
        pitch: parseInt(pitch, 10),
        zoom: zoom
    };
}
util.panomarker.calculatePointPovFromImageCoordinate = calculatePointPovFromImageCoordinate;

/**
 * Calculate Image Coordinate
 * This method returns the GSV image coordinate from the original pov of the label
 *
 * @param pov
 * @returns {{x: (number|*), y: (number|*)}}
 */
function calculateImageCoordinateFromPointPov(pov) {
    var heading = pov.heading,
        pitch = pov.pitch,
        zoom = pov.zoom;

    var imageX, imageY;
    var zoomFactor = svl.zoomFactor[zoom];

    var svImageWidth = svl.svImageWidth * zoomFactor;
    var svImageHeight = svl.svImageHeight * zoomFactor;

    imageX = (svImageWidth * (heading / 360) + ((svImageWidth / 360) / 2)) / zoomFactor;
    imageY = ((svImageHeight / 2) * (pitch / 90)) / zoomFactor;

    return {
        x: imageX,
        y: imageY
    };
}
util.panomarker.calculateImageCoordinateFromPointPov = calculateImageCoordinateFromPointPov;

/**
 * This function maps canvas coordinate to image coordinate
 * @param canvasX
 * @param canvasY
 * @param pov
 * @returns {{x: number, y: number}}
 */
function canvasCoordinateToImageCoordinate(canvasX, canvasY, pov) {

    // Old calculation
    // var zoomFactor = svl.zoomFactor[pov.zoom];
    // var x = svl.svImageWidth * pov.heading / 360 + (svl.alpha_x * (canvasX - (svl.canvasWidth / 2)) / zoomFactor);
    // var y = (svl.svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (canvasY - (svl.canvasHeight / 2)) / zoomFactor);

    var svImageWidth = svl.svImageWidth;
    var pointPOV = calculatePointPov(canvasX, canvasY, pov);
    var svImageCoord = calculateImageCoordinateFromPointPov(pointPOV);

    if (svImageCoord.x < 0) {
        svImageCoord.x = svImageCoord.x + svImageWidth;
    }

    return { x: svImageCoord.x, y: svImageCoord.y };
}
util.panomarker.canvasCoordinateToImageCoordinate = canvasCoordinateToImageCoordinate;

/***
 * Get canvas coordinates of points from the POV
 * @return {Object} Top and Left offsets for the given viewport that point to
 *     the desired point-of-view.
 */
function povToPixel3DOffset(targetPov, currentPov, zoom, viewport) {

    // Gather required variables and convert to radians where necessary
    var width = viewport.offsetWidth;
    var height = viewport.offsetHeight;
    var target = {
        left: width / 2,
        top: height / 2
    };

    var DEG_TO_RAD = Math.PI / 180.0;
    var fov = get3dFov(zoom) * DEG_TO_RAD;
    var h0 = currentPov.heading * DEG_TO_RAD;
    var p0 = currentPov.pitch * DEG_TO_RAD;
    var h = targetPov.heading * DEG_TO_RAD;
    var p = targetPov.pitch * DEG_TO_RAD;

    // f = focal length = distance of current POV to image plane
    var f = (width / 2) / Math.tan(fov / 2);

    // our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0)
    // calculate 3d coordinates of viewport center and target
    var cos_p = Math.cos(p);
    var sin_p = Math.sin(p);

    var cos_h = Math.cos(h);
    var sin_h = Math.sin(h);

    var x = f * cos_p * sin_h;
    var y = f * cos_p * cos_h;
    var z = f * sin_p;

    var cos_p0 = Math.cos(p0);
    var sin_p0 = Math.sin(p0);

    var cos_h0 = Math.cos(h0);
    var sin_h0 = Math.sin(h0);

    var x0 = f * cos_p0 * sin_h0;
    var y0 = f * cos_p0 * cos_h0;
    var z0 = f * sin_p0;

    var nDotD = x0 * x + y0 * y + z0 * z;
    var nDotC = x0 * x0 + y0 * y0 + z0 * z0;

    // nDotD == |targetVec| * |currentVec| * cos(theta)
    // nDotC == |currentVec| * |currentVec| * 1
    // Note: |currentVec| == |targetVec| == f

    // Sanity check: the vectors shouldn't be perpendicular because the line
    // from camera through target would never intersect with the image plane
    if (Math.abs(nDotD) < 1e-6) {
        return null;
    }

    // t is the scale to use for the target vector such that its end
    // touches the image plane. It's equal to 1/cos(theta) ==
    //     (distance from camera to image plane through target) /
    //     (distance from camera to target == f)
    var t = nDotC / nDotD;

    // Sanity check: it doesn't make sense to scale the vector in a negative
    // direction. In fact, it should even be t >= 1.0 since the image plane
    // is always outside the pano sphere (except at the viewport center)
    if (t < 0.0) {
        return null;
    }

    // (tx, ty, tz) are the coordinates of the intersection point between a
    // line through camera and target with the image plane
    var tx = t * x;
    var ty = t * y;
    var tz = t * z;

    // u and v are the basis vectors for the image plane
    var vx = -sin_p0 * sin_h0;
    var vy = -sin_p0 * cos_h0;
    var vz = cos_p0;

    var ux = cos_h0;
    var uy = -sin_h0;
    var uz = 0;

    // normalize horiz. basis vector to obtain orthonormal basis
    var ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;

    // project the intersection point t onto the basis to obtain offsets in
    // terms of actual pixels in the viewport
    var du = tx * ux + ty * uy + tz * uz;
    var dv = tx * vx + ty * vy + tz * vz;

    // use the calculated pixel offsets
    target.left += du;
    target.top -= dv;
    return target;
}

/**
 * This function takes current pov of the Street View as a parameter and returns a canvas coordinate of a point
 * when the pov is changed.
 * If the pov is not changed, then the passed canvas Coordinate is returned
 * @param canvasCoord
 * @param origPov
 * @param canvasCoord
 * @param origPov
 * @param pov
 * @returns {{x, y}}
 */
function getCanvasCoordinate(canvasCoord, origPov, pov) {

    var povChange = svl.map.getPovChangeStatus(),
        povChangeStatus = povChange["status"];

    if (canvasCoord == undefined){
        canvasCoord = {x: undefined, y: undefined};
    }

    if (povChangeStatus){
        var currentPov = pov,
            targetPov = origPov;
        var zoom = currentPov.zoom;
        var viewport = document.getElementById('pano');

        // Calculate the position according to the viewport. Even though the marker
        // doesn't sit directly underneath the panorama container, we pass it on as
        // the viewport because it has the actual viewport dimensions.
        var offset = povToPixel3DOffset(targetPov, currentPov, zoom, viewport);

        if (offset !== null) {
            canvasCoord.x = offset.left; // - origCoord.x;
            canvasCoord.y = offset.top; //- origCoord.y;

        } else {
            // If offset is null, the marker is "behind" the camera,
            // therefore we position the marker outside of the viewport
            var pointWidth = 3; //TODO: Get from Point class
            canvasCoord.x = -(9999 + pointWidth);
            canvasCoord.y = 0;
        }
    }
    return canvasCoord;
}
util.panomarker.getCanvasCoordinate = getCanvasCoordinate;

/** @namespace */
var util = util || {};
util.shape = {};

/**
 *
 * @param ctx
 * @param x1
 * @param y1
 * @param r1
 * @param x2
 * @param y2
 * @param r2
 * @param sourceFormIn
 * @param sourceStrokeStyleIn
 * @param sourceFillStyleIn
 * @param targetFormIn
 * @param targetStrokeStyleIn
 * @param targetFillStyleIn
 */
function lineWithRoundHead (ctx, x1, y1, r1, x2, y2, r2, sourceFormIn, sourceStrokeStyleIn, sourceFillStyleIn, targetFormIn, targetStrokeStyleIn, targetFillStyleIn) {
    var sourceForm = 'none';
    var targetForm = 'none';
    var sourceStrokeStyle = sourceStrokeStyleIn ? sourceStrokeStyleIn : 'rgba(255,255,255,1)';
    var sourceFillStyle = 'rgba(255,255,255,1)';
    var targetStrokeStyle = 'rgba(255,255,255,1)';
    var targetFillStyle = 'rgba(255,255,255,1)';
    if (sourceFormIn) {
        if (sourceFormIn !== 'none' &&
            sourceFormIn !== 'stroke' &&
            sourceFormIn !== 'fill' &&
            sourceFormIn !== 'both') {
            throw 'lineWithRoundHead(): ' + sourceFormIn + ' is not a valid input.';
        }
        sourceForm = sourceFormIn;
    }
    if (targetFormIn) {
        if (targetFormIn !== 'none' &&
            targetFormIn !== 'stroke' &&
            targetFormIn !== 'fill' &&
            targetFormIn !== 'both') {
            throw 'lineWithRoundHead(): ' + targetFormIn + ' is not a valid input.';
        }
        targetForm = targetFormIn;
    }
    if (sourceStrokeStyleIn) {
        sourceStrokeStyle = sourceStrokeStyleIn;
    }
    if (sourceFillStyleIn) {
        sourceFillStyle = sourceFillStyleIn;
    }
    if (targetStrokeStyleIn) {
        targetStrokeStyle = targetStrokeStyleIn;
    }
    if (targetFillStyleIn) {
        targetFillStyle = targetFillStyleIn;
    }

    var theta = Math.atan2(y2 - y1, x2 - x1);
    var lineXStart = x1 + r1 * Math.cos(theta);
    var lineYStart = y1 + r1 * Math.sin(theta);
    var lineXEnd =  x2 - r2 * Math.cos(theta);
    var lineYEnd = y2 - r2 * Math.sin(theta);

    ctx.save();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lineXStart, lineYStart);
    ctx.lineTo(lineXEnd, lineYEnd);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();

    if (sourceForm !== 'none') {
        ctx.save();
        ctx.fillStyle = sourceFillStyle;
        ctx.strokeStyle = sourceStrokeStyle;
        ctx.beginPath();
        ctx.arc(x1, y1, r1, 0, 2 * Math.PI, true);
        if (sourceForm === 'stroke') {
            ctx.stroke();
        } else if (sourceForm === 'fill') {
            ctx.fill();
        } else if (sourceForm === 'both') {
            ctx.fill();
            ctx.stroke();
        }
        ctx.closePath();
        ctx.restore();
    }
    if (targetForm !== 'none') {
        ctx.save();
        ctx.fillStyle = targetFillStyle;
        ctx.strokeStyle = targetStrokeStyle;
        ctx.beginPath();
        ctx.arc(x2, y2, r2, 0, 2 * Math.PI, true);
        if (targetForm === 'stroke') {
            ctx.stroke();
        } else if (targetForm === 'fill') {
            ctx.fill();
        } else if (targetForm === 'both') {
            ctx.fill();
            ctx.stroke();
        }
        ctx.closePath();
        ctx.restore();
    }
}
util.shape.lineWithRoundHead = lineWithRoundHead;

var util = util || {};
util.misc = util.misc || {};

function UtilitiesMisc (JSON) {
    var self = { className: "UtilitiesMisc" };

    // Returns image paths corresponding to each label type.
    function getIconImagePaths(category) {
        var imagePaths = {
            Walk : {
                id : 'Walk',
                iconImagePath : null,
                minimapIconImagePath: null
            },
            CurbRamp: {
                id: 'CurbRamp',
                iconImagePath : svl.rootDirectory + 'img/icons/CurbRamp_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/CurbRamp_tiny.png'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                iconImagePath : svl.rootDirectory + 'img/icons/NoCurbRamp_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/NoCurbRamp_tiny.png'
            },
            Obstacle: {
                id: 'Obstacle',
                iconImagePath: svl.rootDirectory + 'img/icons/Obstacle_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Obstacle_tiny.png'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                iconImagePath: svl.rootDirectory + 'img/icons/SurfaceProblem_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/SurfaceProblem_tiny.png'
            },
            Other: {
                id: 'Other',
                iconImagePath: svl.rootDirectory + 'img/icons/Other_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Other_tiny.png'
            },
            Occlusion: {
                id: 'Occlusion',
                iconImagePath: svl.rootDirectory + 'img/icons/Occlusion_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Occlusion_tiny.png'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                iconImagePath: svl.rootDirectory + 'img/icons/NoSidewalk_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/NoSidewalk_tiny.png'
            },
            Crosswalk: {
                id: 'Crosswalk',
                iconImagePath: svl.rootDirectory + 'img/icons/Crosswalk_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Crosswalk_tiny.png'
            },
            Signal: {
                id: 'Signal',
                iconImagePath: svl.rootDirectory + 'img/icons/Signal_small.png',
                minimapIconImagePath: svl.rootDirectory + 'img/icons/Signal_tiny.png'
            }
        };

        return category ? imagePaths[category] : imagePaths;
    }

    function getLabelDescriptions(category) {
        var descriptions = {
            'Walk': {
                'id': 'Walk',
                'text': 'Walk',
                keyChar: 'E'
            },
            CurbRamp: {
                id: 'CurbRamp',
                text: 'Curb Ramp',
                keyChar: 'C',
                tagInfo: {
                    'narrow': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.narrow')
                    },
                    'points into traffic': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.points-into-traffic')
                    },
                    'missing tactile warning': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.missing-tactile-warning')
                    },
                    'tactile warning': {
                        keyChar: 'H',
                        text: i18next.t('center-ui.context-menu.tag.tactile-warning')
                    },
                    'steep': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.steep')
                    },
                    'not enough landing space': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.not-enough-landing-space')
                    },
                    'not level with street': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.not-level-with-street')
                    },
                    'surface problem': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.surface-problem')
                    },
                    'pooled water': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.pooled-water')
                    }
                }
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                text: 'Missing Curb Ramp',
                keyChar: 'M',
                tagInfo: {
                    'alternate route present': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.alternate-route-present')
                    },
                    'no alternate route': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.no-alternate-route')
                    },
                    'unclear if needed': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.unclear-if-needed')
                    }
                }
            },
            Obstacle: {
                id: 'Obstacle',
                text: 'Obstacle in Path',
                keyChar: 'O',
                tagInfo: {
                    'trash/recycling can': {
                        keyChar: 'H',
                        text: i18next.t('center-ui.context-menu.tag.trash-recycling-can')
                    },
                    'fire hydrant': {
                        keyChar: 'F',
                        text: i18next.t('center-ui.context-menu.tag.fire-hydrant')
                    },
                    'pole': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.pole')
                    },
                    'tree': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.tree')
                    },
                    'vegetation': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.vegetation')
                    },
                    'parked car': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.parked-car')
                    },
                    'parked bike': {
                        keyChar: 'K',
                        text: i18next.t('center-ui.context-menu.tag.parked-bike')
                    },
                    'construction': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.construction')
                    },
                    'sign': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.sign')
                    },
                    'garage entrance': {
                        keyChar: 'G',
                        text: i18next.t('center-ui.context-menu.tag.garage-entrance')
                    },
                    'stairs': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.stairs')
                    },
                    'street vendor': {
                        keyChar: 'J',
                        text: i18next.t('center-ui.context-menu.tag.street-vendor')
                    },
                    'height difference': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.height-difference')
                    },
                    'narrow': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.narrow')
                    },
                    'litter/garbage': {
                        keyChar: 'X',
                        text: i18next.t('center-ui.context-menu.tag.litter-garbage')
                    },
                    'parked scooter/motorcycle': {
                        keyChar: 'Y',
                        text: i18next.t('center-ui.context-menu.tag.parked-scooter-motorcycle')
                    }
                }
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                text: 'Surface Problem',
                keyChar: 'S',
                tagInfo: {
                    'bumpy': {
                        keyChar: 'Y',
                        text: i18next.t('center-ui.context-menu.tag.bumpy')
                    },
                    'uneven/slanted': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.uneven-slanted')
                    },
                    'cracks': {
                        keyChar: 'K',
                        text: i18next.t('center-ui.context-menu.tag.cracks')
                    },
                    'grass': {
                        keyChar: 'G',
                        text: i18next.t('center-ui.context-menu.tag.grass')
                    },
                    'narrow sidewalk': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.narrow')
                    },
                    'brick/cobblestone': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.brick-cobblestone')
                    },
                    'construction': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.construction')
                    },
                    'very broken': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.very-broken')
                    },
                    'height difference': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.height-difference')
                    },
                    'rail/tram track': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.rail-tram-track')
                    },
                    'sand/gravel': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.sand-gravel')
                    },
                    'uncovered manhole': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.uncovered-manhole')
                    }
                }
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                text: 'No Sidewalk',
                keyChar: 'N',
                tagInfo: {
                    'ends abruptly': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.ends-abruptly')
                    },
                    'street has a sidewalk': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.street-has-a-sidewalk')
                    },
                    'street has no sidewalks': {
                        keyChar: 'T',
                        text: i18next.t('center-ui.context-menu.tag.street-has-no-sidewalks')
                    },
                    'gravel/dirt road': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.gravel-dirt-road')
                    },
                    'shared pedestrian/car space': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.shared-pedestrian-car-space')
                    }
                }
            },
            Crosswalk: {
                id: 'Crosswalk',
                text: 'Crosswalk',
                keyChar: 'W',
                tagInfo: {
                    'paint fading': {
                        keyChar: 'F',
                        text: i18next.t('center-ui.context-menu.tag.paint-fading')
                    },
                    'broken surface': {
                        keyChar: 'R',
                        text: i18next.t('center-ui.context-menu.tag.broken-surface')
                    },
                    'uneven surface': {
                        keyChar: 'E',
                        text: i18next.t('center-ui.context-menu.tag.uneven-surface')
                    },
                    'brick/cobblestone': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.brick-cobblestone')
                    },
                    'bumpy': {
                        keyChar: 'Y',
                        text: i18next.t('center-ui.context-menu.tag.bumpy')
                    },
                    'rail/tram track': {
                        keyChar: 'L',
                        text: i18next.t('center-ui.context-menu.tag.rail-tram-track')
                    },
                    'no pedestrian priority': {
                        keyChar: 'V',
                        text: i18next.t('center-ui.context-menu.tag.no-pedestrian-priority')
                    },
                    'very long crossing': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.very-long-crossing')
                    },
                    'level with sidewalk': {
                        keyChar: 'D',
                        text: i18next.t('center-ui.context-menu.tag.level-with-sidewalk')
                    }
                }
            },
            Signal: {
                id: 'Signal',
                text: 'Pedestrian Signal',
                keyChar: 'P',
                tagInfo: {
                    'has button': {
                        keyChar: 'U',
                        text: i18next.t('center-ui.context-menu.tag.has-button')
                    },
                    'button waist height': {
                        keyChar: 'H',
                        text: i18next.t('center-ui.context-menu.tag.button-waist-height')
                    },
                    'APS': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.APS')
                    }
                }
            },
            Other: {
                id: 'Other',
                text: 'Other',
                tagInfo: {
                    'missing crosswalk': {
                        keyChar: 'I',
                        text: i18next.t('center-ui.context-menu.tag.missing-crosswalk')
                    },
                    'no bus stop access': {
                        keyChar: 'A',
                        text: i18next.t('center-ui.context-menu.tag.no-bus-stop-access')
                    }
                }
            },
            Occlusion: {
                id: 'Occlusion',
                text: "Can't see the sidewalk",
                keyChar: 'B'
            }
        };
        return category ? descriptions[category] : descriptions;
    }

    /**
     * Gets the severity message and severity image location that is displayed on a label tag.
     * @returns {{1: {message: string, severityImage: string}, 2: {message: string, severityImage: string},
     *              3: {message: string, severityImage: string}, 4: {message: string, severityImage: string},
     *              5: {message: string, severityImage: string}}}
     */
    function getSeverityDescription() {
        return {
            1: {
                message: i18next.t('center-ui.context-menu.tooltip.passable'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_1_White_Small.png'
            },

            2: {
                message: i18next.t('center-ui.context-menu.tooltip.somewhat-passable'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_2_White_Small.png'
            },

            3: {
                message: i18next.t('center-ui.context-menu.tooltip.difficult-to-pass'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_3_White_Small.png'
            },

            4: {
                message: i18next.t('center-ui.context-menu.tooltip.very-difficult-to-pass'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_4_White_Small.png'
            },

            5: {
                message: i18next.t('center-ui.context-menu.tooltip.not-passable'),
                severityImage: svl.rootDirectory + 'img/misc/SmileyScale_5_White_Small.png'
            }
        };
    }

    /**
     * References: Ajax without jQuery.
     * http://stackoverflow.com/questions/8567114/how-to-make-an-ajax-call-without-jquery
     * http://stackoverflow.com/questions/6418220/javascript-send-json-object-with-ajax
     * @param streetEdgeId
     */
    function reportNoStreetView(streetEdgeId) {
        var x = new XMLHttpRequest(), async = true, url = "/audit/nostreetview";
        x.open('POST', url, async);
        x.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        x.send(JSON.stringify({issue: "NoStreetView", street_edge_id: streetEdgeId}));
    }

    const colors = {
        Walk : {
            id : 'Walk',
            fillStyle : 'rgba(0, 0, 0, 1)',
            strokeStyle: '#FFFFFF'
        },
        CurbRamp: {
            id: 'CurbRamp',
            fillStyle: '#90C31F',
            strokeStyle: '#FFFFFF'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            fillStyle: '#E679B6',
            strokeStyle: '#FFFFFF'
        },
        Obstacle: {
            id: 'Obstacle',
            fillStyle: '#78B0EA',
            strokeStyle: '#FFFFFF'
        },
        Other: {
            id: 'Other',
            fillStyle: '#B3B3B3',
            strokeStyle: '#0000FF'
        },
        Occlusion: {
            id: 'Occlusion',
            fillStyle: '#B3B3B3',
            strokeStyle: '#009902'
        },
        NoSidewalk: {
            id: 'NoSidewalk',
            fillStyle: '#BE87D8',
            strokeStyle: '#FFFFFF'
        },
        SurfaceProblem: {
            id: 'SurfaceProblem',
            fillStyle: '#F68D3E',
            strokeStyle: '#FFFFFF'
        },
        Crosswalk: {
            id: 'Crosswalk',
            fillStyle: '#FABF1C',
            strokeStyle: '#FFFFFF'
        },
        Signal: {
            id: 'Signal',
            fillStyle: '#63C0AB',
            strokeStyle: '#FFFFFF'
        }
    };
    function getLabelColors(category) {
        return category ? colors[category].fillStyle : colors;
    }

    self.getIconImagePaths = getIconImagePaths;
    self.getLabelDescriptions = getLabelDescriptions;
    self.getSeverityDescription = getSeverityDescription;
    self.getLabelColors = getLabelColors;
    self.reportNoStreetView = reportNoStreetView;

    return self;
}

util.misc = UtilitiesMisc(JSON);

/**
 * Displays info about the current GSV pane.
 *
 * @param {HTMLElement} container Element where the info button will be displayed
 * @param {StreetViewPanorama} panorama Panorama object
 * @param {function} coords Function that returns current longitude and latitude coordinates
 * @param {function} panoId Function that returns current panorama ID
 * @param {function} streetEdgeId Function that returns current Street Edge ID
 * @param {function} regionId Function that returns current Region ID
 * @param {function} pov Function that returns current POV
 * @param {Boolean} whiteIcon Set to true if using white icon, false if using blue icon.
 * @param {function} infoLogging Function that adds the info button click to the appropriate logs.
 * @param {function} clipboardLogging Function that adds the copy to clipboard click to the appropriate logs.
 * @param {function} viewGSVLogging Function that adds the View in GSV click to the appropriate logs.
 * @param {function} [labelId] Optional function that returns the Label ID.
 * @returns {GSVInfoPopover} Popover object, which holds the popover title html, content html, info button html, and
 * update values method
 */
function GSVInfoPopover (container, panorama, coords, panoId, streetEdgeId, regionId, pov, whiteIcon, infoLogging, clipboardLogging, viewGSVLogging, labelId) {
    let self = this;

    function _init() {
        // Create popover title bar.
        self.titleBox = document.createElement('div');

        let title = document.createElement('span');
        title.classList.add('popover-element');
        title.textContent = i18next.t('common:gsv-info.details-title');
        self.titleBox.appendChild(title);

        let clipboard = document.createElement('img');
        clipboard.classList.add('popover-element');
        clipboard.src = '/assets/images/icons/clipboard_copy.png';
        clipboard.id = 'clipboard';
        clipboard.setAttribute('data-toggle', 'popover');

        self.titleBox.appendChild(clipboard);

        // Create popover content.
        self.popoverContent = document.createElement('div');

        // Add in container for each info type to the popover.
        let dataList = document.createElement('ul');
        dataList.classList.add('list-group', 'list-group-flush', 'gsv-info-list-group');

        addListElement('latitude', dataList);
        addListElement('longitude', dataList);
        addListElement('panorama-id', dataList);
        addListElement('street-id', dataList);
        addListElement('region-id', dataList);
        if (labelId) addListElement('label-id', dataList);

        self.popoverContent.appendChild(dataList);

        // Create element for a link to GSV in a separate tab.
        let linkGSV = document.createElement('a');
        linkGSV.classList.add('popover-element');
        linkGSV.id = 'gsv-link'
        linkGSV.textContent = i18next.t('common:gsv-info.view-in-gsv');
        self.popoverContent.appendChild(linkGSV);

        // Create info button and add popover attributes.
        self.infoButton = document.createElement('img');
        self.infoButton.classList.add('popover-element');
        self.infoButton.id = 'gsv-info-button';
        if (whiteIcon) self.infoButton.src = '/assets/images/icons/gsv_info_btn_white.svg';
        else self.infoButton.src = '/assets/images/icons/gsv_info_btn.png';
        self.infoButton.setAttribute('data-toggle', 'popover');

        container.append(self.infoButton);

        // Enable popovers/tooltips and set options.
        $('#gsv-info-button').popover({
            html: true,
            placement: 'top',
            container: 'body',
            title: self.titleBox.innerHTML,
            content: self.popoverContent.innerHTML
        }).on('click', updateVals).on('shown.bs.popover', () => {
            // Add popover-element classes to more elements, making it easier to dismiss popover on when outside it.
            $('.popover-title').addClass('popover-element');
            $('.popover-content').addClass('popover-element');

            // Initialize the popover for the clipboard.
            $('#clipboard').popover({
                placement: 'top',
                trigger: 'manual',
                html: true,
                content: `<span class="clipboard-tooltip">${i18next.t('common:gsv-info.copied-to-clipboard')}</span>`
            });
        });

        // Dismiss popover when clicking outside it. Anything without the 'popover-element' class is considered outside.
        $(document).on('mousedown', (e) => {
            let tar = $(e.target);
            if (!tar[0].classList.contains('popover-element')) {
                $('#gsv-info-button').popover('hide');
            }
        });
        // Dismiss popover whenever panorama changes.
        panorama.addListener('pano_changed', () => {
            $('#gsv-info-button').popover('hide');
        })
    }

    /**
     * Update the values within the popover.
     */
    function updateVals() {
        // Log the click on the info button.
        infoLogging();

        // Get info values.
        const currCoords = coords ? coords() : {lat: null, lng: null};
        const currPanoId = panoId ? panoId() : null;
        const currStreetEdgeId = streetEdgeId ? streetEdgeId() : null;
        const currRegionId = regionId ? regionId() : null;
        const currPov = pov ? pov() : {heading: 0, pitch: 0};
        const currLabelId = labelId ? labelId() : null;

        function changeVals(key, val) {
            if (!val) {
                val = 'No Info';
            } else if (key === "latitude" || key === 'longitude') {
                val = val.toFixed(8) + '°';
            }
            let valSpan = document.getElementById(`${key}-value`);
            valSpan.textContent = val;
        }
        changeVals('latitude', currCoords.lat);
        changeVals('longitude', currCoords.lng);
        changeVals('panorama-id', currPanoId);
        changeVals('street-id', currStreetEdgeId);
        changeVals('region-id', currRegionId);
        if (currLabelId) changeVals('label-id', currLabelId);

        // Create GSV link and log the click.
        let gsvLink = $('#gsv-link');
        gsvLink.attr('href', `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${currCoords.lat}%2C${currCoords.lng}&heading=${currPov.heading}&pitch=${currPov.pitch}`);
        gsvLink.attr('target', '_blank');
        gsvLink.on('click', viewGSVLogging);

        // Position popover.
        let infoPopover = $('.popover');
        let infoRect = self.infoButton.getBoundingClientRect();
        let xpos = infoRect.x + (infoRect.width / 2) - (infoPopover.width() / 2);
        infoPopover.css('left', `${xpos}px`);

        // Copy to clipboard.
        $('#clipboard').on('click', function(e) {
            // Log the click on the copy to keyboard button.
            clipboardLogging();

            let clipboardText = `${i18next.t(`common:gsv-info.latitude`)}: ${currCoords.lat}°\n` +
                `${i18next.t(`common:gsv-info.longitude`)}: ${currCoords.lng}°\n` +
                `${i18next.t(`common:gsv-info.panorama-id`)}: ${currPanoId}\n` +
                `${i18next.t(`common:gsv-info.street-id`)}: ${currStreetEdgeId}\n` +
                `${i18next.t(`common:gsv-info.region-id`)}: ${currRegionId}\n`;
            if (currLabelId) clipboardText += `${i18next.t(`common:gsv-info.label-id`)}: ${currLabelId}`;
            navigator.clipboard.writeText(clipboardText);

            // The clipboard popover will only show one time until you close and reopen the info button popover. I have
            // no idea why that's happening, but for some reason it works if you put it in a setTimeout. So I have a one
            // ms delay before showing the popover. Then it disappears after 1.5 seconds.
            setTimeout(function() {
                $(e.target).popover('show');
                setTimeout(function() {
                    $(e.target).popover('hide');
                }, 1500);
            }, 1);
        });
    }

    /**
     * Creates a key-value pair display within the popover.
     * @param {String} key Key name of the key-value pair
     * @param {HTMLElement} dataList List element container to add list item to
     */
    function addListElement(key, dataList) {
        let listElement = document.createElement('li');
        listElement.classList.add('list-group-item', 'info-list-item', 'popover-element', 'audit-selectable');

        let keySpan = document.createElement('span');
        keySpan.classList.add('info-key', 'popover-element');
        keySpan.textContent = i18next.t(`common:gsv-info.${key}`);
        listElement.appendChild(keySpan);

        let valSpan = document.createElement('span');
        valSpan.classList.add('info-val', 'popover-element');
        valSpan.textContent = '-';
        valSpan.id = `${key}-value`

        listElement.appendChild(valSpan);
        dataList.appendChild(listElement);
    }

    _init();

    self.updateVals = updateVals;

    return self;
}
