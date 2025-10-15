/**
 * Handles the Google Maps minimap in the bottom-right corner of the UI.
 * @constructor
 */
function Minimap () {
    let self = this;

    let minimapPaneBlinkInterval;
    let map;

    function _init() {

        // Map UI setting
        // http://www.w3schools.com/googleAPI/google_maps_controls.asp
        // TODO should we pass in a starting lat/lng here instead so that we can initialize before the pano is loaded?
        const startingLatLng = svl.panoViewer.getPosition();
        const mapOptions = {
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

        // TODO switch to new way of importing Google library components only when needed:
        // https://developers.google.com/maps/documentation/javascript/add-google-map
        const mapCanvas = document.getElementById("minimap");
        map = typeof google != "undefined" ? new google.maps.Map(mapCanvas, mapOptions) : null;

        // Styling google map.
        // http://stackoverflow.com/questions/8406636/how-to-remove-all-from-google-map
        // http://gmaps-samples-v3.googlecode.com/svn/trunk/styledmaps/wizard/index.html
        const mapStyleOptions = [
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

        // Connect the map view and panorama view (adds peg at pano's location).
        // TODO might need to do something different for non-GSV pano viewers.
        map.setStreetView(svl.panoViewer.panorama);

        // Add listener to the PanoViewer to update observed area on the minimap when zoom changes.
        svl.panoViewer.addListener('zoom_changed', handlerZoomChange);
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
     * Get the Google map.
     * @returns {null}
     */
    function getMap() {
        return map;
    }

    /**
     * Callback for zoom update.
     */
     function handlerZoomChange () {
        if ("observedArea" in svl) { svl.observedArea.update(); }

        // TODO it makes more sense for this to be tracked from PanoManager (when we setPov), but might need this if we enable scroll zoom.
        svl.tracker.push("Zoom_Changed");
    }

    function setMinimapLocation(latLng) {
        map.setCenter(new google.maps.LatLng(latLng.lat, latLng.lng));
    }

    function stopBlinkingMinimap() {
        window.clearInterval(minimapPaneBlinkInterval);
        svl.ui.minimap.overlay.removeClass("highlight-50");
    }

    self.blinkMinimap = blinkMinimap;
    self.stopBlinkingMinimap = stopBlinkingMinimap;
    self.setMinimapLocation = setMinimapLocation;
    self.getMap = getMap;

    _init();
    return self;
}
