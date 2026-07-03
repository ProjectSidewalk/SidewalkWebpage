/**
 * Handles navigation logic, and keeps the minimap and panorama in sync.
 */
class NavigationService {
    static #END_OF_STREET_THRESHOLD = 25; // Distance from the street endpoint when we consider it complete (meters).
    static #MOVE_DELAY = 800; // Move delay prevents users from spamming through a mission.
    static #DIST_INCREMENT = 0.01; // Distance to move forward along the street on each imagery search attempt (km).

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
     * @returns {Promise<null>}
     */
    async #handleImageryNotFound() {
        const currentTask = svl.taskContainer.getCurrentTask();
        const currentMission = svl.missionContainer.getCurrentMission();

        // If the user is relatively close to the end of the street, tell them to finish labeling before jumping.
        if (currentTask.isAtEnd(svl.panoViewer.getPosition(), svl.CLOSE_TO_ROUTE_THRESHOLD) < 0.5) {
            this.#endTheCurrentTask(currentTask, currentMission);
            this.#updateUiAfterMove();
            return Promise.resolve(null);
        }
        // If they are nowhere near the end, log the street as having no imagery and move them to a new street.
        else {
            await util.misc.reportNoImagery(currentTask, currentMission.getProperty('missionId'));

            // Get a new task and jump to the new task location.
            this.#finishCurrentTaskBeforeJumping(currentMission);
            const newTask = svl.taskContainer.nextTask(currentTask);
            if (newTask) {
                svl.taskContainer.setCurrentTask(newTask);
                svl.stuckAlert.stuckSkippedStreet();
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
                    // TODO should maybe trigger wrapUpRouteOrNeighborhood?
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
        svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
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
            if (!isOnboarding && task && task.isAtEnd(newLatLng, NavigationService.#END_OF_STREET_THRESHOLD)) {
                this.#endTheCurrentTask(task, currentMission);
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
                svl.peg.setHeading(heading);
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
            dist += NavigationService.#DIST_INCREMENT;
        }
    }

    /**
     * Attempts to move the user forward by incrementally checking for imagery every few meters along the route.
     */
    async moveForward() {
        if (this.#status.disableWalking) return;

        this.#updateUiBeforeMove();

        // TODO show loading icon. Add when resolving issue #2403.

        // Grab street geometry and current location.
        const currentTask = svl.taskContainer.getCurrentTask();
        const streetEdge = currentTask.getFeature();
        const startLatLng = turf.point(currentTask.getFurthestPointReached().geometry.coordinates);
        const streetEndpoint = turf.point([currentTask.getEndCoordinate().lng, currentTask.getEndCoordinate().lat]);

        // Remove the part of the street geometry that you've already passed using lineSlice.
        let remainder = turf.cleanCoords(turf.lineSlice(startLatLng, streetEndpoint, streetEdge));
        let currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };

        // Prefetch images for the full street geometry. Using the full street (not just the remainder) ensures the
        // sampled points are identical on every moveForward() call, so the dedup in prefetchLocation() makes this
        // effectively a no-op after the first call on a given street.
        this.prefetchAlongStreet(streetEdge);

        // If the user is already near their furthest point, bump currLoc one step forward so we search for imagery
        // that's actually ahead rather than cycling through other panos clustered at the current location.
        // If they've wandered away from the route, keep currLoc at getFurthestPointReached() to bring them back.
        const currPosition = svl.panoViewer.getPosition();
        const distFromFurthest = turf.distance(turf.point([currPosition.lng, currPosition.lat]), startLatLng, { units: 'meters' });
        if (distFromFurthest <= svl.STREETVIEW_MAX_DISTANCE && turf.length(remainder, { units: 'kilometers' }) > NavigationService.#DIST_INCREMENT) {
            remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, NavigationService.#DIST_INCREMENT, streetEndpoint));
            currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
        }

        // Save the current pano as one that you're stuck at.
        const currentPano = svl.panoStore.getPanoData(svl.panoViewer.getPanoId());
        this.#stuckPanos.add(currentPano);

        const successCallback = () => {
            // Save current pano as one that doesn't work in case they try to move before clicking 'stuck' again.
            const newPanoId = svl.panoViewer.getPanoId();
            this.#stuckPanos.add(svl.panoStore.getPanoData(newPanoId));
            this.#updateUiAfterMove();
            return Promise.resolve(newPanoId);
        };

        const failureCallback = (error) => {
            // If there is room to move forward then try again, recursively calling getPanorama with this callback.
            if (turf.length(remainder) > 0) {
                // Try `DIST_INCREMENT` further down the street.
                const distIncrement = Math.min(NavigationService.#DIST_INCREMENT, turf.length(remainder));
                remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, distIncrement, streetEndpoint));
                currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
                return svl.panoManager.setLocation(currLoc, this.#stuckPanos).then(successCallback, failureCallback);
            } else {
                return this.#handleImageryNotFound();
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
    async moveToLinkedPano(heading) {
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
            return this.moveToPano(linkedPanos[maxIndex].panoId)
                // Should never fail to load a linked pano, but adding a page refresh as a failsafe.
                .catch((err) => window.location.reload());
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
        await svl.panoManager.setPanorama(panoId);
        this.#updateUiAfterMove();

        return Promise.resolve(true);
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
