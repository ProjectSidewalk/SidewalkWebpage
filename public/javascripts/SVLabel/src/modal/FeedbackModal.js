/**
 * The feedback dialog, opened by the Feedback button overlaid on the panorama. Lets the user send a free-text comment
 * tied to their current pano/position/task. On a successful submit, a brief confirmation toast is shown.
 */
class FeedbackModal {
    #svl;
    #tracker;
    #ribbon;
    #taskContainer;

    #feedbackButton;
    #holder;
    #background;
    #title;
    #textarea;
    #okButton;
    #cancelButton;

    /**
     * @param {Object} svl Shared app object (used for panoViewer, popUpMessage, and missionContainer).
     * @param {Tracker} tracker
     * @param {RibbonMenu} ribbon Used to suspend mode switching while the textarea is focused.
     * @param {TaskContainer} taskContainer Provides the current task for the submitted comment.
     */
    constructor(svl, tracker, ribbon, taskContainer) {
        this.#svl = svl;
        this.#tracker = tracker;
        this.#ribbon = ribbon;
        this.#taskContainer = taskContainer;

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
        this.#textarea.addEventListener('focus', () => this.#ribbon.disableModeSwitch());
        this.#textarea.addEventListener('blur', () => this.#ribbon.enableModeSwitch());

        this.#setOkEnabled(false);
    }

    /** Opens the feedback dialog. */
    #handleClickFeedback = () => {
        this.#tracker.push('ModalComment_ClickFeedback');
        this.#textarea.value = '';
        this.#setOkEnabled(false);
        this.#holder.classList.remove('hidden');
        this.#background.style.visibility = 'visible';
        this.#svl.popUpMessage.disableInteractions();
    }

    /** Hides the feedback dialog and restores interaction with the tool. */
    hide = () => {
        this.#holder.classList.add('hidden');
        this.#background.style.visibility = 'hidden';
        this.#svl.popUpMessage.enableInteractions();
    }

    /** Submits the typed comment, then closes the dialog. */
    #handleClickOK = (e) => {
        e.preventDefault();
        this.#tracker.push('ModalComment_ClickOK');

        const task = this.#taskContainer.getCurrentTask();
        const panoId = this.#svl.panoViewer.getPanoId();
        const latlng = this.#svl.panoViewer.getPosition();
        const pov = this.#svl.panoViewer.getPov();

        this.#submitComment(this.#prepareCommentData(panoId, latlng.lat, latlng.lng, pov, task));
        this.hide();
    }

    #handleClickCancel = (e) => {
        e.preventDefault();
        this.#tracker.push('ModalComment_ClickCancel');
        this.hide();
    }

    /** Enables the OK button only when the user has typed something. */
    #handleTextareaInput = () => {
        this.#setOkEnabled(this.#textarea.value.length > 0);
    }

    /**
     * Enables or disables the OK button.
     * @param {boolean} enabled
     */
    #setOkEnabled(enabled) {
        this.#okButton.disabled = !enabled;
        this.#okButton.classList.toggle('disabled', !enabled);
    }

    /**
     * Posts the comment to the back end and shows a confirmation toast on success.
     * @param {Object} data Comment payload built by #prepareCommentData.
     */
    #submitComment(data) {
        fetch('/explore/comment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(data)
        }).then(response => {
            if (!response.ok) throw new Error(`Comment submission failed: ${response.status}`);
            Toast.show({
                message: i18next.t('audit:controls.feedback-submitted'),
                reference: document.getElementById('pano'),
                duration: 3000
            });
        }).catch(error => console.error(error));
    }

    /**
     * Builds the comment payload from the current pano/position/task state.
     * @param {string} panoId
     * @param {number} lat
     * @param {number} lng
     * @param {Object} pov Current point of view ({ heading, pitch, zoom }).
     * @param {Object} task Current audit task.
     * @returns {Object}
     */
    #prepareCommentData(panoId, lat, lng, pov, task) {
        return {
            comment: this.#textarea.value,
            pano_id: panoId,
            heading: pov.heading,
            lat: lat,
            lng: lng,
            pitch: pov.pitch,
            street_edge_id: task.getStreetEdgeId(),
            audit_task_id: task.getAuditTaskId(),
            mission_id: this.#svl.missionContainer.getCurrentMission().getProperty('missionId'),
            zoom: pov.zoom
        };
    }
}
