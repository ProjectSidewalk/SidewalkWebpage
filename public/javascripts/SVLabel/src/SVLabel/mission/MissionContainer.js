/**
 * MissionContainer module
 * @param statusFieldMission.  Todo. The module should communicate with the statusFieldMission via StatusModel.
 * @param missionModel. Mission model object.
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionContainer (statusFieldMission, missionModel, taskModel) {
    var self = this;
    this._missionStoreByRegionId = { "noRegionId" : []};
    this._completedMissions = [];
    this._currentMission = null;

    var _missionModel = missionModel;

    _missionModel.on("MissionProgress:complete", function (mission) {
        self.addToCompletedMissions(mission);
        _missionModel.submitMissions([mission]);
    });

    _missionModel.on("MissionContainer:addAMission", function (mission) {
        var regionId = mission.getProperty("regionId");
        self.add(regionId, mission);
        if (mission.isCompleted()) {
            self.addToCompletedMissions(mission);
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
        var regionIds = Object.keys(self._missionStoreByRegionId);

        for (var ri = 0, rlen = regionIds.length; ri < rlen; ri++) {
            var regionId = regionIds[ri];
            var distance, distanceFt, distanceMi;
            for (var mi = 0, mlen = self._missionStoreByRegionId[regionId].length; mi < mlen; mi++) {
                if (mi == 0) {
                    self._missionStoreByRegionId[regionId][mi].setProperty("auditDistance", self._missionStoreByRegionId[regionId][mi].getProperty("distance"));
                    self._missionStoreByRegionId[regionId][mi].setProperty("auditDistanceFt", self._missionStoreByRegionId[regionId][mi].getProperty("distanceFt"));
                    self._missionStoreByRegionId[regionId][mi].setProperty("auditDistanceMi", self._missionStoreByRegionId[regionId][mi].getProperty("distanceMi"));
                } else {
                    distance = self._missionStoreByRegionId[regionId][mi].getProperty("distance") - self._missionStoreByRegionId[regionId][mi - 1].getProperty("distance");
                    distanceFt = self._missionStoreByRegionId[regionId][mi].getProperty("distanceFt") - self._missionStoreByRegionId[regionId][mi - 1].getProperty("distanceFt");
                    distanceMi = self._missionStoreByRegionId[regionId][mi].getProperty("distanceMi") - self._missionStoreByRegionId[regionId][mi - 1].getProperty("distanceMi");
                    self._missionStoreByRegionId[regionId][mi].setProperty("auditDistance", distance);
                    self._missionStoreByRegionId[regionId][mi].setProperty("auditDistanceFt", distanceFt);
                    self._missionStoreByRegionId[regionId][mi].setProperty("auditDistanceMi", distanceMi);
                }
            }
        }
    }

    /**
     * Adds a mission into data structure.
     * @param regionId
     * @param mission
     */
    this.add = function (regionId, mission) {
        if (regionId || regionId === 0) {
            if (!(regionId in self._missionStoreByRegionId)) {
                self._missionStoreByRegionId[regionId] = [];
            }
        } else {
            regionId = "noRegionId";
        }

        var currentMissionId = mission.getProperty("missionId");
        var existingMissionIds = self._missionStoreByRegionId[regionId].map(function (m) { return m.getProperty("missionId"); });
        if (existingMissionIds.indexOf(currentMissionId) < 0) {
            self._missionStoreByRegionId[regionId].push(mission);
        }
    };

    /** Push the completed mission */
    this.addToCompletedMissions = function (mission) {
        var existingMissionIds = self._completedMissions.map(function (m) { return m.getProperty("missionId")});
        var currentMissionId = mission.getProperty("missionId");
        if (existingMissionIds.indexOf(currentMissionId) < 0) {
            self._completedMissions.push(mission);
        }

        if ("regionId" in mission) {
            // Add the region id to self._missionStoreByRegionId if it's not there already
            if (!getMissionsByRegionId(mission.regionId)) self._missionStoreByRegionId[mission.regionId] = [];

            // Add the mission into self._missionStoreByRegionId if it's not there already
            var missionIds = self._missionStoreByRegionId[mission.regionId].map(function (x) { return x.missionId; });
            if (missionIds.indexOf(mission.missionId) < 0) self._missionStoreByRegionId[regionId].push(mission);
        }
    };


    /** Get current mission */
    function getCurrentMission () {
        return self._currentMission;
    }

    /**
     * Get a mission stored in the self._missionStoreByRegionId.
     * @param regionId
     * @param label
     * @param level
     * @returns {*}
     */
    function getMission(regionId, label, level) {
        if (!regionId) regionId = "noRegionId";
        var missions = self._missionStoreByRegionId[regionId];

        for (var i = 0, len = missions.length; i < len; i++) {
            if (missions[i].getProperty("label") == label) {
                if (level) {
                    if (level == missions[i].getProperty("level")) {
                        return missions[i];
                    }
                } else {
                    return missions[i];
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

    this.getIncompleteMissionsByRegionId = function (regionId) {
        var missions = self.getMissionsByRegionId(regionId);
        return missions.filter(function (mission) { return !mission.getProperty("isCompleted"); });
    };

    /**
     * Get all the completed missions with the given region id
     *
     * @param regionId A region id
     * @returns {*}
     */
    function getMissionsByRegionId (regionId) {
        if (!(regionId in self._missionStoreByRegionId)) self._missionStoreByRegionId[regionId] = [];
        var missions = self._missionStoreByRegionId[regionId];
        missions.sort(function(m1, m2) {
            var d1 = m1.getProperty("distance"),
                d2 = m2.getProperty("distance");
            if (!d1) d1 = 0;
            if (!d2) d2 = 0;
            return d1 - d2;
        });
        return missions;
    }

    function getAvailableRegionIds () {
        return Object.keys(self._missionStoreByRegionId);
    }

    /**
     * Checks if this is the first mission or not.
     * @returns {boolean}
     */
    function isTheFirstMission () {
        return getCompletedMissions().length == 0;
    }

    /**
     *
     * @param regionId
     * @returns {*}
     */
    this.nextMission = function (regionId) {
        var missions = getMissionsByRegionId (regionId);
        missions = missions.filter(function (m) { return !m.isCompleted(); });
        missions.sort(function (m1, m2) {
            var d1 = m1.getProperty("distance"), d2 = m2.getProperty("distance");
            return d1 - d2;
        });

        /**
         * Check if there are more missions remaining.
         */
        if (missions.length > 0 && taskModel.tasksAreAvailableInARegion(regionId)) {
            return missions[0];
        }

        var nextRegionId = this._findARegionWithMission(regionId);
        missions = missions = self._missionStoreByRegionId[nextRegionId];
        missions = missions.filter(function (m) { return !m.isCompleted(); });
        return missions[0];
    };

    this._getANextRegionId = function (currentRegionId) {
        var currentRegionId = currentRegionId.toString();
        var regionIds = Object.keys(self._missionStoreByRegionId);
        regionIds = regionIds.map(function (key) { return key.toString(); });
        regionIds = regionIds.filter(function (regionId) { return regionId != "noRegionId"; });

        var currentRegionIdIndex = regionIds.indexOf(currentRegionId);
        var nextRegionIdIndex = currentRegionIdIndex + 1;
        if (nextRegionIdIndex < 0 || nextRegionIdIndex >= regionIds.length) {
            nextRegionIdIndex = 0;
        }
        return regionIds[nextRegionIdIndex];
    };

    this._findARegionWithMission = function (currentRegionId) {
        var nextRegionId = self._getANextRegionId(currentRegionId);
        var missions = self._missionStoreByRegionId[nextRegionId];
        missions = missions.filter(function (m) { return !m.isCompleted(); });
        while (missions.length == 0) {
            nextRegionId = self._getANextRegionId(nextRegionId);
            if (nextRegionId == currentRegionId) throw Error("No missions available");
            missions = self._missionStoreByRegionId[nextRegionId];
            missions = missions.filter(function (m) { return !m.isCompleted(); });
        }
        return nextRegionId;
    };


    this.refresh = function () {
        self._missionStoreByRegionId = { "noRegionId" : [] };
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

    self._onLoadComplete = _onLoadComplete;
    self.getAvailableRegionIds = getAvailableRegionIds;
    self.getCompletedMissions = getCompletedMissions;
    self.getCurrentMission = getCurrentMission;
    self.getMission = getMission;
    self.getMissionsByRegionId = getMissionsByRegionId;
    self.isTheFirstMission = isTheFirstMission;
}

