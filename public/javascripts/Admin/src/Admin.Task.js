function AdminTask(params) {
    var self = { auditTaskId: params.auditTaskId };
    var _data = {};

    L.mapbox.accessToken = params.mapboxApiKey;
    var map = L.mapbox.map('admin-task-choropleth', null, {
        zoomControl: false,
        scrollWheelZoom: false,
        touchZoom: false,
        doubleClickZoom: true
    }).addLayer(L.mapbox.styleLayer(i18next.t('common:map-url-streets')));

    (function mapAnimation () {
        var colorScheme = util.misc.getLabelColors();
        var lastPaused = 0;
        // Prepare a layer to put d3 stuff
        var svg = d3.select(map.getPanes().overlayPane).append('svg');  // The base svg
        var g = svg.append('g').attr('class', 'leaflet-zoom-hide');  // The root group
        
        // Plays/Pauses the stream.
        $('#control-btn').on('click', function() {
            if (document.getElementById('control-btn').innerHTML === 'Play') {
                playAnimation();
            } else if (document.getElementById('control-btn').innerHTML === 'Pause') {
                pauseAnimation();
            }
        });

        
        // Adds input listeners and pauses playback whenever fields are changed.
        var elements = document.getElementsByTagName('input');
        for (let i = 0; i < elements.length; ++i) {
            elements[i].addEventListener('input', function() {
                pauseAnimation();
            });
        }
        
        // The animation is played again by recalculating the stream again from where it stopped.
        function playAnimation() {
            let speedMultiplier = document.getElementById('speed-multiplier').value;
            let maxWaitMs = (document.getElementById('wait-time').value) * 1000;
            let skipFillTimeMs = (document.getElementById('fill-time').value) * 1000;
            // Import the sample data and start animating.
            var geojsonURL = '/adminapi/auditpath/' + self.auditTaskId;
            d3.json(geojsonURL, function (collection) {
                animate(collection, lastPaused, speedMultiplier, maxWaitMs, skipFillTimeMs);
            });
            document.getElementById('control-btn').innerHTML = 'Pause';
        }

        // This function "pauses" the animation by saving the last moment where it stopped.
        function pauseAnimation() {
            console.log('int4erupreur');
            d3.selectAll('*').transition();
            document.getElementById('control-btn').innerHTML = 'Play';
        }

        /**
         * This function animates how a user (represented as a yellow circle) walked through the map and labeled
         * accessibility attributes.
         *
         * param walkTrajectory A trajectory of a user's auditing activity in a GeoJSON FeatureCollection format.
         */
        function animate(walkTrajectory, startTime, speedMultiplier, maxWaitMs, skipFillTimeMs) {
            // https://github.com/mbostock/d3/wiki/Geo-Streams#stream-transforms
            var initialCoordinate = walkTrajectory.features[startTime].geometry.coordinates;
            var transform = d3.geo.transform({point: projectPoint});
            var d3path = d3.geo.path().projection(transform);
            var featuresdata = walkTrajectory.features;
            var timedata = [];
            var markerGroup = g.append('g').data(featuresdata);
            var marker = markerGroup.append('circle')
                .attr('r', 2)
                .attr('id', 'marker')
                .attr('class', 'travel-marker');
            var markerNose = markerGroup.append('line')
                .attr({'x1': 0, 'y1': -3, 'x2': 0, 'y2': -10})
                .attr('stroke', 'gray')
                .attr('stroke-width', 2);

            map.setView([initialCoordinate[1], initialCoordinate[0]], 18);

            // Set the initial heading
            markerGroup.attr('transform', function () {
                var y = featuresdata[startTime].geometry.coordinates[1];
                var x = featuresdata[startTime].geometry.coordinates[0];
                var heading = featuresdata[startTime].properties.heading;
                return 'translate(' +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).x + ',' +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).y + ')' +
                    'rotate(' + heading + ')';
            });


            // Get the bounding box and align the svg
            var bounds = d3path.bounds(walkTrajectory);
            var topLeft = bounds[0];
            var bottomRight = bounds[1];
            svg.attr('width', bottomRight[0] - topLeft[0] + 120)
                .attr('height', bottomRight[1] - topLeft[1] + 120)
                .style('left', topLeft[0] - 50 + 'px')
                .style('top', topLeft[1] - 50 + 'px');
            g.attr('transform', 'translate(' + (-topLeft[0] + 50) + ',' + (-topLeft[1] + 50) + ')');

            // Apply the toLine function to align the path to
            markerGroup.attr('transform', function () {
                var y = featuresdata[startTime].geometry.coordinates[1];
                var x = featuresdata[startTime].geometry.coordinates[0];
                return 'translate(' +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).x + ',' +
                    map.latLngToLayerPoint(new L.LatLng(y, x)).y + ')';
            });

            // Animate the marker's radius to 7px.
            markerGroup = markerGroup.attr('counter', startTime)
                .transition()
                .each('start', function () {
                    var thisMarker = d3.select(d3.select(this).node().children[0]);
                    var thisMarkerNose = d3.select(d3.select(this).node().children[0]);

                    thisMarker.transition()
                        .duration(250)
                        .attr('r', 7);
                })
                .duration(750);

            // Chain transitions.
            var timeToPlaybackTask = 0;
            var totalDuration = 0;
            var totalSkips = 0;
            var skippedTime = 0;

            for (let i = 0; i < featuresdata.length; i++) {
                // This controls the speed.
                featuresdata[i].properties.timestamp /= speedMultiplier;

                if (i > 0) {
                    let duration = featuresdata[i].properties.timestamp - featuresdata[i - 1].properties.timestamp;
                    if (duration > maxWaitMs) {
                        totalSkips += 1;
                        skippedTime += duration;
                        duration = skipFillTimeMs;
                    }
                    timedata[i] = timedata[i-1] + duration;
                    console.log(skipFillTimeMs);
                } else {
                    timedata[i] = 0;
                }
            }
            timeToPlaybackTask = timedata[featuresdata.length - 1];
            console.log(`Speed being multiplied by ${speedMultiplier}.`);
            console.log(`${totalSkips} pauses over ${maxWaitMs / 1000} sec totalling ${skippedTime / 1000} sec. Pausing for ${skipFillTimeMs / 1000} sec during those.`);
            console.log(`Time to replay task: ${timeToPlaybackTask / 1000} seconds`);

            document.getElementById('total-time-label').innerHTML = (timeToPlaybackTask/1000).toFixed(0);
            var currentTimestamp = featuresdata[startTime].properties.timestamp;
            var currPano = null;
            var renderedLabels = [];
            for (let i = startTime; i < featuresdata.length; i++) {
                var duration = featuresdata[i].properties.timestamp - currentTimestamp;
                currentTimestamp = featuresdata[i].properties.timestamp;

                // If there is a greater than 30 second pause, log to console but only pause for 1 second.
                if (duration > maxWaitMs) {
                    duration = skipFillTimeMs;
                }
                markerGroup = markerGroup.transition()
                    .duration(duration)
                    .attr('transform', function () {
                        var y = featuresdata[i].geometry.coordinates[1];
                        var x = featuresdata[i].geometry.coordinates[0];
                        var heading = featuresdata[i].properties.heading;
                        return 'translate(' +
                            map.latLngToLayerPoint(new L.LatLng(y, x)).x + ',' +
                            map.latLngToLayerPoint(new L.LatLng(y, x)).y + ')' +
                            'rotate(' + heading + ')';
                    })
                    .each('start', function () {
                        var counter = d3.select(this).attr('counter');
                        var d = featuresdata[counter];

                        if (!self.panorama) self.panorama = AdminPanorama($('#svholder')[0]);

                        if (currPano === null || currPano !== d.properties.panoId) {
                            currPano = d.properties.panoId;
                            self.panorama.setPano(d.properties.panoId, d.properties.heading, d.properties.pitch, d.properties.zoom);
                        } else {
                            self.panorama.setPov(d.properties.heading, d.properties.pitch, d.properties.zoom);
                        }

                        self.showEvent(d.properties);

                        if (d) {
                            map.setView([d.geometry.coordinates[1], d.geometry.coordinates[0]], 18);

                            // If the 'label' is in the data, draw the label data and attach mouseover/mouseout events.
                            if ('label' in d.properties && !renderedLabels.includes(d.properties.label.label_id)) {
                                var label = d.properties.label;
                                var fill = (label.label_type in colorScheme) ? colorScheme[label.label_type].fillStyle : 'rgb(128, 128, 128)';
                                var p = map.latLngToLayerPoint(new L.LatLng(label.coordinates[1], label.coordinates[0]));
                                var c = g.append('circle')
                                    .attr('r', 5)
                                    .attr('cx', p.x)
                                    .attr('cy', p.y)
                                    .attr('fill', fill)
                                    .attr('stroke-width', 1)
                                    .on('mouseover', function () {
                                        d3.select(this).attr('r', 15);
                                    })
                                    .on('mouseout', function () {
                                        d3.select(this).attr('r', 5);
                                    });

                                var adminPanoramaLabel = AdminPanoramaLabel(
                                    label.label_id, label.label_type, label.canvasX, label.canvasY,
                                    util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT,
                                    d.properties.heading, d.properties.pitch, d.properties.zoom
                                );
                                self.panorama.renderLabel(adminPanoramaLabel);
                                renderedLabels.push(label.label_id);

                            }
                        }

                        document.getElementById('current-time-label').innerText = `${(timedata[counter]/1000).toFixed(0)}`;

                        $('#timeline-active').animate({
                            width: 360 * (timedata[counter]/timeToPlaybackTask)
                        }, 0);

                        $('#timeline-handle').animate({
                            left: 360 * (timedata[counter]/timeToPlaybackTask)
                        }, 0);

                        // console.log(`duration: ${duration}`);
                        d3.select(this).attr('counter', ++counter);
                        lastPaused = d3.select(this).attr('counter');

                        // Outputs message to refresh page.
                        if (lastPaused >= featuresdata.length) {
                            document.getElementById('control-btn').innerHTML = "Refresh Page to Replay";
                        }
                    });
            }
        }

        function projectPoint(x, y) {
            // https://github.com/mbostock/d3/wiki/Geo-Streams#stream-transforms
            var point = map.latLngToLayerPoint(new L.LatLng(y, x));
            this.stream.point(point.x, point.y);
        }
    })();

    self.showEvent = function(data) {
        var eventsholder = $('#eventsholder');
        var event = $("<div class='event'/>");
        event.append("<div class='type'>" + data['action'] + "</div>");
        event.append("<div class='desc'>"+ data['note'] +"</div>");

        event.hide().prependTo(eventsholder).fadeIn(300);
    };
    
    self.data = _data;
    return self;
}
