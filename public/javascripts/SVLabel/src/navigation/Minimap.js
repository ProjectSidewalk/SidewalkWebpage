/**
 * Handles the Google Maps minimap in the bottom-right corner of the UI.
 */
class Minimap {

    /** @type {google.maps.Map} */
    #map;

    /** @type {number} */
    #minimapPaneBlinkInterval;

    /**
     * Imports necessary libraries and creates the map. Resolves once the map has finished loading.
     * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
     * @returns {Promise<google.maps.Map>}
     */
    async #init(initialLocation) {
        const { LatLng } = await google.maps.importLibrary('core');
        const { Map, MapTypeId, RenderingType } = await google.maps.importLibrary('maps');

        // Create the minimap.
        const mapOptions = {
            backgroundColor: 'none',
            cameraControl: false,
            center: new LatLng(initialLocation.lat, initialLocation.lng),
            clickableIcons: false,
            disableDefaultUi: true,
            fullscreenControl: false,
            gestureHandling: 'none',
            keyboardShortcuts: false,
            mapId: 'DEMO_MAP_ID', // TODO use cloud-based map styling, to replace old way to style maps.
            mapTypeControl: false,
            mapTypeId: MapTypeId.ROADMAP, // HYBRID is another option
            renderingType: RenderingType.RASTER,
            // streetViewControl: true,
            zoom: 18
        };
        this.#map = new Map(document.getElementById('minimap'), mapOptions);

        // TODO use cloud-based map styling, to replace old way to style maps.
        // https://developers.google.com/maps/documentation/javascript/cloud-customization
        // Styling google map.
        // http://stackoverflow.com/questions/8406636/how-to-remove-all-from-google-map
        // http://gmaps-samples-v3.googlecode.com/svn/trunk/styledmaps/wizard/index.html
        // const mapStyleOptions = [
        //     {
        //         featureType: "all",
        //         stylers: [
        //             { visibility: "off" }
        //         ]
        //     },
        //     {
        //         featureType: "road",
        //         stylers: [
        //             { visibility: "on" }
        //         ]
        //     },
        //     {
        //         "elementType": "labels",
        //         "stylers": [
        //             { "visibility": "off" }
        //         ]
        //     }
        // ];
        //
        // map.setOptions({ styles: mapStyleOptions });

        // Add listener to the PanoViewer to update observed area on the minimap when zoom changes.
        svl.panoViewer.addListener('zoom_changed', this.handlerZoomChange);

        // Return a promise that resolves once the map is idle (and therefore fully initialized).
        return new Promise((resolve) => {
            const listener = google.maps.event.addListener(this.#map, 'idle', async () => {
                google.maps.event.removeListener(listener);
                resolve(this.#map);
            });
        });
    }

    /**
     * Makes the minimap start to blink; used in the tutorial.
     */
    blinkMinimap() {
        this.stopBlinkingMinimap();
        this.#minimapPaneBlinkInterval = window.setInterval(function () {
            svl.ui.minimap.overlay.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Stops the minimap from blinking; used in the tutorial.
     */
    stopBlinkingMinimap() {
        window.clearInterval(this.#minimapPaneBlinkInterval);
        svl.ui.minimap.overlay.removeClass("highlight-50");
    }

    /**
     * Get the Google map.
     * @returns {google.maps.Map}
     */
    getMap() {
        return this.#map;
    }

    /**
     * Callback for zoom update; updates the observed area view.
     */
     handlerZoomChange () {
        if ("observedArea" in svl) { svl.observedArea.update(); }

        // TODO it makes more sense for this to be tracked from PanoManager (when we setPov), but might need this if we enable scroll zoom.
        svl.tracker.push("Zoom_Changed");
    }

    /**
     * Sets the center of the minimap to the given lat/lng.
     * @param {{lat: number, lng: number}} latLng
     */
    setMinimapLocation(latLng) {
        this.#map.setCenter(new google.maps.LatLng(latLng.lat, latLng.lng));
    }

    /**
     * Factory function that creates a Google Maps minimap in the bottom-right of the UI.
     * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
     * @returns {Promise<Minimap>} The minimap instance.
     */
    static async create(initialLocation) {
        const newMinimap = new Minimap();
        await newMinimap.#init(initialLocation);
        return newMinimap;
    }
}
