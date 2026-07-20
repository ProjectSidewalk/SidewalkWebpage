/**
 * Renders the "Current Mission" header and description at the top of the right sidebar.
 */
class MissionPanel {
  #headerEl;
  #descriptionEl;

  constructor() {
    this.#headerEl = document.getElementById('current-mission-header');
    this.#descriptionEl = document.getElementById('current-mission-description');
  }

  /**
   * Sets the header and description text for the given mission.
   * @param mission The current Mission object.
   */
  setMessage(mission) {
    const missionType = mission.getProperty('missionType');
    const isRoute = svl.neighborhoodModel.isRoute;

    if (missionType === 'exploreAddress') {
      this.#headerEl.innerHTML = i18next.t('right-ui.current-mission.header-free-explore');
    } else {
      this.#headerEl.innerHTML = i18next.t('right-ui.current-mission.header');
    }

    // Free exploration shows the header alone, so the description stays empty — the neighborhood message it would
    // otherwise fall through to carries a distance __PLACEHOLDER__ that this mission type never substitutes.
    let missionMessage;
    if (missionType === 'auditOnboarding') {
      missionMessage = i18next.t('tutorial.mission-message');
    } else if (missionType === 'exploreAddress') {
      missionMessage = '';
    } else if (isRoute) {
      // On a user-defined route the mission is the route itself, so name it rather than the neighborhood.
      missionMessage = i18next.t('right-ui.current-mission.message-route', { routeName: svl.routeName });
    } else {
      // The regular mission message names the neighborhood being explored.
      const neighborhood = svl.neighborhoodModel.currentNeighborhood();
      const neighborhoodName = neighborhood ? neighborhood.getProperty('name') : '';
      missionMessage = i18next.t('right-ui.current-mission.message', { neighborhoodName });
    }

    if (missionType === 'audit' && !isRoute) {
      const distanceString = this.#distanceToString(mission.getDistance('miles'), 'miles');
      missionMessage = missionMessage.replace('__PLACEHOLDER__', distanceString);
    }

    this.#descriptionEl.innerHTML = missionMessage;

    // The mission line is clamped to one line via CSS; when a long neighborhood name is clipped, keep the full text
    // available on hover (and leave no redundant tooltip when it already fits).
    const clipped = this.#descriptionEl.scrollWidth > this.#descriptionEl.clientWidth;
    this.#descriptionEl.title = clipped ? this.#descriptionEl.textContent : '';
  }

  /**
   * Converts a mission distance to a localized, rounded display string with its unit abbreviation.
   * @param {number} distance The distance value.
   * @param {string} unit The unit of the passed distance ("feet", "miles", or "kilometers").
   * @returns {string}
   */
  #distanceToString(distance, unit = 'kilometers') {
    // Convert to meters first.
    if (unit === 'feet') distance = util.math.feetToMeters(distance);
    else if (unit === 'miles') distance = util.math.milesToMeters(distance);
    else if (unit === 'kilometers') distance = util.math.kmsToMeters(distance);

    const distanceType = i18next.t('common:measurement-system');
    const unitAbbreviation = i18next.t('common:unit-abbreviation-mission-distance');

    if (distanceType === 'metric') return `${util.math.roundToTwentyFive(distance)} ${unitAbbreviation}`;
    return `${util.math.roundToTwentyFive(util.math.metersToFeet(distance))} ${unitAbbreviation}`;
  }
}
