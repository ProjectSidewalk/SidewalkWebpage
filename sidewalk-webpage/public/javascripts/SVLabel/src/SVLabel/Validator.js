var svl = svl || {};

/**
 * Validator
 * @param param
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Validator (param, $) {
    var self = {
        'className' : 'Validator'
    };
    var properties = {
        onboarding: false
    };
    var status = {
        allLabelsHaveBeenValidated: false,
        disableAgreeButton: false,
        disableDisagreeButton: false,
        disableRadioButtons: false,
        menuBarMouseDown: false,
        radioCurrentLabelCheckState: 'ShowLabel',
        radioCurrentLabelHoverState: 'ShowLabel'
    };
    var mouse = {
        menuBarMouseDownX: undefined,
        menuBarMouseDownY: undefined,
        menuBarMouseUpX: undefined,
        menuBarMouseUpY: undefined,
        menuBarPrevX: undefined,
        menuBarPrevY: undefined
    };
    var currentLabel = undefined;
    var labels = [];

    var $divHolderValidation;
    var $divValidationMenuBar;
    var $divValidationDialogWindow;
    var $validationLabelMessage;
    var $btnAgree;
    var $btnDisagree;
    var $spansValidationCurrentLabeliVisibility;
    var $radioValidationCurrentLabelVisibility;
    var $spanNumCompletedTasks;
    var $spanNumTotalTasks;
    var $divProgressBarFiller;

    function currentLabelVisibilitySpanMousein (e) {
        // This is a mousein callback method for spans that hold ShowLabel/HideLabel radio buttons
        var $span = $(this);
        var radioValue = $span.attr("value"); // $span.find('input').attr('value');

        $span.css('background', 'rgba(230, 230, 230, 1)');
        status.radioCurrentLabelHoverState = radioValue;

        highlightCurrentLabel();
    }

    function currentLabelVisibilitySpanMouseout (e) {
        // This is a mouseout callback method for spans that hold ShowLabel/HideLabel radio buttons
        var $span = $(this);
        $span.css('background', 'transparent');
        status.radioCurrentLabelHoverState = 'ShowLabel';
        highlightCurrentLabel();
    }

    function currentLabelVisibilityRadioMousedown (e) {
        // This is a mousedown callback method for ShowLabel/HideLabel checkboxes.
        var radioValue = $(this).attr('value');
        status.radioCurrentLabelCheckState = radioValue;
        highlightCurrentLabel();
    }

    function getBoundingBox(povIn) {
        // This function takes
        var j;
        var len;
        var canvasCoords;
        var pov = povIn;
        var xMax = -1;
        var xMin = 1000000;
        var yMax = -1;
        var yMin = 1000000;

        // Check on points
        canvasCoords = getCanvasCoordinates(pov);
        len = canvasCoords.length;

        for (j = 0; j < len; j += 1) {
            var coord = canvasCoords[j];

            if (coord.x < xMin) {
                xMin = coord.x;
            }
            if (coord.x > xMax) {
                xMax = coord.x;
            }
            if (coord.y < yMin) {
                yMin = coord.y;
            }
            if (coord.y > yMax) {
                yMax = coord.y;
            }
        }

        return {
            x: xMin,
            y: yMin,
            width: xMax - xMin,
            height: yMax - yMin
        };
    }

    function getCanvasCoordinates (pov, imCoords) {
        // Get canvas coordinates of points that constitute the label.
        // param imCoords: a list of image coordinates, i.e., [{x: xVal, y: yVal}, ...]
        // var imCoords = getImageCoordinates();
        var i;
        var len = imCoords.length;
        var canvasCoord;
        var canvasCoords = [];

        var min = 10000000;
        var max = -1;

        for (i = 0; i < len; i += 1) {
            if (min > imCoords[i].x) {
                min = imCoords[i].x;
            }
            if (max < imCoords[i].x) {
                max = imCoords[i].x;
            }
        }

        // Note canvasWidthInGSVImage is approximately equals to the image width of GSV image that fits in one canvas view
        var canvasWidthInGSVImage = 3328;
        for (i = 0; i < len; i += 1) {
            if (pov.heading < 180) {
                if (max > svl.svImageWidth - canvasWidthInGSVImage) {
                    if (imCoords[i].x > canvasWidthInGSVImage) {
                        imCoords[i].x -= svl.svImageWidth;
                    }
                }
            } else {
                if (min < canvasWidthInGSVImage) {
                    if (imCoords[i].x < svl.svImageWidth - canvasWidthInGSVImage) {
                        imCoords[i].x += svl.svImageWidth;
                    }
                }
            }
            canvasCoord = svl.gsvImageCoordinate2CanvasCoordinate(imCoords[i].x, imCoords[i].y, pov);
            canvasCoords.push(canvasCoord);
        }

        return canvasCoords;
    }

    function getLabelBottom(label) {
        // This method gets the largest y-coordinate (i.e., closest to the bottom of the canvas) of label points
        //
        var i;
        var len = label.points.length;
        var pov = svl.getPOV();
//        {
//            heading: parseFloat(label.points[0].heading),
//            pitch: parseFloat(label.points[0].pitch),
//            zoom: parseFloat(label.points[0].zoom)
//        };

        // Format a label points.
        var point = undefined;
        var points = [];
        for (i = 0; i < len; i++) {
            point = {
                x: parseInt(label.points[i].svImageX),
                y: parseInt(label.points[i].svImageY)
            };
            points.push(point)
        }

        // Get the min
        var canvasCoordinates = getCanvasCoordinates(pov, points);

        var coord;
        var maxY = -1;
        for (i = 0; i < len; i++) {
            coord = canvasCoordinates[i];
            if (maxY < coord.y) {
                maxY = coord.y;
            }
        }
        return maxY;
    }

    function getLabelLeft(label) {
        // This method gets the smallest x-coordinate of label points
        //
        var i;
        var len = label.points.length;
        var pov = {
            heading: parseFloat(label.points[0].heading),
            pitch: parseFloat(label.points[0].pitch),
            zoom: parseFloat(label.points[0].zoom)
        };

        // Format a label points.
        var point = undefined;
        var points = [];
        for (i = 0; i < len; i++) {
            point = {
                x: parseInt(label.points[i].svImageX),
                y: parseInt(label.points[i].svImageY)
            };
            points.push(point)
        }

        // Get the min
        var canvasCoordinates = getCanvasCoordinates(pov, points);

        var coord;
        var minX = 1000000;
        for (i = 0; i < len; i++) {
            coord = canvasCoordinates[i];
            if (minX > coord.x) {
                minX = coord.x;
            }
        }
        return minX;
    }

    function getNextLabel () {
        // Get the next label that is not validated (i.e., label.validated == false)
        // This method returns false if all the labels have been validated.
        var i;
        var len = labels.length;
        var label;
        var allLabelsHaveBeenValidated = true;
        for (i = 0; i < len; i++) {
            label = labels[i];
            if (!label.validated) {
                allLabelsHaveBeenValidated = false;
                break;
            }
        }

        if (allLabelsHaveBeenValidated) {
            status.allLabelsHaveBeenValidated = allLabelsHaveBeenValidated;
            return false;
        } else {
            return label;
        }
    }

    function getNumTasksDone () {
        // Get number of tasks that are done.
        var i;
        var numTotalTasks = labels.length;
        var numTasksDone = 0;
        for (i = 0; i < numTotalTasks; i ++) {
            if (labels[i].validated) {
                numTasksDone += 1;
            }
        }
        return numTasksDone;
    }

    function hideDialogWindow () {
        // Hide the dialog box
        $divValidationDialogWindow.css('visibility', 'hidden');
    }

    function highlightCurrentLabel () {
        // Highlight the current label and dim the rest by changing the label properties
        if (!currentLabel) {
            throw oPublic.className + ': highlightCurrentLabel(): currentLabel is not set.';
        }
        var i;
        var j;
        var len;
        var canvasLabels;
        var canvasLabel;
        var canvasPath;
        var pathPoints;
        var pathPointsLen;

        if (svl.canvas) {
            var showLabel = undefined;
            canvasLabels = svl.canvas.getLabels();
            len = canvasLabels.length;

            // Decided whether currentLabel should be visible or not.
//            if (status.radioCurrentLabelHoverState) {
//                if (status.radioCurrentLabelHoverState === 'ShowLabel') {
//                    showLabel = true;
//                } else {
//                    showLabel = false;
//                }
//            } else {
//                if (status.radioCurrentLabelCheckState === 'ShowLabel') {
//                    showLabel = true;
//                } else {
//                    showLabel = false;
//                }
//            }
            if (status.radioCurrentLabelHoverState === 'ShowLabel') {
                showLabel = true;
            } else {
                showLabel = false;
            }

            for (i = 0; i < len; i ++) {
                canvasLabel = canvasLabels[i];
                canvasPath = canvasLabel.getPath(true); // Get a reference to the currentPath
                if (currentLabel.meta.labelId === canvasLabels[i].getProperty("labelId") &&
                    showLabel) {
                    // Highlight the label
                    // Change the fill and stroke color of a path to the original color (green and white)
                    // canvasPath.resetFillStyle();
                    // canvasPath.resetStrokeStyle();
                    canvasLabel.setVisibility('visible');

                    // Change the fill and stroke color of points to the original color
                    pathPoints = canvasPath.points;
                    pathPointsLen = pathPoints.length;
                    for (j = 0; j < pathPointsLen; j++) {
                        pathPoints[j].resetFillStyle();
                        pathPoints[j].resetStrokeStyle();
                    }
                } else {
                    // Dim the label
                    // Make fill and stroke of a path invisible
                    // canvasPath.setFillStyle('rgba(255,255,255,0)');
                    // canvasPath.setStrokeStyle('rgba(255,255,255,0)');
                    canvasLabel.setVisibility('hidden');

                    // Change the fill and stroke color of points invisible
                    pathPoints = canvasPath.points;
                    pathPointsLen = pathPoints.length;
                    for (j = 0; j < pathPointsLen; j++) {
                        pathPoints[j].setFillStyle('rgba(255,255,255,0)');
                        pathPoints[j].setStrokeStyle('rgba(255,255,255,0)');
                    }
                }

            }
            svl.canvas.clear();
            svl.canvas.render2();
        } else {
            throw oPublic.className + ': highlightCurrentLabel(): canvas is not defined.';
        }
    }

    function init(param) {
        properties.previewMode = param.previewMode;

        $divHolderValidation = $(param.domIds.holder);
        $divValidationDialogWindow = $("#ValidationDialogWindow");
        $divValidationMenuBar = $("#ValidationDialogWindowMenuBar");
        $validationLabelMessage = $("#ValidationLabelValue");
        $btnAgree = $("#ValidationButtonAgree");
        $btnDisagree =$("#ValidationButtonDisagree");
        $spansValidationCurrentLabeliVisibility = $(".SpanValidationCurrentLabeliVisibility");
        $radioValidationCurrentLabelVisibility = $(".RadioValidationCurrentLabelVisibility");

        $spanNumCompletedTasks = $("#NumCompletedTasks");
        $spanNumTotalTasks = $("#NumTotalTasks");
        $divProgressBarFiller = $("#ProgressBarFiller");

        // Attach listeners
        $divValidationMenuBar.on({
            mousedown: validationMenuBarMousedown,
            mouseleave: validationMenuBarMouseleave,
            mousemove: validationMenuBarMousemove,
            mouseup: validationMenuBarMouseup
        });

        $spansValidationCurrentLabeliVisibility.hover(currentLabelVisibilitySpanMousein, currentLabelVisibilitySpanMouseout);
        $radioValidationCurrentLabelVisibility.on('mousedown', currentLabelVisibilityRadioMousedown);

        $btnAgree.on('click', validationButtonAgreeClick);
        $btnDisagree.on('click', validationButtonDisagreeClick);

        hideDialogWindow();
        updateProgress();

        svl.ui.googleMaps.holder.css('visibility', 'hidden');
        // $("#google-maps-holder").css('visibility', 'hidden');
    }

    function showDialogWindow (timelapse) {
        // This method shows a dialog window to ask a user whether a current label is valid/invalid label.
        // If timelapse is specified, wait for timelapse milli-seconds to show the window.
        if (typeof(timelapse) !== "number") {
            console.error(oPublic.className, 'A parameter of showDialogWindow() should be in milli-seconds (number).');
            timelapse = undefined;
        }

        if (currentLabel) {
            var maxY = getLabelBottom(currentLabel); // Get the largest y-coordinate (i.e., closest to the bottom of the canvas) of label points
            var minX = getLabelLeft(currentLabel); // Get the smallest x-coordinate
            var message;

            if (currentLabel.meta.labelType === 'CurbRamp') {
                message = "We believe the green box (label) is correctly placed on a curb ramp in this image. Do you agree?";
                // message = 'We believe the <span class="bold">green box is placed on a curb ramp</span> in this image.';
            } else {
                message = 'We believe <span class="bold">there should be a curb ramp</span> under the highlighted area.';
            }
            $validationLabelMessage.html(message);
            // console.log(currentLabel.meta.labelType);

            if (timelapse) {
            // if (false) {
                setTimeout(function () {
                    // Recalculate. Hm, then the previous calculation is redundant.
                    maxY = getLabelBottom(currentLabel);
                    minX = getLabelLeft(currentLabel);
                    $divValidationDialogWindow.css({
                        left: minX,
                        top: maxY + 20,
                        visibility: 'visible'
                    });
                }, timelapse);

            } else {
                $divValidationDialogWindow.css({
                    left: minX,
                    top: maxY + 20,
                    visibility: 'visible'
                });
            }
        }
    }

    function updateProgress () {
        // This method updates the number of completed tasks and the progress bar in the interface.
        var numTotalTasks = labels.length;
        var numTasksDone = 0;
        numTasksDone = getNumTasksDone();

        $spanNumCompletedTasks.text(numTasksDone);
        $spanNumTotalTasks.text(numTotalTasks);

        var widthRatio = numTasksDone / numTotalTasks;
        var widthPercentage = parseInt(widthRatio * 100, 10) + '%'

        var r;
        var g;
        var rgbValue;
        if (widthRatio < 0.5) {
            r = 255;
            g = parseInt(255 * widthRatio * 2);
        } else {
            r = parseInt(255 * (1 - widthRatio) * 2);
            g = 255;
        }
        rgbValue = 'rgb(' + 4 + ',' + g + ', 0)';

        $divProgressBarFiller.css({
            background: rgbValue,
            width: widthPercentage
        });
    }

    function validationButtonAgreeClick () {
        // A callback function for click on an Agree button
        if (!currentLabel) {
            // if a current label is not set, set one.
            currentLabel = getNextLabel();
            if (!currentLabel) {
                // Todo. Navigate to submit validations
            }
        }
        currentLabel.validated = true;
        currentLabel.validationLabel = 'Agree';


        // svl.validatorForm.submit(); // Debug

        oPublic.validateNext();
        updateProgress();

        //
        // Return when everything is verified
        if (properties.onboarding) {
            return false;
        }
        if (getNumTasksDone() < labels.length) {
            return false;
        } else {
            if (properties.previewMode) {
                // Not a preview mode
                window.location.reload();
                return false;
            } else {
                // Return if it is not a preview mode.
                return true;
            }
        }
    }

    function validationButtonDisagreeClick () {
        // A callback function for click on a Disagree button
        if (!currentLabel) {
            // if a current label is not set, set one...
            currentLabel = getNextLabel();
            if (!currentLabel) {
                // Todo. Navigate to submit validations
            }
        }
        currentLabel.validated = true;
        currentLabel.validationLabel = 'Disagree';
        oPublic.validateNext();
        updateProgress();

        //
        // Return when everything is verified
        if (properties.onboarding) {
            return false;
        }
        if (getNumTasksDone() < labels.length) {
            return false;
        } else {
            if (properties.previewMode) {
                // Not a preview mode
                window.location.reload();
                return false;
            } else {
                // Return if it is not a preview mode.
                return true;
            }
        }
    }

    function validationMenuBarMousedown (e) {
        // A callback function for mousedown on a menu bar
        var m = mouseposition(e, 'body');

        status.menuBarMouseDown = true;
        mouse.menuBarPrevX = m.x;
        mouse.menuBarPrevY = m.y;
        mouse.menuBarMouseDownX = m.x;
        mouse.menuBarMouseDownY = m.y;
    }

    function validationMenuBarMouseleave (e) {
        // A callback function for mouseleave on a menu bar
        var m = mouseposition(e, 'body');

        status.menuBarMouseDown = false;
        mouse.menuBarMouseUpX = m.x;
        mouse.menuBarMouseUpY = m.y;
    }

    function validationMenuBarMousemove (e) {
        // A callback function for mousemove on a menu bar
        var m = mouseposition(e, 'body');
        if (status.menuBarMouseDown) {
            // Move around the validation dialog window if mouse is held down on the menu bar

            if (m && m.x && m.y && mouse.menuBarPrevX && mouse.menuBarPrevX) {
                var dx = m.x - mouse.menuBarPrevX;
                var dy = m.y - mouse.menuBarPrevY;

                // Get css top/left values as number
                // http://stackoverflow.com/questions/395163/get-css-top-value-as-number-not-as-string
                var currX = parseInt($divValidationDialogWindow.css('left'), 10);
                var currY = parseInt($divValidationDialogWindow.css('top'), 10);

                $divValidationDialogWindow.css({
                    left: currX + dx,
                    top: currY + dy
                });
            }
        }

        mouse.menuBarPrevX = m.x;
        mouse.menuBarPrevY = m.y;
    }

    function validationMenuBarMouseup (e) {
        // A callback function for mouseup on a menu bar
        var m = mouseposition(e, 'body');

        status.menuBarMouseDown = false;
        mouse.menuBarMouseUpX = m.x;
        mouse.menuBarMouseUpY = m.y;
    }

    self.disableAgreeButton = function () {
        // This method disables the Agree button.
        status.disableAgreeButton = true;
        $btnAgree.css('opacity', '0.5');
        $btnAgree.attr('disabled', true);
        return this;
    };

    self.disableDisagreeButton = function () {
        // This method disables the Disagree button.
        status.disableDisagreeButton = true;
        $btnDisagree.css('opacity', '0.5');
        $btnDisagree.attr('disabled', true);
        return this;
    };

    self.disableRadioButtons = function () {
        // This method disables "Show label" and "Hide label" radio buttons
        status.disableRadioButtons = true;
        $radioValidationCurrentLabelVisibility.each(function (i, v) {
            $(v).attr('disabled', true);
        });
        return this;
    };

    self.enableAgreeButton = function () {
        // This method enables the Agree button.
        status.disableAgreeButton = false;
        $btnAgree.css('opacity', '1');
        $btnAgree.attr('disabled', false);
        return this;
    };

    self.enableDisagreeButton = function () {
        // This method enables the Disagree button.
        status.disableDisagreeButton = false;
        $btnDisagree.css('opacity', '1');
        $btnDisagree.attr('disabled', false);
    };

    self.enableRadioButtons = function () {
        // This method enables "Show label" and "Hide label" radio buttons
        status.disableRadioButtons = false;
        $radioValidationCurrentLabelVisibility.each(function (i, v) {
            $(v).attr('disabled', false);
        });
        return;
    };

    self.getLabels = function () {
        // This method returns validatorLabels
        return $.extend(true, [], labels);
    };

    self.hideDialogWindow = function () {
        // This method hides a dialog window
        hideDialogWindow();
        return this;
    };

    self.insertLabels = function (labelPoints) {
        // This method takes a label data (i.e., a set of point coordinates, label types, etc) and
        // and insert it into the labels array so the Canvas will render it
        var labelDescriptions = svl.misc.getLabelDescriptions();

        var param = {};
        param.canvasWidth = svl.canvasWidth;
        param.canvasHeight = svl.canvasHeight;
        param.canvasDistortionAlphaX = svl.alpha_x;
        param.canvasDistortionAlphaY = svl.alpha_y;
        param.labelId = labelPoints[0].LabelId;
        param.labelType = labelPoints[0].LabelType;
        param.labelDescription = labelDescriptions[param.labelType].text;
        param.panoId = labelPoints[0].LabelGSVPanoramaId;
        param.panoramaLat = labelPoints[0].Lat;
        param.panoramaLng = labelPoints[0].Lng;
        param.panoramaHeading = labelPoints[0].heading;
        param.panoramaPitch = labelPoints[0].pitch;
        param.panoramaZoom = labelPoints[0].zoom;
        param.svImageWidth = svl.svImageWidth;
        param.svImageHeight = svl.svImageHeight;
        param.svMode = 'html4';

        var label = {
            meta: param,
            points: labelPoints,
            validated: false,
            validationLabel: undefined
        };

        labels.push(label);

        updateProgress();
    };

    self.setDialogWindowBorderWidth = function (width) {
        // This method sets the border width of the dialog window.
        $divValidationDialogWindow.css('border-width', width);
        return this;
    };

    self.setDialogWindowBorderColor = function (color) {
        // This method sets the border color of the dialog window.
        $divValidationDialogWindow.css('border-color', color);
        return this;
    };

    self.showDialogWindow = function (timelapse) {
        // This method shows a dialog window
        showDialogWindow(timelapse);
        return this;
    };

    self.sortLabels = function () {
        // This method sorts the labels by it's heading angle.
        // Sorting an array of objects
        // http://stackoverflow.com/questions/1129216/sorting-objects-in-an-array-by-a-field-value-in-javascript
        function compare (a, b) {
            if (parseInt(a.points[0].svImageX) < parseInt(b.points[0].svImageX)) {
                return -1;
            }
            if (parseInt(a.points[0].svImageX) > parseInt(b.points[0].svImageX)) {
                return 1
            }
            return 0
        }

        labels.sort(compare);
        return this;
    };

    self.validateNext = function (timelapse) {
        // This method changes the heading angle so the next unvalidated label will be centered
        // on the canvas.
        // 0. Wait and see whether panorama is ready
        // 1. Check if svl.map and svl.canvas exist
        // 2. Select the target label
        // 3. Adjust the SV heading angle and pitch angle so the target label will be centered.

        if (!('map' in svl)) {
            throw self.className + ': Map is not defined.';
        }
        if (!('canvas' in svl)) {
            throw self.className + ': Canvas is not defined.';
        }

        currentLabel = getNextLabel();
        if (currentLabel) {
            var pov = {
                heading: parseFloat(currentLabel.meta.panoramaHeading),
                pitch: parseFloat(currentLabel.meta.panoramaPitch),
                zoom: parseFloat(currentLabel.meta.zoom)
            };

            hideDialogWindow();

            if (typeof timelapse === "number" && timelapse >= 0) {
                var changePOVDuration = 500;
                svl.map.setPov(pov, changePOVDuration);
                highlightCurrentLabel();
                showDialogWindow(changePOVDuration);
            } else {
                svl.map.setPov(pov, 500);
                highlightCurrentLabel();
                showDialogWindow(500);
            }

        } else {
            // Todo. Navigate a user to submit
            hideDialogWindow();

            if (properties.onboarding) {
                return false;
            }
            svl.validatorForm.submit();
        }

        return this;
    };

    self.setOnboarding = function (val) {
        properties.onboarding = val;
    };

    init(param);

    return self;
}
