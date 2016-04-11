var svl = svl || {};

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
        lat, lng,
        taskCompletionRate = 0,
        paths, previousPaths = [],
        status = { };

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

        if (currentLat && currentLng) {
            // Continuing from the previous task (i.e., currentLat and currentLng exist).
            var d1 = svl.util.math.haversine(lat1, lng1, currentLat, currentLng),
                d2 = svl.util.math.haversine(lat2, lng2, currentLat, currentLng);

            if (d2 < d1) {
                // Flip the coordinates of the line string if the last point is closer to the end point of the current street segment.
                _geojson.features[0].geometry.coordinates.reverse();
            }
        }

        lat = _geojson.features[0].geometry.coordinates[0][1];
        lng = _geojson.features[0].geometry.coordinates[0][0];
        paths = null;

        // Render the path for the current task.
        // Todo. Move the definition of the render() to the Map.js
        render();
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
     * Returns the street edge id of the current task.
     */
    function getStreetEdgeId () {
        return _geojson.features[0].properties.street_edge_id;
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
    function getCumulativeDistance (units) {
        if (!units) units = "kilometers";

        var distance = svl.taskContainer.getCompletedTaskDistance(units);

        var i,
            point,
            latlng = svl.map.getPosition(),
            lat = latlng.lat,
            lng = latlng.lng,
            line = _geojson.features[0],
            currentPoint = turf.point([lng, lat]),
            snapped = turf.pointOnLine(line, currentPoint),
            closestSegmentIndex = closestSegment(currentPoint, line),
            coords = line.geometry.coordinates,
            segment,
            cumSum = 0;
        for (i = 0; i < closestSegmentIndex; i++) {
            segment = turf.linestring([[coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]]]);
            cumSum += turf.lineDistance(segment);
        }

        // Check if the snapped point is not too far away from the current point. Then add the distance between the
        // snapped point and the last segment point to cumSum.
        if (turf.distance(snapped, currentPoint, units) < 100) {
            point = turf.point([coords[closestSegmentIndex][0], coords[closestSegmentIndex][1]])
            cumSum += turf.distance(snapped, point);
        }
        distance += cumSum;

        return distance;
    }

    /** Returns the starting location */
    function initialLocation() { 
        return _geojson ? { lat: lat, lng: lng } : null; 
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
            lat = latlng.lat,
            lng = latlng.lng,
            line = _geojson.features[0],
            currentPoint = turf.point([lng, lat]),
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

    _init (geojson, currentLat, currentLng);

    self.getCumulativeDistance = getCumulativeDistance;
    self.getGeoJSON = getGeoJSON;
    self.getGeometry = getGeometry;
    self.getStreetEdgeId = getStreetEdgeId;
    self.getTaskStart = getTaskStart;
    self.getTaskCompletionRate = function () {
        return taskCompletionRate ? taskCompletionRate : 0;
    };
    self.initialLocation = initialLocation;
    self.isAtEnd = isAtEnd;
    self.render = render;

    return self;
}

