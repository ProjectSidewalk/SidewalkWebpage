/**
 * Handles undo button functionality. Allows users to go back to the previous
 * label they have validated and re-do the validation
 * @param uiModal   Undo button UI elements.
 * @returns {ModalUndo}
 * @constructor
 */
function ModalUndo (uiModal) {
    let status = {
        disableUndo: false
    };
    let self = this;

    /**
     * Enables the undo button (makes button clickable).
     */
    function enableUndo() {
        status.disableUndo = false;
        uiModal.undoButton.attr("disabled", false);
        uiModal.undoButton.removeClass("disabled");
    }

    /**
     * Disables the undo button (makes button unclickable).
     */
    function disableUndo() {
        status.disableUndo = true;
        uiModal.undoButton.attr("disabled", true);
        uiModal.undoButton.addClass("disabled");
        svv.panorama.setLastLabel({});
    }

    /**
     * Goes back to the previous label (decrements user's progress).
     */
    function undo() {
        svv.tracker.push("ModalUndo_Click");
        svv.missionContainer.updateAMissionUndoValidation();
        svv.panorama.undoLabel();
        disableUndo();
    }

    uiModal.undoButton.on("click", undo);

    self.enableUndo = enableUndo;
    self.disableUndo = disableUndo;

    return this;
}
