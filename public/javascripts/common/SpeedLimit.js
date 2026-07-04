/**
 * An indicator that displays the speed limit of the current position's nearest road.
 *
 * Exposes `container` (the sign element), `speedLimit` (`{ number, sub }` where `sub` is the units, e.g. 'mph'),
 * `speedLimitVisible` (boolean), and `updateSpeedLimit()`.
 */
class SpeedLimit {
    static #ROAD_HIGHWAY_TYPES = [
        'motorway',
        'trunk',
        'primary',
        'secondary',
        'tertiary',
        'unclassified',
        'residential',
        'motorway_link',
        'trunk_link',
        'primary_link',
        'secondary_link',
        'tertiary_link',
        'living_street',
        'road',
    ];

    // Labels in which speed limit is necessary context for validation. Speed limit will not display for other labels.
    static #SPEED_LIMIT_RELEVANT_LABELS = ['NoCurbRamp'];

    #coords;
    #isOnboarding;
    #labelContainer;
    #labelType;

    #cache = {};

    // Country info (ISO 3166-1 code) for the current session. Country doesn't change while a user is auditing, so we
    // fetch it once and reuse it to cut Overpass request volume roughly in half. Null until first successful fetch; on
    // failure we reset to null so the next pano change can retry.
    #countryCodePromise = null;

    /**
     * @param {PanoViewer} panoViewer PanoramaViewer object.
     * @param {function} coords Function that returns current longitude and latitude coordinates.
     * @param {function} isOnboarding Function that returns a boolean on whether the current mission is the tutorial task.
     * @param {LabelContainer} [labelContainer] Label container for pre-fetching validation labels. Can be null.
     * @param {string} [labelType] Label type being validated; null/undefined shows the speed limit by default.
     */
    constructor(panoViewer, coords, isOnboarding, labelContainer, labelType) {
        this.#coords = coords;
        this.#isOnboarding = isOnboarding;
        this.#labelContainer = labelContainer;
        this.#labelType = labelType;

        // If labelType is null/undefined (not provided), the speed limit will be displayed by default.
        const speedLimitRelevant = !labelType || SpeedLimit.#SPEED_LIMIT_RELEVANT_LABELS.includes(labelType);
        if (typeof (labelContainer) !== 'undefined' && labelContainer !== null && speedLimitRelevant) {
            this.#prefetchLabels(); // Note that this happens async.
            labelContainer.resetLabelListUpdateCallback(this.#prefetchLabels);
        }

        this.container = document.getElementById('speed-limit-sign');
        this.speedLimit = {
            number: '',
            sub: '',
        };
        this.speedLimitVisible = false;
        this.updateSpeedLimit();

        // Listen for pano changes.
        panoViewer.addListener('pano_changed', this.#panoChangeListener);
    }

    /**
     * Render/update the speed limit using the current info in speedLimit.
     */
    updateSpeedLimit() {
        this.container.querySelector('#speed-limit').innerText = this.speedLimit.number;
        this.container.querySelector('#speed-limit-sub').innerText = this.speedLimit.sub;
        this.container.style.display = this.speedLimitVisible ? 'flex' : 'none';
    }

    /**
     * Finds the closest road given overpass API's response of nearby roads and the current position.
     *
     * @param {object} data The overpass API's response of nearby roads.
     * @param {number} lat The latitude of the current position.
     * @param {number} lon The longitude of the current position.
     */
    #findClosestRoad(data, lat, lon) {
        // Filter to only be roads, and not footpaths/walkways.
        const roads = data.elements.filter((el) =>
            el.type === 'way' && el.tags && el.tags.highway && SpeedLimit.#ROAD_HIGHWAY_TYPES.includes(el.tags.highway),
        );

        const point = turf.point([lat, lon]);
        let closestRoad = null;
        let minDistance = Infinity;

        // Go through all the roads and find the closest one.
        for (const road of roads) {
            const lineString = turf.lineString(road.geometry.map((p) => [p.lon, p.lat]));
            const distance = turf.pointToLineDistance(point, lineString);

            if (distance < minDistance) {
                minDistance = distance;
                closestRoad = road;
            }
        }

        return closestRoad;
    }

    /**
     * Function called specifically on validation page to prefetch the upcoming speed limits.
     */
    #prefetchLabels = async () => {
        // Clear the cache.
        this.#cache = {};

        // Get the labels from the pano container and prefetch them.
        const labelsToPrefetch = this.#labelContainer.getLabels();
        for (const label of labelsToPrefetch) {
            const cameraLat = label.getAuditProperty('cameraLat');
            const cameraLng = label.getAuditProperty('cameraLng');
            if (cameraLat && cameraLng) {
                await this.#queryClosestRoadForCoords(cameraLat, cameraLng, true, label);
            }
        }
    };

    /**
     * Fetches the closest nearby road for a given set of coordinates from the Overpass API.
     *
     * @param {number} lat The latitude of the current position.
     * @param {number} lng The longitude of the current position.
     * @param {boolean} shouldCache If true, this will cache the coordinates with the road response.
     * @param {Label} label The label that is being validated. Can be null.
     * @returns {Promise<{closestRoad: object|null}>} Object with the calculated closest road, or null on failure.
     */
    async #queryClosestRoadForCoords(lat, lng, shouldCache, label) {
        const cacheKey = label === null ? (this.#labelContainer === null ? '' : this.#labelContainer.getCurrentLabel().getAuditProperty('panoId')) : label.getAuditProperty('panoId');
        if (cacheKey in this.#cache) {
            return await this.#cache[cacheKey];
        }

        // Get nearby roads and their respective information from the overpass API.
        const overpassQuery = `
        [out:json];
        (
        way['highway'](around:10.0, ${lat}, ${lng});
        );
        out geom;
        `;
        const promise = (async () => {
            try {
                const overpassResp = await fetch(
                    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`,
                );
                // A 429 (or other non-2xx) returns XML rather than JSON, so guard before parsing.
                if (!overpassResp.ok) {
                    return { closestRoad: null };
                }
                const overpassRespJson = await overpassResp.json();
                return { closestRoad: this.#findClosestRoad(overpassRespJson, lat, lng) };
            } catch {
                return { closestRoad: null };
            }
        })();

        if (shouldCache) {
            this.#cache[cacheKey] = promise;
        }

        return await promise;
    }

    /**
     * Fetches the ISO 3166-1 country code for the given coordinates. The result is cached for the session on first
     * success since the country doesn't change while a user audits. On failure the cache is cleared.
     *
     * @param {number} lat The latitude of the current position.
     * @param {number} lng The longitude of the current position.
     * @returns {Promise<string|null>} ISO 3166-1 country code, or null if the lookup failed.
     */
    async #queryCountryCode(lat, lng) {
        if (this.#countryCodePromise !== null) {
            return await this.#countryCodePromise;
        }

        const overpassQuery = `
        [out:json];
        is_in(${lat}, ${lng})->.a;
        rel(pivot.a)['ISO3166-1'];
        convert country
            ::id = id(),
            code = t['ISO3166-1'];
        out tags;
        `;
        this.#countryCodePromise = (async () => {
            try {
                const resp = await fetch(
                    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`,
                );
                if (!resp.ok) {
                    this.#countryCodePromise = null;
                    return null;
                }
                const json = await resp.json();
                const countryElements = json.elements.filter((el) => el.type === 'country');
                return countryElements.length > 0 ? countryElements[0].tags.code : null;
            } catch {
                this.#countryCodePromise = null;
                return null;
            }
        })();

        return await this.#countryCodePromise;
    }

    /**
     * Function to be called on a position change/movement in the google street view.
     */
    #panoChangeListener = async () => {
        // If user is in the onboarding/tutorial mission, we can skip getting the speed limit and hide the sign.
        if (this.#isOnboarding()) {
            this.speedLimitVisible = false;
            this.updateSpeedLimit();
            return;
        }

        // If labelType is null/undefined (not provided), the speed limit will be displayed by default.
        const speedLimitRelevant = !this.#labelType || SpeedLimit.#SPEED_LIMIT_RELEVANT_LABELS.includes(this.#labelType);

        // If user is validating a label that doesn't require speed limit context, hide the speed limit.
        if (!speedLimitRelevant) {
            this.speedLimitVisible = false;
            this.updateSpeedLimit();
            return;
        }

        // Get the current position.
        const { lat, lng } = this.#coords();
        // Test coords here if someone finds them useful.
        // const lat = 47.6271486;
        // const lng = -122.3423263;

        // Fetch roads (per-pano) and country code (session-cached) in parallel.
        const [queryResp, countryCode] = await Promise.all([
            this.#queryClosestRoadForCoords(lat, lng, false, null),
            this.#queryCountryCode(lat, lng),
        ]);
        const closestRoad = queryResp.closestRoad;

        // Fallback units should be kilometers per hour by default.
        let fallbackUnits = 'km/h';

        // Use the country code to set the speed limit indicator design and fallback units.
        if (countryCode) {
            // Set proper design.
            if (countryCode === 'US' || countryCode === 'CA') {
                this.container.setAttribute('data-design-style', 'us-canada');
            } else {
                this.container.setAttribute('data-design-style', 'non-us-canada');
            }

            // Set mph for fallback units if US or UK.
            if (countryCode === 'US' || countryCode === 'UK') {
                fallbackUnits = 'mph';
            }
        }

        // Extract speed limit info from closest road.
        if (closestRoad !== null && closestRoad.tags.maxspeed) {
            const splitMaxspeed = closestRoad.tags.maxspeed.split(' ');
            const number = splitMaxspeed.shift();
            let sub = splitMaxspeed.join(' ');
            if (sub.trim().length === 0) {
                sub = fallbackUnits;
            }
            this.speedLimit = {
                number,
                sub,
            };
            this.speedLimitVisible = true;
        } else {
            this.speedLimitVisible = false;
        }
        this.updateSpeedLimit();
    };
}
