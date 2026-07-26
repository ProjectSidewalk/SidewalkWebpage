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
  /** The label type meaning "all of them", which the sidebar renders as the first row. */
  static DEFAULT_LABEL_TYPE = 'Assorted';

  /** Validation options shown by default, matching the `/gallery` route's default query param. */
  static #DEFAULT_VALIDATIONS = ['correct', 'unvalidated'];

  /** @type {HTMLElement} */
  #root;
  /** @type {FilterSidebar} */
  #sidebar;
  /** @type {HTMLElement} */
  #clearButton;
  /** @type {{currentLabelType: string}} */
  #status;
  /** @type {object} Filters with no UI of their own, carried through so the URL keeps reporting them. */
  #initialFilters;

  /**
   * @param {HTMLElement} root The sidebar element holding the filter controls.
   * @param {HTMLElement} clearButton The button that resets every filter to its default.
   * @param {object} initialFilters Filters parsed from the URL by the server, passed through the page.
   */
  constructor(root, clearButton, initialFilters) {
    this.#root = root;
    this.#clearButton = clearButton;
    this.#initialFilters = initialFilters;
    this.#status = { currentLabelType: initialFilters.labelType };

    this.#sidebar = new FilterSidebar(root, { onChange: (change) => this.#onChange(change) });

    this.#clearButton.addEventListener('click', () => {
      this.clearFilters();
      this.update();
    });

    this.#renderSeverity();
    this.#updateURL();
  }

  /**
   * Applies a sidebar change: log it, follow the label type if it moved, and refetch the cards.
   * @param {object} change The change descriptor from FilterSidebar.
   */
  #onChange(change) {
    this.#log(change);
    this.update();
  }

  /** Pulls the cards and the URL back in line with the sidebar. */
  update() {
    const selected = this.#sidebar.selectedIn('label-type') ?? GalleryFilter.DEFAULT_LABEL_TYPE;
    if (selected !== this.#status.currentLabelType) {
      this.#status.currentLabelType = selected;
      this.#renderSeverity();
    }
    sg.cardContainer.updateCardsByFilter();
    this.#updateURL();
  }

  /**
   * Rebuilds the severity block for the current label type: hidden for the types that carry no rating, headed
   * "Quality" for the positive types (a curb ramp's 3 is good news, an obstacle's is bad), and showing whichever
   * smiley set and level names that direction calls for.
   */
  #renderSeverity() {
    const labelType = this.#status.currentLabelType;
    const section = this.#root.querySelector('[data-filter-section="severity"]');
    if (!section) return;

    section.hidden = !util.misc.labelTypeHasSeverity(labelType);
    if (section.hidden) return;

    const headingKey = util.misc.isPositiveLabelType(labelType) ? 'common:quality' : 'common:severity';
    const heading = section.querySelector('.filter-sidebar__heading');
    // The i18n hook moves with the text so a later re-translation pass doesn't put the other word back.
    heading.dataset.i18n = headingKey;
    heading.textContent = i18next.t(headingKey);

    const levelKeys = util.misc.getRatingLevelKeys(labelType);
    for (const btn of section.querySelectorAll('.severity-button')) {
      const severity = Number(btn.dataset.severity);
      const icon = btn.querySelector('.severity-button__icon');
      icon.dataset.selectedSrc = util.misc.getSmileyIconPath(severity, labelType, true);
      icon.dataset.unselectedSrc = util.misc.getSmileyIconPath(severity, labelType, false);
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
    const url = this.#buildCurrentURL();
    this.#clearButton.hidden = url === '/gallery';

    const fullUrl = `${window.location.protocol}//${window.location.host}${url}`;
    if (fullUrl !== window.location.href) window.history.pushState({}, '', fullUrl);
  }

  /**
   * Builds the `/gallery` URL for the current filters, leaving out every filter that is at its default.
   * @returns {string} The path, with a query string when anything is filtered.
   */
  #buildCurrentURL() {
    const params = new URLSearchParams();
    const severities = this.getAppliedSeverities();
    const valOptions = this.getAppliedValidationOptions().sort();

    if (this.#status.currentLabelType !== GalleryFilter.DEFAULT_LABEL_TYPE) {
      params.set('labelType', this.#status.currentLabelType);
      // Tags belong to one label type, so they only mean something alongside a chosen type.
      const tags = this.getAppliedTagNames();
      if (tags.length > 0) params.set('tags', tags.join());
    }
    // TODO once we add a UI for neighborhood filtering, have that process mirror what we have for other filters.
    const { neighborhoods, aiValidationOptions } = this.#initialFilters;
    if (neighborhoods.length > 0) params.set('neighborhoods', neighborhoods.join());
    if (severities.length !== 4) params.set('severities', severities.join());
    if (valOptions.join() !== GalleryFilter.#DEFAULT_VALIDATIONS.join()) {
      params.set('validationOptions', valOptions.join());
    }
    // TODO once we add a UI for filtering on AI validation, have that process mirror the other filters.
    if (aiValidationOptions.length > 0) params.set('aiValidationOptions', aiValidationOptions.join());

    // Commas are legal unencoded in a query value, and these params are comma-separated lists, so leaving them
    // readable keeps the shared URLs legible without changing what the server parses.
    const query = params.toString().replace(/%2C/g, ',');
    return query ? `/gallery?${query}` : '/gallery';
  }

  /**
   * Translates a sidebar change into this page's tracker event.
   * @param {object} change The change descriptor from FilterSidebar.
   */
  #log({ kind, section, value, checked, labelType, tag }) {
    if (!sg.tracker) return;
    const severityName = (v) => (Number(v) === 0 ? 'null' : String(v));

    if (kind === 'tag') {
      sg.tracker.push(checked ? 'TagApply' : 'TagUnapply', null, { Tag: tag, Label_Type: labelType });
    } else if (kind === 'only') {
      if (section === FilterSidebar.SEVERITY) {
        sg.tracker.push('SeverityOnly', null, { Severity: severityName(value) });
      } else {
        sg.tracker.push('ValidationOptionOnly', null, { ValidationOption: value });
      }
    } else if (kind === 'selectAll') {
      const action = checked ? 'SelectAll' : 'DeselectAll';
      sg.tracker.push(section === FilterSidebar.SEVERITY ? `Severity${action}` : `ValidationOption${action}`);
    } else if (section === FilterSidebar.SEVERITY) {
      sg.tracker.push(checked ? 'SeverityApply' : 'SeverityUnapply', null, { Severity: severityName(value) });
    } else if (section === 'label-type') {
      sg.tracker.push(`Filter_LabelType=${value}`);
    } else if (section === 'label-validations') {
      sg.tracker.push(checked ? 'ValidationOptionApply' : 'ValidationOptionUnapply', null, {
        ValidationOption: value,
      });
    }
  }

  /** @returns {{currentLabelType: string}} The label type the cards are being fetched for. */
  getStatus() {
    return this.#status;
  }

  /** @returns {string[]} The selected severities, as the card query spells them ("null" for the N/A bucket). */
  getAppliedSeverities() {
    return this.#sidebar.getState().severities.map((s) => (s === 0 ? 'null' : String(s)));
  }

  /** @returns {string[]} The tags narrowing the current label type. */
  getAppliedTagNames() {
    return this.#sidebar.getState().tags[this.#status.currentLabelType] ?? [];
  }

  /** @returns {string[]} The selected validation options. */
  getAppliedValidationOptions() {
    return this.#sidebar.getState().sections['label-validations'] ?? [];
  }

  /** Blocks interaction with the filters while a page of cards loads. */
  disable() {
    this.#sidebar.disable();
  }

  /** Restores interaction with the filters. */
  enable() {
    this.#sidebar.enable();
  }

  /** Resets every filter to its default state. Callers follow with update() to apply it. */
  clearFilters() {
    this.#sidebar.clearAllTags();
    this.#sidebar.setSection('label-type', (value) => value === GalleryFilter.DEFAULT_LABEL_TYPE);
    this.#sidebar.setSection(FilterSidebar.SEVERITY, () => true);
    this.#sidebar.setSection('label-validations', (v) => GalleryFilter.#DEFAULT_VALIDATIONS.includes(v));
  }
}
