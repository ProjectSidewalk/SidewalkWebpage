/**
 * TaskContainer module.
 *
 * TODO This module needs to be cleaned up.
 * TODO Split the responsibilities. Storing tasks should remain here, but other things like fetching data from the server (should go to TaskModel) and rendering segments on a map.
 * @param neighborhoodModel
 * @param svl
 * @param tracker
 */
function TaskContainer (neighborhoodModel, svl, tracker) {
    const self = this;

    let currentTask = null;
    /* Used to keep track of the task we've decided to jump to while the user finishes labeling the current location. */
    let nextTaskAfterJump = null;
    let tasksFinishedLoading = false;

    self._tasks = [];

    self.tasksLoaded = function() {
        return tasksFinishedLoading;
    }

    /**
     * End the current task.
     */
    function endTask(task) {
        if (tracker) tracker.push("TaskEnd");
        task.complete();
        // Go through the tasks and mark the completed task as isComplete=true.
        for (let i = 0, len = self._tasks.length;  i < len; i++) {
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

        if (svl.user.getProperty('role') === "Anonymous"
            && getCompletedTaskDistance({ units: 'kilometers' }) > 0.15
            && !svl.popUpMessage.haveAskedToSignIn()) {
            svl.popUpMessage.promptSignIn();
        }

        // Updates the segments that the user has already explored.
        self.updateCurrentTask();

        return task;
    }

    /**
     * Request the server to populate tasks
     * TODO Move this to somewhere else. TaskModel?
     */
    self.fetchTasks = function() {
        const currMission = svl.missionContainer.getCurrentMission();
        const currMissionId = currMission.getProperty('missionId');
        let url;
        if (svl.neighborhoodModel.isRoute) url = `/routeTasks?userRouteId=${svl.userRouteId}`;
        else url = `/tasks?regionId=${svl.neighborhoodModel.currentNeighborhood().getRegionId()}`;

        return fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        })
            .then((response) => response.json())
            .then(async (result) => {
                let task;
                const currStreetId = getCurrentTaskStreetEdgeId();
                for (let i = 0; i < result.features.length; i++) {
                    // Skip the task that we were given to start with so that we don't add a duplicate.
                    if (result.features[i].properties.street_edge_id !== currStreetId) {
                        task = new Task(result.features[i], false);
                        if ((result.features[i].properties.completed)) task.complete();
                        self._tasks.push(task);

                        // If the street was part of the curr mission, add it to the list!
                        if (task.getProperty('currentMissionId') === currMissionId) {
                            currMission.pushATaskToTheRoute(task);
                        }
                    }
                }
                tasksFinishedLoading = true;
            })
            .catch(error => {
                console.error(error);
            });
    };

    /**
     * Updates the task priorities for the given set of streets. These should be updated from other users' audits.
     * @param {{street_edge_id: number, priority: number}} updatedPriorities Any streets with a new priority value
    */
    function updateTaskPriorities(updatedPriorities) {
        // Loop through all updatedPriorities and update self._tasks with the new priorities.
        updatedPriorities.forEach(function (newPriority) {
            const index = self._tasks.findIndex((s) => { return s.getStreetEdgeId() === newPriority.street_edge_id; });
            self._tasks[index].setProperty('priority', newPriority.priority);
        });
    }

    /**
     * Find incomplete tasks (i.e., street edges) that are connected to the given task.
     *
     * @param {object} taskIn Task to check whether any available tasks are connected
     * @param {number} threshold Distance threshold in km, unless specified in unit parameter
     * @param {object} [unit] Object with field 'units' holding distance unit, default to 'kilometers'
     * @returns {Task[]} Array of tasks that are connected to the given task
     * @private
     */
    self._findConnectedTasks = function(taskIn, threshold, unit) {
        if (!unit) unit = { units: 'kilometers' };
        let tasks = self.getTasks();

        let connectedTasks = [];
        if (taskIn && tasks) {
            tasks = tasks.filter(function (t) {
                return !t.isComplete() && t.getStreetEdgeId() !== taskIn.getStreetEdgeId();
            });

            for (let i = 0, len = tasks.length; i < len; i++) {
                if (taskIn.isConnectedTo(tasks[i], threshold, unit)) {
                    connectedTasks.push(tasks[i]);
                }
            }
        }

        return connectedTasks;
    };

    /**
     * Get the total distance of completed segments.
     * @params {{units: string}} [units] Object with field 'units' holding distance unit, default to 'kilometers'
     * @returns {number} distance in unit.
     */
    function getCompletedTaskDistance(units) {
        if (!units) units = { units: i18next.t('common:unit-distance') };
        const completedTasks = getCompletedTasks()
        let feature;
        let distance = 0;

        if (completedTasks) {
            for (let i = 0, len = completedTasks.length; i < len; i++) {
                feature = completedTasks[i].getGeoJSON();
                distance += turf.length(feature, units);
            }
        }
        if (!currentTask.isComplete()) distance += getCurrentTaskDistance(units);

        return distance;
    }

    /**
     * Get the total distance of segments completed by any user.
     *
     * @returns {number} distance in unit.
     */
    function getCompletedTaskDistanceAcrossAllUsersUsingPriority() {
        const unit = { units: i18next.t('common:unit-distance') };
        const tasks = self.getTasks().filter(function(t) { return t.getStreetPriority() < 1; });
        let feature;
        let distance = 0;

        if (tasks) {
            for (let i = 0; i < tasks.length; i++) {
                feature = tasks[i].getGeoJSON();
                distance += turf.length(feature, unit);
            }
        }
        return distance;
    }

    /**
     *
     * @param {object} [unit] Object with field 'units' holding distance unit, default to 'kilometers'
     * @returns {number}
     */
    function getCurrentTaskDistance(unit) {
        if (!unit) unit = {units: 'kilometers'};

        if (currentTask) {
            const currentLatLng = svl.panoViewer.getPosition();
            currentTask.updateTheFurthestPointReached(currentLatLng);
            return currentTask.getAuditedDistance(unit);
        }
        return 0;
    }

    /**
     * This method returns the completed tasks.
     * @returns {Task[]}
     */
    function getCompletedTasks() {
        return self._tasks.filter(function (task) { return task.isComplete(); });
    }

    /**
     * Return list of tasks completed by any user.
     * @returns {Task[]}
     */
    function getCompletedTasksAllUsersUsingPriority() {
        return self._tasks.filter(function (task) { return task.getStreetPriority() < 1; });
    }

    /**
     * Get the current task
     * @returns {Task}
     */
    function getCurrentTask() {
        return currentTask;
    }

    /**
     * Store the task to jump to once the current intersection is complete.
     * @param {Task} task
     */
    this.setNextTaskAfterJump = function(task) {
        nextTaskAfterJump = task;
    };

    /**
     * Get the task to jump to once the current intersection is complete.
     * TODO This might make more sense in NavigationService..?
     * @returns {Task}
     */
    function getNextTaskAfterJump() {
        return nextTaskAfterJump;
    }

    /**
     * Find incomplete tasks by the user.
     */
    self.getIncompleteTasks = function() {
        return self._tasks.filter(function (task) { return !task.isComplete(); });
    };

    /**
     * Find incomplete tasks across all users.
     */
    self.getIncompleteTasksAcrossAllUsersUsingPriority = function() {
        const incompleteTasksByUser = self._tasks.filter(function (task) { return !task.isComplete(); });

        let incompleteTasksAcrossAllUsers = [];
        if (incompleteTasksByUser.length > 0) {
            incompleteTasksAcrossAllUsers = incompleteTasksByUser.filter(function (t) {
                return t.getStreetPriority() === 1;
            });
        }

        return incompleteTasksAcrossAllUsers;
    };

    this.getTasks = function() {
        return self._tasks;
    };

    /**
     * Checks if finishedTask makes the neighborhood complete across all users; if so, it displays the relevant overlay.
     *
     * @param {Task} finishedTask
     */
    function updateNeighborhoodCompleteAcrossAllUsersStatus(finishedTask) {
        // Only run this code if the neighborhood was set as incomplete and user is not on a designated route.
        if (!neighborhoodModel.isRoute && !neighborhoodModel.getNeighborhoodCompleteAcrossAllUsers()) {
            const candidateTasks = self.getIncompleteTasksAcrossAllUsersUsingPriority().filter(function (t) {
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
                const currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
                const currentNeighborhoodId = currentNeighborhood.getRegionId();

                console.log('neighborhood: ' + currentNeighborhoodId + ": " + currentNeighborhood);

                tracker.push("NeighborhoodComplete_AcrossAllUsers", { 'RegionId': currentNeighborhoodId });
            }
        }
    }

    /**
     * Get the next task.
     *
     * TODO It's not immediately obvious how much this function handles. Some things should likely be separated.
     *
     * Procedure:
     * Get the list of the highest priority streets that this user has not audited
     * - If the street you just audited connects to any of those, pick the highest priority one
     * - O/w jump to the highest priority street
     *
     * @param {Task} finishedTask The task that has been finished
     * @returns {Task} Next task
     */
    this.nextTask = function(finishedTask) {
        let newTask;

        // Check if this task finishes the neighborhood across all users, if so, shows neighborhood complete overlay.
        updateNeighborhoodCompleteAcrossAllUsersStatus(finishedTask);

        // Check if user has audited entire region or route.
        let tasksNotCompletedByUser = self.getTasks().filter(function (t) {
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
            const highestPriorityTask = tasksNotCompletedByUser.sort(function(t1, t2) {
                    return t2.getStreetPriority() - t1.getStreetPriority();
                })[0];
            const highestPriorityDiscretized = highestPriorityTask.getStreetPriorityDiscretized();

            // Get list of connected streets. If empty, try with a progressively wider radius 5m, 10m, 25m.
            let connectedTasks = self._findConnectedTasks(finishedTask, 0.005);
            if (connectedTasks.length === 0) {
                connectedTasks = self._findConnectedTasks(finishedTask, 0.010);
            }
            if (connectedTasks.length === 0) {
                connectedTasks = self._findConnectedTasks(finishedTask, svl.CONNECTED_TASK_THRESHOLD);
            }

            // If any of the connected tasks has max discretized priority, pick the highest priority connected street,
            // o/w take the highest priority task in the neighborhood.
            connectedTasks = connectedTasks.filter(function (t) {
                return t.getStreetPriorityDiscretized() === highestPriorityDiscretized;
            }).sort(function (t1, t2) {
                return t2.getStreetPriority() - t1.getStreetPriority();
            });
            let connectedTask;
            if (connectedTasks.length > 0) {
                newTask = connectedTasks[0];
                connectedTask = true;
            } else {
                newTask = highestPriorityTask;
                connectedTask = false;
            }

            // Set the start point of the new task. If it's connected to the current task or is nearby, use the current
            // task's endpoint to avoid accidentally marking the user as being at the end of the street. Otherwise
            // (street not connected, user will need to jump), if the default endpoint of the new task is not connected
            // to any streets, try reversing its direction to encourage contiguous routes.
            // TODO take into account street priority when checking for connected tasks here.
            if (newTask && finishedTask) {
                let startPoint;
                const line = newTask.getGeoJSON();
                const endPoint = turf.point([finishedTask.getEndCoordinate().lng, finishedTask.getEndCoordinate().lat]);
                const taskNearby = turf.pointToLineDistance(endPoint, line) < svl.CLOSE_TO_ROUTE_THRESHOLD * 1.5;
                if (connectedTask || taskNearby) {
                    startPoint = finishedTask.getEndCoordinate();
                    newTask.setStreetEdgeDirection(startPoint);
                } else if (self._findConnectedTasks(newTask, svl.CONNECTED_TASK_THRESHOLD).length === 0) {
                    newTask.reverseStreetDirection();
                }
            }
        }
        newTask.setProperty('taskStart', new Date());
        newTask.render();
        return newTask;
    };

    /**
     * Set the current task
     * @param {Task} task
     */
    this.setCurrentTask = function(task) {
        currentTask = task;
        if ('missionContainer' in svl) {
            const currMissionId = svl.missionContainer.getCurrentMission().getProperty('missionId');
            currentTask.setProperty('currentMissionId', currMissionId);
        }
        tracker.push('TaskStart');

        if ('compass' in svl) {
            svl.compass.showMessage();
            svl.compass.update();
        }

        if ('form' in svl) {
            svl.form.submitData(currentTask); // Note that this happens async.
        }

        // Show AI guidance message if applicable.
        if (svl.aiGuidance) svl.aiGuidance.showAiGuidanceMessage();
    };

    /**
     * Get the street id of the current task.
     */
    function getCurrentTaskStreetEdgeId() {
        return currentTask ? currentTask.getStreetEdgeId() : null;
    }

    /**
     *
     * @param {object} [unit] Object with field 'units' holding distance unit, default to 'kilometers'
     */
    function totalLineDistanceInNeighborhood(unit) {
        if (!unit) unit = { units: 'kilometers' };
        const tasks = self.getTasks();

        if (tasks) {
            const distanceArray = tasks.map(function (t) { return t.lineDistance(unit); });
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
        const currentLatLng = svl.panoViewer.getPosition();
        currentTask.updateTheFurthestPointReached(currentLatLng);
        currentTask.render();
    }

    /**
     * Update the audited distance in the right sidebar using the length of the streets in the current neighborhood.
     * @returns {updateAuditedDistance}
     */
    function updateAuditedDistance() {
        let distance = 0;
        const neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();

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
    self.getNextTaskAfterJump = getNextTaskAfterJump;
    self.renderAllTasks = renderAllTasks;
    self.hasMaxPriorityTask = hasMaxPriorityTask;
    self.totalLineDistanceInNeighborhood = totalLineDistanceInNeighborhood;
    self.updateCurrentTask = updateCurrentTask;
    self.updateAuditedDistance = updateAuditedDistance;
    self.updateTaskPriorities = updateTaskPriorities;
    self.getCurrentTaskStreetEdgeId = getCurrentTaskStreetEdgeId;
}
