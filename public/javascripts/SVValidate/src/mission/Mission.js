/**
 * Represents a single validation mission
 * @param params  Mission metadata passed in from MissionModel.js
 * @returns {Mission} object
 * @constructor
 */
function Mission(params) {
    var self = this;
    var properties = {
        missionId: null,
        missionType: null,
        isComplete: false,
        pay: null,
        paid: null,
        validation: null,
        validationProgress: null,
        skipped: false
    };

    /**
     * Initializes a front-end mission object
     */
    function _init() {
        if ("missionId" in params) {
            console.log("exists");
        } else {
            console.log("doesn't exist");
        }

        if ("missionId" in params) setProperty("missionId", params.missionId);
        if ("missionType" in params) setProperty("missionType", params.missionType);
        if ("regionId" in params) setProperty("regionId", params.regionId);
        if ("isComplete" in params) setProperty("isComplete", params.isComplete);
        if ("pay" in params) setProperty("pay", params.pay);
        if ("paid" in params) setProperty("paid", params.paid);
        if ("validation" in params) setProperty("distance", params.labelsValidated);
        if ("validationProgress" in params) setProperty("distanceProgress", params.labelsProgress);
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

    self.getProperty = getProperty;
    self.setProperty = setProperty;

    _init();
    return self;
}