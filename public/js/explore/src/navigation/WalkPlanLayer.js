/**
 * Previews the next few streets of a neighborhood mission's planned walk on the minimap, and the jumps between them
 * (#5526).
 *
 * A route shows every street ahead, but a planned walk covers the whole region, and drawing all of it as the route
 * ahead would bury the path the labeler is about to take under the rest of the neighborhood. So only the streets
 * within a horizon are drawn as the route ahead (Task.render draws a task marked planned-ahead that way), and each
 * upcoming jump is drawn as a dotted connector, so a jump is visible before it happens rather than announced after.
 * Everything beyond the horizon stays quiet grey context.
 */
class WalkPlanLayer {
  // The preview reaches at least this far, so the last stretch of a mission still shows where the walk goes next.
  static #MIN_HORIZON_M = 250;
  // Fewer than two streets reads as the current street's continuation rather than as a path.
  static #MIN_STREETS = 2;
  // Past this many streets the preview stops being "the next few" and starts filling the minimap, which at its usual
  // zoom shows only a block or two in each direction anyway.
  static #MAX_STREETS = 8;

  #taskContainer;
  /** @type {Task[]} */
  #previewed = [];
  /** @type {google.maps.Polyline[]} */
  #connectors = [];

  /**
   * @param {TaskContainer} taskContainer - Source of the plan and of the current street.
   */
  constructor(taskContainer) {
    this.#taskContainer = taskContainer;
  }

  /**
   * How many of the planned streets ahead to preview: enough to cover the rest of the mission (and at least
   * #MIN_HORIZON_M), never fewer than #MIN_STREETS nor more than #MAX_STREETS.
   *
   * @param {number[]} lengthsM - Lengths of the planned streets ahead, in walk order.
   * @param {number} remainingMissionM - Metres left in the current mission; 0 when unknown.
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
   * Recomputes which streets are previewed and redraws them and the jump connectors. Cheap enough to run on every
   * street switch: it touches at most #MAX_STREETS streets plus the ones previewed before.
   *
   * @returns {void}
   */
  refresh() {
    const ahead = this.#taskContainer.getPlannedStepsAhead(WalkPlanLayer.#MAX_STREETS);
    const lengthsM = ahead.map(({ task }) => task.lineDistance({ units: 'meters' }));
    const previewedSteps = ahead.slice(0, WalkPlanLayer.horizonCount(lengthsM, this.#remainingMissionM()));

    const before = this.#previewed;
    this.#previewed = previewedSteps.map(({ task }) => task);
    for (const task of before) task.setPlannedAhead(false);
    for (const task of this.#previewed) task.setPlannedAhead(true);
    // Every previewed street is redrawn, not only the ones whose flag changed: a replan can turn a street around, and
    // its chevrons have to follow.
    for (const task of new Set([...before, ...this.#previewed])) task.render();

    this.#drawConnectors(previewedSteps);
  }

  /**
   * Metres left in the current mission, read without Mission.getMissionCompletionRate, which recomputes and stores
   * the mission's progress and so is not safe to call before the page has set the mission offset.
   *
   * @returns {number} 0 when there is no mission or it has no distance target.
   */
  #remainingMissionM() {
    const mission = svl.missionContainer?.getCurrentMission();
    if (!mission) return 0;
    const targetM = mission.getDistance('meters') || 0;
    return Math.max(targetM - (mission.getProperty('distanceProgress') || 0), 0);
  }

  /**
   * One connector per previewed jump, from the end of the street before it to the start of the jumped-to street.
   * The street before is the previous previewed one, or the current street for the first: steps between them that
   * were walked or given up on out of order no longer stand between the labeler and the jump.
   *
   * @param {{task: Task, step: {jump: boolean}}[]} previewedSteps - The previewed streets with their plan steps.
   * @returns {void}
   */
  #drawConnectors(previewedSteps) {
    for (const connector of this.#connectors) connector.setMap(null);
    this.#connectors = [];
    if (svl.isExploreAddressMode?.()) return;

    let previous = this.#taskContainer.getCurrentTask();
    for (const { task, step } of previewedSteps) {
      if (step?.jump && previous) {
        const from = previous.getEndCoordinate();
        const to = task.getStartCoordinate();
        const path = [new google.maps.LatLng(from.lat, from.lng), new google.maps.LatLng(to.lat, to.lng)];
        const connector = new google.maps.Polyline(MinimapStyle.plannedJump(path));
        connector.setMap(svl.minimap.getMap());
        this.#connectors.push(connector);
      }
      previous = task;
    }
  }
}
