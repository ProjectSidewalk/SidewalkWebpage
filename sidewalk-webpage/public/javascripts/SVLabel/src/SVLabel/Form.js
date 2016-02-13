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
    var self = { className : 'Form'},
        properties = {
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
        var hasGroupId = getURLParameter('groupId') !== "";
        var hasHitId = getURLParameter('hitId') !== "";
        var hasWorkerId = getURLParameter('workerId') !== "";
        var assignmentId = getURLParameter('assignmentId');

        properties.onboarding = params.onboarding;
        properties.dataStoreUrl = params.dataStoreUrl;

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
    function compileSubmissionData () {
        var data = {};

        data.audit_task = {
            street_edge_id: svl.task.getStreetEdgeId(),
            task_start: svl.task.getTaskStart()
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

        for(var i = 0; i < labels.length; i += 1) {
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
                        lat : labelLatLng.lat,
                        lng : labelLatLng.lng
                    };
                temp.label_points.push(pointParam);
            }

            data.labels.push(temp)
        }

        // Add the value in the comment field if there are any.
        //var comment = svl.ui.form.commentField.val();
        //data.comment = null;
        //if (comment !== svl.ui.form.commentField.attr('title')) {
        //    data.comment = svl.ui.form.commentField.val();
        //}

        return data;
    }

    /**
     * This method checks whether users can submit labels or skip this task by first checking if they assessed all
     * the angles of the street view. Enable/disable form a submit button and a skip button.
     * @returns {boolean}
     */
    function checkSubmittable () {
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

    /**
     * Callback function that is invoked when a user hits a submit button
     * @param e
     * @returns {boolean}
     */
    function handleFormSubmit (e) {
        if (!properties.isAMTTask || properties.taskRemaining > 1) { e.preventDefault(); }

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


    /** This method returns whether the task is in preview mode or not. */
    function isPreviewMode () { return properties.isPreviewMode; }

    function lockDisableSubmit () { lock.disableSubmit = true; return this; }

    function lockDisableSkip () { lock.disableSkip = true; return this; }

    function setPreviousLabelingTaskId (val) { properties.previousLabelingTaskId = val; return this; }

    /** This method sets the taskDescription */
    function setTaskDescription (val) { properties.taskDescription = val; return this; }

    /** This method sets the taskPanoramaId. Note it is not same as the GSV panorama id. */
    function setTaskPanoramaId (val) { properties.taskPanoramaId = val; return this; }

    /** This method sets the number of remaining tasks */
    function setTaskRemaining (val) { properties.taskRemaining = val; return this; }

    /**
     *
     */
    function showDisabledSubmitButtonMessage () {
        var completionRate = parseInt(svl.progressPov.getCompletionRate() * 100, 10);

        if (!('onboarding' in svl && svl.onboarding) &&
            (completionRate < 100)) {
            var message = "You have inspected " + completionRate +
                "% of the scene. Let's inspect all the corners before you submit the task!",
                $OkBtn;

            // Clear and render the onboarding canvas
            var $divOnboardingMessageBox = undefined; //

            if (status.disabledButtonMessageVisibility === 'hidden') {
                status.disabledButtonMessageVisibility = 'visible';
                var okButton = '<button id="TempOKButton" class="button bold" style="left:20px;position:relative; width:100px;">OK</button>';
                $divOnboardingMessageBox.append(okButton);
                $OkBtn = $("#TempOKButton");
                $OkBtn.bind('click', function () {
                    //
                    // Remove the OK button and clear the message.
                    $OkBtn.remove();
                    //messageCanvas.clear();
                    status.disabledButtonMessageVisibility = 'hidden';
                })
            }
        }
    }

    /**
     * Submit the data collected so far and move to another location.
     * @param dataIn. An object which has fields "issue_description", "lat", and "lng." E.g., {issue_description: "IWantToExplore", lat: 38.908628, lng: -77.08022499999998}
     * @returns {boolean}
     */
    function skipSubmit (dataIn) {
        var data = compileSubmissionData();
        data.incomplete = dataIn;
        svl.tracker.push('TaskSkip');
        submit(data);
        svl.task.nextTask();
        return false;
    }


    /**
     * Submit the data.
     * @param data This can be an object of a compiled data for auditing, or an array of
     * the auditing data.
     */
    function submit(data) {
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
                if (result.error) {
                    console.log(result.error);
                }
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    /** Unlock disable submit */
    function unlockDisableSubmit () { lock.disableSubmit = false; return this; }

    /** Unlock disable skip */
    function unlockDisableSkip () { lock.disableSkipButton = false; return this; }

    self.checkSubmittable = checkSubmittable;
    self.compileSubmissionData = compileSubmissionData;
    self.disableSubmit = disableSubmit;
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
    self.skipSubmit = skipSubmit;
    self.unlockDisableSubmit = unlockDisableSubmit;
    self.unlockDisableSkip = unlockDisableSkip;
    self.submit = submit;
    _init(params);
    return self;
}
