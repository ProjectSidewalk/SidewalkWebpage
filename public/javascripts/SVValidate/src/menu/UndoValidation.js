/**
 * Handles undo button functionality. Allows users to go back to the previous
 * label they have validated and re-do the validation
 * @param uiUndo   Undo button UI elements.
 * @returns {UndoValidation}
 * @constructor
 */
function UndoValidation (uiUndo) {
    let status = {
        disableUndo: false
    };
    const self = this;

    /**
     * Enables the undo button (makes button clickable).
     */
    function enableUndo() {
        status.disableUndo = false;
        uiUndo.undoButton.prop('disabled', false);
    }

    /**
     * Disables the undo button (makes button unclickable).
     */
    function disableUndo() {
        status.disableUndo = true;
        uiUndo.undoButton.prop('disabled', true);
    }

    /**
     * Goes back to the previous label (decrements user's progress).
     */
    function undo() {
        svv.tracker.push('ModalUndo_Click');
        svv.missionContainer.updateAMissionUndoValidation();
        svv.validationMenu.saveValidationState();
        svv.labelContainer.undoLabel();
        disableUndo();
    }

    uiUndo.undoButton.on('click', undo);

    self.enableUndo = enableUndo;
    self.disableUndo = disableUndo;

    return this;
}
