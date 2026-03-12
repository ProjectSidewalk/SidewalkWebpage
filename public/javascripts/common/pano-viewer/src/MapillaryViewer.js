/**
 * Mapillary implementation of the panorama viewer.
 * Docs: https://mapillary.github.io/mapillary-js/api/classes/viewer.Viewer
 */
class MapillaryViewer extends PanoViewer {
    constructor() {
        super();
        this.viewer = undefined;
        this.currImage = undefined;
        this.currPanoData = undefined;

        // The following three are recorded as they update so that we can have synchronous getPov() function.
        this.currCameraHeading = undefined;
        this.currCenter = undefined;
        this.currVerticalFov = undefined;

        // Used to differentiate between pano changing from Mapillary's nav arrows vs calling setPano/setLocation.
        this.changingPanoOurselves = undefined;

        // A function to update image metadata after a pano change; only used if move happens thru Mapillary nav arrows.
        this.updateImageData = undefined;
    }

    async initialize(canvasElem, panoOptions = {}) {
        // TODO Need to define a set of options and then find a nice way to map them onto viewer-specific configs.
        let disableDefaultUi = 'disableDefaultUi' in panoOptions ? panoOptions.disableDefaultUi : true;
        let defaultNavigation = 'defaultNavigation' in panoOptions ? panoOptions.defaultNavigation : false;
        let panoOpts = {
            accessToken: panoOptions.accessToken,
            container: canvasElem.id,
            component: {
                bearing: !disableDefaultUi, // Shows heading viewer orb thing
                cache: false, // TODO should make this true on Explore
                direction: defaultNavigation, // Shows Mapillary's navigation arrows
                keyboard: false,
                marker: true, // TODO "Enable an interface for showing 3D markers in the viewer"
                tag: true, // TODO "Enable an interface for drawing 2D geometries on top of images"
                pointer: true, // "Enable mouse, pen, and touch interaction for zoom and pan"
                sequence: !disableDefaultUi, // Shows next/previous image UI at the top
                zoom: 'zoomControl' in panoOptions ? panoOptions.zoomControl : false,
            }
        };
        panoOpts = { ...panoOpts, ...panoOptions };
        this.viewer = new mapillary.Viewer(panoOpts);

        // Restrict to panoramas -- https://mapillary.github.io/mapillary-js/api/classes/viewer.Viewer/#setfilter
        this.viewer.setFilter(["==", "cameraType", "spherical"]);

        // Initialize pano at the desired location.
        if (panoOpts.startPanoId) {
            await this.setPano(panoOpts.startPanoId);
        } else if (panoOpts.startLatLng) {
            await this.setLocation(panoOpts.startLatLng).catch(err => {
                if (panoOpts.backupLatLng) return this.setLocation(panoOpts.backupLatLng);
                else throw err;
            });
        }

        // Set up event listeners. We hold a list and go through each listener ourselves to control their ordering.
        // Changing zoom fires 'fov' but not 'pov' event, but we consider that a pov change so we fire on either.
        const povChangeListener = async (e) => {
            for (const listener of this.povChangedListeners) await listener(e);
        }
        this.viewer.on('pov', povChangeListener);
        this.viewer.on('fov', povChangeListener);

        // Set up event listener on a pano change. Adding one to the front of the list that updates the image metadata.
        // We don't want to run it if the pano change happened through setPano/setLocation, since those functions
        // already update the metadata.
        this.updateImageData = (e) => {
            return this._getPanoramaCallback(e.image);
        };
        const panoChangeListener = async (e) => {
            for (const listener of this.panoChangedListeners) {
                // Skip the updateImageData() call if it's already happening through setPano/setLocation.
                if (!this.changingPanoOurselves || listener !== this.updateImageData) await listener(e);
            }
        }
        this.viewer.on('image', panoChangeListener);

        // TODO Maybe we could add the following two subscribers only if we aren't handling panning/zooming ourselves,
        //      which could be passed as a parameter. That logic could be applied to the other viewers as well.
        // Track heading and pitch (by way of tracking where the view is centered) on any pov change event.
        const povTracker = () => {
            this.viewer._navigator.stateService.getCenter().subscribe((newCenter => {
                this.currCenter = newCenter;
            }));
        }
        this.addListener('pov_changed', povTracker);
        povTracker(); // And run it once to start so that we have an initial heading/pitch recorded.

        // Track zoom level (by way of tracking the fov) by subscribing to changes to the renderCamera.
        await this.viewer._container.renderService.renderCamera$.subscribe((rc => {
            const currImageId = this.currPanoData ? this.currPanoData.getPanoId() : undefined;
            if (!currImageId || currImageId === rc._currentImageId) {
                this.currVerticalFov = rc.perspective.fov;
            }
        }));

        // If defaultNavigation is enabled, we need a pano_changed listener to record the pano metadata after moving.
        if (defaultNavigation) {
            this.addListener('pano_changed', this.updateImageData);
        }

        // Can even set the width of the nav arrows? https://mapillary.github.io/mapillary-js/api/interfaces/component.DirectionConfiguration/
        // TODO Might want to do that in defaultNavigation actually... They're kinda big.
    }

