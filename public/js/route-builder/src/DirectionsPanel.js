/**
 * The slim Start/End address seed for the planner card. Typing an address in either field (Mapbox search) plants a
 * waypoint at that location — Start plants the route's first point, End extends it — after which the route is refined
 * by clicking the map. The fields also mirror the route's current endpoints (reverse-geocoded) as it's edited. The
 * panel renders no markers of its own; the route's start/end flags are the only endpoint markers.
 */
class DirectionsPanel {
  // Skip a reverse-geocode when an endpoint moved less than this — the label wouldn't meaningfully change.
  static MIN_MOVE_FOR_GEOCODE_M = 15;

  // A typed address label is kept while the endpoint stays within this distance of it — the route snapping to a
  // nearby street must not overwrite the user's own words with a reverse-geocoded neighbor.
  static KEEP_USER_LABEL_M = 100;

  #map;
  #mapboxApiKey;
  #onSetStart;
  #onSetEnd;
  #lastGeocoded = { start: null, end: null }; // Last [lng, lat] each field was reverse-geocoded for.
  #userLabelCoord = { start: null, end: null }; // Where the user last picked an address by typing (if anywhere).

  /**
   * @param {Object} opts
   * @param {Object} opts.map - The Mapbox map.
   * @param {string} opts.mapboxApiKey
   * @param {Object} opts.bbox - Search bounds: [[west, south], [east, north]].
   * @param {Function} opts.onSetStart - Called with {lng, lat} when a Start address is chosen.
   * @param {Function} opts.onSetEnd - Called with {lng, lat} when an End address is chosen.
   */
  constructor(opts) {
    this.#map = opts.map;
    this.#mapboxApiKey = opts.mapboxApiKey;
    this.#onSetStart = opts.onSetStart;
    this.#onSetEnd = opts.onSetEnd;

    this.#buildSearchBox('start', opts.bbox, i18next.t('directions-start-placeholder'));
    this.#buildSearchBox('end', opts.bbox, i18next.t('directions-end-placeholder'));
  }

  /**
   * Creates a Mapbox search box bound to one of the panel's slots.
   *
   * @param {string} which - 'start' or 'end'.
   * @param {Object} bbox - Search bounds.
   * @param {string} placeholder
   * @returns {Object} The MapboxSearchBox instance.
   */
  #buildSearchBox(which, bbox, placeholder) {
    const box = new MapboxSearchBox();
    box.accessToken = this.#mapboxApiKey;
    box.options = {
      bbox,
      language: i18next.t('common:mapbox-language-code'),
      placeholder,
    };
    // onAdd builds the search box's element for this map; we place it in the panel instead of a map corner.
    document.getElementById(`directions-${which}-slot`).append(box.onAdd(this.#map));

    box.addEventListener('retrieve', (event) => {
      const coord = event.detail?.features?.[0]?.geometry?.coordinates;
      if (!coord) return;
      window.logWebpageActivity(`RouteBuilder_Click=${which === 'start' ? 'SetStartAddress' : 'SetEndAddress'}`);
      this.#lastGeocoded[which] = coord; // The user just named this point; no need to reverse-geocode it.
      this.#userLabelCoord[which] = coord;
      const lngLat = { lng: coord[0], lat: coord[1] };
      if (which === 'start') this.#onSetStart(lngLat);
      else this.#onSetEnd(lngLat);
    });
    return box;
  }

  /**
   * Syncs the fields with the route's current endpoints (reverse-geocoded, throttled by distance moved).
   *
   * @param {Array<number>} startCoord - The route's first coordinate [lng, lat].
   * @param {Array<number>} endCoord - The route's last coordinate [lng, lat].
   */
  updateFromRoute(startCoord, endCoord) {
    this.updateStart(startCoord);
    this.#reverseGeocodeInto('end', { lng: endCoord[0], lat: endCoord[1] });
  }

  /**
   * Syncs just the Start field with the route's start — used when only the first point exists (no end yet).
   *
   * @param {Array<number>} startCoord - The start point [lng, lat].
   */
  updateStart(startCoord) {
    this.#reverseGeocodeInto('start', { lng: startCoord[0], lat: startCoord[1] });
  }

  /**
   * Shows or hides the End field's row — it stays hidden until the route has a start, so the page opens with a
   * single obvious first step.
   *
   * @param {boolean} visible
   */
  setEndVisible(visible) {
    const row = document.getElementById('directions-end-row');
    if (row) row.hidden = !visible;
  }

  /** Clears both fields (route emptied / reset). */
  clearFields() {
    this.#lastGeocoded = { start: null, end: null };
    this.#userLabelCoord = { start: null, end: null };
    this.#setFieldText('start', '');
    this.#setFieldText('end', '');
  }

  /**
   * Fills a field with the nearest address/place name for a coordinate, unless it barely moved since the last
   * lookup or the user is typing in / recently typed that field.
   *
   * @param {string} which - 'start' or 'end'.
   * @param {Object} lngLat - {lng, lat}.
   */
  #reverseGeocodeInto(which, lngLat) {
    const coord = [lngLat.lng, lngLat.lat];
    const last = this.#lastGeocoded[which];
    if (last && RouteGraph.distanceM(last, coord) < DirectionsPanel.MIN_MOVE_FOR_GEOCODE_M) return;
    // A user-typed address stays in the field while the endpoint is still near it (e.g. after route snapping).
    const typedAt = this.#userLabelCoord[which];
    if (typedAt && RouteGraph.distanceM(typedAt, coord) < DirectionsPanel.KEEP_USER_LABEL_M) return;
    const slot = document.getElementById(`directions-${which}-slot`);
    if (slot?.contains(document.activeElement)) return; // Don't clobber what the user is typing.
    this.#lastGeocoded[which] = coord;
    this.#userLabelCoord[which] = null; // The endpoint left the typed address behind; the field follows it now.

    const params = new URLSearchParams({
      longitude: lngLat.lng,
      latitude: lngLat.lat,
      types: 'address,street',
      language: i18next.t('common:mapbox-language-code'),
      access_token: this.#mapboxApiKey,
    });
    fetch(`https://api.mapbox.com/search/geocode/v6/reverse?${params}`)
      .then((response) => response.json())
      .then((data) => {
        const props = data.features?.[0]?.properties;
        const label = props?.name_preferred || props?.name || props?.full_address;
        if (label) this.#setFieldText(which, label);
      })
      .catch(() => {
        // Reverse geocoding is best-effort decoration; the route is unaffected.
      });
  }

  /**
   * Sets a search box's visible text without triggering a search.
   *
   * @param {string} which - 'start' or 'end'.
   * @param {string} text
   */
  #setFieldText(which, text) {
    const slot = document.getElementById(`directions-${which}-slot`);
    const input = slot?.querySelector('input');
    if (input) input.value = text;
  }
}
