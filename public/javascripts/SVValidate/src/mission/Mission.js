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
        missionsCompleted: undefined,
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
        if ("missionsCompleted" in params) setProperty("missionsCompleted", params.missionsCompleted);
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
     */
    function updateMissionProgress(skip) {
        console.log(getProperties());
        let labelsProgress = getProperty("labelsProgress");
        let missionsCompleted = getProperty("missionsCompleted")
        if (labelsProgress < getProperty("labelsValidated")) {
            if (!skip) {
                labelsProgress += 1;
            }
            svv.statusField.updateLabelCounts(labelsProgress + 10 * svv.validationMissionsCompleted);
            setProperty("labelsProgress", labelsProgress);

            // Submit mission if mission is complete
            if (labelsProgress >= getProperty("labelsValidated")) {
                setProperty("completed", true);
                svv.missionContainer.completeAMission();
            }
        }

        let completionRate = labelsProgress / getProperty("labelsValidated");
        svv.statusField.setProgressBar(completionRate);
        svv.statusField.setProgressText(completionRate);
    }

    /**
     * Updates the validation result for this mission by incrementing agree, disagree and not sure
     * counts collected in this mission. (Only persists for current session)
     * @param result Validation result - Can either be agree, disagree, or not sure.
     */
    function updateValidationResult(result) {
        switch (result) {
            case 1:
                setProperty("agreeCount", getProperty("agreeCount") + 1);
                break;
            case 2:
                setProperty("disagreeCount", getProperty("disagreeCount") + 1);
                break;
            case 3:
                setProperty("notSureCount", getProperty("notSureCount") + 1);
                break;
        }
    }

    /**
     * Function that returns the appropriate description for the current mission label type.
     * @param result Validation result - Can either be agree, disagree, or not sure.
     */
    function getLabelTypeDescription(labelTypeId) {
        let description = "";
        switch(labelTypeId) {
            //if curb ramp
            case 1:
                description = "A curb ramp is a short ramp that cuts through or builds up to a curb." +
                    " An accessible curb ramp is one that provides an accessible route for people with mobility impairments " +
                    "to safely transition from a curbed sidewalk to a roadway, or vice versa.";
                return description;;
            // if missing curb ramp
            case 2:
                description = "A curb ramp is a short ramp that cuts through or builds up to a curb." +
                    " An accessible curb ramp is one that provides an accessible route for people with mobility impairments " +
                    "to safely transition from a curbed sidewalk to a roadway, or vice versa.";
                return description;;
            //if obstacle
            case 3:
                description = "Obstacles are objects that are directly on the path of a pedestrian route, thus blocking the path. " +
                    "The ADA (Americans with Disabilities Act) requires a \"clear floor or ground space\" along accessible pedestrian " +
                    "routes. This allows pedestrians, especially those using walkers or wheelchairs, to remain safely on the sidewalk or crosswalk. " +
                    "Moving off the path to avoid an obstacle may be impossible or may cause imbalance, tripping, or other hazards.";
                return description;;
            //if surface problem
            case 4:
                description = "A surface problem is a problem that would cause a bumpy or otherwise uncomfortable experience for someone using a " +
                    "wheelchair or other assistive devices. If something on a surface would make it hard or impossible to cross, it should be " +
                    "labeled as a Surface Problem.";
                return description;;
            //if other
            case 5:
                description = "";
                return description;;
            //if occlusion
            case 6:
                description = "Occlusion is when you can't see something at all. In these cases, you should place an Occlusion label. " +
                    "This should rarely be used, so only place the Occlusion label when a sidewalk, ramp, or other accessibility problem " +
                    "cannot be viewed from any angle due to obstructions, such as cars.";
                return description;;
            //if no sidewalk
            case 7:
                description = "A No Sidewalk label should be placed if there is a missing sidewalk where there should be one.";
                return description;;
            //if problem
            case 8:
                description = "";
                return description;;
        }

    }

    self.isComplete = isComplete;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.updateMissionProgress = updateMissionProgress;
    self.updateValidationResult = updateValidationResult;
    self.getLabelTypeDescription = getLabelTypeDescription;

    _init();
    return self;
}
