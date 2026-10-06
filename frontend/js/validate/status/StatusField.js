/**
 * Tracks the number of completed validations for the user, updating the progress bar throughout the mission.
 */

import { svv } from '../svv.js';
import { BadgeAchievements } from '../../common/BadgeAchievements.js';
import { ProgressBar } from '../../common/ProgressBar.js';
import { util } from '../../common/utilities.js';
import '../../common/utilitiesSidewalk.js';
/** @typedef {import('../mission/Mission.js').Mission} Mission */

export class StatusField {
  #completedValidations;
  #statusUI;
  #progressBar;
  #dots;

  // Past this many labels the dots won't fit the phone's pill; the plain bar stands in.
  static #MAX_DOTS = 20;

  /**
   * @param {number} completedValidationsParam - The number of validations the user has completed all time.
   */
  constructor(completedValidationsParam) {
    this.#completedValidations = completedValidationsParam;
    this.#statusUI = svv.ui.status;
    this.#progressBar = new ProgressBar('mission-progress-bar-complete', 'mission-progress-bar-text');
    this.#dots = document.getElementById('mission-progress-dots');
  }

  /**
   * Resets the status field whenever a new mission is introduced.
   *
   * @param {Mission} currentMission - Mission object for the current mission.
   */
  reset(currentMission) {
    const progress = currentMission.getProperty('labelsProgress');
    const total = currentMission.getProperty('labelsValidated');
    this.setProgressText(progress, total);
    this.setProgressBar(progress, total);
    this.setProgressDots(currentMission.getVerdicts(), total);
  }

  /**
   * Increments the number of labels the user has validated.
   */
  incrementLabelCounts() {
    const prevCount = this.#completedValidations;
    this.#completedValidations++;
    this.#checkBadgeUnlock(prevCount, this.#completedValidations);
  }

  /**
   * Shows a badge-unlock toast over the panorama if this validation crossed into a new validation-badge level.
   *
   * @param {number} oldCount - The user's all-time validation count before this validation.
   * @param {number} newCount - The user's all-time validation count after this validation.
   */
  #checkBadgeUnlock(oldCount, newCount) {
    const badge = BadgeAchievements.detectUnlock('validations', oldCount, newCount);
    if (badge) BadgeAchievements.showUnlockToast(badge, document.getElementById('svv-panorama-holder'));
  }

  /**
   * Decrements the number of labels the user has validated (used in undo).
   */
  decrementLabelCounts() {
    this.#completedValidations--;
  }

  /**
   * Updates the label name that is displayed in the title bar and above the validation section.
   *
   * @param {string} labelType - Name of label without spaces.
   */
  updateLabelText(labelType) {
    const missionLength = svv.missionContainer
      ? svv.missionContainer.getCurrentMission().getProperty('labelsValidated')
      : svv.missionLength;
    // The title bar takes HTML, so the count is escaped; the type name is written `{{- labelType}}`. The case is left
    // alone: the boxed and mobile titles uppercase it in CSS, immersive mode's pill does not.
    const newMissionTitle = i18next.t('mission-start-tutorial.mst-instruction-2', {
      nLabels: missionLength,
      labelType: util.misc.labelTypeName(labelType),
      interpolation: { escapeValue: true },
    });
    this.#statusUI.upperMenuTitle.innerHTML = newMissionTitle;
    if (this.#statusUI.upperMenuIcon) {
      this.#statusUI.upperMenuIcon.src = util.misc.getIconImagePaths(labelType).iconImagePath;
    }
    // The menu header is desktop's; the phone has no menu column.
    if (svv.ui.validationMenu.header) {
      svv.ui.validationMenu.header.innerHTML = i18next.t(`top-ui.title.${util.camelToKebab(labelType)}`);
    }
  }

  /**
   * Updates the mission progress completion bar by setting the width of the green portion.
   */
  setProgressBar(progress, total) {
    this.#progressBar.setFraction(progress / total);
  }

  /**
   * Draws the mission as a row of dots, one per label, each validated one in its verdict's colour (#5580): the phone
   * pill's progress, where the bar told only how far along the mission was and not how it was going. CSS shows the
   * row only where the pill uses it; a mission too long to fit hides it and keeps the bar. Decorative to a screen
   * reader, which already has the count beside it.
   *
   * @param {Array<?string>} verdicts - The verdict per validated label, null where this page never saw it.
   * @param {number} total - The mission's length.
   */
  setProgressDots(verdicts, total) {
    if (!this.#dots) return;
    this.#dots.hidden = total > StatusField.#MAX_DOTS;
    if (this.#dots.hidden) return;
    const modifier = { Agree: 'agree', Disagree: 'disagree', Unsure: 'unsure' };
    this.#dots.replaceChildren(...Array.from({ length: total }, (_, i) => {
      const dot = document.createElement('span');
      dot.className = 'svv-mission-dot';
      if (i < verdicts.length) dot.classList.add(`svv-mission-dot--${modifier[verdicts[i]] ?? 'done'}`);
      return dot;
    }));
  }

  /**
   * Updates the percentage on the progress bar to show how much of the validation mission the user has completed.
   */
  setProgressText(progress, total) {
    this.#progressBar.setLabel(`${progress}/${total}`); // No-op on mobile.
  }

  /**
   * @returns {number} The user's total validation count.
   */
  getCompletedValidations() {
    return this.#completedValidations;
  }
}
