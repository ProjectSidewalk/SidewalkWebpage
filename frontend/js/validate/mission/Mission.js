/**
 * Represents a single validation mission.
 */

/** @typedef {import('./MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../status/StatusField.js').StatusField} StatusField */

export class Mission {
  /** @type {MissionContainer} */
  #missionContainer;
  /** @type {StatusField} */
  #statusField;

  #properties = {
    agreeCount: 0,
    disagreeCount: 0,
    missionId: undefined,
    missionType: undefined,
    completed: undefined,
    labelsProgress: undefined,
    labelType: undefined,
    labelsValidated: undefined,
    unsureCount: 0,
  };

  /**
   * @param {object} params - Mission metadata passed in from MissionContainer.js.
   * @param {MissionContainer} missionContainer - Told when this mission's last label is validated.
   * @param {StatusField} statusField - Shows this mission's progress and the validator's running count.
   */
  constructor(params, missionContainer, statusField) {
    this.#missionContainer = missionContainer;
    this.#statusField = statusField;
    this.#init(params);
  }

  /**
   * Initializes a front-end mission object from metadata.
   * @param {object} params - Mission metadata.
   */
  #init(params) {
    if ('agreeCount' in params) this.setProperty('agreeCount', params.agreeCount);
    if ('disagreeCount' in params) this.setProperty('disagreeCount', params.disagreeCount);
    if ('missionId' in params) this.setProperty('missionId', params.missionId);
    if ('missionType' in params) this.setProperty('missionType', params.missionType);
    if ('regionId' in params) this.setProperty('regionId', params.regionId);
    if ('completed' in params) this.setProperty('completed', params.completed);
    if ('labelsProgress' in params) this.setProperty('labelsProgress', params.labelsProgress);
    if ('labelsValidated' in params) this.setProperty('labelsValidated', params.labelsValidated);
    if ('labelType' in params) this.setProperty('labelType', params.labelType);
    if ('unsureCount' in params) this.setProperty('unsureCount', params.unsureCount);
  }

  /**
   * Gets a single property for this mission object.
   * @param {string} key - String representation of property.
   * @returns {*} Property if it exists, null otherwise.
   */
  getProperty(key) {
    return key in this.#properties ? this.#properties[key] : null;
  }

  /**
   * Returns all properties associated with this mission.
   * @returns {object} Object for properties.
   */
  getProperties() {
    return this.#properties;
  }

  /**
   * Function that checks if the current mission is complete.
   * @returns {boolean|undefined} True if this mission is complete, false if in progress, undefined if not yet known.
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
