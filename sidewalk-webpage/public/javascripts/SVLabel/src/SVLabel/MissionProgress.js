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
     * Show a window saying the mission(s) is completed.
     * @param missions Completed missions
     */
    function showMissionCompleteWindow (missions) {
        if (missions) {
            var _callback, mission = missions.shift();

            if (missions.length > 0) {
                _callback = function () {
                    showMissionCompleteWindow(missions);
                };
                svl.modalMission.setMissionComplete(mission, { callback: _callback });
            } else {
                _callback = function () {
                    if ("missionContainer" in svl) {
                        var currentRegion = svl.neighborhoodContainer.getCurrentNeighborhood();
                        if (currentRegion) {
                            var nextMission = svl.missionContainer.nextMission(currentRegion.getProperty("regionId"));
                            showNextMission(nextMission);
                        }
                    }
                };
                svl.modalMission.setMissionComplete(mission, { callback: _callback });
            }
        }
    }

    /**
     * @param mission Next mission
     */
    function showNextMission (mission) {
        var label = mission.getProperty("label");
        if (label == "distance-mission") {
            svl.modalMission.setMission(mission, { distance: mission.getProperty("distance"), badgeURL: mission.getProperty("badgeURL") });
        } else if (label == "area-coverage-mission") {
            svl.modalMission.setMission(mission, { coverage: mission.getProperty("coverage"), badgeURL: mission.getProperty("badgeURL") });
        } else {
            console.error("It shouldn't reach here.");
        }
    }

    /**
     * This method updates the mission completion rate and its visualization.
     */
    function update () {
        if ("missionContainer" in svl) {
            var i, len, missions,
                currentRegion = svl.neighborhoodContainer.getCurrentNeighborhood(),
                currentMission = svl.missionContainer.getCurrentMission(),
                completionRate;
            printCompletionRate(currentMission);
            updateMissionCompletionBar(currentMission);

            if (currentRegion) {
                // Update mission completion rate.
                var completedMissions = [],
                    regionId = currentRegion.getProperty("regionId");
                missions = svl.missionContainer.getMissionsByRegionId("noRegionId");
                missions = missions.concat(svl.missionContainer.getMissionsByRegionId(regionId));
                missions = missions.filter(function (m) { return !m.isCompleted(); });
                missions.sort(function (a, b) {
                    var distA = a.getProperty("distance"), distB = b.getProperty("distance");
                    if (distA < distB) return -1;
                    else if (distA > distB) return 1;
                    else return 0;
                });

                len = missions.length;
                for (i = 0; i < len; i++) {
                    completionRate = missions[i].getMissionCompletionRate();
                    if (completionRate >= 1.0) {
                    // if (completionRate >= 1.0 || missions[i].getProperty("label") == "initial-mission") {  // debug
                        complete(missions[i]);
                        completedMissions.push(missions[i]);
                    }
                }
                // Submit the staged missions
                svl.missionContainer.commit();

                // Present the mission completion messages.
                if (completedMissions.length > 0) {
                    showMissionCompleteWindow(completedMissions);
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

    self.showNextMission = showNextMission;
    self.showMissionCompleteWindow = showMissionCompleteWindow;
    self.update = update;

    _init();
    return self;
}
