/**
 * An indicator that displays the speed limit of the current position's nearest road.
 *
 * Speed limits come from our own backend (precomputed per street from OSM, #4654): in Explore from the loaded tasks'
 * `maxSpeed` property, in Validate from the current label's `maxSpeed` audit property. Only when the user wanders off
 * our street network does it ask our server's `/speedLimit` point-lookup fallback — this code never calls a
 * third-party API.
 *
 * Exposes `container` (the sign element), `speedLimit` (`{ number, sub }` where `sub` is the units, e.g. 'mph'),
 * `speedLimitVisible` (boolean), and `updateSpeedLimit()`.
 */
class SpeedLimit {
  // Labels in which speed limit is necessary context for validation. Speed limit will not display for other labels.
  static #SPEED_LIMIT_RELEVANT_LABELS = ['NoCurbRamp'];

  // How close (meters) a loaded street must be to the current position to supply the sign's value. Chosen to match
  // the server's /speedLimit search radius (OsmWayService.SEARCH_RADIUS_M) so the client and fallback agree on what
  // counts as "on a road here".
  static #NEARBY_STREET_THRESHOLD_M = 15;

  // Cap on remembered fallback lookups; a long session off the network shouldn't grow the cache without bound.
  static #POINT_LOOKUP_CACHE_MAX = 100;

  #coords;
  #isOnboarding;
  #panoViewer;
  #taskContainer;
  #labelContainer;
  #labelType;
  #fallbackUnits;

  // Fallback lookups keyed by pano id, holding the in-flight promise so concurrent pano events share one request.
  #pointLookupCache = new Map();

  // Monotonic token so a slow fallback response can't overwrite the sign after the user has already moved on.
  #latestUpdateId = 0;

  // Pending re-check while the pano position / street list are still loading at page startup.
  #startupRetryTimer = null;

