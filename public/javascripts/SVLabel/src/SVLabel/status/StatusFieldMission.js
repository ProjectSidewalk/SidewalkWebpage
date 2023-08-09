function StatusFieldMission (modalModel, uiStatusField) {
    var self = this;
    var $missionHeader = uiStatusField.holder.find("#current-mission-header");
    var $missionDescription = uiStatusField.holder.find("#current-mission-description");

    modalModel.on("ModalMissionComplete:closed", function (param) {
        self.setMessage(param.nextMission);
    });

    /**
     * This method takes a Mission object and sets the appropriate text for the mission status field in
     * @param mission
     */
    this.setMessage = function (mission) {
        // Set header first. We just add "Route: <route-number>" if we are on a user-defined route.
        if (svl.neighborhoodModel.isRoute) {
            $missionHeader.html(i18next.t('right-ui.current-mission.header-route', { route_number: svl.routeId }));
        } else {
            $missionHeader.html(i18next.t('right-ui.current-mission.header'));
        }

        var missionType = mission.getProperty("missionType");

        var missionMessage;
        if (missionType === "auditOnboarding") {
            missionMessage = i18next.t('tutorial.mission-message');
        } else if (svl.missionContainer.isTheFirstMission()) {
            missionMessage = i18next.t('right-ui.current-mission.message-first-mission');
        } else {
            missionMessage = i18next.t('right-ui.current-mission.message');
        }

        if (missionType === "audit") {
            var distanceString = this._distanceToString(mission.getDistance("miles"), "miles");
            missionMessage = missionMessage.replace("__PLACEHOLDER__", distanceString);
        }

        $missionDescription.html(missionMessage);
    };

    /**
     *  This method takes in an integer feet and converts it to meters, truncating all decimals.
     *  @param feet to convert to meters
     *  @return
     */
    this.convertToMetric = function(feet, unitAbbreviation) {
        return Math.trunc(feet * 0.3048) + " " + unitAbbreviation;
    };
}

StatusFieldMission.prototype._distanceToString = function (distance, unit) {
    if (!unit) unit = "kilometers";

    // Convert to meters.
    if (unit === "feet") distance = util.math.feetToMeters(distance);
    else if (unit === "miles") distance = util.math.milesToMeters(distance);
    else if (unit === "kilometers") distance = util.math.kilometersToMeters(distance);

    var distanceType = i18next.t('common:measurement-system');
    var unitAbbreviation = i18next.t('common:unit-abbreviation-mission-distance');

    if (distanceType === "metric") return util.math.roundToTwentyFive(distance) + " " + unitAbbreviation;
    else return util.math.roundToTwentyFive(util.math.metersToFeet(distance)) + " " + unitAbbreviation;
};
