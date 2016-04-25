/**
 * MissionProgress module.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionProgress () {
    var self = { className: 'MissionProgress' };
    var status = {
            currentCompletionRate: 0,
            currentMission: null,
            previousHeading: 0
        };

    function _init() {
        // Fill in the surveyed angles
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
                            svl.missionContainer.setCurrentMission(nextMission);
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
            console.warn("It shouldn't reach here.");
        }
    }

    /**
     * This method updates the mission completion rate and its visualization.
     */
    function update () {
        if ("onboarding" in svl && svl.onboarding.isOnboarding()) return;  // Don't show the mission completion message
        if ("missionContainer" in svl && "neighborhoodContainer" in svl) {
            var i,
                len,
                missions,
                currentRegion = svl.neighborhoodContainer.getCurrentNeighborhood(),
                currentMission = svl.missionContainer.getCurrentMission(),
                completionRate;

            // Update the mission completion rate in the progress bar
            if (currentMission) {
                var missionsInCurrentRegion = svl.missionContainer.getMissionsByRegionId(currentRegion.getProperty("regionId"));


                completionRate = currentMission.getMissionCompletionRate();
                printCompletionRate(completionRate);
                updateMissionCompletionBar(completionRate);
            }

            // Check if missions are completed.
            if (currentRegion) {
                var completedMissions = [],
                    regionId = currentRegion.getProperty("regionId"),
                    missionComplete = false;
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
                    if (completionRate >= 0.999) {
                        complete(missions[i]);
                        completedMissions.push(missions[i]);
                        missionComplete = true;
                    }
                }
                // Submit the staged missions
                svl.missionContainer.commit();

                // Present the mission completion messages.
                if (completedMissions.length > 0) {
                    showMissionCompleteWindow(completedMissions);
                }

                if (missionComplete && "audioEffect" in svl) {
                    svl.audioEffect.play("yay");
                    svl.audioEffect.play("applause");
                }
            }
        }
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
        printCompletionRate(completionRate);
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

    self.showNextMission = showNextMission;
    self.showMissionCompleteWindow = showMissionCompleteWindow;
    self.update = update;
    self.updateMissionCompletionBar = updateMissionCompletionBar;

    _init();
    return self;
}
