/**
 * The Map module. This module is responsible for the interaction with Street View and Google Maps.
 * Todo. Need to clean this module up...
 * @param $ {object} jQuery object
 * @param google {object} Google Maps object
 * @param turf {object} turf object
 * @param params {object} parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Map ($, google, turf, params) {
    var self = { className: 'Map' },
        canvas,
        overlayMessageBox,
        mapIconInterval,
        lock = {
            renderLabels : false
        },
        markers = [],
        properties = {
            browser : 'unknown',
            latlng : {
                lat : undefined,
                lng : undefined
            },
            initialPanoId : undefined,
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
            availablePanoIds : undefined,
            currentPanoId: undefined,
            disablePanning: false,
            disableWalking : false,
            disableClickZoom: false,
            hideNonavailablePanoLinks : false,
            lockDisablePanning: false,
            lockDisableWalking : false,
            panoLinkListenerSet: false,
            svLinkArrowsLoaded : false
        };

    var initialPositionUpdate = true,
        panoramaOptions,
        STREETVIEW_MAX_DISTANCE = 50,
        googleMapsPaneBlinkInterval;
    svl.streetViewService = typeof google != "undefined" ? new google.maps.StreetViewService() : null;

    // Mouse status and mouse event callback functions
    var mouseStatus = {
            currX:0,
            currY:0,
            prevX:0,
            prevY:0,
            leftDownX:0,
            leftDownY:0,
            leftUpX:0,
            leftUpY:0,
            isLeftDown:false
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
    } else if (('Lat' in params) && ('Lng' in params)) {
        properties.latlng = {'lat': params.Lat, 'lng': params.Lng};
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
        zoom: 18
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
        properties.browser = svl.util.getBrowser();

        if ("overlayMessageBox" in params) { overlayMessageBox = params.overlayMessageBox; }

        // Set GSV panorama options
        // To not show StreetView controls, take a look at the following gpage
        // http://blog.mridey.com/2010/05/controls-in-maps-javascript-api-v3.html
        // Set 'mode' to 'html4' in the SV panoramaOption.
        // https://groups.google.com/forum/?fromgroups=#!topic/google-maps-js-api-v3/q-SjeW19TJw
        if (params.taskPanoId) {
            panoramaOptions = {
                mode : 'html4',
                // position: fenway,
                pov: properties.panoramaPov,
                pano: params.taskPanoId
            };
        } else if (params.Lat && params.Lng) {
            fenway = new google.maps.LatLng(params.Lat, params.Lng);
            panoramaOptions = {
                mode : 'html4',
                position: fenway,
                pov: properties.panoramaPov
            };

        } else {
            console.warn(self.className + ' init(): The pano id nor panorama position is given. Cannot initialize the panorama.');
        }

        var panoCanvas = document.getElementById('pano');
        svl.panorama = typeof google != "undefined" ? new google.maps.StreetViewPanorama(panoCanvas, panoramaOptions) : null;
        if (svl.panorama) {
            svl.panorama.set('addressControl', false);
            svl.panorama.set('clickToGo', false);
            svl.panorama.set('disableDefaultUI', true);
            svl.panorama.set('linksControl', true);
            svl.panorama.set('navigationControl', false);
            svl.panorama.set('panControl', false);
            svl.panorama.set('zoomControl', false);
            svl.panorama.set('keyboardShortcuts', true);
        }


        properties.initialPanoId = params.taskPanoId;

        // Set so the links to panoaramas that are not listed on availablePanoIds will be removed
        status.availablePanoIds = params.availablePanoIds;

        // Attach listeners to dom elements
        svl.ui.map.viewControlLayer.bind('mousedown', handlerViewControlLayerMouseDown);
        svl.ui.map.viewControlLayer.bind('mouseup', handlerViewControlLayerMouseUp);
        svl.ui.map.viewControlLayer.bind('mousemove', handlerViewControlLayerMouseMove);
        svl.ui.map.viewControlLayer.bind('mouseleave', handlerViewControlLayerMouseLeave);

        svl.ui.map.viewControlLayer[0].onselectstart = function () { return false; };


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

        // For Internet Explore, append an extra canvas in viewControlLayer.
        properties.isInternetExplore = $.browser['msie'];
        if (properties.isInternetExplore) {
            svl.ui.map.viewControlLayer.append('<canvas width="720px" height="480px"  class="Window_StreetView" style=""></canvas>');
        }
    }

    /**
     * Remove icons on Google Maps
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
        var highlighted = false;
        stopBlinkingGoogleMaps();
        googleMapsPaneBlinkInterval = window.setInterval(function () {
            svl.ui.googleMaps.overlay.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * This function maps canvas coordinate to image coordinate
     * @param canvasX
     * @param canvasY
     * @param pov
     * @returns {{x: number, y: number}}
     */
    function canvasCoordinateToImageCoordinate (canvasX, canvasY, pov) {
        // return svl.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov);
        var zoomFactor = svl.zoomFactor[pov.zoom];
        var x = svl.svImageWidth * pov.heading / 360 + (svl.alpha_x * (canvasX - (svl.canvasWidth / 2)) / zoomFactor);
        var y = (svl.svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (canvasY - (svl.canvasHeight / 2)) / zoomFactor);
        return { x: x, y: y };
    }

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
            svl.ui.map.modeSwitchWalk.css('opacity', 0.5);
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
            svl.ui.map.modeSwitchWalk.css('opacity', 1);
            status.disableWalking = false;
        }
        return this;
    }

    /**
     * Get the initial panorama id.
     * @returns {undefined|*}
     */
    function getInitialPanoId () {
        return properties.initialPanoId;
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
        return svl.ui.map.pano.children(':first').children(':first').children(':first').children(':eq(5)');
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
        return svl.ui.map.pano.find('svg').parent();
    }

    /**
     * Callback for pano_changed event (https://developers.google.com/maps/documentation/javascript/streetview).
     * Update the map pane, and also query data for the new panorama.
     */
    function handlerPanoramaChange () {
        if (svl.panorama) {
            var panoramaPosition = svl.panorama.getPosition();
            map.setCenter(panoramaPosition);

            if (svl.canvas) {
                svl.canvas.clear();
                svl.canvas.setVisibilityBasedOnLocation('visible', getPanoId());
                svl.canvas.render2();
            }

            // Attach listeners to svl.pointCloud
            if ('pointCloud' in svl && svl.pointCloud) {
                var panoId = getPanoId();
                var pointCloud = svl.pointCloud.getPointCloud(panoId);
                if (!pointCloud) {
                    svl.pointCloud.createPointCloud(getPanoId());
                    // svl.pointCloud.ready(panoId, function () {
                        // console.log(svl.pointCloud.getPointCloud(panoId));
                    //});
                }
            }
        } else {
            throw self.className + ' handlerPanoramaChange(): panorama not defined.';
        }

        if ('compass' in svl) { svl.compass.update(); }
    }

    /**
     * A callback for position_change.
     */
    function handlerPositionUpdate () {
        var position = svl.panorama.getPosition();

        if ("canvas" in svl && svl.canvas) updateCanvas();
        if ("compass" in svl) svl.compass.update();
        if ("missionProgress" in svl) svl.missionProgress.update();
        if ("taskContainer" in svl) {
            svl.taskContainer.update();

            // End of the task if the user is close enough to the end point
            var task = svl.taskContainer.getCurrentTask();
            if (task) {
                if (task.isAtEnd(position.lat(), position.lng(), 25)) {
                    svl.taskContainer.endTask(task);
                    var newTask = svl.taskContainer.nextTask(task);
                    svl.taskContainer.setCurrentTask(newTask);
                    
                    // Check if the interface jumped the user to another discontinuous location. If the user jumped,
                    // tell them that we moved her to another location in the same neighborhood.
                    if (!task.isConnectedTo(newTask) && !svl.taskContainer.isFirstTask()) {
                        svl.popUpMessage.notify("Jumped back to your neighborhood!",
                            "We sent you back into the neighborhood you have been walking around! Please continue to " +
                            "make this neighborhood more accessible for everyone!");
                    }

                    var geometry = newTask.getGeometry();
                    if (geometry) {
                        var lat = geometry.coordinates[0][1],
                            lng = geometry.coordinates[0][0],
                            currentLatLng = getPosition(),
                            newTaskPosition = turf.point([lng, lat]),
                            currentPosition = turf.point([currentLatLng.lng, currentLatLng.lat]),
                            distance = turf.distance(newTaskPosition, currentPosition, "kilometers");

                        // Jump to the new location if it's really far away.
                        if (distance > 0.1) setPosition(lat, lng);
                    }
                }
            }
        }

        // Set the heading angle when the user is dropped to the new position
        if (initialPositionUpdate && 'compass' in svl) {
            var pov = svl.panorama.getPov(),
                compassAngle = svl.compass.getCompassAngle();
            pov.heading = parseInt(pov.heading - compassAngle, 10) % 360;
            svl.panorama.setPov(pov);
            initialPositionUpdate = false;
        }
    }

    /**
     * Callback for pov update
     */
    function handlerPovChange () {
        // This is a callback function that is fired when pov is changed
        if ("canvas" in svl && svl.canvas) { updateCanvas(); }
        if ("compass" in svl) { svl.compass.update(); }
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

        // if (!status.disableWalking) {
            // Setting a cursor
            // http://www.jaycodesign.co.nz/css/cross-browser-css-grab-cursors-for-dragging/
            if (svl.keyboard.isShiftDown()) {
                setViewControlLayerCursor('ZoomOut');
            } else {
                setViewControlLayerCursor('ClosedHand');
            }
        // }

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

        // if (!status.disableWalking) {
            // Setting a mouse cursor
            // http://www.jaycodesign.co.nz/css/cross-browser-css-grab-cursors-for-dragging/
            if (!svl.keyboard.isShiftDown()) {
                setViewControlLayerCursor('OpenHand');
                // svl.ui.map.viewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
            } else {
                setViewControlLayerCursor('ZoomOut');
            }
        // }

        currTime = new Date().getTime();

        if ('canvas' in svl && svl.canvas) {
            var point = svl.canvas.isOn(mouseStatus.currX, mouseStatus.currY);
            if (point && point.className === "Point") {
                var path = point.belongsTo(),
                    selectedLabel = path.belongsTo(),
                    canvasCoordinate = point.getCanvasCoordinate(getPov());

                svl.canvas.setCurrentLabel(selectedLabel);
                if ('contextMenu' in svl) {
                    svl.contextMenu.show(canvasCoordinate.x, canvasCoordinate.y, {
                        targetLabel: selectedLabel,
                        targetLabelColor: selectedLabel.getProperty("labelFillStyle")
                    });
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
                    // double clicked. If a Street View scene exists and the distance is below STREETVIEW_MAX_DISTANCE (25 meters),
                    // then jump to the scene
                    if (!status.disableWalking) {
                        var imageCoordinate = canvasCoordinateToImageCoordinate (mouseStatus.currX, mouseStatus.currY, getPov()),
                            latlng = getPosition(),
                            newLatlng = imageCoordinateToLatLng(imageCoordinate.x, imageCoordinate.y, latlng.lat, latlng.lng);
                        if (newLatlng) {
                            var distance = svl.util.math.haversine(latlng.lat, latlng.lng, newLatlng.lat, newLatlng.lng);
                            if (distance < STREETVIEW_MAX_DISTANCE) {
                                svl.streetViewService.getPanoramaByLocation(new google.maps.LatLng(newLatlng.lat, newLatlng.lng), STREETVIEW_MAX_DISTANCE, function (streetViewPanoramaData, status) {
                                    if (status === google.maps.StreetViewStatus.OK) svl.panorama.setPano(streetViewPanoramaData.location.pano);
                                });
                            }
                        }
                    }
                }
            }
        }
        mouseStatus.prevMouseUpTime = currTime;
    }

    /**
     *
     * @param e
     */
    function handlerViewControlLayerMouseLeave (e) {
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

        if (mouseStatus.isLeftDown) {
            setViewControlLayerCursor('ClosedHand');
        } else {
            if (!svl.keyboard.isShiftDown()) {
                setViewControlLayerCursor('OpenHand');
                // svl.ui.map.viewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
            } else {
                setViewControlLayerCursor('ZoomOut');
            }
        }

        if (mouseStatus.isLeftDown && status.disablePanning === false) {
            // If a mouse is being dragged on the control layer, move the sv image.
            var dx = mouseStatus.currX - mouseStatus.prevX;
            var dy = mouseStatus.currY - mouseStatus.prevY;
            var pov = getPov();
            var zoom = pov.zoom;
            var zoomLevel = svl.zoomFactor[zoom];

            dx = dx / (2 * zoomLevel);
            dy = dy / (2 * zoomLevel);
            dx *= 1.5;
            dy *= 1.5;
            updatePov(dx, dy);
        }

        // Show label delete menu
        if ('canvas' in svl && svl.canvas) {
            var item = svl.canvas.isOn(mouseStatus.currX,  mouseStatus.currY);
            if (item && item.className === "Point") {
                var path = item.belongsTo();
                var selectedLabel = path.belongsTo();

                svl.canvas.setCurrentLabel(selectedLabel);
                svl.canvas.showLabelTag(selectedLabel);
                svl.canvas.clear();
                svl.canvas.render2();
            } else if (item && item.className === "Label") {
                var selectedLabel = item;
                svl.canvas.setCurrentLabel(selectedLabel);
                svl.canvas.showLabelTag(selectedLabel);
            } else if (item && item.className === "Path") {
                var label = item.belongsTo();
                svl.canvas.clear();
                svl.canvas.render2();
                svl.canvas.showLabelTag(label);
            }
            else {
                // canvas.hideDeleteLabel();
                svl.canvas.showLabelTag(undefined);
                svl.canvas.setCurrentLabel(undefined);
            }
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
        if (properties.browser === 'chrome') {
            // Somehow chrome does not allow me to select path
            // and fadeOut. Instead, I'm just manipulating path's style
            // and making it hidden.
            $('path').css('visibility', 'hidden');
        } else {
            // $('path').fadeOut(1000);
            $('path').css('visibility', 'hidden');
        }
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
            var p = svl.util.scaleImageCoordinate(imageX, imageY, 1 / 26),
                idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y)),
                dx = pc.pointCloud[idx],
                dy = pc.pointCloud[idx + 1],
                delta = svl.util.math.latlngOffset(lat, dx, dy);
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
        var numPath = svl.ui.map.viewControlLayer.find("path").length;
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
        // Bring the layer with arrows forward.
        var $links = getLinkLayer();
        svl.ui.map.viewControlLayer.append($links);

        if (properties.browser === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            svl.ui.map.viewControlLayer.append(svl.ui.map.canvas);
        } else if (properties.browser === 'msie') {
            svl.ui.map.viewControlLayer.insertBefore(svl.ui.map.drawingLayer);
        }
    }

    /**
     *
     */
    function modeSwitchLabelClick () {
        svl.ui.map.drawingLayer.css('z-index','1');
        svl.ui.map.viewControlLayer.css('z-index', '0');
        // svl.ui.map.streetViewHolder.append(svl.ui.map.drawingLayer);

        if (properties.browser === 'mozilla') { svl.ui.map.drawingLayer.append(svl.ui.map.canvas); }
        hideLinks();
    }

    /**
     * This function brings a div element for drawing labels in front of
     */
    function modeSwitchWalkClick () {
        svl.ui.map.viewControlLayer.css('z-index', '1');
        svl.ui.map.drawingLayer.css('z-index','0');
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
     * Set map position
     * @param lat
     * @param lng
     */
    function setPosition (lat, lng) {
        var latlng = new google.maps.LatLng(lat, lng);
        svl.panorama.setPosition(latlng);
        map.setCenter(latlng);
        return this;
    }

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
        svl.canvas.clear();
        if (status.currentPanoId !== getPanoId()) {
            svl.canvas.setVisibilityBasedOnLocation('visible', getPanoId());
        }
        status.currentPanoId = getPanoId();
        svl.canvas.render2();
    }

    /**
     *
     * @param type
     */
    function setViewControlLayerCursor(type) {
        switch(type) {
            case 'ZoomOut':
                svl.ui.map.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/Cursor_ZoomOut.png) 4 4, move");
                break;
            case 'OpenHand':
                svl.ui.map.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/openhand.cur) 4 4, move");
                break;
            case 'ClosedHand':
                svl.ui.map.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/closedhand.cur) 4 4, move");
                break;
            default:
                svl.ui.map.viewControlLayer.css("cursor", "default");
        }
    }

    /**
     * Show links (<, >) for walking
     * @param delay
     */
    function showLinks (delay) {
        // Show links

        // This is kind of redundant, but as long as the link arrows have not been
        // moved to user control layer, keep calling the modeSwitchWalkClick()
        // to bring arrows to the top layer. Once loaded, move svLinkArrowsLoaded to true.
        if (!status.svLinkArrowsLoaded) {
            var numPath = svl.ui.map.viewControlLayer.find("path").length;
            if (numPath === 0) {
                makeLinksClickable();
            } else {
                status.svLinkArrowsLoaded = true;
            }
        }

        if (status.hideNonavailablePanoLinks &&
            status.availablePanoIds) {
            $.each($('path'), function (i, v) {
                if ($(v).attr('pano')) {
                    var panoId = $(v).attr('pano');
                    var idx = status.availablePanoIds.indexOf(panoId);

                    if (idx === -1) {
                        $(v).prev().prev().remove();
                        $(v).prev().remove();
                        $(v).remove();
                    } else {
                        //if (properties.browser === 'chrome') {
                        // Somehow chrome does not allow me to select path
                        // and fadeOut. Instead, I'm just manipulating path's style
                        // and making it hidden.
                        $(v).prev().prev().css('visibility', 'visible');
                        $(v).prev().css('visibility', 'visible');
                        $(v).css('visibility', 'visible');
                    }
                }
            });
        } else {
            if (properties.browser === 'chrome') {
                // Somehow chrome does not allow me to select path
                // and fadeOut. Instead, I'm just manipulating path's style
                // and making it hidden.
                $('path').css('visibility', 'visible');
            } else {
                if (!delay) {
                    delay = 0;
                }
                // $('path').show();
                $('path').css('visibility', 'visible');
            }
        }
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

            //
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

            //
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
            var end = false;
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
                var headingDelta;
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
     * This funciton sets the current status of the instantiated object
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
     * Show delete menu
     */
    function showDeleteLabelMenu () {
        var item = canvas.isOn(mouseStatus.currX,  mouseStatus.currY);
        if (item && item.className === "Point") {
            var selectedLabel = item.belongsTo().belongsTo();
            if (selectedLabel === canvas.getCurrentLabel()) {
                canvas.showDeleteLabel(mouseStatus.currX, mouseStatus.currY);
            }
        }
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
     * Unlock render lables
     * @returns {unlockRenderLabels}
     */
    function unlockRenderLabels () {
        lock.renderLabels = false;
        return this;
    }

    self.blinkGoogleMaps = blinkGoogleMaps;
    self.stopBlinkingGoogleMaps = stopBlinkingGoogleMaps;
    self.disablePanning = disablePanning;
    self.disableWalking = disableWalking;
    self.disableClickZoom = disableClickZoom;
    self.enablePanning = enablePanning;
    self.enableClickZoom = enableClickZoom;
    self.enableWalking = enableWalking;
    self.getInitialPanoId = getInitialPanoId;
    self.getMap = getMap;
    self.getMaxPitch = getMaxPitch;
    self.getMinPitch = getMinPitch;
    self.getPanoId = getPanoId;
    self.getProperty = getProperty;
    self.getPosition = getPosition;
    self.getPov = getPov;
    self.hideLinks = hideLinks;
    self.load = load;
    self.lockDisablePanning = lockDisablePanning;
    self.lockDisableWalking = lockDisableWalking;
    self.lockRenderLabels = lockRenderLabels;
    self.modeSwitchLabelClick = modeSwitchLabelClick;
    self.modeSwitchWalkClick = modeSwitchWalkClick;
    self.plotMarkers = plotMarkers;
    self.save = save;
    self.setHeadingRange = setHeadingRange;
    self.setMode = setMode;
    self.setPitchRange = setPitchRange;
    self.setPosition = setPosition;
    self.setPov = setPov;
    self.setStatus = setStatus;
    self.unlockDisableWalking = unlockDisableWalking;
    self.unlockDisablePanning = unlockDisablePanning;
    self.unlockRenderLabels = unlockRenderLabels;

    _init(params);
    return self;
}
