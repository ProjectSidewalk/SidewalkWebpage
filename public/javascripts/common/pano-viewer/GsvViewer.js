/**
 * Google Street View implementation of the panorama viewer.
 * Docs: https://developers.google.com/maps/documentation/javascript/reference/street-view
 */
class GsvViewer extends PanoViewer {
    constructor() {
        super();
        this.streetViewService = undefined;
        this.panorama = undefined;
        this.currPanoData = undefined;
    }

    async initialize(canvasElem, panoOptions = {}) { // lat, lng
        const { LatLng } = await google.maps.importLibrary('core');
        const { StreetViewService, StreetViewPanorama } = await google.maps.importLibrary('streetView');
        const STREETVIEW_MAX_DISTANCE = 40; // TODO use this?
        this.streetViewService = await new StreetViewService();

        // Set GSV panorama options.
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
        this.panorama = await new StreetViewPanorama(canvasElem, panoOpts);

        // Add support for the tutorial panos that we have supplied locally.
        this.panorama.registerPanoProvider((pano) => {
            if (pano === 'tutorial' || pano === 'afterWalkTutorial') {
                return this._getCustomPanoData(pano);
            }
            return null;
        });

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

        let panoDataParams = {
            panoId: newPanoData.data.location.pano,
            source: this.getViewerType(),
            captureDate: moment(newPanoData.data.imageDate),
            width: newPanoData.data.tiles.worldSize.width,
            height: newPanoData.data.tiles.worldSize.height,
            tileWidth: newPanoData.data.tiles.tileSize.width,
            tileHeight: newPanoData.data.tiles.tileSize.height,
            lat: newPanoData.data.location.latLng.lat(),
            lng: newPanoData.data.location.latLng.lng(),
            cameraHeading: newPanoData.data.tiles.originHeading,
            cameraPitch: -newPanoData.data.tiles.originPitch,
            address: newPanoData.data.location.shortDescription,
            copyright: newPanoData.data.copyright,
            history: []
        }

        panoDataParams.linkedPanos = newPanoData.data.links.map(function(link) {
            return {
                panoId: link.pano,
                heading: link.heading,
                description: link.description
            };
        });

        let history = [];
        for (let prevPano of newPanoData.data.time) {
            // Try to find the date since this is an internal API and the property name can change.
            const prevPanoDate = Object.values(prevPano).find(value => value instanceof Date);
            if (prevPanoDate) {
                history.push({
                    panoId: prevPano.pano,
                    captureDate: moment(prevPanoDate)
                });
            } else {
                console.error('Could not find date in pano history object:', prevPano);
            }
        }
        panoDataParams.history = history;

        this.currPanoData = new PanoData(panoDataParams);

        // Now we actually set the pano and wait to resolve until it's finished loading.
        const newPano = this.currPanoData.getProperty('panoId');
        return new Promise((resolve) => {
            // If the pano didn't actually change, no event will be fired, so just resolve immediately.
            if (newPano === prevPano) {
                resolve(this.currPanoData);
            } else {
                // Listen for the position_changed event which fires when the panorama has finished loading.
                const listener = this.panorama.addListener('position_changed', () => {
                    google.maps.event.removeListener(listener);
                    resolve(this.currPanoData);
                });
                this.panorama.setPano(newPano);
            }
        });
    }

    setLocation = async (latLng) => {
        const { LatLng } = await google.maps.importLibrary('core');
        const gLatLng = new LatLng(latLng.lat, latLng.lng);
        return this.streetViewService.getPanorama(
            { location: gLatLng, radius: svl.STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR }
        ).then(this._getPanoramaCallback);
    }

    setPano = async (panoId) => {
        if (panoId === 'tutorial' || panoId === 'afterWalkTutorial') {
            // For locally stored tutorial panos, skip the getPanorama step and continue w/ our saved data.
            return this._getPanoramaCallback({ data: this._getCustomPanoData(panoId) });
        } else {
            return this.streetViewService.getPanorama({ pano: panoId }).then(this._getPanoramaCallback);
        }
    }

    /**
     * If the user is going through the tutorial, it will return the custom/stored panorama for either the initial
     * tutorial view or the "after walk" view.
     * @param pano - the pano ID/name of the wanted custom panorama.
     * @returns custom Google Street View panorama.
     */
    _getCustomPanoData = (pano) => {
        if (pano === 'tutorial') {
            return {
                location: {
                    pano: 'tutorial',
                    latLng: new google.maps.LatLng(38.94042608, -77.06766133)
                },
                links: [{
                    description: 'afterWalkTutorial',
                    heading: 340,
                    pano: 'afterWalkTutorial'
                }],
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
                },
                time: []
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
                },
                time: []
            };
        }
    }

    getLinkedPanos = () => {
        return this.currPanoData.getProperty('linkedPanos');
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
