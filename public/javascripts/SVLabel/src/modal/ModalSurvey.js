/**
 * ModalSurvey module.
 * @constructor
 */
function ModalSurvey(uiModalSurvey) {
    var self = this;

    /**
     * Event Handlers:
     */

    // Callback for showing the survey modal.
    this._handleShowSurvey = (e) => {
        svl.popUpMessage.disableInteractions();
        svl.ribbon.disableModeSwitch();
        svl.zoomControl.disableZoomIn();
        svl.zoomControl.disableZoomOut();
    };

    // Callback for hiding the survey modal.
    this._handleHideSurvey = (e) => {
        svl.popUpMessage.enableInteractions();
        svl.ribbon.enableModeSwitch();
        svl.zoomControl.enableZoomIn();
        svl.zoomControl.enableZoomOut();
    }

    // Callback for submitting the survey.
    this._handleSubmitSurvey = (e) => {
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: '/survey',
            method: 'POST',
            dataType: 'json',
            data: JSON.stringify(uiModalSurvey.form.serializeArray()),
            success: function (data) {
                uiModalSurvey.container.modal('hide');
            }
        });
        // Prevents reloading the explore page with the posted data in the url.
        // https://stackoverflow.com/questions/12624230/jquery-post-returns-querystring-in-address-bar
        e.preventDefault();
    }

    // Log whether the survey was skipped or completed to WebpageActivityTable.
    this._handleSkipSurvey = (e) => {
        window.logWebpageActivity('SurveySkip', true);
    }

    // Initialize Event Listeners.
    uiModalSurvey.container.bind('show.bs.modal', this._handleShowSurvey);
    uiModalSurvey.container.bind('hide.bs.modal', this._handleHideSurvey);
    uiModalSurvey.container.bind('keydown', (e) => e.stopPropagation());
    uiModalSurvey.form.bind('submit', this._handleSubmitSurvey);
    svl.ui.modalSurvey.skipButton.bind('click', this._handleSkipSurvey);
}
