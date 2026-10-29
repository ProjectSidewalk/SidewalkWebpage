/**
 * The streets of the region or route being explored, which one is being walked, how they are drawn on the minimap,
 * and, on a neighborhood mission, the planned order they are walked in (#5526). A street changing or ending, or the
 * plan being rebuilt, is announced (onCurrentTaskChanged, onTaskEnded, onTaskLeft, onWalkPlanChanged) rather than
 * acted on here, since the compass, the crumbs, the mission, the Form and the plan's preview are built after this.
 *
 * TODO Split the responsibilities: storing tasks stays here, fetching from the server could go to a TaskModel.
 */

import * as turf from '@turf/turf';
import { util } from '../../common/utilities.js';
import { Task } from './Task.js';
import { WalkPlanner } from '../../common/WalkPlanner.js';
import '../../common/utilitiesMath.js';
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('../navigation/Minimap.js').Minimap} Minimap */
/** @typedef {import('../mission/Mission.js').Mission} Mission */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../region/RegionModel.js').RegionModel} RegionModel */
/** @typedef {import('../sidebar/OverallStats.js').OverallStats} OverallStats */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class TaskContainer {
  // How close (km) a street's end must be to another street's end for the two to count as connected.
  static CONNECTED_TASK_KM = 0.025;

  #config;
  #regionModel;
  #minimap;
  #panoManager;
  #overallStats;
  #tracker;

  #currentTask = null;
  /* Used to keep track of the task we've decided to jump to while the user finishes labeling the current location. */
  #nextTaskAfterJump = null;
  #tasksFinishedLoading = false;

  /**
   * The neighborhood mission's planned walk (#5526): the planner's steps and stats, why it was (re)built, and when.
   * Null on a route, in free exploration and the tutorial, and after a planning failure, which sends nextTask back
   * to the greedy rule.
   * @type {?{steps: import('../../common/WalkPlanner.js').PlanStep[], stats: object, reason: string,
   *   createdAt: number}}
   */
  #walkPlan = null;
  /**
   * Why a replan was asked for while a jump was armed, or null. The armed target was chosen and prefetched from the
   * plan as it stood, so replanning under it could turn or reorder the street the labeler is about to land on; the
   * replan runs once the jump lands instead (see setCurrentTask).
   * @type {?string}
   */
  #deferredReplanReason = null;

  /** @type {Array<(task: Task) => void>} */
  #currentTaskListeners = [];

  /** @type {Array<() => void>} */
  #walkPlanListeners = [];

  /** @type {Array<(task: Task) => void>} */
  #taskEndedListeners = [];

  /** @type {Array<(task: Task) => void>} */
  #taskLeftListeners = [];

  _tasks = [];

  /**
   * @param {Task} initialTask - The street the page opened on, current from the start. Nothing hears about it
   *   through onCurrentTaskChanged; Main sets up the first street itself once the tool is up.
   * @param {ExploreConfig} config
   * @param {RegionModel} regionModel
   * @param {Minimap} minimap - Where the streets are drawn.
   * @param {PanoManager} panoManager - Whose position says how far along a street the labeler is.
   * @param {OverallStats} overallStats - Shown the audited distance as streets finish.
   * @param {Tracker} tracker
   */
  constructor(initialTask, config, regionModel, minimap, panoManager, overallStats, tracker) {
    this.#config = config;
    this.#regionModel = regionModel;
    this.#minimap = minimap;
    this.#panoManager = panoManager;
    this.#overallStats = overallStats;
    this.#tracker = tracker;

    this._tasks.push(initialTask);
    this.#currentTask = initialTask;
    this.#recordTaskStart(initialTask);
  }

  /**
   * Told when another street becomes the one being walked. Not for the street the page opened on.
   * @param {(task: Task) => void} listener
   */
  onCurrentTaskChanged(listener) {
    this.#currentTaskListeners.push(listener);
  }

  /**
   * Told when a street is finished (endTask), once it is marked complete and ready to submit.
   * @param {(task: Task) => void} listener
   */
  onTaskEnded(listener) {
    this.#taskEndedListeners.push(listener);
  }

  /**
   * Told when free exploration wanders off a street onto another (#5733), so what was seen of it can be submitted.
   * @param {(task: Task) => void} listener
   */
  onTaskLeft(listener) {
    this.#taskLeftListeners.push(listener);
  }

  /**
   * Told when the planned walk is built, rebuilt or dropped (#5526), so its minimap preview can follow.
   * @param {() => void} listener
   */
  onWalkPlanChanged(listener) {
    this.#walkPlanListeners.push(listener);
  }

  tasksLoaded() {
    return this.#tasksFinishedLoading;
  }

  /**
   * End the current task.
   */
  endTask(task) {
    // Free exploration never completes a task from the client: the server credits a street from the coverage the task
    // posts (#4451, #5733). Callers are individually gated on the mode too; this is the final backstop.
    if (this.#config.isExploreAddressMode) return task;
    this.#tracker.push('TaskEnd');
    task.complete();

    // The Form submits it so the task is marked as complete in the db. Note that this happens async.
    this.#taskEndedListeners.forEach((listener) => listener(task));

    // Update the audited distance in the right sidebar.
    this.updateAuditedDistance();

    // Updates the segments that the user has already explored.
    this.updateCurrentTask();

    // After task.complete(), so getIncompleteTasksAcrossAllUsersUsingPriority() leaves the just-finished task out.
    this.#updateRegionCompleteAcrossAllUsersStatus();

    return task;
  }

  /**
   * Request the server to populate tasks
   * TODO Move this to somewhere else. TaskModel?
   * @param {Mission} currentMission - The mission underway, whose streets the list is matched against.
   * @returns {Promise<void>} Resolves once the tasks have been fetched and added to the container.
   */
  fetchTasks(currentMission) {
    const currMissionId = currentMission.getProperty('missionId');
    let url;
    if (this.#regionModel.isRoute) url = `/routeTasks?userRouteId=${this.#config.userRouteId}`;
    else url = `/tasks?regionId=${this.#regionModel.currentRegion().getRegionId()}`;

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
            task = new Task(result.features[i], this.#config.streetCoverage, false, resumeAt);
            task.markFromTaskList();
            if ((result.features[i].properties.completed)) task.complete();
            // A route's flag covers this walk only, so it is this walk's give-up (#5008); a region's covers every
            // earlier session (#5017), so it is only skipped.
            if (props.reported_no_imagery && this.#regionModel.isRoute) task.giveUpOnImagery();
            this._tasks.push(task);

            // If the street was part of the curr mission, add it to the list!
            if (task.getProperty('currentMissionId') === currMissionId) {
              currentMission.pushATaskToTheRoute(task);
            }
          }
        }
        this.#tasksFinishedLoading = true;
        // Planned before the first move, so the first end of street already follows the plan and the minimap shows
        // where the walk goes from the moment the page appears (#5526).
        this.planWalk('load');
      })
      .catch((error) => {
        console.error(error);
      });
  }

  /**
   * Whether this session plans its own walk: a neighborhood mission does, a route already has its order, and free
   * exploration and the tutorial walk no sequence of streets at all.
   * @returns {boolean}
   */
  #walksAPlannedRoute() {
    return !this.#regionModel.isRoute && !this.#config.isExploreAddressMode && !this.#config.isOnboarding;
  }

  /**
   * Plans the walk over every street still to be walked, starting from the current street, and stamps the order and
   * each street's direction onto its task (#5526). While a jump is armed the replan is only recorded, and runs once
   * the jump lands. Never throws: a failing planner leaves no plan and nextTask falls back to the greedy rule, because
   * a planning bug must never be what stops someone labeling.
   *
   * @param {string} reason - Why a plan is being built, for the log: 'load', 'giveUp', 'priority', or 'switch'.
   * @returns {boolean} Whether a plan now exists.
   */
  planWalk(reason) {
    if (!this.#tasksFinishedLoading || !this.#walksAPlannedRoute()) return false;
    if (this.#nextTaskAfterJump) {
      this.#deferredReplanReason ??= reason;
      return this.hasWalkPlan();
    }
    this.#deferredReplanReason = null;
    try {
      // A street just given up on is already off the unwalked list, so the plan starts from where the labeler stands.
      const current = this.#currentTask;
      const startsOnCurrent = Boolean(current) && current.isLeftToWalk();
      const toPlan = this.getUnwalkedTasks().filter((t) => t !== current);
      if (startsOnCurrent) toPlan.unshift(current);
      if (toPlan.length === 0) {
        this.#clearWalkPlan();
        return false;
      }

      const streets = toPlan.map((task) => {
        const coords = TaskContainer.#unwalkedCoords(task);
        return {
          id: task.getStreetEdgeId(),
          coords,
          priority: task.getStreetPriority(),
          fixedDirection: task.isResumed(),
        };
      });
      const { priorityTolerance, tinyStreetM } = this.#config.walkPlanner ?? {};
      const plan = new WalkPlanner(streets, { priorityTolerance, tinyStreetM }).plan(startsOnCurrent
        ? { streetId: current.getStreetEdgeId() }
        : { from: this.#currentPositionLngLat() });
      this.#applyWalkPlan(plan, toPlan, reason);

      // A summary rather than the steps: the tracker buffer holds 200 actions, and a full region's plan would crowd
      // out the interactions it is flushed with. The plan itself can be rebuilt from the same inputs.
      const { stats } = plan;
      this.#tracker.push('WalkPlan_Created', {
        reason,
        tolerance: priorityTolerance,
        streets: stats.streets,
        jumps: stats.jumps,
        plannedM: Math.round(stats.totalM),
        lowerBoundJumps: stats.lowerBoundJumps,
        ms: Math.round(stats.ms),
      });
      return true;
    } catch (error) {
      console.error(error);
      this.#clearWalkPlan();
      // The tracker writes notes as `key:value,` pairs, so a free-text message has its separators stripped.
      this.#tracker.push('WalkPlan_Failed', {
        reason,
        error: error?.name ?? 'Error',
        message: String(error?.message ?? error).replace(/[,:]/g, ''),
      });
      return false;
    } finally {
      this.#walkPlanListeners.forEach((listener) => listener());
    }
  }

  /**
   * The part of a street still to walk, as [lng, lat] coordinates in walking order. A part-walked street (#5370) is
   * entered where the labeler left it, its furthest point reached, not at its start: planning it whole would call a
   * step "connected" that Explore turns into a mid-street jump.
   *
   * @param {Task} task - A street to be planned.
   * @returns {number[][]} The whole street, or for a resumed one its unwalked remainder (whole if that has collapsed).
   */
  static #unwalkedCoords(task) {
    const coords = task.getGeoJSON().geometry.coordinates;
    if (!task.isResumed()) return coords;
    const remainder = task.unwalkedRemainder().geometry.coordinates;
    return remainder.length >= 2 ? remainder : coords;
  }

  /**
   * Where the labeler stands, as the planner's [lng, lat], for a plan that cannot start on the current street.
   * @returns {number[]}
   */
  #currentPositionLngLat() {
    const position = this.#panoManager.getPosition() ?? this.#currentTask.getEndCoordinate();
    return [position.lng, position.lat];
  }

  /**
   * Stamps a plan onto its tasks: each step's position, and each street's walking direction.
   *
   * Direction goes through setStreetEdgeDirection, which only ever turns a street to start at the given end, so
   * applying the same plan twice changes nothing. The current street keeps its orientation (the labeler is already
   * walking it), a part-walked street keeps its own, since its audit_task row fixes it (#5370), and so does an armed
   * jump's target, which was chosen and prefetched as it stands.
   *
   * @param {{steps: import('../../common/WalkPlanner.js').PlanStep[], stats: object}} plan
   * @param {Task[]} plannedTasks - The tasks the plan was built over.
   * @param {string} reason - Why the plan was built.
   */
  #applyWalkPlan(plan, plannedTasks, reason) {
    for (const task of this._tasks) task.setPlannedPosition(null);
    // Street ids are unique on a region audit, which is the only place a walk is planned.
    const byStreetId = new Map(plannedTasks.map((task) => [task.getStreetEdgeId(), task]));
    plan.steps.forEach((step, position) => {
      const task = byStreetId.get(step.id);
      if (!task) return;
      task.setPlannedPosition(position);
      if (task !== this.#currentTask && task !== this.#nextTaskAfterJump && !task.isResumed()) {
        const coords = task.getGeoJSON().geometry.coordinates;
        const [lng, lat] = step.reverse ? coords[coords.length - 1] : coords[0];
        task.setStreetEdgeDirection({ lat, lng });
      }
    });
    this.#walkPlan = { steps: plan.steps, stats: plan.stats, reason, createdAt: Date.now() };
  }

  /** Drops the plan: nextTask goes back to the greedy rule and the minimap stops previewing. */
  #clearWalkPlan() {
    this.#walkPlan = null;
    for (const task of this._tasks) task.setPlannedPosition(null);
  }

  /** @returns {boolean} Whether a planned walk is being followed. */
  hasWalkPlan() {
    return this.#walkPlan !== null;
  }

  /**
   * @returns {?{steps: import('../../common/WalkPlanner.js').PlanStep[], stats: object, reason: string,
   *   createdAt: number}} The planned walk, or null.
   */
  getWalkPlan() {
    return this.#walkPlan;
  }

  /**
   * The streets still to walk after the current one, in plan order, each with its plan step. Steps already walked or
   * given up on are skipped rather than ending the list, as nextTask skips them.
   *
   * @param {number} [limit=Infinity] - At most this many entries.
   * @returns {{task: Task, step: import('../../common/WalkPlanner.js').PlanStep}[]} [] with no plan.
   */
  getPlannedStepsAhead(limit = Infinity) {
    if (!this.#walkPlan) return [];
    const current = this.#currentTask;
    const currentPosition = current?.getPlannedPosition() ?? -1;
    const ahead = this.getUnwalkedTasks()
      .filter((task) => task !== current && task.getPlannedPosition() !== null
        && task.getPlannedPosition() > currentPosition)
      .sort((t1, t2) => t1.getPlannedPosition() - t2.getPlannedPosition());
    return ahead.slice(0, limit).map((task) => ({ task, step: this.#walkPlan.steps[task.getPlannedPosition()] }));
  }

  /**
   * Updates the task priorities for the given set of streets. These should be updated from other users' audits.
   * @param {Array<{street_edge_id: number, priority: number}>} updatedPriorities - Any streets with a new priority
   */
  updateTaskPriorities(updatedPriorities) {
    // Another labeler finishing streets here changes what is most worth walking, but with several labelers in one
    // region nearly every submission brings a change, and a replan each time would reshuffle the preview under the
    // labeler. So the plan is rebuilt only when the change can matter to it: a street the minimap is previewing, or
    // which streets are in the planner's top tier (#5526).
    const tierBefore = this.hasWalkPlan() ? this.#topTierTasks() : null;
    let previewedChanged = false;
    // The server reports every street of the region whose priority changed, which need not be one that is loaded
    // here (a hidden street, say), so an unknown id is skipped rather than assumed present.
    updatedPriorities.forEach((newPriority) => {
      const task = this._tasks.find((s) => s.getStreetEdgeId() === newPriority.street_edge_id);
      if (!task) return;
      if (tierBefore && task.isPlannedAhead() && task.getStreetPriority() !== newPriority.priority) {
        previewedChanged = true;
      }
      task.setProperty('priority', newPriority.priority);
    });
    if (!tierBefore) return;
    const tierAfter = this.#topTierTasks();
    const tierChanged = tierAfter.size !== tierBefore.size || [...tierAfter].some((task) => !tierBefore.has(task));
    if (previewedChanged || tierChanged) this.planWalk('priority');
  }

  /**
   * The unwalked streets the planner treats as the top tier: priority within the tolerance of the best one left. A
   * street entering or leaving it changes which streets the walk may take before a jump, so a replan has to see that.
   *
   * @returns {Set<Task>} Empty when nothing is left to walk.
   */
  #topTierTasks() {
    const unwalked = this.getUnwalkedTasks();
    if (unwalked.length === 0) return new Set();
    const best = Math.max(...unwalked.map((task) => task.getStreetPriority()));
    const cutoff = best - (this.#config.walkPlanner?.priorityTolerance ?? 0);
    return new Set(unwalked.filter((task) => WalkPlanner.inTier(task.getStreetPriority(), cutoff)));
  }

  /**
   * How far the labeler has to go from the end of one street to where they enter the next. Under CONNECTED_TASK_KM
   * the streets are switched seamlessly; from further away it is a jump, which StreetProgress prompts for and the
   * minimap draws a connector for, so both read the same gap.
   *
   * @param {Task} task - The street being finished.
   * @param {Task} nextTask - The street that follows it.
   * @returns {number} Kilometers.
   */
  static jumpGapKm(task, nextTask) {
    const from = task.getEndCoordinate();
    const to = nextTask.getEntryCoordinate();
    return turf.distance(turf.point([from.lng, from.lat]), turf.point([to.lng, to.lat]), { units: 'kilometers' });
  }

  /**
   * Find incomplete tasks (i.e., street edges) that are connected to the given task.
   *
   * @param {Task} taskIn - Task to check whether any available tasks are connected
   * @param {number} threshold - Distance threshold in km, unless specified in unit parameter
   * @param {{units: import('@turf/turf').Units}} [unit] - The distance unit; defaults to the user's
   * @returns {Task[]} Array of tasks that are connected to the given task
   */
  #findConnectedTasks(taskIn, threshold, unit) {
    if (!unit) unit = { units: 'kilometers' };
    let tasks = this.getTasks();

    const connectedTasks = [];
    if (taskIn && tasks) {
      tasks = tasks.filter((t) => t.isLeftToWalk() && t.getStreetEdgeId() !== taskIn.getStreetEdgeId());

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
   * @param {{units: import('@turf/turf').Units}} [units] - The distance unit; defaults to the user's
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
      const currentLatLng = this.#panoManager.getPosition();
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
   * Distinct from getIncompleteTasks, which is server-side completion and so still counts give-ups and reports.
   * @returns {Task[]}
   */
  getUnwalkedTasks() {
    return this._tasks.filter((task) => task.isLeftToWalk());
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
   * Store the task to jump to once the current intersection is complete. While one is set, a planned walk holds its
   * replans until the labeler lands there (planWalk, setCurrentTask).
   * @param {?Task} task
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
        document.getElementById('area-completion-overlay-wrapper').style.display = 'block';
        const currentRegionId = regionModel.currentRegion().getRegionId();
        this.#tracker.push('NeighborhoodComplete_AcrossAllUsers', { RegionId: currentRegionId });
      }
    }
  }

  /**
   * Get the next task.
   *
   * TODO It's not immediately obvious how much this function handles. Some things should likely be separated.
   *
   * On a route, the next street is the next in its saved order; on a neighborhood mission with a planned walk
   * (#5526), the next in the plan. Without a plan (the planner failed):
   * Get the list of the highest priority streets that this user has not audited
   * - If the street you just audited connects to any of those, pick the highest priority one
   * - O/w jump to the highest priority street
   *
   * @param {Task} finishedTask - The task that has been finished
   * @returns {Task} Next task
   */
  nextTask(finishedTask) {
    let newTask;

    // On a route, a street can legitimately appear twice (out-and-back), so the just-finished task is excluded by
    // its route_street row rather than by its street: excluding by street would silently drop the return leg.
    const sameAsFinished = (t) => {
      if (!finishedTask) return false;
      const finishedWalkOrder = finishedTask.getWalkOrder();
      return this.#regionModel.isRoute && finishedWalkOrder !== null && finishedWalkOrder !== undefined
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

    if (this.#regionModel.isRoute) {
      // For a route, the user walks the streets in the route's saved order.
      newTask = tasksNotCompletedByUser.reduce((min, current) => {
        return current.getWalkOrder() < min.getWalkOrder() ? current : min;
      }, tasksNotCompletedByUser[0]);
    } else if (this.hasWalkPlan()) {
      // The earliest unwalked step of the plan; a street the plan left out sorts last (null would compare as 0). No
      // direction correction, unlike the greedy rule below: the plan chose each street's direction, including a jump
      // target entered at its far end, and turning one toward the finished street would land the labeler where the
      // minimap connector does not point.
      const position = (t) => t.getPlannedPosition() ?? Infinity;
      newTask = tasksNotCompletedByUser.reduce((min, current) => {
        return position(current) < position(min) ? current : min;
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
        connectedTasks = this.#findConnectedTasks(finishedTask, TaskContainer.CONNECTED_TASK_KM);
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

      // A street connected to or near the finished one starts from its endpoint, so the user isn't accidentally
      // marked as being at the end of the street. One the user will need to jump to is reversed when its default
      // endpoint connects to nothing, to encourage contiguous routes.
      // TODO take into account street priority when checking for connected tasks here.
      // A part-walked street is exempt: its direction is fixed by its audit_task row (the server never rewrites
      // start_point_reversed) and its walked metres are measured from that end, so flipping it here would put the
      // walked segment on the wrong half of the street (#5370).
      if (newTask && finishedTask && !newTask.isResumed()) {
        let startPoint;
        const line = newTask.getGeoJSON();
        const endPoint = turf.point([finishedTask.getEndCoordinate().lng, finishedTask.getEndCoordinate().lat]);
        const taskNearby = turf.pointToLineDistance(endPoint, line) < Task.CLOSE_TO_ROUTE_KM * 1.5;
        if (connectedTask || taskNearby) {
          startPoint = finishedTask.getEndCoordinate();
          newTask.setStreetEdgeDirection(startPoint);
        } else if (this.#findConnectedTasks(newTask, TaskContainer.CONNECTED_TASK_KM).length === 0) {
          newTask.reverseStreetDirection();
        }
      }
    }
    // A resumed task keeps its original task_start so the client's copy still matches its row. Nothing server-side
    // depends on it — the column is written on insert only, and a resumed task always takes the update path — so this
    // is about not holding a value that contradicts the database, not about protecting a submission.
    if (!newTask.isResumed()) newTask.setProperty('taskStart', new Date());
    this.renderTask(newTask);
    return newTask;
  }

  /**
   * Set the current task.
   * @param {Task} task
   */
  setCurrentTask(task) {
    this.#currentTask = task;
    // Landing on the armed target is what ends a jump, so from here a replan may run again.
    if (task === this.#nextTaskAfterJump) this.#nextTaskAfterJump = null;
    this.#recordTaskStart(task);
    // Taking a street other than the plan's next one (picking an abandoned street back up, #5370) leaves the plan
    // describing a walk from somewhere the labeler isn't, so it is rebuilt from here. Otherwise a replan held back
    // while a jump was armed runs now, from the street the jump landed on. After the task start, so the plan is
    // logged under this street; before the listeners, so the preview they redraw is of the plan as it now stands.
    if (this.hasWalkPlan() && task.isLeftToWalk()) {
      const position = task.getPlannedPosition();
      const earliest = Math.min(...this.getUnwalkedTasks().map((t) => t.getPlannedPosition() ?? Infinity));
      if (position === null || position > earliest) this.planWalk('switch');
      else if (this.#deferredReplanReason !== null) this.planWalk(this.#deferredReplanReason);
    }
    this.#currentTaskListeners.forEach((listener) => listener(task));
  }

  /**
   * Logs that a street became the one being walked, and files what is logged next under its audit task.
   * @param {Task} task
   */
  #recordTaskStart(task) {
    // Interactions are stamped with the tracker's audit task id, which otherwise only moves on a submission result —
    // so without this, what is logged between the switch and the first submission is filed under the old street. A
    // fresh street has no id yet, so it still has to wait for its first submission.
    if (task.getAuditTaskId()) this.#tracker.setAuditTaskID(task.getAuditTaskId());
    // `source` is the part worth counting: `switch` is a street picked back up mid-session, which is what #5370
    // added. `pageLoad` covers the street already in progress and a drop-in session, both of which carry an open row
    // too and neither of which is news.
    // `reaudit` rides along whichever shape the note takes, so re-audit tasks can be counted from the log (#4895).
    const startNote = task.isResumed()
      ? { resumed: true, auditTaskId: task.getAuditTaskId(), source: task.cameFromTaskList() ? 'switch' : 'pageLoad' }
      : {};
    if (task.getProperty('needsReaudit')) startNote.reaudit = true;
    this.#tracker.push('TaskStart', Object.keys(startNote).length ? startNote : undefined);
  }

  /**
   * Free exploration's walking (#5733): credits the pano to the street the labeler is on, switching tasks when they
   * wander onto another. The street left is posted as it stands; a street walked earlier keeps its coverage.
   *
   * @param {{lat: number, lng: number}} latLng - Where the labeler now stands.
   */
  recordExploreMove(latLng) {
    const current = this.#currentTask;
    const nearest = this.tasksLoaded() ? this.#nearestTask(latLng) : null;
    if (nearest && current && nearest !== current) {
      this.#tracker.push('ExploreAddress_StreetSwitch', {
        from: current.getStreetEdgeId(),
        to: nearest.getStreetEdgeId(),
        resumed: nearest.getCoveredRanges().length > 0,
      });
      this.#taskLeftListeners.forEach((listener) => listener(current));
      current.resetVisitChain();
      // The task starts when the labeler steps onto the street, not when the task list or an old audit of it did.
      if (nearest.getCoveredRanges().length === 0) nearest.setProperty('taskStart', new Date());
      this.setCurrentTask(nearest);
    }
    if (this.#currentTask) {
      this.#currentTask.recordVisit(latLng);
      this.renderTask(this.#currentTask);
    }
  }

  /**
   * The loaded street a position is on: the nearest within Task.ON_STREET_MAX_DISTANCE_M. The current street only
   * loses to a strictly nearer one, so a corner pano equally close to two streets stays on the one being walked.
   *
   * @param {{lat: number, lng: number}} latLng
   * @returns {?Task}
   */
  #nearestTask(latLng) {
    const point = turf.point([latLng.lng, latLng.lat]);
    let nearest = null;
    let nearestM = Task.ON_STREET_MAX_DISTANCE_M;
    const candidates = this.#currentTask ? [this.#currentTask, ...this._tasks] : this._tasks;
    for (const task of candidates) {
      const distM = turf.pointToLineDistance(point, task.getGeoJSON(), { units: 'meters' });
      if (distM < nearestM) {
        nearest = task;
        nearestM = distM;
      }
    }
    return nearest;
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
   * Called on each position update to redraw the current task's explored and remaining parts on the minimap.
   * TODO This should be done somewhere else.
   */
  updateCurrentTask() {
    const currentLatLng = this.#panoManager.getPosition();
    this.#currentTask.updateTheFurthestPointReached(currentLatLng);
    this.renderTask(this.#currentTask);
  }

  /**
   * Update the audited distance in the right sidebar using the length of the streets in the current region.
   * @returns {TaskContainer}
   */
  updateAuditedDistance() {
    let distance = 0;
    const region = this.#regionModel.currentRegion();

    if (region) {
      distance = this.getCompletedTaskDistance({ units: util.turfDistanceUnits() });
    }
    this.#overallStats.setRegionAuditedDistance(distance);
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
   * Draws a street on the minimap in the encoding that fits its state, replacing what it drew before.
   * @param {Task} task
   */
  renderTask(task) {
    this.#minimap.setStreetLines(task.minimapKey(), task.minimapLines({
      exploreAddressMode: this.#config.isExploreAddressMode,
      current: task === this.#currentTask,
      route: this.#regionModel.isRoute,
    }));
  }

  /**
   * Renders all tasks to draw both unexplored and already-completed tasks. Should be called at page load
   * so it does not render redundantly.
   */
  renderAllTasks() {
    for (const task of this._tasks) {
      this.renderTask(task);
    }
  }
}
