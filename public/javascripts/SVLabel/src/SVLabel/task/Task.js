/**
 * Task module.
 * @param geojson
 * @param tutorialTask
 * @param currentLat
 * @param currentLng
 * @param startPointReversed
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Task (geojson, tutorialTask, currentLat, currentLng, startPointReversed) {
    var self = this;
    var _geojson;
    var _furthestPoint;

    var paths;
    var status = {
        isComplete: false
    };
    var properties = {
        auditTaskId: null,
        streetEdgeId: null,
        regionId: null,
        completedByAnyUser: null,
        priority: null,
        currentLat: currentLat,
        currentLng: currentLng,
        startPointReversed: startPointReversed,
        finishedReversing: false,
        tutorialTask: tutorialTask
    };

    var fogOfWarProperties = {
        radius: 40,  // FOV radius in pixels.
        angle: null,  // User's angle.
        leftAngle: null,  // Left-most angle of the user's FOV.
        rightAngle: null,  // Right-most angle of the user's FOV.
        observedAreas: [],  // List of observed areas (latLng, minAngle, maxAngle).
        fractionObserved: 0,  // User's current fraction of 360 degrees observed.
        fogOfWarCtx: null,  // Canvas context for the fog of war.
        fovCtx: null,  // Canvas context for user's FOV.
        width: 0,  // Canvas width.
        height: 0,  // Canvas height.
    }

    /**
     * This method takes a task parameters and set up the current task.
     * @param geojson Description of the next task in json format.
     * @param currentLat Current latitude
     * @param currentLng Current longitude
     */
    this.initialize = function (geojson, currentLat, currentLng) {
        _geojson = geojson;

        self.setProperty("streetEdgeId", _geojson.features[0].properties.street_edge_id);
        self.setProperty("regionId", _geojson.features[0].properties.region_id);
        self.setProperty("completedByAnyUser", _geojson.features[0].properties.completed_by_any_user);
        self.setProperty("priority", _geojson.features[0].properties.priority);

        if (_geojson.features[0].properties.completed) {
            status.isComplete = true;
        }

        if (currentLat && currentLng) {
            this.setStreetEdgeDirection(currentLat, currentLng);
        }

        paths = null;

        // Get canvas context for the fog of war.
        let fogOfWarCanvas = document.getElementById("google-maps-fog-of-war-canvas");
        fogOfWarProperties.fogOfWarCtx = fogOfWarCanvas.getContext("2d");
        // Get canvas context for user's FOV.
        let fovCanvas = document.getElementById("google-maps-fov-canvas");
        fogOfWarProperties.fovCtx = fovCanvas.getContext("2d");
        // Get canvas width and height.
        fogOfWarProperties.width = fogOfWarCanvas.width;
        fogOfWarProperties.height = fogOfWarCanvas.height;
    };

    this.setStreetEdgeDirection = function (currentLat, currentLng) {
        var len = geojson.features[0].geometry.coordinates.length - 1,
            lat1 = geojson.features[0].geometry.coordinates[0][1],
            lng1 = geojson.features[0].geometry.coordinates[0][0],
            lat2 = geojson.features[0].geometry.coordinates[len][1],
            lng2 = geojson.features[0].geometry.coordinates[len][0];
        // Continuing from the previous task (i.e., currentLat and currentLng exist).
        var d1 = util.math.haversine(lat1, lng1, currentLat, currentLng),
            d2 = util.math.haversine(lat2, lng2, currentLat, currentLng);

        // If we already set reversed to true or we are at the 2nd endpoint, reverse the coordinates.
        if (properties.startPointReversed
            || ((properties.startPointReversed === null || properties.startPointReversed === undefined) && d2 < d1)) {
            // Only reverse if we haven't already reversed.
            if (!properties.finishedReversing) {
                self.reverseCoordinates();
                properties.finishedReversing = true;
                properties.startPointReversed = true;
                _furthestPoint = turf.point([lng2, lat2]);
            }
        } else {
            properties.startPointReversed = false;
            _furthestPoint = turf.point([lng1, lat1]);
        }
    };

    /**
     * Get the index of the segment in the street edge that is closest to the point
     * @param point A geojson Point feature
     * @param line A geojson LineString Feature
     */
    this._indexOfTheClosestSegment = function (point, line) {
        var coords = line.geometry.coordinates,
            lenCoord = coords.length,
            segment, lengthArray = [], minValue;

        for (var i = 0; i < lenCoord - 1; i++) {
            segment = turf.lineString([ [coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]] ]);
            lengthArray.push(_pointSegmentDistance(point, segment));
        }
        minValue = Math.min.apply(null, lengthArray);
        return lengthArray.indexOf(minValue);
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
        var point = this.getFurthestPointReached();
        var lat = point.geometry.coordinates[1];
        var lng = point.geometry.coordinates[0];
        return this._getPointsOnSegmentsToASnappedPoint(lat, lng);
    };

    this._getPointsOnUnauditedSegments = function () {
        var point = this.getFurthestPointReached();
        var lat = point.geometry.coordinates[1];
        var lng = point.geometry.coordinates[0];
        return this._getPointsOnSegmentsFromASnappedPoint(lat, lng);
    };

    this._getPointsOnSegmentsToASnappedPoint = function (currentLat, currentLng) {
        var streetEdge =  _geojson.features[0];
        var currentPosition = turf.point([currentLng, currentLat]);
        var snappedPosition = turf.nearestPointOnLine(streetEdge, currentPosition);
        var closestSegmentIndex = self._indexOfTheClosestSegment(currentPosition, streetEdge);
        var coordinates = [];

        for (var i = 0; i <= closestSegmentIndex; i++) {
            coordinates.push(streetEdge.geometry.coordinates[i]);
        }

        coordinates.push(snappedPosition.geometry.coordinates);

        return coordinates;
    };

    this._getPointsOnSegmentsFromASnappedPoint = function (lat, lng) {
        var streetEdge =  _geojson.features[0];
        var currentPosition = turf.point([lng, lat]);
        var snappedPosition = turf.nearestPointOnLine(streetEdge, currentPosition);
        var closestSegmentIndex = self._indexOfTheClosestSegment(currentPosition, streetEdge);
        var coordinates = [];

        coordinates.push(snappedPosition.geometry.coordinates);
        for (var i = closestSegmentIndex + 1, len = streetEdge.geometry.coordinates.length; i < len; i++) {
            coordinates.push(streetEdge.geometry.coordinates[i]);
        }

        return coordinates;
    };

    this._getSegmentsToAPoint = function (lat, lng) {
        var coordinates = this._getPointsOnSegmentsToASnappedPoint(lat, lng);
        if (coordinates.length > 1) {
            return this._coordinatesToSegments(coordinates);
        } else {
            // console.error("`Task._getSegmentsToAPoint` returned only 1 coordinate");
            return [];
        }
    };

    this._getAuditedSegments = function () {
        var point = this.getFurthestPointReached();
        var lat = point.geometry.coordinates[1];
        var lng = point.geometry.coordinates[0];
        return this._getSegmentsToAPoint(lat, lng);
    };

    /**
     * Get a distance between a point and a segment
     * @param point A Geojson Point feature
     * @param segment A Geojson LineString feature with two points
     * @returns {*}
     */
    function _pointSegmentDistance(point, segment) {
        var snapped = turf.nearestPointOnLine(segment, point),
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

    this.getCurrentLatLng = function() {
        return { lat: properties.currentLat, lng: properties.currentLng };
    };

    /**
     * Returns the street edge id of the current task.
     */
    this.getStreetEdgeId = function () {
        return _geojson.features[0].properties.street_edge_id;
    };

    this.getRegionId = function () {
        return _geojson.features[0].properties.region_id;
    }

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

    /**
     * Returns the task start time
     */
    this.getTaskStart = function () {
        return _geojson.features[0].properties.task_start;
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
        if (!unit) unit = {units: 'kilometers'};

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
    this.eraseFromGoogleMaps = function () {
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
            self.eraseFromGoogleMaps();
            if (self.isComplete()) {
                // If the task has been completed already, set the paths to a green polyline
                var gCoordinates = _geojson.features[0].geometry.coordinates.map(function (coord) {
                    return new google.maps.LatLng(coord[1], coord[0]);
                });
                paths = [
                    new google.maps.Polyline({
                        path: gCoordinates,
                        geodesic: true,
                        strokeColor: '#00ff00',
                        strokeOpacity: 1.0,
                        strokeWeight: 2
                    })
                ];
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
     * Resets the user's angle and appends the user's new position to 'observedAreas'. Called when the user takes a step. 
     */
    this.observedAreaStep = function () {
        fogOfWarProperties.angle = null;
        fogOfWarProperties.leftAngle = null;
        fogOfWarProperties.rightAngle = null;
        let latLng = svl.map.getPosition();
        for (let i = 0; i < fogOfWarProperties.observedAreas.length; i++) {
            // If we have observed the new position before, move it to the end of the 'observedAreas' list.
            if (fogOfWarProperties.observedAreas[i].latLng.lat == latLng.lat
                    && fogOfWarProperties.observedAreas[i].latLng.lng == latLng.lng) {
                fogOfWarProperties.observedAreas.push(fogOfWarProperties.observedAreas.splice(i, 1)[0]);
                return;
            }
        }
        fogOfWarProperties.observedAreas.push({latLng: latLng, minAngle: null, maxAngle: null});
    }

    /**
     * From PanoMarker spec
     * @param zoom
     * @returns {number}
     */
    function get3dFov(zoom) {
        return zoom <= 2 ? 126.5 - zoom * 36.75 : 195.93 / Math.pow(1.92, zoom);
    }

    /**
     * Converts degrees to radians.
     * @param degrees
     * @returns {number}
     */
    function toRadians(degrees) {
        return degrees / 180 * Math.PI;
    }

    /**
     * Converts a latitude and longitude to pixel xy-coordinates.
     * @param latLng
     * @returns {number, number}
     */
    function latLngToPixel(latLng) {
        let projection = svl.map.getMap().getProjection();
        let bounds = svl.map.getMap().getBounds();
        let topRight = projection.fromLatLngToPoint(bounds.getNorthEast());
        let bottomLeft = projection.fromLatLngToPoint(bounds.getSouthWest());
        let scale = Math.pow(2, svl.map.getMap().getZoom());
        let worldPoint = projection.fromLatLngToPoint(latLng);
        return {x: Math.floor((worldPoint.x - bottomLeft.x) * scale),
                y: Math.floor((worldPoint.y - topRight.y) * scale)};
    }

    /**
     * Updates all of the angle variables necessary to keep track of the user's observed area.
     */
    function updateAngles() {
        let pov = svl.map.getPov();
        let heading = pov.heading;
        let fov = get3dFov(pov.zoom);
        if (fogOfWarProperties.angle) {
            if (heading - fogOfWarProperties.angle > 180) {
                heading -= 360;
            }
            if (heading - fogOfWarProperties.angle < -180) {
                heading += 360;
            }
        }
        fogOfWarProperties.angle = heading;
        fogOfWarProperties.leftAngle = fogOfWarProperties.angle - fov / 2;
        fogOfWarProperties.rightAngle = fogOfWarProperties.angle + fov / 2;
        let current = fogOfWarProperties.observedAreas[fogOfWarProperties.observedAreas.length - 1];
        if (!current.minAngle || fogOfWarProperties.leftAngle < current.minAngle) {
            current.minAngle = fogOfWarProperties.leftAngle;
        }
        if (!current.maxAngle || fogOfWarProperties.rightAngle > current.maxAngle) {
            current.maxAngle = fogOfWarProperties.rightAngle;
        }
        fogOfWarProperties.fractionObserved = Math.min(current.maxAngle - current.minAngle, 360) / 360;
    }

    /**
     * Renders the fog of war.
     */
    function renderFogOfWar() {
        fogOfWarProperties.fogOfWarCtx.fillStyle = "#888888";
        fogOfWarProperties.fogOfWarCtx.filter = "blur(5px)";
        fogOfWarProperties.fogOfWarCtx.fillRect(0, 0, fogOfWarProperties.width, fogOfWarProperties.height);
        fogOfWarProperties.fogOfWarCtx.globalCompositeOperation = "destination-out";
        for (let observedArea of fogOfWarProperties.observedAreas) {
            let center = latLngToPixel(observedArea.latLng);
            fogOfWarProperties.fogOfWarCtx.beginPath();
            if (observedArea.maxAngle - observedArea.minAngle < 360) {
                fogOfWarProperties.fogOfWarCtx.moveTo(center.x, center.y);
            }
            fogOfWarProperties.fogOfWarCtx.arc(center.x, center.y, fogOfWarProperties.radius,
                toRadians(observedArea.minAngle - 90), toRadians(observedArea.maxAngle - 90));
                fogOfWarProperties.fogOfWarCtx.fill();
        }
        fogOfWarProperties.fogOfWarCtx.globalCompositeOperation = "source-over";
    }

    /**
     * Renders the the user's FOV.
     */
    function renderFov() {
        fogOfWarProperties.fovCtx.fillStyle = "#8080ff";
        fogOfWarProperties.fovCtx.clearRect(0, 0, fogOfWarProperties.width, fogOfWarProperties.height);
        let current = fogOfWarProperties.observedAreas[fogOfWarProperties.observedAreas.length - 1];
        let center = latLngToPixel(current.latLng);
        fogOfWarProperties.fovCtx.beginPath();
        fogOfWarProperties.fovCtx.moveTo(center.x, center.y);
        fogOfWarProperties.fovCtx.arc(center.x, center.y, fogOfWarProperties.radius,
            toRadians(fogOfWarProperties.leftAngle - 90), toRadians(fogOfWarProperties.rightAngle - 90));
        fogOfWarProperties.fovCtx.fill();
    }

    /**
     * Renders the user's percentage of 360 degrees observed progress bar.
     */
    function renderPercentObserved() {
        let observedPercentage = Math.floor(100 * fogOfWarProperties.fractionObserved) + "%";
        document.getElementById("google-maps-percent-observed").innerText = observedPercentage;
        if (fogOfWarProperties.fractionObserved == 1) {
            // If 100% observed, turn progress bar and text green.
            document.getElementById("google-maps-percent-observed").style.color = "#00dd00";
            fogOfWarProperties.fovCtx.strokeStyle = "#00dd00";
        } else {
            document.getElementById("google-maps-percent-observed").style.color = "#404040";
            fogOfWarProperties.fovCtx.strokeStyle = "#808080";
            fogOfWarProperties.fovCtx.lineWidth = 3;
            fogOfWarProperties.fovCtx.beginPath();
            fogOfWarProperties.fovCtx.arc(fogOfWarProperties.width - 20, 20, 16, 0, 2 * Math.PI);
            fogOfWarProperties.fovCtx.stroke();
            fogOfWarProperties.fovCtx.strokeStyle = "#404040";
        }
        fogOfWarProperties.fovCtx.lineCap = "round";
        fogOfWarProperties.fovCtx.beginPath();
        fogOfWarProperties.fovCtx.arc(fogOfWarProperties.width - 20, 20, 16,
            toRadians(-90), toRadians(fogOfWarProperties.fractionObserved * 360 - 90));
        fogOfWarProperties.fovCtx.stroke();
    }

    /**
     * Updates everything relevant to the user's observed area.
     */
    this.updateObservedArea = function () {
        if (fogOfWarProperties.observedAreas.length > 0) {
            updateAngles();
            renderFogOfWar();
            renderFov();
            renderPercentObserved();
        }
    }

    /**
     * Flip the coordinates of the line string if the last point is closer to the end point of the current street segment.
     */
    this.reverseCoordinates = function () {
        _geojson.features[0].geometry.coordinates.reverse();
    };

    this.setProperty = function (key, value){
        properties[key] = value;
    };

    this.getFurthestPointReached = function () {
        return _furthestPoint;
    };

    this.updateTheFurthestPointReached = function (currentLat, currentLng) {
        if (this._hasAdvanced(currentLat, currentLng)) {
            _furthestPoint = turf.point([currentLng, currentLat]);
        }
    };

    this.initialize(geojson, currentLat, currentLng);
}
