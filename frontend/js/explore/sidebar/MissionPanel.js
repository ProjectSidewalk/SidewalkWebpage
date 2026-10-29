/**
 * Renders the "Current Mission" header and description at the top of the right sidebar.
 */

import i18next from 'i18next';
import { util } from '../../common/utilities.js';
import '../../common/utilitiesMath.js';
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('../mission/Mission.js').Mission} Mission */
/** @typedef {import('../region/RegionModel.js').RegionModel} RegionModel */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class MissionPanel {
  #config;
  #regionModel;
  #headerEl;
  #descriptionEl;
  #exitRouteEl;

  /**
   * @param {ExploreConfig} config - Names the route, when on one.
   * @param {RegionModel} regionModel - Names the region, and says whether this is a route.
   * @param {Tracker} tracker
   */
  constructor(config, regionModel, tracker) {
    this.#config = config;
    this.#regionModel = regionModel;
    this.#headerEl = document.getElementById('current-mission-header');
    this.#descriptionEl = document.getElementById('current-mission-description');
    this.#exitRouteEl = document.getElementById('explore-sidebar__exit-route');
    // The link's href does the navigation; the page-dismissal flush (Form's pagehide handler) submits the event.
    this.#exitRouteEl.addEventListener('click', () => tracker.push('Click_ExitRoute', { source: 'sidebar' }));
  }

  /**
   * Sets the header and description text for the given mission.
   * @param {Mission} mission - The current Mission object.
   */
  setMessage(mission) {
    const missionType = mission.getProperty('missionType');
    const isRoute = this.#regionModel.isRoute;

    if (missionType === 'exploreAddress') {
      this.#headerEl.innerHTML = i18next.t('right-ui.current-mission.header-free-explore');
    } else if (isRoute) {
      this.#headerEl.innerHTML = i18next.t('right-ui.current-mission.header-route');
    } else {
      this.#headerEl.innerHTML = i18next.t('right-ui.current-mission.header');
    }

    // Free exploration shows the header alone, so the description stays empty — the region message it would
    // otherwise fall through to carries a distance __PLACEHOLDER__ that this mission type never substitutes.
    let missionMessage;
    if (missionType === 'auditOnboarding') {
      missionMessage = i18next.t('tutorial.mission-message');
    } else if (missionType === 'exploreAddress') {
      missionMessage = '';
    } else if (isRoute) {
      // On a user-defined route the mission is the route itself, so name it rather than the region.
      missionMessage = i18next.t('right-ui.current-mission.message-route', {
        routeName: this.#config.routeName, interpolation: { escapeValue: true },
      });
    } else {
      // The regular mission message names the region being explored.
      const region = this.#regionModel.currentRegion();
      const regionName = region ? region.getProperty('name') : '';
      missionMessage = i18next.t('right-ui.current-mission.message', {
        regionName, interpolation: { escapeValue: true },
      });
    }

    if (missionType === 'audit' && !isRoute) {
      const distanceString = util.distanceToString(util.math.milesToMeters(mission.getDistance('miles')));
      missionMessage = missionMessage.replace('__PLACEHOLDER__', distanceString);
    }

    this.#descriptionEl.innerHTML = missionMessage;

    // The exit link only makes sense on a custom-route walk.
    this.#exitRouteEl.hidden = !isRoute;

    // The mission line is clamped to one line via CSS; when a long region name is clipped, keep the full text
    // available on hover (and leave no redundant tooltip when it already fits).
    const clipped = this.#descriptionEl.scrollWidth > this.#descriptionEl.clientWidth;
    this.#descriptionEl.title = clipped ? this.#descriptionEl.textContent : '';
  }
}
