function Compass ($) {
    "use strict";
    var self = { className : 'Compass' },
        status = {},
        properties = {};

    var height = 50, width = 50, padding = {
        top: 5,
        right: 5,
        bottom: 5,
        left: 5
    },
        needleRadius = 10,
        el = d3.select('#compass-holder'),
        svg = el.append('svg'),
        chart = svg.append('g'),
        label = svg.append('g');

    svg.attr('width', width + padding.left + padding.right)
        .attr('height', height + padding.top + padding.bottom + 30)
        .style({ position: 'absolute', left: 660, top: 510 });
    chart.transition(100).attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.bottom) + ')');
    // label.attr('transform', 'translate(0, 0)');

    chart.append('circle')
        .attr('cx', 0) .attr('cy', 0).attr('r', width / 2)
        .attr('fill', 'black');
    chart.append('circle')
        .attr('cx', 0) .attr('cy', 10).attr('r', needleRadius)
        .attr('fill', 'white');
    chart.append('path')
        .attr('d', 'M 0 -' + (width / 2 - 3) + ' L 10 9 L -10 9')
        .attr('fill', 'white');


    //label.append('text')
    //    .attr("x", 0)
    //    .attr("y", 65)
    //    .attr("dy", ".35em")
    //    .text("Walking direction")
    //    .style({
    //        visibility: 'visible',
    //        fill: 'white',
    //        font: '10px sans-serif'
    //    });


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
            chart.transition(100).attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.left) + ') rotate(' + (-compassAngle) + ')');
    }

    self.update = update;
    return self;
}
