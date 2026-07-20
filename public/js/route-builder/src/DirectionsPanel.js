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
  #endpointStreets = { start: null, end: null }; // Street name at each endpoint (for the suggested route name).

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
    };
    // Must be the element property — a `placeholder` inside `options` is silently ignored and the field
    // falls back to the library's generic "Search".
    box.placeholder = placeholder;
    box.theme = {
      variables: {
        borderRadius: '8px',
      },
      // The library reserves 40px of input padding for its 20px search icon; tighten the icon-to-text gap.
      cssText: '.Input { padding-left: 32px; height: 34px; } .SearchIcon { left: 8px; }',
    };
    // onAdd builds the search box's element for this map; we place it in the panel instead of a map corner.
    document.getElementById(`directions-${which}-slot`).append(box.onAdd(this.#map));
    this.#wireEnterToFirstSuggestion(box, which);

    box.addEventListener('retrieve', (event) => {
      const feature = event.detail?.features?.[0];
      const coord = feature?.geometry?.coordinates;
      if (!coord) return;
      window.logWebpageActivity(`RouteBuilder_Click=${which === 'start' ? 'SetStartAddress' : 'SetEndAddress'}`);
      this.#lastGeocoded[which] = coord; // The user just named this point; no need to reverse-geocode it.
      this.#userLabelCoord[which] = coord;
      this.#endpointStreets[which] = DirectionsPanel.#streetNameFromProps(feature.properties);
      const lngLat = { lng: coord[0], lat: coord[1] };
      if (which === 'start') this.#onSetStart(lngLat);
      else this.#onSetEnd(lngLat);
    });
    return box;
  }

  /**
   * Makes Enter accept the top suggestion.
   *
   * The library only fires `retrieve` on Enter when a suggestion was first highlighted with the arrow keys —
   * a plain "type an address, press Enter" silently does nothing. Intercept a trusted, unhandled Enter and
   * replay it as ArrowDown + Enter, the library's own keyboard protocol for "take the first suggestion". An
   * Enter that lands before the suggestions arrive is remembered and honored when they do.
   *
   * @param {Object} box - The mounted MapboxSearchBox element.
   * @param {string} which - 'start' or 'end'.
   */
  #wireEnterToFirstSuggestion(box, which) {
    const slot = document.getElementById(`directions-${which}-slot`);
    let pendingEnter = false;
    const acceptFirst = (input) => {
      const key = { bubbles: true, cancelable: true };
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', ...key }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ...key }));
    };
    // Capture phase on the slot, so this runs before the library's own keydown listener on the input. The
    // isTrusted check lets the synthetic Enter from acceptFirst pass through to the library untouched.
    slot.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !event.isTrusted) return;
      const input = slot.querySelector('input');
      if (!input || input.value.trim() === '') return;
      const listbox = document.getElementById(input.getAttribute('aria-controls') ?? '');
      if (listbox?.querySelector('[aria-selected="true"]')) return; // The user arrow-keyed to a suggestion.
      event.preventDefault();
      event.stopPropagation();
      if (listbox?.querySelector('[role="option"]')) acceptFirst(input);
      else pendingEnter = true; // Suggestions still loading; accept the top one when they arrive.
    }, true);
    box.addEventListener('suggest', () => {
      if (!pendingEnter) return;
      pendingEnter = false;
      const input = slot.querySelector('input');
      if (input) acceptFirst(input);
    });
    // A queued Enter must not fire a stale retrieve after the user clears or leaves the field.
    box.addEventListener('clear', () => {
      pendingEnter = false;
    });
    slot.addEventListener('focusout', (event) => {
      if (!slot.contains(event.relatedTarget)) pendingEnter = false;
    });
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
    this.#endpointStreets = { start: null, end: null };
    this.#setFieldText('start', '');
    this.#setFieldText('end', '');
  }

  /**
   * The street name at each endpoint, as far as geocoding has resolved them (best-effort; either may be null).
   * @returns {{start: string|null, end: string|null}}
   */
  getEndpointStreetNames() {
    return { start: this.#endpointStreets.start, end: this.#endpointStreets.end };
  }

  /**
   * Extracts the bare street name from a Mapbox geocoding/search feature's properties: the street context of an
   * address result, or the feature's own name for a street result.
   *
   * @param {Object} [props] - The feature's properties.
   * @returns {string|null}
   */
  static #streetNameFromProps(props) {
    if (!props) return null;
    const contextStreet = props.context?.street?.name;
    const ownName = props.feature_type === 'street' ? (props.name_preferred || props.name) : null;
    return contextStreet || ownName || null;
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
    // Cleared at dispatch, not on response: a failed lookup must not leave a street name for a stale coordinate.
    this.#endpointStreets[which] = null;

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
        this.#endpointStreets[which] = DirectionsPanel.#streetNameFromProps(props);
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
