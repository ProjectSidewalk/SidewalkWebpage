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

    /**
     *  This method takes in an integer feet and converts it to meters, truncuating all decimals
     *  @param feet to convert to meters
     *  @return conversion as a String
     */
    this.convertToMetric = function(feet) {
        return Math.trunc(feet * 0.3048) + "m";
    };
}

StatusFieldMission.prototype._distanceToString = function (distance, unit) {
    if (!unit) unit = "kilometers";

    // Convert to miles and round to 4 decimal places.
    if (unit === "feet") distance = util.math.feetToMiles(distance);
    else if (unit === "meters") distance = util.math.metersToMiles(distance);
    else if (unit === "kilometers") distance = util.math.kilometersToMiles(distance);

    distance = distance.toPrecision(4);
    var distanceType = i18next.t('measurement-system');

    if (distance === "0.0947"){
        if(distanceType === "metric") return this.convertToMetric(500);
        return "500ft";
    } else if (distance === "0.1420") {
        if(distanceType === "metric") return this.convertToMetric(750);
        return "750ft";
    } else if (distance === "0.1894") {
        if(distanceType === "metric") return this.convertToMetric(1000);
        return "1000ft";
    } else if (distance === "0.2500") {
        if(distanceType === "metric") return this.convertToMetric(distance * 5280);
        return "&frac14;mi";
    } else if (distance === "0.3788") {
        if(distanceType === "metric") return this.convertToMetric(2000);
        return "2000ft";
    } else if (distance === "0.5000") {
        if(distanceType === "metric") return this.convertToMetric(distance * 5280);
        return "&frac12;mi";
    } else if (distance === "0.7500") {
        if(distanceType === "metric") return this.convertToMetric(distance * 5280);
        return "&frac34;mi";
    } else {
        if(distanceType === "metric") return this.convertToMetric(distance * 5280);
        return (util.math.milesToFeet(distance)).toFixed(0) + "ft";
    }
};
