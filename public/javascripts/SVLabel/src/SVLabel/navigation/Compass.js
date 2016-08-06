/**
 * Compass module
 * @param d3 d3 module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Compass (d3, turf) {
    "use strict";
    var self = { className : 'Compass' },
        blinkInterval;

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

    function _init() {
        svg.attr('width', width + padding.left + padding.right)
            .attr('height', height + padding.top + padding.bottom + 30)
            .style({ position: 'absolute', left: 0, top: 0 });

        // chart.transition(100).attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.bottom) + ')');
        // needle = chart.append('path')
        //         .attr('d', 'M 0 -' + (width / 2 - 3) + ' L 10 9 L 0 6 L -10 9 z')
        //         .attr('fill', 'white')
        //         .attr('stroke', 'white')
        //         .attr('stroke-width', 1);
    }

    /**
     * Mapping from an angle to a direction
     * @param angle
     * @returns {*}
     */
    function angleToDirection (angle) {
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
     * Blink the compass message
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.compass.messageHolder.toggleClass("white-background-75");
            svl.ui.compass.messageHolder.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Check if the user is following the route that we specified
     * @param threshold
     * @param unit
     * @returns {boolean}
     */
    function checkEnRoute (threshold, unit) {
        var task = svl.taskContainer.getCurrentTask();
        if (!unit) unit = "kilometers";
        if (!threshold) threshold = 0.05;  // 50 m

        if (task) {
            var geojson = task.getGeoJSON(),
                latlng = svl.map.getPosition(),
                line = geojson.features[0],
                currentPoint = turf.point([latlng.lng, latlng.lat]),
                snapped = turf.pointOnLine(line, currentPoint);
            return turf.distance(currentPoint, snapped, unit) < threshold;
        }
        return true;
    }

    /**
     * Mapping from direction to a description of the direction
     * @param direction
     * @returns {*}
     */
    function directionToDirectionMessage(direction) {
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
     * Mapping from a direction to an image path of direction icons.
     * @param direction
     * @returns {string|*}
     */
    function directionToImagePath(direction) {
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
     * Get the angle to the next goal.
     * @returns {number}
     */
    function getTargetAngle () {
        var task = svl.taskContainer.getCurrentTask(),
            latlng = svl.map.getPosition(),  // current position
            geometry = task.getGeometry(),  // get the street geometry of the current task
            coordinates = geometry.coordinates,  // get the latlng coordinates of the streets
            distArray = coordinates.map(function(o) { return Math.sqrt(norm(latlng.lat, latlng.lng, o[1], o[0])); }),
            minimum = Math.min.apply(Math, distArray),
            argmin = distArray.indexOf(minimum),
            argTarget;
        argTarget = (argmin < (coordinates.length - 1)) ? argmin + 1 : geometry.coordinates.length - 1;

        return svl.util.math.toDegrees(Math.atan2(coordinates[argTarget][0] - latlng.lng, coordinates[argTarget][1] - latlng.lat));
    }

    /**
     * Get the compass angle
     * @returns {number}
     */
    function getCompassAngle () {
        var heading = svl.map.getPov().heading, targetAngle = getTargetAngle();
        return heading - targetAngle;
    }

    /**
     * Hide a message
     */
    function hideMessage () {
        svl.ui.compass.messageHolder.removeClass("fadeInUp").addClass("fadeOutDown");
    }

    /**
     * Return the sum of square of lat and lng diffs
     * */
    function norm (lat1, lng1, lat2, lng2) {
        return Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2);
    }

    /**
     * Set the compass message.
     */
    function setTurnMessage () {
        var image, message,
            angle = getCompassAngle(),
            direction = angleToDirection(angle);

        image = "<img src='" + directionToImagePath(direction) + "' class='compass-turn-images' alt='Turn icon' />";
        message =  "<span class='compass-message-small'>Do you see any unlabeled problems? If not,</span><br/>" + image + "<span class='bold'>" + directionToDirectionMessage(direction) + "</span>";
        // message =  image + "<span class='bold'>" + directionToDirectionMessage(direction) + "</span>";
        svl.ui.compass.message.html(message);
    }

    /**
     * Show a message
     */
    function showMessage () {
        svl.ui.compass.messageHolder.removeClass("fadeOutDown").addClass("fadeInUp");
    }

    /**
     * Stop blinking the compass message.
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        blinkInterval = null;
        svl.ui.compass.messageHolder.addClass("white-background-75");
        svl.ui.compass.messageHolder.removeClass("highlight-50");
    }

    /**
     * Update the compass visualization
     */
    function update () {
        var compassAngle = getCompassAngle(),
            cosine = Math.cos(compassAngle / 360 * 2 * Math.PI),
            val = (cosine + 1) / 2,
            r = 229 - 185 * val, g = 245 - 83 * val, b = 249 - 154 * val, rgb = 'rgb(' + r + ',' + g + ',' + b + ')';

        // http://colorbrewer2.org/ (229,245,249), (44,162,95)
        if (needle && chart) {
            needle.transition(100)
                .attr('fill', rgb);
            chart.transition(100)
                .attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.left) + ') rotate(' + (-compassAngle) + ')');
        }

        setTurnMessage();

        if (checkEnRoute()) {
            stopBlinking();
        } else {
            blink();
        }
    }

    /**
     * Update the message
     * @param streetName
     */
    function updateMessage (streetName) {
        setTurnMessage(streetName);
    }

    self.blink = blink;
    self.getCompassAngle = getCompassAngle;
    self.hideMessage = hideMessage;
    self.showMessage = showMessage;
    self.setTurnMessage = setTurnMessage;
    self.stopBlinking = stopBlinking;
    self.updateMessage = updateMessage;
    self.update = update;

    _init();
    return self;
}
