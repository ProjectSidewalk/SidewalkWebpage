/**
 * Todo. This module needs to be cleaned up.
 * Todo. Separate the Google Maps component (UI and logic) and Street View component (UI and logic).
 * @param canvas
 * @param neighborhoodModel
 * @param uiMap
 * @returns {{className: string}}
 * @constructor
 */
function MapService (canvas, neighborhoodModel, uiMap) {
    var self = { className: 'Map' },
        _canvas = canvas,
        properties = {
            browser : 'unknown',
            latlng : {
                lat : undefined,
                lng : undefined
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
            lockDisablePanning: false,
            lockDisableWalking : false,
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
    var map, mapOptions, mapStyleOptions;

    // Map UI setting
    // http://www.w3schools.com/googleAPI/google_maps_controls.asp
    const startingLatLng = svl.panoViewer.getPosition();
    mapOptions = {
        center: new google.maps.LatLng(startingLatLng.lat, startingLatLng.lng),
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

    function _init() {
        self.properties = properties; // Make properties public.
        properties.browser = util.getBrowser();

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
            updatePov(.0025,.0025);
        });

        // Add listeners to the SV panorama.
        // https://developers.google.com/maps/documentation/javascript/streetview#StreetViewEvents
        svl.panoViewer.addListener('pano_changed', handlerPositionUpdate);
        svl.panoViewer.addListener('pano_changed', switchToExploreMode); // TODO This was addListenerOnce before...
        svl.panoViewer.addListener('zoom_changed', handlerZoomChange);

        // Connect the map view and panorama view (adds peg).
        map.setStreetView(svl.panoViewer.panorama);
    }

    /**
     * Disable walking thoroughly and indicate that user is moving.
     */
    function timeoutWalking() {
        svl.panoViewer.hideNavigationArrows();
        svl.keyboard.setStatus("disableKeyboard", true);
        disableWalking();
        svl.keyboard.setStatus("moving", true);
    }

    /**
     * Enable walking and indicate that user has finished moving.
     */
    function resetWalking() {
        svl.panoViewer.showNavigationArrows();
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
            currentLatLng = svl.panoViewer.getPosition(),
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
            svl.panoViewer.showNavigationArrows();
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
     * This method returns a value of a specified property.
     * @param prop
     * @returns {*}
     */
    function getProperty(prop) {
        return (prop in properties) ? properties[prop] : false;
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
        svl.panoViewer.hideNavigationArrows();
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
            svl.panoViewer.showNavigationArrows();
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
            if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete() || !task.isConnectedTo(nextTask)) {
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
                    // TODO this is never being removed, right?
                    listeners.beforeJumpListenerHandle = google.maps.event.addListener(
                        svl.panoViewer.panorama, "pano_changed", trackBeforeJumpActions
                    );
                } catch (err) {}
            } else {
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
            var currentLatLng = svl.panoViewer.getPosition(),
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
        jumpLocation = svl.panoViewer.getPosition();
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
     * TODO this might make more sense as a callback whenever we setLocation or setPano, bc rn I think it's being run in a weird order...
     * - this might be why the peg is being moved at a different time than the pano changing when clicking stuck and skipping b/w panos?
     */
    function handlerPositionUpdate () {
        var isOnboarding = svl.isOnboarding()
        var position = svl.panoViewer.getPosition();
        var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
        var currentMission = svl.missionContainer.getCurrentMission();
        // Takes care of position_changed happening after the map has already been set
        setMinimapLocation(position);

        // Hide context menu if walking started
        if (svl.contextMenu.isOpen()) {
            svl.contextMenu.hide();
        }

        // Position updated, set delay until user can walk again to properly update canvas
        if (!isOnboarding && !svl.keyboard.getStatus("moving")) {
            timeoutWalking();
            setTimeout(resetWalking, moveDelay);
        }
        svl.panoManager.updateCanvas();
        if (currentMission && neighborhood) {
            if ("compass" in svl) {
                svl.compass.update();
            }
            if (!isOnboarding && "taskContainer" in svl && svl.taskContainer.tasksLoaded()) {

                // End of the task if the user is close enough to the end point and we aren't in the tutorial.
                var task = svl.taskContainer.getCurrentTask();
                if (!isOnboarding && task && task.isAtEnd(position.lat, position.lng, END_OF_STREET_THRESHOLD)) {
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
        var currTime = new Date();

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
            svl.panoViewer.showNavigationArrows();
        } else {
            hideLinks();
        }

        if (mouseStatus.isLeftDown && status.disablePanning === false) {
            // If a mouse is being dragged on the control layer, move the pano.
            var dx = mouseStatus.currX - mouseStatus.prevX;
            var dy = mouseStatus.currY - mouseStatus.prevY;
            var pov = svl.panoViewer.getPov();
            var zoom = Math.round(pov.zoom);
            var zoomLevel = svl.ZOOM_FACTOR[zoom];
            dx = dx / (2 * zoomLevel);
            dy = dy / (2 * zoomLevel);
            dx *= 0.375;
            dy *= 0.375;
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
        svl.panoViewer.hideNavigationArrows();
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

    // Moves label drawing layer to the top and hides navigation arrows.
    function switchToLabelingMode() {
        uiMap.drawingLayer.css('z-index','1');
        uiMap.viewControlLayer.css('z-index', '0');

        if (properties.browser === 'mozilla') {
            uiMap.drawingLayer.append(uiMap.canvas);
        }
        hideLinks();
    }

    // Moves label drawing layer to the bottom. Shows navigation arrows if walk is enabled.
    function switchToExploreMode() {
        uiMap.viewControlLayer.css('z-index', '1');
        uiMap.drawingLayer.css('z-index','0');
        if (!status.disableWalking) {
            svl.panoViewer.showNavigationArrows();
        }
    }

    /**
     * @param panoramaId
     * @param force force to change pano, even if walking is disabled
     * @returns {setPano}
     */
    async function setPano(panoramaId, force) {
        if (force === undefined) force = false;

        if (!status.disableWalking || force) {
            return svl.panoViewer.setPano(panoramaId);
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Set map position.
     * @param lat
     * @param lng
     * @param callback
     */
    async function setPosition(lat, lng, callback) {
        if (!status.disableWalking) {
            // Check the presence of the Google Street View. If it exists, then set the location, otherwise error.
            svl.panoManager.setLocation(lat, lng).then((streetViewPanoramaData) => {
                const panoData = streetViewPanoramaData.data;
                self.enableWalking();

                // Sets new panorama.
                var newPano = panoData.location.pano;
                self.setPano(newPano);
                setMinimapLocation({ lat: lat, lng: lng });

                self.disableWalking();
                window.setTimeout(function() { self.enableWalking(); }, 1000);

                if (callback) callback(panoData, status); // TODO this status was the GSV status, used to submit no GSV report to back end
            });
        } else {
            return Promise.resolve();
        }
    }

    // For setting the position when the exact panorama is known.
    function setPositionByIdAndLatLng(panoId, lat, lng) {
        // Only set the location if walking is enabled
        if (!status.disableWalking) {
            self.enableWalking();
            self.setPano(panoId);
            setMinimapLocation({ lat: lat, lng: lng });

            self.disableWalking();
            window.setTimeout(function() { self.enableWalking(); }, 1000);
        }
        return this;
    }

    function setMinimapLocation(latLng) {
        map.setCenter(new google.maps.LatLng(latLng.lat, latLng.lng));
    }

    function stopBlinkingMinimap() {
        window.clearInterval(minimapPaneBlinkInterval);
        svl.ui.minimap.overlay.removeClass("highlight-50");
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
        let pov = svl.panoViewer.getPov();
        pov.heading -= dx;
        pov.pitch += dy;
        pov = restrictViewPort(pov);
        povChange["status"] = true;

        // Update the Street View image.
        svl.panoViewer.setPov(pov);
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
        var currentPov = svl.panoViewer.getPov();
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
                    svl.panoViewer.setPov(currentPov);
                } else {
                    // Set the pov to adjust zoom level, then clear the interval. Invoke a callback if there is one.
                    if (!pov.zoom) {
                        pov.zoom = 1;
                    }

                    svl.panoViewer.setPov(pov);
                    window.clearInterval(interval);
                    if (callback) {
                        callback();
                    }
                }
            }, timeSegment);
        } else {
            svl.panoViewer.setPov(pov);
        }
        return this;
    }

    /**
     * Attempts to move the user forward in GSV by incrementally checking for imagery every few meters along the route.
     * @param successLogMessage String internal logging when imagery is found; different for stuck button v compass.
     * @param failLogMessage String internal logging when imagery is not found; different for stuck button v compass.
     * @param alertFunc Function An optional function that would alert the user upon successfully finding imagery.
     */
    function moveForward(successLogMessage, failLogMessage, alertFunc) {
        svl.modalComment.hide();
        svl.modalSkip.disableStuckButton();
        svl.compass.disableCompassClick();
        const enableClicksCallback = function() {
            svl.modalSkip.enableStuckButton();
            svl.compass.enableCompassClick();
        };
        // TODO show loading icon. Add when resolving issue #2403.

        // Grab street geometry and current location.
        const currentTask = svl.taskContainer.getCurrentTask();
        const streetEdge = currentTask.getFeature();
        const point = svl.panoViewer.getPosition();
        const currPos = turf.point([point.lng, point.lat]);
        const streetEndpoint = turf.point([currentTask.getLastCoordinate().lng, currentTask.getLastCoordinate().lat]);

        // Remove the part of the street geometry that you've already passed using lineSlice.
        let remainder = turf.cleanCoords(turf.lineSlice(currPos, streetEndpoint, streetEdge));
        let currLat = remainder.geometry.coordinates[0][1];
        let currLng = remainder.geometry.coordinates[0][0];

        // Save the current pano ID as one that you're stuck at.
        const currentPano = svl.panoViewer.getPanoId();
        if (!_stuckPanos.includes(currentPano)) _stuckPanos.push(currentPano);

        // Set radius around each attempted point for which you'll accept GSV imagery to 10 meters.
        let MAX_DIST = 10;
        // Set how far to move forward along the street for each new attempt at finding imagery to 10 meters.
        const DIST_INCREMENT = 0.01;

        // TODO we have repeated functionality between the success and failure callbacks. Clean up later.
        let successCallback = function() {
            const newPanoId = svl.panoViewer.getPanoId();
            if (_stuckPanos.includes(newPanoId)) {
                // If there is room to move forward then try again, recursively calling getPanorama with this callback.
                if (turf.length(remainder) > 0) {
                    // Save the current pano ID as one that doesn't work.
                    _stuckPanos.push(newPanoId);

                    // Set `currPos` to be `DIST_INCREMENT` further down the street. Use `lineSliceAlong` to find the
                    // remaining subsection of the street to check.
                    remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, DIST_INCREMENT, streetEndpoint));
                    currLat = remainder.geometry.coordinates[0][1];
                    currLng = remainder.geometry.coordinates[0][0];
                    svl.panoManager.setLocation(currLat, currLng).then(successCallback, failureCallback);
                } else {
                    // If all else fails, jump to a new street.
                    svl.tracker.push(failLogMessage);
                    svl.form.skip(currentTask, "GSVNotAvailable");
                    svl.stuckAlert.stuckSkippedStreet();
                    window.setTimeout(enableClicksCallback, 1000);
                }
            } else {
                // Save current pano ID as one that doesn't work in case they try to move before clicking 'stuck' again.
                _stuckPanos.push(newPanoId);
                // Move them to the new pano we found.
                setPositionByIdAndLatLng(newPanoId, currLat, currLng);
                svl.tracker.push(successLogMessage);
                if (alertFunc !== null) alertFunc();
                window.setTimeout(enableClicksCallback, 1000);
            }
        }

        let failureCallback = function(error) {
            // If there is room to move forward then try again, recursively calling getPanorama with this callback.
            if (turf.length(remainder) > 0) {
                // Set `currPos` to be `DIST_INCREMENT` further down the street. Use `lineSliceAlong` to find the
                // remaining subsection of the street to check.
                remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, DIST_INCREMENT, streetEndpoint));
                currLat = remainder.geometry.coordinates[0][1];
                currLng = remainder.geometry.coordinates[0][0];
                svl.panoManager.setLocation(currLat, currLng).then(successCallback, failureCallback);
            }
            // TODO add this functionality again later. Need to add a parameter to setLocation().
            // else if (MAX_DIST === 10) {
            //     // If we get to the end of the street, increase the radius a bit to try and drop them at the end.
            //     MAX_DIST = 25;
            //     svl.panoManager.setLocation(currLat, currLng).then(successCallback, failureCallback);
            // }
            else {
                // If all else fails, jump to a new street.
                svl.tracker.push(failLogMessage);
                svl.form.skip(currentTask, "GSVNotAvailable");
                svl.stuckAlert.stuckSkippedStreet();
                window.setTimeout(enableClicksCallback, 1000);
            }
        }

        // Initial call to getPanorama with using the recursive callback function.
        svl.panoManager.setLocation(currLat, currLng).then(successCallback, failureCallback);
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
                if (value) {
                    disableWalking();
                } else {
                    enableWalking();
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

    // Set a flag that triggers the POV being reset into the route direction upon the position changing.
    function preparePovReset() {
        initialPositionUpdate = true;
    }

    // Set the POV in the same direction as the route.
    function setPovToRouteDirection(durationMs) {
        var pov = svl.panoViewer.getPov();
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
    self.setMinimapLocation = setMinimapLocation;
    self.blinkNavigationArrows = blinkNavigationArrows;
    self.disablePanning = disablePanning;
    self.disableWalking = disableWalking;
    self.enablePanning = enablePanning;
    self.enableWalking = enableWalking;
    self.finishCurrentTaskBeforeJumping = finishCurrentTaskBeforeJumping;
    self.getLabelBeforeJumpListenerStatus = getLabelBeforeJumpListenerStatus;
    self.getMap = getMap;
    self.getProperty = getProperty;
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
    self.preparePovReset = preparePovReset;
    self.setPovToRouteDirection = setPovToRouteDirection;
    self.timeoutWalking = timeoutWalking;
    self.resetWalking = resetWalking;
    self.getMoveDelay = getMoveDelay;

    _init();
    return self;
}
