function NeighborhoodModel () {
    var self = this;
    this._neighborhoodContainer = null;
    this.isNeighborhoodCompleted = false;
    this.isNeighborhoodCompletedAcrossAllUsers = null;
    this.difficultRegionIds = [];

    this._handleFetchComplete = function (geojson) {
        var geojsonLayer = L.geoJson(geojson);
        var leafletLayers = geojsonLayer.getLayers();
        var layer, regionId, regionName;
        for (var i = 0, len = leafletLayers.length; i < len; i++) {
            layer =leafletLayers[i];
            regionId = layer.feature.properties.region_id;
            regionName = layer.feature.properties.region_name;
            // TODO: Add a isCompleted property
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

    this.fetchDifficultNeighborhoods = function () {
        $.ajax({
            contentType: 'application/json; charset=utf-8',
            url: "/neighborhoods/difficult",
            type: 'get',
            success: function (json) {
                self.difficultRegionIds = json.regionIds;
            },
            error: function (result) {
                throw result;
            }
        });
    };
    
    this.fetchNextLeastAuditedRegion = function (async) {
        if (typeof async === "undefined") async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: "/neighborhood/assignment",
            type: 'post',
            data: JSON.stringify({"region_id": null}),
            dataType: 'json',
            success: function (json) {
                var regionId = json.region_id;
                if (regionId) {
                    var neighborhood = svl.neighborhoodContainer.get(json.region_id);
                    self.setCurrentNeighborhood(neighborhood);
                } else {
                    // When no region is left to assign to the user
                    self.setCurrentNeighborhood(null);
                    console.error("No regions to assign to the user!");
                }
            },
            error: function (result) {
                throw result;
            }
        });
    }
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

/**
 *
 * @param regionId
 */
NeighborhoodModel.prototype.updateUserRegionInDatabase = function (regionId) {
    regionId = parseInt(regionId, 10);
    var url = "/neighborhood/assignment";
    $.ajax({
        async: true,
        contentType: 'application/json; charset=utf-8',
        url: url,
        type: 'post',
        data: JSON.stringify({"region_id": regionId}),
        dataType: 'json',
        success: function (result) {

        },
        error: function (result) {
            console.error(result);
        }
    });
};

NeighborhoodModel.prototype.getNeighborhoodCompleteAcrossAllUsers = function (neighborhoodId) {
    return this.isNeighborhoodCompletedAcrossAllUsers;
};


NeighborhoodModel.prototype.setNeighborhoodCompleteAcrossAllUsers = function (neighborhoodId) {
    this.isNeighborhoodCompletedAcrossAllUsers = true;
};

NeighborhoodModel.prototype.getNeighborhood = function (neighborhoodId) {
    if (!this._neighborhoodContainer) return null;
    return this._neighborhoodContainer.get(neighborhoodId);
};

NeighborhoodModel.prototype.neighborhoodCompleted = function (currentNeighborhoodId) {
    if (!this._neighborhoodContainer) return;
    this.trigger("Neighborhood:completed", {
        completedRegionId: currentNeighborhoodId
    });
    this.isNeighborhoodCompleted = true;
};

NeighborhoodModel.prototype.setCurrentNeighborhood = function (neighborhood) {
    if (this._neighborhoodContainer) {
        this._neighborhoodContainer.setCurrentNeighborhood(neighborhood);
    }
};