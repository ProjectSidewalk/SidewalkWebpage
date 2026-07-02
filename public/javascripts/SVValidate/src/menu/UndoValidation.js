/**
 * Handles undo button functionality. Allows users to go back to the previous
 * label they have validated and re-do the validation.
 */
class UndoValidation {
    #disableUndo = false;
    #uiUndo;

    /**
     * @param {object} uiUndo Undo button UI elements.
     */
    constructor(uiUndo) {
        this.#uiUndo = uiUndo;
        uiUndo.undoButton.on('click', this.#undo);
    }

    /**
     * Enables the undo button (makes button clickable).
     */
    enableUndo() {
        this.#disableUndo = false;
        this.#uiUndo.undoButton.prop('disabled', false);
    }

    /**
     * Disables the undo button (makes button unclickable).
     */
    disableUndo() {
        this.#disableUndo = true;
        this.#uiUndo.undoButton.prop('disabled', true);
    }

    /**
     * Goes back to the previous label (decrements user's progress).
     */
    #undo = () => {
        svv.tracker.push('ModalUndo_Click');
        svv.missionContainer.updateAMissionUndoValidation();
        svv.validationMenu.saveValidationState();
        svv.labelContainer.undoLabel();
        this.disableUndo();
    };

    /**
     * @returns {boolean} True if the undo button is enabled.
     */
    canUndo() {
        return !this.#disableUndo;
    }
}
