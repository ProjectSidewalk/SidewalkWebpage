/**
 * Mission objects, stores data from mission table, as well as associated tasks. How far along a mission is comes from
 * the streets walked, which MissionContainer measures (updateDistanceProgress, getMissionCompletionRate).
 */

import { util } from '../../common/utilities.js';
import '../../common/utilitiesMath.js';
/** @typedef {import('../task/Task.js').Task} Task */

export class Mission {
  #properties = {
    missionId: null,
    missionType: null,
    regionId: null,
    isComplete: false,
    distance: null,
    distanceProgress: null,
    skipped: false,
  };

  #tasksForTheMission = [];

  /**
   * Fills in the #properties object with the data for the mission table.
   * @param {object} params
   * @param {number} params.missionId
   * @param {string} params.missionType
   * @param {number} params.regionId
   * @param {boolean} params.isComplete
   * @param {number} params.distance
   * @param {number} params.distanceProgress
   * @param {boolean} params.skipped
   */
  constructor(params) {
    this.setProperty('missionId', params.missionId);
    this.setProperty('missionType', params.missionType);
    this.setProperty('regionId', params.regionId);
    this.setProperty('isComplete', params.isComplete);
    this.setProperty('distance', params.distance);
    this.setProperty('distanceProgress', params.distanceProgress);
    this.setProperty('skipped', params.skipped);
  }

  /**
   * Set the isComplete property to true. MissionContainer.finishMission is how a mission is finished, since the
   * mission's overshoot has to come off the offset it keeps.
   * @returns {void}
   */
  complete = () => {
    this.setProperty('isComplete', true);
  };

  /**
   * Returns a property
   * @param {string} key - The property being requested
   * @returns {*|null} The value of the property, or null if no property found with that ID
   */
  getProperty = (key) => {
    return key in this.#properties ? this.#properties[key] : null;
  };

  /**
   * Get an array of tasks for this mission
   * @returns {Array<Task>}
   */
  getRoute = () => {
    return this.#tasksForTheMission;
  };

  /**
   * Sets a property
   * @param {string} key - The property being set
   * @param {*} value - The value to set that property to
   * @returns {void}
   */
  setProperty = (key, value) => {
    this.#properties[key] = value;
  };

  /**
   * Check if the mission is completed or not.
   * @returns {boolean}
   */
  isComplete = () => {
    return this.getProperty('isComplete');
  };

  /**
   * Push a completed task into `this.#tasksForTheMission`.
   * @param {Task} task
   */
  pushATaskToTheRoute = (task) => {
    const streetEdgeIds = this.#tasksForTheMission.map((t) => t.getStreetEdgeId());
    if (streetEdgeIds.indexOf(task.getStreetEdgeId()) < 0) {
      this.#tasksForTheMission.push(task);
    }
  };

  /**
   * Total line distance in this mission.
   * @param {string} [unit='meters'] - One of 'meters', 'miles', 'feet', 'kilometers', or 'meters'
   */
  getDistance = (unit = 'meters') => {
    if (unit === 'miles') {
      return util.math.metersToMiles(this.getProperty('distance'));
    } else if (unit === 'feet') {
      return util.math.metersToFeet(this.getProperty('distance'));
    } else if (unit === 'kilometers') {
      return util.math.metersToKms(this.getProperty('distance'));
    } else if (unit === 'meters') {
      return this.getProperty('distance');
    } else {
      console.error(`Unit must be miles, feet, kilometers, or meters. Given: ${unit}`);
      return this.getProperty('distance');
    }
  };
}
