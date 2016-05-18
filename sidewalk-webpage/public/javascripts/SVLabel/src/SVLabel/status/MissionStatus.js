function MissionStatus () {
    var self = { className: "MissionStatus" };

    // These are messages that are shown under the "Current Mission" in the status pane. The object's keys correspond to
    // the "label"s of missions (e.g., "initial-mission"). Substitute __PLACEHOLDER__ depending on each mission.
    var missionMessages = {
        "onboarding": "Complete the onboarding tutorial!",
        "initial-mission": "Walk for 1000ft and find all the sidewalk accessibility attributes",
        "distance-mission": "Walk for __PLACEHOLDER__ and find all the sidewalk accessibility attributes in this neighborhood",
        "area-coverage-mission": "Make the __PLACEHOLDER__ of this neighborhood more accessible"
    };
    
    function _init() {
        printCompletionRate(0);
        
    }

    /**
     * This method returns the mission message based on the passed label parameter.
     * @param label {string} Mission label
     * @returns {string}
     */
    function getMissionMessage(label) {
        return label in missionMessages ? missionMessages[label] : "";
    }

    /**
     * This method prints what percent of the intersection the user has observed.
     * @param completionRate {number} Mission completion rate.
     * @returns {printCompletionRate}
     */
    function printCompletionRate (completionRate) {
        completionRate *= 100;
        if (completionRate > 100) completionRate = 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% complete";
        svl.ui.progressPov.rate.html(completionRate);
        return this;
    }

    /**
     * This method takes a mission object and sets the appropriate text for the mission status field in 
     * the status pane.
     * @param mission
     * @returns {printMissionMessage}
     */
    function printMissionMessage (mission) {
        var missionLabel = mission.getProperty("label"),
            missionMessage = getMissionMessage(missionLabel);

        if (missionLabel == "distance-mission") {
            if (mission.getProperty("level") <= 2) {
                missionMessage = missionMessage.replace("__PLACEHOLDER__", mission.getProperty("distanceFt") + "ft");
            } else {
                missionMessage = missionMessage.replace("__PLACEHOLDER__", mission.getProperty("distanceMi") + "mi");
            }
        } else if (missionLabel == "area-coverage-mission") {
            var coverage = (mission.getProperty("coverage") * 100).toFixed(0) + "%";
            missionMessage = missionMessage.replace("__PLACEHOLDER__", coverage);
        }

        svl.ui.status.currentMissionDescription.html(missionMessage);

        return this;
    }

    /**
     * This method updates the filler of the completion bar
     */
    function updateMissionCompletionBar (completionRate) {
        var r, g, b, color, colorIntensity = 200;
        if (completionRate < 0.6) {
            r = colorIntensity * 1.3;
            g = parseInt(colorIntensity * completionRate * 2);
            b = 20;
        }
        // TODO change green threshold to ~90%
        else {
            r = parseInt(colorIntensity * (1 - completionRate) * 1.7);
            g = colorIntensity;
            b = 100;
        }
        color = 'rgba(' + r + ',' + g + ',' + b + ',1)';
        completionRate *=  100;
        if (completionRate > 100) completionRate = 100;
        completionRate = completionRate.toFixed(0, 10);
        // completionRate -= 0.8;
        completionRate = completionRate + "%";
        svl.ui.progressPov.filler.css({
            background: color,
            width: completionRate
        });
        return this;
    }

    self.printCompletionRate = printCompletionRate;
    self.printMissionMessage = printMissionMessage;
    self.updateMissionCompletionBar = updateMissionCompletionBar;
    
    _init();
    return self;
}
