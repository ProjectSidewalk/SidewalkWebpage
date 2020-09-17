/**
 * MissionProgress module.
 * Todo. Rename this... Probably some of these features should be moved to status/StatusFieldMission.js
 * Todo. Get rid of neighborhoodContainer and taskContainer dependencies. Instead, communicate with them through neighborhoodModel and taskModel.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionProgress (svl, gameEffectModel, missionModel, modalModel, neighborhoodModel, statusModel,
                          missionContainer, neighborhoodContainer, taskContainer, tracker) {
    var self = this;
    var _gameEffectModel = gameEffectModel;
    var _missionModel = missionModel;
    var _modalModel = modalModel;
    var _neighborhoodModel = neighborhoodModel;

    _missionModel.on("MissionProgress:update", function (parameters) {
        var mission = parameters.mission;
        var neighborhood = parameters.neighborhood;
        // We track mission progress separately for CV ground truth missions.
        if (!svl.isCVGroundTruthAudit) {
            self.update(mission, neighborhood);
        }
    });

    _neighborhoodModel.on("Neighborhood:completed", function (parameters) {
        // When the user has complete auditing all the streets in the neighborhood,
        // show the 100% coverage mission completion message.

        var mission = missionContainer.getCurrentMission();
        var neighborhood = neighborhoodContainer.getCurrentNeighborhood();

        self._completeTheCurrentMission(mission, neighborhood);
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
                regionId: neighborhood.getProperty("regionId")
            }
        );
        mission.complete();

        // TODO Audio should listen to MissionProgress instead of MissionProgress telling what to do.
        _gameEffectModel.loadAudio({audioType: "success"});
        _gameEffectModel.playAudio({audioType: "success"});

        // Update the neighborhood status
        if ("labelContainer" in svl) {
            var regionId = neighborhood.getProperty("regionId");
            var count = svl.labelContainer.countLabels(regionId);
            svl.statusFieldNeighborhood.setLabelCount(count);
        }

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

            _modalModel.updateModalMissionComplete(mission, neighborhood);
            _modalModel.showModalMissionComplete();
        }
    };

    /**
     * This method updates the mission completion rate and its visualization.
     */
    this.update = function (currentMission, currentRegion) {
        if (svl.isOnboarding()) return;
        var completionRate = currentMission.getMissionCompletionRate();
        statusModel.setMissionCompletionRate(completionRate);
        statusModel.setProgressBar(completionRate);
        this._checkMissionComplete(currentMission, currentRegion);

        // Survey prompt. Modal should display survey if
        // 1. User has completed numMissionsBeforeSurvey number of missions
        // 2. The user has just completed more than 30% of the current mission
        // 3. The user has not been shown the survey before
        if (completionRate > 0.3 && completionRate < 0.9) {
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
