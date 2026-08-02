/**
 * Two-way sync between the filter sidebar's state (plus the map viewport) and the page URL, so a filtered
 * LabelMap view can be shared as a link (#4696).
 *
 * Reading: viewport params (lat, lng, zoom) are applied via the static applyUrlViewport() as soon as the map is
 * ready, before the label layers stream in. Filter params (severities, labelTypes, validationOptions, tags,
 * streets) are parsed on construction, validated against the rendered controls, and applied through
 * MapSidebarFilter. Unknown or invalid tokens are ignored; an absent or fully-invalid param leaves that section
 * at its default. Param naming mirrors the Gallery's filter params (camelCase, comma-separated, severity 'null'
 * token for the N/A toggle).
 *
 * Writing: filter changes and user-initiated map movement rewrite the URL via debounced history.replaceState
 * (never pushState, so rapid toggling doesn't pollute the back button). Params matching the sidebar's rendered
 * defaults are omitted; params this class doesn't own (regions, routes, aiValidationOptions, labelId, ...) are
 * preserved.
 */
class MapSidebarUrlSync {
  /** @type {MapSidebarFilter} */
  #filter;
  /** @type {mapboxgl.Map} */
  #map;
  /** @type {HTMLElement} */
  #sidebar;
  /** @type {?number} */
  #writeTimer = null;
  /** @type {number[]} Severities pressed in the rendered markup — buttons carry no defaultChecked, so the
   *      default is snapshotted before any URL state is applied. */
  #defaultSeverities;

  /**
   * Returns whether the URL carries a complete viewport (finite lat AND lng).
   * @returns {boolean} Whether applyUrlViewport() would move the map.
   */
  static hasUrlViewport() {
    const params = new URLSearchParams(window.location.search);
    return Number.isFinite(Number.parseFloat(params.get('lat')))
      && Number.isFinite(Number.parseFloat(params.get('lng')));
  }

  /**
   * Applies the URL's ?lat/?lng (and optional ?zoom) to the map via jumpTo. Called from onMapReady — before the
   * label layers stream in — so a deep-linked user isn't parked on the city-wide view while they load.
   * @param {mapboxgl.Map} map The Mapbox map instance.
   * @returns {boolean} Whether a viewport was applied.
   */
  static applyUrlViewport(map) {
    if (!MapSidebarUrlSync.hasUrlViewport()) return false;
    const params = new URLSearchParams(window.location.search);
    const lat = Number.parseFloat(params.get('lat'));
    const lng = Number.parseFloat(params.get('lng'));
    const zoom = Number.parseFloat(params.get('zoom'));
    map.jumpTo({ center: [lng, lat], ...(Number.isFinite(zoom) ? { zoom } : {}) });
    return true;
  }

