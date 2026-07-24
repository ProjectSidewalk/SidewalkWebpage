/**
 * Coordinates what happens as the user makes progress on a mission: refreshes the sidebar stats and progress bar,
 * detects when a mission (or the whole route/neighborhood) is complete, and triggers the mission-complete modal. This
 * is the mission controller; visuals handled in sidebar/MissionPanel.js and the shared common/ProgressBar.js.
 */
class MissionController {
  // 0.9 not 1.0: some panos can't rotate a full 360 (the sparse-imagery inverse trap in #4640), so requiring an
  // exact full sweep could make a route impossible to auto-finish. The manual compass-click fallback covers the rest.
  static #ROUTE_FINISH_OBSERVED_THRESHOLD = 0.9;

  #missionModel;
  #neighborhoodModel;
  #missionContainer;
  #tracker;
  #routeAutoCompleteFired = false;

  constructor(missionModel, neighborhoodModel, missionContainer, tracker) {
    this.#missionModel = missionModel;
    this.#neighborhoodModel = neighborhoodModel;
    this.#missionContainer = missionContainer;
    this.#tracker = tracker;

    missionModel.on('MissionProgress:update', (parameters) => {
      this.update(parameters.mission, parameters.neighborhood);
    });
  }

  /**
   * Wraps up the current route or neighborhood once the user has finished every street and confirmed they're done
   * auditing their last intersection: ends the current task and shows the mission-complete modal.
   */
  wrapUpRouteOrNeighborhood() {
    // Free-exploration sessions (#4451) have no route/neighborhood goal to wrap up.
    if (svl.isExploreAddressMode()) return;

    const mission = this.#missionContainer.getCurrentMission();
    const neighborhood = this.#neighborhoodModel.currentNeighborhood();

    // A route-scoped mission completes with the route. This must happen before endTask: endTask's submission
    // carries the mission's completed flag, which is what marks the mission complete server-side.
    if (svl.neighborhoodModel.isRoute && !mission.isComplete()) {
      this.#completeTheCurrentMission(mission, neighborhood);
    }

    const currentTask = svl.taskContainer.getCurrentTask();
    svl.taskContainer.endTask(currentTask);

    svl.modalMissionComplete.update(mission, neighborhood);
    svl.modalMissionComplete.show();
  }

  /**
   * Called when a route reaches its end. Shows the salient finish toast and arms the 360°-gated auto-complete so the
   * celebration fires once the user has looked around the final location — no manual click required.
   */
  onRouteReadyToFinish() {
    svl.alertController.showAlert(i18next.t('center-ui.compass.route-finish-look-around'), 'routeFinish', false);
    this.#tracker.push('RouteFinishToast_Shown', { userRouteId: svl.userRouteId });
    // Fire immediately if they already looked all the way around at this pano before reaching the end.
    this.maybeAutoCompleteRoute();
  }

  /**
   * On each POV change, auto-fire route completion once the final pano is ~fully observed. No-op until the route is
   * flagged complete (its last reachable pano reached) and until the 360° observed fraction clears the threshold.
   */
  maybeAutoCompleteRoute() {
    if (this.#routeAutoCompleteFired || !svl.neighborhoodModel.isRouteComplete) return;
    // If the manual compass-click fallback already finished the route, don't fire wrapUp a second time.
    const mission = this.#missionContainer.getCurrentMission();
    if (mission && mission.isComplete()) return;
    if (svl.observedArea.getFractionObserved() >= MissionController.#ROUTE_FINISH_OBSERVED_THRESHOLD) {
      this.#routeAutoCompleteFired = true;
      this.#tracker.push('RouteAutoComplete_Fired',
        { userRouteId: svl.userRouteId, fractionObserved: svl.observedArea.getFractionObserved() });
      // Drop the manual-click fallback so the compass message can't also fire wrapUp.
      svl.compass.removeLabelBeforeJumpMessage();
      this.wrapUpRouteOrNeighborhood();
    }
  }

  /**
   * Marks the given mission as complete: logs it, updates the model, and bumps the session's completed-mission count.
   * @param mission The mission being completed.
   * @param neighborhood The neighborhood the mission was in.
   */
  #completeTheCurrentMission(mission, neighborhood) {
    this.#tracker.push(
      'MissionComplete',
      {
        missionId: mission.getProperty('missionId'),
        missionType: mission.getProperty('missionType'),
        distanceMeters: Math.round(mission.getDistance('meters')),
        regionId: neighborhood.getRegionId(),
      },
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
    // On a route the mission IS the route walk (one route-scoped mission, sized to the route server-side), so its
    // completion is finishing the route — handled in wrapUpRouteOrNeighborhood, not by this distance check. The
    // check would also misfire here: the server measures the route in EPSG:26918 while the client's progress is
    // turf/WGS84, so the two cross the 99.9% threshold at slightly different points.
    if (svl.neighborhoodModel.isRoute) return;

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

    // Update the neighborhood progress bar (this user's vs. the community's share of the neighborhood).
    svl.neighborhoodProgressBar.update();

    // Free-exploration missions (#4451) have no distance target: the completion rate would compute as
    // distanceProgress / null → 1, immediately triggering the mission-complete modal. No progress bar, no survey.
    if (svl.isExploreAddressMode()) return;

    // Update mission completion rate in the right sidebar and the minimap's mission-progress bar. On a route, the
    // Current Mission section describes the whole route (the server-side mission slices are invisible there), so its
    // bar tracks route progress.
    let completionRate;
    if (this.#neighborhoodModel.isRoute) {
      const unit = { units: i18next.t('common:unit-distance') };
      const routeDistance = svl.taskContainer.totalLineDistanceInNeighborhood(unit);
      completionRate = routeDistance ? Math.min(1, distance / routeDistance) : 0;
    } else {
      completionRate = currentMission.getMissionCompletionRate();
    }
    svl.missionProgressBar.update(completionRate);
    if (svl.minimap) svl.minimap.updateMissionProgress(currentMission);
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
        success(data) {
          if (data.displayModal) {
            $('#survey-modal-container').modal({
              backdrop: 'static',
              keyboard: false,
            });

            // Log in the webpage activity table if the survey has been shown.
            window.logWebpageActivity('SurveyShown', true);
          }
        },
        error(xhr, ajaxOptions, thrownError) {
          console.log(thrownError);
        },
      });
    }
  }
}
