/**
 * Holds and triggers mission-related pub/sub events.
 */
class MissionModel extends EventEmitter {
  /**
   * Loads the missions already completed in this region and registers each one.
   * @param {Function} [callback] - Runs after the missions are registered.
   */
  fetchCompletedMissionsInRegion(callback) {
    fetch(`/completedMissionsInRegion?regionId=${svl.regionId}`)
      .then((res) => res.json())
      .then((missions) => {
        for (const mission of missions) this.createAMission(mission);
        if (callback) callback();
      });
  }

  addAMission(mission) {
    this.trigger('MissionContainer:addAMission', mission);
  }

  completeMission(mission) {
    this.trigger('MissionProgress:complete', { mission });
  }

  /**
   * Creates a Mission from raw back-end parameters and adds it via MissionContainer:addAMission.
   * @param {Record<string, any>} parameters - Mission values from the back end (snake_case keys become camelCase).
   */
  createAMission(parameters) {
    // Makes any necessary changes from snake_case to camelCase since we get the values from JSON.
    if (!Object.hasOwn(parameters, 'missionId') && Object.hasOwn(parameters, 'mission_id')) {
      parameters.missionId = parameters.mission_id;
    }
    if (!Object.hasOwn(parameters, 'missionType') && Object.hasOwn(parameters, 'mission_type')) {
      parameters.missionType = parameters.mission_type;
    }
    if (!Object.hasOwn(parameters, 'regionId') && Object.hasOwn(parameters, 'region_id')) {
      parameters.regionId = parameters.region_id;
    }
    if (!Object.hasOwn(parameters, 'isComplete') && Object.hasOwn(parameters, 'completed')) {
      parameters.isComplete = parameters.completed;
    }
    if (!Object.hasOwn(parameters, 'isComplete') && Object.hasOwn(parameters, 'is_complete')) {
      parameters.isComplete = parameters.is_complete;
    }
    if (!Object.hasOwn(parameters, 'distance') && Object.hasOwn(parameters, 'distanceMeters')) {
      parameters.distance = parameters.distanceMeters;
    }
    if (!Object.hasOwn(parameters, 'distance') && Object.hasOwn(parameters, 'distance_meters')) {
      parameters.distance = parameters.distance_meters;
    }
    if (!Object.hasOwn(parameters, 'distanceProgress') && Object.hasOwn(parameters, 'distance_progress')) {
      parameters.distanceProgress = parameters.distance_progress;
    }

    const mission = new Mission({
      missionId: parameters.missionId,
      missionType: parameters.missionType,
      regionId: parameters.regionId,
      isComplete: parameters.isComplete,
      distance: parameters.distance,
      distanceProgress: parameters.distanceProgress,
      skipped: parameters.skipped,
    });
    this.addAMission(mission);
  }

  /**
   * Notify the mission modules with MissionProgress:update
   */
  updateMissionProgress(mission, region) {
    this.trigger('MissionProgress:update', { mission, region });
  }
}
