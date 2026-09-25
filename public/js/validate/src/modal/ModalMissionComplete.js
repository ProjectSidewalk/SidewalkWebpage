/**
 * Displays the mission complete screen at the end of a validation mission.
 */
class ModalMissionComplete {
  #uiModalMissionComplete;
  #language;

  /**
   * @param {object} uiModalMissionComplete - Mission-complete modal UI elements.
   * @param {object} user - Current user.
   * @param {string} [language] - Language code passed on to the mission start tutorial.
   */
  constructor(uiModalMissionComplete, user, language = 'en') {
    this.#uiModalMissionComplete = uiModalMissionComplete;
    this.#language = language;
  }

  /**
   * @param {'primary'|'secondary'} button - Which of the two close buttons was clicked.
   */
  #handleButtonClick = (button) => {
    // If they've done three missions and clicked the audit button, load the explore page.
    if (button === 'primary' && svv.missionsCompleted % 3 === 0 && !util.isMobile()) {
      window.location.replace('/explore');
    } else {
      // If there is a new validate mission available, show the mission screens. Desktop only: the phone's briefing is
      // ModalMission's carousel, and this tutorial's markup isn't on that page.
      const newMission = svv.missionContainer.getCurrentMission();
      if (!util.isMobile() && newMission && newMission.getProperty('missionType') === 'validation') {
        new MissionStartTutorial(
          'validate', newMission.getProperty('labelType'),
          { nLabels: newMission.getProperty('labelsValidated') }, svv, this.#language,
        );
      }

      this.hide();

      // The new mission's first label rendered while this modal was still up (Form.js loads it before re-enabling
      // the button), so its halo pulse played unseen. Replay it now that the marker can be seen — or once the
      // mission-start tutorial raised just above clears (#4790).
      svv.panoManager.replayMarkerPulse();
    }
  };

  /**
   * Hides the mission complete menu.
   */
  hide() {
    const ui = this.#uiModalMissionComplete;
    ui.closeButtonPrimary.onclick = null;
    ui.closeButtonSecondary.onclick = null;
    ui.background.style.visibility = 'hidden';
    ui.holder.style.visibility = 'hidden';
    ui.foreground.style.visibility = 'hidden';
    ui.closeButtonPrimary.style.visibility = 'hidden';
    ui.closeButtonSecondary.style.visibility = 'hidden';
  }

  /**
   * Says where this mission leaves the validator overall: the badge their all-time validation count has earned, if
   * they have earned one, and the count itself.
   *
   * The badge and its wording are mobile's; the desktop screen has no badge and keeps the bare number.
   *
   * @param {number} total - The validator's all-time validation count.
   */
  #showStanding(total) {
    const ui = this.#uiModalMissionComplete;
    ui.yourOverallTotalCount.innerHTML = util.isMobile()
      ? i18next.t('mission-complete.all-time', { count: total, interpolation: { escapeValue: true } })
      : String(total);
    if (!ui.badgeIcon) return;

    const { badge, next, fraction, remaining } = BadgeAchievements.getProgress('validations', total);
    ui.badgeIcon.classList.toggle('ps-hidden', !badge);
    ui.badgeName.textContent = badge ? `${badge.name} ${badge.roman}` : '';
    if (badge) ui.badgeIcon.style.backgroundImage = `url("${badge.iconSrc}")`;

    // What they're climbing toward, which is what makes the badge legible as a level rather than a decoration. It's
    // the same line for someone who has none yet: their first badge is simply the next one.
    if (ui.badgeProgressFill) new ProgressBar(ui.badgeProgressFill).setFraction(fraction);
    ui.badgeNext.textContent = next
      ? i18next.t('mission-complete.next-badge', { count: remaining, badge: `${next.name} ${next.roman}` })
      : i18next.t('mission-complete.top-badge');
  }

  /**
   * Sets off the fireworks — and a short buzz where the device does haptics — for a finished mission.
   *
   * The animation rides a class rather than the screen's own visibility because `visibility: hidden` doesn't rewind
   * one, and this screen is shown over and over. Both are pure celebration, so a visitor who asked for less motion
   * gets neither. Mobile only: the desktop screen has no fireworks to play.
   */
  static #celebrate() {
    const celebration = document.getElementById('mission-complete-celebration');
    if (!celebration || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    celebration.classList.remove('mv-celebrate--play');
    celebration.getBoundingClientRect(); // Forces the reflow that lets the same animation play again.
    celebration.classList.add('mv-celebrate--play');
    navigator.vibrate?.([40, 60, 40]);
    Confetti.burst();
  }

  /**
   * Displays the mission complete screen.
   * @param {Mission} mission - Object for the mission that was just completed.
   */
  show(mission) {
    // Disable keyboard on mobile.
    svv.undoValidation.disableUndo();
    if (svv.keyboard) {
      svv.keyboard.disableKeyboard();
    }
    const totalLabels = mission.getProperty('agreeCount') + mission.getProperty('disagreeCount')
      + mission.getProperty('unsureCount');
    const message = i18next.t(`mission-complete.body-${mission.getProperty('labelType')}`, {
      n: totalLabels, interpolation: { escapeValue: true },
    });

    // Disable user from clicking the 'Validate next mission' button and set background to gray. When we have a new
    // mission from the back end, nextMissionLoaded() will be called from Form.js to re-enable the button.
    const ui = this.#uiModalMissionComplete;
    ui.closeButtonPrimary.classList.remove('btn-primary');
    ui.closeButtonPrimary.classList.add('btn-loading');
    ui.closeButtonSecondary.classList.remove('btn-secondary');
    ui.closeButtonSecondary.classList.add('btn-loading');

    ui.background.style.visibility = 'visible';
    ui.missionTitle.innerHTML = i18next.t('mission-complete.title');
    ui.message.innerHTML = message;
    // Mobile shows the mission's label type beside that sentence; the element is absent on desktop.
    const labelType = mission.getProperty('labelType');
    if (ui.labelIcon) {
      ui.labelIcon.style.backgroundImage = `url("${util.misc.getIconImagePaths(labelType).iconImagePath}")`;
    }
    ui.agreeCount.textContent = mission.getProperty('agreeCount');
    ui.disagreeCount.textContent = mission.getProperty('disagreeCount');
    ui.unsureCount.textContent = mission.getProperty('unsureCount');
    this.#showStanding(svv.statusField.getCompletedValidations());

    ui.holder.style.visibility = 'visible';
    ui.foreground.style.visibility = 'visible';
    // Hiding this screen only makes it invisible, which preserves how far it was scrolled, and it is shown again at
    // the end of every mission — so without this the next one opens wherever the last one was left.
    ui.foreground.scrollTop = 0;
    ModalMissionComplete.#celebrate();

    // Set primary button text to Explore if they've completed 3 validation missions (and are on a laptop/desktop).
    if (svv.missionsCompleted % 3 === 0 && !util.isMobile()) {
      ui.closeButtonPrimary.innerHTML = i18next.t('mission-complete.explore');
      ui.closeButtonPrimary.style.visibility = 'visible';
      ui.closeButtonPrimary.style.width = '60%';
      ui.closeButtonSecondary.innerHTML = i18next.t('mission-complete.continue');
      ui.closeButtonSecondary.style.visibility = 'visible';
      ui.closeButtonSecondary.style.width = '39%';
    } else {
      ui.closeButtonPrimary.innerHTML = i18next.t('mission-complete.validate-more');
      ui.closeButtonPrimary.style.visibility = 'visible';
      ui.closeButtonPrimary.style.width = '100%';

      ui.closeButtonSecondary.style.visibility = 'hidden';
    }

    svv.tracker.push(
      'MissionComplete',
      {
        missionId: mission.getProperty('missionId'),
        missionType: mission.getProperty('missionType'),
        labelType: mission.getProperty('labelType'),
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
    // Re-enable the buttons. Handlers are assigned, not added, so a second load can't stack a second handler.
    const ui = this.#uiModalMissionComplete;
    ui.closeButtonPrimary.classList.remove('btn-loading');
    ui.closeButtonPrimary.classList.add('btn-primary');
    ui.closeButtonPrimary.onclick = () => this.#handleButtonClick('primary');
    ui.closeButtonSecondary.classList.remove('btn-loading');
    ui.closeButtonSecondary.classList.add('btn-secondary');
    ui.closeButtonSecondary.onclick = () => this.#handleButtonClick('secondary');
  }
}
