/**
 * Represents a validation label.
 * @returns {Label}
 * @constructor
 */
function Label(params) {
    // Original properties of the label collected through the audit interface. These properties are initialized from
    // metadata from the backend. These properties are used to help place the label on the validation interface and
    // should not be changed.
    let auditProperties = {
        canvasX: undefined,
        canvasY: undefined,
        gsvPanoramaId: undefined,
        imageCaptureDate: undefined,
        labelTimestamp: undefined,
        heading: undefined,
        labelId: undefined,
        labelType: undefined,
        pitch: undefined,
        zoom: undefined,
        severity: undefined,
        temporary: undefined,
        description: undefined,
        streetEdgeId: undefined,
        regionId: undefined,
        tags: undefined,
        isMobile: undefined
    };

    // These properties are set through validating labels. In this object, canvas properties and
    // heading/pitch/zoom are from the perspective of the user that is validating the labels.
    let properties = {
        canvasX: undefined,
        canvasY: undefined,
        endTimestamp: undefined,
        heading: undefined,
        pitch: undefined,
        startTimestamp: undefined,
        validationResult: undefined,
        oldSeverity: undefined,
        oldSeverityCollapsed: undefined,
        newSeverity: undefined,
        oldTags: undefined,
        newTags: undefined,
        disagreeOption: undefined,
        disagreeReasonTextBox: '',
        unsureReasonTextBox: '',
        comment: undefined,
        zoom: undefined,
        isMobile: undefined
    };

    let adminProperties = {
        username: null,
        previousValidations: null
    }

    let icons = {
        CurbRamp : '/assets/images/icons/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/images/icons/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem.png',
        Other : '/assets/images/icons/AdminTool_Other.png',
        Occlusion : '/assets/images/icons/AdminTool_Occlusion.png',
        NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk.png',
        Crosswalk : '/assets/images/icons/AdminTool_Crosswalk.png',
        Signal : '/assets/images/icons/AdminTool_Signal.png'
    };

    if (isMobile()) {
        icons = {
            CurbRamp : '/assets/images/icons/AdminTool_CurbRamp_Mobile.png',
            NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp_Mobile.png',
            Obstacle : '/assets/images/icons/AdminTool_Obstacle_Mobile.png',
            SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem_Mobile.png',
            Other : '/assets/images/icons/AdminTool_Other_Mobile.png',
            Occlusion : '/assets/images/icons/AdminTool_Other_Mobile.png',
            NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk_Mobile.png',
            Crosswalk : '/assets/images/icons/AdminTool_Crosswalk_Mobile.png',
            Signal : '/assets/images/icons/AdminTool_Signal_Mobile.png'
        };
    }

    // Labels are circles with a 10px radius, mobile is 25px.
    let radius = 10;

    if (isMobile()) {
        radius = 25;
    }

    let self = this;

    /**
     * Initializes a label from metadata (if parameters are passed in).
     * @private
     */
    function _init() {
        if (params) {
            if ("canvas_x" in params) setAuditProperty("canvasX", params.canvas_x);
            if ("canvas_y" in params) setAuditProperty("canvasY", params.canvas_y);
            if ("gsv_panorama_id" in params) setAuditProperty("gsvPanoramaId", params.gsv_panorama_id);
            if ("image_capture_date" in params) setAuditProperty("imageCaptureDate", params.image_capture_date);
            if ("label_timestamp" in params) setAuditProperty("labelTimestamp", params.label_timestamp);
            if ("heading" in params) setAuditProperty("heading", params.heading);
            if ("label_id" in params) setAuditProperty("labelId", params.label_id);
            if ("label_type" in params) setAuditProperty("labelType", params.label_type);
            if ("pitch" in params) setAuditProperty("pitch", params.pitch);
            if ("zoom" in params) setAuditProperty("zoom", params.zoom);
            if ("severity" in params) {
                setAuditProperty("severity", params.severity);
                setProperty("oldSeverity", params.severity);
                // Collapse severity from 5-point to 3-point scale. 1-2 -> 1, 3 -> 2, 4-5 -> 3.
                let collapsedSeverity = params.severity;
                if (collapsedSeverity) {
                    collapsedSeverity = collapsedSeverity < 3 ? 1 : collapsedSeverity < 4 ? 2 : 3;
                }
                setProperty("oldSeverityCollapsed", collapsedSeverity);
                setProperty("newSeverity", collapsedSeverity);
            }
            if ("temporary" in params) setAuditProperty("temporary", params.temporary);
            if ("description" in params) setAuditProperty("description", params.description);
            if ("street_edge_id" in params) setAuditProperty("streetEdgeId", params.street_edge_id);
            if ("region_id" in params) setAuditProperty("regionId", params.region_id);
            if ("tags" in params) {
                setAuditProperty("tags", params.tags);
                setProperty("oldTags", params.tags);
                setProperty("newTags", params.tags);
            }
            // Properties only used on the Admin version of Validate.
            if ("admin_data" in params && params.admin_data !== null) {
                if ("username" in params.admin_data) adminProperties.username = params.admin_data.username;
                if ("previous_validations" in params.admin_data) {
                    adminProperties.previousValidations = []
                    for (let prevVal of params.admin_data.previous_validations) {
                        adminProperties.previousValidations.push(prevVal);
                    }
                }
            }
            setAuditProperty("isMobile", isMobile());
        }
    }

    /**
     * Gets the file path associated with the labels' icon type.
     * @returns {*} String - Path of image in the directory.
     */
    function getIconUrl() {
        return icons[auditProperties.labelType];
    }

    /**
     * Returns a specific originalProperty of this label.
     * @param key   Name of property.
     * @returns     Value associated with this key.
     */
    function getAuditProperty(key) {
        return key in auditProperties ? auditProperties[key] : null;
    }

    /**
     * Returns a specific adminProperty of this label.
     * @param key        Name of property.
     * @returns {*|null} Value associated with this key.
     */
    function getAdminProperty(key) {
        return key in adminProperties ? adminProperties[key] : null;
    }

    /**
     * Gets the position of this label from the POV from which it was originally placed.
     * @returns {heading: number, pitch: number}
     */
    function getPosition() {
        // This calculates the heading and position for placing this Label onto the panorama from
        // the same POV as when the user placed the label.
        let pos = svv.util.properties.panorama.getPosition(getAuditProperty('canvasX'),
            getAuditProperty('canvasY'), util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT,
            getAuditProperty('zoom'), getAuditProperty('heading'), getAuditProperty('pitch'));
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
     * Returns the entire properties object for this label.
     * @returns Object for properties.
     */
    function getProperties () {
        return properties;
    }

    /**
     * Gets a specific validation property of this label.
     * @param key   Name of property.
     * @returns     Value associated with this key.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Sets the value of a single property in properties.
     * @param key   Name of property
     * @param value Value to set property to.
     */
    function setProperty(key, value) {
        properties[key] = value;
        return this;
    }

    function setAuditProperty(key, value) {
        auditProperties[key] = value;
        return this;
    }
    
    function prepareLabelCommentData(comment, position, pov) {
        let data = {
            comment: comment,
            label_id: svv.panorama.getCurrentLabel().getAuditProperty("labelId"),
            gsv_panorama_id: svv.panorama.getPanoId(),
            heading: pov.heading,
            lat: position.lat,
            lng: position.lng,
            pitch: pov.pitch,
            mission_id: svv.missionContainer.getCurrentMission().getProperty('missionId'),
            zoom: pov.zoom
        };
        return data;
    }

    /**
     * Submit the comment.
     */
    function submitComment (data) {
        let url = "/validate/comment";
        let async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'POST',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {},
            error: function(xhr, textStatus, error){
                console.error(xhr.statusText);
                console.error(textStatus);
                console.error(error);
            }
        });
    }

    /**
     * Updates validation status for Label, StatusField and logs interactions into Tracker. Occurs
     * when a validation button is clicked.
     *
     * NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
     *
     * @param validationResult  Must be one of the following: {Agree, Disagree, Unsure}.
     * @param comment An optional comment submitted with the validation.
     */
    function validate(validationResult, comment) {
        // This is the POV of the PanoMarker, where the PanoMarker would be loaded at the center of the viewport.
        let pos = getPosition();
        let panomarkerPov = {
            heading: pos.heading,
            pitch: pos.pitch
        };

        // This is the POV of the viewport center - this is where the user is looking.
        let userPov = svv.panorama.getPov();

        // Calculates the center xy coordinates of the Label on the current viewport.
        let pixelCoordinates = svv.util.properties.panorama.povToPixel3d(panomarkerPov, userPov, svv.canvasWidth, svv.canvasHeight);

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

        setProperty("endTimestamp", new Date().getTime());
        // TODO do we actually want to use `labelCanvasX` and `labelCanvasY` here? Or are they updated already?
        setProperty("canvasX", labelCanvasX);
        setProperty("canvasY", labelCanvasY);
        setProperty("heading", userPov.heading);
        setProperty("pitch", userPov.pitch);
        setProperty("zoom", userPov.zoom);
        setProperty("isMobile", isMobile());

        if (comment) {
            if (!svv.newValidateBeta) svv.ui.validation.comment.val('');
            svv.tracker.push("ValidationTextField_DataEntered");
            let data = prepareLabelCommentData(comment, svv.panorama.getPosition(), userPov);
            submitComment(data);
        }

        switch (validationResult) {
            // Agree option selected.
            case "Agree":
                setProperty("validationResult", 1);
                svv.missionContainer.getCurrentMission().updateValidationResult(1, false);
                svv.labelContainer.push(getAuditProperty('labelId'), getProperties());
                svv.missionContainer.updateAMission();
                break;
            // Disagree option selected.
            case "Disagree":
                setProperty("validationResult", 2);
                svv.missionContainer.getCurrentMission().updateValidationResult(2, false);
                svv.labelContainer.push(getAuditProperty('labelId'), getProperties());
                svv.missionContainer.updateAMission();
                break;
            // Unsure option selected.
            case "Unsure":
                setProperty("validationResult", 3);
                svv.missionContainer.getCurrentMission().updateValidationResult(3, false);
                svv.labelContainer.push(getAuditProperty('labelId'), getProperties());
                svv.missionContainer.updateAMission();
                break;
        }

        // If there are more labels left to validate, add a new label to the panorama. Otherwise, we will load a new
        // label onto the panorama from Form.js - where we still need to retrieve 10 more labels for the next mission.
        if (!svv.missionContainer.getCurrentMission().isComplete()) {
            svv.panoramaContainer.loadNewLabelOntoPanorama();
        }
    }

    _init();

    self.getAuditProperty = getAuditProperty;
    self.getAdminProperty = getAdminProperty;
    self.getIconUrl = getIconUrl;
    self.getProperty = getProperty;
    self.getProperties = getProperties;
    self.setProperty = setProperty;
    self.getPosition = getPosition;
    self.getRadius = getRadius;
    self.validate = validate;

    return this;
}
