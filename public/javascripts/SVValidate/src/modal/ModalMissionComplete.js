function ModalMissionComplete (uiModalMissionComplete, user) {
    let self = this;
    let properties = {
        clickable: false
    };
    let watch;

    function _handleButtonClick(event) {
        // If they've done three missions and clicked the audit button, load the explore page.
        if (event.data.button === 'primary' && svv.missionsCompleted % 3 === 0 && !isMobile()) {
            window.location.replace('/explore');
        } else {

            // If there is a new validate mission available, we should show the mission screens.
            const newMission = svv.missionContainer.getCurrentMission();
            if (newMission && newMission.getProperty('missionType') === 'validation') {
                const labelTypeID = newMission.getProperty('labelTypeId');
                const missionStartTutorial = new MissionStartTutorial('validate', svv.labelTypes[labelTypeID], {nLabels: newMission.getProperty('labelsValidated')}, svv);
            }

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
        // Have to remove the effect since keyup event did not go through (but no keyboard use on mobile).
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
        // Disable keyboard on mobile.
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

    self.getProperty = getProperty;
    self.hide = hide;
    self.setProperty = setProperty;
    self.show = show;
}
