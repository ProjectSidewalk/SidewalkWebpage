/**
 * Function that keeps track of labels that have appeared on the panorama
 * @returns {LabelContainer}
 * @constructor
 */
function LabelContainer() {
    var self = this;
    var currentLabels = [];
    var previousLabels = [];

    /**
     * Gets a list of current labels that have not been sent to the backend yet.
     * @returns {Array}
     */
    function getCurrentLabels() {
        return currentLabels;
    }

    /**
     * Pushes a label to the list of current labels.
     * @param labelMetadata     Label metadata (validationProperties object)
     */
    function push(labelMetadata) {
        console.log("[LabelContainer.js] Pushing validation label data");
        var data = {
            canvas_height: svv.canvasHeight,
            canvas_width: svv.canvasWidth,
            canvas_x: labelMetadata.canvasX,
            canvas_y: labelMetadata.canvasY,
            end_timestamp: labelMetadata.endTimestamp,
            heading: labelMetadata.heading,
            label_id: labelMetadata.labelId,
            mission_id: svv.missionContainer.getCurrentMission().getProperty("missionId"),
            pitch: labelMetadata.pitch,
            start_timestamp: labelMetadata.startTimestamp,
            validation_result: labelMetadata.validationResult,
            zoom: labelMetadata.zoom
        };
        console.log(data);
        currentLabels.push(data);
    }

    /**
     * Moves the currentLabels to previousLabels and clears the currentLabels array.
     */
    function refresh() {
        previousLabels.concat(currentLabels);
        currentLabels = [];
    }

    self.getCurrentLabels = getCurrentLabels;
    self.push = push;
    self.refresh = refresh;

    return this;
}