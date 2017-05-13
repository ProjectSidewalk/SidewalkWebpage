/**
 * Created by manaswi on 5/12/17.
 */
function RouteModel () {
    var self = this;
    this._routeContainer = null;
    this.isRouteCompleted = false;
}
_.extend(RouteModel.prototype, Backbone.Events);

RouteModel.prototype.add = function (route) {
    this.trigger("RouteContainer:add", route);
};

RouteModel.prototype.create = function (routeId, regionId, lengthMi, streetCount) {
    var parameters = { routeId: routeId, regionId: regionId, lengthMi: lengthMi, streetCount: streetCount};
    this.trigger("RouteFactory:create", parameters);
};

RouteModel.prototype.currentRoute = function () {
    if (!this._routeContainer) return null;
    return this._routeContainer.getCurrentRoute();
};

/**
 *
 * @param routeId
 */
RouteModel.prototype.updateRemoteDatabase = function (routeId) {
    routeId = parseInt(routeId, 10);
    var url = "/route/assignment";
    $.ajax({
        async: true,
        contentType: 'application/json; charset=utf-8',
        url: url,
        type: 'post',
        data: JSON.stringify({"route_id": routeId}),
        dataType: 'json',
        success: function (result) {

        },
        error: function (result) {
            console.error(result);
        }
    });
};

RouteModel.prototype.getRoute = function (routeId) {
    if (!this._routeContainer) return null;
    return this._routeContainer.get(routeId);
};

RouteModel.prototype.routeCompleted = function (currentRouteId) {
    if (!this._routeContainer) return;
    this.trigger("Route:completed", {
        completedRouteId: currentRouteId
    });
    this.isRouteCompleted = true;
};

RouteModel.prototype.setCurrentRoute = function (route) {
    if (this._routeContainer) {
        this._routeContainer.setCurrentRoute(route);
    }
};