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

import { sg } from '../sg.js';
import { FilterSidebar } from '../../common/filter-sidebar/FilterSidebar.js';
import { LabelDetail } from '../../common/label-detail/LabelDetail.js';
import { util } from '../../common/utilities.js';
import { isSorted, RANDOM_SORT, sortMootReason } from '../cards/cardOrder.js';
import '../../common/urlQuery.js';
import '../../common/utilitiesSidewalk.js';
/** @typedef {import('../../common/filter-sidebar/FilterSidebar.js').FilterSidebarChange} FilterSidebarChange */

export class GalleryFilter {
  /** Validation options shown by default, matching the `/gallery` route's default query param. */
  static #DEFAULT_VALIDATIONS = ['correct', 'unvalidated'];

  /** @type {?HTMLElement} Absent in review-list mode, which renders no filter controls at all (#5444). */
  #root;
  /** @type {?FilterSidebar} Absent with no root; every reader below then answers the empty default. */
  #sidebar = null;
  /** @type {?HTMLButtonElement} Absent in review-list mode — there are no filters to reset. */
  #clearButton;
  /**
   * @type {?HTMLSelectElement} The admin's "Sort by" (#2705). Absent for everyone else and in review-list mode, and
   * then the Gallery is in its random order.
   */
  #sortSelect;
  /** Whether the select had focus when the filters were last disabled, so enable() can hand it back. */
  #sortHadFocus = false;
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
   * @param {?HTMLSelectElement} [sortSelect] - The admin's "Sort by" select, or null when none is rendered.
   */
  constructor(root, clearButton, initialFilters, sortSelect = null) {
    this.#root = root;
    this.#clearButton = clearButton;
    this.#sortSelect = sortSelect;
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
    if (this.#sortSelect) {
      this.#sortSelect.addEventListener('change', () => {
        sg.tracker?.push('SortApply', null, { Sort: this.getSort() });
        this.renderSortStatus();
        sg.cardContainer.updateCardsBySort();
        this.#updateURL();
      });
    }

    this.#renderSeverity();
    // The server renders the footer for the order the page opened in but can't know whether the filters leave that
    // order anything to rank, so the status is settled here as soon as the controls exist.
    this.renderSortStatus();
    this.#updateURL();
  }

  /**
   * The order the cards are in: the select's value, or the random default when there is no select.
   * @returns {string} A `GallerySort` wire name.
   */
  getSort() {
    return this.#sortSelect?.value || RANDOM_SORT;
  }

  /**
   * Why the current sort can't tell the filtered labels apart, or null when it can (or there is no sort).
   * @returns {?string} A `sortMootReason` value.
   */
  getSortMootReason() {
    const sort = this.getSort();
    if (!isSorted(sort)) return null;
    const types = this.#status.currentLabelTypes;
    const anyRatedType = types.some((type) => util.misc.labelTypeHasSeverity(type));
    return sortMootReason(sort, {
      validations: this.getAppliedValidationOptions(),
      severities: anyRatedType ? this.getAppliedSeverities() : undefined,
      anyRatedType,
    });
  }

  /**
   * Restates what the page says about its order, in the page's language: the footer's "Labels are sorted …" line,
   * and the note under the select that appears when the filters leave the sort nothing to rank. The choice itself
   * is left alone in that case — greying the option out would have to snap the sort back to Random and rewrite the
   * URL under the admin — so the page says what it is actually showing instead of claiming an order it isn't in.
   */
  renderSortStatus() {
    const sort = this.getSort();
    const reason = this.getSortMootReason();
    const sortName = i18next.t(`gallery:sort-${sort.replaceAll('_', '-')}`);

    // The note stays in the document, empty, when there is nothing to say: a live region that is hidden until it
    // has text is outside the accessibility tree at the moment the text lands, and so is not announced.
    const note = document.getElementById('gallery-sort-note');
    if (note) note.textContent = reason === null ? '' : i18next.t(`gallery:sort-moot-${reason}`);

    const footer = document.getElementById('gallery-footer');
    if (!footer) return;
    if (!isSorted(sort)) footer.textContent = i18next.t('gallery:cards');
    else if (reason !== null) footer.textContent = i18next.t('gallery:cards-sorted-moot', { sort: sortName });
    else footer.textContent = i18next.t('gallery:cards-sorted', { sort: sortName });
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
    // A filter change can give a sort something to rank, or take it away.
    this.renderSortStatus();
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
    // The reset speaks for the filters alone, so neither the sort nor the deep link below makes it appear.
    if (this.#clearButton) this.#clearButton.hidden = [...params.keys()].length === 0;

    // An order is not a filter: it rides in the URL so the view reloads and links as seen, but it is not counted
    // above and the reset leaves it alone. Random is the default and is left out, as a default filter is.
    const sort = this.getSort();
    if (isSorted(sort)) params.set('sort', sort);

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
    // half is belt and braces — the view renders the sidebar exactly when the list is empty, so the first half
    // already covers it — but every line below here needs a sidebar, so it stays.
    const listLabelIds = this.#listLabelIds();
    if (listLabelIds.length > 0 || !this.#sidebar) {
      if (listLabelIds.length > 0) {
        // The ids the URL asked for, not the ones the page is showing: what the page carries is what the server
        // kept, capped at MaxLabelIds, so writing from that would rewrite a 600-id link down to 500 — under a
        // strip that is at that moment reporting 100 as dropped. (The value is re-serialized, so an encoded space
        // comes back as "+"; what matters is that the ids are the ones that arrived.) A URL with no labelIds at
        // all is the only case written from the parsed list.
        const asGiven = new URLSearchParams(window.location.search).get('labelIds');
        params.set('labelIds', asGiven ?? listLabelIds.join());
      }
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
    // The reset and the sort sit outside the sidebar (see gallery.scala.html), so they need disabling on their own.
    if (this.#clearButton) this.#clearButton.disabled = true;
    if (this.#sortSelect) {
      // Disabling the focused element drops focus to the body, and a keyboard user stepping a closed select with the
      // arrow keys fires a change (and so this) on every step, so without remembering it they would lose the select
      // after one step and have no way to reach the next option.
      this.#sortHadFocus = document.activeElement === this.#sortSelect;
      this.#sortSelect.disabled = true;
    }
  }

  /** Restores interaction with the filters. */
  enable() {
    this.#sidebar?.enable();
    if (this.#clearButton) this.#clearButton.disabled = false;
    if (this.#sortSelect) {
      this.#sortSelect.disabled = false;
      if (this.#sortHadFocus) this.#sortSelect.focus();
      this.#sortHadFocus = false;
    }
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