  /**
   * @param {PanoViewer} panoViewer PanoramaViewer object.
   * @param {function} coords Function that returns current longitude and latitude coordinates.
   * @param {function} isOnboarding Function that returns a boolean on whether the current mission is the tutorial task.
   * @param {string} countryId The current city's country id (e.g. 'usa'), for sign design and fallback units.
   * @param {object} [sources] Where to read speed limits from; exactly one should be provided.
   * @param {TaskContainer} [sources.taskContainer] Explore's task container; the sign tracks the nearest loaded street.
   * @param {LabelContainer} [sources.labelContainer] Validate's label container; the sign shows the current label's
   *                                                  street.
   * @param {string} [sources.labelType] Label type being validated; null/undefined shows the speed limit by default.
   */
  constructor(panoViewer, coords, isOnboarding, countryId, { taskContainer = null, labelContainer = null,
    labelType = null } = {}) {
    this.#coords = coords;
    this.#isOnboarding = isOnboarding;
    this.#panoViewer = panoViewer;
    this.#taskContainer = taskContainer;
    this.#labelContainer = labelContainer;
    this.#labelType = labelType;

    this.container = document.getElementById('speed-limit-sign');
    this.speedLimit = {
      number: '',
      sub: '',
    };
    this.speedLimitVisible = false;

    // US/Canada use the MUTCD-style rectangular sign; everywhere else gets the Vienna-convention circle. Fallback
    // units (used when the OSM maxspeed value carries no unit suffix) are mph only in the US.
    this.container.setAttribute(
      'data-design-style', ['usa', 'canada'].includes(countryId) ? 'us-canada' : 'non-us-canada',
    );
    this.#fallbackUnits = countryId === 'usa' ? 'mph' : 'km/h';

    this.updateSpeedLimit();

    // Listen for pano changes.
    panoViewer.addListener('pano_changed', this.#panoChangeListener);

    // The initial pano usually finishes loading before this listener attaches, so its pano_changed is missed; run one
    // update for the current position so the sign shows on the first pano without requiring movement.
    this.#panoChangeListener();
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
   * Function to be called on a position change/movement in the pano viewer.
   */
  #panoChangeListener = async () => {
    // If user is in the onboarding/tutorial mission, we can skip getting the speed limit and hide the sign.
    if (this.#isOnboarding()) {
      this.#render(null, ++this.#latestUpdateId);
      return;
    }

    // If labelType is null/undefined (not provided), the speed limit will be displayed by default.
    const speedLimitRelevant = !this.#labelType || SpeedLimit.#SPEED_LIMIT_RELEVANT_LABELS.includes(this.#labelType);

    // If user is validating a label that doesn't require speed limit context, hide the speed limit.
    if (!speedLimitRelevant) {
      this.#render(null, ++this.#latestUpdateId);
      return;
    }

    const updateId = ++this.#latestUpdateId;
    if (this.#labelContainer !== null) {
      // Validate: the label being judged sits on a known street, so its metadata already carries the speed limit.
      this.#render(this.#labelContainer.getCurrentLabel()?.getAuditProperty('maxSpeed') ?? null, updateId);
    } else {
      this.#render(await this.#maxSpeedNearCurrentPosition(), updateId);
    }
  };

  /**
   * Finds the speed limit at the current position: the nearest loaded street's if one is close enough, otherwise via
   * the server's point-lookup fallback (the user has wandered off our street network).
   *
   * @returns {Promise<string|null>} Raw OSM maxspeed value (e.g. '25 mph', '30'), or null if unknown.
   */
  async #maxSpeedNearCurrentPosition() {
    const position = this.#coords();
    const tasks = this.#taskContainer.getTasks() ?? [];
    if (!Number.isFinite(position?.lat) || tasks.length === 0) {
      // At page startup the pano position and street list can lag this component. Re-check shortly instead of
      // treating the spot as off-network (which would pointlessly ask the server about an on-network street).
      if (this.#startupRetryTimer === null) {
        this.#startupRetryTimer = setTimeout(() => {
          this.#startupRetryTimer = null;
          this.#panoChangeListener();
        }, 1000);
      }
      return null;
    }
    const point = turf.point([position.lng, position.lat]);

    let nearestTask = null;
    let minDistance = Infinity;
    for (const task of tasks) {
      const distance = turf.pointToLineDistance(point, task.getGeoJSON(), { units: 'meters' });
      if (distance < minDistance) {
        minDistance = distance;
        nearestTask = task;
      }
    }

    if (nearestTask !== null && minDistance <= SpeedLimit.#NEARBY_STREET_THRESHOLD_M) {
      return nearestTask.getProperty('maxSpeed');
    }
    return await this.#fetchSpeedLimitAtPoint(position.lat, position.lng);
  }

  /**
   * Asks our server for the speed limit at a point, memoized per pano id.
   *
   * @param {number} lat The latitude of the current position.
   * @param {number} lng The longitude of the current position.
   * @returns {Promise<string|null>} Raw OSM maxspeed value, or null if unknown or on failure.
   */
  async #fetchSpeedLimitAtPoint(lat, lng) {
    const panoId = this.#panoViewer.getPanoId();
    if (this.#pointLookupCache.has(panoId)) {
      return await this.#pointLookupCache.get(panoId);
    }

    const promise = (async () => {
      try {
        const resp = await fetch(`/speedLimit?lat=${lat}&lng=${lng}`);
        if (!resp.ok) {
          return null;
        }
        return (await resp.json()).max_speed ?? null;
      } catch {
        return null;
      }
    })();
    // Evict the oldest entry once full (Map preserves insertion order, so the first key is the oldest).
    if (this.#pointLookupCache.size >= SpeedLimit.#POINT_LOOKUP_CACHE_MAX) {
      this.#pointLookupCache.delete(this.#pointLookupCache.keys().next().value);
    }
    this.#pointLookupCache.set(panoId, promise);
    return await promise;
  }

  /**
   * Shows the sign for the given maxspeed value, or hides it when there is none.
   *
   * @param {string|null} maxspeed Raw OSM maxspeed value (e.g. '25 mph', '30'), or null to hide the sign.
   * @param {number} updateId The token from the update that produced this value; stale updates are dropped.
   */
  #render(maxspeed, updateId) {
    if (updateId !== this.#latestUpdateId) {
      return;
    }

    if (maxspeed) {
      // A unit suffix in the value itself (e.g. '25 mph') wins over the country-based fallback units.
      const splitMaxspeed = maxspeed.split(' ');
      const number = splitMaxspeed.shift();
      let sub = splitMaxspeed.join(' ');
      if (sub.trim().length === 0) {
        sub = this.#fallbackUnits;
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
  }
}
