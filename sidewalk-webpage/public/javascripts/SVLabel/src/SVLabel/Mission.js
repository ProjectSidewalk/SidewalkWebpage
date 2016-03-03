/**
 * Mission module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 */
function Mission(parameters) {
    var self = { className: "Mission" },
        properties = {
            regionId: null,
            label: null,
            missionId: null,
            level: null,
            isCompleted: false
        };

    function _init(parameters) {
        if ("regionId" in parameters) setProperty("regionId", parameters.regionId);
        if ("label" in parameters) setProperty("label", parameters.label);
        if ("missionId" in parameters) setProperty("missionId", parameters.missionId);
        if ("level" in parameters) setProperty("level", parameters.level);
        if ("distance" in parameters) setProperty("distance", parameters.distance);
        if ("coverage" in parameters) setProperty("coverage", parameters.coverage);
        if ("isCompleted" in parameters) setProperty("isCompleted", parameters.isCompleted);
    }

    /** Returns a property */
    function getProperty (key) {
        return key in properties ? properties[key] : key;
    }

    function isCompleted () {
        return getProperty("isCompleted");
    }

    /** Sets a property */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /** Compute the remaining audit distance till complete (in meters) */
    function remainingAuditDistanceTillComplete () {
        var label = getProperty("label");
        if (label) {
            var distance, cumulativeDistanceAudited = 0;  // Todo.
            if (label == "initial-mission") {
                distance = getProperty("level") * 1000;
                return distance - cumulativeDistanceAudited;
            } else if (label == "distance-mission") {
                distance = getProperty("level") * 1000;
                return distance - cumulativeDistanceAudited;
            } else if (label == "area-coverage-mission") {
                return Infinity;
            } else if (label == "neighborhood-coverage-mission") {
                return Infinity;  // Return infinity as this mission does not depend on distance traveled.
            } else {
                return Infinity;  // This should not happen...
            }
        } else {
            return Infinity;  // The label is not specified.
        }
    }

    function toString () {
        return "Mission: " + getProperty("label") + ", Level: "+ getProperty("level") +
            ", Distance: " + getProperty("distance") + ", Coverage " + getProperty("coverage") +
            ", Mission Id: " + getProperty("missionId") + ", Region Id: " + getProperty("regionId") +
            ", Completed: " + getProperty("isCompleted");
    }

    function getMissionCompletionRate () {
        if ("taskContainer" in svl) {
            var targetDistance = getProperty("distance") / 1000;
            var task = svl.taskContainer.getCurrentTask();

            if (task) {
                var cumulativeDistance = task.getCumulativeDistance("kilometers");
                return cumulativeDistance / targetDistance;
            } else {
                return 0;
            }
        } else {
            return 0;
        }
    }

    _init(parameters);

    self.getProperty = getProperty;
    self.getMissionCompletionRate = getMissionCompletionRate;
    self.isCompleted = isCompleted;
    self.setProperty = setProperty;
    self.remainingAuditDistanceTillComplete = remainingAuditDistanceTillComplete;
    self.toString = toString;
    return self;
}

/**
 * MissionContainer module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 */
function MissionContainer ($, parameters) {
    var self = { className: "MissionContainer" },
        missionStoreByRegionId = { "noRegionId" : []},
        completedMissions = [],
        currentMission = null;

    function _init (parameters) {
        // Query all the completed & incomplete missions.
        $.when($.ajax("/mission/complete"), $.ajax("/mission/incomplete")).done(function (result1, result2) {
            var i, len, mission, completed = result1[0], incomplete = result2[0], nm;

            len = completed.length;
            for (i = 0; i < len; i++) {
                mission = svl.missionFactory.create(completed[i].regionId, completed[i].missionId, completed[i].label,
                    completed[i].level, completed[i].distance, completed[i].coverage, true);
                add(completed[i].regionId, mission);
                addToCompletedMissions(mission);
            }

            len = incomplete.length;
            for (i = 0; i < len; i++) {
                mission = svl.missionFactory.create(incomplete[i].regionId, incomplete[i].missionId, incomplete[i].label,
                    incomplete[i].level, incomplete[i].distance, incomplete[i].coverage, false);
                add(incomplete[i].regionId, mission);
            }

            // Set the current mission.
            if (parameters.currentNeighborhood) {
                nm = nextMission(parameters.currentNeighborhood.getProperty("regionId"));
                setCurrentMission(nm);
                svl.missionProgress.showMission();
            }
        });
    }

    /** Set current missison */
    function setCurrentMission (mission) { currentMission = mission; return this; }

    /** Get current mission */
    function getCurrentMission () { return currentMission; }

    /**
     * Adds a mission into data structure.
     * @param regionId
     * @param mission
     */
    function add(regionId, mission) {
        if (regionId) {
            if (!(regionId in missionStoreByRegionId)) missionStoreByRegionId[regionId] = [];
        } else {
            regionId = "noRegionId";
        }
        missionStoreByRegionId[regionId].push(mission);
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

    /** Get all the completed missions */
    function getCompletedMissions () {
        return completedMissions;
    }

    /** Get all the completed missions with the given region id */
    function getMissionsByRegionId (regionId) {
        if (!(regionId in missionStoreByRegionId)) missionStoreByRegionId[regionId] = [];
        return missionStoreByRegionId[regionId];
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

    _init(parameters);

    self.addToCompletedMissions = addToCompletedMissions;
    self.add = add;
    self.getCompletedMissions = getCompletedMissions;
    self.getCurrentMission = getCurrentMission;
    self.getMissionsByRegionId = getMissionsByRegionId;
    self.nextMission = nextMission;
    return self;
}

/**
 * MissionFactory module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 */
function MissionFactory (parameters) {
    var self = { className: "MissionFactory"};

    function _init (parameters) {
        if (parameters) {}
    }

    /** Create an instance of a mission object */
    function create (regionId, missionId, label, level, distance, coverage, isCompleted) {
        return new Mission({ regionId: regionId, missionId: missionId, label: label, level: level, distance: distance,
            coverage: coverage, isCompleted: isCompleted });
    }

    _init(parameters);

    self.create = create;
    return self;
}