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
            linksControl: true, // TODO true on Explore, false on Validate
            // TODO navigationControl?
            zoomControl: true,
        };
        const panoOpts = { ...defaults, ...panoOptions };

        this.viewer = await manager.initViewer(panoOpts);

        // Handle a few other configs that need to be handled after initialization.
        if (panoOptions.linksControl === false) {
            this.hideNavigationArrows();
        }
        if (panoOpts.zoomControl === false) {
            this._disableUserZoom();
        }

        // Set up listener for pano changes to track the current navigation arrows.
        this.addListener("pano_changed", (node) => { this.currentLinks = node.spatialEdges.edges; });
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

    // Move in the direction of a link closest to a given angle.
    // TODO I think that this function could make the angle an option, if none supplied than it's just the Stuck button.
    moveToNextPano = async (angle) => {
        // if (googleMap.getStatus("disableWalking")) return; // TODO do we make this a func of PanoViewer?

        // Take the cosine of the difference bw each link & the current heading in radians and stores them to an array.
        const cosines = this.currentLinks.map(function(link) {
            // The worldMotionAzimuth is defined as "the counter-clockwise horizontal rotation angle from the X-axis in
            // a spherical coordinate system", so we need to adjust it to be like a compass heading.
            const linkHeading = (Math.PI - link.worldMotionAzimuth) % (2 * Math.PI);
            const headingAngleOffset = util.math.toRadians(svl.panoViewer.panorama.pov.heading + angle) - linkHeading;
            return Math.cos(headingAngleOffset);
        });
        const maxVal = Math.max.apply(null, cosines);
        const maxIndex = cosines.indexOf(maxVal);
        if (cosines[maxIndex] > 0.5) {
            await this.setPano(this.currentLinks[maxIndex].to);
            return true;
        } else {
            return false;
        }
    };

    getPov = () => {
        const current_view = this.viewer.getCameraView();
        const current_node = this.viewer.getCurrentNode();

        // Calculate the orientation of the camera.
        const horizontal_orientation = this._getHeading(
            current_node.omega,
            current_node.phi
        );
        // Add the orientation of the image to the camera.
        const horizontal_azimuth = (horizontal_orientation + current_view.lon) % 360;

        // Calculate the orientation of the camera.
        const vertical_orientation = this._getPitch(
            current_node.omega,
            current_node.phi
        );
        // Add the orientation of the image to the camera.
        const vertical_azimuth = (vertical_orientation + current_view.lat) % 360;

        // Convert the FOV to a zoom level that you'd see in GSV.
        const zoom = this._getZoomFrom3dFov(current_view.fov);

        return { heading: horizontal_azimuth, pitch: vertical_azimuth, fov: zoom };
    }

    setPov = (pov) => {
        const current_node = this.viewer.getCurrentNode();

        // Calculate the base orientation from the node's position.
        const base_heading = this._getHeading(current_node.omega, current_node.phi);
        const base_pitch = this._getPitch(current_node.omega, current_node.phi);

        // Calculate the required camera adjustment to reach target orientation.
        // Since: target = base + camera_adjustment
        // Therefore: camera_adjustment = target - base
        const required_lon = (pov.heading - base_heading + 360) % 360;
        const required_lat = (pov.pitch - base_pitch + 360) % 360;

        // Convert to the range expected by setCameraView (typically -180 to 180).
        const view_lon = required_lon > 180 ? required_lon - 360 : required_lon;
        const view_lat = required_lat > 180 ? required_lat - 360 : required_lat;
        const view_fov = pov.zoom ? this._get3dFov(pov.zoom) : this.viewer.getCameraView().fov;

        // Set the camera view.
        this.viewer.setCameraView({
            type: 'pano',
            lon: view_lon,
            lat: view_lat,
            fov: view_fov
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
    _getHeading(omega_deg, phi_deg) {
        const omega = (omega_deg * Math.PI) / 180;
        const phi = (phi_deg * Math.PI) / 180;
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
    _getPitch(omega_deg, phi_deg) {
        const omega = (omega_deg * Math.PI) / 180;
        const phi = (phi_deg * Math.PI) / 180;
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
