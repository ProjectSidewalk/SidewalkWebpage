/**
 * Handles the Gallery-specific keyboard shortcuts for the expanded view.
 *
 * Paging (left/right arrows) and voting (A/Y, D/N, U) belong to the label detail card itself, which owns them on
 * every host it has (#5194) — see LabelDetail's `#wireKeyboard`. What is left here is the pair only the Gallery
 * offers: Z / Shift+Z to zoom the imagery, and Escape to close the expanded view and restore the card grid.
 */
class KeyboardManager {
  #expandedView;

  /**
   * @param {ExpandedView} expandedView The object for the expanded view in the gallery.
   */
  constructor(expandedView) {
    this.#expandedView = expandedView;
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
      case 'KeyZ':
        if (e.shiftKey) this.#expandedView.panoManager.zoomOut();
        else this.#expandedView.panoManager.zoomIn();
        break;
      case 'Escape':
        this.#expandedView.closeExpandedViewAndRemoveCardTransparency();
        break;
      default:
        break;
    }
  }
}
