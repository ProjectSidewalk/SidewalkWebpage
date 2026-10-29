/** @typedef {import('../expandedview/ExpandedView.js').ExpandedView} ExpandedView */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

/**
 * Handles the Gallery-specific keyboard shortcuts for the expanded view.
 *
 * Paging (left/right arrows) and voting (A/Y, D/N, U) belong to the label detail card itself, which owns them on
 * every host it has (#5194) — see LabelDetail's `#wireKeyboard`. What is left here is the pair only the Gallery
 * offers: Z / Shift+Z to zoom the imagery, and Escape to close the expanded view and restore the card grid.
 */

export class KeyboardManager {
  #expandedView;
  #tracker;

  /**
   * @param {ExpandedView} expandedView - The object for the expanded view in the gallery.
   * @param {Tracker} tracker - Logs the shortcuts.
   */
  constructor(expandedView, tracker) {
    this.#expandedView = expandedView;
    this.#tracker = tracker;
    window.addEventListener('keyup', (e) => this.#documentKeyUp(e));
  }

  /**
   * Callback for key-up events. Routes keyboard shortcuts to the appropriate expanded-view actions.
   * @param {KeyboardEvent} e
   */
  #documentKeyUp(e) {
    // Prevent shortcuts in the comment box.
    const activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
    if (!e.code || e.ctrlKey || e.metaKey || e.altKey || !this.#expandedView.open) return;

    switch (e.code) {
      // Zoom in on 'Z', zoom out on 'Shift+Z'.
      // Logged whether or not the view moved (already at a bound, or a crop on screen), as Explore and Validate do.
      case 'KeyZ':
        if (!KeyboardManager.#cardOwnsKeyboard()) break;
        if (e.shiftKey) {
          this.#expandedView.panoManager.zoomOut();
          this.#tracker.push('KeyboardShortcut_ZoomOut', null, { code: e.code });
        } else {
          this.#expandedView.panoManager.zoomIn();
          this.#tracker.push('KeyboardShortcut_ZoomIn', null, { code: e.code });
        }
        break;
      case 'Escape':
        this.#expandedView.closeExpandedViewAndRemoveCardTransparency();
        break;
      default:
        break;
    }
  }

  /**
   * Whether the expanded view's card is what a keypress is aimed at, by the rule LabelDetail's own shortcuts use
   * (`#ownsKeyboard`, #5194). A dialog stacked over the card (a delete confirmation, the story photo lightbox, the
   * share sheet, the story composer) owns the keyboard while it is up, so Z must not zoom the imagery hidden
   * behind it.
   * @returns {boolean}
   */
  static #cardOwnsKeyboard() {
    const active = document.activeElement;
    const focused = active && active !== document.body && active !== document.documentElement ? active : null;
    if (focused?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog')) {
      return false;
    }
    // With focus on a control the card is frontmost. With focus nowhere in particular, ask the document instead.
    return !!focused || !document.querySelector('dialog[open]');
  }
}
