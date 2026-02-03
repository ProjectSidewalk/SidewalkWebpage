/**
 * Task module.
 * @param geojson
 * @param tutorialTask
 * @param {{lat: number, lng: number}} [currentLatLng] The user's current lat/lng to use if resuming
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Task (geojson, tutorialTask, currentLatLng) {
    let self = this;
    let _geojson;

    /* @type {turf.Point} */
    let _furthestPoint;

    let paths;
    let missionStarts = {};
    let status = {
        isComplete: false
    };
    let properties = {
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
     * @param {GeoJSON.LineString} geojson The GeoJSON representation of the street
     * @param {{lat: number, lng: number}} [currentLatLng] The user's current lat/lng to use if resuming
     */
    this.initialize = function(geojson, currentLatLng) {
        _geojson = geojson;
        const currMissionId = _geojson.properties.current_mission_id;
        const currMissionStart = _geojson.properties.currentMissionStart;

        self.setProperty("streetEdgeId", _geojson.properties.street_edge_id);
        self.setProperty("completedByAnyUser", _geojson.properties.completed_by_any_user);
        self.setProperty("priority", _geojson.properties.priority);
        self.setProperty("currentMissionId", currMissionId);
        self.setProperty("auditTaskId", _geojson.properties.audit_task_id);
        self.setProperty("wayType", _geojson.properties.way_type);
        self.setProperty("routeStreetId", _geojson.properties.route_street_id);
        self.setProperty("taskStart", new Date(_geojson.properties.task_start));
        if (_geojson.properties.completed) {
            status.isComplete = true;
        }
        if (_geojson.properties.start_point_reversed) {
            self.reverseStreetDirection();
        }
        if (currMissionId && currMissionStart) {
            self.setMissionStart(currMissionId, { lat: currMissionStart[0], lng: currMissionStart[1] });
        }
        if (currentLatLng) {
            _furthestPoint = turf.point([currentLatLng.lng, currentLatLng.lat]);
        } else {
            _furthestPoint = turf.point(_geojson.geometry.coordinates[0]);
        }

        paths = null;
    };

    this.reverseStreetDirection = function() {
        self.reverseCoordinates();
        properties.startPointReversed = !properties.startPointReversed;
        _furthestPoint = turf.point(_geojson.geometry.coordinates[0]);
    };

    /**
     * Choose whether to reverse street direction based on the current position (should be where prev task ends).
     * @param {{lat: number, lng: number}} currentLatLng User's current position
     */
    this.setStreetEdgeDirection = function(currentLatLng) {
        const lat1 = geojson.geometry.coordinates[0][1];
        const lng1 = geojson.geometry.coordinates[0][0];
        const lat2 = geojson.geometry.coordinates[geojson.geometry.coordinates.length - 1][1];
        const lng2 = geojson.geometry.coordinates[geojson.geometry.coordinates.length - 1][0];
        const d1 = util.math.haversine({ lat: lat1, lng: lng1 }, currentLatLng);
        const d2 = util.math.haversine({ lat: lat2, lng: lng2 }, currentLatLng);

        // If current position is closer to the end point than the start point, reverse the street direction.
        if (d2 < d1) {
            self.reverseStreetDirection();
        }
    };

    /**
     * This method creates Google Maps Polyline objects to render on the Google Maps minimap.
     * @returns {Array|*[]}
     */
    this.getGooglePolylines = function() {
        const auditedCoordinates = this._getPointsOnAuditedSegments();
        const unauditedCoordinates = this._getPointsOnUnauditedSegments();
        let completedPath = [];
        let incompletePath = [];

        for (let i = 0, len = auditedCoordinates.length; i < len; i++) {
            completedPath.push(new google.maps.LatLng(auditedCoordinates[i][1], auditedCoordinates[i][0]));
        }

        for (let i = 0, len = unauditedCoordinates.length; i < len; i++) {
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

    this._coordinatesToSegments = function(coordinates) {
        let returnSegments = [];
        for (let i = 1, len = coordinates.length; i < len; i++) {
            returnSegments.push(turf.lineString([
                [coordinates[i - 1][0], coordinates[i - 1][1]],
                [coordinates[i][0], coordinates[i][1]]
            ]));
        }
        return returnSegments;
    };

    this._getPointsOnAuditedSegments = function() {
        const startCoord = this.getStartCoordinate();
        const endCoord = this.getFurthestPointReached().geometry.coordinates;
        return this.getSubsetOfCoordinates(startCoord, { lat: endCoord[1], lng: endCoord[0] });
    };

    this._getPointsOnUnauditedSegments = function() {
        const startCoord = this.getFurthestPointReached().geometry.coordinates;
        const endCoord = this.getEndCoordinate();
        return this.getSubsetOfCoordinates({ lat: startCoord[1], lng: startCoord[0] }, endCoord);
    };

    this.getSubsetOfCoordinates = function(fromLatLng, toLatLng) {
        const startPoint = turf.point([fromLatLng.lng, fromLatLng.lat]);
        const endPoint = turf.point([toLatLng.lng, toLatLng.lat]);
        const slicedLine = turf.lineSlice(startPoint, endPoint, _geojson);
        return turf.cleanCoords(slicedLine).geometry.coordinates;
    };

    this._getSegmentsToAPoint = function(latLng) {
        const startCoord = this.getStartCoordinate();
        const coordinates = this.getSubsetOfCoordinates(startCoord, latLng);
        return this._coordinatesToSegments(coordinates);
    };

    this._hasAdvanced = function(currentLatLng) {
        if (typeof _furthestPoint === "undefined") return false;
        const latFurthest = _furthestPoint.geometry.coordinates[1];
        const lngFurthest = _furthestPoint.geometry.coordinates[0];
        const distanceAtTheFurthestPoint = this.getDistanceFromStart({ lat: latFurthest, lng: lngFurthest });
        const distanceAtCurrentPoint = this.getDistanceFromStart(currentLatLng);

        const streetEdge =  _geojson;
        const currentPosition = turf.point([currentLatLng.lng, currentLatLng.lat]);
        const snappedPosition = turf.nearestPointOnLine(streetEdge, currentPosition);

        return (distanceAtTheFurthestPoint < distanceAtCurrentPoint) &&
            turf.distance(currentPosition, snappedPosition) < 0.025;
    };

    /**
     * Set the isComplete status to true.
     */
    this.complete = function() {
        status.isComplete = true;
        properties.completedByAnyUser = true;
        properties.priority = 1 / (1 + (1 / properties.priority));
    };

    this.getAuditTaskId = function() {
        return properties.auditTaskId;
    };

    /**
     * Get the GeoJSON representation of the street.
     * @returns {GeoJSON.LineString}
     */
    this.getFeature = function() {
        return _geojson ? _geojson : null;
    };

    /**
     * Get the GeoJSON representation of the street.
     * TODO why do we have both this and getFeature()? Can the geojson be null ever? During initialization maybe..?
     * @returns {GeoJSON.LineString}
     */
    this.getGeoJSON = function() {
        return _geojson;
    };

    /**
     * Get the last coordinate in the geojson.
     * @returns {{lat: number, lng: number}
     */
    this.getEndCoordinate = function() {
        const len = geojson.geometry.coordinates.length - 1;
        return { lat: _geojson.geometry.coordinates[len][1], lng: _geojson.geometry.coordinates[len][0] };
    };

    /**
     * Return the property.
     * @param {string} key Field name
     * @returns {null}
     */
    this.getProperty = function(key) {
        return key in properties ? properties[key] : null;
    };

    /**
     * Get the first coordinate in the geojson
     * @returns {{lat: number, lng: number}}
     */
    this.getStartCoordinate = function() {
        return { lat: _geojson.geometry.coordinates[0][1], lng: _geojson.geometry.coordinates[0][0] };
    };

    /**
     * Returns the street edge id of the current task.
     */
    this.getStreetEdgeId = function() {
        return _geojson.properties.street_edge_id;
    };

    this.getStreetPriority = function() {
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
        const n = 4;
        return Math.min(Math.floor(_geojson.properties.priority / (1 / n)), n - 1);
    };

    this.getAuditedDistance = function(units) {
        if (typeof _furthestPoint === "undefined") return 0;
        if (!units) units = { units: 'kilometers' };
        const latFurthest = _furthestPoint.geometry.coordinates[1];
        const lngFurthest = _furthestPoint.geometry.coordinates[0];
        return this.getDistanceFromStart({ lat: latFurthest, lng: lngFurthest }, units);
    };

    /**
     * Get the cumulative distance.
     *
     * @param {{lat: number, lng: number}} latLng The point to measure the distance from the start
     * @param {{units: string}} [units] String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in meters
     */
    this.getDistanceFromStart = function (latLng, units) {
        if (!units) units = { units: 'kilometers' };
        let distance = 0;
        const walkedSegments = this._getSegmentsToAPoint(latLng);

        for (let i = 0, len = walkedSegments.length; i < len; i++) {
            distance += turf.length(walkedSegments[i], units);
        }
        return distance;
    };


    /**
     * This method checks if the task is completed by comparing the current position and the ending point.
     *
     * @param {{lat: number, lng: number}} latLng The user's current location
     * @param {number} threshold Distance threshold in meters
     * @returns {boolean}
     */
    this.isAtEnd = function(latLng, threshold) {
        if (_geojson) {
            let d;
            const len = _geojson.geometry.coordinates.length - 1;
            const latEnd = _geojson.geometry.coordinates[len][1];
            const lngEnd = _geojson.geometry.coordinates[len][0];

            if (!threshold) threshold = 10; // 10 meters
            d = util.math.haversine(latLng, { lat: latEnd, lng: lngEnd });
            return d < threshold;
        }
    };

    /**
     * Returns if the task was completed or not.
     * @returns {boolean}
     */
    this.isComplete = function() {
        return status.isComplete;
    };

    /**
     * Checks if the current task is connected to the given task.
     *
     * @param {Task} task The task to check if this task is close to
     * @param {number} threshold Distance threshold in km, unless specified in unit parameter
     * @param {{units: string}} [units] Object with field 'units' holding distance unit, default to 'kilometers'
     * @returns {boolean} true this task's endpoint is within threshold distance of either endpoint of given task
     */
    this.isConnectedTo = function(task, threshold, units) {
        if (!units) units = { units: 'kilometers' };

        const lastCoordinate = self.getEndCoordinate()
        const targetCoordinate1 = task.getStartCoordinate();
        const targetCoordinate2 = task.getEndCoordinate();
        const p = turf.point([lastCoordinate.lng, lastCoordinate.lat]);
        const p1 = turf.point([targetCoordinate1.lng, targetCoordinate1.lat]);
        const p2 = turf.point([targetCoordinate2.lng, targetCoordinate2.lat]);

        return turf.distance(p, p1, units) < threshold || turf.distance(p, p2, units) < threshold;
    };

    /**
     * Get the line distance of the task street edge
     * @param {{units: string}} [units] Object with field 'units' holding distance unit, default to 'kilometers'
     * @returns {number} The length of the street in the given units
     */
    this.lineDistance = function(units) {
        if (!units) units = { units: 'kilometers' };
        return turf.length(_geojson, units);
    };

    /**
     * TODO This should go to the Minimap.
     */
    this.eraseFromMinimap = function() {
        if (paths) {
            for (let i = 0; i < paths.length; i++) {
                paths[i].setMap(null);
            }
        }
    };

    /**
     * Render the task path on the Google Maps pane.
     * TODO This should go to the Minimap.
     * Reference:
     * https://developers.google.com/maps/documentation/javascript/shapes#polyline_add
     * https://developers.google.com/maps/documentation/javascript/examples/polyline-remove
     */
    this.render = function() {
        self.eraseFromMinimap();

        // If the task has been completed already, or if it has not been completed and is not the current task,
        // render it using one green or gray Polyline, respectively.
        if (self.isComplete() || self.getStreetEdgeId() !== svl.taskContainer.getCurrentTaskStreetEdgeId()) {
            const gCoordinates = _geojson.geometry.coordinates.map(function (coord) {
                return new google.maps.LatLng(coord[1], coord[0]);
            });
            paths = [
                new google.maps.Polyline({
                    path: gCoordinates,
                    geodesic: true,
                    strokeColor: self.isComplete() ? '#00ff00' : '#808080',
                    strokeOpacity: self.isComplete() ? 1.0 : 0.75,
                    strokeWeight: 2
                })
            ];
        // If the task is incomplete and is the current task, render it using two Polylines (red and green).
        } else {
            paths = self.getGooglePolylines();
        }

        for (let i = 0, len = paths.length; i < len; i++) {
            paths[i].setMap(svl.minimap.getMap());
        }
    };

    /**
     * Flip the coordinates of the linestring if the last point is closer to the endpoint of the current street segment.
     */
    this.reverseCoordinates = function() {
        _geojson.geometry.coordinates.reverse();
    };

    this.setProperty = function(key, value) {
        properties[key] = value;
    };

    this.getMissionStart = function(missionId) {
        return missionStarts[missionId];
    };

    this.setMissionStart = function(missionId, missionStart) {
        missionStarts[missionId] = missionStart;
    };

    this.getFurthestPointReached = function() {
        return _furthestPoint;
    };

    this.updateTheFurthestPointReached = function(currentLatLng) {
        let currentPoint = turf.point([currentLatLng.lng, currentLatLng.lat]);
        if (turf.pointToLineDistance(currentPoint, _geojson) < svl.CLOSE_TO_ROUTE_THRESHOLD &&
            this._hasAdvanced(currentLatLng)) {
            _furthestPoint = currentPoint;
        }
    };

    this.initialize(geojson, currentLatLng);
}
