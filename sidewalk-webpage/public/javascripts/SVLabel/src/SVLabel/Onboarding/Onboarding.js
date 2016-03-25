function Onboarding ($, params) {
    var self = { className : 'Onboarding' },
        ctx, canvasWidth = 720, canvasHeight = 480,
        properties = {},
        status = {
            state: 0
        },
        states = [
            {
                "action": {
                    "action": "Initialize",
                    "heading": 280,
                    "pitch": -6,
                    "zoom": 1
                },
                "message": null,
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null
            },
            {
                "action": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'In this Street View image, we can see a curb ramp. Let’s <span class="bold">click the "Curb Ramp" button</span> to label it!',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "x": 10280,
                        "y": -385,
                        "length": 50,
                        "angle": 30,
                        "text": null
                    }
                ]
            },
            {
                "action": {
                    "action" : "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 10280,
                    "imageY": -425,
                    "tolerance": 300
                },
                "message": {
                    "message": 'Good! Now, <span class="bold">click the curb ramp in the image to label it.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "x": 10280,
                        "y": -385,
                        "length": 50,
                        "angle": 30,
                        "text": null
                    }
                ]
            },
            {
                "action": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'On this context menu, <span class="bold">you can rate the quality of the curb ramp, ' +
                    'where 1 is passable and 5 is not passable for a wheelchair user.</span> This is a large curb ramp ' +
                    'and it is not degraded (e.g., cracked), so <span class="bold">let’s rate it as 1, passable.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null
            },
            {
                "action": {
                    "action": "AdjustHeadingAngle",
                    "heading": 230,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Great! Let’s adjust the view to look at another corner of the intersection on the left. ' +
                    '<span class="bold">Grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null
            },
            {
                "action": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'Here, we see a curb ramp. Let’s label it. First <span class="bold">click the "Curb Ramp" button.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": []
            },
            {
                "action": {
                    "action" : "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 8720,
                    "imageY": -549,
                    "tolerance": 300
                },
                "message": {
                    "message": 'Now, <span class="bold">click on the curb ramp to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": []
            },
            {
                "action": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": null
                },
                "message": {
                    "message": 'Good! <span class="bold">Let’s rate the quality of the curb ramp.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null
            },
            {
                "action": {
                    "action": "SelectLabelType",
                    "labelType": "NoCurbRamp"
                },
                "message": {
                    "message": 'There is no curb ramp at the end of this cross walk. Let’s <span class="bold">click the “Missing Curb Ramp” button to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": []
            },
            {
                "action": {
                    "action" : "LabelAccessibilityAttribute",
                    "labelType": "NoCurbRamp",
                    "imageX": 8237,
                    "imageY": -600,
                    "tolerance": 300
                },
                "message": {
                    "message": '<span class="bold">Click the end of the crosswalk to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": []
            },
            {
                "action": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Let’s rate the severity of the problem. Since there is one curb ramp right next to the missing curb ramp, the problem is less severe. <span class="bold">Let’s rate it as 1.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null
            },
            {
                "action": {
                    "action": "AdjustHeadingAngle",
                    "heading": 75,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Great! Let’s adjust the view to look at another corner on the left. <span class="bold">Grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null
            },
            {
                "action": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'Good! Here, we can see two curb ramps. <span class="bold">Click the "Curb Ramp" button on the menu</span> to label them both!',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": []
            },
            {
                "action": {
                    "action" : "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 2170,
                    "imageY": -900,
                    "tolerance": 300
                },
                "message": {
                    "message": 'Now, <span class="bold">click on the curb ramp to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": []
            },
            {
                "action": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": null
                },
                "message": {
                    "message": '<span class="bold">Let’s rate the quality of the curb ramp.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null
            },
            {
                "action": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'Good! <span class="bold">Click the "Curb Ramp" button on the menu</span> to label another curb ramp!',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": []
            },
            {
                "action": {
                    "action" : "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 3218,
                    "imageY": -1203,
                    "tolerance": 300
                },
                "message": {
                    "message": 'Now, <span class="bold">click on the curb ramp to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": []
            },
            {
                "action": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": null
                },
                "message": {
                    "message": '<span class="bold">Let’s rate the quality of the curb ramp.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null
            },
            {
                "action": {
                    "action": "SelectLabelType",
                    "labelType": "Other",
                    "subcategory": "NoSidewalk"
                },
                "message": {
                    "message": 'Notice that the sidewalk is prematurely ending here. <span class="bold">Move the mouse cursor over the "Other" and click "No Sidewalk" to label it.</span>',
                    "position": "top-left",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": []
            },
            {
                "action": {
                    "action" : "LabelAccessibilityAttribute",
                    "labelType": "Other",
                    "subcategory": "NoSidewalk",
                    "imageX": 1996,
                    "imageY": -526,
                    "tolerance": 300
                },
                "message": {
                    "message": '<span class="bold">Click on the ground where the sidewalk is missing.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": []
            },
            {
                "action": {
                    "action": "AdjustHeadingAngle",
                    "heading": 17,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Great! Let’s adjust the view to look at another corner on the left. <span class="bold">Grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null
            },
            {
                "action": {
                    "action": "WalkTowards",
                    "panoId": "bdmGHJkiSgmO7_80SnbzXw",
                    "imageX": -341,
                    "tolerance": -703
                },
                "message": {
                    "message": 'It seems like there is a curb ramp at the end of the cross walk, but it’s hard to see ' +
                    'because the image is washed out. <span class="bold">Let’s double click on the road to take ' +
                    'a step and see it from another angle.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null
            },
            {
                "action": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'Good! There is a curb ramp. Click the "Curb Ramp" button on the menu to label it!',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"bdmGHJkiSgmO7_80SnbzXw",
                "annotations": []
            },
            {
                "action": {
                    "action" : "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 3218,
                    "imageY": -1203,
                    "tolerance": 300
                },
                "message": {
                    "message": '<span class="bold">Click on the curb ramp to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"bdmGHJkiSgmO7_80SnbzXw",
                "annotations": []
            },
            {
                "action": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": null
                },
                "message": {
                    "message": '<span class="bold">Let’s rate the quality of the curb ramp.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"bdmGHJkiSgmO7_80SnbzXw",
                "annotations": null
            },
            {
                "action": {
                    "action": "AdjustHeadingAngle",
                    "heading": 267,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Great! Let’s adjust the view to look at another corner on the left. <span class="bold">Grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"bdmGHJkiSgmO7_80SnbzXw",
                "annotations": null
            },
            {
                "action": {
                    "action": "Instruction"
                },
                "message": {
                    "message": 'Great! You have already labeled the curb ramp at this corner from the previous angle, ' +
                    'so <span class="bold">you do not need to label it again!</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId":"bdmGHJkiSgmO7_80SnbzXw",
                "annotations": null
            },
            // Done till here


            {
                "action":"LabelingCanvas_FinishLabeling",
                "panoId":"bdmGHJkiSgmO7_80SnbzXw",
                "labelType":"CurbRamp",
                "imageX":1301.4,
                "imageY":-756.1444444444445
            }
        ];

    function _init (params) {
        // svl.compass.hideMessage();
        svl.ui.onboarding.holder.css("visibility", "visible");
        ctx = svl.ui.onboarding.canvas.get(0).getContext('2d');
        visit(0);
    }

    function getState(stateIndex) {
        return states[stateIndex];
    }


    function hideMessage () {

    }

    function next () {
        status.state += 1;
        visit(status.state);
    }

    function showMessage (message, position, parameters) {
        if (!position) {
            position = "top-right";
        }

        svl.ui.onboarding.messageHolder.css("visibility", "visible");

        if (position == "top-left") {
            svl.ui.onboarding.messageHolder.css({
                top: 0,
                left: 0,
                width: 300
            });
        } else {
            svl.ui.onboarding.messageHolder.css({
                top: 0,
                right: 0,
                width: 300
            });
        }
        svl.ui.onboarding.background.css("visibility", "hidden");

        if (parameters) {
            if ("width" in parameters) {
                svl.ui.onboarding.messageHolder.css("width", parameters.width);
            }
            if ("background" in parameter && parameter.background) {
                svl.ui.onboarding.background.css("visibility", "visible");
            }
        }

        svl.ui.onboarding.messageHolder.html(message);
    }



    function visit(stateIndex) {
        var action, message, callback, state = getState(stateIndex), annotationListener;
        clear(); // Clear what ever was rendered on the onboarding-canvas in the previous state.

        if ("message" in state && state.message) {
            showMessage(state.message.message, state.message.position, state.message.parameters);
        }

        if ("annotations" in state && state.annotations) {
            var i, len, coordinate, imX, imY, lineLength, lineAngle, x1, x2, y1, y2, currentPOV = svl.getPOV(), drawArrows;
            len = state.annotations.length;

            drawArrows = function () {
                clear();
                for (i = 0; i < len; i++) {
                    imX = state.annotations[i].x;
                    imY = state.annotations[i].y;
                    currentPOV = svl.getPOV();
                    coordinate = svl.misc.imageCoordinateToCanvasCoordinate(imX, imY, currentPOV);
                    lineLength = state.annotations[i].length;
                    lineAngle = state.annotations[i].angle;
                    x2 = coordinate.x;
                    y2 = coordinate.y;
                    x1 = x2 - lineLength * Math.sin(svl.util.math.toRadians(lineAngle));
                    y1 = y2 - lineLength * Math.cos(svl.util.math.toRadians(lineAngle));
                    drawArrow(x1, y1, x2, y2);
                }
            };
            drawArrows();
            annotationListener = google.maps.event.addListener(svl.panorama, "pov_changed", drawArrows);
        }

        if ("action" in state) {
            var $target, labelType, subcategory;
            if (state.action.action == "Initialize") {
                // Set the initial pov.
                var pov = { heading: state.action.heading, pitch: state.action.pitch, zoom: state.action.zoom };

                callback = function () {
                    svl.panorama.setPov(pov);
                    svl.panorama.setPano(state.panoId);
                    google.maps.event.removeListener($target);
                    if (annotationListener) google.maps.event.removeListener(annotationListener);
                    next();
                };
                $target = google.maps.event.addListener(svl.panorama, "position_changed", callback);
            } else if (state.action.action == "SelectLabelType") {
                // Blink the given label type and nudge them to click one of the buttons in the ribbon menu.
                // Move on to the next state if they click the button.
                labelType = state.action.labelType;
                subcategory = "subcategory" in state.action ? state.action.subcategory : null;
                if ("ribbon" in svl) {
                    svl.ribbon.startBlinking(labelType, subcategory);
                }

                if (subcategory) {
                    $target = $(svl.ui.ribbonMenu.subcategoryHolder.find('[val="' + subcategory + '"]').get(0));
                } else {
                    $target = $(svl.ui.ribbonMenu.holder.find('[val="' + labelType + '"]').get(0));
                }

                callback = function () {
                    svl.ribbon.stopBlinking();
                    $target.off("click", callback); // Remove the handler
                    if (annotationListener) google.maps.event.removeListener(annotationListener);
                    next();
                };
                $target.on("click", callback);
            } else if (state.action.action == "LabelAccessibilityAttribute") {
                // Tell the user to label the target attribute.
                var imageX = state.action.imageX,
                    imageY = state.action.imageY,
                    tolerance = state.action.tolerance;
                labelType = state.action.labelType;
                $target = svl.ui.canvas.drawingLayer;

                callback = function (e) {
                    // Check if the point that the user clicked is close enough to the given ground truth point.
                    var clickCoordinate = mouseposition(e, this),
                        pov = svl.getPOV(),
                        canvasX = clickCoordinate.x,
                        canvasY = clickCoordinate.y,
                        imageCoordinate = svl.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov),
                        distance = (imageX - imageCoordinate.x) * (imageX - imageCoordinate.x) + (imageY - imageCoordinate.y) * (imageY - imageCoordinate.y);

                    if (distance < tolerance * tolerance) {
                        $target.off("click", callback);
                        if (annotationListener) google.maps.event.removeListener(annotationListener);
                        next();
                    }
                };
                $target.on("click", callback);
            } else if (state.action.action == "RateSeverity") {
                var severity = state.action.severity;
                $target = svl.ui.contextMenu.radioButtons;
                labelType = state.action.labelType;
                callback = function () {

                    if (!severity || severity == parseInt($(this).attr("value"), 10)) {
                        $target.off("click", callback);
                        if (annotationListener) google.maps.event.removeListener(annotationListener);
                        next();
                    }
                };
                $target.on("click", callback);
            } else if (state.action.action == "AdjustHeadingAngle") {
                // Tell them to remove a label.
                callback = function () {
                    var pov = svl.getPOV();
                    if ((360 + state.action.heading - pov.heading) % 360 < state.action.tolerance) {
                        google.maps.event.removeListener($target);
                        if (annotationListener) google.maps.event.removeListener(annotationListener);
                        next();
                    }
                };
                // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
                $target = google.maps.event.addListener(svl.panorama, "pov_changed", callback);
            } else if (state.action.action == "WalkTowards") {
                callback = function () {
                    var panoId = svl.getPanoId();
                    if (state.action.panoId == panoId) {
                        google.maps.event.removeListener($target);
                        if (annotationListener) google.maps.event.removeListener(annotationListener);
                        next();
                    }
                };
                // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
                $target = google.maps.event.addListener(svl.panorama, "pano_changed", callback);
            }
        }

    }

    function clear () {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        return this;
    }

    function drawArrow (x1, y1, x2, y2, param) {
        param = param || {};
        var lineWidth = 1,
            fillStyle = 'rgba(255,255,255,1)',
            lineCap = 'round',
            headSize = 5,
            arrowWidth = 3,
            strokeStyle  = 'rgba(96, 96, 96, 1)',
            dx, dy, theta;

        dx = x2 - x1;
        dy = y2 - y1;
        theta = Math.atan2(dy, dx);

        ctx.save();
        ctx.fillStyle = fillStyle;
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = lineCap;

        ctx.translate(x1, y1);
        ctx.beginPath();
        ctx.moveTo(arrowWidth * Math.sin(theta), - arrowWidth * Math.cos(theta));
        ctx.lineTo(dx + arrowWidth * Math.sin(theta), dy - arrowWidth * Math.cos(theta));

        // Draw an arrow head
        ctx.lineTo(dx + 3 * arrowWidth * Math.sin(theta), dy - 3 * arrowWidth * Math.cos(theta));
        ctx.lineTo(dx + 3 * arrowWidth * Math.cos(theta), dy + 3 * arrowWidth * Math.sin(theta));
        ctx.lineTo(dx - 3 * arrowWidth * Math.sin(theta), dy + 3 * arrowWidth * Math.cos(theta));

        ctx.lineTo(dx - arrowWidth * Math.sin(theta), dy + arrowWidth * Math.cos(theta));
        ctx.lineTo(- arrowWidth * Math.sin(theta), + arrowWidth * Math.cos(theta));

        ctx.fill();
        ctx.stroke();
        ctx.closePath();
        ctx.restore();
        return this;
    }

    self.clear = clear;
    self.drawArrow = drawArrow;
    self.next = next;

    _init(params);

    return self;
}