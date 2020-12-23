function AdminTask(params) {
    var self = { auditTaskId: params.auditTaskId };
    var _data = {};

    L.mapbox.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var map = L.mapbox.map('map', null, {
        zoomControl: false,
        scrollWheelZoom: false,
        touchZoom: false,
        doubleClickZoom: true
    }).addLayer(L.mapbox.styleLayer('mapbox://styles/mapbox/streets-v11'));

    (function mapAnimation () {
        var colorScheme = util.misc.getLabelColors();
        var lastPaused = 0;
        // Prepare a layer to put d3 stuff
        var svg = d3.select(map.getPanes().overlayPane).append('svg');  // The base svg
        var g = svg.append('g').attr('class', 'leaflet-zoom-hide');  // The root group
        
        $('#control-btn').on('click', function() {
            if (document.getElementById('control-btn').innerHTML == 'Play') {
                playAnimation();
            } else {
                pauseAnimation();
            }
        });

        $('#replay-btn').on('click', function() {
            pauseAnimation();
            lastPaused = 0;
            playAnimation();
        })
        
        var elements = document.getElementsByTagName('input');
        for (let i = 0; i < elements.length; ++i) {
            elements[i].addEventListener('input', function() {
                pauseAnimation();
            });
        }
        
        function playAnimation() {
            const SPEEDUP_MULTIPLIER = document.getElementById('speed-multiplier').value;
            const MAX_WAIT_MS = document.getElementById('wait-time').value;
            const SKIP_FILL_TIME_MS = document.getElementById('fill-time').value;

            // Import the sample data and start animating
            var geojsonURL = '/adminapi/auditpath/' + self.auditTaskId;
            d3.json(geojsonURL, function (collection) {
                animate(collection, lastPaused, SPEEDUP_MULTIPLIER, MAX_WAIT_MS, SKIP_FILL_TIME_MS);
            });
            document.getElementById('control-btn').innerHTML = 'Pause';
        }

        // This function "pauses" the animation by saving the last moment where it stopped.
        // The animation is played again by recalculating the stream again from where it stopped.
        function pauseAnimation() {
            // TODO: check if d3 stream is active. 
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
        function animate(walkTrajectory, startTime, SPEEDUP_MULTIPLIER, MAX_WAIT_MS, SKIP_FILL_TIME_MS) {
            // https://github.com/mbostock/d3/wiki/Geo-Streams#stream-transforms
            var initialCoordinate = walkTrajectory.features[startTime].geometry.coordinates;
            var transform = d3.geo.transform({point: projectPoint});
            var d3path = d3.geo.path().projection(transform);
            var featuresdata = walkTrajectory.features;
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
            var totalDuration = 0;
            var totalSkips = 0;
            var skippedTime = 0;
            for (let i = startTime; i < featuresdata.length; i++) {
                // This controls the speed.
                featuresdata[i].properties.timestamp /= SPEEDUP_MULTIPLIER;

                if (i > 0) {
                    let duration = featuresdata[i].properties.timestamp - featuresdata[i - 1].properties.timestamp;

                    // If there is a greater than MAX_WAIT_MS pause, only pause for SKIP_FILL_TIME_MS.
                    if (duration > MAX_WAIT_MS) {
                        totalSkips += 1;
                        skippedTime += duration;
                        duration = SKIP_FILL_TIME_MS;
                    }
                    totalDuration += duration;
                }
            }
            console.log(`Speed being multiplied by ${SPEEDUP_MULTIPLIER}.`)
            console.log(`${totalSkips} pauses over ${MAX_WAIT_MS / 1000} sec totalling ${skippedTime / 1000} sec. Pausing for ${SKIP_FILL_TIME_MS / 1000} sec during those.`);
            console.log(`Total watch time: ${totalDuration / 1000} seconds`);

            $('#timeline-active').animate({
                width: '360px'
            }, totalDuration);

            $('#timeline-handle').animate({
                left: '360px'
            }, totalDuration);

            var currentTimestamp = featuresdata[0].properties.timestamp;
            var currPano = null;
            var renderedLabels = [];
            for (let i = startTime; i < featuresdata.length; i++) {
                var duration = featuresdata[i].properties.timestamp - currentTimestamp;
                currentTimestamp = featuresdata[i].properties.timestamp;

                // If there is a greater than 30 second pause, log to console but only pause for 1 second.
                if (duration > MAX_WAIT_MS) {
                    duration = SKIP_FILL_TIME_MS;
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
                                    d.properties.canvasWidth, d.properties.canvasHeight, d.properties.heading,
                                    d.properties.pitch, d.properties.zoom
                                );
                                self.panorama.renderLabel(adminPanoramaLabel);
                                renderedLabels.push(label.label_id);

                            }
                        }
                        d3.select(this).attr('counter', ++counter);
                        lastPaused = d3.select(this).attr('counter');
                        
                        // Allows the stream to restart at the beginning.
                        if (lastPaused >= featuresdata.length) {
                            lastPaused = 0;
                            pauseAnimation();
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
