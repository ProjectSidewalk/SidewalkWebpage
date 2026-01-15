/**
 * Infra3D implementation of the PanoViewer interface.
 * Docs: https://developers.infra3d.com/javascript-api/reference/classes/Viewer.Viewer.html
 */
class Infra3dViewer extends PanoViewer {
    constructor() {
        super();
        this.viewer = undefined;
        this.currNode = null;
        this.currPanoData = undefined;
    }

    async initialize(canvasElem, panoOptions = {}) {
        const manager = await infra3dapi.init(canvasElem.id, panoOptions.accessToken);
        const fetchedProjects = await manager.getProjects();
        console.log(fetchedProjects);
        const projectUID = fetchedProjects[0].uid;

        // Docs on Infra3D viewer options:
        // https://developers.infra3d.com/custom-content/reference/classes/Manager.Manager.html#initViewer
        const defaults = {
            project_uid: projectUID,
            show_topbar: false,
            show_toolbar: false,
            show_mapWindow: false,
            map_expand: false, // Only used if show_mapWindow is true
            show_cockpit: false,

            // TODO Below are a few options copied from GSV that I might want to take into account here.
            // position: undefined,
            // pov: properties.panoramaPov, // TODO required or optional parameter? -- optional, but do I want to include here?
            // disableDefaultUI: true,
            // TODO keyboardShortcuts..? Looks like only available for `new google.maps.Map`?
            linksControl: false,
            // TODO navigationControl?
            zoomControl: true,
        };
        const panoOpts = { ...defaults, ...panoOptions };

        try {
            this.viewer = await manager.initViewer(panoOpts);
        } catch (error) {
            console.error('Viewer initialization failed:', error);

            // Try it a second time in case it works...
            try {
                this.viewer = await manager.initViewer(panoOpts);
            } catch (retryError) {
                console.error('Viewer initialization retry failed:', retryError);
                // TODO should do a page refresh or something here. Or show an error message.
            }
        }
        console.log(this.viewer);

        // Handle a few other configs that need to be handled after initialization.
        if (panoOpts.linksControl === false) {
            this.hideNavigationArrows();
        }
        if (panoOpts.zoomControl === false) {
            this._disableUserZoom();
        }

        // Set up listener for pano changes to track the current navigation arrows.
        const panoChangedListener = (node) => {
            this.currNode = node;
            this.removeListener('pano_changed', panoChangedListener);
        }
        this.addListener("pano_changed", panoChangedListener);
    }

    getPanoId = () => {
        return this.currPanoData ? this.currPanoData.getProperty('panoId') : this.viewer.getCurrentNode().id;
    }

    getPosition = () => {
        if (this.currNode) {
            return { lat: this.currNode.frame.latitude, lng: this.currNode.frame.longitude };
        } else {
            const currNode = this.viewer.getCurrentNode();
            return { lat: currNode.lat, lng: currNode.lon };
        }
    }

    setLocation = async (latLng) => {
        this.currNode = null;
        // Convert from WGS84 to Web Mercator (EPSG:3857), which is what Infra3D uses.
        const wgs84 = 'EPSG:4326';
        const webMercator = 'EPSG:3857';
        const [easting, northing] = proj4(wgs84, webMercator, [latLng.lng, latLng.lat]);

        // Undefined params are height (deprecated) and distance (in meters). Distance is the max distance to move from
        // current position, so we don't really have a use for it.
        // TODO We'll have to do the radius check GSV does ourselves.
        return this.viewer.moveToPosition(easting, northing, undefined, undefined, 3857)
            .then(this._finishRecordingMetadata);
    }

    setPano = async (panoId) => {
        this.currNode = null;
        return this.viewer._sdk_viewer.moveToKey(panoId).then(this._finishRecordingMetadata);
    }

