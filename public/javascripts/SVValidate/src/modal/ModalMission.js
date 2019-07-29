function ModalMission (uiModalMission, user) {
    let self = this;

    let validationStartMissionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Your mission is to determine the correctness of  __LABELCOUNT_PLACEHOLDER__ __LABELTYPE_PLACEHOLDER__</span> labels placed by other users!</p>\
        <div class="spacer10"></div>';

    let validationResumeMissionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Continue validating  __LABELCOUNT_PLACEHOLDER__ __LABELTYPE_PLACEHOLDER__</span> labels placed by other users!</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        svv.tracker.push("ModalMission_ClickOK");
        if (svv.zoomControl) {
            svv.zoomControl.updateZoomAvailability();
        }
        hide();
    }

    /**
     * Hides the new/continuing mission screen
     */
    function hide () {
        if (svv.keyboard) {
            svv.keyboard.enableKeyboard();
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
            let validationMissionStartTitle = "Validate " + mission.getProperty("labelsValidated")
                + " " + svv.labelTypeNames[mission.getProperty("labelTypeId")] + " labels";
            validationStartMissionHTML = validationStartMissionHTML.replace("__LABELCOUNT_PLACEHOLDER__", mission.getProperty("labelsValidated"));
            validationStartMissionHTML = validationStartMissionHTML.replace("__LABELTYPE_PLACEHOLDER__", svv.labelTypeNames[mission.getProperty("labelTypeId")]);
            show(validationMissionStartTitle, validationStartMissionHTML);
        } else {
            validationMissionStartTitle = "Return to your mission";
            validationResumeMissionHTML = validationResumeMissionHTML.replace("__LABELCOUNT_PLACEHOLDER__", mission.getProperty("labelsValidated"));
            validationResumeMissionHTML = validationResumeMissionHTML.replace("__LABELTYPE_PLACEHOLDER__", svv.labelTypeNames[mission.getProperty("labelTypeId")]);
            show(validationMissionStartTitle, validationResumeMissionHTML);
        }

        // Update the reward HTML if the user is a turker.
        if (user.getProperty("role") === "Turker") {
            let missionReward = mission.getProperty("pay");
            let missionRewardText = 'Reward on satisfactory completion: <span class="bold" style="color: forestgreen;">$__REWARD_PLACEHOLDER__</span>';
            missionRewardText = missionRewardText.replace("__REWARD_PLACEHOLDER__", missionReward.toFixed(2));
            svv.ui.status.currentMissionReward.html("Current Mission Reward: <span style='color:forestgreen'>$" + missionReward.toFixed(2)) + "</span>";
            uiModalMission.rewardText.html(missionRewardText);

            $.ajax({
                async: true,
                url: '/rewardEarned',
                type: 'get',
                success: function(rewardData) {
                    svv.ui.status.totalMissionReward.html("Total Earned Reward: <span style='color:forestgreen'>$" + rewardData.reward_earned.toFixed(2)) + "</span>";
                },
                error: function (xhr, ajaxOptions, thrownError) {
                    console.log(thrownError);
                }
            })
        }
    }

    function show (title, instruction) {
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
        uiModalMission.closeButton.on('click', _handleButtonClick);
    }

    self.hide = hide;
    self.setMissionMessage = setMissionMessage;
    self.show = show;

    return this;
}
