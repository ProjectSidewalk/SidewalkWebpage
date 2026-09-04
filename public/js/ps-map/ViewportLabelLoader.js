/**
 * Loads a label feed scoped to the map's viewport, refetching as the map moves (#5002).
 *
 * All viewport-fetch policy lives here so createPSMap and the page only react to events:
 * - The fetched bbox is the viewport padded by `padFactor` per side (clamped to the map's maxBounds), so small
 *   pans stay inside already-fetched data and cost no request. Once a fetch has covered `dataBounds` — the
 *   extent the labels themselves live in — there is nothing left to fetch and every later move is free, so a
 *   desktop session opened on the city-wide view makes exactly one request, like the old single-shot load.
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
  /** @type {number} Degrees (~1 km) of slack on the data extent; see the constructor for why. */
  static #DATA_BOUNDS_MARGIN_DEG = 0.01;

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
  /** @type {?{minLng: number, minLat: number, maxLng: number, maxLat: number}} Extent the labels live in,
   *     margin included; null when the caller didn't supply one. */
  #dataBounds = null;
  /** @type {boolean} A fetch has covered `#dataBounds`, so every later move is a no-op. */
  #coversAllData = false;
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
   * @param {mapboxgl.LngLatBounds} [options.dataBounds] The extent the labels live in (the city's
   *     neighborhoods); a fetch covering it has fetched everything, so no later move refetches. maxBounds
   *     can't stand in for it — several cities draw one degrees larger than the city itself (#5170).
   */
  constructor(map, labelsURL,
    { minFetchZoom = 13, floorApplies, padFactor = 0.5, debounceMs = 350, dataBounds } = {}) {
    this.#map = map;
    this.#labelsURL = labelsURL;
    this.#minFetchZoom = minFetchZoom;
    this.#floorApplies = floorApplies ?? (() => util.isMobile());
    this.#padFactor = padFactor;
    this.#debounceMs = debounceMs;
    if (dataBounds) {
      // Labels sit a little outside the polygons they belong to (the boundary runs down the street, the label
      // is on the sidewalk), so the extent gets slack before a fetch counts as covering it — then clamping,
      // since a target past maxBounds is one no fetch could meet and the latch would never fire.
      const margin = ViewportLabelLoader.#DATA_BOUNDS_MARGIN_DEG;
      this.#dataBounds = this.#clampedBox({
        minLng: dataBounds.getWest() - margin,
        minLat: dataBounds.getSouth() - margin,
        maxLng: dataBounds.getEast() + margin,
        maxLat: dataBounds.getNorth() + margin,
      });
    }
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
    this.#coversAllData = false;
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
        this.#coversAllData = false;
        this.#abortController?.abort();
        this.#emitData({ type: 'FeatureCollection', features: [] });
        this.#setState('belowFloor');
      }
      return;
    }
    this.#belowFloor = false;

    if (this.#coversAllData) return;

    const viewport = this.#map.getBounds();
    if (this.#lastFetchedBbox && this.#contains(this.#lastFetchedBbox, this.#boxFor(viewport, 0))) return;

    if (this.#inFlight) {
      this.#queued = true;
      return;
    }

    this.#fetch(this.#boxFor(viewport, this.#padFactor));
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
      this.#coversAllData = this.#dataBounds !== null && this.#contains(bbox, this.#dataBounds);
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
   * Returns the viewport expanded by `pad` of its span per side, clamped and rounded by #clampedBox.
   *
   * The fetched bbox and the box containment compares against both come from here. A raw viewport won't do
   * for the latter: zoomed out past maxBounds (mapbox pins the center only once the bounds are smaller than
   * the view) it can never be contained in a bbox clamped to them (#5170).
   *
   * @param {mapboxgl.LngLatBounds} viewport The current unpadded viewport.
   * @param {number} pad Fraction of the viewport's span added on each side before clamping.
   * @returns {{minLng: number, minLat: number, maxLng: number, maxLat: number}} The clamped, rounded box.
   */
  #boxFor(viewport, pad) {
    const padLng = (viewport.getEast() - viewport.getWest()) * pad;
    const padLat = (viewport.getNorth() - viewport.getSouth()) * pad;
    const box = {
      minLng: viewport.getWest() - padLng,
      minLat: viewport.getSouth() - padLat,
      maxLng: viewport.getEast() + padLng,
      maxLat: viewport.getNorth() + padLat,
    };
    return this.#clampedBox(box);
  }

  /**
   * Every box the loader compares or fetches passes through here, so an edge pinned to maxBounds is the same
   * number on both sides of a comparison rather than one rounding itself out of containment.
   * @param {{minLng: number, minLat: number, maxLng: number, maxLat: number}} box The box to normalize.
   * @returns {{minLng: number, minLat: number, maxLng: number, maxLat: number}} It, held inside maxBounds —
   *     the limit of what any viewport, and so any fetch, can reach — and rounded to the 5 decimals (~1 m)
   *     the server filters by.
   */
  #clampedBox(box) {
    const maxBounds = this.#map.getMaxBounds();
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const fit = maxBounds
      ? {
          minLng: clamp(box.minLng, maxBounds.getWest(), maxBounds.getEast()),
          minLat: clamp(box.minLat, maxBounds.getSouth(), maxBounds.getNorth()),
          maxLng: clamp(box.maxLng, maxBounds.getWest(), maxBounds.getEast()),
          maxLat: clamp(box.maxLat, maxBounds.getSouth(), maxBounds.getNorth()),
        }
      : box;
    const round = (value) => Number(value.toFixed(5));
    return {
      minLng: round(fit.minLng), minLat: round(fit.minLat), maxLng: round(fit.maxLng), maxLat: round(fit.maxLat),
    };
  }

  /**
   * Returns whether the viewed box lies fully inside the fetched bbox.
   * @param {{minLng: number, minLat: number, maxLng: number, maxLat: number}} bbox The fetched bbox.
   * @param {{minLng: number, minLat: number, maxLng: number, maxLat: number}} view The current viewed box.
   * @returns {boolean} True when no refetch is needed.
   */
  #contains(bbox, view) {
    return view.minLng >= bbox.minLng && view.maxLng <= bbox.maxLng
      && view.minLat >= bbox.minLat && view.maxLat <= bbox.maxLat;
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
