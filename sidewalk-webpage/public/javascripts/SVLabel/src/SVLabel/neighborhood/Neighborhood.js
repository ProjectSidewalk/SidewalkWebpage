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
        if ('regionId' in parameters) setProperty("regionId", parameters.regionId);
        if ("layer" in parameters) setProperty("layer", parameters.layer);
    }

    /**
     * Add a layer to the map
     * @param map
     */
    function addTo(map) {
        if (map && properties.layer && !status.layerAdded) {
            status.layerAdded = true;
            properties.layer.addTo(map);
            properties.layer.setStyle({
                color: "red", fillColor: "red"
            });
        }
    }

    /**
     * Return the center of this polygon
     * @returns {null}
     */
    function center () {
        return properties.layer ? turf.center(parameters.layer.toGeoJSON()) : null;
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

    self.addTo = addTo;
    self.center = center;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    return self;
}