/**
 * Represents a validation label
 * @returns {Label}
 * @constructor
 */
function Label(params) {
    // Original properties of the label collected during the audit interface. These properties are
    // initialized from metadata from the backend. These properties are used to help place the label
    // on the validation interface and should not be changed.
    let auditProperties = {
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
        tags: undefined,
        isMobile: undefined
    };

    // These properties are set through validating labels. In this object, canvas properties and
    // heading/pitch/zoom are from the perspective of the user that is validating the labels.
    let properties = {
        canvasX: undefined,
        canvasY: undefined,
        endTimestamp: undefined,
        labelId: undefined,
        heading: undefined,
        pitch: undefined,
        startTimestamp: undefined,
        validationResult: undefined,
        zoom: undefined,
        isMobile: undefined
    };

    let icons = {
        CurbRamp : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_SurfaceProblem.png',
        Other : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other.png',
        Occlusion : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other.png',
        NoSidewalk : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoSidewalk.png'
    };

    if (isMobile()) {
        icons = {
            CurbRamp : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_CurbRamp_Mobile.png',
            NoCurbRamp : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoCurbRamp_Mobile.png',
            Obstacle : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Obstacle_Mobile.png',
            SurfaceProblem : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_SurfaceProblem_Mobile.png',
            Other : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other_Mobile.png',
            Occlusion : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other_Mobile.png',
            NoSidewalk : '/assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoSidewalk_Mobile.png'
        };
    }

    // Labels are circles with a 10px radius, mobile is 25px.
    let radius = 10;

    if (isMobile()) {
        radius = 25;
    }

    let self = this;

    /**
     * Initializes a label from metadata (if parameters are passed in)
     * @private
     */
    function _init() {
        if (params) {
            if ("canvasHeight" in params) setAuditProperty("canvasHeight", params.canvasHeight);
            if ("canvasWidth" in params) setAuditProperty("canvasWidth", params.canvasWidth);
            if ("canvasX" in params) setAuditProperty("canvasX", params.canvasX);
            if ("canvasY" in params) setAuditProperty("canvasY", params.canvasY);
            if ("gsvPanoramaId" in params) setAuditProperty("gsvPanoramaId", params.gsvPanoramaId);
            if ("heading" in params) setAuditProperty("heading", params.heading);
            if ("labelId" in params) setAuditProperty("labelId", params.labelId);
            if ("labelId" in params) setProperty("labelId", params.labelId);
            if ("labelType" in params) setAuditProperty("labelType", params.labelType);
            if ("pitch" in params) setAuditProperty("pitch", params.pitch);
            if ("zoom" in params) setAuditProperty("zoom", params.zoom);
            if ("severity" in params) setAuditProperty("severity", params.severity);
            if ("temporary" in params) setAuditProperty("temporary", params.temporary);
            if ("description" in params) setAuditProperty("description", params.description);
            if ("tags" in params) setAuditProperty("tags", params.tags);
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
    function getAuditProperty (key) {
        return key in auditProperties ? auditProperties[key] : null;
    }

    /**
     * Gets the position of this label from the POV from which it was originally placed.
     * @returns {heading: number, pitch: number}
     */
    function getPosition () {
        // This calculates the heading and position for placing this Label onto the panorama from
        // the same POV as when the user placed the label.
        let pos = svv.util.properties.panorama.getPosition(getAuditProperty('canvasX'),
            getAuditProperty('canvasY'), getAuditProperty('canvasWidth'),
            getAuditProperty('canvasHeight'), getAuditProperty('zoom'),
            getAuditProperty('heading'), getAuditProperty('pitch'));
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
    
    function prepareLabelCommentData(comment, position, pov, zoom) {
        let data =  {
            comment: comment,
            label_id: svv.panorama.getCurrentLabel().getAuditProperty("labelId"),
            gsv_panorama_id: svv.panorama.getPanoId(),
            heading: pov.heading,
            lat: position.lat,
            lng: position.lng,
            pitch: pov.pitch,
            mission_id: svv.missionContainer.getCurrentMission().getProperty('missionId'),
            zoom: zoom
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
     * @param panorama          Panorama object that this label was placed on.
     */
    function validate(validationResult, panorama, comment) {
        // This is the POV of the PanoMarker, where the PanoMarker would be loaded at the center
        // of the viewport.
        let pos = getPosition();
        let panomarkerPov = {
            heading: pos.heading,
            pitch: pos.pitch
        };

        // This is the POV of the viewport center - this is where the user is looking.
        let userPov = panorama.getPov();
        let zoom = panorama.getZoom();

        // Calculates the center xy coordinates of the Label on the current viewport.
        let pixelCoordinates = svv.util.properties.panorama.povToPixel3d(panomarkerPov, userPov,
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

        setProperty("endTimestamp", new Date().getTime());
        setProperty("canvasX", labelCanvasX);
        setProperty("canvasY", labelCanvasY);
        setProperty("heading", userPov.heading);
        setProperty("pitch", userPov.pitch);
        setProperty("zoom", userPov.zoom);
        setProperty("isMobile", isMobile());

        if(comment) {
            svv.tracker.push("ValidationTextField_DataEntered");
            let data = prepareLabelCommentData(comment, svv.panorama.getPosition(), userPov, zoom);
            submitComment(data);
        }

        switch (validationResult) {
            // Agree option selected.
            case "Agree":
                setProperty("validationResult", 1);
                svv.missionContainer.getCurrentMission().updateValidationResult(1);
                svv.labelContainer.push(getProperties());
                svv.missionContainer.updateAMission();
                break;
            // Disagree option selected.
            case "Disagree":
                setProperty("validationResult", 2);
                svv.missionContainer.getCurrentMission().updateValidationResult(2);
                svv.labelContainer.push(getProperties());
                svv.missionContainer.updateAMission();
                break;
            // Not sure option selected.
            case "NotSure":
                setProperty("validationResult", 3);
                svv.missionContainer.getCurrentMission().updateValidationResult(3);
                svv.labelContainer.push(getProperties());
                svv.missionContainer.updateAMission();
                break;
        }

        // If there are more labels left to validate, add a new label to the panorama.
        // Otherwise, we will load a new label onto the panorama from Form.js - where we still need
        // to retrieve 10 more labels for the next mission.
        if (!svv.missionContainer.getCurrentMission().isComplete()) {
            svv.panoramaContainer.loadNewLabelOntoPanorama(panorama);
        }
    }

    _init();

    self.getAuditProperty = getAuditProperty;
    self.getIconUrl = getIconUrl;
    self.getProperty = getProperty;
    self.getProperties = getProperties;
    self.setProperty = setProperty;
    self.getPosition = getPosition;
    self.getRadius = getRadius;
    self.validate = validate;

    return this;
}
