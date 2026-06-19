/**
 * Tracks the number of completed validations for the user, updating the progress bar throughout the mission.
 *
 * @param {number} completedValidationsParam The number of validations the user has completed all time
 * @returns {StatusField}
 * @constructor
 */
function StatusField(completedValidationsParam) {
    const self = this;
    let completedValidations = completedValidationsParam;
    const statusUI = svv.ui.status;
    const progressBar = new ProgressBar('mission-progress-bar-complete', 'mission-progress-bar-text');

    /**
     * Resets the status field whenever a new mission is introduced.
     *
     * @param {Mission} currentMission Mission object for the current mission
     */
    function reset(currentMission) {
        let progress = currentMission.getProperty('labelsProgress');
        let total = currentMission.getProperty('labelsValidated');
        setProgressText(progress, total);
        setProgressBar(progress, total);
    }

    /**
     * Increments the number of labels the user has validated.
     */
    function incrementLabelCounts(){
        let prevCount = completedValidations;
        completedValidations++;
        checkBadgeUnlock(prevCount, completedValidations);
    }

    /**
     * Shows a badge-unlock toast over the panorama if this validation crossed into a new validation-badge level.
     *
     * @param {number} oldCount The user's all-time validation count before this validation.
     * @param {number} newCount The user's all-time validation count after this validation.
     */
    function checkBadgeUnlock(oldCount, newCount) {
        let badge = BadgeAchievements.detectUnlock('validations', oldCount, newCount);
        if (badge) BadgeAchievements.showUnlockToast(badge, document.getElementById('svv-panorama-holder'));
    }

    /**
     * Decrements the number of labels the user has validated (used in undo).
     */
    function decrementLabelCounts(){
        completedValidations--;
    }

    /**
     * Updates the label name that is displayed in the title bar and above the validation section.
     *
     * @param labelType {string} Name of label without spaces.
     */
    function updateLabelText(labelType) {
        let missionLength = svv.missionContainer ? svv.missionContainer.getCurrentMission().getProperty('labelsValidated') : svv.missionLength;
        let newMissionTitle = i18next.t(
            'mission-start-tutorial.mst-instruction-2',
            {'nLabels': missionLength, 'labelType': i18next.t(`common:${util.camelToKebab(labelType)}`)}
        ).toUpperCase().replace(/&SHY;/g, '&shy;');
        statusUI.upperMenuTitle.html(newMissionTitle);
        svv.ui.validationMenu.header.html(i18next.t(`top-ui.title.${util.camelToKebab(labelType)}`));
    }

    /**
     * Updates the mission progress completion bar by setting the width of the green portion.
     */
    function setProgressBar(progress, total) {
        progressBar.setFraction(progress / total);
    }

    /**
     * Updates the percentage on the progress bar to show how much of the validation mission the user has completed.
     */
    function setProgressText(progress, total) {
        progressBar.setLabel(`${progress}/${total}`); // No-op on mobile.
    }

    /**
     * Returns the user's total validation count.
     */
    function getCompletedValidations() {
      return completedValidations;
    }

    self.setProgressBar = setProgressBar;
    self.setProgressText = setProgressText;
    self.updateLabelText = updateLabelText;
    self.incrementLabelCounts = incrementLabelCounts;
    self.decrementLabelCounts = decrementLabelCounts;
    self.reset = reset;
    self.getCompletedValidations = getCompletedValidations;

    return this;
}
