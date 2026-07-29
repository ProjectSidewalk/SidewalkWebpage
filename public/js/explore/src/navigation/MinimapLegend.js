/**
 * Collapsible legend ("map key") for the Explore minimap. Collapsed, it's a small pill showing the route marks
 * themselves; expanded, a card names each mark. Defaults to collapsed; the user opens it from the pill (#4639).
 */
class MinimapLegend {
  #uiMinimap;
  #tracker;
  #expanded = false;

  /**
   * @param {Object} uiMinimap - The svl.ui.minimap object holding the minimap's jQuery DOM elements.
   * @param {Tracker} tracker - Interaction logger.
   */
  constructor(uiMinimap, tracker) {
    this.#uiMinimap = uiMinimap;
    this.#tracker = tracker;

    uiMinimap.legendToggle.on('click', () => this.#setExpanded(true, 'Click_MinimapLegend_Open'));
    uiMinimap.legendClose.on('click', () => this.#setExpanded(false, 'Click_MinimapLegend_Close'));
    $(document).on('keydown', (e) => {
      if (e.key === 'Escape' && this.#expanded) this.#setExpanded(false, 'MinimapLegend_EscapeClose');
    });
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
