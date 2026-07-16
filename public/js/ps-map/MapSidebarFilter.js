/**
 * Controls the map filter sidebar UI: Manages state and applies Mapbox filter expressions.
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
  /** @type {HTMLElement[]} */
  #countSpans;
  /** @type {Function[]} */
  #changeCallbacks = [];

  /**
   * Initializes the sidebar filter, binding all event handlers and enabling controls.
   * @param {mapboxgl.Map} map The Mapbox map instance.
   * @param {object} mapData The layer tracker from CreateMapLayerTracker.
   * @param {object} [options] Configuration options.
   * @param {boolean} [options.highQualityFilter=true] Whether to apply the high-quality user filter.
   */
  constructor(map, mapData, { highQualityFilter = true } = {}) {
    this.#map = map;
    this.#mapData = mapData;
    this.#highQualityFilter = highQualityFilter;
    this.#sidebar = document.getElementById('map-sidebar');
    this.#countSpans = Array.from(this.#sidebar.querySelectorAll('.map-sidebar__count'));

    this.#initSeverityToggles();
    this.#initLabelTypeCheckboxes();
    this.#initValidationCheckboxes();
    this.#initAdminValidationCheckbox();
    this.#initStreetCheckboxes();
    this.#initDeselectAllButtons();
    this.#initOnlyButtons();
    this.#initTagToggles();
    this.#initTagPills();
    this.#initSidebarOpenClose();
    this.#initResizeHandle();
    this.#enableAllControls();

    // Sync the streets layer visibility with the initial checkbox state (the streets layer starts hidden).
    filterStreetLayer(this.#map);
    this.#updateCounts();
  }

  /**
   * Registers a callback invoked after any user-driven filter change (clicks — not programmatic applyState calls).
   * @param {Function} callback Called with no arguments.
   */
  onChange(callback) {
    this.#changeCallbacks.push(callback);
  }

  /**
   * Applies a batch of filter selections programmatically (e.g. restored from URL parameters), updating the
   * sidebar controls, mapData, and map layers in one pass. Only the provided sections are changed; onChange
   * subscribers are not notified.
   *
   * @param {object} state Sections to apply.
   * @param {number[]} [state.severities] Severities (0-3) to enable; all others are disabled.
   * @param {string[]} [state.labelTypes] Label type keys to check; all others are unchecked.
   * @param {string[]} [state.validationOptions] Validation checkbox ids to check; all others are unchecked.
   * @param {string[]} [state.tags] Tag names to activate; each also checks its label type, like a pill click.
   * @param {string[]} [state.streets] Street checkbox ids to check; all others are unchecked.
   */
  applyState({ severities, labelTypes, validationOptions, tags, streets } = {}) {
    if (severities) {
      const set = new Set(severities);
      this.#setSeverityToggles((severity) => set.has(severity));
    }
    if (labelTypes) {
      const set = new Set(labelTypes);
      this.#setLabelTypeCheckboxes((labelType) => set.has(labelType));
    }
    if (validationOptions) {
      const set = new Set(validationOptions);
      this.#setValidationCheckboxes((id) => set.has(id));
    }
    if (tags) {
      for (const tag of tags) {
        this.#sidebar.querySelectorAll(`.tag-pill[data-tag="${CSS.escape(tag)}"]`).forEach((pill) => {
          const labelType = pill.dataset.labelType;
          pill.classList.add('tag-pill--active');
          this.#mapData.selectedTags[labelType].add(tag);
          // Selecting a tag implies its label type, matching the pill click path.
          const cb = this.#sidebar.querySelector(`#${labelType}-checkbox`);
          if (cb && !cb.checked) {
            cb.checked = true;
            toggleLabelLayer(labelType, true, this.#map, this.#mapData);
          }
          this.#updateCheckboxPartialState(labelType);
          // Open the drawer so the restored tag selection is visible.
          this.#setTagDrawerExpanded(labelType, true);
        });
      }
    }
    if (streets) {
      const set = new Set(streets);
      this.#setStreetCheckboxes((id) => set.has(id));
      filterStreetLayer(this.#map);
    }

    filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
    ['severity', 'label-type', 'label-validations', 'streets'].forEach((s) => this.#updateDeselectAllButton(s));
    this.#updateCounts();
  }

  /**
   * Returns the current filter selections in a plain serializable form.
   * @returns {object} Arrays per section: severities (numbers 0-3), labelTypes (type keys), validationOptions
   *     (checkbox ids), tags (unique tag names across types), streets (checkbox ids).
   */
  getState() {
    const severities = Object.entries(this.#mapData.severities)
      .filter(([, on]) => on)
      .map(([severity]) => Number(severity));
    const labelTypes = Array.from(this.#sidebar.querySelectorAll('input[data-filter-type="label-type"]:checked'))
      .map((cb) => cb.id.replace('-checkbox', ''));
    const validationOptions = Array.from(
      this.#sidebar.querySelectorAll('input[data-filter-type="label-validations"]:checked'),
    ).map((cb) => cb.id);
    const tags = Array.from(new Set(Object.values(this.#mapData.selectedTags).flatMap((set) => Array.from(set))));
    const streets = Array.from(this.#sidebar.querySelectorAll('input[data-filter-type="streets"]:checked'))
      .map((cb) => cb.id);
    return { severities, labelTypes, validationOptions, tags, streets };
  }

  /**
   * Sets every severity toggle from a predicate, updating mapData, aria-pressed, and the filled/outline icon.
   * @param {Function} isOn Receives the severity number (0-3); returns whether that toggle should be on.
   */
  #setSeverityToggles(isOn) {
    this.#sidebar.querySelectorAll('.severity-button').forEach((toggle) => {
      const severity = Number(toggle.dataset.severity);
      const on = isOn(severity);
      this.#mapData.severities[severity] = on;
      toggle.setAttribute('aria-pressed', String(on));
      const img = toggle.querySelector('.severity-button__icon');
      if (img) img.src = on ? img.dataset.selectedSrc : img.dataset.unselectedSrc;
    });
  }

  /**
   * Sets every label type checkbox from a predicate, syncing layer visibility, tag selections (cleared for types
   * turning off), and the partial-state glyph.
   * @param {Function} isOn Receives the label type key; returns whether that type should be checked.
   */
  #setLabelTypeCheckboxes(isOn) {
    this.#sidebar.querySelectorAll('input[data-filter-type="label-type"]').forEach((cb) => {
      const labelType = cb.id.replace('-checkbox', '');
      const on = isOn(labelType);
      cb.checked = on;
      if (on) {
        this.#updateCheckboxPartialState(labelType);
      } else {
        this.#clearTagsForLabelType(labelType);
      }
      toggleLabelLayer(labelType, on, this.#map, this.#mapData);
    });
  }

  /**
   * Sets every validation checkbox from a predicate, keeping mapData in sync.
   * @param {Function} isOn Receives the checkbox id; returns whether it should be checked.
   */
  #setValidationCheckboxes(isOn) {
    this.#sidebar.querySelectorAll('input[data-filter-type="label-validations"]').forEach((cb) => {
      cb.checked = isOn(cb.id);
      this.#mapData[cb.id] = cb.checked;
    });
  }

  /**
   * Sets every street checkbox from a predicate. Callers re-apply the street layer filter afterwards.
   * @param {Function} isOn Receives the checkbox id; returns whether it should be checked.
   */
  #setStreetCheckboxes(isOn) {
    this.#sidebar.querySelectorAll('input[data-filter-type="streets"]').forEach((cb) => {
      cb.checked = isOn(cb.id);
    });
  }

  /** Recomputes counts and notifies onChange subscribers after a user-driven filter change. */
  #notifyChange() {
    this.#updateCounts();
    this.#changeCallbacks.forEach((callback) => callback());
  }

  /** Binds click handlers to the severity toggle buttons. */
  #initSeverityToggles() {
    this.#sidebar.querySelectorAll('.severity-button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const severity = Number(btn.dataset.severity);
        const newState = !this.#mapData.severities[severity];
        this.#mapData.severities[severity] = newState;

        btn.setAttribute('aria-pressed', String(newState));

        // Swap the icon between filled and outline.
        const img = btn.querySelector('.severity-button__icon');
        if (img) img.src = newState ? img.dataset.selectedSrc : img.dataset.unselectedSrc;

        filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
        this.#updateDeselectAllButton('severity');
        this.#notifyChange();
        const sevValue = severity === 0 ? 'null' : severity;
        this.#log(`Click_module=MapSidebar_Severity${newState ? 'Apply' : 'Unapply'}_severity=${sevValue}`);
      });
    });
  }

  /** Binds click handlers to the label type checkboxes. */
  #initLabelTypeCheckboxes() {
    this.#sidebar.querySelectorAll('input[data-filter-type="label-type"]').forEach((cb) => {
      cb.addEventListener('click', () => {
        const labelType = cb.id.replace('-checkbox', '');
        // Unchecking a label type clears its tag filters.
        if (!cb.checked) this.#clearTagsForLabelType(labelType);
        cb.classList.remove('checkbox--partial');
        toggleLabelLayer(labelType, cb.checked, this.#map, this.#mapData);
        // Reapply filters so stale tag constraints are cleared from the Mapbox layer.
        filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
        this.#updateDeselectAllButton('label-type');
        this.#notifyChange();
        this.#log(`Click_module=MapSidebar_LabelType${cb.checked ? 'Apply' : 'Unapply'}_labelType=${labelType}`);
      });
    });
  }

  /** Binds click handlers to the validation checkboxes. */
  #initValidationCheckboxes() {
    this.#sidebar.querySelectorAll('input[data-filter-type="label-validations"]').forEach((cb) => {
      cb.addEventListener('click', () => {
        filterLabelLayers(cb, this.#map, this.#mapData, this.#highQualityFilter);
        this.#updateDeselectAllButton('label-validations');
        this.#notifyChange();
        this.#log(`Click_module=MapSidebar_ValidationOption${cb.checked ? 'Apply' : 'Unapply'}_option=${cb.id}`);
      });
    });
  }

  /**
   * Binds the admin-only "not validated by an admin" checkbox. No-op on /labelMap, where the checkbox isn't rendered.
   */
  #initAdminValidationCheckbox() {
    const cb = this.#sidebar.querySelector('#not-admin-validated');
    if (!cb) return;
    cb.addEventListener('click', () => {
      this.#mapData.notAdminValidated = cb.checked;
      filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
      this.#notifyChange();
      this.#log(`Click_module=MapSidebar_NotAdminValidated_checked=${cb.checked}`);
    });
  }

  /** Binds click handlers to the street checkboxes. */
  #initStreetCheckboxes() {
    this.#sidebar.querySelectorAll('input[data-filter-type="streets"]').forEach((cb) => {
      cb.addEventListener('click', () => {
        filterStreetLayer(this.#map);
        this.#updateDeselectAllButton('streets');
        this.#notifyChange();
        const street = cb.id.replace('-street', '');
        this.#log(`Click_module=MapSidebar_Street${cb.checked ? 'Apply' : 'Unapply'}_street=${street}`);
      });
    });
  }

  /**
   * Initializes "Deselect all" / "Select all" toggle buttons for each section.
   */
  #initDeselectAllButtons() {
    this.#sidebar.querySelectorAll('.map-sidebar__deselect-all').forEach((btn) => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        const newState = !this.#isAnyActive(section);

        if (section === 'severity') {
          this.#setSeverityToggles(() => newState);
          filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
        } else if (section === 'label-type') {
          this.#setLabelTypeCheckboxes(() => newState);
          // Reapply filters so stale tag constraints are cleared from the Mapbox layers.
          filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
        } else if (section === 'label-validations') {
          this.#setValidationCheckboxes(() => newState);
          filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
        } else if (section === 'streets') {
          this.#setStreetCheckboxes(() => newState);
          filterStreetLayer(this.#map);
        }

        this.#updateDeselectAllButton(section);
        this.#notifyChange();
        this.#log(`Click_module=MapSidebar_${newState ? 'SelectAll' : 'DeselectAll'}_section=${section}`);
      });
    });
  }

  /**
   * Initializes the hover-revealed "Only" buttons that exclusive-select a single option within their section,
   * so isolating one value (e.g. only severity High) is one click instead of "Deselect all" plus a re-click.
   */
  #initOnlyButtons() {
    this.#sidebar.querySelectorAll('.map-sidebar__only').forEach((btn) => {
      // Give the visible "Only" text its row's context for screen readers (e.g. "Only: Obstacle").
      const row = btn.closest('.map-sidebar__item-row, .map-sidebar__item, .map-sidebar__severity-cell');
      const rowLabel = row?.querySelector('label, .severity-button__label')?.textContent.trim();
      if (rowLabel) btn.setAttribute('aria-label', `${i18next.t('common:only')}: ${rowLabel}`);

      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        const value = btn.dataset.value;

        if (section === 'severity') {
          this.#setSeverityToggles((severity) => String(severity) === value);
          filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
        } else if (section === 'label-type') {
          this.#setLabelTypeCheckboxes((labelType) => labelType === value);
          filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
        } else if (section === 'label-validations') {
          this.#setValidationCheckboxes((id) => id === value);
          filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
        } else if (section === 'streets') {
          this.#setStreetCheckboxes((id) => id === value);
          filterStreetLayer(this.#map);
        }

        this.#updateDeselectAllButton(section);
        this.#notifyChange();
        this.#log(`Click_module=MapSidebar_Only_section=${section}_value=${value}`);
      });
    });
  }

  /**
   * Returns true when at least one control in the section is on (checkbox checked, or toggle pressed for severity).
   * @param {string} section The data-section value identifying the section.
   */
  #isAnyActive(section) {
    if (section === 'severity') {
      const toggles = this.#sidebar.querySelectorAll('.severity-button');
      return Array.from(toggles).some((t) => t.getAttribute('aria-pressed') === 'true');
    }
    const checkboxes = this.#sidebar.querySelectorAll(`input[data-filter-type="${section}"]`);
    return Array.from(checkboxes).some((cb) => cb.checked);
  }

  /**
   * Syncs a section's toggle button text: "Deselect all" if any control is active, "Select all" otherwise.
   * @param {string} section The data-section value identifying the button and its controls.
   */
  #updateDeselectAllButton(section) {
    const btn = this.#sidebar.querySelector(`.map-sidebar__deselect-all[data-section="${section}"]`);
    btn.textContent = this.#isAnyActive(section)
      ? i18next.t('labelmap:deselect-all')
      : i18next.t('labelmap:select-all');
  }

  /** Binds click handlers to the tag expand/collapse chevron buttons. */
  #initTagToggles() {
    this.#sidebar.querySelectorAll('.map-sidebar__tag-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        const labelType = btn.closest('.map-sidebar__item')?.querySelector('input[data-filter-type="label-type"]')
          ?.id.replace('-checkbox', '');
        if (labelType) this.#setTagDrawerExpanded(labelType, !expanded);
      });
    });
  }

  /**
   * Expands or collapses a label type's tag drawer, keeping the chevron button's state in sync.
   * @param {string} labelType The label type key.
   * @param {boolean} expanded Whether the drawer should be open.
   */
  #setTagDrawerExpanded(labelType, expanded) {
    const item = this.#sidebar.querySelector(`#${labelType}-checkbox`)?.closest('.map-sidebar__item');
    const btn = item?.querySelector('.map-sidebar__tag-toggle');
    const pillsContainer = item?.querySelector('.map-sidebar__tag-pills');
    if (!btn || !pillsContainer) return;

    btn.setAttribute('aria-expanded', String(expanded));
    const img = btn.querySelector('img');
    if (img) img.src = expanded ? img.dataset.upSrc : img.dataset.downSrc;
    pillsContainer.hidden = !expanded;
  }

  /** Binds click handlers to tag pills to toggle them and update map filters. */
  #initTagPills() {
    this.#sidebar.querySelectorAll('.tag-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const tag = pill.dataset.tag;
        const labelType = pill.dataset.labelType;
        const isActive = pill.classList.toggle('tag-pill--active');

        if (isActive) {
          this.#mapData.selectedTags[labelType].add(tag);
        } else {
          this.#mapData.selectedTags[labelType].delete(tag);
        }

        // If a tag is selected on an unchecked label type, check and show it.
        const cb = this.#sidebar.querySelector(`#${labelType}-checkbox`);
        if (isActive && !cb.checked) {
          cb.checked = true;
          toggleLabelLayer(labelType, true, this.#map, this.#mapData);
          this.#updateDeselectAllButton('label-type');
        }

        // Update the checkbox appearance: dash glyph when partially filtered by tags.
        this.#updateCheckboxPartialState(labelType);

        filterLabelLayers(null, this.#map, this.#mapData, this.#highQualityFilter);
        this.#notifyChange();
        this.#log(`Click_module=MapSidebar_Tag${isActive ? 'Apply' : 'Unapply'}_labelType=${labelType}_tag=${tag}`);
      });
    });
  }

  /**
   * Updates the checkbox to show a partial (gray) state when some tags are selected, or full (black) otherwise.
   * @param {string} labelType The label type key.
   */
  #updateCheckboxPartialState(labelType) {
    const cb = this.#sidebar.querySelector(`#${labelType}-checkbox`);
    const hasActiveTags = this.#mapData.selectedTags[labelType]?.size > 0;
    cb.classList.toggle('checkbox--partial', hasActiveTags);
  }

  /**
   * Clears tag selections for a specific label type.
   * @param {string} labelType The label type key.
   */
  #clearTagsForLabelType(labelType) {
    this.#mapData.selectedTags[labelType]?.clear();
    this.#sidebar.querySelectorAll(`.tag-pill[data-label-type="${labelType}"]`).forEach((pill) => {
      pill.classList.remove('tag-pill--active');
    });
    this.#updateCheckboxPartialState(labelType);
  }

  /** Initializes the sidebar open/close behavior. Padding is set initially by createPSMap. */
  #initSidebarOpenClose() {
    const closeBtn = document.getElementById('map-sidebar-close');
    const openBtn = document.getElementById('map-sidebar-open');
    const handle = document.getElementById('map-sidebar-resize-handle');

    closeBtn.addEventListener('click', () => {
      this.#sidebar.classList.add('map-sidebar--hidden');
      handle.style.display = 'none';
      openBtn.style.display = 'block';
      this.#map.easeTo({ padding: { left: 0, top: 0, right: 0, bottom: 0 } });
      this.#log('Click_module=MapSidebar_Close');
    });
    openBtn.addEventListener('click', () => {
      const width = this.#sidebar.offsetWidth;
      this.#sidebar.classList.remove('map-sidebar--hidden');
      handle.style.display = '';
      openBtn.style.display = 'none';
      this.#map.easeTo({ padding: { left: width, top: 0, right: 0, bottom: 0 } });
      this.#log('Click_module=MapSidebar_Open');
    });
  }

  /** Wires up the drag-to-resize handle on the sidebar's right edge, keeping map centered as you drag. */
  #initResizeHandle() {
    const handle = document.getElementById('map-sidebar-resize-handle');
    if (!handle) return;

    const MIN_WIDTH = 280;
    const MAX_WIDTH = 600;

    // Sync the handle's starting position with the sidebar's rendered width.
    handle.style.left = `${this.#sidebar.offsetWidth}px`;

    const onPointerMove = (e) => {
      const rect = this.#sidebar.getBoundingClientRect();
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX - rect.left));
      this.#sidebar.style.width = `${newWidth}px`;
      handle.style.left = `${newWidth}px`;
      this.#map.setPadding({ left: newWidth, top: 0, right: 0, bottom: 0 });
    };

    const onPointerUp = (e) => {
      handle.releasePointerCapture?.(e.pointerId);
      handle.classList.remove('map-sidebar__resize-handle--dragging');
      document.body.classList.remove('map-sidebar-resizing');
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
    };

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('map-sidebar__resize-handle--dragging');
      document.body.classList.add('map-sidebar-resizing');
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    });
  }

  /**
   * Recomputes and renders the per-option label counts. No-op on pages that don't render count spans.
   *
   * Counts are faceted: each option's count applies every *other* active filter but ignores its own section's
   * on/off state, so it answers "how many labels would this option contribute if it were enabled" and never
   * zeroes out just because the option itself is unchecked.
   */
  #updateCounts() {
    if (this.#countSpans.length === 0) return;

    const typeCounts = {};
    const validationCounts = { correct: 0, incorrect: 0, unsure: 0, unvalidated: 0 };
    for (const [labelType, features] of Object.entries(this.#mapData.sortedLabels)) {
      const typeChecked = this.#sidebar.querySelector(`#${labelType}-checkbox`)?.checked ?? false;
      let count = 0;
      for (const feature of features) {
        const props = feature.properties;
        if (!this.#passesQualityFilters(props)) continue;
        const severityOk = this.#passesSeverity(props);
        const tagsOk = this.#passesTags(labelType, props);
        if (severityOk && tagsOk && this.#mapData[this.#validationCategory(props)]) count += 1;
        if (severityOk && tagsOk && typeChecked) validationCounts[this.#validationCategory(props)] += 1;
      }
      typeCounts[labelType] = count;
    }

    for (const span of this.#countSpans) {
      const key = span.dataset.countFor;
      const count = key in validationCounts ? validationCounts[key] : typeCounts[key] ?? 0;
      span.textContent = count.toLocaleString(i18next.language);
    }
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
   * Logs a sidebar interaction to the `webpage_activity` table. No-op on pages without the shared logger.
   * @param {string} activity The activity string, following the Click_module=<Action> convention.
   */
  #log(activity) {
    window.logWebpageActivity?.(activity);
  }

  /** Enables all disabled controls and removes the loading appearance. */
  #enableAllControls() {
    this.#sidebar.classList.remove('map-sidebar--loading');
    this.#sidebar.querySelectorAll('input[disabled]').forEach((cb) => {
      cb.disabled = false;
    });
  }
}
