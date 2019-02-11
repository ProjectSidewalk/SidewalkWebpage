/**
 * Handles edge case if there are no more labels for this user to validate.
 * Creates an overlay that notifies user that there are no more labels left for them to validate
 * at the moment. Disables controls, shortcuts.
 * @returns {ModalNoNewMission}
 * @constructor
 */
function ModalNoNewMission (uiModalMission) {
    var self = this;

    var noMissionsRemaining = '<figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Please come back later! In the meanwhile, free feel to start auditing.</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        window.location.replace("/audit");
    }

    function show () {
        uiModalMission.background.css('visibility', 'visible');
        uiModalMission.instruction.html(noMissionsRemaining);
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.closeButton.html('Start Auditing');
        uiModalMission.closeButton.on('click', _handleButtonClick);
    }

    self.show = show;

    return self;
}
