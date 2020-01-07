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
            missionMessage = "Complete the onboarding tutorial!";
        } else if (svl.missionContainer.isTheFirstMission()) {
            missionMessage = "Walk for __PLACEHOLDER__ and find all the sidewalk accessibility attributes"
        } else {
            missionMessage = "Explore __PLACEHOLDER__ of this neighborhood";
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

    if (distance === "0.0947"){
        return "500ft";
    } else if (distance === "0.1420") {
        return "750ft";
    } else if (distance === "0.1894") {
        return "1000ft";
    } else if (distance === "0.2500") {
        return "&frac14;mi";
    } else if (distance === "0.3788") {
        return "2000ft";
    } else if (distance === "0.5000") {
        return "&frac12;mi";
    } else if (distance === "0.7500") {
        return "&frac34;mi";
    } else {
        return (util.math.milesToFeet(distance)).toFixed(0) + "ft";
    }
};
