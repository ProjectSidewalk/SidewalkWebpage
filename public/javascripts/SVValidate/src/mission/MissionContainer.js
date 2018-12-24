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
        console.log("[Mission.js] Adding a mission");
        if (mission.getProperty("completed")) {
            console.log("[Mission.js] Mission is complete");
            _addToCompletedMissions(mission);
        } else {
            currentMission = mission;
            svv.statusField.reset(mission);
            console.log("[Mission.js] currentMission set");
            console.log(currentMission);
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
        console.log("existingMissionIds: ");
        console.log(existingMissionIds);
        var currentMissionId = mission.getProperty("missionId");
        console.log("currentMissionId: " + currentMissionId);
        if (existingMissionIds.indexOf(currentMissionId) < 0) {
            _completedMissions.push(mission);
        } else {
            console.log("Oops, we are trying to add to completed missions array multiple times.")
        }
    }

    /**
     * Submits this mission to the backend.
     */
    function completeAMission () {
        var data = svv.form.compileSubmissionData();
        svv.form.submit(data, true);
        _addToCompletedMissions(currentMission);
    }

    /**
     * Creates a mission by parsing a JSON file
     * @param missionMetadata   JSON metadata for mission (from backend)
     * @private
     */
    function createAMission(missionMetadata) {
        console.log("[MissionContainer.js] createAMission mission");
        var metadata = {
            completed : missionMetadata.completed,
            labelsProgress : missionMetadata.labels_progress,
            labelsValidated : missionMetadata.labels_validated,
            missionId : missionMetadata.mission_id,
            missionType : missionMetadata.mission_type,
            skipped : missionMetadata.skipped
        };
        var mission = new Mission(metadata);
        console.log("Creating a mission");
        console.log(mission);
        addAMission(mission);
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
        currentMission.updateMissionProgress();
    }

    self.addAMission = addAMission;
    self.completeAMission = completeAMission;
    self.createAMission = createAMission;
    self.getCurrentMission = getCurrentMission;
    self.updateAMission = updateAMission;

    return this;
}