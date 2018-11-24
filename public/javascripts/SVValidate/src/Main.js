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
        svv.ui.validation.buttons = $('button.validation-button');
        svv.ui.validation.agreeButton = $("#validation-agree-button");
        svv.ui.validation.disagreeButton = $("#validation-disagree-button");
        svv.ui.validation.unsureButton = $("#validation-unsure-button");
    }

    function _init() {
        // TODO later: Add params for map
        svv.form = new Form(param.dataStoreUrl);
        svv.tracker = new Tracker();

        svv.panorama = new Panorama();
        svv.menuButtons = new MenuButton(svv.ui.validation, svv.form);

        // mission stuff
        svv.missionModel = new MissionModel();
        svv.missionModel.trigger("MissionModel:createAMission", param.mission);
    }

    _initUI();
    _init();
    return this;
}