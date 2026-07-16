/**
 * Two-way sync between the map sidebar's filter state (plus the map viewport) and the page URL, so a filtered
 * LabelMap view can be shared as a link (#4585).
 *
 * Reading: on construction, filter params (severities, labelTypes, validationOptions, tags, streets) and viewport
 * params (lat, lng, zoom) are parsed from the query string, validated against the rendered controls, and applied
 * through MapSidebarFilter. Unknown or invalid tokens are ignored; an absent or fully-invalid param leaves that
 * section at its default. Param naming mirrors the Gallery's filter params (camelCase, comma-separated, severity
 * 'null' token for the N/A toggle).
 *
 * Writing: filter changes and map movement rewrite the URL via debounced history.replaceState (never pushState,
 * so rapid toggling doesn't pollute the back button). Params matching the sidebar's rendered defaults are
 * omitted; params this class doesn't own (regions, routes, aiValidationOptions, regionId, ...) are preserved.
 */
class MapSidebarUrlSync {
  /** @type {MapSidebarFilter} */
  #filter;
  /** @type {mapboxgl.Map} */
  #map;
  /** @type {HTMLElement} */
  #sidebar;
  /** @type {number|null} */
  #writeTimer = null;

  /**
   * @param {MapSidebarFilter} sidebarFilter The sidebar filter to read state from and apply URL state through.
   * @param {mapboxgl.Map} map The Mapbox map instance, for viewport read/write.
   */
  constructor(sidebarFilter, map) {
    this.#filter = sidebarFilter;
    this.#map = map;
    this.#sidebar = document.getElementById('map-sidebar');

    this.#applyFromUrl();
    this.#filter.onChange(() => this.#scheduleWrite());
    // Only user-initiated moves (originalEvent present) write the URL — programmatic moves like the sidebar's
    // padding ease on load or the jumpTo restore above would otherwise stamp viewport params on page load.
    this.#map.on('moveend', (event) => {
      if (event.originalEvent) this.#scheduleWrite();
    });
    this.#initCopyLink();
  }

  /** Parses the current query string and applies any valid filter/viewport params. */
  #applyFromUrl() {
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

    const lat = Number.parseFloat(params.get('lat'));
    const lng = Number.parseFloat(params.get('lng'));
    const zoom = Number.parseFloat(params.get('zoom'));
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      this.#map.jumpTo({ center: [lng, lat], ...(Number.isFinite(zoom) ? { zoom } : {}) });
    }
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

    const severityCount = this.#sidebar.querySelectorAll('.severity-button').length;
    const severities = state.severities.map((s) => (s === 0 ? 'null' : s));
    this.#setOrDelete(url, 'severities', state.severities.length === severityCount ? null : severities.join(','));

    const typeCount = this.#checkboxIds('label-type').length;
    this.#setOrDelete(url, 'labelTypes', state.labelTypes.length === typeCount ? null : state.labelTypes.join(','));

    const defaultValidations = this.#defaultCheckedIds('label-validations');
    this.#setOrDelete(url, 'validationOptions',
      this.#sameSet(state.validationOptions, defaultValidations) ? null : state.validationOptions.join(','));

    this.#setOrDelete(url, 'tags', state.tags.length === 0 ? null : state.tags.join(','));

    const streets = state.streets.map((id) => id.replace('-street', ''));
    this.#setOrDelete(url, 'streets',
      this.#sameSet(state.streets, this.#defaultCheckedIds('streets')) ? null : streets.join(','));

    const center = this.#map.getCenter();
    url.searchParams.set('lat', center.lat.toFixed(5));
    url.searchParams.set('lng', center.lng.toFixed(5));
    url.searchParams.set('zoom', this.#map.getZoom().toFixed(2));

    window.history.replaceState(null, '', url);
  }

  /** Wires the "Copy link" button: flushes the URL, copies it, and briefly confirms on the button itself. */
  #initCopyLink() {
    const btn = document.getElementById('map-sidebar-copy-link');
    if (!btn) return;

    const label = btn.querySelector('.map-sidebar__copy-link-text');
    btn.addEventListener('click', async () => {
      // Flush any pending debounce so the copied link matches what's on screen.
      this.#writeUrl();
      try {
        await navigator.clipboard.writeText(window.location.href);
      } catch {
        // Clipboard access can be denied (insecure context, permissions); the URL bar still holds the same link.
      }
      if (label) {
        label.textContent = i18next.t('labelmap:link-copied');
        setTimeout(() => {
          label.textContent = i18next.t('labelmap:copy-link');
        }, 2000);
      }
      window.logWebpageActivity?.('Click_module=MapSidebar_CopyLink');
    });
  }

  /**
   * Parses a comma-separated URL param, keeping only known values.
   * @param {URLSearchParams} params The current query params.
   * @param {string} name The param name.
   * @param {string[]} knownValues The accepted values; anything else is dropped.
   * @returns {string[]|null} The valid values, or null when the param is absent or has no valid values.
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
   * Returns the ids of the checkboxes of a filter type that are checked in the rendered markup — the page's
   * default state, read from the DOM (defaultChecked) rather than re-declared here.
   * @param {string} filterType The data-filter-type value.
   * @returns {string[]} The default-checked checkbox ids.
   */
  #defaultCheckedIds(filterType) {
    return Array.from(this.#sidebar.querySelectorAll(`input[data-filter-type="${filterType}"]`))
      .filter((cb) => cb.defaultChecked)
      .map((cb) => cb.id);
  }

  /**
   * Returns true when two arrays hold the same values, order-insensitively.
   * @param {string[]} a First array.
   * @param {string[]} b Second array.
   * @returns {boolean} Whether the arrays are equal as sets.
   */
  #sameSet(a, b) {
    return a.length === b.length && a.every((value) => b.includes(value));
  }

  /**
   * Sets a query param, or removes it when the value is null (the param's default state).
   * @param {URL} url The URL being built.
   * @param {string} name The param name.
   * @param {string|null} value The value to set, or null to delete.
   */
  #setOrDelete(url, name, value) {
    if (value === null) {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, value);
    }
  }
}
