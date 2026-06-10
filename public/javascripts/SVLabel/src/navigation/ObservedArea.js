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
    // Minimap size (px) at UI scale 1, read from the base dimension defined in svl-minimap.css.
    const BASE_SIZE = parseFloat(getComputedStyle(uiMinimap.holder[0]).getPropertyValue('--minimap-base-size'));
    const baseRadius = 40;  // FOV radius in pixels at UI scale 1.
    // The canvas bitmaps are kept in sync with the displayed minimap size (which scales with the UI). This is required
    // because the fog is positioned via the map's projection, which returns coordinates in displayed pixels; if the
    // bitmap didn't match, the fog would be offset (e.g. drawn at displayed/2 inside a smaller bitmap).
    let width = 0;          // Canvas bitmap width (set by syncCanvasSize).
    let height = 0;         // Canvas bitmap height.
    let scaleFactor = 1;    // width / BASE_SIZE; scales the FOV/progress geometry to match the minimap.
    // Get canvas context for the various components of the fog of war view on the mini map.
    const fogOfWarCtx = uiMinimap.fogOfWar[0].getContext('2d');
    const fovCtx = uiMinimap.fov[0].getContext('2d');
    const progressCircleCtx = uiMinimap.progressCircle[0].getContext('2d');

    function initialize() {
        syncCanvasSize();
    }

    /**
     * Sizes the three minimap canvases' bitmaps to the current displayed minimap size and (re)applies the persistent
     * context state. Setting canvas.width/height resets the context, so the styles must be applied here, after sizing.
     */
    function syncCanvasSize() {
        const displayedWidth = Math.round(uiMinimap.fogOfWar.width()) || BASE_SIZE;
        const displayedHeight = Math.round(uiMinimap.fogOfWar.height()) || BASE_SIZE;
        if (displayedWidth !== width || displayedHeight !== height) {
            width = displayedWidth;
            height = displayedHeight;
            scaleFactor = width / BASE_SIZE;
            for (const canvas of [uiMinimap.fogOfWar[0], uiMinimap.fov[0], uiMinimap.progressCircle[0]]) {
                canvas.width = width;
                canvas.height = height;
            }
        }
        // Set up ctx state that doesn't change between renders (and is reset by any resize above).
        uiMinimap.percentObserved.css('color', '#404040');
        fogOfWarCtx.fillStyle = '#888888';
        fogOfWarCtx.filter = `blur(${5 * scaleFactor}px)`;
        fovCtx.fillStyle = '#8080ff';
        progressCircleCtx.fillStyle = '#8080ff';
        progressCircleCtx.lineCap = 'round';
        progressCircleCtx.lineWidth = 2 * scaleFactor;
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
     * Converts a latitude and longitude to pixel xy-coordinates.
     * @param {{lat: number, lng: number}} latLng
     * @returns {{x: number, y: number}}
     */
    function latLngToPixel(latLng) {
        const projection = svl.minimap.getMap().getProjection();
        const bounds = svl.minimap.getMap().getBounds();
        const topRight = projection.fromLatLngToPoint(bounds.getNorthEast());
        const bottomLeft = projection.fromLatLngToPoint(bounds.getSouthWest());
        const scale = Math.pow(2, svl.minimap.getMap().getZoom());
        const worldPoint = projection.fromLatLngToPoint(latLng);
        return {
            x: Math.floor((worldPoint.x - bottomLeft.x) * scale),
            y: Math.floor((worldPoint.y - topRight.y) * scale)
        };
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
            fogOfWarCtx.arc(center.x, center.y, baseRadius * scaleFactor,
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
        fovCtx.arc(width / 2, height / 2, baseRadius * scaleFactor, toRadians(leftAngle - 90), toRadians(rightAngle - 90));
        fovCtx.fill();
    }

    /**
     * Renders the user's percentage of 360 degrees observed progress bar. Gray until 100%, then switches to green.
     */
    function renderProgressCircle() {
        progressCircleCtx.clearRect(0, 0, width, height);
        progressCircleCtx.strokeStyle = fractionObserved === 1 ? '#00dd00' : '#404040';
        progressCircleCtx.beginPath();
        progressCircleCtx.arc(width - 20 * scaleFactor, 20 * scaleFactor, 16 * scaleFactor,
            toRadians(-90), toRadians(fractionObserved * 360 - 90));
        progressCircleCtx.stroke();
    }

    this.getFractionObserved = () => {
        return fractionObserved;
    }

    /**
     * Updates everything relevant to the user's observed area.
     */
    this.update = function() {
        if (observedAreas.length > 0) {
            syncCanvasSize();
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
