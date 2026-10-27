/**
 * Decides when a street is done and what comes next: after each landing it credits the pano to the street, ends a
 * street that's been walked, hands over the next one or asks the labeler to finish here before a jump, makes the
 * jump, and says when streets run out.
 */

import { TaskContainer } from './TaskContainer.js';
import { PanoViewer } from '../../common/pano-viewer/PanoViewer.js';
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('../alert/JumpAlert.js').JumpAlert} JumpAlert */
/** @typedef {import('../mission/Mission.js').Mission} Mission */
/** @typedef {import('../mission/MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../mission/MissionModel.js').MissionModel} MissionModel */
/** @typedef {import('../navigation/NavigationService.js').NavigationService} NavigationService */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../region/RegionModel.js').RegionModel} RegionModel */
/** @typedef {import('../navigation/StreetSweep.js').StreetSweep} StreetSweep */
/** @typedef {import('./Task.js').Task} Task */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class StreetProgress {
  /**
   * How near its end a landing must be to walk a street out (meters): the search radius, since from any nearer the
   * next search would find panos of the street beyond. Credit is the coverage rule's call, not this (#4640).
   */
  static #END_OF_STREET_THRESHOLD = PanoViewer.SEARCH_RADIUS_M;

  #config;
  #regionModel;
  #missionModel;
  #missionContainer;
  #taskContainer;
  #panoManager;
  #navigationService;
  #streetSweep;
  #jumpAlert;
  #tracker;

  #labelBeforeJumpArmed = false;

  /** @type {Mission | undefined} The mission the street being left is filed under when the jump finishes it. */
  #missionJump = undefined;

  /** @type {Array<(armed: boolean) => void>} */
  #labelBeforeJumpListeners = [];

  /** @type {Array<() => void>} */
  #routeEndReachedListeners = [];

  /** @type {Array<() => void>} */
  #regionExhaustedListeners = [];

  /**
   * @param {ExploreConfig} config
   * @param {RegionModel} regionModel - Marked complete when the streets run out.
   * @param {MissionModel} missionModel - Told of progress after each landing.
   * @param {MissionContainer} missionContainer - Whose current mission a finished street is filed under.
   * @param {TaskContainer} taskContainer - The streets being walked.
   * @param {PanoManager} panoManager - Where the labeler stands, and which way they face after a jump.
   * @param {NavigationService} navigationService - Whose landings may end a street, and which makes the jump.
   * @param {StreetSweep} streetSweep - Says when a street walked out of imagery or the streets ran out; files a
   *   street seen too little of.
   * @param {JumpAlert} jumpAlert - The tip shown after a jump.
   * @param {Tracker} tracker
   */
  constructor(config, regionModel, missionModel, missionContainer, taskContainer, panoManager, navigationService,
    streetSweep, jumpAlert, tracker) {
    this.#config = config;
    this.#regionModel = regionModel;
    this.#missionModel = missionModel;
    this.#missionContainer = missionContainer;
    this.#taskContainer = taskContainer;
    this.#panoManager = panoManager;
    this.#navigationService = navigationService;
    this.#streetSweep = streetSweep;
    this.#jumpAlert = jumpAlert;
    this.#tracker = tracker;

    navigationService.onLanded(() => this.#afterLanding());
    streetSweep.onStreetWalkedOut((task) => this.#endStreet(task, missionContainer.getCurrentMission()));
    streetSweep.onStreetsRanOut(() => this.#streetsRanOut());
  }

  /**
   * Told when the "finish labeling here before jumping" prompt goes up (true) or down (false).
   * @param {(armed: boolean) => void} listener
   */
  onLabelBeforeJumpChanged(listener) {
    this.#labelBeforeJumpListeners.push(listener);
  }

  /**
   * Told when a route's last reachable pano is reached.
   * @param {() => void} listener
   */
  onRouteEndReached(listener) {
    this.#routeEndReachedListeners.push(listener);
  }

  /**
   * Told when a region has no streets left.
   * @param {() => void} listener
   */
  onRegionExhausted(listener) {
    this.#regionExhaustedListeners.push(listener);
  }

  /** @returns {boolean} Whether the "finish labeling here before jumping" prompt is up. */
  isLabelBeforeJumpArmed() {
    return this.#labelBeforeJumpArmed;
  }

  /** @param {boolean} armed - Whether the "finish labeling here before jumping" prompt is up. */
  #setLabelBeforeJumpState(armed) {
    this.#labelBeforeJumpArmed = armed;
    this.#labelBeforeJumpListeners.forEach((listener) => listener(armed));
  }

  /**
   * Finishes the current street and moves to the one the prompt was for, or else the next in line.
   * @returns {Promise<void>}
   */
  async jumpToANewTask() {
    // Free exploration (#4451) has no next street to jump to.
    if (this.#config.isExploreAddressMode) return;

    const landed = await this.#navigationService.moveToNextStreet(() => {
      const mission = this.#missionJump || this.#missionContainer.getCurrentMission();
      const currentTask = this.#taskContainer.getCurrentTask();
      // A street given up on when the prompt went up was reported then; finishing it now would credit it (#4922).
      if (!currentTask.wasGivenUpOnImagery()) {
        this.#taskContainer.endTask(currentTask);
        mission.pushATaskToTheRoute(currentTask);
      }
      this.#setLabelBeforeJumpState(false);

      const task = this.#taskContainer.getNextTaskAfterJump() || this.#taskContainer.nextTask(currentTask);
      this.#taskContainer.setCurrentTask(task);
      this.#taskContainer.setNextTaskAfterJump(null);
    });
    if (!landed) return;

    // Read again: the move may have passed a street with no imagery.
    const landedOn = this.#taskContainer.getCurrentTask();
    this.#panoManager.turnTo(landedOn.headingAlongRoute(this.#panoManager.getPosition()));
    this.#jumpAlert.onClickJumpMessage();
  }

  /** Credits the pano to its street, ends the street at its end, updates progress, and preloads the next move. */
  #afterLanding() {
    const position = this.#panoManager.getPosition();
    const region = this.#regionModel.currentRegion();
    const currentMission = this.#missionContainer.getCurrentMission();

    try {
      if (this.#config.isExploreAddressMode) {
        // Free exploration has no end-of-street: each pano is credited to the street it is on (#5733).
        this.#taskContainer.recordExploreMove(position);
      } else if (!this.#config.isOnboarding && this.#taskContainer.tasksLoaded()) {
        const task = this.#taskContainer.getCurrentTask();
        if (task) task.recordVisit(position);
        if (task && task.isAtEnd(position, StreetProgress.#END_OF_STREET_THRESHOLD)) {
          // On a route's short last street, the end threshold can end the route well before its last pano (#4640),
          // so wait until most of it is walked; running out of imagery ends it otherwise.
          const finalRouteStreet = this.#regionModel.isRoute && !this.#taskContainer.nextTask(task);
          const streetLen = task.lineDistance({ units: 'meters' });
          const walkedMostOfStreet = streetLen > 0
            && task.getDistanceFromStart(position, { units: 'meters' }) / streetLen >= 0.9;
          if (!finalRouteStreet || walkedMostOfStreet) {
            this.#endStreet(task, currentMission);
          }
        }
        this.#taskContainer.updateCurrentTask();
      }
      this.#missionModel.updateMissionProgress(currentMission, region);
    } finally {
      this.#preloadNextMove();
    }
  }

  /**
   * Ends a street: credited if enough was seen, else reported as missing imagery and left unfinished (#5669). A
   * joining next street is handed over now; otherwise the labeler is asked to finish here first.
   * @param {Task} task - The street being ended.
   * @param {Mission} mission - The mission it's filed under.
   */
  #endStreet(task, mission) {
    if (this.#labelBeforeJumpArmed) return;

    // A street reached across a gap in its imagery is still one nobody saw enough of: the report is what the checker
    // retires it on, the give-up what keeps it from coming back (#4922). Not awaited, as endTask's submission isn't:
    // the hand-off below must finish before the views read it.
    if (!task.isCoveredEnough()) {
      this.#streetSweep.giveUpOnStreet(task).catch((err) => console.warn('Failed to file the street as empty:', err));
    }

    this.#missionJump = mission;
    const nextTask = this.#taskContainer.nextTask(task);
    const connected = nextTask
      && task.isConnectedTo(nextTask, TaskContainer.CONNECTED_TASK_KM, { units: 'kilometers' });

    // Before a jump, or at the very end, this is their last chance to label here, so ask first.
    if (this.#regionModel.isRouteOrRegionComplete() || !connected) {
      if (!nextTask) {
        this.#regionModel.setComplete();
        // Regions finish with a compass click instead.
        if (this.#regionModel.isRoute) this.#routeEndReachedListeners.forEach((listener) => listener());
      } else {
        if (!connected) this.#taskContainer.setNextTaskAfterJump(nextTask);
        this.#panoManager.panoViewer.clearPrefetchCache();
        this.#streetSweep.prefetchAlongStreet(nextTask.getFeature());
      }

      this.#tracker.push('LabelBeforeJump_ShowMsg');
      this.#setLabelBeforeJumpState(true);
    } else {
      if (!task.wasGivenUpOnImagery()) {
        this.#taskContainer.endTask(task);
        mission.pushATaskToTheRoute(task);
      }
      this.#taskContainer.setCurrentTask(nextTask);
      // The pano at the junction shows the next street's start too; the first landing on it is a window further on.
      nextTask.recordVisit(this.#panoManager.getPosition());
    }
  }

  /** The last street had no imagery, so the route or region is done where the labeler stands. */
  #streetsRanOut() {
    this.#regionModel.setComplete();
    // A route ends the normal way (look around, then finish) rather than jumping straight to the modal (#5008).
    if (this.#regionModel.isRoute) {
      this.#routeEndReachedListeners.forEach((listener) => listener());
    } else {
      this.#regionExhaustedListeners.forEach((listener) => listener());
    }
  }

  /** Pre-downloads where the next forward move will land. */
  #preloadNextMove() {
    // Best-effort: a bad guess must never break a landing.
    try {
      if (!this.#taskContainer.tasksLoaded()) return;
      if (this.#navigationService.walking.isHeld()) return;

      // With the jump prompt up, the next move is the jump, so preload the street it goes to (none at the end).
      const targetTask = this.#labelBeforeJumpArmed
        ? this.#taskContainer.getNextTaskAfterJump()
        : this.#taskContainer.getCurrentTask();
      if (targetTask) this.#streetSweep.preloadAhead(targetTask);
    } catch (err) {
      console.warn('Failed to preload the next move target:', err);
    }
  }
}
