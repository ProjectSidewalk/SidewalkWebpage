/**
 * TaskContainer module.
 *
 * TODO This module needs to be cleaned up.
 * TODO Split the responsibilities. Storing tasks should remain here, but other things like fetching data from the server (should go to TaskModel) and rendering segments on a map.
 */
class TaskContainer {
    #neighborhoodModel;
    #svl;
    #tracker;

    #currentTask = null;
    /* Used to keep track of the task we've decided to jump to while the user finishes labeling the current location. */
    #nextTaskAfterJump = null;
    #tasksFinishedLoading = false;

    _tasks = [];

    /**
     * @param neighborhoodModel
     * @param svl
     * @param tracker
     */
    constructor(neighborhoodModel, svl, tracker) {
        this.#neighborhoodModel = neighborhoodModel;
        this.#svl = svl;
        this.#tracker = tracker;
    }

    tasksLoaded() {
        return this.#tasksFinishedLoading;
    }

    /**
     * End the current task.
     */
    endTask(task) {
        const svl = this.#svl;
        if (this.#tracker) this.#tracker.push("TaskEnd");
        task.complete();

        // Submit the data so that the task is marked as complete in the db. Note that this happens async.
        svl.form.submitData(task);

        // Update the audited distance in the right sidebar.
        this.updateAuditedDistance();

        if (svl.user.getProperty('role') === "Anonymous"
            && this.getCompletedTaskDistance({ units: 'kilometers' }) > 0.15
            && !svl.popUpMessage.haveAskedToSignIn()) {
            svl.popUpMessage.promptSignIn();
        }

        // Updates the segments that the user has already explored.
        this.updateCurrentTask();

        // Check if finishing this task completes the neighborhood across all users. Must run after task.complete() so
        // the just-finished task is filtered out of getIncompleteTasksAcrossAllUsersUsingPriority() naturally.
        this.#updateNeighborhoodCompleteAcrossAllUsersStatus();

        return task;
    }

    /**
     * Request the server to populate tasks
     * TODO Move this to somewhere else. TaskModel?
     */
    fetchTasks() {
        const svl = this.#svl;
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
                const currStreetId = this.getCurrentTaskStreetEdgeId();
                for (let i = 0; i < result.features.length; i++) {
                    // Skip the task that we were given to start with so that we don't add a duplicate.
                    if (result.features[i].properties.street_edge_id !== currStreetId) {
                        task = new Task(result.features[i], false);
                        if ((result.features[i].properties.completed)) task.complete();
                        this._tasks.push(task);

                        // If the street was part of the curr mission, add it to the list!
                        if (task.getProperty('currentMissionId') === currMissionId) {
                            currMission.pushATaskToTheRoute(task);
                        }
                    }
                }
                this.#tasksFinishedLoading = true;
            })
            .catch(error => {
                console.error(error);
            });
    }

    /**
     * Updates the task priorities for the given set of streets. These should be updated from other users' audits.
     * @param {{street_edge_id: number, priority: number}} updatedPriorities Any streets with a new priority value
    */
    updateTaskPriorities(updatedPriorities) {
        // Loop through all updatedPriorities and update _tasks with the new priorities.
        updatedPriorities.forEach((newPriority) => {
            const index = this._tasks.findIndex(s => s.getStreetEdgeId() === newPriority.street_edge_id);
            this._tasks[index].setProperty('priority', newPriority.priority);
        });
    }

    /**
     * Find incomplete tasks (i.e., street edges) that are connected to the given task.
     *
     * @param {object} taskIn Task to check whether any available tasks are connected
     * @param {number} threshold Distance threshold in km, unless specified in unit parameter
     * @param {object} [unit] Object with field 'units' holding distance unit, default to 'kilometers'
     * @returns {Task[]} Array of tasks that are connected to the given task
     */
    #findConnectedTasks(taskIn, threshold, unit) {
        if (!unit) unit = { units: 'kilometers' };
        let tasks = this.getTasks();

        const connectedTasks = [];
        if (taskIn && tasks) {
            tasks = tasks.filter(t => !t.isComplete() && t.getStreetEdgeId() !== taskIn.getStreetEdgeId());

            for (let i = 0, len = tasks.length; i < len; i++) {
                if (taskIn.isConnectedTo(tasks[i], threshold, unit)) {
                    connectedTasks.push(tasks[i]);
                }
            }
        }

        return connectedTasks;
    }

    /**
     * Get the total distance of completed segments.
     * @params {{units: string}} [units] Object with field 'units' holding distance unit, default to 'kilometers'
     * @returns {number} distance in unit.
     */
    getCompletedTaskDistance(units) {
        if (!units) units = { units: i18next.t('common:unit-distance') };
        const completedTasks = this.getCompletedTasks();
        let feature;
        let distance = 0;

        if (completedTasks) {
            for (let i = 0, len = completedTasks.length; i < len; i++) {
                feature = completedTasks[i].getGeoJSON();
                distance += turf.length(feature, units);
            }
        }
        if (!this.#currentTask.isComplete()) distance += this.getCurrentTaskDistance(units);

        return distance;
    }

    /**
     * Get the total distance of segments completed by any user.
     *
     * @returns {number} distance in unit.
     */
    getCompletedTaskDistanceAcrossAllUsersUsingPriority() {
        const unit = { units: i18next.t('common:unit-distance') };
        const tasks = this.getTasks().filter(t => t.getStreetPriority() < 1);
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
    getCurrentTaskDistance(unit) {
        if (!unit) unit = {units: 'kilometers'};

        if (this.#currentTask) {
            const currentLatLng = this.#svl.panoViewer.getPosition();
            this.#currentTask.updateTheFurthestPointReached(currentLatLng);
            return this.#currentTask.getAuditedDistance(unit);
        }
        return 0;
    }

    /**
     * This method returns the completed tasks.
     * @returns {Task[]}
     */
    getCompletedTasks() {
        return this._tasks.filter(task => task.isComplete());
    }

    /**
     * Return list of tasks completed by any user.
     * @returns {Task[]}
     */
    getCompletedTasksAllUsersUsingPriority() {
        return this._tasks.filter(task => task.getStreetPriority() < 1);
    }

    /**
     * Get the current task
     * @returns {Task}
     */
    getCurrentTask() {
        return this.#currentTask;
    }

    /**
     * Store the task to jump to once the current intersection is complete.
     * @param {Task} task
     */
    setNextTaskAfterJump(task) {
        this.#nextTaskAfterJump = task;
    }

    /**
     * Get the task to jump to once the current intersection is complete.
     * TODO This might make more sense in NavigationService..?
     * @returns {Task}
     */
    getNextTaskAfterJump() {
        return this.#nextTaskAfterJump;
    }

    /**
     * Find incomplete tasks by the user.
     */
    getIncompleteTasks() {
        return this._tasks.filter(task => !task.isComplete());
    }

    /**
     * Find incomplete tasks across all users.
     */
    getIncompleteTasksAcrossAllUsersUsingPriority() {
        const incompleteTasksByUser = this._tasks.filter(task => !task.isComplete());

        let incompleteTasksAcrossAllUsers = [];
        if (incompleteTasksByUser.length > 0) {
            incompleteTasksAcrossAllUsers = incompleteTasksByUser.filter(t => t.getStreetPriority() === 1);
        }

        return incompleteTasksAcrossAllUsers;
    }

    getTasks() {
        return this._tasks;
    }

    /**
     * Checks if the neighborhood is complete across all users; if so, displays the relevant overlay.
     */
    #updateNeighborhoodCompleteAcrossAllUsersStatus() {
        const neighborhoodModel = this.#neighborhoodModel;
        // Only run this code if the neighborhood was set as incomplete and user is not on a designated route.
        if (!neighborhoodModel.isRoute && !neighborhoodModel.getNeighborhoodCompleteAcrossAllUsers()) {
            // Indicates neighborhood is complete.
            if (this.getIncompleteTasksAcrossAllUsersUsingPriority().length === 0) {
                neighborhoodModel.setNeighborhoodCompleteAcrossAllUsers();
                $("#area-completion-overlay-wrapper").show();
                const currentNeighborhood = this.#svl.neighborhoodModel.currentNeighborhood();
                const currentNeighborhoodId = currentNeighborhood.getRegionId();
                this.#tracker.push("NeighborhoodComplete_AcrossAllUsers", { 'RegionId': currentNeighborhoodId });
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
    nextTask(finishedTask) {
        const svl = this.#svl;
        let newTask;

        // Check if user has audited entire region or route.
        const tasksNotCompletedByUser = this.getTasks().filter(t => {
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
            const highestPriorityTask = tasksNotCompletedByUser.sort((t1, t2) => {
                    return t2.getStreetPriority() - t1.getStreetPriority();
                })[0];
            const highestPriorityDiscretized = highestPriorityTask.getStreetPriorityDiscretized();

            // Get list of connected streets. If empty, try with a progressively wider radius 5m, 10m, 25m.
            let connectedTasks = this.#findConnectedTasks(finishedTask, 0.005);
            if (connectedTasks.length === 0) {
                connectedTasks = this.#findConnectedTasks(finishedTask, 0.010);
            }
            if (connectedTasks.length === 0) {
                connectedTasks = this.#findConnectedTasks(finishedTask, svl.CONNECTED_TASK_THRESHOLD);
            }

            // If any of the connected tasks has max discretized priority, pick the highest priority connected street,
            // o/w take the highest priority task in the neighborhood.
            connectedTasks = connectedTasks.filter(t => {
                return t.getStreetPriorityDiscretized() === highestPriorityDiscretized;
            }).sort((t1, t2) => {
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
                } else if (this.#findConnectedTasks(newTask, svl.CONNECTED_TASK_THRESHOLD).length === 0) {
                    newTask.reverseStreetDirection();
                }
            }
        }
        newTask.setProperty('taskStart', new Date());
        newTask.render();
        return newTask;
    }

    /**
     * Set the current task.
     * @param {Task} task
     */
    setCurrentTask(task) {
        const svl = this.#svl;
        this.#currentTask = task;
        if ('missionContainer' in svl) {
            const currMissionId = svl.missionContainer.getCurrentMission().getProperty('missionId');
            this.#currentTask.setProperty('currentMissionId', currMissionId);
        }
        this.#tracker.push('TaskStart');

        if ('compass' in svl) {
            svl.compass.showMessage();
            svl.compass.update();
        }

        // Show AI guidance message if applicable.
        if (svl.aiGuidance) svl.aiGuidance.showAiGuidanceMessage();
    }

    /**
     * Get the street id of the current task.
     */
    getCurrentTaskStreetEdgeId() {
        return this.#currentTask ? this.#currentTask.getStreetEdgeId() : null;
    }

    /**
     *
     * @param {object} [unit] Object with field 'units' holding distance unit, default to 'kilometers'
     */
    totalLineDistanceInNeighborhood(unit) {
        if (!unit) unit = { units: 'kilometers' };
        const tasks = this.getTasks();

        if (tasks) {
            const distanceArray = tasks.map(t => t.lineDistance(unit));
            return util.array.sum(distanceArray);
        } else {
            return null;
        }
    }

    /**
     * This method is called from Map.handlerPositionUpdate() to update the color of audited and unaudited street
     * segments of the current task on Google Maps.
     * TODO This should be done somewhere else.
     */
    updateCurrentTask() {
        const currentLatLng = this.#svl.panoViewer.getPosition();
        this.#currentTask.updateTheFurthestPointReached(currentLatLng);
        this.#currentTask.render();
    }

    /**
     * Update the audited distance in the right sidebar using the length of the streets in the current neighborhood.
     * @returns {TaskContainer}
     */
    updateAuditedDistance() {
        let distance = 0;
        const neighborhood = this.#svl.neighborhoodModel.currentNeighborhood();

        if (neighborhood) {
            distance = this.getCompletedTaskDistance({ units: i18next.t('common:unit-distance') });
        }
        this.#svl.overallStats.setNeighborhoodAuditedDistance(distance);
        return this;
    }

    /**
     * Checks if there are any max priority tasks remaining (proxy for neighborhood being complete across all users.
     * @returns {null|boolean}
     */
    hasMaxPriorityTask() {
        return this._tasks.filter(task => task.getStreetPriority() === 1).length > 0;
    }

    /**
     * Renders all tasks to draw both unexplored and already-completed tasks. Should be called at page load
     * so it does not render redundantly.
     */
    renderAllTasks() {
        for (const task of this._tasks) {
            task.render();
        }
    }
}
