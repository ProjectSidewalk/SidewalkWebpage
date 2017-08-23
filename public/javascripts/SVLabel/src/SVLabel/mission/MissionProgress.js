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

        self._updateTheCurrentMission(mission, neighborhood);

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

        // Added a route completion trigger here
        // When route length is much greater than mission length then
        // it becomes necessary to trigger route completion event at the end of a mission.
        // In the previous implementation route lengths were usually close to or slightly lower than mission distance
        // which is why route completion was triggered when there was a null nextTask as in MapService.js

        var currentRoute = svl.routeContainer.getCurrentRoute();
        _routeModel.routeCompleted(currentRoute.getProperty("routeId"), mission, neighborhood);

        //if(mission.getProperty("label") != "mturk-mission") {
            // Update the route within this
            //this._updateTheCurrentMission(mission, neighborhood);
        //}

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
        // Refresh mission completion here.
        currentMission.setProperty("isCompleted", true);

        var nextMission = missionContainer.nextMission(currentNeighborhoodId);

        //Added code here to bring up the submit HIT button and post to the turkSubmit link
        // Or just trigger an event here such that the form submission (POST request to turkSubmit) happens on this event
        if (nextMission == null) {
            _modalModel.updateModalMissionComplete(currentMission, currentNeighborhood);
            _modalModel.showModalMissionComplete();
            _modalModel.showModalMissionCompleteHITSubmission();
            console.error("No missions available");
            return;
        }
        else {
            _modalModel.hideModalMissionCompleteHITSubmission();
        }

        var nextRouteId = nextMission.getProperty("routeId");

        // Update route here (may need to add route to taskContainer as well) and post to the audit/amtAssignment end point

        var route; //Get route from next mission
        var route_json = $.ajax("/route/"+nextRouteId);
        route = svl.routeFactory.create(nextRouteId, route_json["region_id"],
                                        route_json["route_length_mi"], route_json["street_count"]);
        svl.routeContainer.add(route);
        svl.routeContainer.setCurrentRoute(route);
        var url = "/audit/amtAssignment ";

        // Fetch tasks for the route
        taskContainer.fetchTasksOnARoute(nextRouteId, function () {
            // Replace current task with the first task from the next route
            var newStreetEdgeId = Object.keys(taskContainer._taskStoreByRouteId[nextRouteId]).filter(function start(el){return taskContainer._taskStoreByRouteId[nextRouteId][el]['isStartEdge'];})[0];
            var newTask = taskContainer._taskStoreByRouteId[nextRouteId][newStreetEdgeId].task;
            var currentStreetEdgeId = taskContainer.getCurrentTask().getStreetEdgeId();
            if(currentStreetEdgeId != newStreetEdgeId){
                // Jump if the first street edge in the next route is not the same as the last street edge on the completed route.
                svl.map.moveToTheTaskLocation(newTask);
                taskContainer.setCurrentTask(newTask);
            }
        });

        missionContainer.setCurrentMission(nextMission);

        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify({
                "assignment_id": svl.assignmentId,
                "hit_id": svl.hitId,
                "turker_id": svl.turkerId,
                "route_id": nextMission.getProperty("routeId")
            }),
            dataType: 'json',
            success: function (result) {
                svl.amtAssignmentId = result["asg_id"];
            },
            error: function (result) {
                console.error(result);
            }
        });

        /* Not required for mturk code. MAybe we need a flag here instead
        var nextMissionNeighborhood = neighborhoodContainer.get(nextMission.getProperty("regionId"));

        // If the current neighborhood is different from the next neighborhood
        if (currentNeighborhood.getProperty("regionId") != nextMissionNeighborhood.getProperty("regionId")) {
            this._updateTheCurrentNeighborhood(nextMissionNeighborhood);
        }

        // Adjust the target distance based on the tasks available
        var incompleteTaskDistance = taskContainer.getIncompleteTaskDistance(currentNeighborhoodId);
        nextMission.adjustTheTargetDistance(incompleteTaskDistance);*/
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
