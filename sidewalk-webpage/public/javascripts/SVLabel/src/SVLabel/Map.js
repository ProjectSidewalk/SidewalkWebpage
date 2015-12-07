var svl = svl || {};
var panorama;
svl.panorama = panorama;

////////////////////////////////////////
// Street View Global functions that can
// be accessed from anywhere
////////////////////////////////////////
// Get the camera point-of-view (POV)
// http://www.geocodezip.com/v3_Streetview_lookAt.html?lat=34.016673&lng=-118.501322&zoom=18&type=k


//
// Helper functions
//
function getPanoId() {
    if (svl.panorama) {
        var panoId = svl.panorama.getPano();
        return panoId;
    } else {
        throw 'getPanoId() (in Map.js): panorama not defined.'
    }
}
svl.getPanoId = getPanoId;


function getPosition() {
    if (svl.panorama) {
        var pos = svl.panorama.getPosition();
        if (pos) {
            var ret = {
                'lat' : pos.lat(),
                'lng' : pos.lng()
            };
            return ret;
        }
    } else {
        throw 'getPosition() (in Map.js): panorama not defined.';
    }
}
svl.getPosition = getPosition;

function setPosition(lat, lng) {
    var pos = new google.maps.LatLng(lat, lng),
        radius = 50;

    if (svl.panorama) {
        // Checking if there are street view panoramas
        // http://stackoverflow.com/questions/2675032/how-to-check-if-google-street-view-available-and-display-message
        svl.service.getPanoramaByLocation(pos, radius, function (data, status) {
            if (status === google.maps.StreetViewStatus.OK) {
                svl.panorama.setPosition(pos);
            } else {
                // no street view available in this range, or some error occurred
                svl.task.nextTask({regionId: 61});
            }
        });


    }
}
svl.setPosition = setPosition;

function getPOV() {
    if (svl.panorama) {
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
    } else {
        throw 'getPOV() (in Map.js): panoarama not defined.';
    }
}
svl.getPOV = getPOV;


function getLinks () {
    if (svl.panorama) {
        var links = svl.panorama.getLinks();
        return links;
    } else {
        throw 'getLinks() (in Map.js): panorama not defined.';
    }
}
svl.getLinks = getLinks;

//
// Fog related variables.
var fogMode = false;
var fogSet = false;
var current;
var first;
var previousPoints = [];
var radius = .1;
var isNotfirst = 0;
var paths;
svl.fog = undefined;;
var au = [];
var pty = [];
//au = adjustFog(fog, current.lat(), current.lng(), radius);
var polys = [];


