/**
 * Nudges the user toward keyboard shortcuts after they've repeatedly clicked the mode buttons or the Stuck button.
 */
class KeyboardShortcutAlert extends Alert {
  #clickCount = {};

  static #MINIMUM_CLICKS_BEFORE_ALERT = 10;
  // Stuck is clicked far less often than the mode buttons, so nudge after fewer clicks.
  static #MINIMUM_STUCK_CLICKS_BEFORE_ALERT = 5;

  /**
     * Tracks clicks on a label-type mode button and shows its keyboard shortcut once clicked enough times.
     * @param {string} labelType - The label type whose mode button was clicked.
     */
  modeSwitchButtonClicked(labelType) {
    if (labelType === 'Walk') return;

    if (labelType in this.#clickCount) {
      this.#clickCount[labelType]++;
    } else {
      this.#clickCount[labelType] = 1;
    }

    if (this.#clickCount[labelType] >= KeyboardShortcutAlert.#MINIMUM_CLICKS_BEFORE_ALERT && !svl.isOnboarding()) {
      const labelDescription = util.misc.getLabelDescriptions(labelType);
      if ('keyChar' in labelDescription) {
        const translationKey = `popup.label-shortcuts-${util.camelToKebab(labelType)}`;
        this._showAlert(translationKey, labelType, { key: labelDescription.keyChar });
        this.#clickCount[labelType] = 0;
      }
    }
  }

  /**
     * Nudges the user toward the spacebar shortcut after they've clicked the Stuck button several times. The spacebar
     * first tries a routed linked-pano step and only falls back to the Stuck button's route-aware moveForward() when
     * no such link exists (see Keyboard._advanceForwardAlongRoute).
     */
  stuckButtonClicked() {
    if ('Stuck' in this.#clickCount) {
      this.#clickCount.Stuck++;
    } else {
      this.#clickCount.Stuck = 1;
    }

    if (this.#clickCount.Stuck >= KeyboardShortcutAlert.#MINIMUM_STUCK_CLICKS_BEFORE_ALERT
      && !svl.isOnboarding()) {
      this._showAlert('popup.move-forward-shortcut', 'MoveForwardShortcut');
      this.#clickCount.Stuck = 0;
    }
  }
}
