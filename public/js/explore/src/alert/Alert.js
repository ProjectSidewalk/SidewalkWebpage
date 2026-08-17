/**
 * Base class for the individual alert types shown to the user (keyboard-shortcut nudges, the jump tip, etc.).
 *
 * Each subclass decides *when* to alert; this base handles the shared plumbing of *rendering* one — it holds the
 * AlertController and exposes `_showAlert()` so subclasses never touch the alert DOM or the handler directly.
 */
class Alert {
  #alertHandler;

  /**
   * @param {AlertController} alertHandler - Controller that renders the message in the shared banner.
   */
  constructor(alertHandler) {
    this.#alertHandler = alertHandler;
  }

  /**
   * Renders a translated message through the shared alert banner.
   * @param {string} translationKey - i18next key for the message.
   * @param {string} type - Message type identifier, used for the "don't show again" opt-out list.
   * @param {Object} [interpolation={}] - Interpolation values passed to i18next (e.g. `{ key: shortcut }`).
   * @param {boolean} [dontShow=true] - Whether to offer "don't show again". Tips and nudges do; a message
   *     reporting something that happened to the labeler without their asking does not.
   */
  _showAlert(translationKey, type, interpolation = {}, dontShow = true) {
    this.#alertHandler.showAlert(i18next.t(translationKey, interpolation), type, dontShow);
  }
}
