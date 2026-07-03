/**
 * Shows a survey modal for select users and reports whether it was completed or skipped.
 *
 * The modal itself is a Bootstrap modal, so its events and hide call go through jQuery; remaining code is plain JS.
 */
class ModalSurvey {
    #uiModalSurvey;

    constructor() {
        this.#uiModalSurvey = {
            container: $('#survey-modal-container'),
            form: $('#survey-form'),
            skipButton: $('#survey-skip-button'),
        };

        this.#uiModalSurvey.container.on('show.bs.modal', this.#handleShowSurvey);
        this.#uiModalSurvey.container.on('hide.bs.modal', this.#handleHideSurvey);
        this.#uiModalSurvey.container.on('keydown', (e) => e.stopPropagation());
        this.#uiModalSurvey.form.on('submit', this.#handleSubmitSurvey);
        this.#uiModalSurvey.skipButton.on('click', this.#handleSkipSurvey);
    }

    // Disables panorama interactions while the survey modal is open.
    #handleShowSurvey = () => {
        svl.popUpMessage.disableInteractions();
        svl.ribbon.disableModeSwitch();
        svl.zoomControl.disableZoomIn();
        svl.zoomControl.disableZoomOut();
    };

    // Re-enables panorama interactions once the survey modal is closed.
    #handleHideSurvey = () => {
        svl.popUpMessage.enableInteractions();
        svl.ribbon.enableModeSwitch();
        svl.zoomControl.enableZoomIn();
        svl.zoomControl.enableZoomOut();
    };

    // Submits the survey responses, then hides the modal. Prevents the page from reloading with the posted data.
    #handleSubmitSurvey = (e) => {
        e.preventDefault();
        fetch('/survey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(this.#uiModalSurvey.form.serializeArray()),
        }).then(() => this.#uiModalSurvey.container.modal('hide'));
    };

    // Logs that the survey was skipped to WebpageActivityTable.
    #handleSkipSurvey = () => {
        window.logWebpageActivity('SurveySkip', true);
    };
}
