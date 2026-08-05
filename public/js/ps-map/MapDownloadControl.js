/**
 * "Download" map control: a labeled pill that opens a dropdown menu for downloading the labels currently shown on
 * the map via the public /v3/api/rawLabels endpoint, in the user's choice of format.
 *
 * Implements the Mapbox IControl interface (onAdd/onRemove) so it stacks with the built-in controls in a map corner.
 * The host page supplies accessors for the live filter state and visible-label count; the control turns that state
 * into rawLabels query parameters at click time, so the file always reflects the current sidebar selections.
 */
class MapDownloadControl {
  /** @type {HTMLElement} */
  #container;
  /** @type {HTMLButtonElement} */
  #button;
  /** @type {HTMLElement} */
  #menu;
  /** @type {() => object} */
  #getFilterState;
  /** @type {() => number} */
  #getVisibleLabelCount;
  /** @type {?number} */
  #regionId;
  /** @type {boolean} */
  #showsPartialFilterCaveat;
  /** @type {boolean} */
  #open = false;
  /** @type {(e: MouseEvent) => void} Stable reference so the capturing document listener can be removed. */
  #boundOutsideClick = (e) => this.#onOutsideClick(e);

  /** The download formats offered, in menu order. Format names are proper nouns and are not translated. */
  static #FORMATS = [
    { format: 'geojson', name: 'GeoJSON', hintKey: 'hint-geojson', hintFallback: 'Web mapping standard' },
    { format: 'csv', name: 'CSV', hintKey: 'hint-csv', hintFallback: 'For Excel, Google Sheets' },
    { format: 'shapefile', name: 'Shapefile', hintKey: 'hint-shapefile', hintFallback: 'For ArcGIS, QGIS' },
    { format: 'geopackage', name: 'GeoPackage', hintKey: 'hint-geopackage', hintFallback: 'Open GIS format' },
  ];

  /** Sidebar validation checkbox id → public rawLabels validationStatus token. */
  static #VALIDATION_TOKENS = {
    correct: 'validated_correct',
    incorrect: 'validated_incorrect',
    unsure: 'unsure',
    unvalidated: 'unvalidated',
  };

  /**
   * @param {object} options
   * @param {() => object} options.getFilterState Returns FilterSidebar.getState()'s shape.
   * @param {() => number} options.getVisibleLabelCount Returns the number of labels the filters leave visible.
   * @param {?number} [options.regionId] Single deep-linked region id to scope downloads to, or null.
   * @param {boolean} [options.showsPartialFilterCaveat=false] Whether to warn that some page-level filters
   *      (multi-region, routes, AI validation) are not reflected in downloads.
   */
  constructor({ getFilterState, getVisibleLabelCount, regionId = null, showsPartialFilterCaveat = false }) {
    this.#getFilterState = getFilterState;
    this.#getVisibleLabelCount = getVisibleLabelCount;
    this.#regionId = regionId;
    this.#showsPartialFilterCaveat = showsPartialFilterCaveat;
  }

  /**
   * Builds the relative /v3/api/rawLabels URL for the given sidebar state.
   *
   * A section with every option selected is omitted — the endpoint's default already covers it. A section with
   * nothing selected is also omitted: it means the map shows nothing, and callers disable the download actions in
   * that case (the endpoint cannot express an empty selection).
   *
   * @param {{severities: number[], sections: object, tags: object}} state FilterSidebar.getState()'s shape.
   * @param {object} options
   * @param {string} options.format One of 'geojson', 'csv', 'shapefile', 'geopackage'.
   * @param {?number} [options.regionId] Single region id to scope the download to, or null.
   * @returns {string} The relative URL, e.g. "/v3/api/rawLabels?filetype=csv&highQualityUserOnly=true".
   */
  static buildDownloadUrl(state, { format, regionId = null }) {
    const params = new URLSearchParams();
    params.set('filetype', format);
    // The public LabelMap only renders high-quality users' labels (labelMap.scala.html passes
    // highQualityFilter: true), so downloads must match.
    params.set('highQualityUserOnly', 'true');

    // state.tags carries every rendered label type (FilterSidebar.getState()'s contract), checked or not.
    const renderedTypeCount = Object.keys(state.tags).length;
    const checkedTypes = state.sections['label-type'] ?? [];
    if (checkedTypes.length > 0 && checkedTypes.length < renderedTypeCount) {
      params.set('labelType', checkedTypes.join(','));
    }

    // The sidebar renders exactly four severity toggles (N/A + 1-3, filterSidebar.scala.html); all four selected
    // is the endpoint's default.
    const severities = [...state.severities].sort((a, b) => a - b);
    if (severities.length > 0 && severities.length < 4) {
      params.set('severity', severities.map((severity) => (severity === 0 ? 'none' : String(severity))).join(','));
    }

    const validations = state.sections['label-validations'] ?? [];
    if (validations.length > 0 && validations.length < Object.keys(MapDownloadControl.#VALIDATION_TOKENS).length) {
      params.set(
        'validationStatus',
        validations.map((option) => MapDownloadControl.#VALIDATION_TOKENS[option]).join(','),
      );
    }

    const tagPairs = Object.entries(state.tags)
      .flatMap(([labelType, tags]) => tags.map((tag) => `${labelType}:${tag}`));
    if (tagPairs.length > 0) params.set('tags', tagPairs.join(','));

    if (regionId !== null) params.set('regionId', String(regionId));
    return `/v3/api/rawLabels?${params}`;
  }

  /**
   * Builds the control's DOM and wires its event handlers. Called by Mapbox when the control is added to a map;
   * the map argument the interface passes is not needed.
   * @returns {HTMLElement} The control's root element.
   */
  onAdd() {
    this.#container = document.createElement('div');
    this.#container.className = 'mapboxgl-ctrl map-download-control';
    const formatItems = MapDownloadControl.#FORMATS.map(({ format, name, hintKey, hintFallback }) => `
        <button type="button" role="menuitem" class="map-download-control__item" data-format="${format}">
          <span class="map-download-control__format">${name}</span>
          <span class="map-download-control__hint" data-i18n="labelmap:download.${hintKey}">${hintFallback}</span>
        </button>`).join('');
    this.#container.innerHTML = `
      <button type="button" class="map-download-control__button" aria-haspopup="menu" aria-expanded="false"
              aria-controls="map-download-menu">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12v1.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V12"
                stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span data-i18n="labelmap:download.button">Download</span>
      </button>
      <div id="map-download-menu" class="map-download-control__menu" role="menu" aria-labelledby="map-download-title"
           aria-describedby="map-download-count" hidden>
        <p id="map-download-title" class="map-download-control__title"
           data-i18n="labelmap:download.title">Select a file format to download</p>
        <p id="map-download-count" class="map-download-control__count"></p>
        <p class="map-download-control__caveat" data-i18n="labelmap:download.caveat" hidden>
          Some filters from this page's link (multiple regions, routes, or AI validation) aren't applied to downloads.
        </p>${formatItems}
        <a role="menuitem" class="map-download-control__docs-link" href="/v3/api-docs/rawLabels" target="_blank"
           data-i18n="labelmap:download.api-docs-link">Raw Labels API documentation</a>
      </div>`;

    this.#button = this.#container.querySelector('.map-download-control__button');
    this.#menu = this.#container.querySelector('#map-download-menu');
    if (this.#showsPartialFilterCaveat) this.#container.querySelector('.map-download-control__caveat').hidden = false;

    this.#button.addEventListener('click', () => (this.#open ? this.#closeMenu() : this.#openMenu()));
    this.#container.addEventListener('keydown', (e) => this.#onKeydown(e));
    for (const item of this.#menu.querySelectorAll('.map-download-control__item')) {
      item.addEventListener('click', () => this.#triggerDownload(item.dataset.format));
    }
    this.#container.querySelector('.map-download-control__docs-link')
      .addEventListener('click', () => this.#logActivity('Click_module=MapDownload_DocsLink'));

    window.localizeSubtree?.(this.#container);
    return this.#container;
  }

  /** Tears down the control. Called by Mapbox when the control is removed from the map. */
  onRemove() {
    document.removeEventListener('click', this.#boundOutsideClick, true);
    this.#container.remove();
  }

  /**
   * Opens the menu: refreshes the count line, disables the format actions when nothing is shown, and moves focus in.
   * @param {boolean} [focusLast=false] Whether to focus the last item instead of the first (ArrowUp convention).
   */
  #openMenu(focusLast = false) {
    const count = this.#getVisibleLabelCount();
    this.#renderCount(count);
    for (const item of this.#menu.querySelectorAll('.map-download-control__item')) {
      item.disabled = count === 0;
    }

    this.#menu.hidden = false;
    this.#open = true;
    this.#button.setAttribute('aria-expanded', 'true');

    // Defer listener registration so the click that opened the menu doesn't immediately close it.
    setTimeout(() => document.addEventListener('click', this.#boundOutsideClick, true), 0);

    const items = this.#focusableItems();
    (focusLast ? items.at(-1) : items[0])?.focus();
    this.#logActivity('Click_module=MapDownload_Open');
  }

  /**
   * Closes the menu and tears down the outside-click listener.
   * @param {boolean} [returnFocus=true] Whether to move focus back to the pill (skip on outside-click/Tab).
   */
  #closeMenu(returnFocus = true) {
    this.#menu.hidden = true;
    this.#open = false;
    this.#button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', this.#boundOutsideClick, true);
    if (returnFocus) this.#button.focus();
  }

  /**
   * Navigates to the rawLabels URL for the current filter state via an ephemeral anchor; the server's
   * Content-Disposition names the downloaded file.
   * @param {string} format One of 'geojson', 'csv', 'shapefile', 'geopackage'.
   */
  #triggerDownload(format) {
    const url = MapDownloadControl.buildDownloadUrl(this.#getFilterState(), { format, regionId: this.#regionId });
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    this.#logActivity(`Click_module=MapDownload_Download_format=${format}`);
    this.#closeMenu();
  }

  /**
   * Renders the count line: the visible-label count in a pill ("17224 labels"), followed by "match your filters".
   * Both halves receive the count so each locale can inflect its own half (e.g. "matches" vs "match").
   * @param {number} count The current visible-label count.
   */
  #renderCount(count) {
    const hasI18n = typeof i18next !== 'undefined';
    const pill = document.createElement('span');
    pill.className = 'map-download-control__count-pill';
    pill.textContent = hasI18n ? i18next.t('labelmap:download.count', { count }) : `${count} labels`;
    const suffix = hasI18n ? i18next.t('labelmap:download.count-match', { count }) : 'match your filters';
    this.#menu.querySelector('.map-download-control__count').replaceChildren(pill, suffix);
  }

  /**
   * Returns the menu's currently actionable items in navigation order (enabled formats, then the docs link).
   * @returns {HTMLElement[]} The focusable menu items.
   */
  #focusableItems() {
    const selector = '.map-download-control__item:not(:disabled), .map-download-control__docs-link';
    return [...this.#menu.querySelectorAll(selector)];
  }

  /**
   * Handles keyboard interaction: ArrowDown/ArrowUp open the menu from the pill; inside the menu, arrows cycle,
   * Home/End jump, Escape closes and refocuses the pill, and Tab closes while letting focus move on.
   * @param {KeyboardEvent} e The keydown event.
   */
  #onKeydown(e) {
    if (!this.#open) {
      if (document.activeElement === this.#button && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        this.#openMenu(e.key === 'ArrowUp');
      }
      return;
    }

    const items = this.#focusableItems();
    const index = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      this.#closeMenu();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items.at(-1)?.focus();
    } else if (e.key === 'Tab') {
      this.#closeMenu(false);
    }
  }

  /**
   * Closes the menu when a click lands outside the control.
   * @param {MouseEvent} e The document-level click event.
   */
  #onOutsideClick(e) {
    if (!this.#container.contains(e.target)) this.#closeMenu(false);
  }

  /**
   * Logs an interaction to the `webpage_activity` table. No-op on pages without the shared logger.
   * @param {string} activity The activity string, following the Click_module=<Action> convention.
   */
  #logActivity(activity) {
    window.logWebpageActivity?.(activity);
  }
}
