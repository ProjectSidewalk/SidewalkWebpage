/**
 * Function that keeps track of labels that have appeared on the panorama
 * @returns {LabelContainer}
 * @constructor
 */
function LabelContainer() {
    var self = this;
    var currentLabels = [];
    var previousLabels = [];

    /**
     * Gets a list of current labels that have not been sent to the backend yet.
     * @returns {Array}
     */
    function getCurrentLabels() {
        return currentLabels;
    }

    /**
     * Pushes a label to the list of current labels.
     * @param labelMetadata     Label metadata (properties field)
     */
    function push(labelMetadata) {
        var data = {
            end_timestamp: labelMetadata.endTimestamp,
            label_id: labelMetadata.labelId,
            mission_id: svv.missionModel.getCurrentMission().getProperty("missionId"),
            start_timestamp: labelMetadata.startTimestamp,
            validation_result: labelMetadata.validationResult
        };

        currentLabels.push(data);
    }

    /**
     * Moves the currentLabels to previousLabels and clears the currentLabels array.
     */
    function refresh() {
        previousLabels.concat(currentLabels);
        currentLabels = [];
    }

    self.getCurrentLabels = getCurrentLabels;
    self.push = push;
    self.refresh = refresh;

    return this;
}