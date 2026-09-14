// TODO generalize this whole thing so that it functions as either a region OR a route.
class RegionModel {
  constructor() {
    this._currentRegion = null;
    this.isRoute = null;
    this.isRouteComplete = null;
    this.isRegionComplete = null;
    this.isRegionCompleteAcrossAllUsers = null;
  }

  currentRegion() {
    return this._currentRegion;
  }

  setCurrentRegion(region) {
    this._currentRegion = region;
  }

  getRegionCompleteAcrossAllUsers() {
    return this.isRegionCompleteAcrossAllUsers;
  }

  setRegionCompleteAcrossAllUsers() {
    this.isRegionCompleteAcrossAllUsers = true;
  }

  setAsRouteOrRegion(routeOrRegion) {
    if (routeOrRegion === 'route') {
      this.isRoute = true;
      this.isRouteComplete = false;
    } else {
      this.isRoute = false;
      this.isRegionComplete = false;
    }
  }

  setComplete() {
    if (this.isRoute) {
      svl.tracker.push('RouteComplete', { UserRouteId: svl.userRouteId });
      this.isRouteComplete = true;
    } else {
      if (!this._currentRegion) return;
      svl.tracker.push('NeighborhoodComplete_ByUser', { RegionId: this.currentRegion().getRegionId() });
      this.isRegionComplete = true;
    }
  }

  isRouteOrRegionComplete() {
    return this.isRouteComplete || this.isRegionComplete;
  }
}