    getPanoId = () => {
        return this.currImage.id;
    }

    getPosition = () => {
        return this.currImage.lngLat;
    }

    _getPanoramaCallback = async (newImage) => {
        const oldPov = this.currImage ? this.getPov() : null; // Save old pov so we can keep the same view.

        // Make sure that the node has the linked panos are initialized (in image._cache._spatialEdges.edges).
        const edgesInitialized= new Promise((resolve) => {
            // Use links if they're already cached.
            if (newImage._cache._spatialEdges.cached) {
                resolve(newImage._cache._spatialEdges.edges);
            } else {
                // Listen for the event that fires when the links are updated.
                const linksListener = (e) => {
                    if (e.status.cached) {
                        this.viewer.off('spatialedges', linksListener);
                        resolve(e.status.edges);
                    }
                }
                this.viewer.on('spatialedges', linksListener);
            }
        });

        // Call a few async funcs to get metadata used by synchronous getPov() function.
        const gotCenter = this.viewer.getCenter();
        const gotFov = this.viewer.getFieldOfView();

        // Once all async processes have finished, let's fill in the currPanoData object.
        return Promise.all([edgesInitialized, gotCenter, gotFov]).then(([edges, newCenter, newFov]) => {
            this.currImage = newImage;

            this.currCameraHeading = this.currImage.compassAngle;
            this.currCenter = newCenter;
            this.currVerticalFov = newFov;

            // To get various info about the pano -- https://mapillary.github.io/mapillary-js/api/classes/viewer.Image/
            // TODO merged, might want to record whether it's been merged thru sfm
            // TODO qualityScore is interesting: A number between zero and one determining the quality of the image. Blurriness, .......
            let panoDataParams = {
                panoId: this.currImage.id,
                source: this.getViewerType(),
                captureDate: moment(this.currImage.capturedAt),
                width: this.currImage.width,
                height: this.currImage.height,
                tileWidth: this.currImage.width,
                tileHeight: this.currImage.height,
                lat: this.currImage.lngLat.lat,
                lng: this.currImage.lngLat.lng,
                cameraHeading: this.currImage.compassAngle,
                // TODO I think that we have camera pitch in renderCamera.camera.position.z. But actually seems really
                //      important when it comes to Mapillary images... And that info should be available in the
                //      renderCamera.camera.up vector.
                cameraPitch: 0,
                copyright: this.currImage.creatorUsername,
                history: [] // TODO could use /images endpoint to fill this. But can also see history in the UI https://www.mapillary.com/app/user/uwrapid?lat=47.66374856411&lng=-122.28224790652&z=17&x=0.5871305676894112&y=0.5159912788583514&zoom=0&panos=true&focus=photo&pKey=134748085384999&my_coverage=false&user_coverage=false
            }

            panoDataParams.linkedPanos = edges
                .filter(link => link.data.direction === 9) // Filter for only panoramas.
                .map(function(link) {
                    // The worldMotionAzimuth is defined as "the counter-clockwise horizontal rotation angle from the
                    // X-axis in a spherical coordinate system", so we need to adjust it to be like a compass heading.
                    return {
                        panoId: link.target,
                        heading: util.math.toDegrees((Math.PI / 2 - link.data.worldMotionAzimuth) % (2 * Math.PI))
                    };
                });

            // Make sure that we keep the same pov in the new pano.
            if (oldPov) this.setPov(oldPov);

            this.changingPanoOurselves = false;

            this.currPanoData = new PanoData(panoDataParams);
            return this.currPanoData;
        });
    }

