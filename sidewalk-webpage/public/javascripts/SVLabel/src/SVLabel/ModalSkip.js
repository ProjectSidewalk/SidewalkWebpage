var svl = svl || {};

/**
 * A Modal module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalSkip ($) {
    var self = { className : 'Modal'},
        status = {
            disableClickOK: true
        };

    function _init () {
        disableClickOK();

        svl.ui.modalSkip.ok.bind("click", handlerClickOK);
        svl.ui.modalSkip.cancel.bind("click", handlerClickCancel);
        svl.ui.modalSkip.radioButtons.bind("click", handlerClickRadio);
    }

    /**
     * This method handles a click OK event
     * @param e
     */
    function handlerClickOK (e) {
        var radioValue = $('input[name="modal-skip-radio"]:checked', '#modal-skip-content').val(),
            position = svl.panorama.getPosition(),
            incomplete = {
                issue_description: radioValue,
                lat: position.lat(),
                lng: position.lng()
            };

        svl.form.skipSubmit(incomplete);
        hideSkipMenu();
    }

    /**
     * This method handles a click Cancel event
     * @param e
     */
    function handlerClickCancel (e) {
        hideSkipMenu();
    }

    /**
     * This method takes care of nothing.
     * @param e
     */
    function handlerClickRadio (e) {
        enableClickOK();
    }

    /**
     * Hide a skip menu
     */
    function hideSkipMenu () {
        svl.ui.modalSkip.radioButtons.prop('checked', false);
        svl.ui.modalSkip.holder.addClass('hidden');
    }

    /**
     * Show a skip menu
     */
    function showSkipMenu () {
        svl.ui.modalSkip.holder.removeClass('hidden');
        disableClickOK();
    }


    function disableClickOK () {
        svl.ui.modalSkip.ok.attr("disabled", true);
        svl.ui.modalSkip.ok.addClass("disabled");
        status.disableClickOK = true;
    }

    function enableClickOK () {
        svl.ui.modalSkip.ok.attr("disabled", false);
        svl.ui.modalSkip.ok.removeClass("disabled");
        status.disableClickOK = false;
    }


    _init();

    self.showSkipMenu = showSkipMenu;
    self.hideSkipMenu = hideSkipMenu;
    return self;
}
