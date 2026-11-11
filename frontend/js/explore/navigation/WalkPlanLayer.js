/**
 * Previews the next few streets of a neighborhood mission's planned walk on the minimap (#5526).
 *
 * A route shows every street ahead, but a planned walk covers the whole region, and drawing all of it that way would
 * bury the path the labeler is about to take. So only the streets within a horizon are drawn as the route ahead (a
 * task marked planned-ahead draws itself that way), and only up to the first jump: the labeler can't walk to a
 * stretch on the far side of one (#5918). Everything beyond stays quiet grey context.
 */

import { TaskContainer } from '../task/TaskContainer.js';
/** @typedef {import('../mission/MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../task/Task.js').Task} Task */

export class WalkPlanLayer {
  // The preview reaches at least this far, so the last stretch of a mission still shows where the walk goes next.
  static #MIN_HORIZON_M = 250;
  // Fewer than two streets reads as the current street's continuation rather than as a path.
  static #MIN_STREETS = 2;
  // Past this many streets the preview stops being "the next few". The minimap's default zoom spans only about
  // 100 m at Seattle's latitude, less than a block, so most of the preview is seen through the ⛶ overview, which
  // frames the previewed streets (Minimap.setOverviewStreets).
  static #MAX_STREETS = 8;

  #taskContainer;
  #missionContainer;
  /** @type {Task[]} */
  #previewed = [];

  /**
   * Redraws on every change the preview depends on: the plan itself, the street being walked (the preview is measured
   * from it), a street ending (it drops out, so the horizon reaches one further), and a new mission (its remaining
   * distance sets the horizon).
   *
   * @param {TaskContainer} taskContainer - Source of the plan and of the current street.
   * @param {MissionContainer} missionContainer - Whose current mission's remaining distance sets the horizon.
   */
  constructor(taskContainer, missionContainer) {
    this.#taskContainer = taskContainer;
    this.#missionContainer = missionContainer;

    taskContainer.onWalkPlanChanged(() => this.refresh());
    taskContainer.onCurrentTaskChanged(() => this.refresh());
    taskContainer.onTaskEnded(() => this.refresh());
    missionContainer.on('MissionContainer:missionLoaded', () => this.refresh());
  }

  /**
   * How many of the planned streets ahead to preview: enough to cover the rest of the mission (and at least
   * #MIN_HORIZON_M), never fewer than #MIN_STREETS nor more than #MAX_STREETS.
   *
   * @param {number[]} lengthsM - Lengths of the planned streets ahead, in walk order.
   * @param {number} remainingMissionM - Metres left in the mission once the current street is finished; 0 when
   *     unknown.
   * @returns {number} The number of streets from the front of `lengthsM` to preview.
   */
  static horizonCount(lengthsM, remainingMissionM) {
    const targetM = Math.max(remainingMissionM, WalkPlanLayer.#MIN_HORIZON_M);
    let count = 0;
    let coveredM = 0;
    while (count < lengthsM.length && count < WalkPlanLayer.#MAX_STREETS
      && (coveredM < targetM || count < WalkPlanLayer.#MIN_STREETS)) {
      coveredM += lengthsM[count];
      count++;
    }
    return count;
  }

  /**
   * Recomputes which streets are previewed and redraws them. The preview is decoration, so a drawing error is only
   * logged: let into the street switch or submission that triggered it, it would reload the page.
   */
  refresh() {
    try {
      this.#redraw();
    } catch (error) {
      console.error(error);
    }
  }

  /** @returns {Task[]} The streets drawn as the path ahead, in walk order; the ⛶ overview frames them. */
  getPreviewedTasks() {
    return [...this.#previewed];
  }

  /** Marks the streets within the horizon, up to the first jump, as previewed, and re-renders what changed. */
  #redraw() {
    const ahead = this.#taskContainer.getPlannedStepsAhead(WalkPlanLayer.#MAX_STREETS);
    const lengthsM = ahead.map(({ task }) => WalkPlanLayer.#remainderM(task));
    // The current street's unwalked part is walked before any of these, so it comes out of what they must cover.
    const afterCurrentM = Math.max(this.#remainingMissionM() - this.#currentRemainderM(), 0);
    const withinHorizon = ahead.slice(0, WalkPlanLayer.horizonCount(lengthsM, afterCurrentM)).map(({ task }) => task);

    const before = this.#previewed;
    this.#previewed = withinHorizon.slice(0, this.#streetsBeforeFirstJump(withinHorizon));
    for (const task of before) task.setPlannedAhead(false);
    for (const task of this.#previewed) task.setPlannedAhead(true);
    // Every previewed street is redrawn, not only the ones whose flag changed: a replan can turn a street around, and
    // its chevrons have to follow.
    for (const task of new Set([...before, ...this.#previewed])) this.#taskContainer.renderTask(task);
  }

  /**
   * Metres left in the current mission, read without MissionContainer.getMissionCompletionRate, which recomputes and
   * stores the mission's progress and so is not safe to call before the page has set the mission offset.
   *
   * @returns {number} 0 when there is no mission or it has no distance target.
   */
  #remainingMissionM() {
    const mission = this.#missionContainer.getCurrentMission();
    if (!mission) return 0;
    const targetM = mission.getDistance('meters') || 0;
    return Math.max(targetM - (mission.getProperty('distanceProgress') || 0), 0);
  }

  /**
   * @returns {number} Metres of the current street not yet walked; 0 when there is no current street.
   */
  #currentRemainderM() {
    const current = this.#taskContainer.getCurrentTask();
    return current ? WalkPlanLayer.#remainderM(current) : 0;
  }

  /**
   * @param {Task} task
   * @returns {number} Metres of the street not yet walked: all of it unless it was left part-walked (#5370).
   */
  static #remainderM(task) {
    return Math.max(task.lineDistance({ units: 'meters' }) - task.getAuditedDistance({ units: 'meters' }), 0);
  }

  /**
   * How many of the streets ahead the labeler reaches on foot before the first jump. A current street given up on for
   * lack of imagery is always left by a jump, so the count then starts from the street after it.
   *
   * Uses the gap StreetProgress measures at a street's end, not the plan's jump flag, so the two never disagree.
   *
   * @param {Task[]} tasks - The streets ahead, in walk order.
   * @returns {number} The number of streets from the front of `tasks` before the first jump.
   */
  #streetsBeforeFirstJump(tasks) {
    const current = this.#taskContainer.getCurrentTask();
    let previous = current?.isLeftToWalk() ? current : null;
    let count = 0;
    for (const task of tasks) {
      if (previous && TaskContainer.jumpGapKm(previous, task) >= TaskContainer.CONNECTED_TASK_KM) break;
      previous = task;
      count++;
    }
    return count;
  }
}
