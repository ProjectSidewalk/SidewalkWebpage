/**
 * Shows a survey modal for select users and reports whether it was completed or skipped.
 *
 * A native <dialog>, opened modally so the page behind it is inert. There is no dismissing it with Escape or a click
 * outside: the user either submits it or skips it with the X, and both close it.
 */
class ModalSurvey {
  /** @type {HTMLDialogElement} */
  #dialog;

  /** @type {HTMLFormElement} */
  #form;

  #submitted = false;

  constructor() {
    this.#dialog = /** @type {HTMLDialogElement} */ (document.getElementById('survey-modal-container'));
    this.#form = /** @type {HTMLFormElement} */ (document.getElementById('survey-form'));

    this.#dialog.addEventListener('cancel', (e) => e.preventDefault()); // Escape, where closedby is unsupported.
    this.#dialog.addEventListener('close', this.#handleHideSurvey);
    this.#dialog.addEventListener('keydown', (e) => e.stopPropagation()); // Typing an answer isn't a shortcut.
    this.#form.addEventListener('submit', this.#handleSubmitSurvey);
    document.getElementById('survey-skip-button').addEventListener('click', () => this.#dialog.close());
  }

  /** Opens the survey, with panorama interactions disabled for as long as it is up. */
  open() {
    if (this.#dialog.open) return;
    this.#submitted = false;
    svl.popUpMessage.disableInteractions();
    svl.ribbon.disableModeSwitch();
    svl.zoomControl.disableZoomIn();
    svl.zoomControl.disableZoomOut();
    this.#dialog.showModal();
    // showModal() lands focus on the first control, the skip X. The survey opens on its own mid-labeling, so a key
    // the user is already pressing would skip it; the dialog itself takes the focus instead.
    this.#dialog.focus();
  }

  // Re-enables panorama interactions once the survey modal is closed. Any close that isn't the submit is a skip,
  // whichever way it happened, so the skip is logged here rather than on the X.
  #handleHideSurvey = () => {
    if (!this.#submitted) window.logWebpageActivity('SurveySkip', true);
    svl.popUpMessage.enableInteractions();
    svl.ribbon.enableModeSwitch();
    svl.zoomControl.enableZoomIn();
    svl.zoomControl.enableZoomOut();
  };

  // Submits the survey responses, then hides the modal. Prevents the page from reloading with the posted data.
  #handleSubmitSurvey = (e) => {
    e.preventDefault();
    const answers = [...new FormData(this.#form)].map(([name, value]) => ({ name, value }));
    fetch('/survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(answers),
    }).then(() => {
      this.#submitted = true;
      this.#dialog.close();
    });
  };
}
