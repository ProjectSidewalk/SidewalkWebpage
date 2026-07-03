// TODO generalize this whole thing so that it functions as either a neighborhood OR a route.
class NeighborhoodModel {
    constructor() {
        this._currentNeighborhood = null;
        this.isRoute = null;
        this.isRouteComplete = null;
        this.isNeighborhoodComplete = null;
        this.isNeighborhoodCompleteAcrossAllUsers = null;
    }

    currentNeighborhood() {
        return this._currentNeighborhood;
    }

    setCurrentNeighborhood(neighborhood) {
        this._currentNeighborhood = neighborhood;
    }

    getNeighborhoodCompleteAcrossAllUsers() {
        return this.isNeighborhoodCompleteAcrossAllUsers;
    }

    setNeighborhoodCompleteAcrossAllUsers() {
        this.isNeighborhoodCompleteAcrossAllUsers = true;
    }

    setAsRouteOrNeighborhood(routeOrNeighborhood) {
        if (routeOrNeighborhood === 'route') {
            this.isRoute = true;
            this.isRouteComplete = false;
        } else {
            this.isRoute = false;
            this.isNeighborhoodComplete = false;
        }
    }

    setComplete() {
        if (this.isRoute) {
            svl.tracker.push('RouteComplete', { UserRouteId: svl.userRouteId });
            this.isRouteComplete = true;
        } else {
            if (!this._currentNeighborhood) return;
            svl.tracker.push('NeighborhoodComplete_ByUser', { RegionId: this.currentNeighborhood().getRegionId() });
            this.isNeighborhoodComplete = true;
        }
    }

    isRouteOrNeighborhoodComplete() {
        return this.isRouteComplete || this.isNeighborhoodComplete;
    }
}
