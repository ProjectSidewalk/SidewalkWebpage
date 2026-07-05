/**
 * Keeps track of the current and completed validation missions.
 */
class MissionContainer {
  #currentMission = undefined;
  #completedMissions = [];

  /**
   * Adds a mission to in progress or list of completed missions.
   * @param {Mission} mission
   */
  addAMission(mission) {
    if (mission.getProperty('completed')) {
      this.#addToCompletedMissions(mission);
    } else {
      this.#currentMission = mission;
      svv.statusField.reset(mission);
    }
    return this;
  }

  /**
   * This function adds the current mission to a list of completed missions.
   * @param {Mission} mission Mission object of the current mission.
   */
  #addToCompletedMissions(mission) {
    const existingMissionIds = this.#completedMissions.map((m) => m.getProperty('missionId'));
    const currentMissionId = mission.getProperty('missionId');
    if (existingMissionIds.indexOf(currentMissionId) < 0) {
      this.#completedMissions.push(mission);
    }
  }

  /**
   * Submits this mission to the backend.
   */
  completeAMission() {
    svv.missionsCompleted += 1;
    svv.modalMissionComplete.show(this.#currentMission);
    const data = svv.form.compileSubmissionData(true);
    svv.form.submit(data); // Note that this happens async. Once finished, it enables start next mission button.
    this.#addToCompletedMissions(this.#currentMission);
  }

  /**
   * Creates a mission by parsing a JSON file.
   * @param {object} missionMetadata JSON metadata for mission (from backend).
   * @param {object} progressMetadata JSON metadata about mission progress
   *                                  (counts of agree/disagree/unsure labels for this mission).
   */
  createAMission(missionMetadata, progressMetadata) {
    svv.undoValidation.disableUndo();
    const metadata = {
      agreeCount: progressMetadata.agree_count,
      completed: missionMetadata.completed,
      disagreeCount: progressMetadata.disagree_count,
      labelsProgress: missionMetadata.labels_progress,
      labelsValidated: missionMetadata.labels_validated,
      labelTypeId: missionMetadata.label_type_id,
      missionId: missionMetadata.mission_id,
      missionType: missionMetadata.mission_type,
      unsureCount: progressMetadata.unsure_count,
      skipped: missionMetadata.skipped,
    };
    const mission = new Mission(metadata);
    this.addAMission(mission);
    svv.modalMission.setMissionMessage(mission);
    svv.statusField.updateLabelText(svv.labelTypes[mission.getProperty('labelTypeId')]);
  }

  /**
   * Returns the current mission in progress.
   * @returns Mission object for the current mission.
   */
  getCurrentMission() {
    return this.#currentMission;
  }

  /**
   * Updates the status of the current mission.
   */
  updateAMission() {
    this.#currentMission.updateMissionProgress(false);
  }

  /**
   * Updates the status of the current mission if client clicked the undo button.
   */
  updateAMissionUndoValidation() {
    this.#currentMission.updateMissionProgress(true);
  }
}
