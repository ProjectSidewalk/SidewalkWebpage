/**
 * Compass module
 * @param svl SVL name space. Need this for rootDirectory.
 * @param mapService MapService module
 * @param taskContainer TaskContainer module
 * @param uiCompass ui elements. // Todo. Future work. Just pass the top level ui element.
 * @constructor
 */
function Compass (svl, mapService, taskContainer, uiCompass) {
    var self = {className: 'Compass'};
    var blinkInterval;
    var blinkTimer;

    var imageDirectories = {
        leftTurn: svl.rootDirectory + 'img/icons/ArrowLeftTurn.png',
        rightTurn: svl.rootDirectory + 'img/icons/ArrowRightTurn.png',
        slightLeft: svl.rootDirectory + 'img/icons/ArrowSlightLeft.png',
        slightRight: svl.rootDirectory + 'img/icons/ArrowSlightRight.png',
        straight: svl.rootDirectory + 'img/icons/ArrowStraight.png',
        uTurn: svl.rootDirectory + 'img/icons/ArrowUTurn.png'
    };

    /**
     * Blink the compass message
     */
    function blink() {
        self.stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiCompass.messageHolder.toggleClass("white-background-75");
            uiCompass.messageHolder.toggleClass("highlight-50");
        }, 500);
    }

    function getCompassMessageHolder() {
        return uiCompass;
    }

    /**
     * Get the angle to the next goal.
     * @returns {number}
     */
    function getTargetAngle() {
        var task = taskContainer.getCurrentTask();
        var latlng = mapService.getPosition();
        var geometry = task.getGeometry();  // get the street geometry of the current task
        var coordinates = geometry.coordinates;  // get the latlng coordinates of the streets
        var distArray = coordinates.map(function(o) {
            return Math.sqrt(_norm(latlng.lat, latlng.lng, o[1], o[0]));
        });
        var minimum = Math.min.apply(Math, distArray);
        var argmin = distArray.indexOf(minimum);
        var argTarget;
        argTarget = (argmin < (coordinates.length - 1)) ? argmin + 1 : geometry.coordinates.length - 1;

        return util.math.toDegrees(Math.atan2(coordinates[argTarget][0] - latlng.lng, coordinates[argTarget][1] - latlng.lat));
    }

    /**
     * Check if the user is following the route that we specified.
     * @returns {boolean}
     */
    function _checkEnRoute() {
        var task = taskContainer.getCurrentTask();
        if (task) {
            var line = task.getGeoJSON().features[0];
            var latlng = mapService.getPosition();
            var currentPoint = turf.point([latlng.lng, latlng.lat]);
            return turf.pointToLineDistance(currentPoint, line) < svl.CLOSE_TO_ROUTE_THRESHOLD;
        }
        return true;
    }

    function _jumpBackToTheRoute() {
        var task = taskContainer.getCurrentTask();
        var coordinate = task.getStartCoordinate();
        mapService.preparePovReset();
        mapService.setPosition(coordinate.lat, coordinate.lng);
        mapService.setPovToRouteDirection();
        svl.taskContainer.showNeighborhoodCompleteOverlayIfRequired();
    }

    function enableCompassClick() {
        uiCompass.messageHolder.on('click', _handleCompassClick);
        uiCompass.messageHolder.css('cursor', 'pointer');
    }

    function disableCompassClick() {
        uiCompass.messageHolder.off('click', _handleCompassClick);
        uiCompass.messageHolder.css('cursor', 'default');
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
        mapService.resetBeforeJumpLocationAndListener();
    }

    function _jumpToTheNewTask() {
        svl.tracker.push('LabelBeforeJump_Jump');
        // Finish the current task
        mapService.finishCurrentTaskBeforeJumping();

        // Finish clean up tasks before jumping
        resetBeforeJump();

        var task = taskContainer.getAfterJumpNewTask();
        taskContainer.setCurrentTask(task);
        svl.map.enableWalking(); // Needed so you can click during the 1 second after taking a step.
        mapService.moveToTheTaskLocation(task, true);
        svl.jumpModel.triggerUserClickJumpMessage();
    }

    function _makeTheLabelBeforeJumpMessageBoxClickable() {
        let jumpMessageOnclick;
        if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete()) {
            jumpMessageOnclick = function() { svl.neighborhoodModel.trigger("Neighborhood:wrapUpRouteOrNeighborhood"); }
        } else {
            jumpMessageOnclick = _jumpToTheNewTask
        }
        uiCompass.messageHolder.on('click', jumpMessageOnclick);
        uiCompass.messageHolder.css('cursor', 'pointer');
    }

    function _makeTheLabelBeforeJumpMessageBoxUnclickable () {
        uiCompass.messageHolder.off('click', _jumpToTheNewTask);
        uiCompass.messageHolder.css('cursor', 'default');
    }

    function showLabelBeforeJumpMessage() {
        // Start blinking after 15 seconds.
        blinkTimer = window.setTimeout(function () {
            svl.tracker.push('LabelBeforeJump_Blink');
            self.blink();
        }, 15000);
        self.disableCompassClick();
        _makeTheLabelBeforeJumpMessageBoxClickable();
        self.setLabelBeforeJumpMessage();
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
    function _getCompassAngle () {
        var heading = mapService.getPov().heading;
        var targetAngle = getTargetAngle();
        return (heading - targetAngle) % 360;
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
    function hideMessage () {
        uiCompass.messageHolder.removeClass("fadeInUp").addClass("fadeOutDown");
        uiCompass.messageHolder.css('pointer-events', 'none');
    }

    /**
     * Set the compass message.
     */
    function setTurnMessage () {
        var image,
            message,
            angle = _getCompassAngle(),
            direction = _angleToDirection(angle);

        image = "<img src='" + directionToImagePath(direction) + "' class='compass-turn-images' alt='Turn icon' />";
        message =  "<span class='compass-message-small'>" + i18next.t('center-ui.compass.unlabeled-problems') + "</span><br/>" +
            image + "<span class='bold'>" + _directionToDirectionMessage(direction) + "</span>";
        uiCompass.message.html(message);
    }

    function setLabelBeforeJumpMessage() {
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
    function showMessage () {
        uiCompass.messageHolder.removeClass("fadeOutDown").addClass("fadeInUp");
        uiCompass.messageHolder.css('pointer-events', 'auto');
    }

    /**
     * Stop blinking the compass message.
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        blinkInterval = null;
        uiCompass.messageHolder.addClass("white-background-75");
        uiCompass.messageHolder.removeClass("highlight-50");
    }

    /**
     * Update the compass message.
     */
    function update () {
        if (!mapService.getLabelBeforeJumpListenerStatus() && !svl.isOnboarding()) {
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
        angle = (angle + 360) % 360;
        if (angle < 20 || angle > 340)
            return "straight";
        else if (angle >= 20 && angle < 45)
            return "slight-left";
        else if (angle <= 340 && angle > 315)
            return "slight-right";
        else if (angle >= 35 && angle < 150)
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


    /**
     * Return the sum of square of lat and lng diffs
     * */
    function _norm(lat1, lng1, lat2, lng2) {
        return Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2);
    }

    /**
     * Update the message
     * @param streetName
     */
    function updateMessage(streetName) {
        self.setTurnMessage(streetName);
    }

    // Performs the action written in the compass message for the user (turning, moving ahead, jumping).
    function _handleCompassClick() {
        if (_checkEnRoute()) {
            svl.stuckAlert.compassOrStuckClicked();

            var angle = _getCompassAngle();
            var direction = _angleToDirection(angle);
            svl.tracker.push(`Click_Compass_Direction=${direction}`);

            if (direction === 'straight') {
                mapService.moveForward('CompassMove_Success', 'CompassMove_GSVNotAvailable', null);
            } else {
                mapService.setPovToRouteDirection(250);
            }
        } else {
            svl.tracker.push('Click_Compass_FarFromRoute');
            _jumpBackToTheRoute();
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
    self.setLabelBeforeJumpMessage = setLabelBeforeJumpMessage;
    self.stopBlinking = stopBlinking;
    self.showMessage = showMessage;
    self.showLabelBeforeJumpMessage = showLabelBeforeJumpMessage;
    self.removeLabelBeforeJumpMessage = removeLabelBeforeJumpMessage;
    self.update = update;
    self.updateMessage = updateMessage;

    return self;
}