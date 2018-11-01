/**
 *
 * @param label_type
 * @param canvasX
 * @param canvasY
 * @param originalCanvasWidth
 * @param originalCanvasHeight
 * @param heading
 * @param pitch
 * @param zoom
 * @returns {{className: string}}
 * @constructor
 */
function AdminPanoramaLabel(label_type, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight,
                            heading, pitch, zoom) {
    var self = { className: "AdminPanoramaLabel" };

    /**
     * This function initializes the Panorama
     */
    function _init () {
        self.label_type = label_type;
        self.canvasX = canvasX;
        self.canvasY = canvasY;
        self.originalCanvasWidth = originalCanvasWidth;
        self.originalCanvasHeight = originalCanvasHeight;
        self.heading = heading;
        self.pitch = pitch;
        self.zoom = zoom;
        return this;
    }

    //init
    _init();

    return self;
}