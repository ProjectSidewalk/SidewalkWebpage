/**
 *
 * @returns {MissionContainer}
 * @constructor
 */
function MissionContainer () {
    var self = this;
    var currentMission = undefined;
    var completedMissions = [];

    _init();

    function _init() {
        _.extend(self, Backbone.Events);
    }

    /**
     * Adds a mission to in progress or list of completed missions
     * @param missionMetadata
     * @private
     */
    function _addAMission(mission) {
        console.log("[Mission.js] Adding a mission");
        if (mission.getProperty("isComplete")) {
            completedMissions.push(mission);
            console.log("mission is complete");
        } else {
            currentMission = mission;
            console.log("currentMission set");
            console.log(currentMission);
        }
        return this;
    }

    /**
     * Creates a mission by parsing a JSON file
     * @param missionMetadata   JSON representation of mission (from backend)
     * @private
     */
    function _createAMission(missionMetadata) {
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
        _addAMission(mission);
    }

    function getCurrentMission() {
        return currentMission;
    }

    /**
     * Events that trigger mission creation and updating functions
     */
    self.on("MissionContainer:createAMission", function (mission) {
        console.log("[MissionContainer.js] createAMission mission");
        console.log(mission);
        _createAMission(mission);
    });

    self.on("MissionContainer:addAMission", function (mission) {
        console.log("[MissionContainer.js] Adding a mission...");
        _addAMission(mission);
    });

    self.on("MissionContainer:updateAMission", function () {
       console.log("[MissionContainer.js] Updating a mission...");
       currentMission.updateMissionProgress();
    });

    self.getCurrentMission = getCurrentMission;

    return self;
}