/**
 * Collapsible legend ("map key") for the Explore minimap. Collapsed, it's a small pill showing the route marks
 * themselves; expanded, a card names each mark. Defaults to collapsed; the user opens it from the pill (#4639).
 *
 * The card also carries the "My earlier labels" checkbox (#4945), which shows or hides the dimmed markers of labels
 * the user placed in earlier missions here; the labels themselves are untouched.
 */
class MinimapLegend {
  #uiMinimap;
  #tracker;
  #expanded = false;

  /**
   * @param {Record<string, HTMLElement>} uiMinimap - The svl.ui.minimap object holding the minimap's DOM elements.
   * @param {Tracker} tracker - Interaction logger.
   */
  constructor(uiMinimap, tracker) {
    this.#uiMinimap = uiMinimap;
    this.#tracker = tracker;

    uiMinimap.legendToggle.addEventListener('click', () => this.#setExpanded(true, 'Click_MinimapLegend_Open'));
    uiMinimap.legendClose.addEventListener('click', () => this.#setExpanded(false, 'Click_MinimapLegend_Close'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.#expanded) this.#setExpanded(false, 'MinimapLegend_EscapeClose');
    });

    // The checkbox reflects the remembered preference from the first paint; the markers it governs are created later
    // (LabelContainer.fetchLabelsToResumeMission applies the same preference to them).
    const earlierLabels = /** @type {HTMLInputElement} */ (uiMinimap.legendEarlierLabels);
    earlierLabels.checked = LabelContainer.earlierLabelsShownPreference();
    earlierLabels.addEventListener('change', (e) => {
      svl.labelContainer.setEarlierLabelsShown(/** @type {HTMLInputElement} */ (e.target).checked);
    });
  }

  /**
   * Expands or collapses the legend, keeping the toggle's ARIA state in sync.
   * @param {boolean} expanded - Whether the card should be visible.
   * @param {string} [logEvent] - Tracker event to record, if this was user-initiated.
   */
  #setExpanded(expanded, logEvent) {
    this.#expanded = expanded;
    this.#uiMinimap.legendToggle.setAttribute('aria-expanded', String(expanded));
    this.#uiMinimap.legendToggle.classList.toggle('minimap-legend-toggle-hidden', expanded);
    this.#uiMinimap.legendCard.classList.toggle('minimap-legend-card-hidden', !expanded);
    if (logEvent) this.#tracker.push(logEvent);
  }
}
