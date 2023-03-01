// TODO generalize this whole thing so that it functions as either a neighborhood OR a route.
function NeighborhoodModel() {
    var self = this;
    this._neighborhoodContainer = null;
    this.routeOrNeighborhood = null;
    this.isRouteComplete = null;
    this.isNeighborhoodCompleted = false;
    this.isNeighborhoodCompletedAcrossAllUsers = null;

    this._handleFetchComplete = function (geojson) {
        var geojsonLayer = L.geoJson(geojson);
        var leafletLayers = geojsonLayer.getLayers();
        var layer, regionId, regionName;
        for (var i = 0, len = leafletLayers.length; i < len; i++) {
            layer = leafletLayers[i];
            regionId = layer.feature.properties.region_id;
            regionName = layer.feature.properties.region_name;
            // TODO: Add an isComplete property
            self.create(regionId, layer, regionName);
        }
    };

    this.fetchNeighborhoods = function (callback) {
        if (callback) {
            $.when($.ajax("/neighborhoods")).done(self._handleFetchComplete).done(callback);
        } else {
            $.when($.ajax("/neighborhoods")).done(self._handleFetchComplete)
        }
    };
}
_.extend(NeighborhoodModel.prototype, Backbone.Events);

NeighborhoodModel.prototype.add = function (neighborhood) {
    this.trigger("NeighborhoodContainer:add", neighborhood);
};

NeighborhoodModel.prototype.create = function (regionId, layer, name) {
    var parameters = { regionId: regionId, layer: layer, name: name };
    this.trigger("NeighborhoodFactory:create", parameters);
};

NeighborhoodModel.prototype.currentNeighborhood = function () {
    if (!this._neighborhoodContainer) return null;
    return this._neighborhoodContainer.getCurrentNeighborhood();
};

NeighborhoodModel.prototype.getNeighborhoodCompleteAcrossAllUsers = function () {
    return this.isNeighborhoodCompletedAcrossAllUsers;
};

NeighborhoodModel.prototype.setNeighborhoodCompleteAcrossAllUsers = function () {
    this.isNeighborhoodCompletedAcrossAllUsers = true;
};

NeighborhoodModel.prototype.isRouteOrNeighborhood = function () {
    return this.routeOrNeighborhood;
};

NeighborhoodModel.prototype.setAsRouteOrNeighborhood = function (routeOrNeighborhood) {
    if (['route', 'neighborhood'].indexOf(routeOrNeighborhood) > 0) this.routeOrNeighborhood = routeOrNeighborhood;
    if (routeOrNeighborhood === 'route') this.isRouteComplete = false;
};

NeighborhoodModel.prototype.routeComplete = function () {
    if (!this._neighborhoodContainer) return;
    this.isRouteComplete = true;
}

NeighborhoodModel.prototype.neighborhoodCompleted = function () {
    if (!this._neighborhoodContainer) return;
    this.trigger("Neighborhood:completed");
    this.isNeighborhoodCompleted = true;
};
