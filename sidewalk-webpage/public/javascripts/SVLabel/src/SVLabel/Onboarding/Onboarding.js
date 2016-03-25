function Onboarding ($, params) {
    var self = { className : 'Onboarding' },
        properties = {},
        status = {
            state: 0
        },
        states = [
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
                "annocations": []
            },
            {
                "action": {
                    "action" : "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 10280,
                    "imageY": -525,
                    "tolerance": 300
                },
                "message": {
                    "message": 'Good! Now, <span class="bold">click the curb ramp in the image to label it.',
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
                    "message": 'Good! <span class="bold">Click the "Curb Ramp" button on the menu</span> to label another curb ramp.!',
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
        var action, message, callback, state = getState(stateIndex);
        if ("action" in state) {
            var $target, labelType, subcategory;
            if (state.action.action == "SelectLabelType") {
                // Blink the given label type and nudge them to click one of the buttons in the ribbon menu.
                // Move on to the next state if they click the button.
                labelType = state.action.labelType;

                if ("ribbon" in svl) {
                    svl.ribbon.startBlinking(labelType);
                }

                if (subcategory) {
                    $target = $(svl.ui.ribbonMenu.subcategoryHolder.find('[val="' + subcategory + '"]').get(0));
                } else {
                    $target = $(svl.ui.ribbonMenu.holder.find('[val="' + labelType + '"]').get(0));
                }

                callback = function () {
                    svl.ribbon.stopBlinking();
                    $target.off("click", callback); // Remove the handler
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
                        next();
                    }
                };
                $target.on("click", callback);
            } else if (state.action.action == "AdjustHeadingAngle") {
                // Tell them to remove a label.
                callback = function () {
                    var pov = svl.getPOV();
                    console.log(pov, (360 + state.action.heading - pov.heading) % 360);
                    if ((360 + state.action.heading - pov.heading) % 360 < state.action.tolerance) {
                        google.maps.event.removeListener($target);
                        next();
                    }
                };
                // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
                $target = google.maps.event.addListener(svl.panorama, "pov_changed", callback);
            }
        }

        if ("message" in state && state.message) {
            showMessage(state.message.message, "top-right", state.message.parameters);
        }
    }

    self.next = next;

    _init(params);

    return self;
}