var svl = svl || {};

/**
 * Task constructor
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Task ($, turf) {
    var self = {className: 'Task'},
        taskSetting,
        previousTasks = [],
        lat, lng,
        taskCompletionRate = 0,
        paths, previousPaths = [],
        status = {
            noAudio: false
        };

    /** Save the task */
    function save () { svl.storage.set("task", taskSetting); }

    /** Load the task */
    function load () {
        var map = svl.storage.get("map");
        taskSetting = svl.storage.get("task");

        if (map) {
            lat = map.latlng.lat;
            lng = map.latlng.lng;
        }
        return taskSetting ? true : false;
    }

    /**  Get a next task */
    function nextTask (streetEdgeId) {
        if (streetEdgeId) {
            // When the current street edge id is given (i.e., when you are simply walking around).
            var len = taskSetting.features[0].geometry.coordinates.length - 1,
                latEnd = taskSetting.features[0].geometry.coordinates[len][1],
                lngEnd = taskSetting.features[0].geometry.coordinates[len][0];

            $.ajax({
                // async: false,
                // contentType: 'application/json; charset=utf-8',
                url: "/audit/task/next?streetEdgeId=" + streetEdgeId + "&lat=" + latEnd + "&lng=" + lngEnd,
                type: 'get',
                success: function (task) {
                    var len = task.features[0].geometry.coordinates.length - 1,
                        lat1 = task.features[0].geometry.coordinates[0][1],
                        lng1 = task.features[0].geometry.coordinates[0][0],
                        lat2 = task.features[0].geometry.coordinates[len][1],
                        lng2 = task.features[0].geometry.coordinates[len][0],
                        d1 = svl.util.math.haversine(lat1, lng1, latEnd, lngEnd),
                        d2 = svl.util.math.haversine(lat2, lng2, latEnd, lngEnd);

                    if (d1 > 10 && d2 > 10) {
                        // If the starting point of the task is far away, jump there.
                        svl.setPosition(lat1, lng1);
                    } else if (d2 < d1) {
                        // Flip the coordinates of the line string if the last point is closer to the end point of the current street segment.
                        task.features[0].geometry.coordinates.reverse();
                    }
                    set(task);
                    renderTaskPath();
                },
                error: function (result) {
                    throw result;
                }
            });
        } else {
            // No street edge id is provided (i.e., you skip a task or for some other reason get another task.
            $.ajax({
                // async: false,
                // contentType: 'application/json; charset=utf-8',
                url: "/audit/task",
                type: 'get',
                success: function (task) {
                    var lat1 = task.features[0].geometry.coordinates[0][1],
                        lng1 = task.features[0].geometry.coordinates[0][0];

                    svl.setPosition(lat1, lng1);
                    set(task);
                    renderTaskPath();
                },
                error: function (result) {
                    throw result;
                }
            });
        }
    }

    function animateTaskCompletionMessage() {
        svl.ui.task.taskCompletionMessage.css('visibility', 'visible').hide();
        svl.ui.task.taskCompletionMessage.removeClass('animated bounce bounceOut').fadeIn(300).addClass('animated bounce');
        setTimeout(function () { svl.ui.task.taskCompletionMessage.fadeOut(300).addClass('bounceOut'); }, 1000)

        if ('audioEffect' in svl && !getStatus('noAudio')) {
            svl.audioEffect.play('yay');
            svl.audioEffect.play('applause');
        }
    }

    /** End the current task */
    function endTask () {
        svl.statusMessage.animate();
        svl.statusMessage.setCurrentStatusTitle("Great!");
        svl.statusMessage.setCurrentStatusDescription("You have finished auditing accessibility of this street and sidewalks. Keep it up!");
        svl.statusMessage.setBackgroundColor("rgb(254, 255, 223)");
        svl.tracker.push("TaskEnd");

        animateTaskCompletionMessage(); // Play the animation and audio effect after task completion.

        taskCompletionRate = 0;

        // Push the data into the list
        previousTasks.push(taskSetting);

        var gCoordinates = taskSetting.features[0].geometry.coordinates.map(function (coord) { return new google.maps.LatLng(coord[1], coord[0]); });
        previousPaths.push(new google.maps.Polyline({ path: gCoordinates, geodesic: true, strokeColor: '#00ff00', strokeOpacity: 1.0, strokeWeight: 2 }));
        paths = null;

        if (!('user' in svl)) {
            // Prompt a user who's not logged in to sign up/sign in.
            svl.popUpMessage.setTitle("You've completed the first accessibility audit!");
            svl.popUpMessage.setMessage("Do you want to create an account to keep track of your progress?");
            svl.popUpMessage.appendButton('<button id="pop-up-message-sign-up-button">Let me sign up!</button>', function () {
                // Store the data in LocalStorage.
                var data = svl.form.compileSubmissionData(),
                    staged = svl.storage.get("staged");
                staged.push(data);
                svl.storage.set("staged", staged);

                $("#sign-in-modal").addClass("hidden");
                $("#sign-up-modal").removeClass("hidden");
                $('#sign-in-modal-container').modal('show');
            });
            svl.popUpMessage.appendButton('<button id="pop-up-message-cancel-button">Nope</button>', function () {
                svl.user = new User({username: 'Anon accessibility auditor'});

                // Submit the data as an anonymous user.
                var data = svl.form.compileSubmissionData();
                svl.form.submit(data);
            });
            svl.popUpMessage.appendHTML('<br /><a id="pop-up-message-sign-in"><small><span style="color: white; ' +
                'text-decoration: underline;">I do have an account! Let me sign in.</span></small></a>', function () {
                var data = svl.form.compileSubmissionData(),
                    staged = svl.storage.get("staged");
                staged.push(data);
                svl.storage.set("staged", staged);

                $("#sign-in-modal").removeClass("hidden");
                $("#sign-up-modal").addClass("hidden");
                $('#sign-in-modal-container').modal('show');
            });
            svl.popUpMessage.setPosition(0, 260, '100%');
            svl.popUpMessage.show(true);
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
        nextTask(getStreetEdgeId());
    }

    /** Get geometry */
    function getGeometry () { return taskSetting ? taskSetting.features[0].geometry : null; }

    /** Get status */
    function getStatus (key) { return key in status ? status[key] : null; }

    /** Returns the street edge id of the current task. */
    function getStreetEdgeId () { return taskSetting.features[0].properties.street_edge_id; }

    /** Returns the task start time */
    function getTaskStart () { return taskSetting.features[0].properties.task_start; }

    /** Returns the starting location */
    function initialLocation() { return taskSetting ? { lat: lat, lng: lng } : null; }

    /**
     * This method checks if the task is done or not by assessing the
     * current distance and the ending distance.
     */
    function isAtEnd (lat, lng, threshold) {
        if (taskSetting) {
            var d, len = taskSetting.features[0].geometry.coordinates.length - 1,
                latEnd = taskSetting.features[0].geometry.coordinates[len][1],
                lngEnd = taskSetting.features[0].geometry.coordinates[len][0];

            if (!threshold) { threshold = 10; } // 10 meters
            d = svl.util.math.haversine(lat, lng, latEnd, lngEnd);
            console.debug('Distance to the end:' , d);
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
            var point1 = {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Point",
                    "coordinates": [coords[0][0], coords[0][1]]
                }
            };
            var point2 = {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Point",
                    "coordinates": [coords[1][0], coords[1][1]]
                }
            };
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
            segment = {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [coords[i][0], coords[i][1]],
                        [coords[i + 1][0], coords[i + 1][1]]
                    ]
                }
            };

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
        var i, point, lineLength, cumsumRate, newPaths, latlng = svl.getPosition(), lat = latlng.lat, lng = latlng.lng,
            line = taskSetting.features[0],
            currentPoint = { "type": "Feature", "properties": {},
                geometry: {
                    "type": "Point", "coordinates": [lng, lat]
                }
            },
            snapped = turf.pointOnLine(line, currentPoint),
            closestSegmentIndex = closestSegment(currentPoint, line),
            coords = line.geometry.coordinates,
            segment, cumSum = 0,
            completedPath = [new google.maps.LatLng(coords[0][1], coords[0][0])],
            incompletePath = [];
        for (i = 0; i < closestSegmentIndex; i++) {
            segment = {
                type: "Feature", properties: {}, geometry: {
                    type: "LineString",
                    coordinates: [ [coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]] ]
                }
            };
            cumSum += turf.lineDistance(segment);
            completedPath.push(new google.maps.LatLng(coords[i + 1][1], coords[i + 1][0]));
        }
        completedPath.push(new google.maps.LatLng(snapped.geometry.coordinates[1], snapped.geometry.coordinates[0]));
        incompletePath.push(new google.maps.LatLng(snapped.geometry.coordinates[1], snapped.geometry.coordinates[0]));

        for (i = closestSegmentIndex; i < coords.length - 1; i++) {
            incompletePath.push(new google.maps.LatLng(coords[i + 1][1], coords[i + 1][0]))
        }

        point = {
            "type": "Feature", "properties": {},
            "geometry": {
                "type": "Point", "coordinates": [coords[closestSegmentIndex][0], coords[closestSegmentIndex][1]]
            }
        };
        cumSum += turf.distance(snapped, point);
        lineLength = turf.lineDistance(line);
        cumsumRate = cumSum / lineLength;

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

        return {
            taskCompletionRate: taskCompletionRate < cumsumRate ? cumsumRate : taskCompletionRate,
            paths: newPaths
        };
    }

    /**
     * Reference:
     * https://developers.google.com/maps/documentation/javascript/shapes#polyline_add
     * https://developers.google.com/maps/documentation/javascript/examples/polyline-remove
     */
    function renderTaskPath() {
        if ('map' in svl && google) {
            if (paths) {
                // Remove the existing paths and switch with the new ones
                for (var i = 0; i < paths.length; i++) {
                    paths[i].setMap(null);
                }

                var taskCompletion = getTaskCompletionRate();

                if (taskCompletionRate < taskCompletion.taskCompletionRate) {
                    taskCompletionRate = taskCompletion.taskCompletionRate;
                    paths = taskCompletion.paths;
                }
            } else {
                var gCoordinates = taskSetting.features[0].geometry.coordinates.map(function (coord) {
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

    /** This method takes a task parameters in geojson format. */
    function set(json) {
        paths = null;
        taskSetting = json;
        lat = taskSetting.features[0].geometry.coordinates[0][1];
        lng = taskSetting.features[0].geometry.coordinates[0][0];
    }

    /** Set status */
    function setStatus(key, value) { status[key] = value; return this; }

    self.endTask = endTask;
    self.getGeometry = getGeometry;
    self.getStreetEdgeId = getStreetEdgeId;
    self.getTaskStart = getTaskStart;
    self.getTaskCompletionRate = function () { return taskCompletionRate ? taskCompletionRate : 0; };
    self.initialLocation = initialLocation;
    self.isAtEnd = isAtEnd;
    self.load = load;
    self.nextTask = nextTask;
    self.render = renderTaskPath;
    self.save = save;
    self.set = set;
    self.setStatus = setStatus;
    //self.updateTaskCompletionRate = updateTaskCompletionRate;

    return self;
}
