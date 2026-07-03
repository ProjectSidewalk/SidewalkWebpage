/**
 * Keeps track of labels that have appeared on the panorama.
 *
 * Construct instances via the `static async create()` factory, which renders the first label before resolving.
 */
class LabelContainer {
    // These three are set in resetLabelList.
    #labels;  // All labels in the mission.
    #currLabelIndex;
    #currLabel;

    #labelsToSubmit = [];
    #submittedLabels = [];
    #lastLabelFormData; // Holds prior label's metadata formatted for submission, making it easier to submit an undo.

    #properties = {
        validationTimestamp: new Date(),
    };

    #labelsUpdateCallback = () => {};

    /**
     * @param {Array} labelList Initial list of labels to be validated (generated when the page is loaded).
     */
    constructor(labelList) {
        this.resetLabelList(labelList);
    }

    /**
     * Creates a LabelContainer and renders its first label.
     * @param {Array} labelList Initial list of labels to be validated.
     * @returns {Promise<LabelContainer>}
     */
    static async create(labelList) {
        const labelContainer = new LabelContainer(labelList);
        await labelContainer.renderCurrentLabel();
        return labelContainer;
    }

    /**
     * Gets a specific property from the LabelContainer.
     * @param {string} key Property name.
     * @returns Value associated with this property or null.
     */
    getProperty(key) {
        return key in this.#properties ? this.#properties[key] : null;
    }

    /**
     * Sets a property for the LabelContainer.
     * @param {string} key Name of property.
     * @param value Value of property.
     * @returns {LabelContainer}
     */
    setProperty(key, value) {
        this.#properties[key] = value;
        return this;
    }

    /**
     * Returns the last validated label's form data for submission to the back end, useful for undoing a label.
     * @returns Form data for last validated label from this mission.
     */
    getPriorLabelFormData() {
        return this.#lastLabelFormData;
    }

    /**
     * Returns the Label object for the current label.
     * @returns {Label}
     */
    getCurrentLabel() {
        return this.#currLabel;
    }

    /**
     * Goes back to the last label.
     */
    async undoLabel() {
        this.#lastLabelFormData = undefined;
        this.#currLabelIndex -= 1;
        this.#currLabel = this.#labels[this.#currLabelIndex];
        await this.renderCurrentLabel();
    }

    /**
     * Moves to the next label in the list. If there are no more labels, shows the mission complete modal.
     * @returns {Promise<void>}
     */
    async moveToNextLabel() {
        this.#currLabelIndex += 1;
        this.#currLabel = this.#labels[this.#currLabelIndex];
        if (this.#currLabel === undefined) {
            svv.modalNoNewMission.show();
        } else {
            await this.renderCurrentLabel();
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
    async renderCurrentLabel() {
        // Prevent UI interaction and show that we're working on loading the next label.
        svv.ui.validationMenu.holder.addClass('validate-disabled');
        svv.ui.viewer.holder.addClass('validate-disabled');
        svv.ui.holder.css('cursor', 'wait');
        if (svv.keyboard) svv.keyboard.disableKeyboard();

        // Render the new pano and the label on it, updating the surrounding UI given the new label's info.
        this.#currLabel.setProperty('startTimestamp', new Date());
        if (this.#currLabelIndex > 0) { svv.undoValidation.enableUndo(); }
        await svv.panoManager.setPanorama(this.#currLabel.getAuditProperty('panoId'), this.#currLabel.getAuditProperty('backupImage'));
        svv.labelDescriptionBox.setDescription(this.#currLabel);
        svv.validationMenu.resetMenu(this.#currLabel);
        if (svv.adminVersion) svv.adminInfo.updateAdminInfo(this.#currLabel);
        svv.panoManager.renderPanoMarker(this.#currLabel);

        // Re-enable UI interaction now that everything has loaded. Also need to invalidate the cached cursor so that it
        // will reset, which is why we attach a timestamp to it below.
        svv.ui.validationMenu.holder.removeClass('validate-disabled');
        svv.ui.viewer.holder.removeClass('validate-disabled');
        svv.ui.holder.css('cursor', '');
        svv.ui.viewer.controlLayer.css('cursor', 'url(/assets/images/icons/openhand.cur?' + Date.now() + ') 4 4, move');
        if (svv.keyboard) svv.keyboard.enableKeyboard();

    }

    /**
     * Creates a list of label objects to be validated from label metadata. Called when a new mission is loaded.
     * @param {Array} labelList List of label metadata objects.
     */
    resetLabelList(labelList) {
        this.#labels = labelList.map(key => new Label(key));
        this.#currLabelIndex = 0;
        this.#currLabel = this.#labels[this.#currLabelIndex];
        this.#labelsUpdateCallback();
    }

    /**
     * Sets the callback that will be called after resetLabelList is called. Used by SpeedLimit.js.
     * @param {function} callback The function that will be called.
     */
    resetLabelListUpdateCallback(callback) {
        this.#labelsUpdateCallback = callback;
    }

    /**
     * Returns a list of labels for the current mission.
     */
    getLabels() {
        return this.#labels;
    }

    /**
     * Validates the current label.
     */
    validateCurrentLabel(action, timestamp, comment) {
        this.#currLabel.validate(action, comment);
        this.setProperty('validationTimestamp', timestamp);
    }

    /**
     * Gets a list of current labels that have not been sent to the backend yet.
     * @returns {Array}
     */
    getLabelsToSubmit() {
        return this.#labelsToSubmit;
    }

    /**
     * Pushes label metadata to the list of labels that need to be submitted to the backend.
     * @param {number} labelId Integer label ID.
     * @param {object} labelMetadata Label metadata (validationProperties object).
     * @param {object} commentData Comment data (commentProperties object).
     */
    pushToLabelsToSubmit(labelId, labelMetadata, commentData) {
        // If the most recent label is the same as current (meaning it was an undo), remove the undo and use this one.
        const mostRecentLabel = this.#labelsToSubmit[this.#labelsToSubmit.length - 1];
        let redone = false;
        if (mostRecentLabel && mostRecentLabel.label_id === labelId) {
            this.#labelsToSubmit.pop();
            redone = true;
        }

        const data = {
            canvas_height: svv.canvasHeight(),
            canvas_width: svv.canvasWidth(),
            canvas_x: labelMetadata.canvasX,
            canvas_y: labelMetadata.canvasY,
            end_timestamp: labelMetadata.endTimestamp,
            heading: labelMetadata.heading,
            label_id: labelId,
            mission_id: svv.missionContainer.getCurrentMission().getProperty('missionId'),
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
            redone: redone,
            viewer_type: svv.panoManager.getActiveViewerName()
        };
        this.#labelsToSubmit.push(data);
        this.#lastLabelFormData = data;
    }

    /**
     * Pushes a label object directly (for undo purposes) to the list of current labels.
     * @param {object} validation The completed label validation object ready to be pushed to the list of labels.
     */
    pushUndoValidation(validation) {
        validation.undone = true;
        validation.redone = false;
        this.#labelsToSubmit.push(validation);
    }

    /**
     * Takes the last label out of the list of labels that have not been submitted to the backend.
     */
    pop() {
        this.#labelsToSubmit.pop();
    }

    /**
     * Moves the labelsToSubmit to submittedLabels and clears the labelsToSubmit array.
     */
    refresh() {
        this.#submittedLabels.concat(this.#labelsToSubmit);
        this.#labelsToSubmit = [];
    }
}
