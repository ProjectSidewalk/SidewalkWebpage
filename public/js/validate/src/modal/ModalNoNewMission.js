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
   * @param {object} uiModalMission Mission modal UI elements.
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
   * @param {string} message The translated sentence explaining the dead end.
   * @returns {string} The body's HTML.
   */
  static #buildBody(message) {
    return `
      <figure>
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block"
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
   * @param {boolean} [opts.imageryUnavailable=false] True when Validate stopped because it couldn't load the imagery
   *      for the labels it had, rather than because there are none left (#4810).
   */
  show({ imageryUnavailable = false } = {}) {
    this.#showing = true;
    if (svv.keyboard) {
      svv.keyboard.disableKeyboard();
    }
    this.#uiModalMission.background.css('visibility', 'visible');
    this.#uiModalMission.instruction.html(imageryUnavailable ? this.#imageryUnavailable : this.#noMissionsRemaining);
    // This dead end can follow a mission briefing, which leaves two things behind on mobile: its "YOUR MISSION"
    // eyebrow, and the shrunk-to-one-line sizing it put on the title. This message is a sentence and wants to wrap at
    // the heading's own size. (Desktop has no eyebrow and never shrinks the title, so both are no-ops there.)
    this.#uiModalMission.eyebrow.empty();
    this.#uiModalMission.missionTitle.css({ 'white-space': '', 'font-size': '' });
    this.#uiModalMission.missionTitle.html(imageryUnavailable
      ? i18next.t('imagery-unavailable.title')
      : i18next.t('mission-complete.no-new-mission-title'));
    this.#uiModalMission.holder.css('visibility', 'visible');
    this.#uiModalMission.foreground.css('visibility', 'visible');

    let buttonLabel;
    if (imageryUnavailable) {
      buttonLabel = i18next.t('imagery-unavailable.retry');
    } else if (util.isMobile()) {
      buttonLabel = `${i18next.t('mobile.no-new-mission-button')} Seattle, WA`;
    } else {
      buttonLabel = i18next.t('mission-complete.no-new-mission-button');
    }
    this.#uiModalMission.closeButton.html(buttonLabel);

    // Widen the button to fit more text. The mobile page's button is already full-width (mobile-validate.css).
    if (!util.isMobile()) {
      this.#uiModalMission.closeButton.css('width', 'fit-content');
    }

    // Re-bind rather than add: the modal can be shown twice in a session with different actions on its one button.
    this.#uiModalMission.closeButton.off('click')
      .on('click', imageryUnavailable ? this.#handleRetryClick : this.#handleButtonClick);
    this.#uiModalMission.holder.removeClass('ps-hidden');
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
