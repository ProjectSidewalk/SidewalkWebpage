/**
 * Task module.
 * @param turf
 * @param geojson
 * @param currentLat
 * @param currentLng
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Task (turf, geojson, currentLat, currentLng) {
    var self = {className: 'Task'},
        _geojson,
        lat,
        lng,
        lastLat,
        lastLng,
        taskCompletionRate = 0,
        paths, previousPaths = [],
        status = {
            isCompleted: false
        },
        properties = {
            auditTaskId: null,
            streetEdgeId: null
        };

    /**
     * This method takes a task parameters and set up the current task.
     * @param geojson Description of the next task in json format.
     * @param currentLat Current latitude
     * @param currentLng Current longitude
     */
    function _init (geojson, currentLat, currentLng) {
        var len = geojson.features[0].geometry.coordinates.length - 1,
            lat1 = geojson.features[0].geometry.coordinates[0][1],
            lng1 = geojson.features[0].geometry.coordinates[0][0],
            lat2 = geojson.features[0].geometry.coordinates[len][1],
            lng2 = geojson.features[0].geometry.coordinates[len][0];
        _geojson = geojson;

        setProperty("streetEdgeId", _geojson.features[0].properties.street_edge_id);

        if (currentLat && currentLng) {
            // Continuing from the previous task (i.e., currentLat and currentLng exist).
            var d1 = svl.util.math.haversine(lat1, lng1, currentLat, currentLng),
                d2 = svl.util.math.haversine(lat2, lng2, currentLat, currentLng);

            if (d2 < d1) reverseCoordinates();
        }

        lat = _geojson.features[0].geometry.coordinates[0][1];
        lng = _geojson.features[0].geometry.coordinates[0][0];

        paths = null;
    }

    /**
     * Get the index of the segment in the line that is closest to the point
     * @param point A geojson Point feature
     * @param line A geojson LineString Feature
     */
    function closestSegment(point, line) {
        var coords = line.geometry.coordinates,
            lenCoord = coords.length,
            segment, lengthArray = [], minValue;

        for (var i = 0; i < lenCoord - 1; i++) {
            segment = turf.linestring([ [coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]] ]);
            lengthArray.push(pointSegmentDistance(point, segment));
        }
        minValue = Math.min.apply(null, lengthArray);
        return lengthArray.indexOf(minValue);
    }


    /**
     * Set the isCompleted status to true
     * @returns {complete}
     */
    function complete () {
        status.isCompleted = true;
        return this;
    }


    function completedTaskPaths () {
        var i,
            newPaths,
            latlng = svl.map.getPosition(),
            lat = latlng.lat,
            lng = latlng.lng,
            line = _geojson.features[0],
            currentPoint = turf.point([lng, lat]),
            snapped = turf.pointOnLine(line, currentPoint),
            closestSegmentIndex = closestSegment(currentPoint, line),
            coords = line.geometry.coordinates,
            segment,
            completedPath = [new google.maps.LatLng(coords[0][1], coords[0][0])],
            incompletePath = [];
        for (i = 0; i < closestSegmentIndex; i++) {
            segment = turf.linestring([ [coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]] ]);
            completedPath.push(new google.maps.LatLng(coords[i + 1][1], coords[i + 1][0]));
        }
        completedPath.push(new google.maps.LatLng(snapped.geometry.coordinates[1], snapped.geometry.coordinates[0]));
        incompletePath.push(new google.maps.LatLng(snapped.geometry.coordinates[1], snapped.geometry.coordinates[0]));

        for (i = closestSegmentIndex; i < coords.length - 1; i++) {
            incompletePath.push(new google.maps.LatLng(coords[i + 1][1], coords[i + 1][0]))
        }

        // Create paths
        newPaths = [
            new google.maps.Polyline({
                path: completedPath,
                geodesic: true,
                strokeColor: '#00ff00',
                strokeOpacity: 1.0,
                strokeWeight: 2
            }),
            new google.maps.Polyline({
                path: incompletePath,
                geodesic: true,
                strokeColor: '#ff0000',
                strokeOpacity: 1.0,
                strokeWeight: 2
            })
        ];

        return newPaths;
    }


    function getAuditTaskId () {
        return properties.auditTaskId;
    }

    /**
     * Get a geojson feature
     * @returns {null}
     */
    function getFeature () {
        return _geojson ? _geojson.features[0] : null;
    }

    /**
     * Get geojson
     * @returns {*}
     */
    function getGeoJSON () { 
        return _geojson; 
    }

    /**
     * Get geometry
     */
    function getGeometry () {
        return _geojson ? _geojson.features[0].geometry : null;
    }

    /**
     * Get the last coordinate in the geojson.
     * @returns {{lat: *, lng: *}}
     */
    function getLastCoordinate () {
        var len = geojson.features[0].geometry.coordinates.length - 1,
            lat = _geojson.features[0].geometry.coordinates[len][1],
            lng = _geojson.features[0].geometry.coordinates[len][0];
        return { lat: lat, lng: lng };
    }

    /**
     * Return the property
     * @param key Field name
     * @returns {null}
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Get the first coordinate in the geojson
     * @returns {{lat: *, lng: *}}
     */
    function getStartCoordinate () {
        var lat = _geojson.features[0].geometry.coordinates[0][1],
            lng = _geojson.features[0].geometry.coordinates[0][0];
        return { lat: lat, lng: lng };
    }

    /**
     * Returns the street edge id of the current task.
     */
    function getStreetEdgeId () {
        return _geojson.features[0].properties.street_edge_id;
    }


    /**
     * References:
     * http://turfjs.org/static/docs/module-turf_point-on-line.html
     * http://turfjs.org/static/docs/module-turf_distance.html
     */
    function getTaskCompletionRate () {
        var i,
            point,
            lineLength,
            cumsumRate,
            latlng = svl.map.getPosition(),
            line = _geojson.features[0],
            currentPoint = turf.point([latlng.lng, latlng.lat]),
            snapped = turf.pointOnLine(line, currentPoint),
            closestSegmentIndex = closestSegment(currentPoint, line),
            coords = line.geometry.coordinates,
            segment,
            cumSum = 0;
        for (i = 0; i < closestSegmentIndex; i++) {
            segment = turf.linestring([ [coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]] ]);
            cumSum += turf.lineDistance(segment);
        }

        point = turf.point([coords[closestSegmentIndex][0], coords[closestSegmentIndex][1]]);
        cumSum += turf.distance(snapped, point);
        lineLength = turf.lineDistance(line);
        cumsumRate = cumSum / lineLength;

        return taskCompletionRate < cumsumRate ? cumsumRate : taskCompletionRate;
    }

    /**
     * Returns the task start time
     */
    function getTaskStart () {
        return _geojson.features[0].properties.task_start;
    }

    /**
     * Get the cumulative distance
     * Reference:
     * turf-line-distance: https://github.com/turf-junkyard/turf-line-distance
     *
     * @params {units} String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in meters
     */
    function getDistanceWalked (units) {
        if (!units) units = "kilometers";

        var i,
            point,
            latlng = svl.map.getPosition(),
            line = _geojson.features[0],
            currentPoint = turf.point([latlng.lng, latlng.lat]),
            snapped = turf.pointOnLine(line, currentPoint),
            closestSegmentIndex = closestSegment(currentPoint, line),
            coords = line.geometry.coordinates,
            segment,
            distance = 0;
        for (i = 0; i < closestSegmentIndex; i++) {
            segment = turf.linestring([[coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]]]);
            distance += turf.lineDistance(segment);
        }

        // Check if the snapped point is not too far away from the current point. Then add the distance between the
        // snapped point and the last segment point to cumSum.
        if (turf.distance(snapped, currentPoint, units) < 100) {
            point = turf.point([coords[closestSegmentIndex][0], coords[closestSegmentIndex][1]]);
            distance += turf.distance(snapped, point);
        }

        return distance;
    }


    /**
     * This method checks if the task is completed by comparing the
     * current position and the ending point.
     * 
     * @param lat
     * @param lng
     * @param threshold
     * @returns {boolean}
     */
    function isAtEnd (lat, lng, threshold) {
        if (_geojson) {
            var d, len = _geojson.features[0].geometry.coordinates.length - 1,
                latEnd = _geojson.features[0].geometry.coordinates[len][1],
                lngEnd = _geojson.features[0].geometry.coordinates[len][0];

            if (!threshold) threshold = 10; // 10 meters
            d = svl.util.math.haversine(lat, lng, latEnd, lngEnd);
            return d < threshold;
        }
    }

    /**
     * Returns if the task is completed or not
     * @returns {boolean}
     */
    function isCompleted () {
        return status.isCompleted;
    }

    /**
     * Checks if the current task is connected to the given task
     * @param task
     * @param threshold
     * @param unit
     * @returns {boolean}
     */
    function isConnectedTo (task, threshold, unit) {
        if (!threshold) threshold = 0.01;
        if (!unit) unit = "kilometers";

        var lastCoordinate = getLastCoordinate(),
            targetCoordinate1 = task.getStartCoordinate(),
            targetCoordinate2 = task.getLastCoordinate(),
            p = turf.point([lastCoordinate.lng, lastCoordinate.lat]),
            p1 = turf.point([targetCoordinate1.lng, targetCoordinate1.lat]),
            p2 = turf.point([targetCoordinate2.lng, targetCoordinate2.lat]);
        return turf.distance(p, p1, unit) < threshold || turf.distance(p, p2, unit) < threshold;
    }

    function isConnectedToAPoint(point, threshold, unit) {
        if (!threshold) threshold = 0.01;
        if (!unit) unit = "kilometers";

        var startCoordinate = getStartCoordinate(),
            lastCoordinate = getLastCoordinate(),
            p2 = turf.point([lastCoordinate.lng, lastCoordinate.lat]),
            p1 = turf.point([startCoordinate.lng, startCoordinate.lat]);
        return turf.distance(point, p1, unit) < threshold || turf.distance(point, p2, unit) < threshold;
    }

    /**
     * Get the line distance of the task street edge
     * @param unit
     * @returns {*}
     */
    function lineDistance(unit) {
        if (!unit) unit = "kilometers";
        return turf.lineDistance(_geojson.features[0], unit);
    }

    /**
     * Get a distance between a point and a segment
     * @param point A Geojson Point feature
     * @param segment A Geojson LineString feature with two points
     * @returns {*}
     */
    function pointSegmentDistance(point, segment) {
        var snapped = turf.pointOnLine(segment, point),
            snappedLat = snapped.geometry.coordinates[1],
            snappedLng = snapped.geometry.coordinates[0],
            coords = segment.geometry.coordinates;
        if (Math.min(coords[0][0], coords[1][0]) <= snappedLng &&
            snappedLng <= Math.max(coords[0][0], coords[1][0]) &&
            Math.min(coords[0][1], coords[1][1]) <= snappedLat &&
            snappedLng <= Math.max(coords[0][1], coords[1][1])) {
            return turf.distance(point, snapped);
        } else {
            var point1 = turf.point([coords[0][0], coords[0][1]]);
            var point2 = turf.point([coords[1][0], coords[1][1]]);
            return Math.min(turf.distance(point, point1), turf.distance(point, point2));
        }
    }

    /**
     * Render the task path on the Google Maps pane.
     * Todo. This should be Map.js's responsibility.
     * Reference:
     * https://developers.google.com/maps/documentation/javascript/shapes#polyline_add
     * https://developers.google.com/maps/documentation/javascript/examples/polyline-remove
     */
    function render () {
        if ('map' in svl && google) {
            if (paths) {
                // Remove the existing paths and switch with the new ones
                for (var i = 0; i < paths.length; i++) {
                    paths[i].setMap(null);
                }

                var newTaskCompletionRate = getTaskCompletionRate();

                if (taskCompletionRate < newTaskCompletionRate) {
                    taskCompletionRate = newTaskCompletionRate;
                    paths = completedTaskPaths();
                }
            } else {
                var gCoordinates = _geojson.features[0].geometry.coordinates.map(function (coord) {
                    return new google.maps.LatLng(coord[1], coord[0]);
                });
                paths = [
                    new google.maps.Polyline({
                        path: gCoordinates,
                        geodesic: true,
                        strokeColor: '#ff0000',
                        strokeOpacity: 1.0,
                        strokeWeight: 2
                    })
                ];
            }

            for (i = 0; i < previousPaths.length; i++) {
                previousPaths[i].setMap(svl.map.getMap());
            }
            for (i = 0; i < paths.length; i++) {
                paths[i].setMap(svl.map.getMap());
            }
        }
    }

    /**
     * Flip the coordinates of the line string if the last point is closer to the end point of the current street segment.
     */
    function reverseCoordinates () {
        _geojson.features[0].geometry.coordinates.reverse();
    }

    function setProperty (key, value) {
        properties[key] = value;
    }

    _init (geojson, currentLat, currentLng);

    self.complete = complete;
    self.getAuditTaskId = getAuditTaskId;
    self.getProperty = getProperty;
    self.getDistanceWalked = getDistanceWalked;
    self.getFeature = getFeature;
    self.getGeoJSON = getGeoJSON;
    self.getGeometry = getGeometry;
    self.getLastCoordinate = getLastCoordinate;
    self.getStartCoordinate = getStartCoordinate;
    self.getStreetEdgeId = getStreetEdgeId;
    self.getTaskStart = getTaskStart;
    self.getTaskCompletionRate = function () {
        return taskCompletionRate ? taskCompletionRate : 0;
    };
    self.initialLocation = getStartCoordinate;
    self.isAtEnd = isAtEnd;
    self.isCompleted = isCompleted;
    self.isConnectedTo = isConnectedTo;
    self.isConnectedToAPoint = isConnectedToAPoint;
    self.lineDistance = lineDistance;
    self.render = render;
    self.reverseCoordinates = reverseCoordinates;
    self.setProperty = setProperty;

    return self;
}