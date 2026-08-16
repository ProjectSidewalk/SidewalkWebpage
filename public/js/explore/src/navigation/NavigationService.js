/**
 * Handles navigation logic, and keeps the minimap and panorama in sync.
 */
class NavigationService {
  static #END_OF_STREET_THRESHOLD = 25; // Distance from the street endpoint when we consider it complete (meters).
  // How close to the endpoint imagery has to run out before we treat the street as walked rather than as having
  // an imagery gap. More generous than #END_OF_STREET_THRESHOLD: the imagery simply ends, so there is nothing
  // further to walk either way, and Task.isAtEnd caps it on short streets.
  static #NEAR_END_NO_IMAGERY_THRESHOLD = 50;
  static #MOVE_DELAY = 800; // Move delay prevents users from spamming through a mission.
  // Distance between points on a street when searching it for imagery (km). Public so that PanoManager can sample
  // backup starting points at the same granularity as moveForward()'s search.
  static DIST_INCREMENT = 0.01;

  #uiStreetview;
  #properties = {
    browser: 'unknown',
  };

  #status = {
    disableWalking: false,
    lockDisableWalking: false,
    labelBeforeJumpState: false,
    contextMenuWasOpen: false,
    // True during a move until getPosition() is final; gates position-dependent views like the off-route warning.
    movingToNewLocation: false,
    // True from a move's start until getPov() stops settling; we hold their pre-move heading until then. (#4174)
    headingSettling: false,
  };

  /**
   * Tracks which mission a task should be linked to when shown on mission complete modal (I think).
   * @type {Mission | undefined}
   */
  #missionJump = undefined;
  #stuckPanos = new Set([]);
  // Street the #stuckPanos set belongs to; see the reset in moveForward().
  #stuckPanosStreetId = null;
  #positionUpdateCallbacks = [];
  #povSettlePoll = null; // Interval id; see #refreshHeadingViewsAfterPovSettles.

  /**
   * @param {Object} neighborhoodModel - NeighborhoodModel module.
   * @param {Object} uiStreetview - jQuery-wrapped street view UI elements.
   */
  constructor(neighborhoodModel, uiStreetview) {
    this.#uiStreetview = uiStreetview;
    this.#properties.browser = util.getBrowser();
  }

  /**
   * Disable walking thoroughly and indicate that user is moving.
   */
  timeoutWalking() {
    svl.panoManager.hideNavArrows();
    this.disableWalking();
  }

  /**
   * Enable walking and indicate that user has finished moving.
   */
  resetWalking() {
    svl.panoManager.resetNavArrows();
    svl.panoManager.showNavArrows();
    svl.panoOverlayControls.enableStuckButton();
    this.enableWalking();
  }

  /*
   * Get the status of the labelBeforeJump listener.
   */
  getLabelBeforeJumpState() {
    return this.#status.labelBeforeJumpState;
  }

  /*
   * Set the status of the labelBeforeJump listener.
   */
  setLabelBeforeJumpState(statusToSet) {
    this.#status.labelBeforeJumpState = statusToSet;
  }

  /**
   * Disables walking by hiding links towards other Street View panoramas.
   * @returns {NavigationService} this.
   */
  disableWalking() {
    if (!this.#status.lockDisableWalking) {
      // Disable clicking links and changing POV.
      svl.panoManager.hideNavArrows();
      this.#uiStreetview.modeSwitchWalk.css('opacity', 0.5);
      this.#status.disableWalking = true;
    }
    return this;
  }

  /**
   * Enables walking to other panoramas by showing links.
   * @returns {NavigationService} this.
   */
  enableWalking() {
    // This method shows links on SV and enables users to walk.
    if (!this.#status.lockDisableWalking) {
      // Enable clicking links and changing POV.
      svl.panoManager.showNavArrows();
      this.#uiStreetview.modeSwitchWalk.css('opacity', 1);
      this.#status.disableWalking = false;
    }
    return this;
  }

  /**
   * Returns a value of a specified property.
   * @param {string} prop - The property you want to get.
   * @returns {*}
   */
  getProperty(prop) {
    return (prop in this.#properties) ? this.#properties[prop] : false;
  }

  getStatus(key) {
    return this.#status[key];
  }

  /**
   * Handle no remaining imagery on current street. Log it if no imagery at all, or let them finish if near the end.
   *
   * @param {boolean} streetLooksEmpty - Whether the search that ran out actually established anything about the
   *     street: true when every sampled point along it got a clean "nothing usable here" from the provider, false
   *     when any of them failed to get an answer at all (a provider error, a blocked or unreachable API). Only the
   *     true case may complete or report the street — see the bail-out below.
   * @returns {Promise<null>}
   */
  async #handleImageryNotFound(streetLooksEmpty) {
    const currentTask = svl.taskContainer.getCurrentTask();
    const currentMission = svl.missionContainer.getCurrentMission();

    // The search never got an answer, so nothing is known about this street's imagery: don't complete it, don't
    // flag it, don't move on to the next one. Just say so and let the user retry once the provider recovers.
    // This is the same distinction the page-load path draws, and it has to be drawn here too — otherwise a provider
    // outage still walks the neighborhood, just three streets at a time instead of unbounded (#4918).
    if (!streetLooksEmpty) {
      svl.tracker.push('PanoSearchFailed');
      // moveForward() locked the UI for a move that isn't going to happen, and this branch leaves the user standing
      // where they were, so hand the controls back — otherwise the alert is the last thing they can interact with.
      this.#restoreUiAfterFailedMove();
      svl.alertController.showAlert(i18next.t('popup.imagery-load-failed'), 'imageryLoadFailed', false);
      return Promise.resolve(null);
    }

    // In free exploration (#4451) there is no task to finish and no street to advance to: don't report the street as
    // imagery-less (the user is mid-street by design), just tell them there's nothing further in this direction.
    if (svl.isExploreAddressMode()) {
      this.#restoreUiAfterFailedMove();
      svl.alertController.showAlert(i18next.t('popup.free-explore-no-imagery'), 'exploreAddressNoImagery', false);
      return Promise.resolve(null);
    }

    // If the user is relatively close to the end of the street, tell them to finish labeling before jumping.
    if (currentTask.isAtEnd(svl.panoViewer.getPosition(), NavigationService.#NEAR_END_NO_IMAGERY_THRESHOLD)) {
      this.#endTheCurrentTask(currentTask, currentMission);
      this.#updateUiAfterMove();
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
      svl.tracker.push('NoImageryFlagLimitReached');
    }

    // Every given-up street stays incomplete, which leaves it eligible for nextTask() — only the street just left is
    // excluded — so the run can cycle between the same few streets. The advance ceiling is what ends it.
    if (!NoImageryFlagGuard.canAdvance()) {
      svl.tracker.push('NoImageryAdvanceLimitReached');
      this.#restoreUiAfterFailedMove();
      // Its own message rather than the imagery-load-failed one: nothing failed to load here — the provider answered
      // every time, and we are the ones who stopped believing it. "Try again in a few minutes" would be wrong
      // advice, since waiting changes nothing about a run of streets that all read as empty (#4918).
      svl.alertController.showAlert(i18next.t('popup.imagery-skip-limit'), 'imagerySkipLimit', false);
      return Promise.resolve(null);
    }

    // Get a new task and jump to the new task location. The task being left is deliberately not finished — finishing
    // it submits completed=true, and the regular submission path credits that as a full audit, which is exactly the
    // claim a no-imagery verdict cannot support (#4922).
    const newTask = svl.taskContainer.nextTask(currentTask);
    if (newTask) {
      svl.taskContainer.setCurrentTask(newTask);
      // Not awaited: naming the destination takes a network round trip, and the move should not wait on decoration.
      svl.stuckAlert.announceSkippedStreetNear(newTask.getMidpoint(), svl.mapboxApiKey);
      // The failed search that brought us here left walking disabled, and moveForward() returns immediately in that
      // state — so without this the advance silently does nothing: the labeler is left standing on the old street's
      // pano with the panorama pane inert (no walking, panning, labeling, or keyboard) while the current task has
      // already been switched out from under them, and only a page reload gets them out (#4921). jumpToANewTask()
      // re-enables walking before its own moveForward() for the same reason.
      this.enableWalking();
      return this.moveForward();
    } else {
      // No new task: complete the neighborhood. This path skips #updateUiAfterMove(), so clear the flags here.
      this.#status.movingToNewLocation = false;
      this.#status.headingSettling = false;
      svl.neighborhoodModel.setComplete();
      svl.missionController.wrapUpRouteOrNeighborhood();
      return Promise.resolve(null);
    }
  }

  /**
   * @param {Mission} mission - The mission to associate the current task to.
   */
  #finishCurrentTaskBeforeJumping(mission) {
    mission = mission || this.#missionJump;

    // Finish the current task.
    const currentTask = svl.taskContainer.getCurrentTask();
    svl.taskContainer.endTask(currentTask);
    mission.pushATaskToTheRoute(currentTask);
  }

  async jumpToANewTask() {
    // Free exploration (#4451) pins the session to the searched location — there is no next street to jump to.
    if (svl.isExploreAddressMode()) return;

    // Flag the move before setCurrentTask() below, which synchronously calls compass.update() while still at the
    // old location — otherwise it would flash the off-route warning before moveForward() sets these. (#4174)
    this.#status.movingToNewLocation = true;
    this.#status.headingSettling = true;

    // Finish the current task.
    const mission = this.#missionJump || svl.missionContainer.getCurrentMission();
    this.#finishCurrentTaskBeforeJumping(mission);
    this.setLabelBeforeJumpState(false);

    // Finish clean up tasks before jumping.
    svl.compass.resetBeforeJump();

    const currTask = svl.taskContainer.getCurrentTask();
    const task = svl.taskContainer.getNextTaskAfterJump() || svl.taskContainer.nextTask(currTask);
    svl.taskContainer.setCurrentTask(task);
    svl.taskContainer.setNextTaskAfterJump(null);
    this.enableWalking();

    await this.moveForward();
    svl.panoManager.setPovToRouteDirection();
    svl.jumpAlert.onClickJumpMessage();
  }

  /**
   * Get a new task and check if it's disconnected from the current task. If yes, then finish the current task after
   * the user has finished labeling the current location.
   * @param {Task} task - The task that the user has neared the end of.
   * @param {Mission} mission - The mission that the task should be associated with.
   */
  #endTheCurrentTask(task, mission) {
    if (!this.getLabelBeforeJumpState()) {
      this.#missionJump = mission;
      const nextTask = svl.taskContainer.nextTask(task);

      // Check if the user will jump to another discontinuous location or if this is the last street in their
      // route/neighborhood. If either is the case, let the user know to label the location before proceeding.
      if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete()
        || !nextTask
        || !task.isConnectedTo(nextTask, svl.CONNECTED_TASK_THRESHOLD, { units: 'kilometers' })) {
        // If we are out of streets, set the route/neighborhood as complete.
        if (!nextTask) {
          svl.neighborhoodModel.setComplete();
          // A route completes at its last reachable pano: show the finish toast and arm the 360°-gated auto-complete.
          // Neighborhoods keep the manual compass-click flow.
          if (svl.neighborhoodModel.isRoute) svl.missionController.onRouteReadyToFinish();
        } else if (!task.isConnectedTo(nextTask, svl.CONNECTED_TASK_THRESHOLD, { units: 'kilometers' })) {
          // If jumping to a new place, record what the next task will be.
          svl.taskContainer.setNextTaskAfterJump(nextTask);
        }

        if (nextTask) {
          // Clear prefetch cache from the previous street and start prefetching for the new street.
          svl.panoViewer.clearPrefetchCache();
          this.prefetchAlongStreet(nextTask.getFeature());
        }

        // Show message to the user instructing them to label the current location.
        svl.tracker.push('LabelBeforeJump_ShowMsg');
        svl.compass.showLabelBeforeJumpMessage();
        this.setLabelBeforeJumpState(true);
      } else {
        // If there is another contiguous task, end the current one and show the next one.
        svl.taskContainer.endTask(task);
        mission.pushATaskToTheRoute(task);
        svl.taskContainer.setCurrentTask(nextTask);
      }
    }
  }

  /**
   * Adds a callback that is called whenever a successful move occurs.
   * @param {Function} callback
   */
  bindPositionUpdate(callback) {
    if (typeof callback === 'function') {
      this.#positionUpdateCallbacks.push(callback);
    }
  }

  /**
   * Remove the given callback function from the list of callbacks that are used on a successful move.
   * @param {Function} callback
   */
  unbindPositionUpdate(callback) {
    const callbackIndex = this.#positionUpdateCallbacks.indexOf(callback);
    if (callbackIndex >= 0) {
      this.#positionUpdateCallbacks.splice(callbackIndex, 1);
    }
  }

  /**
   * Updates the UI before moving to a new location, hiding certain elements and preventing interaction.
   */
  #updateUiBeforeMove() {
    this.#status.movingToNewLocation = true;
    this.#status.headingSettling = true;
    svl.feedbackModal.hide();
    if (svl.contextMenu.isOpen()) {
      svl.contextMenu.hide();
    }
    svl.canvas.hideHoverCard();
    svl.panoOverlayControls.disableStuckButton();
    svl.compass.disableCompassClick();
    svl.panoManager.disablePanning();
    svl.canvas.disableLabeling();
    svl.keyboard.setStatus('disableKeyboard', true);
    this.disableWalking();
  }

  /**
   * Updates the UI after moving to a new location, re-enabling certain elements and interactions.
   */
  #updateUiAfterMove() {
    const isOnboarding = svl.isOnboarding();
    const newLatLng = svl.panoViewer.getPosition();
    const neighborhood = svl.neighborhoodModel.currentNeighborhood();
    const currentMission = svl.missionContainer.getCurrentMission();

    // Set delay until user can move again, to prevent spam running through a mission without labeling.
    this.timeoutWalking();
    setTimeout(() => this.resetWalking(), NavigationService.#MOVE_DELAY);

    // Update the canvas to show the correct labels on the pano.
    svl.panoManager.updateCanvas();

    this.switchToExploreMode();
    svl.panoManager.enablePanning();
    svl.canvas.enableLabeling();

    if (!isOnboarding && 'taskContainer' in svl && svl.taskContainer.tasksLoaded()) {
      // End of the task if the user is close enough to the end point, and we aren't in the tutorial.
      // TODO I wonder if ending a task should happen elsewhere? Bc some types of moves might never cause an end task?
      // - that might be because the task was already ended before we moved them, for example...
      // TODO I hardly understand the todo above, and idk why we would end the task in the middle of updating the
      //      UI after a move... especially when #endTheCurrentTask() can result in another move...
      const task = svl.taskContainer.getCurrentTask();
      // In free exploration (#4451) reaching the end of the street must not end the task or advance to a new street.
      if (!isOnboarding && !svl.isExploreAddressMode() && task
        && task.isAtEnd(newLatLng, NavigationService.#END_OF_STREET_THRESHOLD)) {
        // On a route's final street, 25 m-from-endpoint can be a large fraction of a short street, firing "end of
        // route" long before the last reachable pano (#4640 route manifestation). Defer to the imagery-exhaustion
        // path (#handleImageryNotFound) unless they've already walked most of the street — on a long street 25 m
        // really is the end, so preserve today's behavior there.
        const finalRouteStreet = svl.neighborhoodModel.isRoute && !svl.taskContainer.nextTask(task);
        const streetLen = task.lineDistance({ units: 'meters' });
        const walkedMostOfStreet = streetLen > 0
          && task.getDistanceFromStart(newLatLng, { units: 'meters' }) / streetLen >= 0.9;
        if (!finalRouteStreet || walkedMostOfStreet) {
          this.#endTheCurrentTask(task, currentMission);
        }
      }
      svl.taskContainer.updateCurrentTask();
    }
    svl.missionModel.updateMissionProgress(currentMission, neighborhood);

    // Position is final, so position-dependent checks can run again; heading is still settling (handled below).
    this.#status.movingToNewLocation = false;

    // Update position-dependent views now; heading-dependent ones wait for the pov to settle.
    svl.minimap.setMinimapLocation(newLatLng);
    svl.compass.enableCompassClick();
    this.#refreshHeadingViewsAfterPovSettles();

    // Now that the task state reflects the new position, predict where the next move will go and pre-download
    // that pano so the move doesn't wait on the network.
    this.#preloadNextMoveTarget();

    // Re-enable the keyboard.
    svl.keyboard.setStatus('disableKeyboard', false);

    // Calling callbacks from outside NavigationService after a move (things like first mission popups).
    for (let i = 0, len = this.#positionUpdateCallbacks.length; i < len; i++) {
      const callback = this.#positionUpdateCallbacks[i];
      if (typeof callback === 'function') {
        callback();
      }
    }

    // Enable moving again after a timeout.
    setTimeout(() => this.resetWalking(), NavigationService.#MOVE_DELAY);
  }

  /**
   * Once the viewer's heading stops changing after a move (Mapillary keeps animating it briefly), refreshes the
   * heading-dependent views — peg, observed-area FOV, compass — with the settled pov. Until then those views keep
   * their pre-move orientation. Aborts if a new move begins (it runs its own refresh); GSV, whose pov is final
   * immediately, settles after the first couple of ticks.
   */
  #refreshHeadingViewsAfterPovSettles() {
    if (this.#povSettlePoll) window.clearInterval(this.#povSettlePoll); // Replace any in-flight poll from a prior move.

    let prevHeading = svl.panoViewer.getPov().heading;
    let stableTicks = 0;
    const startTime = performance.now();
    const pollMs = 80;
    const maxSettleMs = 1500; // Stop polling even if the heading never fully stabilizes.

    this.#povSettlePoll = window.setInterval(() => {
      if (this.#status.movingToNewLocation) { // A new move took over.
        window.clearInterval(this.#povSettlePoll);
        this.#povSettlePoll = null;
        return;
      }

      const heading = svl.panoViewer.getPov().heading;
      const headingDelta = Math.abs(((heading - prevHeading + 540) % 360) - 180); // Shortest angular distance.
      prevHeading = heading;
      stableTicks = headingDelta < 0.5 ? stableTicks + 1 : 0;

      if (stableTicks >= 2 || performance.now() - startTime > maxSettleMs) {
        window.clearInterval(this.#povSettlePoll);
        this.#povSettlePoll = null;
        this.#status.headingSettling = false; // Clear first so observedArea.update() recomputes from the settled pov.
        svl.observedArea.panoChanged();
        svl.observedArea.update();
        svl.compass.update();
      }
    }, pollMs);
  }

  /**
   * Locks status.disableWalking.
   * @returns {NavigationService} this.
   */
  lockDisableWalking() {
    this.#status.lockDisableWalking = true;
    return this;
  }

  // Moves label drawing layer to the top and hides navigation arrows.
  switchToLabelingMode() {
    this.#uiStreetview.drawingLayer.css('z-index', '1');
    this.#uiStreetview.viewControlLayer.css('z-index', '0');

    // TODO test if this is still necessary.
    if (this.#properties.browser === 'mozilla') {
      this.#uiStreetview.drawingLayer.append(this.#uiStreetview.canvas);
    }
    svl.panoManager.hideNavArrows();
  }

  // Moves label drawing layer to the bottom. Shows navigation arrows if walk is enabled.
  switchToExploreMode() {
    this.#uiStreetview.viewControlLayer.css('z-index', '1');
    this.#uiStreetview.drawingLayer.css('z-index', '0');
    if (!this.#status.disableWalking) {
      svl.panoManager.showNavArrows();
    }
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
      svl.panoViewer.prefetchLocation({ lat: point.geometry.coordinates[1], lng: point.geometry.coordinates[0] });
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
   * @param {Task} currentTask The task whose street is being walked.
   * @returns {{currLoc: {lat: number, lng: number}, remainder: turf.Feature<turf.LineString>}}
   */
  #computeMoveTarget(currentTask) {
    const streetEdge = currentTask.getFeature();
    const startLatLng = turf.point(currentTask.getFurthestPointReached().geometry.coordinates);
    const streetEndpoint = turf.point([currentTask.getEndCoordinate().lng, currentTask.getEndCoordinate().lat]);

    // Remove the part of the street geometry that you've already passed using lineSlice.
    let remainder = turf.cleanCoords(turf.lineSlice(startLatLng, streetEndpoint, streetEdge));
    let currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };

    const currPosition = svl.panoViewer.getPosition();
    const distFromFurthest = turf.distance(
      turf.point([currPosition.lng, currPosition.lat]), startLatLng, { units: 'meters' },
    );
    if (distFromFurthest <= svl.STREETVIEW_MAX_DISTANCE
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
      if (!('taskContainer' in svl) || !svl.taskContainer.tasksLoaded()) return;
      // When walking is hard-locked (tutorial, mission-complete modal) no forward move can happen, so don't
      // preload for one. The transient disableWalking that timeoutWalking() sets on every move doesn't apply.
      if (this.#status.lockDisableWalking) return;

      // When the label-before-jump state is armed, the next forward move is the jump itself: predict the start of
      // the street being jumped to rather than a point on the street the user is about to leave (which would also
      // pollute the prefetch cache that #endTheCurrentTask() just re-primed for the new street). No jump target
      // means the route/neighborhood is complete, so there is nothing to preload.
      const targetTask = this.getLabelBeforeJumpState()
        ? svl.taskContainer.getNextTaskAfterJump()
        : svl.taskContainer.getCurrentTask();
      if (!targetTask) return;

      // Mirror the exclusions the next moveForward() will use: the stuck set plus the pano the user is on now
      // (moveForward() adds the current pano to the stuck set before searching).
      const excludedPanos = new Set(this.#stuckPanos);
      const currentPano = svl.panoStore.getPanoData(svl.panoViewer.getPanoId());
      if (currentPano) excludedPanos.add(currentPano);

      const { currLoc } = this.#computeMoveTarget(targetTask);
      svl.panoViewer.preloadPanoNear(currLoc, excludedPanos);
    } catch (err) {
      console.warn('Failed to preload the next move target:', err);
    }
  }

  /**
   * Attempts to move the user forward by incrementally checking for imagery every few meters along the route.
   * @returns {Promise<string|null|void>} Resolves with the new pano ID on a successful move, null if the street ran
   *     out of imagery, or undefined if walking is disabled.
   */
  moveForward() {
    if (this.#status.disableWalking) return Promise.resolve();

    this.#updateUiBeforeMove();

    // TODO show loading icon. Add when resolving issue #2403.

    const currentTask = svl.taskContainer.getCurrentTask();
    const streetEndpoint = turf.point([currentTask.getEndCoordinate().lng, currentTask.getEndCoordinate().lat]);

    // The stuck set exists to stop the user cycling among panos they have already stood at on *this* street.
    // Carrying it onto the next street poisons the search there: the nearest pano to a new street's start is
    // routinely one visited on the street just finished, and setLocation() rejects an excluded pano exactly as it
    // rejects empty ground — so a street with perfectly good imagery can scan as having none, and then be falsely
    // reported on that basis (#4918). Short streets are the worst case, since every sample point on them can fall
    // within range of the same already-visited pano.
    if (currentTask.getStreetEdgeId() !== this.#stuckPanosStreetId) {
      this.#stuckPanos.clear();
      this.#stuckPanosStreetId = currentTask.getStreetEdgeId();
    }

    // Prefetch images for the full street geometry. Using the full street (not just the remainder) ensures the
    // sampled points are identical on every moveForward() call, so the dedup in prefetchLocation() makes this
    // effectively a no-op after the first call on a given street.
    this.prefetchAlongStreet(currentTask.getFeature());

    // Find where to start searching for imagery, and the part of the street geometry that hasn't been walked yet.
    let { currLoc, remainder } = this.#computeMoveTarget(currentTask);

    // Save the current pano as one that you're stuck at.
    const currentPano = svl.panoStore.getPanoData(svl.panoViewer.getPanoId());
    this.#stuckPanos.add(currentPano);

    const successCallback = () => {
      // Save current pano as one that doesn't work in case they try to move before clicking 'stuck' again.
      const newPanoId = svl.panoViewer.getPanoId();
      this.#stuckPanos.add(svl.panoStore.getPanoData(newPanoId));
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
        return svl.panoManager.setLocation(currLoc, this.#stuckPanos).then(successCallback, failureCallback);
      } else {
        return this.#handleImageryNotFound(NoImageryError.allNoImagery(searchFailures));
      }
    };

    // Initial call to getPanorama with using the recursive callback function.
    return svl.panoManager.setLocation(currLoc, this.#stuckPanos).then(successCallback, failureCallback);
  }

  /**
   * Move to the linked pano closest to the given heading angle.
   * @param {number} heading - The user's heading in degrees.
   * @returns {Promise<boolean>}
   */
  moveToLinkedPano(heading) {
    if (this.#status.disableWalking) return Promise.resolve(false);

    // Figure out if there's a link close to the given heading.
    const currHeading = svl.panoViewer.getPov().heading;
    const linkedPanos = svl.panoViewer.getLinkedPanos();
    const cosines = linkedPanos.map((link) => {
      const headingAngleOffset = util.math.toRadians(currHeading + heading) - util.math.toRadians(link.heading);
      return Math.cos(headingAngleOffset);
    });
    const maxIndex = cosines.indexOf(Math.max.apply(null, cosines));
    if (cosines[maxIndex] > 0.5) {
      return this.moveToPano(linkedPanos[maxIndex].panoId);
    } else {
      return Promise.resolve(false);
    }
  }

  /**
   * Move to a specific pano ID.
   * @param {string} panoId - The string ID of the pano that we want to move to.
   * @param {boolean} [force] - If true, force a move despite walking being disabled. Used in tutorial.
   * @returns {Promise<boolean>}
   */
  async moveToPano(panoId, force) {
    if (force === undefined) force = false;
    if (this.#status.disableWalking && !force) return Promise.resolve(false);

    this.#updateUiBeforeMove();
    try {
      await svl.panoManager.setPanorama(panoId);
    } catch (err) {
      // The move failed, so we haven't actually moved: re-enable the UI so that the user can try something else.
      this.#restoreUiAfterFailedMove();
      console.error(err);
      // Tell the user, so a step that goes nowhere reads as a failure rather than as a dead page. This targets one
      // specific pano that wouldn't load, which says nothing about the street, so nothing is recorded (#4918).
      svl.alertController.showAlert(i18next.t('popup.imagery-load-failed'), 'imageryLoadFailed', false);
      return false;
    }
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
    if (this.#status.disableWalking) return false;
    const moved = svl.panoViewer.getPanoId() === panoId ? true : await this.moveToPano(panoId);
    if (moved && pov) svl.panoManager.setPov(pov);
    // The move carries the prior pano's zoom over (GSV keeps the POV across setPanorama), so the zoom buttons can end
    // up desynced from the actual zoom — e.g. pinned at max with zoom-out dead. Re-sync them to the current zoom.
    if (moved && svl.zoomControl) svl.zoomControl.syncButtonsToZoom(svl.panoViewer.getPov().zoom);
    return moved;
  }

  /**
   * Re-enables the UI elements that #updateUiBeforeMove() disabled, w/out the updates that assume the position changed.
   */
  #restoreUiAfterFailedMove() {
    this.#status.movingToNewLocation = false;
    this.#status.headingSettling = false;
    this.resetWalking();
    svl.compass.enableCompassClick();
    svl.panoManager.enablePanning();
    svl.canvas.enableLabeling();
    svl.keyboard.setStatus('disableKeyboard', false);
  }

  /**
   * Sets the current status of the instantiated object.
   * @param {string} key - The status that needs to be set.
   * @param {*} value - The value to set that status to.
   * @returns {NavigationService|boolean} this, or false if the key is not a known status.
   */
  setStatus(key, value) {
    if (key in this.#status) {
      // if the key is disableWalking, invoke walk disabling/enabling function
      if (key === 'disableWalking') {
        if (value) {
          this.disableWalking();
        } else {
          this.enableWalking();
        }
      } else {
        this.#status[key] = value;
      }
      return this;
    }
    return false;
  }

  /**
   * Unlock disable walking.
   * @returns {NavigationService} this.
   */
  unlockDisableWalking() {
    this.#status.lockDisableWalking = false;
    return this;
  }
}
