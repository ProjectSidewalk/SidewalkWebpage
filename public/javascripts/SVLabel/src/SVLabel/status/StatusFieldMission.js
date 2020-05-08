function StatusFieldMission (modalModel, uiStatusField) {
    var self = this;
    var $missionDescription = uiStatusField.holder.find("#current-mission-description");

    modalModel.on("ModalMissionComplete:closed", function (param) {
        self.setMessage(param.nextMission);
    });

    /**
     * This method takes a Mission object and sets the appropriate text for the mission status field in
     * @param mission
     */
    this.setMessage = function (mission) {
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
}

StatusFieldMission.prototype._distanceToString = function (distance, unit) {
    if (!unit) unit = "kilometers";

    // Convert to miles and round to 4 decimal places.
    if (unit === "feet") distance = util.math.feetToMiles(distance);
    else if (unit === "meters") distance = util.math.metersToMiles(distance);
    else if (unit === "kilometers") distance = util.math.kilometersToMiles(distance);

    distance = distance.toPrecision(4);
    var distanceType = i18next.t('mission-start.distance-type', 'meters');

    if (distance === "0.0947"){
        if(distanceType === "meters") return Math.trunc(500 * 0.3048) + "m";
        return "500ft";
    } else if (distance === "0.1420") {
        if(distanceType === "meters") return Math.trunc(750 * 0.3048) + "m";
        return "750ft";
    } else if (distance === "0.1894") {
        if(distanceType === "meters") return Math.trunc(1000 * 0.3048) + "m";
        return "1000ft";
    } else if (distance === "0.2500") {
        if(distanceType === "meters") return Math.trunc(distance * 5280 * 0.3048) + "m";
        return "&frac14;mi";
    } else if (distance === "0.3788") {
        if(distanceType === "meters") return Math.trunc(2000 * 0.3048) + "m";
        return "2000ft";
    } else if (distance === "0.5000") {
        if(distanceType === "meters") return Math.trunc(distance * 5280 * 0.3048) + "m";
        return "&frac12;mi";
    } else if (distance === "0.7500") {
        if(distanceType === "meters") return Math.trunc(distance * 5280 * 0.3048) + "m";
        return "&frac34;mi";
    } else {
        if(distanceType === "meters") return Math.trunc(distance * 5280 * 0.3048) + "m";
        return (util.math.milesToFeet(distance)).toFixed(0) + "ft";
    }
};
