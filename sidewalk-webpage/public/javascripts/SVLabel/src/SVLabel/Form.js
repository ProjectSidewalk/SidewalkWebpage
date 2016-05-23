/**
 * A form module. This module is responsible for communicating with the server side for submitting collected data.
 * @param $ {object} jQuery object
 * @param params {object} Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Form ($, params) {
    var self = { className : 'Form'},
        properties = {
            commentFieldMessage: undefined,
            isAMTTask : false,
            isPreviewMode : false,
            previousLabelingTaskId: undefined,
            dataStoreUrl : undefined,
            taskRemaining : 0,
            taskDescription : undefined,
            taskPanoramaId: undefined,
            hitId : undefined,
            assignmentId: undefined,
            turkerId: undefined,
            userExperiment: false
        },
        status = {
            disabledButtonMessageVisibility: 'hidden',
            disableSkipButton : false,
            disableSubmit : false,
            radioValue: undefined,
            skipReasonDescription: undefined,
            submitType: undefined,
            taskDifficulty: undefined,
            taskDifficultyComment: undefined
        },
        lock = {
            disableSkipButton : false,
            disableSubmit : false
        };

    function _init (params) {
        var params = params || {};
        var hasGroupId = getURLParameter('groupId') !== "";
        var hasHitId = getURLParameter('hitId') !== "";
        var hasWorkerId = getURLParameter('workerId') !== "";
        var assignmentId = getURLParameter('assignmentId');

        properties.dataStoreUrl = "dataStoreUrl" in params ? params.dataStoreUrl : null;

        if (('assignmentId' in params) && params.assignmentId &&
            ('hitId' in params) && params.hitId &&
            ('turkerId' in params) && params.turkerId
        ) {
            properties.assignmentId = params.assignmentId;
            properties.hitId = params.hitId;
            properties.turkerId = params.turkerId;
            $('input[name="assignmentId"]').attr('value', properties.assignmentId);
            $('input[name="workerId"]').attr('value', properties.turkerId);
            $('input[name="hitId"]').attr('value', properties.hitId);
        }

        if (assignmentId && assignmentId === 'ASSIGNMENT_ID_NOT_AVAILABLE') {
            properties.isPreviewMode = true;
            properties.isAMTTask = true;
            unlockDisableSubmit().disableSubmit().lockDisableSubmit();
            unlockDisableSkip().disableSkip().lockDisableSkip();
        } else if (hasWorkerId && !assignmentId) {
            properties.isPreviewMode = false;
            properties.isAMTTask = false;
        } else if (!assignmentId && !hasHitId && !hasWorkerId) {
            properties.isPreviewMode = false;
            properties.isAMTTask = false;
        } else {
            properties.isPreviewMode = false;
            properties.isAMTTask = true;
        }

        // Check if this is a sandbox task or not
        properties.isSandbox = false;
        if (properties.isAMTTask) {
            if (document.referrer.indexOf("workersandbox.mturk.com") !== -1) {
                properties.isSandbox = true;
                $form.prop("action", "https://workersandbox.mturk.com/mturk/externalSubmit");
            }
        }

        // Check if this is a preview and, if so, disable submission and show a message saying this is a preview.
        if (properties.isAMTTask && properties.isPreviewMode) {
            var dom = '<div class="amt-preview-warning-holder">' +
                '<div class="amt-preview-warning">' +
                'Warning: you are on a Preview Mode!' +
                '</div>' +
                '</div>';
            $("body").append(dom);
            disableSubmit();
            lockDisableSubmit();
        }

        //svl.ui.form.skipButton.on('click', handleSkipClick);
        //svl.ui.leftColumn.jump.on('click', handleSkipClick);
        //svl.ui.leftColumn.feedback.on('click', handleFeedbackClick);
    }

    /**
     * This method gathers all the data needed for submission.
     * @returns {{}}
     */
    function compileSubmissionData (task) {
        var i, j, len, data = {};

        data.audit_task = {
            street_edge_id: task.getStreetEdgeId(),
            task_start: task.getTaskStart(),
            audit_task_id: task.getAuditTaskId()
        };

        data.environment = {
            browser: svl.util.getBrowser(),
            browser_version: svl.util.getBrowserVersion(),
            browser_width: $(window).width(),
            browser_height: $(window).height(),
            screen_width: screen.width,
            screen_height: screen.height,
            avail_width: screen.availWidth,		// total width - interface (taskbar)
            avail_height: screen.availHeight,		// total height - interface };
            operating_system: svl.util.getOperatingSystem()
        };

        data.interactions = svl.tracker.getActions();
        svl.tracker.refresh();

        data.labels = [];
        var labels = svl.labelContainer.getCurrentLabels();
        for(i = 0; i < labels.length; i += 1) {
            var label = labels[i],
                prop = label.getProperties(),
                points = label.getPath().getPoints(),
                pathLen = points.length;

            var labelLatLng = label.toLatLng();
            var temp = {
                deleted : label.isDeleted(),
                label_id : label.getLabelId(),
                label_type : label.getLabelType(),
                photographer_heading : prop.photographerHeading,
                photographer_pitch : prop.photographerPitch,
                panorama_lat: prop.panoramaLat,
                panorama_lng: prop.panoramaLng,
                temporary_label_id: label.getProperty('temporary_label_id'),
                gsv_panorama_id : prop.panoId,
                label_points : [],
                severity: label.getProperty('severity'),
                temporary_problem: label.getProperty('temporaryProblem'),
                description: label.getProperty('description')
            };

            for (j = 0; j < pathLen; j += 1) {
                var point = points[j],
                    gsvImageCoordinate = point.getGSVImageCoordinate(),
                    pointParam = {
                        sv_image_x : gsvImageCoordinate.x,
                        sv_image_y : gsvImageCoordinate.y,
                        canvas_x: point.originalCanvasCoordinate.x,
                        canvas_y: point.originalCanvasCoordinate.y,
                        heading: point.originalPov.heading,
                        pitch: point.originalPov.pitch,
                        zoom : point.originalPov.zoom,
                        canvas_height : prop.canvasHeight,
                        canvas_width : prop.canvasWidth,
                        alpha_x : prop.canvasDistortionAlphaX,
                        alpha_y : prop.canvasDistortionAlphaY,
                        lat : labelLatLng.lat,
                        lng : labelLatLng.lng
                    };
                temp.label_points.push(pointParam);
            }

            data.labels.push(temp)
        }

        // Keep Street View meta data. This is particularly important to keep track of the date when the images were taken (i.e., the date of the accessibilty attributes).
        data.gsv_panoramas = [];
        if ("panoramaContainer" in svl && svl.panoramaContainer) {
            var temp,
                panoramaData,
                link,
                linksc,
                panoramas = svl.panoramaContainer.getStagedPanoramas();
            len = panoramas.length;

            for (i = 0; i < len; i++) {
                panoramaData = panoramas[i].data();
                links = [];

                if ("links" in panoramaData) {
                    for (j = 0; j < panoramaData.links.length; j++) {
                        link = panoramaData.links[j];
                        links.push({
                            target_gsv_panorama_id: ("pano" in link) ? link.pano : "",
                            yaw_deg: ("heading" in link) ? link.heading : 0.0,
                            description: ("description" in link) ? link.description : ""
                        });
                    }
                }

                temp = {
                    panorama_id: ("location" in panoramaData && "pano" in panoramaData.location) ? panoramaData.location.pano : "",
                    image_date: "imageDate" in panoramaData ? panoramaData.imageDate : "",
                    links: links,
                    copyright: "copyright" in panoramaData ? panoramaData.copyright : ""
                };

                data.gsv_panoramas.push(temp);
                panoramas[i].setProperty("submitted", true);
            }
        }

        return data;
    }
    

    /**
     * Disable clicking the submit button
     * @returns {*}
     */
    function disableSubmit () {
        if (!lock.disableSubmit) {
            status.disableSubmit = true;
            //  $btnSubmit.attr('disabled', true);
            //$btnSubmit.css('opacity', 0.5);
            return this;
        }
        return false;
    }

    /**
     * Disable clicking the skip button
     * @returns {*}
     */
    function disableSkip () {
        if (!lock.disableSkip) {
            status.disableSkip = true;
            // $btnSkip.attr('disabled', true);
            //$btnSkip.css('opacity', 0.5);
            return this;
        } else {
            return false;
        }
    }

    /**
     * Enable clicking the submit button
     * @returns {*}
     */
    function enableSubmit () {
        if (!lock.disableSubmit) {
            status.disableSubmit = false;
            return this;
        } else {
            return false;
        }
    }

    /**
     * Enable clicking the skip button
     * @returns {*}
     */
    function enableSkip () {
        if (!lock.disableSkip) {
            status.disableSkip = false;
            return this;
        } else {
            return false;
        }
    }

    /** This method returns whether the task is in preview mode or not. */
    function isPreviewMode () {
        return properties.isPreviewMode;
    }

    function lockDisableSubmit () {
        lock.disableSubmit = true;
        return this;
    }

    function lockDisableSkip () {
        lock.disableSkip = true;
        return this;
    }

    /**
     * Post a json object
     * @param url
     * @param data
     * @param callback
     * @param async
     */
    function postJSON (url, data, callback, async) {
        if (!async) async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                if (callback) callback(result);
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    function setPreviousLabelingTaskId (val) {
        properties.previousLabelingTaskId = val;
        return this;
    }

    /** This method sets the taskDescription */
    function setTaskDescription (val) {
        properties.taskDescription = val;
        return this;
    }

    /** This method sets the taskPanoramaId. Note it is not same as the GSV panorama id. */
    function setTaskPanoramaId (val) {
        properties.taskPanoramaId = val;
        return this;
    }

    /** This method sets the number of remaining tasks */
    function setTaskRemaining (val) {
        properties.taskRemaining = val;
        return this;
    }

    /**
     * Submit the data collected so far and move to another location.
     * @param dataIn An object that has issue_description, lat, and lng as fields.
     * @returns {boolean}
     */
    function skipSubmit (dataIn) {
        var task = svl.taskContainer.getCurrentTask();
        var data = compileSubmissionData(task);
        data.incomplete = dataIn;
        svl.tracker.push('TaskSkip');
        submit(data, task);

        if ("taskContainer" in svl) {
            svl.taskContainer.initNextTask();
        }

        return false;
    }

    /**
     * Submit the data.
     * @param data This can be an object of a compiled data for auditing, or an array of
     * the auditing data.
     */
    function submit(data, task) {
        svl.tracker.push('TaskSubmit');
        svl.labelContainer.refresh();
        if (data.constructor !== Array) { data = [data]; }

        $.ajax({
            // async: false,
            contentType: 'application/json; charset=utf-8',
            url: properties.dataStoreUrl,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                if (result) task.setProperty("auditTaskId", result.audit_task_id);
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    /** Unlock disable submit */
    function unlockDisableSubmit () {
        lock.disableSubmit = false;
        return this;
    }

    /** Unlock disable skip */
    function unlockDisableSkip () {
        lock.disableSkipButton = false;
        return this;
    }

    //self.checkSubmittable = checkSubmittable;
    self.compileSubmissionData = compileSubmissionData;
    self.disableSubmit = disableSubmit;
    self.disableSkip = disableSkip;
    self.enableSubmit = enableSubmit;
    self.enableSkip = enableSkip;
    self.isPreviewMode = isPreviewMode;
    self.lockDisableSubmit = lockDisableSubmit;
    self.lockDisableSkip = lockDisableSkip;
    self.postJSON = postJSON;
    self.setPreviousLabelingTaskId = setPreviousLabelingTaskId;
    self.setTaskDescription = setTaskDescription;
    self.setTaskRemaining = setTaskRemaining;
    self.setTaskPanoramaId = setTaskPanoramaId;
    self.skipSubmit = skipSubmit;
    self.unlockDisableSubmit = unlockDisableSubmit;
    self.unlockDisableSkip = unlockDisableSkip;
    self.submit = submit;
    _init(params);
    return self;
}
