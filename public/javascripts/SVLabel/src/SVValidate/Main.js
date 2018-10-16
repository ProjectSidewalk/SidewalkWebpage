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
        svv.ui.validationButtons = $('button.validation-button');
        /*
        svv.ui.disagreeButton = $('#validation-no-button');
        svv.ui.unclearButton = $('#validation-unclear-button');
        */
    }

    function _init() {
        // TODO later: Add params for map
        svv.panorama = new Panorama();
        svv.menuButtons = new MenuButton(svv.ui.validationButtons);
    }

    _initUI();
    _init();
}