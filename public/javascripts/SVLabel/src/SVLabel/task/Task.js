/**
 * Task module.
 * @param geojson
 * @param tutorialTask
 * @param currentLat
 * @param currentLng
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Task (geojson, tutorialTask, currentLat, currentLng) {
    var self = this;
    var _geojson;
    var _furthestPoint;

    var paths;
    var missionStarts = {};
    var status = {
        isComplete: false
    };
    var properties = {
        auditTaskId: null,
        streetEdgeId: null,
        completedByAnyUser: null,
        priority: null,
        taskStart: null,
        currentMissionId: null,
        startPointReversed: false,
        tutorialTask: tutorialTask,
        wayType: null,
        routeStreetId: null
    };

    /**
     * This method takes a task parameters and set up the current task.
     * @param geojson Description of the next task in json format.
     * @param currentLat Current latitude
     * @param currentLng Current longitude
     */
    this.initialize = function (geojson, currentLat, currentLng) {
        _geojson = geojson;
        var currMissionId = _geojson.features[0].properties.current_mission_id;
        var currMissionStart = _geojson.features[0].properties.currentMissionStart;

        self.setProperty("streetEdgeId", _geojson.features[0].properties.street_edge_id);
        self.setProperty("completedByAnyUser", _geojson.features[0].properties.completed_by_any_user);
        self.setProperty("priority", _geojson.features[0].properties.priority);
        self.setProperty("currentMissionId", currMissionId);
        self.setProperty("auditTaskId", _geojson.features[0].properties.audit_task_id);
        self.setProperty("wayType", _geojson.features[0].properties.way_type);
        self.setProperty("routeStreetId", _geojson.features[0].properties.route_street_id);
        self.setProperty("taskStart", new Date(`${_geojson.features[0].properties.task_start}Z`));
        if (_geojson.features[0].properties.completed) {
            status.isComplete = true;
        }
        if (_geojson.features[0].properties.start_point_reversed) {
            self.reverseStreetDirection();
        }
        if (currMissionId && currMissionStart) {
            self.setMissionStart(currMissionId, { lat: currMissionStart[0], lng: currMissionStart[1] });
        }
        if (currentLat && currentLng) {
            _furthestPoint = turf.point([currentLng, currentLat]);
        } else {
            _furthestPoint = turf.point(_geojson.features[0].geometry.coordinates[0]);
        }

        paths = null;
    };

    this.reverseStreetDirection = function () {
        self.reverseCoordinates();
        properties.startPointReversed = !properties.startPointReversed;
    }

    /**
     * Choose whether to reverse street direction based on the current position (should be where prev task ends).
     * @param currentLat
     * @param currentLng
     */
    this.setStreetEdgeDirection = function (currentLat, currentLng) {
        var len = geojson.features[0].geometry.coordinates.length - 1;
        var lat1 = geojson.features[0].geometry.coordinates[0][1];
        var lng1 = geojson.features[0].geometry.coordinates[0][0];
        var lat2 = geojson.features[0].geometry.coordinates[len][1];
        var lng2 = geojson.features[0].geometry.coordinates[len][0];
        var d1 = util.math.haversine(lat1, lng1, currentLat, currentLng);
        var d2 = util.math.haversine(lat2, lng2, currentLat, currentLng);

        // If current position is closer to the end point than the start point, reverse the street direction.
        if (d2 < d1) {
            self.reverseStreetDirection();
            _furthestPoint = turf.point([lng2, lat2]);
        } else {
            _furthestPoint = turf.point([lng1, lat1]);
        }
    };

    /**
     * This method creates Google Maps Polyline objects to render on the google maps.
     * @param lat
     * @param lng
     * @returns {Array|*[]}
     * @private
     */
    this.getGooglePolylines = function (lat, lng) {
        var auditedCoordinates = this._getPointsOnAuditedSegments();
        var unauditedCoordinates = this._getPointsOnUnauditedSegments();
        var completedPath = [];
        var incompletePath = [];

        for (var i = 0, len = auditedCoordinates.length; i < len; i++) {
            completedPath.push(new google.maps.LatLng(auditedCoordinates[i][1], auditedCoordinates[i][0]));
        }

        for (var i = 0, len = unauditedCoordinates.length; i < len; i++) {
            incompletePath.push(new google.maps.LatLng(unauditedCoordinates[i][1], unauditedCoordinates[i][0]));
        }

        return [
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
    };

    this._coordinatesToSegments = function (coordinates) {
        var returnSegments = [];
        for (var i = 1, len = coordinates.length; i < len; i++) {
            returnSegments.push(turf.lineString([
                [coordinates[i - 1][0], coordinates[i - 1][1]],
                [coordinates[i][0], coordinates[i][1]]
            ]));
        }
        return returnSegments;
    };

    this._getPointsOnAuditedSegments = function () {
        var startCoord = this.getStartCoordinate();
        var endCoord = this.getFurthestPointReached().geometry.coordinates;
        return this.getSubsetOfCoordinates(startCoord.lat, startCoord.lng, endCoord[1], endCoord[0]);
    };

    this._getPointsOnUnauditedSegments = function () {
        var startCoord = this.getFurthestPointReached().geometry.coordinates;
        var endCoord = this.getLastCoordinate();
        return this.getSubsetOfCoordinates(startCoord[1], startCoord[0], endCoord.lat, endCoord.lng);
    };

    this.getSubsetOfCoordinates = function(fromLat, fromLng, toLat, toLng) {
        var startPoint = turf.point([fromLng, fromLat]);
        var endPoint = turf.point([toLng, toLat]);
        var slicedLine = turf.lineSlice(startPoint, endPoint, _geojson.features[0]);
        return turf.cleanCoords(slicedLine).geometry.coordinates;
    };

    this._getSegmentsToAPoint = function (lat, lng) {
        var startCoord = this.getStartCoordinate();
        var coordinates = this.getSubsetOfCoordinates(startCoord.lat, startCoord.lng, lat, lng);
        return this._coordinatesToSegments(coordinates);
    };

    this._hasAdvanced = function (currentLat, currentLng) {
        if (typeof _furthestPoint === "undefined") return false;
        var latFurthest = _furthestPoint.geometry.coordinates[1];
        var lngFurthest = _furthestPoint.geometry.coordinates[0];
        var distanceAtTheFurthestPoint = this.getDistanceFromStart(latFurthest, lngFurthest);
        var distanceAtCurrentPoint = this.getDistanceFromStart(currentLat, currentLng);

        var streetEdge =  _geojson.features[0];
        var currentPosition = turf.point([currentLng, currentLat]);
        var snappedPosition = turf.nearestPointOnLine(streetEdge, currentPosition);

        return (distanceAtTheFurthestPoint < distanceAtCurrentPoint) &&
            turf.distance(currentPosition, snappedPosition) < 0.025;
    };

    /**
     * Set the isComplete status to true.
     * @returns {complete}
     */
    this.complete = function () {
        status.isComplete = true;
        properties.completedByAnyUser = true;
        properties.priority = 1 / (1 + (1 / properties.priority));
        return this;
    };

    this.getAuditTaskId = function () {
        return properties.auditTaskId;
    };

    /**
     * Get a geojson feature
     * @returns {null}
     */
    this.getFeature = function () {
        return _geojson ? _geojson.features[0] : null;
    };

    /**
     * Get geojson
     * @returns {*}
     */
    this.getGeoJSON = function () {
        return _geojson;
    };

    /**
     * Get geometry
     */
    this.getGeometry = function () {
        return _geojson ? _geojson.features[0].geometry : null;
    };

    /**
     * Get the last coordinate in the geojson.
     * @returns {{lat: *, lng: *}}
     */
    this.getLastCoordinate = function () {
        var len = geojson.features[0].geometry.coordinates.length - 1,
            lat = _geojson.features[0].geometry.coordinates[len][1],
            lng = _geojson.features[0].geometry.coordinates[len][0];
        return { lat: lat, lng: lng };
    };

    /**
     * Return the property
     * @param key Field name
     * @returns {null}
     */
    this.getProperty = function (key) {
        return key in properties ? properties[key] : null;
    };

    /**
     * Get the first coordinate in the geojson
     * @returns {{lat: *, lng: *}}
     */
    this.getStartCoordinate = function () {
        var lat = _geojson.features[0].geometry.coordinates[0][1],
            lng = _geojson.features[0].geometry.coordinates[0][0];
        return { lat: lat, lng: lng };
    };

    /**
     * Returns the street edge id of the current task.
     */
    this.getStreetEdgeId = function () {
        return _geojson.features[0].properties.street_edge_id;
    };

    this.streetCompletedByAnyUser = function () {
        return properties.completedByAnyUser;
    };

    this.getStreetPriority = function () {
        return properties.priority;
    };

    /**
     * Returns an integer in the range 0 to n-1, where larger n means higher priority.
     *
     * Explanation:
     * We want to split the range [0,1] into n = 4 ranges, each sub-range has a length of 1 / n = 1 / 4 = 0.25.
     * To get the discretized order, we take the floor(priority / 0.25), which brings [0,0.25) -> 0, [0.25,0.5) -> 1,
     * [0.5,0.75) -> 2, [0.75,1) -> 3, and 1 -> 4. But we really want [0.75-1] -> 3, so instead of
     * floor(priority / (1 / n)), we have min(floor(priority / (1 / n)), n - 1).
     * @returns {number}
     */
    this.getStreetPriorityDiscretized = function() {
        var n = 4;
        return Math.min(Math.floor(_geojson.features[0].properties.priority / (1 / n)), n - 1);
    };

    this.getAuditedDistance = function (unit) {
        if (typeof _furthestPoint === "undefined") return 0;
        if (!unit) unit = {units: 'kilometers'};
        var latFurthest = _furthestPoint.geometry.coordinates[1];
        var lngFurthest = _furthestPoint.geometry.coordinates[0];
        return this.getDistanceFromStart(latFurthest, lngFurthest, unit);
    };

    /**
     * Get the cumulative distance
     * Reference:
     * turf-line-distance: https://github.com/turf-junkyard/turf-line-distance
     *
     * @params {units} String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in meters
     */
    this.getDistanceFromStart = function (lat, lng, unit) {
        if (!unit) unit = {units: 'kilometers'};
        var distance = 0;
        var walkedSegments = this._getSegmentsToAPoint(lat, lng);

        for (var i = 0, len = walkedSegments.length; i < len; i++) {
            distance += turf.length(walkedSegments[i], unit);
        }
        return distance;
    };


    /**
     * This method checks if the task is completed by comparing the
     * current position and the ending point.
     *
     * @param lat
     * @param lng
     * @param threshold
     * @returns {boolean}
     */
    this.isAtEnd = function (lat, lng, threshold) {
        if (_geojson) {
            var d, len = _geojson.features[0].geometry.coordinates.length - 1,
                latEnd = _geojson.features[0].geometry.coordinates[len][1],
                lngEnd = _geojson.features[0].geometry.coordinates[len][0];

            if (!threshold) threshold = 10; // 10 meters
            d = util.math.haversine(lat, lng, latEnd, lngEnd);
            return d < threshold;
        }
    };

    /**
     * Returns if the task was completed or not.
     * @returns {boolean}
     */
    this.isComplete = function () {
        return status.isComplete;
    };

    /**
     * Checks if the current task is connected to the given task
     * @param task
     * @param threshold
     * @param unit
     * @returns {boolean}
     */
    this.isConnectedTo = function (task, threshold, unit) {
        if (!threshold) threshold = 0.01;
        if (!unit) unit = { units: 'kilometers' };

        var lastCoordinate = self.getLastCoordinate(),
            targetCoordinate1 = task.getStartCoordinate(),
            targetCoordinate2 = task.getLastCoordinate(),
            p = turf.point([lastCoordinate.lng, lastCoordinate.lat]),
            p1 = turf.point([targetCoordinate1.lng, targetCoordinate1.lat]),
            p2 = turf.point([targetCoordinate2.lng, targetCoordinate2.lat]);
        return turf.distance(p, p1, unit) < threshold || turf.distance(p, p2, unit) < threshold;
    };

    /**
     * Get the line distance of the task street edge
     * @param unit
     * @returns {*}
     */
    this.lineDistance = function (unit) {
        if (!unit) unit = {units: 'kilometers'};
        return turf.length(_geojson.features[0], unit);
    };

    /**
     * Todo. This should go to the MapService or its submodule.
     */
    this.eraseFromMinimap = function () {
        if ('map' in svl && google && paths) {
            for (var i = 0; i < paths.length; i++) {
                paths[i].setMap(null);
            }
        }
    };

    /**
     * Render the task path on the Google Maps pane.
     * Todo. This should go to the MapService or its submodule
     * Reference:
     * https://developers.google.com/maps/documentation/javascript/shapes#polyline_add
     * https://developers.google.com/maps/documentation/javascript/examples/polyline-remove
     */
    this.render = function () {
        if ('map' in svl && google) {
            self.eraseFromMinimap();
            // If the task has been completed already, or if it has not been completed and is not the current task,
            // render it using one green or gray Polyline, respectively.
            if (self.isComplete() || self.getStreetEdgeId() !== svl.taskContainer.getCurrentTaskStreetEdgeId()) {
                var gCoordinates = _geojson.features[0].geometry.coordinates.map(function (coord) {
                    return new google.maps.LatLng(coord[1], coord[0]);
                });
                var color = self.isComplete() ? '#00ff00' : '#808080';
                var opacity = self.isComplete() ? 1.0 : 0.75;
                paths = [
                    new google.maps.Polyline({
                        path: gCoordinates,
                        geodesic: true,
                        strokeColor: color,
                        strokeOpacity: opacity,
                        strokeWeight: 2
                    })
                ];
            // If the task is incomplete and is the current task, render it using two Polylines (red and green).
            } else {
                var latlng = svl.map.getPosition();
                paths = self.getGooglePolylines(latlng.lat, latlng.lng);
            }

            for (var i = 0, len = paths.length; i < len; i++) {
                paths[i].setMap(svl.map.getMap());
            }
        }
    };

    /**
     * Flip the coordinates of the linestring if the last point is closer to the endpoint of the current street segment.
     */
    this.reverseCoordinates = function() {
        _geojson.features[0].geometry.coordinates.reverse();
    };

    this.setProperty = function(key, value) {
        properties[key] = value;
    };

    this.getMissionStart = function(missionId) {
        return missionStarts[missionId];
    }

    this.setMissionStart = function(missionId, missionStart) {
        missionStarts[missionId] = missionStart;
    }

    this.getFurthestPointReached = function() {
        return _furthestPoint;
    };

    this.updateTheFurthestPointReached = function(currentLat, currentLng) {
        let currentPoint = turf.point([currentLng, currentLat]);
        if (turf.pointToLineDistance(currentPoint, _geojson.features[0]) < svl.CLOSE_TO_ROUTE_THRESHOLD &&
            this._hasAdvanced(currentLat, currentLng)) {
            _furthestPoint = currentPoint;
        }
    };

    this.initialize(geojson, currentLat, currentLng);
}
