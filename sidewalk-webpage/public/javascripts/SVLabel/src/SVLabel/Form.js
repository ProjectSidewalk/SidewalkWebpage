var svl = svl || {};

/**
 * A form module
 * @param $ {object} jQuery object
 * @param params {object} Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Form ($, params) {
    var self = { className : 'Form' };
    var properties = {
        commentFieldMessage: undefined,
        isAMTTask : false,
        isPreviewMode : false,
        previousLabelingTaskId: undefined,
        dataStoreUrl : undefined,
        onboarding : false,
        taskRemaining : 0,
        taskDescription : undefined,
        taskPanoramaId: undefined,
        hitId : undefined,
        assignmentId: undefined,
        turkerId: undefined
    };
    var status = {
        disabledButtonMessageVisibility: 'hidden',
        disableSkipButton : false,
        disableSubmit : false,
        radioValue: undefined,
        skipReasonDescription: undefined,
        submitType: undefined,
        taskDifficulty: undefined,
        taskDifficultyComment: undefined
    };
    var lock = {
        disableSkipButton : false,
        disableSubmit : false
    };

    function _init (params) {
        var hasGroupId = getURLParameter('groupId') !== "",
            hasHitId = getURLParameter('hitId') !== "",
            hasWorkerId = getURLParameter('workerId') !== "",
            assignmentId = getURLParameter('assignmentId');

        properties.onboarding = params.onboarding;
        properties.dataStoreUrl = params.dataStoreUrl;

        if (('assignmentId' in params) && params.assignmentId) {
            properties.assignmentId = params.assignmentId;
        }
        if (('hitId' in params) && params.hitId) {
            properties.hitId = params.hitId;
        }
        if (('turkerId' in params) && params.turkerId) {
            properties.turkerId = params.turkerId;
        }

        $('input[name="assignmentId"]').attr('value', properties.assignmentId);
        $('input[name="workerId"]').attr('value', properties.turkerId);
        $('input[name="hitId"]').attr('value', properties.hitId);


        if (assignmentId && assignmentId === 'ASSIGNMENT_ID_NOT_AVAILABLE') {
            properties.isPreviewMode = true;
            properties.isAMTTask = true;
            self.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
            self.unlockDisableSkip().disableSkip().lockDisableSkip();
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
                svl.ui.form.form.prop("action", "https://workersandbox.mturk.com/mturk/externalSubmit");
            }
        }

        // Check if this is a preview and, if so, disable submission and show a message saying
        // this is a preview.
        if (properties.isAMTTask && properties.isPreviewMode) {
            var dom = '<div class="amt-preview-warning-holder">' +
                '<div class="amt-preview-warning">' +
                'Warning: you are on a Preview Mode!' +
                '</div>' +
                '</div>';
            $("body").append(dom);
            self.disableSubmit();
            self.lockDisableSubmit();
        }

        // Attach listeners
        svl.ui.form.form.bind('submit', formSubmit);
        svl.ui.form.skipButton.bind('click', openSkipWindow);
    }

    /**
     * This method gathers all the data needed for submission.
     * @returns {{}}
     */
    function compileSubmissionData () {
        var data = {};

        data.audit_task = {
            street_edge_id: svl.task.getStreetEdgeId(),
            task_start: svl.task.getTaskStart(),
            audit_task_id: svl.task.getAuditTaskId()
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

        data.labels = [];
        var labels = svl.labelContainer.getCurrentLabels();

        for(var i = 0; i < labels.length; i += 1) {
            var label = labels[i],
                prop = label.getProperties(),
                points = label.getPath().getPoints(),
                pathLen = points.length;

            var temp = {
                deleted : label.isDeleted(),
                label_id : label.getLabelId(),
                label_type : label.getLabelType(),
                photographer_heading : prop.photographerHeading,
                photographer_pitch : prop.photographerPitch,
                gsv_panorama_id : prop.panoId,
                panorama_lat : prop.panoramaLat,
                panorama_lng : prop.panoramaLng,
                label_points : []
            };

            for (var j = 0; j < pathLen; j += 1) {
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
                        lat : null,
                        lng : null
                    };
                temp.label_points.push(pointParam);
            }

            data.labels.push(temp)
        }


        // Add the value in the comment field if there are any.
        var comment = svl.ui.form.commentField.val();
        data.comment = undefined;
        if (comment &&
            comment !== svl.ui.form.commentField.attr('title')) {
            data.comment = svl.ui.form.commentField.val();
        }
        return data;
    }

    /**
      * Submit the data.
      * @param data This can be an object of a compiled data for auditing, or an array of
      * the auditing data.
      */
    function submit(data) {
        svl.tracker.push('TaskSubmit');
        svl.tracker.refresh();
        svl.labelContainer.refresh();

        if (data.constructor !== Array) {
            data = [data];
        }
        try {
            $.ajax({
                // async: false,
                contentType: 'application/json; charset=utf-8',
                url: properties.dataStoreUrl,
                type: 'post',
                data: JSON.stringify(data),
                dataType: 'json',
                success: function (result) {
                    console.log(result);

                    if (result.error) {
                        console.error(result.error);
                    }
                    else if (!svl.task.getAuditTaskId() && svl.task.getStreetEdgeId() == result.street_edge_id) {
                        svl.task.setAuditTaskId(result.audit_task_id);
                    }
                },
                error: function (result) {
                    throw result;
                    // console.error(result);
                }
            });
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    /**
     * Callback function that is invoked when a user hits a submit button
     * @param e
     * @returns {boolean}
     */
    function formSubmit (e) {
        if (!properties.isAMTTask || properties.taskRemaining > 1) {
            e.preventDefault();
        }

        if (status.disableSubmit) {
            showDisabledSubmitButtonMessage();
            return false;
        }

        // Submit collected data if a user is not in onboarding mode.
        if (!properties.onboarding) {
            var data = compileSubmissionData();
            submit(data);
        }
        return false;
    }

    /**
     * Submit data that has been collected so far.
     * @param e
     */
    function skipSubmit (incompleteTaskData) {
        var data = compileSubmissionData();
        data.incomplete = incompleteTaskData;
        submit(data);
        svl.task.newTask();
    }


    /**
     * Open a modal window and ask why they are jumping to another location
     * @param e
     * @returns {boolean}
     */
    function openSkipWindow (e) {
        e.preventDefault();
        svl.tracker.push('Click_OpenSkipWindow');
        svl.modalSkip.showSkipMenu();
        return false;
    }


    function checkSubmittable () {
        // This method checks whether users can submit labels or skip this task by first checking if they
        // assessed all the angles of the street view.
        // Enable/disable form a submit button and a skip button
        if ('progressPov' in svl && svl.progressPov) {
            var completionRate = svl.progressPov.getCompletionRate();
        } else {
            var completionRate = 0;
        }

        var labelCount = svl.canvas.getNumLabels();

        if (1 - completionRate < 0.01) {
            if (labelCount > 0) {
                enableSubmit();
                disableSkip();
            } else {
                disableSubmit();
                enableSkip();
            }
            return true;
        } else {
            disableSubmit();
            disableSkip();
            return false;
        }
    }

    function disableSubmit () {
        if (!lock.disableSubmit) {
            status.disableSubmit = true;
            //  svl.ui.form.submitButton.attr('disabled', true);
            svl.ui.form.submitButton.css('opacity', 0.5);
            return this;
        }
        return false;
    }


    function disableSkip () {
        if (!lock.disableSkip) {
            status.disableSkip = true;
            // svl.ui.form.skipButton.attr('disabled', true);
            svl.ui.form.skipButton.css('opacity', 0.5);
            return this;
        }
        return false;
    }

    function enableSubmit () {
        if (!lock.disableSubmit) {
            status.disableSubmit = false;
            // svl.ui.form.submitButton.attr('disabled', false);
            svl.ui.form.submitButton.css('opacity', 1);
            return this;
        }
        return false;
    }

    function enableSkip () {
        if (!lock.disableSkip) {
            status.disableSkip = false;
            // svl.ui.form.skipButton.attr('disabled', false);
            svl.ui.form.skipButton.css('opacity', 1);
            return this;
        }
        return false;
    }

    function isPreviewMode () {
        // This method returns whether the task is in preview mode or not.
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

    function setTaskDescription (val) {
        // This method sets the taskDescription
        properties.taskDescription = val;
        return this;
    }

    /**
     * This method sets the labelingTaskId
     * @param val
     * @returns {setPreviousLabelingTaskId}
     */
    function setPreviousLabelingTaskId (val) {
        properties.previousLabelingTaskId = val;
        return this;
    }

    /**
     * This method sets the number of remaining tasks
     * @param val
     * @returns {setTaskRemaining}
     */
    function setTaskRemaining (val) {
        properties.taskRemaining = val;
        return this;
    }

    /**
     * This method sets the taskPanoramaId. Note it is not same as the GSV panorama id.
     * @param val
     * @returns {setTaskPanoramaId}
     */
    function setTaskPanoramaId (val) {
        properties.taskPanoramaId = val;
        return this;
    }

    function unlockDisableSubmit () {
        lock.disableSubmit = false;
        return this;
    }

    function unlockDisableSkip () {
        lock.disableSkipButton = false;
        return this;
    }

    self.checkSubmittable = checkSubmittable;
    self.disableSubmit = disableSubmit;
    self.compileSubmissionData = compileSubmissionData;
    self.disableSkip = disableSkip;
    self.enableSubmit = enableSubmit;
    self.enableSkip = enableSkip;
    self.isPreviewMode = isPreviewMode;
    self.lockDisableSubmit = lockDisableSubmit;
    self.lockDisableSkip = lockDisableSkip;
    self.setPreviousLabelingTaskId = setPreviousLabelingTaskId;
    self.setTaskDescription = setTaskDescription;
    self.setTaskRemaining = setTaskRemaining;
    self.setTaskPanoramaId = setTaskPanoramaId;
    self.unlockDisableSubmit = unlockDisableSubmit;
    self.unlockDisableSkip = unlockDisableSkip;
    self.submit = submit;
    self.skipSubmit = skipSubmit;
    _init(params);
    return self;
}
