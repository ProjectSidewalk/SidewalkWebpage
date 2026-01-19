/**
 * An object that contains all the information to render a label onto a pano. Used in the PanoManager.renderLabel().
 *
 * @param {string} labelId The ID of the label.
 * @param {string} labelType The type of the label.
 * @param {number} canvasX The X position of the label on the canvas.
 * @param {number} canvasY The Y position of the label on the canvas.
 * @param {number} ogCanvasWidth The width of the canvas when the label was added.
 * @param {number} ogCanvasHeight The height of the canvas when the label was added.
 * @param {{heading: number, pitch: number, zoom: number}} pov The pov of the pano when the label was added in Explore.
 * @param {Boolean} aiGenerated Whether the label was created by AI.
 * @returns {ExpandedLabel}
 * @constructor
 */
 function ExpandedLabel(labelId, labelType, canvasX, canvasY, ogCanvasWidth, ogCanvasHeight, pov, aiGenerated) {
    let self = { className: 'ExpandedLabel' };

    /**
     * Initializes the instance variables to the values provided in the constructor.
     */
    function _init () {
        self.labelId = labelId;
        self.label_type = labelType;
        self.canvasX = canvasX;
        self.canvasY = canvasY;
        self.originalCanvasWidth = ogCanvasWidth;
        self.originalCanvasHeight = ogCanvasHeight;
        self.pov = pov;
        self.aiGenerated = aiGenerated;
    }

    _init();

    return self;
}
