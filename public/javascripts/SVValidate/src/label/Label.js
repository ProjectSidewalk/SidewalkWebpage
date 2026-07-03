/**
 * Represents a validation label.
 */
class Label {
    // Original properties of the label collected through the audit interface. These properties are initialized from
    // metadata from the backend. These properties help place the label on the validation interface and
    // should not be changed.
    #auditProperties = {
        lat: undefined,
        lng: undefined,
        cameraLat: undefined,
        cameraLng: undefined,
        canvasX: undefined,
        canvasY: undefined,
        panoId: undefined,
        imageCaptureDate: undefined,
        labelTimestamp: undefined,
        heading: undefined,
        labelId: undefined,
        labelType: undefined,
        pitch: undefined,
        zoom: undefined,
        severity: undefined,
        description: undefined,
        streetEdgeId: undefined,
        regionId: undefined,
        tags: undefined,
        aiTags: undefined,
        aiTagsNotPresent: undefined,
        isMobile: undefined,
        aiGenerated: false,
        backupImage: null,
    };

    // These properties are set through validating labels. In this object, canvas properties and
    // heading/pitch/zoom are from the perspective of the user that is validating the labels.
    #properties = {
        canvasX: undefined,
        canvasY: undefined,
        endTimestamp: undefined,
        heading: undefined,
        pitch: undefined,
        startTimestamp: undefined,
        validationResult: undefined,
        oldSeverity: undefined,
        newSeverity: undefined,
        oldTags: undefined,
        newTags: undefined,
        agreeComment: '',
        disagreeOption: undefined,
        disagreeReasonTextBox: '',
        unsureOption: undefined,
        unsureReasonTextBox: '',
        comment: undefined,
        zoom: undefined,
        isMobile: undefined,
    };

    #adminProperties = {
        username: null,
        previousValidations: null,
    };

    #icons;

    constructor(params) {
        this.#icons = {
            CurbRamp: '/assets/images/icons/AdminTool_CurbRamp.png',
            NoCurbRamp: '/assets/images/icons/AdminTool_NoCurbRamp.png',
            Obstacle: '/assets/images/icons/AdminTool_Obstacle.png',
            SurfaceProblem: '/assets/images/icons/AdminTool_SurfaceProblem.png',
            Other: '/assets/images/icons/AdminTool_Other.png',
            Occlusion: '/assets/images/icons/AdminTool_Occlusion.png',
            NoSidewalk: '/assets/images/icons/AdminTool_NoSidewalk.png',
            Crosswalk: '/assets/images/icons/AdminTool_Crosswalk.png',
            Signal: '/assets/images/icons/AdminTool_Signal.png',
        };

        if (isMobile()) {
            this.#icons = {
                CurbRamp: '/assets/images/icons/AdminTool_CurbRamp_Mobile.png',
                NoCurbRamp: '/assets/images/icons/AdminTool_NoCurbRamp_Mobile.png',
                Obstacle: '/assets/images/icons/AdminTool_Obstacle_Mobile.png',
                SurfaceProblem: '/assets/images/icons/AdminTool_SurfaceProblem_Mobile.png',
                Other: '/assets/images/icons/AdminTool_Other_Mobile.png',
                Occlusion: '/assets/images/icons/AdminTool_Other_Mobile.png',
                NoSidewalk: '/assets/images/icons/AdminTool_NoSidewalk_Mobile.png',
                Crosswalk: '/assets/images/icons/AdminTool_Crosswalk_Mobile.png',
                Signal: '/assets/images/icons/AdminTool_Signal_Mobile.png',
            };
        }

        this.#init(params);
    }

    /**
     * Initializes a label from metadata (if parameters are passed in).
     * @param {object} params Label metadata from the backend.
     */
    #init(params) {
        if (params) {
            if ('lat' in params) this.setAuditProperty('lat', params.lat);
            if ('lng' in params) this.setAuditProperty('lng', params.lng);
            if ('camera_lat' in params) this.setAuditProperty('cameraLat', params.camera_lat);
            if ('camera_lng' in params) this.setAuditProperty('cameraLng', params.camera_lng);
            if ('canvas_x' in params) this.setAuditProperty('canvasX', params.canvas_x);
            if ('canvas_y' in params) this.setAuditProperty('canvasY', params.canvas_y);
            if ('pano_id' in params) this.setAuditProperty('panoId', params.pano_id);
            if ('image_capture_date' in params) this.setAuditProperty('imageCaptureDate', moment(params.image_capture_date));
            if ('label_timestamp' in params) this.setAuditProperty('labelTimestamp', moment(params.label_timestamp));
            if ('heading' in params) this.setAuditProperty('heading', params.heading);
            if ('label_id' in params) this.setAuditProperty('labelId', params.label_id);
            if ('label_type' in params) this.setAuditProperty('labelType', params.label_type);
            if ('pitch' in params) this.setAuditProperty('pitch', params.pitch);
            if ('zoom' in params) this.setAuditProperty('zoom', params.zoom);
            if ('severity' in params) {
                this.setAuditProperty('severity', params.severity);
                this.setProperty('oldSeverity', params.severity);
                this.setProperty('newSeverity', params.severity);
            }
            if ('description' in params) this.setAuditProperty('description', params.description);
            if ('street_edge_id' in params) this.setAuditProperty('streetEdgeId', params.street_edge_id);
            if ('region_id' in params) this.setAuditProperty('regionId', params.region_id);
            if ('tags' in params) {
                this.setAuditProperty('tags', params.tags);
                this.setProperty('oldTags', params.tags);
                this.setProperty('newTags', [...params.tags]); // Copy tags to newTags.
            }
            if ('ai_tags' in params) this.setAuditProperty('aiTags', params.ai_tags);
            if ('ai_tags_not_present' in params) this.setAuditProperty('aiTagsNotPresent', params.ai_tags_not_present);
            if ('ai_generated' in params) this.setAuditProperty('aiGenerated', params.ai_generated);
            this.setAuditProperty('backupImage', buildBackupImageData(params));
            // Properties only used on the Admin version of Validate.
            if ('admin_data' in params && params.admin_data !== null) {
                if ('username' in params.admin_data) this.#adminProperties.username = params.admin_data.username;
                if ('previous_validations' in params.admin_data) {
                    this.#adminProperties.previousValidations = [];
                    for (const prevVal of params.admin_data.previous_validations) {
                        this.#adminProperties.previousValidations.push(prevVal);
                    }
                }
            }
            this.setAuditProperty('isMobile', isMobile());
        }
    }

    /**
     * Gets the file path associated with the labels' icon type.
     * @returns {string} Path of image in the directory.
     */
    getIconUrl() {
        return this.#icons[this.#auditProperties.labelType];
    }

    /**
     * Returns a specific originalProperty of this label.
     * @param {string} key Name of property.
     * @returns Value associated with this key.
     */
    getAuditProperty(key) {
        return key in this.#auditProperties ? this.#auditProperties[key] : null;
    }

    /**
     * Returns a specific adminProperty of this label.
     * @param {string} key Name of property.
     * @returns {*|null} Value associated with this key.
     */
    getAdminProperty(key) {
        return key in this.#adminProperties ? this.#adminProperties[key] : null;
    }

    /**
     * Calculate heading/pitch for drawing this Label on the pano from the POV of the user when placing the label.
     * @returns {{heading: number, pitch: number, zoom: number}}
     */
    getOriginalPov() {
        const origPov = {
            heading: this.getAuditProperty('heading'),
            pitch: this.getAuditProperty('pitch'),
            zoom: this.getAuditProperty('zoom'),
        };
        return util.pano.canvasCoordToCenteredPov(origPov, this.getAuditProperty('canvasX'),
            this.getAuditProperty('canvasY'), util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT);
    }

    /**
     * Returns the entire properties object for this label.
     * @returns Object for properties.
     */
    getProperties() {
        return this.#properties;
    }

    /**
     * Gets a specific validation property of this label.
     * @param {string} key Name of property.
     * @returns Value associated with this key.
     */
    getProperty(key) {
        return key in this.#properties ? this.#properties[key] : null;
    }

    /**
     * Sets the value of a single property in properties.
     * @param {string} key Name of property.
     * @param value Value to set property to.
     */
    setProperty(key, value) {
        this.#properties[key] = value;
        return this;
    }

    setAuditProperty(key, value) {
        this.#auditProperties[key] = value;
        return this;
    }

    #prepareCommentData() {
        const comment = this.getProperty('comment');
        if (comment) {
            return {
                comment,
                label_id: this.getAuditProperty('labelId'),
                pano_id: this.getAuditProperty('panoId'),
                heading: this.getProperty('heading'),
                lat: this.getAuditProperty('lat'),
                lng: this.getAuditProperty('lng'),
                pitch: this.getProperty('pitch'),
                mission_id: svv.missionContainer.getCurrentMission().getProperty('missionId'),
                zoom: this.getProperty('zoom'),
            };
        } else {
            return null;
        }
    }

    /**
     * When a validation button is clicked, updates validation status for Label, StatusField, and logs interactions.
     *
     * @param {string} validationResult Must be one of the following: {Agree, Disagree, Unsure}.
     * @param {string} comment An optional comment submitted with the validation.
     */
    validate(validationResult, comment) {
        // This is the POV if the label were in the center of the viewport.
        const centeredPov = this.getOriginalPov();

        // This is the POV of the viewport center - this is where the user is looking.
        const userPov = svv.panoViewer.getPov();

        // Calculates the center xy coordinates of the Label on the current viewport.
        const pixelCoordinates = util.pano.centeredPovToCanvasCoord(
            centeredPov, userPov, svv.canvasWidth(), svv.canvasHeight(), svv.labelRadius * util.uiScale());

        this.setProperty('endTimestamp', new Date());
        this.setProperty('canvasX', pixelCoordinates ? Math.round(pixelCoordinates.x) : null);
        this.setProperty('canvasY', pixelCoordinates ? Math.round(pixelCoordinates.y) : null);
        this.setProperty('heading', userPov.heading);
        this.setProperty('pitch', userPov.pitch);
        this.setProperty('zoom', userPov.zoom);
        this.setProperty('isMobile', isMobile());
        this.setProperty('comment', comment);

        if (this.getProperty('comment')) {
            svv.tracker.push('ValidationTextField_DataEntered', { validation: validationResult, text: comment });
        }

        if (['Agree', 'Disagree', 'Unsure'].includes(validationResult)) {
            this.setProperty('validationResult', validationResult);
            svv.missionContainer.getCurrentMission().updateValidationResult(validationResult, false);
            svv.labelContainer.pushToLabelsToSubmit(this.getAuditProperty('labelId'), this.getProperties(), this.#prepareCommentData());
            svv.missionContainer.updateAMission();
        }

        // If there are more labels left to validate, add a new label to the panorama. Otherwise, we will load a new
        // label onto the panorama from Form.js - where we still need to retrieve 10 more labels for the next mission.
        if (!svv.missionContainer.getCurrentMission().isComplete()) {
            svv.labelContainer.moveToNextLabel(); // NOTE That this returns a Promise that we're ignoring right now.
        }
    }
}
