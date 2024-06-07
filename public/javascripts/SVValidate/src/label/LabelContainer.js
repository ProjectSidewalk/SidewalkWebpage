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
        // If the most recent label is the same as current (meaning it was an undo), remove the undo and use this one.
        const mostRecentLabel = currentLabels[currentLabels.length - 1];
        if (mostRecentLabel && mostRecentLabel.label_id === labelId) {
            currentLabels.pop();
        }

        // TODO remove this extra bit of logic once we fully switch to a 3-point scale.
        // With the new Validate page, we are showing the severity on a 3-point scale instead of 5-point. This makes it
        // so that newSeverity is always 1, 2, or 3. We should keep newSeverity equal to oldSeverity unless the
        // validator actually changed it. If they did not, keep the original unchanged. If they did, change the
        // newSeverity to 1/3/5 instead of 1/2/3.
        let newSev = labelMetadata.oldSeverityCollapsed === labelMetadata.newSeverity ? labelMetadata.oldSeverity : labelMetadata.newSeverity * 2 - 1;

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
            old_severity: labelMetadata.oldSeverity,
            new_severity: newSev,
            old_tags: labelMetadata.oldTags,
            new_tags: labelMetadata.newTags,
            zoom: labelMetadata.zoom,
            source: labelMetadata.isMobile ? "ValidateMobile" : "ValidateDesktop",
        };
        currentLabels.push(data);
        svv.panorama.setLastLabel(data);
    }

    /**
     * Pushes a label object directly (for undo purposes) to the list of current labels.
     * @param validation  The completed label validation object ready to be pushed to the list of labels.
     */
    function pushUndoValidation(validation) {
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
