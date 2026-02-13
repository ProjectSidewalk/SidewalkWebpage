/**
 * Handles navigation logic, and keeps the minimap and panorama in sync.
 * @param neighborhoodModel
 * @param uiStreetview
 * @returns {{className: string}}
 * @constructor
 */
function NavigationService (neighborhoodModel, uiStreetview) {
    let self = {className: 'Map'};
    let properties = {
        browser: 'unknown'
    };
    let status = {
        disableWalking: false,
        lockDisableWalking: false,
        labelBeforeJumpState: false,
        contextMenuWasOpen: false
    };

    /**
     * Used to track which mission a task should be linked to when shown on mission complete modal (I think).
     * @type {Mission | undefined}
     */
    let missionJump = undefined;
    let _stuckPanos = new Set([]);
    let positionUpdateCallbacks = [];

    const END_OF_STREET_THRESHOLD = 25; // Distance from the endpoint of the street when we consider it complete (meters).
    const moveDelay = 800; // Move delay prevents users from spamming through a mission.

    function _init() {
        self.properties = properties; // Make properties public.
        properties.browser = util.getBrowser();
    }

    /**
     * Disable walking thoroughly and indicate that user is moving.
     */
    function timeoutWalking() {
        svl.panoManager.hideNavArrows();
        disableWalking();
    }

    /**
     * Enable walking and indicate that user has finished moving.
     */
    function resetWalking() {
        svl.panoManager.resetNavArrows();
        svl.panoManager.showNavArrows();
        svl.leftMenu.enableStuckButton();
        enableWalking();
    }

    /*
     * Get the status of the labelBeforeJump listener.
     */
    function getLabelBeforeJumpState() {
        return status.labelBeforeJumpState;
    }

    /*
     * Set the status of the labelBeforeJump listener.
     */
    function setLabelBeforeJumpState(statusToSet) {
        status.labelBeforeJumpState = statusToSet;
    }

    /**
     * This method disables walking by hiding links towards other Street View panoramas.
     * @returns {disableWalking}
     */
    function disableWalking() {
        if (!status.lockDisableWalking) {
            // Disable clicking links and changing POV.
            svl.panoManager.hideNavArrows();
            uiStreetview.modeSwitchWalk.css('opacity', 0.5);
            status.disableWalking = true;
        }
        return this;
    }

    /**
     * This method enables walking to other panoramas by showing links.
     */
    function enableWalking() {
        // This method shows links on SV and enables users to walk.
        if (!status.lockDisableWalking) {
            // Enable clicking links and changing POV.
            svl.panoManager.showNavArrows();
            uiStreetview.modeSwitchWalk.css('opacity', 1);
            status.disableWalking = false;
        }
        return this;
    }

    /**
     * This method returns a value of a specified property.
     * @param {string} prop The property you want to get
     * @returns {*}
     */
    function getProperty(prop) {
        return (prop in properties) ? properties[prop] : false;
    }

    function getStatus(key) {
        return status[key];
    }

    /**
     * Handle no remaining imagery on current street. Log it if no imagery at all, or let them finish if near the end.
     * @return {Promise<null>}
     */
    async function _handleImageryNotFound() {
        const currentTask = svl.taskContainer.getCurrentTask();
        const currentMission = svl.missionContainer.getCurrentMission();

        // If the user is relatively close to the end of the street, tell them to finish labeling before jumping.
        if (currentTask.isAtEnd(svl.panoViewer.getPosition(), svl.CLOSE_TO_ROUTE_THRESHOLD) < 0.5) {
            _endTheCurrentTask(currentTask, currentMission);
            _updateUiAfterMove();
            return Promise.resolve(null);
        }
        // If they are nowhere near the end, log the street as having no imagery and move them to a new street.
        else {
            await util.misc.reportNoImagery(currentTask, currentMission.getProperty('missionId'));

            // Get a new task and jump to the new task location.
            finishCurrentTaskBeforeJumping(currentMission);
            const newTask = svl.taskContainer.nextTask(currentTask);
            if (newTask) {
                svl.taskContainer.setCurrentTask(newTask);
                svl.stuckAlert.stuckSkippedStreet();
                return moveForward();
            } else {
                // Complete current neighborhood if no new task is available.
                svl.neighborhoodModel.setComplete();
                svl.neighborhoodModel.trigger("Neighborhood:wrapUpRouteOrNeighborhood");
                return Promise.resolve(null);
            }
        }
    }

    /**
     *
     * @param {Mission} mission The mission to associate the current task to.
     */
    function finishCurrentTaskBeforeJumping(mission) {
        mission = mission || missionJump;

        // Finish the current task.
        const currentTask = svl.taskContainer.getCurrentTask();
        svl.taskContainer.endTask(currentTask);
        mission.pushATaskToTheRoute(currentTask);
    }

    async function jumpToANewTask() {
        // Finish the current task.
        const mission = missionJump || svl.missionContainer.getCurrentMission()
        finishCurrentTaskBeforeJumping(mission);
        setLabelBeforeJumpState(false);

        // Finish clean up tasks before jumping.
        svl.compass.resetBeforeJump();

        const currTask = svl.taskContainer.getCurrentTask();
        const task = svl.taskContainer.getNextTaskAfterJump() || svl.taskContainer.nextTask(currTask);
        svl.taskContainer.setCurrentTask(task);
        svl.taskContainer.setNextTaskAfterJump(null);
        enableWalking();
        await moveForward();
        svl.panoManager.setPovToRouteDirection();
        svl.jumpModel.triggerUserClickJumpMessage();
    }

    /**
     * Get a new task and check if it's disconnected from the current task. If yes, then finish the current task after
     * the user has finished labeling the current location.
     * @param {Task} task The task that the user has neared the end of
     * @param {Mission} mission The mission that the task should be associated with
     * @private
     */
    function _endTheCurrentTask(task, mission) {
        if (!getLabelBeforeJumpState()) {
            missionJump = mission;
            let nextTask = svl.taskContainer.nextTask(task);

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

                // Show message to the user instructing them to label the current location.
                svl.tracker.push('LabelBeforeJump_ShowMsg');
                svl.compass.showLabelBeforeJumpMessage();
                setLabelBeforeJumpState(true);
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
     * @param {function} callback
     */
    function bindPositionUpdate(callback) {
        if (typeof callback == 'function') {
            positionUpdateCallbacks.push(callback);
        }
    }

    /**
     * Remove the given callback function from the list of callbacks that are used on a successful move.
     * @param {function} callback
     */
    function unbindPositionUpdate(callback) {
        const callbackIndex = positionUpdateCallbacks.indexOf(callback);
        if (callbackIndex >= 0) {
            positionUpdateCallbacks.splice(callbackIndex, 1);
        }
    }

    /**
     * This method updates the UI before moving to a new location, hiding certain elements and preventing interaction.
     * @private
     */
    function _updateUiBeforeMove() {
        svl.modalComment.hide();
        if (svl.contextMenu.isOpen()) {
            svl.contextMenu.hide();
        }
        svl.ui.canvas.deleteIconHolder.css("visibility", "hidden");
        svl.leftMenu.disableStuckButton();
        svl.compass.disableCompassClick();
        svl.panoManager.disablePanning();
        svl.canvas.disableLabeling();
        svl.keyboard.setStatus("disableKeyboard", true);
    }

    /**
     * This method updates the UI after moving to a new location, re-enabling certain elements and interactions.
     */
    function _updateUiAfterMove() {
        const isOnboarding = svl.isOnboarding()
        const newLatLng = svl.panoViewer.getPosition();
        const neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
        const currentMission = svl.missionContainer.getCurrentMission();

        // Set delay until user can move again, to prevent spam running through a mission without labeling.
        timeoutWalking();
        setTimeout(resetWalking, moveDelay);

        // Update the canvas to show the correct labels on the pano.
        svl.panoManager.updateCanvas();

        switchToExploreMode();
        svl.panoManager.enablePanning();
        svl.canvas.enableLabeling();

        if (!isOnboarding && "taskContainer" in svl && svl.taskContainer.tasksLoaded()) {

            // End of the task if the user is close enough to the end point, and we aren't in the tutorial.
            // TODO I wonder if ending a task should happen elsewhere? Bc some types of moves might never cause an end task?
            // - that might be because the task was already ended before we moved them, for example...
            // TODO I hardly understand the todo above, and idk why we would end the task in the middle of updating the
            //      UI after a move... especially when _endTheCurrentTask() can result in another move...
            const task = svl.taskContainer.getCurrentTask();
            if (!isOnboarding && task && task.isAtEnd(newLatLng, END_OF_STREET_THRESHOLD)) {
                _endTheCurrentTask(task, currentMission);
            }
            svl.taskContainer.updateCurrentTask();
        }
        svl.missionModel.updateMissionProgress(currentMission, neighborhood);

        // Update the minimap location and observed area viz.
        svl.minimap.setMinimapLocation(newLatLng);
        svl.peg.setHeading(svl.panoViewer.getPov().heading);
        svl.observedArea.panoChanged();
        svl.observedArea.update();

        // Update the compass navigation messages.
        svl.compass.update();
        svl.compass.enableCompassClick();

        // Re-enable the keyboard.
        svl.keyboard.setStatus("disableKeyboard", false);

        // Calling callbacks from outside NavigationService after a move (things like first mission popups).
        for (let i = 0, len = positionUpdateCallbacks.length; i < len; i++) {
            const callback = positionUpdateCallbacks[i];
            if (typeof callback === 'function') {
                callback();
            }
        }

        // Enable moving again after a timeout.
        setTimeout(resetWalking, moveDelay);
    }

    /**
     * This method locks status.disableWalking.
     * @returns {lockDisableWalking}
     */
    function lockDisableWalking() {
        status.lockDisableWalking = true;
        return this;
    }

    // Moves label drawing layer to the top and hides navigation arrows.
    function switchToLabelingMode() {
        uiStreetview.drawingLayer.css('z-index','1');
        uiStreetview.viewControlLayer.css('z-index', '0');

        // TODO test if this is still necessary.
        if (properties.browser === 'mozilla') {
            uiStreetview.drawingLayer.append(uiStreetview.canvas);
        }
        svl.panoManager.hideNavArrows();
    }

    // Moves label drawing layer to the bottom. Shows navigation arrows if walk is enabled.
    function switchToExploreMode() {
        uiStreetview.viewControlLayer.css('z-index', '1');
        uiStreetview.drawingLayer.css('z-index','0');
        if (!status.disableWalking) {
            svl.panoManager.showNavArrows();
        }
    }

    /**
     * Attempts to move the user forward by incrementally checking for imagery every few meters along the route.
     */
    async function moveForward() {
        if (status.disableWalking) return;

        _updateUiBeforeMove();

        // TODO show loading icon. Add when resolving issue #2403.

        // Grab street geometry and current location.
        const currentTask = svl.taskContainer.getCurrentTask();
        const streetEdge = currentTask.getFeature();
        const startLatLng = turf.point(currentTask.getFurthestPointReached().geometry.coordinates);
        const streetEndpoint = turf.point([currentTask.getEndCoordinate().lng, currentTask.getEndCoordinate().lat]);

        // Remove the part of the street geometry that you've already passed using lineSlice.
        let remainder = turf.cleanCoords(turf.lineSlice(startLatLng, streetEndpoint, streetEdge));
        let currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };

        // Save the current pano ID as one that you're stuck at.
        const currentPano = svl.panoViewer.getPanoId();
        _stuckPanos.add(currentPano);

        // Set how far to move forward along the street for each new attempt at finding imagery to 10 meters.
        const DIST_INCREMENT = 0.01;

        let successCallback = function() {
            // Save current pano ID as one that doesn't work in case they try to move before clicking 'stuck' again.
            const newPanoId = svl.panoViewer.getPanoId();
            _stuckPanos.add(newPanoId);
            _updateUiAfterMove();
            return Promise.resolve(newPanoId);
        }

        let failureCallback = function(error) {
            // If there is room to move forward then try again, recursively calling getPanorama with this callback.
            if (turf.length(remainder) > 0) {
                // Try `DIST_INCREMENT` further down the street.
                let distIncrement = Math.min(DIST_INCREMENT, turf.length(remainder));
                remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, distIncrement, streetEndpoint));
                currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
                return svl.panoManager.setLocation(currLoc, _stuckPanos).then(successCallback, failureCallback);
            } else {
                return _handleImageryNotFound();
            }
        }

        // Initial call to getPanorama with using the recursive callback function.
        return svl.panoManager.setLocation(currLoc, _stuckPanos).then(successCallback, failureCallback);
    }

    /**
     * Move to the linked pano closest to the given heading angle.
     * @param {number} heading The user's heading in degrees
     * @returns {Promise<Awaited<boolean>>}
     */
    async function moveToLinkedPano(heading) {
        if (status.disableWalking) return Promise.resolve(false);

        // Figure out if there's a link close to the given heading.
        const currHeading = svl.panoViewer.getPov().heading;
        const linkedPanos = svl.panoViewer.getLinkedPanos();
        const cosines = linkedPanos.map(function(link) {
            const headingAngleOffset = util.math.toRadians(currHeading + heading) - util.math.toRadians(link.heading);
            return Math.cos(headingAngleOffset);
        });
        const maxIndex = cosines.indexOf(Math.max.apply(null, cosines));
        if (cosines[maxIndex] > 0.5) {
            return moveToPano(linkedPanos[maxIndex].panoId)
                // Should never fail to load a linked pano, but adding a page refresh as a failsafe.
                .catch((err) => window.location.reload());
        } else {
            return Promise.resolve(false);
        }
    }

    /**
     * Move to a specific pano ID.
     * @param {string} panoId The string ID of the pano that we want to move to.
     * @param {boolean} [force] If true, force a move to the pano despite walking being disabled. Used in tutorial.
     * @returns {Promise<Awaited<boolean>>}
     */
    async function moveToPano(panoId, force) {
        if (force === undefined) force = false;
        if (status.disableWalking && !force) return Promise.resolve(false);

        _updateUiBeforeMove();
        await svl.panoManager.setPanorama(panoId);
        _updateUiAfterMove();

        return Promise.resolve(true);
    }

    /**
     * This function sets the current status of the instantiated object.
     * @param {string} key That status that needs to be set
     * @param {*} value The value to set that status to
     * @returns {*}
     */
    function setStatus(key, value) {
        if (key in status) {
            // if the key is disableWalking, invoke walk disabling/enabling function
            if (key === "disableWalking") {
                if (value) {
                    disableWalking();
                } else {
                    enableWalking();
                }
            } else {
                status[key] = value;
            }
            return this;
        }
        return false;
    }

    /**
     * Unlock disable walking.
     * @returns {unlockDisableWalking}
     */
    function unlockDisableWalking() {
        status.lockDisableWalking = false;
        return this;
    }

    self.disableWalking = disableWalking;
    self.enableWalking = enableWalking;
    self.jumpToANewTask = jumpToANewTask;
    self.getLabelBeforeJumpState = getLabelBeforeJumpState;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.bindPositionUpdate = bindPositionUpdate;
    self.unbindPositionUpdate = unbindPositionUpdate;
    self.lockDisableWalking = lockDisableWalking;
    self.switchToLabelingMode = switchToLabelingMode;
    self.switchToExploreMode = switchToExploreMode;
    self.setLabelBeforeJumpState = setLabelBeforeJumpState;
    self.moveForward = moveForward;
    self.moveToPano = moveToPano;
    self.moveToLinkedPano = moveToLinkedPano;
    self.setStatus = setStatus;
    self.unlockDisableWalking = unlockDisableWalking;
    self.timeoutWalking = timeoutWalking;
    self.resetWalking = resetWalking;

    _init();
    return self;
}
