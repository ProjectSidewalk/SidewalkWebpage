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
            layer: null,
            name: null,
            regionId: null
        },
        status = {
            layerAdded: false
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
     * Add a layer to the map
     * @param map
     */
    function addTo(map, layerStyle) {
        if (map && properties.layer && !status.layerAdded) {
            layerStyle = {"color":"rgb(200,200,200)", "fill": false, "weight": 2 } || layerStyle;
            status.layerAdded = true;
            properties.layer.addTo(map);
            properties.layer.setStyle(layerStyle);
        }
    }

    /**
     * Return the center of this polygon
     * @returns {null}
     */
    function center () {
        return properties.layer ? turf.center(parameters.layer.toGeoJSON()) : null;
    }
    
    function completedLineDistance (unit) {
        if (!unit) unit = "kilometers";
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.getCompletedTaskDistance(unit);
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

    function totalLineDistanceInARegion (unit) {
        if (!unit) unit = "kilometers";
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.totalLineDistanceInARegion(getProperty("regionId"), unit);
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

    self.addTo = addTo;
    self.center = center;
    self.completedLineDistance = completedLineDistance;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.totalLineDistance = totalLineDistanceInARegion;
    self.getGeoJSON = getGeoJSON;
    return self;
}