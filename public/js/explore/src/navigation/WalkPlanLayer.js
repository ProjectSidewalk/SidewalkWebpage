/**
 * Previews the next few streets of a neighborhood mission's planned walk on the minimap, and the jumps between them
 * (#5526).
 *
 * A route shows every street ahead, but a planned walk covers the whole region, and drawing all of it as the route
 * ahead would bury the path the labeler is about to take under the rest of the neighborhood. So only the streets
 * within a horizon are drawn as the route ahead (Task.render draws a task marked planned-ahead that way), and each
 * place Explore will move the labeler rather than let them walk is drawn as a dashed connector, so a jump is visible
 * before it happens rather than announced after. Everything beyond the horizon stays quiet grey context.
 */
class WalkPlanLayer {
  // The preview reaches at least this far, so the last stretch of a mission still shows where the walk goes next.
  static #MIN_HORIZON_M = 250;
  // Fewer than two streets reads as the current street's continuation rather than as a path.
  static #MIN_STREETS = 2;
  // Past this many streets the preview stops being "the next few". The minimap's default zoom 18 spans only about
  // 100 m at Seattle's latitude, less than a block, so most of the preview is seen through the ⛶ overview, which
  // frames the previewed streets (Minimap's street bounds).
  static #MAX_STREETS = 8;
  // Holder class that reveals the legend's jump row: the row explains a mark only a planned walk draws.
  static #PLAN_MODE_CLASS = 'minimap-plan-mode';

  /** @type {TaskContainer} */
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
   * Redraws the preview whenever a new mission becomes current, since its horizon is measured against the mission's
   * remaining distance. Goes through TaskContainer.refreshWalkPlanPreview, which keeps a render error out of the
   * mission-loading code.
   *
   * @param {MissionContainer} missionContainer - Emits `MissionContainer:missionLoaded`.
   * @returns {void}
   */
  watchMissions(missionContainer) {
    missionContainer.on('MissionContainer:missionLoaded', () => this.#taskContainer.refreshWalkPlanPreview());
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
    // The current street's unwalked part is walked before any of these, so it comes out of what they must cover.
    const afterCurrentM = Math.max(this.#remainingMissionM() - this.#currentRemainderM(), 0);
    const previewedSteps = ahead.slice(0, WalkPlanLayer.horizonCount(lengthsM, afterCurrentM));

    const before = this.#previewed;
    this.#previewed = previewedSteps.map(({ task }) => task);
    for (const task of before) task.setPlannedAhead(false);
    for (const task of this.#previewed) task.setPlannedAhead(true);
    // Every previewed street is redrawn, not only the ones whose flag changed: a replan can turn a street around, and
    // its chevrons have to follow.
    for (const task of new Set([...before, ...this.#previewed])) task.render();

    this.#drawConnectors(this.#previewed);
    svl.ui?.minimap?.holder?.classList.toggle(WalkPlanLayer.#PLAN_MODE_CLASS, this.#taskContainer.hasWalkPlan());
  }

  /**
   * @returns {Task[]} The streets drawn as the path ahead, in walk order; the ⛶ overview frames them.
   */
  getPreviewedTasks() {
    return [...this.#previewed];
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
   * @returns {number} Metres of the current street not yet walked; 0 when there is no current street.
   */
  #currentRemainderM() {
    const current = this.#taskContainer.getCurrentTask();
    if (!current) return 0;
    return Math.max(current.lineDistance({ units: 'meters' }) - current.getAuditedDistance({ units: 'meters' }), 0);
  }

  /**
   * One connector for each previewed street Explore will jump to: from the end of the street before it to where the
   * labeler lands on it, its start or, on a part-walked street, where they left it. The street before is the previous
   * previewed one, or the current street for the first: a step between them that was walked or given up on out of
   * order is skipped by nextTask, so it does not stand between the labeler and the jump.
   *
   * Drawn from geometry rather than the plan's own jump flag, with the rule NavigationService applies at the end of a
   * street: a gap under svl.CONNECTED_TASK_THRESHOLD is switched seamlessly, so a connector there would promise a jump
   * that never comes.
   *
   * @param {Task[]} previewed - The previewed streets, in walk order.
   * @returns {void}
   */
  #drawConnectors(previewed) {
    for (const connector of this.#connectors) connector.setMap(null);
    this.#connectors = [];
    if (svl.isExploreAddressMode?.()) return;

    let previous = this.#taskContainer.getCurrentTask();
    for (const task of previewed) {
      if (previous) {
        const from = previous.getEndCoordinate();
        const to = task.isResumed()
          ? task.getFurthestPointReached().geometry.coordinates
          : [task.getStartCoordinate().lng, task.getStartCoordinate().lat];
        const gapKm = turf.distance(turf.point([from.lng, from.lat]), turf.point(to), { units: 'kilometers' });
        if (gapKm >= svl.CONNECTED_TASK_THRESHOLD) {
          const path = [new google.maps.LatLng(from.lat, from.lng), new google.maps.LatLng(to[1], to[0])];
          const connector = new google.maps.Polyline(MinimapStyle.plannedJump(path));
          connector.setMap(svl.minimap.getMap());
          this.#connectors.push(connector);
        }
      }
      previous = task;
    }
  }
}
