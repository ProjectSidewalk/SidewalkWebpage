/**
 * Google Street View implementation of the panorama viewer.
 * Docs: https://developers.google.com/maps/documentation/javascript/reference/street-view
 */
class GsvViewer extends PanoViewer {
    constructor() {
        super();
        this.streetViewService = undefined;
        this.gsvPano = undefined;
        this.prevPanoData = undefined;
        this.currPanoData = undefined;
    }

    async initialize(canvasElem, panoOptions = {}) {
        const { LatLng } = await google.maps.importLibrary('core');
        const { StreetViewService, StreetViewPanorama } = await google.maps.importLibrary('streetView');
        this.streetViewService = await new StreetViewService();

        // Set GSV panorama options.
        const defaults = {
            addressControl: false,
            clickToGo: false,
            disableDefaultUI: true,
            linksControl: false, // We create our own navigation arrows.
            motionTracking: false,
            motionTrackingControl: false,
            navigationControl: false,
            panControl: false,
            scrollwheel: false,
            showRoadLabels: false,
            zoomControl: false
        };
        const panoOpts = { ...defaults, ...panoOptions };
        this.gsvPano = await new StreetViewPanorama(canvasElem, panoOpts);

        // Add support for the tutorial panos that we have supplied locally.
        this.gsvPano.registerPanoProvider((pano) => {
            if (pano === 'tutorial' || pano === 'afterWalkTutorial') {
                return this.#getCustomPanoData(pano);
            }
            return null;
        });

        // Initialize pano at the desired location.
        if (panoOptions.startPanoId) {
            return this.setPano(panoOptions.startPanoId);
        } else if (panoOptions.startLatLng) {
            return this.setLocation(panoOptions.startLatLng).catch(err => {
                if (panoOptions.backupLatLng) return this.setLocation(panoOptions.backupLatLng);
                else throw err;
            });
        }
    };

    getPanoId = () => {
        return this.currPanoData.getPanoId();
    };

    getPosition = () => {
        return { lat: this.currPanoData.getProperty('lat'), lng: this.currPanoData.getProperty('lng') };
    };

    /**
     * A callback to getPanorama() that packages the data into a PanoData object. Resolves when pano has done loading.
     * @param {object} newPanoData
     * @param {Set<string>} [excludedPanos=new Set()] Set of pano IDs that are not valid images to move to.
     * @returns {Promise<PanoData>}
     * @private
     */
    #getPanoramaCallback = async (newPanoData, excludedPanos = new Set()) => {
        // If the pano given is in the excluded list, treat it as if the API call itself had returned nothing.
        if (excludedPanos.has(newPanoData.data.location.pano)) {
            throw new Error(`Excluded pano: ${newPanoData.data.location.pano}`);
        }

        // Putting the data returned from Google into the format for our generic PanoData object.
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

        // Add the nearby (linked) panos.
        panoDataParams.linkedPanos = newPanoData.data.links.map(function(link) {
            return {
                panoId: link.pano,
                heading: link.heading,
                description: link.description
            };
        });

        // Add the list of prior images at this location (history).
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

        // Create the new PanoData object.
        this.currPanoData = new PanoData(panoDataParams);

        // Now we actually set the pano and wait to resolve until it's finished loading.
        const newPano = this.currPanoData.getPanoId();
        const prevPano = this.prevPanoData ? this.prevPanoData.getPanoId() : undefined;
        return new Promise((resolve) => {
            // If the pano didn't actually change, nothing needs to change, so just resolve immediately.
            if (newPano === prevPano) {
                resolve(this.currPanoData);
            } else {
                // Listen for the position_changed event which fires when the panorama has finished loading.
                const listener = this.gsvPano.addListener('position_changed', () => {
                    google.maps.event.removeListener(listener);
                    resolve(this.currPanoData);
                });
                this.gsvPano.setPano(newPano);
            }
        });
    };

    setLocation = async (latLng, excludedPanos = new Set()) => {
        const { LatLng } = await google.maps.importLibrary('core');
        const gLatLng = new LatLng(latLng.lat, latLng.lng);
        this.prevPanoData = this.currPanoData;
        return this.streetViewService.getPanorama(
            { location: gLatLng, radius: svl.STREETVIEW_MAX_DISTANCE, source: google.maps.StreetViewSource.OUTDOOR }
        ).then((panoData) => this.#getPanoramaCallback(panoData, excludedPanos));
    };

    setPano = async (panoId) => {
        this.prevPanoData = this.currPanoData;
        if (panoId === 'tutorial' || panoId === 'afterWalkTutorial') {
            // For locally stored tutorial panos, skip the getPanorama step and continue w/ our saved data.
            return this.#getPanoramaCallback({ data: this.#getCustomPanoData(panoId) }, new Set());
        } else {
            return this.streetViewService.getPanorama({ pano: panoId }).then(this.#getPanoramaCallback);
        }
    };

    /**
     * If the user is going through the tutorial, it will return the custom/stored panorama for either the initial
     * tutorial view or the "after walk" view.
     * @param pano - the pano ID/name of the wanted custom panorama.
     * @returns custom Google Street View panorama.
     */
    #getCustomPanoData = (pano) => {
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
    };

    getLinkedPanos = () => {
        return this.currPanoData.getProperty('linkedPanos');
    };

    getPov = () => {
        // Get POV and adjust heading to be between 0 and 360.
        let pov = this.gsvPano.getPov();
        while (pov.heading < 0) pov.heading += 360;
        while (pov.heading > 360) pov.heading -= 360;
        return pov;
    };

    setPov = (pov) => {
        return this.gsvPano.setPov(pov);
    };

    hideNavigationArrows = () => {
        return this.gsvPano.set('linksControl', false);
    };

    showNavigationArrows = () => {
        return this.gsvPano.set('linksControl', true);
    };

    addListener(event, handler) {
        if (event === 'pano_changed') {
            this.gsvPano.addListener('pano_changed', handler);
        } else if (event === 'pov_changed') {
            this.gsvPano.addListener('pov_changed', handler);
        }
    }

    removeListener(event, handler) {
        if (event === 'pano_changed') {
            this.gsvPano.removeListener('pano_changed', handler);
        } else if (event === 'pov_changed') {
            this.gsvPano.removeListener('pov_changed', handler);
        }
    }
}
