// TODO generalize this whole thing so that it functions as either a region OR a route.
/**
 * Tracks what the user is exploring (a region, or a custom route) and whether they've finished it.
 *
 * @memberof svl
 */
class RegionModel {
  #currentRegion = null;
  #regionCompleteAcrossAllUsers = false;

  constructor() {
    this.isRoute = null;
    this.isRouteComplete = null;
    this.isRegionComplete = null;
  }

  /**
   * @returns {?Region} The region being explored, or null before one is set.
   */
  currentRegion() {
    return this.#currentRegion;
  }

  setCurrentRegion(region) {
    this.#currentRegion = region;
  }

  /**
   * @returns {boolean} Whether every street in the region has been audited by someone, not just this user.
   */
  getRegionCompleteAcrossAllUsers() {
    return this.#regionCompleteAcrossAllUsers;
  }

  setRegionCompleteAcrossAllUsers() {
    this.#regionCompleteAcrossAllUsers = true;
  }

  /**
   * @param {string} routeOrRegion - 'route' for a custom route; anything else means a region.
   */
  setAsRouteOrRegion(routeOrRegion) {
    if (routeOrRegion === 'route') {
      this.isRoute = true;
      this.isRouteComplete = false;
    } else {
      this.isRoute = false;
      this.isRegionComplete = false;
    }
  }

  /** Marks the current route or region as finished by this user, and logs it. */
  setComplete() {
    if (this.isRoute) {
      svl.tracker.push('RouteComplete', { UserRouteId: svl.userRouteId });
      this.isRouteComplete = true;
    } else {
      if (!this.#currentRegion) return;
      svl.tracker.push('NeighborhoodComplete_ByUser', { RegionId: this.#currentRegion.getRegionId() });
      this.isRegionComplete = true;
    }
  }

  isRouteOrRegionComplete() {
    return this.isRouteComplete || this.isRegionComplete;
  }
}
