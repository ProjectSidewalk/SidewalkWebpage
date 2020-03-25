/**
 * Handles edge case if there are no more labels for this user to validate.
 * Creates an overlay that notifies user that there are no more labels left for them to validate
 * at the moment. Disables controls, shortcuts.
 * @returns {ModalNoNewMission}
 * @constructor
 */
function ModalNoNewMission (uiModalMission) {
    let self = this;

    let noMissionsRemaining = '<figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + i18next.t('mission-complete.no-new-mission-body') + '</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        svv.tracker.push("Click_NoMoreMissionModal_Audit");
        window.location.replace("/audit");
    }

    function show () {
        svv.keyboard.disableKeyboard();
        uiModalMission.background.css('visibility', 'visible');
        uiModalMission.instruction.html(noMissionsRemaining);
        uiModalMission.missionTitle.html(i18next.t('mission-complete.no-new-mission-title'));
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.closeButton.html(i18next.t('mission-complete.no-new-mission-button'));
        uiModalMission.closeButton.on('click', _handleButtonClick);
    }

    self.show = show;

    return self;
}
