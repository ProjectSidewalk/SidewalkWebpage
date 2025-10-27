/**
 * Google Street View implementation of the panorama viewer.
 * Docs: https://developers.google.com/maps/documentation/javascript/reference/street-view
 */
class GsvViewer extends PanoViewer {
    constructor() {
        super();
        this.streetViewService = undefined;
        this.panorama = undefined;
        this.panoData = undefined;
    }

    // TODO maybe do `new google.maps.Map(mapCanvas, mapOptions)` here? But maybe we do that for infra3d too..?
    async initialize(canvasElem, panoOptions = {}) { // lat, lng
        const STREETVIEW_MAX_DISTANCE = 40; // TODO use this?
        this.streetViewService = await new google.maps.StreetViewService();

        // Set GSV panorama options.
        // const startingLatLng = new google.maps.LatLng(lat, lng);
        const defaults = {
            // position: undefined,
            // pov: properties.panoramaPov, // TODO required or optional parameter? -- optional, but do I want to include here?

            addressControl: false,
            // cameraControl: false, // TODO this is no longer being used theoretically I think...
            clickToGo: false,
            disableDefaultUI: true,
            // TODO keyboardShortcuts..? Looks like only available for `new google.maps.Map`?
            linksControl: false, // TODO true on Explore, false on Validate
            motionTracking: false,
            motionTrackingControl: false,
            // TODO navigationControl?
            panControl: false,
            scrollwheel: false, // TODO false unless mobile Validate
            showRoadLabels: false, // TODO true on Explore, false on Validate -- but I think I'll remove from Explore too
            zoomControl: false,

            // Options for initializing with a pano loaded.
            // pano: undefined,
            // position: undefined,

            keyboardShortcuts: false, // TODO we have these set to true in Explore, do we use them at all? just for panning?
            navigationControl: false,
        };
        const panoOpts = { ...defaults, ...panoOptions };
        this.panorama = typeof google != "undefined" ? await new google.maps.StreetViewPanorama(canvasElem, panoOpts) : null;

        // Issue: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2468
        // This line of code is here to fix the bug when zooming with ctr +/-, the screen turns black.
        // We are updating the pano POV slightly to simulate an update the gets rid of the black pano.
        // TODO is this still needed? I wasn't able to reproduce in Chrome or Firefox in Sep 2025.
        // $(window).on('resize', function() {
        //     // TODO copied from Validate, but Explore instead calls `updatePov(.01,.01)` which might do something different.
        //     let pov = this.panorama.getPov();
        //     pov.heading -= .01;
        //     pov.pitch -= .01;
        //     this.panorama.setPov(pov);
        // });

        // Connect the map view and panorama view.
        // if (map && this.panorama) map.setStreetView(this.panorama); // TODO once I get to the Explore page.
    }

    getPanoId = () => {
        return this.panorama.getPano();
    }

    getPosition = () => {
        const gLatLng = this.panorama.getPosition();
        if (gLatLng) {
            return { lat: gLatLng.lat(), lng: gLatLng.lng() };
        }
    }

    // We need to call getPanorama() to get the pano's data and make sure it exists. Then we can call setPano() to
    // actually move to the image. But there's no callback to know when the pano has finished loading, so we have to
    // listen for the position_changed event (we _should_ be able to listen to the pano_changed event instead, but
    // this seems to be failing when loading the first pano at least). We return a promise that resolves when the
    // pano has successfully changed, or we know that there's no pano at the requested location.
    // Request a pano's data for the given location.
    _getPanoramaCallback = async (newPanoData) => {
        const prevPano = this.getPanoId();
        this.panoData = newPanoData.data;
        const newPano = this.panoData.location.pano

        return new Promise((resolve) => {
            // If the pano didn't actually change, no event will be fired, so just resolve immediately.
            if (newPano === prevPano) {
                resolve(this.panoData);
            } else {
                // Listen for the position_changed event which fires when the panorama loads.
                const listener = this.panorama.addListener('position_changed', () => {
                    google.maps.event.removeListener(listener);
                    resolve(this.panoData);
                });
                this.panorama.setPano(newPano);
            }
        });
    }

    setPosition = async (latLng) => {
        const gLatLng = new google.maps.LatLng(latLng.lat, latLng.lng);
        return this.streetViewService.getPanorama(
            { location: gLatLng, radius: svl.STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR }
        ).then(this._getPanoramaCallback);
    }

    setPano = async (panoId) => {
        return this.streetViewService.getPanorama({ pano: panoId }).then(this._getPanoramaCallback);
    }

    getLinkedPanos = async () => {
        return this.panorama.links.map(function(link) {
            return { panoId: link.pano, heading: link.heading };
        });
    }

    getPov = () => {
        // Get POV and adjust heading to be between 0 and 360.
        // TODO we force zoom to an integer rn in Explore with Math.round(). Might be good to change now anyway w/ other viewers.
        let pov = this.panorama.getPov();
        while (pov.heading < 0) pov.heading += 360;
        while (pov.heading > 360) pov.heading -= 360;
        return pov;
    }

    setPov = (pov) => {
        return this.panorama.setPov(pov);
    }

    hideNavigationArrows = () => {
        return this.panorama.set('linksControl', false);
    }

    showNavigationArrows = () => {
        return this.panorama.set('linksControl', true);
    }

    addListener(event, handler) {
        if (event === 'pano_changed') {
            this.panorama.addListener(event, handler);
        } else if (event === 'pov_changed') {
            this.panorama.addListener(event, handler);
        }
    }
}
