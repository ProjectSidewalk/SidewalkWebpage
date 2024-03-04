/**
 * Holds the list of labels to be validated, and distributes them to the panoramas that are on the
 * page. Fetches labels from the backend and converts them into Labels that can be placed onto the
 * GSV Panorama.
 * @param labelList     Initial list of labels to be validated (generated when the page is loaded).
 * @returns {PanoramaContainer}
 * @constructor
 */
function PanoramaContainer (labelList) {
    let labels = labelList;    // labels that all panoramas from the screen are going to be validating from
    let properties = {
        progress: 0             // used to keep track of which index to retrieve from labels
    };
    let self = this;

    /**
     * Initializes panorama(s) on the validate page.
     * @private
     */
    function _init () {
        svv.panorama = new Panorama(labelList[getProperty("progress")]);
        setProperty("progress", getProperty("progress") + 1);

        // Set the HTML
        svv.statusField.updateLabelText(labelList[0].getAuditProperty('labelType'));
        svv.statusExample.updateLabelImage(labelList[0].getAuditProperty('labelType'));
        if (svv.adminVersion) svv.statusField.updateAdminInfo();
    }

    /**
     * Fetches a single label from the database.  When the user clicks skip, need to get more
     * because missions fetch exactly the number of labels that are needed to complete the mission.
     * @param skippedLabelId the ID of the label that we are skipping
     */
    function fetchNewLabel (skippedLabelId) {
        let labelTypeId = svv.missionContainer.getCurrentMission().getProperty('labelTypeId');
        let labelUrl = '/label/geo/random/' + labelTypeId + '/' + skippedLabelId;

        let data = {};
        data.labels = svv.labelContainer.getCurrentLabels();

        if (data.constructor !== Array) {
            data = [data];
        }

        $.ajax({
            async: false,
            contentType: 'application/json; charset=utf-8',
            url: labelUrl,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (labelMetadata) {
                labels.push(new Label(labelMetadata));
                svv.missionContainer.updateAMissionSkip();
                loadNewLabelOntoPanorama(svv.panorama);
            }
        });
    }

    /**
     * Gets a specific property from the PanoramaContainer.
     * @param key   Property name.
     * @returns     Value associated with this property or null.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Loads a new label onto a panorama after the user validates a label.
     */
    function loadNewLabelOntoPanorama() {
        // If no more labels are left, show no more validations modal (should on happen on Admin Validate).
        if (labels[getProperty('progress')] === undefined) {
            svv.modalNoNewMission.show();
        } else {
            svv.panorama.setLabel(labels[getProperty('progress')]);
            setProperty('progress', getProperty('progress') + 1);
            if (svv.labelVisibilityControl && !svv.labelVisibilityControl.isVisible()) {
                svv.labelVisibilityControl.unhideLabel(true);
            }

            // Update zoom availability on desktop.
            if (svv.zoomControl) {
                svv.zoomControl.updateZoomAvailability();
            }

            if (svv.adminVersion) svv.statusField.updateAdminInfo();
        }
    }

    function getCurrentLabel() {
        return labels[getProperty('progress') - 1];
    }

    /**
     * Resets the validation interface for a new mission. Loads a new set of label onto the panoramas.
     */
    function reset() {
        setProperty('progress', 0);
        loadNewLabelOntoPanorama();
    }

    /**
     * Creates a list of label objects to be validated from label metadata.
     * Called when a new mission is loaded onto the screen.
     * @param labelList Object containing key-value pairings of {index: labelMetadata}
     */
    function setLabelList (labelList) {
        Object.keys(labelList).map(function(key, index) {
            labelList[key] = new Label(labelList[key]);
        });

        labels = labelList;
    }

    /**
     * Sets a property for the PanoramaContainer.
     * @param key   Name of property
     * @param value Value of property.
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Validates the label.
     */
    function validateLabel(action, timestamp, comment) {
        svv.panorama.getCurrentLabel().validate(action, comment);
        svv.panorama.setProperty('validationTimestamp', timestamp);
    }

    self.fetchNewLabel = fetchNewLabel;
    self.getProperty = getProperty;
    self.loadNewLabelOntoPanorama = loadNewLabelOntoPanorama;
    self.getCurrentLabel = getCurrentLabel;
    self.setProperty = setProperty;
    self.reset = reset;
    self.setLabelList = setLabelList;
    self.validateLabel = validateLabel;

    _init();

    return this;
}