/**
 * The Map module.
 * @param params {object} Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Map ($, params) {
    var self = {className: 'Map'},
        canvas,
        overlayMessageBox,
        mapIconInterval,
        lock = {
            renderLabels : false
        },
        markers = [];
    // properties
    var properties = {
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
    };
    var status = {
        availablePanoIds : undefined,
        currentPanoId: undefined,
        disableWalking : false,
        disableClickZoom: false,
        hideNonavailablePanoLinks : false,
        lockDisableWalking : false,
        panoLinkListenerSet: false,
        svLinkArrowsLoaded : false
    };

        // Street view variables
    var panoramaOptions;

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
    var fenway;
    var map;
    var mapOptions;
    var mapStyleOptions;
    var fogParam = {
        interval: undefined,
        ready: undefined
    };
    var svgListenerAdded = false;

    // Street View variables
    var _streetViewInit;

    // jQuery doms
    var $canvas;
    var $divLabelDrawingLayer;
    var $divPano;
    var $divStreetViewHolder;
    var $divViewControlLayer;
    var $spanModeSwitchWalk;
    var $spanModeSwitchDraw;


    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
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
    fenway = new google.maps.LatLng(properties.latlng.lat, properties.latlng.lng);

    mapOptions = {
        center: fenway,
        mapTypeControl:false,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
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
    map = new google.maps.Map(mapCanvas, mapOptions);
    properties.map = map;

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


    map.setOptions({styles: mapStyleOptions});

    function _init(params) {
        params = params || {};

        self.properties = properties; // Make properties public.
        properties.browser = svl.util.getBrowser();

        if ("overlayMessageBox" in params) {
            overlayMessageBox = params.overlayMessageBox;
        }


        // Set GSV panorama options
        // To not show StreetView controls, take a look at the following gpage
        // http://blog.mridey.com/2010/05/controls-in-maps-javascript-api-v3.html
        //
        // This is awesome... There is a hidden option called 'mode' in the SV panoramaOption.
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

            // throw self.className + ' init(): Specifying a dropping point with a latlng coordinate is no longer a good idea. It does not drop the pegman on the specified position.';
        } else {
            throw self.className + ' init(): The pano id nor panorama position is give. Cannot initialize the panorama.';
        }

        var panoCanvas = document.getElementById('pano');
        svl.panorama = new google.maps.StreetViewPanorama(panoCanvas, panoramaOptions);
        svl.panorama.set('addressControl', false);
        svl.panorama.set('clickToGo', false);
        svl.panorama.set('disableDefaultUI', true);
        svl.panorama.set('linksControl', true);
        svl.panorama.set('navigationControl', false);
        svl.panorama.set('panControl', false);
        svl.panorama.set('zoomControl', false);
        svl.panorama.set('keyboardShortcuts', true);

        properties.initialPanoId = params.taskPanoId;
        $canvas = svl.ui.map.canvas;
        $divLabelDrawingLayer = svl.ui.map.drawingLayer;
        $divPano = svl.ui.map.pano;
        $divStreetViewHolder = svl.ui.map.streetViewHolder;
        $divViewControlLayer = svl.ui.map.viewControlLayer;
        $spanModeSwitchWalk = svl.ui.map.modeSwitchWalk;
        $spanModeSwitchDraw = svl.ui.map.modeSwitchDraw;

        // Set so the links to panoaramas that are not listed on availablePanoIds will be removed
        status.availablePanoIds = params.availablePanoIds;

        // Attach listeners to dom elements
        $divViewControlLayer.bind('mousedown', viewControlLayerMouseDown);
        $divViewControlLayer.bind('mouseup', viewControlLayerMouseUp);
        $divViewControlLayer.bind('mousemove', viewControlLayerMouseMove);
        $divViewControlLayer.bind('mouseleave', viewControlLayerMouseLeave);


        // Add listeners to the SV panorama
        // https://developers.google.com/maps/documentation/javascript/streetview#StreetViewEvents
        google.maps.event.addListener(svl.panorama, "pov_changed", handlerPovChange);
//        google.maps.event.addListener(svl.panorama, "position_changed", handlerPovChange);
        google.maps.event.addListener(svl.panorama, "position_changed", handlerPositionUpdate);
        google.maps.event.addListener(svl.panorama, "pano_changed", handlerPanoramaChange);

        // Connect the map view and panorama view
        map.setStreetView(svl.panorama);

        // Set it to walking mode initially.
        google.maps.event.addListenerOnce(svl.panorama, "pano_changed", self.modeSwitchWalkClick);

        _streetViewInit = setInterval(initStreetView, 100);

        //if ("disableWalking" in params && params.disableWalking) {
        //    disableWalking();
        //} else {
        //    enableWalking();
        //}
        //
        // Set the fog parameters
        // Comment out to disable the fog feature.
        if ("onboarding" in svl &&
            svl.onboarding &&
            svl.onboarding.className === "Onboarding_LabelingCurbRampsDifficultScene") { //"zoomViewAngles" in params) {
            fogParam.zoomViewAngles = [Math.PI / 2, Math.PI / 4, Math.PI / 8];
        }
        fogParam.interval = setInterval(initFog, 250);

        // Hide the dude on the top-left of the map.
        mapIconInterval = setInterval(removeIcon, 0.2);

        //
        // For Internet Explore, append an extra canvas in viewControlLayer.
        properties.isInternetExplore = $.browser['msie'];
        if (properties.isInternetExplore) {
            $divViewControlLayer.append('<canvas width="720px" height="480px"  class="Window_StreetView" style=""></canvas>');
        }
    }

    /**
     *
     */
    function removeIcon() {
        var doms = $('.gmnoprint');
        if (doms.length > 0) {
            window.clearInterval(mapIconInterval);
            $.each($('.gmnoprint'), function (i, v) {
                var $images = $(v).find('img');
                if ($images) {
                    $images.css('visibility', 'hidden');
                }
            });
        }
    }

    /**
     * This method disables zooming by double click.
     */
    function disableClickZoom () {
        status.disableClickZoom = true;
    }

    /**
     * This method disables walking by hiding links towards other Street View panoramas.
     * @returns {disableWalking}
     */
    function disableWalking () {

        // This method hides links on SV and disables users from walking.
        if (!status.lockDisableWalking) {
            // Disable clicking links and changing POV
            hideLinks();
            $spanModeSwitchWalk.css('opacity', 0.5);
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
     * This method enables walking to other panoramas by showing links.
     */
    function enableWalking () {
        // This method shows links on SV and enables users to walk.
        if (!status.lockDisableWalking) {
            // Enable clicking links and changing POV
            showLinks();
            $spanModeSwitchWalk.css('opacity', 1);
            status.disableWalking = false;
        }
    }

    function fogUpdate () {
        var pov = svl.getPOV();

        if (pov) {
            var heading = pov.heading;
            var dir = heading * (Math.PI / 180);
            svl.fog.updateFromPOV(current, radius, dir, Math.PI/2);
        }
    }

    /**
     * Get the map
     */
    function getMap() {
        return properties.map;
    }

    /**
     * Returns a panorama dom element that is dynamically created by GSV API
     * @returns {*}
     */
    function getPanoramaLayer () {
        return $divPano.children(':first').children(':first').children(':first').children(':eq(5)');
    }

    /**
     * Get svg element (arrows) in Street View.
     * @returns {*}
     */
    function getLinkLayer () {
        return $divPano.find('svg').parent();
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
     * Save
     */
    function save () {
        svl.storage.set("map", {"pov": svl.getPOV(), "latlng": svl.getPosition(), "panoId": svl.getPanoId() });
    }

    /**
     * Load
     */
    function load () {
        return svl.storage.get("map");
    }

    /**
     * This method brings the links (<, >) to the view control layer so that a user can click them to walk around
     */
    function makeLinksClickable () {
        // Bring the layer with arrows forward.
        var $links = getLinkLayer();
        $divViewControlLayer.append($links);

        if (properties.browser === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            $divViewControlLayer.append($canvas);
        } else if (properties.browser === 'msie') {
            $divViewControlLayer.insertBefore($divLabelDrawingLayer);
        }
    }

    /**
     * Initializes fog.
     */
    function initFog () {
        // Initialize the fog on top of the map.
        if (current) {
            fogParam.center = current;
            fogParam.radius = 200;

            current = svl.panorama.getPosition();
            svl.fog = new Fog(map, fogParam);
            fogSet = true;
            window.clearInterval(fogParam.interval);
            fogUpdate();
        }
    }

    /**
     * Initailize Street View
     */
    function initStreetView () {
        // Initialize the Street View interface
        var numPath = $divViewControlLayer.find("path").length;
        if (numPath !== 0) {
            status.svLinkArrowsLoaded = true;
            window.clearTimeout(_streetViewInit);
        }

        //if (!status.svLinkArrowsLoaded) {
        //    hideLinks();
        //}
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
                svl.canvas.setVisibilityBasedOnLocation('visible', svl.getPanoId());
                if (properties.mode === 'Evaluation') {
                    myTables.updateCanvas();
                }
                svl.canvas.render2();
            }

//            if ('storage' in svl) {
//                svl.storage.set('currentPanorama', svl.panorama.getPano());
//                svl.storage.set('currentPov', svl.panorama.getPov());
//            }

            if (fogSet) {
                fogUpdate();
            }

            // Attach listeners to svl.pointCloud
            if ('pointCloud' in svl && svl.pointCloud) {
                var panoId = svl.getPanoId();
                var pointCloud = svl.pointCloud.getPointCloud(panoId);
                if (!pointCloud) {
                    svl.pointCloud.createPointCloud(svl.getPanoId());
                    // svl.pointCloud.ready(panoId, function () {
                        // console.log(svl.pointCloud.getPointCloud(panoId));
                    //});
                }
            }
        } else {
            throw self.className + ' handlerPanoramaChange(): panorama not defined.';
        }


    }

    /**
     * A callback for position_change.
     */
    function handlerPositionUpdate () {
        var position = svl.panorama.getPosition();
        handlerPovChange(); // handle pov change

        // Store the current status
//        if ('storage' in svl) {
//            svl.tracker.save();
//            svl.labelContainer.save();
//            svl.map.save();
//            svl.task.save();
//        }

        // End of the task if the user is close enough to the end point
        if ('task' in svl) {
            if (svl.task.isAtEnd(position.lat(), position.lng(), 10)) {
                svl.task.endTask();
            }
        }
    }

    /**
     * Callback for pov update
     */
    function handlerPovChange () {
        // This is a callback function that is fired when pov is changed
        if (svl.canvas) {
            var latlng = getPosition();
            var heading = svl.getPOV().heading;

            svl.canvas.clear();

            if (status.currentPanoId !== svl.getPanoId()) {
            	svl.canvas.setVisibilityBasedOnLocation('visible', svl.getPanoId());
            }
            status.currentPanoId = svl.getPanoId();


            if (properties.mode === 'Evaluation') {
                myTables.updateCanvas();
            }
            svl.canvas.render2();
        }


        // Sean & Vicki Fog code
        if (fogMode && "fog" in svl) {
            current = svl.panorama.getPosition();
            if (current) {
                if (!fogSet) {

                } else {
                    fogUpdate();
                    // var dir = heading * (Math.PI / 180);
                    // fog.updateFromPOV(current, radius, dir, Math.PI/2);
                }
           }
         }

        // Add event listener to svg. Disable walking to far.
        if ($('svg')[0]) {
            if (!svgListenerAdded) {
                svgListenerAdded = true;
                $('svg')[0].addEventListener('mousedown', function (e) {
                    showLinks();
                });
            }
        }
    }

    function setViewControlLayerCursor(type) {
        switch(type) {
            case 'ZoomOut':
                $divViewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/Cursor_ZoomOut.png) 4 4, move");
                break;
            case 'OpenHand':
                $divViewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/openhand.cur) 4 4, move");
                break;
            case 'ClosedHand':
                $divViewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/closedhand.cur) 4 4, move");
                break;
            default:
                $divViewControlLayer.css("cursor", "default");
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
            var numPath = $divViewControlLayer.find("path").length;
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
     * This is a callback function that is fired with the mouse down event
     * on the view control layer (where you control street view angle.)
     * @param e
     */
    function viewControlLayerMouseDown (e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = mouseposition(e, this).x;
        mouseStatus.leftDownY = mouseposition(e, this).y;

        if (!status.disableWalking) {
            // Setting a cursor
            // http://www.jaycodesign.co.nz/css/cross-browser-css-grab-cursors-for-dragging/
            try {
                if (!svl.keyboard.isShiftDown()) {
                    setViewControlLayerCursor('ClosedHand');
                    // $divViewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
                } else {
                    setViewControlLayerCursor('ZoomOut');
                }
            } catch (e) {
                console.error(e);
            }
        }

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

        svl.tracker.push('ViewControl_MouseDown', {x: mouseStatus.leftDownX, y:mouseStatus.leftDownY});
    }

    /**
     * This is a callback function that is called with mouse up event on
     * the view control layer (where you change the Google Street view angle.
     * @param e
     */
    function viewControlLayerMouseUp (e) {
        var currTime;

        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = mouseposition(e, this).x;
        mouseStatus.leftUpY = mouseposition(e, this).y;
        svl.tracker.push('ViewControl_MouseUp', {x:mouseStatus.leftUpX, y:mouseStatus.leftUpY});

        if (!status.disableWalking) {
            // Setting a mouse cursor
            // http://www.jaycodesign.co.nz/css/cross-browser-css-grab-cursors-for-dragging/
            try {
                if (!svl.keyboard.isShiftDown()) {
                    setViewControlLayerCursor('OpenHand');
                    // $divViewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
                } else {
                    setViewControlLayerCursor('ZoomOut');
                }
            } catch (e) {
                console.error(e);
            }
        }

        currTime = new Date().getTime();

        if (currTime - mouseStatus.prevMouseUpTime < 300) {
            // Double click
            // canvas.doubleClickOnCanvas(mouseStatus.leftUpX, mouseStatus.leftDownY);
            if (!status.disableClickZoom) {
                svl.tracker.push('ViewControl_DoubleClick');
                if (svl.keyboard.isShiftDown()) {
                    // If Shift is down, then zoom out with double click.
                    svl.zoomControl.zoomOut();
                    svl.tracker.push('ViewControl_ZoomOut');
                } else {
                    // If Shift is up, then zoom in wiht double click.
                    // svl.zoomControl.zoomIn();
                    svl.zoomControl.pointZoomIn(mouseStatus.leftUpX, mouseStatus.leftUpY);
                    svl.tracker.push('ViewControl_ZoomIn');
                }
            }

        }



        mouseStatus.prevMouseUpTime = currTime;
    }

    /**
     * This is a callback function that is fired when a user moves a mouse on the
     * view control layer where you change the pov.
     */
    function viewControlLayerMouseMove (e) {
        mouseStatus.currX = mouseposition(e, this).x;
        mouseStatus.currY = mouseposition(e, this).y;

        //
        // Show a link and fade it out
        if (!status.disableWalking) {
            showLinks(2000);
            if (!mouseStatus.isLeftDown) {
                try {
                    if (!svl.keyboard.isShiftDown()) {
                        setViewControlLayerCursor('OpenHand');
                        // $divViewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
                    } else {
                        setViewControlLayerCursor('ZoomOut');
                    }
            } catch (e) {
                    console.error(e);
                }
            } else {

            }
        } else {
            setViewControlLayerCursor('default');
            // $divViewControlLayer.css("cursor", "default");
        }

        if (mouseStatus.isLeftDown &&
            status.disableWalking === false) {
            //
            // If a mouse is being dragged on the control layer, move the sv image.
            var dx = mouseStatus.currX - mouseStatus.prevX;
            var dy = mouseStatus.currY - mouseStatus.prevY;
            var pov = svl.getPOV();
            var zoom = pov.zoom;
            var zoomLevel = svl.zoomFactor[zoom];

            dx = dx / (2 * zoomLevel);
            dy = dy / (2 * zoomLevel);

            //
            // It feels the panning is a little bit slow, so speed it up by 50%.
            dx *= 1.5;
            dy *= 1.5;

            updatePov(dx, dy);
        }

        //
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

    function viewControlLayerMouseLeave (e) {
        mouseStatus.isLeftDown = false;
    }

    function showDeleteLabelMenu () {
        var item = canvas.isOn(mouseStatus.currX,  mouseStatus.currY);
        if (item && item.className === "Point") {
            var selectedLabel = item.belongsTo().belongsTo();
            if (selectedLabel === canvas.getCurrentLabel()) {
                canvas.showDeleteLabel(mouseStatus.currX, mouseStatus.currY);
            }
        }
    }

    ////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////
    self.disableWalking = function () {
        if (!status.lockDisableWalking) {
            disableWalking();
            return this;
        } else {
            return false;
        }
    };

    self.enableWalking = function () {
        // This method enables users to walk and change the camera angle.
        if (!status.lockDisableWalking) {
            enableWalking();
            return this;
        } else {
            return false;
        }
    };

    self.getInitialPanoId = function () {
        // This method returns the panorama id of the position this user is dropped.
        return properties.initialPanoId;
    };

    self.getMap = getMap;

    /**
     * This method returns a max pitch
     */
    function getMaxPitch () {
        return properties.maxPitch;
    }
    self.getMaxPitch = getMaxPitch;

    /**
     * This method returns a min pitch
     * @returns {*}
     */
    function getMinPitch () {
        return properties.minPitch;
    }
    self.getMinPitch = getMinPitch;

    self.getProperty = function (prop) {
        // This method returns a value of a specified property.
        if (prop in properties) {
            return properties[prop];
        } else {
            return false;
        }
    };

    self.lockDisableWalking = function () {
        // This method locks status.disableWalking
        status.lockDisableWalking = true;
        return this;
    };

    self.lockRenderLabels = function () {
        lock.renderLabels = true;
        return this;
    };

    self.modeSwitchWalkClick = function () {
        // This function brings a div element for drawing labels in front of
        // $svPanoramaLayer = getPanoramaLayer();
        // $svPanoramaLayer.append($divLabelDrawingLayer);
        $divViewControlLayer.css('z-index', '1');
        $divLabelDrawingLayer.css('z-index','0');
        if (!status.disableWalking) {
            // Show the link arrows on top of the panorama
            showLinks();
            // Make links clickable
            makeLinksClickable();
        }
    };


    /**
     * This is a call back function for mode switch click.
     */
    function modeSwitchLabelClick () {
        // This function
        $divLabelDrawingLayer.css('z-index','1');
        $divViewControlLayer.css('z-index', '0');
        // $divStreetViewHolder.append($divLabelDrawingLayer);

        if (properties.browser === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            $divLabelDrawingLayer.append($canvas);
        }

        hideLinks();
    }

    self.plotMarkers = function () {
        // Examples for plotting markers:
        // https://google-developers.appspot.com/maps/documentation/javascript/examples/icon-complex?hl=fr-FR
        if (canvas) {
            var labels = undefined, labelsLen = 0, prop = undefined, labelType = undefined, latlng = undefined;
            labels = canvas.getLabels();
            labelsLen = labels.length;

            // Clear the map first
            for (var i = 0; i < markers.length; i += 1) {
                markers[i].setMap(null);
            }

            markers = [];
            // Then plot markers
            for (i = 0; i < labelsLen; i++) {
                prop = labels[i].getProperties();
                labelType = prop.labelProperties.labelType;
                latlng = prop.panoramaProperties.latlng;
                if (prop.labelerId.indexOf('Researcher') !== -1) {
                    // Skip researcher labels
                    continue;
                }

                var myLatLng =  new google.maps.LatLng(latlng.lat, latlng.lng);
                var marker = new google.maps.Marker({
                    position: myLatLng,
                    map: map,
                    zIndex: i
                });
                markers.push(marker);
            }
        }
        return false;
    };

    self.setHeadingRange = function (range) {
        // This method sets the minimum and maximum heading angle that users can adjust the Street View camera.
        properties.minHeading = range[0];
        properties.maxHeading = range[1];
        return this;
    };

    self.setMode = function (modeIn) {
        properties.mode = modeIn;
        return this;
    };

    self.setPitchRange = function (range) {
        // This method sets the minimum and maximum pitch angle that users can adjust the Street View camera.
        properties.minPitch = range[0];
        properties.maxPitch = range[1];
        return this;
    };

    self.setPov = function (pov, duration, callback) {
        // Change the pov.
        // If a transition duration is set, smoothly change the pov over the time specified (milli-sec)
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

            if (duration) {
                var timeSegment = 25; // 25 milli-sec

                // Get how much angle you change over timeSegment of time.
                var cw = (pov.heading - currentPov.heading + 360) % 360;
                var ccw = 360 - cw;
                var headingDelta;
                var headingIncrement;
                if (cw < ccw) {
                    headingIncrement = cw * (timeSegment / duration);
                } else {
                    headingIncrement = (-ccw) * (timeSegment / duration);
                }

                var pitchIncrement;
                var pitchDelta = pov.pitch - currentPov.pitch;
                pitchIncrement = pitchDelta * (timeSegment / duration);


                interval = window.setInterval(function () {
                    var headingDelta = pov.heading - currentPov.heading;
                    if (Math.abs(headingDelta) > 1) {
                        //
                        // Update heading angle and pitch angle
                        /*
                        var angle = (360 - pov.heading) + currentPov.heading;
                        if (angle < 180 || angle > 360) {
                            currentPov.heading -= headingIncrement;
                        } else {
                            currentPov.heading += headingIncrement;
                        }
                        */
                        currentPov.heading += headingIncrement;
                        currentPov.pitch += pitchIncrement;
                        currentPov.heading = (currentPov.heading + 360) % 360; //Math.ceil(currentPov.heading);
                        currentPov.pitch = currentPov.pitch; // Math.ceil(currentPov.pitch);
                        svl.panorama.setPov(currentPov);
                    } else {
                        //
                        // Set the pov to adjust the zoom level. Then clear the interval.
                        // Invoke a callback function if there is one.
                        if (!pov.zoom) {
                            pov.zoom = 1;
                        }
                        //pov.heading = Math.ceil(pov.heading);
                        //pov.pitch = Math.ceil(pov.pitch);
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
    };

    self.setStatus = function (key, value) {
        // This funciton sets the current status of the instantiated object
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
    };

    self.unlockDisableWalking = function () {
        status.lockDisableWalking = false;
        return this;
    };

    self.unlockRenderLabels = function () {
        lock.renderLabels = false;
        return this;
    };

    self.disableClickZoom = disableClickZoom;
    self.enableClickZoom = enableClickZoom;
    self.hideLinks = hideLinks;
    self.modeSwitchLabelClick = modeSwitchLabelClick;
    self.save = save;
    self.load = load;

    _init(params);
    return self;
}
