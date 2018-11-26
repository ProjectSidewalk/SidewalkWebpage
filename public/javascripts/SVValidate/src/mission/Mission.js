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
     * Initializes a front-end mission object.
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
     * Gets a property for this mission object
     * @param key   String representation of property
     * @returns     property if it exists, null otherwise
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    function getProperties() {
        return properties;
    }

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
     * Updates mission progress for this mission.
     */
    function updateMissionProgress() {
        var labelsProgress = getProperty("labelsProgress");
        // TODO: update progress bar
        if (labelsProgress >= getProperty("labelsValidated")) {
            setProperty("isComplete", true);
        } else {
            labelsProgress += 1;
        }
        svv.statusField.updateLabelCounts(labelsProgress);
        console.log("Validated: " + labelsProgress + ", total: " + getProperty("labelsValidated"));
        setProperty("labelsProgress", labelsProgress);
    }

    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.updateMissionProgress = updateMissionProgress;

    _init();
    return self;
}