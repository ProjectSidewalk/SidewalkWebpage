function ModalMissionComplete (uiModalMissionComplete, user, confirmationCode) {
    let self = this;
    let properties = {
        clickable: false
    };
    let watch;

    function _handleButtonClick() {
        if (svv.missionsCompleted === 3) {
            // Load the audit page since they've done 3 missions.
            window.location.replace('/audit');
        } else {
            self.hide();
        }
    }

    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Hides the mission complete menu. Waits until the next mission has been initialized and the
     * first label has been loaded onto the screen.
     */
    function hide () {
        // Have to remove the effect since keyup event did not go through (but no keyboard use on /rapidValidate).
        if (svv.keyboard) {
            svv.keyboard.removeAllKeyPressVisualEffect();
            svv.keyboard.enableKeyboard();
        }

        uiModalMissionComplete.closeButton.off('click');
        uiModalMissionComplete.background.css('visibility', 'hidden');
        uiModalMissionComplete.holder.css('visibility', 'hidden');
        uiModalMissionComplete.foreground.css('visibility', 'hidden');
    }

    function setProperty(key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Displays the mission complete screen.
     * @param mission   Object for the mission that was just completed.
     */
    function show (mission) {
        // Disable keyboard on /validate (/rapidValidate doesn't have keyboard shortcuts right now).
        if (svv.keyboard) {
            svv.keyboard.disableKeyboard();
        }
        let totalLabels = mission.getProperty("agreeCount") + mission.getProperty("disagreeCount")
            + mission.getProperty("notSureCount");
        let message = "You just validated " + totalLabels + " " +
            svv.labelTypeNames[mission.getProperty("labelTypeId")] + " labels!";

        // Disable user from clicking the "Validate next mission" button and set background to gray
        uiModalMissionComplete.closeButton.css('background', '#7f7f7f');
        uiModalMissionComplete.closeButton.css('cursor', 'wait');

        // Wait until next mission has been loaded before allowing the user to click the button
        clearInterval(watch);
        watch = window.setInterval(function () {
            if (getProperty('clickable')) {
                // Enable button clicks, change the background to blue
                uiModalMissionComplete.closeButton.css('background', '#3182bd');
                uiModalMissionComplete.closeButton.css('cursor', 'pointer');
                uiModalMissionComplete.closeButton.on('click', _handleButtonClick);
                setProperty('clickable', false);
                clearInterval(watch);
            }
        }, 100);

        uiModalMissionComplete.background.css('visibility', 'visible');
        uiModalMissionComplete.missionTitle.html("Great Job!");
        uiModalMissionComplete.message.html(message);
        uiModalMissionComplete.agreeCount.html(mission.getProperty("agreeCount"));
        uiModalMissionComplete.disagreeCount.html(mission.getProperty("disagreeCount"));
        uiModalMissionComplete.notSureCount.html(mission.getProperty("notSureCount"));

        uiModalMissionComplete.holder.css('visibility', 'visible');
        uiModalMissionComplete.foreground.css('visibility', 'visible');
        uiModalMissionComplete.closeButton.html('Validate more labels');

        // TODO this code was removed for issue #1693, search for "#1693" and uncomment all later.
        // If this is a turker and the confirmation code button hasn't been shown yet, mark amt_assignment as complete
        // and reveal the confirmation code. Take care to handle the mobile use case when this is added back in.

        // if (user.getProperty('role') === 'Turker' && confirmationCode.css('visibility') === 'hidden') {
        //     _markAmtAssignmentAsComplete();
        //     _showConfirmationCode();
        //     let confirmationCodeElement = document.createElement("h3");
        //     confirmationCodeElement.innerHTML = "<img src='/assets/javascripts/SVLabel/img/icons/Icon_OrangeCheckmark.png'  \" +\n" +
        //         "                \"alt='Confirmation Code icon' align='middle' style='top:-1px;position:relative;width:18px;height:18px;'> " +
        //         "Confirmation Code: " +
        //         svv.confirmationCode +
        //         "<p></p>";
        //     confirmationCodeElement.setAttribute("id", "modal-mission-complete-confirmation-text");
        //     uiModalMissionComplete.message.append(confirmationCodeElement);
        // }

        svv.tracker.push(
            "MissionComplete",
            {
                missionId: mission.getProperty("missionId"),
                missionType: mission.getProperty("missionType"),
                labelTypeId: mission.getProperty("labelTypeId"),
                labelsValidated: mission.getProperty("labelsValidated")
            }
        );
    }

    function _markAmtAssignmentAsComplete() {
        let data = {
            amt_assignment_id: svv.amtAssignmentId,
            completed: true
        };
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/amtAssignment",
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    // TODO this code was removed for issue #1693, search for "#1693" and uncomment all later.
    // function _showConfirmationCode() {
    //     confirmationCode.css('visibility', "");
    //     confirmationCode.attr('data-toggle','popover');
    //     confirmationCode.attr('title','Submit this code for HIT verification on Amazon Mechanical Turk');
    //     confirmationCode.attr('data-content', svv.confirmationCode);
    //     confirmationCode.popover();
    //
    //     //Hide the confirmation popover on clicking the background
    //     //https://stackoverflow.com/questions/11703093/how-to-dismiss-a-twitter-bootstrap-popover-by-clicking-outside
    //     $(document).on('click', function(e) {
    //         confirmationCode.each(function () {
    //             // The 'is' for buttons that trigger popups.
    //             // The 'has' for icons within a button that triggers a popup.
    //             if (!$(this).is(e.target) && $(this).has(e.target).length === 0 && $('.popover').has(e.target).length === 0) {
    //                 (($(this).popover('hide').data('bs.popover')||{}).inState||{}).click = false
    //             }
    //
    //         });
    //     });
    // }

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

    self.getProperty = getProperty;
    self.hide = hide;
    self.setProperty = setProperty;
    self.show = show;
}
