/**
 * Handles undo button functionality. Allows users to go back to the previous
 * label they have validated and re-do the validation.
 */

/** @typedef {import('../label/LabelContainer.js').LabelContainer} LabelContainer */
/** @typedef {import('./DesktopValidationMenu.js').DesktopValidationMenu} DesktopValidationMenu */
/** @typedef {import('./MobileValidationMenu.js').MobileValidationMenu} MobileValidationMenu */
/** @typedef {import('../mission/MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../Tracker.js').Tracker} Tracker */

export class UndoValidation {
  #disableUndo = false;
  #uiUndo;
  /** @type {LabelContainer} */
  #labelContainer;
  /** @type {DesktopValidationMenu|MobileValidationMenu} */
  #validationMenu;
  /** @type {MissionContainer} */
  #missionContainer;
  /** @type {Tracker} */
  #tracker;

  /**
   * @param {{undoButton: HTMLButtonElement}} uiUndo - Undo button UI elements.
   * @param {LabelContainer} labelContainer - Steps back to the previous label; the button is live while it has one.
   * @param {DesktopValidationMenu|MobileValidationMenu} validationMenu - Whose typed text is saved before going back.
   * @param {MissionContainer} missionContainer - Whose progress the undone verdict comes off; its completion turns
   *     the button off.
   * @param {Tracker} tracker - Logs the undo and hurries the retraction to the server.
   */
  constructor(uiUndo, labelContainer, validationMenu, missionContainer, tracker) {
    this.#uiUndo = uiUndo;
    this.#labelContainer = labelContainer;
    this.#validationMenu = validationMenu;
    this.#missionContainer = missionContainer;
    this.#tracker = tracker;
    uiUndo.undoButton.addEventListener('click', this.#undo);

    // Back means something only while there is a validated label behind the current one, and nothing to go back to
    // once a mission is done: its labels are submitted with it.
    labelContainer.onLoadingChange((loading) => {
      if (!loading) return;
      if (labelContainer.hasPreviousLabel()) this.enableUndo();
      else this.disableUndo();
    });
    missionContainer.onMissionComplete(() => this.disableUndo());
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
    if (this.#labelContainer.dropInputWhileLoading('Undo')) return;

    this.#tracker.push('ModalUndo_Click');
    this.#validationMenu.saveValidationState();

    // Progress is rolled back only once the previous label is actually on screen, so that an undo the label container
    // couldn't complete leaves the mission counting the validation the user still has standing.
    if (await this.#labelContainer.undoLabel()) {
      const undone = this.#labelContainer.retractLastValidation();
      this.#missionContainer.updateAMissionUndoValidation(undone.validation_result);
      // The verdict being undone has usually reached the server already (verdicts flush within a second, #5561), so
      // the retraction is a row of its own and is worth the same hurry: a tab killed before it goes out keeps a
      // verdict the validator took back, and the mission's progress a label ahead of the truth.
      this.#tracker.flushSoon();
    }
    // Off either way: an undo that worked has nothing further to take back, and one the container abandoned fell
    // back to the label the user undid from, where pressing Back again would only repeat the failure.
    this.disableUndo();
  };

  /**
   * @returns {boolean} True if the undo button is enabled.
   */
  canUndo() {
    return !this.#disableUndo;
  }
}
