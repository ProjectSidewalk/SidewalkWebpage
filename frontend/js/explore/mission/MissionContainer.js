/**
 * Holds the current mission and the ones completed in this region, and measures a mission's progress from the
 * streets walked. Announces 'MissionContainer:missionChanged' whenever the current mission is set, which is after
 * every successful submission, not only at a mission boundary.
 */

import { EventEmitter } from '../EventEmitter.js';
import { util } from '../../common/utilities.js';
import '../../common/utilitiesMath.js';
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('./Mission.js').Mission} Mission */
/** @typedef {import('./MissionModel.js').MissionModel} MissionModel */
/** @typedef {import('../sidebar/MissionPanel.js').MissionPanel} MissionPanel */
/** @typedef {import('../data/Storage.js').TemporaryStorage} TemporaryStorage */
/** @typedef {import('../task/Task.js').Task} Task */
/** @typedef {import('../task/TaskContainer.js').TaskContainer} TaskContainer */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */

export class MissionContainer extends EventEmitter {
  #config;
  #missionPanel;
  #storage;
  #taskContainer;
  #panoManager;
  #completedMissions = [];
  #currentMission = null;
  #missionsCompletedThisSession = 0;

  /*
    This variable keeps the distance of completed missions minus completed audits to fix the problem that
    is discussed here: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/297#issuecomment-259697107
   */
  #tasksMissionsOffset = null;

