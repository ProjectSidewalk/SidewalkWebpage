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

        if (!('user' in svl) || (svl.user.getProperty('username') == "anonymous" && getCompletedTaskDistance(neighborhood.getProperty("regionId"), "kilometers") > 0.5)) {
            svl.popUpMessage.promptSignIn();
        } else {
            // Submit the data.
            var data = svl.form.compileSubmissionData(),
                staged = svl.storage.get("staged");

            if (staged.length > 0) {
                staged.push(data);
                svl.form.submit(staged);
                svl.storage.set("staged", []);  // Empty the staged data.
            } else {
                svl.form.submit(data);
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
     * Get the total distance of completed segments
     * @params {units} String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in meters
     */
    function getCompletedTaskDistance (regionId, units) {
        if (!units) units = "kilometers";

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
                distance += turf.lineDistance(feature, units);
            }

            if (currentTask) distance += currentTask.getDistanceWalked(units);

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
        if (!(regionId in taskStoreByRegionId)) {
            console.error("regionId is not specified");
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
     * Find tasks (i.e., street edges) in the region that are connected to the given task.
     * @param regionId {number} Region id
     * @param taskIn {object} Task
     * @param threshold {number} Distance threshold
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
        len = tasks.length;

        for (i = 0; i < len; i++) {
            if (taskIn.isConnectedTo(tasks[i], threshold, unit)) {
                connectedTasks.push(tasks[i]);
            }
        }
        return connectedTasks;
    }

    /**
     * Get the next task and set it as a current task.
     * @param task Current task
     * @returns {*} Next task
     */
    function nextTask (task) {
        var newTask = null,
            neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood(),
            candidateTasks = findConnectedTask(neighborhood.getProperty("regionId"), task);

        candidateTasks = candidateTasks.filter(function (t) { return !t.isCompleted(); });

        if (candidateTasks.length > 0) {
            newTask = candidateTasks[0];
        } else {
            candidateTasks = getIncompleteTasks(neighborhood.getProperty("regionId"));
            newTask = candidateTasks[0];
        }

        var c1 = task.getLastCoordinate(),
            c2 = newTask.getStartCoordinate(),
            p1 = turf.point([c1.lng, c1.lat]),
            p2 = turf.point([c2.lng, c2.lat]);
        if (turf.distance(p1, p2, "kilometers") > 0.025) {
            newTask.reverseCoordinates();
        }
        return newTask;

        // In case
        // if (task) {
        //     var streetEdgeId = task.getStreetEdgeId(),
        //         _geojson = task.getGeoJSON();
        //     // When the current street edge id is given (i.e., when you are simply walking around).
        //     var len = _geojson.features[0].geometry.coordinates.length - 1,
        //         latEnd = _geojson.features[0].geometry.coordinates[len][1],
        //         lngEnd = _geojson.features[0].geometry.coordinates[len][0];
        //
        //     $.ajax({
        //         async: false,
        //         url: "/task/next?streetEdgeId=" + streetEdgeId + "&lat=" + latEnd + "&lng=" + lngEnd,
        //         type: 'get',
        //         success: function (json) {
        //             newTask = svl.taskFactory.create(json, latEnd, lngEnd);
        //         },
        //         error: function (result) {
        //             throw result;
        //         }
        //     });
        // } else {
        //     // No street edge id is provided (e.g., the user skipped the task to explore another location.)
        //     $.ajax({
        //         async: false,
        //         url: "/task",
        //         type: 'get',
        //         success: function (json) {
        //             // Check if Street View is available at the location. If it's not available, report it to the
        //             // server and go to the next task.
        //             // http://stackoverflow.com/questions/2675032/how-to-check-if-google-street-view-available-and-display-message
        //             // https://developers.google.com/maps/documentation/javascript/reference?csw=1#StreetViewService
        //             var len = json.features[0].geometry.coordinates.length - 1,
        //                 lat1 = json.features[0].geometry.coordinates[0][1],
        //                 lng1 = json.features[0].geometry.coordinates[0][0],
        //                 lat2 = json.features[0].geometry.coordinates[len][1],
        //                 lng2 = json.features[0].geometry.coordinates[len][0];
        //
        //             newTask = svl.taskFactory.create(json);
        //         },
        //         error: function (result) {
        //             throw result;
        //         }
        //     });
        // }
        //
        // return newTask;
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
     * Request the server to populate tasks
     * @param regionId {number} Region id
     * @param callback A callback function
     * @param async {boolean}
     */
    function requestTasksInARegion(regionId, callback, async) {
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
     * Set the current task
     * @param task
     */
    function setCurrentTask (task) {
        currentTask = task;

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
        var streetEdgeIds = taskStoreByRegionId[regionId].map(function (task) { return task.getProperty("streetEdgeId"); });
        if (streetEdgeIds.indexOf(task.street_edge_id) < 0) taskStoreByRegionId[regionId].push(task);  // Check for duplicates
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
    self.getCompletedTasks = getCompletedTasks;
    self.getCompletedTaskDistance = getCompletedTaskDistance;
    self.getCurrentTask = getCurrentTask;
    self.getTasksInRegion = getTasksInRegion;
    self.isFirstTask = isFirstTask;
    self.length = length;
    self.nextTask = nextTask;
    self.push = push;
    self.requestTasksInARegion = requestTasksInARegion;
    self.setCurrentTask = setCurrentTask;
    self.storeTask = storeTask;
    self.update = update;
    self.updateAuditedDistance = updateAuditedDistance;

    return self;
}