function AdminTask(params) {
    let self = { auditTaskId: params.auditTaskId };

    mapboxgl.accessToken = params.mapboxApiKey;
    let map = new mapboxgl.Map({
        container: 'admin-task-choropleth',
        style: 'mapbox://styles/mapbox/streets-v12?optimize=true',
        maxZoom: 19,
        minZoom: 8.25,
        scrollZoom: false,
        doubleClickZoom: true
    }).addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }));
    self.map = map;

    (function mapAnimation () {
        const colorScheme = util.misc.getLabelColors();
        let currStep = 0;
        let paused = false;
        let featuresData;
        let currentTimestamp;
        let currPano = null;
        let renderedLabels = { type: 'FeatureCollection', features: [] };
        let timedata = [];
        let timeToPlaybackTask;
        let speedMultiplier = document.getElementById('speed-multiplier').value;
        let maxWaitMs = (document.getElementById('wait-time').value) * 1000;
        let skipFillTimeMs = (document.getElementById('fill-time').value) * 1000;

        // Add marker to show user's location and orientation.
        const userMarkerEl = document.createElement('div');
        userMarkerEl.className = 'user-marker';
        let userMarker;

        // Plays/Pauses the stream.
        $('#control-btn').on('click', function() {
            if (document.getElementById('control-btn').innerHTML === 'Play') {
                playAnimation();
            } else if (document.getElementById('control-btn').innerHTML === 'Pause') {
                pauseAnimation();
            }
        });


        // Adds input listeners and pauses playback whenever fields are changed.
        const elements = document.getElementsByTagName('input');
        for (let i = 0; i < elements.length; ++i) {
            elements[i].addEventListener('input', function() {
                pauseAnimation();
            });
        }

        function _init() {
            // Get the audit task data.
            $.getJSON('/adminapi/auditpath/' + self.auditTaskId, async function (data) {
                if (data.features.length === 0) {
                    alert('No data for this audit task.');
                    return;
                }

                featuresData = data.features;
                currentTimestamp = featuresData[0].properties.timestamp;

                // Initialize the pano.
                if (!self.panoManager) self.panoManager = await AdminPanorama($('#svholder')[0], null, true, params.viewerType, params.viewerAccessToken);
                self.panoManager.setPano(featuresData[0].properties.panoId, {
                    heading: featuresData[0].properties.heading,
                    pitch: featuresData[0].properties.pitch,
                    zoom: featuresData[0].properties.zoom
                });

                // Once the map has loaded, add the user marker and layer for the labels.
                map.on('load', function() {
                    const initialCoordinate = featuresData[0].geometry.coordinates;
                    map.jumpTo({ center: initialCoordinate, zoom: 17 });

                    userMarker = new mapboxgl.Marker(userMarkerEl)
                        .setLngLat(initialCoordinate).setRotation(featuresData[0].properties.heading).addTo(map);

                    map.addSource('labels', {
                        type: 'geojson',
                        data: renderedLabels
                    });
                    map.addLayer({
                        id: 'labels',
                        type: 'circle',
                        source: 'labels',
                        paint: {
                            'circle-radius': 5,
                            'circle-opacity': 0.75,
                            'circle-stroke-opacity': 1,
                            'circle-stroke-width': 1,
                            'circle-color': ['get', 'circleColor'],
                            'circle-stroke-color': '#fff'
                        }
                    });
                });
            });
        }

        // The animation is played again by recalculating the stream again from where it stopped.
        function playAnimation() {
            paused = false;
            resumeAnimation();
            document.getElementById('control-btn').innerHTML = 'Pause';
        }

        // This function "pauses" the animation by saving the last moment where it stopped.
        function pauseAnimation() {
            paused = true;
            document.getElementById('control-btn').innerHTML = 'Play';
        }

        // Execute the current step in the animation and move to the next one.
        function doNextStep() {
            let duration = featuresData[currStep].properties.timestamp - currentTimestamp;
            currentTimestamp = featuresData[currStep].properties.timestamp;

            // If there is a greater than 30 second pause, log to console but only pause for 1 second.
            if (duration > maxWaitMs) {
                duration = skipFillTimeMs;
            }

            // After the duration, execute the next step (assuming playback has not been paused).
            setTimeout(function() {
                if (paused) return;
                const action = featuresData[currStep];

                // Set orientation of the user.
                userMarker.setLngLat(action.geometry.coordinates).setRotation(action.properties.heading);

                // Update the pano POV.
                if (currPano === null || currPano !== action.properties.panoId) {
                    currPano = action.properties.panoId;
                    self.panoManager.setPano(action.properties.panoId, action.properties.heading, action.properties.pitch, action.properties.zoom);
                } else {
                    self.panoManager.panoViewer.setPov({
                        heading: action.properties.heading,
                        pitch: action.properties.pitch,
                        zoom: action.properties.zoom
                    });
                }

                // Update the location of the map.
                map.flyTo({ center: action.geometry.coordinates });

                // Add to the list of events.
                self.showEvent(action.properties);

                // If this step included adding a label, draw the label on the map and pano.
                if ('label' in action.properties && renderedLabels.features.filter(x => x.properties.label_id === action.properties.label.label_id).length === 0) {
                    let label = action.properties.label;
                    label.circleColor = colorScheme[label.label_type].fillStyle;
                    renderedLabels.features.push({ type: 'Feature', properties: label, geometry: { type: 'Point', coordinates: label.coordinates }});
                    map.getSource('labels').setData(renderedLabels);

                    const adminPanoramaLabel = AdminPanoramaLabel(
                        label.label_id, label.label_type, label.canvasX, label.canvasY,
                        util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT,
                        action.properties.heading, action.properties.pitch, action.properties.zoom
                    );
                    self.panoManager.renderLabel(adminPanoramaLabel);
                }

                // Update the UI for time elapsed.
                document.getElementById('current-time-label').innerText = `${(timedata[currStep] / 1000).toFixed(0)}`;
                $('#timeline-active').animate({ width: 360 * (timedata[currStep] / timeToPlaybackTask) }, 0);
                $('#timeline-handle').animate({ left: 360 * (timedata[currStep] / timeToPlaybackTask) }, 0);

                // Either move on to the next step or show that the animation is over.
                currStep += 1;
                if (currStep < featuresData.length) {
                    doNextStep();
                } else {
                    document.getElementById('control-btn').innerHTML = "Refresh page to replay";
                }
            }, duration);
        }

        // Recalculate the timestamps for each step and resume the animation.
        function resumeAnimation() {
            speedMultiplier = document.getElementById('speed-multiplier').value;
            maxWaitMs = (document.getElementById('wait-time').value) * 1000;
            skipFillTimeMs = (document.getElementById('fill-time').value) * 1000;

            // Calculate how long the task takes to replay.
            let totalSkips = 0;
            let skippedTime = 0;
            for (let i = 0; i < featuresData.length; i++) {
                // This controls the speed.
                featuresData[i].properties.timestamp /= speedMultiplier;

                if (i > 0) {
                    let duration = featuresData[i].properties.timestamp - featuresData[i - 1].properties.timestamp;
                    if (duration > maxWaitMs) {
                        totalSkips += 1;
                        skippedTime += duration;
                        duration = skipFillTimeMs;
                    }
                    timedata[i] = timedata[i - 1] + duration;
                } else {
                    timedata[i] = 0;
                }
            }
            timeToPlaybackTask = timedata[featuresData.length - 1];
            currentTimestamp = featuresData[currStep].properties.timestamp;

            // Log the time to replay the task to the console.
            console.log(`Speed being multiplied by ${speedMultiplier}.`);
            console.log(`${totalSkips} pauses over ${maxWaitMs / 1000} sec totalling ${skippedTime / 1000} sec. Pausing for ${skipFillTimeMs / 1000} sec during those.`);
            console.log(`Time to replay task: ${timeToPlaybackTask / 1000} seconds`);

            document.getElementById('total-time-label').innerHTML = (timeToPlaybackTask / 1000).toFixed(0);

            doNextStep();
        }

        _init();
    })();

    self.showEvent = function(data) {
        let eventsHolder = $('#eventsHolder');
        let event = $("<div class='event'/>");
        event.append("<div class='type'>" + data['action'] + "</div>");
        event.append("<div class='desc'>"+ data['note'] +"</div>");

        event.hide().prependTo(eventsHolder).fadeIn(300);
    };

    return self;
}
