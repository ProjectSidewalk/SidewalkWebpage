/**
 * Loads a label feed scoped to the map's viewport, refetching as the map moves (#5002).
 *
 * All viewport-fetch policy lives here so createPSMap and the page only react to events:
 * - The fetched bbox is the viewport padded by `padFactor` per side (clamped to the map's maxBounds), so small
 *   pans stay inside already-fetched data and cost no request. When the initial viewport shows the whole city
 *   (the desktop default), the padded first fetch covers everything and no later move can escape it — desktop
 *   ends up with exactly one request, like the old single-shot load.
 * - Below `minFetchZoom` (where `floorApplies`, mobile by default) nothing is fetched: the layers are cleared
 *   through the normal data fan-out and a `belowFloor` state is emitted so the page can hint "zoom in". This is
 *   what keeps a pinch-out from re-downloading a whole city over cell data.
 * - `moveend` evaluations are debounced, in-flight fetches are never overlapped (a move during one queues a
 *   single follow-up against the then-current viewport), and a stale response can never clobber a newer one.
 *
 * Listener registration replays the latest emission, so subscribers wired after `start()` (the page gets the
 * loader off the resolved map promise) can't miss a fast first fetch.
 */
class ViewportLabelLoader {
  /** @type {mapboxgl.Map} */
  #map;
  /** @type {string|URL} */
  #labelsURL;
  /** @type {number} */
  #minFetchZoom;
  /** @type {() => boolean} */
  #floorApplies;
  /** @type {number} */
  #padFactor;
  /** @type {number} */
  #debounceMs;
  /** @type {?{minLng: number, minLat: number, maxLng: number, maxLat: number}} Padded bbox of the last
   *     successful fetch; null until one lands (and cleared when the floor empties the layers). */
  #lastFetchedBbox = null;
  /** @type {number} Monotonic token; a resolving fetch only applies while it is still the newest. */
  #fetchSeq = 0;
  /** @type {boolean} */
  #inFlight = false;
  /** @type {boolean} A move landed while a fetch was in flight; run one follow-up when it settles. */
  #queued = false;
  /** @type {?AbortController} */
  #abortController = null;
  /** @type {?number} */
  #debounceTimer = null;
  /** @type {boolean} */
  #belowFloor = false;
  /** @type {string} */
  #state = 'idle';
  /** @type {?{featureCollection: object, meta: object}} Latest data emission, replayed to late subscribers. */
  #lastEmission = null;
  /** @type {{data: Function[], error: Function[], state: Function[]}} */
  #listeners = { data: [], error: [], state: [] };
  /** @type {() => void} Stable reference so destroy() can unbind it. */
  #onMoveEnd = () => this.#scheduleEvaluate();

  /**
   * @param {mapboxgl.Map} map The map whose viewport scopes the feed.
   * @param {string|URL} labelsURL The feed endpoint, already carrying any page-level params (regions, routes,
   *     aiValidationOptions); the loader adds/replaces only `bbox`.
   * @param {object} [options]
   * @param {number} [options.minFetchZoom=13] Zoom below which nothing is fetched where the floor applies.
   * @param {() => boolean} [options.floorApplies] Whether the zoom floor is in force. Defaults to mobile only:
   *     desktop keeps its at-a-glance city-wide view, which the padded first fetch already covers.
   * @param {number} [options.padFactor=0.5] Fraction of the viewport span added on each side of the fetched
   *     bbox, so nearby pans need no request. 0.5 fetches roughly four viewports' worth.
   * @param {number} [options.debounceMs=350] Quiet time after a moveend before the viewport is evaluated.
   */
  constructor(map, labelsURL, { minFetchZoom = 13, floorApplies, padFactor = 0.5, debounceMs = 350 } = {}) {
    this.#map = map;
    this.#labelsURL = labelsURL;
    this.#minFetchZoom = minFetchZoom;
    this.#floorApplies = floorApplies ?? (() => util.isMobile());
    this.#padFactor = padFactor;
    this.#debounceMs = debounceMs;
  }

