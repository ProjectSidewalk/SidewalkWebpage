/**
 * Holds the list of labels to be validated, and distributes them to the panoramas that are on the
 * page. Fetches labels from the backend and converts them into Labels that can be placed onto the
 * GSV Panorama.
 * @param labelList Initial list of labels to be validated (generated when the page is loaded).
 * @returns {PanoramaContainer}
 * @constructor
 */
function PanoramaContainer (labelList) {
    var self = this;
    var labels = labelList;    // labels that all panoramas from the screen are going to be validating from
    var properties = {
        progress: 0             // used to keep track of which index to retrieve from labels
    };

    /**
     * Initializes panorama(s) on the validate page.
     * @private
     */
    function _init () {
        svv.panorama = new Panorama(labelList[getProperty("progress")]);
        setProperty("progress", 1);
    }

    /**
     * Uses label metadata to initialize a new label.
     * @param metadata  Metadata for the label.
     * @returns {Label} Label object for this label.
     * @private
     */
    function _createSingleLabel (metadata) {
        var labelMetadata = {
            canvasHeight: metadata.canvas_height,
            canvasWidth: metadata.canvas_width,
            canvasX: metadata.canvas_x,
            canvasY: metadata.canvas_y,
            gsvPanoramaId: metadata.gsv_panorama_id,
            heading: metadata.heading,
            labelId: metadata.label_id,
            labelType: metadata.label_type,
            pitch: metadata.pitch,
            zoom: metadata.zoom,
            severity: metadata.severity,
            temporary: metadata.temporary,
            description: metadata.description,
            tags: metadata.tags
        };
        return new Label(labelMetadata);
    }

    /**
     * Fetches a single label from the database.  When the user clicks skip, need to get more
     * because missions fetch exactly the number of labels that are needed to complete the mission.
     */
    function fetchNewLabel () {
        var labelTypeId = svv.missionContainer.getCurrentMission().getProperty('labelTypeId');
        var labelUrl = "/label/geo/random/" + labelTypeId;

        var data = {};
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
                labels.push(_createSingleLabel(labelMetadata));
                svv.missionContainer.updateAMissionSkip();
                loadNewLabelOntoPanorama();
            }
        });
    }

    /**
     * Gets the list of labels assigned to this panorama for the current mission.
     * NOTE: This is used for testing purposes. It does not have any functionality for the
     * validation interface at the moment.
     * @returns {*} Returns the label list for this panorama.
     */
    function getLabels () {
        return labels;
    }

    /**
     * Gets a specific property from the PanoramaContainer.
     * @param key   Property name.
     * @returns     Value associated with this property or null.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    function loadNewLabelOntoPanorama () {
        svv.panorama.setLabel(labels[getProperty('progress')]);
        setProperty('progress', getProperty('progress') + 1);
        if (!svv.labelVisibilityControlButton.isVisible()) {
            svv.labelVisibilityControlButton.unhideLabel();
        }
        svv.zoomControl.updateZoomAvailability();
    }

    /**
     * Resets the state of the mission.
     * Called when a new validation mission is loaded, and when we need to get rid of lingering
     * data from the previous validation mission.
     */
    function reset () {
        setProperty('progress', 0);
    }

    /**
     * Creates a list of label objects to be validated from label metadata.
     * Called when a new mission is loaded onto the screen.
     * @param labelList Object containing key-value pairings of (index, labelMetadata)
     */
    function setLabelList (labelList) {
        Object.keys(labelList).map(function(key, index) {
            labelList[key] = _createSingleLabel(labelList[key]);
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
     * Retrieves a label with a given id from the database and adds it to the label list.
     * NOTE: Currently unused, but may be useful later.
     * @param labelId   label_id of the desired label.
     */
    function setLabelWithId (labelId) {
        var labelUrl = "/label/geo/" + labelId;
        $.ajax({
            url: labelUrl,
            async: false,
            dataType: 'json',
            success: function (labelMetadata) {
                var label = _createSingleLabel(labelMetadata);
                labels.push(label);
            }
        });
    }

    self.fetchNewLabel = fetchNewLabel;
    self.getLabels = getLabels;
    self.getProperty = getProperty;
    self.loadNewLabelOntoPanorama = loadNewLabelOntoPanorama;
    self.setProperty = setProperty;
    self.reset = reset;
    self.setLabelList = setLabelList;

    _init();

    return this;
}
