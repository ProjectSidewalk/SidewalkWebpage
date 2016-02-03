var svl = svl || {};

/**
 *
 * @param param {object}
 * @param $ {object} jQuery object
 * @returns {{className: string}}
 * @constructor
 */
function GoldenInsertion (param, $) {
    var self = {
        className: 'GoldenInsertion'
    };
    var properties = {
        cameraMovementDuration: 500, // 500 ms
        curbRampThreshold: 0.35,
        goldenLabelVisibility: 'hidden',
        noCurbRampThreshold: 0.1
    };
    var status = {
        boxMessage: "",
        currentLabel: undefined,
        hasMistake: false,
        revisingLabels: false
    };
    var lock = {};
    var domOKButton = '<button id="GoldenInsertionOkButton" class="button" style="">OK</button>';

    var onboarding; // This variable will hold an onboarding object

    var $buttonCurbRamp;
    var $buttonNoCurbRamp;

    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function _init (param) {
        if ('goldenLabelVisibility' in param) {
            properties.goldenLabelVisibility = param.goldenLabelVisibility;
        }

        onboarding = new Onboarding(param, $);
        $buttonCurbRamp = $("#ModeSwitchButton_CurbRamp");
        $buttonNoCurbRamp = $("#ModeSwitchButton_NoCurbRamp");
    }

    function clear () {
        // This method clears the object status and cleans up the instruction canvas.
        status.currentLabel = undefined;
        onboarding.clear();
    }

    function clickOK () {
        // This is a callback function that is invoked when a user clicked an OK button on the final message.
        if ('form' in svl && svl.form) {
            svl.form.goldenInsertionSubmit();
        } else {
            throw self.className + ": Cannnot submit without a Form object.";
        }
    }

    function compare(label1, label2) {
        // A comparison function used to sort a list of labels based on its relativeHeading.
        if (label1.relativeHeading < label2.relativeHeading) {
            return -1;
        } else if (label1.relativeHeading > label2.relativeHeading) {
            return 1
        } else {
            return 0;
        }
    }

    function reviseFalseNegative (label) {
        // This method sets the camera angle to a false negative label and asks a user to label it.
        if (('canvas' in svl && svl.canvas) &&
            ('map' in svl && svl.map)) {
            svl.tracker.push('GoldenInsertion_ReviseFalseNegative');
            var labelId = label.getLabelId();
            var systemLabels = svl.canvas.getSystemLabels(true);
            var systemLabelIndex;
            var systemLabelsLength = systemLabels.length;

            //
            // Find a reference to the right user label
            for (systemLabelIndex = 0; systemLabelIndex < systemLabelsLength; systemLabelIndex++) {
                if (labelId == systemLabels[systemLabelIndex].getLabelId()) {
                    label = systemLabels[systemLabelIndex];
                    label.unlockVisibility().setVisibility('visible').lockVisibility();
                    // label.unlockTagVisibility().setTagVisibility('visible').lockTagVisibility();
                } else {
                    systemLabels[systemLabelIndex].unlockVisibility().setVisibility('hidden').lockVisibility();
                    // systemLabels[systemLabelIndex].unlockTagVisibility().setTagVisibility('hidden').lockTagVisibility();
                }
            }

            //
            // Set the pov so the user can see the label.
            var pov = label.getLabelPov();
            var labelType = label.getLabelType();
            status.currentLabel = label;

            if (labelType === "CurbRamp") {
                // status.boxMessage = "You did not label this <b>curb ramp</b>. Please draw an outline around it by clicking the <b>Curb Ramp</b> button.";
                status.boxMessage = "You did not label this <b>curb ramp</b>. Please draw an outline around it.";
            } else {
                // status.boxMessage = "You did not label this <b>missing curb ramp</b>. Please draw an outline around it by clicking the <b>Missing Curb Ramp</b> button.";
                status.boxMessage = "You did not label this <b>missing curb ramp</b>. Please draw an outline around it.";
            }

            svl.messageBox.hide();
            svl.map.setPov(pov, properties.cameraMovementDuration, function () {
                status.currentLabel = label;
                showMessage();
                //
                // Automatically switch to the CurbRamp or NoCurbRamp labeling mode based on the given label type.
                if (labelType === 'CurbRamp') {
                    svl.ribbon.modeSwitch('CurbRamp');
                } else if (labelType === 'NoCurbRamp') {
                    svl.ribbon.modeSwitch('NoCurbRamp');
                }
            });
            var blue = 'rgba(0,0,255, 0.5)';
            label.fill(blue).blink(5); // True is set to fade the color at the end.
        }
    }

    function reviseFalsePositive (label, overlap) {
        // This method sets the camera angle to a false positive label and asks a user to delete the false positive label.
        if (!overlap || typeof overlap !== "number") {
            overlap = 0;
        }
        if (('canvas' in svl && svl.canvas) &&
            ('map' in svl && svl.map)) {
            svl.tracker.push('GoldenInsertion_ReviseFalsePositive');
            var labelId = label.getLabelId();
            var userLabels = svl.canvas.getUserLabels(true);
            var userLabelIndex;
            var userLabelsLength = svl.canvas.getUserLabelCount();

            //
            // Find a reference to the right user label
            for (userLabelIndex = 0; userLabelIndex < userLabelsLength; userLabelIndex++) {
                if (labelId == userLabels[userLabelIndex].getLabelId()) {
                    label = userLabels[userLabelIndex];
                    break;
                }
            }

            //
            // Set the pov so the user can see the label.
            var pov = label.getLabelPov();
            var labelType = label.getLabelType();
            status.currentLabel = label;

            if (labelType === "CurbRamp") {
                // status.boxMessage = "You did not label this <b>curb ramp</b>. Please draw an outline around it by clicking the <b>Curb Ramp</b> button.";
                if (overlap > 0) {
                    status.boxMessage = "This label does not precisely outline the <b>curb ramp</b>. Mouse over the label and click " +
                        "<img src=\"" + svl.rootDirectory + "img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
                        "to delete.";
                } else {
                    status.boxMessage = "There does not appear to be a curb ramp to label here. Mouse over the label and click " +
                        "<img src=\"" + svl.rootDirectory + "/img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
                        "to delete.";
                }
            } else {
                // status.boxMessage = "You did not label this <b>missing curb ramp</b>. Please draw an outline around it by clicking the <b>Missing Curb Ramp</b> button.";
                if (overlap > 0) {
                    status.boxMessage = "Your label is not on a <b>missing curb ramp</b>. Mouse over the label and click " +
                        "<img src=\"" + svl.rootDirectory + "/img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
                        "to delete.";
                } else {
                    status.boxMessage = "There does not appear to be any missing curb ramp to label here. Mouse over the label and click " +
                        "<img src=\"" + svl.rootDirectory + "/img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
                        "to delete.";
                }
            }

//            if (labelType === "CurbRamp") {
//                var message = "This label does not precisely outline the curb ramp. Please delete the label by clicking the " +
//                    "<img src=\"public/img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
//                    "button and try outlining.";
//            } else {
//                var message = "Your label is not on a missing curb ramp. Please delete the label by clicking " +
//                    "<img src=\"public/img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
//                    "on the label.";
//            }

            //
            // Change the pov, then invoke a callback function to show an message.
            // Ask an user to delete the label that is wrong.
            // Keep checking if the user deleted the label or not by counting the number of user labels.
            // Move on once the user have corrected the mistake.
            svl.messageBox.hide();
            svl.map.setPov(pov, properties.cameraMovementDuration, function () {
                status.currentLabel = label;
                showMessage();
            });
            // label.highlight().blink(5, true); // The second argument is set to true so the label will fade at the end.
            var red = 'rgba(255, 0, 0, 0.7)';
            label.fill(red).blink(5);
        }
    }

    function reviewLabels () {
        // Deprecated. Use reviewLabels2
        // This method reviews if user provided labels align well with system provided (golden/ground truth) labels.
        // This method extract system labels and user labels from svl.canvas, then compares overlap.
        // Finally it returns the number of mistakes identified.
        if (('canvas' in svl && svl.canvas) &&
            ('form' in svl && svl.form) &&
            ('map' in svl && svl.map)) {
            var userLabels = svl.canvas.getLabels('user');
            var systemLabels = svl.canvas.getLabels('system');
            var userLabelIndex;
            var systemLabelIndex;

            //
            // Clear anything from previous review.
            clear();

            //
            // Filter user labels
            userLabels = userLabels.filter(function (label) {
                return !label.isDeleted() && label.isVisible();
            });

            var userLabelsLength = svl.canvas.getUserLabelCount();
            var systemLabelsLength = systemLabels.length;
            var falseNegativeLabels = []; // This array stores ids of missed system labels.
            var falsePositiveLabels = []; // This array stores ids of false user labels.

            var overlap;
            var labelType;
            var doesOverlap;

            //
            // Check if a user has labeled something that is not a curb ramp or not a missing curb ramp (False positive)
            for (userLabelIndex = 0; userLabelIndex < userLabelsLength; userLabelIndex++) {
                overlap = 0;
                doesOverlap = false;
                for (systemLabelIndex = 0; systemLabelIndex < systemLabelsLength; systemLabelIndex++) {
                    if (!userLabels[userLabelIndex].isDeleted() && userLabels[userLabelIndex].isVisible()) {
                        if (userLabels[userLabelIndex].getLabelType() == systemLabels[systemLabelIndex].getLabelType()) {
                            overlap = userLabels[userLabelIndex].overlap(systemLabels[systemLabelIndex]);
                            labelType = userLabels[userLabelIndex].getLabelType();
                            if (labelType == "CurbRamp" && overlap > properties.curbRampThreshold) {
                                doesOverlap = true;
                                break;
                            } else if (labelType == "NoCurbRamp" && overlap > properties.noCurbRampThreshold) {
                                doesOverlap = true;
                                break;
                            }
                        }
                    }
                }
                if (!doesOverlap) {
                    falsePositiveLabels.push(userLabels[userLabelIndex]);
                }
            }

            //
            // Check if a user has missed to label some of system labels (False negatives)
            for (systemLabelIndex = 0; systemLabelIndex < systemLabelsLength; systemLabelIndex++) {
                overlap = 0;
                doesOverlap = false;
                for (userLabelIndex = 0; userLabelIndex < userLabelsLength; userLabelIndex++) {
                    if (!userLabels[userLabelIndex].isDeleted() && userLabels[userLabelIndex].isVisible()) {

                        if (userLabels[userLabelIndex].getLabelType() == systemLabels[systemLabelIndex].getLabelType()) {
                            overlap = userLabels[userLabelIndex].overlap(systemLabels[systemLabelIndex]);
                            labelType = userLabels[userLabelIndex].getLabelType();
                            if (labelType == "CurbRamp" && overlap > properties.curbRampThreshold) {
                                doesOverlap = true;
                                break;
                            } else if (labelType == "NoCurbRamp" && overlap > properties.noCurbRampThreshold) {
                                doesOverlap = true;
                                break;
                            }
                        }
                    }
                }
                if (!doesOverlap) {
                    falseNegativeLabels.push(systemLabels[systemLabelIndex]);
                }
            }

            //
            // Walk through the mistakes if there are any mistakes
            var numFalseNegatives = falseNegativeLabels.length;
            var numFalsePositives = falsePositiveLabels.length;
            var numMistakes = numFalseNegatives + numFalsePositives;
            if (numMistakes > 0) {
                status.hasMistake = true;
                if (numFalsePositives > 0) {
                    reviseFalsePositive(falsePositiveLabels[0]);
                } else if (numFalseNegatives > 0) {
                    reviseFalseNegative(falseNegativeLabels[0]);
                }
                return numMistakes;
            } else {
                // Change the message depending on whether s/he has made a misatke or not.
                var domSpacer = "<div style='height: 10px'></div>"
                if (status.hasMistake) {
                    var message = "Great, you corrected all the mistakes! Now, let's move on to the next task. " +
                        "Please try to be as accurate as possible. Your labels will be used to make our cities better " +
                        "and more accessible.<br/>" + domSpacer + domOKButton;
                } else {
                    var message = "Fantastic! You labeled everything correctly! Let's move on to the next task. <br />" + domSpacer + domOKButton;
                }
                var messageBoxX = 0;
                var messageBoxY = 320;
                var width = 720;
                var height = null;
                svl.messageBox.setMessage(message).setPosition(messageBoxX, messageBoxY, width, height, true).show();
                $("#GoldenInsertionOkButton").bind('click', clickOK);
                return 0;
            }
        }
        return false;
    }

    function reviewLabels2 () {
        // This method reviews if user provided labels align well with system provided (golden/ground truth) labels.
        // This method extract system labels and user labels from svl.canvas, then compares overlap.
        if (('canvas' in svl && svl.canvas) &&
            ('form' in svl && svl.form) &&
            ('map' in svl && svl.map) &&
            ('panorama' in svl && svl.panorama)) {
            svl.tracker.push('GoldenInsertion_ReviewLabels');
            var userLabels = svl.canvas.getLabels('user');
            var systemLabels = svl.canvas.getLabels('system');
            var allLabels = [];
            var userLabelIndex;
            var systemLabelIndex;

            //
            // Clear anything from previous review.
            clear();

            //
            // Filter user labels
            userLabels = userLabels.filter(function (label) {
                return !label.isDeleted() && label.isVisible();
            });


            var _userLabels = userLabels.map(function (label) {
                label.labeledBy = "user";
                return label;
            });
            var _systemLabels = systemLabels.map(function (label) {
                label.labeledBy = "system";
                return label;
            });
            var allLabels = _userLabels.concat(_systemLabels);
            allLabels = allLabels.map(function (label) {
                var currentHeading = svl.panorama.getPov().heading;
                var labelHeading = label.getLabelPov().heading; //label.//label.getProperty("panoramaHeading");
                var weight = 10; // Add a weight to system labels so they tend to be corrected after correcting user labels.
                label.relativeHeading = parseInt((labelHeading - currentHeading + 360) % 360);
                label.relativeHeading = (label.relativeHeading < 360 - label.relativeHeading) ? label.relativeHeading : 360 - label.relativeHeading;
                label.relativeHeading = (label.labeledBy === "system") ? label.relativeHeading + weight : label.relativeHeading;
                return label;
            });
            //
            // Sort an array of objects by values of the objects
            // http://stackoverflow.com/questions/1129216/sorting-objects-in-an-array-by-a-field-value-in-javascript
            allLabels.sort(compare);


            var overlap;


            //
            // Check if the user has labeled curb ramps and missing curb ramps correctly.
            var allLabelsLength = allLabels.length;
            var i;
            var j;
            var len;
            var correctlyLabeled;
            for (i = 0; i < allLabelsLength; i++) {
                if (("correct" in allLabels[i]) && allLabels[i]["correct"]) {
                    continue;
                } else {
                    correctlyLabeled = false;
                    var maxOverlap = 0;
                    if (allLabels[i].labeledBy === "user") {
                        // compare the user label with all the system labels to see if it is a true positive label.
                        len = systemLabels.length;
                        for (j = 0; j < len; j++) {
                            if (allLabels[i].getLabelType() === systemLabels[j].getLabelType()) {
                                overlap = allLabels[i].overlap(systemLabels[j]);

                                if (overlap > maxOverlap) {
                                    maxOverlap = overlap;
                                }


                                if ((allLabels[i].getLabelType() === "CurbRamp" && overlap > properties.curbRampThreshold) ||
                                    (allLabels[i].getLabelType() === "NoCurbRamp" && overlap > properties.noCurbRampThreshold)) {
                                    allLabels[i].correct = true;
                                    systemLabels[j].correct = true;
                                    correctlyLabeled = true;
                                    break;
                                }
                            }
                        }
                        if (!correctlyLabeled) {
                            if (!status.hasMistake) {
                                // Before moving on to the correction phase, show a message that tells
                                // the user we will guide them to correct labels.
                                showPreLabelCorrectionMesseage(reviseFalsePositive, {label: allLabels[i], overlap: maxOverlap});
                                status.hasMistake = true;
                            } else {
                                reviseFalsePositive(allLabels[i], maxOverlap);
                            }
                            return;
                        }
                    } else {
                        // Compare the system label with all the user labels to see if the user has missed to label this
                        // this system label.
                        len = userLabels.length;
                        for (j = 0; j < len; j++) {
                            if (allLabels[i].getLabelType() === userLabels[j].getLabelType()) {
                                overlap = allLabels[i].overlap(userLabels[j]);
                                if ((allLabels[i].getLabelType() === "CurbRamp" && overlap > properties.curbRampThreshold) ||
                                    (allLabels[i].getLabelType() === "NoCurbRamp" && overlap > properties.noCurbRampThreshold)) {
                                    allLabels[i].correct = true;
                                    userLabels[j].correct = true;
                                    correctlyLabeled = true;
                                    break;
                                }
                            }
                        }
                        if (!correctlyLabeled) {
                            if (!status.hasMistake) {
                                // Before moving on to the correction phase, show a message that tells
                                // the user we will guide them to correct labels.
                                showPreLabelCorrectionMesseage(reviseFalseNegative, {label: allLabels[i]});
                                status.hasMistake = true;
                            } else {
                                reviseFalseNegative(allLabels[i]);
                            }
                            return;
                        }
                    }
                }
            }

            //
            // Change the message depending on whether s/he has made a misatke or not.
            var domSpacer = "<div style='height: 10px'></div>"
            if (status.hasMistake) {
                var message = "Great, you corrected all the mistakes! Please try to be as accurate as possible. " +
                    "Your labels will be used to make our cities better and more accessible." +
                    "Now, let's move on to the next task. <br/>" + domSpacer + domOKButton;
            } else {
                var message = "Fantastic! You labeled everything correctly! Let's move on to the next task. <br />" + domSpacer + domOKButton;
            }
            var messageBoxX = 0;
            var messageBoxY = 320;
            var width = 700;
            var height = null;
            svl.messageBox.setMessage(message).setPosition(messageBoxX, messageBoxY, width, height, true).show();
            $("#GoldenInsertionOkButton").bind('click', clickOK);
            return;
        }
        return;
    }

    function showMessage() {
        // Show a message and ask an user to provide a label the label they missed to label.
        // Keep checking if they provided a new label or not. Until they provide the label, disable submit.
        // Once they provide a label, review other labels.
        //
        // This method assumes that status.currentLabel and status.boxMessage are set.
        onboarding.clear();

        var boundingbox = status.currentLabel.getBoundingBox();
        var messageBoxX = boundingbox.x + boundingbox.width + 50;
        var messageBoxY = boundingbox.y + boundingbox.height / 2 + 60;
        svl.messageBox.setMessage(status.boxMessage).setPosition(messageBoxX, messageBoxY).show();

        //
        // Show a "click here" message and bind events to mode switch buttons.

        // onboarding.renderArrow(x, y - 50, x, y - 20, {arrowWidth: 3});
        onboarding.renderArrow(messageBoxX, boundingbox.y + boundingbox.height / 2 + 10, messageBoxX - 25, boundingbox.y + (boundingbox.height / 2), {arrowWidth: 3});
        // onboarding.renderArrow(messageBoxX, y - 50, messageBoxX - 25, y - 80, {arrowWidth: 3});
        // onboarding.renderCanvasMessage(x - (boundingbox.width / 2) - 150, y - 60, "Trace an outline similar to this one.", {fontSize: 18, bold: true});
    }

    function showPreLabelCorrectionMesseage(callback, params) {
        // Before moving on to the correction phase, show a message that tells
        // the user we will guide them to correct labels.
        if (!params) {
            return false;
        }
        if (!("label" in params) || !params.label) {
            return false;
        }

        var domSpacer = "<div style='height: 10px'></div>"
        var message = "<img src=\"" + svl.rootDirectory + "/img/icons/Icon_WarningSign.svg\" class=\"MessageBoxIcons\" style=\"height:30px; width:30px; top:6px;\"/> " +
            "Uh oh, looks like there is a problem with your labels. Let's see if we can fix this. <br />" + domSpacer + domOKButton;
        var messageBoxX = 0;
        var messageBoxY = 320;
        var width = 720;
        var height = null;
        svl.messageBox.setMessage(message).setPosition(messageBoxX, messageBoxY, width, height, true).show();
        $("#GoldenInsertionOkButton").bind('click', function () {
            svl.messageBox.hide();
            if ("overlap" in params) {
                callback(params.label, params.overlap);
            } else {
                callback(params.label);
            }
        });
    }


    ////////////////////////////////////////////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////////////////////////////////////////////
    self.disableOkButton = function () {
        // This method disables the OK button.
        $("#GoldenInsertionOkButton").unbind('click');
        $("#GoldenInsertionOkButton").css('opacity', 0.7);
    };

    self.getGoldenLabelVisibility = function () {
        // This method returns the visibility of golden labels.
        return properties.goldenLabelVisibility;
    };

    self.isRevisingLabels = function () {
        // This function is called in Canvas to check whether the user should be revising
        // the false labels. See removeLabel amd closePath methods.
        return status.revisingLabels;
    };

    self.renderMessage = function () {
        // This is a function that is executed from Map.js's viewControlLayerMouseMove()
        if (status.currentLabel && status.boxMessage !== "") {
            showMessage();
        }
        return;
    };

    self.reviewLabels = function () {
        status.revisingLabels = true;
        return reviewLabels2();
    };

    _init(param);
    return self;
}

