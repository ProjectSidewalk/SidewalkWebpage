/**
 * Displays the mission complete screen at the end of a validation mission.
 */
class ModalMissionComplete {
  #uiModalMissionComplete;
  #language;

  /**
   * @param {object} uiModalMissionComplete Mission-complete modal UI elements.
   * @param {object} user Current user.
   * @param {string} [language] Language code passed on to the mission start tutorial.
   */
  constructor(uiModalMissionComplete, user, language = 'en') {
    this.#uiModalMissionComplete = uiModalMissionComplete;
    this.#language = language;
  }

  #handleButtonClick = (event) => {
    // If they've done three missions and clicked the audit button, load the explore page.
    if (event.data.button === 'primary' && svv.missionsCompleted % 3 === 0 && !util.isMobile()) {
      window.location.replace('/explore');
    } else {
      // If there is a new validate mission available, we should show the mission screens.
      const newMission = svv.missionContainer.getCurrentMission();
      if (newMission && newMission.getProperty('missionType') === 'validation') {
        const labelTypeID = newMission.getProperty('labelTypeId');
        new MissionStartTutorial(
          'validate', svv.labelTypes[labelTypeID],
          { nLabels: newMission.getProperty('labelsValidated') }, svv, this.#language,
        );
      }

      this.hide();
    }
  };

  /**
   * Hides the mission complete menu.
   */
  hide() {
    this.#uiModalMissionComplete.closeButtonPrimary.off('click');
    this.#uiModalMissionComplete.closeButtonSecondary.off('click');
    this.#uiModalMissionComplete.background.css('visibility', 'hidden');
    this.#uiModalMissionComplete.holder.css('visibility', 'hidden');
    this.#uiModalMissionComplete.foreground.css('visibility', 'hidden');
    this.#uiModalMissionComplete.closeButtonPrimary.css('visibility', 'hidden');
    this.#uiModalMissionComplete.closeButtonSecondary.css('visibility', 'hidden');
  }

  /**
   * Displays the mission complete screen.
   * @param {Mission} mission Object for the mission that was just completed.
   */
  show(mission) {
    // Disable keyboard on mobile.
    svv.undoValidation.disableUndo();
    if (svv.keyboard) {
      svv.keyboard.disableKeyboard();
    }
    const totalLabels = mission.getProperty('agreeCount') + mission.getProperty('disagreeCount')
      + mission.getProperty('unsureCount');
    const message = i18next.t(`mission-complete.body-${mission.getProperty('labelTypeId')}`, { n: totalLabels });

    // Disable user from clicking the 'Validate next mission' button and set background to gray. When we have a new
    // mission from the back end, nextMissionLoaded() will be called from Form.js to re-enable the button.
    this.#uiModalMissionComplete.closeButtonPrimary.removeClass('btn-primary');
    this.#uiModalMissionComplete.closeButtonPrimary.addClass('btn-loading');
    this.#uiModalMissionComplete.closeButtonSecondary.removeClass('btn-secondary');
    this.#uiModalMissionComplete.closeButtonSecondary.addClass('btn-loading');

    this.#uiModalMissionComplete.background.css('visibility', 'visible');
    this.#uiModalMissionComplete.missionTitle.html(i18next.t('mission-complete.title'));
    this.#uiModalMissionComplete.message.html(message);
    this.#uiModalMissionComplete.agreeCount.html(mission.getProperty('agreeCount'));
    this.#uiModalMissionComplete.disagreeCount.html(mission.getProperty('disagreeCount'));
    this.#uiModalMissionComplete.unsureCount.html(mission.getProperty('unsureCount'));
    this.#uiModalMissionComplete.yourOverallTotalCount.html(svv.statusField.getCompletedValidations());

    this.#uiModalMissionComplete.holder.css('visibility', 'visible');
    this.#uiModalMissionComplete.foreground.css('visibility', 'visible');

    // Set primary button text to Explore if they've completed 3 validation missions (and are on a laptop/desktop).
    if (svv.missionsCompleted % 3 === 0 && !util.isMobile()) {
      this.#uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.explore'));
      this.#uiModalMissionComplete.closeButtonPrimary.css('visibility', 'visible');
      this.#uiModalMissionComplete.closeButtonPrimary.css('width', '60%');
      this.#uiModalMissionComplete.closeButtonSecondary.html(i18next.t('mission-complete.continue'));
      this.#uiModalMissionComplete.closeButtonSecondary.css('visibility', 'visible');
      this.#uiModalMissionComplete.closeButtonSecondary.css('width', '39%');
    } else {
      this.#uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.validate-more'));
      this.#uiModalMissionComplete.closeButtonPrimary.css('visibility', 'visible');
      this.#uiModalMissionComplete.closeButtonPrimary.css('width', '100%');

      this.#uiModalMissionComplete.closeButtonSecondary.css('visibility', 'hidden');
    }
    if (util.isMobile()) this.#uiModalMissionComplete.closeButtonPrimary.css('font-size', '30pt');

    svv.tracker.push(
      'MissionComplete',
      {
        missionId: mission.getProperty('missionId'),
        missionType: mission.getProperty('missionType'),
        labelTypeId: mission.getProperty('labelTypeId'),
        labelsValidated: mission.getProperty('labelsValidated'),
      },
    );

    // Celebrate a newly unlocked mission badge if this completion crossed a threshold.
    BadgeAchievements.recordMissionComplete(document.getElementById('modal-mission-complete-foreground'));
  }

  /**
   * Re-enables the start next mission button; called once a new mission has loaded from the back end.
   */
  nextMissionLoaded() {
    // Enable button clicks, reset the CSS for primary/secondary close buttons.
    this.#uiModalMissionComplete.closeButtonPrimary.removeClass('btn-loading');
    this.#uiModalMissionComplete.closeButtonPrimary.addClass('btn-primary');
    this.#uiModalMissionComplete.closeButtonPrimary.on('click', { button: 'primary' }, this.#handleButtonClick);
    this.#uiModalMissionComplete.closeButtonSecondary.removeClass('btn-loading');
    this.#uiModalMissionComplete.closeButtonSecondary.addClass('btn-secondary');
    this.#uiModalMissionComplete.closeButtonSecondary.on('click', { button: 'secondary' }, this.#handleButtonClick);
    if (util.isMobile()) this.#uiModalMissionComplete.closeButtonPrimary.css('font-size', '30pt');
  }
}
