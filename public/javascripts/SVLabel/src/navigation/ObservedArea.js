/**
 * ObservedArea module.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ObservedArea(uiMinimap) {
    let angle = null;  // User's angle.
    let leftAngle = null;  // Left-most angle of the user's FOV.
    let rightAngle = null;  // Right-most angle of the user's FOV.
    let observedAreas = [];  // List of observed areas (panoId, latLng, minAngle, maxAngle).
    let currArea = {}; // Current observed area (panoId, latLng, minAngle, maxAngle).
    let fractionObserved = 0;  // User's current fraction of 360 degrees observed.
    const radius = 40;  // FOV radius in pixels.
    const width = uiMinimap.fogOfWar.width();  // Canvas width.
    const height = uiMinimap.fogOfWar.height();  // Canvas height.
    // Get canvas context for the various components of the fog of war view on the mini map.
    const fogOfWarCtx = uiMinimap.fogOfWar[0].getContext('2d');
    const fovCtx = uiMinimap.fov[0].getContext('2d');
    const progressCircleCtx = uiMinimap.progressCircle[0].getContext('2d');

    function initialize() {
        // Set up some ctx stuff that never changes here so that we don't do it repeatedly.
        uiMinimap.percentObserved.css('color', '#404040')
        fogOfWarCtx.fillStyle = '#888888';
        fogOfWarCtx.filter = 'blur(5px)';
        fovCtx.fillStyle = '#8080ff';
        progressCircleCtx.fillStyle = '#8080ff';
        progressCircleCtx.lineCap = 'round';
        progressCircleCtx.lineWidth = 2;
    }

    /**
     * Resets the user's angle and adds user's new pano to 'observedAreas'. Called when the user takes a step.
     */
     this.panoChanged = function() {
        angle = null;
        leftAngle = null;
        rightAngle = null;
        const panoId = svl.panoViewer.getPanoId();
        currArea = observedAreas.find(area => area.panoId === panoId);

        if (!currArea) {
            currArea = { panoId: panoId, latLng: svl.panoViewer.getPosition(), minAngle: null, maxAngle: null };
            observedAreas.push(currArea);
        }
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
     * Updates all the angle variables necessary to keep track of the user's observed area.
     */
    function updateAngles() {
        const pov = svl.panoViewer.getPov();
        let heading = pov.heading;
        const fov = util.pano.zoomToFov(pov.zoom);
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
            fogOfWarCtx.beginPath();
            if (observedArea.maxAngle - observedArea.minAngle < 360) {
                fogOfWarCtx.moveTo(width / 2, height / 2);
            }
            fogOfWarCtx.arc(width / 2, height / 2, radius,
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
        fovCtx.beginPath();
        fovCtx.moveTo(width / 2, height / 2);
        fovCtx.arc(width / 2, height / 2, radius, toRadians(leftAngle - 90), toRadians(rightAngle - 90));
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
            uiMinimap.percentObserved.text(Math.floor(100 * fractionObserved) + '%');
            if (fractionObserved === 1) {
                uiMinimap.message.text(i18next.t('right-ui.minimap.follow-red-line'));
            } else {
                uiMinimap.message.text(i18next.t('right-ui.minimap.explore-current-location'));
            }
        }
    }

    initialize();
    return this;
}
