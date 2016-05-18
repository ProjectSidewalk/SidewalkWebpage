/**
 * MissionContainer module
 * @param $ jQuery object
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionContainer ($, parameters) {
    var self = { className: "MissionContainer" },
        missionStoreByRegionId = { "noRegionId" : []},
        completedMissions = [],
        staged = [],
        currentMission = null;

    function _init (parameters) {
        parameters = parameters || {};
        // Query all the completed & incomplete missions.
        function _callback (result1, result2) {
            var i, len, mission, completed = result1[0], incomplete = result2[0], nm;

            len = completed.length;
            for (i = 0; i < len; i++) {
                mission = svl.missionFactory.create(completed[i].regionId, completed[i].missionId, completed[i].label,
                    completed[i].level, completed[i].distance, completed[i].distance_ft, completed[i].distance_mi, completed[i].coverage, true);
                addAMission(completed[i].regionId, mission);
                addToCompletedMissions(mission);
            }

            len = incomplete.length;
            for (i = 0; i < len; i++) {
                mission = svl.missionFactory.create(incomplete[i].regionId, incomplete[i].missionId, incomplete[i].label,
                    incomplete[i].level, incomplete[i].distance, incomplete[i].distance_ft, incomplete[i].distance_mi, incomplete[i].coverage, false);
                addAMission(incomplete[i].regionId, mission);
            }

            // Set the current mission.
            if (parameters.currentNeighborhood) {
                nm = nextMission(parameters.currentNeighborhood.getProperty("regionId"));
                setCurrentMission(nm);
            }
        }
        
        if ("callback" in parameters) {
            $.when($.ajax("/mission/complete"), $.ajax("/mission/incomplete")).done(_callback).done(parameters.callback);
        } else {
            $.when($.ajax("/mission/complete"), $.ajax("/mission/incomplete")).done(_callback)
        }
    }

    /**
     * Adds a mission into data structure.
     * @param regionId
     * @param mission
     */
    function addAMission(regionId, mission) {
        if (regionId || regionId === 0) {
            if (!(regionId in missionStoreByRegionId)) missionStoreByRegionId[regionId] = [];
        } else {
            regionId = "noRegionId";
        }

        var m = getMission(mission.getProperty("regionId"), mission.getProperty("label"), mission.getProperty("level"));
        if (!m) {
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

            if ("form" in svl && svl.form) {
                svl.form.postJSON("/mission", data);
            }
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
            i, len = missions.length;
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
            svl.missionProgress.update();
            svl.missionStatus.printMissionMessage(mission);
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

    self.addToCompletedMissions = addToCompletedMissions;
    self.add = addAMission;
    self.commit = commit;
    self.getCompletedMissions = getCompletedMissions;
    self.getCurrentMission = getCurrentMission;
    self.getMission = getMission;
    self.getMissionsByRegionId = getMissionsByRegionId;
    self.nextMission = nextMission;
    self.refresh = refresh;
    self.stage = stage;
    self.setCurrentMission = setCurrentMission;
    return self;
}