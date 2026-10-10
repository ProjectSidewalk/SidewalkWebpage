/**
 * Handles undo button functionality. Allows users to go back to the previous
 * label they have validated and re-do the validation.
 */

import { svv } from '../svv.js';

export class UndoValidation {
  #disableUndo = false;
  #uiUndo;

  /**
   * @param {Record<string, HTMLButtonElement>} uiUndo - Undo button UI elements.
   */
  constructor(uiUndo) {
    this.#uiUndo = uiUndo;
    uiUndo.undoButton.addEventListener('click', this.#undo);
  }

  /**
   * Enables the undo button (makes button clickable).
   */
  enableUndo() {
    this.#disableUndo = false;
    this.#uiUndo.undoButton.disabled = false;
  }

  /**
   * Disables the undo button (makes button unclickable).
   */
  disableUndo() {
    this.#disableUndo = true;
    this.#uiUndo.undoButton.disabled = true;
  }

  /**
   * Goes back to the previous label (decrements user's progress).
   */
  #undo = async () => {
    // Guarded before saveValidationState, which writes the reason text boxes onto the current label — mid-load that
    // is the label being stepped back to, not the one whose text is in the boxes (#5211).
    if (svv.labelContainer.dropInputWhileLoading('Undo')) return;

    svv.tracker.push('ModalUndo_Click');
    svv.validationMenu.saveValidationState();

    // Progress is rolled back only once the previous label is actually on screen, so that an undo the label container
    // couldn't complete leaves the mission counting the validation the user still has standing.
    if (await svv.labelContainer.undoLabel()) {
      const undone = svv.labelContainer.retractLastValidation();
      svv.missionContainer.updateAMissionUndoValidation(undone.validation_result);
      this.disableUndo();
      // The verdict being undone has usually reached the server already (verdicts flush within a second, #5561), so
      // the retraction is a row of its own and is worth the same hurry: a tab killed before it goes out keeps a
      // verdict the validator took back, and the mission's progress a label ahead of the truth.
      svv.tracker.flushSoon();
    }
  };

  /**
   * @returns {boolean} True if the undo button is enabled.
   */
  canUndo() {
    return !this.#disableUndo;
  }
}
