/**
 * Handles skip button functionality. Allows users to validate different labels without affecting
 * their current validation mission progress.
 * @param uiSkip   Skip button UI elements.
 * @returns {SkipValidation}
 * @constructor
 */
function SkipValidation (uiSkip) {
    let status = {
        disableSkip: false
    };
    const self = this;

    /**
     * Enables the skip button (makes button clickable).
     */
    function enableSkip () {
        status.disableSkip = true;
        uiSkip.skipButton.attr("disabled", false);
        uiSkip.skipButton.removeClass("disabled");
    }

    /**
     * Disables the skip button (makes button unclickable).
     */
    function disableSkip () {
        status.disableSkip = false;
        uiSkip.skipButton.attr("disabled", true);
        uiSkip.skipButton.addClass("disabled");
    }

    /**
     * Skips this current label (does not change the user's current validation progress).
     */
    function skip() {
        svv.tracker.push("ModalSkip_ClickOK");
        svv.labelContainer.skipLabel();
        svv.undoValidation.disableUndo();
    }

    uiSkip.skipButton.on("click", skip);

    self.enableSkip = enableSkip;
    self.disableSkip = disableSkip;

    return this;
}
