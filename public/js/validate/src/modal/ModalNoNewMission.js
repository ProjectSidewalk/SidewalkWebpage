/**
 * Handles the two dead ends Validate can reach: there are no more labels for this user to validate, or none of the
 * ones it has left can be shown. Creates an overlay saying which, and disables controls and shortcuts.
 */
class ModalNoNewMission {
  #uiModalMission;
  #noMissionsRemaining;
  #imageryUnavailable;
  #showing = false;

  /**
   * @param {object} uiModalMission - Mission modal UI elements.
   */
  constructor(uiModalMission) {
    this.#uiModalMission = uiModalMission;

    const instructions = util.isMobile()
      ? i18next.t('mobile.no-new-mission-body')
      : i18next.t('mission-complete.no-new-mission-body');
    this.#noMissionsRemaining = ModalNoNewMission.#buildBody(instructions);
    this.#imageryUnavailable = ModalNoNewMission.#buildBody(i18next.t('imagery-unavailable.body'));
  }

  /**
   * Wraps a message in the modal's illustrated body markup.
   * @param {string} message - The translated sentence explaining the dead end.
   * @returns {string} The body's HTML.
   */
  static #buildBody(message) {
    return `
      <figure>
        <img src="${util.assetPath('images/icons/AccessibilityFeatures.png')}" class="modal-mission-images"
        alt="Street accessibility features" />
      </figure>
      <div class="spacer10"></div>
      <p>${message}</p>
      <div class="spacer10"></div>`;
  }

  #handleButtonClick = () => {
    if (util.isMobile()) {
      svv.tracker.push('Click_NoMoreMissionModal_ValidateSeattle');
      window.location.replace('https://sidewalk-sea.cs.washington.edu/validate');
    } else {
      svv.tracker.push('Click_NoMoreMissionModal_Audit');
      window.location.replace('/explore');
    }
  };

  // The imagery failures that land someone here are usually transient (a provider hiccup or quota), and the mission
  // is resumed with a fresh set of labels on load, so retrying is the action worth offering. It reloads rather than
  // retrying in place because the whole page was left disabled behind this modal.
  #handleRetryClick = () => {
    svv.tracker.push('Click_ImageryUnavailableModal_Retry');
    window.location.reload();
  };

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.imageryUnavailable=false] - True when Validate stopped because it couldn't load the imagery
   *      for the labels it had, rather than because there are none left (#4810).
   */
  show({ imageryUnavailable = false } = {}) {
    this.#showing = true;
    if (svv.keyboard) {
      svv.keyboard.disableKeyboard();
    }
    this.#uiModalMission.background.style.visibility = 'visible';
    this.#uiModalMission.instruction.innerHTML = imageryUnavailable
      ? this.#imageryUnavailable
      : this.#noMissionsRemaining;
    // A mobile briefing leaves its "YOUR MISSION" eyebrow and a shrunk title behind; this message is a sentence and
    // wants the heading's own size. Both are no-ops on desktop.
    this.#uiModalMission.eyebrow?.replaceChildren();
    this.#uiModalMission.missionTitle.style.whiteSpace = '';
    this.#uiModalMission.missionTitle.style.fontSize = '';
    this.#uiModalMission.missionTitle.innerHTML = imageryUnavailable
      ? i18next.t('imagery-unavailable.title')
      : i18next.t('mission-complete.no-new-mission-title');
    this.#uiModalMission.holder.style.visibility = 'visible';
    this.#uiModalMission.foreground.style.visibility = 'visible';
    // A briefing the validator had scrolled can be what this replaces, and hiding it preserved the offset.
    this.#uiModalMission.foreground.scrollTop = 0;

    let buttonLabel;
    if (imageryUnavailable) {
      buttonLabel = i18next.t('imagery-unavailable.retry');
    } else if (util.isMobile()) {
      buttonLabel = `${i18next.t('mobile.no-new-mission-button')} Seattle, WA`;
    } else {
      buttonLabel = i18next.t('mission-complete.no-new-mission-button');
    }
    this.#uiModalMission.closeButton.innerHTML = buttonLabel;

    // Widen the button to fit more text. The mobile page's button is already full-width (mobile-validate.css).
    if (!util.isMobile()) {
      this.#uiModalMission.closeButton.style.width = 'fit-content';
    }

    // Assigned, not added: this can show twice with different actions, and ModalMission uses the same button.
    this.#uiModalMission.closeButton.onclick = imageryUnavailable ? this.#handleRetryClick : this.#handleButtonClick;
    this.#uiModalMission.holder.classList.remove('ps-hidden');
  }

  /**
   * Whether Validate has hit one of its dead ends and this modal has taken the mission modal over.
   *
   * The dead end can be reached while the page is still building — the very first label render is one of the places
   * that finds no imagery (#4810) — so the rest of that build has to know to leave the modal and its controls alone.
   *
   * @returns {boolean} True once show() has run.
   */
  isShowing() {
    return this.#showing;
  }
}
