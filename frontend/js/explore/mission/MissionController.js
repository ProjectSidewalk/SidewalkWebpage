/**
 * Coordinates what happens as the user makes progress on a mission: refreshes the sidebar stats and progress bar,
 * detects when a mission (or the whole route/region) is complete, and triggers the mission-complete modal. This
 * is the mission controller; visuals handled in sidebar/MissionPanel.js and the shared common/ProgressBar.js.
 */

import { util } from '../../common/utilities.js';
/** @typedef {import('../alert/AlertController.js').AlertController} AlertController */
/** @typedef {import('../navigation/Compass.js').Compass} Compass */
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('../data/Form.js').Form} Form */
/** @typedef {import('../navigation/MinimapMissionProgress.js').MinimapMissionProgress} MinimapMissionProgress */
/** @typedef {import('./Mission.js').Mission} Mission */
/** @typedef {import('./MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('./MissionModel.js').MissionModel} MissionModel */
/** @typedef {import('../modal/ModalMissionComplete.js').ModalMissionComplete} ModalMissionComplete */
/** @typedef {import('../modal/ModalSurvey.js').ModalSurvey} ModalSurvey */
/** @typedef {import('../navigation/NavigationService.js').NavigationService} NavigationService */
/** @typedef {import('../navigation/ObservedArea.js').ObservedArea} ObservedArea */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../sidebar/OverallStats.js').OverallStats} OverallStats */
/** @typedef {import('../../common/ProgressBar.js').ProgressBar} ProgressBar */
/** @typedef {import('../region/Region.js').Region} Region */
/** @typedef {import('../region/RegionModel.js').RegionModel} RegionModel */
/** @typedef {import('../sidebar/RegionProgressBar.js').RegionProgressBar} RegionProgressBar */
/** @typedef {import('../task/TaskContainer.js').TaskContainer} TaskContainer */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class MissionController {
  // 0.9 not 1.0: some panos can't rotate a full 360 (the sparse-imagery inverse trap in #4640), so requiring an
  // exact full sweep could make a route impossible to auto-finish. The manual compass-click fallback covers the rest.
  static #ROUTE_FINISH_OBSERVED_THRESHOLD = 0.9;

  #config;
  #missionModel;
  #regionModel;
  #missionContainer;
  #taskContainer;
  #form;
  #modalMissionComplete;
  #modalSurvey;
  #alertController;
  #compass;
  #observedArea;
  #overallStats;
  #regionProgressBar;
  #missionProgressBar;
  #minimapMissionProgress;
  #tracker;
  #routeAutoCompleteFired = false;

  /**
   * @param {ExploreConfig} config
   * @param {MissionModel} missionModel - Announces progress and completion.
   * @param {RegionModel} regionModel
   * @param {MissionContainer} missionContainer - Holds and measures the missions.
   * @param {TaskContainer} taskContainer - Whose streets are finished with a mission.
   * @param {Form} form - Submits a given-up street a route or region wraps up on.
   * @param {ModalMissionComplete} modalMissionComplete - Shown when a mission completes.
   * @param {ModalSurvey} modalSurvey - Shown partway through a mission, when the server says so.
   * @param {AlertController} alertController - Shows the route's finish toast.
   * @param {Compass} compass - Wraps the route or region up on its finish click, and drops the finish prompt once a
   *   route auto-completes on its own.
   * @param {NavigationService} navigationService - Announces the route's end and a region's last street.
   * @param {PanoManager} panoManager - Each turn of whose view may complete a finished route.
   * @param {ObservedArea} observedArea - Says how much of the final pano the user has looked around.
   * @param {OverallStats} overallStats - Shown the audited distance.
   * @param {RegionProgressBar} regionProgressBar - Refreshed with each progress update.
   * @param {ProgressBar} missionProgressBar - The sidebar's mission bar.
   * @param {MinimapMissionProgress} minimapMissionProgress - The minimap's mission bar and flags.
   * @param {Tracker} tracker
   */
  constructor(config, missionModel, regionModel, missionContainer, taskContainer, form, modalMissionComplete,
    modalSurvey, alertController, compass, navigationService, panoManager, observedArea, overallStats,
    regionProgressBar, missionProgressBar, minimapMissionProgress, tracker) {
    this.#config = config;
    this.#missionModel = missionModel;
    this.#regionModel = regionModel;
    this.#missionContainer = missionContainer;
    this.#taskContainer = taskContainer;
    this.#form = form;
    this.#modalMissionComplete = modalMissionComplete;
    this.#modalSurvey = modalSurvey;
    this.#alertController = alertController;
    this.#compass = compass;
    this.#observedArea = observedArea;
    this.#overallStats = overallStats;
    this.#regionProgressBar = regionProgressBar;
    this.#missionProgressBar = missionProgressBar;
    this.#minimapMissionProgress = minimapMissionProgress;
    this.#tracker = tracker;

    missionModel.on('MissionProgress:update', (parameters) => {
      this.update(parameters.mission, parameters.region);
    });
    navigationService.onRouteEndReached(() => this.onRouteReadyToFinish());
    navigationService.onRegionExhausted(() => this.wrapUpRouteOrRegion());
    compass.onFinishClick(() => this.wrapUpRouteOrRegion());
    // Once at the route's last pano, auto-finish as soon as the user has looked all the way around it. Not while
    // the heading settles after a move, when the observed area is still the pre-move one (#4174).
    panoManager.onPovChanged(() => {
      if (!navigationService.isHeadingSettling()) this.maybeAutoCompleteRoute();
    });
  }

  /**
   * Wraps up the current route or region once the user has finished every street and confirmed they're done
   * auditing their last intersection: ends the current task and shows the mission-complete modal.
   */
  wrapUpRouteOrRegion() {
    // Free-exploration sessions (#4451) have no route/region goal to wrap up.
    if (this.#config.isExploreAddressMode) return;

    const mission = this.#missionContainer.getCurrentMission();
    const region = this.#regionModel.currentRegion();

    // A route's mission completes before endTask, so endTask's submission carries the completed flag to the server.
    if (this.#regionModel.isRoute && !mission.isComplete()) {
      this.#completeTheCurrentMission(mission, region);
    }

    // Reached standing on a given-up street whenever that path found nothing left to walk. Such a street is submitted
    // but never finished: endTask sends completed=true, crediting a full audit of a street nobody could look at
    // (#4922). The submission still has to happen — it carries the mission's completed flag to the server.
    const currentTask = this.#taskContainer.getCurrentTask();
    if (currentTask.wasGivenUpOnImagery()) {
      this.#form.submitData(currentTask);
      this.#taskContainer.updateAuditedDistance();
    } else {
      this.#taskContainer.endTask(currentTask);
    }

    // Finish a region's mission here, as it can read just under 99.9% (server and page measure distance a bit
    // differently). Only after the street's submission, or the server would count it as left and start a new mission.
    if (!mission.isComplete()) {
      this.#completeTheCurrentMission(mission, region);
    }

    this.#modalMissionComplete.update(mission, region);
    this.#modalMissionComplete.show();
  }

  /**
   * Called when a route reaches its end. Shows the salient finish toast and arms the 360°-gated auto-complete so the
   * celebration fires once the user has looked around the final location — no manual click required.
   */
  onRouteReadyToFinish() {
    this.#alertController.showAlert(i18next.t('center-ui.compass.route-finish-look-around'), 'routeFinish', false);
    this.#tracker.push('RouteFinishToast_Shown', { userRouteId: this.#config.userRouteId });
    // Fire immediately if they already looked all the way around at this pano before reaching the end.
    this.maybeAutoCompleteRoute();
  }

  /**
   * On each POV change, auto-fire route completion once the final pano is ~fully observed. No-op until the route is
   * flagged complete (its last reachable pano reached) and until the 360° observed fraction clears the threshold.
   */
  maybeAutoCompleteRoute() {
    if (this.#routeAutoCompleteFired || !this.#regionModel.isRouteComplete) return;
    // If the manual compass-click fallback already finished the route, don't fire wrapUp a second time.
    const mission = this.#missionContainer.getCurrentMission();
    if (mission && mission.isComplete()) return;
    const fractionObserved = this.#observedArea.getFractionObserved();
    if (fractionObserved >= MissionController.#ROUTE_FINISH_OBSERVED_THRESHOLD) {
      this.#routeAutoCompleteFired = true;
      this.#tracker.push('RouteAutoComplete_Fired', { userRouteId: this.#config.userRouteId, fractionObserved });
      // Drop the manual-click fallback so the compass message can't also fire wrapUp.
      this.#compass.removeLabelBeforeJumpMessage();
      this.wrapUpRouteOrRegion();
    }
  }

  /**
   * Marks the given mission as complete: logs it, updates the model, and bumps the session's completed-mission count.
   * @param {Mission} mission - The mission being completed.
   * @param {Region} region - The region the mission was in.
   */
  #completeTheCurrentMission(mission, region) {
    this.#tracker.push(
      'MissionComplete',
      {
        missionId: mission.getProperty('missionId'),
        missionType: mission.getProperty('missionType'),
        distanceMeters: Math.round(mission.getDistance('meters')),
        regionId: region.getRegionId(),
      },
    );
    this.#missionContainer.finishMission(mission);
    this.#missionModel.completeMission(mission);
  }

  /**
   * Completes the mission and shows the mission-complete modal if the mission is finished.
   * @param {Mission} mission - The current mission.
   * @param {Region} region - The current region.
   */
  #checkMissionComplete(mission, region) {
    // On a route the mission IS the route walk (one route-scoped mission, sized to the route server-side), so its
    // completion is finishing the route — handled in wrapUpRouteOrRegion, not by this distance check. The
    // check would also misfire here: the server sizes the route geodesically on the WGS84 spheroid while the
    // client's progress is turf (spherical haversine), so the two cross the 99.9% threshold at slightly
    // different points.
    if (this.#regionModel.isRoute) return;

    if (this.#missionContainer.getMissionCompletionRate(mission) > 0.999) {
      this.#completeTheCurrentMission(mission, region);

      // While the mission complete modal is open, after the **region** is 100% audited, the user is jumped
      // to the next region, which updates the modal's region information while it is still open.
      if (this.#modalMissionComplete.isOpen()) return;

      // Show the mission complete screen unless we're at the end of a route/region.
      if (!this.#regionModel.isRouteOrRegionComplete()) {
        this.#modalMissionComplete.update(mission, region);
        this.#modalMissionComplete.show();
      }
    }
  }

  /**
   * Updates the audited distance and mission completion rate in the right sidebar, checks for mission completion, and
   * occasionally prompts the user with the survey.
   * @param {Mission} currentMission - The current mission.
   * @param {Region} currentRegion - The current region.
   */
  update(currentMission, currentRegion) {
    if (this.#config.isOnboarding) return;

    // Update the global audited distance in the right sidebar.
    const distance = this.#taskContainer.getCompletedTaskDistance();
    this.#overallStats.setRegionAuditedDistance(distance);

    // Update the region progress bar (this user's vs. the community's share of the region).
    this.#regionProgressBar.update();

    // Free-exploration missions (#4451) have no distance target: the completion rate would compute as
    // distanceProgress / null → 1, immediately triggering the mission-complete modal. No progress bar, no survey.
    if (this.#config.isExploreAddressMode) return;

    // Update mission completion rate in the right sidebar and the minimap's mission-progress bar. On a route, the
    // Current Mission section describes the whole route (the server-side mission slices are invisible there), so its
    // bar tracks route progress.
    let completionRate;
    if (this.#regionModel.isRoute) {
      const unit = { units: util.turfDistanceUnits() };
      const routeDistance = this.#taskContainer.getTotalTaskDistance(unit);
      completionRate = routeDistance ? Math.min(1, distance / routeDistance) : 0;
    } else {
      completionRate = this.#missionContainer.getMissionCompletionRate(currentMission);
    }
    this.#missionProgressBar.update(completionRate);
    this.#minimapMissionProgress.update(currentMission);
    if (!this.#regionModel.isRouteComplete && !this.#regionModel.isRegionComplete) {
      this.#checkMissionComplete(currentMission, currentRegion);
    }

    // Show the survey modal if the user has just completed more than 60% (but less than 90%) of the current
    // mission. The server decides whether the survey should actually be shown (e.g. not shown twice).
    if (completionRate > 0.6 && completionRate < 0.9) {
      fetch('/survey/display').then((response) => response.json()).then((data) => {
        if (data.displayModal) {
          this.#modalSurvey.open();
          window.logWebpageActivity('SurveyShown');
        }
      }).catch((error) => console.log(error));
    }
  }
}
