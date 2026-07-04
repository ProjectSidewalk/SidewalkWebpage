/**
 * Handles keyboard shortcuts for the Gallery's expanded view.
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

    if (e.key && !e.ctrlKey) {
      switch (e.key.toUpperCase()) {
        case 'ARROWLEFT':
          if (this.#expandedView.open && !this.#expandedView.leftArrowDisabled) {
            this.#expandedView.previousLabel(true);
          }
          break;
        case 'ARROWRIGHT':
          if (this.#expandedView.open && !this.#expandedView.rightArrowDisabled) {
            this.#expandedView.nextLabel(true);
          }
          break;
        case 'A':
        case 'Y':
          this.#expandedView.validate('Agree');
          break;
        case 'D':
        case 'N':
          this.#expandedView.validate('Disagree');
          break;
        case 'U':
          this.#expandedView.validate('Unsure');
          break;
        case 'Z':
          if (this.#expandedView.open) {
            if (e.shiftKey) {
              this.#expandedView.panoManager.zoomOut();
            } else {
              this.#expandedView.panoManager.zoomIn();
            }
          }
          break;
        case 'ESCAPE':
          if (this.#expandedView.open) {
            this.#expandedView.closeExpandedViewAndRemoveCardTransparency();
          }
          break;
        default:
          break;
      }
    }
  }
}
