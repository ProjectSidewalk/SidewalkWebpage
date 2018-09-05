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
            var distance = mission.getDistance("miles");
            var distanceString = this._distanceToString(distance.toPrecision(4), "miles");
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

    if (unit == "miles") {
        if(distance <= 0.12){
            return "500ft";
        }
        else if (distance <= 0.20) {
            return "1000ft";
        } else if (distance <= 0.25) {
            return "&frac14;mi";
        } else if (distance <= 0.5) {
            return "&frac12;mi"
        } else if (distance <= 0.75) {
            return "&frac34;mi";
        } else {
            return distance.toFixed(0, 10) + "";
        }
    } else if (unit == "feet") {
        return distance + "";
    } else {
        return distance + "";
    }
};