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
function Main ($, params) {
    var self = {moduleName: 'Main'};
    var properties = {};
    var status = {
        currentNeighborhood: null,
        isFirstTask: false
    };
    svl.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';

    function _initUI () {
        // Todo. Move all the UI codes here.
        svl.ui = UI($);
    }

    function _init (params) {
        var panoId = params.panoId;
        var SVLat = parseFloat(params.initLat), SVLng = parseFloat(params.initLng);

        // Instantiate objects
        svl.labelContainer = LabelContainer();
        svl.keyboard = Keyboard($);
        svl.canvas = Canvas($);
        svl.form = Form($, params.form);
        svl.overlayMessageBox = OverlayMessageBox($);
        svl.labelCounter = LabelCounter($, d3);
        svl.actionStack = ActionStack();
        svl.ribbon = RibbonMenu($);
        svl.popUpMessage = PopUpMessage($);
        svl.zoomControl = ZoomControl($);
        svl.missionProgress = MissionProgress($);
        svl.pointCloud = new PointCloud($, {panoIds: [panoId]});
        svl.tracker = Tracker();
        svl.labelFactory = LabelFactory();
        svl.compass = Compass($);
        svl.contextMenu = ContextMenu($);
        svl.audioEffect = AudioEffect();
        svl.modalSkip = ModalSkip($);
        svl.modalComment = ModalComment($);
        svl.modalMission = ModalMission($);

        svl.neighborhoodFactory = NeighborhoodFactory();
        svl.neighborhoodContainer = NeighborhoodContainer();
        if ('neighborhoodId' in params) {
            var neighborhood = svl.neighborhoodFactory.create(params.neighborhoodId);
            svl.neighborhoodContainer.add(neighborhood);
            setStatus("currentNeighborhood", neighborhood);
        }

        svl.missionContainer = MissionContainer ({currentNeighborhood: getStatus("currentNeighborhood")});
        svl.missionFactory = MissionFactory ();
        //svl.mission = new Mission();;
        //svl.achievement = new Achievement();

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

        svl.map = new Map($, mapParam);
        svl.map.disableClickZoom();

        if ('task' in svl) {
          google.maps.event.addDomListener(window, 'load', svl.task.render);
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