  /** Binds the map's moveend and evaluates the current viewport immediately (no debounce on the first pass). */
  start() {
    // Not gated on event.originalEvent: programmatic moves (setRegionFocus's fitBounds, a deep link's jumpTo,
    // the drawer's padding ease, the spotlight's easeTo, the geocoder's flyTo) change the visible bbox and must
    // refetch just like user pans — the opposite policy from MapSidebarUrlSync's URL writes.
    this.#map.on('moveend', this.#onMoveEnd);
    this.#evaluate();
  }

  /** Forgets the last fetched bbox and fetches the current viewport now. The retry hook for a failed fetch. */
  refetch() {
    this.#lastFetchedBbox = null;
    this.#evaluate();
  }

  /** Unbinds from the map and cancels any pending work. */
  destroy() {
    this.#map.off('moveend', this.#onMoveEnd);
    clearTimeout(this.#debounceTimer);
    this.#queued = false; // An aborted fetch's cleanup must not re-evaluate after teardown.
    this.#abortController?.abort();
  }

  /**
   * Registers a callback for label data. Called with the fetched GeoJSON FeatureCollection and
   * `{isInitial}` (true only for the first emission, floor-cleared empty collections included). If data has
   * already been emitted, the callback is invoked immediately with the latest emission.
   * @param {(featureCollection: object, meta: {isInitial: boolean}) => void} callback The subscriber.
   */
  onData(callback) {
    this.#listeners.data.push(callback);
    if (this.#lastEmission) callback(this.#lastEmission.featureCollection, this.#lastEmission.meta);
  }

  /**
   * Registers a callback for fetch failures (including truncated chunked streams, which surface as JSON parse
   * errors under a 200 — see fetchLabelFeed). Aborted/superseded requests never reach it.
   * @param {(error: Error) => void} callback The subscriber.
   */
  onError(callback) {
    this.#listeners.error.push(callback);
  }

  /**
   * Registers a callback for state changes: 'idle' | 'loading' | 'belowFloor' | 'error'. If the loader is not
   * idle, the callback is invoked immediately with the current state.
   * @param {(state: string) => void} callback The subscriber.
   */
  onStateChange(callback) {
    this.#listeners.state.push(callback);
    if (this.#state !== 'idle') callback(this.#state);
  }

  /** Debounces moveend bursts (a continuous pan or inertia fling) into one evaluation. */
  #scheduleEvaluate() {
    clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => this.#evaluate(), this.#debounceMs);
  }

  /** Decides, in order: zoom floor, containment skip, busy queue, fetch. */
  #evaluate() {
    if (this.#floorApplies() && this.#map.getZoom() < this.#minFetchZoom) {
      if (!this.#belowFloor) {
        this.#belowFloor = true;
        // The layers are being cleared, so the last-fetched bbox must be forgotten too — otherwise returning
        // above the floor inside it would pass the containment check and leave the map empty.
        this.#lastFetchedBbox = null;
        this.#abortController?.abort();
        this.#emitData({ type: 'FeatureCollection', features: [] });
        this.#setState('belowFloor');
      }
      return;
    }
    this.#belowFloor = false;

    const viewport = this.#map.getBounds();
    if (this.#lastFetchedBbox && this.#contains(this.#lastFetchedBbox, viewport)) return;

    if (this.#inFlight) {
      this.#queued = true;
      return;
    }

    this.#fetch(this.#paddedBbox(viewport));
  }

  /**
   * Fetches one bbox's worth of labels and fans the result out. Serialized by the caller's busy guard; the
   * sequence token additionally keeps a response that was superseded (floor abort, destroy) from applying.
   * @param {{minLng: number, minLat: number, maxLng: number, maxLat: number}} bbox The padded bbox to fetch.
   */
  async #fetch(bbox) {
    this.#inFlight = true;
    const token = ++this.#fetchSeq;
    this.#abortController = typeof AbortController === 'undefined' ? null : new AbortController();
    this.#setState('loading');
    try {
      const url = new URL(this.#labelsURL, window.location.origin);
      url.searchParams.set('bbox', [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat].join(','));
      const data = await fetchLabelFeed(url, { signal: this.#abortController?.signal });
      if (token !== this.#fetchSeq) return;
      this.#lastFetchedBbox = bbox;
      this.#emitData(data);
      this.#setState('idle');
    } catch (e) {
      if (e.name === 'AbortError' || token !== this.#fetchSeq) return;
      // The failed bbox is deliberately not stored: the next moveend (or refetch()) tries again.
      for (const callback of this.#listeners.error) callback(e);
      this.#setState('error');
    } finally {
      this.#inFlight = false;
      if (this.#queued) {
        this.#queued = false;
        this.#evaluate();
      }
    }
  }

  /**
   * Returns the viewport expanded by `padFactor` of its span per side, clamped to the map's maxBounds (which
   * loses nothing — the viewport itself can't leave maxBounds — and keeps the desktop one-fetch invariant
   * exact). Corners are rounded to 5 decimals (~1 m) so the stored bbox is exactly what the server filtered by.
   * @param {mapboxgl.LngLatBounds} viewport The current unpadded viewport.
   * @returns {{minLng: number, minLat: number, maxLng: number, maxLat: number}} The bbox to fetch.
   */
  #paddedBbox(viewport) {
    const padLng = (viewport.getEast() - viewport.getWest()) * this.#padFactor;
    const padLat = (viewport.getNorth() - viewport.getSouth()) * this.#padFactor;
    let box = {
      minLng: viewport.getWest() - padLng,
      minLat: viewport.getSouth() - padLat,
      maxLng: viewport.getEast() + padLng,
      maxLat: viewport.getNorth() + padLat,
    };
    const maxBounds = this.#map.getMaxBounds();
    if (maxBounds) {
      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
      box = {
        minLng: clamp(box.minLng, maxBounds.getWest(), maxBounds.getEast()),
        minLat: clamp(box.minLat, maxBounds.getSouth(), maxBounds.getNorth()),
        maxLng: clamp(box.maxLng, maxBounds.getWest(), maxBounds.getEast()),
        maxLat: clamp(box.maxLat, maxBounds.getSouth(), maxBounds.getNorth()),
      };
    }
    const round = (value) => Number(value.toFixed(5));
    return {
      minLng: round(box.minLng), minLat: round(box.minLat), maxLng: round(box.maxLng), maxLat: round(box.maxLat),
    };
  }

  /**
   * Returns whether the viewport lies fully inside the bbox. Rounding shrinks the stored bbox by ≤ 0.5 m per
   * edge, which the padding dwarfs.
   * @param {{minLng: number, minLat: number, maxLng: number, maxLat: number}} bbox The fetched bbox.
   * @param {mapboxgl.LngLatBounds} viewport The current viewport.
   * @returns {boolean} True when no refetch is needed.
   */
  #contains(bbox, viewport) {
    return viewport.getWest() >= bbox.minLng && viewport.getEast() <= bbox.maxLng
      && viewport.getSouth() >= bbox.minLat && viewport.getNorth() <= bbox.maxLat;
  }

  /**
   * Emits a data event and records it for replay to late subscribers.
   * @param {object} featureCollection The GeoJSON FeatureCollection to fan out.
   */
  #emitData(featureCollection) {
    const meta = { isInitial: this.#lastEmission === null };
    this.#lastEmission = { featureCollection, meta };
    for (const callback of this.#listeners.data) callback(featureCollection, meta);
  }

  /**
   * Emits a state change, deduplicated so subscribers only hear transitions.
   * @param {string} state One of 'idle' | 'loading' | 'belowFloor' | 'error'.
   */
  #setState(state) {
    if (state === this.#state) return;
    this.#state = state;
    for (const callback of this.#listeners.state) callback(state);
  }
}
