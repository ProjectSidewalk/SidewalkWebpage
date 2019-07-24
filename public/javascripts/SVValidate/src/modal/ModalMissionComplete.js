function ModalMissionComplete (uiModalMissionComplete, user, confirmationCode) {
    var self = this;
    var properties = {
        clickable: false
    };
    var watch;

    function _handleButtonClick() {
        if (svv.missionsCompleted === 3) {
            // Load the audit page since they've done 2 missions.
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
        svv.keyboard.disableKeyboard();
        var totalLabels = mission.getProperty("agreeCount") + mission.getProperty("disagreeCount")
            + mission.getProperty("notSureCount");
        var message = "You just validated " + totalLabels + " " +
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
        // and reveal the confirmation code.
        // if (user.getProperty('role') === 'Turker' && confirmationCode.css('visibility') === 'hidden') {
        //     _markAmtAssignmentAsComplete();
        //     _showConfirmationCode();
        //     var confirmationCodeElement = document.createElement("h3");
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
        var data = {
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

    self.getProperty = getProperty;
    self.hide = hide;
    self.setProperty = setProperty;
    self.show = show;
}
