/**
 * MissionProgress module.
 * Todo. Rename this... Probably some of these features should be moved to status/StatusFieldMission.js
 * Todo. Get rid of neighborhoodContainer dependency. Instead, communicate with them through neighborhoodModel and taskModel.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionProgress(svl, missionModel, modalModel, neighborhoodModel, statusModel, missionContainer,
                         neighborhoodContainer, tracker) {
    var self = this;
    var _missionModel = missionModel;
    var _modalModel = modalModel;
    var _neighborhoodModel = neighborhoodModel;

    _missionModel.on("MissionProgress:update", function (parameters) {
        var mission = parameters.mission;
        var neighborhood = parameters.neighborhood;
        self.update(mission, neighborhood);
    });

    _neighborhoodModel.on("Neighborhood:wrapUpRouteOrNeighborhood", function () {
        // When the user has finished every street in their route or neighborhood and have confirmed that they've
        // finished auditing their last intersection, mark task/mission as complete and show the mission complete modal.
        var currentTask = svl.taskContainer.getCurrentTask();
        svl.taskContainer.endTask(currentTask);

        var mission = missionContainer.getCurrentMission();
        var neighborhood = neighborhoodContainer.getCurrentNeighborhood();

        _modalModel.updateModalMissionComplete(mission, neighborhood);
        _modalModel.showModalMissionComplete();
    });


    /**
     * Finish the mission.
     * @param mission
     * @param neighborhood
     */
    this._completeTheCurrentMission = function (mission, neighborhood) {
        tracker.push(
            "MissionComplete",
            {
                missionId: mission.getProperty("missionId"),
                missionType: mission.getProperty("missionType"),
                distanceMeters: Math.round(mission.getDistance("meters")),
                regionId: neighborhood.getRegionId()
            }
        );
        mission.complete();


        _missionModel.completeMission(mission);

        svl.missionsCompleted += 1;
    };

    this._checkMissionComplete = function (mission, neighborhood) {
        if (mission.getMissionCompletionRate() > 0.999) {
            this._completeTheCurrentMission(mission, neighborhood);

            // While the mission complete modal is open, after the **neighborhood** is 100% audited,
            // the user is jumped to the next neighborhood, that causes the modalmodel to be updated
            // and it changes the modal's neighborhood information while it is open.
            if (svl.modalMissionComplete.isOpen())
                return;

            // Show the mission complete screen unless we're at the end of a route/neighborhood.
            if (!svl.neighborhoodModel.isRouteOrNeighborhoodComplete()) {
                _modalModel.updateModalMissionComplete(mission, neighborhood);
                _modalModel.showModalMissionComplete();
            }
        }
    };

    /**
     * This method updates audited distance and mission completion rate in the right sidebar.
     */
    this.update = function (currentMission, currentRegion) {
        if (svl.isOnboarding()) return;

        // Update audited distance in both Overall and Neighborhood stats in right sidebar.
        var distance = svl.taskContainer.getCompletedTaskDistance();
        svl.statusFieldNeighborhood.setAuditedDistance(distance);
        svl.statusFieldOverall.setNeighborhoodAuditedDistance(distance);

        // Update mission completion rate in right sidebar.
        var completionRate = currentMission.getMissionCompletionRate();
        statusModel.setMissionCompletionRate(completionRate);
        statusModel.setProgressBar(completionRate);
        if (!_neighborhoodModel.isRouteComplete && !_neighborhoodModel.isNeighborhoodComplete) {
            this._checkMissionComplete(currentMission, currentRegion);
        }

        // Survey prompt. Modal should display survey if
        // 1. User has completed numMissionsBeforeSurvey number of missions
        // 2. The user has just completed more than 60% of the current mission
        // 3. The user has not been shown the survey before
        // 4. They are not on the crowdstudy server that has pre- and post-study questionnaires.
        if (completionRate > 0.6 && completionRate < 0.9) {
            $.ajax({
                async: true,
                url: '/survey/display',
                type: 'get',
                success: function (data) {
                    if (data.displayModal) {
                        $('#survey-modal-container').modal({
                            backdrop: 'static',
                            keyboard: false
                        });

                        //we will log in the webpage activity table if the survey has been shown
                        var activity = "SurveyShown";
                        var url = "/userapi/logWebpageActivity";
                        var async = true;
                        $.ajax({
                            async: async,
                            contentType: 'application/json; charset=utf-8',
                            url: url,
                            type: 'post',
                            data: JSON.stringify(activity),
                            dataType: 'json',
                            success: function (result) {
                            },
                            error: function (result) {
                                console.error(result);
                            }
                        });
                    }
                },
                error: function (xhr, ajaxOptions, thrownError) {
                    console.log(thrownError);
                }
            });
        }

    };
}
