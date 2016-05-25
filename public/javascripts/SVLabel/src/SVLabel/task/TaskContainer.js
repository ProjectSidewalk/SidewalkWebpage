/**
 * TaskContainer module.
 * @param turf
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TaskContainer (turf) {
    var self = { className: "TaskContainer" },
        previousTasks = [],
        currentTask = null,
        paths, previousPaths = [],
        taskStoreByRegionId = {};

    /**
     * I had to make this method to wrap the street view service.
     * @param task
     */
    function initNextTask (task) {
        var nextTask = svl.taskContainer.nextTask(task),
            geometry,
            lat,
            lng;
        geometry = nextTask.getGeometry();
        lat = geometry.coordinates[0][1];
        lng = geometry.coordinates[0][0];

        // var streetViewService = new google.maps.StreetViewService();
        var STREETVIEW_MAX_DISTANCE = 25;
        var latLng = new google.maps.LatLng(lat, lng);

        svl.streetViewService.getPanoramaByLocation(latLng, STREETVIEW_MAX_DISTANCE, function (streetViewPanoramaData, status) {
            if (status === google.maps.StreetViewStatus.OK) {
                svl.taskContainer.setCurrentTask(nextTask);
                svl.map.setPosition(streetViewPanoramaData.location.latLng.lat(), streetViewPanoramaData.location.latLng.lng());
            } else if (status === google.maps.StreetViewStatus.ZERO_RESULTS) {
                // no street view available in this range.
                svl.taskContainer.initNextTask();
            } else {
                throw "Error loading Street View imagey.";
            }
        });
    }

    /**
     * End the current task.
     */
    function endTask (task) {
        if ('tracker' in svl) svl.tracker.push("TaskEnd");
        var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
        task.complete();

        // Update the total distance across neighborhoods that the user has audited
        updateAuditedDistance("miles");

        if (!('user' in svl) || (svl.user.getProperty('username') == "anonymous" && getCompletedTaskDistance(neighborhood.getProperty("regionId"), "kilometers") > 0.15)) {
            if (!svl.popUpMessage.haveAskedToSignIn()) svl.popUpMessage.promptSignIn();
        } else {
            // Submit the data.
            var data = svl.form.compileSubmissionData(task),
                staged = svl.storage.get("staged");

            if (staged.length > 0) {
                staged.push(data);
                svl.form.submit(staged, task);
                svl.storage.set("staged", []);  // Empty the staged data.
            } else {
                svl.form.submit(data, task);
            }
        }

        push(task); // Push the data into previousTasks

        // Clear the current paths
        var _geojson = task.getGeoJSON(),
            gCoordinates = _geojson.features[0].geometry.coordinates.map(function (coord) { return new google.maps.LatLng(coord[1], coord[0]); });
        previousPaths.push(new google.maps.Polyline({ path: gCoordinates, geodesic: true, strokeColor: '#00ff00', strokeOpacity: 1.0, strokeWeight: 2 }));
        paths = null;

        return task;
    }


    /**
     * Fetch a task based on the street id.
     * @param regionId
     * @param streetEdgeId
     * @param callback
     * @param async
     */
    function fetchATask(regionId, streetEdgeId, callback, async) {
        if (typeof async == "undefined") async = true;
        $.ajax({
            url: "/task/street/" + streetEdgeId,
            type: 'get',
            success: function (json) {
                var lat1 = json.features[0].geometry.coordinates[0][1],
                    lng1 = json.features[0].geometry.coordinates[0][0],
                    newTask = svl.taskFactory.create(json, lat1, lng1);
                if (json.features[0].properties.completed) newTask.complete();
                storeTask(regionId, newTask);
                if (callback) callback();
            },
            error: function (result) {
                throw result;
            }
        });
    }

    /**
     * Request the server to populate tasks
     * @param regionId {number} Region id
     * @param callback A callback function
     * @param async {boolean}
     */
    function fetchTasksInARegion(regionId, callback, async) {
        if (typeof async == "undefined") async = true;

        if (typeof regionId == "number") {
            $.ajax({
                url: "/tasks?regionId=" + regionId,
                async: async,
                type: 'get',
                success: function (result) {
                    var task;
                    for (var i = 0; i < result.length; i++) {
                        task = svl.taskFactory.create(result[i]);
                        if ((result[i].features[0].properties.completed)) task.complete();
                        storeTask(regionId, task);
                    }

                    if (callback) callback();
                },
                error: function (result) {
                    console.error(result);
                }
            });
        } else {
            console.error("regionId should be an integer value");
        }
    }

    /**
     * Find tasks (i.e., street edges) in the region that are connected to the given task.
     * @param regionId {number} Region id
     * @param taskIn {object} Task
     * @param threshold {number} Distance threshold
     * @param unit {string} Distance unit
     * @returns {Array}
     */
    function findConnectedTask (regionId, taskIn, threshold, unit) {
        var i,
            len,
            tasks = getTasksInRegion(regionId),
            connectedTasks = [];

        if (!threshold) threshold = 0.01;  // 0.01 km.
        if (!unit) unit = "kilometers";
        tasks = tasks.filter(function (t) { return !t.isCompleted(); });

        if (taskIn) {
            tasks = tasks.filter(function (t) { return t.getStreetEdgeId() != taskIn.getStreetEdgeId(); });  // Filter out the current task
            len = tasks.length;

            for (i = 0; i < len; i++) {
                if (taskIn.isConnectedTo(tasks[i], threshold, unit)) {
                    connectedTasks.push(tasks[i]);
                }
            }
            return connectedTasks;
        } else {
            return tasks;
        }

    }

    /**
     * Get the total distance of completed segments
     * @params {unit} String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in meters
     */
    function getCompletedTaskDistance (regionId, unit) {
        if (!unit) unit = "kilometers";

        var completedTasks = getCompletedTasks(regionId),
            geojson,
            feature,
            i,
            len,
            distance = 0;

        if (completedTasks) {
            len = completedTasks.length;
            for (i = 0; i < len; i++) {
                geojson = completedTasks[i].getGeoJSON();
                feature = geojson.features[0];
                distance += turf.lineDistance(feature, unit);
            }

            if (currentTask) distance += currentTask.getDistanceWalked(unit);

            return distance;
        } else {
            return 0;
        }
    }

    /**
     * This method returns the completed tasks in the given region
     * @param regionId
     * @returns {Array}
     */
    function getCompletedTasks (regionId) {
        if (!(regionId in taskStoreByRegionId)) {
            console.error("getCompletedTasks needs regionId");
            return null;
        }
        if (!Array.isArray(taskStoreByRegionId[regionId])) {
            console.error("taskStoreByRegionId[regionId] is not an array. Probably the data from this region is not loaded yet.");
            return null;
        }
        return taskStoreByRegionId[regionId].filter(function (task) {
            return task.isCompleted();
        });
    }

    /**
     * Get the current task
     * @returns {*}
     */
    function getCurrentTask () {
        return currentTask;
    }

    function getIncompleteTasks (regionId) {
        if (!regionId && regionId !== 0) {
            console.error("regionId is not specified")
        }
        if (!(regionId in taskStoreByRegionId)) {
            console.error("regionId is not in taskStoreByRegionId. This is probably because you have not fetched the tasks in the region yet (e.g., by fetchTasksInARegion)");
            return null;
        }
        if (!Array.isArray(taskStoreByRegionId[regionId])) {
            console.error("taskStoreByRegionId[regionId] is not an array. Probably the data from this region is not loaded yet.");
            return null;
        }
        return taskStoreByRegionId[regionId].filter(function (task) {
            return !task.isCompleted();
        });
    }

    function getTasksInRegion (regionId) {
        return regionId in taskStoreByRegionId ? taskStoreByRegionId[regionId] : null;
    }

    /**
     * Check if the current task is the first task in this session
     * @returns {boolean}
     */
    function isFirstTask () {
        return length() == 0;
    }

    /**
     * Get the length of the previous tasks
     * @returns {*|Number}
     */
    function length () {
        return previousTasks.length;
    }

    /**
     * Get the next task and set it as a current task.
     * @param task Current task
     * @returns {*} Next task
     */
    function nextTask (task) {
        var newTask = null,
            neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood(),
            candidateTasks = findConnectedTask(neighborhood.getProperty("regionId"), task, null, null);

        candidateTasks = candidateTasks.filter(function (t) { return !t.isCompleted(); });

        if (candidateTasks.length > 0) {
            newTask = candidateTasks[0];
        } else {
            candidateTasks = getIncompleteTasks(neighborhood.getProperty("regionId"));
            newTask = candidateTasks[0];
        }

        if (task) {
            var c1 = task.getLastCoordinate(),
                c2 = newTask.getStartCoordinate(),
                p1 = turf.point([c1.lng, c1.lat]),
                p2 = turf.point([c2.lng, c2.lat]);
            if (turf.distance(p1, p2, "kilometers") > 0.025) {
                newTask.reverseCoordinates();
            }
        }

        return newTask;
    }

    /**
     * Push a task to previousTasks
     * @param task
     */
    function push (task) {
        // Todo. Check for the duplicates.
        previousTasks.push(task);
    }

    /**
     * Set the current task
     * @param task
     */
    function setCurrentTask (task) {
        currentTask = task;
        if ("tracker" in svl) {
            svl.tracker.push('TaskStart');
        }

        if ('compass' in svl) {
            svl.compass.setTurnMessage();
            svl.compass.showMessage();
            svl.compass.update();
        }
    }

    /**
     * Store a task into taskStoreByRegionId
     * @param regionId {number} Region id
     * @param task {object} Task object
     */
    function storeTask(regionId, task) {
        if (!(regionId in taskStoreByRegionId)) taskStoreByRegionId[regionId] = [];
        var streetEdgeIds = taskStoreByRegionId[regionId].map(function (task) {
            return task.getProperty("streetEdgeId");
        });
        if (streetEdgeIds.indexOf(task.street_edge_id) < 0) taskStoreByRegionId[regionId].push(task);  // Check for duplicates
    }

    /**
     *
     * @param regionId
     */
    function totalLineDistanceInARegion(regionId, unit) {
        if (!unit) unit = "kilometers";
        var tasks = getTasksInRegion(regionId);

        if (tasks) {
            var distanceArray = tasks.map(function (t) { return t.lineDistance(unit); });
            return distanceArray.sum();
        } else {
            return null;
        }
    }

    /**
     * This method is called from Map.handlerPositionUpdate() to update the color of audited and unaudited street
     * segments on Google Maps.
     * KH: It maybe more natural to let a method in Map.js do handle it...
     */
    function update () {
        var i, len = previousTasks.length;
        for (i = 0; i < len; i++) previousTasks[i].render();
        currentTask.render();
    }

    /**
     * Update the audited distance by combining the distance previously traveled and the distance the user traveled in
     * the current session.
     * Todo. Fix this. The function name should be clear that this updates the global distance rather than the distance traveled in the current neighborhood. Also get rid of the async call.
     * @returns {updateAuditedDistance}
     */
    function updateAuditedDistance (unit) {
        if (!unit) unit = "kilometers";
        var distance = 0,
            sessionDistance = 0,
            neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();

        if (neighborhood) {
            sessionDistance = getCompletedTaskDistance(neighborhood.getProperty("regionId"), unit);
        }

        distance += sessionDistance;
        svl.ui.progress.auditedDistance.html(distance.toFixed(2));
        return this;
    }

    self.initNextTask = initNextTask;
    self.endTask = endTask;
    self.fetchATask = fetchATask;
    self.fetchTasksInARegion = fetchTasksInARegion;
    self.findConnectedTask = findConnectedTask;
    self.getCompletedTasks = getCompletedTasks;
    self.getCompletedTaskDistance = getCompletedTaskDistance;
    self.getCurrentTask = getCurrentTask;
    self.getIncompleteTasks = getIncompleteTasks;
    self.getTasksInRegion = getTasksInRegion;
    self.isFirstTask = isFirstTask;
    self.length = length;
    self.nextTask = nextTask;
    self.push = push;

    self.setCurrentTask = setCurrentTask;
    self.storeTask = storeTask;
    self.totalLineDistanceInARegion = totalLineDistanceInARegion;
    self.update = update;
    self.updateAuditedDistance = updateAuditedDistance;

    return self;
}