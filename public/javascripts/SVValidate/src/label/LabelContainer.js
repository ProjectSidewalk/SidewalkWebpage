/**
 * Keeps track of labels that have appeared on the panorama
 * @returns {LabelContainer}
 * @constructor
 */
function LabelContainer() {
    let self = this;
    let currentLabels = [];
    let previousLabels = [];

    /**
     * Gets a list of current labels that have not been sent to the backend yet.
     * @returns {Array}
     */
    function getCurrentLabels() {
        return currentLabels;
    }

    /**
     * Pushes a label to the list of current labels.
     * @param labelId           Integer label ID
     * @param labelMetadata     Label metadata (validationProperties object)
     */
    function push(labelId, labelMetadata) {
        let data = {
            canvas_height: svv.canvasHeight,
            canvas_width: svv.canvasWidth,
            canvas_x: labelMetadata.canvasX,
            canvas_y: labelMetadata.canvasY,
            end_timestamp: labelMetadata.endTimestamp,
            heading: labelMetadata.heading,
            label_id: labelId,
            mission_id: svv.missionContainer.getCurrentMission().getProperty("missionId"),
            pitch: labelMetadata.pitch,
            start_timestamp: labelMetadata.startTimestamp,
            validation_result: labelMetadata.validationResult,
            zoom: labelMetadata.zoom,
            source: labelMetadata.isMobile ? "ValidateMobile" : "ValidateDesktop",
        };
        currentLabels.push(data);
        svv.panorama.setLastLabel(data);
    }

    /**
     * Pushes a label object directly (for undo purposes) to the list of current labels.
     * @param data     The completed label object ready to be pushed to the list of labels.
     */
    function pushUndoValidation(data) {
        var validation = {...data}
        validation.undone = true;
        currentLabels.push(validation);
    }

    /**
     * Takes the last label out of the list of labels that have not been submitted to the backend.
     */
    function pop() {
        currentLabels.pop();
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
    self.pushUndoValidation = pushUndoValidation;
    self.pop = pop;
    self.refresh = refresh;

    return this;
}
