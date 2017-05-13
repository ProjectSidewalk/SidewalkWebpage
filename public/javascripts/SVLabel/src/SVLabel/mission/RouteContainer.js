/**
 * Created by manaswi on 5/12/17.
 */

/**
 * RouteContainer module
 * @param routeModel RouteModel object
 * @constructor
 */
function RouteContainer (routeModel) {
    var self = this;
    this._routeModel = routeModel;

    this._routes = {};
    this._status = {
        currentRoute: null
    };

    this._routeModel.on("RouteContainer:add", function (route) {
        self.add(route);
    });
}


RouteContainer.prototype.add = function (route) {
    var id = route.getProperty("routeId");
    this._routes[id] = route;
};

RouteContainer.prototype.get = function (routeId) {
    return routeId in this._routes ? this._routes[routeId] : null;
};

RouteContainer.prototype.getCurrentRoute = function () {
    return this.getStatus('currentRoute');
};

RouteContainer.prototype.getStatus = function (key) {
    return this._status[key];
};

RouteContainer.prototype.setCurrentRoute = function (newRoute) {
    this.setStatus('currentRoute', newRoute);

    // var oldRoute = this.getCurrentRoute();
    // var parameters = { oldRoute: oldRoute, newRoute: newRoute };
    // this._routeModel.trigger("RouteContainer:routeChanged", parameters);
};

RouteContainer.prototype.setStatus = function (key, value) {
    this._status[key] = value;
};

/*
For Future. Currently, only one route is loaded for a mission
Date: May 12, 2017
 */
RouteContainer.prototype.getNextRouteId = function (currentRouteId, availableRouteIds) {
    currentRouteId = currentRouteId.toString();
    availableRouteIds = availableRouteIds.map(function (id) { return id.toString(); });
    var indexOfNextRoute = availableRouteIds.indexOf(currentRouteId) + 1;
    if (indexOfNextRoute < 0 || indexOfNextRoute == availableRouteIds.length) {
        indexOfNextRoute = 0;
    }
    return availableRouteIds[indexOfNextRoute];
};

/** Return a list of route ids */
RouteContainer.prototype.getRouteIds = function () {
    return Object.keys(this._routes).map(function (x) { return parseInt(x, 10); });
};