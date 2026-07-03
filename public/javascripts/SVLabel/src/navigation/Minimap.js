/**
 * Handles the Google Maps minimap in the bottom-right corner of the UI.
 */
class Minimap {
    // Zoom bounds for the minimap. ObservedArea's REFERENCE_ZOOM must match DEFAULT.
    /** @type {number} */
    static #MIN_ZOOM = 16;
    /** @type {number} */
    static #MAX_ZOOM = 20;
    /** @type {number} */
    static #DEFAULT_ZOOM = 18;

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
            // Panning is disabled (the map must stay centered on the user's pano so the FOV cone lines up); zooming is
            // instead driven manually by #setupZoomControls so the center is preserved.
            gestureHandling: 'none',
            keyboardShortcuts: false,
            // Map style is changed via cloud-based maps styling in the Google Cloud Console.
            mapId: '9c9a85114c815aa4d4dbd5d3',
            mapTypeControl: false,
            mapTypeId: MapTypeId.ROADMAP, // HYBRID is another option
            maxZoom: Minimap.#MAX_ZOOM,
            minZoom: Minimap.#MIN_ZOOM,
            renderingType: RenderingType.RASTER,
            zoom: Minimap.#DEFAULT_ZOOM,
        };
        this.#map = new Map(document.getElementById('minimap'), mapOptions);

        this.#setupZoomControls();

        // Redraw the observed-area overlay whenever the map settles (e.g. after a zoom) so the fog/FOV stay aligned.
        google.maps.event.addListener(this.#map, 'idle', () => {
            if (svl.observedArea) svl.observedArea.update();
        });

        // Return a promise that resolves once the map is idle (and therefore fully initialized).
        return new Promise((resolve) => {
            const listener = google.maps.event.addListener(this.#map, 'idle', async () => {
                google.maps.event.removeListener(listener);
                resolve(this.#map);
            });
        });
    }

    /**
     * Wires up the minimap's zoom interactions: scroll-wheel zooming over the map and the on-map +/- buttons. Each step
     * recenters on the current pano so the map never drifts off-center, keeping the FOV cone aligned.
     */
    #setupZoomControls() {
        const holder = document.getElementById('minimap-holder');
        if (holder) {
            // Scroll wheel: one notch per zoom level. preventDefault stops the wheel from scrolling the sidebar/page.
            holder.addEventListener('wheel', (e) => {
                e.preventDefault();
                this.#changeZoom(e.deltaY < 0 ? 1 : -1);
            }, { passive: false });
        }

        const zoomInButton = document.getElementById('minimap-zoom-in');
        const zoomOutButton = document.getElementById('minimap-zoom-out');
        if (zoomInButton) zoomInButton.addEventListener('click', () => this.#changeZoom(1));
        if (zoomOutButton) zoomOutButton.addEventListener('click', () => this.#changeZoom(-1));
    }

    /**
     * Changes the minimap zoom by the given (signed) number of levels, clamped to the configured min/max.
     * @param {number} delta - Number of zoom levels to add (positive zooms in, negative zooms out).
     */
    #changeZoom(delta) {
        if (svl.ui.minimap.holder.hasClass('minimap-tutorial')) return;
        const newZoom = Math.min(Minimap.#MAX_ZOOM, Math.max(Minimap.#MIN_ZOOM, this.#map.getZoom() + delta));
        if (newZoom !== this.#map.getZoom()) {
            this.#map.setZoom(newZoom);
        }
    }

    /**
     * Makes the minimap start to blink; used in the tutorial.
     */
    blinkMinimap() {
        this.stopBlinkingMinimap();
        this.#minimapPaneBlinkInterval = window.setInterval(() => {
            svl.ui.minimap.overlay.toggleClass('highlight-50');
        }, 500);
    }

    /**
     * Stops the minimap from blinking; used in the tutorial.
     */
    stopBlinkingMinimap() {
        window.clearInterval(this.#minimapPaneBlinkInterval);
        svl.ui.minimap.overlay.removeClass('highlight-50');
    }

    /**
     * Get the Google map.
     * @returns {google.maps.Map}
     */
    getMap() {
        return this.#map;
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
