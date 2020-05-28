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
    /**
     * Resets the status field whenever a new mission is introduced.
     * @param currentMission    Mission object for the current mission.
     */
    function reset(currentMission) {
        let progress = currentMission.getProperty('labelsProgress');
        let total = currentMission.getProperty('labelsValidated');
        let completionRate = progress / total;
        refreshLabelCountsDisplay();
        updateMissionDescription(total);
        setProgressText(completionRate);
        setProgressBar(completionRate);
    }

    /**
     * Increments the number of labels the user has validated.
     */
    function incrementLabelCounts(){
        completedValidations++;
        refreshLabelCountsDisplay();
    }

    /**
     * Refreshes the number count displayed.
     */
    function refreshLabelCountsDisplay(){
        svv.ui.status.labelCount.html(completedValidations);
    }

    /**
     * Updates the label name that is displayed in the status field and title bar.
     * @param labelType {String} Name of label without spaces.
     */
    function updateLabelText(labelType) {
        // Centers and updates title top of the validation interface.
        svv.ui.status.upperMenuTitle.html(i18next.t('top-ui.title.' + labelType));
        let offset = svv.ui.status.zoomInButton.outerWidth()
            + svv.ui.status.zoomOutButton.outerWidth()
            + svv.ui.status.labelVisibilityControlButton.outerWidth();
        let width = ((svv.canvasWidth - offset) / 2) - (svv.ui.status.upperMenuTitle.outerWidth() / 2);
        svv.ui.status.upperMenuTitle.css("left", width + "px");

        // Changes text on on the status field (right side of the validation interface).
        svv.ui.status.labelTypeExample.html(i18next.t('right-ui.correct.' + labelType + ".title"));
        svv.ui.status.labelTypeCounterexample.html(i18next.t('right-ui.incorrect.' + labelType + ".title"));
    }

    /**
     * Updates the text for the mission description.
     * @param count {Number} Number of labels to validate this mission.
     */
    function updateMissionDescription(count) {
        svv.ui.status.missionDescription.html(i18next.t('right-ui.current-mission.validate-labels', { n: count }));
    }

    /**
     * Updates the mission progress completion bar
     * @param completionRate    Proportion of this region completed (0 <= completionRate <= 1)
     */
    function setProgressBar(completionRate) {
        let color = completionRate < 1 ? 'rgba(0, 161, 203, 1)' : 'rgba(0, 222, 38, 1)';

        completionRate *=  100;
        if (completionRate > 100) completionRate = 100;

        completionRate = completionRate.toFixed(0);
        completionRate = completionRate + "%";

        // Update blue portion of progress bar
        svv.ui.status.progressFiller.css({
            background: color,
            width: completionRate
        });
    }

    /**
     * Updates the percentage on the progress bar to show what percentage of the validation mission
     * the user has completed.
     * @param completionRate    {Number} Proportion of completed validations.
     */
    function setProgressText(completionRate) {
        completionRate *= 100;
        if (completionRate > 100) completionRate = 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% " + i18next.t('common:complete');
        svv.ui.status.progressText.html(completionRate);
    }

    self.setProgressBar = setProgressBar;
    self.setProgressText = setProgressText;
    self.updateLabelText = updateLabelText;
    self.updateMissionDescription = updateMissionDescription;
    self.refreshLabelCountsDisplay = refreshLabelCountsDisplay;
    self.incrementLabelCounts = incrementLabelCounts;
    self.reset = reset;

    return this;
}
