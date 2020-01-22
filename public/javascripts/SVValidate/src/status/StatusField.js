/**
 * Updates items that appear on the right side of the validation interface (i.e., label counts)
 * @returns {StatusField}
 * @constructor
 */
function StatusField() {
    let containerWidth = 730;
    let self = this;

    /**
     * Creates the prefix that comes before a label.
     * @param labelType
     * @returns {string}
     */
    function createPrefix (labelType) {
        if (labelType === "Obstacle") {
            return "an ";
        } else {
            return "a ";
        }
    }

    /**
     * Resets the status field whenever a new mission is introduced.
     * @param currentMission    Mission object for the current mission.
     */
    function reset(currentMission) {
        let progress = currentMission.getProperty('labelsProgress');
        let total = currentMission.getProperty('labelsValidated');
        let completionRate = progress / total;
        updateLabelCounts(progress);
        updateMissionDescription(total);
        setProgressText(completionRate);
        setProgressBar(completionRate);
    }

    /**
     * Updates the number of labels the user has validated.
     * @param count {int} Number of labels the user has validated.
     */
    function updateLabelCounts(count) {
        svv.ui.status.labelCount.html(count);
    }

    /**
     * Updates the label name that is displayed in the status field and title bar.
     * @param labelType {String} Name of label without spaces.
     */
    function updateLabelText(labelType) {
        let labelName = svv.labelNames[labelType];
        let prefix = createPrefix(labelType);

        // Centers and updates title top of the validation interface.
        if (labelName === "No Sidewalk") {
            svv.ui.status.upperMenuTitle.html("Should there be a " + "No Sidewalk".bold() + " label here?");
        } else {
            svv.ui.status.upperMenuTitle.html("Is this " + prefix + labelName.bold() + "?");
        }
        let offset = svv.ui.status.zoomInButton.outerWidth()
            + svv.ui.status.zoomOutButton.outerWidth()
            + svv.ui.status.labelVisibilityControlButton.outerWidth();
        let width = ((svv.canvasWidth - offset) / 2) - (svv.ui.status.upperMenuTitle.outerWidth() / 2);
        svv.ui.status.upperMenuTitle.css("left", width + "px");

        // Changes text on on the status field (right side of the validation interface).
        svv.ui.status.labelTypeCounterexample.html("INCORRECT ".italics() + labelName);
        svv.ui.status.labelTypeExample.html("CORRECT " + labelName);
    }

    /**
     * Updates the text for the mission description.
     * @param count {Number} Number of labels to validate this mission.
     */
    function updateMissionDescription(count) {
        svv.ui.status.missionDescription.html("Validate " + count + " labels");
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
        completionRate = completionRate + "% complete";
        svv.ui.status.progressText.html(completionRate);
    }

    self.createPrefix = createPrefix;
    self.setProgressBar = setProgressBar;
    self.setProgressText = setProgressText;
    self.updateLabelCounts = updateLabelCounts;
    self.updateLabelText = updateLabelText;
    self.updateMissionDescription = updateMissionDescription;
    self.reset = reset;

    return this;
}
