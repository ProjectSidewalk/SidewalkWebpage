/**
 * "Download" map control: a labeled pill that opens a panel for downloading the labels currently shown on the map
 * via the public /v3/api/rawLabels endpoint, in the user's choice of format.
 *
 * Implements the Mapbox IControl interface (onAdd/onRemove) so it stacks with the built-in controls in a map corner.
 * The host page supplies accessors for the live filter state and visible-label count; the control turns that state
 * into rawLabels query parameters at click time, so the file always reflects the current sidebar selections.
 *
 * The panel is a disclosure (button + `aria-expanded`/`aria-controls`), not an ARIA menu: it mixes static text (the
 * title, the count, the caveat) with actions, and `role="menu"` may only contain menu items. Arrow/Home/End keys are
 * still wired up as a convenience for the run of buttons inside.
 */
class MapDownloadControl {
  /** @type {HTMLElement} */
  #container;
  /** @type {HTMLButtonElement} */
  #button;
  /** @type {HTMLElement} */
  #panel;
  /** @type {HTMLElement} */
  #status;
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
  /** @type {string} Prefix for this instance's element ids, so two controls on one page can't collide. */
  #idPrefix;
  /** @type {?number} */
  #outsideClickTimer = null;
  /** @type {?number} */
  #busyTimer = null;
  /** @type {?number} */
  #tabCloseTimer = null;
  /** @type {(e: MouseEvent) => void} Stable reference so the capturing document listener can be removed. */
  #boundOutsideClick = (e) => this.#onOutsideClick(e);

  /** Instances built so far, used to make element ids unique. */
  static #instanceCount = 0;

  /**
   * How long the pill stays in its "preparing your download" state, in ms.
   *
   * The transfer is a plain browser navigation, which fires no completion event we can listen for, so the state is
   * time-boxed rather than tied to the response. It exists to acknowledge the click — a city-wide GeoPackage takes a
   * while to first byte, and with no feedback at all people click again.
   */
  static #BUSY_MS = 4000;

