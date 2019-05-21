function ModalMission (uiModalMission, user) {
    var self = this;

    var validationStartMissionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Your mission is to determine the correctness of  __LABELCOUNT_PLACEHOLDER__ __LABELTYPE_PLACEHOLDER__</span> labels placed by other users!</p>\
        <div class="spacer10"></div>';

    var validationResumeMissionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Continue validating  __LABELCOUNT_PLACEHOLDER__ __LABELTYPE_PLACEHOLDER__</span> labels placed by other users!</p>\
        <div class="spacer10"></div>';

    function _handleButtonClick() {
        svv.tracker.push("ModalMission_ClickOK");
        svv.zoomControl.updateZoomAvailability();
        hide();
    }

    /**
     * Hides the new/continuing mission screen
     */
    function hide () {
        svv.keyboard.enableKeyboard();
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
            var validationMissionStartTitle = "Validate " + mission.getProperty("labelsValidated")
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
        if (!isMobile()) {
            if (user.getProperty("role") === "Turker") {
                var missionReward = mission.getProperty("pay");
                var missionRewardText = 'Reward on satisfactory completion: <span class="bold" style="color: forestgreen;">$__REWARD_PLACEHOLDER__</span>';
                missionRewardText = missionRewardText.replace("__REWARD_PLACEHOLDER__", missionReward.toFixed(2));
                svv.ui.status.currentMissionReward.html("Current Mission Reward: <span style='color:forestgreen'>$" + missionReward.toFixed(2)) + "</span>";
                uiModalMission.rewardText.html(missionRewardText);

                $.ajax({
                    async: true,
                    url: '/rewardEarned',
                    type: 'get',
                    success: function (rewardData) {
                        svv.ui.status.totalMissionReward.html("Total Earned Reward: <span style='color:forestgreen'>$" + rewardData.reward_earned.toFixed(2)) + "</span>";
                    },
                    error: function (xhr, ajaxOptions, thrownError) {
                        console.log(thrownError);
                    }
                })
            }
        }
    }

    function show (title, instruction) {
        svv.keyboard.disableKeyboard();
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

    //detect if mobile
    function isMobile() {
        var isMobile = false; //initiate as false
        // device detection
        if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|ipad|iris|kindle|Android|Silk|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(navigator.userAgent)
            || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(navigator.userAgent.substr(0, 4))) {
            isMobile = true;
        }
        return isMobile;
    }

    self.hide = hide;
    self.setMissionMessage = setMissionMessage;
    self.show = show;

    return this;
}
