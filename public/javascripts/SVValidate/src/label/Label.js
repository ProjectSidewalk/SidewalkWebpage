/**
 * Represents a validation label
 * @returns {Label}
 * @constructor
 */
function Label(params) {
    // Original properties of the label. These properties are initialized from metadata from the
    // backend. These properties are used to help place the label on the validation interface
    // and should not be changed.
    var originalProperties = {
        canvasHeight: undefined,
        canvasWidth: undefined,
        canvasX: undefined,
        canvasY: undefined,
        heading: undefined,
        labelId: undefined,
        labelType: undefined,
        pitch: undefined,
        zoom: undefined,
        severity: undefined,
        temporary: undefined,
        description: undefined,
        tags: undefined
    };

    // These properties are set through validating labels. In this object, canvas properties and
    // heading/pitch/zoom are from the perspective of the user that is validating the labels.
    var validationProperties = {
        canvasX: undefined,
        canvasY: undefined,
        endTimestamp: undefined,
        labelId: undefined,
        heading: undefined,
        pitch: undefined,
        startTimestamp: undefined,
        validationResult: undefined,
        zoom: undefined
    };

    var icons = {
        CurbRamp : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_SurfaceProblem.png',
        Other : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other.png',
        Occlusion : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other.png',
        NoSidewalk : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoSidewalk.png'
    };

    // Labels are circles with a 10px radius.
    var radius = 10;

    var self = this;

    /**
     * Initializes a label from metadata (if parameters are passed in)
     * @private
     */
    function _init() {
        if (params) {
            if ("canvasHeight" in params) setOriginalProperty("canvasHeight", params.canvasHeight);
            if ("canvasWidth" in params) setOriginalProperty("canvasWidth", params.canvasWidth);
            if ("canvasX" in params) setOriginalProperty("canvasX", params.canvasX);
            if ("canvasY" in params) setOriginalProperty("canvasY", params.canvasY);
            if ("gsvPanoramaId" in params) setOriginalProperty("gsvPanoramaId", params.gsvPanoramaId);
            if ("heading" in params) setOriginalProperty("heading", params.heading);
            if ("labelId" in params) setOriginalProperty("labelId", params.labelId);
            if ("labelId" in params) setValidationProperty("labelId", params.labelId);
            if ("labelType" in params) setOriginalProperty("labelType", params.labelType);
            if ("pitch" in params) setOriginalProperty("pitch", params.pitch);
            if ("zoom" in params) setOriginalProperty("zoom", params.zoom);
            if ("severity" in params) setOriginalProperty("severity", params.severity);
            if ("temporary" in params) setOriginalProperty("temporary", params.temporary);
            if ("description" in params) setOriginalProperty("description", params.description);
            if ("tags" in params) setOriginalProperty("tags", params.tags);

            console.log(params.labelId);
            if ("severity" in params) console.log(params.severity);
            if ("temporary" in params) console.log(params.temporary);
            if ("description" in params) console.log(params.description);
            if ("tags" in params) console.log(params.tags);

        } //bloopdebeephdhhyhdhhhfhhbbjjjhnbdbjnnahhhhn12345678ahhanMESSn?nn
    }

    /**
     * Gets the file path associated with the labels' icon type.
     * @returns {*} String - Path of image in the directory.
     */
    function getIconUrl() {
        return icons[originalProperties.labelType];
    }

    /**
     * Returns a specific originalProperty of this label.
     * @param key   Name of property.
     * @returns     Value associated with this key.
     */
    function getOriginalProperty (key) {
        return key in originalProperties ? originalProperties[key] : null;
    }

    /**
     * Returns the entire originalProperty object for this label.
     * @returns Object for originalProperties.
     */
    function getOriginalProperties () {
        return originalProperties;
    }

    /**
     * Gets the position of this label from the POV from which it was originally placed.
     * @returns {heading: number, pitch: number}
     */
    function getPosition () {
        // This calculates the heading and position for placing this Label onto the panorama from
        // the same POV as when the user placed the label.
        var pos = svv.util.properties.panorama.getPosition(getOriginalProperty('canvasX'),
            getOriginalProperty('canvasY'), getOriginalProperty('canvasWidth'),
            getOriginalProperty('canvasHeight'), getOriginalProperty('zoom'),
            getOriginalProperty('heading'), getOriginalProperty('pitch'));
        return pos;
    }

    /**
     * Gets the radius of this label.
     * @returns {number}
     */
    function getRadius () {
        return radius;
    }

    /**
     * Returns the entire validationProperties object for this label.
     * @returns Object for validationProperties.
     */
    function getValidationProperties () {
        return validationProperties;
    }

    /**
     * Gets a specific validationProperty of this label.
     * @param key   Name of property.
     * @returns     Value associated with this key.
     */
    function getValidationProperty (key) {
        return key in validationProperties ? validationProperties[key] : null;
    }

    /**
     * Sets the value of a single property in originalProperties.
     * @param key   Name of property
     * @param value Value to set property to.
     */
    function setOriginalProperty(key, value) {
        originalProperties[key] = value;
        return this;
    }

    /**
     * Sets the value of a single property in validationProperties.
     * @param key   Name of property
     * @param value Value to set property to.
     */
    function setValidationProperty(key, value) {
        validationProperties[key] = value;
        return this;
    }

    /**
     * Updates validation status for Label, StatusField and logs interactions into Tracker. Occurs
     * when a validation button is clicked.
     *
     * NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
     *
     * @param validationResult  Must be one of the following: {Agree, Disagree, Unsure}.
     */
    function validate(validationResult) {
        // This is the POV of the PanoMarker, where the PanoMarker would be loaded at the center
        // of the viewport.
        var pos = getPosition();
        var panomarkerPov = {
            heading: pos.heading,
            pitch: pos.pitch
        };

        // This is the POV of the viewport center - this is where the user is looking.
        var userPov = svv.panorama.getPov();
        var zoom = svv.panorama.getZoom();

        // Calculates the center xy coordinates of the Label on the current viewport.
        var pixelCoordinates = svv.util.properties.panorama.povToPixel3d(panomarkerPov, userPov,
            zoom, svv.canvasWidth, svv.canvasHeight);

        // If the user has panned away from the label and it is no longer visible on the canvas, set canvasX/Y to null.
        // We add/subtract the radius of the label so that we still record these values when only a fraction of the
        // label is still visible.
        let labelCanvasX = null;
        let labelCanvasY = null;
        if (pixelCoordinates
            && pixelCoordinates.left + getRadius() > 0
            && pixelCoordinates.left - getRadius() < svv.canvasWidth
            && pixelCoordinates.top + getRadius() > 0
            && pixelCoordinates.top - getRadius() < svv.canvasHeight) {

            labelCanvasX = pixelCoordinates.left - getRadius();
            labelCanvasY = pixelCoordinates.top - getRadius();
        }

        setValidationProperty("endTimestamp", new Date().getTime());
        setValidationProperty("canvasX", labelCanvasX);
        setValidationProperty("canvasY", labelCanvasY);
        setValidationProperty("heading", userPov.heading);
        setValidationProperty("pitch", userPov.pitch);
        setValidationProperty("zoom", userPov.zoom);

        switch (validationResult) {
            // Agree option selected.
            case "Agree":
                setValidationProperty("validationResult", 1);
                svv.missionContainer.getCurrentMission().updateValidationResult(1);
                svv.labelContainer.push(getValidationProperties());
                svv.missionContainer.updateAMission();
                break;
            // Disagree option selected.
            case "Disagree":
                setValidationProperty("validationResult", 2);
                svv.missionContainer.getCurrentMission().updateValidationResult(2);
                svv.labelContainer.push(getValidationProperties());
                svv.missionContainer.updateAMission();
                break;
            // Not sure option selected.
            case "NotSure":
                setValidationProperty("validationResult", 3);
                svv.missionContainer.getCurrentMission().updateValidationResult(3);
                svv.labelContainer.push(getValidationProperties());
                svv.missionContainer.updateAMission();
                break;
        }

        // If there are more labels left to validate, add a new label to the panorama.
        // Otherwise, we will load a new label onto the panorama from Form.js - where we still need
        // to retrieve 10 more labels for the next mission.
        if (!svv.missionContainer.getCurrentMission().isComplete()) {
            svv.panoramaContainer.loadNewLabelOntoPanorama();
        }
    }

    _init();

    self.getIconUrl = getIconUrl;
    self.getOriginalProperty = getOriginalProperty;
    self.getPosition = getPosition;
    self.getRadius = getRadius;
    self.getValidationProperty = getValidationProperty;
    self.getOriginalProperties = getOriginalProperties;
    self.getValidationProperties = getValidationProperties;
    self.setValidationProperty = setValidationProperty;
    self.validate = validate;

    return this;
}