  /**
   * @param {ExploreConfig} config
   * @param {MissionPanel} missionPanel - Renders the current mission's header and description in the sidebar.
   * @param {MissionModel} missionModel - Mission model object.
   * @param {TemporaryStorage} storage - Remembers across sessions that a first mission was ever finished.
   * @param {TaskContainer} taskContainer - Whose walked streets measure a mission's progress, and whose current
   *   street each mission is tied to.
   * @param {PanoManager} panoManager - Whose position marks where a mission began on its street.
   */
  constructor(config, missionPanel, missionModel, storage, taskContainer, panoManager) {
    super();
    this.#config = config;
    this.#missionPanel = missionPanel;
    this.#storage = storage;
    this.#taskContainer = taskContainer;
    this.#panoManager = panoManager;

    missionModel.on('MissionProgress:complete', (parameters) => {
      this.#missionsCompletedThisSession += 1;
      this.addToCompletedMissions(parameters.mission);
    });

    missionModel.on('MissionContainer:addAMission', (mission) => {
      if (mission.getProperty('isComplete')) {
        this.#completedMissions.push(mission);
      } else {
        this.setCurrentMission(mission);
        this.notifyMissionLoaded(mission);
      }
    });

    taskContainer.onCurrentTaskChanged((task) => this.#adoptTask(task));
  }

  /** Push the completed mission */
  addToCompletedMissions(mission) {
    const existingMissionIds = this.#completedMissions.map((m) => m.getProperty('missionId'));
    const currentMissionId = mission.getProperty('missionId');
    if (existingMissionIds.indexOf(currentMissionId) < 0) {
      mission.setProperty('distanceProgress', mission.getDistance());
      this.#completedMissions.push(mission);
    } else {
      console.log('Oops, we are trying to add to completed missions array multiple times. Plz fix.');
    }
  }

  /** Get current mission */
  getCurrentMission() {
    return this.#currentMission;
  }

  /**
   * Get all the completed missions
   */
  getCompletedMissions() {
    return this.#completedMissions;
  }

  /** @returns {number} Missions finished since the page loaded. */
  getMissionsCompletedThisSession() {
    return this.#missionsCompletedThisSession;
  }

  /**
   * Get the sum of the distance of all the user's completed missions in this region.
   * @param {string} [unit]
   * @returns {number}
   */
  getCompletedMissionDistance(unit) {
    if (!unit) unit = 'meters';
    let completedDistance = 0;
    for (let missionIndex = 0; missionIndex < this.#completedMissions.length; missionIndex++) {
      completedDistance += this.#completedMissions[missionIndex].getDistance(unit);
    }
    return completedDistance;
  }

  /**
   * Checks if this is the first mission or not.
   * @returns {boolean}
   */
  isTheFirstMission() {
    return this.getCompletedMissions().length === 0 && !this.#storage.get('completedFirstMission');
  }

  /**
   * This method sets the current mission
   * @param {Mission} mission - A Mission object
   * @returns {MissionContainer}
   */
  setCurrentMission(mission) {
    this.#currentMission = mission;
    this.#missionPanel.setMessage(mission);
    const currTask = this.#taskContainer.getCurrentTask();
    const missionId = mission.getProperty('missionId');
    currTask.setProperty('currentMissionId', missionId);

    // If this is the start of a new mission, mark the location along the street that the user is at when the
    // mission starts. This will be used later to draw their route on the mission complete map.
    if (mission.getProperty('distanceProgress') < 1.0 && !currTask.getProperty('tutorialTask')) {
      // Snap the current location to the nearest point on the street, and use that as the mission start.
      const position = this.#panoManager.getPosition();
      const currPos = turf.point([position.lng, position.lat]);
      const missionStart = turf.nearestPointOnLine(currTask.getFeature(), currPos).geometry.coordinates;
      currTask.setMissionStart(missionId, { lat: missionStart[1], lng: missionStart[0] });
    }
    this.trigger('MissionContainer:missionChanged', mission);
    return this;
  }

  /**
   * Ties a street the labeler switched onto to the current mission.
   * @param {Task} task - The street now being walked.
   */
  #adoptTask(task) {
    if (!this.#currentMission) return;
    task.setProperty('currentMissionId', this.#currentMission.getProperty('missionId'));

    // Metres walked on this street in an earlier session are already in the server's mission progress, which the
    // page load folded into the offset. The mission bar counts the current street's audited distance, so switching
    // onto a part-walked street mid-session would add them a second time and jump the bar (#5370).
    if (task.isResumed() && this.#tasksMissionsOffset !== null) {
      const prewalkedM = util.math.kmsToMeters(task.claimSavedProgress());
      this.#tasksMissionsOffset -= prewalkedM;
    }
  }

  setTasksMissionsOffset(value) {
    this.#tasksMissionsOffset = value;
  }

  getTasksMissionsOffset() {
    // See issue https://github.com/ProjectSidewalk/SidewalkWebpage/issues/297
    // Check pull request for more details
    return this.#tasksMissionsOffset;
  }

  /**
   * Marks a mission finished. Its overshoot comes off the offset, so distanceProgress is at most the mission's
   * distance, and a first finished mission is remembered across sessions.
   * @param {Mission} mission
   */
  finishMission(mission) {
    mission.complete();
    if (mission.getProperty('missionType') === 'audit') {
      const distanceOver = mission.getProperty('distanceProgress') - mission.getProperty('distance');
      this.#tasksMissionsOffset -= distanceOver;
    }
    if (!this.#config.isOnboarding) this.#storage.set('completedFirstMission', true);
  }

  /**
   * Compute and return the mission completion rate
   * @param {Mission} mission
   * @returns {number} The completion rate of the mission between 0 and 1
   */
  getMissionCompletionRate(mission) {
    this.updateDistanceProgress(mission);
    if (mission.getProperty('missionType') === 'auditOnboarding') return 0;
    const distanceProgress = mission.getProperty('distanceProgress');
    const targetDistance = mission.getDistance('meters');
    // No distance target (e.g. an exploreAddress mission) → not "complete"; dividing by 0/null would clamp to 1
    // and fire the mission-complete modal.
    if (!targetDistance) return 0;
    return Math.min(Math.max(distanceProgress / targetDistance, 0), 1);
  }

  /**
   * Updates the distanceProgress for an audit mission from the streets walked.
   * @param {Mission} mission
   */
  updateDistanceProgress(mission) {
    if (mission.getProperty('missionType') === 'auditOnboarding' || this.#tasksMissionsOffset === null) return;
    let currentMissionCompletedDistance;
    if (mission.isComplete()) {
      currentMissionCompletedDistance = mission.getDistance('meters');
    } else {
      const taskDistance = util.math.kmsToMeters(
        this.#taskContainer.getCompletedTaskDistance({ units: 'kilometers' }),
      );
      const offset = this.#tasksMissionsOffset || 0;

      const missionDistance = this.getCompletedMissionDistance();
      currentMissionCompletedDistance = taskDistance - missionDistance + offset;
      // Hotfix for an issue where the mission completion distance was negative. Need to find root cause.
      // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2120
      if (currentMissionCompletedDistance < 0) {
        this.#tasksMissionsOffset = offset - currentMissionCompletedDistance;
        console.error(`Mission progress was set to ${currentMissionCompletedDistance}, resetting to 0.`);
        currentMissionCompletedDistance = 0;
      }
    }
    mission.setProperty('distanceProgress', currentMissionCompletedDistance);
  }

  /**
   * Tells listeners that a new current mission is ready.
   * @param {Mission} mission - The mission that was loaded.
   */
  notifyMissionLoaded(mission) {
    this.trigger('MissionContainer:missionLoaded', mission);
  }
}
