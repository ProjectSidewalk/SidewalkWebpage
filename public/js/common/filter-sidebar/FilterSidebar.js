/**
 * Host-agnostic controller for the shared filter sidebar (#4585).
 *
 * Owns the sidebar's interaction rules — toggling an option, select/deselect all, the "Only" affordance, tag pills
 * and their drawers, the indeterminate glyph, count rendering — and knows nothing about what the filters filter.
 * Hosts subscribe with `onChange` and apply `getState()` however they like: LabelMap rewrites Mapbox layer filters
 * in place, the Gallery re-queries the server. That split is the point: the two differ in how filters are *applied*,
 * not in how they are *chosen*.
 *
 * The DOM is the single source of truth for filter state — checkbox `checked`, `aria-pressed` on severity toggles,
 * and the `tag-pill--active` class — so there is no second copy that can drift out of sync with what's on screen.
 *
 * Sections are discovered from the markup: every `input[data-filter-type="<section>"]` belongs to that section, and
 * the severity toggles form a section of their own ("severity") because they're buttons rather than checkboxes.

 */
class FilterSidebar {
  /** Section name for the severity toggles, which are buttons rather than checkboxes. */
  static SEVERITY = 'severity';

  /** @type {HTMLElement} */
  #root;
  /** @type {(change: object) => void} */
  #onChange;
  /** @type {{selectAll: string, deselectAll: string, only: string}} */
  #i18nKeys;

  /**
   * @param {HTMLElement} root The sidebar element containing the filter controls.
   * @param {object} [options] Configuration options.
   * @param {(change: object) => void} [options.onChange] Called after every interaction, with a change descriptor:
   *      `{kind, section, value, checked, labelType, tag, typeTurnedOn}`. `kind` is 'option', 'selectAll', 'only',
   *      or 'tag'. Read `getState()` inside the callback for the resulting filter state.
   * @param {object} [options.i18nKeys] Overrides for the i18next keys of the section actions.
   */
  constructor(root, { onChange = () => {}, i18nKeys = {} } = {}) {
    this.#root = root;
    this.#onChange = onChange;
    this.#i18nKeys = {
      selectAll: 'labelmap:select-all',
      deselectAll: 'labelmap:deselect-all',
      only: 'common:only',
      ...i18nKeys,
    };

    this.#initSeverityToggles();
    this.#initOptionCheckboxes();
    this.#initSelectAllButtons();
    this.#initOnlyButtons();
    this.#initTagToggles();
    this.#initTagPills();

