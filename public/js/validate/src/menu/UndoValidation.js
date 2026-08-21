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

    // Progress is rolled back only once the previous label is actually on screen, so that an undo the label container
    // couldn't complete leaves the mission counting the validation the user still has standing.
    if (await svv.labelContainer.undoLabel()) {
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
