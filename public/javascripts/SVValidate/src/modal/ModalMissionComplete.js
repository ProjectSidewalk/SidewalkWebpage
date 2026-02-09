function ModalMissionComplete (uiModalMissionComplete, user, language = 'en') {
    const self = this;

    function _handleButtonClick(event) {
        // If they've done three missions and clicked the audit button, load the explore page.
        if (event.data.button === 'primary' && svv.missionsCompleted % 3 === 0 && !isMobile()) {
            window.location.replace('/explore');
        } else {
            // If there is a new validate mission available, we should show the mission screens.
            const newMission = svv.missionContainer.getCurrentMission();
            if (newMission && newMission.getProperty('missionType') === 'validation') {
                const labelTypeID = newMission.getProperty('labelTypeId');
                const missionStartTutorial = new MissionStartTutorial('validate', svv.labelTypes[labelTypeID], {nLabels: newMission.getProperty('labelsValidated')}, svv, language);
            }

            self.hide();
        }
    }

    /**
     * Hides the mission complete menu. Waits until the next mission has been initialized and the
     * first label has been loaded onto the screen.
     */
    function hide() {
        // Have to remove the effect since keyup event did not go through (but no keyboard use on mobile).
        if (svv.keyboard) {
            svv.keyboard.removeAllKeyPressVisualEffect();
        }

        uiModalMissionComplete.closeButtonPrimary.off('click');
        uiModalMissionComplete.closeButtonSecondary.off('click');
        uiModalMissionComplete.background.css('visibility', 'hidden');
        uiModalMissionComplete.holder.css('visibility', 'hidden');
        uiModalMissionComplete.foreground.css('visibility', 'hidden');
        uiModalMissionComplete.closeButtonPrimary.css('visibility', 'hidden');
        uiModalMissionComplete.closeButtonSecondary.css('visibility', 'hidden');
    }

    /**
     * Displays the mission complete screen.
     * @param mission   Object for the mission that was just completed.
     */
    function show(mission) {
        // Disable keyboard on mobile.
        svv.undoValidation.disableUndo();
        if (svv.keyboard) {
            svv.keyboard.disableKeyboard();
        }
        let totalLabels = mission.getProperty('agreeCount') + mission.getProperty('disagreeCount')
            + mission.getProperty('unsureCount');
        let message = i18next.t('mission-complete.body-' + mission.getProperty('labelTypeId'), { n: totalLabels });

        // Disable user from clicking the 'Validate next mission' button and set background to gray. When we have a new
        // mission from the back end, nextMissionLoaded() will be called from Form.js to re-enable the button.
        uiModalMissionComplete.closeButtonPrimary.removeClass('btn-primary');
        uiModalMissionComplete.closeButtonPrimary.addClass('btn-loading');
        uiModalMissionComplete.closeButtonSecondary.removeClass('btn-secondary');
        uiModalMissionComplete.closeButtonSecondary.addClass('btn-loading');

        uiModalMissionComplete.background.css('visibility', 'visible');
        uiModalMissionComplete.missionTitle.html(i18next.t('mission-complete.title'));
        uiModalMissionComplete.message.html(message);
        uiModalMissionComplete.agreeCount.html(mission.getProperty('agreeCount'));
        uiModalMissionComplete.disagreeCount.html(mission.getProperty('disagreeCount'));
        uiModalMissionComplete.unsureCount.html(mission.getProperty('unsureCount'));
        uiModalMissionComplete.yourOverallTotalCount.html(svv.statusField.getCompletedValidations());

        uiModalMissionComplete.holder.css('visibility', 'visible');
        uiModalMissionComplete.foreground.css('visibility', 'visible');

        // Set primary button text to Explore if they've completed 3 validation missions (and are on a laptop/desktop).
        if (svv.missionsCompleted % 3 === 0 && !isMobile()) {
            uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.explore'));
            uiModalMissionComplete.closeButtonPrimary.css('visibility', 'visible');
            uiModalMissionComplete.closeButtonPrimary.css('width', '60%');
            uiModalMissionComplete.closeButtonSecondary.html(i18next.t('mission-complete.continue'));
            uiModalMissionComplete.closeButtonSecondary.css('visibility', 'visible');
            uiModalMissionComplete.closeButtonSecondary.css('width', '39%');
        } else {
            uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.validate-more'));
            uiModalMissionComplete.closeButtonPrimary.css('visibility', 'visible');
            uiModalMissionComplete.closeButtonPrimary.css('width', '100%');

            uiModalMissionComplete.closeButtonSecondary.css('visibility', 'hidden');
        }
        if (isMobile()) uiModalMissionComplete.closeButtonPrimary.css('font-size', '30pt');

        svv.tracker.push(
            'MissionComplete',
            {
                missionId: mission.getProperty('missionId'),
                missionType: mission.getProperty('missionType'),
                labelTypeId: mission.getProperty('labelTypeId'),
                labelsValidated: mission.getProperty('labelsValidated')
            }
        );
    }

    /**
     * Re-enables the start next mission button; called once a new mission has loaded from the back end.
     */
    function nextMissionLoaded() {
        // Enable button clicks, reset the CSS for primary/secondary close buttons.
        uiModalMissionComplete.closeButtonPrimary.removeClass('btn-loading');
        uiModalMissionComplete.closeButtonPrimary.addClass('btn-primary');
        uiModalMissionComplete.closeButtonPrimary.on('click', { button: 'primary' }, _handleButtonClick);
        uiModalMissionComplete.closeButtonSecondary.removeClass('btn-loading');
        uiModalMissionComplete.closeButtonSecondary.addClass('btn-secondary');
        uiModalMissionComplete.closeButtonSecondary.on('click', { button: 'secondary' }, _handleButtonClick);
        if (isMobile()) uiModalMissionComplete.closeButtonPrimary.css('font-size', '30pt');
    }

    self.hide = hide;
    self.show = show;
    self.nextMissionLoaded = nextMissionLoaded;
}
