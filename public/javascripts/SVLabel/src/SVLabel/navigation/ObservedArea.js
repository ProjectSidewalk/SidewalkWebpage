/**
 * ObservedArea module.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ObservedArea(uiMiniMap) {
    let radius = 40;  // FOV radius in pixels.
    let angle = null;  // User's angle.
    let leftAngle = null;  // Left-most angle of the user's FOV.
    let rightAngle = null;  // Right-most angle of the user's FOV.
    let observedAreas = [];  // List of observed areas (panoId, latLng, minAngle, maxAngle).
    let currArea = {}; // Current observed area (panoId, latLng, minAngle, maxAngle).
    let fractionObserved = 0;  // User's current fraction of 360 degrees observed.
    let fogOfWarCtx = null;  // Canvas context for the fog of war.
    let fovCtx = null;  // Canvas context for user's FOV (and progress bar).
    let progressCircleCtx = null; // Canvas context for current pano's FOV progress circle.
    let width = 0;  // Canvas width.
    let height = 0;  // Canvas height.

    this.initialize = function() {
        // Get canvas context for the various components of the fog of war view on the mini map.
        fogOfWarCtx = uiMiniMap.fogOfWar[0].getContext('2d');
        fovCtx = uiMiniMap.fov[0].getContext('2d');
        progressCircleCtx = uiMiniMap.progressCircle[0].getContext('2d');
        // Get canvas width and height.
        width = uiMiniMap.fogOfWar.width();
        height = uiMiniMap.fogOfWar.height();

        // Set up some ctx stuff that never changes here so that we don't do it repeatedly.
        uiMiniMap.percentObserved.css('color', '#404040')
        fogOfWarCtx.fillStyle = '#888888';
        fogOfWarCtx.filter = 'blur(5px)';
        fovCtx.fillStyle = '#8080ff';
        progressCircleCtx.fillStyle = '#8080ff';
        progressCircleCtx.lineCap = 'round';
        progressCircleCtx.lineWidth = 2;
    };

    /**
     * Resets the user's angle and adds user's new pano to 'observedAreas'. Called when the user takes a step.
     */
     this.panoChanged = function() {
        angle = null;
        leftAngle = null;
        rightAngle = null;
        const panoId = svl.panorama.getPano();
        currArea = observedAreas.find(area => area.panoId === panoId);

        if (!currArea) {
            currArea = { panoId: panoId, latLng: svl.map.getPosition(), minAngle: null, maxAngle: null };
            observedAreas.push(currArea);
        }
    }

    /**
     * From PanoMarker spec
     * @param zoom
     * @returns {number}
     */
    function get3dFov(zoom){
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
        const projection = svl.map.getMap().getProjection();
        const bounds = svl.map.getMap().getBounds();
        const topRight = projection.fromLatLngToPoint(bounds.getNorthEast());
        const bottomLeft = projection.fromLatLngToPoint(bounds.getSouthWest());
        const scale = Math.pow(2, svl.map.getMap().getZoom());
        const worldPoint = projection.fromLatLngToPoint(latLng);
        return {x: Math.floor((worldPoint.x - bottomLeft.x) * scale),
                y: Math.floor((worldPoint.y - topRight.y) * scale)};
    }

    /**
     * Updates all the angle variables necessary to keep track of the user's observed area.
     */
    function updateAngles() {
        const pov = svl.map.getPov();
        let heading = pov.heading;
        const fov = get3dFov(pov.zoom);
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
        if (!currArea.minAngle || leftAngle < currArea.minAngle) {
            currArea.minAngle = leftAngle;
        }
        if (!currArea.maxAngle || rightAngle > currArea.maxAngle) {
            currArea.maxAngle = rightAngle;
        }
        fractionObserved = Math.min(currArea.maxAngle - currArea.minAngle, 360) / 360;
    }

    /**
     * Renders the fog of war.
     */
    function renderFogOfWar() {
        fogOfWarCtx.fillRect(0, 0, width, height);
        fogOfWarCtx.globalCompositeOperation = 'destination-out';
        for (const observedArea of observedAreas) {
            const center = latLngToPixel(observedArea.latLng);
            fogOfWarCtx.beginPath();
            if (observedArea.maxAngle - observedArea.minAngle < 360) {
                fogOfWarCtx.moveTo(center.x, center.y);
            }
            fogOfWarCtx.arc(center.x, center.y, radius,
                toRadians(observedArea.minAngle - 90), toRadians(observedArea.maxAngle - 90));
                fogOfWarCtx.fill();
        }
        fogOfWarCtx.globalCompositeOperation = 'source-over';
    }

    /**
     * Renders the user's FOV.
     */
    function renderFov() {
        fovCtx.clearRect(0, 0, width, height);
        const center = latLngToPixel(currArea.latLng);
        fovCtx.beginPath();
        fovCtx.moveTo(center.x, center.y);
        fovCtx.arc(center.x, center.y, radius, toRadians(leftAngle - 90), toRadians(rightAngle - 90));
        fovCtx.fill();
    }

    /**
     * Renders the user's percentage of 360 degrees observed progress bar. Gray until 100%, then switches to green.
     */
    function renderProgressCircle() {
        progressCircleCtx.clearRect(0, 0, width, height);
        progressCircleCtx.strokeStyle = fractionObserved === 1 ? '#00dd00' : '#404040';
        progressCircleCtx.beginPath();
        progressCircleCtx.arc(width - 20, 20, 16, toRadians(-90), toRadians(fractionObserved * 360 - 90));
        progressCircleCtx.stroke();
    }

    /**
     * Updates everything relevant to the user's observed area.
     */
    this.update = function() {
        if (observedAreas.length > 0) {
            updateAngles();
            renderFogOfWar();
            renderFov();
            renderProgressCircle();
            uiMiniMap.percentObserved.text(Math.floor(100 * fractionObserved) + '%');
            if (fractionObserved === 1) {
                uiMiniMap.message.text(i18next.t('minimap.follow-red-line'));
            } else {
                uiMiniMap.message.text(i18next.t('minimap.explore-current-location'));
            }
        }
    }

    this.initialize();
}
