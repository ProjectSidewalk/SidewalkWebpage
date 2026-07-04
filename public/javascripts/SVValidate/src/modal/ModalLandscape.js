/**
 * Displays modal popup if user is on mobile and in landscape mode.
 */
class ModalLandscape {
  #uiModal;

  /**
     * @param {object} uiModal Modal UI elements.
     */
  constructor(uiModal) {
    this.#uiModal = uiModal;
  }

  hide() {
    this.#uiModal.background.css('visibility', 'hidden');
    this.#uiModal.holder.css('visibility', 'hidden');
    this.#uiModal.foreground.css('visibility', 'hidden');
  }

  show() {
    this.#uiModal.background.css('visibility', 'visible');
    this.#uiModal.holder.css('visibility', 'visible');
    this.#uiModal.foreground.css('visibility', 'visible');
  }
}
