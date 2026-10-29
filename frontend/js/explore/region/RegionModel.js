/** @typedef {import('./Region.js').Region} Region */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

// TODO generalize this whole thing so that it functions as either a region OR a route.
/**
 * Tracks what the user is exploring (a region, or a custom route) and whether they've finished it.
 */
export class RegionModel {
  #userRouteId;
  #tracker;
  #currentRegion = null;
  #regionCompleteAcrossAllUsers = false;

  /**
   * @param {?number} userRouteId - The route walk the user is on; null on a region audit.
   * @param {Tracker} tracker
   */
  constructor(userRouteId, tracker) {
    this.#userRouteId = userRouteId ?? null;
    this.#tracker = tracker;
    this.isRoute = this.#userRouteId !== null;
    this.isRouteComplete = this.isRoute ? false : null;
    this.isRegionComplete = this.isRoute ? null : false;
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

  /** Marks the current route or region as finished by this user, and logs it. */
  setComplete() {
    if (this.isRoute) {
      this.#tracker.push('RouteComplete', { UserRouteId: this.#userRouteId });
      this.isRouteComplete = true;
    } else {
      if (!this.#currentRegion) return;
      this.#tracker.push('NeighborhoodComplete_ByUser', { RegionId: this.#currentRegion.getRegionId() });
      this.isRegionComplete = true;
    }
  }

  isRouteOrRegionComplete() {
    return this.isRouteComplete || this.isRegionComplete;
  }
}
