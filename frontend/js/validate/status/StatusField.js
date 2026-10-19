/**
 * Tracks the number of completed validations for the user, updating the progress bar throughout the mission.
 */

import { BadgeAchievements } from '../../common/BadgeAchievements.js';
import { ProgressBar } from '../../common/ProgressBar.js';
import { util } from '../../common/utilities.js';
import '../../common/utilitiesSidewalk.js';
/** @typedef {import('../mission/Mission.js').Mission} Mission */
/** @typedef {import('../Main.js').ValidateUi} ValidateUi */

export class StatusField {
  #completedValidations;
  #statusUI;
  /** @type {?HTMLElement} The menu column's header, which names the label type; desktop only. */
  #menuHeader;
  #progressBar;

  /**
   * @param {number} completedValidationsParam - The number of validations the user has completed all time.
   * @param {ValidateUi} ui - The title bar's elements, plus the desktop menu header that repeats the label type.
   */
  constructor(completedValidationsParam, ui) {
    this.#completedValidations = completedValidationsParam;
    this.#statusUI = ui.status;
    this.#menuHeader = ui.validationMenu.header;
    this.#progressBar = new ProgressBar('mission-progress-bar-complete', 'mission-progress-bar-text');
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
   * @param {number} missionLength - How many labels the mission asks for, for the title's count.
   */
  updateLabelText(labelType, missionLength) {
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
    if (this.#menuHeader) {
      this.#menuHeader.innerHTML = i18next.t(`top-ui.title.${util.camelToKebab(labelType)}`);
    }
  }

  /**
   * Updates the mission progress completion bar by setting the width of the green portion.
   */
  setProgressBar(progress, total) {
    this.#progressBar.setFraction(progress / total);
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