  /** The download formats offered, in panel order. Format names are proper nouns and are not translated. */
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
    this.#idPrefix = `map-download-${MapDownloadControl.#instanceCount++}`;
  }

  /**
   * Builds the relative /v3/api/rawLabels URL for the given sidebar state.
   *
   * A section with every rendered option selected is omitted — the endpoint's default already covers it. A section
   * with nothing selected is also omitted: it means the map shows nothing, and callers disable the download actions
   * in that case (the endpoint cannot express an empty selection).
   *
   * @param {{severities: number[], allSeverities: number[], sections: object, tags: object,
   *      allLabelTypes: string[]}} state FilterSidebar.getState()'s shape.
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

    const checkedTypes = state.sections['label-type'] ?? [];
    if (checkedTypes.length > 0 && checkedTypes.length < state.allLabelTypes.length) {
      params.set('labelType', checkedTypes.join(','));
    }

    const severities = [...state.severities].sort((a, b) => a - b);
    if (severities.length > 0 && severities.length < state.allSeverities.length) {
      params.set('severity', severities.map((severity) => (severity === 0 ? 'none' : String(severity))).join(','));
    }

    const validations = state.sections['label-validations'] ?? [];
    if (validations.length > 0 && validations.length < Object.keys(MapDownloadControl.#VALIDATION_TOKENS).length) {
      params.set(
        'validationStatus',
        validations.map((option) => MapDownloadControl.#VALIDATION_TOKENS[option]).join(','),
      );
    }

    // One `tags` occurrence per tag rather than a comma-separated list: tag names are free-form label text and at
    // least one of them contains a comma ("yellow box, accessibility features not visible"), which a list would
    // shred into two tags matching nothing. Each entry is scoped to its label type, which the endpoint reads as
    // "narrow this type by these tags", leaving the untagged types alone — exactly what the sidebar does.
    for (const [labelType, tags] of Object.entries(state.tags)) {
      for (const tag of tags) params.append('tags', `${labelType}:${tag}`);
    }

    if (regionId !== null) params.set('regionId', String(regionId));
    return `/v3/api/rawLabels?${params}`;
  }

  /**
   * Builds the control's DOM and wires its event handlers. Called by Mapbox when the control is added to a map;
   * the map argument the interface passes is not needed.
   * @returns {HTMLElement} The control's root element.
   */
  onAdd() {
    const panelId = `${this.#idPrefix}-panel`;
    const titleId = `${this.#idPrefix}-title`;
    const countId = `${this.#idPrefix}-count`;
    const caveatId = `${this.#idPrefix}-caveat`;
    // The caveat only describes the panel when it's actually shown, or screen readers announce a warning that isn't
    // on screen.
    const describedBy = this.#showsPartialFilterCaveat ? `${countId} ${caveatId}` : countId;

    this.#container = document.createElement('div');
    this.#container.className = 'mapboxgl-ctrl map-download-control';
    const formatItems = MapDownloadControl.#FORMATS.map(({ format, name, hintKey, hintFallback }) => `
        <button type="button" class="map-download-control__item" data-format="${format}">
          <span class="map-download-control__format">${name}</span>
          <span class="map-download-control__hint" data-i18n="labelmap:download.${hintKey}">${hintFallback}</span>
        </button>`).join('');
    this.#container.innerHTML = `
      <button type="button" class="map-download-control__button" aria-expanded="false" aria-controls="${panelId}">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12v1.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V12"
                stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="map-download-control__label" data-i18n="labelmap:download.button">Download</span>
        <span class="map-download-control__label map-download-control__label--busy"
              data-i18n="labelmap:download.preparing" hidden>Preparing your download…</span>
      </button>
      <div id="${panelId}" class="map-download-control__panel" role="group" aria-labelledby="${titleId}"
           aria-describedby="${describedBy}" hidden>
        <p id="${titleId}" class="map-download-control__title"
           data-i18n="labelmap:download.title">Select a file format to download</p>
        <p id="${countId}" class="map-download-control__count"></p>
        <p id="${caveatId}" class="map-download-control__caveat" data-i18n="labelmap:download.caveat" hidden>
          Some filters from this page's link (multiple regions, routes, or AI validation) can't be applied to
          downloads, so the file may contain more labels than the count above.
        </p>${formatItems}
        <a class="map-download-control__docs-link" href="/v3/api-docs/rawLabels" target="_blank" rel="noopener">
          <span data-i18n="labelmap:download.api-docs-link">Raw Labels API documentation</span>
          <span class="map-download-control__sr-only"
                data-i18n="labelmap:download.opens-new-tab"> (opens in a new tab)</span>
        </a>
      </div>
      <p class="map-download-control__sr-only" role="status"></p>`;

    this.#button = this.#container.querySelector('.map-download-control__button');
    this.#panel = this.#container.querySelector(`#${panelId}`);
    this.#status = this.#container.querySelector('[role="status"]');
    if (this.#showsPartialFilterCaveat) this.#container.querySelector('.map-download-control__caveat').hidden = false;

    this.#button.addEventListener('click', () => (this.#open ? this.#closePanel() : this.#openPanel()));
    this.#container.addEventListener('keydown', (e) => this.#onKeydown(e));
    for (const item of this.#panel.querySelectorAll('.map-download-control__item')) {
      item.addEventListener('click', () => this.#triggerDownload(item.dataset.format));
    }
    this.#container.querySelector('.map-download-control__docs-link')
      .addEventListener('click', () => this.#logActivity('Click_module=MapDownload_DocsLink'));

    window.localizeSubtree?.(this.#container);
    return this.#container;
  }

  /** Tears down the control. Called by Mapbox when the control is removed from the map. */
  onRemove() {
    clearTimeout(this.#outsideClickTimer);
    clearTimeout(this.#busyTimer);
    clearTimeout(this.#tabCloseTimer);
    document.removeEventListener('click', this.#boundOutsideClick, true);
    this.#container.remove();
  }

  /**
   * Opens the panel: refreshes the count line, disables the format actions when nothing is shown, and moves focus in.
   * @param {boolean} [focusLast=false] Whether to focus the last item instead of the first (ArrowUp convention).
   */
  #openPanel(focusLast = false) {
    const count = this.#getVisibleLabelCount();
    this.#renderCount(count);
    for (const item of this.#panel.querySelectorAll('.map-download-control__item')) {
      item.disabled = count === 0;
    }

    this.#panel.hidden = false;
    this.#open = true;
    this.#button.setAttribute('aria-expanded', 'true');

    // Defer listener registration so the click that opened the panel doesn't immediately close it. The guard covers
    // a close that lands before the timer fires, which would otherwise leave a listener attached to a closed panel.
    clearTimeout(this.#outsideClickTimer);
    this.#outsideClickTimer = setTimeout(() => {
      if (this.#open) document.addEventListener('click', this.#boundOutsideClick, true);
    }, 0);

    const items = this.#focusableItems();
    (focusLast ? items.at(-1) : items[0])?.focus();
    this.#logActivity('Click_module=MapDownload_Open');
  }

  /**
   * Closes the panel and tears down the outside-click listener.
   * @param {boolean} [returnFocus=true] Whether to move focus back to the pill (skip on outside-click/Tab).
   */
  #closePanel(returnFocus = true) {
    this.#panel.hidden = true;
    this.#open = false;
    this.#button.setAttribute('aria-expanded', 'false');
    clearTimeout(this.#outsideClickTimer);
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
    this.#setBusy(true);
    this.#closePanel();
  }

  /**
   * Puts the pill into (or out of) its "preparing your download" state and announces the change.
   * @param {boolean} busy Whether a download has just been started.
   */
  #setBusy(busy) {
    const idle = this.#button.querySelector('.map-download-control__label:not(.map-download-control__label--busy)');
    const working = this.#button.querySelector('.map-download-control__label--busy');
    idle.hidden = busy;
    working.hidden = !busy;
    this.#button.setAttribute('aria-busy', String(busy));
    // Announce the localized string the pill itself is showing, rather than a second copy that could drift from it.
    this.#status.textContent = busy ? working.textContent.trim() : '';

    clearTimeout(this.#busyTimer);
    if (busy) this.#busyTimer = setTimeout(() => this.#setBusy(false), MapDownloadControl.#BUSY_MS);
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
    this.#panel.querySelector('.map-download-control__count').replaceChildren(pill, suffix);
  }

  /**
   * Returns the panel's currently actionable items in navigation order (enabled formats, then the docs link).
   * @returns {HTMLElement[]} The focusable items.
   */
  #focusableItems() {
    const selector = '.map-download-control__item:not(:disabled), .map-download-control__docs-link';
    return [...this.#panel.querySelectorAll(selector)];
  }

  /**
   * Handles keyboard interaction: ArrowDown/ArrowUp open the panel from the pill; inside it, arrows cycle,
   * Home/End jump, Escape closes and refocuses the pill, and Tab closes while letting focus move on.
   * @param {KeyboardEvent} e The keydown event.
   */
  #onKeydown(e) {
    if (!this.#open) {
      if (document.activeElement === this.#button && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        this.#openPanel(e.key === 'ArrowUp');
      }
      return;
    }

    const items = this.#focusableItems();
    const index = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      this.#closePanel();
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
      // Deferred: hiding the focused element's subtree synchronously leaves the browser resolving sequential focus
      // from a display:none element, which can drop focus at the top of the document. Let the default Tab land first.
      clearTimeout(this.#tabCloseTimer);
      this.#tabCloseTimer = setTimeout(() => this.#closePanel(false), 0);
    }
  }

  /**
   * Closes the panel when a click lands outside the control.
   * @param {MouseEvent} e The document-level click event.
   */
  #onOutsideClick(e) {
    if (!this.#container.contains(e.target)) this.#closePanel(false);
  }

  /**
   * Logs an interaction to the `webpage_activity` table. No-op on pages without the shared logger.
   * @param {string} activity The activity string, following the Click_module=<Action> convention.
   */
  #logActivity(activity) {
    window.logWebpageActivity?.(activity);
  }
}
