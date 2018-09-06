function StatusFieldMission (modalModel, uiStatusField) {
    var self = this;
    var $missionDescription = uiStatusField.holder.find("#current-mission-description");

    // These are messages that are shown under the "Current Mission" in the status pane. The object's keys correspond to
    // the "label"s of missions (e.g., "initial-mission"). Substitute __PLACEHOLDER__ depending on each mission.
    // TODO update these to check for first mission and neighborhood completion mission status based on tasks, etc.
    var missionMessages = {
        "auditOnboarding": "Complete the onboarding tutorial!",
        "initial-mission": "Walk for 1000ft and find all the sidewalk accessibility attributes",
        "audit": "Audit __PLACEHOLDER__ of this neighborhood",
        "area-coverage-mission": "Make __PLACEHOLDER__ of this neighborhood accessible"
    };

    modalModel.on("ModalMissionComplete:closed", function (param) {
        self. setMessage(param.nextMission);
    });

    /**
     * This method returns the mission message based on the passed label parameter.
     * @param label {string} Mission label
     * @returns {string}
     */
    this._getMissionMessage = function (label) {
        return label in missionMessages ? missionMessages[label] : "";
    };

    /**
     * This method takes a Mission object and sets the appropriate text for the mission status field in
     * @param mission
     */
    this.setMessage = function (mission) {
        var missionType = mission.getProperty("missionType");
        var missionMessage = this._getMissionMessage(missionType);

        if (missionType === "audit") {
            var distanceString = this._distanceToString(mission.getDistance("miles"), "miles");
            missionMessage = missionMessage.replace("__PLACEHOLDER__", distanceString);

        } else if (missionType === "area-coverage-mission") {
            var coverage = (mission.getProperty("coverage") * 100).toFixed(0) + "%";
            missionMessage = missionMessage.replace("__PLACEHOLDER__", coverage);
        }

        $missionDescription.html(missionMessage);
    };
}

StatusFieldMission.prototype._distanceToString = function (distance, unit) {
    if (!unit) unit = "kilometers";

    // Convert to miles and round to 4 decimal places.
    if (unit === "feet") distance = distance / 5280;
    else if (unit === "meters") distance = distance / 1609.34;
    else if (unit === "kilometers") distance = distance / 1.60934;

    distance = distance.toPrecision(4);

    if (distance === "0.0947"){
        return "500ft";
    } else if (distance === "0.1894") {
        return "1001ft";
    } else if (distance === "0.2500") {
        return "&frac14;mi";
    } else if (distance === "0.3788") {
        return "2000ft";
    } else if (distance === "0.5000") {
        return "&frac12;mi";
    } else if (distance === "0.7500") {
        return "&frac34;mi";
    } else {
        return (distance * 5280).toFixed(0) + "ft";
    }
};
