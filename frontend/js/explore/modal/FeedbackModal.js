/**
 * The feedback dialog, opened by the Feedback button overlaid on the panorama. Lets the user send a free-text comment
 * tied to their current pano/position/task. On a successful submit, a brief confirmation toast is shown.
 */

import { Toast } from '../../common/Toast.js';
/** @typedef {import('../../common/Gate.js').Gate} Gate */
/** @typedef {import('../navigation/NavigationService.js').NavigationService} NavigationService */
/** @typedef {import('../mission/MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../task/Task.js').Task} Task */
/** @typedef {import('../task/TaskContainer.js').TaskContainer} TaskContainer */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class FeedbackModal {
  #interactionLock;
  #missionContainer;
  #taskContainer;
  #panoManager;
  #tracker;

  #feedbackButton;
  #holder;
  #background;
  #title;
  #textarea;
  #okButton;
  #cancelButton;

  /**
   * @param {Gate} interactionLock - Held while the dialog is open.
   * @param {MissionContainer} missionContainer - Provides the current mission for the submitted comment.
   * @param {TaskContainer} taskContainer - Provides the current task for the submitted comment.
   * @param {PanoManager} panoManager - Provides the pano and view for the submitted comment.
   * @param {NavigationService} navigationService - Whose moves close the dialog.
   * @param {Tracker} tracker
   */
  constructor(interactionLock, missionContainer, taskContainer, panoManager, navigationService, tracker) {
    this.#interactionLock = interactionLock;
    this.#missionContainer = missionContainer;
    this.#taskContainer = taskContainer;
    this.#panoManager = panoManager;
    this.#tracker = tracker;
    navigationService.onMoveStarted(() => this.hide());

    this.#feedbackButton = document.getElementById('explore-control-feedback');
    this.#holder = document.getElementById('modal-comment-holder');
    this.#background = document.getElementById('modal-comment-background');
    this.#title = document.getElementById('modal-comment-title');
    this.#textarea = document.getElementById('modal-comment-textarea');
    this.#okButton = document.getElementById('modal-comment-ok-button');
    this.#cancelButton = document.getElementById('modal-comment-cancel-button');

    // The title may contain markup (e.g. a <br>), so set it as HTML rather than text.
    this.#title.innerHTML = i18next.t('audit:controls.feedback-title');

    this.#feedbackButton.addEventListener('click', this.#handleClickFeedback);
    this.#okButton.addEventListener('click', this.#handleClickOK);
    this.#cancelButton.addEventListener('click', this.#handleClickCancel);
    this.#textarea.addEventListener('input', this.#handleTextareaInput);

    this.#setOkEnabled(false);
  }

  /** Opens the feedback dialog. */
  #handleClickFeedback = () => {
    this.#tracker.push('ModalComment_ClickFeedback');
    this.#textarea.value = '';
    this.#setOkEnabled(false);
    this.#holder.classList.remove('ps-hidden');
    this.#background.style.visibility = 'visible';
    this.#interactionLock.hold('feedback');
  };

  /** Hides the feedback dialog and restores interaction with the tool. */
  hide = () => {
    this.#holder.classList.add('ps-hidden');
    this.#background.style.visibility = 'hidden';
    this.#interactionLock.release('feedback');
  };

  /** Submits the typed comment, then closes the dialog. */
  #handleClickOK = (e) => {
    e.preventDefault();
    this.#tracker.push('ModalComment_ClickOK');

    const task = this.#taskContainer.getCurrentTask();
    const panoId = this.#panoManager.getPanoId();
    const latlng = this.#panoManager.getPosition();
    const pov = this.#panoManager.getPov();

    this.#submitComment(this.#prepareCommentData(panoId, latlng.lat, latlng.lng, pov, task));
    this.hide();
  };

  #handleClickCancel = (e) => {
    e.preventDefault();
    this.#tracker.push('ModalComment_ClickCancel');
    this.hide();
  };

  /** Enables the OK button only when the user has typed something. */
  #handleTextareaInput = () => {
    this.#setOkEnabled(this.#textarea.value.length > 0);
  };

  /**
   * Enables or disables the OK button.
   * @param {boolean} enabled
   */
  #setOkEnabled(enabled) {
    this.#okButton.disabled = !enabled;
  }

  /**
   * Posts the comment to the back end and shows a confirmation toast on success.
   * @param {object} data - Comment payload built by #prepareCommentData.
   */
  #submitComment(data) {
    fetch('/explore/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data),
    }).then((response) => {
      if (!response.ok) throw new Error(`Comment submission failed: ${response.status}`);
      Toast.show({
        message: i18next.t('audit:controls.feedback-submitted'),
        reference: document.getElementById('pano'),
        duration: 3000,
      });
    }).catch((error) => console.error(error));
  }

  /**
   * Builds the comment payload from the current pano/position/task state.
   * @param {string} panoId
   * @param {number} lat
   * @param {number} lng
   * @param {{heading: number, pitch: number, zoom: number}} pov - Current point of view.
   * @param {Task} task - Current audit task.
   * @returns {object}
   */
  #prepareCommentData(panoId, lat, lng, pov, task) {
    return {
      comment: this.#textarea.value,
      pano_id: panoId,
      heading: pov.heading,
      lat,
      lng,
      pitch: pov.pitch,
      street_edge_id: task.getStreetEdgeId(),
      audit_task_id: task.getAuditTaskId(),
      mission_id: this.#missionContainer.getCurrentMission().getProperty('missionId'),
      zoom: pov.zoom,
    };
  }
}
