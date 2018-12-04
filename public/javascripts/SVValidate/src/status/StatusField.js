/**
 * Updates items that appear on the right side of the validation interface (i.e., label counts)
 * @param missionMetadata   Metadata for the initial mission
 * @returns {StatusField}
 * @constructor
 */
function StatusField(missionMetadata) {
    var self = this;

    var labelNames = {
        CurbRamp : "Curb Ramp",
        NoCurbRamp : "Missing Curb Ramp",
        Obstacle : "Obstacle in Path",
        SurfaceProblem : "Surface Problem",
        NoSidewalk : "Missing Sidewalk",
        Other : "Other"
    };

    /**
     * Function to initialize the status field the first time.
     * Sets the mission description to validate the number of labels in the initial mission.
     * TODO: Feels really sloppy... is there a better way to do this?
     * @private
     */
    function _init() {
        updateMissionDescription(missionMetadata.labels_validated);
        setProgressText(missionMetadata.labels_progress / missionMetadata.labels_validated);
        setProgressText(missionMetadata.labels_progress / missionMetadata.labels_validated)
    }

    /**
     * Updates the number of labels the user has validated.
     * @param count {int} Number of labels the user has validated.
     */
    function updateLabelCounts(count) {
        svv.ui.status.labelCount.html(count);
    }

    /**
     * Updates the label name that is displayed in the status field.
     * Updates the label name that is displayed in the title bar.
     * TODO: Clean this up! So messy :(
     * TODO: Make a file to keep track of useful constants, i.e., canvas width
     * @param labelType {String} Name of label without spaces.
     */
    function updateLabelText(labelType) {
        var labelName = labelNames[labelType];
        svv.ui.status.upperMenuTitle.html("Is this a " + labelName.bold() + "?");
        var offset = svv.ui.status.upperMenuTitle.width();
        var width = (720 - offset) / 2;
        svv.ui.status.upperMenuTitle.css("left", width + "px");

        svv.ui.status.labelTypeExample.html(labelName);
        svv.ui.status.labelTypeCounterexample.html("NOT".italics() + " a " + labelName);
    }

    /**
     * Updates the text for the mission description.
     * @param count {int} Number of labels to validate this mission.
     */
    function updateMissionDescription(count) {
        svv.ui.status.missionDescription.html("Validate " + count + " labels");
    }

    // TODO: write resizeTextSize function, if necessary
    /**
     * Updates the mission progress completion bar
     * @param completion
     */
    function setProgressBar(completionRate) {
        var color = completionRate < 1 ? 'rgba(0, 161, 203, 1)' : 'rgba(0, 222, 38, 1)';

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

    function setProgressText(completionRate) {
        completionRate *= 100;
        if (completionRate > 100) completionRate = 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% complete";
        svv.ui.status.progressText.html(completionRate);
    }

    _init();

    self.setProgressBar = setProgressBar;
    self.setProgressText = setProgressText;
    self.updateLabelCounts = updateLabelCounts;
    self.updateLabelText = updateLabelText;
    self.updateMissionDescription = updateMissionDescription;

    return this;
}