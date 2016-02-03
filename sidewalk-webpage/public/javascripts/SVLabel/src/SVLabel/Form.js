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
    var self = {
        'className' : 'Form'
    };

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
        turkerId: undefined,
        userExperiment: false
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

    // jQuery doms
    //var $form;
    //var $textieldComment;
    //var $btnSubmit;
    //var $btnSkip;
    //var $btnConfirmSkip;
    //var $btnCancelSkip;
    //var $radioSkipReason;
    //var $textSkipOtherReason;
    //var $divSkipOptions;
    //var $pageOverlay;
    //var $taskDifficultyWrapper;
    //var $taskDifficultyOKButton;

    var messageCanvas;

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

        //if (('userExperiment' in params) && params.userExperiment) {
        //    properties.userExperiment = true;
        //}

        // initiailze jQuery elements.
        //$form = $("#BusStopLabelerForm");
        //$textieldComment = svl.ui.form.commentField; //$("#CommentField");
        //$btnSubmit = svl.ui.form.submitButton;
        //$btnSkip = svl.ui.form.skipButton;
        //$btnConfirmSkip = $("#BusStopAbsence_Submit");
        //$btnCancelSkip = $("#BusStopAbsence_Cancel");
        //$radioSkipReason = $('.Radio_BusStopAbsence');
        //$textSkipOtherReason = $("#Text_BusStopAbsenceOtherReason");
        //$divSkipOptions = $("#Holder_SkipOptions");
        //$pageOverlay = $("#page-overlay-holder");


        //if (properties.userExperiment) {
        //    $taskDifficultyOKButton = $("#task-difficulty-button");
        //    $taskDifficultyWrapper = $("#task-difficulty-wrapper");
        //}


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

        // Check if this is a preview and, if so, disable submission and show a message saying
        // this is a preview.
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

        // if (!('onboarding' in svl && svl.onboarding)) {
        //     messageCanvas = new Onboarding(params, $)
        // }

        //
        // Insert texts in a textfield
        //properties.commentFieldMessage = $textieldComment.attr('title');
        //$textieldComment.val(properties.commentFieldMessage);

        //
        // Disable Submit button so turkers cannot submit without selecting
        // a reason for not being able to find the bus stop.
        //disableConfirmSkip();

        //
        // Attach listeners
        //$textieldComment.bind('focus', focusCallback); // focusCallback is in Utilities.js
        //$textieldComment.bind('blur', blurCallback); // blurCallback is in Utilities.js
        //$form.bind('submit', formSubmit);
        //$btnSkip.bind('click', openSkipWindow);
        //$btnConfirmSkip.on('click', skipSubmit);
        //$btnCancelSkip.on('click', closeSkipWindow);
        //$radioSkipReason.on('click', radioSkipReasonClicked);
        // http://stackoverflow.com/questions/11189136/fire-oninput-event-with-jquery
        //if ($textSkipOtherReason.get().length > 0) {
        //    $textSkipOtherReason[0].oninput = skipOtherReasonInput;
        //}
        //
        //if (properties.userExperiment) {
        //    $taskDifficultyOKButton.bind('click', taskDifficultyOKButtonClicked);
        //}

        svl.ui.form.skipButton.on('click', handleSkipClick);

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
                temporary_problem: label.getProperty('temporaryProblem')
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

