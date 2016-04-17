/**
 * Neighborhood module.
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Neighborhood (parameters) {
    var self = { className: "Neighborhood"},
        properties = {
            regionId: null
        };

    /** Initialize */
    function _init (parameters) {
        if ('regionId' in parameters) setProperty("regionId", parameters.regionId)
    }

    /** Get property */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /** Set property */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    _init(parameters);

    self.getProperty = getProperty;
    self.setProperty = setProperty;
    return self;
}