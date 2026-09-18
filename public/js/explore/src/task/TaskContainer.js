/**
 * TaskContainer module.
 *
 * TODO This module needs to be cleaned up.
 * TODO Split the responsibilities. Storing tasks should remain here, but other things like fetching data from the
 * server (should go to TaskModel) and rendering segments on a map.
 */
class TaskContainer {
  #regionModel;
  #svl;
  #tracker;

  #currentTask = null;
  /* Used to keep track of the task we've decided to jump to while the user finishes labeling the current location. */
  #nextTaskAfterJump = null;
  #tasksFinishedLoading = false;

  _tasks = [];

  /**
   * @param {RegionModel} regionModel
   * @param {Record<string, any>} svl
   * @param {Tracker} tracker
   */
  constructor(regionModel, svl, tracker) {
    this.#regionModel = regionModel;
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
    // Free-exploration tasks never complete — completing one would mark the street audited and move coverage (#4451).
    // Callers are individually gated on the mode too; this is the final backstop.
    if (svl.isExploreAddressMode()) return task;
    if (this.#tracker) this.#tracker.push('TaskEnd');
    task.complete();

    // Submit the data so that the task is marked as complete in the db. Note that this happens async.
    svl.form.submitData(task);

    // Update the audited distance in the right sidebar.
    this.updateAuditedDistance();

    if (svl.user.getProperty('role') === 'Anonymous'
      && this.getCompletedTaskDistance({ units: 'kilometers' }) > 0.15
      && !svl.popUpMessage.haveAskedToSignIn()) {
      svl.popUpMessage.promptSignIn();
    }

    // Updates the segments that the user has already explored.
    this.updateCurrentTask();

    // Check if finishing this task completes the region across all users. Must run after task.complete() so
    // the just-finished task is filtered out of getIncompleteTasksAcrossAllUsersUsingPriority() naturally.
    this.#updateRegionCompleteAcrossAllUsersStatus();

    return task;
  }

  /**
   * Request the server to populate tasks
   * TODO Move this to somewhere else. TaskModel?
   * @returns {Promise<void>} Resolves once the tasks have been fetched and added to the container.
   */
  fetchTasks() {
    const svl = this.#svl;
    const currMission = svl.missionContainer.getCurrentMission();
    const currMissionId = currMission.getProperty('missionId');
    let url;
    if (svl.regionModel.isRoute) url = `/routeTasks?userRouteId=${svl.userRouteId}`;
    else url = `/tasks?regionId=${svl.regionModel.currentRegion().getRegionId()}`;

    return fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
      .then((response) => response.json())
      .then((result) => {
        let task;
        const currStreetId = this.getCurrentTaskStreetEdgeId();
        for (let i = 0; i < result.features.length; i++) {
          // Skip the task that we were given to start with so that we don't add a duplicate.
          if (result.features[i].properties.street_edge_id !== currStreetId) {
            // current_lat/lng comes back for every street, but on a fresh one it is just the street's start point;
            // only an open audit_task's position means "where the labeler stopped" and should seed the walked
            // stretch (#5370).
            const props = result.features[i].properties;
            const resumeAt = props.audit_task_id && !props.completed
              ? { lat: props.current_lat, lng: props.current_lng }
              : undefined;
            task = new Task(result.features[i], false, resumeAt);
            task.markFromTaskList();
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
      .catch((error) => {
        console.error(error);
      });
  }

  /**
   * Updates the task priorities for the given set of streets. These should be updated from other users' audits.
   * @param {Array<{street_edge_id: number, priority: number}>} updatedPriorities - Any streets with a new priority
   */
  updateTaskPriorities(updatedPriorities) {
    // The server reports every street of the region whose priority changed, which need not be one that is loaded
    // here (a hidden street, say), so an unknown id is skipped rather than assumed present.
    updatedPriorities.forEach((newPriority) => {
      const task = this._tasks.find((s) => s.getStreetEdgeId() === newPriority.street_edge_id);
      task?.setProperty('priority', newPriority.priority);
    });
  }

  /**
   * Find incomplete tasks (i.e., street edges) that are connected to the given task.
   *
   * @param {Task} taskIn - Task to check whether any available tasks are connected
   * @param {number} threshold - Distance threshold in km, unless specified in unit parameter
   * @param {{units: string}} [unit] - Holds the distance unit; defaults to the user's units
   * @returns {Task[]} Array of tasks that are connected to the given task
   */
  #findConnectedTasks(taskIn, threshold, unit) {
    if (!unit) unit = { units: 'kilometers' };
    let tasks = this.getTasks();

    const connectedTasks = [];
    if (taskIn && tasks) {
      tasks = tasks.filter((t) => !t.isComplete() && t.getStreetEdgeId() !== taskIn.getStreetEdgeId());

      for (let i = 0, len = tasks.length; i < len; i++) {
        if (taskIn.isConnectedTo(tasks[i], threshold, unit)) {
          connectedTasks.push(tasks[i]);
        }
      }
    }

    return connectedTasks;
  }

  /**
   * Get the total distance of the segments the labeler is done with — walked, or given up on for lack of imagery —
   * plus their progress along the street they are on now.
   * @param {{units: string}} [units] - Object with field 'units' holding distance unit; defaults to the user's units
   * @returns {number} Distance in unit.
   */
  getCompletedTaskDistance(units) {
    if (!units) units = { units: util.turfDistanceUnits() };
    const walkedTasks = this.getWalkedTasks();
    let feature;
    let distance = 0;

    if (walkedTasks) {
      for (let i = 0, len = walkedTasks.length; i < len; i++) {
        feature = walkedTasks[i].getGeoJSON();
        distance += turf.length(feature, units);
      }
    }
    if (!this.#currentTask.isComplete() && !this.#currentTask.wasGivenUpOnImagery()) {
      distance += this.getCurrentTaskDistance(units);
    }

    return distance;
  }

  /**
   * Get the total distance of segments completed by any user.
   *
   * @returns {number} Distance in unit.
   */
  getAllUsersCompletedTaskDistance() {
    const unit = { units: util.turfDistanceUnits() };
    const tasks = this.getTasks().filter((t) => t.getStreetPriority() < 1);
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
   * @param {object} [unit] - Object with field 'units' holding distance unit; defaults to the user's units
   * @returns {number}
   */
  getCurrentTaskDistance(unit) {
    if (!unit) unit = { units: 'kilometers' };

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
    return this._tasks.filter((task) => task.isComplete());
  }

  /**
   * Tasks the labeler is shown as done with: completed streets, plus the ones this session gave up on for lack of
   * imagery. The give-ups are not completions — nothing about them reaches audit_task.completed (#4922) — but they
   * are as finished as the tool will ever let the labeler make them, so the distances and maps they see count them.
   * @returns {Task[]}
   */
  getWalkedTasks() {
    return this._tasks.filter((task) => task.isComplete() || task.wasGivenUpOnImagery());
  }

  /**
   * The complement of getWalkedTasks: streets the labeler still has something to do on. Distinct from
   * getIncompleteTasks, which is server-side completion and so still counts a give-up as outstanding.
   * @returns {Task[]}
   */
  getUnwalkedTasks() {
    return this._tasks.filter((task) => !task.isComplete() && !task.wasGivenUpOnImagery());
  }

  /**
   * Return list of tasks completed by any user.
   * @returns {Task[]}
   */
  getCompletedTasksAllUsersUsingPriority() {
    return this._tasks.filter((task) => task.getStreetPriority() < 1);
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
    return this._tasks.filter((task) => !task.isComplete());
  }

  /**
   * Find incomplete tasks across all users.
   */
  getIncompleteTasksAcrossAllUsersUsingPriority() {
    const incompleteTasksByUser = this._tasks.filter((task) => !task.isComplete());

    let incompleteTasksAcrossAllUsers = [];
    if (incompleteTasksByUser.length > 0) {
      incompleteTasksAcrossAllUsers = incompleteTasksByUser.filter((t) => t.getStreetPriority() === 1);
    }

    return incompleteTasksAcrossAllUsers;
  }

  getTasks() {
    return this._tasks;
  }

  /**
   * The route's start and finish coordinates in walking order: the first street's start and the last street's end.
   * Coordinates are already oriented to the walking direction on each task, so start/end are the true
   * origin/destination.
   * @returns {?{start: {lat: number, lng: number}, finish: {lat: number, lng: number}}} null if no tasks loaded.
   */
  getRouteEndpoints() {
    const tasks = this.getTasks();
    if (tasks.length === 0) return null;
    const ordered = [...tasks].sort((t1, t2) => t1.getWalkOrder() - t2.getWalkOrder());
    return { start: ordered[0].getStartCoordinate(), finish: ordered[ordered.length - 1].getEndCoordinate() };
  }

  /**
   * The route's full path as a flat list of [lng, lat] coordinates in walking order: every street's LineString
   * concatenated by walk order (matching getRouteEndpoints/nextTask), each oriented to the walking direction. Adjacent
   * streets share a junction point, keeping the path continuous — suitable for direction arrows and the explorer walk.
   * @returns {number[][]} [] if no tasks are loaded.
   */
  getRoutePathCoordinates() {
    const ordered = [...this.getTasks()].sort((t1, t2) => t1.getWalkOrder() - t2.getWalkOrder());
    return ordered.flatMap((task) => task.getGeoJSON().geometry.coordinates);
  }

  /**
   * Checks if the region is complete across all users; if so, displays the relevant overlay.
   */
  #updateRegionCompleteAcrossAllUsersStatus() {
    const regionModel = this.#regionModel;
    // Only run this code if the region was set as incomplete and user is not on a designated route.
    if (!regionModel.isRoute && !regionModel.getRegionCompleteAcrossAllUsers()) {
      // Indicates region is complete.
      if (this.getIncompleteTasksAcrossAllUsersUsingPriority().length === 0) {
        regionModel.setRegionCompleteAcrossAllUsers();
        $('#area-completion-overlay-wrapper').show();
        const currentRegion = this.#svl.regionModel.currentRegion();
        const currentRegionId = currentRegion.getRegionId();
        this.#tracker.push('NeighborhoodComplete_AcrossAllUsers', { RegionId: currentRegionId });
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
   * @param {Task} finishedTask - The task that has been finished
   * @returns {Task} Next task
   */
  nextTask(finishedTask) {
    const svl = this.#svl;
    let newTask;

    // Check if user has audited entire region or route. On a route, a street can legitimately appear twice
    // (out-and-back), so the just-finished task is excluded by its route_street row rather than by its street —
    // excluding by street would silently drop the return leg.
    const sameAsFinished = (t) => {
      if (!finishedTask) return false;
      const finishedWalkOrder = finishedTask.getWalkOrder();
      return svl.regionModel.isRoute && finishedWalkOrder !== null && finishedWalkOrder !== undefined
        ? t.getWalkOrder() === finishedWalkOrder
        : t.getStreetEdgeId() === finishedTask.getStreetEdgeId();
    };
    // A street this session gave up on for lack of imagery stays incomplete on purpose (#4922), so "not complete"
    // alone would keep handing it back — on a route, that means the last street's finish teleports the labeler onto
    // a dead one. Give-ups are this session's memory of what it already tried (#5008).
    const tasksNotCompletedByUser = this.getUnwalkedTasks().filter((t) => !sameAsFinished(t));
    if (tasksNotCompletedByUser.length === 0) {
      return null;
    }

    if (svl.regionModel.isRoute) {
      // For a route, the user walks the streets in the route's saved order.
      newTask = tasksNotCompletedByUser.reduce((min, current) => {
        return current.getWalkOrder() < min.getWalkOrder() ? current : min;
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
      // o/w take the highest priority task in the region.
      connectedTasks = connectedTasks.filter((t) => {
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
      // A part-walked street is exempt: its direction is fixed by its audit_task row (the server never rewrites
      // start_point_reversed) and its walked metres are measured from that end, so flipping it here would put the
      // walked segment on the wrong half of the street (#5370).
      if (newTask && finishedTask && !newTask.isResumed()) {
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
    // A resumed task keeps its original task_start so the client's copy still matches its row. Nothing server-side
    // depends on it — the column is written on insert only, and a resumed task always takes the update path — so this
    // is about not holding a value that contradicts the database, not about protecting a submission.
    if (!newTask.isResumed()) newTask.setProperty('taskStart', new Date());
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

      // Metres walked on this street in an earlier session are already in the server's mission progress, which the
      // page load folded into the offset. The mission bar counts the current street's audited distance, so switching
      // onto a part-walked street mid-session would add them a second time and jump the bar (#5370).
      if (task.isResumed() && svl.missionContainer.getTasksMissionsOffset() !== null) {
        const prewalkedM = util.math.kmsToMeters(task.claimSavedProgress());
        svl.missionContainer.setTasksMissionsOffset(svl.missionContainer.getTasksMissionsOffset() - prewalkedM);
      }
    }
    // Interactions are stamped with the tracker's audit task id, which otherwise only moves on a submission result —
    // so without this, what is logged between the switch and the first submission is filed under the old street. A
    // fresh street has no id yet, so it still has to wait for its first submission.
    if (task.getAuditTaskId()) this.#tracker.setAuditTaskID(task.getAuditTaskId());
    // `source` is the part worth counting: `switch` is a street picked back up mid-session, which is what #5370
    // added. `pageLoad` covers the street already in progress and a drop-in session, both of which carry an open row
    // too and neither of which is news.
    this.#tracker.push('TaskStart', task.isResumed()
      ? { resumed: true, auditTaskId: task.getAuditTaskId(), source: task.cameFromTaskList() ? 'switch' : 'pageLoad' }
      : undefined);

    if ('compass' in svl) {
      svl.compass.showMessage();
      svl.compass.update();
    }
    // Every street switch and direction reversal passes through here, so this is where the crumbs ahead re-aim.
    if (svl.forwardCrumbs) svl.forwardCrumbs.refresh();

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
   * @param {object} [unit] - Object with field 'units' holding distance unit; defaults to the user's units
   */
  getTotalTaskDistance(unit) {
    if (!unit) unit = { units: 'kilometers' };
    const tasks = this.getTasks();

    if (tasks) {
      const distanceArray = tasks.map((t) => t.lineDistance(unit));
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
   * Update the audited distance in the right sidebar using the length of the streets in the current region.
   * @returns {TaskContainer}
   */
  updateAuditedDistance() {
    let distance = 0;
    const region = this.#svl.regionModel.currentRegion();

    if (region) {
      distance = this.getCompletedTaskDistance({ units: util.turfDistanceUnits() });
    }
    this.#svl.overallStats.setRegionAuditedDistance(distance);
    return this;
  }

  /**
   * Checks if there are any max priority tasks remaining (proxy for region being complete across all users.
   * @returns {null|boolean}
   */
  hasMaxPriorityTask() {
    return this._tasks.filter((task) => task.getStreetPriority() === 1).length > 0;
  }

  /**
   * Renders all tasks to draw both unexplored and already-completed tasks. Should be called at page load
   * so it does not render redundantly.
   */
  renderAllTasks() {
    for (const task of this._tasks) {
      task.render();
    }
    // Keep the route overview inset's explored/ahead colors in sync as streets complete (routes only; no-op otherwise).
    if (svl.routeOverview) svl.routeOverview.render();
  }
}
