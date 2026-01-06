/**
 * An object that contains all the information to render a label onto a pano. Used in the PanoManager.renderLabel().
 *
 * @param {string} labelId The ID of the label.
 * @param {string} labelType The type of the label.
 * @param {number} canvasX The X position of the label on the canvas.
 * @param {number} canvasY The Y position of the label on the canvas.
 * @param {number} originalCanvasWidth The width of the canvas when the label was added.
 * @param {number} originalCanvasHeight The height of the canvas when the label was added.
 * @param {{heading: number, pitch: number, zoom: number}} pov The pov of the pano when the label was added in Explore
 * @returns {ExpandedLabel}
 * @constructor
 */
 function ExpandedLabel(labelId, labelType, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight, pov) {
    let self = { className: 'ExpandedLabel' };

    /**
     * Initializes the instance variables to the values provided in the constructor.
     */
    function _init () {
        self.labelId = labelId;
        self.label_type = labelType;
        self.canvasX = canvasX;
        self.canvasY = canvasY;
        self.originalCanvasWidth = originalCanvasWidth;
        self.originalCanvasHeight = originalCanvasHeight;
        self.pov = pov;
    }

    _init();

    return self;
}
