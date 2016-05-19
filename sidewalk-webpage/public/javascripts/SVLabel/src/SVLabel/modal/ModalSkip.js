/**
 * A ModalSkip module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalSkip ($) {
    var self = { className : 'ModalSkip' },
        status = {
            disableClickOK: true
        },
        blinkInterval;

    function _init () {
        disableClickOK();

        svl.ui.modalSkip.ok.bind("click", handlerClickOK);
        svl.ui.modalSkip.cancel.bind("click", handlerClickCancel);
        svl.ui.modalSkip.radioButtons.bind("click", handlerClickRadio);
        svl.ui.leftColumn.jump.on('click', handleClickJump);
    }

    /**
     * Blink the jump button
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.leftColumn.jump.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Callback for clicking jump button
     * @param e
     */
    function handleClickJump (e) {
        e.preventDefault();
        svl.tracker.push('ModalSkip_ClickJump');
        svl.modalSkip.showSkipMenu();
    }


    /**
     * This method handles a click OK event
     * @param e
     */
    function handlerClickOK (e) {
        svl.tracker.push("ModalSkip_ClickOK");
        var radioValue = $('input[name="modal-skip-radio"]:checked', '#modal-skip-content').val(),
            position = svl.panorama.getPosition(),
            incomplete = {
                issue_description: radioValue,
                lat: position.lat(),
                lng: position.lng()
            };

        if ('form' in svl) svl.form.skipSubmit(incomplete);
        if ('ribbon' in svl) svl.ribbon.backToWalk();
        hideSkipMenu();
    }

    /**
     * This method handles a click Cancel event
     * @param e
     */
    function handlerClickCancel (e) {
        svl.tracker.push("ModalSkip_ClickCancel");
        hideSkipMenu();
    }

    /**
     * This method takes care of nothing.
     * @param e
     */
    function handlerClickRadio (e) {
        svl.tracker.push("ModalSkip_ClickRadio");
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

    /**
     * Disable clicking the ok button
     */
    function disableClickOK () {
        svl.ui.modalSkip.ok.attr("disabled", true);
        svl.ui.modalSkip.ok.addClass("disabled");
        status.disableClickOK = true;
    }

    /**
     * Enable clicking the ok button
     */
    function enableClickOK () {
        svl.ui.modalSkip.ok.attr("disabled", false);
        svl.ui.modalSkip.ok.removeClass("disabled");
        status.disableClickOK = false;
    }

    /**
     * Stop blinking the jump button
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        svl.ui.leftColumn.jump.removeClass("highlight-50");
    }

    _init();

    self.blink = blink;
    self.showSkipMenu = showSkipMenu;
    self.hideSkipMenu = hideSkipMenu;
    self.stopBlinking = stopBlinking;
    return self;
}
