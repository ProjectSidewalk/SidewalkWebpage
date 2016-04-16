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
     * @returns {Neighborhood}
     */
    function create (regionId) {
        return new Neighborhood({regionId: regionId});
    }

    self.create = create;
    return self;
}