/**
 * This function acts as a liason between the the mission factory and mission container.
 * @constructor
 */
function MissionModel () {
    var self = this;
    self._currentMission = null;
    self._completedMissions = [];

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
        console.log("Adding a mission");
        if (mission.getProperty("isComplete")) {
            self._completedMissions.push(mission);
        } else {
            self._currentMission = mission;
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
            labelsProgress : missionMetadata.validate_progress,
            labelsValidated : missionMetadata.validate_total,
            missionId : missionMetadata.mission_id,
            missionType : missionMetadata.mission_type,
            skipped : missionMetadata.skipped
        };
        var mission = new Mission(metadata);
        console.log(mission.getProperty("missionType"));
        _addAMission(mission);
    }

    /**
     * Events that trigger functions
     */
    self.on("MissionModel:createAMission", function (mission) {
        console.log("JSON mission");
        console.log(mission);
        _createAMission(mission);
    });

    self.on("MissionModel:addAMission", function (mission) {
        console.log("Adding a mission...");
        _addAMission(mission);
    });

    self.on("MissionModel:updateAMission", function (mission) {
       console.log("Updating a mission...");
    });

    return self;
}