function NavigationModel () {
    this._mapService = null;  // Todo. Should a map service be under NavigationModel?
}

_.extend(NavigationModel.prototype, Backbone.Events);

NavigationModel.prototype.getPosition = function () {
    return this._mapService ? this._mapService.getPosition() : null;
};

NavigationModel.prototype.setPosition = function (lat, lng, callback) {
    if (this._mapService) this._mapService.setPosition(lat, lng, callback);
};