    /**
     * Ensures that all image metadata has been saved before letting setPano or setLocation resolve.
     *
     * Due to quirks with the Infra3d APIs, there are inconsistencies on when data that we need are available. Data
     * loads in a different order for the first pano, and data loads in a different order when using moveToKey() vs
     * moveToPosition(). We handle all edges cases below so that all necessary data is available when this resolves.
     * @param node {Object | undefined} Infra3d's internal node object; moveToKey sends it but moteToPosition does not
     * @returns {Promise<Object>} TODO need to define a class for this
     * @private
     */
    _finishRecordingMetadata = async (node) => {
        // First, make sure that this.currNode has been set.
        return new Promise((resolve) => {
            if (this.currNode) {
                // When first pano loads, 'pano_changed' event is fired before moveToPosition() resolves, and since
                // moveToPosition() doesn't return the node, we had to save the node using a listener in initialize().
                resolve(this.currNode);
            } else if (node) {
                // If _sdk_viewer.moveToKey() was used, it returns the node that we need.
                this.currNode = node;
                resolve(node);
            } else {
                // If moveToPosition() was used, it doesn't return a node, and we have to get it from an event.
                const panoChangedListener = (node) => {
                    this.removeListener('pano_changed', panoChangedListener);
                    this.currNode = node;
                    resolve(node);
                };
                this.addListener('pano_changed', panoChangedListener);
            }
        }).then((node) => {
            // Next, make sure that the node has the linked panos initialized (in node.spatialEdges.edges).
            return new Promise((resolve) => {
                // Links should be initialized always, except for the first pano. So we can just use them.
                if (node.spatialEdges.cached) {
                    resolve(node);
                } else {
                    // Listen for the event that fires when the links are updated. Only needed when loading first image.
                    const linksListener = node.spatialEdges$.subscribe((spatialEdges) => {
                        if (spatialEdges.cached) {
                            linksListener.unsubscribe(); // We no longer need the listener at this point.
                            resolve(node);
                        }
                    });
                }
            });
        }).then((node) => {
            // TODO this node has the wrong lat/lng. Does it have the right date, omega, and phi?
            const mainNode = this.viewer.getCurrentNode();

            // Now that all the data is available, we can fill the currPanoData object and say that the pano has loaded.
            let panoDataParams = {
                panoId: node.frame.id,
                source: this.getViewerType(),
                captureDate: moment(mainNode.date),
                width: 4 * node.frame.framedatameta.imagewidth, // width/height are for only one side of the cube map
                height: 2 * node.frame.framedatameta.imageheight,
                tileWidth: node.frame.framedatameta.tilesize,
                tileHeight: node.frame.framedatameta.tilesize,
                lat: node.frame.latitude,
                lng: node.frame.longitude,
                cameraHeading: this._getHeading(mainNode.omega, mainNode.phi),
                cameraPitch: this._getPitch(mainNode.omega, mainNode.phi),
                copyright: null, // TODO should probably fill in infra3d here?
                history: [] // TODO I don't think we have a history to pull from?
            }

            panoDataParams.linkedPanos = node.spatialEdges.edges
                .filter(link => link.data.direction === 9) // Filters out link to camera on back of car for now.
                .map(function(link) {
                    // The worldMotionAzimuth is defined as "the counter-clockwise horizontal rotation angle from the
                    // X-axis in a spherical coordinate system", so we need to adjust it to be like a compass heading.
                    return {
                        panoId: link.to,
                        heading: util.math.toDegrees((Math.PI / 2 - link.data.worldMotionAzimuth) % (2 * Math.PI))
                    };
                });

            this.currPanoData = new PanoData(panoDataParams);
            return this.currPanoData;
        });
    }

    getLinkedPanos = () => {
        return this.currPanoData.getProperty('linkedPanos');
    }

    getPov = () => {
        const currentView = this.viewer.getCameraView();
        const currentNode = this.viewer.getCurrentNode();

        // Calculate the orientation of the camera.
        const horizontalOrientation = this._getHeading(currentNode.omega, currentNode.phi);
        const verticalOrientation = this._getPitch(currentNode.omega, currentNode.phi);

        // Add the orientation of the image to the camera.
        const horizontalAzimuth = (horizontalOrientation + currentView.lon) % 360;
        const verticalAzimuth = (verticalOrientation + currentView.lat) % 360;

        // Convert from vertical fov to horizontal fov, then convert to a zoom level that you'd see in GSV.
        const horizontalFov = util.math.toDegrees(
            2 * Math.atan(Math.tan(util.math.toRadians(currentView.fov) / 2) * util.EXPLORE_CANVAS_ASPECT_RATIO)
        );
        const zoom = this._getZoomFrom3dFov(horizontalFov);

        return { heading: horizontalAzimuth, pitch: verticalAzimuth, zoom: zoom };
    }

