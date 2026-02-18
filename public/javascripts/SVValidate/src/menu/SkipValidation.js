/**
 * Handles skip button functionality. Allows users to skip a label without affecting their mission progress.
 * @param uiSkip   Skip button UI elements.
 * @returns {SkipValidation}
 * @constructor
 */
class SkipValidation {
    constructor(uiSkip) {
        uiSkip.skipButton.on('click', this.skip);
    }

    /**
     * Skips this current label (does not change the user's current validation progress).
     * @returns {Promise<void>} A Promise that resolves once the new label has loaded onto the screen
     */
    skip = async () => {
        svv.tracker.push('ModalSkip_ClickOK');
        svv.undoValidation.disableUndo();
        return svv.labelContainer.skipLabel();
    }
}
