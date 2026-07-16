/**
 * The Google-Maps-style Start/End panel for auto-routing (#4579). Typing an address in either field (Mapbox
 * search) drops a draggable pin; once both pins are set, the panel asks RouteBuilder to compute a walking route
 * between them. When the user builds a route manually instead, the fields auto-fill by reverse-geocoding the
 * route's current endpoints and keep updating as it is edited.
 */
class DirectionsPanel {
  // Skip a reverse-geocode when an endpoint moved less than this — the label wouldn't meaningfully change.
  static MIN_MOVE_FOR_GEOCODE_M = 15;

  // A typed address label is kept while the endpoint stays within this distance of it — the route snapping to
  // a nearby street must not overwrite the user's own words with a reverse-geocoded neighbor.
  static KEEP_USER_LABEL_M = 100;

  #map;
  #mapboxApiKey;
  #onPinsChanged;
  #errorEl;
  #startPin = null;
  #endPin = null;
  #lastGeocoded = { start: null, end: null }; // Last [lng, lat] each field was reverse-geocoded for.
  #userLabelCoord = { start: null, end: null }; // Where the user last picked an address by typing (if anywhere).

  /**
   * @param {Object} opts
   * @param {Object} opts.map - The Mapbox map.
   * @param {string} opts.mapboxApiKey
   * @param {Object} opts.bbox - Search bounds: [[west, south], [east, north]].
   * @param {Function} opts.onPinsChanged - Called with ({lng, lat}, {lng, lat}) whenever both pins are set and
   *                                        one of them changed (typed or dragged).
   */
  constructor(opts) {
    this.#map = opts.map;
    this.#mapboxApiKey = opts.mapboxApiKey;
    this.#onPinsChanged = opts.onPinsChanged;
    this.#errorEl = document.getElementById('directions-error');

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
      const eventName = which === 'start' ? 'SetStartPin' : 'SetEndPin';
      window.logWebpageActivity(`RouteBuilder_Click=${eventName}`);
      this.#setPin(which, { lng: coord[0], lat: coord[1] });
      this.#lastGeocoded[which] = coord; // The user just named this point; no need to reverse-geocode it.
      this.#userLabelCoord[which] = coord;
      this.#firePinsChanged();
    });
    return box;
  }

  /**
   * Places or moves a pin marker (draggable; dragging recomputes the route).
   *
   * @param {string} which - 'start' or 'end'.
   * @param {Object} lngLat - {lng, lat}.
   */
  #setPin(which, lngLat) {
    const existing = which === 'start' ? this.#startPin : this.#endPin;
    if (existing) {
      existing.setLngLat(lngLat);
      return;
    }
    const marker = new mapboxgl.Marker({
      color: which === 'start' ? '#80c32a' : '#ff6a00',
      draggable: true,
    }).setLngLat(lngLat).addTo(this.#map);
    marker.on('dragend', () => {
      window.logWebpageActivity(`RouteBuilder_Drag=${which === 'start' ? 'StartPin' : 'EndPin'}`);
      this.#userLabelCoord[which] = null; // A drag supersedes any typed address for this endpoint.
      this.#reverseGeocodeInto(which, marker.getLngLat());
      this.#firePinsChanged();
    });
    if (which === 'start') this.#startPin = marker;
    else this.#endPin = marker;
  }

  #firePinsChanged() {
    this.clearError();
    if (this.#startPin && this.#endPin) {
      this.#onPinsChanged(this.#startPin.getLngLat(), this.#endPin.getLngLat());
    }
  }

  /**
   * Syncs the panel with a manually edited route: pins follow the route's endpoints and the fields are
   * refreshed via reverse geocoding (throttled by distance moved).
   *
   * @param {Array<number>|null} startCoord - The route's first coordinate [lng, lat], or null when empty.
   * @param {Array<number>|null} endCoord - The route's last coordinate, or null when empty.
   */
  updateFromRoute(startCoord, endCoord) {
    if (!startCoord || !endCoord) {
      this.clearPins();
      return;
    }
    this.#setPin('start', { lng: startCoord[0], lat: startCoord[1] });
    this.#setPin('end', { lng: endCoord[0], lat: endCoord[1] });
    this.#reverseGeocodeInto('start', { lng: startCoord[0], lat: startCoord[1] });
    this.#reverseGeocodeInto('end', { lng: endCoord[0], lat: endCoord[1] });
  }

  /** Removes both pins and clears the fields (route emptied / reset). */
  clearPins() {
    this.#startPin?.remove();
    this.#endPin?.remove();
    this.#startPin = null;
    this.#endPin = null;
    this.#lastGeocoded = { start: null, end: null };
    this.#userLabelCoord = { start: null, end: null };
    this.#setFieldText('start', '');
    this.#setFieldText('end', '');
    this.clearError();
  }

  /**
   * Shows a routing error under the fields (e.g. no path found).
   * @param {string} message - Already-localized text.
   */
  setError(message) {
    if (!this.#errorEl) return;
    this.#errorEl.textContent = message;
    this.#errorEl.hidden = false;
  }

  clearError() {
    if (this.#errorEl) this.#errorEl.hidden = true;
  }

  /**
   * Fills a field with the nearest address/place name for a coordinate, unless it barely moved since the
   * last lookup or the user is typing in that field.
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
        // Reverse geocoding is best-effort decoration; the pins/route are unaffected.
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
