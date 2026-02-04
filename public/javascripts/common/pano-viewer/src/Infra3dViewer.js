/**
 * Infra3D implementation of the PanoViewer interface.
 * Docs: https://developers.infra3d.com/javascript-api/reference/classes/Viewer.Viewer.html
 */
class Infra3dViewer extends PanoViewer {
    constructor() {
        super();
        this.viewer = undefined;
        this.prevNode = null;
        this.currNode = null; // This becomes null while waiting to load subsequent panos.
        this.currPanoData = undefined; // This holds onto the data for the prior pano while we are loading the next one.
    }

    async initialize(canvasElem, panoOptions = {}) {
        console.log(canvasElem, panoOptions);
        const manager = await infra3dapi.init(canvasElem.id, panoOptions.accessToken);
        // Fetching projects will occasionally fail once, just refresh page to try again.
        let fetchedProjects;
        try {
            fetchedProjects = await manager.getProjects();
        } catch (error) {
            window.location.reload();
        }
        console.log(fetchedProjects);
        const projectUID = fetchedProjects[0].uid;

        // Docs on Infra3D viewer options:
        // https://developers.infra3d.com/custom-content/reference/classes/Manager.Manager.html#initViewer
        let disableDefaultUi = 'disableDefaultUi' in panoOptions ? panoOptions.disableDefaultUi : true;
        let panoOpts = {
            project_uid: projectUID,
            show_topbar: !disableDefaultUi,
            show_toolbar: !disableDefaultUi,
            show_mapWindow: !disableDefaultUi,
            map_expand: !disableDefaultUi, // Only used if show_mapWindow is true
            show_cockpit: !disableDefaultUi,

            linksControl: false,
            zoomControl: true,
        };
        panoOpts = { ...panoOpts, ...panoOptions };

        // Initialize the viewer.
        // TODO sometimes initViewer fails and idk how to catch the error. Refresh page if not done after 10 seconds.
        this.viewer = await Promise.race([
            manager.initViewer(panoOpts),
            new Promise((_, reject) => setTimeout(() => reject('timeout'), 10000))
        ]).catch(() => {
            window.location.reload();
        });
        console.log(this.viewer);

        // Handle a few other configs that need to be handled after initialization.
        if (panoOpts.linksControl === false) {
            this.hideNavigationArrows();
        }
        if (panoOpts.zoomControl === false) {
            this.#disableUserZoom();
        }

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

    setLocation = async (latLng, excludedPanos = new Set()) => {
        this.prevNode = this.currNode;
        this.currNode = null;

        // Convert from WGS84 to Web Mercator (EPSG:3857), which is what Infra3D uses.
        const wgs84 = 'EPSG:4326';
        const webMercator = 'EPSG:3857';
        const [easting, northing] = proj4(wgs84, webMercator, [latLng.lng, latLng.lat]);
        const newPosition = { easting: easting, northing: northing };

        // Using the internal function that returns a node, since the usual one in the API does not.
        // TODO We should be checking if the new location is within STREETVIEW_MAX_DISTANCE. But we always have imagery
        //      in the zurich test city, so this should never be a problem.
        return this.viewer._sdk_viewer.movePosition(newPosition, 3857)
            .then(this.#finishRecordingMetadata)
            .then((panoData) => this.#filterExcludedPanos(panoData, excludedPanos));
    };

    // TODO This version includes non-panoramic imagery, but does not require loading images for excluded panos. We're
    //      waiting to hear back from Andreas on whether there's a way to do filtering. If so, use this method instead.
    // setLocation = async (latLng, excludedPanos = new Set()) => {
    //     // Use imagesByKNN$ to find the closest image to the lat/lng.
    //     const closestPano = new Promise((resolve, reject) => {
    //         this.viewer._sdk_viewer._navigator._api.imagesByKNN$(latLng.lng, latLng.lat, 4326).subscribe({
    //             next: (data) => {
    //                 if (excludedPanos.has(data.key)) reject(`Excluded pano: ${data.key}`);
    //                 else resolve(data.key);
    //                 },
    //             error: (err) => reject(err),
    //         });
    //     });
    //
    //     // TODO We'll have to do the radius check GSV does ourselves. Though we should always have imagery now...
    //     //      And can we get that info from the KNN data..?
    //     return closestPano.then(this.setPano);
    // };

    setPano = async (panoId) => {
        this.prevNode = this.currNode;
        this.currNode = null;
        return this.viewer._sdk_viewer.moveToKey(panoId).then(this.#finishRecordingMetadata);
    };

    /**
     * If the new pano we arrived at is in the excluded list, go back to the previous one and throw an error.
     * @param {PanoData} newPanoData The pano data for the new panorama
     * @param {Set<string>} [excludedPanos=new Set()] Set of pano IDs that are not valid images to move to
     * @returns {Promise<PanoData>} Rejects with error if new pano in excluded list; resolves with pano data otherwise
     */
    #filterExcludedPanos = (newPanoData, excludedPanos) => {
        // If the pano given is in the excluded list, treat it as if the API call itself had returned nothing.
        if (excludedPanos.has(newPanoData.getPanoId())) {
            return this.setPano(this.prevNode.frame.id).then(() => {
                throw new Error(`Excluded pano: ${newPanoData.getPanoId()}`);
            });
        } else {
            return Promise.resolve(newPanoData);
        }
    };

    /**
     * Ensures that all image metadata has been saved before letting setPano or setLocation resolve.
     *
     * @param node {object} Infra3d's internal node object; moveToKey sends it but moteToPosition does not
     * @returns {Promise<PanoData>}
     * @private
     */
    #finishRecordingMetadata = async (node) => {
        this.currNode = node;
        // Make sure that the node has the linked panos initialized (in node.spatialEdges.edges).
        return new Promise((resolve) => {
            // Links should be initialized always, except for the first pano. So we can just use them.
            if (node.spatialEdges.cached) {
                resolve(node);
            } else {
                // Listen for the event that fires when the links are updated. Only needed when loading first image.
                // NOTE the subscribe architecture is coming from RxJS.
                const linksListener = node.spatialEdges$.subscribe((spatialEdges) => {
                    if (spatialEdges.cached) {
                        linksListener.unsubscribe(); // We no longer need the listener at this point.
                        resolve(node);
                    }
                });
            }
        }).then((node) => {
            // Now that all the data is available, we can fill the currPanoData object and say that the pano has loaded.
            let panoDataParams = {
                panoId: node.frame.id,
                source: this.getViewerType(),
                captureDate: moment(node.frame.timestamp),
                width: 4 * node.frame.framedatameta.imagewidth, // width/height are for only one side of the cube map
                height: 2 * node.frame.framedatameta.imageheight,
                tileWidth: node.frame.framedatameta.tilesize,
                tileHeight: node.frame.framedatameta.tilesize,
                lat: node.frame.latitude,
                lng: node.frame.longitude,
                cameraHeading: this._getHeading(node.frame.omega, node.frame.phi),
                cameraPitch: this._getPitch(node.frame.omega, node.frame.phi),
                copyright: 'City of Zurich and iNovitas AG',
                history: [] // No history to pull from for Infra3D right now.
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
    };

    getLinkedPanos = () => {
        return this.currPanoData.getProperty('linkedPanos');
    };

    getPov = () => {
        const currentView = this.viewer.getCameraView();
        const node = this.currNode || this.prevNode;

        // Calculate the orientation of the camera.
        const horizontalOrientation = this._getHeading(node.frame.omega, node.frame.phi);
        const verticalOrientation = this._getPitch(node.frame.omega, node.frame.phi);

        // Add the orientation of the image to the camera.
        const horizontalAzimuth = (horizontalOrientation + currentView.lon) % 360;
        const verticalAzimuth = (verticalOrientation + currentView.lat) % 360;

        // Convert from vertical fov to horizontal fov, then convert to a zoom level that you'd see in GSV.
        const horizontalFov = util.math.toDegrees(
            2 * Math.atan(Math.tan(util.math.toRadians(currentView.fov) / 2) * util.EXPLORE_CANVAS_ASPECT_RATIO)
        );
        const zoom = util.pano.fovToZoom(horizontalFov);

        return { heading: horizontalAzimuth, pitch: verticalAzimuth, zoom: zoom };
    };

    setPov = (pov) => {
        const node = this.currNode || this.prevNode;

        // Calculate the base orientation from the node's position.
        const baseHeading = this._getHeading(node.frame.omega, node.frame.phi);
        const basePitch = this._getPitch(node.frame.omega, node.frame.phi);

        // Calculate the required camera adjustment to reach target orientation.
        // Since: target = base + cameraAdjustment, therefore: cameraAdjustment = target - base.
        const requiredLng = (pov.heading - baseHeading + 360) % 360;
        const requiredLat = (pov.pitch - basePitch + 360) % 360;

        // Convert to the range expected by setCameraView (typically -180 to 180).
        let viewLng = requiredLng > 180 ? requiredLng - 360 : requiredLng;
        let viewLat = requiredLat > 180 ? requiredLat - 360 : requiredLat;

        // If zoom was provided, convert to a horizontal fov, and then convert to the vertical fov used by Infra3D.
        let verticalFov;
        if (pov.zoom) {
            const horizontalFov = util.pano.zoomToFov(pov.zoom);
            verticalFov = util.math.toDegrees(
                2 * Math.atan(Math.tan(util.math.toRadians(horizontalFov / 2)) / util.EXPLORE_CANVAS_ASPECT_RATIO)
            );
        } else {
            verticalFov = this.viewer.getCameraView().fov;
        }

        // Set the camera view, smooth panning=false.
        this.viewer.setCameraView({
            type: 'pano',
            lat: viewLat,
            lon: viewLng,
            fov: verticalFov
        }, false);
    };

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
    };

    // Called getVerticalOrientation in the code we were sent.
    _getPitch(omegaDeg, phiDeg) {
        const omega = (omegaDeg * Math.PI) / 180;
        const phi = (phiDeg * Math.PI) / 180;
        const x = -1 * Math.sin(phi);
        const y = Math.sin(omega) * Math.cos(phi);
        const z = Math.cos(omega) * Math.cos(phi);

        return (Math.atan(z / Math.sqrt(x * x + y * y)) * 180) / Math.PI;
    };

    #disableUserZoom = () => {
        this.viewer.setUserInteraction(true, false); // first option is panning, second is zooming
    };

    hideNavigationArrows = () => {
        this.viewer._sdk_viewer.deactivateComponent("direction");
    };

    showNavigationArrows = () => {
        this.viewer._sdk_viewer.activateComponent("direction");
    };

    addListener(event, handler) {
        if (event === 'pano_changed') {
            this.viewer._sdk_viewer.on("nodechanged", handler);
        } else if (event === 'pov_changed') {
            this.viewer.on("panorotationchanged", (evt) => {
                handler(evt);
            });
        }
    };

    removeListener(event, handler) {
        if (event === 'pano_changed') {
            this.viewer._sdk_viewer.off("nodechanged", handler);
        } else if (event === 'pov_changed') {
            this.viewer.off("panorotationchanged", handler);
        }
    };
}
