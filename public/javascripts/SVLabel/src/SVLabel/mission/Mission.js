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
            isCompleted: false,
            pay: null,
            paid: null,
            distance: null,
            distanceProgress: null
        },
        _tasksForTheMission = [],
        labelCountsAtCompletion;
    
    function _init(parameters) {
        if ("missionId" in parameters) setProperty("missionId", parameters.missionId);
        if ("missionType" in parameters) setProperty("missionType", parameters.missionType);
        if ("regionId" in parameters) setProperty("regionId", parameters.regionId);
        if ("isCompleted" in parameters) setProperty("isCompleted", parameters.isCompleted);
        if ("pay" in parameters) setProperty("pay", parameters.pay);
        if ("paid" in parameters) setProperty("paid", parameters.paid);
        if ("distance" in parameters) setProperty("distance", parameters.distance);
        if ("distanceProgress" in parameters) setProperty("distanceProgress", parameters.distanceProgress);
    }

    /**
     * Set the property to complete
     */
    function complete () {
        // Play the animation and audio effect after task completion.

        setProperty("isCompleted", true);

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
            && svl.missionContainer.getTasksMissionsOffset()) {

            var currentMissionCompletedDistance;
            if (isCompleted()) {
                currentMissionCompletedDistance = getDistance("meters");
            } else {
                var taskDistance = svl.taskContainer.getCompletedTaskDistance("kilometers") * 1000;
                var offset = svl.missionContainer.getTasksMissionsOffset();
                offset = offset ? offset : 0;

                var missionDistance = svl.missionContainer.getCompletedMissionDistance();
                currentMissionCompletedDistance = taskDistance - missionDistance + offset;
            }
            setProperty("distanceProgress", currentMissionCompletedDistance);
        }
    }

    /** Returns a property */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
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
     * Todo. Shouldn't it be isComplete rather than isCompleted??? -- lol yes (says Mikey)
     *
     * @returns {boolean}
     */
    function isCompleted () {
        return getProperty("isCompleted");
    }

    /**
     * Push a completed task into `_tasksForTheMission`
     * @param task
     */
    function pushATaskToTheRoute(task) {
        _tasksForTheMission.push(task);
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
            ", Region Id: " + getProperty("regionId") + ", Completed: " + getProperty("isCompleted") +
            ", Distance: " + getDistance("meters") + "\n";
    }

    /**
     * Total line distance in this mission.
     * @param unit
     */
    function getDistance(unit) {
        if (unit === undefined) unit = "meters";

        if (unit === "miles")           return getProperty("distance") / 1609.34;
        else if (unit === "feet")       return getProperty("distance") * 3.28084;
        else if (unit === "kilometers") return getProperty("distance") / 1000;
        else if (unit === "meters")     return getProperty("distance");
        else {
            console.error("Unit must be miles, feet, kilometers, or meters. Given: " + unit);
            return getProperty("distance");
        }
    }

    _init(parameters);

    self.complete = complete;
    self.getLabelCount = getLabelCount;
    self.getProperty = getProperty;
    self.getRoute = getRoute;
    self.getMissionCompletionRate = getMissionCompletionRate;
    self.updateDistanceProgress = updateDistanceProgress;
    self.isCompleted = isCompleted;
    self.pushATaskToTheRoute = pushATaskToTheRoute;
    self.setProperty = setProperty;
    self.toString = toString;
    self.getDistance = getDistance;
}