/**
 * Tracks and renders the user's observed area on the minimap: the fog of war, the current field-of-view cone, and the
 * 360°-observed progress circle.
 */
class ObservedArea {

    static #BASE_RADIUS = 40;  // FOV radius in pixels at UI scale 1 and REFERENCE_ZOOM.

    // Zoom the minimap was tuned at; BASE_RADIUS is correct here. As the user zooms the minimap, the observed-area
    // radius is scaled by 2^(zoom - REFERENCE_ZOOM) so the fog/FOV keep covering the same geographic area. Must match
    // Minimap's default zoom.
    static #REFERENCE_ZOOM = 18;

    #uiMinimap;

    #angle = null;            // User's angle.
    #leftAngle = null;        // Left-most angle of the user's FOV.
    #rightAngle = null;       // Right-most angle of the user's FOV.
    #observedAreas = [];     // List of observed areas (panoId, latLng, minAngle, maxAngle).
    #currArea = {};             // Current observed area (panoId, latLng, minAngle, maxAngle).
    #fractionObserved = 0; // User's current fraction of 360 degrees observed.

    // Minimap size (px) at UI scale 1, read from the base dimension defined in svl-minimap.css.
    #baseSize;

    // The canvas bitmaps are kept in sync with the displayed minimap size (which scales with the UI). This is required
    // because the fog is positioned via the map's projection, which returns coordinates in displayed pixels; if the
    // bitmap didn't match, the fog would be offset (e.g. drawn at displayed/2 inside a smaller bitmap).
    #width = 0;          // Canvas bitmap width (set by #syncCanvasSize).
    #height = 0;         // Canvas bitmap height.
    #scaleFactor = 1;    // width / baseSize; scales the FOV/progress geometry to match the minimap.

    // Canvas contexts for the various components of the fog of war view on the mini map.
    #fogOfWarCtx;
    #fovCtx;
    #progressCircleCtx;

    /**
     * @param {Object} uiMinimap - The svl.ui.minimap object holding the minimap's jQuery DOM elements.
     */
    constructor(uiMinimap) {
        this.#uiMinimap = uiMinimap;
        this.#baseSize = parseFloat(getComputedStyle(uiMinimap.holder[0]).getPropertyValue('--minimap-base-size'));
        this.#fogOfWarCtx = uiMinimap.fogOfWar[0].getContext('2d');
        this.#fovCtx = uiMinimap.fov[0].getContext('2d');
        this.#progressCircleCtx = uiMinimap.progressCircle[0].getContext('2d');
        this.#syncCanvasSize();
    }

