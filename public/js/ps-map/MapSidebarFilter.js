/**
 * Applies the shared filter sidebar's state to a Mapbox map.
 *
 * The sidebar itself is FilterSidebar (`common/filter-sidebar/`), which owns the controls and their interaction
 * rules; this class is the map's half of that split. It mirrors the sidebar's state into the `mapData` tracker,
 * rewrites the layer filters, facets the counts, and logs the interaction.
 *
 * Whether the drawer is open is MapSidebarDrawer's, not this class's: that state has to be live from map-ready,
 * and this one can only be built once the label feed has loaded.
 */
class MapSidebarFilter {
  /** @type {mapboxgl.Map} */
  #map;
  /** @type {object} */
  #mapData;
  /** @type {boolean} */
  #highQualityFilter;
  /** @type {HTMLElement} */
  #sidebar;
  /** @type {FilterSidebar} */
  #filters;
  /** @type {boolean} */
  #showsCounts;
  /** @type {boolean} */
  #viewportCounts;
  /** @type {object} Last-applied per-type layer visibility, so unchanged layers aren't re-set on every click. */
  #layerVisibility = {};
  /** @type {Array<() => void>} */
  #changeCallbacks = [];

  /**
   * Initializes the sidebar filter, binding all event handlers and enabling controls.
   * @param {mapboxgl.Map} map The Mapbox map instance.
   * @param {object} mapData The layer tracker from CreateMapLayerTracker.
   * @param {object} [options] Configuration options.
   * @param {boolean} [options.highQualityFilter=true] Whether to apply the high-quality user filter.
   * @param {boolean} [options.viewportCounts=false] Count only labels inside the current viewport. For pages
   *     with viewport-scoped label loading (#5002), where the loaded set is padded beyond the view: the counts
   *     then mean "in the current view" and agree with a view-scoped download. The host page is responsible for
   *     calling refresh() when the data or the viewport changes.
   */
  constructor(map, mapData, { highQualityFilter = true, viewportCounts = false } = {}) {
    this.#map = map;
    this.#mapData = mapData;
    this.#highQualityFilter = highQualityFilter;
    this.#viewportCounts = viewportCounts;
    this.#sidebar = document.getElementById('filter-sidebar');
    this.#showsCounts = this.#sidebar.querySelector('.filter-sidebar__count') !== null;

    this.#filters = new FilterSidebar(this.#sidebar, { onChange: (change) => this.#onFilterChange(change) });

    for (const labelType of Object.keys(this.#mapData.layerNames)) {
      this.#layerVisibility[labelType] = true;
    }

    this.#filters.enable();

    // Sync the streets layer visibility with the initial checkbox state (the streets layer starts hidden).
    filterStreetLayer(this.#map);
    this.#updateCounts();
  }

  /**
   * Registers a callback invoked after a user-driven filter change has been fully applied to the map.
   * Programmatic applyState() calls do not notify, so a subscriber that applies state can't loop back into itself.
   * @param {() => void} callback The callback to invoke.
   */
  onChange(callback) {
    this.#changeCallbacks.push(callback);
  }

  /**
   * Returns the sidebar's current filter state.
   * @returns {{severities: number[], sections: object, tags: object}} FilterSidebar.getState()'s shape.
   */
  getState() {
    return this.#filters.getState();
  }

  /**
   * Returns how many loaded labels the current filters leave visible on the map.
   *
   * Computed on demand (an O(labels) walk) rather than maintained on every filter click, so consumers that only
   * need it occasionally — like the download menu on open — pay for it only then. The spotlighted label's filter
   * bypass is deliberately not counted: it isn't part of the matching data, just a popup affordance.
   *
   * @returns {number} The visible label count across all checked label types.
   */
  getVisibleLabelCount() {
    const bounds = this.#countBounds();
    let total = 0;
    for (const [labelType, features] of Object.entries(this.#mapData.sortedLabels)) {
      if (!(this.#sidebar.querySelector(`#${labelType}-checkbox`)?.checked ?? false)) continue;
      for (const feature of features) {
        const props = feature.properties;
        if (bounds && !bounds.contains(feature.geometry.coordinates)) continue;
        if (!this.#passesQualityFilters(props)) continue;
        if (this.#passesSeverity(props) && this.#passesTags(labelType, props)
          && this.#mapData[this.#validationCategory(props)]) {
          total += 1;
        }
      }
    }
    return total;
  }

  /**
   * Recomputes the faceted counts — the hook for viewport label loading, where the data (a refetch) or the
   * counted area (a pan under viewportCounts) changes without a filter interaction.
   */
  refresh() {
    this.#updateCounts();
  }

  /**
   * Applies a batch of selections (e.g. restored from the URL) to the sidebar controls and the map in one pass.
   * Only the provided sections change; onChange subscribers are not notified.
   *
   * @param {object} [state] The selections to apply.
   * @param {number[]} [state.severities] Severities (0=N/A through 3) to enable; others are disabled.
   * @param {string[]} [state.labelTypes] Label type keys to check; others are unchecked and their tags cleared.
   * @param {string[]} [state.validationOptions] Validation checkbox ids to check; others are unchecked.
   * @param {Array<{labelType: string, tag: string}>} [state.tags] Tag pairs to activate on checked label types.
   * @param {string[]} [state.streets] Street checkbox ids to check; others are unchecked.
   */
  applyState({ severities, labelTypes, validationOptions, tags, streets } = {}) {
    if (severities) {
      const on = new Set(severities);
      this.#filters.setSection(FilterSidebar.SEVERITY, (value) => on.has(Number(value)));
    }
    if (labelTypes) {
      const on = new Set(labelTypes);
      this.#filters.setSection('label-type', (value) => on.has(value), { clearTagsWhenOff: true });
    }
    if (validationOptions) {
      const on = new Set(validationOptions);
      this.#filters.setSection('label-validations', (value) => on.has(value));
    }
    // After labelTypes: applyTags only activates pills on checked types.
    if (tags) this.#filters.applyTags(tags);
    if (streets) {
      const on = new Set(streets);
      this.#filters.setSection('streets', (value) => on.has(value));
      filterStreetLayer(this.#map);
    }

    // One full pipeline pass regardless of which sections changed — the constructor deliberately skips it (the
    // server-rendered defaults already match the tracker's), so this is where restored non-default state lands.
    this.#applyFilters();
  }

  /**
   * Pushes a sidebar change onto the map: mirror the state into mapData, reapply the layer filters, refresh counts.
   * @param {object} change The change descriptor from FilterSidebar.
   */
  #onFilterChange(change) {
    this.#log(change);

    // Streets are a separate Mapbox layer with its own filter, and they carry no label counts.
    if (change.section === 'streets') {
      filterStreetLayer(this.#map);
    } else {
      this.#applyFilters();
    }
    this.#changeCallbacks.forEach((callback) => callback());
  }

  /** Applies the sidebar's label filters to the map layers and refreshes the counts. */
  #applyFilters() {
    const state = this.#filters.getState();
    this.#syncMapData(state);
    this.#syncLayerVisibility(state);
    filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
    this.#updateCounts();
  }

  /**
   * Mirrors the sidebar's state into the mapData tracker that the Mapbox filter expressions are built from.
   * @param {object} state The state from FilterSidebar.getState().
   */
  #syncMapData(state) {
    // Each section is mirrored only when the page actually renders it. A section the sidebar omits has no state to
    // report, and treating that as "nothing selected" would filter the map down to nothing — the admin-only control
    // is absent on the public LabelMap, and a host may drop severity for label types that have none.
    if (this.#sidebar.querySelector('.severity-button')) {
      for (const severity of Object.keys(this.#mapData.severities)) {
        this.#mapData.severities[severity] = state.severities.includes(Number(severity));
      }
    }

    const validations = state.sections['label-validations'];
    if (validations) {
      for (const option of ['correct', 'incorrect', 'unsure', 'unvalidated']) {
        this.#mapData[option] = validations.includes(option);
      }
    }

    // Admin-only filter (#4243), rendered on the admin map tab only.
    const adminOnly = state.sections['admin-validation'];
    if (adminOnly) this.#mapData.notAdminValidated = adminOnly.includes('not-admin-validated');

    for (const [labelType, tags] of Object.entries(state.tags)) {
      const selected = this.#mapData.selectedTags[labelType];
      if (!selected) continue;
      selected.clear();
      tags.forEach((tag) => selected.add(tag));
    }
  }

  /**
   * Shows or hides each label type's layer. Diffed against what's already applied because setting the layout
   * property is a style change, and a batch action like "Only" would otherwise touch all nine layers every click.
   * @param {object} state The state from FilterSidebar.getState().
   */
  #syncLayerVisibility(state) {
    const shown = new Set(state.sections['label-type'] ?? []);
    for (const labelType of Object.keys(this.#mapData.layerNames)) {
      const visible = shown.has(labelType);
      if (this.#layerVisibility[labelType] === visible) continue;
      this.#layerVisibility[labelType] = visible;
      toggleLabelLayer(labelType, visible, this.#map, this.#mapData);
    }
  }

  /**
   * Recomputes and renders the per-option label counts. No-op on pages that don't render count slots.
   *
   * Counts are faceted: each option's count applies every *other* active filter but ignores its own section's
   * on/off state, so it answers "how many labels would this option contribute if it were enabled" and never
   * zeroes out just because the option itself is unchecked.
   */
  #updateCounts() {
    if (!this.#showsCounts) return;

    const bounds = this.#countBounds();
    const typeCounts = {};
    const validationCounts = { correct: 0, incorrect: 0, unsure: 0, unvalidated: 0 };
    for (const [labelType, features] of Object.entries(this.#mapData.sortedLabels)) {
      const typeChecked = this.#sidebar.querySelector(`#${labelType}-checkbox`)?.checked ?? false;
      let count = 0;
      for (const feature of features) {
        const props = feature.properties;
        if (bounds && !bounds.contains(feature.geometry.coordinates)) continue;
        if (!this.#passesQualityFilters(props)) continue;
        const severityOk = this.#passesSeverity(props);
        const tagsOk = this.#passesTags(labelType, props);
        if (severityOk && tagsOk && this.#mapData[this.#validationCategory(props)]) count += 1;
        if (severityOk && tagsOk && typeChecked) validationCounts[this.#validationCategory(props)] += 1;
      }
      typeCounts[labelType] = count;
    }

    // Street counts are whatever loaded — no label filter narrows a street — so they come straight off the tracker.
    const streets = this.#mapData.streetCounts;
    const streetCounts = streets
      ? {
          'audited-street': streets.audited,
          'outdated-street': streets.outdated,
          'unaudited-street': streets.unaudited,
        }
      : {};

    this.#filters.setCounts({ ...typeCounts, ...validationCounts, ...streetCounts });
  }

  /** @returns {?mapboxgl.LngLatBounds} The current viewport under viewportCounts, else null (no restriction). */
  #countBounds() {
    return this.#viewportCounts ? this.#map.getBounds() : null;
  }

  /**
   * Returns true when the label passes the selected severity toggles (toggle 0 covers labels with no severity).
   * @param {object} props The label's GeoJSON properties.
   * @returns {boolean} Whether the label's severity is currently enabled.
   */
  #passesSeverity(props) {
    return Number.isInteger(props.severity)
      ? Boolean(this.#mapData.severities[props.severity])
      : this.#mapData.severities[0];
  }

  /**
   * Returns which validation checkbox a label falls under. Mirrors the Mapbox expressions in filterLabelLayers.
   * @param {object} props The label's GeoJSON properties.
   * @returns {string} One of 'correct', 'incorrect', 'unsure', 'unvalidated'.
   */
  #validationCategory(props) {
    if (props.correct === true) return 'correct';
    if (props.correct === false) return 'incorrect';
    return props.has_validations ? 'unsure' : 'unvalidated';
  }

  /**
   * Returns true when the label passes the page-level quality filters (high-quality users, admin validation).
   * @param {object} props The label's GeoJSON properties.
   * @returns {boolean} Whether the label survives the quality/admin base filters.
   */
  #passesQualityFilters(props) {
    if (this.#highQualityFilter && !this.#mapData.lowQualityUsers && props.high_quality_user !== true) return false;
    if (this.#mapData.notAdminValidated && props.has_admin_validation !== false) return false;
    return true;
  }

  /**
   * Returns true when the label matches the active tag filters for its label type (no tags selected = pass).
   * @param {string} labelType The label type key.
   * @param {object} props The label's GeoJSON properties.
   * @returns {boolean} Whether the label carries at least one of the selected tags.
   */
  #passesTags(labelType, props) {
    const selected = this.#mapData.selectedTags[labelType];
    if (!selected || selected.size === 0) return true;
    const tags = props.tags ?? [];
    return Array.from(selected).some((tag) => tags.includes(tag));
  }

  /**
   * Translates a sidebar change into this page's `Click_module=MapSidebar_*` activity string.
   * @param {object} change The change descriptor from FilterSidebar.
   */
  #log({ kind, section, value, checked, labelType, tag }) {
    const applied = checked ? 'Apply' : 'Unapply';

    if (kind === 'selectAll') {
      this.#logActivity(`Click_module=MapSidebar_${checked ? 'SelectAll' : 'DeselectAll'}_section=${section}`);
    } else if (kind === 'only') {
      this.#logActivity(`Click_module=MapSidebar_Only_section=${section}_value=${value}`);
    } else if (kind === 'tag') {
      this.#logActivity(`Click_module=MapSidebar_Tag${applied}_labelType=${labelType}_tag=${tag}`);
    } else if (section === FilterSidebar.SEVERITY) {
      this.#logActivity(`Click_module=MapSidebar_Severity${applied}_severity=${value === 0 ? 'null' : value}`);
    } else if (section === 'label-type') {
      this.#logActivity(`Click_module=MapSidebar_LabelType${applied}_labelType=${value}`);
    } else if (section === 'label-validations') {
      this.#logActivity(`Click_module=MapSidebar_ValidationOption${applied}_option=${value}`);
    } else if (section === 'streets') {
      this.#logActivity(`Click_module=MapSidebar_Street${applied}_street=${value.replace('-street', '')}`);
    } else if (section === 'admin-validation') {
      this.#logActivity(`Click_module=MapSidebar_NotAdminValidated_checked=${checked}`);
    }
  }

  /**
   * Logs a sidebar interaction to the `webpage_activity` table. No-op on pages without the shared logger.
   * @param {string} activity The activity string, following the Click_module=<Action> convention.
   */
  #logActivity(activity) {
    window.logWebpageActivity?.(activity);
  }
}
