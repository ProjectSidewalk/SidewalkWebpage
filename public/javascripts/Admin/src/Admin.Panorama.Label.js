/**
 *
 * @param {number} labelId
 * @param {string} labelType
 * @param {number} canvasX
 * @param {number} canvasY
 * @param {number} originalCanvasWidth
 * @param {number} originalCanvasHeight
 * @param {{heading: number, pitch: number, zoom: number}} pov
 * @param {number} [streetEdgeId]
 * @param {number} [severity]
 * @param {Array[string]} [tags]
 * @param {boolean=false} aiGenerated
 * @returns {{className: string}}
 * @constructor
 */
function AdminPanoramaLabel(labelId, labelType, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight,
                            pov, streetEdgeId, severity, tags, aiGenerated = false) {
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
        self.pov = pov;
        self.streetEdgeId = streetEdgeId;
        self.oldSeverity = severity;
        self.newSeverity = severity;
        self.oldTags = tags;
        self.newTags = tags;
        self.aiGenerated = aiGenerated;
        return this;
    }

    _init();

    return self;
}
