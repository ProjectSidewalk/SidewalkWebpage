/**
 * Updates items that appear on the right side of the validation interface (i.e., label counts)
 * @param param must have:
 *                  - completedValidations: the number of validations the user has completed in all time. 
 * @returns {StatusField}
 * @constructor
 */
function StatusField(param) {
    let containerWidth = 730;
    let self = this;
    let completedValidations = param.completedValidations;
    let statusUI = svv.ui.status;
    let valerdateProgressBarProgress = $('#mission-progress-bar-complete');
    let valerdateProgressBarRemaining = $('#mission-progress-bar-incomplete');
    let valerdateProgressBarText = $('#mission-progress-bar-text');

    /**
     * Resets the status field whenever a new mission is introduced.
     * @param currentMission    Mission object for the current mission.
     */
    function reset(currentMission) {
        let progress = currentMission.getProperty('labelsProgress');
        let total = currentMission.getProperty('labelsValidated');
        refreshLabelCountsDisplay();
        updateMissionDescription(total);
        setProgressText(progress, total);
        setProgressBar(progress, total);
    }

    /**
     * Increments the number of labels the user has validated.
     */
    function incrementLabelCounts(){
        completedValidations++;
        refreshLabelCountsDisplay();
    }

    /**
     * Decrements the number of labels the user has validated (used in undo).
     */
    function decrementLabelCounts(){
        completedValidations--;
        refreshLabelCountsDisplay();
    }

    /**
     * Refreshes the number count displayed.
     */
    function refreshLabelCountsDisplay(){
        statusUI.labelCount.html(completedValidations);
    }

    /**
     * Updates the label name that is displayed in the status field and title bar.
     * @param labelType {String} Name of label without spaces.
     */
    function updateLabelText(labelType) {
        // Centers and updates title top of the validation interface.
        statusUI.upperMenuTitle.html(i18next.t(`top-ui.title.${util.camelToKebab(labelType)}`));
        let offset = statusUI.zoomInButton.outerWidth()
            + statusUI.zoomOutButton.outerWidth()
            + statusUI.labelVisibilityControlButton.outerWidth();
        let width = ((svv.canvasWidth - offset) / 2) - (statusUI.upperMenuTitle.outerWidth() / 2);
        statusUI.upperMenuTitle.css("left", width + "px");
    }

    /**
     * Updates the text for the mission description.
     * @param count {Number} Number of labels to validate this mission.
     */
    function updateMissionDescription(count) {
        statusUI.missionDescription.html(i18next.t('right-ui.current-mission.validate-labels', { n: count }));
    }

    /**
     * Updates the mission progress completion bar
     */
    function setProgressBar(progress, total) {
        let completionRate = progress / total;
        let color = completionRate < 1 ? 'rgba(0, 161, 203, 1)' : 'rgba(0, 222, 38, 1)';

        completionRate *=  100;
        if (completionRate > 100) completionRate = 100;

        completionRate = completionRate.toFixed(0);
        completionRate = completionRate + "%";

        // Update blue portion of progress bar
        statusUI.progressFiller.css({
            background: color,
            width: completionRate
        });

        if (svv.valerdate) {
            valerdateProgressBarProgress.css({ width: completionRate });
            valerdateProgressBarRemaining.css({ width: 100 * (total - progress) / total + "%" });
        }
    }

    /**
     * Updates the percentage on the progress bar to show how much of the validation mission the user has completed.
     */
    function setProgressText(progress, total) {
        let completionRate = progress / total;
        completionRate *= 100;
        if (completionRate > 100) completionRate = 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% " + i18next.t('common:complete');
        statusUI.progressText.html(completionRate);
        if (svv.valerdate) valerdateProgressBarText.text(`${progress}/${total}`);
    }

    /**
     * Returns the user's total validation count.
     */
    function getCompletedValidations(){
      return completedValidations;
    }

    /**
     * Updates the admin HTML with extra information about the label being validated. Only call if on Admin Validate!
     */
    function updateAdminInfo() {
        if (svv.adminVersion) {
            // Update the status area with extra info if on Admin Validate.
            const user = svv.panorama.getCurrentLabel().getAdminProperty('username');
            statusUI.admin.username.html(`<a href="/admin/user/${user}" target="_blank">${user}</a>`);
            statusUI.admin.labelId.html(svv.panorama.getCurrentLabel().getAuditProperty('labelId'));

            // Remove prior set of previous validations and add the new set.
            document.querySelectorAll('.prev-val').forEach(e => e.remove());
            const prevVals = svv.panorama.getCurrentLabel().getAdminProperty('previousValidations');
            if (prevVals.length === 0) {
                // TODO statusUI.admin.prevValidations
                $(`<p class="prev-val">None</p>`).insertAfter('#curr-label-prev-validations');
            } else {
                for (const prevVal of svv.panorama.getCurrentLabel().getAdminProperty('previousValidations')) {
                    $(`<p class="prev-val"><a href="/admin/user/${prevVal.username}" target="_blank">${prevVal.username}</a>: ${i18next.t(`common:${util.camelToKebab(prevVal.validation)}`)}</p>`)
                        .insertAfter('#curr-label-prev-validations');
                }
            }
        }
    }

    self.setProgressBar = setProgressBar;
    self.setProgressText = setProgressText;
    self.updateLabelText = updateLabelText;
    self.updateMissionDescription = updateMissionDescription;
    self.refreshLabelCountsDisplay = refreshLabelCountsDisplay;
    self.incrementLabelCounts = incrementLabelCounts;
    self.decrementLabelCounts = decrementLabelCounts;
    self.reset = reset;
    self.getCompletedValidations = getCompletedValidations;
    self.updateAdminInfo = updateAdminInfo;

    return this;
}