/**
 * TaskContainer module.
 * @param turf
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TaskContainer (turf) {
    var self = { className: "TaskContainer" },
        previousTasks = [],
        currentTask = null,
        paths, previousPaths = [];

    /**
     * End the current task.
     * Todo. Need to be fixed... Not really this function, but the nextTask() has a side effect of bringing users to different places.
     */
    function endTask () {
        if ('statusMessage' in svl) {
            svl.statusMessage.animate();
            svl.statusMessage.setCurrentStatusTitle("Great!");
            svl.statusMessage.setCurrentStatusDescription("You have finished auditing accessibility of this street and sidewalks. Keep it up!");
            svl.statusMessage.setBackgroundColor("rgb(254, 255, 223)");
        }
        if ('tracker' in svl) svl.tracker.push("TaskEnd");

        // Update the audited miles
        if ('ui' in svl) updateAuditedDistance();

        // if (!('user' in svl) || (svl.user.getProperty('username') == "anonymous" && svl.taskContainer.isFirstTask())) {
        if (!('user' in svl) || (svl.user.getProperty('username') == "anonymous" && getCompletedTaskDistance() > 0.5)) {
            svl.popUpMessage.promptSignIn();
        } else {
            // Submit the data.
            var data = svl.form.compileSubmissionData(),
                staged = svl.storage.get("staged");

            if (staged.length > 0) {
                staged.push(data);
                svl.form.submit(staged);
                svl.storage.set("staged", []);  // Empty the staged data.
            } else {
                svl.form.submit(data);
            }
        }
        
        push(currentTask); // Push the data into previousTasks

        // Clear the current paths
        var _geojson = currentTask.getGeoJSON(),
            gCoordinates = _geojson.features[0].geometry.coordinates.map(function (coord) { return new google.maps.LatLng(coord[1], coord[0]); });
        previousPaths.push(new google.maps.Polyline({ path: gCoordinates, geodesic: true, strokeColor: '#00ff00', strokeOpacity: 1.0, strokeWeight: 2 }));
        paths = null;

        return currentTask;
    }

    /**
     * Get the total distance of completed segments
     * @params {units} String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in meters
     */
    function getCompletedTaskDistance (units) {
        if (!units) units = "kilometers";

        var geojson, feature, i, len = length(), distance = 0;
        for (i = 0; i < len; i++) {
            geojson = previousTasks[i].getGeoJSON();
            feature = geojson.features[0];
            distance += turf.lineDistance(feature, units);
        }
        return distance;
    }

    /**
     * This method returns the completed tasks
     * @returns {Array}
     */
    function getCompletedTasks () {
        return previousTasks;
    }

    /**
     * Get the current task
     * @returns {*}
     */
    function getCurrentTask () {
        return currentTask;
    }

    /**
     * Check if the current task is the first task in this session
     * @returns {boolean}
     */
    function isFirstTask () {
        return length() == 0;
    }

    /**
     * Get the length of the previous tasks
     * @returns {*|Number}
     */
    function length () {
        return previousTasks.length;
    }
    
    /**
     * Get the next task and set it as a current task.
     * Todo. I don't like querying the next task with $.ajax every time I need a new street task. Task container should get a set of tasks in the beginning and supply a task from the locally held data.
     * @param task Current task
     * @returns {*} Next task
     */
    function nextTask (task) {
        var newTask = null;
        if (task) {
            var streetEdgeId = task.getStreetEdgeId(),
                _geojson = task.getGeoJSON();
            // When the current street edge id is given (i.e., when you are simply walking around).
            var len = _geojson.features[0].geometry.coordinates.length - 1,
                latEnd = _geojson.features[0].geometry.coordinates[len][1],
                lngEnd = _geojson.features[0].geometry.coordinates[len][0];

            $.ajax({
                async: false,
                url: "/task/next?streetEdgeId=" + streetEdgeId + "&lat=" + latEnd + "&lng=" + lngEnd,
                type: 'get',
                success: function (json) {
                    newTask = svl.taskFactory.create(json, latEnd, lngEnd);
                    // setCurrentTask(newTask);
                },
                error: function (result) {
                    throw result;
                }
            });
        } else {
            // No street edge id is provided (e.g., the user skipped the task to explore another location.)
            $.ajax({
                async: false,
                url: "/task",
                type: 'get',
                success: function (json) {
                    // Check if Street View is available at the location. If it's not available, report it to the
                    // server and go to the next task.
                    // http://stackoverflow.com/questions/2675032/how-to-check-if-google-street-view-available-and-display-message
                    // https://developers.google.com/maps/documentation/javascript/reference?csw=1#StreetViewService
                    var len = json.features[0].geometry.coordinates.length - 1,
                        lat1 = json.features[0].geometry.coordinates[0][1],
                        lng1 = json.features[0].geometry.coordinates[0][0],
                        lat2 = json.features[0].geometry.coordinates[len][1],
                        lng2 = json.features[0].geometry.coordinates[len][0];

                    newTask = svl.taskFactory.create(json);

                    // var streetViewService = new google.maps.StreetViewService();
                    // var STREETVIEW_MAX_DISTANCE = 25;
                    // var latLng = new google.maps.LatLng(lat1, lng1);
                    // setCurrentTask(newTask);

                    // streetViewService.getPanoramaByLocation(latLng, STREETVIEW_MAX_DISTANCE, function (streetViewPanoramaData, status) {
                    //     if (status === google.maps.StreetViewStatus.OK) {
                    //         var newTask = svl.taskFactory.create(json);
                    //         setCurrentTask(newTask);
                    //     } else if (status === google.maps.StreetViewStatus.ZERO_RESULTS) {
                    //         // no street view available in this range.
                    //         var latLng = new google.maps.LatLng(lat2, lng2);
                    //         streetViewService.getPanoramaByLocation(latLng, STREETVIEW_MAX_DISTANCE, function (streetViewPanoramaData, status) {
                    //             if (status === google.maps.StreetViewStatus.OK) {
                    //                 json.features[0].geometry.coordinates.reverse();
                    //                 var newTask = svl.taskFactory.create(json);
                    //                 setCurrentTask(newTask);
                    //             } else if (status === google.maps.StreetViewStatus.ZERO_RESULTS) {
                    //                 // Todo. Report lack of street view.
                    //                 nextTask();
                    //             } else {
                    //                 throw "Error loading Street View imagey.";
                    //             }
                    //         });
                    //     } else {
                    //         throw "Error loading Street View imagey.";
                    //     }
                    // });
                },
                error: function (result) {
                    throw result;
                }
            });
        }
        return newTask;
    }

    /**
     * Push a task to previousTasks
     * @param task
     */
    function push (task) {
        previousTasks.push(task);
    }

    /**
     * Set the current task
     * @param task
     */
    function setCurrentTask (task) {
        currentTask = task;

        if ('compass' in svl) {
            svl.compass.setTurnMessage();
            svl.compass.showMessage();
            svl.compass.update();
        }
    }

    /**
     * This method is called from Map.handlerPositionUpdate() to update the color of audited and unaudited street
     * segments on Google Maps.
     * KH: It maybe more natural to let a method in Map.js do handle it...
     */
    function update () {
        var i, len = previousTasks.length;
        for (i = 0; i < len; i++) previousTasks[i].render();
        currentTask.render();
    }

    /**
     * Update the audited distance by combining the distance previously traveled and the distance the user traveled in
     * the current session.
     * @returns {updateAuditedDistance}
     */
    function updateAuditedDistance () {
        var distance, sessionDistance = getCompletedTaskDistance();

        if ('user' in svl && svl.user.getProperty('username') != "anonymous") {
            if (!svl.user.getProperty('recordedAuditDistance')) {
                // Get the distance previously traveled if it is not cached
                var i, distanceAudited = 0;
                $.getJSON("/contribution/streets", function (data) {
                    if (data && 'features' in data) {
                        for (i = data.features.length - 1; i >= 0; i--) {
                            distanceAudited += turf.lineDistance(data.features[i], 'miles');
                        }
                    } else {
                        distanceAudited = 0;
                    }
                    svl.user.setProperty('recordedAuditDistance', distanceAudited);
                    distance = sessionDistance + distanceAudited;
                    svl.ui.progress.auditedDistance.html(distance.toFixed(2));
                });
            } else {
                // use the cached recordedAuditDistance if it exists
                distance = sessionDistance + svl.user.getProperty('recordedAuditDistance');
                svl.ui.progress.auditedDistance.html(distance.toFixed(2));
            }
        } else {
            // If the user is using the application as an anonymous, just use the session distance.
            distance = sessionDistance;
            svl.ui.progress.auditedDistance.html(distance.toFixed(2));
        }

        return this;
    }
    
    self.endTask = endTask;
    self.getCompletedTasks = getCompletedTasks;
    self.getCompletedTaskDistance = getCompletedTaskDistance;
    self.getCurrentTask = getCurrentTask;
    self.isFirstTask = isFirstTask;
    self.length = length;
    self.nextTask = nextTask;
    self.push = push;
    self.setCurrentTask = setCurrentTask;
    self.update = update;
    self.updateAuditedDistance = updateAuditedDistance;

    return self;
}

