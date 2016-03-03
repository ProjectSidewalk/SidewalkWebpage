var svl = svl || {};

/**
 *
 * @returns {{className: string}}
 * @constructor
 */
function MissionProgress () {
    var self = { className: 'MissionProgress' };
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

    /**
     * Finish the mission.
     * @param mission
     */
    function complete (mission) {
        if (mission) {
            mission.complete();
            svl.missionContainer.addToCompletedMissions(mission);
            svl.missionContainer.stage(mission);

            showMissionCompleteWindow(mission, function () {
               console.log("Mission complete");
            });
        }
    }

    /**
     * This method prints what percent of the intersection the user has observed.
     * @returns {printCompletionRate}
     */
    function printCompletionRate (mission) {
        if (mission) {
            var completionRate = mission.getMissionCompletionRate() * 100;
            completionRate = completionRate.toFixed(0, 10);
            completionRate = completionRate + "% complete";
            $divCurrentCompletionRate.html(completionRate);
        }
        return this;
    }

    /**
     * Show a message to the user that they have completed the mission
     */
    function showMission () {
        var currentMission = svl.missionContainer.getCurrentMission();
        if (currentMission) console.debug(currentMission);
    }

    /**
     * Show to the user that the mission is completed
     * @param mission
     * @param callback
     */
    function showMissionCompleteWindow (mission, callback) {
        console.log("Congratulations, you have completed the following mission:", mission);
        if (callback) callback();
    }

    /**
     * This method updates the mission completion rate and its visualization.
     */
    function update () {
        if ("missionContainer" in svl) {
            // Todo. I think I should check not only the current mission but also all the incomplete missions
            var i, len, missions,
                currentRegion = svl.neighborhoodContainer.getCurrentNeighborhood(),
                currentMission = svl.missionContainer.getCurrentMission(),
                completionRate;
            printCompletionRate(currentMission);
            updateMissionCompletionBar(currentMission);

            if (currentRegion) {
                missions = svl.missionContainer.getMissionsByRegionId(currentRegion.getProperty("regionId"));
                missions = missions.concat(svl.missionContainer.getMissionsByRegionId("noRegionId"));

                len = missions.length;
                for (i = 0; i < len; i++) {
                    completionRate = missions[i].getMissionCompletionRate();
                    if (completionRate >= 1.0) {
                        complete(missions[i]);
                    }
                }
            }
        }
    }

    /**
     * This method updates the filler of the completion bar
     */
    function updateMissionCompletionBar (mission) {
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
        return this;
    }

    self.showMission = showMission;
    self.showMissionCompleteWindow = showMissionCompleteWindow;
    self.update = update;

    _init();
    return self;
}
