/**
 * Compass module
 * @param svl SVL name space. Need this for rootDirectory.
 * @param mapService MapService module
 * @param taskContainer TaskContainer module
 * @param uiCompass ui elements. // Todo. Future work. Just pass the top level ui element.
 * @constructor
 */
function Compass (svl, mapService, taskContainer, uiCompass) {
    var self = this;
    var blinkInterval;

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
    this.blink = function() {
        this.stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiCompass.messageHolder.toggleClass("white-background-75");
            uiCompass.messageHolder.toggleClass("highlight-50");
        }, 500);
    };

    /**
     * Check if the user is following the route that we specified
     * @param threshold
     * @param unit
     * @returns {boolean}
     */
    this._checkEnRoute = function (threshold, unit) {
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
    };

    /**
     * Get the angle to the next goal.
     * @returns {number}
     */
    this._getTargetAngle = function () {
        var task = taskContainer.getCurrentTask();
        var latlng = mapService.getPosition();
        var geometry = task.getGeometry();  // get the street geometry of the current task
        var coordinates = geometry.coordinates;  // get the latlng coordinates of the streets
        var distArray = coordinates.map(function(o) {
            return Math.sqrt(self._norm(latlng.lat, latlng.lng, o[1], o[0]));
        });
        var minimum = Math.min.apply(Math, distArray);
        var argmin = distArray.indexOf(minimum);
        var argTarget;
        argTarget = (argmin < (coordinates.length - 1)) ? argmin + 1 : geometry.coordinates.length - 1;

        return util.math.toDegrees(Math.atan2(coordinates[argTarget][0] - latlng.lng, coordinates[argTarget][1] - latlng.lat));
    };

    this._jumpBackToTheRoute = function () {
        var task = taskContainer.getCurrentTask();
        var coordinate = task.getStartCoordinate();
        mapService.setPosition(coordinate.lat, coordinate.lng);
    };

    this._makeTheMessageBoxClickable = function () {
        var events = $._data(uiCompass.messageHolder[0], "events");
        if (!events) {
            uiCompass.messageHolder.on('click', this._jumpBackToTheRoute);
            uiCompass.messageHolder.css('cursor', 'pointer');
        }
    };

    this._makeTheMessageBoxUnclickable = function () {
        uiCompass.messageHolder.off('click', this._jumpBackToTheRoute);
        uiCompass.messageHolder.css('cursor', 'default');
    };

    /**
     * Get the compass angle
     * @returns {number}
     */
    this.getCompassAngle = function () {
        var heading = mapService.getPov().heading;
        var targetAngle = this._getTargetAngle();
        return heading - targetAngle;
    };

    /**
     * Mapping from a direction to an image path of direction icons.
     * @param direction
     * @returns {string|*}
     */
    this._directionToImagePath = function (direction) {
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
    };

    /**
     * Hide a message
     */
    this.hideMessage = function () {
        uiCompass.messageHolder.removeClass("fadeInUp").addClass("fadeOutDown");
    };

    /**
     * Set the compass message.
     */
    this.setTurnMessage = function () {
        var image,
            message,
            angle = this.getCompassAngle(),
            direction = this._angleToDirection(angle);

        image = "<img src='" + this._directionToImagePath(direction) + "' class='compass-turn-images' alt='Turn icon' />";
        message =  "<span class='compass-message-small'>Do you see any unlabeled problems? If not,</span><br/>" +
            image + "<span class='bold'>" + this._directionToDirectionMessage(direction) + "</span>";
        uiCompass.message.html(message);
    };

    this.setBackToRouteMessage = function () {
        var message = "Uh-oh, you're quite far away from the audit route, <br />" +
            "<span class='bold'>click here to jump back.</span>";
        uiCompass.message.html(message);
    };

    /**
     * Show a message
     */
    this.showMessage = function () {
        uiCompass.messageHolder.removeClass("fadeOutDown").addClass("fadeInUp");
    };

    /**
     * Stop blinking the compass message.
     */
    this.stopBlinking = function () {
        window.clearInterval(blinkInterval);
        blinkInterval = null;
        uiCompass.messageHolder.addClass("white-background-75");
        uiCompass.messageHolder.removeClass("highlight-50");
    };

    /**
     * Update the compass visualization
     */
    this.update = function () {
        var compassAngle = this.getCompassAngle(),
            cosine = Math.cos(compassAngle / 360 * 2 * Math.PI),
            val = (cosine + 1) / 2,
            r = 229 - 185 * val, g = 245 - 83 * val, b = 249 - 154 * val, rgb = 'rgb(' + r + ',' + g + ',' + b + ')';

        if (needle && chart) {
            needle.transition(100)
                .attr('fill', rgb);
            chart.transition(100)
                .attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.left) + ') rotate(' + (-compassAngle) + ')');
        }

        this.setTurnMessage();

        if (this._checkEnRoute()) {
            this.stopBlinking();
            this._makeTheMessageBoxUnclickable();
        } else {
            this.blink();
            this._makeTheMessageBoxClickable();
            this.setBackToRouteMessage();
        }
    };
}

/**
 * Mapping from an angle to a direction
 * @param angle
 * @returns {*}
 */
Compass.prototype._angleToDirection = function (angle) {
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
};

/**
 * Mapping from direction to a description of the direction
 * @param direction
 * @returns {*}
 */
Compass.prototype._directionToDirectionMessage = function (direction) {
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
};


/**
 * Return the sum of square of lat and lng diffs
 * */
Compass.prototype._norm = function (lat1, lng1, lat2, lng2) {
    return Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2);
};

/**
 * Update the message
 * @param streetName
 */
Compass.prototype.updateMessage = function (streetName) {
    this.setTurnMessage(streetName);
};