/**
 * TaskFactory module
 * @param turf
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TaskFactory (turf) {
    var self = { className: "TaskFactory" };

    /**
     * Create a new task instance
     * @param geojson
     * @param lat
     * @param lng
     * @returns {svl.Task}
     */
    function create(geojson, lat, lng) {
        return new Task(turf, geojson, lat, lng);
    }

    /**
     * Query the backend server and create a new task instance.
     * @param parameters
     * @param callback
     */
    function getTask (parameters, callback) {
        if (!parameters || !callback) return;

        if ("streetEdgeId" in parameters && parameters.streetEdgeId) {
            $.ajax({
                url: "/task/street/" + parameters.streetEdgeId,
                type: 'get',
                success: function (json) {
                    var lat1 = json.features[0].geometry.coordinates[0][1],
                        lng1 = json.features[0].geometry.coordinates[0][0];
                    var newTask = create(json, lat1, lng1);
                    callback(newTask);
                },
                error: function (result) {
                    throw result;
                }
            });
        } else {
            $.ajax({
                url: "/task",
                type: 'get',
                success: function (json) {
                    var lat1 = json.features[0].geometry.coordinates[0][1],
                        lng1 = json.features[0].geometry.coordinates[0][0];
                    var newTask = create(json, lat1, lng1);
                    callback(newTask);
                },
                error: function (result) {
                    throw result;
                }
            });
        }
    }

    self.create = create;
    self.getTask = getTask;

    return self;
}

