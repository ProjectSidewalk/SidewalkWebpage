/**
 * TaskContainer module.
 *
 * TODO This module needs to be cleaned up.
 * TODO Split the responsibilities. Storing tasks should remain here, but other things like fetching data from the server (should go to TaskModel) and rendering segments on a map.
 * @param navigationModel
 * @param neighborhoodModel
 * @param streetViewService
 * @param svl
 * @param tracker
 */
function TaskContainer (navigationModel, neighborhoodModel, streetViewService, svl, tracker) {
    var self = this;

    var previousTasks = [];
    var currentTask = null;
    var afterJumpNewTask = null;
    var tasksFinishedLoading = false;

    self._tasks = [];
    self._showNeighborhoodCompleteOverlayStatus = false;

    self.tasksLoaded = function() {
        return tasksFinishedLoading;
    }

    self.getFinishedAndInitNextTask = function (finished) {
        self.showNeighborhoodCompleteOverlayIfRequired();
        var newTask = self.nextTask(finished);
        if (!newTask) {
            svl.neighborhoodModel.setComplete();
        } else {
            svl.taskContainer.initNextTask(newTask);
        }
        return newTask;
    };

    self.initNextTask = function (nextTaskIn) {
        navigationModel.disableWalking();

        if (streetViewService) {
            var geometry = nextTaskIn.getGeometry();
            var lat = geometry.coordinates[0][1];
            var lng = geometry.coordinates[0][0];
            var latLng = new google.maps.LatLng(lat, lng);
            streetViewService.getPanorama({ location: latLng, radius: svl.STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR },
                function (streetViewPanoramaData, status) {
                    navigationModel.enableWalking();
                    if (status === google.maps.StreetViewStatus.OK) {
                        lat = streetViewPanoramaData.location.latLng.lat();
                        lng = streetViewPanoramaData.location.latLng.lng();
                        let beforeJumpTask = currentTask;
                        self.setCurrentTask(nextTaskIn);
                        beforeJumpTask.render();
                        navigationModel.setPosition(lat, lng, function(){
                            navigationModel.preparePovReset();
                        });
                    } else {
                        console.error("Error loading Street View imagery");
                        svl.tracker.push("PanoId_NotFound", { 'Location': JSON.stringify(latLng) });
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
    function endTask(task, nextTask) {
        if (tracker) tracker.push("TaskEnd");
        task.complete();
        // Go through the tasks and mark the completed task as isComplete=true
        for (var i = 0, len = self._tasks.length;  i < len; i++) {
            if (task.getStreetEdgeId() === self._tasks[i].getStreetEdgeId()) {
                // Check if the reference passed in from the method parameter and the array are the same.
                // This is needed because otherwise we could update a reference to the same task twice.
                if (task !== self._tasks[i]) {
                    self._tasks[i].complete();
                }
            }
        }

        // Update the audited distance in the right sidebar.
        updateAuditedDistance();

        if (!('user' in svl) || (svl.user.getProperty('role') === "Anonymous" &&
            getCompletedTaskDistance({units: 'kilometers'}) > 0.15 &&
            !svl.popUpMessage.haveAskedToSignIn())) {
            svl.popUpMessage.promptSignIn();
        }

        // Submit the data.
        svl.form.submitData(task);

        pushATask(task); // Push the data into previousTasks.

        // Updates the segments that the user has already explored.
        self.updateCurrentTask();
        // Renders the next street that the user will explore.
        if(nextTask) nextTask.render();

        return task;
    }

    /**
     * Request the server to populate tasks
     * TODO Move this to somewhere else. TaskModel?
     * @param callback A callback function
     * @param async {boolean}
     */
    self.fetchTasks = function (callback, async) {
        if (typeof async == "undefined") async = true;
        var currMission = svl.missionContainer.getCurrentMission();
        var currMissionId = currMission.getProperty('missionId');
        var url;
        if (svl.neighborhoodModel.isRoute) url = `/routeTasks?userRouteId=${svl.userRouteId}`;
        else url = `/tasks?regionId=${svl.neighborhoodModel.currentNeighborhood().getRegionId()}`;

        $.ajax({
            url: url,
            async: async,
            type: 'get',
            success: function (result) {
                var task;
                var currStreetId = getCurrentTaskStreetEdgeId();
                for (var i = 0; i < result.length; i++) {
                    // Skip the task that we were given to start with so that we don't add a duplicate.
                    if (result[i].features[0].properties.street_edge_id !== currStreetId) {
                        task = new Task(result[i], false);
                        if ((result[i].features[0].properties.completed)) task.complete();
                        self._tasks.push(task);

                        // If the street was part of the curr mission, add it to the list!
                        if (task.getProperty('currentMissionId') === currMissionId) {
                            currMission.pushATaskToTheRoute(task);
                        }
                    }
                }
                tasksFinishedLoading = true;

                if (callback) callback();
            },
            error: function (result) {
                console.error(result);
            }
        });
    };

    /**
     * Updates the task priorities for the given set of streets. These should be updates from other users' audits.
     * @param updatedPriorities
    */
    function updateTaskPriorities(updatedPriorities) {
        // Loop through all updatedPriorities and update self._tasks with the new priorities.
        updatedPriorities.forEach(function (newPriority) {
            const index = self._tasks.findIndex((s) => { return s.getStreetEdgeId() === newPriority.streetEdgeId; });
            self._tasks[index].setProperty('priority', newPriority.priority);
        });
    }

    /**
     * Find incomplete tasks (i.e., street edges) that are connected to the given task.
     *
     * @param taskIn {object} Task
     * @param acrossAllUsers
     * @param threshold {number} Distance threshold
     * @param unit {object} Distance unit
     * @returns {Array}
     * @private
     */
    self._findConnectedTasks = function (taskIn, acrossAllUsers, threshold, unit) {
        var tasks = self.getTasks();

        if (acrossAllUsers) {
            tasks = tasks.filter(function (t) { return t.streetCompletedByAnyUser(); });
        }

        if (taskIn && tasks) {
            var connectedTasks = [];
            if (!threshold) threshold = 0.01;  // 0.01 km.
            if (!unit) unit = { units: 'kilometers' };

            tasks = tasks.filter(function (t) {
                return !t.isComplete() && t.getStreetEdgeId() !== taskIn.getStreetEdgeId();
            });

            for (var i = 0, len = tasks.length; i < len; i++) {
                if (taskIn.isConnectedTo(tasks[i], threshold, unit)) {
                    connectedTasks.push(tasks[i]);
                }
            }
            return connectedTasks;
        } else {
            return [];
        }
    };

    /**
     * Get the total distance of completed segments
     * @params {unit} String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in unit.
     */
    function getCompletedTaskDistance(unit) {
        if (!unit) unit = { units: i18next.t('common:unit-distance') };
        var completedTasks = getCompletedTasks(),
            geojson,
            feature,
            distance = 0;

        if (completedTasks) {
            for (var i = 0, len = completedTasks.length; i < len; i++) {
                geojson = completedTasks[i].getGeoJSON();
                feature = geojson.features[0];
                distance += turf.length(feature, unit);
            }
        }
        if (!currentTask.isComplete()) distance += getCurrentTaskDistance(unit);

        return distance;
    }

    /**
     * Get the total distance of segments completed by any user.
     *
     * @returns {number} distance in unit.
     */
    function getCompletedTaskDistanceAcrossAllUsersUsingPriority() {
        var unit = { units: i18next.t('common:unit-distance') };
        var tasks = self.getTasks().filter(function(t) { return t.getStreetPriority() < 1; });
        var geojson;
        var feature;
        var distance = 0;

        if (tasks) {
            for (var i = 0; i < tasks.length; i++) {
                geojson = tasks[i].getGeoJSON();
                feature = geojson.features[0];
                distance += turf.length(feature, unit);
            }
        }
        return distance;
    }

    /**
     *
     * @param unit {string} Distance unit
     * @returns {*}
     */
    function getCurrentTaskDistance(unit) {
        if (!unit) unit = {units: 'kilometers'};

        if (currentTask) {
            var currentLatLng = navigationModel.getPosition();
            currentTask.updateTheFurthestPointReached(currentLatLng.lat, currentLatLng.lng);
            return currentTask.getAuditedDistance(unit);
        }
        return 0;
    }

    /**
     * This method returns the completed tasks.
     * @returns {Array}
     */
    function getCompletedTasks() {
        return self._tasks.filter(function (task) { return task.isComplete(); });
    }

    /**
     * Return list of tasks completed by any user.
     * @returns {Array of tasks}
     */
    function getCompletedTasksAllUsersUsingPriority() {
        return self._tasks.filter(function (task) { return task.getStreetPriority() < 1; });
    }

    /**
     * Get the current task
     * @returns {*}
     */
    function getCurrentTask() {
        return currentTask;
    }

    /**
     * Get the before jump task
     * @returns {*}
     */
    function getAfterJumpNewTask() {
        return afterJumpNewTask;
    }

    /**
     * Find incomplete tasks by the user.
     */
    self.getIncompleteTasks = function () {
        return self._tasks.filter(function (task) { return !task.isComplete(); });
    };

    /**
     * Find incomplete tasks across all users.
     */
    self.getIncompleteTasksAcrossAllUsersUsingPriority = function () {
        var incompleteTasksByUser = self._tasks.filter(function (task) { return !task.isComplete(); });

        var incompleteTasksAcrossAllUsers = [];
        if (incompleteTasksByUser.length > 0) {
            incompleteTasksAcrossAllUsers = incompleteTasksByUser.filter(function (t) {
                return t.getStreetPriority() === 1;
            });
        }

        return incompleteTasksAcrossAllUsers;
    };

    this.getTasks = function () {
        return self._tasks;
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

    /**
     * Checks if finishedTask makes the neighborhood complete across all users; if so, it displays the relevant overlay.
     * UPDATE: THIS FUNCTION IS NOW UNUSED
     *
     * @param finishedTask
     */
    function updateNeighborhoodCompleteAcrossAllUsersStatus(finishedTask) {
        // Only run this code if the neighborhood was set as incomplete and user is not on a designated route.
        if (!neighborhoodModel.isRoute && !neighborhoodModel.getNeighborhoodCompleteAcrossAllUsers()) {
            var candidateTasks = self.getIncompleteTasksAcrossAllUsersUsingPriority().filter(function (t) {
                return (t.getStreetEdgeId() !== (finishedTask ? finishedTask.getStreetEdgeId() : null));
            });
            // Indicates neighborhood is complete.
            if (candidateTasks.length === 0) {
                // TODO: Remove the console.log statements if issue #1449 has been resolved.
                console.error('finished neighborhood screen has appeared, logging debug info');
                console.trace();
                console.log('incompleteTasks.length:' +
                    self.getIncompleteTasksAcrossAllUsersUsingPriority().length);
                console.log('finishedTask streetEdgeId: ' + finishedTask.getStreetEdgeId());

                neighborhoodModel.setNeighborhoodCompleteAcrossAllUsers();
                svl.ui.areaComplete.overlay.show();
                var currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
                var currentNeighborhoodId = currentNeighborhood.getRegionId();

                console.log('neighborhood: ' + currentNeighborhoodId + ": " + currentNeighborhood);

                tracker.push("NeighborhoodComplete_AcrossAllUsers", { 'RegionId': currentNeighborhoodId });
            }
        }
    }

    /**
     * Get the next task.
     *
     * Procedure:
     * Get the list of the highest priority streets that this user has not audited
     * - If the street you just audited connects to any of those, pick the highest priority one
     * - O/w jump to the highest priority street
     *
     * @param finishedTask The task that has been finished.
     * @returns {*} Next task
     */
    this.nextTask = function (finishedTask) {
        var newTask;
        // Check if user has audited entire region or route.
        var tasksNotCompletedByUser = self.getTasks().filter(function (t) {
            return !t.isComplete() && t.getStreetEdgeId() !== (finishedTask ? finishedTask.getStreetEdgeId() : null);
        });
        if (tasksNotCompletedByUser.length === 0) {
            return null;
        }

        if (svl.neighborhoodModel.isRoute) {
            // For a route, the user will go to the street with the next highest routeStreetId.
            newTask = tasksNotCompletedByUser.reduce((min, current) => {
                return current.getProperty('routeStreetId') < min.getProperty('routeStreetId') ? current : min;
            }, tasksNotCompletedByUser[0]);
        } else {
            // If not part of a route, check for a connected task with a high priority. If none, jump to the highest
            // priority task that isn't connected.

            // Find the highest priority task not audited by the user.
            var highestPriorityTask = tasksNotCompletedByUser.sort(function(t1, t2) {
                    return t2.getStreetPriority() - t1.getStreetPriority();
                })[0];
            var highestPriorityDiscretized = highestPriorityTask.getStreetPriorityDiscretized();

            // Get list of connected streets. If empty, try again with a larger radius.
            var connectedTasks = self._findConnectedTasks(finishedTask, false, 0.0075, { units: 'kilometers' });
            if (connectedTasks.length === 0) {
                connectedTasks = self._findConnectedTasks(finishedTask, false, 0.15, { units: 'kilometers' });
            }

            // If any of the connected tasks has max discretized priority, pick the highest priority connected street,
            // o/w take the highest priority task in the neighborhood.
            connectedTasks = connectedTasks.filter(function (t) {
                return t.getStreetPriorityDiscretized() === highestPriorityDiscretized;
            }).sort(function (t1, t2) {
                return t2.getStreetPriority() - t1.getStreetPriority();
            });
            var connectedTask;
            if (connectedTasks.length > 0) {
                newTask = connectedTasks[0];
                connectedTask = true;
            } else {
                newTask = highestPriorityTask;
                connectedTask = false;
            }

            // Set the start point of the new task. If it's connected to the current task or is generally nearby, use the
            // current task's endpoint to avoid accidentally marking the user as being at the end of the street. Otherwise
            // (street not connected, user will need to jump), if the default endpoint of the new task is not connected to
            // any streets, try reversing its direction to encourage contiguous routes.
            // TODO take into account street priority when checking for connected tasks here.
            if (finishedTask) {
                var startPoint;
                var line = newTask.getGeoJSON().features[0];
                var endPoint = turf.point([finishedTask.getLastCoordinate().lng, finishedTask.getLastCoordinate().lat]);
                var taskNearby = turf.pointToLineDistance(endPoint, line) < svl.CLOSE_TO_ROUTE_THRESHOLD * 1.5;
                if (connectedTask || taskNearby) {
                    startPoint = finishedTask.getLastCoordinate();
                    newTask.setStreetEdgeDirection(startPoint.lat, startPoint.lng);
                } else if (self._findConnectedTasks(newTask, false, null, null).length === 0) {
                    newTask.reverseStreetDirection();
                }
            }
        }
        newTask.setProperty('taskStart', new Date());
        newTask.render();
        return newTask;
    };

    /**
     * Check if a task is the last incomplete task in the neighborhood.
     * @param task
     */
    function isLastIncompleteTaskInNeighborhood(task) { 
        // If this is the last incomplete task in the neighborhood, it should be the only task in the 
        // incompleteTasksAcrossAllUsers list and should have priority = 1.
        var incompleteTasksAcrossAllUsers = self.getIncompleteTasksAcrossAllUsersUsingPriority();
        return incompleteTasksAcrossAllUsers.length === 1 && 
            incompleteTasksAcrossAllUsers[0].getStreetEdgeId() === task.getStreetEdgeId() && 
            task.getProperty('priority') === 1; 
    }

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
        if ('missionContainer' in svl) {
            var currMissionId = svl.missionContainer.getCurrentMission().getProperty('missionId');
            currentTask.setProperty('currentMissionId', currMissionId);
        }
        if (tracker) tracker.push('TaskStart');

        if ('compass' in svl) {
            svl.compass.setTurnMessage();
            svl.compass.showMessage();
            if (!svl.map.getLabelBeforeJumpListenerStatus()) svl.compass.update();
        }

        if ('form' in svl){
            svl.form.submitData(currentTask);
        }
    };

    /**
     * Display the neighborhood complete overlay if state permits it to be shown.
     * Reset the corresponding state afterwards.
     */
    this.showNeighborhoodCompleteOverlayIfRequired = function () {
        if (self.getShowNeighborhoodCompleteOverlayStatus()) {
            neighborhoodModel.setNeighborhoodCompleteAcrossAllUsers();
            svl.ui.areaComplete.overlay.show();
            tracker.push("NeighborhoodComplete_AcrossAllUsers", { 'RegionId': currentNeighborhood.getRegionId() });
        }
        self.setShowNeighborhoodCompleteOverlayStatus(false);
    }

    /**
     * Get the show neighborhood overlay status boolean.
     */
    this.getShowNeighborhoodCompleteOverlayStatus = function () {
        return self._showNeighborhoodCompleteOverlayStatus;
    }

    /**
     * Set the show neighborhood overlay status boolean to a given value.
     * @param value
     */
    this.setShowNeighborhoodCompleteOverlayStatus = function (value) {
        self._showNeighborhoodCompleteOverlayStatus = value;
    }

    /**
     * Get the street id of the current task.
     */
    function getCurrentTaskStreetEdgeId() {
        return currentTask ? currentTask.getStreetEdgeId() : null;
    }

    /**
     * Store the before jump new task
     * @param task
     */
    this.setBeforeJumpNewTask = function (task) {
        afterJumpNewTask = task;
    };

    /**
     *
     * @param unit {string} Distance unit
     */
    function totalLineDistanceInNeighborhood(unit) {
        if (!unit) unit = {units: 'kilometers'};
        var tasks = self.getTasks();

        if (tasks) {
            var distanceArray = tasks.map(function (t) { return t.lineDistance(unit); });
            return distanceArray.sum();
        } else {
            return null;
        }
    }

    /**
     * This method is called from Map.handlerPositionUpdate() to update the color of audited and unaudited street
     * segments of the current task on Google Maps.
     * TODO This should be done somewhere else.
     */
    function updateCurrentTask() {
        var currentLatLng = navigationModel.getPosition();
        currentTask.updateTheFurthestPointReached(currentLatLng.lat, currentLatLng.lng);
        currentTask.render();
    }

    /**
     * Update the audited distance in the right sidebar using the length of the streets in the current neighborhood.
     * @returns {updateAuditedDistance}
     */
    function updateAuditedDistance() {
        var distance = 0;
        var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();

        if (neighborhood) {
            distance = getCompletedTaskDistance({ units: i18next.t('common:unit-distance') });
        }
        svl.statusFieldNeighborhood.setAuditedDistance(distance);
        svl.statusFieldOverall.setNeighborhoodAuditedDistance(distance);
        return this;
    }

    /**
     * Checks if there are any max priority tasks remaining (proxy for neighborhood being complete across all users.
     * @returns {null|boolean}
     */
    function hasMaxPriorityTask() {
        return self._tasks.filter(function (task) { return task.getStreetPriority() === 1; }).length > 0;
    }

    /**
     * Renders all tasks to draw both unexplored and previously completed tasks. Should be called at page load
     * so it does not render redundantly.
     */
    function renderAllTasks() {
        for (let task of self._tasks) {
            task.render();
        }
    }

    self.endTask = endTask;
    self.getCompletedTasks = getCompletedTasks;
    self.getCompletedTasksAllUsersUsingPriority = getCompletedTasksAllUsersUsingPriority;
    self.getCurrentTaskDistance = getCurrentTaskDistance;
    self.getCompletedTaskDistance = getCompletedTaskDistance;
    self.getCompletedTaskDistanceAcrossAllUsersUsingPriority = getCompletedTaskDistanceAcrossAllUsersUsingPriority;
    self.getCurrentTask = getCurrentTask;
    self.getAfterJumpNewTask = getAfterJumpNewTask;
    self.isFirstTask = isFirstTask;
    self.length = length;
    self.isLastIncompleteTaskInNeighborhood = isLastIncompleteTaskInNeighborhood;
    self.push = pushATask;
    self.renderAllTasks = renderAllTasks;
    self.hasMaxPriorityTask = hasMaxPriorityTask;
    self.totalLineDistanceInNeighborhood = totalLineDistanceInNeighborhood;
    self.updateCurrentTask = updateCurrentTask;
    self.updateAuditedDistance = updateAuditedDistance;
    self.updateTaskPriorities = updateTaskPriorities;
    self.getCurrentTaskStreetEdgeId = getCurrentTaskStreetEdgeId;
}
