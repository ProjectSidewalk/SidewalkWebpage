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
            var currTaskId = currTask.getProperty('auditTaskId');
            if (!currTaskId) currTask.setProperty("auditTaskId", params.mission.current_audit_task_id);
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
                $("#mini-footer-audit").css("visibility", "hidden");
                startOnboarding();
            } else {
                _calculateAndSetTasksMissionsOffset();
                var currentNeighborhood = svl.neighborhoodContainer.getStatus("currentNeighborhood");
                $("#mini-footer-audit").css("visibility", "visible");

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
