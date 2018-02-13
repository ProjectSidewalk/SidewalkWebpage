/**
 * TaskContainer module.
 *
 * Todo. This module needs to be cleaned up.
 * Todo. Split the responsibilities. Storing tasks should remain here, but other things like fetching data from the server (should go to TaskModel) and rendering segments on a map.
 * @param turf
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TaskContainer (navigationModel, neighborhoodModel, streetViewService, svl, taskModel, tracker) {
    var self = this;

    var previousTasks = [];
    var currentTask = null;
    var beforeJumpNewTask = null;
    var paths;
    var previousPaths = [];

    self._taskStoreByRegionId = {};

    self._handleTaskFetchCompleted = function () {
        var nextTask = self.nextTask();
        self.initNextTask(nextTask);
    };

    self.getFinishedAndInitNextTask = function (finished) {
        var newTask = self.nextTask(finished);
        if (!newTask) {
            var currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
            var currentNeighborhoodId = currentNeighborhood.getProperty("regionId");
            svl.neighborhoodModel.neighborhoodCompleted(currentNeighborhoodId);
            tracker.push("NeighborhoodComplete_ByUser", {'RegionId': currentNeighborhoodId});
        } else {
            svl.taskContainer.initNextTask(newTask);
        }
        return newTask;
    };

    self.initNextTask = function (nextTaskIn) {
        var geometry;
        var lat;
        var lng;

        var currentPosition = navigationModel.getPosition();
        nextTaskIn.setStreetEdgeDirection(currentPosition.lat, currentPosition.lng);

        geometry = nextTaskIn.getGeometry();
        lat = geometry.coordinates[0][1];
        lng = geometry.coordinates[0][0];

        var STREETVIEW_MAX_DISTANCE = 25;
        var latLng = new google.maps.LatLng(lat, lng);

        navigationModel.disableWalking();

        if (streetViewService) {
            streetViewService.getPanorama({location: latLng, radius: STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR},
                function (streetViewPanoramaData, status) {
                    navigationModel.enableWalking();
                    if (status === google.maps.StreetViewStatus.OK) {
                        lat = streetViewPanoramaData.location.latLng.lat();
                        lng = streetViewPanoramaData.location.latLng.lng();
                        self.setCurrentTask(nextTaskIn);
                        navigationModel.setPosition(lat, lng, function(){
                            navigationModel.preparePovReset();
                        });
                    } else {
                        console.error("Error loading Street View imagery");
                        svl.tracker.push("PanoId_NotFound", {'Location': JSON.stringify(latLng)});
                        nextTaskIn.complete();
                        // no street view available in this range.
                        self.getFinishedAndInitNextTask(nextTaskIn);
                    }
                });
        }
    };

    /**
     * End the current task.
     */
    self.endTask = function (task) {
        if (tracker) tracker.push("TaskEnd");
        var neighborhood = neighborhoodModel.currentNeighborhood();

        task.complete();
        // Go through the tasks and mark the completed task as isCompleted=true
        var neighborhoodTasks = self._taskStoreByRegionId[neighborhood.getProperty("regionId")];
        for (var i = 0, len = neighborhoodTasks.length;  i < len; i++) {
            if (task.getStreetEdgeId() === neighborhoodTasks[i].getStreetEdgeId()) {
                neighborhoodTasks[i].complete();
            }
        }

        // Update the total distance across neighborhoods that the user has audited
        updateAuditedDistance("miles");

        if (!('user' in svl) || (svl.user.getProperty('username') === "anonymous" &&
            getCompletedTaskDistance(neighborhood.getProperty("regionId"), "kilometers") > 0.15 &&
            !svl.popUpMessage.haveAskedToSignIn())) {
            svl.popUpMessage.promptSignIn();
        }

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


        pushATask(task); // Push the data into previousTasks

        // Clear the current paths
        var _geojson = task.getGeoJSON();
        var gCoordinates = _geojson.features[0].geometry.coordinates.map(function (coord) {
            return new google.maps.LatLng(coord[1], coord[0]);
        });
        previousPaths.push(new google.maps.Polyline({
            path: gCoordinates,
            geodesic: true,
            strokeColor: '#00ff00',
            strokeOpacity: 1.0,
            strokeWeight: 2
        }));
        paths = null;

        return task;
    };


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
     * Todo. Move this to somewhere else. TaskModel?
     * @param regionId {number} Region id
     * @param callback A callback function
     * @param async {boolean}
     */
    self.fetchTasksInARegion = function (regionId, callback, async) {
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
    };

    /**
     * Find incomplete tasks (i.e., street edges) in the region that are connected to the given task.
     *
     * @param regionId {number} Region id
     * @param taskIn {object} Task
     * @param acrossAllUsers
     * @param threshold {number} Distance threshold
     * @param unit {string} Distance unit
     * @returns {Array}
     * @private
     */
    self._findConnectedTasks = function (regionId, taskIn, acrossAllUsers, threshold, unit) {
        var tasks = self.getTasksInRegion(regionId);

        if (acrossAllUsers) {
            tasks = tasks.filter(function (t) { return t.getStreetCompletionCount() === 0; });
        }

        if (tasks) {
            var connectedTasks = [];
            if (!threshold) threshold = 0.01;  // 0.01 km.
            if (!unit) unit = "kilometers";
            tasks = tasks.filter(function (t) { return !t.isCompleted(); });

            if (taskIn) {
                tasks = tasks.filter(function (t) { return t.getStreetEdgeId() !== taskIn.getStreetEdgeId(); });

                for (var i = 0, len = tasks.length; i < len; i++) {
                    if (taskIn.isConnectedTo(tasks[i], threshold, unit)) {
                        connectedTasks.push(tasks[i]);
                    }
                }
                return connectedTasks;
            } else {
                return util.shuffle(tasks);
            }
        } else {
            return [];
        }
    };

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
            distance = 0;

        if (completedTasks) {
            for (var i = 0, len = completedTasks.length; i < len; i++) {
                geojson = completedTasks[i].getGeoJSON();
                feature = geojson.features[0];
                distance += turf.lineDistance(feature, unit);
            }
        }

        distance += getCurrentTaskDistance(unit);

        return distance;
    }

    function getCurrentTaskDistance(unit) {
        if (!unit) unit = "kilometers";

        if (currentTask) {
            var currentLatLng = navigationModel.getPosition();
            currentTask.updateTheFurthestPointReached(currentLatLng.lat, currentLatLng.lng);
            var currentTaskDistance = currentTask.getAuditedDistance(unit);
            return currentTaskDistance;
        }
        return 0;
    }

    /**
     * This method returns the completed tasks in the given region
     * @param regionId
     * @returns {Array}
     */
    function getCompletedTasks (regionId) {
        if (!(regionId in self._taskStoreByRegionId)) {
            console.error("getCompletedTasks needs regionId");
            return null;
        }
        if (!Array.isArray(self._taskStoreByRegionId[regionId])) {
            console.error("_taskStoreByRegionId[regionId] is not an array. Probably the data from this region is not loaded yet.");
            return null;
        }
        return self._taskStoreByRegionId[regionId].filter(function (task) {
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

    /**
     * Get the before jump task
     * @returns {*}
     */
    function getBeforeJumpTask () {
        return beforeJumpNewTask;
    }

    /**
     * Used to set target distance for Mission Progress
     *
     * TODO: 839 - Do we set that for completed tasks across all users?
     * @param regionId
     * @param unit
     */
    self.getIncompleteTaskDistance = function (regionId, unit) {
        var incompleteTasks = self.getIncompleteTasks(regionId);
        var taskDistances = incompleteTasks.map(function (task) { return task.lineDistance(unit); });
        return taskDistances.reduce(function (a, b) { return a + b; }, 0);
    };

    /**
     * Find incomplete tasks by the user
     * @param regionId
     * @returns {null}
     */
    self.getIncompleteTasks = function (regionId) {
        if (!regionId && regionId !== 0) {
            console.error("regionId is not specified")
        }
        if (!(regionId in self._taskStoreByRegionId)) {
            self.fetchTasksInARegion(regionId, null, false);
            // console.error("regionId is not in _taskStoreByRegionId. This is probably because " +
            //    "you have not fetched the tasks in the region yet (e.g., by fetchTasksInARegion)");
            // return null;
        }
        if (!Array.isArray(self._taskStoreByRegionId[regionId])) {
            console.error("_taskStoreByRegionId[regionId] is not an array. " +
                "Probably the data from this region is not loaded yet.");
            return null;
        }
        return self._taskStoreByRegionId[regionId].filter(function (task) {
            return !task.isCompleted();
        });
    };

    /**
     * Find incomplete tasks across all users
     *
     * @param regionId
     * @returns {*}
     */
    self.getIncompleteTasksAcrossAllUsers = function (regionId) {
        if (!regionId && regionId !== 0) {
            console.error("regionId is not specified")
        }
        if (!(regionId in self._taskStoreByRegionId)) {
            self.fetchTasksInARegion(regionId, null, false);
            // console.error("regionId is not in _taskStoreByRegionId. This is probably because " +
            //    "you have not fetched the tasks in the region yet (e.g., by fetchTasksInARegion)");
            // return null;
        }
        if (!Array.isArray(self._taskStoreByRegionId[regionId])) {
            console.error("_taskStoreByRegionId[regionId] is not an array. " +
                "Probably the data from this region is not loaded yet.");
            return null;
        }

        var incompleteTasksByUser = self._taskStoreByRegionId[regionId].filter(function (task) {
            return !task.isCompleted();
        });

        var incompleteTasksAcrossAllUsers = [];
        if (incompleteTasksByUser.length > 0) {
            incompleteTasksAcrossAllUsers = incompleteTasksByUser.filter(function (t) {
                return t.getStreetCompletionCount() === 0;
            });
        }

        return incompleteTasksAcrossAllUsers;
    };

    this.getTasksInRegion = function (regionId) {
        return regionId in self._taskStoreByRegionId ? self._taskStoreByRegionId[regionId] : null;
    };

    /**
     * Check if the current task is the first task in this session
     * @returns {boolean}
     */
    function isFirstTask () {
        return length() === 0;
    }

    /**
     * Get the length of the previous tasks
     * @returns {*|Number}
     */
    function length () {
        return previousTasks.length;
    }

    function findNeighborhoodCompleteAcrossAllUsers(neighborhoodId, finishedTask) {
        var isNeighborhoodCompleteAcrossAllUsers = neighborhoodModel.getNeighborhoodCompleteAcrossAllUsers();

        // Only run this code if the neighborhood is set as incomplete
        if (!isNeighborhoodCompleteAcrossAllUsers) {
            var candidateTasks = self.getIncompleteTasksAcrossAllUsers(neighborhoodId).filter(function (t) {
                return (t.getStreetEdgeId() !== (finishedTask ? finishedTask.getStreetEdgeId() : null));
            });
            // Indicates neighborhood is complete
            if (candidateTasks.length === 0) {
                neighborhoodModel.setNeighborhoodCompleteAcrossAllUsers();
                //console.log("Neighborhood complete");
                isNeighborhoodCompleteAcrossAllUsers = true;
                $('#neighborhood-completion-overlay').show();
                tracker.push("NeighborhoodComplete_AcrossAllUsers", {'RegionId': neighborhoodId})
            } else {
                //console.log("Neighborhood not complete");
                isNeighborhoodCompleteAcrossAllUsers = false;
            }
        }

        return isNeighborhoodCompleteAcrossAllUsers;
    }

    /**
     * Get the next task and set it as a current task.
     *
     * Procedure:
     * Get the list of highest priority streets that this user has not audited
     * - If the street you just audited connects to any of those, pick the highest priority one
     * - O/w jump to the highest priority street
     *
     * @param finishedTask The task that has been finished.
     * @returns {*} Next task
     */
    this.nextTask = function (finishedTask) {
        var newTask;
        var userCandidateTasks = null;
        var neighborhood = neighborhoodModel.currentNeighborhood();
        var currentNeighborhoodId = neighborhood.getProperty("regionId");

        // Find highest priority task not audited by the user
        var tasksNotCompletedByUser = self.getTasksInRegion(currentNeighborhoodId).filter(function (t) {
            return !t.isCompleted() && t.getStreetEdgeId() !== (finishedTask ? finishedTask.getStreetEdgeId() : null);
        }).sort(function(t1, t2) {
            return t2.getStreetPriority() - t1.getStreetPriority();
        });
        if (tasksNotCompletedByUser.length === 0) { // user has audited entire region
            return null;
        }
        var highestPriorityTask = tasksNotCompletedByUser[0];
        console.log(highestPriorityTask);

        // If any of the connected tasks has max discretized priority, pick the highest priority one, o/w take the
        // highest priority task in the region.
        userCandidateTasks = self._findConnectedTasks(currentNeighborhoodId, finishedTask, false, null, null);
        console.log(userCandidateTasks);

        userCandidateTasks = userCandidateTasks.filter(function(t) {
            return !t.isCompleted() && t.getStreetPriorityDiscretized() === highestPriorityTask.getStreetPriorityDiscretized();
        }).sort(function(t1,t2) {
            return t2.getStreetPriority() - t1.getStreetPriority();
        });
        console.log(userCandidateTasks);

        if (userCandidateTasks.length > 0) {
            newTask = userCandidateTasks[0];
        } else {
            newTask = highestPriorityTask;
        }

        // Return the new task. Change the starting point of the new task accordingly.
        if (finishedTask) {
            var coordinate = finishedTask.getLastCoordinate();
            newTask.setStreetEdgeDirection(coordinate.lat, coordinate.lng);
        }

        return newTask;
    };

    /**
     * Push a task to previousTasks
     * @param task
     */
    function pushATask (task) {
        if (previousTasks.indexOf(task) < 0) {
            previousTasks.push(task);
        }
    }

    /**
     * Pop a task at the end of previousTasks
     * @returns {*}
     */
    function pop () {
        return previousTasks.pop();
    }

    /**
     * Set the current task
     * @param task
     */
    this.setCurrentTask = function (task) {
        currentTask = task;
        if (tracker) tracker.push('TaskStart');

        if ('compass' in svl) {
            svl.compass.setTurnMessage();
            svl.compass.showMessage();
            if (!svl.map.getLabelBeforeJumpListenerStatus()) svl.compass.update();
        }

        if ('form' in svl){
            svl.form.submit(svl.form.compileSubmissionData(currentTask), currentTask);
        }
    };

    /**
     * Store the before jump new task
     * @param task
     */
    this.setBeforeJumpNewTask = function (task) {
        beforeJumpNewTask = task;
    };

    /**
     * Store a task into taskStoreByRegionId
     * @param regionId {number} Region id
     * @param task {object} Task object
     */
    // TODO: Issue 839
    function storeTask(regionId, task) {
        if (!(regionId in self._taskStoreByRegionId)) self._taskStoreByRegionId[regionId] = [];
        var streetEdgeIds = self._taskStoreByRegionId[regionId].map(function (task) {
            return task.getStreetEdgeId();
        });
        if (streetEdgeIds.indexOf(task.getStreetEdgeId()) < 0) self._taskStoreByRegionId[regionId].push(task);
    }

    /**
     *
     * @param regionId
     */
    function totalLineDistanceInARegion(regionId, unit) {
        if (!unit) unit = "kilometers";
        var tasks = self.getTasksInRegion(regionId);

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
     * Todo. This should be done somewhere else.
     */
    function update () {
        for (var i = 0, len = previousTasks.length; i < len; i++) {
            previousTasks[i].render();
        }

        var currentLatLng = navigationModel.getPosition();
        currentTask.updateTheFurthestPointReached(currentLatLng.lat, currentLatLng.lng);
        currentTask.render();
    }

    /**
     * Update the audited distance by combining the distance previously traveled and the distance the user traveled in
     * the current session.
     * Todo. Fix this. The function name should be clear that this updates the global distance rather than the distance traveled in the current neighborhood.
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
        svl.statusFieldNeighborhood.setAuditedDistance(distance.toFixed(1));
        return this;
    }

    // self.endTask = endTask;
    self.fetchATask = fetchATask;
    self.getCompletedTasks = getCompletedTasks;
    self.getCurrentTaskDistance = getCurrentTaskDistance;
    self.getCompletedTaskDistance = getCompletedTaskDistance;
    self.getCurrentTask = getCurrentTask;
    self.getBeforeJumpNewTask = getBeforeJumpTask;
    self.isFirstTask = isFirstTask;
    self.length = length;
    // self.nextTask = getNextTask;
    self.push = pushATask;

    self.storeTask = storeTask;
    self.totalLineDistanceInARegion = totalLineDistanceInARegion;
    self.update = update;
    self.updateAuditedDistance = updateAuditedDistance;
}
