/**
 * The mission's progress on the minimap: the bar along its top edge, and the start and finish flags of a
 * neighborhood mission, planted so a mission reads the way a RouteBuilder route does.
 */

import { util } from '../../common/utilities.js';
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('../Main.js').MinimapUi} MinimapUi */
/** @typedef {import('./Minimap.js').Minimap} Minimap */
/** @typedef {import('./Minimap.js').MinimapMarker} MinimapMarker */
/** @typedef {import('../mission/Mission.js').Mission} Mission */
/** @typedef {import('../mission/MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../region/RegionModel.js').RegionModel} RegionModel */
/** @typedef {import('../task/Task.js').Task} Task */
/** @typedef {import('../task/TaskContainer.js').TaskContainer} TaskContainer */

export class MinimapMissionProgress {
  // Route start/finish flags reuse RouteBuilder's flag icons at its rasterized size, planted at the pole base.
  static #FLAG_SIZE_PX = 27;
  static #START_FLAG_SRC = util.assetPath('images/icons/routebuilder/flag-start.svg');
  static #FINISH_FLAG_SRC = util.assetPath('images/icons/routebuilder/flag-end.svg');

  #ui;
  #config;
  #regionModel;
  #taskContainer;
  #missionContainer;
  #minimap;

  /**
   * The flags, planted on first use and moved after; see updateFlags().
   * @type {{start: ?MinimapMarker, finish: ?MinimapMarker}}
   */
  #flags = { start: null, finish: null };

  /**
   * @param {MinimapUi} ui
   * @param {ExploreConfig} config
   * @param {RegionModel} regionModel
   * @param {TaskContainer} taskContainer - Whose streets carry the mission's start and may carry its finish.
   * @param {MissionContainer} missionContainer - Measures a mission's completion.
   * @param {Minimap} minimap - Where the flags are planted.
   */
  constructor(ui, config, regionModel, taskContainer, missionContainer, minimap) {
    this.#ui = ui;
    this.#config = config;
    this.#regionModel = regionModel;
    this.#taskContainer = taskContainer;
    this.#missionContainer = missionContainer;
    this.#minimap = minimap;
  }

  /**
   * Fills the bar to the mission's completion fraction and labels it with the percentage and the distance explored
   * so far out of the mission's target (e.g. "65%  325/500 ft").
   * @param {Mission} mission - The current mission.
   */
  update(mission) {
    this.updateFlags(mission);
    const totalMeters = mission.getDistance('meters');
    // Free-exploration missions (#4451) have no distance target; a "0/0" progress bar would be meaningless, so hide it.
    if (!totalMeters) {
      this.#ui.missionProgress.style.display = 'none';
      return;
    }
    this.#ui.missionProgress.style.display = '';

    const fraction = this.#missionContainer.getMissionCompletionRate(mission);
    const doneMeters = Math.min(Math.max(mission.getProperty('distanceProgress') || 0, 0), totalMeters);
    const percent = Math.round(fraction * 100);

    this.#ui.missionProgressFill.style.width = `${percent}%`;
    this.#ui.missionProgressPercent.textContent = `${percent}%`;
    this.#ui.missionProgressDistance.textContent
      = i18next.t('common:distance-progress', { done: doneMeters, total: totalMeters });
    this.#ui.missionProgress.setAttribute('aria-valuenow', String(percent));
  }

  /**
   * Resets the bar to 0% for a freshly started mission, mirroring the sidebar bar's reset when the mission-complete
   * modal closes. Shows "0 / <target>" so the new mission's length is visible right away, and re-plants the flags for
   * the new mission: its start is where the last one finished, so the red finish flag the user just reached becomes
   * the green start flag without waiting for their next step (#5378).
   * @param {Mission} [mission] - The newly started mission; if absent, the distance label is cleared.
   */
  reset(mission) {
    this.#ui.missionProgressFill.style.width = '0%';
    this.#ui.missionProgressPercent.textContent = '0%';
    this.#ui.missionProgress.setAttribute('aria-valuenow', '0');
    if (mission) {
      this.updateFlags(mission);
      const totalMeters = mission.getDistance('meters');
      this.#ui.missionProgressDistance.textContent
        = i18next.t('common:distance-progress', { done: 0, total: totalMeters });
    } else {
      this.#ui.missionProgressDistance.textContent = '';
    }
  }

