/**
 * Collapsible legend ("map key") for the Explore minimap. Collapsed, it's a small pill showing the route marks
 * themselves; expanded, a card names each mark. Auto-expands once for new users so they learn the map's language,
 * then defaults to collapsed (#4639).
 */
class MinimapLegend {
  #uiMinimap;
  #tracker;
  #expanded = false;

  /**
   * @param {Object} uiMinimap - The svl.ui.minimap object holding the minimap's jQuery DOM elements.
   * @param {Tracker} tracker - Interaction logger.
   * @param {TemporaryStorage} storage - Client-side storage for the first-run flag.
   */
  constructor(uiMinimap, tracker, storage) {
    this.#uiMinimap = uiMinimap;
    this.#tracker = tracker;

    uiMinimap.legendToggle.on('click', () => this.#setExpanded(true, 'Click_MinimapLegend_Open'));
    uiMinimap.legendClose.on('click', () => this.#setExpanded(false, 'Click_MinimapLegend_Close'));
    $(document).on('keydown', (e) => {
      if (e.key === 'Escape' && this.#expanded) this.#setExpanded(false, 'MinimapLegend_EscapeClose');
    });

    // First run: open the legend once so new users meet the marks, then default to collapsed forever after.
    if (!storage.get('minimapLegendSeen') && !svl.isOnboarding()) {
      storage.set('minimapLegendSeen', true);
      this.#setExpanded(true, null);
    }
  }

  /**
   * Expands or collapses the legend, keeping the toggle's ARIA state in sync.
   * @param {boolean} expanded - Whether the card should be visible.
   * @param {string} [logEvent] - Tracker event to record, if this was user-initiated.
   */
  #setExpanded(expanded, logEvent) {
    this.#expanded = expanded;
    this.#uiMinimap.legendToggle.attr('aria-expanded', String(expanded));
    this.#uiMinimap.legendToggle.toggleClass('minimap-legend-toggle-hidden', expanded);
    this.#uiMinimap.legendCard.toggleClass('minimap-legend-card-hidden', !expanded);
    if (logEvent) this.#tracker.push(logEvent);
  }
}
