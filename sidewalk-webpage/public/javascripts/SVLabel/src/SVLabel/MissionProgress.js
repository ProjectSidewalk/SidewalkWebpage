var svl = svl || {};

/**
 *
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 */
function MissionProgress () {
    var self = {className: 'ProgressPov'};
    var status = {
        currentCompletionRate: 0,
        currentMission: null,
        previousHeading: 0,
        surveyedAngles: undefined
    };

    var $divCurrentCompletionRate;
    var $divCurrentCompletionBar;
    var $divCurrentCompletionBarFiller;


    function _init() {
        $divCurrentCompletionRate = svl.ui.progressPov.rate;
        $divCurrentCompletionBar = svl.ui.progressPov.bar;
        $divCurrentCompletionBarFiller = svl.ui.progressPov.filler;

        // Fill in the surveyed angles
        status.surveyedAngles = new Array(100);
        for (var i=0; i < 100; i++) {
            status.surveyedAngles[i] = 0;
        }

        printCompletionRate();
    }

    function complete (mission, callback) {
        console.log("Congratulations, you have completed the following mission:", mission);
        if (callback) callback();
    }

    /**
     * This method prints what percent of the intersection the user has observed.
     * @returns {printCompletionRate}
     */
    function printCompletionRate () {
        if ("missionContainer" in svl) {
            var mission = svl.missionContainer.getCurrentMission();
            if (mission) {
                var completionRate = mission.getMissionCompletionRate() * 100;
                completionRate = completionRate.toFixed(0, 10);
                completionRate = completionRate + "% complete";
                $divCurrentCompletionRate.html(completionRate);
            }
        }

        return this;
    }

    /**
     * This method updates the filler of the completion bar
     */
    function updateMissionCompletionBar () {
        if ("missionContainer" in svl) {
            var mission = svl.missionContainer.getCurrentMission();
            if (mission) {
                var r, g, color, completionRate = mission.getMissionCompletionRate();
                var colorIntensity = 230;
                if (completionRate < 0.5) {
                    r = colorIntensity;
                    g = parseInt(colorIntensity * completionRate * 2);
                } else {
                    r = parseInt(colorIntensity * (1 - completionRate) * 2);
                    g = colorIntensity;
                }

                color = 'rgba(' + r + ',' + g + ',0,1)';
                completionRate *=  100;
                completionRate = completionRate.toFixed(0, 10);
                completionRate -= 0.8;
                completionRate = completionRate + "%";
                $divCurrentCompletionBarFiller.css({
                    background: color,
                    width: completionRate
                });
            }
        }
        return this;
    }

    /**
     * This method updates the printed completion rate and the bar.
     */
    function updateMissionCompletionRate () {
        printCompletionRate();
        updateMissionCompletionBar();
    }


    function showMission () {
        var currentMission = svl.missionContainer.getCurrentMission();
        if (currentMission) console.debug(currentMission);
    }

    self.complete = complete;
    self.updateMissionCompletionRate = updateMissionCompletionRate;
    self.showMission = showMission;

    _init();
    return self;
}
