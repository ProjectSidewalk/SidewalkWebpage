//var svl = svl || {};
//
///**
// *
// * @param param
// * @param $
// * @returns {{className: string}}
// * @constructor
// * @memberof svl
// */
//function ValidatorForm (param, $) {
//    var oPublic = {className: 'ValidatorForm'};
//    var properties = {
//        dataStoreUrl: undefined,
//        onboarding: undefined,
//        taskDescription: undefined,
//        taskPanoramaId: undefined,
//        assignmentId: undefined,
//        hitId: undefined,
//        turkerId: undefined
//    };
//    var labelBinId = undefined;
//
//    var $btnSubmit;
//
//
//    function init (param) {
//        for (attr in properties) {
//            properties[attr] = param[attr];
//        }
//    }
//
//    function submit () {
//        // This method collects validation labels and submit the data to
//        // the API specified by properties.submitURL.
//        if (!('validator' in svl) || !svl.validator) {
//            throw oPublic.className + ': Validator not defined.';
//        }
//        var taskGSVPanoId = properties.panoId;
//        var url = properties.dataStoreUrl;
//        var hitId;
//        var assignmentId;
//        var turkerId;
//        var data = {};
//        var i;
//        var len;
//
//
//        //
//        hitId = properties.hitId ? properties.hitId : 'Test_Hit';
//        assignmentId = properties.assignmentId? properties.assignmentId : 'Test_Assignment';
//        turkerId = properties.turkerId ? properties.turkerId : 'Test_Kotaro';
//
//
//        // Submit collected data if a user is not in oboarding mode.
//        if (!properties.onboarding) {
//            // if (true) {
//            data.assignment = {
//                amazon_turker_id : turkerId,
//                amazon_hit_id : hitId,
//                amazon_assignment_id : assignmentId,
//                interface_type : 'StreetViewValidator',
//                interface_version : '1',
//                completed : 0,
//                task_description : properties.taskDescription
//            };
//
//            data.labelBinId = labelBinId;
//            data.validationTask = {
//                task_panorama_id: properties.taskPanoramaId,
//                task_gsv_panorama_id : taskGSVPanoId,
//                description: ""
//            };
//
//            data.validationTaskEnvironment = {
//                browser: getBrowser(),
//                browser_version: getBrowserVersion(),
//                browser_width: $(window).width(),
//                browser_height: $(window).height(),
//                screen_width: screen.width,
//                screen_height: screen.height,
//                avail_width: screen.availWidth,		// total width - interface (taskbar)
//                avail_height: screen.availHeight,		// total height - interface };
//                operating_system: getOperatingSystem()
//            };
//
//            //
//            // Get interactions
//            svl.tracker.push('TaskSubmit');
//            data.userInteraction = svl.tracker.getActions();
//
//            data.labels = [];
//
//            // Format the validation labels
//            var validatorLabels = svl.validator.getLabels();
//            len = validatorLabels.length;
//            for (i = 0; i < len; i++) {
//                console.log(validatorLabels[i]);
//                var temp = {};
//                temp.labelId = validatorLabels[i].points[0].LabelId;
//                temp.result = validatorLabels[i].validationLabel === "Disagree" ? 0 : 1;
//                data.labels.push(temp);
//            }
//
//            // Add the value in the comment field if there are any.
////            var comment = $textieldComment.val();
////            data.comment = undefined;
////            if (comment &&
////                comment !== $textieldComment.attr('title')) {
////                data.comment = $textieldComment.val();
////            }
//
//            // Submit data to
//            try {
//                $.ajax({
//                    async: false,
//                    url: url,
//                    type: 'post',
//                    data: data,
//                    dataType: 'json',
//                    success: function (result) {
//                        if (result.error) {
//                            throw result.error.message;
//                        }
//                    },
//                    error: function (result) {
//                        throw result;
//                        // console.error(result);
//                    }
//                });
//            } catch (e) {
//                console.log(e);
//            }
//
//
//
//            if (properties.taskRemaining > 1) {
//                window.location.reload();
//            } else {
//                if (properties.isAMTTask) {
//                    $('input[name="assignmentId"]').attr('value', assignmentId);
//                    $('input[name="workerId"]').attr('value', turkerId);
//                    $('input[name="hitId"]').attr('value', hitId);
//                    return true;
//                } else {
//                    window.location.reload();
//                    //window.location = '/';
//                    return false;
//                }
//            }
//
//        }
//
//        return false;
//    }
//
//
//    oPublic.setLabelBinId = function (binId) {
//        labelBinId = binId;
//        return this;
//    };
//
//    oPublic.submit = function () {
//        return submit();
//    };
//
//
//    init(param);
//    return oPublic;
//}