    // The markup ships a fixed label, but a section whose defaults aren't all-on (validations, where "incorrect"
    // starts off) already wants "Select all" on arrival.
    this.#root.querySelectorAll('.filter-sidebar__deselect-all').forEach((btn) => {
      this.#syncSectionAction(btn.dataset.section);
    });

    // A type can arrive already narrowed by tags — the Gallery renders the URL's tags as applied — and its glyph
    // has to say so from the first paint, not from the first click.
    this.#optionsIn('label-type').forEach((cb) => this.#syncPartialGlyph(FilterSidebar.#valueOf(cb)));
  }

  /**
   * Returns the current filter state, read straight off the DOM.
   *
   * @returns {{severities: number[], sections: object, tags: object}} Enabled severities; per-section arrays of the
   *      selected values (label types as bare type names, everything else as control ids); and the active tags of
   *      every label type, including types with none selected so hosts can clear stale tag filters.
   */
  getState() {
    const severities = this.#severityButtons()
      .filter((btn) => btn.getAttribute('aria-pressed') === 'true')
      .map((btn) => Number(btn.dataset.severity));

    const sections = {};
    for (const cb of this.#root.querySelectorAll('input[data-filter-type]')) {
      const section = cb.dataset.filterType;
      sections[section] ??= [];
      if (cb.checked) sections[section].push(FilterSidebar.#valueOf(cb));
    }

    const tags = {};
    for (const cb of this.#optionsIn('label-type')) {
      tags[FilterSidebar.#valueOf(cb)] = [];
    }
    for (const pill of this.#root.querySelectorAll('.tag-pill--active')) {
      tags[pill.dataset.labelType]?.push(pill.dataset.tag);
    }

    return { severities, sections, tags };
  }

  /**
   * Renders per-option counts into the sidebar's count slots. Hosts compute the numbers — the map facets its loaded
   * labels, a server-backed host would ask the backend — because only they know what "how many" means.
   *
   * @param {object} countsByValue Map of control value (label type or option id) to count.
   */
  setCounts(countsByValue) {
    for (const span of this.#root.querySelectorAll('.filter-sidebar__count')) {
      const count = countsByValue[span.dataset.countFor];
      if (count === undefined) continue;
      span.textContent = count.toLocaleString(i18next.language);
    }
  }

  /** Drops the loading appearance and enables the controls, which render disabled until their data has loaded. */
  enable() {
    this.#root.classList.remove('filter-sidebar--loading');
    this.#root.querySelectorAll('input[disabled]').forEach((cb) => {
      cb.disabled = false;
    });
  }

  /** Puts the controls back into the loading appearance, e.g. while a host refetches what the filters select. */
  disable() {
    this.#root.classList.add('filter-sidebar--loading');
    this.#root.querySelectorAll('input[data-filter-type]').forEach((cb) => {
      cb.disabled = true;
    });
  }

  /**
   * Returns true when at least one control in the section is on.
   * @param {string} section The section name (a `data-filter-type` value, or 'severity').
   * @returns {boolean} Whether anything in the section is currently selected.
   */
  isAnyActive(section) {
    if (section === FilterSidebar.SEVERITY) {
      return this.#severityButtons().some((btn) => btn.getAttribute('aria-pressed') === 'true');
    }
    return this.#optionsIn(section).some((cb) => cb.checked);
  }

  /**
   * Returns true when every control in the section is on.
   * @param {string} section The section name (a `data-filter-type` value, or 'severity').
   * @returns {boolean} Whether the section is fully selected.
   */
  isAllActive(section) {
    if (section === FilterSidebar.SEVERITY) {
      return this.#severityButtons().every((btn) => btn.getAttribute('aria-pressed') === 'true');
    }
    return this.#optionsIn(section).every((cb) => cb.checked);
  }

  /** Binds the severity toggle buttons, which carry their state in aria-pressed and swap filled/outline icons. */
  #initSeverityToggles() {
    this.#severityButtons().forEach((btn) => {
      btn.addEventListener('click', () => {
        const checked = btn.getAttribute('aria-pressed') !== 'true';
        this.#setSeverityButton(btn, checked);
        this.#syncSectionAction(FilterSidebar.SEVERITY);
        this.#onChange({
          kind: 'option', section: FilterSidebar.SEVERITY, value: Number(btn.dataset.severity), checked,
        });
      });
    });
  }

  /**
   * Binds every option control, in whatever section it belongs to. Bound to `change` rather than `click` so that
   * only a control whose state actually moved reports one — a host refetches on the strength of these.
   */
  #initOptionCheckboxes() {
    this.#root.querySelectorAll('input[data-filter-type]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const section = cb.dataset.filterType;
        const value = FilterSidebar.#valueOf(cb);
        // Hiding a label type drops its tag filters: a tag narrows a type that is being shown, so keeping them would
        // leave an invisible constraint waiting to surprise the user when they turn the type back on.
        if (section === 'label-type' && !cb.checked) this.clearTags(value);
        this.#syncSectionAction(section);
        this.#onChange({ kind: 'option', section, value, checked: cb.checked });
      });
    });
  }

  /**
   * Expands or collapses one label type's tag drawer, keeping the chevron's direction and ARIA state in step.
   * @param {HTMLElement} item The label type's list item.
   * @param {boolean} expanded Whether the drawer should end up open.
   */
  #setDrawer(item, expanded) {
    const pills = item.querySelector('.filter-sidebar__tag-pills');
    const btn = item.querySelector('.filter-sidebar__tag-toggle');
    if (!pills || !btn) return;
    btn.setAttribute('aria-expanded', String(expanded));
    const img = btn.querySelector('img');
    if (img) img.src = expanded ? img.dataset.upSrc : img.dataset.downSrc;
    pills.hidden = !expanded;
  }

  /** Binds the per-section action that flips the whole section on or off. */
  #initSelectAllButtons() {
    this.#root.querySelectorAll('.filter-sidebar__deselect-all').forEach((btn) => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        // Offer the action with the most left to give: once anything is off — one "Only" click, say — restoring the
        // section is more useful than clearing what little is left, so the button becomes "Select all".
        const checked = !this.isAllActive(section);
        this.setSection(section, () => checked);
        if (section === 'label-type' && !checked) this.clearAllTags();
        this.#onChange({ kind: 'selectAll', section, checked });
      });
    });
  }

  /** Binds the hover-revealed "Only" buttons, which exclusive-select one value within their section. */
  #initOnlyButtons() {
    this.#root.querySelectorAll('.filter-sidebar__only').forEach((btn) => {
      // Give the visible "Only" text its row's context for screen readers (e.g. "Only: Obstacle").
      const row = btn.closest('.filter-sidebar__item-row, .filter-sidebar__item, .filter-sidebar__severity-cell');
      const rowLabel = row?.querySelector('.filter-sidebar__item-name, label, .severity-button__label')
        ?.textContent.trim();
      if (rowLabel) btn.setAttribute('aria-label', `${i18next.t(this.#i18nKeys.only)}: ${rowLabel}`);

      btn.addEventListener('click', () => {
        const { section, value } = btn.dataset;
        this.setSection(section, (candidate) => String(candidate) === value, { clearTagsWhenOff: true });
        this.#onChange({ kind: 'only', section, value });
      });
    });
  }

  /**
   * Sets every control in a section from a predicate.
   *
   * @param {string} section The section name.
   * @param {(value: string) => boolean} isOn Given a control's value, whether it should end up selected.
   * @param {object} [options] Configuration options.
   * @param {boolean} [options.clearTagsWhenOff=false] Whether to drop the tag filters of label types turned off.
   */
  setSection(section, isOn, { clearTagsWhenOff = false } = {}) {
    if (section === FilterSidebar.SEVERITY) {
      this.#severityButtons().forEach((btn) => this.#setSeverityButton(btn, isOn(btn.dataset.severity)));
      this.#syncSectionAction(section);
      return;
    }
    this.#optionsIn(section).forEach((cb) => {
      const value = FilterSidebar.#valueOf(cb);
      cb.checked = isOn(value);
      if (section !== 'label-type') return;
      if (!cb.checked && clearTagsWhenOff) this.clearTags(value);
      // Derived from the pills rather than blanket-cleared: a type that keeps its tags must keep its dash, or the
      // glyph would claim the type is unfiltered while the tag filter is still narrowing it.
      this.#syncPartialGlyph(value);
    });
    this.#syncSectionAction(section);
  }

  /** Binds the chevrons that expand and collapse a label type's tag drawer. */
  #initTagToggles() {
    this.#root.querySelectorAll('.filter-sidebar__tag-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.filter-sidebar__item');
        if (item) this.#setDrawer(item, btn.getAttribute('aria-expanded') !== 'true');
      });
    });
  }

  /** Binds the tag pills that narrow a label type to labels carrying one of the selected tags. */
  #initTagPills() {
    this.#root.querySelectorAll('.tag-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const { tag, labelType } = pill.dataset;
        const checked = pill.classList.toggle('tag-pill--active');

        // Selecting a tag on a hidden label type turns the type back on; otherwise the tag filter would silently
        // narrow nothing.
        const cb = this.#checkboxFor(labelType);
        const typeTurnedOn = Boolean(checked && cb && !cb.checked);
        if (typeTurnedOn) {
          cb.checked = true;
          this.#syncSectionAction('label-type');
        }

        this.#syncPartialGlyph(labelType);
        this.#onChange({ kind: 'tag', section: 'label-type', labelType, tag, checked, typeTurnedOn });
      });
    });
  }

  /**
   * Clears the tag filters of one label type.
   * @param {string} labelType The label type key.
   */
  clearTags(labelType) {
    this.#root.querySelectorAll(`.tag-pill[data-label-type="${labelType}"]`).forEach((pill) => {
      pill.classList.remove('tag-pill--active');
    });
    this.#syncPartialGlyph(labelType);
  }

  /** Clears every tag filter in the sidebar. */
  clearAllTags() {
    this.#root.querySelectorAll('.tag-pill--active').forEach((pill) => {
      pill.classList.remove('tag-pill--active');
    });
    this.#root.querySelectorAll('.checkbox--partial').forEach((cb) => {
      cb.classList.remove('checkbox--partial');
    });
  }

  /**
   * Swaps a section action between "Deselect all" and "Select all" to match what the click would do. No-op for
   * sections that don't render one (the admin-only filter).
   * @param {string} section The section name.
   */
  #syncSectionAction(section) {
    const btn = this.#root.querySelector(`.filter-sidebar__deselect-all[data-section="${section}"]`);
    if (!btn) return;
    btn.textContent = this.isAllActive(section)
      ? i18next.t(this.#i18nKeys.deselectAll)
      : i18next.t(this.#i18nKeys.selectAll);
  }

  /** Shows the indeterminate glyph on a label type that active tags are narrowing. */
  #syncPartialGlyph(labelType) {
    const cb = this.#checkboxFor(labelType);
    const hasActiveTags = this.#root.querySelector(`.tag-pill--active[data-label-type="${labelType}"]`) !== null;
    cb?.classList.toggle('checkbox--partial', hasActiveTags);
  }

  /** Applies a severity toggle's on/off state to both its ARIA state and its filled/outline icon. */
  #setSeverityButton(btn, on) {
    btn.setAttribute('aria-pressed', String(on));
    const img = btn.querySelector('.severity-button__icon');
    if (img) img.src = on ? img.dataset.selectedSrc : img.dataset.unselectedSrc;
  }

  /** @returns {HTMLElement[]} The severity toggle buttons. */
  #severityButtons() {
    return Array.from(this.#root.querySelectorAll('.severity-button'));
  }

  /**
   * @param {string} section The section name.
   * @returns {HTMLInputElement[]} The section's option checkboxes.
   */
  #optionsIn(section) {
    return Array.from(this.#root.querySelectorAll(`input[data-filter-type="${section}"]`));
  }

  /**
   * @param {string} labelType The label type key.
   * @returns {?HTMLInputElement} That label type's checkbox, or null on pages that don't render it.
   */
  #checkboxFor(labelType) {
    return this.#root.querySelector(`#${labelType}-checkbox`);
  }

  /**
   * A control's semantic value: label types drop the `-checkbox` suffix their ids carry, everything else is its id.
   * @param {HTMLInputElement} cb The option checkbox.
   * @returns {string} The value hosts filter on.
   */
  static #valueOf(cb) {
    return cb.dataset.filterType === 'label-type' ? cb.id.replace('-checkbox', '') : cb.id;
  }
}
