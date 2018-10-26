/** @namespace */
var svv = svv || {};

/**
 * Main module of SVValidate
 * @param params
 * @returns {{className: string}}
 * @constructor
 */
function Main (params) {
    function _initUI() {
        svv.ui = {};

        svv.ui.validation = {};
        svv.ui.validation.buttons = $('button.validation-button');
        svv.ui.validation.agreeButton = $("#validation-agree-button");
        svv.ui.validation.disagreeButton = $("#validation-disagree-button");
        svv.ui.validation.unclearButton = $("#validation-unclear-button");
    }

    function _init() {
        // TODO later: Add params for map
        svv.panorama = new Panorama();
        svv.menuButtons = new MenuButton(svv.ui.validation);
    }

    _initUI();
    _init();
}