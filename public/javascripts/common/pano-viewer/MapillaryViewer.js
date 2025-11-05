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
        this.accessToken = undefined;
        this.currRenderCamera = undefined;
        this.currImage = undefined;
        this.currPov = {
            heading: null,
            pitch: null,
            zoom: null
        };
        this.currPanoData = {
            panoId: null,
            captureDate: null,
            width: null,
            height: null,
            tileWidth: null,
            tileHeight: null,
            lat: null,
            lng: null,
            cameraHeading: null,
            cameraPitch: null,
            linkedPanos: null,
            copyright: null,
            history: []
        };
    }

    async initialize(canvasElem, panoOptions = {}) {
        this.viewer = new mapillary.Viewer({
            accessToken: svl.mapillaryToken,
            // accessToken: svv.mapillaryToken,
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
        this.currImage = newImage;
        this.currPov = await this._getPov();

        // To get various info about the pano -- https://mapillary.github.io/mapillary-js/api/classes/viewer.Image/
        this.currPanoData.panoId = this.currImage.id;
        this.currPanoData.captureDate = moment(this.currImage.capturedAt).format('YYYY-MM');
        this.currPanoData.width = this.currImage.width;
        this.currPanoData.height = this.currImage.height;
        this.currPanoData.tileWidth = this.currImage.width; // TODO
        this.currPanoData.tileHeight = this.currImage.height; // TODO
        this.currPanoData.lat = this.currImage.lngLat.lat;
        this.currPanoData.lng = this.currImage.lngLat.lng;
        this.currPanoData.cameraHeading = this.currImage.compassAngle;
        this.currPanoData.linkedPanos = []; // TODO maybe setFilter helps too? https://mapillary.github.io/mapillary-js/api/classes/viewer.Viewer/#setfilter
        this.currPanoData.copyright = ''; // TODO  = this.currImage.creatorUsername
        this.currPanoData.history = []; // TODO could use /images endpoint to fill this
        // TODO merged, might want to record whether it's been merged thru sfm
        // TODO qualityScore is interesting: A number between zero and one determining the quality of the image. Blurriness, .......

        return new Promise((resolve) => {
            // Get the renderCamera object async. Once we have it, we can use it to get/set pov/zoom synchronously.
            const cameraListener = this.viewer._container.renderService.renderCamera$.subscribe((rc) => {
                this.currRenderCamera = rc;
                this.currPanoData.cameraPitch = rc.getTilt();
                cameraListener.unsubscribe(); // We no longer need the listener at this point.
                resolve(this.currPanoData);
            });
        });
    }

    setLocation = async (latLng) => {
        // Search for images near the coordinates.
        // Docs for how to filter images: https://www.mapillary.com/developer/api-documentation#image
        const radius = svl.STREETVIEW_MAX_DISTANCE / 1000.0; // Convert search radius to kms.
        // TODO don't send accessToken in the URL: https://www.mapillary.com/developer/api-documentation#authentication
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
            access_token: svl.accessToken,
            // access_token: svv.accessToken,
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
                // Find image that is closest to the input lat/lng.
                // TODO we could take into account recency, resolution, etc here as well!
                let closestPano = data.data[0];
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
        return this.viewer.moveTo('1485659461780098').then(this._getPanoramaCallback);
    }

    getLinkedPanos = () => {
        // TODO need to implement! Maybe can get the info from DirectionComponent..? But I haven't seen a way to see the arrows available.
        //      But maybe we should just create our own set based on the output from the graph API?
        return [];
    }

    // TODO instead of saving it, should we calculate it using getCenter() and getZoom()?
    getPov = () => {
        return this.currPov; // Saving POV whenever it's changed so that this doesn't need to be done async.
    }

    _getPov = async () => {
        const povWithoutZoom = await this.viewer.getPointOfView();
        const fov = await this.viewer.getFieldOfView();
        const zoom = this._getZoomFrom3dFov(fov);

        return { heading: povWithoutZoom.bearing, pitch: povWithoutZoom.tilt, zoom: zoom };
    }

    setPov = (pov) => {
        // Find x-position of requested heading on the underlying image [0,1]. To do this, we find the difference b/w
        // requested heading and the heading for the start of the image (which is cameraHeading - 180), divide by 360.
        const headingPixelZero = (this.currPanoData.cameraHeading - 180 + 360) % 360;
        const x = (((pov.heading - headingPixelZero) + 360) % 360) / 360;

        // Find y-position of requested pitch on underlying image [0,1]. Requested pitch is wrt the center of the image.
        const y = 0.5 - pov.pitch / 180;

        // Set the x/y position of the camera based on the requested heading/pitch.
        this.viewer.setCenter([x, y]); // [0,1] along image width/height

        // Convert zoom to a horizontal fov, and then convert to the vertical fov used by Mapillary.
        pov.zoom = pov.zoom ? pov.zoom : this.currPov.zoom ? this.currPov.zoom : 1;
        const horizontalFov = this._get3dFov(pov.zoom);
        const verticalFov = util.math.toDegrees(
            2 * Math.atan(Math.tan(util.math.toRadians(horizontalFov / 2)) / util.EXPLORE_CANVAS_ASPECT_RATIO)
        );

        // Using an internal function to figure out what the zoom level should be. We're using setZoom() instead of
        // setFieldOfView() because only the latter is async.
        const newZoom = this.currRenderCamera.fovToZoom(verticalFov);
        this.viewer.setZoom(newZoom);

        this.currPov = {...pov};
    }

    // Copied from UtilitiesPanomarker.js, converts GSV zoom level to FOV, which is what Mapillary uses.
    // TODO move this to a shared location.
    _get3dFov(zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // Linear descent.
            195.93 / Math.pow(1.92, zoom); // Parameters determined experimentally.
    }

    /**
     * Calculates the zoom level from a given 3D field of view angle. This is the inverse of get3dFov().
     * TODO move this to a shared location.
     * @param {number} fov - The field of view angle in degrees.
     * @returns {number} The corresponding zoom level.
     */
    _getZoomFrom3dFov(fov) {
        // The transition point is at zoom = 2, where fov = 126.5 - 2 * 36.75 = 53
        const transitionFov = 53;

        if (fov >= transitionFov) {
            // Reverse of: fov = 126.5 - zoom * 36.75. Solving for zoom: zoom = (126.5 - fov) / 36.75
            return (126.5 - fov) / 36.75;
        } else {
            // Reverse of: fov = 195.93 / Math.pow(1.92, zoom)
            // Solving for zoom: 1.92^zoom = 195.93 / fov
            // Taking log: zoom * log(1.92) = log(195.93 / fov)
            // Therefore: zoom = log(195.93 / fov) / log(1.92)
            return Math.log(195.93 / fov) / Math.log(1.92);
        }
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
