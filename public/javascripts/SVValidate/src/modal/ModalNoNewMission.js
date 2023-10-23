/**
 * Handles edge case if there are no more labels for this user to validate.
 * Creates an overlay that notifies user that there are no more labels left for them to validate
 * at the moment. Disables controls, shortcuts.
 * @returns {ModalNoNewMission}
 * @constructor
 */
function ModalNoNewMission (uiModalMission) {
    let self = this;

    let instructions = isMobile() ? i18next.t('mobile.no-new-mission-body') : i18next.t('mission-complete.no-new-mission-body');
    let noMissionsRemaining = '<figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + instructions + '</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        if (isMobile()) {
            svv.tracker.push("Click_NoMoreMissionModal_ValidateSeattle");
            window.location.replace("https://sidewalk-sea.cs.washington.edu/validate");
        } else {
            svv.tracker.push("Click_NoMoreMissionModal_Audit");
            window.location.replace("/explore");
        }
    }

    function show () {
        if (svv.keyboard) {
            svv.keyboard.disableKeyboard();
        }
        uiModalMission.background.css('visibility', 'visible');
        uiModalMission.instruction.html(noMissionsRemaining);
        uiModalMission.missionTitle.html(i18next.t('mission-complete.no-new-mission-title'));
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');

        // Update and widen the button to fit more text when there is no new mission.
        if (isMobile()) {
            uiModalMission.closeButton.html(i18next.t('mobile.no-new-mission-button') + ` Seattle, WA`);
            uiModalMission.closeButton.css('font-size', '40pt');
            uiModalMission.closeButton.css('width', '76%');
            uiModalMission.closeButton.css('margin-right', '12%');
        } else {
            uiModalMission.closeButton.html(i18next.t('mission-complete.no-new-mission-button'));
            uiModalMission.closeButton.css('font-size', '20pt');
            uiModalMission.closeButton.css('width', '40%');
            uiModalMission.closeButton.css('margin-right', '30%');
        }
        uiModalMission.closeButton.on('click', _handleButtonClick);
        uiModalMission.holder.css('display', '');
    }

    self.show = show;

    return self;
}
