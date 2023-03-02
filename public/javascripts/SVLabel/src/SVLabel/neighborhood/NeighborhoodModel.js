// TODO generalize this whole thing so that it functions as either a neighborhood OR a route.
function NeighborhoodModel() {
    var self = this;
    this._neighborhoodContainer = null;
    this.isRoute = null;
    this.isRouteComplete = null;
    this.isNeighborhoodComplete = null;
    this.isNeighborhoodCompleteAcrossAllUsers = null;

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
    return this.isNeighborhoodCompleteAcrossAllUsers;
};

NeighborhoodModel.prototype.setNeighborhoodCompleteAcrossAllUsers = function () {
    this.isNeighborhoodCompleteAcrossAllUsers = true;
};

NeighborhoodModel.prototype.setAsRouteOrNeighborhood = function (routeOrNeighborhood) {
    if (routeOrNeighborhood === 'route') {
        this.isRoute = true;
        this.isRouteComplete = false;
    } else {
        this.isRoute = false;
        this.isNeighborhoodComplete = false;
    }
};

NeighborhoodModel.prototype.setComplete = function () {
    if (this.isRoute) {
        svl.tracker.push("RouteComplete", { 'UserRouteId': svl.userRouteId });
        this.isRouteComplete = true;
    } else {
        if (!this._neighborhoodContainer) return;
        svl.tracker.push("NeighborhoodComplete_ByUser", { 'RegionId': this.currentNeighborhood().getRegionId() });
        this.isNeighborhoodComplete = true;
    }
}

NeighborhoodModel.prototype.isRouteOrNeighborhoodComplete = function () {
    return this.isRouteComplete || this.isNeighborhoodComplete
}