svl.formatRecordsToGoldenLabels = function (records) {
    // This method takes records from database and format it into labels that the Canvas object can read.
    var i;
    var goldenLabels = {};
    var recordsLength = records.length;

    //
    // Group label points by label id
    var labelId;
    var panoId;
    var lat;
    var lng;
    var deleted;
    for (i = 0; i < recordsLength; i++) {
        //
        // Set pano id
        if ('LabelGSVPanoramaId' in records[i]) {
            panoId = records[i].LabelGSVPanoramaId;
        } else if ('GSVPanoramaId' in records[i]) {
            panoId = records[i].GSVPanoramaId;
        } else {
            panoId = undefined;
        }

        //
        // set latlng
        if ('Lat' in records[i]) {
            lat = records[i].Lat;
        } else if ('labelLat' in records[i]) {
            lat = records[i].labelLat;
        } else {
            lat = undefined;
        }
        if ('Lng' in records[i]) {
            lng = records[i].Lng;
        } else if ('labelLng' in records[i]) {
            lng = records[i].labelLng;
        } else {
            lng = undefined;
        }

        if (records[i].Deleted != "1") {
            labelId = records[i].LabelId;
            if (!(labelId in goldenLabels)) {
                goldenLabels[labelId] = [];
            }

            var temp = {
                AmazonTurkerId: records[i].AmazonTurkerId,
                LabelId: records[i].LabelId,
                LabelGSVPanoramaId: panoId,
                LabelType: records[i].LabelType,
                LabelPointId: records[i].LabelPointId,
                svImageX: records[i].svImageX,
                svImageY: records[i].svImageY,
                originalCanvasCoordinate: {x: records[i].originalCanvasX, y: records[i].originalCanvasY},
                originalHeading: records[i].originalHeading,
                originalPitch: records[i].originalPitch,
                originalZoom: records[i].originalZoom,
                heading: records[i].heading,
                pitch: records[i].pitch,
                zoom: records[i].zoom,
                Lat: lat,
                Lng: lng
            };

            if ('PhotographerHeading' in records[i] && 'PhotographerPitch' in records[i]) {
                temp.PhotographerHeading = parseFloat(records[i].PhotographerHeading);
                temp.PhotographerPitch = parseFloat(records[i].PhotographerPitch);
            }
            goldenLabels[labelId].push(temp);
        }
    }

    var ret = [];
    for (labelId in goldenLabels) {
        ret.push(goldenLabels[labelId]);
    }
    return ret;
};

svl.formatRecordsToLabels = svl.formatRecordsToGoldenLabels;
