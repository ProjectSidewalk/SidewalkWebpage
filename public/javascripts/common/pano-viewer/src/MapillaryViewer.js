/**
 * Mapillary implementation of the panorama viewer.
 * Docs: https://mapillary.github.io/mapillary-js/api/classes/viewer.Viewer
 *
 * Some functions that might be useful, but I'm not sure what they do quite yet
 * https://mapillary.github.io/mapillary-js/api/classes/viewer.Viewer/#getcenter
 * https://mapillary.github.io/mapillary-js/api/classes/viewer.Viewer/#project -- this one should take a lat/lng and give us canvas pixel coordinates
 * https://mapillary.github.io/mapillary-js/api/classes/viewer.Viewer/#unproject -- this one should take canvas pixel coordinates and give us lat/lng
 * https://mapillary.github.io/mapillary-js/api/classes/viewer.Viewer/#projectfrombasic -- I think goes from pano_x/y to canvas pixel coordinates?
 * https://mapillary.github.io/mapillary-js/api/classes/viewer.Viewer/#unprojecttobasic -- I think goes from canvas pixel coordinates to pano_x/y?
 */
class MapillaryViewer extends PanoViewer {
    constructor() {
        super();
        this.viewer = undefined;
        this.currRenderCamera = undefined;
        this.currImage = undefined;
        this.currPov = {
            heading: null,
            pitch: null,
            zoom: null
        };
        this.currPanoData = undefined;
    }

    async initialize(canvasElem, panoOptions = {}) {
        this.viewer = new mapillary.Viewer({
            accessToken: panoOptions.accessToken,
            container: canvasElem.id,
            // imageId: '<your image ID for initializing the viewer>',
            component: {
                bearing: false, // showing heading viewer orb thing
                cache: false, // TODO should make this true on Explore
                direction: false, // TODO This is showing nav arrows
                keyboard: false,
                marker: true, // TODO "Enable an interface for showing 3D markers in the viewer"
                tag: true, // TODO "Enable an interface for drawing 2D geometries on top of images"
                pointer: false, // "Enable mouse, pen, and touch interaction for zoom and pan"
                sequence: false, // Shows next/previous image UI at the top
                zoom: false,
            }
        });

        // Initialize pano at the desired location.
        if (panoOptions.startPanoId) {
            await this.setPano(panoOptions.startPanoId);
        } else if (panoOptions.startLatLng) {
            await this.setLocation(panoOptions.startLatLng);
        }

        // Restrict to panoramas -- https://mapillary.github.io/mapillary-js/api/classes/viewer.Viewer/#setfilter
        // Can even set the width of the nav arrows? https://mapillary.github.io/mapillary-js/api/interfaces/component.DirectionConfiguration/
    }

    getPanoId = () => {
        return this.currImage.id;
    }

    getPosition = () => {
        return this.currImage.lngLat;
    }

    _getPanoramaCallback = async (newImage) => {
        // Make sure that the node has the linked panos are initialized (in image._cache._spatialEdges.edges).
        const edgesInitialized= new Promise((resolve) => {
            // Links should be initialized always, except for the first pano. So we can just use them.
            if (newImage._cache._spatialEdges.cached) {
                resolve(newImage._cache._spatialEdges.edges);
            } else {
                // Listen for the event that fires when the links are updated.
                const linksListener = newImage._cache.spatialEdges$.subscribe((spatialEdges) => {
                    if (spatialEdges.cached) {
                        linksListener.unsubscribe(); // We no longer need the listener at this point.
                        resolve(newImage._cache._spatialEdges.edges);
                    }
                });
            }
        });

        // Get the renderCamera object async. Once we have it, we can use it to get/set pov/zoom synchronously.
        const renderCameraInitialized = new Promise((resolve) => {
            const cameraListener = this.viewer._container.renderService.renderCamera$.subscribe((rc) => {
                this.currRenderCamera = rc; // Not sure if we need to save this for anything.
                // cameraListener.unsubscribe(); // We no longer need the listener at this point.
                resolve(rc);
            });
        });

        // Get the starting POV.
        const currPov = this._getPov();

        // Once all async processes have finished, let's fill in the currPanoData object.
        return Promise.all([edgesInitialized, renderCameraInitialized, currPov]).then(([edges, rc, pov]) => {
            this.currImage = newImage;
            this.currPov = pov;

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
                cameraPitch: rc.getTilt(),
                copyright: null, // TODO this.currImage.creatorUsername?
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

            this.currPanoData = new PanoData(panoDataParams);
            return this.currPanoData;
        });
    }

