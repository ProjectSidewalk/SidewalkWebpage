/**
 * Represents a single region the user is auditing.
 *
 * @memberof svl
 */
class Region {
  #properties = {
    geoJSON: null,
    name: null,
    regionId: null,
  };

  /**
   * @param {object} parameters - May contain regionId, geoJSON, and name.
   */
  constructor(parameters) {
    if ('regionId' in parameters) {
      this.setProperty('regionId', parameters.regionId);
      this.regionId = parameters.regionId; // Exposed publicly for debugging in the console.
    }
    if ('geoJSON' in parameters) this.setProperty('geoJSON', parameters.geoJSON);
    if ('name' in parameters) this.setProperty('name', parameters.name);
  }

  /**
   * @param {object} [unit] - Turf-style units object; defaults to kilometers.
   * @returns {?number} Distance the user has completed in this region, or null if unavailable.
   */
  completedLineDistance(unit) {
    if (!unit) unit = { units: 'kilometers' };
    if ('taskContainer' in svl && svl.taskContainer) {
      return svl.taskContainer.getCompletedTaskDistance(unit);
    } else {
      return null;
    }
  }

  /**
   * @returns {?number} Completed distance across all users (using priority), or null if unavailable.
   */
  communityCompletedLineDistance() {
    if ('taskContainer' in svl && svl.taskContainer) {
      return svl.taskContainer.getCommunityCompletedTaskDistance();
    } else {
      return null;
    }
  }

  /**
   * @param {string} key
   * @returns {*} The property value, or null if not present.
   */
  getProperty(key) {
    return key in this.#properties ? this.#properties[key] : null;
  }

  /**
   * @param {string} key
   * @param {*} value
   * @returns {Region} this, for chaining.
   */
  setProperty(key, value) {
    this.#properties[key] = value;
    return this;
  }

  /**
   * @returns {*} Region id of this region.
   */
  getRegionId() {
    return this.getProperty('regionId');
  }

  /**
   * @returns {?object} The region's GeoJSON, or null if not set.
   */
  getGeoJSON() {
    return this.#properties.geoJSON ? this.#properties.geoJSON : null;
  }
}
