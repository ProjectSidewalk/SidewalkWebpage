function Compass ($) {
    "use strict";
    var self = { className : 'Compass' },
        status = {},
        properties = {};

    var imageDirectories = {
        leftTurn: svl.rootDirectory + 'img/icons/ArrowLeftTurn.png',
        rightTurn: svl.rootDirectory + 'img/icons/ArrowRightTurn.png',
        slightLeft: svl.rootDirectory + 'img/icons/ArrowSlightLeft.png',
        slightRight: svl.rootDirectory + 'img/icons/ArrowSlightRight.png',
        straight: svl.rootDirectory + 'img/icons/ArrowStraight.png',
        uTurn: svl.rootDirectory + 'img/icons/ArrowUTurn.png'
    };

    var height = 50, width = 50, padding = {
        top: 5,
        right: 5,
        bottom: 5,
        left: 5
    },
        el = d3.select('#compass-holder'),
        svg = el.append('svg'),
        chart = svg.append('g'),
        needle;

    function _init() {
        svg.attr('width', width + padding.left + padding.right)
            .attr('height', height + padding.top + padding.bottom + 30)
            .style({ position: 'absolute', left: 0, top: 0 });
        chart.transition(100).attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.bottom) + ')');

        needle = chart.append('path')
            .attr('d', 'M 0 -' + (width / 2 - 3) + ' L 10 9 L 0 6 L -10 9 z')
            .attr('fill', 'white')
            .attr('stroke', 'white')
            .attr('stroke-width', 1);

    }

    /**
     * Get the angle to the next goal.
     * @returns {number}
     */
    function getTargetAngle () {
        var latlng = svl.getPosition(),  // current position
            geometry = svl.task.getGeometry(),  // get the street geometry of the current task
            coordinates = geometry.coordinates,  // get the latlng coordinates of the streets
            distArray = coordinates.map(function(o) { return Math.sqrt(norm(latlng.lat, latlng.lng, o[1], o[0])); }),
            minimum = Math.min.apply(Math, distArray),
            argmin = distArray.indexOf(minimum),
            argTarget;
        // argTarget = (argmin < (coordinates.length - 1)) ? argmin + 1 : geometry.coordinates.length - 1;
        argTarget = (argmin < (coordinates.length - 1)) ? argmin + 1 : geometry.coordinates.length - 1;

        //var goal = coordinates[coordinates.length - 1];
        //return svl.util.math.toDegrees(Math.atan2(goal[0] - latlng.lng, goal[1] - latlng.lat));
        return svl.util.math.toDegrees(Math.atan2(coordinates[argTarget][0] - latlng.lng, coordinates[argTarget][1] - latlng.lat));
    }

    /**
     * Get the compass angle
     * @returns {number}
     */
    function getCompassAngle () {
        var heading = svl.getPOV().heading,
            targetAngle = getTargetAngle();
        return heading - targetAngle;
    }

    /** Return the sum of square of lat and lng diffs */
    function norm (lat1, lng1, lat2, lng2) {
        return Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2);
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
        needle.transition(100)
            .attr('fill', rgb);
        chart.transition(100)
            .attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.left) + ') rotate(' + (-compassAngle) + ')');
    }

    function angleToDirection (angle) {
        angle = (angle + 360) % 360;
        if (angle < 20 || angle > 340)
            return "straight";
        else if (angle >= 20 && angle < 45)
            return "left";  // return "slight-left";
        else if (angle <= 340 && angle > 315)
            return "right";  // return "slight-right";
        else if (angle >= 35 && angle < 180)
            return "left";
        else if (angle <= 315 && angle >= 180)
            return "right";
        else {
            console.debug("It shouldn't reach here.");
        }
    }

    function directionToDirectionMessage(direction) {
        switch (direction) {
            case "straight":
                return "Keep walking straight";
            case "slight-right":
                return "Turn slightly towards right";
            case "slight-left":
                return "Turn slightly towards left";
            case "right":
                return "Turn right";
            case "left":
                return "Turn left";
            default:
        }
    }

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
            default:
        }
    }

    function setTurnMessage (streetName) {
        var imageFilePath, image, message,
            angle = getCompassAngle(),
            direction = angleToDirection(angle);

        image = "<img src='" + directionToImagePath(direction) + "' class='compass-turn-images' alt='Turn icon' />";
        message =  image + directionToDirectionMessage(direction);
        setMessage(message);
    }

    function setMessage (message) {
        svl.ui.compass.message.html(message);
    }

    function showMessage () {
        svl.ui.compass.messageHolder.removeClass("fadeOutDown").addClass("fadeInUp");
    }

    function hideMessage () {
       svl.ui.compass.messageHolder.removeClass("fadeInUp").addClass("fadeOutDown");
    }

    function updateMessage (streetName) {
        setTurnMessage(streetName);
    }

    self.getCompassAngle = getCompassAngle;
    self.update = update;
    self.hideMessage = hideMessage;
    self.showMessage = showMessage;
    self.setTurnMessage = setTurnMessage;
    self.updateMessage = updateMessage;

    _init();

    return self;
}
