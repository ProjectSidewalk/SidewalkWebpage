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
        // The header gains a "Route: <route-number>" suffix when on a user-defined route.
        if (svl.neighborhoodModel.isRoute) {
            this.#headerEl.innerHTML = i18next.t('right-ui.current-mission.header-route', { route_number: svl.routeId });
        } else {
            this.#headerEl.innerHTML = i18next.t('right-ui.current-mission.header');
        }

        const missionType = mission.getProperty('missionType');

        let missionMessage;
        if (missionType === 'auditOnboarding') {
            missionMessage = i18next.t('tutorial.mission-message');
        } else if (svl.missionContainer.isTheFirstMission()) {
            missionMessage = i18next.t('right-ui.current-mission.message-first-mission');
        } else {
            missionMessage = i18next.t('right-ui.current-mission.message');
        }

        if (missionType === 'audit') {
            const distanceString = this.#distanceToString(mission.getDistance('miles'), 'miles');
            missionMessage = missionMessage.replace('__PLACEHOLDER__', distanceString);
        }

        this.#descriptionEl.innerHTML = missionMessage;
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
