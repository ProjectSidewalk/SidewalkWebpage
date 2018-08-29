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
        self.update(mission, neighborhood);
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


    /**
     * Finish the mission.
     * @param mission
     */
    this._completeTheCurrentMission = function (mission, neighborhood) {
        tracker.push(
            "MissionComplete",
            {
                missionId: mission.getProperty("missionId"),
                missionType: mission.getProperty("missionType"),
                distanceMeters: Math.round(mission.getProperty("distance")),
                regionId: neighborhood.getProperty("regionId")
            }
        );
        mission.complete();

        // Survey prompt. Modal should display survey if
        // 1. User is a Turker (/survey/display endpoint returns true if this is the case).
        // 2. User has just completed numMissionsBeforeSurvey number of missions.

        var url = '/survey/display';
        var numMissionsBeforeSurvey = 2;
        var numMissionsCompleted = svl.missionContainer.getCompletedMissions().length;
        $.ajax({
            async: true,
            url: url,//endpoint that checks above conditions
            type: 'get',
            success: function(data){
                if(data.displayModal && numMissionsCompleted == numMissionsBeforeSurvey){
                    $('#survey-modal-container').modal({
                        backdrop: 'static',
                        keyboard: false
                    });
                    //console.log('Survey displayed');
                }
            },
            error: function (xhr, ajaxOptions, thrownError) {
                console.log(thrownError);
            }
        });


        //this is placeholder; replace with above commented code once endpoint is implemented
        /*var mTurk = true;
        if(mTurk) {
            $('#survey-modal-container').modal({
                backdrop: 'static',
                keyboard: false
            });
        }*/

        // TODO Audio should listen to MissionProgress instead of MissionProgress telling what to do.
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

            this._updateTheCurrentMission(mission, neighborhood); // TODO this could go after showModalMissionComplete maybe?

            // While the mission complete modal is open, after the **neighborhood** is 100% audited,
            // the user is jumped to the next neighborhood, that causes the modalmodel to be updated
            // and it changes the modal's neighborhood information while it is open.
            if (svl.modalMissionComplete.isOpen())
                return;

            _modalModel.updateModalMissionComplete(mission, neighborhood);
            _modalModel.showModalMissionComplete();
        }
    };

    this._updateTheCurrentMission = function (currentMission, currentNeighborhood) {
        // missionContainer.nextMission();
        // var nextMission = missionContainer.getCurrentMission();
        //
        // if (nextMission == null) throw new Error("No missions available");

        // missionContainer.setCurrentMission(nextMission);
        // var nextMissionNeighborhood = neighborhoodContainer.get(nextMission.getProperty("regionId"));

        // If the current neighborhood is different from the next neighborhood
        // TODO I removed (commented) code, but it included "taskContainer.endTask(taskContainer.getCurrentTask());, we might need it!
        // if (currentNeighborhood.getProperty("regionId") != nextMissionNeighborhood.getProperty("regionId")) {
        //     this._updateTheCurrentNeighborhood(nextMissionNeighborhood);
        // }

        // TODO probably add back in this check later, after the mission is actually received from back-end
        // Adjust the target distance based on the tasks available
        // var incompleteTaskDistance = taskContainer.getIncompleteTaskDistance();
        // nextMission.adjustTheTargetDistance(incompleteTaskDistance); // I deleted this func cause it modifies a mission's distance! We will ensure this is ok on the back-end
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
