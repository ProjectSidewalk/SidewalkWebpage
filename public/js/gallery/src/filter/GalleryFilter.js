/**
 * The Gallery's half of the shared filter sidebar (#4585).
 *
 * FilterSidebar owns the controls and their interaction rules; this class turns the resulting state into a card
 * query — mirroring the selection into the URL, asking the card container to refetch, and logging the interaction.
 * It also keeps the severity block in step with the selected label type, which decides whether severity applies at
 * all, whether it reads as "Severity" or "Quality", and which smiley set the toggles show.
 *
 * The map's adapter (MapSidebarFilter) is the sibling of this class: same controls, a different way to apply them.
 */
class GalleryFilter {
  /** Validation options shown by default, matching the `/gallery` route's default query param. */
  static #DEFAULT_VALIDATIONS = ['correct', 'unvalidated'];

  /** @type {?HTMLElement} Absent in review-list mode, which renders no filter controls at all (#5444). */
  #root;
  /** @type {?FilterSidebar} Absent with no root; every reader below then answers the empty default. */
  #sidebar = null;
  /** @type {?HTMLButtonElement} Absent in review-list mode — there are no filters to reset. */
  #clearButton;
  /** @type {{currentLabelTypes: string[]}} */
  #status;
  /** @type {Record<string, any>} Filters with no UI of their own, carried through so the URL keeps reporting them. */
  #initialFilters;

