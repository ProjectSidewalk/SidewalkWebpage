/**
 * MissionContainer module
 * @param $ jQuery object
 * @param factory MissionFactory. Todo. I shouldn't need the factory inside this module. Refactor.
 * @param form. Todo. Again, I shouldn't need the form object here. Refactor.
 * @param progress. MissionProgress object.
 * @param missionStatus. Todo. MissionStatus object. Write a model that connects MissionContainer with MissionProgress and
 * MissionStatus. Or rather I want a model that ties all the mission related modules. Read JSTR Section 4.2.4 Building and testing the model.
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionContainer ($, factory, form, progress, missionStatus, parameters) {
    var self = { className: "MissionContainer" },
        missionStoreByRegionId = { "noRegionId" : []},
        completedMissions = [],
        staged = [],
        currentMission = null;
    
    function _init (parameters) {
        parameters = parameters || {};
        // Query all the completed & incomplete missions.
        function _callback (result1) {
            var i,
                len,
                mission,
                missions = result1,
                nm;

            function cmp (a, b) {
                var distanceA = a.distance ? a.distance : 0;
                var distanceB = b.distance ? b.distance : 0;
                return distanceA - distanceB;
            }
            missions.sort(cmp);
            len = missions.length;
            for (i = 0; i < len; i++) {
                mission = factory.create(
                    missions[i].region_id,
                    missions[i].mission_id,
                    missions[i].label,
                    missions[i].level,
                    missions[i].distance,
                    missions[i].distance_ft,
                    missions[i].distance_mi,
                    missions[i].coverage,
                    missions[i].is_completed);
                addAMission(missions[i].region_id, mission);
                if (missions[i].is_completed) {
                    addToCompletedMissions(mission);
                }
            }

            // Set the current mission.
            if (parameters.currentNeighborhood) {
                nm = nextMission(parameters.currentNeighborhood.getProperty("regionId"));
                setCurrentMission(nm);
            }
        }

        if ("callback" in parameters) {
            $.when($.ajax("/mission")).done(_callback).done(_onLoadComplete).done(parameters.callback);
        } else {
            $.when($.ajax("/mission")).done(_callback).done(_onLoadComplete)
        }
    }

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

    /**
     * Submit the currently staged missions to the server.
     * Todo. I no longer have to stage-and-commit... So I can simplify this.
     * @returns {commit}
     */
    function commit () {
        if (staged.length > 0) {
            var i, data = [];

            for (i = 0; i < staged.length; i++) {
                data.push(staged[i].toSubmissionFormat());
            }
            staged = [];
            form.postJSON("/mission", data);
        }
        return this;
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

    function nextMission (regionId) {
        var missions = getMissionsByRegionId (regionId);
        missions = missions.filter(function (m) { return !m.isCompleted(); });

        if (missions.length > 0) {
            missions.sort(function (m1, m2) {
                var d1 = m1.getProperty("distance"), d2 = m2.getProperty("distance");
                if (d1 == d2) return 0;
                else if (d1 < d2) return -1;
                else return 1;
            });
            return missions[0];
        } else {
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

        if ("missionProgress" in svl && "missionStatus" in svl) {
            progress.update();
            missionStatus.printMissionMessage(mission);
        }
        return this;
    }

    /**
     * Push the completed mission to the staged so it will be submitted to the server.
     * Todo. I no longer have to stage-and-commit... So I can simplify this.
     * @param mission
     */
    function stage (mission) {
        staged.push(mission);
        return this;
    }

    _init(parameters);

    self._onLoadComplete = _onLoadComplete;
    self.addToCompletedMissions = addToCompletedMissions;
    self.add = addAMission;
    self.commit = commit;
    self.getAvailableRegionIds = getAvailableRegionIds;
    self.getCompletedMissions = getCompletedMissions;
    self.getCurrentMission = getCurrentMission;
    self.getMission = getMission;
    self.getMissionsByRegionId = getMissionsByRegionId;
    self.isTheFirstMission = isTheFirstMission;
    self.nextMission = nextMission;
    self.refresh = refresh;
    self.stage = stage;
    self.setCurrentMission = setCurrentMission;
    return self;
}