/**
 *
 * @param labelId
 * @param labelType
 * @param canvasX
 * @param canvasY
 * @param originalCanvasWidth
 * @param originalCanvasHeight
 * @param heading
 * @param pitch
 * @param zoom
 * @param streetEdgeId
 * @param lat
 * @param lng
 * @param panoId
 * @returns {{className: string}}
 * @constructor
 */
function AdminPanoramaLabel(labelId, labelType, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight,
                            heading, pitch, zoom, streetEdgeId, lat, lng, panoId) {
    var self = { className: "AdminPanoramaLabel" };

    /**
     * This function initializes the Panorama
     */
    function _init () {
        self.labelId = labelId;
        self.label_type = labelType;
        self.canvasX = canvasX;
        self.canvasY = canvasY;
        self.originalCanvasWidth = originalCanvasWidth;
        self.originalCanvasHeight = originalCanvasHeight;
        self.heading = heading;
        self.pitch = pitch;
        self.zoom = zoom;
        self.streetEdgeId = streetEdgeId;
        self.lat = lat;
        self.lng = lng;
        self.panoId = panoId;
        return this;
    }

    //init
    _init();

    return self;
}