    /**
     * Creates a bounding box around the given point with given radius, and creates a URL to fetch images in the box.
     *
     * @param {turf.Point} centerPoint The center of the output bounding box
     * @param {number} radius A distance (in km) to extend from the center point in each direction
     * @returns {string} A URL that can be called to fetch Mapillary images within the bounding box
     */
    #createPanoFetchUrl = (centerPoint, radius) => {
        // Create a bounding box using to search for imagery.
        let boundingBox = [
            turf.destination(centerPoint, radius, 270).geometry.coordinates[0], // West
            turf.destination(centerPoint, radius, 180).geometry.coordinates[1], // South
            turf.destination(centerPoint, radius, 90).geometry.coordinates[0],  // East
            turf.destination(centerPoint, radius, 0).geometry.coordinates[1]    // North
        ];

        const params = new URLSearchParams({
            access_token: this.viewer._navigator._api._data._accessToken,
            fields: 'id,geometry,computed_geometry,captured_at,sequence,width,camera_type,computed_rotation',
            is_pano: 'true',
            bbox: boundingBox,
        });

        return `https://graph.mapillary.com/images?${params.toString()}`;
    };

    setLocation = async (latLng, excludedPanos = new Set()) => {
        // Search for images near the coordinates.
        // Docs for how to filter images: https://www.mapillary.com/developer/api-documentation#image
        let radius = svl.STREETVIEW_MAX_DISTANCE / 1000.0; // Convert search radius to kms.
        // TODO don't send accessToken in the URL: https://www.mapillary.com/developer/api-documentation#authentication
        // TODO should be able to use this to find (or decide on our own) links if we want.
        // NOTE The 'limit' API param doesn't do what it says. Including it can make the API return no images when the
        //      limit is set to something greater than 0 and we get images if we exclude the limit param. Don't use it!
        // NOTE I found at least one situation where where duplicate images had been uploaded under different users.
        //      The `captured_at` fields were identical, so maybe that could be used to weed out duplicates if this
        //      becomes an issue? I haven't checked that the capture time is consistently different between consecutive
        //      panos though, so I don't want to start doing that filtering without more testing.
        const centerPoint = turf.point([latLng.lng, latLng.lat]);
        let success = false;
        let data;
        let potentialPanos;

        try {
            while (!success && radius > 0) {
                const url = this.#createPanoFetchUrl(centerPoint, radius);
                const response = await fetch(url);
                data = await response.json();
                console.log(data);

                if (data.data) {
                    potentialPanos = data.data.filter(pano => !excludedPanos.has(pano.id));
                    if (potentialPanos.length > 0) {
                        success = true;
                    } else {
                        throw new Error('No images found near this location');
                    }
                } else if (data.error && data.error.code === 1) {
                    // If there were too many images in the bounding box, API fails. Try with a smaller area.
                    radius -= 0.01;
                } else if (data.error) {
                    throw new Error(data.error.message);
                } else {
                    throw new Error(JSON.stringify(data));
                }
            }

            if (potentialPanos && potentialPanos.length > 0) {
                // Find image that is closest to the input lat/lng that isn't in the excluded list.
                // TODO we could take into account recency, resolution, etc here as well!
                let closestPano = potentialPanos[0];
                let currGeom = closestPano.computed_geometry ? closestPano.computed_geometry : closestPano.geometry;
                let closestDist = turf.distance(centerPoint, turf.point(currGeom.coordinates));
                for (let i = 1; i < potentialPanos.length; i++) {
                    const currPano = potentialPanos[i];
                    currGeom = currPano.computed_geometry ? currPano.computed_geometry : currPano.geometry;
                    const currDist = turf.distance(centerPoint, turf.point(currGeom.coordinates));
                    if (currDist < closestDist) {
                        closestPano = currPano;
                        closestDist = currDist;
                    }
                }

                // Load the pano. Say that it failed if it doesn't work after 10 seconds.
                // TODO If the pano fails to load, we should try the next closest pano. Getting an issue where the pano
                //      with ID 859880776211217 never loads, but there are plenty of others at that location.
                this.changingPanoOurselves = true;
                return await Promise.race([
                    this.viewer.moveTo(closestPano.id).then(this._getPanoramaCallback),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), 10000))
                ]).catch(() => {
                    console.error('Failed to load pano: ', closestPano.id);
                    throw new Error('Failed to load pano: ', closestPano.id);
                });
            } else {
                throw new Error(JSON.stringify(data));
            }
        } catch (error) {
            console.error('Error moving to location:', error);
            throw error;
        }
    }

    setPano = async (panoId) => {
        this.changingPanoOurselves = true;
        return this.viewer.moveTo(panoId).then(this._getPanoramaCallback);
    }

    getLinkedPanos = () => {
        return this.currPanoData.getProperty('linkedPanos');
    }

    getPov = () => {
        // Where the viewport is centered on the image is stored in this.currCenter. Use this to compute heading/pitch.
        const headingPixelZero = (this.currCameraHeading - 180 + 360) % 360;
        const currHeading = ((360 * this.currCenter[0]) + headingPixelZero + 360) % 360;
        const currPitch = -180 * (this.currCenter[1] - 0.5);

        // Use this.currVerticalFov and the canvas aspect ratio to calculate the horizontal fov. Can then convert this
        // into the zoom level that we use throughout our system.
        const horizontalFov = util.math.toDegrees(
            2 * Math.atan(Math.tan(util.math.toRadians(this.currVerticalFov / 2)) * util.EXPLORE_CANVAS_ASPECT_RATIO)
        );

        return {
            heading: currHeading,
            pitch: currPitch,
            zoom: util.pano.fovToZoom(horizontalFov)
        };
    }

    setPov = (pov) => {
        // Find x-position of requested heading on the underlying image [0,1]. To do this, we find the difference b/w
        // requested heading and the heading for the start of the image (which is cameraHeading - 180), divide by 360.
        const headingPixelZero = (this.currCameraHeading - 180 + 360) % 360;
        const x = (((pov.heading - headingPixelZero) + 360) % 360) / 360;

        // Find y-position of requested pitch on underlying image [0,1]. Requested pitch is wrt the center of the image.
        const y = 0.5 - pov.pitch / 180;

        // Set the x/y position of the camera based on the requested heading/pitch.
        // NOTE despite not returning a Promise, setCenter() happens async, so we save it in this.currCenter as well.
        this.viewer.setCenter([x, y]);
        this.currCenter = [x, y];

        // Convert zoom to a horizontal fov, and then convert to the vertical fov used by Mapillary.
        pov.zoom = pov.zoom || this.getPov().zoom || 1;
        const horizontalFov = util.pano.zoomToFov(pov.zoom);
        const verticalFov = util.math.toDegrees(
            2 * Math.atan(Math.tan(util.math.toRadians(horizontalFov / 2)) / util.EXPLORE_CANVAS_ASPECT_RATIO)
        );
        // NOTE despite not returning a Promise, setFieldOfView() happens async, so we save it in this.currVerticalFov.
        this.viewer.setFieldOfView(verticalFov);
        this.currVerticalFov = verticalFov;
    }

    hideNavigationArrows = () => {
        return this.viewer.deactivateComponent('direction');
    }

    showNavigationArrows = () => {
        return this.viewer.activateComponent('direction');
    }
}
