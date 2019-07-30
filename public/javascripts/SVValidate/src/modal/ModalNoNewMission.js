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
        <p>Click the button to start exploring.</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        svv.tracker.push("Click_NoMoreMissionModal_Audit");
        window.location.replace("/audit");
    }

    function show () {
        svv.keyboard.disableKeyboard();
        uiModalMission.background.css('visibility', 'visible');
        uiModalMission.instruction.html(noMissionsRemaining);
        uiModalMission.missionTitle.html("No more validation missions left");
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.closeButton.html('Start Exploring');
        uiModalMission.closeButton.on('click', _handleButtonClick);
    }

    self.show = show;

    return self;
}
