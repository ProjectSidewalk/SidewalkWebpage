/**
 * Represents a single validation mission
 * @param params  Mission metadata passed in from MissionContainer.js
 * @returns {Mission} object
 * @constructor
 */
function Mission(params) {
    var self = this;
    var properties = {
        missionId: undefined,
        missionType: undefined,
        isComplete: undefined,
        labelsProgress: undefined,
        labelsValidated: undefined,
        pay: undefined,
        paid: undefined,
        skipped: undefined
    };

    /**
     * Initializes a front-end mission object from metadata.
     */
    function _init() {
        if ("missionId" in params) setProperty("missionId", params.missionId);
        if ("missionType" in params) setProperty("missionType", params.missionType);
        if ("regionId" in params) setProperty("regionId", params.regionId);
        if ("isComplete" in params) setProperty("isComplete", params.isComplete);
        if ("pay" in params) setProperty("pay", params.pay);
        if ("paid" in params) setProperty("paid", params.paid);
        if ("labelsProgress" in params) setProperty("labelsProgress", params.labelsProgress);
        if ("labelsValidated" in params) setProperty("labelsValidated", params.labelsValidated);
        if ("skipped" in params) setProperty("skipped", params.skipped);
    }

    /**
     * Gets a single property for this mission object.
     * @param key   String representation of property
     * @returns     property if it exists, null otherwise
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
     * @returns {property} True if this mission is complete, false if in progress
     */
    function isComplete() {
        return getProperty("isComplete");
    }

    /**
     * Sets a property of this mission
     * @param key       Name of property
     * @param value     Value
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Updates status bar (UI) and current mission properties.
     */
    function updateMissionProgress() {
        var labelsProgress = getProperty("labelsProgress");
        // TODO: update progress bar
        if (labelsProgress <= getProperty("labelsValidated")) {
            labelsProgress += 1;

            if (labelsProgress == getProperty("labelsValidated")) {
                setProperty("isComplete", true);
                svv.missionContainer.trigger("MissionContainer:completeAMission");
            }
        }
        svv.statusField.updateLabelCounts(labelsProgress);
        console.log("Validated: " + labelsProgress + ", total: " + getProperty("labelsValidated"));
        setProperty("labelsProgress", labelsProgress);
    }

    self.isComplete = isComplete;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.updateMissionProgress = updateMissionProgress;

    _init();
    return self;
}