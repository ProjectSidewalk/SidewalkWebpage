/**
 * Represents a single neighborhood (region) the user is auditing.
 *
 * @memberof svl
 */
class Neighborhood {
    #properties = {
        geoJSON: null,
        name: null,
        regionId: null
    };

    /**
     * @param {Object} parameters - May contain regionId, geoJSON, and name.
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
     * @param {Object} [unit] - Turf-style units object; defaults to kilometers.
     * @returns {?number} Distance the user has completed in this neighborhood, or null if unavailable.
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
    completedLineDistanceAcrossAllUsersUsingPriority() {
        if ('taskContainer' in svl && svl.taskContainer) {
            return svl.taskContainer.getCompletedTaskDistanceAcrossAllUsersUsingPriority();
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
     * @returns {Neighborhood} this, for chaining.
     */
    setProperty(key, value) {
        this.#properties[key] = value;
        return this;
    }

    /**
     * @returns {*} Region id of this neighborhood.
     */
    getRegionId() {
        return this.getProperty('regionId');
    }

    /**
     * @param {Object} [unit] - Turf-style units object; defaults to kilometers.
     * @returns {?number} Total street distance in this neighborhood, or null if unavailable.
     */
    totalLineDistanceInNeighborhood(unit) {
        if (!unit) unit = { units: 'kilometers' };
        if ('taskContainer' in svl && svl.taskContainer) {
            return svl.taskContainer.totalLineDistanceInNeighborhood(unit);
        } else {
            return null;
        }
    }

    /**
     * @returns {?Object} The neighborhood's GeoJSON, or null if not set.
     */
    getGeoJSON() {
        return this.#properties.geoJSON ? this.#properties.geoJSON : null;
    }
}
