/**
 * Represents a single validation mission
 * @param params  Mission metadata passed in from MissionContainer.js
 * @returns {Mission} object.
 * @constructor
 */
function Mission(params) {
    let self = this;
    let properties = {
        agreeCount: 0,
        disagreeCount: 0,
        missionId: undefined,
        missionType: undefined,
        completed: undefined,
        labelsProgress: undefined,
        labelTypeId: undefined,
        labelsValidated: undefined,
        notSureCount: 0,
        pay: undefined,
        paid: undefined,
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
        if ("pay" in params) setProperty("pay", params.pay);
        if ("paid" in params) setProperty("paid", params.paid);
        if ("labelsProgress" in params) setProperty("labelsProgress", params.labelsProgress);
        if ("labelsValidated" in params) setProperty("labelsValidated", params.labelsValidated);
        if ("labelTypeId" in params) setProperty("labelTypeId", params.labelTypeId);
        if ("notSureCount" in params) setProperty("notSureCount", params.notSureCount);
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
     * @param skip (bool) - If true, the user clicked the skip button and the progress will not
     *                      increase. If false the user clicked agree, disagree, or not sure and
     *                      progress will increase.
     * @param undo (bool) - If true, the user clicked the undo button, so we are progressing backwards.
     */
    function updateMissionProgress(skip, undo) {
        let labelsProgress = getProperty("labelsProgress");
        if (labelsProgress < getProperty("labelsValidated")) {
            if (skip) {
                // Do nothing.
            } else {
                if (undo) {
                    labelsProgress -= 1;
                    updateValidationResult(svv.panorama.getLastLabel().validation_result, true);
                    svv.statusField.decrementLabelCounts();
                    // We either have or have not submitted the last label to the backend.
                    if (svv.labelContainer.getCurrentLabels().length > 0) {
                        svv.labelContainer.pop();
                    } else {
                        svv.labelContainer.pushUndoValidation(svv.panorama.getLastLabel());
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
                    svv.modalUndo.disableUndo();
                }
            }
        }

        let completionRate = labelsProgress / getProperty("labelsValidated");
        svv.statusField.setProgressBar(completionRate);
        svv.statusField.setProgressText(completionRate);
    }

    /**
     * Updates the validation result for this mission by incrementing agree, disagree and not sure
     * counts collected in this mission. (Only persists for current session)
     * @param result Validation result - Can either be 1, 2, or 3 for agree, disagree, or not sure.
     * @param removeValidation (bool)  - Whether user clicked "undo", meaning we would decrement the count.
     */
    function updateValidationResult(result, removeValidation) {
        const change = removeValidation ? -1 : 1;
        switch (result) {
            case 1:
                setProperty("agreeCount", getProperty("agreeCount") + change);
                break;
            case 2:
                setProperty("disagreeCount", getProperty("disagreeCount") + change);
                break;
            case 3:
                setProperty("notSureCount", getProperty("notSureCount") + change);
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
