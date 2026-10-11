/**
 * Keeps track of the current and completed validation missions.
 */

import { Mission } from './Mission.js';
/** @typedef {import('../status/StatusField.js').StatusField} StatusField */
/** @typedef {import('../modal/ModalMission.js').ModalMission} ModalMission */
/** @typedef {import('../modal/ModalMissionComplete.js').ModalMissionComplete} ModalMissionComplete */
/** @typedef {import('../util/MissionLiveMarker.js').MissionLiveMarker} MissionLiveMarker */
/** @typedef {import('../Tracker.js').Tracker} Tracker */

export class MissionContainer {
  #currentMission = undefined;
  #completedMissions = [];
  /** @type {number} Missions finished on this page, including a mission finished twice through an undo. */
  #missionsCompleted = 0;
  /** @type {StatusField} */
  #statusField;
  /** @type {ModalMission} */
  #modalMission;
  /** @type {ModalMissionComplete} */
  #modalMissionComplete;
  /** @type {MissionLiveMarker} */
  #missionLiveMarker;
  /** @type {Array<() => void>} Run as a mission completes: the Form submits it, the undo button turns off. */
  #completeListeners = [];

  /**
   * @param {StatusField} statusField - Shows each mission's progress and the title naming its label type.
   * @param {ModalMission} modalMission - Briefs each new mission.
   * @param {ModalMissionComplete} modalMissionComplete - Celebrates each finished one.
   * @param {MissionLiveMarker} missionLiveMarker - Marks the tab live for each mission, so a kill is filed against it.
   * @param {Tracker} tracker - Files every action under the current mission from here on.
   */
  constructor(statusField, modalMission, modalMissionComplete, missionLiveMarker, tracker) {
    this.#statusField = statusField;
    this.#modalMission = modalMission;
    this.#modalMissionComplete = modalMissionComplete;
    this.#missionLiveMarker = missionLiveMarker;
    tracker.trackMissions(this);
  }

  /**
   * Registers what happens as a mission completes, after its screen is up.
   * @param {() => void} listener
   */
  onMissionComplete(listener) {
    this.#completeListeners.push(listener);
  }

  /**
   * Adds a mission to in progress or list of completed missions.
   * @param {Mission} mission
   */
  addAMission(mission) {
    if (mission.getProperty('completed')) {
      this.#addToCompletedMissions(mission);
    } else {
      this.#currentMission = mission;
      this.#statusField.reset(mission);
    }
    return this;
  }

  /**
   * This function adds the current mission to a list of completed missions.
   * @param {Mission} mission - Mission object of the current mission.
   */
  #addToCompletedMissions(mission) {
    const existingMissionIds = this.#completedMissions.map((m) => m.getProperty('missionId'));
    const currentMissionId = mission.getProperty('missionId');
    if (existingMissionIds.indexOf(currentMissionId) < 0) {
      this.#completedMissions.push(mission);
    }
  }

  /**
   * Shows the mission-complete screen and hands the mission to the listeners, which submit it to the backend.
   */
  completeAMission() {
    this.#missionsCompleted += 1;
    this.#modalMissionComplete.show(this.#currentMission, this.#missionsCompleted);
    for (const listener of this.#completeListeners) listener();
    this.#addToCompletedMissions(this.#currentMission);
  }

  /**
   * Creates a mission by parsing a JSON file.
   * @param {{completed: boolean, labels_progress: ?number, labels_validated: ?number, label_type: string,
   *     mission_id: number, mission_type: string}} missionMetadata - JSON metadata for mission (from backend).
   * @param {{agree_count: number, disagree_count: number, unsure_count: number}} progressMetadata - JSON metadata
   *     about mission progress (counts of agree/disagree/unsure labels for this mission).
   */
  createAMission(missionMetadata, progressMetadata) {
    // Each mission re-marks the tab as live, so a kill during a later mission of the page is filed against that
    // mission and its own age (#5561).
    this.#missionLiveMarker.markLive(missionMetadata.mission_id);
    const metadata = {
      agreeCount: progressMetadata.agree_count,
      completed: missionMetadata.completed,
      disagreeCount: progressMetadata.disagree_count,
      labelsProgress: missionMetadata.labels_progress,
      labelsValidated: missionMetadata.labels_validated,
      labelType: missionMetadata.label_type,
      missionId: missionMetadata.mission_id,
      missionType: missionMetadata.mission_type,
      unsureCount: progressMetadata.unsure_count,
    };
    const mission = new Mission(metadata, this, this.#statusField);
    this.addAMission(mission);
    this.#modalMission.setMissionMessage(mission);
    this.#statusField.updateLabelText(mission.getProperty('labelType'), mission.getProperty('labelsValidated'));
  }

  /**
   * Returns the current mission in progress.
   * @returns {Mission|undefined} The current mission, or undefined if none is in progress.
   */
  getCurrentMission() {
    return this.#currentMission;
  }

  /**
   * Counts a validation toward the current mission.
   */
  updateAMission() {
    this.#currentMission.updateMissionProgress(null);
  }

  /**
   * Takes a validation back off the current mission, for the undo button.
   * @param {string} undoneResult - The verdict taken back: Agree, Disagree, or Unsure.
   */
  updateAMissionUndoValidation(undoneResult) {
    this.#currentMission.updateMissionProgress(undoneResult);
  }
}
