/**
 * Created by manaswi on 5/12/17.
 */

/**
 * Route module.
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Route (parameters) {
    var self = { className: "Route"},
        properties = {
            routeId: null,
            regionId: null,
            lengthMi: null,
            streetCount: null
        };

    /**
     * Initialize
     */
    function _init (parameters) {
        if ('routeId' in parameters) setProperty("routeId", parameters.routeId);
        if ("regionId" in parameters) setProperty("regionId", parameters.regionId);
        if ("lengthMi" in parameters) setProperty("lengthMi", parameters.lengthMi);
        if ("streetCount" in parameters) setProperty("streetCount", parameters.streetCount);
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

    function completedLineDistance (unit) {
        if (!unit) unit = "kilometers";
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.getCompletedTaskDistance(getProperty("regionId"), unit);
        } else {
            return null;
        }
    }

    function totalLineDistanceInARoute (unit) {
        if (!unit) unit = "kilometers";
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.totalLineDistanceInARegion(getProperty("regionId"), unit);
        } else {
            return null;
        }
    }

    _init(parameters);

    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.completedLineDistance = completedLineDistance;
    self.totalLineDistance = totalLineDistanceInARoute;
    return self;
}