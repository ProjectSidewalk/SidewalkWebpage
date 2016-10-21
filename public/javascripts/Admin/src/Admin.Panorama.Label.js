/**
 *
 * @param label_type
 * @param canvasX
 * @param canvasY
 * @param originalCanvasX
 * @param originalCanvasY
 * @returns {{className: string}}
 * @constructor
 */
function AdminPanoramaLabel(label_type, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight) {
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
        return this;
    }

    //init
    _init();

    return self;
}