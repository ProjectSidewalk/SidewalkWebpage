/**
 * Holds and triggers mission-related pub/sub events.
 */

import { EventEmitter } from '../EventEmitter.js';
import { Mission } from './Mission.js';

export class MissionModel extends EventEmitter {
  #regionId;

  /**
   * @param {number} regionId - The region whose completed missions are fetched.
   */
  constructor(regionId) {
    super();
    this.#regionId = regionId;
  }

  /**
   * Loads the missions already completed in this region and registers each one.
   * @param {Function} [callback] - Runs after the missions are registered.
   */
  fetchCompletedMissionsInRegion(callback) {
    fetch(`/completedMissionsInRegion?regionId=${this.#regionId}`)
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
   * Creates a Mission from a row as the server serializes it (MissionFormats, snake_case) and adds it to the container.
   * @param {Record<string, any>} parameters - The mission's JSON.
   */
  createAMission(parameters) {
    const mission = new Mission({
      missionId: parameters.mission_id,
      missionType: parameters.mission_type,
      regionId: parameters.region_id,
      isComplete: parameters.completed,
      distance: parameters.distance_meters,
      distanceProgress: parameters.distance_progress,
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