    setLocation = async (latLng, excludedPanos) => {
        // Search for images near the coordinates.
        // Docs for how to filter images: https://www.mapillary.com/developer/api-documentation#image
        const radius = svl.STREETVIEW_MAX_DISTANCE / 1000.0; // Convert search radius to kms.
        // TODO don't send accessToken in the URL: https://www.mapillary.com/developer/api-documentation#authentication
        // TODO start by asking for a smaller area, then move larger if we find nothing. Getting an error if requesting too many images.
        // TODO should be able to use this to find (or decide on our own) links if we want.

        // Create a bounding box using to search for imagery.
        const centerPoint = turf.point([latLng.lng, latLng.lat]);
        let boundingBox = [
            turf.destination(centerPoint, radius, 270).geometry.coordinates[0], // West
            turf.destination(centerPoint, radius, 180).geometry.coordinates[1], // South
            turf.destination(centerPoint, radius, 90).geometry.coordinates[0],  // East
            turf.destination(centerPoint, radius, 0).geometry.coordinates[1]    // North
        ];

        const params = new URLSearchParams({
            access_token: this.viewer._navigator._api._data._accessToken,
            fields: 'id,geometry,computed_geometry,captured_at,sequence,width,camera_type,computed_rotation,detections.value',
            is_pano: 'true',
            bbox: boundingBox,
        });
        const url = `https://graph.mapillary.com/images?${params.toString()}`;

        try {
            const response = await fetch(url);
            const data = await response.json();
            console.log(data);

            if (data.data && data.data.length > 0) {
                // Find image that is closest to the input lat/lng that isn't in the excluded list.
                // TODO we could take into account recency, resolution, etc here as well!
                let closestPano = data.data.filter(pano => !excludedPanos.has(pano.id))[0];
                let currGeom = closestPano.computed_geometry ? closestPano.computed_geometry : closestPano.geometry;
                let closestDist = turf.distance(centerPoint, turf.point(currGeom.coordinates));
                for (let i = 1; i < data.data.length; i++) {
                    const currPano = data.data[i];
                    currGeom = currPano.computed_geometry ? currPano.computed_geometry : currPano.geometry;
                    const currDist = turf.distance(centerPoint, turf.point(currGeom.coordinates));
                    if (currDist < closestDist) {
                        closestPano = currPano;
                        closestDist = currDist;
                    }
                }

                return await this.viewer.moveTo(closestPano.id).then(this._getPanoramaCallback);
            } else {
                if (data.data && data.data.length === 0) throw new Error('No images found near this location');
                else if (data.error) throw new Error(data.error.message);
                else throw new Error(JSON.stringify(data));
            }
        } catch (error) {
            console.error('Error moving to location:', error);
            throw error;
        }
    }

    setPano = async (panoId) => {
        // return this.viewer.moveTo('1485659461780098').then(this._getPanoramaCallback);
        return this.viewer.moveTo(panoId).then(this._getPanoramaCallback);
    }

    getLinkedPanos = () => {
        return this.currPanoData.getProperty('linkedPanos');
    }

    // TODO instead of saving it, should we calculate it using getCenter() and getZoom()?
    getPov = () => {
        return this.currPov; // Saving POV whenever it's changed so that this doesn't need to be done async.
    }

    _getPov = async () => {
        const povWithoutZoom = await this.viewer.getPointOfView();
        const fov = await this.viewer.getFieldOfView();
        const zoom = util.pano.fovToZoom(fov);

        return { heading: povWithoutZoom.bearing, pitch: povWithoutZoom.tilt, zoom: zoom };
    }

    // TODO should this be sharing any code with util.pano.povToPanoCoord()?
    setPov = (pov) => {
        // Find x-position of requested heading on the underlying image [0,1]. To do this, we find the difference b/w
        // requested heading and the heading for the start of the image (which is cameraHeading - 180), divide by 360.
        const headingPixelZero = (this.currPanoData.getProperty('cameraHeading') - 180 + 360) % 360;
        const x = (((pov.heading - headingPixelZero) + 360) % 360) / 360;

        // Find y-position of requested pitch on underlying image [0,1]. Requested pitch is wrt the center of the image.
        const y = 0.5 - pov.pitch / 180;

        // Set the x/y position of the camera based on the requested heading/pitch.
        this.viewer.setCenter([x, y]); // [0,1] along image width/height

        // Convert zoom to a horizontal fov, and then convert to the vertical fov used by Mapillary.
        pov.zoom = pov.zoom || this.currPov.zoom || 1;
        const horizontalFov = util.pano.zoomToFov(pov.zoom);
        const verticalFov = util.math.toDegrees(
            2 * Math.atan(Math.tan(util.math.toRadians(horizontalFov / 2)) / util.EXPLORE_CANVAS_ASPECT_RATIO)
        );

        // Using an internal function to figure out what the zoom level should be. We're using setZoom() instead of
        // setFieldOfView() because only the latter is async.
        const newZoom = this.currRenderCamera.fovToZoom(verticalFov);
        this.viewer.setZoom(newZoom);

        this.currPov = {...pov};
    }

    hideNavigationArrows = () => {
        return this.viewer.deactivateComponent('direction');
    }

    showNavigationArrows = () => {
        return this.viewer.activateComponent('direction');
    }

    // TODO need to implement.
    addListener(event, handler) {
        if (event === 'pano_changed') {
            // this.panorama.addListener(event, handler);
        } else if (event === 'pov_changed') {
            // this.panorama.addListener(event, handler);
        }
    }
}
