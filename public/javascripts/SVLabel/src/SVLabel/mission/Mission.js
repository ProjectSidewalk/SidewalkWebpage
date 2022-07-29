/**
 * Mission module
 * Todo. Needs clean up
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Mission(parameters) {
    var self = this;
    var properties = {
            missionId: null,
            missionType: null,
            regionId: null,
            isComplete: false,
            pay: null,
            paid: null,
            distance: null,
            distanceProgress: null,
            skipped: false
        },
        _tasksForTheMission = [],
        labelCountsAtCompletion;
    
    function _init(parameters) {
        if ("missionId" in parameters) setProperty("missionId", parameters.missionId);
        if ("missionType" in parameters) setProperty("missionType", parameters.missionType);
        if ("regionId" in parameters) setProperty("regionId", parameters.regionId);
        if ("isComplete" in parameters) setProperty("isComplete", parameters.isComplete);
        if ("pay" in parameters) setProperty("pay", parameters.pay);
        if ("paid" in parameters) setProperty("paid", parameters.paid);
        if ("distance" in parameters) setProperty("distance", parameters.distance);
        if ("distanceProgress" in parameters) setProperty("distanceProgress", parameters.distanceProgress);
        if ("skipped" in parameters) setProperty("skipped", parameters.skipped);
    }

    /**
     * Set the isComplete property to true.
     */
    function complete() {
        // Play the animation and audio effect after task completion.

        setProperty("isComplete", true);

        // Set distanceProgress to be at most the distance for the mission, subtract the difference from the offset.
        if (getProperty("missionType") === "audit") {
            var distanceOver = getProperty("distanceProgress") - getProperty("distance");
            var oldOffset = svl.missionContainer.getTasksMissionsOffset();
            var newOffset = oldOffset - distanceOver;
            svl.missionContainer.setTasksMissionsOffset(newOffset);
        }

        // Update the neighborhood status
        if ("labelContainer" in svl) {
            var regionId = svl.neighborhoodContainer.getCurrentNeighborhood().getProperty("regionId");
            var count = svl.labelContainer.countLabels(regionId);
            svl.statusFieldNeighborhood.setLabelCount(count);
        }

        // Reset the label counter
        if ('labelCounter' in svl) {
            labelCountsAtCompletion = {
                "CurbRamp": svl.labelCounter.countLabel("CurbRamp"),
                "NoCurbRamp": svl.labelCounter.countLabel("NoCurbRamp"),
                "Obstacle": svl.labelCounter.countLabel("Obstacle"),
                "SurfaceProblem": svl.labelCounter.countLabel("SurfaceProblem"),
                "NoSidewalk": svl.labelCounter.countLabel("NoSidewalk"),
                "Other": svl.labelCounter.countLabel("Other")
            };
            svl.labelCounter.reset();
        }

        if (!svl.isOnboarding()){
            svl.storage.set('completedFirstMission', true);
        }
    }

    /**
     * This method returns the label count object
     * @returns {*}
     */
    function getLabelCount () {
        return labelCountsAtCompletion;
    }

    /**
     * Compute and return the mission completion rate
     * @returns {number}
     */
    function getMissionCompletionRate () {
        updateDistanceProgress();
        if ("taskContainer" in svl && getProperty("missionType") !== "auditOnboarding") {
            var distanceProgress = getProperty("distanceProgress");
            var targetDistance = getDistance();

            return Math.min(Math.max(distanceProgress / targetDistance, 0), 1);
        } else {
            return 0;
        }
    }

    /**
     * Updates the distanceProgress for this audit mission.
     */
    function updateDistanceProgress() {
        if ("taskContainer" in svl
            && getProperty("missionType") !== "auditOnboarding"
            && svl.missionContainer.getTasksMissionsOffset() !== null) {

            var currentMissionCompletedDistance;
            if (isComplete()) {
                currentMissionCompletedDistance = getDistance("meters");
            } else {
                var taskDistance = util.math.kilometersToMeters(svl.taskContainer.getCompletedTaskDistance({units: 'kilometers'}));
                var offset = svl.missionContainer.getTasksMissionsOffset();
                offset = offset ? offset : 0;

                var missionDistance = svl.missionContainer.getCompletedMissionDistance();
                currentMissionCompletedDistance = taskDistance - missionDistance + offset;
                // Hotfix for an issue where the mission completion distance was negative. Need to find root cause.
                // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2120
                if (currentMissionCompletedDistance < 0) {
                    svl.missionContainer.setTasksMissionsOffset(offset - currentMissionCompletedDistance);
                    console.error(`Mission progress was set to ${currentMissionCompletedDistance}, resetting to 0.`);
                    currentMissionCompletedDistance = 0;
                }
            }
            setProperty("distanceProgress", currentMissionCompletedDistance);
        }
    }

    /** Returns a property */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Get tasks in mission and push task to _tasksForTheMission
     * @param missionId
     * @param callback
     * @param async
     */
     function getMissionTasks(missionId, callback, async) {
        if (typeof async == "undefined") async = true;
        $.ajax({
            url: "/tasks/mission/" + missionId,
            type: 'get',
            success: function (result) {
                var task;
                for (var i = 0; i < result.length; i++) {
                    var lat = result[i].features[0].properties.current_lat,
                    lng = result[i].features[0].properties.current_lng;
                    task = svl.taskFactory.create(result[i], false, lat, lng, false);
                    pushATaskToTheRoute(task);
                }
                if (callback) callback();
            },
            error: function (result) {
                throw result;
            }
        });
    }

    /**
     * Get an array of tasks for this mission
     * @returns {Array}
     */
    function getRoute () {
        return _tasksForTheMission;
    }

    /**
     * Check if the mission is completed or not
     *
     * @returns {boolean}
     */
    function isComplete () {
        return getProperty("isComplete");
    }

    /**
     * Push a completed task into `_tasksForTheMission`.
     * @param task
     */
    function pushATaskToTheRoute(task) {
        var streetEdgeIds = _tasksForTheMission.map(function (task) {
            return task.getStreetEdgeId();
        });
        if (streetEdgeIds.indexOf(task.getStreetEdgeId()) < 0) {
            _tasksForTheMission.push(task);
        }
    }

    /**
     * Sets a property
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Return a string describing this data
     * @returns {string}
     */
    function toString () {
        return "Mission ID: " + getProperty("missionId") + ", Mission Type: " + getProperty("missionType") +
            ", Region Id: " + getProperty("regionId") + ", Complete: " + getProperty("isComplete") +
            ", Distance: " + getDistance("meters") + "\n";
    }

    /**
     * Total line distance in this mission.
     * @param unit
     */
    function getDistance(unit) {
        if (unit === undefined) unit = "meters";

        if (unit === "miles")           return util.math.metersToMiles(getProperty("distance"));
        else if (unit === "feet")       return util.math.metersToFeet(getProperty("distance"));
        else if (unit === "kilometers") return util.math.metersToKilometers(getProperty("distance"));
        else if (unit === "meters")     return getProperty("distance");
        else {
            console.error("Unit must be miles, feet, kilometers, or meters. Given: " + unit);
            return getProperty("distance");
        }
    }

    _init(parameters);
    getMissionTasks(getProperty("missionId"), null, false);

    self.complete = complete;
    self.getLabelCount = getLabelCount;
    self.getProperty = getProperty;
    self.getRoute = getRoute;
    self.getMissionCompletionRate = getMissionCompletionRate;
    self.updateDistanceProgress = updateDistanceProgress;
    self.isComplete = isComplete;
    self.pushATaskToTheRoute = pushATaskToTheRoute;
    self.setProperty = setProperty;
    self.toString = toString;
    self.getDistance = getDistance;
}