//        if (data.labels.length === 0) {
//            data.labelingTask.no_label = 0;
//        }

        // Add the value in the comment field if there are any.
        var comment = $textieldComment.val();
        data.comment = undefined;
        if (comment &&
            comment !== $textieldComment.attr('title')) {
            data.comment = $textieldComment.val();
        }
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
        }
        return false;
    }

    /**
     * Enable clicking the submit button
     * @returns {*}
     */
    function enableSubmit () {
        if (!lock.disableSubmit) {
            status.disableSubmit = false;
            // $btnSubmit.attr('disabled', false);
            //$btnSubmit.css('opacity', 1);

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
            // $btnSkip.attr('disabled', false);
            //$btnSkip.css('opacity', 1);
            return this;
        }
        return false;
    }

    function handleSkipClick (e) {
        e.preventDefault();
        svl.tracker.push('Click_OpenSkipWindow');
        svl.modalSkip.showSkipMenu();
    }

    /**
      * Submit the data.
      * @param data This can be an object of a compiled data for auditing, or an array of
      * the auditing data.
      */
    function submit(data) {
        svl.tracker.push('TaskSubmit');
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
                    if (result.error) {
                        console.log(result.error);
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
//
//        if (properties.taskRemaining > 1) {
//            window.location.reload();
//            return false;
//        } else {
//            if (properties.isAMTTask) {
//                return true;
//            } else {
//                window.location.reload();
//                //window.location = '/';
//                return false;
//            }
//        }
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

        var url = properties.dataStoreUrl;
        var data = {};

        if (status.disableSubmit) {
            showDisabledSubmitButtonMessage();
            return false;
        }

        // temp
        // window.location.reload();

        //
        // If this is a task with ground truth labels, check if users made any mistake.
//        if ('goldenInsertion' in svl && svl.goldenInsertion) {
//            var numMistakes = svl.goldenInsertion.reviewLabels();
//            self.disableSubmit().lockDisableSubmit();
//            self.disableSkip().lockDisableSkip();
//            return false;
//        }

        //
        // Disable a submit button and other buttons so turkers cannot submit labels more than once.
        //$btnSubmit.attr('disabled', true);
        //$btnSkip.attr('disabled', true);
        //$btnConfirmSkip.attr('disabled', true);
        //$pageOverlay.css('visibility', 'visible');



        // Submit collected data if a user is not in onboarding mode.
        if (!properties.onboarding) {
            data = compileSubmissionData();
            submit(data);
//            svl.tracker.push('TaskSubmit');
//
//            data = compileSubmissionData();
//
//            if (status.taskDifficulty != undefined) {
//                data.taskDifficulty = status.taskDifficulty;
//                data.labelingTask.description = "TaskDifficulty:" + status.taskDifficulty;
//                if (status.taskDifficultyComment) {
//                    data.comment = "TaskDifficultyCommentField:" + status.taskDifficultyComment + ";InterfaceCommentField:" + data.comment
//                }
//            }
//
//            try {
//                $.ajax({
//                    async: false,
//                    contentType: 'application/json; charset=utf-8',
//                    url: url,
//                    type: 'post',
//                    data: JSON.stringify(data),
//                    dataType: 'json',
//                    success: function (result) {
//                        if (result.error) {
//                            console.log(result.error);
//                        }
//                    },
//                    error: function (result) {
//                        throw result;
//                        // console.error(result);
//                    }
//                });
//            } catch (e) {
//                console.error(e);
//                return false;
//            }
//
//            if (properties.taskRemaining > 1) {
//                window.location.reload();
//                return false;
//            } else {
//                if (properties.isAMTTask) {
//                    return true;
//                } else {
//                    window.location.reload();
//                    //window.location = '/';
//                    return false;
//                }
//            }
        }
        return false;
    }

    function goldenInsertionSubmit () {
        // This method submits the labels that a user provided on golden insertion task and refreshes the page.
        if ('goldenInsertion' in svl && svl.goldenInsertion) {
            svl.tracker.push('GoldenInsertion_Submit');
            var url = properties.dataStoreUrl;
            var data;
            svl.goldenInsertion.disableOkButton();

            data = compileSubmissionData();
            data.labelingTask.description = "GoldenInsertion";

            try {
                $.ajax({
                    async: false,
                    url: url,
                    type: 'post',
                    data: data,
                    dataType: 'json',
                    success: function (result) {
                        if (((typeof result) == 'object') && ('error' in result) && result.error) {
                            console.log(result.error);
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

            window.location.reload();
        } else {
            throw self.className + ": This method cannot be called without GoldenInsertion";
        }
        return false;
    }

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
            messageCanvas.clear();
            messageCanvas.renderMessage(300, 250, message, 350, 140);
            messageCanvas.renderArrow(650, 282, 710, 282);

            if (status.disabledButtonMessageVisibility === 'hidden') {
                status.disabledButtonMessageVisibility = 'visible';
                var okButton = '<button id="TempOKButton" class="button bold" style="left:20px;position:relative; width:100px;">OK</button>';
                $divOnboardingMessageBox.append(okButton);
                $OkBtn = $("#TempOKButton");
                $OkBtn.bind('click', function () {
                    //
                    // Remove the OK button and clear the message.
                    $OkBtn.remove();
                    messageCanvas.clear();
                    status.disabledButtonMessageVisibility = 'hidden';
                })
            }
        }
    }

    /**
     *
     * @param dataIn. An object which has fields "issue_description", "lat", and "lng."
     *                E.g., {issue_description: "IWantToExplore", lat: 38.908628, lng: -77.08022499999998}
     * @returns {boolean}
     */
    function skipSubmit (dataIn) {
        var url = properties.dataStoreUrl, data = {};

        // Set a value for skipReasonDescription.
        if (status.radioValue === 'Other:') {
            status.skipReasonDescription = "Other: " + $textSkipOtherReason.val();
        }

        // Submit collected data if a user is not in oboarding mode.
        if (!properties.onboarding) {
            svl.tracker.push('TaskSubmitSkip');

            // Compile the submission data with compileSubmissionData method,
            // then overwrite a part of the compiled data.
            data = compileSubmissionData();
            data.noLabels = true;
            data.labelingTask.no_label = 1;
            data.labelingTask.description = status.skipReasonDescription;


            try {
                $.ajax({
                    async: false,
                    url: url,
                    type: 'post',
                    data: data,
                    success: function (result) {
                        if (result.error) {
                            console.error(result.error);
                        }
                    },
                    error: function (result) {
                        throw result;
                    }
                });
            } catch (e) {
                console.error(e);
                return false;
            }

            if (properties.taskRemaining > 1) {
                window.location.reload();
                return false;
            } else {
                if (properties.isAMTTask) {
                    // $form.submit();
                    document.getElementById("BusStopLabelerForm").submit();
                    return true;
                } else {
                    // window.location = '/';
                    window.location.reload();
                    return false;
                }
            }

        }
        return false;
    }


    /**
     * This method returns whether the task is in preview mode or not.
     * @returns {boolean}
     */
    function isPreviewMode () { return properties.isPreviewMode; }

    function lockDisableSubmit () {
        lock.disableSubmit = true;
        return this;
    }

    function lockDisableSkip () {
        lock.disableSkip = true;
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

    /** This method sets the taskDescription */
    function setTaskDescription (val) {
        properties.taskDescription = val;
        return this;
    }

    /** This method sets the number of remaining tasks */
    function setTaskRemaining (val) {
        properties.taskRemaining = val;
        return this;
    }

    /** This method sets the taskPanoramaId. Note it is not same as the GSV panorama id. */
    function setTaskPanoramaId (val) {
        properties.taskPanoramaId = val;
        return this;
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

    self.checkSubmittable = checkSubmittable;
    self.compileSubmissionData = compileSubmissionData;
    self.disableSubmit = disableSubmit;
    self.disableSkip = disableSkip;
    self.enableSubmit = enableSubmit;
    self.enableSkip = enableSkip;
    self.goldenInsertionSubmit = goldenInsertionSubmit;
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
    self.compileSubmissionData = compileSubmissionData;
    _init(params);
    return self;
}
