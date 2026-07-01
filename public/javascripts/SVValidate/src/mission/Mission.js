/**
 * Represents a single validation mission.
 */
class Mission {
    #properties = {
        agreeCount: 0,
        disagreeCount: 0,
        missionId: undefined,
        missionType: undefined,
        completed: undefined,
        labelsProgress: undefined,
        labelTypeId: undefined,
        labelsValidated: undefined,
        unsureCount: 0,
        skipped: undefined
    };

    /**
     * @param {object} params Mission metadata passed in from MissionContainer.js.
     */
    constructor(params) {
        this.#init(params);
    }

    /**
     * Initializes a front-end mission object from metadata.
     * @param {object} params Mission metadata.
     */
    #init(params) {
        if ("agreeCount" in params) this.setProperty("agreeCount", params.agreeCount);
        if ("disagreeCount" in params) this.setProperty("disagreeCount", params.disagreeCount);
        if ("missionId" in params) this.setProperty("missionId", params.missionId);
        if ("missionType" in params) this.setProperty("missionType", params.missionType);
        if ("regionId" in params) this.setProperty("regionId", params.regionId);
        if ("completed" in params) this.setProperty("completed", params.completed);
        if ("labelsProgress" in params) this.setProperty("labelsProgress", params.labelsProgress);
        if ("labelsValidated" in params) this.setProperty("labelsValidated", params.labelsValidated);
        if ("labelTypeId" in params) this.setProperty("labelTypeId", params.labelTypeId);
        if ("unsureCount" in params) this.setProperty("unsureCount", params.unsureCount);
        if ("skipped" in params) this.setProperty("skipped", params.skipped);
    }

    /**
     * Gets a single property for this mission object.
     * @param {string} key String representation of property.
     * @returns Property if it exists, null otherwise.
     */
    getProperty(key) {
        return key in this.#properties ? this.#properties[key] : null;
    }

    /**
     * Returns all properties associated with this mission.
     * @returns Object for properties.
     */
    getProperties() {
        return this.#properties;
    }

    /**
     * Function that checks if the current mission is complete.
     * @returns True if this mission is complete, false if in progress.
     */
    isComplete() {
        return this.getProperty("completed");
    }

    /**
     * Sets a property of this mission.
     * @param {string} key Name of property.
     * @param value Value.
     * @returns {Mission}
     */
    setProperty(key, value) {
        this.#properties[key] = value;
        return this;
    }

    /**
     * Updates status bar (UI) and current mission properties.
     * @param {boolean} undo If true, the user clicked the undo button, so we are progressing backwards.
     */
    updateMissionProgress(undo) {
        let labelsProgress = this.getProperty("labelsProgress");
        if (labelsProgress < this.getProperty("labelsValidated")) {
            if (undo) {
                labelsProgress -= 1;
                const priorLabelFormData = svv.labelContainer.getPriorLabelFormData();
                this.updateValidationResult(priorLabelFormData.validation_result, true);
                svv.statusField.decrementLabelCounts();
                // We either have or have not submitted the last label to the backend.
                if (svv.labelContainer.getLabelsToSubmit().length > 0) {
                    svv.labelContainer.pop();
                } else {
                    svv.labelContainer.pushUndoValidation(priorLabelFormData);
                }
            } else {
                labelsProgress += 1;
                svv.statusField.incrementLabelCounts();
            }

            this.setProperty("labelsProgress", labelsProgress);
            // Submit mission if mission is complete.
            if (labelsProgress >= this.getProperty("labelsValidated")) {
                this.setProperty("completed", true);
                svv.missionContainer.completeAMission();
                svv.undoValidation.disableUndo();
            }
        }

        // Update progress bar.
        const labelsInMission = this.getProperty("labelsValidated");
        svv.statusField.setProgressBar(labelsProgress, labelsInMission);
        svv.statusField.setProgressText(labelsProgress, labelsInMission);
    }

    /**
     * Updates the validation result for this mission by incrementing agree, disagree and unsure
     * counts collected in this mission. (Only persists for current session)
     * @param {string} result Validation result - Can either be 'Agree', 'Disagree', or 'Unsure'.
     * @param {boolean} removeValidation Whether user clicked "undo", meaning we would decrement the count.
     */
    updateValidationResult(result, removeValidation) {
        const change = removeValidation ? -1 : 1;
        switch (result) {
            case 'Agree':
                this.setProperty("agreeCount", this.getProperty("agreeCount") + change);
                break;
            case 'Disagree':
                this.setProperty("disagreeCount", this.getProperty("disagreeCount") + change);
                break;
            case 'Unsure':
                this.setProperty("unsureCount", this.getProperty("unsureCount") + change);
                break;
        }
    }
}
