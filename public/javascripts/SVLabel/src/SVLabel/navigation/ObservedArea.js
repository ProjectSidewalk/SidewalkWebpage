/**
 * ObservedArea module.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ObservedArea (uiMiniMap) {
    let radius = 40;  // FOV radius in pixels.
    let angle = null;  // User's angle.
    let leftAngle = null;  // Left-most angle of the user's FOV.
    let rightAngle = null;  // Right-most angle of the user's FOV.
    let observedAreas = [];  // List of observed areas (latLng, minAngle, maxAngle).
    let fractionObserved = 0;  // User's current fraction of 360 degrees observed.
    let fogOfWarCtx = null;  // Canvas context for the fog of war.
    let fovCtx = null;  // Canvas context for user's FOV (and progress bar).
    let width = 0;  // Canvas width.
    let height = 0;  // Canvas height.

    this.initialize = function () {
        // Get canvas context for the fog of war.
        let fogOfWarCanvas = document.getElementById("google-maps-fog-of-war-canvas");
        fogOfWarCtx = fogOfWarCanvas.getContext("2d");
        // Get canvas context for user's FOV.
        let fovCanvas = document.getElementById("google-maps-fov-canvas");
        fovCtx = fovCanvas.getContext("2d");
        // Get canvas width and height.
        width = fogOfWarCanvas.width;
        height = fogOfWarCanvas.height;

        // Set up some ctx stuff that never changes here so that we don't do it repeatedly.
        uiMiniMap.percentObserved.css('color', '#404040')
        fogOfWarCtx.fillStyle = "#888888";
        fogOfWarCtx.filter = "blur(5px)";
        fovCtx.fillStyle = "#8080ff";
        fovCtx.lineCap = "round";
        fovCtx.lineWidth = 2;
    };

    /**
     * Resets the user's angle and appends the user's new position to 'observedAreas'.
     * Called when the user takes a step.
     */
     this.step = function () {
        angle = null;
        leftAngle = null;
        rightAngle = null;
        let latLng = svl.map.getPosition();
        for (let i = 0; i < observedAreas.length; i++) {
            // If we have observed the new position before, move it to the end of the 'observedAreas' list.
            if (observedAreas[i].latLng.lat == latLng.lat
                    && observedAreas[i].latLng.lng == latLng.lng) {
                observedAreas.push(observedAreas.splice(i, 1)[0]);
                return;
            }
        }
        observedAreas.push({latLng: latLng, minAngle: null, maxAngle: null});
    }

    /**
     * From PanoMarker spec
     * @param zoom
     * @returns {number}
     */
    function get3dFov(zoom) {
        return zoom <= 2 ? 126.5 - zoom * 36.75 : 195.93 / Math.pow(1.92, zoom);
    }

    /**
     * Converts degrees to radians.
     * @param degrees
     * @returns {number}
     */
    function toRadians(degrees) {
        return degrees / 180 * Math.PI;
    }

    /**
     * Converts a latitude and longitude to pixel xy-coordinates.
     * @param latLng
     * @returns {number, number}
     */
    function latLngToPixel(latLng) {
        let projection = svl.map.getMap().getProjection();
        let bounds = svl.map.getMap().getBounds();
        let topRight = projection.fromLatLngToPoint(bounds.getNorthEast());
        let bottomLeft = projection.fromLatLngToPoint(bounds.getSouthWest());
        let scale = Math.pow(2, svl.map.getMap().getZoom());
        let worldPoint = projection.fromLatLngToPoint(latLng);
        return {x: Math.floor((worldPoint.x - bottomLeft.x) * scale),
                y: Math.floor((worldPoint.y - topRight.y) * scale)};
    }

    /**
     * Updates all of the angle variables necessary to keep track of the user's observed area.
     */
    function updateAngles() {
        let pov = svl.map.getPov();
        let heading = pov.heading;
        let fov = get3dFov(pov.zoom);
        if (angle) {
            if (heading - angle > 180) {
                heading -= 360;
            }
            if (heading - angle < -180) {
                heading += 360;
            }
        }
        angle = heading;
        leftAngle = angle - fov / 2;
        rightAngle = angle + fov / 2;
        let current = observedAreas[observedAreas.length - 1];
        if (!current.minAngle || leftAngle < current.minAngle) {
            current.minAngle = leftAngle;
        }
        if (!current.maxAngle || rightAngle > current.maxAngle) {
            current.maxAngle = rightAngle;
        }
        fractionObserved = Math.min(current.maxAngle - current.minAngle, 360) / 360;
    }

    /**
     * Renders the fog of war.
     */
    function renderFogOfWar() {
        fogOfWarCtx.fillRect(0, 0, width, height);
        fogOfWarCtx.globalCompositeOperation = "destination-out";
        for (let observedArea of observedAreas) {
            let center = latLngToPixel(observedArea.latLng);
            fogOfWarCtx.beginPath();
            if (observedArea.maxAngle - observedArea.minAngle < 360) {
                fogOfWarCtx.moveTo(center.x, center.y);
            }
            fogOfWarCtx.arc(center.x, center.y, radius,
                toRadians(observedArea.minAngle - 90), toRadians(observedArea.maxAngle - 90));
                fogOfWarCtx.fill();
        }
        fogOfWarCtx.globalCompositeOperation = "source-over";
    }

    /**
     * Renders the user's FOV.
     */
    function renderFov() {
        fovCtx.clearRect(0, 0, width, height);
        let current = observedAreas[observedAreas.length - 1];
        let center = latLngToPixel(current.latLng);
        fovCtx.beginPath();
        fovCtx.moveTo(center.x, center.y);
        fovCtx.arc(center.x, center.y, radius, toRadians(leftAngle - 90), toRadians(rightAngle - 90));
        fovCtx.fill();
    }

    /**
     * Renders the user's percentage of 360 degrees observed progress bar. Gray until 100%, then switches to green.
     */
    function renderProgressCircle() {
        fovCtx.strokeStyle = fractionObserved === 1 ? "#00dd00" : '#404040';
        fovCtx.beginPath();
        fovCtx.arc(width - 20, 20, 16, toRadians(-90), toRadians(fractionObserved * 360 - 90));
        fovCtx.stroke();
    }

    /**
     * Updates everything relevant to the user's observed area.
     */
    this.update = function () {
        if (observedAreas.length > 0) {
            updateAngles();
            renderFogOfWar();
            renderFov();
            renderProgressCircle();
            document.getElementById("google-maps-percent-observed").innerText = Math.floor(100 * fractionObserved) + "%";
            if (fractionObserved === 1) {
                document.getElementById("google-maps-message").innerText = i18next.t("minimap.follow-red-line");
            } else {
                document.getElementById("google-maps-message").innerText = i18next.t("minimap.explore-current-location");
            }
        }
    }

    this.initialize();
}