    setPov = (pov) => {
        const currentNode = this.viewer.getCurrentNode();
        const currView = this.viewer.getCameraView();

        // Calculate the base orientation from the node's position.
        const baseHeading = this._getHeading(currentNode.omega, currentNode.phi);
        const basePitch = this._getPitch(currentNode.omega, currentNode.phi);

        // Calculate the required camera adjustment to reach target orientation.
        // Since: target = base + cameraAdjustment
        // Therefore: cameraAdjustment = target - base
        const requiredLng = (pov.heading - baseHeading + 360) % 360;
        const requiredLat = (pov.pitch - basePitch + 360) % 360;

        // Convert to the range expected by setCameraView (typically -180 to 180).
        let viewLng = requiredLng > 180 ? requiredLng - 360 : requiredLng;
        let viewLat = requiredLat > 180 ? requiredLat - 360 : requiredLat;

        // If zoom was provided, convert to a horizontal fov, and then convert to the vertical fov used by infra3d.
        let verticalFov;
        if (pov.zoom) {
            const horizontalFov = this._get3dFov(pov.zoom);
            verticalFov = util.math.toDegrees(
                2 * Math.atan(Math.tan(util.math.toRadians(horizontalFov / 2)) / util.EXPLORE_CANVAS_ASPECT_RATIO)
            );
        } else {
            verticalFov = currView.fov;
        }

        // Set the camera view.
        this.viewer.setCameraView({
            type: 'pano',
            lat: viewLat,
            lon: viewLng,
            fov: verticalFov
        });
    }

    // Copied from UtilitiesPanomarker.js, converts GSV zoom level to FOV, which is what Infra3D uses.
     _get3dFov(zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // Linear descent.
            195.93 / Math.pow(1.92, zoom); // Parameters determined experimentally.
    }

    /**
     * Calculates the zoom level from a given 3D field of view angle. This is the inverse of get3dFov().
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

    // Called getHorizontalOrientation in the code we were sent.
    _getHeading(omegaDeg, phiDeg) {
        const omega = (omegaDeg * Math.PI) / 180;
        const phi = (phiDeg * Math.PI) / 180;
        const x = -1 * Math.sin(phi);
        const y = Math.sin(omega) * Math.cos(phi);

        let azi = 0;

        if (x > 0 && y > 0) {
            azi = (Math.atan(x / y) * 180) / Math.PI;
        } else if (x > 0 && y < 0) {
            azi = ((Math.atan(x / y) + Math.PI) * 180) / Math.PI;
        } else if (x < 0 && y < 0) {
            azi = ((Math.atan(x / y) + Math.PI) * 180) / Math.PI;
        } else if (x < 0 && y > 0) {
            azi = ((Math.atan(x / y) + 2 * Math.PI) * 180) / Math.PI;
        }

        return azi;
    }

    // Called getVerticalOrientation in the code we were sent.
    _getPitch(omegaDeg, phiDeg) {
        const omega = (omegaDeg * Math.PI) / 180;
        const phi = (phiDeg * Math.PI) / 180;
        const x = -1 * Math.sin(phi);
        const y = Math.sin(omega) * Math.cos(phi);
        const z = Math.cos(omega) * Math.cos(phi);

        return (Math.atan(z / Math.sqrt(x * x + y * y)) * 180) / Math.PI;
    }

    _disableUserZoom = () => {
        this.viewer.setUserInteraction(true, false); // first option is panning, second is zooming
    }

    hideNavigationArrows = () => {
        this.viewer._sdk_viewer.deactivateComponent("direction")
    }

    showNavigationArrows = () => {
        this.viewer._sdk_viewer.activateComponent("direction")
    }

    addListener(event, handler) {
        if (event === 'pano_changed') {
            this.viewer._sdk_viewer.on("nodechanged", handler);
        } else if (event === 'pov_changed') {
            this.viewer.on("panorotationchanged", (evt) => {
                handler(evt);
            });
        }
    }

    removeListener(event, handler) {
        if (event === 'pano_changed') {
            this.viewer._sdk_viewer.off("nodechanged", handler);
        } else if (event === 'pov_changed') {
            this.viewer.off("panorotationchanged", handler);
        }
    }
}
