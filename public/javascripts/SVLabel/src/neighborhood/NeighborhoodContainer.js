/**
 * NeighborhoodContainer module
 * @param neighborhoodModel NeighborhoodModel object
 * @constructor
 */
function NeighborhoodContainer (neighborhoodModel) {
    var self = this;
    this._neighborhoodModel = neighborhoodModel;

    this._neighborhoods = {};
    this._status = {
        currentNeighborhood: null
    };

    this._neighborhoodModel.on("NeighborhoodContainer:add", function (neighborhood) {
        self.add(neighborhood);
    });
}


NeighborhoodContainer.prototype.add = function (neighborhood) {
    var id = neighborhood.getRegionId();
    this._neighborhoods[id] = neighborhood;
};

NeighborhoodContainer.prototype.get = function (neighborhoodId) {
    return neighborhoodId in this._neighborhoods ? this._neighborhoods[neighborhoodId] : null;
};

NeighborhoodContainer.prototype.getCurrentNeighborhood = function () {
    return this.getStatus('currentNeighborhood');
};

NeighborhoodContainer.prototype.getStatus = function (key) {
    return this._status[key];
};

NeighborhoodContainer.prototype.setCurrentNeighborhood = function (newNeighborhood) {
    this.setStatus('currentNeighborhood', newNeighborhood);
    this._neighborhoodModel.trigger("NeighborhoodContainer:setNeighborhood", newNeighborhood);
};

NeighborhoodContainer.prototype.setStatus = function (key, value) {
    this._status[key] = value;
};
