/**
 * MissionContainer module.
 * @memberof svl
 */
class MissionContainer extends EventEmitter {
  #missionPanel;
  #completedMissions = [];
  #currentMission = null;

  /*
    This variable keeps the distance of completed missions minus completed audits to fix the problem that
    is discussed here: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/297#issuecomment-259697107
   */
  #tasksMissionsOffset = null;

  // The mission id the minimap's label eras were last derived against (#4945). setCurrentMission runs after every
  // successful data submission, not only when the mission changes, so this is what keeps the re-derivation (a pass over
  // every label in the region) to actual mission boundaries.
  #minimapEraMissionId = null;

  /**
   * @param {MissionPanel} missionPanel - Renders the current mission's header and description in the sidebar.
   * @param {MissionModel} missionModel - Mission model object.
   */
  constructor(missionPanel, missionModel) {
    super();
    this.#missionPanel = missionPanel;

    missionModel.on('MissionProgress:complete', (parameters) => {
      const mission = parameters.mission;
      this.addToCompletedMissions(mission);
    });

    missionModel.on('MissionContainer:addAMission', (mission) => {
      if (mission.getProperty('isComplete')) {
        this.#completedMissions.push(mission);
      } else {
        this.setCurrentMission(mission);
        this.notifyMissionLoaded(mission);
      }
    });
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
    return this.getCompletedMissions().length === 0 && !svl.storage.get('completedFirstMission');
  }

  /**
   * This method sets the current mission
   * @param {Mission} mission - A Mission object
   * @returns {MissionContainer}
   */
  setCurrentMission(mission) {
    this.#currentMission = mission;
    this.#missionPanel.setMessage(mission);
    const currTask = svl.taskContainer.getCurrentTask();
    const missionId = mission.getProperty('missionId');
    currTask.setProperty('currentMissionId', missionId);
    // The mission boundary is what separates this pass's minimap markers from earlier ones (#4945).
    if (missionId !== this.#minimapEraMissionId) {
      this.#minimapEraMissionId = missionId;
      svl.labelContainer?.refreshMinimapEras();
    }

    // If this is the start of a new mission, mark the location along the street that the user is at when the
    // mission starts. This will be used later to draw their route on the mission complete map.
    if (mission.getProperty('distanceProgress') < 1.0 && !currTask.getProperty('tutorialTask')) {
      // Snap the current location to the nearest point on the street, and use that as the mission start.
      const currPos = turf.point([svl.panoViewer.getPosition().lng, svl.panoViewer.getPosition().lat]);
      const missionStart = turf.nearestPointOnLine(currTask.getFeature(), currPos).geometry.coordinates;
      currTask.setMissionStart(missionId, { lat: missionStart[1], lng: missionStart[0] });
    }
    return this;
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
   * Tells listeners that a new current mission is ready.
   * @param {Mission} mission - The mission that was loaded.
   */
  notifyMissionLoaded(mission) {
    this.trigger('MissionContainer:missionLoaded', mission);
  }
}
