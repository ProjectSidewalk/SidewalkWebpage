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
        el = d3.select('#compass-holder'),
        svg = el.append('svg'),
        chart = svg.append('g'),
        needle;

    svg.attr('width', width + padding.left + padding.right)
        .attr('height', height + padding.top + padding.bottom + 30)
        .style({ position: 'absolute', left: 660, top: 525 });
    chart.transition(100).attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.bottom) + ')');
    // label.attr('transform', 'translate(0, 0)');

    //chart.append('circle')
    //    .attr('cx', 0) .attr('cy', 0).attr('r', width / 2)
    //    .attr('fill', 'black');
    //chart.append('circle')
    //    .attr('cx', 0) .attr('cy', 10).attr('r', needleRadius)
    //    .attr('fill', 'white');
    needle = chart.append('path')
        .attr('d', 'M 0 -' + (width / 2 - 3) + ' L 10 9 L 0 6 L -10 9 z')
        .attr('fill', 'white')
        .attr('stroke', 'white')
        .attr('stroke-width', 1);


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

    self.update = update;
    return self;
}