  /**
   * @param {MapSidebarFilter} sidebarFilter The sidebar filter to read state from and apply URL state through.
   * @param {mapboxgl.Map} map The Mapbox map instance, for viewport read/write.
   */
  constructor(sidebarFilter, map) {
    this.#filter = sidebarFilter;
    this.#map = map;
    this.#sidebar = document.getElementById('filter-sidebar');
    this.#defaultSeverities = this.#pressedSeverities();

    this.#applyFiltersFromUrl();
    this.#filter.onChange(() => this.#scheduleWrite());
    // Only user-initiated moves (originalEvent present) write the URL — programmatic moves like the sidebar's
    // padding ease, setRegionFocus's fitBounds, or the spotlight's jumpTo would otherwise stamp viewport params
    // on page load.
    this.#map.on('moveend', (event) => {
      if (event.originalEvent) this.#scheduleWrite();
    });
  }

  /** Parses the current query string and applies any valid filter params through MapSidebarFilter. */
  #applyFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const state = {};

    // Accept both the Gallery-style 'null' token and a literal 0 for the N/A severity toggle.
    const severities = this.#parseList(params, 'severities', ['null', '0', '1', '2', '3']);
    if (severities) state.severities = severities.map((s) => (s === 'null' ? 0 : Number(s)));

    const knownTypes = this.#checkboxIds('label-type').map((id) => id.replace('-checkbox', ''));
    const labelTypes = this.#parseList(params, 'labelTypes', knownTypes);
    if (labelTypes) state.labelTypes = labelTypes;

    const validationOptions = this.#parseList(params, 'validationOptions', this.#checkboxIds('label-validations'));
    if (validationOptions) state.validationOptions = validationOptions;

    const knownTags = Array.from(this.#sidebar.querySelectorAll('.tag-pill[data-tag]')).map((p) => p.dataset.tag);
    const tags = this.#parseList(params, 'tags', knownTags);
    if (tags) state.tags = tags;

    const streets = this.#parseList(params, 'streets', ['audited', 'unaudited']);
    if (streets) state.streets = streets.map((s) => `${s}-street`);

    if (Object.keys(state).length > 0) this.#filter.applyState(state);
  }

  /** Debounces URL writes so a burst of filter clicks or a continuous pan produces one replaceState. */
  #scheduleWrite() {
    if (this.#writeTimer) clearTimeout(this.#writeTimer);
    this.#writeTimer = setTimeout(() => this.#writeUrl(), 300);
  }

  /** Rewrites the URL from the current filter state and viewport, omitting params that match the defaults. */
  #writeUrl() {
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer);
      this.#writeTimer = null;
    }

    const url = new URL(window.location.href);
    const state = this.#filter.getState();

    const severities = state.severities.map((s) => (s === 0 ? 'null' : s));
    this.#setOrDelete(url, 'severities',
      this.#sameSet(state.severities, this.#defaultSeverities) ? null : severities.join(','));

    const labelTypes = state.sections['label-type'] ?? [];
    this.#setOrDelete(url, 'labelTypes',
      this.#sameSet(labelTypes, this.#defaultCheckedValues('label-type')) ? null : labelTypes.join(','));

    const validationOptions = state.sections['label-validations'] ?? [];
    this.#setOrDelete(url, 'validationOptions',
      this.#sameSet(validationOptions, this.#defaultCheckedValues('label-validations'))
        ? null
        : validationOptions.join(','));

    // Tag names repeat across types ("narrow" is both a curb ramp and a sidewalk tag), so the flat param carries
    // each name once; the read path re-applies it to every checked type that renders it.
    const tags = [...new Set(Object.values(state.tags).flat())];
    this.#setOrDelete(url, 'tags', tags.length === 0 ? null : tags.join(','));

    const streetIds = state.sections.streets ?? [];
    const streets = streetIds.map((id) => id.replace('-street', ''));
    this.#setOrDelete(url, 'streets',
      this.#sameSet(streetIds, this.#defaultCheckedValues('streets')) ? null : streets.join(','));

    const center = this.#map.getCenter();
    url.searchParams.set('lat', center.lat.toFixed(5));
    url.searchParams.set('lng', center.lng.toFixed(5));
    url.searchParams.set('zoom', this.#map.getZoom().toFixed(2));

    // Commas are legal unencoded in a query value, and these params are comma-separated lists, so leaving them
    // readable keeps the shared URLs legible (Gallery precedent).
    const query = url.searchParams.toString().replace(/%2C/g, ',');
    window.history.replaceState(null, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
  }

  /**
   * Parses a comma-separated URL param, keeping only known values.
   * @param {URLSearchParams} params The current query params.
   * @param {string} name The param name.
   * @param {string[]} knownValues The accepted values; anything else is dropped.
   * @returns {?string[]} The valid values, or null when the param is absent or has no valid values.
   */
  #parseList(params, name, knownValues) {
    const raw = params.get(name);
    if (raw === null) return null;
    const known = new Set(knownValues);
    const values = raw.split(',').map((v) => v.trim()).filter((v) => known.has(v));
    return values.length > 0 ? values : null;
  }

  /**
   * Returns the ids of the sidebar checkboxes of a given filter type.
   * @param {string} filterType The data-filter-type value.
   * @returns {string[]} The checkbox element ids.
   */
  #checkboxIds(filterType) {
    return Array.from(this.#sidebar.querySelectorAll(`input[data-filter-type="${filterType}"]`)).map((cb) => cb.id);
  }

  /**
   * Returns the semantic values of a filter type's checkboxes that are checked in the rendered markup — the
   * page's default state, read from the DOM (defaultChecked, which survives programmatic .checked writes)
   * rather than re-declared here. Label types report their bare type name, everything else its id, matching
   * FilterSidebar.getState().
   * @param {string} filterType The data-filter-type value.
   * @returns {string[]} The default-checked values.
   */
  #defaultCheckedValues(filterType) {
    return Array.from(this.#sidebar.querySelectorAll(`input[data-filter-type="${filterType}"]`))
      .filter((cb) => cb.defaultChecked)
      .map((cb) => (filterType === 'label-type' ? cb.id.replace('-checkbox', '') : cb.id));
  }

  /**
   * Returns the severities whose toggle buttons are currently pressed.
   * @returns {number[]} The pressed severities (0=N/A through 3).
   */
  #pressedSeverities() {
    return Array.from(this.#sidebar.querySelectorAll('.severity-button'))
      .filter((btn) => btn.getAttribute('aria-pressed') === 'true')
      .map((btn) => Number(btn.dataset.severity));
  }

  /**
   * Returns true when two arrays hold the same values, order-insensitively.
   * @param {Array<string|number>} a First array.
   * @param {Array<string|number>} b Second array.
   * @returns {boolean} Whether the arrays are equal as sets.
   */
  #sameSet(a, b) {
    return a.length === b.length && a.every((value) => b.includes(value));
  }

  /**
   * Sets a query param, or removes it when the value is null (the param's default state).
   * @param {URL} url The URL being built.
   * @param {string} name The param name.
   * @param {?string} value The value to set, or null to delete.
   */
  #setOrDelete(url, name, value) {
    if (value === null) {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, value);
    }
  }
}
