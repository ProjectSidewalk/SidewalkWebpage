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

    var height = 50, width = 50, padding = { top: 5, right: 5, bottom: 5, left: 5 },
        el = d3.select('#compass-holder'),
        svg = el.append('svg'),
        chart = svg.append('g'),
        needle;

    svg.attr('width', width + padding.left + padding.right)
        .attr('height', height + padding.top + padding.bottom + 30)
        .style({ position: 'absolute', left: 0, top: 0 });

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
    function _getTargetAngle() {
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
     * Check if the user is following the route that we specified
     * @param threshold
     * @param unit
     * @returns {boolean}
     */
    function _checkEnRoute (threshold, unit) {
        var task = taskContainer.getCurrentTask();
        if (!unit) unit = "kilometers";
        if (!threshold) threshold = 0.05;  // 50 m

        if (task) {
            var geojson = task.getGeoJSON(),
                latlng = mapService.getPosition(),
                line = geojson.features[0],
                currentPoint = turf.point([latlng.lng, latlng.lat]),
                snapped = turf.pointOnLine(line, currentPoint);
            return turf.distance(currentPoint, snapped, unit) < threshold;
        }
        return true;
    }

    function _jumpBackToTheRoute() {
        var task = taskContainer.getCurrentTask();
        var coordinate = task.getStartCoordinate();
        mapService.preparePovReset();
        mapService.setPosition(coordinate.lat, coordinate.lng);
        mapService.setPovToRouteDirection();
        // mapService.resetPanoChange();
    }

    function _makeTheMessageBoxClickable() {
        var events = $._data(uiCompass.messageHolder[0], "events");
        if (!events) {
            uiCompass.messageHolder.on('click', _jumpBackToTheRoute);
            uiCompass.messageHolder.css('cursor', 'pointer');
        }
    }

    function _makeTheMessageBoxUnclickable () {
        uiCompass.messageHolder.off('click', _jumpBackToTheRoute);
        uiCompass.messageHolder.css('cursor', 'default');
    }

    /*
     * Part of the new jump mechanism
     */
    //  ** start **

    function cancelTimer() {
        window.clearTimeout(blinkTimer);
    }

    function resetBeforeJump () {
        cancelTimer();
        removeLabelBeforeJumpMessage();
        mapService.resetBeforeJumpLocationAndListener();
    }

    function _jumpToTheNewRoute () {

        svl.tracker.push('LabelBeforeJump_Jump');
        // Finish the current task
        mapService.finishCurrentTaskBeforeJumping();

        // Finish clean up tasks before jumping
        resetBeforeJump();

        var task = taskContainer.getBeforeJumpNewTask();
        taskContainer.setCurrentTask(task);
        mapService.moveToTheTaskLocation(task);
        svl.jumpModel.triggerUserClickJumpMessage();
    }

    function _makeTheLabelBeforeJumpMessageBoxClickable () {
        var events = $._data(uiCompass.messageHolder[0], "events");
        if (!events) {
            uiCompass.messageHolder.on('click', _jumpToTheNewRoute);
            uiCompass.messageHolder.css('cursor', 'pointer');
        }
    }

    function _makeTheLabelBeforeJumpMessageBoxUnclickable () {
        uiCompass.messageHolder.off('click', _jumpToTheNewRoute);
        uiCompass.messageHolder.css('cursor', 'default');
    }

    function showLabelBeforeJumpMessage () {
        // Start blinking after 15 seconds
        blinkTimer = window.setTimeout(function () {
            svl.tracker.push('LabelBeforeJump_Blink');
            self.blink();
        }, 15000);
        _makeTheLabelBeforeJumpMessageBoxClickable();
        self.setLabelBeforeJumpMessage();
    }

    function removeLabelBeforeJumpMessage () {
        self.stopBlinking();
        _makeTheLabelBeforeJumpMessageBoxUnclickable();
    }
    // ** end **

    /**
     * Get the compass angle
     * @returns {number}
     */
    function getCompassAngle () {
        var heading = mapService.getPov().heading;
        var targetAngle = _getTargetAngle();
        return heading - targetAngle;
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
    }

    /**
     * Set the compass message.
     */
    function setTurnMessage () {
        var image,
            message,
            angle = self.getCompassAngle(),
            direction = _angleToDirection(angle);

        image = "<img src='" + directionToImagePath(direction) + "' class='compass-turn-images' alt='Turn icon' />";
        message =  "<span class='compass-message-small'>Do you see any unlabeled problems? If not,</span><br/>" +
            image + "<span class='bold'>" + _directionToDirectionMessage(direction) + "</span>";
        uiCompass.message.html(message);
    }

    function setLabelBeforeJumpMessage () {
        var message = "<div style='width: 20%'>You have reached the end of this route. Finish labeling this intersection then <br/> " +
            "<span class='bold'>click here to move to a new location.</span></div>";
        uiCompass.message.html(message);
    }

    function setBackToRouteMessage () {
        var message = "Uh-oh, you're quite far away from the audit route. <br />" +
            "<span class='bold'>Click here to jump back.</span>";
        uiCompass.message.html(message);
    }

    /**
     * Show a message
     */
    function showMessage () {
        uiCompass.messageHolder.removeClass("fadeOutDown").addClass("fadeInUp");
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
     * Update the compass visualization
     */
    function update () {
        var compassAngle = self.getCompassAngle(),
            cosine = Math.cos(compassAngle / 360 * 2 * Math.PI),
            val = (cosine + 1) / 2,
            r = 229 - 185 * val, g = 245 - 83 * val, b = 249 - 154 * val, rgb = 'rgb(' + r + ',' + g + ',' + b + ')';

        if (needle && chart) {
            needle.transition(100)
                .attr('fill', rgb);
            chart.transition(100)
                .attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.left) + ') rotate(' + (-compassAngle) + ')');
        }

        if (!mapService.getLabelBeforeJumpListenerStatus()) {
            self.setTurnMessage();

            if (_checkEnRoute() || svl.isOnboarding()) {
                self.stopBlinking();
                _makeTheMessageBoxUnclickable();
            }
            else {
                self.blink();
                _makeTheMessageBoxClickable();
                self.setBackToRouteMessage();
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
                return "Walk straight";
            case "slight-right":
                return "Turn slightly towards right";
            case "slight-left":
                return "Turn slightly towards left";
            case "right":
                return "Turn right";
            case "left":
                return "Turn left";
            case "u-turn":
                return "U turn";
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

    self.blink = blink;
    self.directionToImagePath = directionToImagePath;
    self.resetBeforeJump = resetBeforeJump;
    self.getCompassAngle = getCompassAngle;
    self.getCompassMessageHolder = getCompassMessageHolder;
    self.hideMessage = hideMessage;
    self.setTurnMessage = setTurnMessage;
    self.setLabelBeforeJumpMessage = setLabelBeforeJumpMessage;
    self.setBackToRouteMessage = setBackToRouteMessage;
    self.stopBlinking = stopBlinking;
    self.showMessage = showMessage;
    self.showLabelBeforeJumpMessage = showLabelBeforeJumpMessage;
    self.removeLabelBeforeJumpMessage = removeLabelBeforeJumpMessage;
    self.update = update;
    self.updateMessage = updateMessage;

    return self;
}