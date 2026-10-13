/**
 * The moves along a street, between streets and to a named pano. Whether the labeler may walk is the `walking` gate;
 * a move runs idle → moving → settling → idle. What a move means to the rest of the tool is announced rather than
 * done here (onMoveStarted, onMoveFinished, onHeadingSettled, onMoved, onLabelBeforeJumpChanged, onRouteEndReached,
 * onRegionExhausted), since most of what reacts is built after this and several of them command it back.
 */

import { Gate } from '../../common/Gate.js';
import { NoImageryError } from '../../common/pano-viewer/NoImageryError.js';
import { PanoViewer } from '../../common/pano-viewer/PanoViewer.js';
import { util } from '../../common/utilities.js';
import { NoImageryFlagGuard } from '../panorama/NoImageryFlagGuard.js';
import { TaskContainer } from '../task/TaskContainer.js';
import '../../common/utilitiesMath.js';
import '../../common/utilitiesSidewalk.js';
/** @typedef {import('../alert/AlertController.js').AlertController} AlertController */
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('../Main.js').StreetviewUi} StreetviewUi */
/** @typedef {import('../data/Form.js').Form} Form */
/** @typedef {import('../alert/JumpAlert.js').JumpAlert} JumpAlert */
/** @typedef {import('../label/LabelContainer.js').LabelContainer} LabelContainer */
/** @typedef {import('../menu/LabelModes.js').LabelModes} LabelModes */
/** @typedef {import('../mission/Mission.js').Mission} Mission */
/** @typedef {import('../mission/MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../mission/MissionModel.js').MissionModel} MissionModel */
/** @typedef {import('../panorama/NavArrows.js').NavArrows} NavArrows */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../../common/pano-viewer/PanoStore.js').PanoStore} PanoStore */
/** @typedef {import('../region/RegionModel.js').RegionModel} RegionModel */
/** @typedef {import('../alert/StuckAlert.js').StuckAlert} StuckAlert */
/** @typedef {import('../task/Task.js').Task} Task */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class NavigationService {
  static #END_OF_STREET_THRESHOLD = 25; // Distance from the street endpoint when we consider it complete (meters).
  static #MOVE_DELAY = 800; // Move delay prevents users from spamming through a mission.
  // Distance between points on a street when searching it for imagery (km). Public so that PanoManager can sample
  // backup starting points at the same granularity as moveForward()'s search.
  static DIST_INCREMENT = 0.01;

  #ui;
  #config;
  #regionModel;
  #missionModel;
  #missionContainer;
  #taskContainer;
  #panoStore;
  #panoManager;
  #navArrows;
  #keyboardLock;
  #alertController;
  #stuckAlert;
  #jumpAlert;
  #form;
  #tracker;

  /**
   * Whether the labeler may walk: held by a move ('move', released a beat after it lands so a mission can't be
   * spammed through), a pop-up, the tutorial and the mission-complete screen. The arrows and walk button follow it.
   * @type {Gate}
   */
  walking = new Gate();

  /**
   * Where a move is: 'moving' until getPosition() is final, then 'settling' until getPov() stops changing (Mapillary
   * keeps animating the heading briefly, #4174), then 'idle'.
   * @type {'idle'|'moving'|'settling'}
   */
  #moveState = 'idle';

  #labelBeforeJumpArmed = false;

  /**
   * Tracks which mission a task should be linked to when shown on mission complete modal (I think).
   * @type {Mission | undefined}
   */
  #missionJump = undefined;
  #stuckPanos = new Set([]);
  // Traversal the #stuckPanos set belongs to; see the reset in moveForward().
  #stuckPanosTraversalKey = null;
  #povSettlePoll = null; // Interval id; see #refreshHeadingViewsAfterPovSettles.

  /** @type {Array<() => void>} */
  #movedListeners = [];

  /** @type {Array<() => void>} */
  #moveStartedListeners = [];

  /** @type {Array<() => void>} */
  #moveFinishedListeners = [];

  /** @type {Array<() => void>} */
  #headingSettledListeners = [];

  /** @type {Array<(armed: boolean) => void>} */
  #labelBeforeJumpListeners = [];

  /** @type {Array<() => void>} */
  #routeEndReachedListeners = [];

  /** @type {Array<() => void>} */
  #regionExhaustedListeners = [];

  /**
   * @param {StreetviewUi} ui - The pano area's layers, whose stacking says whether a click labels or pans.
   * @param {ExploreConfig} config
   * @param {RegionModel} regionModel
   * @param {MissionModel} missionModel - Told of progress after each move.
   * @param {MissionContainer} missionContainer - Whose current mission a finished street is filed under.
   * @param {TaskContainer} taskContainer - The streets being walked.
   * @param {PanoStore} panoStore - Names the pano stood on, which a move must leave.
   * @param {PanoManager} panoManager - Makes the moves; its panning is held while one is in flight.
   * @param {LabelContainer} labelContainer - Whose minimap markers lead back to a label's pano (#2561).
   * @param {LabelModes} labelModes - Arming a label type raises the drawing layer over the pano; Walk lowers it.
   * @param {NavArrows} navArrows - Hidden while walking is off, redrawn once it is back.
   * @param {Gate} keyboardLock - Held while a move is in flight.
   * @param {AlertController} alertController - Tells the labeler when imagery can't be loaded.
   * @param {StuckAlert} stuckAlert - Names the street the labeler is moved to when one runs out of imagery.
   * @param {JumpAlert} jumpAlert - The tip shown after a jump.
   * @param {Form} form - Submits a street before the labeler is moved off it.
   * @param {Tracker} tracker
   */
  constructor(ui, config, regionModel, missionModel, missionContainer, taskContainer, panoStore, panoManager,
    labelContainer, labelModes, navArrows, keyboardLock, alertController, stuckAlert, jumpAlert, form, tracker) {
    this.#ui = ui;
    this.#config = config;
    this.#regionModel = regionModel;
    this.#missionModel = missionModel;
    this.#missionContainer = missionContainer;
    this.#taskContainer = taskContainer;
    this.#panoStore = panoStore;
    this.#panoManager = panoManager;
    this.#navArrows = navArrows;
    this.#keyboardLock = keyboardLock;
    this.#alertController = alertController;
    this.#stuckAlert = stuckAlert;
    this.#jumpAlert = jumpAlert;
    this.#form = form;
    this.#tracker = tracker;

    this.walking.onChanged((held) => {
      if (held) this.#navArrows.hide();
      else this.#navArrows.show();
      this.#ui.modeSwitchWalk.style.opacity = held ? '0.5' : '1';
    });
    labelContainer.onMarkerClick((label) => {
      this.returnToPano(label.getPanoId(), label.getProperty('povOfLabelIfCentered'));
    });
    labelModes.onModeChanged((mode) => {
      if (mode === 'Walk') this.switchToExploreMode();
      else this.switchToLabelingMode();
    });
  }

  /**
   * Told as a move starts, before the viewer is asked to move: what must not be used mid-move locks here.
   * @param {() => void} listener
   */
  onMoveStarted(listener) {
    this.#moveStartedListeners.push(listener);
  }

  /**
   * Told once a move has either landed or failed, so what locked at its start can unlock.
   * @param {() => void} listener
   */
  onMoveFinished(listener) {
    this.#moveFinishedListeners.push(listener);
  }

  /**
   * Told once the viewer's heading has stopped settling after a move (Mapillary keeps animating it briefly), with
   * the settled pov; the heading-dependent views redraw then rather than mid-animation (#4174).
   * @param {() => void} listener
   */
  onHeadingSettled(listener) {
    this.#headingSettledListeners.push(listener);
  }

  /**
   * Told when the labeler reaches the end of a street the next one doesn't continue from (armed: label here, then
   * jump), and when the jump begins (disarmed).
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
   * Told when a region's streets run out with the labeler standing on one with no imagery left, so the region can be
   * wrapped up from where they are.
   * @param {() => void} listener
   */
  onRegionExhausted(listener) {
    this.#regionExhaustedListeners.push(listener);
  }

  /**
   * Told once a move has landed and the task state reflects the new position, after onMoveFinished.
   * @param {() => void} listener
   */
  onMoved(listener) {
    this.#movedListeners.push(listener);
  }

  /**
   * Stops telling a listener of moves.
   * @param {() => void} listener - The same function that was given to onMoved.
   */
  offMoved(listener) {
    this.#movedListeners = this.#movedListeners.filter((l) => l !== listener);
  }

  /** @returns {boolean} Whether a move is in flight and the position not yet final. */
  isMoving() {
    return this.#moveState === 'moving';
  }

  /**
   * @returns {boolean} Whether the heading is still settling after a move (or the move is still in flight), so the
   *   heading-dependent views should keep their pre-move orientation (#4174).
   */
  isHeadingSettling() {
    return this.#moveState !== 'idle';
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

  /** Redraws the arrows for the pano stood on and lets the move's hold on walking go. */
  #resetWalking() {
    this.#navArrows.reset();
    this.walking.release('move');
  }

  /**
   * Handle no remaining imagery on current street. Log it if no imagery at all, or let them finish if near the end.
   *
   * @param {boolean} streetLooksEmpty - Whether the search that ran out actually established anything about the
   *     street: true when every sampled point along it got a clean "nothing usable here" from the provider, false
   *     when any of them failed to get an answer at all (a provider error, a blocked or unreachable API). Only the
   *     true case may report the street as imagery-less, or move the labeler off it — see the bail-out below.
   * @returns {Promise<string|null|void>} What moveForward() resolves with if the labeler is moved on, otherwise null.
   */
  async #handleImageryNotFound(streetLooksEmpty) {
    const currentTask = this.#taskContainer.getCurrentTask();
    const currentMission = this.#missionContainer.getCurrentMission();

    // In free exploration (#4451) there is no task to finish and no street to advance to: don't report the street as
    // imagery-less (the user is mid-street by design), just tell them why they can't go further. Which reason that is
    // depends on whether the provider actually answered — "there's nothing more this way" is a claim about the world
    // that a failed lookup can't support.
    if (this.#config.isExploreAddressMode) {
      this.#restoreUiAfterFailedMove();
      const key = streetLooksEmpty ? 'popup.free-explore-no-imagery' : 'popup.imagery-load-failed';
      const type = streetLooksEmpty ? 'exploreAddressNoImagery' : 'imageryLoadFailed';
      this.#alertController.showAlert(i18next.t(key), type, false);
      return Promise.resolve(null);
    }

    // If the user is relatively close to the end of the street, tell them to finish labeling before jumping. This is
    // checked before the provider-failure bail-out below because it rests on where the labeler actually walked, not
    // on anything the provider said: they covered the street, so a lookup that failed at the far end is no reason to
    // withhold credit for work that was really done. It is also unreachable by the runaway loop #4918 is about,
    // which never moves off a street's start point.
    //
    // Judged at the furthest point reached as well as where the labeler stands: the sweep's exclusions can land a
    // move back near the start of a street already walked to its end, and the exhaustion that follows must not turn
    // that street into a no-imagery report (#5350).
    //
    // "Near" is the number free exploration may leave unseen (StreetCoverage.MaxUncoveredM), so the two modes agree
    // on what an imagery gap at the end of a street is worth. More generous than #END_OF_STREET_THRESHOLD, since the
    // imagery simply ends; Task.isAtEnd scales it down on short streets.
    const nearEndM = this.#config.streetCoverage.max_uncovered_m;
    const furthest = currentTask.getFurthestPointReached().geometry.coordinates;
    const nearEnd = currentTask.isAtEnd(this.#panoManager.getPosition(), nearEndM)
      || currentTask.isAtEnd({ lat: furthest[1], lng: furthest[0] }, nearEndM);
    const inView = !nearEnd && this.#isWholeStreetInView(currentTask);
    if (inView) this.#tracker.push('NoImagery_StreetInView');
    if (nearEnd || inView) {
      this.#endTheCurrentTask(currentTask, currentMission);
      this.#updateUiAfterMove();
      return Promise.resolve(null);
    }

    // The search never got an answer, so nothing is known about this street's imagery: don't report it and don't move
    // on to the next one. Just say so and let the user retry once the provider recovers. This is the same distinction
    // the page-load path draws, and it has to be drawn here too — otherwise a provider outage still walks the
    // region, just three streets at a time instead of unbounded (#4918).
    if (!streetLooksEmpty) {
      this.#tracker.push('PanoSearchFailed');
      // moveForward() locked the UI for a move that isn't going to happen, and this branch leaves the user standing
      // where they were, so hand the controls back — otherwise the alert is the last thing they can interact with.
      this.#restoreUiAfterFailedMove();
      this.#alertController.showAlert(i18next.t('popup.imagery-load-failed'), 'imageryLoadFailed', false);
      return Promise.resolve(null);
    }

    // One give-up per street. The terminal branch below hands the controls back — the route's finish gate needs the
    // labeler able to look around — so they can walk into this path again on the street they are still standing on,
    // filing a duplicate report and re-firing the finish toast. No other give-up leaves them on a flagged street.
    if (currentTask.wasGivenUpOnImagery()) {
      this.#restoreUiAfterFailedMove();
      return Promise.resolve(null);
    }

    // Nowhere near the end, so the street really does look like it runs out of imagery ahead of the user. Two
    // separable decisions follow: whether to *write down* that the street looks imagery-less, and whether to move
    // the labeler somewhere they can keep working (#4918).
    //
    // Writing it down records evidence and nothing else: the task is not completed or submitted, and the street
    // keeps its priority and its place in the rotation until the offline imagery checker confirms the reports and
    // retires it (#4922) — one session's verdict is never enough to move coverage. Even as pure evidence, an
    // unbroken run of reports is far better explained by one broken session than by a run of empty streets, so
    // reporting stops at MAX_CONSECUTIVE_FLAGS. Moving on costs nothing, so it continues past that point: a labeler
    // working a patchy area shouldn't be stranded just because we stopped trusting what we're seeing.
    const mayFlag = NoImageryFlagGuard.canFlag();
    NoImageryFlagGuard.recordStreetGivenUp();
    if (mayFlag) {
      await util.misc.reportNoImagery(currentTask, currentMission.getProperty('missionId'));
    } else {
      this.#tracker.push('NoImageryFlagLimitReached');
    }

    // The advance ceiling still bounds a run: give-ups leave a street eligible for assignment to everyone else, so a
    // session that keeps finding empty ones is better explained by a broken session than by an empty region.
    if (!NoImageryFlagGuard.canAdvance()) {
      this.#tracker.push('NoImageryAdvanceLimitReached');
      // The run is over, so the budget goes back: what follows can only be the labeler deciding to try again, which
      // is a fresh decision rather than a continuation of the automatic run this bounds (#4918).
      NoImageryFlagGuard.reset();
      this.#restoreUiAfterFailedMove();
      // Its own message rather than the imagery-load-failed one: nothing failed to load here — the provider answered
      // every time, and we are the ones who stopped believing it. "Try again in a few minutes" would be wrong
      // advice, since waiting changes nothing about a run of streets that all read as empty (#4918).
      this.#alertController.showAlert(i18next.t('popup.imagery-skip-limit'), 'imagerySkipLimit', false);
      return Promise.resolve(null);
    }

    // Get a new task and jump to the new task location. The task being left is deliberately not finished — finishing
    // it submits completed=true, and the regular submission path credits that as a full audit, which is exactly the
    // claim a no-imagery verdict cannot support (#4922).
    const newTask = this.#taskContainer.nextTask(currentTask);

    // Set once the labeler is actually being moved off, not when the street is reported: a run stopped by the advance
    // ceiling above leaves them standing here, and the flag reads as "done with this street" everywhere — full length
    // credited toward progress, drawn as walked, never handed back. Client-side only; nothing reaches the server's
    // notion of completion (#4922).
    currentTask.giveUpOnImagery();
    this.#taskContainer.renderTask(currentTask);

    if (newTask) {
      // Flush what the labeler did here before the current task changes under the buffer. Interactions carry no task
      // id of their own — the server files them against whichever audit_task the submission names — so anything still
      // queued would land on the street they are about to be moved to. This is a plain submission, not endTask(): the
      // task is left unfinished, since finishing it submits completed=true and credits a full audit (#4922).
      await this.#form.submitData(currentTask);
      this.#taskContainer.setCurrentTask(newTask);
      // Not awaited: naming the destination takes a network round trip, and the move should not wait on decoration.
      this.#stuckAlert.announceSkippedStreetNear(newTask.getMidpoint(), this.#config.mapboxApiKey);
      // Not moveForward(): the search that brought us here still holds walking, as may a pop-up, and returning at
      // once would strand the labeler on the old pano with the task already switched (#4921).
      return this.#moveForward();
    } else {
      // Nothing left to walk. This path skips #updateUiAfterMove(), so the move ends here.
      this.#restoreUiAfterFailedMove();
      this.#regionModel.setComplete();
      // Same ending a route gets when its last street is walked normally: the finish toast, then the celebration once
      // the labeler has looked around. Firing the modal straight from here made the route end mid-stride (#5008).
      if (this.#regionModel.isRoute) {
        this.#routeEndReachedListeners.forEach((listener) => listener());
      } else {
        this.#regionExhaustedListeners.forEach((listener) => listener());
      }
      return Promise.resolve(null);
    }
  }

  /**
   * Whether the user can see the whole street from where they stand. Short streets often can't be walked, since the
   * search skips the pano the user is on, so seeing it counts (#5474).
   * @param {Task} task
   * @returns {boolean}
   */
  #isWholeStreetInView(task) {
    const position = this.#panoManager.getPosition();
    const here = turf.point([position.lng, position.lat]);
    return task.getFeature().geometry.coordinates.every((coord) =>
      turf.distance(here, turf.point(coord), { units: 'meters' }) <= PanoViewer.SEARCH_RADIUS_M);
  }

  /**
   * @param {Mission} mission - The mission to associate the current task to.
   */
  #finishCurrentTaskBeforeJumping(mission) {
    mission = mission || this.#missionJump;

    // Finish the current task.
    const currentTask = this.#taskContainer.getCurrentTask();
    this.#taskContainer.endTask(currentTask);
    mission.pushATaskToTheRoute(currentTask);
  }

  async jumpToANewTask() {
    // Free exploration (#4451) pins the session to the searched location — there is no next street to jump to.
    if (this.#config.isExploreAddressMode) return;

    // Flag the move before setCurrentTask() below, which synchronously re-aims the compass while still at the old
    // location — otherwise it would flash the off-route warning before moveForward() sets this. (#4174)
    this.#moveState = 'moving';

    // Finish the current task.
    const mission = this.#missionJump || this.#missionContainer.getCurrentMission();
    this.#finishCurrentTaskBeforeJumping(mission);
    // The compass takes its prompt down with this.
    this.#setLabelBeforeJumpState(false);

    const currTask = this.#taskContainer.getCurrentTask();
    const task = this.#taskContainer.getNextTaskAfterJump() || this.#taskContainer.nextTask(currTask);
    this.#taskContainer.setCurrentTask(task);
    this.#taskContainer.setNextTaskAfterJump(null);

    // Not moveForward(): ending the street can raise the sign-in prompt, whose hold would stop the jump with the task
    // already switched. The move can land past `task` if that street has no imagery.
    await this.#moveForward();
    const landedOn = this.#taskContainer.getCurrentTask();
    this.#panoManager.turnTo(landedOn.headingAlongRoute(this.#panoManager.getPosition()));
    this.#jumpAlert.onClickJumpMessage();
  }

  /**
   * Get a new task and check if it's disconnected from the current task. If yes, then finish the current task after
   * the user has finished labeling the current location.
   * @param {Task} task - The task that the user has neared the end of.
   * @param {Mission} mission - The mission that the task should be associated with.
   */
  #endTheCurrentTask(task, mission) {
    if (!this.#labelBeforeJumpArmed) {
      this.#missionJump = mission;
      const nextTask = this.#taskContainer.nextTask(task);

      // A jump to a discontinuous street, or the last street of the route or region, is the user's one chance to
      // finish labeling this location, so they are asked to before proceeding.
      if (this.#regionModel.isRouteOrRegionComplete()
        || !nextTask
        || !task.isConnectedTo(nextTask, TaskContainer.CONNECTED_TASK_KM, { units: 'kilometers' })) {
        // If we are out of streets, set the route/region as complete.
        if (!nextTask) {
          this.#regionModel.setComplete();
          // A route completes at its last reachable pano: show the finish toast and arm the 360°-gated auto-complete.
          // Regions keep the manual compass-click flow.
          if (this.#regionModel.isRoute) this.#routeEndReachedListeners.forEach((listener) => listener());
        } else if (!task.isConnectedTo(nextTask, TaskContainer.CONNECTED_TASK_KM, { units: 'kilometers' })) {
          // If jumping to a new place, record what the next task will be.
          this.#taskContainer.setNextTaskAfterJump(nextTask);
        }

        if (nextTask) {
          // Clear prefetch cache from the previous street and start prefetching for the new street.
          this.#panoManager.panoViewer.clearPrefetchCache();
          this.prefetchAlongStreet(nextTask.getFeature());
        }

        // The compass tells the user to label the current location before moving on.
        this.#tracker.push('LabelBeforeJump_ShowMsg');
        this.#setLabelBeforeJumpState(true);
      } else {
        // If there is another contiguous task, end the current one and show the next one.
        this.#taskContainer.endTask(task);
        mission.pushATaskToTheRoute(task);
        this.#taskContainer.setCurrentTask(nextTask);
      }
    }
  }

  /**
   * Updates the UI before moving to a new location, hiding certain elements and preventing interaction.
   */
  #updateUiBeforeMove() {
    this.#moveState = 'moving';
    this.#moveStartedListeners.forEach((listener) => listener());
    this.#keyboardLock.hold('move');
    this.#panoManager.panning.hold('move');
    this.walking.hold('move');
  }

  /**
   * Updates the UI after moving to a new location, re-enabling certain elements and interactions.
   */
  #updateUiAfterMove() {
    const isOnboarding = this.#config.isOnboarding;
    const newLatLng = this.#panoManager.getPosition();
    const region = this.#regionModel.currentRegion();
    const currentMission = this.#missionContainer.getCurrentMission();

    // Walking stays held for a beat after the move lands, so a mission can't be spam-run through without labeling.
    setTimeout(() => this.#resetWalking(), NavigationService.#MOVE_DELAY);

    this.switchToExploreMode();
    this.#panoManager.panning.release('move');
    this.#moveFinishedListeners.forEach((listener) => listener());

    if (this.#config.isExploreAddressMode) {
      // Free exploration has no end-of-street: each pano is credited to the street it is on (#5733).
      this.#taskContainer.recordExploreMove(newLatLng);
    } else if (!isOnboarding && this.#taskContainer.tasksLoaded()) {
      // End of the task if the user is close enough to the end point, and we aren't in the tutorial.
      // TODO I wonder if ending a task should happen elsewhere? Bc some types of moves might never cause an end task?
      // - that might be because the task was already ended before we moved them, for example...
      // TODO I hardly understand the todo above, and idk why we would end the task in the middle of updating the
      //      UI after a move... especially when #endTheCurrentTask() can result in another move...
      const task = this.#taskContainer.getCurrentTask();
      if (task && task.isAtEnd(newLatLng, NavigationService.#END_OF_STREET_THRESHOLD)) {
        // On a route's final street, 25 m-from-endpoint can be a large fraction of a short street, firing "end of
        // route" long before the last reachable pano (#4640 route manifestation). Defer to the imagery-exhaustion
        // path (#handleImageryNotFound) unless they've already walked most of the street — on a long street 25 m
        // really is the end, so preserve today's behavior there.
        const finalRouteStreet = this.#regionModel.isRoute && !this.#taskContainer.nextTask(task);
        const streetLen = task.lineDistance({ units: 'meters' });
        const walkedMostOfStreet = streetLen > 0
          && task.getDistanceFromStart(newLatLng, { units: 'meters' }) / streetLen >= 0.9;
        if (!finalRouteStreet || walkedMostOfStreet) {
          this.#endTheCurrentTask(task, currentMission);
        }
      }
      this.#taskContainer.updateCurrentTask();
    }
    this.#missionModel.updateMissionProgress(currentMission, region);

    // Position is final, so position-dependent checks can run again; heading views wait for the pov to settle.
    this.#moveState = 'settling';
    this.#refreshHeadingViewsAfterPovSettles();

    // Now that the task state reflects the new position, predict where the next move will go and pre-download
    // that pano so the move doesn't wait on the network.
    this.#preloadNextMoveTarget();

    this.#keyboardLock.release('move');
    this.#movedListeners.forEach((listener) => listener());
  }

  /**
   * Once the viewer's heading stops changing after a move (Mapillary keeps animating it briefly), tells the
   * heading-dependent views — peg, observed-area FOV, compass — to redraw with the settled pov. Until then those
   * views keep their pre-move orientation. Aborts if a new move begins (it runs its own refresh); GSV, whose pov is
   * final immediately, settles after the first couple of ticks.
   */
  #refreshHeadingViewsAfterPovSettles() {
    if (this.#povSettlePoll) window.clearInterval(this.#povSettlePoll); // Replace any in-flight poll from a prior move.

    let prevHeading = this.#panoManager.getPov().heading;
    let stableTicks = 0;
    const startTime = performance.now();
    const pollMs = 80;
    const maxSettleMs = 1500; // Stop polling even if the heading never fully stabilizes.

    this.#povSettlePoll = window.setInterval(() => {
      if (this.#moveState === 'moving') { // A new move took over.
        window.clearInterval(this.#povSettlePoll);
        this.#povSettlePoll = null;
        return;
      }

      const heading = this.#panoManager.getPov().heading;
      const headingDelta = Math.abs(((heading - prevHeading + 540) % 360) - 180); // Shortest angular distance.
      prevHeading = heading;
      stableTicks = headingDelta < 0.5 ? stableTicks + 1 : 0;

      if (stableTicks >= 2 || performance.now() - startTime > maxSettleMs) {
        window.clearInterval(this.#povSettlePoll);
        this.#povSettlePoll = null;
        this.#moveState = 'idle'; // Settled first, so the listeners recompute from the settled pov.
        this.#headingSettledListeners.forEach((listener) => listener());
      }
    }, pollMs);
  }

  // Moves label drawing layer to the top and hides navigation arrows.
  switchToLabelingMode() {
    this.#ui.drawingLayer.style.zIndex = '1';
    this.#ui.viewControlLayer.style.zIndex = '0';
    this.#navArrows.hide();
  }

  // Moves label drawing layer to the bottom. Shows navigation arrows if walk is enabled.
  switchToExploreMode() {
    this.#ui.viewControlLayer.style.zIndex = '1';
    this.#ui.drawingLayer.style.zIndex = '0';
    if (!this.walking.isHeld()) this.#navArrows.show();
  }

  /**
   * Prefetches Mapillary images for all potential goal points along a street. Fires off requests asynchronously so
   * that subsequent setLocation() calls can skip the API round-trip. Safe to call multiple times for the same street
   * — prefetchLocation() deduplicates requests, so only the first call actually fires API requests.
   * @param {turf.Feature<turf.LineString>} streetGeometry - A Turf LineString of the full street geometry.
   */
  prefetchAlongStreet(streetGeometry) {
    const totalLength = turf.length(streetGeometry); // km
    let dist = 0;
    while (dist <= totalLength) {
      const point = turf.along(streetGeometry, dist);
      this.#panoManager.panoViewer.prefetchLocation({
        lat: point.geometry.coordinates[1], lng: point.geometry.coordinates[0],
      });
      dist += NavigationService.DIST_INCREMENT;
    }
  }

  /**
   * Computes the location that moveForward() will search first, along with the unwalked remainder of the street.
   *
   * The target is the start of the remainder (the user's furthest point reached), bumped one DIST_INCREMENT
   * forward when the user is already near that point — so we search for imagery that's actually ahead rather
   * than cycling through other panos clustered at the current location. If they've wandered away from the route,
   * the target stays at the furthest point to bring them back.
   *
   * @param {Task} currentTask - The task whose street is being walked.
   * @returns {{currLoc: {lat: number, lng: number}, remainder: turf.Feature<turf.LineString>}}
   */
  #computeMoveTarget(currentTask) {
    const startLatLng = turf.point(currentTask.getFurthestPointReached().geometry.coordinates);
    const streetEndpoint = turf.point([currentTask.getEndCoordinate().lng, currentTask.getEndCoordinate().lat]);

    let remainder = currentTask.unwalkedRemainder();
    let currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };

    const currPosition = this.#panoManager.getPosition();
    const distFromFurthest = turf.distance(
      turf.point([currPosition.lng, currPosition.lat]), startLatLng, { units: 'meters' },
    );
    if (distFromFurthest <= PanoViewer.SEARCH_RADIUS_M
      && turf.length(remainder, { units: 'kilometers' }) > NavigationService.DIST_INCREMENT) {
      remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, NavigationService.DIST_INCREMENT, streetEndpoint));
      currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
    }
    return { currLoc, remainder };
  }

  /**
   * Predicts where the next moveForward() will search and pre-downloads the pano that search would pick, so the
   * next move doesn't wait on the network. Runs the same target computation and (in the viewer) the same search +
   * scoring as the real move; a misprediction just costs one unused download.
   */
  #preloadNextMoveTarget() {
    // Best-effort: called from post-move UI updates, so never let a prediction error break those.
    try {
      if (!this.#taskContainer.tasksLoaded()) return;
      // Held by something other than the move itself (the tutorial, the mission-complete screen, a pop-up), no
      // forward move can happen, so don't preload for one.
      if (this.walking.isHeldExcept('move')) return;

      // When the label-before-jump state is armed, the next forward move is the jump itself: predict the start of
      // the street being jumped to rather than a point on the street the user is about to leave (which would also
      // pollute the prefetch cache that #endTheCurrentTask() just re-primed for the new street). No jump target
      // means the route/region is complete, so there is nothing to preload.
      const targetTask = this.#labelBeforeJumpArmed
        ? this.#taskContainer.getNextTaskAfterJump()
        : this.#taskContainer.getCurrentTask();
      if (!targetTask) return;

      // Mirror the exclusions the next moveForward() will use: the stuck set plus the pano the user is on now
      // (moveForward() adds the current pano to the stuck set before searching).
      const excludedPanos = new Set(this.#stuckPanos);
      const currentPano = this.#panoStore.getPanoData(this.#panoManager.getPanoId());
      if (currentPano) excludedPanos.add(currentPano);

      const { currLoc } = this.#computeMoveTarget(targetTask);
      this.#panoManager.panoViewer.preloadPanoNear(currLoc, excludedPanos);
    } catch (err) {
      console.warn('Failed to preload the next move target:', err);
    }
  }

  /**
   * Identity of the walk a #stuckPanos set belongs to. Namespaced because route walk orders and street edge ids are
   * both small integers from unrelated sequences.
   *
   * @param {Task} task - The task being walked.
   * @returns {string} The route traversal's key, or the street's when not on a route.
   */
  #stuckPanosKeyFor(task) {
    const walkOrder = task.getWalkOrder();
    return this.#regionModel.isRoute && walkOrder !== null && walkOrder !== undefined
      ? `route:${walkOrder}`
      : `street:${task.getStreetEdgeId()}`;
  }

  /**
   * Attempts to move the user forward by incrementally checking for imagery every few meters along the route.
   * @returns {Promise<string|null|void>} Resolves with the new pano ID on a successful move, null if the street ran
   *     out of imagery, or undefined if walking is disabled.
   */
  moveForward() {
    if (this.walking.isHeld()) return Promise.resolve();
    return this.#moveForward();
  }

  /**
   * The move without the walking check, for continuations of a move already under way (an empty street, a jump).
   * @returns {Promise<string|null|void>} As for moveForward().
   */
  #moveForward() {
    this.#updateUiBeforeMove();

    // TODO show loading icon. Add when resolving issue #2403.

    const currentTask = this.#taskContainer.getCurrentTask();
    const streetEndpoint = turf.point([currentTask.getEndCoordinate().lng, currentTask.getEndCoordinate().lat]);

    // The stuck set exists to stop the user cycling among panos they have already stood at on *this* street.
    // Carrying it onto the next street poisons the search there: the nearest pano to a new street's start is
    // routinely one visited on the street just finished, and setLocation() rejects an excluded pano exactly as it
    // rejects empty ground — so a street with perfectly good imagery can scan as having none, and then be falsely
    // reported on that basis (#4918). Short streets are the worst case, since every sample point on them can fall
    // within range of the same already-visited pano.
    //
    // A route can walk the same street twice (out-and-back), and those passes are separate walks: keying on the
    // street would hand pass two every pano pass one banked, leaving the return leg nothing to land on. Walk order
    // names the traversal, matching TaskContainer.nextTask (#5008).
    const traversalKey = this.#stuckPanosKeyFor(currentTask);
    if (traversalKey !== this.#stuckPanosTraversalKey) {
      this.#stuckPanos.clear();
      this.#stuckPanosTraversalKey = traversalKey;
    }

    // Prefetch images for the full street geometry. Using the full street (not just the remainder) ensures the
    // sampled points are identical on every moveForward() call, so the dedup in prefetchLocation() makes this
    // effectively a no-op after the first call on a given street.
    this.prefetchAlongStreet(currentTask.getFeature());

    // Find where to start searching for imagery, and the part of the street geometry that hasn't been walked yet.
    let { currLoc, remainder } = this.#computeMoveTarget(currentTask);

    // Save the current pano as one that you're stuck at.
    const currentPano = this.#panoStore.getPanoData(this.#panoManager.getPanoId());
    this.#stuckPanos.add(currentPano);

    const successCallback = () => {
      // Save current pano as one that doesn't work in case they try to move before clicking 'stuck' again.
      const newPanoId = this.#panoManager.getPanoId();
      this.#stuckPanos.add(this.#panoStore.getPanoData(newPanoId));
      // A move that lands ends any run of imagery failures, restoring the session's full flag allowance (#4918).
      NoImageryFlagGuard.reset();
      this.#updateUiAfterMove();
      return Promise.resolve(newPanoId);
    };

    // Every rejection from the walk down the street, so the end of the search can tell an empty street from a
    // provider that stopped answering (#4918).
    const searchFailures = [];

    const failureCallback = (err) => {
      searchFailures.push(err);
      // If there is room to move forward then try again, recursively calling getPanorama with this callback.
      if (turf.length(remainder) > 0) {
        // Try `DIST_INCREMENT` further down the street.
        const distIncrement = Math.min(NavigationService.DIST_INCREMENT, turf.length(remainder));
        remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, distIncrement, streetEndpoint));
        currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
        return this.#panoManager.setLocation(currLoc, this.#stuckPanos).then(successCallback, failureCallback);
      } else {
        return this.#handleImageryNotFound(NoImageryError.allNoImagery(searchFailures));
      }
    };

    // Initial call to getPanorama with using the recursive callback function.
    return this.#panoManager.setLocation(currLoc, this.#stuckPanos).then(successCallback, failureCallback);
  }

  /**
   * Move to the linked pano closest to the given heading angle.
   * @param {number} heading - The user's heading in degrees.
   * @param {{alertOnFailure?: boolean}} [options] - Passed through to moveToPano; see its `alertOnFailure`.
   * @returns {Promise<boolean>}
   */
  moveToLinkedPano(heading, options) {
    if (this.walking.isHeld()) return Promise.resolve(false);

    // Figure out if there's a link close to the given heading.
    const currHeading = this.#panoManager.getPov().heading;
    const linkedPanos = this.#panoManager.panoViewer.getLinkedPanos();
    const cosines = linkedPanos.map((link) => {
      const headingAngleOffset = util.math.toRadians(currHeading + heading) - util.math.toRadians(link.heading);
      return Math.cos(headingAngleOffset);
    });
    const maxIndex = cosines.indexOf(Math.max.apply(null, cosines));
    if (cosines[maxIndex] > 0.5) {
      return this.moveToPano(linkedPanos[maxIndex].panoId, false, options);
    } else {
      return Promise.resolve(false);
    }
  }

  /**
   * Move to a specific pano ID.
   * @param {string} panoId - The string ID of the pano that we want to move to.
   * @param {boolean} [force=false] - If true, force a move despite walking being disabled. Used in tutorial.
   * @param {{alertOnFailure?: boolean}} [options] - `alertOnFailure` (default true) shows the labeler a message when
   *     the pano won't load. Pass false when the caller has a fallback that may still move them: a failure the
   *     caller recovers from isn't one the labeler needs to hear about, and reporting it anyway means a banner
   *     saying imagery couldn't be loaded on a step that did in fact happen.
   * @returns {Promise<boolean>}
   */
  async moveToPano(panoId, force = false, { alertOnFailure = true } = {}) {
    if (this.walking.isHeld() && !force) return Promise.resolve(false);

    this.#updateUiBeforeMove();
    try {
      await this.#panoManager.setPanorama(panoId);
    } catch (err) {
      // The move failed, so we haven't actually moved: re-enable the UI so that the user can try something else.
      this.#restoreUiAfterFailedMove();
      console.error(err);
      // Tell the user, so a step that goes nowhere reads as a failure rather than as a dead page. This targets one
      // specific pano that wouldn't load, which says nothing about the street, so nothing is recorded (#4918).
      if (alertOnFailure) {
        this.#alertController.showAlert(i18next.t('popup.imagery-load-failed'), 'imageryLoadFailed', false);
      }
      return false;
    }
    // A pano that loads ends any run of imagery failures, wherever the move came from, so the session gets its full
    // flag allowance back (#4918). Walking on via the link graph is as much evidence that imagery is fine as the
    // street-sweeping move in moveForward() is.
    NoImageryFlagGuard.reset();
    this.#updateUiAfterMove();

    return true;
  }

  /**
   * Moves to whatever pano the provider serves nearest a location, as a real move (the task advances, walking is
   * timed out, the views update). The minimap's forward crumbs use it when a crumb's pano id won't load (GSV retires
   * panos): the crumb still marks where imagery was, so the coordinate search moveForward() relies on is the right
   * retry.
   *
   * The current pano is excluded from the search because a location a few metres ahead is usually still nearest to
   * the pano being stood on, and "moving" there would go nowhere.
   *
   * @param {{lat: number, lng: number}} latLng - Where to look for a pano.
   * @param {{alertOnFailure?: boolean}} [options] - As for moveToPano.
   * @returns {Promise<boolean>} Whether the move succeeded (false if walking is disabled or nothing loads there).
   */
  async moveToLocation(latLng, { alertOnFailure = true } = {}) {
    if (this.walking.isHeld()) return false;

    this.#updateUiBeforeMove();
    try {
      const currentPano = this.#panoStore.getPanoData(this.#panoManager.getPanoId());
      await this.#panoManager.setLocation(latLng, new Set(currentPano ? [currentPano] : []));
    } catch (err) {
      this.#restoreUiAfterFailedMove();
      console.error(err);
      if (alertOnFailure) {
        this.#alertController.showAlert(i18next.t('popup.imagery-load-failed'), 'imageryLoadFailed', false);
      }
      return false;
    }
    NoImageryFlagGuard.reset();
    this.#updateUiAfterMove();
    return true;
  }

  /**
   * Move to an already-visited pano and optionally face a POV. Used by the minimap's clickable markers to let the user
   * revisit a label or an earlier location (#4639, #2561).
   *
   * A "peek": the active audit task is left unchanged. Re-entering an earlier, already-completed street as the current
   * task would push a spurious TaskStart and risk the end-of-task auto-advance jumping the user straight back off the
   * pano they returned to.
   *
   * @param {string} panoId - Target (already-visited) pano id.
   * @param {{heading: number, pitch: number, zoom: number}} [pov] - POV to face on arrival; omit to keep heading.
   * @returns {Promise<boolean>} Whether the move succeeded (false if walking is disabled or the move failed).
   */
  async returnToPano(panoId, pov) {
    if (this.walking.isHeld()) return false;
    const moved = this.#panoManager.getPanoId() === panoId ? true : await this.moveToPano(panoId);
    if (moved && pov) this.#panoManager.setPov(pov);
    return moved;
  }

  /**
   * Re-enables the UI elements that #updateUiBeforeMove() disabled, w/out the updates that assume the position changed.
   */
  #restoreUiAfterFailedMove() {
    this.#moveState = 'idle';
    this.#resetWalking();
    this.#panoManager.panning.release('move');
    this.#moveFinishedListeners.forEach((listener) => listener());
    this.#keyboardLock.release('move');
  }
}
