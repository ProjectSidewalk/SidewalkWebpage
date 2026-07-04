/**
 * Holds and triggers mission-related pub/sub events. The `EventMixin` emitter is mixed onto the prototype below,
 * providing `trigger`/`on`/etc. shared across the model modules.
 */
class MissionModel {
  fetchCompletedMissionsInNeighborhood(callback) {
    const _onFetch = (missions) => {
      for (let i = 0, len = missions.length; i < len; i++) {
        this.createAMission(missions[i]);
      }
    };

    if (callback) {
      $.when($.ajax(`/neighborhoodMissions?regionId=${svl.regionId}`)).done(_onFetch).done(callback);
    } else {
      $.when($.ajax(`/neighborhoodMissions?regionId=${svl.regionId}`)).done(_onFetch);
    }
  }

  addAMission(mission) {
    this.trigger('MissionContainer:addAMission', mission);
  }

  completeMission(mission) {
    this.trigger('MissionProgress:complete', { mission });
  }

  /**
     * Creates a Mission from raw back-end parameters and adds it via MissionContainer:addAMission.
     * @param {object} parameters - Mission values from the back end (snake_case keys are normalized to camelCase).
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
  updateMissionProgress(mission, neighborhood) {
    this.trigger('MissionProgress:update', { mission, neighborhood });
  }
}
Object.assign(MissionModel.prototype, EventMixin);
