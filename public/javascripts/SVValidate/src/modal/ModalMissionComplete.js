function ModalMissionComplete (uiModalMissionComplete, user, confirmationCode) {
    let self = this;
    let properties = {
        clickable: false
    };
    let watch;

    function _handleButtonClick(event) {
        // If they've done three missions and clicked the audit button, load the audit page.
        if (event.data.button === 'primary' && svv.missionsCompleted % 3 === 0 && !isMobile()) {
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

        uiModalMissionComplete.closeButtonPrimary.off('click');
        uiModalMissionComplete.closeButtonSecondary.off('click');
        uiModalMissionComplete.background.css('visibility', 'hidden');
        uiModalMissionComplete.holder.css('visibility', 'hidden');
        uiModalMissionComplete.foreground.css('visibility', 'hidden');
        uiModalMissionComplete.closeButtonPrimary.css('visibility', 'hidden');
        uiModalMissionComplete.closeButtonSecondary.css('visibility', 'hidden');
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
        let message = i18next.t('mission-complete.body-' + mission.getProperty('labelTypeId'), { n: totalLabels });

        // Disable user from clicking the "Validate next mission" button and set background to gray.
        uiModalMissionComplete.closeButtonPrimary.removeClass('btn-primary');
        uiModalMissionComplete.closeButtonPrimary.addClass('btn-loading');
        uiModalMissionComplete.closeButtonSecondary.removeClass('btn-secondary');
        uiModalMissionComplete.closeButtonSecondary.addClass('btn-loading');

        // Wait until next mission has been loaded before allowing the user to click the button.
        clearInterval(watch);
        watch = window.setInterval(function () {
            if (getProperty('clickable')) {
                // Enable button clicks, reset the CSS for primary/secondary close buttons.
                uiModalMissionComplete.closeButtonPrimary.removeClass('btn-loading');
                uiModalMissionComplete.closeButtonPrimary.addClass('btn-primary');
                uiModalMissionComplete.closeButtonPrimary.on('click', { button: 'primary' }, _handleButtonClick);
                uiModalMissionComplete.closeButtonSecondary.removeClass('btn-loading');
                uiModalMissionComplete.closeButtonSecondary.addClass('btn-secondary');
                uiModalMissionComplete.closeButtonSecondary.on('click', { button: 'secondary' }, _handleButtonClick);
                if (isMobile()) uiModalMissionComplete.closeButtonPrimary.css('font-size', '30pt');
                setProperty('clickable', false);
                clearInterval(watch);
            }
        }, 100);

        uiModalMissionComplete.background.css('visibility', 'visible');
        uiModalMissionComplete.missionTitle.html(i18next.t('mission-complete.title'));
        uiModalMissionComplete.message.html(message);
        uiModalMissionComplete.agreeCount.html(mission.getProperty("agreeCount"));
        uiModalMissionComplete.disagreeCount.html(mission.getProperty("disagreeCount"));
        uiModalMissionComplete.notSureCount.html(mission.getProperty("notSureCount"));
        uiModalMissionComplete.yourOverallTotalCount.html(svv.statusField.getCompletedValidations());

        uiModalMissionComplete.holder.css('visibility', 'visible');
        uiModalMissionComplete.foreground.css('visibility', 'visible');

        // Set button text to auditing if they've completed 3 validation missions (and are on a laptop/desktop). If they
        // are a turker, only give them the option to audit. O/w let them choose b/w auditing and validating.
        if (svv.missionsCompleted % 3 === 0 && !isMobile()) {
            uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.explore'));
            uiModalMissionComplete.closeButtonPrimary.css('visibility', 'visible');

            if (user.getProperty('role') === 'Turker') {
                uiModalMissionComplete.closeButtonPrimary.css('width', '100%');
                uiModalMissionComplete.closeButtonSecondary.css('visibility', 'hidden');
            } else {
                uiModalMissionComplete.closeButtonPrimary.css('width', '60%');
                uiModalMissionComplete.closeButtonSecondary.html(i18next.t('mission-complete.continue'));
                uiModalMissionComplete.closeButtonSecondary.css('visibility', 'visible');
                uiModalMissionComplete.closeButtonSecondary.css('width', '39%');
            }
        } else {
            uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.validate-more'));
            uiModalMissionComplete.closeButtonPrimary.css('visibility', 'visible');
            uiModalMissionComplete.closeButtonPrimary.css('width', '100%');

            uiModalMissionComplete.closeButtonSecondary.css('visibility', 'hidden');
        }
        if (isMobile()) uiModalMissionComplete.closeButtonPrimary.css('font-size', '30pt');

        // TODO this code was removed for issue #1693, search for "#1693" and uncomment all later.
        // If this is a turker and the confirmation code button hasn't been shown yet, mark amt_assignment as complete
        // and reveal the confirmation code. Take care to handle the mobile use case when this is added back in.

        // if (user.getProperty('role') === 'Turker' && confirmationCode.css('visibility') === 'hidden') {
        //     _markAmtAssignmentAsComplete();
        //     _showConfirmationCode();
        //     let confirmationCodeElement = document.createElement("h3");
        //     confirmationCodeElement.innerHTML = "<img src='/assets/javascripts/SVLabel/img/icons/Icon_OrangeCheckmark.png'  \" +\n" +
        //         "                \"alt='Confirmation Code icon' align='middle' style='top:-1px;position:relative;width:18px;height:18px;'> " +
        //         i18next.t('common:mission-complete-confirmation-code') +
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
    //     confirmationCode.attr('title', i18next.t('common:left-ui-turk-submit-code'));
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