  /**
   * Review-list mode renders no sidebar and no reset, so both elements arrive null — but this class is still
   * constructed, because it is the page's only writer of the address bar (it carries `?labelIds=` and the
   * `?labelId=` deep link, #5446) and CardContainer still asks it for the filter state. Every method below is
   * therefore a safe no-op, or answers the empty default, when there is nothing to read.
   *
   * @param {?HTMLElement} root - The sidebar element holding the filter controls, or null when none is rendered.
   * @param {?HTMLButtonElement} clearButton - The button that resets every filter, or null when none is rendered.
   * @param {Record<string, any>} initialFilters - Filters parsed from the URL by the server, passed through the page.
   */
  constructor(root, clearButton, initialFilters) {
    this.#root = root;
    this.#clearButton = clearButton;
    this.#initialFilters = initialFilters;
    this.#status = { currentLabelTypes: [] };

    if (this.#root) {
      this.#sidebar = new FilterSidebar(this.#root, { onChange: (change) => this.#onChange(change) });
      this.#status.currentLabelTypes = this.#selectedLabelTypes();
    }
    if (this.#clearButton) {
      this.#clearButton.addEventListener('click', () => {
        this.clearFilters();
        this.update();
      });
    }

    this.#renderSeverity();
    this.#updateURL();
  }

  /**
   * Applies a sidebar change: log it, follow the label type if it moved, and refetch the cards.
   * @param {FilterSidebarChange} change - The change descriptor from FilterSidebar.
   */
  #onChange(change) {
    this.#log(change);
    this.update();
  }

  /** Pulls the cards and the URL back in line with the sidebar. */
  update() {
    const selected = this.#selectedLabelTypes();
    if (selected.join() !== this.#status.currentLabelTypes.join()) {
      this.#status.currentLabelTypes = selected;
      this.#renderSeverity();
    }
    sg.cardContainer.updateCardsByFilter();
    this.#updateURL();
  }

  /** @returns {string[]} The label types currently checked, in the sidebar's order. */
  #selectedLabelTypes() {
    return this.#sidebar?.getState().sections['label-type'] ?? [];
  }

  /**
   * Rebuilds the severity block for the selected label types: hidden when none of them carries a rating, headed
   * "Quality" only when every one of them reads in the positive direction (a curb ramp's 3 is good news, an
   * obstacle's is bad), and showing whichever smiley set and level names that direction calls for. A selection that
   * mixes the two directions falls back to the neutral severity wording, as the LabelMap's sidebar does.
   */
  #renderSeverity() {
    const types = this.#status.currentLabelTypes;
    const section = this.#root?.querySelector('[data-filter-section="severity"]');
    if (!section) return;

    section.hidden = !types.some((type) => util.misc.labelTypeHasSeverity(type));
    if (section.hidden) return;

    const rated = types.filter((type) => util.misc.labelTypeHasSeverity(type));
    const positive = rated.length > 0 && rated.every((type) => util.misc.isPositiveLabelType(type));
    // A label type whose severity reads in the direction the whole selection reads, for the icons and level names.
    const iconType = positive ? rated[0] : (rated.find((type) => !util.misc.isPositiveLabelType(type)) ?? rated[0]);

    const headingKey = positive ? 'common:quality' : 'common:severity';
    const heading = section.querySelector('.filter-sidebar__heading');
    // The i18n hook moves with the text so a later re-translation pass doesn't put the other word back.
    heading.dataset.i18n = headingKey;
    heading.textContent = i18next.t(headingKey);

    const levelKeys = util.misc.getRatingLevelKeys(iconType);
    for (const btn of section.querySelectorAll('.severity-button')) {
      const severity = Number(btn.dataset.severity);
      const icon = /** @type {HTMLImageElement} */ (btn.querySelector('.severity-button__icon'));
      icon.dataset.selectedSrc = util.misc.getSmileyIconPath(severity, iconType, true);
      icon.dataset.unselectedSrc = util.misc.getSmileyIconPath(severity, iconType, false);
      icon.src = btn.getAttribute('aria-pressed') === 'true' ? icon.dataset.selectedSrc : icon.dataset.unselectedSrc;

      // Severity 0 is the "N/A" bucket, which reads the same either direction.
      if (severity === 0) continue;
      const levelKey = `common:${levelKeys[severity]}`;
      const label = btn.querySelector('.severity-button__label');
      label.dataset.i18n = levelKey;
      label.textContent = i18next.t(levelKey);
      icon.dataset.i18nAlt = levelKey;
      icon.alt = i18next.t(levelKey);
    }
  }

  /** Rewrites the address bar to match the filters, so the view can be linked and reloaded. */
  #updateURL() {
    const params = this.#filterParams();
    // The reset speaks for the filters alone, so the deep link below doesn't make it appear.
    if (this.#clearButton) this.#clearButton.hidden = [...params.keys()].length === 0;

    // The open label is not a filter, but this is the page's only writer of the address bar, so it has to carry the
    // deep link through: rebuilding the URL from the filters alone scrubbed `?labelId=` during the constructor's
    // first pass — before ExpandedView could read it — which left every shared Gallery deep link opening the plain
    // grid (#5446). Read fresh each time, so a filter change (which closes the expanded view and clears the param)
    // correctly drops it.
    const openLabelId = LabelDetail.urlLabelId();
    if (openLabelId) params.set('labelId', String(openLabelId));

    const query = util.url.serialize(params);
    const url = query ? `/gallery?${query}` : '/gallery';
    const fullUrl = `${window.location.protocol}//${window.location.host}${url}`;
    if (fullUrl !== window.location.href) window.history.pushState({}, '', fullUrl);
  }

  /**
   * The `/gallery` query params for the current filters, leaving out every filter that is at its default.
   * @returns {URLSearchParams} The filter params; empty when nothing is filtered.
   */
  #filterParams() {
    const params = new URLSearchParams();

    // Review-list mode (#5444): the list is the whole selection and no filter controls are rendered, so reading the
    // sidebar here would write `severities=&validationOptions=` — claiming filters that aren't being applied — and
    // leaving the list out would scrub it from the address bar on the constructor's first pass. The `!#sidebar`
    // half is what makes this safe to reach with nothing to read: below this point every line needs one.
    const listLabelIds = this.#listLabelIds();
    if (listLabelIds.length > 0 || !this.#sidebar) {
      if (listLabelIds.length > 0) params.set('labelIds', listLabelIds.join());
      return params;
    }

    const severities = this.getAppliedSeverities();
    const valOptions = this.getAppliedValidationOptions().sort();

    // Every type selected is the default, so the param only appears once the selection narrows.
    if (!this.#sidebar.isAllActive('label-type')) {
      params.set('labelType', this.#status.currentLabelTypes.join());
    }
    // Tags belong to a label type, so they only mean something alongside the types they narrow.
    // One occurrence per tag rather than a comma-joined list: tag names are free-form and one of them contains a
    // comma (#4783); see util.url.setRepeated.
    util.url.setRepeated(params, 'tags', this.getAppliedTagNames());
    // TODO once we add a UI for region filtering, have that process mirror what we have for other filters.
    const { regionIds, aiValidationOptions } = this.#initialFilters;
    if (regionIds.length > 0) params.set('regions', regionIds.join());
    if (severities.length !== 4) params.set('severities', severities.join());
    if (valOptions.join() !== GalleryFilter.#DEFAULT_VALIDATIONS.join()) {
      params.set('validationOptions', valOptions.join());
    }
    // TODO once we add a UI for filtering on AI validation, have that process mirror the other filters.
    if (aiValidationOptions.length > 0) params.set('aiValidationOptions', aiValidationOptions.join());

    return params;
  }

  /**
   * Translates a sidebar change into this page's tracker event.
   * @param {FilterSidebarChange} change - The change descriptor from FilterSidebar.
   */
  #log({ kind, section, value, checked, labelType, tag }) {
    if (!sg.tracker) return;
    const severityName = (v) => (Number(v) === 0 ? 'null' : String(v));

    if (kind === 'tag') {
      sg.tracker.push(checked ? 'TagApply' : 'TagUnapply', null, { Tag: tag, Label_Type: labelType });
    } else if (kind === 'only') {
      /** @type {Record<string, string|number>} */
      let notes = { ValidationOption: value };
      if (section === FilterSidebar.SEVERITY) notes = { Severity: severityName(value) };
      else if (section === 'label-type') notes = { Label_Type: value };
      sg.tracker.push(`${GalleryFilter.#eventPrefix(section)}Only`, null, notes);
    } else if (kind === 'selectAll') {
      sg.tracker.push(`${GalleryFilter.#eventPrefix(section)}${checked ? 'SelectAll' : 'DeselectAll'}`);
    } else if (section === FilterSidebar.SEVERITY) {
      sg.tracker.push(checked ? 'SeverityApply' : 'SeverityUnapply', null, { Severity: severityName(value) });
    } else if (section === 'label-type') {
      sg.tracker.push(checked ? 'LabelTypeApply' : 'LabelTypeUnapply', null, { Label_Type: value });
    } else if (section === 'label-validations') {
      sg.tracker.push(checked ? 'ValidationOptionApply' : 'ValidationOptionUnapply', null, {
        ValidationOption: value,
      });
    }
  }

  /**
   * The event-name stem a section's batch actions log under, matching its per-option events.
   * @param {string} section - The section name.
   * @returns {string} The stem, e.g. "Severity" for SeverityOnly / SeveritySelectAll.
   */
  static #eventPrefix(section) {
    if (section === FilterSidebar.SEVERITY) return 'Severity';
    return section === 'label-type' ? 'LabelType' : 'ValidationOption';
  }

  /** @returns {number[]} The review list the page was opened with, or an empty list outside list mode (#5444). */
  #listLabelIds() {
    return this.#initialFilters.labelIds ?? [];
  }

  /** @returns {{currentLabelTypes: string[]}} The label types the cards are being fetched for. */
  getStatus() {
    return this.#status;
  }

  /** @returns {string[]} The selected severities, as the card query spells them ("null" for the N/A bucket). */
  getAppliedSeverities() {
    return (this.#sidebar?.getState().severities ?? []).map((s) => (s === 0 ? 'null' : String(s)));
  }

  /** @returns {Record<string, string[]>} The tags narrowing each selected label type, keyed by type name. */
  getAppliedTagsByType() {
    const tags = this.#sidebar?.getState().tags ?? {};
    return Object.fromEntries(this.#status.currentLabelTypes.map((type) => [type, tags[type] ?? []]));
  }

  /** @returns {string[]} Every tag narrowing something, deduped — what the URL carries and the cards highlight. */
  getAppliedTagNames() {
    return [...new Set(Object.values(this.getAppliedTagsByType()).flat())];
  }

  /** @returns {string[]} The selected validation options. */
  getAppliedValidationOptions() {
    return this.#sidebar?.getState().sections['label-validations'] ?? [];
  }

  /** Blocks interaction with the filters while a page of cards loads. */
  disable() {
    this.#sidebar?.disable();
    // The reset sits outside the sidebar (see gallery.scala.html), so it needs disabling on its own.
    if (this.#clearButton) this.#clearButton.disabled = true;
  }

  /** Restores interaction with the filters. */
  enable() {
    this.#sidebar?.enable();
    if (this.#clearButton) this.#clearButton.disabled = false;
  }

  /** Resets every filter to its default state. Callers follow with update() to apply it. */
  clearFilters() {
    if (!this.#sidebar) return;
    this.#sidebar.clearAllTags();
    this.#sidebar.setSection('label-type', () => true);
    this.#sidebar.setSection(FilterSidebar.SEVERITY, () => true);
    this.#sidebar.setSection('label-validations', (v) => GalleryFilter.#DEFAULT_VALIDATIONS.includes(v));
  }
}
