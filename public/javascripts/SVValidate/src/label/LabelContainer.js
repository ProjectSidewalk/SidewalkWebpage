/**
 * Keeps track of labels that have appeared on the panorama
 * @param labelList     Initial list of labels to be validated (generated when the page is loaded).
 * @returns {LabelContainer}
 * @constructor
 */
async function LabelContainer(labelList) {
    const self = this;

    // These three are set in resetLabelList.
    let labels;  // All labels in the mission.
    let currLabelIndex;
    let currLabel;

    let labelsToSubmit = [];
    let submittedLabels = [];
    let lastLabelFormData; // Holds prior label's metadata formatted for submission, making it easier to submit an undo.

    let properties = {
        validationTimestamp: new Date(),
    };

    let labelsUpdateCallback = () => {};

    /**
     * Initializes the LabelContainer and renders the first label.
     * @returns {Promise<void>}
     * @private
     */
    async function _init() {
        resetLabelList(labelList);
        await renderCurrentLabel();
    }

    /**
     * Gets a specific property from the LabelContainer.
     * @param key   Property name.
     * @returns     Value associated with this property or null.
     */
    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Sets a property for the LabelContainer.
     * @param key   Name of property
     * @param value Value of property.
     * @returns {setProperty}
     */
    function setProperty(key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Returns the last validated label's form data for submission to the back end, useful for undoing a label.
     * @returns     Form data for last validated label from this mission.
     */
    function getPriorLabelFormData() {
        return lastLabelFormData;
    }

    /**
     * Returns the Label object for the current label.
     * @returns {Label}
     */
    function getCurrentLabel() {
        return currLabel;
    }

    /**
     * Goes back to the last label.
     */
    async function undoLabel() {
        lastLabelFormData = undefined;
        currLabelIndex -= 1;
        currLabel = labels[currLabelIndex];
        await renderCurrentLabel();
    }

    /**
     * Skips the current label and fetches a new label for validation.
     */
    async function skipLabel() {
        labels[currLabelIndex] = await _fetchNewLabel(currLabel.getAuditProperty('labelId'));
        currLabel = labels[currLabelIndex];
        svv.missionContainer.updateAMissionSkip();
        await renderCurrentLabel();
    }

    /**
     * Moves to the next label in the list. If there are no more labels, shows the mission complete modal.
     * @returns {Promise<void>}
     */
    async function moveToNextLabel() {
        currLabelIndex += 1;
        currLabel = labels[currLabelIndex];
        if (currLabel === undefined) {
            svv.modalNoNewMission.show();
        } else {
            await renderCurrentLabel(currLabel);
            if (svv.labelVisibilityControl && !svv.labelVisibilityControl.isVisible()) {
                svv.labelVisibilityControl.unhideLabel();
            }

            // Update zoom availability on desktop.
            if (svv.zoomControl) {
                svv.zoomControl.updateZoomAvailability();
            }
        }
    }

    /**
     * Renders the current label on the pano, updating the UI accordingly.
     */
    async function renderCurrentLabel() {
        currLabel.setProperty('startTimestamp', new Date());
        if (currLabelIndex > 0) { svv.undoValidation.enableUndo(); }
        await svv.panoManager.setPanorama(currLabel.getAuditProperty('panoId'));
        svv.labelDescriptionBox.setDescription(currLabel);
        if (svv.expertValidate) svv.rightMenu.resetMenu(currLabel);
        if (svv.adminVersion) svv.statusField.updateAdminInfo(currLabel);
        svv.panoManager.renderPanoMarker(currLabel);
    }

    /**
     * Fetches a single label from the database to replace a skipped label.
     * @param skippedLabelId the ID of the label that we are skipping
     * @returns {Promise<Label|undefined>} A Promise that resolves to a Label object or undefined if there was an error.
     * @private
     */
    async function _fetchNewLabel(skippedLabelId) {
        let labelTypeId = svv.missionContainer.getCurrentMission().getProperty('labelTypeId');
        let labelUrl = '/label/geo/random/' + labelTypeId + '/' + skippedLabelId;

        let data = {};
        data.labels = getLabelsToSubmit();
        data.validate_params = {
            admin_version: svv.adminVersion,
            label_type: svv.validateParams.labelTypeId,
            user_ids: svv.validateParams.userIds,
            neighborhood_ids: svv.validateParams.regionIds,
            unvalidated_only: svv.validateParams.unvalidatedOnly
        };

        return fetch(labelUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(data)
        })
            .then((response) => response.json())
            .then(labelMetadata => new Label(labelMetadata.label))
            .catch(error => {
                console.error('Error fetching new label: ' + error);
                return undefined;
            });
    }

    /**
     * Creates a list of label objects to be validated from label metadata. Called when a new mission is loaded.
     * @param labelList  List of label metadata objects.
     */
    function resetLabelList(labelList) {
        labels = labelList.map(function(key, index) { return new Label(key); });
        currLabelIndex = 0;
        currLabel = labels[currLabelIndex];
        labelsUpdateCallback();
    }

    /**
     * Sets the callback that will be called after resetLabelList is called. Used by SpeedLimit.js.
     * @param callback The function that will be called.
     */
    function resetLabelListUpdateCallback(callback) {
        labelsUpdateCallback = callback;
    }

    /**
     * Returns a list of labels for the current mission.
     */
    function getLabels() {
        return labels;
    }

    /**
     * Validates the current label.
     */
    function validateCurrentLabel(action, timestamp, comment) {
        currLabel.validate(action, comment);
        setProperty('validationTimestamp', timestamp);
    }

    /**
     * Gets a list of current labels that have not been sent to the backend yet.
     * @returns {Array}
     */
    function getLabelsToSubmit() {
        return labelsToSubmit;
    }

    /**
     * Pushes label metadata to the list of labels that need to be submitted to the backend.
     * @param labelId           Integer label ID
     * @param labelMetadata     Label metadata (validationProperties object)
     * @param commentData       Comment data (commentProperties object)
     */
    function pushToLabelsToSubmit(labelId, labelMetadata, commentData) {
        // If the most recent label is the same as current (meaning it was an undo), remove the undo and use this one.
        const mostRecentLabel = labelsToSubmit[labelsToSubmit.length - 1];
        let redone = false;
        if (mostRecentLabel && mostRecentLabel.label_id === labelId) {
            labelsToSubmit.pop();
            redone = true;
        }

        let data = {
            canvas_height: svv.canvasHeight(),
            canvas_width: svv.canvasWidth(),
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
            new_severity: labelMetadata.newSeverity,
            old_tags: labelMetadata.oldTags,
            new_tags: labelMetadata.newTags,
            comment: commentData,
            zoom: labelMetadata.zoom,
            source: svv.form.getSource(),
            undone: false,
            redone: redone
        };
        labelsToSubmit.push(data);
        lastLabelFormData = data;
    }

    /**
     * Pushes a label object directly (for undo purposes) to the list of current labels.
     * @param validation  The completed label validation object ready to be pushed to the list of labels.
     */
    function pushUndoValidation(validation) {
        validation.undone = true;
        validation.redone = false;
        labelsToSubmit.push(validation);
    }

    /**
     * Takes the last label out of the list of labels that have not been submitted to the backend.
     */
    function pop() {
        labelsToSubmit.pop();
    }

    /**
     * Moves the labelsToSubmit to submittedLabels and clears the labelsToSubmit array.
     */
    function refresh() {
        submittedLabels.concat(labelsToSubmit);
        labelsToSubmit = [];
    }

    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.moveToNextLabel = moveToNextLabel;
    self.resetLabelList = resetLabelList;
    self.resetLabelListUpdateCallback = resetLabelListUpdateCallback;
    self.getLabels = getLabels;
    self.validateCurrentLabel = validateCurrentLabel;
    self.getCurrentLabel = getCurrentLabel;
    self.getPriorLabelFormData = getPriorLabelFormData;
    self.renderCurrentLabel = renderCurrentLabel;
    self.skipLabel = skipLabel;
    self.undoLabel = undoLabel;
    self.getLabelsToSubmit = getLabelsToSubmit;
    self.pushToLabelsToSubmit = pushToLabelsToSubmit;
    self.pushUndoValidation = pushUndoValidation;
    self.pop = pop;
    self.refresh = refresh;

    await _init();

    return this;
}
