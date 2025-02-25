/**
 * Todo. This module needs to be cleaned up.
 * Todo. Separate the Google Maps component (UI and logic) and Street View component (UI and logic).
 * @param canvas
 * @param neighborhoodModel
 * @param uiMap
 * @param params
 * @returns {{className: string}}
 * @constructor
 */
function MapService (canvas, neighborhoodModel, uiMap, params) {
    var self = { className: 'Map' },
        _canvas = canvas,
        prevPanoId = undefined,
        properties = {
            browser : 'unknown',
            latlng : {
                lat : undefined,
                lng : undefined
            },
            panoramaPov : {
                heading : 0,
                pitch : 0,
                zoom : 1
            },
            map: null,
            maxPitch: 0,
            minPitch: -35,
            minHeading: undefined,
            maxHeading: undefined,
            isInternetExplore: undefined
        },
        status = {
            currPanoId: undefined,
            disablePanning: false,
            disableWalking : false,
            hideNonavailablePanoLinks : false,
            lockDisablePanning: false,
            lockDisableWalking : false,
            panoLinkListenerSet: false,
            bottomLinksClickable: false,
            svLinkArrowsLoaded : false,
            labelBeforeJumpListenerSet: false,
            jumpMsgShown: false,
            jumpImageryNotFoundStatus: undefined,
            contextMenuWasOpen: false
        },
        listeners = {
            beforeJumpListenerHandle: undefined
        },
        jumpLocation = undefined,
        missionJump = undefined,
        _stuckPanos = [];

    var initialPositionUpdate = true,
        panoramaOptions,
        END_OF_STREET_THRESHOLD = 25, // Distance from the endpoint of the street when we consider it complete (meters).
        minimapPaneBlinkInterval,
        moveDelay = 800; //delayed move
    //Move delay exists because too quick navigation causes rendering issues/black screens with no panos
    //No current solution to check that pano view is completely loaded before navigating
    //Hard delay is 2nd best option.

    // Used while calculation of canvas coordinates during rendering of labels
    // TODO: Refactor it to be included in the status variable above so that we can use
    // svl.map.setStatus("povChange", true); Instead of povChange["status"] = true;
    var povChange = {
        status: false
    };

    // Mouse status and mouse event callback functions
    var mouseStatus = {
        currX: 0,
        currY: 0,
        prevX: 0,
        prevY: 0,
        leftDownX: 0,
        leftDownY: 0,
        leftUpX: 0,
        leftUpY: 0,
        isLeftDown: false
    };

    // Maps variables
    var startingLatLng, map, mapOptions, mapStyleOptions;

    // Map UI setting
    // http://www.w3schools.com/googleAPI/google_maps_controls.asp
    if (params.panoramaPov) {
        properties.panoramaPov = params.panoramaPov;
    }
    if (params.latlng) {
        properties.latlng = params.latlng;
    } else if (('lat' in params) && ('lng' in params)) {
        properties.latlng = {'lat': params.lat, 'lng': params.lng};
    } else {
        throw self.className + ': latlng not defined.';
    }

    startingLatLng = typeof google != "undefined" ? new google.maps.LatLng(properties.latlng.lat, properties.latlng.lng) : null;

    mapOptions = {
        center: startingLatLng,
        mapTypeControl:false,
        mapTypeId: typeof google != "undefined" ? google.maps.MapTypeId.ROADMAP : null,
        maxZoom : 20,
        minZoom : 14,
        overviewMapControl:false,
        panControl:false,
        rotateControl:false,
        scaleControl:false,
        streetViewControl:true,
        cameraControl: false,
        zoomControl:false,
        zoom: 18,
        backgroundColor: "none",
        disableDefaultUI: true
    };

    var mapCanvas = document.getElementById("minimap");
    map = typeof google != "undefined" ? new google.maps.Map(mapCanvas, mapOptions) : null;

    // Styling google map.
    // http://stackoverflow.com/questions/8406636/how-to-remove-all-from-google-map
    // http://gmaps-samples-v3.googlecode.com/svn/trunk/styledmaps/wizard/index.html
    mapStyleOptions = [
        {
            featureType: "all",
            stylers: [
                { visibility: "off" }
            ]
        },
        {
            featureType: "road",
            stylers: [
                { visibility: "on" }
            ]
        },
        {
            "elementType": "labels",
            "stylers": [
                { "visibility": "off" }
            ]
        }
    ];

    if (map) map.setOptions({styles: mapStyleOptions});

    function _init(params) {
        params = params || {};

        self.properties = properties; // Make properties public.
        properties.browser = util.getBrowser();

        // Set GSV panorama options
        // To not show StreetView controls, take a look at the following gpage
        // http://blog.mridey.com/2010/05/controls-in-maps-javascript-api-v3.html
        // Set 'mode' to 'html4' in the SV panoramaOption.
        // https://groups.google.com/forum/?fromgroups=#!topic/google-maps-js-api-v3/q-SjeW19TJw
        if (params.lat && params.lng) {
            startingLatLng = new google.maps.LatLng(params.lat, params.lng);
            panoramaOptions = {
                position: startingLatLng,
                pov: properties.panoramaPov,
                showRoadLabels: false,
                motionTracking: false,
                motionTrackingControl: false
            };
        } else {
            console.warn(self.className + ' init(): The pano id nor panorama position is given. Cannot initialize the panorama.');
        }

        var panoCanvas = document.getElementById('pano');
        svl.panorama = typeof google != "undefined" ? new google.maps.StreetViewPanorama(panoCanvas, panoramaOptions) : null;

        svl.panorama.registerPanoProvider(function(pano) {
            if (pano === 'tutorial' || pano === 'afterWalkTutorial') {
                return getCustomPanorama(pano);
            }
            return null;
        });
        svl.panoramaContainer.addPanoMetadata('tutorial', getCustomPanorama('tutorial'));
        svl.panoramaContainer.addPanoMetadata('afterWalkTutorial', getCustomPanorama('afterWalkTutorial'));

        if (svl.panorama) {
            svl.panorama.set('addressControl', false);
            svl.panorama.set('clickToGo', false);
            svl.panorama.set('disableDefaultUI', true);
            svl.panorama.set('linksControl', true);
            svl.panorama.set('navigationControl', false);
            svl.panorama.set('showRoadLabels', true);
            svl.panorama.set('panControl', false);
            svl.panorama.set('scrollwheel', false);
            svl.panorama.set('cameraControl', false);
            svl.panorama.set('zoomControl', false);
            svl.panorama.set('keyboardShortcuts', true);
        }

        // Attach listeners to dom elements
        uiMap.viewControlLayer.bind('mousedown', handlerViewControlLayerMouseDown);
        uiMap.viewControlLayer.bind('mouseup', handlerViewControlLayerMouseUp);
        uiMap.viewControlLayer.bind('mousemove', handlerViewControlLayerMouseMove);
        uiMap.viewControlLayer.bind('mouseleave', handlerViewControlLayerMouseLeave);

        uiMap.viewControlLayer[0].onselectstart = function () { return false; };

        // Issue: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2468
        // This line of code is here to fix the bug when zooming with ctr +/-, the screen turns black.
        // We are updating the pano POV slightly to simulate an update the gets rid of the black pano.
        $(window).on('resize', function() {
            updatePov(.01,.01);
        });

        // Add listeners to the SV panorama.
        // https://developers.google.com/maps/documentation/javascript/streetview#StreetViewEvents
        if (typeof google != "undefined") {
            google.maps.event.addListener(svl.panorama, "pov_changed", handlerPovChange);
            google.maps.event.addListener(svl.panorama, "position_changed", handlerPositionUpdate);
            google.maps.event.addListener(svl.panorama, "pano_changed", handlerPanoramaChange);
            google.maps.event.addListenerOnce(svl.panorama, "pano_changed", switchToExploreMode);
            google.maps.event.addListener(svl.panorama, "zoom_changed", handlerZoomChange);
        }

        // Connect the map view and panorama view.
        if (map && svl.panorama) map.setStreetView(svl.panorama);

        // For Internet Explore, append an extra canvas in view-control-layer.
        properties.isInternetExplore = $.browser['msie'];
        if (properties.isInternetExplore) {
            uiMap.viewControlLayer.append(`<canvas width="${util.EXPLORE_CANVAS_WIDTH}px" height="${util.EXPLORE_CANVAS_HEIGHT}px"  class="window-streetview" style=""></canvas>`);
        }
    }

    /**
     * If the user is going through the tutorial, it will return the custom/stored panorama for either the initial
     * tutorial view or the "after walk" view.
     * @param pano - the pano ID/name of the wanted custom panorama.
     * @returns custom Google Street View panorama.
     * */
    function getCustomPanorama(pano) {
        if (pano === 'tutorial') {
            return {
                location: {
                    pano: 'tutorial',
                    latLng: new google.maps.LatLng(38.94042608, -77.06766133)
                },
                links: [],
                imageDate: '2014-05',
                copyright: 'Imagery (c) 2010 Google',
                tiles: {
                    tileSize: new google.maps.Size(2048, 1024),
                    worldSize: new google.maps.Size(4096, 2048),
                    centerHeading: 50.3866,
                    originHeading: 50.3866,
                    originPitch: -1.13769,
                    getTileUrl: function(pano, zoom, tileX, tileY) {
                        return `${svl.rootDirectory}img/onboarding/tiles/tutorial/${zoom}-${tileX}-${tileY}.jpg`;
                    }
                }
            };
        } else if (pano === 'afterWalkTutorial') {
            return {
                location: {
                    pano: 'afterWalkTutorial',
                    latLng: new google.maps.LatLng(38.94061618, -77.06768201)
                },
                links: [],
                imageDate: '2014-05',
                copyright: 'Imagery (c) 2010 Google',
                tiles: {
                    tileSize: new google.maps.Size(1700, 850),
                    worldSize: new google.maps.Size(3400, 1700),
                    centerHeading: 344,
                    originHeading: 344,
                    originPitch: 0,
                    getTileUrl: function(pano, zoom, tileX, tileY) {
                        return `${svl.rootDirectory}img/onboarding/tiles/afterwalktutorial/${zoom}-${tileX}-${tileY}.jpg`;
                    }
                }
            };
        }
    }

    /**
     * Disable walking thoroughly and indicate that user is moving.
     */
    function timeoutWalking() {
        svl.panorama.set('linksControl', false);
        svl.keyboard.setStatus("disableKeyboard", true);
        disableWalking();
        svl.keyboard.setStatus("moving", true);
    }

    /**
     * Enable walking and indicate that user has finished moving.
     */
    function resetWalking() {
        svl.panorama.set('linksControl', true);
        svl.keyboard.setStatus("disableKeyboard", false);
        enableWalking();
        svl.keyboard.setStatus("moving", false);
    }

    /*
     * Get the status of the labelBeforeJump listener.
     */
    function getLabelBeforeJumpListenerStatus() {
        return status.labelBeforeJumpListenerSet;
    }

    /*
     * Set the status of the labelBeforeJump listener.
     */
    function setLabelBeforeJumpListenerStatus(statusToSet) {
        status.labelBeforeJumpListenerSet = statusToSet;
    }

    /**
     * A helper function to move a user to the task location if they are far from it.
     * @param task - The task to move the user to.
     * @param force - If true, move the user to the task location even if they are close to it.
     * @param caller
     * @private
     */
    function moveToTheTaskLocation(task, force, caller) {
        // Reset all jump parameters.
        if (status.labelBeforeJumpListenerSet) {
            setLabelBeforeJumpListenerStatus(false);
            resetBeforeJumpLocationAndListener();
        }

        var callback = function (data, status) {
            if (status !== google.maps.StreetViewStatus.OK) {
                util.misc.reportNoStreetView(task.getStreetEdgeId());
                svl.taskContainer.endTask(task);

                // Get a new task and repeat.
                task = svl.taskContainer.nextTask(task);
                svl.taskContainer.setCurrentTask(task);
                moveToTheTaskLocation(task, force, caller);
            }
            self.preparePovReset();
        };

        var geometry = task.getGeometry();
        // Jump to the new location if it's really far away.
        var lat = geometry.coordinates[0][1],
            lng = geometry.coordinates[0][0],
            currentLatLng = getPosition(),
            newTaskPosition = turf.point([lng, lat]),
            currentPosition = turf.point([currentLatLng.lng, currentLatLng.lat]),
            distance = turf.distance(newTaskPosition, currentPosition, { units: 'kilometers' });
        if (force || distance > svl.CLOSE_TO_ROUTE_THRESHOLD) {
            self.setPosition(lat, lng, callback);

            if (caller === "jumpImageryNotFound") {
                status.jumpImageryNotFoundStatus = true;
            }
        } else {
            if (caller === "jumpImageryNotFound") {
                status.jumpImageryNotFoundStatus = false;
            }
        }
    }

    /**
     * Blink google maps pane.
     */
    function blinkMinimap() {
        stopBlinkingMinimap();
        minimapPaneBlinkInterval = window.setInterval(function () {
            svl.ui.minimap.overlay.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Disable panning on Street View
     * @returns {disablePanning}
     */
    function disablePanning() {
        if (!status.lockDisablePanning) {
            status.disablePanning = true;
        }
        return this;
    }

    /**
     * This method disables walking by hiding links towards other Street View panoramas.
     * @returns {disableWalking}
     */
    function disableWalking() {
        if (!status.lockDisableWalking) {
            // Disable clicking links and changing POV.
            hideLinks();
            uiMap.modeSwitchWalk.css('opacity', 0.5);
            status.disableWalking = true;
            // Disable forward and backwards keys
            svl.keyboard.setStatus("disableMovement", true);
        }
        return this;
    }

    /**
     * Enable panning on Street View.
     * @returns {enablePanning}
     */
    function enablePanning() {
        if (!status.lockDisablePanning) {
            status.disablePanning = false;
        }
        return this;
    }

    /**
     * This method enables walking to other panoramas by showing links.
     */
    function enableWalking() {
        // This method shows links on SV and enables users to walk.
        if (!status.lockDisableWalking) {
            // Enable clicking links and changing POV.
            showNavigationArrows();
            uiMap.modeSwitchWalk.css('opacity', 1);
            status.disableWalking = false;
            // Enable forward and backward keys
            svl.keyboard.setStatus("disableMovement", false);
        }
        return this;
    }

    /**
     * Get the google map.
     * @returns {null}
     */
    function getMap() {
        return map;
    }

    /**
     * Get the current panorama id.
     * @returns {string} Google Street View panorama id
     */
    function getPanoId () {
        return svl.panorama.getPano();
    }

    /**
     * Get the current latlng coordinate.
     * @returns {{lat: number, lng: number}}
     */
    function getPosition() {
        var pos = svl.panorama.getPosition();
        return { 'lat' : pos.lat(), 'lng' : pos.lng() };
    }

    /**
     * Get the current point of view.
     * @returns {object} pov
     */
    function getPov() {
        if ("panorama" in svl) {
            var pov = svl.panorama.getPov();

            // Make sure that zoom is set to an integer.
            pov.zoom = Math.round(pov.zoom);

            // Adjust heading to be between 0 and 360 instead of -180 to 180.
            while (pov.heading < 0) {
                pov.heading += 360;
            }
            while (pov.heading > 360) {
                pov.heading -= 360;
            }
            return pov;
        }
    }

    /**
     * This method returns a value of a specified property.
     * @param prop
     * @returns {*}
     */
    function getProperty(prop) {
        return (prop in properties) ? properties[prop] : false;
    }

    /**
     * Get svg element (arrows) in Street View.
     * @returns {*}
     */
    function getNavArrowsLayer() {
        return uiMap.pano.find('svg').parent();
    }

    self.getStatus = function (key) {
        return status[key];
    };

    function _jumpToNewTask(task, caller) {
        svl.taskContainer.setCurrentTask(task);
        moveToTheTaskLocation(task, false, caller);
    }

    function _jumpToNewLocation() {
        // Finish the current task.
        var currentMission = svl.missionContainer.getCurrentMission();
        if (currentMission) {
            finishCurrentTaskBeforeJumping(currentMission);

            // Get a new task and jump to the new task location.
            var currentTask = svl.taskContainer.getCurrentTask();
            var newTask = svl.taskContainer.nextTask(currentTask);
            if (newTask) {
                _jumpToNewTask(newTask, "jumpImageryNotFound");
            } else {
                // Complete current neighborhood if no new task available.
                svl.neighborhoodModel.setComplete();
                status.jumpImageryNotFoundStatus = true;
            }
        } else {
            console.error("Mission is not set!");
        }
    }

    /**
     *  Callback for when there is no panorama imagery found.
     *  A popup message is shown. When the user clicks okay, the user is moved to a new location.
     *  Issue #537
     */
    function jumpImageryNotFound() {
        self.preparePovReset();
        var currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
        var currentNeighborhoodName = currentNeighborhood.getProperty("name");

        var title = "Error in Google Street View";
        var message = "Uh-oh, something went wrong with Google Street View. This is not your fault, but we will need " +
            "to move you to another place in the " + currentNeighborhoodName + " neighborhood. Keep up the good work!";
        svl.panorama.set('linksControl', false); // Disable navigation arrows.
        disableWalking();
        disablePanning();
        svl.canvas.disableLabeling();

        var callback = function () {
            enableWalking();
            enablePanning();
            svl.canvas.enableLabeling();

            _jumpToNewLocation();
            var afterJumpStatus = status.jumpImageryNotFoundStatus;

            if (!afterJumpStatus) {
                // Find another location.
                _jumpToNewLocation();
                status.jumpImageryNotFoundStatus = undefined; // Reset variable after the jump.
            }
            else {
                status.jumpImageryNotFoundStatus = undefined; // Reset variable after the jump.
            }
            svl.panorama.set('linksControl', true); // Enable navigation arrows.
            svl.panorama.setVisible(true);
        };

        svl.popUpMessage.notify(title, message, callback);
    }

    /**
     * Initiate imagery not found mechanism.
     */
    function handleImageryNotFound(panoId, panoStatus) {
        var currentTask = svl.taskContainer.getCurrentTask();
        if (currentTask) {
            util.misc.reportNoStreetView(currentTask.getStreetEdgeId());
            console.error("Error Type: " + JSON.stringify(panoStatus) +
                "\nNo Street View found at this location: " + panoId + " street " + currentTask.getStreetEdgeId() +
                "\nNeed to move to a new location.");
        }

        svl.tracker.push("PanoId_NotFound", {'TargetPanoId': panoId});

        // Move to a new location
        jumpImageryNotFound();
    }

    /**
     * Callback for pano_changed event (https://developers.google.com/maps/documentation/javascript/streetview).
     * Update the map pane, and also query data for the new panorama.
     */
    function handlerPanoramaChange() {
        if (svl.panorama) {
            var panoId = getPanoId();

            if (typeof panoId === "undefined" || panoId.length === 0) {
                if ('compass' in svl) {
                    svl.compass.update();
                }
                return;
            }

            // Checks if pano_id is the same as the previous one. Google Maps API triggers pano_changed event twice:
            // once moving between pano_ids and once for setting the new pano_id.
            if (svl.streetViewService && panoId.length > 0 && panoId !== prevPanoId) {
                // Check if panorama exists.
                svl.streetViewService.getPanorama({ pano: panoId },
                    function (data, panoStatus) {
                        if (panoStatus === google.maps.StreetViewStatus.OK) {
                            // Record the pano metadata.
                            svl.panoramaContainer.addPanoMetadata(panoId, data);

                            // Mark that we visited this pano so that we can tell if they've gotten stuck.
                            svl.stuckAlert.panoVisited(panoId);

                            // Updates the date overlay to match when the current panorama was taken.
                            svl.ui.date.text(moment(data.imageDate).format('MMM YYYY'));
                            var panoramaPosition = svl.panorama.getPosition(); // Current position.
                            map.setCenter(panoramaPosition);

                            povChange["status"] = true;
                            _canvas.clear();
                            _canvas.setOnlyLabelsOnPanoAsVisible(panoId);
                            _canvas.render();
                            povChange["status"] = false;

                            svl.tracker.push("PanoId_Changed", {
                                panoId: panoId,
                                lat: data.location.latLng.lat(),
                                lng: data.location.latLng.lng(),
                                cameraHeading: data.tiles.originHeading,
                                cameraPitch: -data.tiles.originPitch, // cameraPitch is negative originPitch.
                            });
                            prevPanoId = panoId;

                        } else if (panoId === "tutorial" || panoId === "afterWalkTutorial") {
                            var imageDate = svl.panoramaContainer.getPanorama(panoId).data().imageDate;
                            svl.ui.date.text(moment(imageDate).format('MMM YYYY'));
                        } else {
                            handleImageryNotFound(panoId, panoStatus);
                        }
                    }
                );
            }
            if ('compass' in svl) {
                svl.compass.update();
            }
        } else {
            throw self.className + ' handlerPanoramaChange(): panorama not defined.';
        }
    }

    function finishCurrentTaskBeforeJumping(mission, nextTask) {
        if (mission === undefined) {
            mission = missionJump;
        }
        // Finish the current task.
        var currentTask = svl.taskContainer.getCurrentTask();
        svl.taskContainer.endTask(currentTask, nextTask);
        mission.pushATaskToTheRoute(currentTask);
    }

    /**
     * Get a new task and check if it's disconnected from the current task. If yes, then finish the current task after
     * the user has finished labeling the current location.
     * @param task
     * @param mission
     * @private
     */
    function _endTheCurrentTask(task, mission) {
        if (!status.labelBeforeJumpListenerSet) { 
            missionJump = mission;
            var nextTask = svl.taskContainer.nextTask(task);

            // If we are out of streets, set the route/neighborhood as complete.
            if (!nextTask) {
                svl.neighborhoodModel.setComplete();
            }

            // Check if the user will jump to another discontinuous location or if this is the last street in their
            // route/neighborhood. If either is the case, let the user know to label the location before proceeding.
            if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete() || (!task.isConnectedTo(nextTask) 
                    && !svl.taskContainer.isLastIncompleteTaskInNeighborhood(task))) {
                // If jumping to a new place, set the newTask before jumping.
                if (nextTask && !task.isConnectedTo(nextTask)) {
                    nextTask.eraseFromMinimap();
                    svl.taskContainer.setBeforeJumpNewTask(nextTask);
                }
                status.labelBeforeJumpListenerSet = true;

                // Store before jump location for tracking pre-jump actions when the user leaves their location.
                setBeforeJumpLocation();

                // Listener activated for tracking before-jump actions.
                try {
                    listeners.beforeJumpListenerHandle = google.maps.event.addListener(svl.panorama,
                        "pano_changed", trackBeforeJumpActions);
                } catch (err) {}
            } else {
                // As soon as we jump to the next task, we'll show the neighborhood complete overlay
                if (svl.taskContainer.isLastIncompleteTaskInNeighborhood(task)) {
                    svl.taskContainer.setShowNeighborhoodCompleteOverlayStatus(true);
                }

                finishCurrentTaskBeforeJumping(missionJump, nextTask);

                // Move to the new task if the route/neighborhood has not finished.
                if (nextTask) {
                    svl.taskContainer.setCurrentTask(nextTask);
                    moveToTheTaskLocation(nextTask, false);
                }
            }
        }
    }

    /**
     * Callback to track when user moves away from their current location.
     */
    function trackBeforeJumpActions() {
        if (status.labelBeforeJumpListenerSet) {
            var currentLatLng = getPosition(),
                currentPosition = turf.point([currentLatLng.lng, currentLatLng.lat]),
                jumpPosition = turf.point([jumpLocation.lng, jumpLocation.lat]),
                distance = turf.distance(jumpPosition, currentPosition, {units: 'kilometers'});

            if (!status.jumpMsgShown && distance >= 0.01) {
                // Show message to the user instructing them to label the current location.
                svl.tracker.push('LabelBeforeJump_ShowMsg');
                svl.compass.showLabelBeforeJumpMessage();
                status.jumpMsgShown = true

            } else if (distance > 0.07 && !svl.neighborhoodModel.isRouteOrNeighborhoodComplete()) {
                // Jump to the new location if it's really far away from their location.
                svl.tracker.push('LabelBeforeJump_AutoJump');

                // Finish the current task
                finishCurrentTaskBeforeJumping();

                // Reset jump parameters before jumping
                svl.compass.resetBeforeJump();

                // Jump to the new task
                var newTask = svl.taskContainer.getAfterJumpNewTask();
                _jumpToNewTask(newTask);
                svl.jumpModel.triggerTooFarFromJumpLocation();
            }
        }
    }

    /**
     * Reset before JumpLocation and Jump Task listener
     */
    function resetBeforeJumpLocationAndListener () {
        jumpLocation = undefined;
        status.jumpMsgShown = false;
        google.maps.event.removeListener(listeners.beforeJumpListenerHandle);
    }

    /**
     *
     * Sets before JumpLocation
     */
    function setBeforeJumpLocation () {
        // Set user's current location
        jumpLocation = getPosition();
    }

    // Todo. Wrote this ad-hoc. Clean up and test later.
    var positionUpdateCallbacks = [];
    self.bindPositionUpdate = function (callback) {
        if (typeof callback == 'function') {
            positionUpdateCallbacks.push(callback);
        }
    };
    self.unbindPositionUpdate = function (callback) {
        var callbackIndex = positionUpdateCallbacks.indexOf(callback);
        if (callbackIndex >= 0) {
            positionUpdateCallbacks.splice(callbackIndex, 1);
        }
    };

    /**
     * A callback for position_change.
     */
    function handlerPositionUpdate () {
        var isOnboarding = svl.isOnboarding()
        var position = svl.panorama.getPosition();
        var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
        var currentMission = svl.missionContainer.getCurrentMission();
        // Takes care of position_changed happening after the map has already been set
        map.setCenter(position);

        // Hide context menu if walking started
        if (svl.contextMenu.isOpen()) {
            svl.contextMenu.hide();
        }

        // Position updated, set delay until user can walk again to properly update canvas
        if (!isOnboarding && !svl.keyboard.getStatus("moving")) {
            timeoutWalking();
            setTimeout(resetWalking, moveDelay);
        }
        updateCanvas();
        if (currentMission && neighborhood) {
            if ("compass" in svl) {
                svl.compass.update();
            }
            if (!isOnboarding && "taskContainer" in svl && svl.taskContainer.tasksLoaded()) {
                svl.taskContainer.showNeighborhoodCompleteOverlayIfRequired();
                // End of the task if the user is close enough to the end point and we aren't in the tutorial.
                var task = svl.taskContainer.getCurrentTask();
                if (!isOnboarding && task && task.isAtEnd(position.lat(), position.lng(), END_OF_STREET_THRESHOLD)) {
                    _endTheCurrentTask(task, currentMission);
                }
                svl.taskContainer.updateCurrentTask();
            }
            if ("observedArea" in svl) {
                svl.observedArea.panoChanged();
            }
            svl.missionModel.updateMissionProgress(currentMission, neighborhood);
        }

        // Set the heading angle when the user is dropped to the new position.
        if (initialPositionUpdate && 'compass' in svl) {
            setPovToRouteDirection();
            initialPositionUpdate = false;
        }

        // Calling callbacks for position_changed event.
        for (var i = 0, len = positionUpdateCallbacks.length; i < len; i++) {
            var callback = positionUpdateCallbacks[i];
            if (typeof callback == 'function') {
                callback();
            }
        }
    }

    /**
     * Callback for pov update.
     */
    function handlerPovChange() {
        povChange["status"] = true;
        updateCanvas();
        povChange["status"] = false;

        if ("compass" in svl) { svl.compass.update(); }
        if ("observedArea" in svl) { svl.observedArea.update(); }

        svl.tracker.push("POV_Changed");
    }

    /**
     * Callback for zoom update.
     */
     function handlerZoomChange () {
        if ("observedArea" in svl) { svl.observedArea.update(); }

        svl.tracker.push("Zoom_Changed");
    }

    /**
     * Callback that is fired with the mousedown event on the view control layer (where you control street view angle).
     * @param e
     */
    function handlerViewControlLayerMouseDown(e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = mouseposition(e, this).x;
        mouseStatus.leftDownY = mouseposition(e, this).y;
        svl.tracker.push('ViewControl_MouseDown', {x: mouseStatus.leftDownX, y:mouseStatus.leftDownY});
        setViewControlLayerCursor('ClosedHand');

        // This is necessary for supporting touch devices, because there is no mouse hover.
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * Callback on mouse up event on the view control layer (where you change the Google Street view angle).
     * @param e
     */
    function handlerViewControlLayerMouseUp(e) {
        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = mouseposition(e, this).x;
        mouseStatus.leftUpY = mouseposition(e, this).y;
        svl.tracker.push('ViewControl_MouseUp', {x:mouseStatus.leftUpX, y:mouseStatus.leftUpY});
        setViewControlLayerCursor('OpenHand');
        var currTime = new Date().getTime();

        var selectedLabel = _canvas.onLabel(mouseStatus.currX, mouseStatus.currY);
        if (selectedLabel && selectedLabel.className === "Label") {
            _canvas.setCurrentLabel(selectedLabel);

            if ('contextMenu' in svl) {
                if (status.contextMenuWasOpen) {
                    svl.contextMenu.hide();
                } else {
                    svl.contextMenu.show(selectedLabel);
                }
                status.contextMenuWasOpen = false;
            }
        } else if (currTime - mouseStatus.prevMouseUpTime < 300) {
            // Continue logging double click. We don't have any features for it now, but it's good to know how
            // frequently people are trying to double-click. They might be trying to zoom?
            svl.tracker.push('ViewControl_DoubleClick');
        }
        setViewControlLayerCursor('OpenHand');
        mouseStatus.prevMouseUpTime = currTime;
    }

    function handlerViewControlLayerMouseLeave(e) {
        setViewControlLayerCursor('OpenHand');
        mouseStatus.isLeftDown = false;
    }

    /**
     * Callback that is fired when a user moves a mouse on the view control layer where you change the pov.
     */
    function handlerViewControlLayerMouseMove(e) {
        mouseStatus.currX = mouseposition(e, this).x;
        mouseStatus.currY = mouseposition(e, this).y;

        // Show/hide navigation arrows.
        if (!status.disableWalking) {
            showNavigationArrows();
        } else {
            hideLinks();
        }

        if (mouseStatus.isLeftDown && status.disablePanning === false) {
            // If a mouse is being dragged on the control layer, move the pano.
            var dx = mouseStatus.currX - mouseStatus.prevX;
            var dy = mouseStatus.currY - mouseStatus.prevY;
            var pov = getPov();
            var zoom = Math.round(pov.zoom);
            var zoomLevel = svl.ZOOM_FACTOR[zoom];
            dx = dx / (2 * zoomLevel);
            dy = dy / (2 * zoomLevel);
            dx *= 1.5;
            dy *= 1.5;
            updatePov(dx, dy);
        }

        // Show label delete menu.
        var item = _canvas.onLabel(mouseStatus.currX, mouseStatus.currY);
        if (item && item.className === "Label") {
            var selectedLabel = item;
            _canvas.setCurrentLabel(selectedLabel);
            _canvas.showLabelHoverInfo(selectedLabel);
            _canvas.clear().render();
        } else {
            _canvas.showLabelHoverInfo(undefined);
            _canvas.setCurrentLabel(undefined);
        }

        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }


    /**
     * This method hides links to neighboring Street View images by changing the svg path elements.
     *
     * @returns {hideLinks} This object.
     */
    function hideLinks() {
        var $paths = $("#view-control-layer").find('path');
        $paths.css('visibility', 'hidden');
        $paths.css('pointer-events', 'none');
        return this;
    }

    /**
     * Lock disable panning.
     * @returns {lockDisablePanning}
     */
    function lockDisablePanning() {
        status.lockDisablePanning = true;
        return this;
    }

    /**
     * This method locks status.disableWalking.
     * @returns {lockDisableWalking}
     */
    function lockDisableWalking() {
        status.lockDisableWalking = true;
        return this;
    }

    /**
     * This method brings the links (<, >) to the view control layer so that a user can click them to walk around.
     */
    function makeArrowsAndLinksClickable() {
        // Bring the links on the bottom of GSV and the mini map to the top layer so they are clickable.
        var bottomLinks = $('.gm-style-cc');
        if (!status.bottomLinksClickable && bottomLinks.length > 7) {
            status.bottomLinksClickable = true;
            bottomLinks[0].remove(); // Remove GSV keyboard shortcuts link.
            bottomLinks[4].remove(); // Remove mini map keyboard shortcuts link.
            bottomLinks[5].remove(); // Remove mini map copyright text (duplicate of GSV).
            bottomLinks[7].remove(); // Remove mini map terms of use link (duplicate of GSV).
            uiMap.viewControlLayer.append($(bottomLinks[1]).parent().parent());
            svl.ui.minimap.overlay.append($(bottomLinks[8]).parent().parent());
        }

        // Bring the layer with arrows forward.
        var $navArrows = getNavArrowsLayer();
        uiMap.viewControlLayer.append($navArrows);

        // Add an event listener to the nav arrows to log their clicks.
        if (!status.panoLinkListenerSet && $navArrows.length > 0) {
            // TODO We are adding click events to extra elements that don't need it, we shouldn't do that :)
            $navArrows[0].addEventListener('click', function (e) {
                var targetPanoId = e.target.getAttribute('pano');
                if (targetPanoId) {
                    svl.tracker.push('WalkTowards', {'TargetPanoId': targetPanoId});
                }
            });
            status.panoLinkListenerSet = true;
        }

        if (properties.browser === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            uiMap.viewControlLayer.append(uiMap.canvas);
        } else if (properties.browser === 'msie') {
            uiMap.viewControlLayer.insertBefore(uiMap.drawingLayer);
        }
    }

    // Moves label drawing layer to the top and hides navigation arrows.
    function switchToLabelingMode() {

        svl.panorama.setOptions({'showRoadLabels': false});

        uiMap.drawingLayer.css('z-index','1');
        uiMap.viewControlLayer.css('z-index', '0');

        if (properties.browser === 'mozilla') {
            uiMap.drawingLayer.append(uiMap.canvas);
        }
        hideLinks();
    }

    // Moves label drawing layer to the bottom. Shows navigation arrows if walk is enabled.
    function switchToExploreMode() {

        svl.panorama.setOptions({'showRoadLabels': true});

        uiMap.viewControlLayer.css('z-index', '1');
        uiMap.drawingLayer.css('z-index','0');
        if (!status.disableWalking) {
            // Show the navigation arrows on top of the panorama and make arrows clickable.
            showNavigationArrows();
            makeArrowsAndLinksClickable();
        }
    }

    /**
     * @param panoramaId
     * @param force: force to change pano, even if walking is disabled
     * @returns {setPano}
     */
    function setPano(panoramaId, force) {
        if (force === undefined) force = false;

        if (!status.disableWalking || force) {
            svl.panorama.setPano(panoramaId);
        }
        return this;
    }

    /**
     * Set map position.
     * @param lat
     * @param lng
     * @param callback
     */
    function setPosition(lat, lng, callback) {
        if (!status.disableWalking) {
            // Check the presence of the Google Street View. If it exists, then set the location, otherwise error.
            var gLatLng = new google.maps.LatLng(lat, lng);
            svl.streetViewService.getPanorama({location: gLatLng, radius: svl.STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR},
                function (streetViewPanoramaData, status) {
                    if (status === google.maps.StreetViewStatus.OK) {

                        self.enableWalking();

                        // Sets new panorama.
                        var newPano = streetViewPanoramaData.location.pano;
                        self.setPano(newPano);
                        map.setCenter(gLatLng);

                        self.disableWalking();
                        window.setTimeout(function() { self.enableWalking(); }, 1000);
                    } else {
                        console.error("Street View does not exist at (lat, lng) = (" + lat + ", " + lng + ")");
                    }
                    if (callback) callback(streetViewPanoramaData, status);
                });
        }
        return this;
    }

    // For setting the position when the exact panorama is known.
    function setPositionByIdAndLatLng(panoId, lat, lng) {
        // Only set the location if walking is enabled
        if (!status.disableWalking) {
            var gLatLng = new google.maps.LatLng(lat, lng);

            self.enableWalking();
            self.setPano(panoId);
            map.setCenter(gLatLng);

            self.disableWalking();
            window.setTimeout(function() { self.enableWalking(); }, 1000);
        }
        return this;
    }

    function stopBlinkingMinimap() {
        window.clearInterval(minimapPaneBlinkInterval);
        svl.ui.minimap.overlay.removeClass("highlight-50");
    }

    function updateCanvas() {
        _canvas.clear();
        if (status.currPanoId !== getPanoId()) {
            _canvas.setOnlyLabelsOnPanoAsVisible(getPanoId());
        }
        status.currPanoId = getPanoId();
        _canvas.render();
    }

    function setViewControlLayerCursor(type) {
        switch(type) {
            case 'OpenHand':
                uiMap.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/openhand.cur) 4 4, move");
                break;
            case 'ClosedHand':
                uiMap.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/closedhand.cur) 4 4, move");
                break;
            default:
                uiMap.viewControlLayer.css("cursor", "default");
        }
    }

    /**
     * Show navigation arrow links (<, >) for walking.
     */
    function showNavigationArrows() {
        // A bit redundant, but as long as the link arrows have not been moved to user control layer, keep calling the
        // makeArrowsAndLinksClickable() to bring arrows to the top layer. Once loaded, set svLinkArrowsLoaded to true.
        if (!status.svLinkArrowsLoaded) {
            var numPath = uiMap.viewControlLayer.find("path").length;
            if (numPath === 0) {
                makeArrowsAndLinksClickable();
            } else {
                status.svLinkArrowsLoaded = true;
            }
        }
        $(".gmnoprint path").css('visibility', 'visible');
        $(".gmnoprint path").css('pointer-events', 'all');
    }

    /**
     * Make navigation arrows blink.
     */
    function blinkNavigationArrows() {
        setTimeout(() => {
            const arrows = document.querySelector("div.gmnoprint.SLHIdE-sv-links-control").querySelector("svg").querySelectorAll("path[fill-opacity='1']");
            // Obtain interval id to allow for the interval to be cleaned up after the arrow leaves document context.
            const intervalId = window.setInterval(function () {
                // Blink logic.
                arrows.forEach((arrow) => {
                    arrow.setAttribute("fill", (arrow.getAttribute("fill") === "white" ? "yellow" : "white"));

                    // Once the arrow is removed from the document, stop the interval for all arrows.
                    if (!document.body.contains(arrow)) window.clearInterval(intervalId);
                });
            }, 500);
        }, 500);
    }

    /*
     * Gets the pov change tracking variable.
     */
    function getPovChangeStatus() {
        return povChange;
    }

    /**
     * Prevents users from looking at the sky or straight to the ground. Restrict heading angle if specified in props.
     */
    function restrictViewPort(pov) {
        if (pov.pitch > properties.maxPitch) {
            pov.pitch = properties.maxPitch;
        } else if (pov.pitch < properties.minPitch) {
            pov.pitch = properties.minPitch;
        }
        if (properties.minHeading && properties.maxHeading) {
            if (properties.minHeading <= properties.maxHeading) {
                if (pov.heading > properties.maxHeading) {
                    pov.heading = properties.maxHeading;
                } else if (pov.heading < properties.minHeading) {
                    pov.heading = properties.minHeading;
                }
            } else {
                if (pov.heading < properties.minHeading &&
                    pov.heading > properties.maxHeading) {
                    if (Math.abs(pov.heading - properties.maxHeading) < Math.abs(pov.heading - properties.minHeading)) {
                        pov.heading = properties.maxHeading;
                    } else {
                        pov.heading = properties.minHeading;
                    }
                }
            }
        }
        return pov;
    }

    /**
     * Update POV of Street View as a user drags their mouse cursor.
     * @param dx
     * @param dy
     */
    function updatePov(dx, dy) {
        if (svl.panorama) {
            var pov = getPov();
            var alpha = 0.25;
            pov.heading -= alpha * dx;
            pov.pitch += alpha * dy;

            // View port restriction.
            pov = restrictViewPort(pov);

            // Update the status of pov change.
            povChange["status"] = true;

            // Set the property this object, then update the Street View image.
            properties.panoramaPov = pov;
            svl.panorama.setPov(pov);
        } else {
            throw self.className + ' updatePov(): panorama not defined!';
        }
    }

    /**
     * Set the minimum and maximum heading angle that users can adjust the Street View camera.
     * @param range
     * @returns {setHeadingRange}
     */
    function setHeadingRange(range) {
        properties.minHeading = range[0];
        properties.maxHeading = range[1];
        return this;
    }

    /**
     * Changes the Street View pov. If a transition duration is given, smoothly updates the pov over that time.
     * @param pov Target pov
     * @param durationMs Transition duration in milliseconds
     * @param callback Callback function executed after updating pov.
     * @returns {setPov}
     */
    function setPov(pov, durationMs, callback) {
        if (('panorama' in svl) && svl.panorama) {
            var currentPov = getPov();
            var interval;

            // Make sure that zoom is set to an integer value.
            if (pov.zoom) pov.zoom = Math.round(pov.zoom);

            // Pov restriction.
            restrictViewPort(pov);

            if (durationMs) {
                var timeSegment = 25; // 25 milliseconds.

                // Get how much angle you change over timeSegment of time.
                var cw = (pov.heading - currentPov.heading + 360) % 360;
                var ccw = 360 - cw;
                var headingIncrement;
                if (cw < ccw) {
                    headingIncrement = cw * (timeSegment / durationMs);
                } else {
                    headingIncrement = (-ccw) * (timeSegment / durationMs);
                }

                var pitchIncrement;
                var pitchDelta = pov.pitch - currentPov.pitch;
                pitchIncrement = pitchDelta * (timeSegment / durationMs);

                interval = window.setInterval(function () {
                    var headingDelta = (pov.heading - currentPov.heading + 360) % 360;
                    if (headingDelta > 1 && headingDelta < 359) {
                        // Update heading angle and pitch angle.
                        currentPov.heading += headingIncrement;
                        currentPov.pitch += pitchIncrement;
                        currentPov.heading = (currentPov.heading + 360) % 360;
                        svl.panorama.setPov(currentPov);
                    } else {
                        // Set the pov to adjust zoom level, then clear the interval. Invoke a callback if there is one.
                        if (!pov.zoom) {
                            pov.zoom = 1;
                        }

                        svl.panorama.setZoom(pov.zoom);
                        window.clearInterval(interval);
                        if (callback) {
                            callback();
                        }
                    }
                }, timeSegment);
            } else {
                svl.panorama.setPov(pov);
            }
        }
        return this;
    }

    function _turfPointToGoogleLatLng(point) {
        return new google.maps.LatLng(point.geometry.coordinates[1], point.geometry.coordinates[0]);
    }

    /**
     * Attempts to move the user forward in GSV by incrementally checking for imagery every few meters along the route.
     * @param successLogMessage [String] internal logging when imagery is found; different for stuck button v compass.
     * @param failLogMessage [String] internal logging when imagery is not found; different for stuck button v compass.
     * @param alertFunc [Function] An optional function that would alert the user upon successfully finding imagery.
     */
    function moveForward(successLogMessage, failLogMessage, alertFunc) {
        svl.modalComment.hide();
        svl.modalSkip.disableStuckButton();
        svl.compass.disableCompassClick();
        var enableClicksCallback = function() {
            svl.modalSkip.enableStuckButton();
            svl.compass.enableCompassClick();
        };
        // TODO show loading icon. Add when resolving issue #2403.

        // Grab street geometry and current location.
        var currentTask = svl.taskContainer.getCurrentTask();
        var streetEdge = currentTask.getFeature();
        var currentPano = getPanoId();
        var point = getPosition();
        var currPos = turf.point([point.lng, point.lat]);
        var streetEndpoint = turf.point([currentTask.getLastCoordinate().lng, currentTask.getLastCoordinate().lat]);

        // Remove the part of the street geometry that you've already passed using lineSlice.
        var remainder = turf.lineSlice(currPos, streetEndpoint, streetEdge);
        currPos = turf.point([remainder.geometry.coordinates[0][0], remainder.geometry.coordinates[0][1]]);
        var gLatLng = _turfPointToGoogleLatLng(currPos);

        // Save the current pano ID as one that you're stuck at.
        if (!_stuckPanos.includes(currentPano)) _stuckPanos.push(currentPano);

        // Set radius around each attempted point for which you'll accept GSV imagery to 10 meters.
        var MAX_DIST = 10;
        // Set how far to move forward along the street for each new attempt at finding imagery to 10 meters.
        var DIST_INCREMENT = 0.01;

        var GSV_SRC = google.maps.StreetViewSource.OUTDOOR;
        var GSV_OK = google.maps.StreetViewStatus.OK;
        var line;
        var end;

        // Callback function when querying GSV for imagery using streetViewService.getPanorama. If we don't find imagery
        // here, recursively call getPanorama with this callback function to test another 10 meters down the street.
        var callback = function(streetViewPanoData, status) {
            // If there is no imagery here that we haven't already been stuck in, either try further down the street,
            // try with a larger radius, or just jump to a new street if all else fails.
            if (status !== GSV_OK || _stuckPanos.includes(streetViewPanoData.location.pano)) {
                // If there is room to move forward then try again, recursively calling getPanorama with this callback.
                if (turf.length(remainder) > 0) {
                    // Save the current pano ID as one that doesn't work.
                    if (status === GSV_OK) {
                        _stuckPanos.push(streetViewPanoData.location.pano);
                    }
                    // Set `currPos` to be `DIST_INCREMENT` further down the street. Use `lineSliceAlong` to find that
                    // next point, and use `lineSlice` to remove the piece we just moved past from `remainder`.
                    line = turf.lineSliceAlong(remainder, 0, DIST_INCREMENT);
                    end = line.geometry.coordinates.length - 1;
                    currPos = turf.point([line.geometry.coordinates[end][0], line.geometry.coordinates[end][1]]);
                    remainder = turf.lineSlice(currPos, streetEndpoint, remainder);
                    gLatLng = _turfPointToGoogleLatLng(currPos);
                    svl.streetViewService.getPanorama({ location: gLatLng, radius: MAX_DIST, source: GSV_SRC }, callback);
                } else if (MAX_DIST === 10 && status !== GSV_OK) {
                    // If we get to the end of the street, increase the radius a bit to try and drop them at the end.
                    MAX_DIST = 25;
                    gLatLng = _turfPointToGoogleLatLng(currPos);
                    svl.streetViewService.getPanorama({ location: gLatLng, radius: MAX_DIST, source: GSV_SRC }, callback);
                } else {
                    // If all else fails, jump to a new street.
                    svl.tracker.push(failLogMessage);
                    svl.form.skip(currentTask, "GSVNotAvailable");
                    svl.stuckAlert.stuckSkippedStreet();
                    window.setTimeout(enableClicksCallback, 1000);
                }
            } else if (status === GSV_OK) {
                // Save current pano ID as one that doesn't work in case they try to move before clicking 'stuck' again.
                _stuckPanos.push(streetViewPanoData.location.pano);
                // Move them to the new pano we found.
                setPositionByIdAndLatLng(
                    streetViewPanoData.location.pano,
                    currPos.geometry.coordinates[1],
                    currPos.geometry.coordinates[0]
                );
                svl.tracker.push(successLogMessage);
                if (alertFunc !== null) alertFunc();
                window.setTimeout(enableClicksCallback, 1000);
            }
        };

        // Initial call to getPanorama with using the recursive callback function.
        svl.streetViewService.getPanorama({ location: gLatLng, radius: MAX_DIST, source: GSV_SRC }, callback);
    }

    /**
     * This function sets the current status of the instantiated object.
     * @param key
     * @param value
     * @returns {*}
     */
    function setStatus(key, value) {
        if (key in status) {
            // if the key is disableWalking, invoke walk disabling/enabling function
            if (key === "disableWalking") {
                if (typeof value === "boolean") {
                    if (value) {
                        disableWalking();
                    } else {
                        enableWalking();
                    }
                } else {
                    return false
                }
            } else {
                status[key] = value;
            }
            return this;
        }
        return false;
    }

    /**
     * Unlock disable panning.
     * @returns {unlockDisablePanning}
     */
    function unlockDisablePanning() {
        status.lockDisablePanning = false;
        return this;
    }

    /**
     * Unlock disable walking.
     * @returns {unlockDisableWalking}
     */
    function unlockDisableWalking() {
        status.lockDisableWalking = false;
        return this;
    }

    function setZoom(zoomLevel) {
        svl.panorama.setZoom(Math.round(zoomLevel));
    }

    // Set a flag that triggers the POV being reset into the route direction upon the position changing.
    function preparePovReset() {
        initialPositionUpdate = true;
    }

    // Set the POV in the same direction as the route.
    function setPovToRouteDirection(durationMs) {
        var pov = getPov();
        var newPov = {
            heading: Math.round(svl.compass.getTargetAngle() + 360) % 360,
            pitch: pov.pitch,
            zoom: pov.zoom
        }
        setPov(newPov, durationMs);
    }

    function getMoveDelay() {
        return moveDelay;
    }

    self.blinkMinimap = blinkMinimap;
    self.stopBlinkingMinimap = stopBlinkingMinimap;
    self.blinkNavigationArrows = blinkNavigationArrows;
    self.disablePanning = disablePanning;
    self.disableWalking = disableWalking;
    self.enablePanning = enablePanning;
    self.enableWalking = enableWalking;
    self.finishCurrentTaskBeforeJumping = finishCurrentTaskBeforeJumping;
    self.getLabelBeforeJumpListenerStatus = getLabelBeforeJumpListenerStatus;
    self.getMap = getMap;
    self.getPanoId = getPanoId;
    self.getProperty = getProperty;
    self.getPosition = getPosition;
    self.getPov = getPov;
    self.getPovChangeStatus = getPovChangeStatus;
    self.hideLinks = hideLinks;
    self.lockDisablePanning = lockDisablePanning;
    self.lockDisableWalking = lockDisableWalking;
    self.switchToLabelingMode = switchToLabelingMode;
    self.switchToExploreMode = switchToExploreMode;
    self.moveToTheTaskLocation = moveToTheTaskLocation;
    self.resetBeforeJumpLocationAndListener = resetBeforeJumpLocationAndListener;
    self.restrictViewPort = restrictViewPort;
    self.setBeforeJumpLocation = setBeforeJumpLocation;
    self.setHeadingRange = setHeadingRange;
    self.setLabelBeforeJumpListenerStatus = setLabelBeforeJumpListenerStatus; 
    self.setPano = setPano;
    self.setPosition = setPosition;
    self.setPositionByIdAndLatLng = setPositionByIdAndLatLng;
    self.setPov = setPov;
    self.moveForward = moveForward;
    self.setStatus = setStatus;
    self.unlockDisableWalking = unlockDisableWalking;
    self.unlockDisablePanning = unlockDisablePanning;
    self.setZoom = setZoom;
    self.preparePovReset = preparePovReset;
    self.setPovToRouteDirection = setPovToRouteDirection;
    self.timeoutWalking = timeoutWalking;
    self.resetWalking = resetWalking;
    self.getMoveDelay = getMoveDelay;

    _init(params);
    return self;
}
