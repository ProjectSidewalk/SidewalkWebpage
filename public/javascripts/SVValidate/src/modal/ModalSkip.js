/**
 * Handles skip button functionality. Allows users to validate different labels without affecting
 * their current validation mission progress.
 * @param uiModal   Skip button UI elements.
 * @returns {ModalSkip}
 * @constructor
 */
function ModalSkip (uiModal) {
    var status = {
        disableSkip: false
    };
    var self = this;

    /**
     * Disables the skip button (makes button unclickable).
     */
    function disableSkip () {
        console.log("Disabled skipping");
        status.disableSkip = true;
        uiModal.skipButton.attr("disabled", false);
        uiModal.skipButton.removeClass("disabled");
    }

    /**
     * Enables the skip button (makes button clickable).
     */
    function enableSkip () {
        console.log("Enabled skipping");
        status.disableSkip = false;
        uiModal.skipButton.attr("disabled", true);
        uiModal.skipButton.addClass("disabled");
    }

    /**
     * Skips this current label (does not change the user's current validation progress).
     */
    function skip () {
        svv.tracker.push("ModalSkip_ClickOK");
        svv.panorama.setLabel();
    }

    uiModal.skipButton.on("click", skip);

    self.enableSkip = enableSkip;
    self.disableSkip = disableSkip;

    return this;
}