/**
 * When the street being walked is done and what comes next. After each landing it ends a street the labeler has
 * reached the end of, either handing them the next street or, when that street is far away or there is none, asking
 * them to finish labeling here before the jump. It makes that jump, and says when a route or region runs out of
 * streets.
 */

import { TaskContainer } from './TaskContainer.js';
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
  static #END_OF_STREET_THRESHOLD = 25; // Distance from the street endpoint when we consider it complete (meters).

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

  /**
   * The mission the street being left is filed under when the jump finishes it.
   * @type {Mission | undefined}
   */
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
   * @param {StreetSweep} streetSweep - Says when a street runs out of imagery near its end, or the streets run out.
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
   * Told when the labeler is asked to finish labeling here before a jump (armed), and when the jump begins (disarmed).
   * @param {(armed: boolean) => void} listener
   */
  onLabelBeforeJumpChanged(listener) {
    this.#labelBeforeJumpListeners.push(listener);
  }

  /**
   * Told when a route's last reachable pano is reached, so the finish can be offered.
   * @param {() => void} listener
   */
  onRouteEndReached(listener) {
    this.#routeEndReachedListeners.push(listener);
  }

  /**
   * Told when a region's streets run out under the labeler, so it can be wrapped up from where they stand.
   * @param {() => void} listener
   */
  onRegionExhausted(listener) {
    this.#regionExhaustedListeners.push(listener);
  }

  /** @returns {boolean} Whether the labeler has been asked to finish labeling here before the next jump. */
  isLabelBeforeJumpArmed() {
    return this.#labelBeforeJumpArmed;
  }

  /**
   * Arms or disarms the label-before-jump prompt, and tells the compass, which shows it.
   * @param {boolean} armed
   */
  #setLabelBeforeJumpState(armed) {
    this.#labelBeforeJumpArmed = armed;
    this.#labelBeforeJumpListeners.forEach((listener) => listener(armed));
  }

  /**
   * Finishes the street being left and moves to the one the prompt was armed for, else the next in line.
   * @returns {Promise<void>}
   */
  async jumpToANewTask() {
    // Free exploration (#4451) pins the session to the searched location — there is no next street to jump to.
    if (this.#config.isExploreAddressMode) return;

    const started = await this.#navigationService.moveToNextStreet(() => {
      const mission = this.#missionJump || this.#missionContainer.getCurrentMission();
      const currentTask = this.#taskContainer.getCurrentTask();
      this.#taskContainer.endTask(currentTask);
      mission.pushATaskToTheRoute(currentTask);
      // The compass takes its prompt down with this.
      this.#setLabelBeforeJumpState(false);

      const task = this.#taskContainer.getNextTaskAfterJump() || this.#taskContainer.nextTask(currentTask);
      this.#taskContainer.setCurrentTask(task);
      this.#taskContainer.setNextTaskAfterJump(null);
    });
    if (!started) return;

    // The move can land past the street jumped to if that street has no imagery.
    const landedOn = this.#taskContainer.getCurrentTask();
    this.#panoManager.turnTo(landedOn.headingAlongRoute(this.#panoManager.getPosition()));
    this.#jumpAlert.onClickJumpMessage();
  }

  /** Ends the street if the labeler has reached its end, then updates the progress shown and preloads the next move. */
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
        if (task && task.isAtEnd(position, StreetProgress.#END_OF_STREET_THRESHOLD)) {
          // On a route's final street, 25 m-from-endpoint can be a large fraction of a short street, firing "end of
          // route" long before the last reachable pano (#4640 route manifestation). Defer to the sweep running out of
          // imagery (StreetSweep.onStreetWalkedOut) unless they've already walked most of the street — on a long
          // street 25 m really is the end, so preserve today's behavior there.
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
      // Now that the task state reflects the new position, predict where the next move will go and pre-download
      // that pano so the move doesn't wait on the network.
      this.#preloadNextMove();
    }
  }

  /**
   * Ends a street the labeler has reached the end of. If the next street joins this one, it is handed over now;
   * if it is far away, or there is none, the labeler is asked to finish labeling here before the jump.
   * @param {Task} task - The street that the user has neared the end of.
   * @param {Mission} mission - The mission that the street should be filed under.
   */
  #endStreet(task, mission) {
    if (this.#labelBeforeJumpArmed) return;

    this.#missionJump = mission;
    const nextTask = this.#taskContainer.nextTask(task);
    const connected = nextTask
      && task.isConnectedTo(nextTask, TaskContainer.CONNECTED_TASK_KM, { units: 'kilometers' });

    // A jump to a discontinuous street, or the last street of the route or region, is the user's one chance to
    // finish labeling this location, so they are asked to before proceeding.
    if (this.#regionModel.isRouteOrRegionComplete() || !connected) {
      if (!nextTask) {
        this.#regionModel.setComplete();
        // A route completes at its last reachable pano: show the finish toast and arm the 360°-gated auto-complete.
        // Regions keep the manual compass-click flow.
        if (this.#regionModel.isRoute) this.#routeEndReachedListeners.forEach((listener) => listener());
      } else {
        if (!connected) this.#taskContainer.setNextTaskAfterJump(nextTask);
        // Clear prefetch cache from the previous street and start prefetching for the new street.
        this.#panoManager.panoViewer.clearPrefetchCache();
        this.#streetSweep.prefetchAlongStreet(nextTask.getFeature());
      }

      // The compass tells the user to label the current location before moving on.
      this.#tracker.push('LabelBeforeJump_ShowMsg');
      this.#setLabelBeforeJumpState(true);
    } else {
      this.#taskContainer.endTask(task);
      mission.pushATaskToTheRoute(task);
      this.#taskContainer.setCurrentTask(nextTask);
    }
  }

  /** The sweep gave up on the last street there was: the route or region is done, from where the labeler stands. */
  #streetsRanOut() {
    this.#regionModel.setComplete();
    // Same ending a route gets when its last street is walked normally: the finish toast, then the celebration once
    // the labeler has looked around. Firing the modal straight from here made the route end mid-stride (#5008).
    if (this.#regionModel.isRoute) {
      this.#routeEndReachedListeners.forEach((listener) => listener());
    } else {
      this.#regionExhaustedListeners.forEach((listener) => listener());
    }
  }

  #preloadNextMove() {
    // Best-effort: runs after every landing, so never let a prediction error break it.
    try {
      if (!this.#taskContainer.tasksLoaded()) return;
      // No forward move can happen while something holds walking, so there is nothing to preload.
      if (this.#navigationService.walking.isHeld()) return;

      // When the label-before-jump state is armed, the next forward move is the jump itself: predict the start of
      // the street being jumped to rather than a point on the street the user is about to leave (which would also
      // pollute the prefetch cache that #endStreet() just re-primed for the new street). No jump target means the
      // route/region is complete, so there is nothing to preload.
      const targetTask = this.#labelBeforeJumpArmed
        ? this.#taskContainer.getNextTaskAfterJump()
        : this.#taskContainer.getCurrentTask();
      if (targetTask) this.#streetSweep.preloadAhead(targetTask);
    } catch (err) {
      console.warn('Failed to preload the next move target:', err);
    }
  }
}
