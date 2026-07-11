/**
 * Handles the compact control buttons overlaid on the top-left of the panorama on the Explore page: the Stuck button
 * and the chevron toggle that expands/collapses the optional controls (sound, feedback). The sound and feedback buttons
 * are owned by AudioEffect and FeedbackModal; this class owns the button group container and the Stuck button.
 */
class PanoOverlayControls {
  #blinkInterval = null;
  #stuckEnabled = true;
  #stuck;
  #controlButtonsHolder;
  #controlButtonsToggle;
  #controlButtonsToggleIcon;

  /**
   * @param {Tracker} tracker
   * @param {NavigationService} navigationService
   * @param {StuckAlert} stuckAlert
   * @param {KeyboardShortcutAlert} keyboardShortcutAlert
   */
  constructor(tracker, navigationService, stuckAlert, keyboardShortcutAlert) {
    this.tracker = tracker;
    this.navigationService = navigationService;
    this.stuckAlert = stuckAlert;
    this.keyboardShortcutAlert = keyboardShortcutAlert;

    this.#stuck = document.getElementById('explore-control-stuck');
    this.#controlButtonsHolder = document.getElementById('explore-control-buttons-holder');
    this.#controlButtonsToggle = document.getElementById('explore-control-buttons-toggle');
    this.#controlButtonsToggleIcon = document.getElementById('explore-control-buttons-toggle-icon');

    // The stuck handler is attached once and gated by #stuckEnabled; enable/disable just flip the flag.
    this.#stuck.addEventListener('click', this.#handleClickStuck);
    this.#controlButtonsToggle.addEventListener('click', this.#handleToggleControls);
  }

  /**
   * Callback for the chevron toggle: expands/collapses the optional control buttons (sound, feedback).
   * @param {Event} e
   */
  #handleToggleControls = (e) => {
    e.preventDefault();
    const expanded = this.#controlButtonsHolder.classList.toggle('expanded');
    this.#controlButtonsToggle.setAttribute('aria-expanded', expanded);
    const chevron = expanded ? 'chevron-left-white-feather.svg' : 'chevron-right-white-feather.svg';
    this.#controlButtonsToggleIcon.setAttribute('src', `/assets/images/icons/${chevron}`);
  };

  /**
   * Callback for clicking the stuck button.
   *
   * The algorithm searches for available imagery along the street you are assigned to. If the pano you are put in
   * doesn't help, you can click the Stuck button again; we save the attempted panos so we'll try something new. If we
   * can't find anything along the street, we just mark it as complete and move you to a new street.
   * @param {Event} e
   */
  #handleClickStuck = (e) => {
    e.preventDefault();
    if (!this.#stuckEnabled) return;
    this.stuckAlert.compassOrStuckClicked();
    this.keyboardShortcutAlert.stuckButtonClicked();
    this.tracker.push('ModalStuck_ClickStuck');
    this.navigationService.moveForward()
      .then(() => {
        this.tracker.push('ModalStuck_Unstuck');
        this.stuckAlert.stuckClicked();
      })
      .catch(() => this.tracker.push('ModalStuck_PanoNotAvailable'));
  };

  /* Enable the stuck button. */
  enableStuckButton = () => {
    this.#stuckEnabled = true;
  };

  /* Disable the stuck button. */
  disableStuckButton = () => {
    this.#stuckEnabled = false;
  };

  /* Visually disable the stuck and control-toggle buttons (used while onboarding takes over the UI). */
  disableButtons = () => {
    this.#stuck.classList.add('disabled');
    this.#controlButtonsToggle.classList.add('disabled');
  };

  /* Blink the stuck button. */
  blinkStuckButton = () => {
    this.stopBlinkingStuckButton();
    this.#blinkInterval = window.setInterval(() => {
      this.#stuck.classList.toggle('highlight-100');
    }, 500);
  };

  /* Stop blinking the stuck button. */
  stopBlinkingStuckButton = () => {
    window.clearInterval(this.#blinkInterval);
    this.#stuck.classList.remove('highlight-100');
  };
}
