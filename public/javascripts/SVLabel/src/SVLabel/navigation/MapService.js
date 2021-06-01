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
    // abbreviated dates for panorama date overlay
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    var self = { className: 'Map' },
        _canvas = canvas,
        mapIconInterval,
        lock = {
            renderLabels : false
        },
        markers = [],
        prevPanoId = undefined,
        properties = {
            browser : 'unknown',
            latlng : {
                lat : undefined,
                lng : undefined
            },
            panoramaPov : {
                heading : 359,
                pitch : -10,
                zoom : 1
            },
            map: null,
            maxPitch: 0,
            minPitch: -35,
            minHeading: undefined,
            maxHeading: undefined,
            mode : 'Labeling',
            isInternetExplore: undefined
        },
        status = {
            currentPanoId: undefined,
            disablePanning: false,
            disableWalking : false,
            disableClickZoom: false,
            hideNonavailablePanoLinks : false,
            lockDisablePanning: false,
            lockDisableWalking : false,
            panoLinkListenerSet: false,
            svLinkArrowsLoaded : false,
            labelBeforeJumpListenerSet: false,
            jumpMsgShown: false,
            jumpImageryNotFoundStatus: undefined
        },
        listeners = {
            beforeJumpListenerHandle: undefined
        },
        jumpLocation = undefined,
        missionJump = undefined,
        wasOpen = false;

    var initialPositionUpdate = true,
        panoramaOptions,
        STREETVIEW_MAX_DISTANCE = 50,
        ONE_STEP_DISTANCE_IN_M = 3,
        googleMapsPaneBlinkInterval,
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

    var panoChange = {
        status: false,
        initialPos: {
            pano: undefined,
            location: undefined,
            resolved: false
        },
        newPos: {
            pano: undefined,
            location: undefined,
            applied: false
        }
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
    var fenway, map, mapOptions, mapStyleOptions;

    // Street View variables
    var _streetViewInit;

    // Map UI setting
    // http://www.w3schools.com/googleAPI/google_maps_controls.asp
    if (params.panoramaPov) {
        properties.panoramaPov = params.panoramaPov;
    } else {
        properties.panoramaPov = {
            heading: 0,
            pitch: 0,
            zoom: 1
        };
    }
    if (params.latlng) {
        properties.latlng = params.latlng;
    } else if (('lat' in params) && ('lng' in params)) {
        properties.latlng = {'lat': params.lat, 'lng': params.lng};
    } else {
        throw self.className + ': latlng not defined.';
    }

    // fenway = new google.maps.LatLng(params.targetLat, params.targetLng);
    fenway = typeof google != "undefined" ? new google.maps.LatLng(properties.latlng.lat, properties.latlng.lng) : null;

    mapOptions = {
        center: fenway,
        mapTypeControl:false,
        mapTypeId: typeof google != "undefined" ? google.maps.MapTypeId.ROADMAP : null,
        maxZoom : 20,
        minZoom : 14,
        overviewMapControl:false,
        panControl:false,
        rotateControl:false,
        scaleControl:false,
        streetViewControl:true,
        zoomControl:false,
        zoom: 18,
        backgroundColor: "none",
        disableDefaultUI: true
    };

    var mapCanvas = document.getElementById("google-maps");
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
            fenway = new google.maps.LatLng(params.lat, params.lng);
            panoramaOptions = {
                mode : 'html4',
                position: fenway,
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

        if (svl.panorama) {
            svl.panorama.set('addressControl', false);
            svl.panorama.set('clickToGo', false);
            svl.panorama.set('disableDefaultUI', true);
            svl.panorama.set('linksControl', true);
            svl.panorama.set('navigationControl', false);
            svl.panorama.set('showRoadLabels', true);
            svl.panorama.set('panControl', false);
            svl.panorama.set('scrollwheel', false);
            svl.panorama.set('zoomControl', false);
            svl.panorama.set('keyboardShortcuts', true);
        }

        // Attach listeners to dom elements
        uiMap.viewControlLayer.bind('mousedown', handlerViewControlLayerMouseDown);
        uiMap.viewControlLayer.bind('mouseup', handlerViewControlLayerMouseUp);
        uiMap.viewControlLayer.bind('mousemove', handlerViewControlLayerMouseMove);
        uiMap.viewControlLayer.bind('mouseleave', handlerViewControlLayerMouseLeave);

        uiMap.viewControlLayer[0].onselectstart = function () { return false; };


        // Add listeners to the SV panorama
        // https://developers.google.com/maps/documentation/javascript/streetview#StreetViewEvents
        if (typeof google != "undefined") {
            google.maps.event.addListener(svl.panorama, "pov_changed", handlerPovChange);
            google.maps.event.addListener(svl.panorama, "position_changed", handlerPositionUpdate);
            google.maps.event.addListener(svl.panorama, "pano_changed", handlerPanoramaChange);
            google.maps.event.addListenerOnce(svl.panorama, "pano_changed", modeSwitchWalkClick);
        }

        // Connect the map view and panorama view
        if (map && svl.panorama) map.setStreetView(svl.panorama);

        // Set it to walking mode initially.

        _streetViewInit = setInterval(initStreetView, 100);

        // Hide the dude on the top-left of the map.
        mapIconInterval = setInterval(_removeIcon, 0.2);

        // For Internet Explore, append an extra canvas in view-control-layer.
        properties.isInternetExplore = $.browser['msie'];
        if (properties.isInternetExplore) {
            uiMap.viewControlLayer.append('<canvas width="720px" height="480px"  class="window-streetview" style=""></canvas>');
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
                copyright: 'Imagery (c) 2010 Google',
                tiles: {
                    tileSize: new google.maps.Size(2048, 1024),
                    worldSize: new google.maps.Size(4096, 2048),
                    centerHeading: 51,
                    getTileUrl: function(pano, zoom, tileX, tileY) {
                        return svl.rootDirectory + "img/onboarding/tiles/tutorial/" + zoom + "-" + tileX + "-" + tileY + ".jpg";
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
                copyright: 'Imagery (c) 2010 Google',
                tiles: {
                    tileSize: new google.maps.Size(1700, 850),
                    worldSize: new google.maps.Size(3400, 1700),
                    centerHeading: 344,
                    getTileUrl: function(pano, zoom, tileX, tileY) {
                        return svl.rootDirectory + "img/onboarding/tiles/afterwalktutorial/" + zoom + "-" + tileX + "-" + tileY + ".jpg";
                    }
                }
            };
        }
    }

    /*
       Disable walking thoroughly and indicate that user is moving.
     */
    function timeoutWalking() {
        svl.panorama.set('linksControl', false);
        svl.keyboard.setStatus("disableKeyboard", true);
        disableWalking();
        svl.keyboard.setStatus("moving", true);
    }
    /*
     Enable walking and indicate that user has finished moving.
     */
    function resetWalking() {
        svl.panorama.set('linksControl', true);
        svl.keyboard.setStatus("disableKeyboard", false);
        enableWalking();
        svl.keyboard.setStatus("moving", false);
    }


    /*
     * Get the status of the labelBeforeJump listener
     */
    function getLabelBeforeJumpListenerStatus() {
        return status.labelBeforeJumpListenerSet;
    }

    /*
     * Set the status of the labelBeforeJump listener
     */
    function setLabelBeforeJumpListenerStatus(statusToSet) {
        status.labelBeforeJumpListenerSet = statusToSet;
    }

    /**
     * A helper function to move a user to the task location
     * @param task
     * @param caller
     * @private
     */
    function moveToTheTaskLocation(task, caller) {

        // Reset all jump parameters
        if (status.labelBeforeJumpListenerSet) {
            setLabelBeforeJumpListenerStatus(false);
            resetBeforeJumpLocationAndListener();
            //console.log("Jumped to street: " + task.getStreetEdgeId());
        }

        var callback = function (data, status) {
            if (status !== google.maps.StreetViewStatus.OK) {
                util.misc.reportNoStreetView(task.getStreetEdgeId());
                svl.taskContainer.endTask(task);

                // Get a new task and repeat
                task = svl.taskContainer.nextTask(task);
                svl.taskContainer.setCurrentTask(task);
                if (caller !== undefined) {
                    moveToTheTaskLocation(task, caller);
                }
                else {
                    moveToTheTaskLocation(task);
                }
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
            distance = turf.distance(newTaskPosition, currentPosition, {units: 'kilometers'});
        if (distance > 0.1) {
            self.setPosition(lat, lng, callback);

            if (caller === "jumpImageryNotFound") {
                status.jumpImageryNotFoundStatus = true;
            }
        } else {
            if (caller === "jumpImageryNotFound") {
                status.jumpImageryNotFoundStatus = false;
            }
        }

        /*
        if (status.labelBeforeJumpListenerSet) {
            setLabelBeforeJumpListenerStatus(false);
            if ("compass" in svl) {svl.compass.update();}
        }*/
    }

    /**
     * A helper method to remove icons on Google Maps
     */
    function _removeIcon() {
        var doms = $('.gmnoprint'), $images;
        if (doms.length > 0) {
            window.clearInterval(mapIconInterval);
            $.each($('.gmnoprint'), function (i, v) {
                $images = $(v).find('img');
                if ($images) $images.css('visibility', 'hidden');
            });
        }
    }

    /**
     * Blink google maps pane
     */
    function blinkGoogleMaps () {
        stopBlinkingGoogleMaps();
        googleMapsPaneBlinkInterval = window.setInterval(function () {
            svl.ui.googleMaps.overlay.toggleClass("highlight-50");
        }, 500);
    }

    function destroyMaps() {
        hideGoogleMaps();
    }

    function hideGoogleMaps () {
        svl.ui.googleMaps.holder.hide();
    }

    svl.neighborhoodModel.on("Neighborhood:completed", function(parameters) {
        destroyMaps();
    });

    /**
     * This method disables zooming by double click.
     */
    function disableClickZoom () {
        status.disableClickZoom = true;
    }

    /**
     * Disable panning on Street View
     * @returns {disablePanning}
     */
    function disablePanning () {
        if (!status.lockDisablePanning) {
            status.disablePanning = true;
        }
        return this;
    }

    /**
     * This method disables walking by hiding links towards other Street View panoramas.
     * @returns {disableWalking}
     */
    function disableWalking () {
        if (!status.lockDisableWalking) {
            // Disable clicking links and changing POV
            hideLinks();
            uiMap.modeSwitchWalk.css('opacity', 0.5);
            status.disableWalking = true;
        }
        return this;
    }

    /**
     * This method enables zooming by double click.
     */
    function enableClickZoom () {
        status.disableClickZoom = false;
    }

    /**
     * Enable panning on Street View
     * @returns {enablePanning}
     */
    function enablePanning () {
        if (!status.lockDisablePanning) {
            status.disablePanning = false;
        }
        return this;
    }

    /**
     * This method enables walking to other panoramas by showing links.
     */
    function enableWalking () {
        // This method shows links on SV and enables users to walk.
        if (!status.lockDisableWalking) {
            // Enable clicking links and changing POV
            showLinks();
            uiMap.modeSwitchWalk.css('opacity', 1);
            status.disableWalking = false;
        }
        return this;
    }

    /**
     * Get the google map
     * @returns {null}
     */
    function getMap() {
        return map;
    }

    /**
     * Get the max pitch
     * @returns {number}
     */
    function getMaxPitch () {
        return properties.maxPitch;
    }

    /**
     * Get the minimum pitch
     * @returns {number|*}
     */
    function getMinPitch () {
        return properties.minPitch;
    }

    /**
     * Returns a panorama dom element that is dynamically created by GSV API
     * @returns {*}
     */
    function getPanoramaLayer () {
        return uiMap.pano.children(':first').children(':first').children(':first').children(':eq(5)');
    }

    /**
     * Get the current panorama id.
     * @returns {string} Google Street View panorama id
     */
    function getPanoId () {
        return svl.panorama.getPano();
    }

    /**
     * Get the current latlng coordinate
     * @returns {{lat: number, lng: number}}
     */
    function getPosition () {
        var pos = svl.panorama.getPosition();
        return { 'lat' : pos.lat(), 'lng' : pos.lng() };
    }

    /**
     * Get the current point of view
     * @returns {object} pov
     */
    function getPov () {
        if ("panorama" in svl) {
            var pov = svl.panorama.getPov();

            // Pov can be less than 0. So adjust it.
            while (pov.heading < 0) {
                pov.heading += 360;
            }

            // Pov can be more than 360. Adjust it.
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
    function getProperty (prop) {
        return (prop in properties) ? properties[prop] : false;
    }

    /**
     * Get svg element (arrows) in Street View.
     * @returns {*}
     */
    function getLinkLayer () {
        return uiMap.pano.find('svg').parent();
    }

    /**
     * Get link layer of bottom links
     * @returns {*}
     */
    function getBottomLinkLayer () {
        var links = $(uiMap.pano.find("a")[6]).parent().parent().parent();
        return links;
    }

    self.getStatus = function (key) {
        return status[key];
    };

    /**
     * This function takes a step in the given direction
     * https://developers.google.com/maps/documentation/javascript/geometry#Navigation
     *
     * @param currentPosition
     * @param heading
     * @returns {*}
     */
    function _takeAStep(currentPosition, heading) {
        return google.maps.geometry.spherical.computeOffset(currentPosition, ONE_STEP_DISTANCE_IN_M, heading);
    }

    /**
     * Find a pano location where there is imagery available
     *
     * Mar 27: Currently not being used. A simple fix has been applied in the handlerPanoramaChange()
     * where this function was originally intended to be called.
     *
     * @param currentPosition
     * @param heading
     * @param round
     */
    function findPanoramaWhereImageryExists(currentPosition, heading, round) {
        // Loop through 3 steps from the current position
        // and find if panorama exists. If no panorama found,
        // then skip to a random location within the neighborhood
        if (round === undefined) round = 1;

        var rId = util.generateAlphaNumId();

        console.log("[" + rId + "]\n Pano: " + getPanoId() + "\nCurrent Position: " + currentPosition +
                    "\nHeading: " + heading);

        // Check for the next step
        var newLatLng = _takeAStep(currentPosition, heading);

        // Calculation from http://www.movable-type.co.uk/scripts/latlong.html
        // For final bearing, simply take the initial bearing from the end point
        // to the start point and reverse it with (brng+180)%360.
        var newHeading = google.maps.geometry.spherical.computeHeading(newLatLng, currentPosition);
        newHeading = (newHeading + 180) % 360; // New Heading

        console.log("[" + rId + "]\n Pano: " + getPanoId() + "\nNewLatLng:" + JSON.stringify(newLatLng));

        if (svl.streetViewService) {
            svl.streetViewService.getPanorama({location: newLatLng, radius: STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR},
                function (data, status) {
                    console.error("[" + rId + "]\nPano:" + getPanoId() + " Round:" + round + " LOC:Status: " + status);

                    if (status === google.maps.StreetViewStatus.OK) {
                        // Move to that location
                        console.error("[" + rId + "]\nPano: " + getPanoId() + " Panorama found at location: " + JSON.stringify(newLatLng));
                        var lat = newLatLng.lat(), lng = newLatLng.lng();
                        self.setPosition(lat, lng);
                    }
                    else {
                        console.error("[" + rId + "]\nPano:" + getPanoId() + " Panorama not found at location: " + JSON.stringify(newLatLng));
                        svl.tracker.push("PanoId_NotFound", {'Location': JSON.stringify(newLatLng)});

                        if (round < 3) {
                            findPanoramaWhereImageryExists(newLatLng, newHeading, round + 1);
                        } else {
                            jumpImageryNotFound();
                            console.error("[" + rId + "]\nPano: " + getPanoId() + " Position Updated");
                        }
                    }
                }
            );
        }
    }

    function _jumpToNewTask(task, caller) {
        svl.taskContainer.setCurrentTask(task);
        if (caller === undefined) {
            moveToTheTaskLocation(task);
        }
        else {
            moveToTheTaskLocation(task, caller);
        }
    }

    function _jumpToNewLocation() {

        // Finish the current task
        var currentMission = svl.missionContainer.getCurrentMission();
        if (currentMission) {
            finishCurrentTaskBeforeJumping(currentMission);

            // Get a new task and jump to the new task location
            var currentTask = svl.taskContainer.getCurrentTask();
            var newTask = svl.taskContainer.nextTask(currentTask);
            if (newTask) {
                _jumpToNewTask(newTask, "jumpImageryNotFound");

            } else {
                // Complete current neighborhood if no new task available
                finishNeighborhood();
                status.jumpImageryNotFoundStatus = true;
            }
        } else {
            console.error("Mission is not set!");
        }
    }

    /**
     *  Callback for when there is no panorama imagery found.
     *  A popup message is shown. When the user clicks okay, the user is moved to a new location
     *  Issue #537
     */
    function jumpImageryNotFound() {
        self.preparePovReset();
        var currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
        var currentNeighborhoodName = currentNeighborhood.getProperty("name");

        var title = "Error in Google Street View";
        var message = "Uh-oh, something went wrong with Google Street View. " +
            "This is not your fault, but we will need to move you to another location in the " +
            currentNeighborhoodName + " neighborhood. Keep up the good work!";
        svl.panorama.set('linksControl', false);//disable arrows
        disableWalking(); //disable walking
        disablePanning(); //disable panning
        svl.canvas.disableLabeling(); //disable labeling

        var callback = function () {
            enableWalking(); //enable walking
            enablePanning(); //panning
            svl.canvas.enableLabeling();

            _jumpToNewLocation();
            var afterJumpStatus = status.jumpImageryNotFoundStatus;

            if (!afterJumpStatus) {
                // Find another location
                _jumpToNewLocation();// Reset variable after the jump
                status.jumpImageryNotFoundStatus = undefined;
            }
            else {
                // Reset variable after the jump
                status.jumpImageryNotFoundStatus = undefined;
            }
            svl.panorama.set('linksControl', true); //enable arrows
            svl.panorama.setVisible(true);
            //handlerPanoramaChange();//refresh pano ID, etc
        };

        svl.popUpMessage.notify(title, message, callback);

    }

    /***
     * Initiate imagery not found mechanism
     */
    function handleImageryNotFound(panoId, panoStatus) {
        // Imagery not found
        var currentTask = svl.taskContainer.getCurrentTask();
        if (currentTask) {
            util.misc.reportNoStreetView(currentTask.getStreetEdgeId());
            console.error("Error Type: " + JSON.stringify(panoStatus) +
                "\nNo street view found at this location: " + panoId + " street " +
                currentTask.getStreetEdgeId() +
                "\nNeed to move to a new location.");
        }

        svl.tracker.push("PanoId_NotFound", {'TargetPanoId': panoId});

        // Move to a new location
        jumpImageryNotFound();

        // Sophisticated Fix - Find pano along the route first before jumping
        // var pov = getPov();
        // findPanoramaWhereImageryExists(panoramaPosition, pov.heading);
    }

    /**
     * Callback for pano_changed event (https://developers.google.com/maps/documentation/javascript/streetview).
     * Update the map pane, and also query data for the new panorama.
     */
    function handlerPanoramaChange () {
        if (svl.panorama) {
            var panoId = getPanoId();

            if (typeof panoId === "undefined" || panoId.length == 0) {
                if ('compass' in svl) {
                    svl.compass.update();
                }
                return;
            }

            if (svl.streetViewService && panoId.length > 0) {
                // Check if panorama exists
                svl.streetViewService.getPanorama({pano: panoId},
                    function (data, panoStatus) {
                        if (panoStatus === google.maps.StreetViewStatus.OK) {
                            // Updates the date overlay to match when the current panorama was taken.
                            document.getElementById("svl-panorama-date").innerText = moment(data.imageDate).format('MMM YYYY');
                            var panoramaPosition = svl.panorama.getPosition(); // Current Position
                            map.setCenter(panoramaPosition);

                            povChange["status"] = true;

                            _canvas.clear();
                            _canvas.setVisibilityBasedOnLocation('visible', panoId);
                            _canvas.render2();

                            povChange["status"] = false;

                            // Attach listeners to svl.pointCloud
                            if ('pointCloud' in svl && svl.pointCloud) {
                                var pointCloud = svl.pointCloud.getPointCloud(panoId);
                                if (!pointCloud) {
                                    svl.pointCloud.createPointCloud(panoId);
                                    // svl.pointCloud.ready(panoId, function () {
                                    // console.log(svl.pointCloud.getPointCloud(panoId));
                                    //});
                                }
                            }

                            // Checks if pano_id is the same as the previous one.
                            // Google maps API triggers the pano_changed event twice: once moving
                            // between pano_ids  and once for setting the new pano_id.
                            if (panoId !== prevPanoId) {
                                svl.tracker.push("PanoId_Changed");
                                prevPanoId = panoId;
                            }
                        } else if (panoId === "tutorial" || panoId === "afterWalkTutorial") {
                            document.getElementById("svl-panorama-date").innerText = "May 2014";
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

    function finishNeighborhood() {
        var currentNeighborhood = svl.neighborhoodModel.currentNeighborhood();
        var currentNeighborhoodId = currentNeighborhood.getProperty("regionId");
        svl.neighborhoodModel.neighborhoodCompleted(currentNeighborhoodId);
        svl.tracker.push("NeighborhoodComplete_ByUser", {'RegionId': currentNeighborhoodId});
    }

    function finishCurrentTaskBeforeJumping(mission, nextTask) {
        if (mission === undefined) {
            mission = missionJump;
        }
        // Finish the current task
        var currentTask = svl.taskContainer.getCurrentTask();
        svl.taskContainer.endTask(currentTask, nextTask);
        mission.pushATaskToTheRoute(currentTask);
    }

    function _endTheCurrentTask(task, mission, neighborhood) {

        if (!status.labelBeforeJumpListenerSet) {

            // Get a new task and check if its disconnected from the current task. If yes, then finish the current task
            // after the user has labeling the the current location before jumping to the new location.

            missionJump = mission;
            var nextTask = svl.taskContainer.nextTask(task);

            if (nextTask && !task.isConnectedTo(nextTask)) {
                // Check if the interface jumped the user to another discontinuous location. If the user has indeed
                // jumped, [UPDATE] before jumping, let the user know to label the location before proceeding.

                // Set the newTask before jumping
                svl.taskContainer.setBeforeJumpNewTask(nextTask);
                status.labelBeforeJumpListenerSet = true;

                // Store before jump location for tracking pre-jump actions when the user leaves their location.
                setBeforeJumpLocation();

                // Listener activated for tracking before-jump actions
                try {
                    listeners.beforeJumpListenerHandle = google.maps.event.addListener(svl.panorama,
                        "pano_changed", trackBeforeJumpActions);
                } catch (err) {}
            }
            else {
                finishCurrentTaskBeforeJumping(missionJump, nextTask);

                // Move to the new task if the neighborhood has not finished
                if (nextTask) {
                    svl.taskContainer.setCurrentTask(nextTask);
                    moveToTheTaskLocation(nextTask);
                }
            }
            if (!nextTask) {
                finishNeighborhood();
            }
        }
    }

    /**
     * Callback to track when user moves away from his current location
     */
    function trackBeforeJumpActions() {

        // This is a callback function that is called each time the user moves
        // before jumping and checks if too far

        // Don't auto-jump in CV ground truth audits.
        if (svl.isCVGroundTruthAudit) {
            return;
        }

        if (status.labelBeforeJumpListenerSet) {
            var currentLatLng = getPosition(),
                currentPosition = turf.point([currentLatLng.lng, currentLatLng.lat]),
                jumpPosition = turf.point([jumpLocation.lng, jumpLocation.lat]),
                distance = turf.distance(jumpPosition, currentPosition, {units: 'kilometers'});

            // Jump to the new location if it's really far away from his location.
            if (!status.jumpMsgShown && distance >= 0.01) {
                //console.log("Jump message shown at " + distance)

                // Show message to the user instructing him to label the current location
                svl.tracker.push('LabelBeforeJump_ShowMsg');
                svl.compass.showLabelBeforeJumpMessage();
                status.jumpMsgShown = true

            }
            else if (distance > 0.07) {
                svl.tracker.push('LabelBeforeJump_AutoJump');

                // Finish the current task
                finishCurrentTaskBeforeJumping();

                // Reset jump parameters before jumping
                svl.compass.resetBeforeJump();

                // Jump to the new task
                var newTask = svl.taskContainer.getBeforeJumpNewTask();
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
        if (!svl.isOnboarding() && !svl.keyboard.getStatus("moving")) {
            timeoutWalking();
            setTimeout(resetWalking, moveDelay);
        }
        updateCanvas();
        if (currentMission && neighborhood) {
            if ("compass" in svl) {
                svl.compass.update();
            }
            if ("taskContainer" in svl) {
                svl.taskContainer.update();

                // End of the task if the user is close enough to the end point
                var task = svl.taskContainer.getCurrentTask();
                if (task && task.isAtEnd(position.lat(), position.lng(), 25)) {
                    _endTheCurrentTask(task, currentMission, neighborhood);
                }
            }
            svl.missionModel.updateMissionProgress(currentMission, neighborhood);
        }

        // Set the heading angle when the user is dropped to the new position
        if (initialPositionUpdate && 'compass' in svl) {
            setPovToRouteDirection();
            initialPositionUpdate = false;
        }

        // Calling callbacks for position_changed event
        for (var i = 0, len = positionUpdateCallbacks.length; i < len; i++) {
            var callback = positionUpdateCallbacks[i];
            if (typeof callback == 'function') {
                callback();
            }
        }
    }

    /**
     * Callback for pov update
     */
    function handlerPovChange () {
        // This is a callback function that is fired when pov is changed
        povChange["status"] = true;
        updateCanvas();
        povChange["status"] = false;

        if ("compass" in svl) { svl.compass.update(); }
        svl.tracker.push("POV_Changed");
    }

    /**
     * This is a callback function that is fired with the mouse down event
     * on the view control layer (where you control street view angle.)
     * @param e
     */
    function handlerViewControlLayerMouseDown (e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = mouseposition(e, this).x;
        mouseStatus.leftDownY = mouseposition(e, this).y;
        svl.tracker.push('ViewControl_MouseDown', {x: mouseStatus.leftDownX, y:mouseStatus.leftDownY});

        // Setting a cursor (crosshair cursor instead of correct zoom out png)
        // http://www.jaycodesign.co.nz/css/cross-browser-css-grab-cursors-for-dragging/
        //if (svl.keyboard.isShiftDown()) {
        //    setViewControlLayerCursor('ZoomOut');
        //} else {
        setViewControlLayerCursor('ClosedHand');
        //}

        // Adding delegation on SVG elements
        // http://stackoverflow.com/questions/14431361/event-delegation-on-svg-elements
        // Or rather just attach a listener to svg and check it's target.
        if (!status.panoLinkListenerSet) {
            try {
                $('svg')[0].addEventListener('click', function (e) {
                    var targetPanoId = e.target.getAttribute('pano');
                    if (targetPanoId) {
                        svl.tracker.push('WalkTowards', {'TargetPanoId': targetPanoId});
                    }
                });

                status.panoLinkListenerSet = true;
            } catch (err) {

            }
        }

        //This is necessary for supporting touch devices, because there is no mouse hover
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * This is a callback function that is called with mouse up event on
     * the view control layer (where you change the Google Street view angle.
     * @param e
     */
    function handlerViewControlLayerMouseUp (e) {
        var currTime;

        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = mouseposition(e, this).x;
        mouseStatus.leftUpY = mouseposition(e, this).y;
        svl.tracker.push('ViewControl_MouseUp', {x:mouseStatus.leftUpX, y:mouseStatus.leftUpY});

        // Setting a mouse cursor (crosshair cursor instead of correct zoom out png)
        // http://www.jaycodesign.co.nz/css/cross-browser-css-grab-cursors-for-dragging/
        //if (!svl.keyboard.isShiftDown()) {
        setViewControlLayerCursor('OpenHand');
            // uiMap.viewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
        //} else {
        //    setViewControlLayerCursor('ZoomOut');
        //}


        currTime = new Date().getTime();

        var point = _canvas.isOn(mouseStatus.currX, mouseStatus.currY);
        if (point && point.className === "Point") {
            var path = point.belongsTo(),
                selectedLabel = path.belongsTo(),
                canvasCoordinate = point.getCanvasCoordinate(getPov());

            _canvas.setCurrentLabel(selectedLabel);

            if ('contextMenu' in svl) {
              if (wasOpen) {
                svl.contextMenu.hide();
              } else {
                svl.contextMenu.show(canvasCoordinate.x, canvasCoordinate.y, {
                    targetLabel: selectedLabel,
                    targetLabelColor: selectedLabel.getProperty("labelFillStyle")
                });
                var labelType = selectedLabel.getProperty("labelType");
                if (labelType === "Other") {
                  // No tooltips for other.
                  $('#severity-one').tooltip('destroy');
                  $('#severity-three').tooltip('destroy');
                  $('#severity-five').tooltip('destroy');
                } else {
                  // Update tooltips.
                  $('#severity-one').tooltip('destroy').tooltip({
                      placement: "top", html: true, delay: { "show": 300, "hide": 10 },
                      title: i18next.t('center-ui.context-menu.severity-example', {n: 1}) + "<br/><img src='/assets/javascripts/SVLabel/img/severity_popups/" + labelType + "_Severity1.png' height='110' alt='CRseverity 1'/><br/><i>" + i18next.t('center-ui.context-menu.severity-shortcuts') + "</i>"
                  });
                  $('#severity-three').tooltip('destroy').tooltip({
                      placement: "top", html: true, delay: { "show": 300, "hide": 10 },
                      title: i18next.t('center-ui.context-menu.severity-example', {n: 3}) + "<br/><img src='/assets/javascripts/SVLabel/img/severity_popups/" + labelType + "_Severity3.png' height='110' alt='CRseverity 3'/><br/><i>" + i18next.t('center-ui.context-menu.severity-shortcuts') + "</i>"
                  });
                  $('#severity-five').tooltip('destroy').tooltip({
                      placement: "top", html: true, delay: { "show": 300, "hide": 10 },
                      title: i18next.t('center-ui.context-menu.severity-example', {n: 5}) + "<br/><img src='/assets/javascripts/SVLabel/img/severity_popups/" + labelType + "_Severity5.png' height='110' alt='CRseverity 5'/><br/><i>" + i18next.t('center-ui.context-menu.severity-shortcuts') + "</i>"
                  });
                }
              }
              wasOpen = false;
            }
        } else if (currTime - mouseStatus.prevMouseUpTime < 300) {
            // Double click
            svl.tracker.push('ViewControl_DoubleClick');
            if (!status.disableClickZoom) {

                if (svl.keyboard.isShiftDown()) {
                    // If Shift is down, then zoom out with double click.
                    svl.zoomControl.zoomOut();
                    svl.tracker.push('ViewControl_ZoomOut');
                } else {
                    // If Shift is up, then zoom in wiht double click.
                    svl.zoomControl.pointZoomIn(mouseStatus.leftUpX, mouseStatus.leftUpY);
                    svl.tracker.push('ViewControl_ZoomIn');
                }
            } else {
                // Double click to walk. First check whether Street View is available at the point where user has
                // double clicked. If a Street View scene exists and the distance is below STREETVIEW_MAX_DISTANCE (50 meters),
                // then jump to the scene
                if (!status.disableWalking) {
                    var imageCoordinate = util.panomarker.canvasCoordinateToImageCoordinate (mouseStatus.currX, mouseStatus.currY, getPov()),
                        latlng = getPosition(),
                        newLatlng = imageCoordinateToLatLng(imageCoordinate.x, imageCoordinate.y, latlng.lat, latlng.lng);
                    if (newLatlng) {
                        var distance = util.math.haversine(latlng.lat, latlng.lng, newLatlng.lat, newLatlng.lng);
                        if (distance < STREETVIEW_MAX_DISTANCE) {
                            svl.streetViewService.getPanorama({location: new google.maps.LatLng(newLatlng.lat, newLatlng.lng),
                                radius: STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR}, function (streetViewPanoramaData, status) {
                                if (status === google.maps.StreetViewStatus.OK) {
                                    self.setPano(streetViewPanoramaData.location.pano);
                                    //self.handlerPositionUpdate();
                                }
                                else {
                                    var currentTask = svl.taskContainer.getCurrentTask();
                                    if (currentTask) {
                                        util.misc.reportNoStreetView(currentTask.getStreetEdgeId());
                                        console.error("Error Type:" + JSON.stringify(status)  +
                                            "\nNo street view found at this location: " + newLatlng +
                                            " street " + currentTask.getStreetEdgeId() +
                                            "\nNeed to move to a new location.");

                                    }
                                    svl.tracker.push("PanoId_NotFound", {'Location': JSON.stringify(newLatlng)});

                                    // Move to a new location
                                    jumpImageryNotFound();

                                }
                            });
                        }
                    }
                }
            }
        }


        setViewControlLayerCursor('OpenHand');
        mouseStatus.prevMouseUpTime = currTime;
    }

    /**
     *
     * @param e
     */
    function handlerViewControlLayerMouseLeave (e) {
        setViewControlLayerCursor('OpenHand');
        mouseStatus.isLeftDown = false;
    }

    /**
     * This is a callback function that is fired when a user moves a mouse on the
     * view control layer where you change the pov.
     */
    function handlerViewControlLayerMouseMove (e) {
        mouseStatus.currX = mouseposition(e, this).x;
        mouseStatus.currY = mouseposition(e, this).y;

        // Show a link and fade it out
        if (!status.disableWalking) {
            showLinks(2000);
        } else {
            hideLinks();
        }


        if (mouseStatus.isLeftDown && status.disablePanning === false) {
            // If a mouse is being dragged on the control layer, move the sv image.
            var dx = mouseStatus.currX - mouseStatus.prevX;
            var dy = mouseStatus.currY - mouseStatus.prevY;
            var pov = getPov();
            var zoom = Math.round(pov.zoom);
            var zoomLevel = svl.zoomFactor[zoom];
            dx = dx / (2 * zoomLevel);
            dy = dy / (2 * zoomLevel);
            dx *= 1.5;
            dy *= 1.5;
            updatePov(dx, dy);
        }

        // Show label delete menu
        var item = _canvas.isOn(mouseStatus.currX, mouseStatus.currY);
        if (item && item.className === "Point") {
            // console.log("On a point");
            var path = item.belongsTo();
            var selectedLabel = path.belongsTo();

            _canvas.setCurrentLabel(selectedLabel);
            _canvas.showLabelTag(selectedLabel);
            _canvas.clear();
            _canvas.render2();
        } else if (item && item.className === "Label") {
            var selectedLabel = item;
            _canvas.setCurrentLabel(selectedLabel);
            _canvas.showLabelTag(selectedLabel);
        } else if (item && item.className === "Path") {
            var label = item.belongsTo();
            _canvas.clear();
            _canvas.render2();
            _canvas.showLabelTag(label);
        }
        else {
            _canvas.showLabelTag(undefined);
            _canvas.setCurrentLabel(undefined);
        }

        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }


    /**
     * This method hides links to neighboring Street View images by changing the
     * svg path elements.
     *
     * @returns {hideLinks} This object.
     */
    function hideLinks () {
        var $paths = $("#view-control-layer").find('path');
        $paths.css('visibility', 'hidden');
        $paths.css('pointer-events', 'none');
        // if (properties.browser === 'chrome') {
        //     // Somehow chrome does not allow me to select path
        //     // and fadeOut. Instead, I'm just manipulating path's style
        //     // and making it hidden.
        //
        //     $paths.css('visibility', 'hidden');
        // } else {
        //     // $('path').fadeOut(1000);
        //     $paths.css('visibility', 'hidden');
        // }
        return this;
    }

    /**
     * This method takes an image coordinate and map it to the corresponding latlng position
     * @param imageX image x coordinate
     * @param imageY image y coordinate
     * @param lat current latitude of where you are standing
     * @param lng current longitude of where you are standing
     * @returns {*}
     */
    function imageCoordinateToLatLng(imageX, imageY, lat, lng) {
        var pc = svl.pointCloud.getPointCloud(getPanoId());
        if (pc) {
            var p = util.scaleImageCoordinate(imageX, imageY, 1 / 26),
                idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y)),
                dx = pc.pointCloud[idx],
                dy = pc.pointCloud[idx + 1],
                delta = util.math.latlngOffset(lat, dx, dy);
            return { lat: lat + delta.dlat, lng: lng + delta.dlng };
        } else {
            return null;
        }
    }


    /**
     * Initailize Street View
     */
    function initStreetView () {
        // Initialize the Street View interface
        var numPath = uiMap.viewControlLayer.find("path").length;
        if (numPath !== 0) {
            status.svLinkArrowsLoaded = true;
            window.clearTimeout(_streetViewInit);
        }
    }


    /**
     * Load the state of the map
     */
    function load () {
        return svl.storage.get("map");
    }

    /**
     * Lock disable panning
     * @returns {lockDisablePanning}
     */
    function lockDisablePanning () {
        status.lockDisablePanning = true;
        return this;
    }

    /**
     * This method locks status.disableWalking
     * @returns {lockDisableWalking}
     */
    function lockDisableWalking () {
        status.lockDisableWalking = true;
        return this;
    }

    /** Lock render labreling */
    function lockRenderLabels () {
        lock.renderLabels = true;
        return this;
    }

    /**
     * This method brings the links (<, >) to the view control layer so that a user can click them to walk around
     */
    function makeLinksClickable () {
        // Bring the layer with arrows and bottom links forward.
        var $links = getLinkLayer();
        var $bottomlinks = getBottomLinkLayer();
        uiMap.viewControlLayer.append($links);
        uiMap.viewControlLayer.append($bottomlinks);

        if (properties.browser === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            uiMap.viewControlLayer.append(uiMap.canvas);
        } else if (properties.browser === 'msie') {
            uiMap.viewControlLayer.insertBefore(uiMap.drawingLayer);
        }
    }


    /**
     *
     */
    function modeSwitchLabelClick () {
        uiMap.drawingLayer.css('z-index','1');
        uiMap.viewControlLayer.css('z-index', '0');

        if (properties.browser === 'mozilla') {
            uiMap.drawingLayer.append(uiMap.canvas);
        }
        hideLinks();
    }

    /**
     * This function brings a div element for drawing labels in front of
     */
    function modeSwitchWalkClick () {
        uiMap.viewControlLayer.css('z-index', '1');
        uiMap.drawingLayer.css('z-index','0');
        if (!status.disableWalking) {
            // Show the link arrows on top of the panorama and make links clickable
            showLinks();
            makeLinksClickable();
        }
    }


    /**
     * Plot markers on the Google Maps pane
     *
     * Example: https://google-developers.appspot.com/maps/documentation/javascript/examples/icon-complex?hl=fr-FR
     * @returns {boolean}
     */
    function plotMarkers () {
        if (canvas) {
            var prop, labelType, latlng, labels = canvas.getLabels(), labelsLen = labels.length;

            // Clear the map first, then plot markers
            for (var i = 0; i < markers.length; i++) { markers[i].setMap(null); }

            markers = [];
            for (i = 0; i < labelsLen; i++) {
                prop = labels[i].getProperties();
                labelType = prop.labelProperties.labelType;
                latlng = prop.panoramaProperties.latlng;
                if (prop.labelerId.indexOf('Researcher') !== -1) {
                    // Skip researcher labels
                    continue;
                }

                markers.push(
                    new google.maps.Marker({
                        position: new google.maps.LatLng(latlng.lat, latlng.lng),
                        map: map,
                        zIndex: i
                    })
                );
            }
        }
    }

    /**
     * Save the state of the map
     */
    function save () {
        svl.storage.set("map", {"pov": getPov(), "latlng": getPosition(), "panoId": getPanoId() });
    }

    /**
     *
     * @param panoramaId
     * @param force: force to change pano, even if walking is disabled
     * @returns {setPano}
     */
    self.setPano = function (panoramaId, force) {
        if (force == undefined) force = false;

        if (!status.disableWalking || force == true) {
            svl.panorama.setPano(panoramaId);
        }
        return this;
    };

    /**
     * Set map position
     * @param lat
     * @param lng
     * @param callback
     */
    self.setPosition = function (lat, lng, callback) {
        if (!status.disableWalking) {
            // Check the presence of the Google Street View. If it exists, then set the location. Other wise error.
            var gLatLng = new google.maps.LatLng(lat, lng);
            svl.streetViewService.getPanorama({location: gLatLng, radius: STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR},
                function (streetViewPanoramaData, status) {
                    if (status === google.maps.StreetViewStatus.OK) {

                        self.enableWalking();

                        // Sets new panorama
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
    };

    // For setting the position when the exact panorama is known
    self.setPositionByIdAndLatLng = function(panoId, lat, lng) {
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
    };

    /**
     * Stop blinking google maps
     */
    function stopBlinkingGoogleMaps () {
        window.clearInterval(googleMapsPaneBlinkInterval);
        svl.ui.googleMaps.overlay.removeClass("highlight-50");
    }

    /**
     * Update the canvas
     */
    function updateCanvas () {
        _canvas.clear();
        if (status.currentPanoId !== getPanoId()) {
            _canvas.setVisibilityBasedOnLocation('visible', getPanoId());
        }
        status.currentPanoId = getPanoId();
        _canvas.render2();
    }

    /**
     *
     * @param type
     */
    function setViewControlLayerCursor(type) {
        switch(type) {
            case 'ZoomOut':
                uiMap.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/ZoomOut.png) 4 4, move");
                break;
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
     * Show links (<, >) for walking
     * @param delay
     */
    function showLinks (delay) {
        // This is kind of redundant, but as long as the link arrows have not been
        // moved to user control layer, keep calling the modeSwitchWalkClick()
        // to bring arrows to the top layer. Once loaded, move svLinkArrowsLoaded to true.
        if (!status.svLinkArrowsLoaded) {
            var numPath = uiMap.viewControlLayer.find("path").length;
            if (numPath === 0) {
                makeLinksClickable();
            } else {
                status.svLinkArrowsLoaded = true;
            }
        }
        $(".gmnoprint path").css('visibility', 'visible');
        $(".gmnoprint path").css('pointer-events', 'all');
    }

    /*
     * Gets the pov change tracking variable
     */
    function getPovChangeStatus() {
        return povChange;
    }

    /****
     * Pano Changing Mechanism - START
     */

    /*
     * Gets the pano change tracking variable
     */
    function getPanoChange() {
        return panoChange;
    }

    /**
     * Sets the pano change tracking variable
     * @param status
     */
    function setPanoChangeStatus(status) {
        panoChange["status"] = status;
    }

    /**
     * Resets the pano change tracking variable
     */
    function resetPanoChange() {
        panoChange = {
            status: false,
            initialPos: {
                pano: undefined,
                location: undefined,
                resolved: false
            },
            newPos: {
                pano: undefined,
                location: undefined,
                applied: false
            }
        };
    }

    function getPanoChangeNewPosition() {
        return panoChange["newPos"];
    }

    function isNewPanoApplied() {
        return panoChange["newPos"]["applied"];
    }

    function setPanoApplied() {
        panoChange["newPos"]["applied"] = true;
    }

    /**
     * Sets the new location when the pano changed happens
     * and sets the appropriate tracking flags to indicate the change
     * @param gLatLng
     * @param newPano
     */
    function setPanoChangeNewPosition(gLatLng, newPano) {

        panoChange["initialPos"]["resolved"] = true;

        panoChange["newPos"]["location"] = gLatLng;
        panoChange["newPos"]["pano"] = newPano;

        console.log("NewPanoChange: " + JSON.stringify(panoChange));
    }

    /**
     * Sets the initial location before the pano change happens
     * @param gLatLng
     * @param panoId
     */
    function setPanoChangeInitialLocation(gLatLng, panoId) {
        panoChange["initialPos"]["pano"] = panoId;
        panoChange["initialPos"]["location"] = gLatLng;
    }

    /****
     * Pano Changing Mechanism - END
     */

    function restrictViewPort(pov) {
        // View port restriction.
        // Do not allow users to look up the sky or down the ground.
        // If specified, do not allow users to turn around too much by restricting the heading angle.
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
     * Update POV of Street View as a user drag a mouse cursor.
     * @param dx
     * @param dy
     */
    function updatePov (dx, dy) {
        if (svl.panorama) {
            var pov = svl.panorama.getPov(),
                alpha = 0.25;
            pov.heading -= alpha * dx;
            pov.pitch += alpha * dy;

            // View port restriction
            pov = restrictViewPort(pov);

            // Update the status of pov change
            povChange["status"] = true;

            // Set the property this object. Then update the Street View image
            properties.panoramaPov = pov;
            svl.panorama.setPov(pov);
        } else {
            throw self.className + ' updatePov(): panorama not defined!';
        }
    }

    /**
     * This method sets the minimum and maximum heading angle that users can adjust the Street View camera.
     * @param range
     * @returns {setHeadingRange}
     */
    function setHeadingRange (range) {
        properties.minHeading = range[0];
        properties.maxHeading = range[1];
        return this;
    }

    /**
     * Set mode.
     * @param modeIn
     * @returns {setMode}
     */
    function setMode (modeIn) {
        properties.mode = modeIn;
        return this;
    }

    /**
     * This method sets the minimum and maximum pitch angle that users can adjust the Street View camera.
     * @param range
     * @returns {setPitchRange}
     */
    function setPitchRange (range) {
        properties.minPitch = range[0];
        properties.maxPitch = range[1];
        return this;
    }

    /**
     * This method changes the Street View pov. If a transition duration is given, the function smoothly updates the
     * pov over the time.
     * @param pov Target pov
     * @param durationMs Transition duration in milli-seconds
     * @param callback Callback function executed after updating pov.
     * @returns {setPov}
     */
    function setPov (pov, durationMs, callback) {
        if (('panorama' in svl) && svl.panorama) {
            var currentPov = svl.panorama.getPov();
            var interval;

            pov.heading = parseInt(pov.heading, 10);
            pov.pitch = parseInt(pov.pitch, 10);
            pov.zoom = parseInt(pov.zoom, 10);

            //
            // Pov restriction
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

            if (durationMs) {
                var timeSegment = 25; // 25 millisecconds

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
                    var headingDelta = pov.heading - currentPov.heading;
                    if (Math.abs(headingDelta) > 1) {
                        // Update heading angle and pitch angle

                        currentPov.heading += headingIncrement;
                        currentPov.pitch += pitchIncrement;
                        currentPov.heading = (currentPov.heading + 360) % 360; //Math.ceil(currentPov.heading);
                        svl.panorama.setPov(currentPov);
                    } else {
                        // Set the pov to adjust the zoom level. Then clear the interval.
                        // Invoke a callback function if there is one.
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

    /**
     * This function sets the current status of the instantiated object
     * @param key
     * @param value
     * @returns {*}
     */
    function setStatus (key, value) {
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
     * Unlock disable panning
     * @returns {unlockDisablePanning}
     */
    function unlockDisablePanning () {
        status.lockDisablePanning = false;
        return this;
    }

    /**
     * Unlock disable walking
     * @returns {unlockDisableWalking}
     */
    function unlockDisableWalking () {
        status.lockDisableWalking = false;
        return this;
    }

    /**
     * Unlock render labels
     * @returns {unlockRenderLabels}
     */
    function unlockRenderLabels () {
        lock.renderLabels = false;
        return this;
    }

    function setZoom (zoomLevel) {
        svl.panorama.setZoom(zoomLevel);
    }


    // Set a flag that triggers the POV being reset into the route direction upon the position changing
    self.preparePovReset = function() {
        initialPositionUpdate = true;
    };
    // Set the POV in the same direction as the route
    function setPovToRouteDirection() {
        var pov = svl.panorama.getPov(),
            compassAngle = svl.compass.getCompassAngle();
        pov.heading = parseInt(pov.heading - compassAngle, 10) % 360;
        svl.panorama.setPov(pov);
    }

    function getMoveDelay() {
        return moveDelay;
    }

    self.blinkGoogleMaps = blinkGoogleMaps;
    self.stopBlinkingGoogleMaps = stopBlinkingGoogleMaps;
    self.disablePanning = disablePanning;
    self.disableWalking = disableWalking;
    self.disableClickZoom = disableClickZoom;
    self.enablePanning = enablePanning;
    self.enableClickZoom = enableClickZoom;
    self.enableWalking = enableWalking;
    self.finishCurrentTaskBeforeJumping = finishCurrentTaskBeforeJumping;
    self.getLabelBeforeJumpListenerStatus = getLabelBeforeJumpListenerStatus;
    self.getMap = getMap;
    self.getMaxPitch = getMaxPitch;
    self.getMinPitch = getMinPitch;
    self.getPanoId = getPanoId;
    self.getProperty = getProperty;
    self.getPosition = getPosition;
    self.getPov = getPov;
    self.getPovChangeStatus = getPovChangeStatus;
    self.getPanoChange = getPanoChange;
    self.resetPanoChange = resetPanoChange;
    self.setPanoChangeStatus = setPanoChangeStatus;
    self.hideLinks = hideLinks;
    self.load = load;
    self.lockDisablePanning = lockDisablePanning;
    self.lockDisableWalking = lockDisableWalking;
    self.lockRenderLabels = lockRenderLabels;
    self.modeSwitchLabelClick = modeSwitchLabelClick;
    self.modeSwitchWalkClick = modeSwitchWalkClick;
    self.moveToTheTaskLocation = moveToTheTaskLocation;
    self.plotMarkers = plotMarkers;
    // self.povToCanvasCoordinate = povToCanvasCoordinate;
    self.resetBeforeJumpLocationAndListener = resetBeforeJumpLocationAndListener;
    self.restrictViewPort = restrictViewPort;
    self.save = save;
    self.setBeforeJumpLocation = setBeforeJumpLocation;
    self.setHeadingRange = setHeadingRange;
    self.setLabelBeforeJumpListenerStatus = setLabelBeforeJumpListenerStatus;
    self.setMode = setMode;
    // self.setPano = setPano;
    self.setPitchRange = setPitchRange;
    self.setPov = setPov;
    self.setStatus = setStatus;
    self.setZoom = setZoom;
    self.showLinks = showLinks;
    self.unlockDisableWalking = unlockDisableWalking;
    self.unlockDisablePanning = unlockDisablePanning;
    self.unlockRenderLabels = unlockRenderLabels;
    self.setPovToRouteDirection = setPovToRouteDirection;
    self.timeoutWalking = timeoutWalking;
    self.resetWalking = resetWalking;
    self.getMoveDelay = getMoveDelay;
    // this.makeLinksClickable = makeLinksClickable;
    _init(params);
    return self;
}
