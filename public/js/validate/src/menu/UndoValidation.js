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
  #undo = async () => {
    svv.tracker.push('ModalUndo_Click');
    svv.validationMenu.saveValidationState();

    const currentMission = svv.missionContainer.getCurrentMission();
    const missionJustCompleted = currentMission.isComplete();

    // After the final validation, the current label is still on screen, so there is
    // no need to move back. Otherwise, only roll back progress once the previous
    // label has been successfully rendered.
    if (missionJustCompleted || await svv.labelContainer.undoLabel()) {
      svv.missionContainer.updateAMissionUndoValidation();
      this.disableUndo();
    }
  };

  /**
   * @returns {boolean} True if the undo button is enabled.
   */
  canUndo() {
    return !this.#disableUndo;
  }
}
