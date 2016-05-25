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
    }

    /**
     * Add a layer to the map
     * @param map
     */
    function addTo(map, layerStyle) {
        if (map && properties.layer && !status.layerAdded) {
            layerStyle = { color: "rgb(161,217,155)", opacity: 0.5, fillColor: "rgb(255,255,255)", fillOpacity: 0.5, weight: 0 } || layerStyle;
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
            return svl.taskContainer.getCompletedTaskDistance(getProperty("regionId"), unit);
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

    _init(parameters);

    self.addTo = addTo;
    self.center = center;
    self.completedLineDistance = completedLineDistance;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.totalLineDistance = totalLineDistanceInARegion;
    return self;
}