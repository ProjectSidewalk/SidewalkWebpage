/**
 * Represents a single validation mission
 * @param params  Mission metadata passed in from MissionContainer.js
 * @returns {Mission} object.
 * @constructor
 */
function Mission(params) {
    const self = this;
    let properties = {
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
     * Initializes a front-end mission object from metadata.
     */
    function _init() {
        if ("agreeCount" in params) setProperty("agreeCount", params.agreeCount);
        if ("disagreeCount" in params) setProperty("disagreeCount", params.disagreeCount);
        if ("missionId" in params) setProperty("missionId", params.missionId);
        if ("missionType" in params) setProperty("missionType", params.missionType);
        if ("regionId" in params) setProperty("regionId", params.regionId);
        if ("completed" in params) setProperty("completed", params.completed);
        if ("labelsProgress" in params) setProperty("labelsProgress", params.labelsProgress);
        if ("labelsValidated" in params) setProperty("labelsValidated", params.labelsValidated);
        if ("labelTypeId" in params) setProperty("labelTypeId", params.labelTypeId);
        if ("unsureCount" in params) setProperty("unsureCount", params.unsureCount);
        if ("skipped" in params) setProperty("skipped", params.skipped);
    }

    /**
     * Gets a single property for this mission object.
     * @param key   String representation of property.
     * @returns     Property if it exists, null otherwise.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Returns all properties associated with this mission.
     * @returns Object for properties.
     */
    function getProperties() {
        return properties;
    }

    /**
     * Function that checks if the current mission is complete.
     * @returns {property} True if this mission is complete, false if in progress.
     */
    function isComplete() {
        return getProperty("completed");
    }

    /**
     * Sets a property of this mission.
     * @param key       Name of property.
     * @param value     Value.
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Updates status bar (UI) and current mission properties.
     * @param undo (bool) - If true, the user clicked the undo button, so we are progressing backwards.
     */
    function updateMissionProgress(undo) {
        let labelsProgress = getProperty("labelsProgress");
        if (labelsProgress < getProperty("labelsValidated")) {
            if (undo) {
                labelsProgress -= 1;
                const priorLabelFormData = svv.labelContainer.getPriorLabelFormData();
                updateValidationResult(priorLabelFormData.validation_result, true);
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

            setProperty("labelsProgress", labelsProgress);
            // Submit mission if mission is complete.
            if (labelsProgress >= getProperty("labelsValidated")) {
                setProperty("completed", true);
                svv.missionContainer.completeAMission();
                svv.undoValidation.disableUndo();
            }
        }

        // Update progress bar.
        let labelsInMission = getProperty("labelsValidated");
        svv.statusField.setProgressBar(labelsProgress, labelsInMission);
        svv.statusField.setProgressText(labelsProgress, labelsInMission);
    }

    /**
     * Updates the validation result for this mission by incrementing agree, disagree and unsure
     * counts collected in this mission. (Only persists for current session)
     * @param result Validation result - Can either be 'Agree', 'Disagree', or 'Unsure'.
     * @param removeValidation (bool)  - Whether user clicked "undo", meaning we would decrement the count.
     */
    function updateValidationResult(result, removeValidation) {
        const change = removeValidation ? -1 : 1;
        switch (result) {
            case 'Agree':
                setProperty("agreeCount", getProperty("agreeCount") + change);
                break;
            case 'Disagree':
                setProperty("disagreeCount", getProperty("disagreeCount") + change);
                break;
            case 'Unsure':
                setProperty("unsureCount", getProperty("unsureCount") + change);
                break;
        }
    }

    self.isComplete = isComplete;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.updateMissionProgress = updateMissionProgress;
    self.updateValidationResult = updateValidationResult;

    _init();
    return self;
}
