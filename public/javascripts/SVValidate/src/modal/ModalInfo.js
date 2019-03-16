/**
 * Handles info button functionality. Used for mobile. Pops up information about the current label.
 * @param uiModal
 * @returns {Modal Info}
 * @constructor
 */

function ModalInfo (uiModal) {
    var self = this;

    var validationMissionDescriptionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Your mission is to determine the correctness of  __LABELCOUNT_PLACEHOLDER__ __LABELTYPE_PLACEHOLDER__</span> labels placed by other users!</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        console.log("trying to close");
        svv.tracker.push("ModalMission_ClickOK");
        hide();
    }

    function hide () {
        uiModal.background.css('visibility', 'hidden');
        uiModal.holder.css('visibility', 'hidden');
        uiModal.foreground.css('visibility', 'hidden');
        cosole.log("attempting to close but failing");
    }

    function show (title, instruction) {
        uiModal.background.css('visibility', 'visible');
        uiModal.missionTitle.html(title);
        uiModal.holder.css('visibility', 'visible');
        uiModal.foreground.css('visibility', 'visible');
        uiModal.closeButton.html('Ok');
        console.log("I am being clicked on");
    }

    function setMissionMessage(mission) {
        if (mission.getProperty("labelsProgress") === 0) {
            var validationMissionStartTitle = "Validate " + mission.getProperty("labelsValidated")
                + " " + svv.labelTypeNames[mission.getProperty("labelTypeId")] + " labels";
            validationMissionDescriptionHTML = validationMissionDescriptionHTML.replace("__LABELCOUNT_PLACEHOLDER__", mission.getProperty("labelsValidated"));
            validationMissionDescriptionHTML = validationMissionDescriptionHTML.replace("__LABELTYPE_PLACEHOLDER__", svv.labelTypeNames[mission.getProperty("labelTypeId")]);
            show(validationMissionStartTitle, validationMissionDescriptionHTML);
        }
    }

    uiModal.infoButton.on("click", show);

    self.hide = hide;
    self.setMissionMessage = setMissionMessage;
    self.show = show;

    return this;
}
