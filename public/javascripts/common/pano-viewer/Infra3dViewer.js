/**
 * Infra3D implementation of the PanoViewer interface.
 * Docs: https://developers.infra3d.com/javascript-api/reference/classes/Viewer.Viewer.html
 */
class Infra3dViewer extends PanoViewer {
    constructor() {
        super();
        this.viewer = undefined;
        this.currentLinks = [];
    }

    async initialize(canvasElem, panoOptions = {}) {
        // const MY_ACCESS_TOKEN = YOUR_CUSTOM_FUNCTION_FOR_RETRIEVING_TOKENS;
        const MY_ACCESS_TOKEN = await infra3dapi.getGuestAccessToken();
        const manager = await infra3dapi.init(
            canvasElem.id,
            MY_ACCESS_TOKEN.access_token//,
            // {
            //   username: "Guest",  // or  userid: "YOUR_USERID" -- TODO
            //   email: "support@inovitas.ch" // TODO
            // }
        );
        const fetchedProjects = await manager.getProjects();
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

        this.viewer = await manager.initViewer(panoOpts);

        // Handle a few other configs that need to be handled after initialization.
        if (panoOpts.linksControl === false) {
            this.hideNavigationArrows();
        }
        if (panoOpts.zoomControl === false) {
            this._disableUserZoom();
        }

        // Set up listener for pano changes to track the current navigation arrows.
        // TODO for some reason spatialEdges is empty when loading the first pano.
        this.addListener("pano_changed", (node) => {
            console.log('pano_changed', node);
            this.currentLinks = node.spatialEdges.edges;
        });
    }

    getPanoId = () => {
        return this.viewer.getCurrentNode().id;
    }

    getPosition = () => {
        const currNode = this.viewer.getCurrentNode();
        return { lat: currNode.lat, lng: currNode.lon };
    }

    setPosition = async (lat, lng) => {
        // Convert from WGS84 to Web Mercator (EPSG:3857), which is what Infra3D uses.
        const wgs84 = 'EPSG:4326';
        const webMercator = 'EPSG:3857';
        const [easting, northing] = proj4(wgs84, webMercator, [lng, lat]);

        // Undefined params are height (deprecated) and distance (in meters). Distance is the max distance to move from
        // current position, so we don't really have a use for it.
        // TODO We'll have to do the radius check GSV does ourselves.
        this.viewer.moveToPosition(easting, northing, undefined, undefined, 3857);
    }

    setPano = async (panoId) => {
        return this.viewer.moveToKey(panoId);
    }

    getLinkedPanos = () => {
        return this.currentLinks.map(function(link) {
            console.log(link);
            // The worldMotionAzimuth is defined as "the counter-clockwise horizontal rotation angle from the X-axis in
            // a spherical coordinate system", so we need to adjust it to be like a compass heading.
            return {
                panoId: link.to,
                heading: util.math.toDegrees((Math.PI / 2 - link.data.worldMotionAzimuth) % (2 * Math.PI))
            };
        });
    }

    getPov = () => {
        const currentView = this.viewer.getCameraView();
        const currentNode = this.viewer.getCurrentNode();

        // Calculate the orientation of the camera.
        const horizontalOrientation = this._getHeading(
            currentNode.omega,
            currentNode.phi
        );
        // Add the orientation of the image to the camera.
        const horizontalAzimuth = (horizontalOrientation + currentView.lon) % 360;

        // Calculate the orientation of the camera.
        const verticalOrientation = this._getPitch(
            currentNode.omega,
            currentNode.phi
        );
        // Add the orientation of the image to the camera.
        const verticalAzimuth = (verticalOrientation + currentView.lat) % 360;

        // Convert the FOV to a zoom level that you'd see in GSV.
        const zoom = Math.round(this._getZoomFrom3dFov(currentView.fov));

        return { heading: horizontalAzimuth, pitch: verticalAzimuth, zoom: zoom };
    }

    setPov = (pov) => {
        const currentNode = this.viewer.getCurrentNode();

        // Calculate the base orientation from the node's position.
        const baseHeading = this._getHeading(currentNode.omega, currentNode.phi);
        const basePitch = this._getPitch(currentNode.omega, currentNode.phi);

        // Calculate the required camera adjustment to reach target orientation.
        // Since: target = base + cameraAdjustment
        // Therefore: cameraAdjustment = target - base
        const requiredLng = (pov.heading - baseHeading + 360) % 360;
        const requiredLat = (pov.pitch - basePitch + 360) % 360;

        // Convert to the range expected by setCameraView (typically -180 to 180).
        const viewLng = requiredLng > 180 ? requiredLng - 360 : requiredLng;
        const viewLat = requiredLat > 180 ? requiredLat - 360 : requiredLat;
        const viewFov = pov.zoom ? this._get3dFov(pov.zoom) : this.viewer.getCameraView().fov;

        // Set the camera view.
        this.viewer.setCameraView({
            type: 'pano',
            lon: viewLng,
            lat: viewLat,
            fov: viewFov
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
}
