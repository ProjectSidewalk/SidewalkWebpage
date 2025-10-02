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
            showRoadLabels: false, // TODO true on Explore, false on Validate
            zoomControl: false,

            keyboardShortcuts: false, // TODO we have these set to true in Explore, do we use them at all? just for panning?
            navigationControl: false,
        };
        const panoOpts = { ...defaults, ...panoOptions };
        this.panorama = typeof google != "undefined" ? await new google.maps.StreetViewPanorama(canvasElem, panoOpts) : null;
        console.log(typeof(this.panorama));

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

    /**
     * Gets the lat/lng location of the current panorama.
     * @returns {Object} The current location with lat and lng properties.
     */
    getPosition = () => {
        const gLatLng = this.panorama.getPosition();
        if (gLatLng) {
            return { lat: gLatLng.lat(), lng: gLatLng.lng() };
        }
    }

    _getPanoramaCallback = (panoData, status) => {
        if (status === google.maps.StreetViewStatus.OK) {
            this.panorama.setPano(panoData.location.pano);
            this.panoData = panoData;
        } else {
            this.panoData = null;
            console.error("Error loading Street View imagery: " + status);
            // TODO would love to log street_edge_id here for explore.scala.html
        }
    }

    setPosition = async (lat, lng) => {
        const gLatLng = new google.maps.LatLng(lat, lng);
        return this.streetViewService.getPanorama(
            { location: gLatLng, radius: svl.STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR },
            this._getPanoramaCallback
        );
    }

    setPano = async (panoId) => {
        // console.trace('SET PANO CALLED', panoId);
        return this.streetViewService.getPanorama({ pano: panoId }, this._getPanoramaCallback);
    }

    // Move in the direction of a link closest to a given angle.
    // TODO I think that this function could make the angle an option, if none supplied than it's just the Stuck button.
    // TODO should this also be async?
    moveToNextPano = async (angle) => {
        if (googleMap.getStatus("disableWalking")) return; // TODO do we make this a func of PanoViewer?

        // Take the cosine of the difference for each link to current heading in radians and stores them in an array.
        const cosines = this.panorama.links.map(function(link) {
            const headingAngleOffset = util.math.toRadians(this.panorama.pov.heading + angle) - util.math.toRadians(link.heading);
            return Math.cos(headingAngleOffset);
        });
        const maxVal = Math.max.apply(null, cosines);
        const maxIndex = cosines.indexOf(maxVal);
        if (cosines[maxIndex] > 0.5) {
            const panoramaId = this.panorama.links[maxIndex].pano;
            this.setPano(panoramaId);
            return true;
        } else {
            return false;
        }
    };

    getPov = () => {
        // Get POV and adjust heading to be between 0 and 360.
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
