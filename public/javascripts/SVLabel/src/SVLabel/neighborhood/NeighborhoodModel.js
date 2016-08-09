function NeighborhoodModel () {
    var self = this;

    this.fetchNeighborhoods = function () {

    }
}
_.extend(NeighborhoodModel.prototype, Backbone.Events);

NeighborhoodModel.prototype.add = function (neighborhood) {
    this.trigger("NeighborhoodContainer:add", neighborhood);
};

NeighborhoodModel.prototype.moveToANewRegion = function (regionId) {
    regionId = parseInt(regionId, 10);
    var url = "/neighborhood/new";
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