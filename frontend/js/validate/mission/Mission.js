/**
 * Represents a single validation mission.
 */

/** @typedef {import('./MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../status/StatusField.js').StatusField} StatusField */

/**
 * What a mission knows about itself, as MissionContainer builds it from the server's mission and progress.
 * @typedef {object} MissionProperties
 * @property {number} agreeCount - Agree votes cast in this mission so far.
 * @property {number} disagreeCount - Disagree votes cast in this mission so far.
 * @property {number} unsureCount - Unsure votes cast in this mission so far.
 * @property {number} missionId
 * @property {string} missionType - E.g. 'validation'.
 * @property {boolean} completed
 * @property {?number} labelsProgress - Labels validated so far; null for a mission nobody has started.
 * @property {number} labelsValidated - How many labels the mission asks for.
 * @property {string} labelType
 */

export class Mission {
  /** @type {MissionContainer} */
  #missionContainer;
  /** @type {StatusField} */
  #statusField;
  /** @type {MissionProperties} */
  #properties;

  /**
   * @param {MissionProperties} params - Mission metadata passed in from MissionContainer.js.
   * @param {MissionContainer} missionContainer - Told when this mission's last label is validated.
   * @param {StatusField} statusField - Shows this mission's progress and the validator's running count.
   */
  constructor(params, missionContainer, statusField) {
    this.#missionContainer = missionContainer;
    this.#statusField = statusField;
    this.#properties = { ...params };
  }

  /**
   * Gets a single property for this mission object.
   * @param {keyof MissionProperties} key - Property name.
   * @returns {*} The property's value.
   */
  getProperty(key) {
    return this.#properties[key];
  }

  /**
   * Function that checks if the current mission is complete.
   * @returns {boolean} True if this mission is complete, false if in progress.
   */
  isComplete() {
    return this.getProperty('completed');
  }

  /**
   * Sets a property of this mission.
   * @param {string} key - Name of property.
   * @param {*} value - Value.
   * @returns {Mission}
   */
  setProperty(key, value) {
    this.#properties[key] = value;
    return this;
  }

  /**
   * Moves the mission's progress one label forward, or back for an undo, and updates the status bar.
   * @param {?string} undoneResult - The verdict an undo took back (Agree, Disagree, or Unsure); null for a verdict
   *     cast, which moves the mission forward.
   */
  updateMissionProgress(undoneResult) {
    let labelsProgress = this.getProperty('labelsProgress');
    if (labelsProgress < this.getProperty('labelsValidated')) {
      if (undoneResult) {
        labelsProgress -= 1;
        this.updateValidationResult(undoneResult, true);
        this.#statusField.decrementLabelCounts();
      } else {
        labelsProgress += 1;
        this.#statusField.incrementLabelCounts();
      }

      this.setProperty('labelsProgress', labelsProgress);
      // Submit mission if mission is complete.
      if (labelsProgress >= this.getProperty('labelsValidated')) {
        this.setProperty('completed', true);
        this.#missionContainer.completeAMission();
      }
    }

    // Update progress bar.
    const labelsInMission = this.getProperty('labelsValidated');
    this.#statusField.setProgressBar(labelsProgress, labelsInMission);
    this.#statusField.setProgressText(labelsProgress, labelsInMission);
  }

  /**
   * Updates the validation result for this mission by incrementing agree, disagree and unsure
   * counts collected in this mission. (Only persists for current session)
   * @param {string} result - Validation result - Can either be 'Agree', 'Disagree', or 'Unsure'.
   * @param {boolean} removeValidation - Whether user clicked "undo", meaning we would decrement the count.
   */
  updateValidationResult(result, removeValidation) {
    const change = removeValidation ? -1 : 1;
    switch (result) {
      case 'Agree':
        this.setProperty('agreeCount', this.getProperty('agreeCount') + change);
        break;
      case 'Disagree':
        this.setProperty('disagreeCount', this.getProperty('disagreeCount') + change);
        break;
      case 'Unsure':
        this.setProperty('unsureCount', this.getProperty('unsureCount') + change);
        break;
    }
  }
}
