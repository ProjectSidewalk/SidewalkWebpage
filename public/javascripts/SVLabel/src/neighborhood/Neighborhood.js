/**
 * Neighborhood module.
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Neighborhood (parameters) {
    var self = { className: "Neighborhood"};
    var properties = {
        geoJSON: null,
        name: null,
        regionId: null
    };

    /**
     * Initialize
     */
    function _init (parameters) {
        if ('regionId' in parameters) {
            setProperty("regionId", parameters.regionId);
            self.regionId = parameters.regionId;  // for debugging
        }
        if ("geoJSON" in parameters) setProperty("geoJSON", parameters.geoJSON);
        if ("name" in parameters) {
            setProperty("name", parameters.name);
        }
    }
    
    function completedLineDistance(unit) {
        if (!unit) unit = {units: 'kilometers'};
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.getCompletedTaskDistance(unit);
        } else {
            return null;
        }
    }

    function completedLineDistanceAcrossAllUsersUsingPriority() {
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.getCompletedTaskDistanceAcrossAllUsersUsingPriority();
        } else {
            return null;
        }
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

    /**
     * @returns region id of this neighborhood
     */
    function getRegionId() {
        return getProperty('regionId');
    }

    function totalLineDistanceInNeighborhood (unit) {
        if (!unit) unit = {units: 'kilometers'};
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.totalLineDistanceInNeighborhood(unit);
        } else {
            return null;
        }
    }

    function getGeoJSON(){
        if (properties.geoJSON){
            return properties.geoJSON;
        } else {
            return null;
        }
    }
    _init(parameters);

    self.completedLineDistance = completedLineDistance;
    self.completedLineDistanceAcrossAllUsersUsingPriority = completedLineDistanceAcrossAllUsersUsingPriority;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.totalLineDistanceInNeighborhood = totalLineDistanceInNeighborhood;
    self.getGeoJSON = getGeoJSON;
    self.getRegionId = getRegionId;
    return self;
}
