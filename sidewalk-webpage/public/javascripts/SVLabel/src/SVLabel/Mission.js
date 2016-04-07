/**
 * Mission module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Mission(parameters) {
    var self = { className: "Mission" },
        properties = {
            regionId: null,
            label: null,
            missionId: null,
            level: null,
            isCompleted: false,
            instruction: null,
            completionMessage: null,
            badgeURL: null,
            distance: null,
            coverage: null
        };

    function _init(parameters) {
        if ("regionId" in parameters) setProperty("regionId", parameters.regionId);
        if ("missionId" in parameters) setProperty("missionId", parameters.missionId);
        if ("level" in parameters) setProperty("level", parameters.level);
        if ("distance" in parameters) setProperty("distance", parameters.distance);
        if ("coverage" in parameters) setProperty("coverage", parameters.coverage);
        if ("isCompleted" in parameters) setProperty("isCompleted", parameters.isCompleted);

        if ("label" in parameters) {
            var instruction, completionMessage, badgeURL;
            setProperty("label", parameters.label);
            self.label = parameters.label;  // debug. You don't actually need this.

            if (parameters.label == "initial-mission") {
                instruction = "Your goal is to <span class='bold'>audit 250 meters of the streets in this neighborhood and find the accessibility attributes!";
                completionMessage = "Good job! You have completed the first mission. Keep making the city more accessible!";
                badgeURL = svl.rootDirectory + "/img/misc/BadgeInitialMission.png";
            } else if (parameters.label == "distance-mission") {
                var distance = parameters.distance,
                    distanceString = distance + " meters";
                instruction = "Your goal is to <span class='bold'>audit " + distanceString + " of the streets in this neighborhood and find the accessibility attributes!";
                completionMessage = "Good job! You have successfully made " + distanceString + " of this neighborhood accessible.";
                badgeURL = svl.rootDirectory + "/img/misc/Badge" + distance + "Meters.png";
            } else if (parameters.label == "area-coverage-mission") {
                var coverage = parameters.coverage, coverageString = coverage + "%";
                instruction = "Your goal is to <span class='bold'>audit " + coverageString + " of the streets in this neighborhood and find the accessibility attributes!";
                completionMessage = "Good job! You have successfully made " + coverageString + " of this neighborhood accessible.";
                badgeURL = svl.rootDirectory + "/img/misc/Badge" + coverage + "Percent.png";
            } else if (parameters.label == "onboarding") {

            } else {
                console.error("It shouldn't reach here.");
            }
            setProperty("instruction", instruction);
            setProperty("completionMessage", completionMessage);
            setProperty("badgeURL", badgeURL);
        }
    }

    /**
     * Set the property to complete
     */
    function complete () {
        // Play the animation and audio effect after task completion.
        svl.ui.task.taskCompletionMessage.css('visibility', 'visible').hide();
        svl.ui.task.taskCompletionMessage.removeClass('animated bounce bounceOut').fadeIn(300).addClass('animated bounce');
        setTimeout(function () { svl.ui.task.taskCompletionMessage.fadeOut(300).addClass('bounceOut'); }, 1000);

        if ('audioEffect' in svl) {
            svl.audioEffect.play('yay');
            svl.audioEffect.play('applause');
        }

        // Reset the label counter
        if ('labelCounter' in svl) { svl.labelCounter.reset(); }
        
        setProperty("isCompleted", true);
    }

    /**
     * Compute and return the mission completion rate
     * @returns {number}
     */
    function getMissionCompletionRate () {
        if ("taskContainer" in svl) {
            var targetDistance = getProperty("distance") / 1000;  // Convert meters to kilometers
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

    /** Returns a property */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /** Check if the mission is completed or not */
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

    /**
     * Return a string describing this data
     * @returns {string}
     */
    function toString () {
        return "Mission: " + getProperty("label") + ", Level: "+ getProperty("level") +
            ", Distance: " + getProperty("distance") + ", Coverage " + getProperty("coverage") +
            ", Mission Id: " + getProperty("missionId") + ", Region Id: " + getProperty("regionId") +
            ", Completed: " + getProperty("isCompleted") + "\n";
    }

    /**
     * Return an object that is in a submittable format
     * @returns {{region_id: *, label: *, mission_id: *, level: *, distance: *, coverage: *}}
     */
    function toSubmissionFormat () {
        return {
            region_id: getProperty("regionId"),
            label: getProperty("label"),
            mission_id: getProperty("missionId"),
            level: getProperty("level"),
            distance: getProperty("distance"),
            coverage: getProperty("coverage"),
            deleted: false
        };
    }

    _init(parameters);

    self.complete = complete;
    self.getProperty = getProperty;
    self.getMissionCompletionRate = getMissionCompletionRate;
    self.isCompleted = isCompleted;
    self.remainingAuditDistanceTillComplete = remainingAuditDistanceTillComplete;
    self.setProperty = setProperty;
    self.toString = toString;
    self.toSubmissionFormat = toSubmissionFormat;

    return self;
}

/**
 * MissionContainer module
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
        // Query all the completed & incomplete missions.
        function _callback (result1, result2) {
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
            }
        }
        
        if ("callback" in parameters) {
            $.when($.ajax("/mission/complete"), $.ajax("/mission/incomplete")).done(_callback).done(parameters.callback);
        } else {
            $.when($.ajax("/mission/complete"), $.ajax("/mission/incomplete")).done(_callback)
        }
    }

    /** Set current missison */
    function setCurrentMission (mission) {
        currentMission = mission;

        if ("missionProgress" in svl) {
            svl.missionProgress.update();
        }
        return this;
    }

    /** Get current mission */
    function getCurrentMission () {
        return currentMission;
    }

    /** Get a mission */
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

    function commit () {
        console.debug("Todo. Submit completed missions");
        if (staged.length > 0) {
            var i, data = [];

            for (i = 0; i < staged.length; i++) {
                data.push(staged[i].toSubmissionFormat());
            }
            staged = [];

            $.ajax({
                // async: false,
                contentType: 'application/json; charset=utf-8',
                url: "/mission",
                type: 'post',
                data: JSON.stringify(data),
                dataType: 'json',
                success: function (result) {
                },
                error: function (result) {
                    console.error(result);
                }
            });

        }
        return this;
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

    /**
     * Push the completed mission to the staged so it will be submitted to the server.
     * @param mission
     */
    function stage (mission) {
        staged.push(mission);
        return this;
    }

    _init(parameters);

    self.addToCompletedMissions = addToCompletedMissions;
    self.add = add;
    self.commit = commit;
    self.getCompletedMissions = getCompletedMissions;
    self.getCurrentMission = getCurrentMission;
    self.getMission = getMission;
    self.getMissionsByRegionId = getMissionsByRegionId;
    self.nextMission = nextMission;
    self.stage = stage;
    self.setCurrentMission = setCurrentMission;
    return self;
}

/**
 * MissionFactory module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionFactory (parameters) {
    var self = { className: "MissionFactory"};

    function _init (parameters) {
        if (parameters) {}
    }

    /**
     * Create an instance of a mission object
     * @param regionId
     * @param missionId
     * @param label The label of the mission
     * @param level The level of the mission
     * @param distance
     * @param coverage
     * @param isCompleted A flag indicating if this mission is completed
     * @returns {svl.Mission}
     */
    function create (regionId, missionId, label, level, distance, coverage, isCompleted) {
        return new Mission({ regionId: regionId, missionId: missionId, label: label, level: level, distance: distance,
            coverage: coverage, isCompleted: isCompleted });
    }

    /**
     * Create the onboarding mission
     * @param level The level of the mission
     * @param isCompleted {boolean} A flag indicating if this mission is completed
     * @returns {svl.Mission}
     */
    function createOnboardingMission(level, isCompleted) {
        return new Mission({label: "onboarding", level: level, isCompleted: isCompleted});
    }

    _init(parameters);

    self.create = create;
    self.createOnboardingMission = createOnboardingMission;
    return self;
}