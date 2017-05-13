/**
 * Created by manaswi on 5/12/17.
 */

/**
 * Route factory module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function RouteFactory (routeModel) {
    var self = this;
    this._routeModel = routeModel;

    this._routeModel.on("RouteFactory:create", function (parameters) {
        var route = self.create(parameters.routeId, parameters.regionId, parameters.lengthMi, parameters.streetCount);
        self._routeModel.add(route);
    });
}

RouteFactory.prototype.create = function(routeId, regionId, lengthMi, streetCount) {
    return new Route({routeId: routeId, regionId: regionId, lengthMi: lengthMi, streetCount: streetCount});
};
