/**
 *
 * @returns {MissionModel}
 * @constructor
 */
function MissionModel () {
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
        // console.log("[Mission.js] Adding a mission");
        if (mission.getProperty("isComplete")) {
            completedMissions.push(mission);
        } else {
            currentMission = mission;
        }
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
        // console.log(mission.getProperty("missionType"));
        // console.log(mission.getProperty("labelsProgress"));
        // console.log(mission.getProperty("labelsValidated"));
        _addAMission(mission);
    }

    function getCurrentMission() {
        return currentMission;
    }

    /**
     * Events that trigger mission creation and updating functions
     */
    self.on("MissionModel:createAMission", function (mission) {
        // console.log("[MissionModel.js] createAMission mission");
        // console.log(mission);
        _createAMission(mission);
    });

    self.on("MissionModel:addAMission", function (mission) {
        // console.log("[MissionModel.js] Adding a mission...");
        _addAMission(mission);
    });

    self.on("MissionModel:updateAMission", function (mission) {
       // console.log("[MissionModel.js] Updating a mission...");
    });

    self.getCurrentMission = getCurrentMission;

    return self;
}