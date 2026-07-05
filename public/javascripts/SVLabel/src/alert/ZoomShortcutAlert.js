/**
 * Nudges the user toward the zoom keyboard shortcut after they've clicked the zoom button several times.
 */
class ZoomShortcutAlert extends Alert {
  #zoomCount = 0;

  static #MINIMUM_ZOOM_CLICKS_BEFORE_ALERT = 5;

  /**
   * Tracks zoom-button clicks and shows the zoom shortcut alert once clicked enough times.
   */
  zoomClicked() {
    if (this.#zoomCount > 0) {
      this.#zoomCount++;
    } else {
      this.#zoomCount = 1;
    }

    if (this.#zoomCount >= ZoomShortcutAlert.#MINIMUM_ZOOM_CLICKS_BEFORE_ALERT && !svl.isOnboarding()) {
      this._showAlert('popup.zoom-shortcuts', 'zoomMessage');
      this.#zoomCount = 0;
    }
  }
}
