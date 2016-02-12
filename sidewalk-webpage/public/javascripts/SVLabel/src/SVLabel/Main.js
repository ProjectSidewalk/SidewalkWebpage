/** @namespace */
var svl = svl || {};

/**
 * The main module of SVLabel
 * @param $: jQuery object
 * @param param: other parameters
 * @returns {{moduleName: string}}
 * @constructor
 * @memberof svl
 */
function Main ($, params) {
    var self = {moduleName: 'Main'};
    var properties = {};
    var status = {};

    function _init (params) {
        var currentProgress;
        var panoId = params.panoId;
        var SVLat = parseFloat(params.initLat);
        var SVLng = parseFloat(params.initLng);

        svl.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';


        // Bind DOMs
        //svl.ui = {};
        svl.ui = new UI($);


        // Instantiate objects
        svl.labelContainer = new LabelContainer();
        svl.keyboard = new Keyboard($);
        svl.canvas = new Canvas($);
        svl.form = new Form($, params.form);
        svl.examples = undefined;
        svl.overlayMessageBox = new OverlayMessageBox($);
        // svl.statusMessage = new StatusMessage($, params.missionDescription);
//        svl.labeledLandmarkFeedback = new LabeledLandmarkFeedback($);
        svl.labelCounter = new LabelCounter($, d3);
        svl.qualificationBadges = undefined;
        //svl.progressFeedback = new ProgressFeedback($);
        svl.actionStack = new ActionStack();
        svl.ribbon = new RibbonMenu($);
        svl.popUpMessage = new PopUpMessage($);
        svl.zoomControl = new ZoomControl($);
        svl.tooltip = undefined;
        svl.onboarding = undefined;
        svl.progressPov = new ProgressPov($);
        svl.pointCloud = new PointCloud($, {panoIds: [panoId]});
        svl.tracker = new Tracker();
        svl.labelFactory = new LabelFactory();
        svl.compass = new Compass($);
        svl.contextMenu = new ContextMenu($);
        svl.audioEffect = new AudioEffect();
        svl.modalSkip = new ModalSkip($);
        svl.modalComment = new ModalComment($);

        svl.form.disableSubmit();
        svl.tracker.push('TaskStart');
          // Set map parameters and instantiate it.
        var mapParam = {};
        mapParam.canvas = svl.canvas;
        mapParam.overlayMessageBox = svl.overlayMessageBox;


        var task = null;
        var nearbyPanoIds = [];
        var totalTaskCount = -1;
        var taskPanoramaId = '';
        var taskRemaining = -1;
        var taskCompleted = -1;
        var isFirstTask = false;

        totalTaskCount = 1; // taskSpecification.numAllTasks;
        taskRemaining = 1; // taskSpecification.numTasksRemaining;
        taskCompleted = totalTaskCount - taskRemaining;
        currentProgress = taskCompleted / totalTaskCount;

        svl.form.setTaskRemaining(taskRemaining);
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

//        svl.statusMessage.setCurrentStatusDescription('Your mission is to ' +
//            '<span class="bold">find and label</span> presence and absence of curb ramps at intersections.');
        // svl.statusMessage.restoreDefault();
        // svl.statusMessage.setCurrentStatusDescription("Your mission is to find and label all the accessibility attributes in the sidewalks and streets.");
        //svl.progressFeedback.setProgress(currentProgress);
        //svl.progressFeedback.setMessage("You have finished " + (totalTaskCount - taskRemaining) +
        //    " out of " + totalTaskCount + ".");

        if (isFirstTask) {
            svl.popUpMessage.setPosition(10, 120, width=400, height=undefined, background=true);
            svl.popUpMessage.setMessage("<span class='bold'>Remember, label all the landmarks close to the bus stop.</span> " +
                "Now the actual task begins. Click OK to start the task.");
            svl.popUpMessage.appendOKButton();
            svl.popUpMessage.show();
        } else {
            svl.popUpMessage.hide();
        }

        // Instantiation
        svl.map = new Map($, mapParam);
        svl.map.disableClickZoom();
        if ('task' in svl) {
          google.maps.event.addDomListener(window, 'load', svl.task.render);
        }
    }

    _init(params);
    return self;
}
