/**
 * MissionProgress module.
 * Todo. Rename this... Probably some of these features should be moved to status/StatusFieldMission.js
 * Todo. Get rid of neighborhoodContainer and taskContainer dependencies. Instead, communicate with them through neighborhoodModel and taskModel.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionProgress (svl, gameEffectModel, missionModel, modalModel, neighborhoodModel, routeModel, statusModel,
                          missionContainer, neighborhoodContainer, taskContainer, tracker) {
    var self = this;
    var _gameEffectModel = gameEffectModel;
    var _missionModel = missionModel;
    var _modalModel = modalModel;
    var _neighborhoodModel = neighborhoodModel;
    var _routeModel = routeModel;

    _missionModel.on("MissionProgress:update", function (parameters) {
        var mission = parameters.mission;
        var neighborhood = parameters.neighborhood;
        self.update(mission, neighborhood);
    });

    _routeModel.on("Route:completed", function (parameters) {

        var mission = parameters.mission, neighborhood = parameters.neighborhood;
        var completionRate = mission.getMissionCompletionRate();
        if (completionRate < 0.99) {
            completionRate = 1.0;
        }

        statusModel.setMissionCompletionRate(completionRate);
        statusModel.setProgressBar(completionRate);
        //self.finishMission(mission, neighborhood);

        self._completeTheCurrentMission(mission, neighborhood);
        self._completeMissionsWithSatisfiedCriteria(neighborhood);

        //self._updateTheCurrentMission(mission, neighborhood);

        // While the mission complete modal is open, after the **neighborhood** is 100% audited,
        // the user is jumped to the next neighborhood, that causes the modalmodel to be updated
        // and it changes the modal's neighborhood information while it is open.
        if (svl.modalMissionComplete.isOpen())
            return;

        _modalModel.updateModalMissionComplete(mission, neighborhood);
        _modalModel.showModalMissionComplete();
    });

    _neighborhoodModel.on("Neighborhood:completed", function (parameters) {
        // When the user has complete auditing all the streets in the neighborhood,
        // show the 100% coverage mission completion message.

        var mission = missionContainer.getNeighborhoodCompleteMission(parameters.completedRegionId);
        var neighborhood = neighborhoodModel.getNeighborhood(parameters.completedRegionId);

        self._completeTheCurrentMission(mission, neighborhood);
        _modalModel.updateModalMissionComplete(mission, neighborhood);
        _modalModel.showModalMissionComplete();
    });

    this._checkMissionComplete = function (mission, neighborhood) {
        if (mission.getMissionCompletionRate() > 0.999) {
            this.finishMission(mission, neighborhood);
        }
    };

    this.finishMission = function (mission, neighborhood) {
        this._completeTheCurrentMission(mission, neighborhood);
        this._completeMissionsWithSatisfiedCriteria(neighborhood);

        console.log(this);
        console.log('Reached finishMission');
        // Added a route completion trigger here
        // When route length is much greater than mission length then
        // it becomes necessary to trigger route completion event at the end of a mission rather than
        // waiting for a null nextTask as in MapService.js
        var currentRoute = svl.routeContainer.getCurrentRoute();
        _routeModel.routeCompleted(currentRoute.getProperty("routeId"), mission, neighborhood);

        if(mission.getProperty("label") != "mturk-mission") {
            this._updateTheCurrentMission(mission, neighborhood);
        }

        // While the mission complete modal is open, after the **neighborhood** is 100% audited,
        // the user is jumped to the next neighborhood, that causes the modalmodel to be updated
        // and it changes the modal's neighborhood information while it is open.
        if (svl.modalMissionComplete.isOpen())
            return;

        _modalModel.updateModalMissionComplete(mission, neighborhood);
        _modalModel.showModalMissionComplete();
    };

    /**
     * Finish the mission.
     * @param mission
     */
    this._completeTheCurrentMission = function (mission, neighborhood) {
        tracker.push(
            "MissionComplete",
            {
                missionId: mission.getProperty("missionId"),
                missionLabel: mission.getProperty("label"),
                missionDistance: mission.getProperty("distance"),
                neighborhoodId: neighborhood.getProperty("regionId")
            }
        );
        mission.complete();

        // Todo. Audio should listen to MissionProgress instead of MissionProgress telling what to do.
        _gameEffectModel.playAudio({audioType: "yay"});
        _gameEffectModel.playAudio({audioType: "applause"});

        // Update the neighborhood status
        if ("labelContainer" in svl) {
            var regionId = neighborhood.getProperty("regionId");
            var count = svl.labelContainer.countLabels(regionId);
            svl.statusFieldNeighborhood.setLabelCount(count);
        }

        _missionModel.completeMission(mission, neighborhood);
    };

    this._completeMissionsWithSatisfiedCriteria = function (neighborhood) {
        var regionId = neighborhood.getProperty("regionId");
        var missions = missionContainer.getIncompleteMissionsByRegionId(regionId);

        for (var i = 0, len = missions.length; i < len; i++) {
            if (missions[i].getMissionCompletionRate() > 0.999) {
                missions[i].complete();
                _missionModel.completeMission(missions[i]);
            }
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
     * Todo. This method should be moved to other place. Maybe NeighborhoodModel...
     * @param neighborhood
     * @private
     */
    this._updateTheCurrentNeighborhood = function (neighborhood) {
        var neighborhoodId = neighborhood.getProperty("regionId");
        neighborhoodContainer.setCurrentNeighborhood(neighborhood);
        neighborhoodModel.moveToANewRegion(neighborhoodId);

        var currentTask = taskContainer.getCurrentTask();
        taskContainer.endTask(currentTask);

        taskContainer.fetchTasksInARegion(neighborhoodId, function () {
            // Jump to the new location.
            var newTask = taskContainer.nextTask();
            if (!newTask) throw "You have audited all the streets in this neighborhood.";
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
