/**
 * Reminds the user to rate severity after they've labeled several times in a row without picking a severity.
 */
class RatingReminderAlert extends Alert {
  #ratingCount = 0;

  // Number of consecutive labels without a severity before the reminder fires.
  static #MINIMUM_NO_RATING_BEFORE_ALERT = 4;

  /**
     * Tracks whether the user rated severity, and shows the reminder after enough consecutive unrated labels.
     * @param {?number} severity - The chosen severity, or null/undefined if the user labeled without rating.
     */
  ratingClicked(severity) {
    if (severity === null || severity === undefined) {
      if (this.#ratingCount > 0) {
        this.#ratingCount++;
      } else {
        this.#ratingCount = 1;
      }
    } else {
      // Picking a severity resets the streak.
      this.#ratingCount = 0;
    }

    if (this.#ratingCount >= RatingReminderAlert.#MINIMUM_NO_RATING_BEFORE_ALERT && !svl.isOnboarding()) {
      this._showAlert('popup.severity-shortcuts', 'reminderMessage');
      this.#ratingCount = 0;
    }
  }
}
