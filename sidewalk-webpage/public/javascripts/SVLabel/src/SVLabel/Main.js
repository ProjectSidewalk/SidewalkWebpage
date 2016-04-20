/** @namespace */
var svl = svl || {};

/**
 * The main module of SVLabel
 * @param $: jQuery object
 * @param params: other parameters
 * @returns {{moduleName: string}}
 * @constructor
 * @memberof svl
 */
function Main ($, d3, turf, params) {
    var self = { className: 'Main' };
    var status = {
        isFirstTask: false
    };
    svl.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';

    /**
     * Store jQuery DOM elements under svl.ui
     * @private
     */
    function _initUI () {
        svl.ui = {};
        svl.ui.actionStack = {};
        svl.ui.actionStack.holder = $("#action-stack-control-holder");
        svl.ui.actionStack.holder.append('<button id="undo-button" class="button action-stack-button" value="Undo"><img src="' + svl.rootDirectory + 'img/icons/Icon_Undo.png" class="action-stack-icons" alt="Undo" /><br /><small>Undo</small></button>');
        svl.ui.actionStack.holder.append('<button id="redo-button" class="button action-stack-button" value="Redo"><img src="' + svl.rootDirectory + 'img/icons/Icon_Redo.png" class="action-stack-icons" alt="Redo" /><br /><small>Redo</small></button>');
        svl.ui.actionStack.redo = $("#redo-button");
        svl.ui.actionStack.undo = $("#undo-button");

        svl.ui.counterHolder = $("#counter-holder");
        svl.ui.labelCounter = $("#label-counter");

        // Map DOMs
        svl.ui.map = {};
        svl.ui.map.canvas = $("canvas#labelCanvas");
        svl.ui.map.drawingLayer = $("div#labelDrawingLayer");
        svl.ui.map.pano = $("div#pano");
        svl.ui.map.streetViewHolder = $("div#streetViewHolder");
        svl.ui.map.viewControlLayer = $("div#viewControlLayer");
        svl.ui.map.modeSwitchWalk = $("span#modeSwitchWalk");
        svl.ui.map.modeSwitchDraw = $("span#modeSwitchDraw");
        svl.ui.googleMaps = {};
        svl.ui.googleMaps.holder = $("#google-maps-holder");
        svl.ui.googleMaps.overlay = $("#google-maps-overlay");

        // Status holder
        svl.ui.status = {};
        svl.ui.status.holder = $("#status-holder");

        // MissionDescription DOMs
        svl.ui.statusMessage = {};
        svl.ui.statusMessage.holder = $("#current-status-holder");
        svl.ui.statusMessage.title = $("#current-status-title");
        svl.ui.statusMessage.description = $("#current-status-description");

        // OverlayMessage
        svl.ui.overlayMessage = {};
        svl.ui.overlayMessage.holder = $("#overlay-message-holder");
        svl.ui.overlayMessage.holder.append("<span id='overlay-message-box'><span id='overlay-message'>Walk</span></span>");
        svl.ui.overlayMessage.box = $("#overlay-message-box");
        svl.ui.overlayMessage.message = $("#overlay-message");

        // Pop up message
        svl.ui.popUpMessage = {};
        svl.ui.popUpMessage.holder = $("#pop-up-message-holder");
        svl.ui.popUpMessage.box = $("#pop-up-message-box");
        svl.ui.popUpMessage.background = $("#pop-up-message-background");
        svl.ui.popUpMessage.title = $("#pop-up-message-title");
        svl.ui.popUpMessage.content = $("#pop-up-message-content");

        // Progress
        svl.ui.progress = {};
        svl.ui.progress.auditedDistance = $("#status-audited-distance");

        // ProgressPov
        svl.ui.progressPov = {};
        svl.ui.progressPov.holder = $("#progress-pov-holder");
        svl.ui.progressPov.rate = $("#progress-pov-current-completion-rate");
        svl.ui.progressPov.bar = $("#progress-pov-current-completion-bar");
        svl.ui.progressPov.filler = $("#progress-pov-current-completion-bar-filler");

        // Ribbon menu DOMs
        svl.ui.ribbonMenu = {};
        svl.ui.ribbonMenu.holder = $("#ribbon-menu-landmark-button-holder");
        svl.ui.ribbonMenu.streetViewHolder = $("#street-view-holder");
        svl.ui.ribbonMenu.buttons = $('span.modeSwitch');
        svl.ui.ribbonMenu.bottonBottomBorders = $(".ribbon-menu-mode-switch-horizontal-line");
        svl.ui.ribbonMenu.connector = $("#ribbon-street-view-connector");
        svl.ui.ribbonMenu.subcategoryHolder = $("#ribbon-menu-other-subcategory-holder");
        svl.ui.ribbonMenu.subcategories = $(".ribbon-menu-other-subcategories");
        svl.ui.ribbonMenu.informationButtons = $(".ribbon-mode-switch-info-buttons");

        // Context menu
        svl.ui.contextMenu = {};
        svl.ui.contextMenu.holder = $("#context-menu-holder");
        svl.ui.contextMenu.connector = $("#context-menu-vertical-connector");
        svl.ui.contextMenu.radioButtons = $("input[name='problem-severity']");
        svl.ui.contextMenu.temporaryProblemCheckbox = $("#context-menu-temporary-problem-checkbox");
        svl.ui.contextMenu.textBox = $("#context-menu-problem-description-text-box");
        svl.ui.contextMenu.closeButton = $("#context-menu-close-button");

        // Modal
        svl.ui.modalSkip = {};
        svl.ui.modalSkip.holder = $("#modal-skip-holder");
        svl.ui.modalSkip.ok = $("#modal-skip-ok-button");
        svl.ui.modalSkip.cancel = $("#modal-skip-cancel-button");
        svl.ui.modalSkip.radioButtons = $(".modal-skip-radio-buttons");
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

        // Mission
        svl.ui.modalMission = {};
        svl.ui.modalMission.holder = $("#modal-mission-holder");
        svl.ui.modalMission.box = $("#modal-mission-box");

        // Zoom control
        svl.ui.zoomControl = {};
        svl.ui.zoomControl.holder = $("#zoom-control-holder");
        svl.ui.zoomControl.holder.append('<button id="zoom-in-button" class="button zoom-control-button"><img src="' + svl.rootDirectory + 'img/icons/ZoomIn.svg" class="zoom-button-icon" alt="Zoom in"><br /><u>Z</u>oom In</button>');
        svl.ui.zoomControl.holder.append('<button id="zoom-out-button" class="button zoom-control-button"><img src="' + svl.rootDirectory + 'img/icons/ZoomOut.svg" class="zoom-button-icon" alt="Zoom out"><br />Zoom Out</button>');
        svl.ui.zoomControl.zoomIn = $("#zoom-in-button");
        svl.ui.zoomControl.zoomOut = $("#zoom-out-button");

        // Form
        svl.ui.form = {};
        svl.ui.form.holder = $("#form-holder");
        svl.ui.form.commentField = $("#comment-field");
        svl.ui.form.skipButton = $("#skip-button");
        svl.ui.form.submitButton = $("#submit-button");

        svl.ui.leftColumn = {};
        svl.ui.leftColumn.sound = $("#left-column-sound-button");
        svl.ui.leftColumn.muteIcon = $("#left-column-mute-icon");
        svl.ui.leftColumn.soundIcon = $("#left-column-sound-icon");
        svl.ui.leftColumn.jump = $("#left-column-jump-button");
        svl.ui.leftColumn.feedback = $("#left-column-feedback-button");

        // Navigation compass
        svl.ui.compass = {};
        svl.ui.compass.messageHolder = $("#compass-message-holder");
        svl.ui.compass.message = $("#compass-message");

        // Canvas for the labeling area
        svl.ui.canvas = {};
        svl.ui.canvas.drawingLayer = $("#labelDrawingLayer");
        svl.ui.canvas.deleteIconHolder = $("#delete-icon-holder");
        svl.ui.canvas.deleteIcon = $("#LabelDeleteIcon");

        // Interaction viewer
        svl.ui.tracker = {};
        svl.ui.tracker.itemHolder = $("#tracked-items-holder");

        svl.ui.task = {};
        svl.ui.task.taskCompletionMessage = $("#task-completion-message-holder");

        svl.ui.onboarding = {};
        svl.ui.onboarding.holder = $("#onboarding-holder");
        svl.ui.onboarding.messageHolder = $("#onboarding-message-holder");
        svl.ui.onboarding.background = $("#onboarding-background");
        svl.ui.onboarding.foreground = $("#onboarding-foreground");
        svl.ui.onboarding.canvas = $("#onboarding-canvas");
        svl.ui.onboarding.handGestureHolder = $("#hand-gesture-holder");
    }

    function _init (params) {
        var params = params || {};
        var panoId = params.panoId;
        var SVLat = parseFloat(params.initLat), SVLng = parseFloat(params.initLng);

        // Instantiate objects
        if (!("storage" in svl)) svl.storage = new Storage(JSON);
        svl.labelContainer = LabelContainer();
        svl.keyboard = Keyboard($);
        svl.canvas = Canvas($);
        svl.form = Form($, params.form);
        svl.overlayMessageBox = OverlayMessageBox($);
        svl.statusField = StatusField();
        svl.labelCounter = LabelCounter(d3);
        svl.actionStack = ActionStack();
        svl.ribbon = RibbonMenu($);  // svl.ribbon.stopBlinking()
        svl.popUpMessage = PopUpMessage($);
        svl.zoomControl = ZoomControl($);
        svl.missionProgress = MissionProgress($);
        svl.pointCloud = new PointCloud($, { panoIds: [panoId] });
        svl.tracker = Tracker();
        // svl.trackerViewer = TrackerViewer();
        svl.labelFactory = LabelFactory();
        svl.compass = Compass(d3, turf);
        svl.contextMenu = ContextMenu($);
        svl.audioEffect = AudioEffect();
        svl.modalSkip = ModalSkip($);
        svl.modalComment = ModalComment($);
        svl.modalMission = ModalMission($);
        svl.modalExample = ModalExample();

        var neighborhood;
        svl.neighborhoodFactory = NeighborhoodFactory();
        svl.neighborhoodContainer = NeighborhoodContainer();
        if ('regionId' in params) {
            neighborhood = svl.neighborhoodFactory.create(params.regionId);
            svl.neighborhoodContainer.add(neighborhood);
            svl.neighborhoodContainer.setCurrentNeighborhood(neighborhood);
        } else {
            var regionId = 0;
            neighborhood = svl.neighborhoodFactory.create(regionId);
            svl.neighborhoodContainer.add(neighborhood);
            svl.neighborhoodContainer.setCurrentNeighborhood(neighborhood);
        }

        if (!("taskFactory" in svl && svl.taskFactory)) svl.taskFactory = TaskFactory(turf);
        if (!("taskContainer" in svl && svl.taskContainer)) svl.taskContainer = TaskContainer(turf);

        //
        var taskLoadComplete = false, missionLoadComplete = false;
        function handleDataLoadComplete () {
            if (taskLoadComplete && missionLoadComplete) {
                // Do stuff
                svl.missionProgress.update();
            }
        }

        svl.taskContainer.requestTasksInARegion(neighborhood.getProperty("regionId"), function () {
            taskLoadComplete = true;
            handleDataLoadComplete();
        });

        svl.missionContainer = MissionContainer ($, {
            callback: function () {
                // Check if the user has completed the onboarding tutorial.
                // If not, let them work on the the tutorial.
                var completedMissions = svl.missionContainer.getCompletedMissions(),
                    missionLabels = completedMissions.map(function (m) { return m.label; }),
                    neighborhood = svl.neighborhoodContainer.getStatus("currentNeighborhood"),
                    mission;
                
                // Set the current mission to onboarding or something else.
                if (missionLabels.indexOf("onboarding") < 0 && !svl.storage.get("completedOnboarding")) {
                    svl.onboarding = new Onboarding($);
                    mission = svl.missionContainer.getCurrentMission();
                } else {
                    mission = svl.missionContainer.getMission("noRegionId", "initial-mission");
                    if (mission.isCompleted()) {
                        var missions = svl.missionContainer.getMissionsByRegionId(neighborhood.getProperty("regionId"));
                        missions = missions.filter(function (m) { return !m.isCompleted(); });
                        mission = missions[0];  // Todo. Take care of the case where length of the missions is 0
                    }
                    svl.missionContainer.setCurrentMission(mission);
                }
                
                // Check if this an anonymous user or not. 
                // If not, record that that this user has completed the onboarding.
                if ('user' in svl && svl.user.getProperty('username') != "anonymous" &&
                        missionLabels.indexOf("onboarding") < 0 && svl.storage.get("completedOnboarding")) {
                    var onboardingMission = svl.missionContainer.getMission(null, "onboarding");
                    onboardingMission.setProperty("isCompleted", true);
                    svl.missionContainer.addToCompletedMissions(onboardingMission);
                    svl.missionContainer.stage(onboardingMission).commit();
                }

                // Popup the message explaining the goal of the current mission if the current mission is not onboarding
                if (mission.getProperty("label") != "onboarding") {
                    svl.modalMission.setMission(mission);
                }

                // Call another callback function
                missionLoadComplete = true;
                handleDataLoadComplete();
            }
        });
        svl.missionFactory = MissionFactory ();

        svl.form.disableSubmit();
        svl.tracker.push('TaskStart');
          // Set map parameters and instantiate it.
        var mapParam = {};
        mapParam.canvas = svl.canvas;
        mapParam.overlayMessageBox = svl.overlayMessageBox;

        svl.form.setTaskRemaining(1);
        svl.form.setTaskDescription('TestTask');
        svl.form.setTaskPanoramaId(panoId);

        mapParam.Lat = SVLat;
        mapParam.Lng = SVLng;
        mapParam.panoramaPov = {
            heading: 0,
            pitch: -10,
            zoom: 1
        };
        mapParam.taskPanoId = panoId;
        nearbyPanoIds = [mapParam.taskPanoId];
        mapParam.availablePanoIds = nearbyPanoIds;

        if (getStatus("isFirstTask")) {
            svl.popUpMessage.setPosition(10, 120, width=400, height=undefined, background=true);
            svl.popUpMessage.setMessage("<span class='bold'>Remember, label all the landmarks close to the bus stop.</span> " +
                "Now the actual task begins. Click OK to start the task.");
            svl.popUpMessage.appendOKButton();
            svl.popUpMessage.show();
        } else {
            svl.popUpMessage.hide();
        }

        svl.map = new Map($, turf, mapParam);
        svl.map.disableClickZoom();

        if ("taskContainer" in svl) {
            var task = svl.taskContainer.getCurrentTask();
        }
        if (task && typeof google != "undefined") {
          google.maps.event.addDomListener(window, 'load', task.render);
        }
    }

    function getStatus (key) { return key in status ? status[key] : null; }
    function setStatus (key, value) { status[key] = value; return this; }

    _initUI();
    _init(params);

    self.getStatus = getStatus;
    self.setStatus = setStatus;
    return self;
}
