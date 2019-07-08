/**
 *
 * @returns {MissionContainer}
 * @constructor
 */
function MissionContainer () {
    var self = this;
    var currentMission = undefined;
    var _completedMissions = [];

    /**
     * Adds a mission to in progress or list of completed missions
     * @param mission
     * @private
     */
    function addAMission(mission) {
        if (mission.getProperty("completed")) {
            _addToCompletedMissions(mission);
        } else {
            currentMission = mission;
            svv.statusField.reset(mission);
        }
        return this;
    }

    /**
     * This function adds the current mission to a list of completed missions.
     * @param mission  Mission object of the current mission.
     * @private
     */
    function _addToCompletedMissions(mission) {
        var existingMissionIds = _completedMissions.map(function (m) {
            return m.getProperty("missionId")
        });
        var currentMissionId = mission.getProperty("missionId");
        if (existingMissionIds.indexOf(currentMissionId) < 0) {
            _completedMissions.push(mission);
        }
    }

    /**
     * Submits this mission to the backend.
     */
    function completeAMission () {
        svv.missionsCompleted += 1;
        svv.modalMissionComplete.show(currentMission);
        var data = svv.form.compileSubmissionData();
        svv.form.submit(data, true);
        _addToCompletedMissions(currentMission);
    }

    /**
     * Creates a mission by parsing a JSON file
     * @param missionMetadata   JSON metadata for mission (from backend)
     * @param progressMetadata  JSON metadata about mission progress
     *                          (counts of agree/disagree/unsure labels for this mission)
     * @private
     */
    function createAMission(missionMetadata, progressMetadata) {
        var metadata = {
            agreeCount: progressMetadata.agree_count,
            completed : missionMetadata.completed,
            disagreeCount: progressMetadata.disagree_count,
            labelsProgress : missionMetadata.labels_progress,
            labelsValidated : missionMetadata.labels_validated,
            labelTypeId : missionMetadata.label_type_id,
            missionId : missionMetadata.mission_id,
            missionType : missionMetadata.mission_type,
            notSureCount: progressMetadata.not_sure_count,
            skipped : missionMetadata.skipped,
            pay: missionMetadata.pay
        };
        var mission = new Mission(metadata);
        addAMission(mission);
        svv.modalMission.setMissionMessage(mission);
    }

    /**
     * Returns the current mission in progress.
     * @returns Mission object for the current mission.
     */
    function getCurrentMission() {
        return currentMission;
    }

    /**
     * Updates the status of the current mission.
     */
    function updateAMission() {
        currentMission.updateMissionProgress(false);
    }

    /**
     * Updates the status of the current mission if client clicked the skip button.
     */
    function updateAMissionSkip() {
        currentMission.updateMissionProgress(true);
    }

    self.addAMission = addAMission;
    self.completeAMission = completeAMission;
    self.createAMission = createAMission;
    self.getCurrentMission = getCurrentMission;
    self.updateAMission = updateAMission;
    self.updateAMissionSkip = updateAMissionSkip;

    return this;
}
