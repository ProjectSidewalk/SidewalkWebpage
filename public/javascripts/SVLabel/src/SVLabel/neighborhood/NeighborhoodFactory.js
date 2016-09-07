/**
 * Neighborhood factory module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function NeighborhoodFactory (neighborhoodModel) {
    var self = this;
    this._neighborhoodModel = neighborhoodModel;

    this._neighborhoodModel.on("NeighborhoodFactory:create", function (parameters) {
        var neighborhood = self.create(parameters.regionId, parameters.layer, parameters.name);
        self._neighborhoodModel.add(neighborhood);
    });
}

NeighborhoodFactory.prototype.create = function (regionId, layer, name) {
    if (layer && "_layers" in layer) {
        layer = layer.getLayers()[0];
    }
    return new Neighborhood({regionId: regionId, layer: layer, name: name });
};