    /**
     * Sizes the three minimap canvases' bitmaps to the current displayed minimap size and (re)applies the persistent
     * context state. Setting canvas.width/height resets the context, so the styles must be applied here, after sizing.
     */
    #syncCanvasSize() {
        const uiMinimap = this.#uiMinimap;
        const displayedWidth = Math.round(uiMinimap.fogOfWar.width()) || this.#baseSize;
        const displayedHeight = Math.round(uiMinimap.fogOfWar.height()) || this.#baseSize;
        if (displayedWidth !== this.#width || displayedHeight !== this.#height) {
            this.#width = displayedWidth;
            this.#height = displayedHeight;
            this.#scaleFactor = this.#width / this.#baseSize;
            for (const canvas of [uiMinimap.fogOfWar[0], uiMinimap.fov[0], uiMinimap.progressCircle[0]]) {
                canvas.width = this.#width;
                canvas.height = this.#height;
            }
        }
        // Set up ctx state that doesn't change between renders (and is reset by any resize above).
        uiMinimap.percentObserved.css('color', '#404040');
        this.#fogOfWarCtx.fillStyle = '#888888';
        this.#fogOfWarCtx.filter = `blur(${5 * this.#scaleFactor}px)`;
        this.#fovCtx.fillStyle = '#8080ff';
        this.#progressCircleCtx.fillStyle = '#8080ff';
        this.#progressCircleCtx.lineCap = 'round';
        this.#progressCircleCtx.lineWidth = 2 * this.#scaleFactor;
    }

    /**
     * Resets the user's angle and adds user's new pano to 'observedAreas'. Called when the user takes a step.
     */
    panoChanged() {
        this.#angle = null;
        this.#leftAngle = null;
        this.#rightAngle = null;
        const panoId = svl.panoViewer.getPanoId();
        this.#currArea = this.#observedAreas.find(area => area.panoId === panoId);

        if (!this.#currArea) {
            this.#currArea = { panoId: panoId, latLng: svl.panoViewer.getPosition(), minAngle: null, maxAngle: null };
            this.#observedAreas.push(this.#currArea);
        }
    }

    /**
     * Converts degrees to radians.
     * @param {number} degrees
     * @returns {number}
     */
    static #toRadians(degrees) {
        return degrees / 180 * Math.PI;
    }

    /**
     * Updates all the angle variables necessary to keep track of the user's observed area.
     */
    #updateAngles() {
        const pov = svl.panoViewer.getPov();
        let heading = pov.heading;
        const fov = util.pano.zoomToFov(pov.zoom);
        if (this.#angle) {
            if (heading - this.#angle > 180) {
                heading -= 360;
            }
            if (heading - this.#angle < -180) {
                heading += 360;
            }
        }
        this.#angle = heading;
        this.#leftAngle = this.#angle - fov / 2;
        this.#rightAngle = this.#angle + fov / 2;
        if (!this.#currArea.minAngle || this.#leftAngle < this.#currArea.minAngle) {
            this.#currArea.minAngle = this.#leftAngle;
        }
        if (!this.#currArea.maxAngle || this.#rightAngle > this.#currArea.maxAngle) {
            this.#currArea.maxAngle = this.#rightAngle;
        }
        this.#fractionObserved = Math.min(this.#currArea.maxAngle - this.#currArea.minAngle, 360) / 360;
    }

    /**
     * Converts a latitude and longitude to pixel xy-coordinates.
     * @param {{lat: number, lng: number}} latLng
     * @returns {{x: number, y: number}}
     */
    #latLngToPixel(latLng) {
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
     * Returns the FOV/observed-area radius in pixels for the minimap's current zoom. Scales BASE_RADIUS by the UI scale
     * and by the zoom relative to REFERENCE_ZOOM so the fog/FOV cover a constant geographic area as the user zooms.
     * @returns {number}
     */
    #currentRadius() {
        const zoom = svl.minimap.getMap().getZoom();
        return ObservedArea.#BASE_RADIUS * this.#scaleFactor * Math.pow(2, zoom - ObservedArea.#REFERENCE_ZOOM);
    }

    /**
     * Renders the fog of war.
     */
    #renderFogOfWar() {
        const radius = this.#currentRadius();
        this.#fogOfWarCtx.fillRect(0, 0, this.#width, this.#height);
        this.#fogOfWarCtx.globalCompositeOperation = 'destination-out';
        for (const observedArea of this.#observedAreas) {
            const center = this.#latLngToPixel(observedArea.latLng);
            this.#fogOfWarCtx.beginPath();
            if (observedArea.maxAngle - observedArea.minAngle < 360) {
                this.#fogOfWarCtx.moveTo(center.x, center.y);
            }
            this.#fogOfWarCtx.arc(center.x, center.y, radius,
                ObservedArea.#toRadians(observedArea.minAngle - 90), ObservedArea.#toRadians(observedArea.maxAngle - 90));
            this.#fogOfWarCtx.fill();
        }
        this.#fogOfWarCtx.globalCompositeOperation = 'source-over';
    }

    /**
     * Renders the user's FOV.
     */
    #renderFov() {
        this.#fovCtx.clearRect(0, 0, this.#width, this.#height);
        this.#fovCtx.beginPath();
        this.#fovCtx.moveTo(this.#width / 2, this.#height / 2);
        this.#fovCtx.arc(this.#width / 2, this.#height / 2, this.#currentRadius(),
            ObservedArea.#toRadians(this.#leftAngle - 90), ObservedArea.#toRadians(this.#rightAngle - 90));
        this.#fovCtx.fill();
    }

    /**
     * Renders the user's percentage of 360 degrees observed progress bar. Gray until 100%, then switches to green.
     */
    #renderProgressCircle() {
        this.#progressCircleCtx.clearRect(0, 0, this.#width, this.#height);
        this.#progressCircleCtx.strokeStyle = this.#fractionObserved === 1 ? '#00dd00' : '#404040';
        this.#progressCircleCtx.beginPath();
        this.#progressCircleCtx.arc(this.#width - 20 * this.#scaleFactor, 20 * this.#scaleFactor, 16 * this.#scaleFactor,
            ObservedArea.#toRadians(-90), ObservedArea.#toRadians(this.#fractionObserved * 360 - 90));
        this.#progressCircleCtx.stroke();
    }

    /**
     * Returns the user's current fraction of 360 degrees observed.
     * @returns {number}
     */
    getFractionObserved() {
        return this.#fractionObserved;
    }

    /**
     * Updates everything relevant to the user's observed area.
     */
    update() {
        if (this.#observedAreas.length > 0) {
            this.#syncCanvasSize();
            this.#updateAngles();
            this.#renderFogOfWar();
            this.#renderFov();
            this.#renderProgressCircle();
            this.#uiMinimap.percentObserved.text(Math.floor(100 * this.#fractionObserved) + '%');
            if (this.#fractionObserved === 1) {
                this.#uiMinimap.message.text(i18next.t('right-ui.minimap.follow-red-line'));
            } else {
                this.#uiMinimap.message.text(i18next.t('right-ui.minimap.explore-current-location'));
            }
        }
    }
}
