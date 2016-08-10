/**
 * MissionContainer module
 * @param statusFieldMission.
 * @param missionModel. Mission model object.
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionContainer (statusFieldMission, missionModel) {
    var self = { className: "MissionContainer" },
        missionStoreByRegionId = { "noRegionId" : []},
        completedMissions = [],
        staged = [],
        currentMission = null;

    var _missionModel = missionModel;

    _missionModel.on("MissionProgress:complete", function (mission) {
        addToCompletedMissions(mission);
        _missionModel.submitMissions([mission]);
    });

    _missionModel.on("MissionContainer:addAMission", function (mission) {
        addAMission(mission.getProperty("regionId"), mission);
        if (mission.isCompleted()) {
            addToCompletedMissions(mission);
        }
    });

    /**
     * This method is called once all the missions are loaded. It sets the auditDistance, auditDistanceFt, and
     * auditDistanceMi of all the missions in the container.
     * @private
     */
    function _onLoadComplete () {
        var regionIds = Object.keys(missionStoreByRegionId);

        for (var ri = 0, rlen = regionIds.length; ri < rlen; ri++) {
            var regionId = regionIds[ri];
            var distance, distanceFt, distanceMi;
            for (var mi = 0, mlen = missionStoreByRegionId[regionId].length; mi < mlen; mi++) {
                if (mi == 0) {
                    missionStoreByRegionId[regionId][mi].setProperty("auditDistance", missionStoreByRegionId[regionId][mi].getProperty("distance"));
                    missionStoreByRegionId[regionId][mi].setProperty("auditDistanceFt", missionStoreByRegionId[regionId][mi].getProperty("distanceFt"));
                    missionStoreByRegionId[regionId][mi].setProperty("auditDistanceMi", missionStoreByRegionId[regionId][mi].getProperty("distanceMi"));
                } else {
                    distance = missionStoreByRegionId[regionId][mi].getProperty("distance") - missionStoreByRegionId[regionId][mi - 1].getProperty("distance");
                    distanceFt = missionStoreByRegionId[regionId][mi].getProperty("distanceFt") - missionStoreByRegionId[regionId][mi - 1].getProperty("distanceFt");
                    distanceMi = missionStoreByRegionId[regionId][mi].getProperty("distanceMi") - missionStoreByRegionId[regionId][mi - 1].getProperty("distanceMi");
                    missionStoreByRegionId[regionId][mi].setProperty("auditDistance", distance);
                    missionStoreByRegionId[regionId][mi].setProperty("auditDistanceFt", distanceFt);
                    missionStoreByRegionId[regionId][mi].setProperty("auditDistanceMi", distanceMi);
                }
            }
        }
    }

    /**
     * Adds a mission into data structure.
     * @param regionId
     * @param mission
     */
    function addAMission(regionId, mission) {
        if (regionId || regionId === 0) {
            if (!(regionId in missionStoreByRegionId)) {
                missionStoreByRegionId[regionId] = [];
            }
        } else {
            regionId = "noRegionId";
        }

        var existingMissionIds = missionStoreByRegionId[regionId].map(function (m) { return m.getProperty("missionId"); });
        if (existingMissionIds.indexOf(mission.getProperty("missionId")) < 0) {
            missionStoreByRegionId[regionId].push(mission);
        }
    }

    /** Push the completed mission */
    function addToCompletedMissions (mission) {
        completedMissions.push(mission);

        if ("regionId" in mission) {
            // Add the region id to missionStoreByRegionId if it's not there already
            if (!getMissionsByRegionId(mission.regionId)) missionStoreByRegionId[mission.regionId] = [];

            // Add the mission into missionStoreByRegionId if it's not there already
            var missionIds = missionStoreByRegionId[mission.regionId].map(function (x) { return x.missionId; });
            if (missionIds.indexOf(mission.missionId) < 0) missionStoreByRegionId[regionId].push(mission);
        }
    }


    /** Get current mission */
    function getCurrentMission () {
        return currentMission;
    }

    /**
     * Get a mission stored in the missionStoreByRegionId.
     * @param regionId
     * @param label
     * @param level
     * @returns {*}
     */
    function getMission(regionId, label, level) {
        if (!regionId) regionId = "noRegionId";
        var missions = missionStoreByRegionId[regionId],
            i,
            len = missions.length;

        for (i = 0; i < len; i++) {
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
        return completedMissions;
    }

    /**
     * Get all the completed missions with the given region id
     *
     * @param regionId A region id
     * @returns {*}
     */
    function getMissionsByRegionId (regionId) {
        if (!(regionId in missionStoreByRegionId)) missionStoreByRegionId[regionId] = [];
        var missions = missionStoreByRegionId[regionId];
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
        return Object.keys(missionStoreByRegionId);
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
    function nextMission (regionId) {
        var missions = getMissionsByRegionId (regionId);
        missions = missions.filter(function (m) { return !m.isCompleted(); });

        /**
         * Check if there are more missions remaining.
         */
        if (missions.length > 0) {
            missions.sort(function (m1, m2) {
                var d1 = m1.getProperty("distance"), d2 = m2.getProperty("distance");
                return d1 - d2;
            });
            return missions[0];
        } else {
            // If no more missions are available in this neighborhood, get a mission from other neighborhood.
            // Todo.
            // while (!nextMission) {
            //     // If not more mission is available in the current neighborhood, get missions from the next neighborhood.
            //     var availableRegionIds = missionContainer.getAvailableRegionIds();
            //     var newRegionId = neighborhoodContainer.getNextRegionId(neighborhoodId, availableRegionIds);
            //     nextMission = missionContainer.nextMission(newRegionId);
            //     movedToANewRegion = true;
            // }
            return null;
        }
    }

    /**
     *
     */
    function refresh () {
        missionStoreByRegionId = { "noRegionId" : [] };
        completedMissions = [];
        staged = [];
        currentMission = null;
    }

    /**
     * This method sets the current mission
     * @param mission {object} A Mission object
     * @returns {setCurrentMission}
     */
    function setCurrentMission (mission) {
        currentMission = mission;
        statusFieldMission.printMissionMessage(mission);
        return this;
    }

    // _init(parameters);

    self._onLoadComplete = _onLoadComplete;
    self.addToCompletedMissions = addToCompletedMissions;
    self.add = addAMission;
    self.getAvailableRegionIds = getAvailableRegionIds;
    self.getCompletedMissions = getCompletedMissions;
    self.getCurrentMission = getCurrentMission;
    self.getMission = getMission;
    self.getMissionsByRegionId = getMissionsByRegionId;
    self.isTheFirstMission = isTheFirstMission;
    self.nextMission = nextMission;
    self.refresh = refresh;
    self.setCurrentMission = setCurrentMission;
    return self;
}