/**
 * Tracks the number of completed validations for the user, updating the progress bar throughout the mission.
 */
class StatusField {
    #completedValidations;
    #statusUI;
    #progressBar;

    /**
     * @param {number} completedValidationsParam The number of validations the user has completed all time.
     */
    constructor(completedValidationsParam) {
        this.#completedValidations = completedValidationsParam;
        this.#statusUI = svv.ui.status;
        this.#progressBar = new ProgressBar('mission-progress-bar-complete', 'mission-progress-bar-text');
    }

    /**
     * Resets the status field whenever a new mission is introduced.
     *
     * @param {Mission} currentMission Mission object for the current mission.
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
     * @param {number} oldCount The user's all-time validation count before this validation.
     * @param {number} newCount The user's all-time validation count after this validation.
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
     * @param {string} labelType Name of label without spaces.
     */
    updateLabelText(labelType) {
        const missionLength = svv.missionContainer ? svv.missionContainer.getCurrentMission().getProperty('labelsValidated') : svv.missionLength;
        const newMissionTitle = i18next.t(
            'mission-start-tutorial.mst-instruction-2',
            {'nLabels': missionLength, 'labelType': i18next.t(`common:${util.camelToKebab(labelType)}`)}
        ).toUpperCase().replace(/&SHY;/g, '&shy;');
        this.#statusUI.upperMenuTitle.html(newMissionTitle);
        svv.ui.validationMenu.header.html(i18next.t(`top-ui.title.${util.camelToKebab(labelType)}`));
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
