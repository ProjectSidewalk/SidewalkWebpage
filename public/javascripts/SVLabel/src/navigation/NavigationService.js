/**
 * Handles navigation logic, and keeps the minimap and panorama in sync.
 * @param neighborhoodModel
 * @param uiStreetview
 * @returns {{className: string}}
 * @constructor
 */
function NavigationService (neighborhoodModel, uiStreetview) {
    let self = { className: 'Map' },
        properties = {
            browser : 'unknown'
        },
        status = {
            disableWalking : false,
            lockDisableWalking : false,
            labelBeforeJumpState: false,
            contextMenuWasOpen: false
        },
        missionJump = undefined,
        _stuckPanos = [];
    let positionUpdateCallbacks = [];

    let initialPositionUpdate = true;
    const END_OF_STREET_THRESHOLD = 25; // Distance from the endpoint of the street when we consider it complete (meters).
    const moveDelay = 800; // Move delay prevents users from spamming through a mission.

    function _init() {
        self.properties = properties; // Make properties public.
        properties.browser = util.getBrowser();
    }

    /**
     * Disable walking thoroughly and indicate that user is moving.
     * TODO should we be hiding the arrows for the full delay or no? Don't want users to click on them, but don't want it all to feel slow to load
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
        svl.modalSkip.enableStuckButton();
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
     * @param prop
     * @returns {*}
     */
    function getProperty(prop) {
        return (prop in properties) ? properties[prop] : false;
    }

    function getStatus(key) {
        return status[key];
    }

    /**
     * Initiate imagery not found mechanism.
     * TODO should this just happen when a large portion has no imagery? What happens if it's just the last little bit again?
     */
    async function handleImageryNotFound() {
        const currentTask = svl.taskContainer.getCurrentTask();
        const currentMission = svl.missionContainer.getCurrentMission();
        util.misc.reportNoImagery(currentTask.getStreetEdgeId());
        console.error("Imagery missing for a large portion of street: " + currentTask.getStreetEdgeId());

        // TODO want to get this tracked somewhere when it's applicable.
        // svl.tracker.push("PanoId_NotFound", {'TargetPanoId': panoId});

        // Move to a new location
        self.preparePovReset();

        // TODO use this to notify the user after we've moved them to a new street.
        // const currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
        // const currentNeighborhoodName = currentNeighborhood.getProperty("name");
        // const title = "Error in Google Street View";
        // const message = "Uh-oh, something went wrong with Google Street View. This is not your fault, but we will need " +
        //     "to move you to another place in the " + currentNeighborhoodName + " neighborhood. Keep up the good work!";
        // svl.popUpMessage.notify(title, message, callback);

        // TODO do we need to call setLabelBeforeJumpState(false)?
        finishCurrentTaskBeforeJumping(currentMission);

        // Get a new task and jump to the new task location.
        const newTask = svl.taskContainer.nextTask(currentTask);
        if (newTask) {
            svl.taskContainer.setCurrentTask(newTask);
            return moveForward();
        } else {
            // Complete current neighborhood if no new task available.
            svl.neighborhoodModel.setComplete();
            return Promise.resolve(null);
        }
    }

    function finishCurrentTaskBeforeJumping(mission, nextTask) {
        if (mission === undefined) {
            mission = missionJump;
        }
        // Finish the current task.
        const currentTask = svl.taskContainer.getCurrentTask();
        svl.taskContainer.endTask(currentTask, nextTask);
        mission.pushATaskToTheRoute(currentTask);
    }

    /**
     * Get a new task and check if it's disconnected from the current task. If yes, then finish the current task after
     * the user has finished labeling the current location.
     * TODO this is probably being called too frequently and is causing issues when finishing a street and jumping.
     * @param task
     * @param mission
     * @private
     */
    function _endTheCurrentTask(task, mission) {
        if (!getLabelBeforeJumpState()) {
            missionJump = mission;
            var nextTask = svl.taskContainer.nextTask(task);

            // If we are out of streets, set the route/neighborhood as complete.
            if (!nextTask) {
                svl.neighborhoodModel.setComplete();
            }

            // TODO rename this? And shouldn't it happen on page load too, not just after a move?
            // TODO could `nextTask` ever be null/undefined?
            // Check if the user will jump to another discontinuous location or if this is the last street in their
            // route/neighborhood. If either is the case, let the user know to label the location before proceeding.
            if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete() || !task.isConnectedTo(nextTask, svl.CONNECTED_TASK_THRESHOLD, 'kilometers', true)) {
                // If jumping to a new place, set the newTask before jumping.
                if (nextTask && !task.isConnectedTo(nextTask, svl.CONNECTED_TASK_THRESHOLD)) {
                    nextTask.eraseFromMinimap(); // TODO why are we erasing here..?
                    svl.taskContainer.setBeforeJumpNewTask(nextTask);
                }

                // Show message to the user instructing them to label the current location.
                svl.tracker.push('LabelBeforeJump_ShowMsg');
                svl.compass.showLabelBeforeJumpMessage();

                setLabelBeforeJumpState(true);
            } else {
                finishCurrentTaskBeforeJumping(missionJump, nextTask);

                // Move to the new task if the route/neighborhood has not finished.
                if (nextTask) {
                    svl.taskContainer.setCurrentTask(nextTask);
                    moveForward();
                }
            }
        }
    }

    // Todo. Wrote this ad-hoc. Clean up and test later.
    function bindPositionUpdate(callback) {
        if (typeof callback == 'function') {
            positionUpdateCallbacks.push(callback);
        }
    }

    function unbindPositionUpdate(callback) {
        var callbackIndex = positionUpdateCallbacks.indexOf(callback);
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
        svl.modalSkip.disableStuckButton();
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

        // Update the minimap location and observed area viz.
        svl.minimap.setMinimapLocation(newLatLng);
        svl.observedArea.panoChanged();

        // Set delay until user can move again, to prevent spam running through a mission without labeling.
        timeoutWalking();
        setTimeout(resetWalking, moveDelay);

        // Update the canvas to show the correct labels on screen the pano.
        svl.panoManager.updateCanvas();

        switchToExploreMode();
        svl.panoManager.enablePanning();
        svl.canvas.enableLabeling();

        svl.compass.update();
        svl.compass.enableCompassClick();

        if (!isOnboarding && "taskContainer" in svl && svl.taskContainer.tasksLoaded()) {

            // End of the task if the user is close enough to the end point, and we aren't in the tutorial.
            // TODO I wonder if ending a task should happen elsewhere? Bc some types of moves might never cause an end task?
            // - that might be because the task was already ended before we moved them, for example...
            const task = svl.taskContainer.getCurrentTask();
            if (!isOnboarding && task && task.isAtEnd(newLatLng.lat, newLatLng.lng, END_OF_STREET_THRESHOLD)) {
                _endTheCurrentTask(task, currentMission);
            }
            svl.taskContainer.updateCurrentTask();
        }
        svl.missionModel.updateMissionProgress(currentMission, neighborhood);

        // Re-enable the keyboard.
        svl.keyboard.setStatus("disableKeyboard", false);

        // Set the heading angle when the user is dropped to the new location.
        // TODO actually do this when appropriate!
        // svl.panoManager.setPovToRouteDirection();

        // Calling callbacks from outside NavigationService after a move (things like first mission popups).
        for (let i = 0, len = positionUpdateCallbacks.length; i < len; i++) {
            const callback = positionUpdateCallbacks[i];
            if (typeof callback == 'function') {
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
     * TODO could the log messages just be done in callbacks to this async function rather than passing them as params.
     *
     * @param successLogMessage String internal logging when imagery is found; different for stuck button v compass.
     * @param failLogMessage String internal logging when imagery is not found; different for stuck button v compass.
     * @param alertFunc Function An optional function that would alert the user upon successfully finding imagery.
     */
    async function moveForward(successLogMessage, failLogMessage, alertFunc) {
        if (status.disableWalking) return;

        _updateUiBeforeMove();

        // TODO show loading icon. Add when resolving issue #2403.

        // Grab street geometry and current location.
        const currentTask = svl.taskContainer.getCurrentTask();
        const streetEdge = currentTask.getFeature();
        const startLatLng = turf.point(currentTask.getFurthestPointReached().geometry.coordinates);
        const streetEndpoint = turf.point([currentTask.getLastCoordinate().lng, currentTask.getLastCoordinate().lat]);

        // Remove the part of the street geometry that you've already passed using lineSlice.
        let remainder = turf.cleanCoords(turf.lineSlice(startLatLng, streetEndpoint, streetEdge));
        let currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };

        // Save the current pano ID as one that you're stuck at.
        const currentPano = svl.panoViewer.getPanoId();
        if (!_stuckPanos.includes(currentPano)) _stuckPanos.push(currentPano);

        // Set radius around each attempted point for which you'll accept imagery to 10 meters.
        let MAX_DIST = 10;
        // Set how far to move forward along the street for each new attempt at finding imagery to 10 meters.
        const DIST_INCREMENT = 0.01;

        // TODO we have repeated functionality between the success and failure callbacks. Clean up later.
        // TODO we're getting forwarded through multiple panos at a time for some reason.
        let successCallback = function() {
            const newPanoId = svl.panoViewer.getPanoId();
            if (_stuckPanos.includes(newPanoId)) {
                // If there is room to move forward then try again, recursively calling getPanorama with this callback.
                if (turf.length(remainder) > 0.001) {
                    // Save the current pano ID as one that doesn't work.
                    _stuckPanos.push(newPanoId);

                    // Try up to `DIST_INCREMENT` further down the street, using `lineSliceAlong` to find the remaining
                    // subsection of the street to check.
                    let distIncrement = Math.min(DIST_INCREMENT, turf.length(remainder));
                    remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, distIncrement, streetEndpoint));
                    currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
                    return svl.panoManager.setLocation(currLoc).then(successCallback, failureCallback);
                } else {
                    // TODO do we just call handleImageryNotFound here instead? Is this different because it's assuming street partially done?
                    return handleImageryNotFound();

                    // If all else fails, jump to a new street.
                    // svl.tracker.push(failLogMessage);
                    // svl.form.skip(currentTask, "PanoNotAvailable");
                    // svl.stuckAlert.stuckSkippedStreet();
                }
            } else {
                // Save current pano ID as one that doesn't work in case they try to move before clicking 'stuck' again.
                _stuckPanos.push(newPanoId);
                // Move them to the new pano we found.
                _updateUiAfterMove();
                svl.tracker.push(successLogMessage);
                if (alertFunc !== null) alertFunc();
                return Promise.resolve(newPanoId);
            }
        }

        let failureCallback = function(error) {
            // If there is room to move forward then try again, recursively calling getPanorama with this callback.
            if (turf.length(remainder) > 0) {
                // Try `DIST_INCREMENT` further down the street, using `lineSliceAlong` to find the remaining
                // subsection of the street to check.
                remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, DIST_INCREMENT, streetEndpoint));
                currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
                return svl.panoManager.setLocation(currLoc).then(successCallback, failureCallback);
            }
            // TODO add this functionality again later. Need to add a parameter to setLocation().
            // else if (MAX_DIST === 10) {
            //     // If we get to the end of the street, increase the radius a bit to try and drop them at the end.
            //     MAX_DIST = 25;
            //     svl.panoManager.setLocation(currLoc).then(successCallback, failureCallback);
            // }
            else {
                // TODO do we just call handleImageryNotFound here instead? Is this different because it's assuming street partially done?
                return handleImageryNotFound();

                // If all else fails, jump to a new street.
                // svl.tracker.push(failLogMessage);
                // svl.form.skip(currentTask, "PanoNotAvailable");
                // svl.stuckAlert.stuckSkippedStreet();
            }
        }

        // Initial call to getPanorama with using the recursive callback function.
        return svl.panoManager.setLocation(currLoc).then(successCallback, failureCallback);
    }

    /**
     * Move to the linked pano closest to the given heading angle.
     * @param heading The user's heading in degrees
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
            return moveToPano(linkedPanos[maxIndex].panoId);
        } else {
            // TODO could show a message to the user when there is no pano in that direction?
            return Promise.resolve(false);
        }
    }

    /**
     * Move to a specific pano ID.
     * @param panoId
     * @param force
     * @returns {Promise<Awaited<boolean>>}
     */
    async function moveToPano(panoId, force) {
        if (force === undefined) force = false;
        if (status.disableWalking && !force) return Promise.resolve(false);

        _updateUiBeforeMove();

        await svl.panoManager.setPanorama(panoId);

        _updateUiAfterMove();

        // TODO I need to double check what this is about... We shouldn't need something like this.
        // Additional check to hide arrows after the fact. Pop-up may become visible during timeout period.
        if (svl.popUpMessage.getStatus('isVisible')){
            svl.panoManager.hideNavArrows();
        }

        return Promise.resolve(true);
    }

    /**
     * This function sets the current status of the instantiated object.
     * @param key
     * @param value
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

    // Set a flag that triggers the POV being reset into the route direction upon the position changing.
    function preparePovReset() {
        initialPositionUpdate = true;
    }

    self.disableWalking = disableWalking;
    self.enableWalking = enableWalking;
    self.finishCurrentTaskBeforeJumping = finishCurrentTaskBeforeJumping;
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
    self.preparePovReset = preparePovReset;
    self.timeoutWalking = timeoutWalking;
    self.resetWalking = resetWalking;

    _init();
    return self;
}
