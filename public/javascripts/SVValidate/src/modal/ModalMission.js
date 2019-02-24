function ModalMission (uiModalMission) {
    var self = this;
    var labelTypeName = {
        1: "Curb Ramp",
        2: "Missing Curb Ramp",
        3: "Obstacle in Path",
        4: "Surface Problem",
        7: "No Sidewalk"
    };

    var validationMissionDescriptionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Your mission is to determine the correctness of  __LABELCOUNT_PLACEHOLDER__ __LABELTYPE_PLACEHOLDER__</span> labels placed by other users!</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        svv.tracker.push("ModalMission_ClickOK");
        hide();
    }

    function hide () {
        uiModalMission.background.css('visibility', 'hidden');
        uiModalMission.holder.css('visibility', 'hidden');
        uiModalMission.foreground.css('visibility', 'hidden');
    }

    function setMissionMessage(mission) {
        if (mission.getProperty("labelsProgress") === 0) {
            var validationMissionStartTitle = "Validate " + mission.getProperty("labelsValidated")
                + " " + labelTypeName[mission.getProperty("labelTypeId")] + " labels";
            validationMissionDescriptionHTML = validationMissionDescriptionHTML.replace("__LABELCOUNT_PLACEHOLDER__", mission.getProperty("labelsValidated"));
            validationMissionDescriptionHTML = validationMissionDescriptionHTML.replace("__LABELTYPE_PLACEHOLDER__", labelTypeName[mission.getProperty("labelTypeId")]);
            show(validationMissionStartTitle, validationMissionDescriptionHTML);
        }
    }

    function show (title, instruction) {
        uiModalMission.background.css('visibility', 'visible');
        uiModalMission.instruction.html(instruction);
        uiModalMission.missionTitle.html(title);
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.closeButton.html('Ok');
        uiModalMission.closeButton.on('click', _handleButtonClick);
    }

    self.hide = hide;
    self.setMissionMessage = setMissionMessage;
    self.show = show;

    return this;
}
