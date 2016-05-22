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
            distanceFt: null,
            distanceMi: null,
            coverage: null
        },
        _tasksForTheMission = [],
        labelCountsAtCompletion;
    
    function _init(parameters) {
        if ("regionId" in parameters) setProperty("regionId", parameters.regionId);
        if ("missionId" in parameters) setProperty("missionId", parameters.missionId);
        if ("level" in parameters) setProperty("level", parameters.level);
        if ("distance" in parameters) setProperty("distance", parameters.distance);
        if ("distanceFt" in parameters) setProperty("distanceFt", parameters.distanceFt);
        if ("distanceMi" in parameters) setProperty("distanceMi", parameters.distanceMi);
        if ("coverage" in parameters) setProperty("coverage", parameters.coverage);
        if ("isCompleted" in parameters) setProperty("isCompleted", parameters.isCompleted);

        if ("label" in parameters) {
            var instruction, completionMessage, badgeURL;
            setProperty("label", parameters.label);
            self.label = parameters.label;  // For debugging. You don't actually need this.
            self.distance = parameters.distance;  // For debugging. You don't actually need this.

            if (parameters.label == "initial-mission") {
                instruction = "Your goal is to <span class='bold'>audit 1000 feet of the streets in this neighborhood and find the accessibility attributes!";
                completionMessage = "Good job! You have completed the first mission. Keep making the city more accessible!";
                badgeURL = svl.rootDirectory + "/img/misc/BadgeInitialMission.png";
            } else if (parameters.label == "distance-mission") {
                var distance = parameters.distance;
                var distanceString = imperialDistance();

                instruction = "Your goal is to <span class='bold'>audit " + distanceString + " of the streets in this neighborhood and find the accessibility attributes!";
                completionMessage = "Good job! You have successfully made " + distanceString + " of this neighborhood accessible.";

                if (distance == 500) {
                    // 2000 ft
                    badgeURL = svl.rootDirectory + "/img/misc/Badge_500.png";
                } else if (distance == 1000) {
                    // 4000 ft
                    badgeURL = svl.rootDirectory + "/img/misc/Badge_1000.png";
                } else {
                    // miles
                    var level = "level" in parameters ? parameters.level : 1;
                    level = (level - 1) % 5 + 1;
                    badgeURL = svl.rootDirectory + "/img/misc/Badge_Level" + level + ".png";
                }
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
     * Because the imperial metric system is messed up.
     * @returns {string}
     */
    function imperialDistance () {
        var distance = getProperty("distance");
        if (distance) {
            if (distance < 1500) {
                if (distance == 250) {
                    return "1000 feet";
                } else if (distance == 500) {
                    return "2000 feet";
                } else if (distance == 1000) {
                    return "4000 feet";
                } else {
                    return distance * 3;
                }
            } else {
                var miles = distance % 1500;
                return miles + "miles";
            }
        } else {
            console.error("Distance is null");
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
        
        setProperty("isCompleted", true);
    }

    /**
     * Total line distance of the completed tasks in this mission
     * @param unit
     */
    function completedLineDistance (unit) {
        if (!unit) unit = "kilometers";
        var completedTasks = _tasksForTheMission.filter(function (t) { return t.isCompleted(); });
        var distances = completedTasks.map(function (t) { return t.lineDistance(unit); });
        return distances.sum();
    }

    /**
     *
     * @param currentTask
     * @param unit
     * @returns {*}
     */
    function computeRoute (currentTask, unit) {
        if ("taskContainer" in svl && svl.taskContainer && "neighborhoodContainer" in svl && svl.neighborhoodContainer) {
            if (!unit) unit = "kilometers";
            var tmpDistance  = currentTask.lineDistance(unit);
            var tasksInARoute = [currentTask];
            var targetDistance = properties.distance / 1000;
            var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood(); // Todo. Pass this as a parameter
            var incompleteTasks = svl.taskContainer.getIncompleteTasks(neighborhood.getProperty("regionId"));
            var connectedTasks;
            var currentTaskIndex;
            var lastCoordinate;
            var lastPoint;

            if (targetDistance < tmpDistance && incompleteTasks.length == 0) {
                return tasksInARoute;
            }

            // Check if there are any street edges connected to the last coordinate of currentTask's street edge.
            lastCoordinate = currentTask.getLastCoordinate();
            lastPoint = turf.point([lastCoordinate.lng, lastCoordinate.lat]);
            connectedTasks = incompleteTasks.filter(function (t) { return t.isConnectedToAPoint(lastPoint) && tasksInARoute.indexOf(t) < 0});
            if (connectedTasks.length == 0) {
                // Reverse the coordinates in the currentTask's street edge if there are no street edges connected to the current last coordinate
                currentTask.reverseCoordinates();
                lastCoordinate = currentTask.getLastCoordinate();
                lastPoint = turf.point([lastCoordinate.lng, lastCoordinate.lat]);
                connectedTasks = incompleteTasks.filter(function (t) { return t.isConnectedToAPoint(lastPoint) && tasksInARoute.indexOf(t) < 0});
            }

            // Compute a route
            while (targetDistance > tmpDistance && incompleteTasks.length > 0) {
                lastCoordinate = currentTask.getLastCoordinate();
                lastPoint = turf.point([lastCoordinate.lng, lastCoordinate.lat]);
                connectedTasks = incompleteTasks.filter(function (t) { return t.isConnectedToAPoint(lastPoint) && tasksInARoute.indexOf(t) < 0});

                if (connectedTasks.length > 0) {
                    connectedTasks = svl.util.shuffle(connectedTasks);
                    currentTask = connectedTasks[0];
                } else {
                    incompleteTasks = svl.util.shuffle(incompleteTasks);  // Shuffle the incommplete tasks
                    currentTask = incompleteTasks[0];  // get the first item in the array
                }
                currentTaskIndex = incompleteTasks.indexOf(currentTask);
                incompleteTasks.splice(currentTaskIndex, 1);  // Remove the current task from the incomplete tasks

                tasksInARoute.push(currentTask);
                tmpDistance +=  currentTask.lineDistance(unit);
            }
            return tasksInARoute;
        } else {
            return null;
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
    function getMissionCompletionRate (unit) {
        if (!unit) unit = "kilometers";
        if ("taskContainer" in svl) {
            var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
            var targetDistance = getProperty("distance") / 1000;  // Convert meters to kilometers
            var initialMission = svl.missionContainer.getMission(null, "initial-mission", 1);
            var missions = svl.missionContainer.getMissionsByRegionId(neighborhood.getProperty("regionId"));
            missions = missions.filter(function (m) { return m.isCompleted() && m != this; });  // Get the completed missions

            // Get the last completed mission's target distance
            var distanceAuditedSoFar = missions.length > 0 ? missions[missions.length - 1].getProperty("distance") / 1000 : 0;
            if (distanceAuditedSoFar === 0 && initialMission.isCompleted()) {
                distanceAuditedSoFar = initialMission.getProperty("distance") / 1000;
            }

            var completedDistance = svl.taskContainer.getCompletedTaskDistance(neighborhood.getProperty("regionId"), unit);

            return Math.max(0, completedDistance - distanceAuditedSoFar) / (targetDistance - distanceAuditedSoFar);
        } else {
            return 0;
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
     * Todo. Shouldn't it be isComplete rather than isCompleted???
     *
     * @returns {boolean}
     */
    function isCompleted () {
        return getProperty("isCompleted");
    }

    /**
     * Sets a property
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Set a route
     * @param tasksInARoute An array of tasks
     */
    function setRoute (tasksInARoute) {
        _tasksForTheMission = tasksInARoute;
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

    /**
     * Total line distance in this mission.
     * @param unit
     */
    function totalLineDistance (unit) {
        var distances = _tasksForTheMission.map(function (task) { return task.lineDistance(unit); });
        return distances.sum();
    }

    _init(parameters);

    self.complete = complete;
    self.completedLineDistance = completedLineDistance;
    self.computeRoute = computeRoute;
    self.getLabelCount = getLabelCount;
    self.getProperty = getProperty;
    self.getRoute = getRoute;
    self.getMissionCompletionRate = getMissionCompletionRate;
    self.imperialDistance = imperialDistance;
    self.isCompleted = isCompleted;
    self.remainingAuditDistanceTillComplete = remainingAuditDistanceTillComplete;
    self.setProperty = setProperty;
    self.setRoute = setRoute;
    self.toString = toString;
    self.toSubmissionFormat = toSubmissionFormat;
    self.totalLineDistance = totalLineDistance;

    return self;
}