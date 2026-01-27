/**
 * Compass module
 * @param svl SVL name space. Need this for rootDirectory.
 * @param navigationService NavigationService module
 * @param taskContainer TaskContainer module
 * @param uiCompass ui elements. // Todo. Future work. Just pass the top level ui element.
 * @constructor
 */
function Compass (svl, navigationService, taskContainer, uiCompass) {
    let self = {className: 'Compass'};
    let blinkInterval;
    let blinkTimer;

    const imageDirectories = {
        leftTurn: svl.rootDirectory + 'img/icons/ArrowLeftTurn.png',
        rightTurn: svl.rootDirectory + 'img/icons/ArrowRightTurn.png',
        slightLeft: svl.rootDirectory + 'img/icons/ArrowSlightLeft.png',
        slightRight: svl.rootDirectory + 'img/icons/ArrowSlightRight.png',
        straight: svl.rootDirectory + 'img/icons/ArrowStraight.png',
        uTurn: svl.rootDirectory + 'img/icons/ArrowUTurn.png'
    };

    let status = {
        lockDisableCompassClick: false
    };

    /**
     * Blink the compass message
     */
    function blink() {
        self.stopBlinking();
        blinkInterval = window.setInterval(function() {
            uiCompass.messageHolder.toggleClass("white-background-75");
            uiCompass.messageHolder.toggleClass("highlight-50");
        }, 500);
    }

    function getCompassMessageHolder() {
        return uiCompass;
    }

    /**
     * Get the angle necessary to move further down the street (using 10 meters further along street as target point).
     * @returns {number}
     */
    function getTargetAngle() {
        const task = taskContainer.getCurrentTask();
        const geometry = task.getFeature();
        const latlng = svl.panoViewer.getPosition();
        const startLatLng = turf.point(task.getFurthestPointReached().geometry.coordinates);
        const streetEnd = turf.point([task.getLastCoordinate().lng, task.getLastCoordinate().lat]);
        const remainder = turf.cleanCoords(turf.lineSlice(startLatLng, streetEnd, geometry));

        // Get the point representing 10 meters further along the street (or the endpoint if there's fewer than 10m).
        const distIncrement = Math.min(0.01, turf.length(remainder));
        const goalLoc = turf.along(remainder, distIncrement).geometry.coordinates;

        // Compute the angle from the current location to the goal location, with respect to true north.
        return ((util.math.toDegrees(Math.atan2(goalLoc[0] - latlng.lng, goalLoc[1] - latlng.lat)) + 360) % 360);
    }

    /**
     * Check if the user is following the route that we specified.
     * @returns {boolean}
     */
    function _checkEnRoute() {
        const task = taskContainer.getCurrentTask();
        if (task) {
            const line = task.getGeoJSON();
            const latlng = svl.panoViewer.getPosition();
            const currentPoint = turf.point([latlng.lng, latlng.lat]);
            return turf.pointToLineDistance(currentPoint, line) < svl.CLOSE_TO_ROUTE_THRESHOLD;
        }
        return true;
    }

    function enableCompassClick() {
        if (!status.lockDisableCompassClick) {
            uiCompass.messageHolder.off('click', _handleCompassClick).on('click', _handleCompassClick);
            uiCompass.messageHolder.css('cursor', 'pointer');
        }
    }

    function disableCompassClick() {
        if (!status.lockDisableCompassClick) {
            uiCompass.messageHolder.off('click', _handleCompassClick);
            uiCompass.messageHolder.css('cursor', 'default');
        }
    }

    function lockDisableCompassClick() {
        status.lockDisableCompassClick = true;
    }

    function unlockDisableCompassClick() {
        status.lockDisableCompassClick = false;
    }

    /*
     * Part of the new jump mechanism
     */
    //  ** start **

    function cancelTimer() {
        window.clearTimeout(blinkTimer);
    }

    function resetBeforeJump() {
        cancelTimer();
        removeLabelBeforeJumpMessage();
    }

    async function _jumpToTheNewTask() {
        svl.tracker.push('LabelBeforeJump_Jump');
        // Finish the current task
        navigationService.finishCurrentTaskBeforeJumping();
        navigationService.setLabelBeforeJumpState(false);

        // Finish clean up tasks before jumping.
        resetBeforeJump();

        const task = taskContainer.getNextTaskAfterJump();
        taskContainer.setCurrentTask(task);
        await navigationService.moveForward();
        svl.panoManager.setPovToRouteDirection();
        svl.jumpModel.triggerUserClickJumpMessage();
    }

    function _makeTheLabelBeforeJumpMessageBoxClickable() {
        let jumpMessageOnclick;
        if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete()) {
            jumpMessageOnclick = function() { svl.neighborhoodModel.trigger("Neighborhood:wrapUpRouteOrNeighborhood"); }
        } else {
            jumpMessageOnclick = _jumpToTheNewTask
        }
        uiCompass.messageHolder.off('click', _jumpToTheNewTask).on('click', jumpMessageOnclick);
        uiCompass.messageHolder.css('cursor', 'pointer');
    }

    function _makeTheLabelBeforeJumpMessageBoxUnclickable() {
        uiCompass.messageHolder.off('click', _jumpToTheNewTask);
        uiCompass.messageHolder.css('cursor', 'default');
    }

    function showLabelBeforeJumpMessage() {
        // Start blinking after 15 seconds.
        blinkTimer = window.setTimeout(function() {
            svl.tracker.push('LabelBeforeJump_Blink');
            self.blink();
        }, 15000);
        self.disableCompassClick();
        _makeTheLabelBeforeJumpMessageBoxClickable();
        _setLabelBeforeJumpMessage();
    }

    function removeLabelBeforeJumpMessage() {
        self.stopBlinking();
        _makeTheLabelBeforeJumpMessageBoxUnclickable();
        self.enableCompassClick();
    }
    // ** end **

    /**
     * Get the compass angle
     * @returns {number}
     */
    function _getCompassAngle() {
        const heading = svl.panoViewer.getPov().heading;
        const targetAngle = getTargetAngle();
        return ((heading - targetAngle + 360) % 360);
    }

    /**
     * Mapping from a direction to an image path of direction icons.
     * @param direction
     * @returns {string|*}
     */
    function directionToImagePath (direction) {
        switch (direction) {
            case "straight":
                return imageDirectories.straight;
            case "slight-right":
                return imageDirectories.slightRight;
            case "slight-left":
                return imageDirectories.slightLeft;
            case "right":
                return imageDirectories.rightTurn;
            case "left":
                return imageDirectories.leftTurn;
            case "u-turn":
                return imageDirectories.uTurn;
            default:
        }
    }

    /**
     * Hide a message
     */
    function hideMessage() {
        uiCompass.messageHolder.removeClass("fadeInUp").addClass("fadeOutDown");
        uiCompass.messageHolder.css('pointer-events', 'none');
    }

    /**
     * Set the compass message.
     */
    function setTurnMessage() {
        const angle = _getCompassAngle();
        const direction = _angleToDirection(angle);

        const image = `<img src="${directionToImagePath(direction)}" class="compass-turn-images" alt="Turn icon"/>`;
        const message =
            `<span class="compass-message-small">${i18next.t('center-ui.compass.unlabeled-problems')}</span>` +
            `<br/>${image}<span class="bold">${_directionToDirectionMessage(direction)}</span>`;
        uiCompass.message.html(message);
    }

    function _setLabelBeforeJumpMessage() {
        if (svl.neighborhoodModel.isRouteComplete) {
            uiCompass.message.html(`<div style="width: 20%">${i18next.t('center-ui.compass.end-route')}</div>`);
        } else if (svl.neighborhoodModel.isNeighborhoodComplete) {
            uiCompass.message.html(`<div style="width: 20%">${i18next.t('center-ui.compass.end-neighborhood')}</div>`);
        } else {
            uiCompass.message.html(`<div style="width: 20%">${i18next.t('center-ui.compass.end-street')}</div>`);
        }
    }

    function _setBackToRouteMessage() {
        uiCompass.message.html(i18next.t('center-ui.compass.far-away'));
    }

    /**
     * Show a message
     */
    function showMessage() {
        uiCompass.messageHolder.removeClass("fadeOutDown").addClass("fadeInUp");
        uiCompass.messageHolder.css('pointer-events', 'auto');
    }

    /**
     * Stop blinking the compass message.
     */
    function stopBlinking() {
        window.clearInterval(blinkInterval);
        blinkInterval = null;
        uiCompass.messageHolder.addClass("white-background-75");
        uiCompass.messageHolder.removeClass("highlight-50");
    }

    /**
     * Update the compass message.
     */
    function update() {
        if (!navigationService.getLabelBeforeJumpState() && !svl.isOnboarding()) {
            if (_checkEnRoute()) {
                self.stopBlinking();
                self.setTurnMessage();
            } else {
                self.blink();
                _setBackToRouteMessage();
            }
        }

    }

    /**
     * Mapping from an angle to a direction
     * @param angle
     * @returns {*}
     */
    function _angleToDirection (angle) {
        if (angle < 20 || angle > 340)
            return "straight";
        else if (angle >= 20 && angle < 45)
            return "slight-left";
        else if (angle <= 340 && angle > 315)
            return "slight-right";
        else if (angle >= 45 && angle < 150)
            return "left";
        else if (angle <= 315 && angle > 210)
            return "right";
        else if (angle <= 210 && angle >= 150) {
            return "u-turn";
        }
        else {
            console.debug("It shouldn't reach here.");
        }
    }

    /**
     * Mapping from direction to a description of the direction
     * @param direction
     * @returns {*}
     */
    function _directionToDirectionMessage (direction) {
        switch (direction) {
            case "straight":
                return i18next.t('center-ui.compass.straight');
            case "slight-right":
                return i18next.t('center-ui.compass.slight-right');
            case "slight-left":
                return i18next.t('center-ui.compass.slight-left');
            case "right":
                return i18next.t('center-ui.compass.right');
            case "left":
                return i18next.t('center-ui.compass.left');
            case "u-turn":
                return i18next.t('center-ui.compass.u-turn');
            default:
        }
    }

    // Performs the action written in the compass message for the user (turning, moving ahead, jumping).
    async function _handleCompassClick() {
        if (_checkEnRoute()) {
            svl.stuckAlert.compassOrStuckClicked();

            const angle = _getCompassAngle();
            const direction = _angleToDirection(angle);
            svl.tracker.push(`Click_Compass_Direction=${direction}`);

            if (direction === 'straight') {
                await navigationService.moveForward()
                    .then(() => svl.tracker.push('CompassMove_Success'))
                    .catch(() => svl.tracker.push('CompassMove_PanoNotAvailable'));
            } else {
                svl.panoManager.setPovToRouteDirection(250);
            }
        } else {
            svl.tracker.push('Click_Compass_FarFromRoute');
            navigationService.preparePovReset();
            await navigationService.moveForward();
            svl.panoManager.setPovToRouteDirection();
        }
    }
    enableCompassClick();

    self.blink = blink;
    self.directionToImagePath = directionToImagePath;
    self.resetBeforeJump = resetBeforeJump;
    self.getCompassMessageHolder = getCompassMessageHolder;
    self.getTargetAngle = getTargetAngle;
    self.hideMessage = hideMessage;
    self.setTurnMessage = setTurnMessage;
    self.enableCompassClick = enableCompassClick;
    self.disableCompassClick = disableCompassClick;
    self.lockDisableCompassClick = lockDisableCompassClick;
    self.unlockDisableCompassClick = unlockDisableCompassClick;
    self.stopBlinking = stopBlinking;
    self.showMessage = showMessage;
    self.showLabelBeforeJumpMessage = showLabelBeforeJumpMessage;
    self.removeLabelBeforeJumpMessage = removeLabelBeforeJumpMessage;
    self.update = update;

    return self;
}
