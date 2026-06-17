/**
 * Coordinates what happens as the user makes progress on a mission: refreshes the sidebar stats and progress bar,
 * detects when a mission (or the whole route/neighborhood) is complete, and triggers the mission-complete modal. This
 * is the mission controller; visuals handled in sidebar/MissionPanel.js and sidebar/MissionProgressBar.js.
 */
class MissionController {
    #missionModel;
    #neighborhoodModel;
    #missionContainer;
    #tracker;

    constructor(missionModel, neighborhoodModel, missionContainer, tracker) {
        this.#missionModel = missionModel;
        this.#neighborhoodModel = neighborhoodModel;
        this.#missionContainer = missionContainer;
        this.#tracker = tracker;

        missionModel.on("MissionProgress:update", (parameters) => {
            this.update(parameters.mission, parameters.neighborhood);
        });
    }

    /**
     * Wraps up the current route or neighborhood once the user has finished every street and confirmed they're done
     * auditing their last intersection: ends the current task and shows the mission-complete modal.
     */
    wrapUpRouteOrNeighborhood() {
        const currentTask = svl.taskContainer.getCurrentTask();
        svl.taskContainer.endTask(currentTask);

        const mission = this.#missionContainer.getCurrentMission();
        const neighborhood = this.#neighborhoodModel.currentNeighborhood();

        svl.modalMissionComplete.update(mission, neighborhood);
        svl.modalMissionComplete.show();
    }

    /**
     * Marks the given mission as complete: logs it, updates the model, and bumps the session's completed-mission count.
     * @param mission The mission being completed.
     * @param neighborhood The neighborhood the mission was in.
     */
    #completeTheCurrentMission(mission, neighborhood) {
        this.#tracker.push(
            "MissionComplete",
            {
                missionId: mission.getProperty("missionId"),
                missionType: mission.getProperty("missionType"),
                distanceMeters: Math.round(mission.getDistance("meters")),
                regionId: neighborhood.getRegionId()
            }
        );
        mission.complete();
        this.#missionModel.completeMission(mission);
        svl.missionsCompleted += 1;
    }

    /**
     * Completes the mission and shows the mission-complete modal if the mission is finished.
     * @param mission The current mission.
     * @param neighborhood The current neighborhood.
     */
    #checkMissionComplete(mission, neighborhood) {
        if (mission.getMissionCompletionRate() > 0.999) {
            this.#completeTheCurrentMission(mission, neighborhood);

            // While the mission complete modal is open, after the **neighborhood** is 100% audited, the user is jumped
            // to the next neighborhood, which updates the modal's neighborhood information while it is still open.
            if (svl.modalMissionComplete.isOpen()) return;

            // Show the mission complete screen unless we're at the end of a route/neighborhood.
            if (!svl.neighborhoodModel.isRouteOrNeighborhoodComplete()) {
                svl.modalMissionComplete.update(mission, neighborhood);
                svl.modalMissionComplete.show();
            }
        }
    }

    /**
     * Updates the audited distance and mission completion rate in the right sidebar, checks for mission completion, and
     * occasionally prompts the user with the survey.
     * @param currentMission The current mission.
     * @param currentRegion The current neighborhood.
     */
    update(currentMission, currentRegion) {
        if (svl.isOnboarding()) return;

        // Update the global audited distance in the right sidebar.
        const distance = svl.taskContainer.getCompletedTaskDistance();
        svl.overallStats.setNeighborhoodAuditedDistance(distance);

        // Update mission completion rate in the right sidebar.
        const completionRate = currentMission.getMissionCompletionRate();
        svl.missionProgressBar.setCompletionRate(completionRate);
        svl.missionProgressBar.setBar(completionRate);
        if (!this.#neighborhoodModel.isRouteComplete && !this.#neighborhoodModel.isNeighborhoodComplete) {
            this.#checkMissionComplete(currentMission, currentRegion);
        }

        // Show the survey modal if the user has just completed more than 60% (but less than 90%) of the current
        // mission. The server decides whether the survey should actually be shown (e.g. not shown twice).
        if (completionRate > 0.6 && completionRate < 0.9) {
            $.ajax({
                async: true,
                url: '/survey/display',
                method: 'GET',
                success: function (data) {
                    if (data.displayModal) {
                        $('#survey-modal-container').modal({
                            backdrop: 'static',
                            keyboard: false
                        });

                        // Log in the webpage activity table if the survey has been shown.
                        window.logWebpageActivity("SurveyShown", true);
                    }
                },
                error: function (xhr, ajaxOptions, thrownError) {
                    console.log(thrownError);
                }
            });
        }
    }
}
