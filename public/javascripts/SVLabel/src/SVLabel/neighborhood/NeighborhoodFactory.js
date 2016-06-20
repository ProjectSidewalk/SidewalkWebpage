/**
 * Neighborhood factory module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function NeighborhoodFactory () {
    var self = { className: "NeighborhoodFactory" };

    /**
     * Create a neighborhood instance.
     * @param regionId
     * @param layer Leaflet layer
     * @returns {Neighborhood}
     */
    function create (regionId, layer, name) {
        return new Neighborhood({regionId: regionId, layer: layer, name: name });
    }

    self.create = create;
    return self;
}