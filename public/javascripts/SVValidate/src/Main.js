/** @namespace */
var svv = svv || {};

/**
 * Main module of SVValidate
 * @param params
 * @constructor
 */
function Main (param) {
    function _initUI() {
        svv.ui = {};

        svv.ui.validation = {};
        svv.ui.validation.agreeButton = $("#validation-agree-button");
        svv.ui.validation.buttons = $('button.validation-button');
        svv.ui.validation.disagreeButton = $("#validation-disagree-button");
        svv.ui.validation.notSureButton = $("#validation-not-sure-button");

        svv.ui.status = {};
        svv.ui.status.labelCount = $("#status-neighborhood-label-count");
        svv.ui.status.labelTypeCounterexample = $("#label-type-counterexample");
        svv.ui.status.labelTypeExample = $("#label-type-example");
        svv.ui.status.missionDescription = $("#current-mission-description");
    }

    function _init() {
        // TODO later: Add params for map
        svv.form = new Form(param.dataStoreUrl);
        svv.statusField = new StatusField(param.mission);
        svv.tracker = new Tracker();

        svv.labelContainer = new LabelContainer();
        svv.panorama = new Panorama();
        svv.menuButtons = new MenuButton(svv.ui.validation, svv.form);

        // mission stuff
        svv.missionContainer = new MissionContainer();
        svv.missionContainer.trigger("MissionContainer:createAMission", param.mission);
    }

    _initUI();
    _init();
    return this;
}