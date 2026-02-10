function ModalMission (uiModalMission, user) {
    const self = this;

    let validationStartMissionHTML = ' <figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + i18next.t('mission-start.body') + '</p>\
        <div class="spacer10"></div>';

    let validationResumeMissionHTML = ' <figure> \
        <img src="/assets/images/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Continue validating  __LABELCOUNT_PLACEHOLDER__ __LABELTYPE_PLACEHOLDER__</span> labels placed by other users!</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        let mission = svv.missionContainer.getCurrentMission();

        // Check added so that if a user begins a mission, leaves partway through, and then resumes the mission later,
        // another MissionStart will not be triggered
        if(mission.getProperty("labelsProgress") < 1) {
            svv.tracker.push(
                "MissionStart",
                {
                    missionId: mission.getProperty("missionId"),
                    missionType: mission.getProperty("missionType"),
                    labelTypeId: mission.getProperty("labelTypeId"),
                    labelsValidated: mission.getProperty("labelsValidated")
                }
            );
        }
        // Update zoom availability on desktop.
        if (svv.zoomControl) {
            svv.zoomControl.updateZoomAvailability();
        }
        hide();
    }

    /**
     * Hides the new/continuing mission screen.
     */
    function hide () {
        if (svv.keyboard) {
            // We still want to disable keyboard shortcuts if the comment box is shown.
            if ($('#modal-comment-box').is(":hidden")) {
                svv.keyboard.enableKeyboard();
            } else {
                svv.keyboard.disableKeyboard();
            }
        }
        uiModalMission.background.css('visibility', 'hidden');
        uiModalMission.holder.css('visibility', 'hidden');
        uiModalMission.foreground.css('visibility', 'hidden');
    }

    /**
     * Generates HTML for the new mission screen with information about the current mission
     * (label type, length of validation mission)
     * @param mission   Mission object for the new mission
     */
    function setMissionMessage(mission) {
        if (mission.getProperty("labelsProgress") === 0) {
            let validationMissionStartTitle = i18next.t('mission-start.title',
                {
                    n: mission.getProperty("labelsValidated"),
                    label_type: svv.labelTypeNames[mission.getProperty("labelTypeId")]
                });
            let validationStartMissionHTMLCopy = validationStartMissionHTML.replace("__LABELCOUNT_PLACEHOLDER__", mission.getProperty("labelsValidated"));
            validationStartMissionHTMLCopy = validationStartMissionHTMLCopy.replace("__LABELTYPE_PLACEHOLDER__", svv.labelTypeNames[mission.getProperty("labelTypeId")]);
            show(validationMissionStartTitle, validationStartMissionHTMLCopy);
        } else {
            validationMissionStartTitle = "Return to your mission";
            let validationResumeMissionHTMLCopy = validationResumeMissionHTML.replace("__LABELCOUNT_PLACEHOLDER__", mission.getProperty("labelsValidated"));
            validationResumeMissionHTMLCopy = validationResumeMissionHTMLCopy.replace("__LABELTYPE_PLACEHOLDER__", svv.labelTypeNames[mission.getProperty("labelTypeId")]);
            show(validationMissionStartTitle, validationResumeMissionHTMLCopy);
        }
    }

    function show (title, instruction) {
        // Disable keyboard on mobile.
        if (svv.keyboard) {
            svv.keyboard.disableKeyboard();
        }
        if (instruction) {
            uiModalMission.instruction.html(instruction);
        }

        uiModalMission.background.css('visibility', 'visible');
        uiModalMission.missionTitle.html(title);
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.closeButton.html('Ok');
        uiModalMission.closeButton.off('click').on('click', _handleButtonClick);
    }

    self.hide = hide;
    self.setMissionMessage = setMissionMessage;
    self.show = show;

    return this;
}
