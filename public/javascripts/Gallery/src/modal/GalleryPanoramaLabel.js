/**
 *
 * An object that contains all of the information to render a label onto a GSVPanorama.
 * Used in the GalleryPanorama.renderLabel() method.
 * 
 * @param {String} labelId The ID of the label.
 * @param {String} labelType The type of the label.
 * @param {Number} canvasX The X position of the label on the canvas.
 * @param {Number} canvasY The Y position of the label on the canvas.
 * @param {Number} originalCanvasWidth The width of the canvas when the label was added.
 * @param {Number} originalCanvasHeight The height of the canvas when the label was added.
 * @param {Number} heading The heading of the GSV pano when the label was added in audit.
 * @param {Number} pitch The pitch of the GSV pano when the label was added in audit.
 * @param {Number} zoom The zoom of the GSV pano when the label was added in audit.
 * @returns {GalleryPanoramaLabel}
 * @constructor
 */
 function GalleryPanoramaLabel(labelId, labelType, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight,
    heading, pitch, zoom) {
    let self = { className: "GalleryPanoramaLabel" };

    /**
     * Initializes the instance variables to the values provided in the constructor
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
    }

    _init();

    return self;
}
