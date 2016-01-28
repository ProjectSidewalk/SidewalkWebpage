function Compass ($) {
    "use strict";
    var self = { className : 'Compass' },
        status = {},
        properties = {};

    var height = 50, width = 50, padding = 5,
        needleRadius = 10,
        el = d3.select('#compass-holder'),
        svg = el.append('svg'),
        chart = svg.append('g');

    svg.attr('width', width + 2 * padding)
        .attr('height', height + 2 * padding)
        .style({ position: 'absolute', left: 660, top: 520 });
    chart.transition(100).attr('transform', 'translate(' + (height / 2) + ', ' + (width / 2) + ')');
    chart.append('circle')
        .attr('cx', 0) .attr('cy', 0).attr('r', width / 2)
        .attr('fill', 'black');
    chart.append('circle')
        .attr('cx', 0) .attr('cy', 10).attr('r', needleRadius)
        .attr('fill', 'white');
    chart.append('path')
        .attr('d', 'M 0 -' + (width / 2 - 3) + ' L 10 9 L -10 9')
        .attr('fill', 'white');


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
        var compassAngle = getCompassAngle();
        // chart.transition(100)
            chart.transition(100).attr('transform', 'translate(' + (height / 2) + ', ' + (width / 2) + ') rotate(' + (-compassAngle) + ')');
    }

    self.update = update;
    return self;
}
