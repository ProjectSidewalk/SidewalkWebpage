/**
 * Represents a validation label
 * @returns {Label}
 * @constructor
 */
function Label(params) {
    var properties = {
        canvasHeight: undefined,
        canvasWidth: undefined,
        canvasX: undefined,
        canvasY: undefined,
        endTimestamp: undefined,
        heading: undefined,
        labelId: undefined,
        labelType: undefined,
        pitch: undefined,
        startTimestamp: undefined,
        validationResult: undefined,
        zoom: undefined
    };

    var icons = {
        CurbRamp : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_CurbRamp.png',
        NoCurbRamp : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoCurbRamp.png',
        Obstacle : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Obstacle.png',
        SurfaceProblem : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_SurfaceProblem.png',
        Other : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other.png',
        Occlusion : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other.png',
        NoSidewalk : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoSidewalk.png'
    };

    var self = this;

    /**
     * Initializes a label from metadata (if parameters are passed in)
     * @private
     */
    function _init() {
        if (params) {
            if ("canvasHeight" in params) setProperty("canvasHeight", params.canvasHeight);
            if ("canvasWidth" in params) setProperty("canvasWidth", params.canvasWidth);
            if ("canvasX" in params) setProperty("canvasX", params.canvasX);
            if ("canvasY" in params) setProperty("canvasY", params.canvasY);
            if ("gsvPanoramaId" in params) setProperty("gsvPanoramaId", params.gsvPanoramaId);
            if ("heading" in params) setProperty("heading", params.heading);
            if ("labelId" in params) setProperty("labelId", params.labelId);
            if ("labelType" in params) setProperty("labelType", params.labelType);
            if ("pitch" in params) setProperty("pitch", params.pitch);
            if ("zoom" in params) setProperty("zoom", params.zoom);
            console.log("Initialized label " + getProperty("labelId"));
        }
    }

    /**
     * Gets the file path associated with the labels' icon type.
     * @returns {*} String - Path of image in the directory.
     */
    function getIconUrl() {
        return icons[properties.labelType];
    }

    /**
     * Returns a specific property of a label.
     * @param key   Name of property.
     * @returns     Property associated with the key.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Returns the entire property object for this label.
     * @returns Object for properties.
     */
    function getProperties () {
        return properties;
    }

    /**
     * Sets the value of a single property.
     * @param key   Name of property
     * @param value Value to set property to.
     * @returns {setProperty}
     */
    function setProperty(key, value) {
        // console.log("[Label.js] Setting property " + key + " to value " + value);
        properties[key] = value;
        return this;
    }

    /**
     * Updates validation status for Label, StatusField and logs interactions into Tracker. Occurs
     * when a validation button is clicked.
     * @param validationResult  Must be one of the following: {Agree, Disagree, Unsure}.
     */
    function validate(validationResult) {
        setProperty("endTimestamp", new Date().getTime());

        switch (validationResult) {
            // Agree option selected.
            case "Agree":
                setProperty("validationResult", 1);
                svv.labelContainer.push(getProperties());
                svv.missionContainer.trigger("MissionContainer:updateAMission");
                break;
            // Disagree option selected.
            case "Disagree":
                setProperty("validationResult", 2);
                svv.labelContainer.push(getProperties());
                svv.missionContainer.trigger("MissionContainer:updateAMission");
                break;
            // Not sure option selected.
            case "NotSure":
                setProperty("validationResult", 3);
                svv.labelContainer.push(getProperties());
                svv.missionContainer.trigger("MissionContainer:updateAMission");
                break;
        }

        // If there are more labels left to validate, add a new label to the panorama.
        // Otherwise, we will load a new label onto the panorama from Form.js - where we still need
        // to retrieve 10 more labels for the next mission.
        if (!svv.missionContainer.getCurrentMission().isComplete()) {
            svv.panorama.loadNewLabelFromList();
        }
    }

    _init();

    self.getIconUrl = getIconUrl;
    self.getProperty = getProperty;
    self.getProperties = getProperties;
    self.setProperty = setProperty;
    self.validate = validate;

    return this;
}