/**
 * NeighborhoodContainer module
 * @param neighborhoodModel
 * @param statusModel
 * @constructor
 */
function NeighborhoodContainer (neighborhoodModel, statusModel, userModel) {
    var self = this;
    this._neighborhoodModel = neighborhoodModel;
    this._statusModel = statusModel;
    this._userModel = userModel;

    this._neighborhoods = {};
    this._status = {
        currentNeighborhood: null
    };

    this._neighborhoodModel.on("NeighborhoodContainer:add", function (neighborhood) {
        self.add(neighborhood);
    });
}


NeighborhoodContainer.prototype.add = function (neighborhood) {
    var id = neighborhood.getProperty("regionId");
    this._neighborhoods[id] = neighborhood;
};

NeighborhoodContainer.prototype.get = function (neighborhoodId) {
    return neighborhoodId in this._neighborhoods ? this._neighborhoods[neighborhoodId] : null;
};

NeighborhoodContainer.prototype.getCurrentNeighborhood = function () {
    return this.getStatus('currentNeighborhood');
};

NeighborhoodContainer.prototype.getNextRegionId = function (currentRegionId, availableRegionIds) {
    currentRegionId = currentRegionId.toString();
    availableRegionIds = availableRegionIds.map(function (id) { return id.toString(); });
    var indexOfNextRegion = availableRegionIds.indexOf(currentRegionId) + 1;
    if (indexOfNextRegion < 0 || indexOfNextRegion == availableRegionIds.length) {
        indexOfNextRegion = 0;
    }
    return availableRegionIds[indexOfNextRegion];
};

/** Return a list of neighborhood ids */
NeighborhoodContainer.prototype.getRegionIds = function () {
    return Object.keys(this._neighborhoods).map(function (x) { return parseInt(x, 10); });
};

NeighborhoodContainer.prototype.getStatus = function (key) {
    return this._status[key];
};

NeighborhoodContainer.prototype.setCurrentNeighborhood = function (value) {
    this.setStatus('currentNeighborhood', value);

    var user = this._userModel.getUser();
    if (user) {
        var href = "/contribution/" + user.getProperty("username") + "?regionId=" + value.getProperty("regionId");
        this._statusModel.setNeighborhoodHref(href);
    }
};

NeighborhoodContainer.prototype.setStatus = function (key, value) {
    this._status[key] = value;
};
