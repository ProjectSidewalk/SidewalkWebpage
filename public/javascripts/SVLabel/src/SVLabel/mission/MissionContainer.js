/**
 * MissionContainer module
 * @param statusFieldMission.  TODO The module should communicate with the statusFieldMission via StatusModel.
 * @param missionModel. Mission model object.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionContainer (statusFieldMission, missionModel) {
    var self = this;
    this._completedMissions = [];
    this._currentMission = null;

    /*
    This variable keeps the distance of completed missions minus completed audits to fix the problem that
    is discussed here: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/297#issuecomment-259697107
     */
    var tasksMissionsOffset = null;

    var _missionModel = missionModel;

    _missionModel.on("MissionProgress:complete", function (parameters) {
        var mission = parameters.mission;
        self.addToCompletedMissions(mission);
    });

    _missionModel.on("MissionContainer:addAMission", function (mission) {
        if (mission.getProperty("isComplete")) {
            self._completedMissions.push(mission);
        } else {
            self.setCurrentMission(mission);
            self.notifyMissionLoaded(mission);
        }
    });

    /** Push the completed mission */
    this.addToCompletedMissions = function (mission) {
        var existingMissionIds = self._completedMissions.map(function (m) { return m.getProperty("missionId")});
        var currentMissionId = mission.getProperty("missionId");
        if (existingMissionIds.indexOf(currentMissionId) < 0) {
            mission.setProperty("distanceProgress", mission.getDistance());
            self._completedMissions.push(mission);
        } else {
            console.log("Oops, we are trying to add to completed missions array multiple times. Plz fix.")
        }
    };

    /** Get current mission */
    function getCurrentMission() {
        return self._currentMission;
    }

    /**
     * Get all the completed missions
     */
    function getCompletedMissions() {
        return self._completedMissions;
    }

    /**
     * Get the sum of the distance of all the user's completed missions in this neighborhood.
     * @param unit
     * @returns {number}
     */
    function getCompletedMissionDistance(unit) {
        if (!unit) unit = "meters";
        var completedDistance = 0;
        for (var missionIndex = 0; missionIndex < self._completedMissions.length; missionIndex++)
            completedDistance += self._completedMissions[missionIndex].getDistance(unit);
        return completedDistance;
    }

    /**
     * Checks if this is the first mission or not.
     * @returns {boolean}
     */
    function isTheFirstMission () {
        return getCompletedMissions().length === 0 && !svl.storage.get("completedFirstMission");
    }

    /**
     * This method sets the current mission
     * @param mission {object} A Mission object
     * @returns {setCurrentMission}
     */
    this.setCurrentMission = function (mission) {
        self._currentMission = mission;
        statusFieldMission.setMessage(mission);
        var currTask = svl.taskContainer.getCurrentTask();
        var missionId = mission.getProperty('missionId');
        currTask.setProperty('currentMissionId', missionId);

        // If this is the start of a new mission, mark the location along the street that the user is at when the
        // mission starts. This will be used later to draw their route on the mission complete map.
        if (mission.getProperty('distanceProgress') < 1.0 && !currTask.getProperty('tutorialTask')) {
            // Snap the current location to the nearest point on the street, and use that as the mission start.
            var currPos = turf.point([svl.map.getPosition().lng, svl.map.getPosition().lat]);
            var missionStart = turf.nearestPointOnLine(currTask.getFeature(), currPos).geometry.coordinates;
            currTask.setMissionStart(missionId, { lat: missionStart[1], lng: missionStart[0]});
        }
        return this;
    };

    function setTasksMissionsOffset(value) {
        tasksMissionsOffset = value;
    }

    function getTasksMissionsOffset() {
        // See issue https://github.com/ProjectSidewalk/SidewalkWebpage/issues/297
        // Check pull request for more details
        return tasksMissionsOffset;
    }

    self.getCompletedMissions = getCompletedMissions;
    self.getCompletedMissionDistance = getCompletedMissionDistance;
    self.getCurrentMission = getCurrentMission;
    self.isTheFirstMission = isTheFirstMission;
    self.setTasksMissionsOffset = setTasksMissionsOffset;
    self.getTasksMissionsOffset = getTasksMissionsOffset;
}
_.extend(MissionContainer.prototype, Backbone.Events);

MissionContainer.prototype.notifyMissionLoaded = function(mission) {
    this.trigger("MissionContainer:missionLoaded", mission);
};
