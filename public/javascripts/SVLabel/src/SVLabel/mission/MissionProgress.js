/**
 * MissionProgress module.
 * Todo. Rename this... Probably some of these features should be moved to status/StatusFieldMission.js
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionProgress (svl, gameEffectModel, missionModel, modalModel, neighborhoodContainer, taskContainer) {
    var self = { className: 'MissionProgress' };
    var status = {
            currentCompletionRate: 0,
            currentMission: null,
            previousHeading: 0
        };

    var _gameEffectModel = gameEffectModel;
    var _missionModel = missionModel;
    var _modalModel = modalModel;


    _missionModel.on("MissionProgress:update", function (parameters) {
        var mission = parameters.mission,
            neighborhood = parameters.neighborhood;
        _update(mission, neighborhood);
    });

    /**
     * Finish the mission.
     * @param mission
     */
    function complete (mission) {
        mission.complete();
        _gameEffectModel.playAudio({audioType: "yay"});
        _gameEffectModel.playAudio({audioType: "applause"});

        // Update the neighborhood status
        if ("labelContainer" in svl) {
            var regionId = neighborhoodContainer.getCurrentNeighborhood().getProperty("regionId");
            var count = svl.labelContainer.countLabels(regionId);
            svl.statusFieldNeighborhood.setLabelCount(count);
        }

        _missionModel.completeMission(mission);
    }

    /**
     * @param mission Next mission
     * @param neighborhood Current neighborhood
     */
    function _showNextMission (mission, neighborhood) {
        var label = mission.getProperty("label");
        var parameters = { badgeURL: mission.getProperty("badgeURL") };

        if (label == "distance-mission") {
            parameters.distance = mission.getProperty("distance");
            _modalModel.trigger("ModalMission:setMission", { mission: mission, neighborhood: neighborhood, parameters: parameters, callback: null });  // Todo. I should not trigger it here. Call a function.
        } else if (label == "area-coverage-mission") {
            parameters.coverage = mission.getProperty("coverage");
            // modalMission.setMission(mission, neighborhood, parameters);
            _modalModel.trigger("ModalMission:setMission", { mission: mission, neighborhood: neighborhood, parameters: parameters, callback: null });

        } else {
            console.warn("Debug: It shouldn't reach here.");
        }
    }

    /**
     * This method updates the mission completion rate and its visualization.
     */
    function _update (currentMission, currentRegion) {
        if (svl.isOnboarding()) return;  // Don't show the mission completion message
        if ("missionContainer" in svl) {
            var completionRate;

            var _callback = function (e) {
                var currentRegionId = currentRegion.getProperty("regionId");
                var nextMission = svl.missionContainer.nextMission(currentRegionId);
                var movedToANewRegion = false;

                // Check if the next mission is null and, if so, get a mission from other neighborhood.
                // Note. Highly unlikely, but this could potentially be an infinate loop
                while (!nextMission) {
                    // If not more mission is available in the current neighborhood, get missions from the next neighborhood.
                    var availableRegionIds = svl.missionContainer.getAvailableRegionIds();
                    var newRegionId = neighborhoodContainer.getNextRegionId(currentRegionId, availableRegionIds);
                    nextMission = svl.missionContainer.nextMission(newRegionId);
                    movedToANewRegion = true;
                }

                svl.missionContainer.setCurrentMission(nextMission);
                _showNextMission(nextMission, currentRegion);

                if (movedToANewRegion) {
                    neighborhoodContainer.moveToANewRegion(newRegionId);
                    taskContainer.fetchTasksInARegion(newRegionId, function () {
                        // Jump to the new location.
                        var newTask = taskContainer.nextTask(task);
                        taskContainer.setCurrentTask(newTask);
                        svl.map.moveToTheTaskLocation(newTask);
                        
                    }, false);  // Fetch tasks in the new region
                }
            };

            // Update the mission completion rate in the progress bar
            if (currentMission) {
                completionRate = currentMission.getMissionCompletionRate();
                svl.statusFieldMission.printCompletionRate(completionRate);
                svl.statusFieldMission.updateMissionCompletionBar(completionRate);

                if (currentMission.getMissionCompletionRate() > 0.999) {
                    complete(currentMission);

                    _modalModel.trigger("ModalMissionComplete:update", { mission: currentMission, neighborhood: currentRegion });
                    _modalModel.trigger("ModalMissionComplete:show");
                    _modalModel.trigger("ModalMissionComplete:one", { uiComponent: 'closeButton', eventType: 'click', callback: _callback });
                }
            }
        }
    }

    self.update = _update;
    return self;
}
