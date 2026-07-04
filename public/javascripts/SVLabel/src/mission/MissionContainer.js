/**
 * MissionContainer module.
 *
 * The `EventMixin` emitter is mixed onto the prototype below, providing `trigger`/`on`/etc.
 *
 * @memberof svl
 */
class MissionContainer {
  #missionPanel;
  #completedMissions = [];
  #currentMission = null;

  /*
    This variable keeps the distance of completed missions minus completed audits to fix the problem that
    is discussed here: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/297#issuecomment-259697107
     */
  #tasksMissionsOffset = null;

  /**
     * @param missionPanel Renders the current mission's header and description in the sidebar.
     * @param missionModel Mission model object.
     */
  constructor(missionPanel, missionModel) {
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
     * Get the sum of the distance of all the user's completed missions in this neighborhood.
     * @param unit
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
     * @param mission {object} A Mission object
     * @returns {MissionContainer}
     */
  setCurrentMission(mission) {
    this.#currentMission = mission;
    this.#missionPanel.setMessage(mission);
    const currTask = svl.taskContainer.getCurrentTask();
    const missionId = mission.getProperty('missionId');
    currTask.setProperty('currentMissionId', missionId);

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
}
Object.assign(MissionContainer.prototype, EventMixin);

MissionContainer.prototype.notifyMissionLoaded = function (mission) {
  this.trigger('MissionContainer:missionLoaded', mission);
};
