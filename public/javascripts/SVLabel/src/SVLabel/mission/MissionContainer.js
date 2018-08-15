/**
 * MissionContainer module
 * @param statusFieldMission.  TODO The module should communicate with the statusFieldMission via StatusModel.
 * @param missionModel. Mission model object.
 * @param parameters
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
    var tasksMissionsOffset= 0;

    var _missionModel = missionModel;

    _missionModel.on("MissionProgress:complete", function (parameters) {
        var mission = parameters.mission;
        self.addToCompletedMissions(mission);
        _missionModel.submitMissions([mission]);
    });

    _missionModel.on("MissionContainer:addAMission", function (mission) {
        var nPrevMiss = self._completedMissions.length;
        var lastMission = nPrevMiss > 0 ? self._completedMissions[nPrevMiss - 1] : null;
        if (!lastMission || lastMission.getProperty("label") === "onboarding") {
            mission.setProperty("auditDistance", mission.getProperty("distance"));
            mission.setProperty("auditDistanceFt", mission.getProperty("distanceFt"));
            mission.setProperty("auditDistanceMi", mission.getProperty("distanceMi"));
        } else {
            var distance = mission.getProperty("distance") - lastMission.getProperty("distance");
            var distanceFt = mission.getProperty("distanceFt") - lastMission.getProperty("distanceFt");
            var distanceMi = mission.getProperty("distanceMi") - lastMission.getProperty("distanceMi");
            mission.setProperty("auditDistance", distance);
            mission.setProperty("auditDistanceFt", distanceFt);
            mission.setProperty("auditDistanceMi", distanceMi);
        }
        if (mission.getProperty("isCompleted")) {
            self._completedMissions.push(mission);
        } else {
            self._currentMission = mission;
        }
    });

    _missionModel.on("MissionModel:loadComplete", function () {
        _onLoadComplete();
    });

    /**
     * This method is called once all the missions are loaded. It sets the auditDistance, auditDistanceFt, and
     * auditDistanceMi of all the missions in the container.
     * @private
     */
    function _onLoadComplete () {
        var distance, distanceFt, distanceMi;
        for (var mi = 0, mlen = self._completedMissions.length; mi < mlen; mi++) {
            if (mi === 0) {
                self._completedMissions[mi].setProperty("auditDistance", self._completedMissions[mi].getProperty("distance"));
                self._completedMissions[mi].setProperty("auditDistanceFt", self._completedMissions[mi].getProperty("distanceFt"));
                self._completedMissions[mi].setProperty("auditDistanceMi", self._completedMissions[mi].getProperty("distanceMi"));
            } else {
                distance = self._completedMissions[mi].getProperty("distance") - self._completedMissions[mi - 1].getProperty("distance");
                distanceFt = self._completedMissions[mi].getProperty("distanceFt") - self._completedMissions[mi - 1].getProperty("distanceFt");
                distanceMi = self._completedMissions[mi].getProperty("distanceMi") - self._completedMissions[mi - 1].getProperty("distanceMi");
                self._completedMissions[mi].setProperty("auditDistance", distance);
                self._completedMissions[mi].setProperty("auditDistanceFt", distanceFt);
                self._completedMissions[mi].setProperty("auditDistanceMi", distanceMi);
            }
        }
        if (getCurrentMission()) {
            var lastMission = self._completedMissions[self._completedMissions.length - 1];
            distance = self._currentMission.getProperty("distance") - lastMission.getProperty("distance");
            distanceFt = self._currentMission.getProperty("distanceFt") - lastMission.getProperty("distanceFt");
            distanceMi = self._currentMission.getProperty("distanceMi") - lastMission.getProperty("distanceMi");
            self._currentMission.setProperty("auditDistance", distance);
            self._currentMission.setProperty("auditDistanceFt", distanceFt);
            self._currentMission.setProperty("auditDistanceMi", distanceMi);

        }
    }

    /** Push the completed mission */
    this.addToCompletedMissions = function (mission) {
        var existingMissionIds = self._completedMissions.map(function (m) { return m.getProperty("missionId")});
        var currentMissionId = mission.getProperty("missionId");
        if (existingMissionIds.indexOf(currentMissionId) < 0) {
            self._completedMissions.push(mission);
        }
    };

    this.onlyMissionOnboardingDone = function (){
       return self._completedMissions.length === 1 && self._completedMissions[0].getProperty("label") === "onboarding" && !svl.storage.get("completedFirstMission");
    };

    /** Get current mission */
    function getCurrentMission () {
        return self._currentMission;
    }

    /**
     * Get a mission stored in the self._completedMissions.
     * @param label
     * @param level
     * @returns {*}
     */
    function getMission(label, level) {
        for (var i = 0, len = self._completedMissions.length; i < len; i++) {
            if (self._completedMissions[i].getProperty("label") === label) {
                if (level) {
                    if (level === self._completedMissions[i].getProperty("level")) {
                        return self._completedMissions[i];
                    }
                } else {
                    return self._completedMissions[i];
                }
            }
        }
        return null;
    }
    
    /**
     * Get all the completed missions
     */
    function getCompletedMissions () {
        return self._completedMissions;
    }

    // TODO this needs to be reimplemented to query database, but really I just think that the back-end will decide for us during nextMission?
    this.getNeighborhoodCompleteMission = function (regionId) {
        // if (typeof regionId == "undefined") throw "MissionContainer.getNeighborhoodCompleteMission: regionId undefined";
        // var missions = self.getMissionsByRegionId(regionId);
        // missions = missions.filter(function (mission) {
        //     return mission.getProperty("label") == "area-coverage-mission" &&
        //         mission.getProperty("coverage") == 1.0;
        // });
        //
        // return missions.length > 0 ? missions[0] : null;
    };

    /**
     * Checks if this is the first mission or not.
     * @returns {boolean}
     */
    function isTheFirstMission () {
        return getCompletedMissions().length == 0 && !svl.storage.get("completedFirstMission");
    }

    /**
     *
     * TODO this will probably end up calling an endpoint to get the next mission, or that might get moved to ModalMissionComplete.js
     * @returns {*}
     */
    this.nextMission = function () {

        var url = "/nextMission/" + self._currentMission.getProperty("regionId"),
            async = false;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'get',
            dataType: 'json',
            success: function (result) {
                console.log("success");
                console.log(result);
                var missionParameters = {
                    regionId: result.region_id,
                    missionId: result.mission_id,
                    label: result.label,
                    level: result.level,
                    distance: result.distance,
                    distanceFt: result.distance_ft,
                    distanceMi: result.distance_mi,
                    coverage: result.coverage,
                    isCompleted: result.is_completed
                };
                missionModel.createAMission(missionParameters);
            },
            error: function (result) {
                console.error(result);
            }
        });
    };


    this.refresh = function () {
        self._completedMissions = [];
        self._currentMission = null;
    };

    /**
     * This method sets the current mission
     * @param mission {object} A Mission object
     * @returns {setCurrentMission}
     */
    this.setCurrentMission = function (mission) {
        self._currentMission = mission;
        statusFieldMission.setMessage(mission);
        return this;
    };

    function setTasksMissionsOffset(value) {
        tasksMissionsOffset = value;
    }

    function getTasksMissionsOffset(value) {
        // See issue https://github.com/ProjectSidewalk/SidewalkWebpage/issues/297
        // Check pull request for more details
        return tasksMissionsOffset;
    }

    self._onLoadComplete = _onLoadComplete;
    self.getCompletedMissions = getCompletedMissions;
    self.getCurrentMission = getCurrentMission;
    self.getMission = getMission;
    self.isTheFirstMission = isTheFirstMission;
    self.setTasksMissionsOffset = setTasksMissionsOffset;
    self.getTasksMissionsOffset = getTasksMissionsOffset;
}

