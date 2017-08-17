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
    var status = {
        isFirstTask: false
    };

    // Initialize things that needs data loading.
    var loadingAnOnboardingTaskCompleted = false;
    var loadingTasksCompleted = false;
    var loadingMissionsCompleted = false;
    var loadNeighborhoodsCompleted = false;

    svl.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';
    svl.onboarding = null;
    svl.isOnboarding = function () {
        return svl.onboarding != null && svl.onboarding.isOnboarding();
    };
    svl.canvasWidth = 720;
    svl.canvasHeight = 480;
    svl.svImageHeight = 6656;
    svl.svImageWidth = 13312;
    svl.alpha_x = 4.6;
    svl.alpha_y = -4.65;
    svl._labelCounter = 0;
    svl.getLabelCounter = function () {
        return svl._labelCounter++;
    };
    svl.zoomFactor = {
        1: 1,
        2: 2.1,
        3: 4,
        4: 8,
        5: 16
    };

    svl.gsvImageCoordinate2CanvasCoordinate = function (xIn, yIn, pov) {
        // This function takes the current pov of the Street View as a parameter
        // and returns a canvas coordinate of a point (xIn, yIn).
        var x, y, zoom = pov.zoom;
        var svImageWidth = svl.svImageWidth * svl.zoomFactor[zoom];
        var svImageHeight = svl.svImageHeight * svl.zoomFactor[zoom];

        xIn = xIn * svl.zoomFactor[zoom];
        yIn = yIn * svl.zoomFactor[zoom];

        x = xIn - (svImageWidth * pov.heading) / 360;
        x = x / svl.alpha_x + svl.canvasWidth / 2;

        //
        // When POV is near 0 or near 360, points near the two vertical edges of
        // the SV image does not appear. Adjust accordingly.
        var edgeOfSvImageThresh = 360 * svl.alpha_x * (svl.canvasWidth / 2) / (svImageWidth) + 10;

        if (pov.heading < edgeOfSvImageThresh) {
            // Update the canvas coordinate of the point if
            // its svImageCoordinate.x is larger than svImageWidth - alpha_x * (svl.canvasWidth / 2).
            if (svImageWidth - svl.alpha_x * (svl.canvasWidth / 2) < xIn) {
                x = (xIn - svImageWidth) - (svImageWidth * pov.heading) / 360;
                x = x / svl.alpha_x + svl.canvasWidth / 2;
            }
        } else if (pov.heading > 360 - edgeOfSvImageThresh) {
            if (svl.alpha_x * (svl.canvasWidth / 2) > xIn) {
                x = (xIn + svImageWidth) - (svImageWidth * pov.heading) / 360;
                x = x / svl.alpha_x + svl.canvasWidth / 2;
            }
        }

        y = yIn - (svImageHeight / 2) * (pov.pitch / 90);
        y = y / svl.alpha_y + svl.canvasHeight / 2;

        return {x : x, y : y};
    };

    function _init (params) {
        params = params || {};
        var panoId = params.panoId;
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
        svl.tracker.push('TaskStart');

        if (!("storage" in svl)) svl.storage = new TemporaryStorage(JSON);
        svl.labelContainer = new LabelContainer($);
        svl.panoramaContainer = new PanoramaContainer(svl.streetViewService);



        svl.overlayMessageBox = new OverlayMessageBox(svl.modalModel, svl.ui.overlayMessage);
        svl.ribbon = new RibbonMenu(svl.overlayMessageBox, svl.tracker, svl.ui.ribbonMenu);
        svl.canvas = new Canvas(svl.ribbon);



        // Set map parameters and instantiate it.
        var mapParam = { Lat: SVLat, Lng: SVLng, panoramaPov: { heading: 0, pitch: -10, zoom: 1 }, taskPanoId: panoId};
        svl.map = new MapService(svl.canvas, svl.neighborhoodModel, svl.ui.map, mapParam);
        svl.map.disableClickZoom();
        svl.compass = new Compass(svl, svl.map, svl.taskContainer, svl.ui.compass);
        svl.alert = new Alert();
        //svl.alert2 = new Alert();
        svl.keyboardShortcutAlert = new KeyboardShortcutAlert(svl.alert);
        svl.ratingReminderAlert = new RatingReminderAlert(svl.alert);
        svl.zoomShortcutAlert = new ZoomShortcutAlert(svl.alert);
        svl.jumpModel = new JumpModel();
        svl.jumpAlert = new JumpAlert(svl.alert, svl.jumpModel);
        svl.navigationModel._mapService = svl.map;

        svl.form = new Form(svl.labelContainer, svl.missionModel, svl.navigationModel, svl.neighborhoodModel, svl.panoramaContainer, svl.taskContainer, svl.map, svl.compass, svl.tracker, params.form);
        svl.tracker.initTaskId();
        svl.statusField = new StatusField(svl.ui.status);
        svl.statusFieldNeighborhood = new StatusFieldNeighborhood(svl.neighborhoodModel, svl.statusModel, svl.userModel, svl.ui.status);
        svl.statusFieldMissionProgressBar = new StatusFieldMissionProgressBar(svl.modalModel, svl.statusModel, svl.ui.status);
        svl.statusFieldMission = new StatusFieldMission(svl.modalModel, svl.ui.status);

        svl.labelCounter = new LabelCounter(d3);

        svl.actionStack = new ActionStack(svl.tracker, svl.ui.actionStack);
        svl.popUpMessage = new PopUpMessage(svl.form, svl.storage, svl.taskContainer, svl.tracker, svl.user, svl.onboardingModel, svl.ui.popUpMessage);

        svl.pointCloud = new PointCloud();
        svl.labelFactory = new LabelFactory(svl);
        svl.contextMenu = new ContextMenu(svl.ui.contextMenu);

        // Game effects
        svl.audioEffect = new AudioEffect(svl.gameEffectModel, svl.ui.leftColumn, svl.rootDirectory, svl.storage);
        svl.completionMessage = new CompletionMessage(svl.gameEffectModel, svl.ui.task);


        var neighborhood;
        svl.neighborhoodContainer = new NeighborhoodContainer(svl.neighborhoodModel, svl.statusModel, svl.userModel);
        svl.neighborhoodModel._neighborhoodContainer = svl.neighborhoodContainer;

        svl.neighborhoodFactory = new NeighborhoodFactory(svl.neighborhoodModel);
        neighborhood = svl.neighborhoodFactory.create(params.regionId, params.regionLayer, params.regionName);
        svl.neighborhoodContainer.add(neighborhood);
        svl.neighborhoodContainer.setCurrentNeighborhood(neighborhood);
        svl.statusFieldNeighborhood.setNeighborhoodName(params.regionName);

        if (!("taskFactory" in svl && svl.taskFactory)) svl.taskFactory = new TaskFactory(svl.taskModel);
        if (!("taskContainer" in svl && svl.taskContainer)) {
            svl.taskContainer = new TaskContainer(svl.navigationModel, svl.neighborhoodModel, svl.streetViewService, svl, svl.taskModel, svl.tracker);
        }
        svl.taskModel._taskContainer = svl.taskContainer;

        // Mission.
        svl.missionContainer = new MissionContainer (svl.statusFieldMission, svl.missionModel, svl.taskModel);
        svl.missionProgress = new MissionProgress(svl, svl.gameEffectModel, svl.missionModel, svl.modalModel,
            svl.neighborhoodModel, svl.statusModel, svl.missionContainer, svl.neighborhoodContainer, svl.taskContainer,
            svl.tracker);
        svl.missionFactory = new MissionFactory (svl.missionModel);

        // Modals
        var modalMissionCompleteMap = new ModalMissionCompleteMap(svl.ui.modalMissionComplete);
        var modalMissionCompleteProgressBar = new ModalMissionCompleteProgressBar(svl.ui.modalMissionComplete);
        svl.modalMissionComplete = new ModalMissionComplete(svl, svl.missionContainer, svl.taskContainer,
            modalMissionCompleteMap, modalMissionCompleteProgressBar, svl.ui.modalMissionComplete, svl.modalModel,
            svl.statusModel, svl.onboardingModel);
        svl.modalMissionComplete.hide();

        svl.modalComment = new ModalComment(svl, svl.tracker, svl.ribbon, svl.taskContainer, svl.ui.leftColumn, svl.ui.modalComment, svl.modalModel, svl.onboardingModel);
        svl.modalMission = new ModalMission(svl.missionContainer, svl.neighborhoodContainer, svl.ui.modalMission, svl.modalModel, svl.onboardingModel);
        svl.modalSkip = new ModalSkip(svl.form, svl.modalModel, svl.navigationModel, svl.onboardingModel, svl.ribbon, svl.taskContainer, svl.tracker, svl.ui.leftColumn, svl.ui.modalSkip);
        svl.modalExample = new ModalExample(svl.modalModel, svl.onboardingModel, svl.ui.modalExample);


        svl.zoomControl = new ZoomControl(svl.canvas, svl.map, svl.tracker, svl.ui.zoomControl);
        svl.keyboard = new Keyboard(svl, svl.canvas, svl.contextMenu, svl.map, svl.ribbon, svl.zoomControl);
        loadData(neighborhood, svl.taskContainer, svl.missionModel, svl.neighborhoodModel);
        var task = svl.taskContainer.getCurrentTask();
        if (task && typeof google != "undefined") {
          google.maps.event.addDomListener(window, 'load', task.render);
        }

        if (getStatus("isFirstTask")) {
            svl.popUpMessage.setPosition(10, 120, width=400, height=undefined, background=true);
            svl.popUpMessage.setMessage("<span class='bold'>Remember, label all the landmarks close to the bus stop.</span> " +
                "Now the actual task begins. Click OK to start the task.");
            svl.popUpMessage.appendOKButton();
            svl.popUpMessage.show();
        } else {
            svl.popUpMessage.hide();
        }

        $("#toolbar-onboarding-link").on('click', function () {
            startOnboarding();
        });
        $('#sign-in-modal-container').on('hide.bs.modal', function () {
            svl.popUpMessage.enableInteractions();
            $(".toolUI").css('opacity', 1);
        });
        $('#sign-in-modal-container').on('show.bs.modal', function () {
            svl.popUpMessage.disableInteractions();
            $(".toolUI").css('opacity', 0.5);
        });
        $('#sign-in-button').on('click', function(){
            $("#sign-in-modal").removeClass("hidden");
            $("#sign-up-modal").addClass("hidden");
            $(".toolUI").css('opacity', 0.5);
        });

        $(svl.ui.ribbonMenu.buttons).each(function() {
            var val = $(this).attr('val');

            if(val != 'Walk' && val != 'Other') {
                $(this).attr({
                    'data-toggle': 'tooltip',
                    'data-placement': 'top',
                    'title': 'Press the "' + util.misc.getLabelDescriptions(val)['shortcut']['keyChar'] + '" key'
                });
            }
        });

        $(svl.ui.ribbonMenu.subcategories).each(function() {
            var val = $(this).attr('val');

            if(val != 'Walk' && val != 'Other') {
                $(this).attr({
                    'data-toggle': 'tooltip',
                    'data-placement': 'left',
                    'title': 'Press the "' + util.misc.getLabelDescriptions(val)['shortcut']['keyChar'] + '" key'
                });
            }
        });
        $('[data-toggle="tooltip"]').tooltip({
            delay: { "show": 500, "hide": 100 }
        });
    }

    function loadData (neighborhood, taskContainer, missionModel, neighborhoodModel) {
        // Fetch an onboarding task.

        taskContainer.fetchATask("onboarding", 15250, function () {
            loadingAnOnboardingTaskCompleted = true;
            handleDataLoadComplete();
        });

        // Fetch tasks in the onboarding region.
        taskContainer.fetchTasksInARegion(neighborhood.getProperty("regionId"), function () {
            loadingTasksCompleted = true;
            handleDataLoadComplete();
        });

        // Fetch all the missions
        missionModel.fetchMissions(function () {
            loadingMissionsCompleted = true;
            handleDataLoadComplete();
        });

        neighborhoodModel.fetchNeighborhoods(function () {
            loadNeighborhoodsCompleted = true;
            handleDataLoadComplete();
        });
    }

    function hasCompletedOnboarding(completedMissions) {
        var missionLabels = completedMissions.map(function (m) { return m.label; });
        return missionLabels.indexOf("onboarding") >= 0 || svl.storage.get("completedOnboarding");
    }

    var onboardingHandAnimation = null;
    var onboardingStates = null;
    function startOnboarding () {
        //hide any alerts
        svl.alert.hideAlert();
        //hide footer
        $("#mini-footer-audit").css("visibility", "hidden");

        if (!onboardingHandAnimation) {
            onboardingHandAnimation = new HandAnimation(svl.rootDirectory, svl.ui.onboarding);
            onboardingStates = new OnboardingStates(svl.compass, svl.map, svl.statusModel, svl.tracker);
        }

        if (!("onboarding" in svl && svl.onboarding)) {

            // Todo. It should pass UserModel instead of User (i.e., svl.user)

            svl.onboarding = new Onboarding(svl, svl.actionStack, svl.audioEffect, svl.compass, svl.form,
                onboardingHandAnimation, svl.map,
                svl.missionContainer, svl.missionModel, svl.modalComment, svl.modalMission, svl.modalSkip,
                svl.neighborhoodContainer, svl.neighborhoodModel, svl.onboardingModel, onboardingStates, svl.ribbon,
                svl.statusField, svl.statusModel, svl.storage, svl.taskContainer, svl.tracker, svl.canvas, svl.ui.canvas,
                svl.contextMenu, svl.ui.map, svl.ui.onboarding, svl.ui.ribbonMenu, svl.user, svl.zoomControl);
        }
        svl.onboarding.start();

        var onboardingMission = svl.missionContainer.getMission("noRegionId", "onboarding", 1);
        if (!onboardingMission) {
            // Add the onboarding mission into the MissionContainer if it is not yet added.
            onboardingMission = svl.missionFactory.createOnboardingMission(1, false);
            svl.missionContainer.add(null, onboardingMission);
        }
        svl.missionContainer.setCurrentMission(onboardingMission);
    }

    function findTheNextRegionWithMissionsNew () {

        // Query the server for the next least unaudited region (across users)
        // and that hasn't been done by the user
        var username = svl.user.getProperty("username");
        return neighborhoodModel.fetchNextLeastAuditedRegion(username);
    }

    function findTheNextRegionWithMissions (currentNeighborhood) {
        var currentRegionId = currentNeighborhood.getProperty("regionId");
        var allRegionIds = svl.neighborhoodContainer.getRegionIds();
        var nextRegionId = svl.neighborhoodContainer.getNextRegionId(currentRegionId, allRegionIds);
        var availableMissions = svl.missionContainer.getMissionsByRegionId(nextRegionId);
        availableMissions = availableMissions.filter(function (m) { return !m.isCompleted(); });

        while(availableMissions.length == 0) {
            nextRegionId = svl.neighborhoodContainer.getNextRegionId(nextRegionId, allRegionIds);
            availableMissions = svl.missionContainer.getMissionsByRegionId(nextRegionId);
            availableMissions = availableMissions.filter(function (m) { return !m.isCompleted(); });
            if (nextRegionId == currentRegionId) {
                console.error("No more available regions to audit");
                return null;
            }
        }
        return nextRegionId;
    }

    function isAnAnonymousUser() {
        return 'user' in svl && svl.user.getProperty('username') == "anonymous"; // Todo. it should access the user through UserModel
    }

    function startTheMission(mission, neighborhood) {
        // Check if this an anonymous user or not.
        // If not, record that that this user has completed the onboarding.
        if (!isAnAnonymousUser()) {
            var onboardingMission = svl.missionContainer.getMission(null, "onboarding");
            onboardingMission.setProperty("isCompleted", true);
            svl.missionContainer.addToCompletedMissions(onboardingMission);
            svl.missionModel.submitMissions([onboardingMission]);
        }

        if(params.init !== "noInit") {
            // Popup the message explaining the goal of the current mission
            if (svl.missionContainer.onlyMissionOnboardingDone() || svl.missionContainer.isTheFirstMission()) {
                var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
                svl.initialMissionInstruction = new InitialMissionInstruction(svl.compass, svl.map,
                    svl.neighborhoodContainer, svl.popUpMessage, svl.taskContainer, svl.labelContainer, svl.tracker);
                svl.modalMission.setMissionMessage(mission, neighborhood, null, function () {
                    svl.initialMissionInstruction.start(neighborhood);
                });
            } else {
                svl.modalMission.setMissionMessage(mission, neighborhood);
            }
            svl.modalMission.show();
        }
        svl.missionModel.updateMissionProgress(mission, neighborhood);

        // Get the labels collected in the current neighborhood
        svl.labelContainer.fetchLabelsInANeighborhood(neighborhood.getProperty("regionId"), function () {
            var count = svl.labelContainer.countLabels(neighborhood.getProperty("regionId"));
            svl.statusFieldNeighborhood.setLabelCount(count);
        });

        svl.labelContainer.fetchLabelsInTheCurrentMission(
            neighborhood.getProperty("regionId"),
            function (result) {
                var counter = {"CurbRamp": 0, "NoCurbRamp": 0, "Obstacle": 0, "SurfaceProblem": 0, "Other": 0};
                for (var i = 0, len = result.length; i < len; i++) {
                    switch (result[i].label_type_id) {
                        case 1:
                            counter['CurbRamp'] += 1;
                            break;
                        case 2:
                            counter['NoCurbRamp'] += 1;
                            break;
                        case 3:
                            counter['Obstacle'] += 1;
                            break;
                        case 4:
                            counter['SurfaceProblem'] += 1;
                            break;
                        default:
                            counter['Other'] += 1;
                    }
                }
                svl.labelCounter.set('CurbRamp', counter['CurbRamp']);
                svl.labelCounter.set('NoCurbRamp', counter['NoCurbRamp']);
                svl.labelCounter.set('Obstacle', counter['Obstacle']);
                svl.labelCounter.set('SurfaceProblem', counter['SurfaceProblem']);
                svl.labelCounter.set('Other', counter['Other']);
            });

        var unit = "miles";
        var distance = svl.taskContainer.getCompletedTaskDistance(neighborhood.getProperty("regionId"), unit);
        svl.statusFieldNeighborhood.setAuditedDistance(distance.toFixed(1), unit);


    }

    // This is a callback function that is executed after every loading process is done.
    function handleDataLoadComplete () {
        if (loadingAnOnboardingTaskCompleted && loadingTasksCompleted &&
            loadingMissionsCompleted && loadNeighborhoodsCompleted) {
            // Check if the user has completed the onboarding tutorial..
            var completedMissions = svl.missionContainer.getCompletedMissions();
            var currentNeighborhood = svl.neighborhoodContainer.getStatus("currentNeighborhood");
            var mission;
            $("#page-loading").css({"visibility": "hidden"});
            $(".toolUI").css({"visibility": "visible"});
            $(".visible").css({"visibility": "visible"});

            if (!hasCompletedOnboarding(completedMissions)) {
                $("#mini-footer-audit").css("visibility", "hidden");
                startOnboarding();
            } else {
                // If the user has completed the onboarding mission but the data is only stored in the browser
                // because the user completed it as an anonymous user, store the record on the server.
                var onboardingMission = svl.missionContainer.getMission(null, "onboarding");
                var hasCompletionRecordStored = onboardingMission.getProperty("isCompleted");
                if (svl.user.getProperty("username") !== "anonymous" && !hasCompletionRecordStored) {
                    onboardingMission.setProperty("isCompleted", true);
                    svl.missionModel.completeMission(onboardingMission, null);
                }
                mission = selectTheMission(currentNeighborhood); // Neighborhood changing side-effect in selectTheMission
                _calculateAndSetTasksMissionsOffset();
                currentNeighborhood = svl.neighborhoodContainer.getStatus("currentNeighborhood");
                svl.missionContainer.setCurrentMission(mission);
                $("#mini-footer-audit").css("visibility", "visible");
                startTheMission(mission, currentNeighborhood);
            }
        }
    }

    function _calculateAndSetTasksMissionsOffset() {
        var neighborhoodId = svl.neighborhoodContainer.getCurrentNeighborhood().getProperty("regionId");

        var completedTasksDistance = svl.taskContainer.getCompletedTaskDistance(neighborhoodId);

        var missions = svl.missionContainer.getMissionsByRegionId(neighborhoodId);
        var completedMissions = missions.filter(function (m) { return m.isCompleted(); });

        var completedMissionsDistance = 0;

        if(completedMissions.length > 0)
            completedMissionsDistance = completedMissions[completedMissions.length - 1].getProperty("distance") / 1000;

        if(completedMissionsDistance > completedTasksDistance) {
            /*
            In this case the user has audited part of a street to complete a mission, then refreshed the browser
            and the audited street is not saved.
             */
            svl.missionContainer.setTasksMissionsOffset(completedMissionsDistance - completedTasksDistance);
        } else {
            /*
            In this case we don't need to store any offset
             */
            svl.missionContainer.setTasksMissionsOffset(0);
        }
    }

    function selectTheMission(currentNeighborhood) {
        var regionId = currentNeighborhood.getProperty("regionId");
        var availableMissions = svl.missionContainer.getIncompleteMissionsByRegionId(regionId);
        var incompleteTasks = svl.taskContainer.getIncompleteTasks(regionId);

        if (!(incompleteMissionExists(availableMissions) && incompleteTaskExists(incompleteTasks))) {
            regionId = findTheNextRegionWithMissions(currentNeighborhood);

            // TODO: This case will execute when the entire city is audited by the user. Should handle properly!
            if (regionId == null) return;  // No missions available.

            currentNeighborhood = svl.neighborhoodContainer.get(regionId);
            svl.neighborhoodModel.moveToANewRegion(regionId);
            svl.neighborhoodModel.setCurrentNeighborhood(currentNeighborhood);
            availableMissions = svl.missionContainer.getMissionsByRegionId(regionId);
            availableMissions = availableMissions.filter(function (m) { return !m.isCompleted(); });
            svl.taskContainer.getFinishedAndInitNextTask();
        }
        return availableMissions[0];
    }

    function incompleteMissionExists(missions) {
        var _missions = missions.filter(function (m) { return !m.isCompleted(); });
        return _missions.length > 0;
    }

    function incompleteTaskExists(tasks) {
        var _tasks = tasks.filter(function (t) { return !t.isCompleted(); });
        return _tasks.length > 0;
    }

    function getStatus (key) {
        return key in status ? status[key] : null;
    }

    function setStatus (key, value) {
        status[key] = value; return this;
    }

    /**
     * Store jQuery DOM elements under svl.ui
     * Todo. Once we update all the modules to take ui elements as injected argumentss, get rid of the svl.ui namespace and everything in it.
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
        svl.ui.status.neighborhoodName = $("#status-holder-neighborhood-name");
        svl.ui.status.neighborhoodLink = $("#status-neighborhood-link");
        svl.ui.status.neighborhoodLabelCount = $("#status-neighborhood-label-count");
        svl.ui.status.currentMissionDescription = $("#current-mission-description");
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
        svl.ui.popUpMessage.buttonHolder = $("#pop-up-message-button-holder");

        // Ribbon menu DOMs
        svl.ui.ribbonMenu = {};
        svl.ui.ribbonMenu.holder = $("#ribbon-menu-landmark-button-holder");
        svl.ui.ribbonMenu.streetViewHolder = $("#street-view-holder");
        svl.ui.ribbonMenu.buttons = $('span.modeSwitch');
        svl.ui.ribbonMenu.bottonBottomBorders = $(".ribbon-menu-mode-switch-horizontal-line");
        svl.ui.ribbonMenu.connector = $("#ribbon-street-view-connector");
        svl.ui.ribbonMenu.subcategoryHolder = $("#ribbon-menu-other-subcategory-holder");
        svl.ui.ribbonMenu.subcategories = $(".ribbon-menu-other-subcategories");

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

        svl.ui.modalMission = {};
        svl.ui.modalMission.holder = $("#modal-mission-holder");
        svl.ui.modalMission.foreground = $("#modal-mission-foreground");
        svl.ui.modalMission.background = $("#modal-mission-background");
        svl.ui.modalMission.missionTitle = $("#modal-mission-header");
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
        svl.ui.modalMissionComplete.closeButton = $("#modal-mission-complete-close-button");
        svl.ui.modalMissionComplete.totalAuditedDistance = $("#modal-mission-complete-total-audited-distance");
        svl.ui.modalMissionComplete.missionDistance = $("#modal-mission-complete-mission-distance");
        svl.ui.modalMissionComplete.remainingDistance = $("#modal-mission-complete-remaining-distance");
        svl.ui.modalMissionComplete.curbRampCount = $("#modal-mission-complete-curb-ramp-count");
        svl.ui.modalMissionComplete.noCurbRampCount = $("#modal-mission-complete-no-curb-ramp-count");
        svl.ui.modalMissionComplete.obstacleCount = $("#modal-mission-complete-obstacle-count");
        svl.ui.modalMissionComplete.surfaceProblemCount = $("#modal-mission-complete-surface-problem-count");
        svl.ui.modalMissionComplete.otherCount = $("#modal-mission-complete-other-count");

        // Zoom control
        svl.ui.zoomControl = {};
        svl.ui.zoomControl.holder = $("#zoom-control-holder");
        svl.ui.zoomControl.holder.append('<button id="zoom-in-button" class="button zoom-control-button" title="Press the &quot;Z&quot; key" data-toggle="tooltip" data-placement="top">' +
            '<img src="' + svl.rootDirectory + 'img/icons/ZoomIn.svg" class="zoom-button-icon" alt="Zoom in">' +
            '<br /><u>Z</u>oom In</button>');
        svl.ui.zoomControl.holder.append('<button id="zoom-out-button" class="button zoom-control-button" title="Press the &quot;Shift + Z&quot; keys" data-toggle="tooltip" data-placement="top">' +
            '<img src="' + svl.rootDirectory + 'img/icons/ZoomOut.svg" class="zoom-button-icon" alt="Zoom out"><br />Zoom Out</button>');
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

    if(params.init !== "noInit") {
        _initUI();
        _init(params);
    }

    self.getStatus = getStatus;
    self.setStatus = setStatus;
    self.isAnAnonymousUser = isAnAnonymousUser;
    self.loadData = loadData;

    return self;
}
