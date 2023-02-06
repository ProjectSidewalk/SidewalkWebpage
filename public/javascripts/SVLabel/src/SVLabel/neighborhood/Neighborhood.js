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
        layer: null,
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
        if ("layer" in parameters) setProperty("layer", parameters.layer);
        if ("name" in parameters) {
            setProperty("name", parameters.name);
        }
    }

    /**
     * Return the center of this polygon
     * @returns {null}
     */
    function center () {
        return properties.layer ? turf.center(parameters.layer.toGeoJSON()) : null;
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
    function getRegionId () {
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
        var layer = properties.layer;
        if (layer){
            // return layer.getLayers()[0].feature;
            return layer.feature;
        } else {
            return null;
        }
    }
    _init(parameters);

    self.center = center;
    self.completedLineDistance = completedLineDistance;
    self.completedLineDistanceAcrossAllUsersUsingPriority = completedLineDistanceAcrossAllUsersUsingPriority;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.totalLineDistanceInNeighborhood = totalLineDistanceInNeighborhood;
    self.getGeoJSON = getGeoJSON;
    self.getRegionId = getRegionId;
    return self;
}
