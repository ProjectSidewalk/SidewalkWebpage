// TODO generalize this whole thing so that it functions as either a neighborhood OR a route.
function NeighborhoodModel() {
    var self = this;
    this._neighborhoodContainer = null;
    this.isRoute = null;
    this.isRouteComplete = null;
    this.isNeighborhoodComplete = null;
    this.isNeighborhoodCompleteAcrossAllUsers = null;

    this._handleFetchComplete = function (geojson) {
        var featureGeoJSON, regionId, regionName;
        for (var i = 0; i < geojson.features.length; i++) {
            regionId = geojson.features[i].properties.region_id;
            regionName = geojson.features[i].properties.region_name;
            featureGeoJSON = geojson.features[i];
            // TODO: Add an isComplete property
            var neighborhood = new Neighborhood({regionId: regionId, geoJSON: featureGeoJSON, name: regionName });
            self.add(neighborhood);
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