  /**
   * Plants a neighborhood mission's start and finish flags. The start is where the mission began (recorded on the
   * task it began on, and persisted with it). The finish is only knowable once the mission's remaining distance fits
   * on the current street, since a neighborhood mission picks each next street as it goes; until then no finish flag
   * shows. Routes keep their whole-route flags; the tutorial and free exploration have no mission to frame.
   * @param {Mission} mission - The current mission.
   */
  updateFlags(mission) {
    if (this.#regionModel.isRoute || this.#config.isOnboarding || this.#config.isExploreAddressMode) return;
    const missionId = mission.getProperty('missionId');
    const startTask = this.#taskContainer.getTasks().find((task) => task.getMissionStart(missionId));
    this.#placeFlag('start', startTask ? startTask.getMissionStart(missionId) : null,
      MinimapMissionProgress.#START_FLAG_SRC, 'mission-start-flag');
    this.#placeFlag('finish', MinimapMissionProgress.missionFinish(mission, this.#taskContainer.getCurrentTask()),
      MinimapMissionProgress.#FINISH_FLAG_SRC, 'mission-finish-flag');
  }

  /**
   * Where a mission will end, once that point lies on the current street: the mission's remaining distance walked
   * along the street from the furthest point reached. Null while a later, not-yet-chosen street will carry the end.
   * @param {Mission} mission - The current mission.
   * @param {?Task} task - The current task.
   * @returns {?{lat: number, lng: number}}
   */
  static missionFinish(mission, task) {
    const totalMeters = mission.getDistance('meters');
    if (!totalMeters || !task) return null;
    const remainingKm = Math.max(0, totalMeters - (mission.getProperty('distanceProgress') || 0)) / 1000;
    const remainder = task.unwalkedRemainder();
    if (remainingKm > turf.length(remainder)) return null;
    const [lng, lat] = turf.along(remainder, remainingKm).geometry.coordinates;
    return { lat, lng };
  }

  /**
   * Plants, moves, or hides one of the flags.
   * @param {'start'|'finish'} which - Which flag.
   * @param {?{lat: number, lng: number}} latLng - Where it goes, or null to hide it.
   * @param {string} src - The flag image.
   * @param {string} i18nKey - Key under audit:right-ui.minimap for its tooltip.
   */
  #placeFlag(which, latLng, src, i18nKey) {
    const flag = this.#flags[which];
    if (!latLng) {
      if (flag) flag.setVisible(false);
      return;
    }
    if (!flag) {
      this.#flags[which] = MinimapMissionProgress.plantFlag(
        this.#minimap, latLng, src, i18next.t(`audit:right-ui.minimap.${i18nKey}`),
      );
      return;
    }
    flag.setLatLng(latLng);
    flag.setVisible(true);
  }

  /**
   * One flag marker, planted with its pole base on the point (the bottom anchor matches RouteBuilder's icon-anchor).
   * Also plants a route's start and finish flags, which share the icons.
   * @param {Minimap} minimap - Where to plant it.
   * @param {{lat: number, lng: number}} latLng - Where to plant it.
   * @param {string} src - The flag image.
   * @param {string} title - Hover tooltip and accessible name.
   * @returns {MinimapMarker}
   */
  static plantFlag(minimap, latLng, src, title) {
    const content = document.createElement('img');
    content.src = src;
    content.alt = title;
    content.style.width = `${MinimapMissionProgress.#FLAG_SIZE_PX}px`;
    return minimap.addMarker(latLng, content, { anchor: 'bottom', title });
  }

  /**
   * Plants a route's start and finish flags (routes only), reusing the flag icons the user placed while building the
   * route so building and walking read as one experience. The flags reinforce route status already conveyed textually
   * (progress bar, finish toast, compass message); their tooltip names them for anyone hovering.
   * @param {{lat: number, lng: number}} start - Route start (first street's walking-start coordinate).
   * @param {{lat: number, lng: number}} finish - Route finish (last street's walking-end coordinate).
   */
  showRouteEndpoints(start, finish) {
    const plant = (latLng, src, key) => MinimapMissionProgress.plantFlag(this.#minimap, latLng, src, i18next.t(key));
    plant(start, MinimapMissionProgress.#START_FLAG_SRC, 'audit:right-ui.minimap.route-start-flag');
    plant(finish, MinimapMissionProgress.#FINISH_FLAG_SRC, 'audit:right-ui.minimap.route-finish-flag');
  }
}
