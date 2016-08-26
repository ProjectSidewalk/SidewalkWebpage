/**
 * MissionProgress module.
 * Todo. Rename this... Probably some of these features should be moved to status/StatusFieldMission.js
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionProgress (svl, gameEffectModel, missionModel, modalModel, neighborhoodModel, statusModel, missionContainer, neighborhoodContainer, taskContainer) {
    var self = this;

    var _gameEffectModel = gameEffectModel;
    var _missionModel = missionModel;
    var _modalModel = modalModel;


    _missionModel.on("MissionProgress:update", function (parameters) {
        var mission = parameters.mission,
            neighborhood = parameters.neighborhood;
        self.update(mission, neighborhood);
    });

    /**
     * Finish the mission.
     * @param mission
     */
    this._completeTheCurrentMission = function (mission, neighborhood) {
        mission.complete();
        _gameEffectModel.playAudio({audioType: "yay"});
        _gameEffectModel.playAudio({audioType: "applause"});

        // Update the neighborhood status
        if ("labelContainer" in svl) {
            var regionId = neighborhood.getProperty("regionId");
            var count = svl.labelContainer.countLabels(regionId);
            svl.statusFieldNeighborhood.setLabelCount(count);
        }

        _missionModel.completeMission(mission);
    };

    this._checkMissionComplete = function (mission, neighborhood) {
        if (mission.getMissionCompletionRate() > 0.999) {
            this._completeTheCurrentMission(mission, neighborhood);
            this._updateTheCurrentMission(mission, neighborhood);

            _modalModel.updateModalMissionComplete(mission, neighborhood);
            _modalModel.showModalMissionComplete();
        }
    };

    this._updateTheCurrentMission = function (currentMission, currentNeighborhood) {
        var currentNeighborhoodId = currentNeighborhood.getProperty("regionId");
        var nextMission = missionContainer.nextMission(currentNeighborhoodId);

        if (nextMission == null) throw new Error("No missions available");

        missionContainer.setCurrentMission(nextMission);
        var nextMissionNeighborhood = neighborhoodContainer.get(nextMission.getProperty("regionId"));

        // If the current neighborhood is different from the next neighborhood
        if (currentNeighborhood.getProperty("regionId") != nextMissionNeighborhood.getProperty("regionId")) {
            this._updateTheCurrentNeighborhood(nextMissionNeighborhood);
        }

        // Adjust the target distance based on the tasks available
        var incompleteTaskDistance = taskContainer.getIncompleteTaskDistance(currentNeighborhoodId);
        nextMission.adjustTheTargetDistance(incompleteTaskDistance);
    };

    /**
     * Toco. This method should be moved to NeighborhoodContainer.
     * @param neighborhood
     * @private
     */
    this._updateTheCurrentNeighborhood = function (neighborhood) {
        var neighborhoodId = neighborhood.getProperty("regionId");
        neighborhoodContainer.setCurrentNeighborhood(neighborhood);
        neighborhoodModel.moveToANewRegion(neighborhoodId);

        taskContainer.fetchTasksInARegion(neighborhoodId, function () {
            // Jump to the new location.
            var newTask = taskContainer.nextTask();
            taskContainer.setCurrentTask(newTask);
            svl.map.moveToTheTaskLocation(newTask);
        }, false);  // Fetch tasks in the new region
    };


    /**
     * This method updates the mission completion rate and its visualization.
     */
    this.update = function (currentMission, currentRegion) {
        if (svl.isOnboarding()) return;
        var completionRate = currentMission.getMissionCompletionRate();
        statusModel.setMissionCompletionRate(completionRate);
        statusModel.setProgressBar(completionRate);
        // svl.statusFieldMission.printCompletionRate(completionRate);
        // svl.statusFieldMission.updateMissionCompletionBar(completionRate);
        this._checkMissionComplete(currentMission, currentRegion);
    };
}
