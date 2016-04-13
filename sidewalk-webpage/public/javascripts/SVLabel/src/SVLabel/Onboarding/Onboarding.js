function Onboarding ($, params) {
    var self = { className : 'Onboarding' },
        ctx, canvasWidth = 720, canvasHeight = 480,
        properties = {},
        status = {
            state: 0,
            isOnboarding: true
        },
        states = {
            "initialize": {
                "properties": {
                    "action": "Introduction",
                    "heading": 280,
                    "pitch": -6,
                    "zoom": 1,
                    "lat": 38.94042608,
                    "lng": -77.06766133
                },
                "message": {
                    "message": function () {
                            return document.getElementById("onboarding-initial-instruction").innerHTML;
                        },
                    "position": "center",
                    "width": 1000,
                    "top": -50,
                    "padding": "100px 10px 100px 10px",
                    "left": -70,
                    "background": true
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    return this.getAttribute("value") == "OK" ? "select-label-type-1" : null;
                }
            },
            "select-label-type-1": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'In this Street View image, we can see a curb ramp. Let’s <span class="bold">click the "Curb Ramp" button</span> to label it!',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 10280,
                        "y": -385,
                        "length": 50,
                        "angle": 0,
                        "text": null
                    }
                ],
                "transition": "label-attribute-1"
            },
            "label-attribute-1": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
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
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 10280,
                        "y": -385,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": "rate-attribute-1"
            },
            "rate-attribute-1": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'On this context menu, you can rate the quality of the curb ramp, ' +
                    'where 1 is passable and 5 is not passable for a wheelchair user.</span> ' +
                    '<span class="bold">Let’s rate it as 1, passable.<br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "adjust-heading-angle-1" : "redo-rate-attribute-1"
                }
            },
            "redo-rate-attribute-1": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Uh-oh, you should rate this curb ramp as 1, passable. ' +
                    '<span class="bold">Let\s click "1" to set its quality.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "adjust-heading-angle-1" : "redo-rate-attribute-1"
                }
            },
            "adjust-heading-angle-1": {
                "properties": {
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
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": "select-label-type-2"
            },
            "select-label-type-2": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'Here, we see a curb ramp. Let’s label it. First <span class="bold">click the "Curb Ramp" button.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 8550,
                        "y": -400,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": null
                    }
                ],
                "transition": "label-attribute-2"
            },
            "label-attribute-2": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
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
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 8550,
                        "y": -400,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": "rate-severity-2"
            },
            "rate-severity-2": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Good! <span class="bold">Let’s rate the quality of the curb ramp.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-3" : "redo-rate-attribute-2"
                }
            },
            "redo-rate-attribute-2": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Uh-oh, you should rate this curb ramp as 1, passable. ' +
                    '<span class="bold">Let\s click "1" to set its quality.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-3" : "redo-rate-attribute-2"
                }
            },
            "select-label-type-3": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "NoCurbRamp"
                },
                "message": {
                    "message": 'There is no curb ramp at the end of this crosswalk. Let’s <span class="bold">click the “Missing Curb Ramp” button to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 8300,
                        "y": -500,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": null
                    }
                ],
                "transition": "label-attribute-3"
            },
            "label-attribute-3": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
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
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 8300,
                        "y": -500,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": "rate-severity-3"
            },
            "rate-severity-3": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "NoCurbRamp",
                    "severity": 3
                },
                "message": {
                    "message": 'Since there is one curb ramp right next to the ' +
                    'missing curb ramp, the problem is less severe. <span class="bold">Let’s rate it as 3.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as 3, a slightly severe problem">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 3 ? "adjust-heading-angle-2" : "redo-rate-attribute-3"
                }
            },
            "redo-rate-attribute-3": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "NoCurbRamp",
                    "severity": 3
                },
                "message": {
                    "message": 'Hmm, this is a slightly severe problem. ' +
                    '<span class="bold">Let\s click "3" to change the severity of the missing curb ramp.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as 3, a slightly severe problem">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 3 ? "adjust-heading-angle-2" : "redo-rate-attribute-3"
                }
            },
            "adjust-heading-angle-2": {
                "properties": {
                    "action": "AdjustHeadingAngle",
                    "heading": 75,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Great! Let’s adjust the view to look at another corner on the left. <span class="bold">Grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": "select-label-type-4"
            },
            "select-label-type-4": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'Good! Here, we can see two curb ramps. <span class="bold">Click the "Curb Ramp" button on the menu</span> to label them both!',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 2170,
                        "y": -650,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    },
                    {
                        "type": "arrow",
                        "x": 3218,
                        "y": -900,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    }
                ],
                "transition": "label-attribute-4"
            },
            "label-attribute-4": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
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
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 2170,
                        "y": -650,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": "rate-severity-4"
            },
            "rate-severity-4": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": null
                },
                "message": {
                    "message": '<span class="bold">Let’s rate the quality of the curb ramp.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-5" : "redo-rate-attribute-4";
                }
            },
            "redo-rate-attribute-4": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Hmm, you should rate this curb ramp as 1, passable. ' +
                    '<span class="bold">Let\s click "1" to change its rating.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-5" : "redo-rate-attribute-4";
                }
            },
            "select-label-type-5": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'Good! <span class="bold">Click the "Curb Ramp" button on the menu</span> to label another curb ramp!',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 3218,
                        "y": -900,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    }
                ],
                "transition": "label-attribute-5"
            },
            "label-attribute-5": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
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
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 3218,
                        "y": -900,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": "rate-severity-5"
            },
            "rate-severity-5": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": null
                },
                "message": {
                    "message": '<span class="bold">Let’s rate the quality of the curb ramp.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-6" : "redo-rate-attribute-5";
                }
            },
            "redo-rate-attribute-5": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Hmm, you should rate this curb ramp as 1, passable. ' +
                    '<span class="bold">Let\s click "1" to change its rating.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-6" : "redo-rate-attribute-5";
                }
            },
            "select-label-type-6": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "Other",
                    "subcategory": "NoSidewalk"
                },
                "message": {
                    "message": 'Notice that the sidewalk is prematurely ending here. <span class="bold">Move the mouse cursor over the "Other" and click "No Sidewalk" to label it.</span>',
                    "position": "top-left",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 1966,
                        "y": -500,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    }
                ],
                "transition": "label-attribute-6"
            },
            "label-attribute-6": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
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
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 1966,
                        "y": -500,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": "adjust-heading-angle-3"
            },
            "adjust-heading-angle-3": {
                "properties": {
                    "action": "AdjustHeadingAngle",
                    "heading": 17,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Great! Let’s adjust the view to look at another corner on the left. <span class="bold">Grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": "walk-1"
            },
            "walk-1": {
                "properties": {
                    "action": "WalkTowards",
                    "panoId": "9xq0EwrjxGwQqNmzNaQTNA"
                },
                "message": {
                    "message": 'It seems like there is a curb ramp at the end of the crosswalk, but it’s hard to see ' +
                    'because the image is washed out. <span class="bold">Let’s double click on the road to take ' +
                    'a step and see it from another angle.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 700,
                        "y": -400,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    },
                    {
                        "type": "double-click",
                        "x": -341,
                        "y": -703,
                        "width": 100
                    }
                ],
                "transition": "select-label-type-7"
            },
            "select-label-type-7": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'Good! There is a curb ramp. <span class="bold">Click the "Curb Ramp" button on the menu to label it!</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 1500,
                        "y": -650,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    }
                ],
                "transition": "label-attribute-7"
            },
            "label-attribute-7": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 1492,
                    "imageY": -783,
                    "tolerance": 300
                },
                "message": {
                    "message": '<span class="bold">Click on the curb ramp to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 1500,
                        "y": -650,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": "rate-severity-7"
            },
            "rate-severity-7": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": null
                },
                "message": {
                    "message": '<span class="bold">Let’s rate the quality of the curb ramp.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "adjust-heading-angle-4" : "redo-rate-attribute-7";
                }
            },
            "redo-rate-attribute-7": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Hmm, you should rate this curb ramp as 1, passable. ' +
                    '<span class="bold">Let\s click "1" to change its rating.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "adjust-heading-angle-4" : "redo-rate-attribute-7";
                }
            },
            "adjust-heading-angle-4": {
                "properties": {
                    "action": "AdjustHeadingAngle",
                    "heading": 267,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Great! Let’s adjust the view to look at another corner on the left. <span class="bold">Grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": "instruction-1"
            },
            "instruction-1": {
                "properties": {
                    "action": "Instruction",
                    "blinks": null
                },
                "message": {
                    "message": 'Great! You have already labeled the curb ramp at this corner from the previous angle, ' +
                    'so <span class="bold">you do not need to label it again!</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    svl.compass.showMessage();
                    return "instruction-2";
                }
            },
            "instruction-2": {
                "properties": {
                    "action": "Instruction",
                    "blinks": ["google-maps", "compass"]
                },
                "message": {
                    "message": 'From here on, we\'ll guide you which way to walk and with the navigation message ' +
                    '(<img src="' + svl.rootDirectory + "img/onboarding/compass.png" + '" width="80px" alt="Navigation message: walk straight">) ' +
                    'and the red line on the map.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": "instruction-3"
            },
            "instruction-3": {
                "properties": {
                    "action": "Instruction",
                    "blinks": ["status-field"]
                },
                "message": {
                    "message": 'Your progress will be tracked and shown on the right side of the interface.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": "instruction-4"
            },
            "instruction-4": {
                "properties": {
                    "action": "Instruction",
                    "blinks": ["zoom", "action-stack"]
                },
                "message": {
                    "message": 'Other interface features include: <br>' +
                    '<span class="bold">Zoom In/Out:</span> Zoom in or out the Street View image<br> ' +
                    '<span class="bold">Undo/Redo:</span> Undo or redo the labeling',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": "instruction-5"
            },
            "instruction-5": {
                "properties": {
                    "action": "Instruction",
                    "blinks": ["sound", "jump", "feedback"]
                },
                "message": {
                    "message": 'Other interface features include: <br>' +
                    '<span class="bold">Sound:</span> Turn on/off the sound effects <br> ' +
                    '<span class="bold">Jump:</span> Click if you want to audit a different street <br>' +
                    '<span class="bold">Feedback:</span> Provide comments',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": "outro"
            },
            "outro": {
                "properties": {
                    "action": "Instruction",
                    "heading": 280,
                    "pitch": -6,
                    "zoom": 1
                },
                "message": {
                    "message": function () {
                        return document.getElementById("onboarding-outro").innerHTML;
                    },
                    "position": "center",
                    "width": 1000,
                    "top": -10,
                    "padding": "100px 10px 100px 10px",
                    "left": -70,
                    "background": true
                },
                "okButton": false,
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": null
            }
            // Done till here

        };

    function _init () {
        status.isOnboarding = true;
        svl.ui.onboarding.holder.css("visibility", "visible");
        svl.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svl.compass.hideMessage();
        ctx = svl.ui.onboarding.canvas.get(0).getContext('2d');
        status.state = getState("initialize");
        visit(status.state);

        initializeHandAnimation();
    }

    /**
     * Clear the onboarding canvas
     * @returns {clear}
     */
    function clear () {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        return this;
    }

    /**
     * Draw a double click icon on the onboarding canvas
     * @param x {number} X coordinate
     * @param y {number} Y coordiante
     * @returns {drawDoubleClickIcon}
     */
    function drawDoubleClickIcon (x, y) {
        // https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage
        var image = document.getElementById("double-click-icon");
        ctx.save();
        ctx.drawImage(image, x - 50, y - 50, 100, 100);
        ctx.restore();
        return this;
    }

    /**
     * Draw an arrow on the onboarding canvas
     * @param x1 {number} Starting x coordinate
     * @param y1 {number} Starting y coordinate
     * @param x2 {number} Ending x coordinate
     * @param y2 {number} Ending y coordinate
     * @param parameters {object} parameters
     * @returns {drawArrow}
     */
    function drawArrow (x1, y1, x2, y2, parameters) {
        var lineWidth = 1,
            fill = 'rgba(255,255,255,1)',
            lineCap = 'round',
            arrowWidth = 6,
            strokeStyle  = 'rgba(96, 96, 96, 1)',
            dx, dy, theta;

        if ("fill" in parameters && parameters.fill) fill = parameters.fill;

        dx = x2 - x1;
        dy = y2 - y1;
        theta = Math.atan2(dy, dx);

        ctx.save();
        ctx.fillStyle = fill;
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

    /**
     * Get a state
     * @param stateIndex
     * @returns {*}
     */
    function getState(stateIndex) {
        return states[stateIndex];
    }

    /**
     * Hide the message box.
     */
    function hideMessage () {
        if (svl.ui.onboarding.messageHolder.is(":visible")) svl.ui.onboarding.messageHolder.hide();
    }

    /**
     * Transition to the next state
     * @param nextState
     */
    function next (nextState) {
        if (typeof nextState == "function") {
            status.state = getState(nextState.call(this));
            visit(status.state);
        } else if (nextState in states) {
            status.state = getState(nextState);
            visit(status.state);
        } else {
            visit(null);
        }
    }

    /**
     * Show a message box
     * @param parameters
     */
    function showMessage (parameters) {
        var message = parameters.message, position = parameters.position;
        if (!position) position = "top-right";

        svl.ui.onboarding.messageHolder.toggleClass("yellow-background");
        setTimeout(function () { svl.ui.onboarding.messageHolder.toggleClass("yellow-background"); }, 100);

        svl.ui.onboarding.messageHolder.css({
            top: 0,
            left: 0,
            width: 300
        });

        // The following code is broken due to Chrome's bug. It does not properly re-render the text box.
        // if (position == "top-left") {
        //     svl.ui.onboarding.messageHolder.css({
        //         top: 0,
        //         left: 0
        //     });
        // } else {
        //     svl.ui.onboarding.messageHolder.css({
        //         top: 0,
        //         left: 410
        //     });
        // }
        if (!svl.ui.onboarding.messageHolder.is(":visible")) svl.ui.onboarding.messageHolder.show();


        svl.ui.onboarding.background.css("visibility", "hidden");
        if (parameters) {
            if ("width" in parameters) {
                svl.ui.onboarding.messageHolder.css("width", parameters.width);
            }

            if ("left" in parameters) {
                svl.ui.onboarding.messageHolder.css("left", parameters.left);
            }

            if ("top" in parameters) {
                svl.ui.onboarding.messageHolder.css("top", parameters.top);
            }

            if ("background" in parameters && parameters.background) {
                svl.ui.onboarding.background.css("visibility", "visible");
            }
        }

        svl.ui.onboarding.messageHolder.html((typeof message == "function" ? message() : message));
    }

    /**
     * Execute an instruction based on the current state.
     * @param state
     */
    function visit(state) {
        var i, len, message, callback, annotationListener;
        clear(); // Clear what ever was rendered on the onboarding-canvas in the previous state.
        hideMessage();
        if (!state) {
            // End of onboarding. Transition to the actual task.
            svl.ui.onboarding.background.css("visibility", "hidden");
            console.debug("Move on to the task.")
            return;
        }

        // Show user a message box.
        if ("message" in state && state.message) {
            showMessage(state.message);
        }

        // Draw arrows to annotate target accessibility attributes
        if ("annotations" in state && state.annotations) {
            var coordinate, imX, imY, lineLength, lineAngle, x1, x2, y1, y2, currentPOV = svl.map.getPov(), drawAnnotations;
            len = state.annotations.length;

            drawAnnotations = function () {
                clear();
                for (i = 0; i < len; i++) {
                    imX = state.annotations[i].x;
                    imY = state.annotations[i].y;
                    currentPOV = svl.map.getPov();

                    // Map an image coordinate to a canvas coordinate
                    if (currentPOV.heading < 180) {
                        if (imX > svl.svImageWidth - 3328 && imX > 3328) {
                            imX -= svl.svImageWidth;
                        }
                    } else {
                        if (imX < 3328 && imX < svl.svImageWidth - 3328) {
                            imX += svl.svImageWidth;
                        }
                    }
                    coordinate = svl.misc.imageCoordinateToCanvasCoordinate(imX, imY, currentPOV);

                    if (state.annotations[i].type == "arrow") {
                        lineLength = state.annotations[i].length;
                        lineAngle = state.annotations[i].angle;
                        x2 = coordinate.x;
                        y2 = coordinate.y;
                        x1 = x2 - lineLength * Math.sin(svl.util.math.toRadians(lineAngle));
                        y1 = y2 - lineLength * Math.cos(svl.util.math.toRadians(lineAngle));
                        drawArrow(x1, y1, x2, y2, { "fill": state.annotations[i].fill });
                    } else if (state.annotations[i].type == "double-click") {
                        drawDoubleClickIcon(coordinate.x, coordinate.y);
                    }

                }
            };
            drawAnnotations();
            annotationListener = google.maps.event.addListener(svl.panorama, "pov_changed", drawAnnotations);
        }

        // A nested function responsible for detaching events from google maps
        function removeAnnotationListener () {
            if (annotationListener) google.maps.event.removeListener(annotationListener);
        }

        // Change behavior based on the current state.
        if ("properties" in state) {
            var $target, labelType, subcategory;
            if (state.properties.action == "Introduction") {
                var pov = { heading: state.properties.heading, pitch: state.properties.pitch, zoom: state.properties.zoom };

                // I need to nest callbacks due to the bug in Street View; I have to first set panorama, and set POV
                // once the panorama is loaded. Here I let the panorama load while the user is reading the instruction.
                // When they click OK, then the POV changes.
                callback = function () {
                    svl.panorama.setPano(state.panoId);
                    google.maps.event.removeListener($target);
                    $target = $("#onboarding-message-holder").find("button");

                    callback = function () {
                        svl.map.setPov(pov);
                        svl.map.setPosition(state.properties.lat, state.properties.lng);
                        $target.off("click", callback);
                        removeAnnotationListener();
                        next.call(this, state.transition);
                    };
                    $target.on("click", callback);
                };
                $target = google.maps.event.addListener(svl.panorama, "position_changed", callback);
            } else if (state.properties.action == "SelectLabelType") {
                // Blink the given label type and nudge them to click one of the buttons in the ribbon menu.
                // Move on to the next state if they click the button.
                labelType = state.properties.labelType;
                subcategory = "subcategory" in state.properties ? state.properties.subcategory : null;
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
                    removeAnnotationListener();
                    next(state.transition);
                };
                $target.on("click", callback);
            } else if (state.properties.action == "LabelAccessibilityAttribute") {
                // Tell the user to label the target attribute.
                var imageX = state.properties.imageX,
                    imageY = state.properties.imageY,
                    tolerance = state.properties.tolerance;
                labelType = state.properties.labelType;
                $target = svl.ui.canvas.drawingLayer;

                callback = function (e) {
                    // Check if the point that the user clicked is close enough to the given ground truth point.
                    var clickCoordinate = mouseposition(e, this),
                        pov = svl.map.getPov(),
                        canvasX = clickCoordinate.x,
                        canvasY = clickCoordinate.y,
                        imageCoordinate = svl.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov),
                        distance = (imageX - imageCoordinate.x) * (imageX - imageCoordinate.x) + (imageY - imageCoordinate.y) * (imageY - imageCoordinate.y);

                    if (distance < tolerance * tolerance) {
                        $target.off("click", callback);
                        removeAnnotationListener();
                        next(state.transition);
                    }
                };
                $target.on("click", callback);
            } else if (state.properties.action == "RateSeverity" || state.properties.action == "RedoRateSeverity") {
                var severity = state.properties.severity;
                $target = svl.ui.contextMenu.radioButtons;
                labelType = state.properties.labelType;
                callback = function () {
                    $target.off("click", callback);
                    removeAnnotationListener();
                    next.call(this, state.transition);
                };
                $target.on("click", callback);
            } else if (state.properties.action == "AdjustHeadingAngle") {
                // Tell them to remove a label.
                showGrabAndDragAnimation({direction: "left-to-right"});
                callback = function () {
                    var pov = svl.map.getPov();
                    if ((360 + state.properties.heading - pov.heading) % 360 < state.properties.tolerance) {
                        google.maps.event.removeListener($target);
                        removeAnnotationListener();
                        hideGrabAndDragAnimation();
                        next(state.transition);
                    }
                };
                // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
                $target = google.maps.event.addListener(svl.panorama, "pov_changed", callback);
            } else if (state.properties.action == "WalkTowards") {
                svl.map.unlockDisableWalking().enableWalking().lockDisableWalking();
                callback = function () {
                    var panoId = svl.map.getPanoId();
                    if (state.properties.panoId == panoId) {
                        window.setTimeout(function () { svl.map.unlockDisableWalking().disableWalking().lockDisableWalking(); }, 1000);
                        google.maps.event.removeListener($target);
                        removeAnnotationListener();
                        next(state.transition);
                    } else {
                        svl.panorama.setPano(state.panoId); // Force the interface to go back to the previous position.
                    }
                };
                // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
                // $target = google.maps.event.addListener(svl.panorama, "pano_changed", callback);
                $target = google.maps.event.addListener(svl.panorama, "position_changed", callback);
            } else if (state.properties.action == "Instruction") {
                if (!("okButton" in state) || state.okButton) {
                    // Insert an ok button.
                    svl.ui.onboarding.messageHolder.append("<br/><button id='onboarding-ok-button' class='button width-50'>OK</button>");
                }

                // Blink parts of the interface
                if ("blinks" in state.properties && state.properties.blinks) {
                    len = state.properties.blinks.length;
                    for (i = 0; i < len; i++) {
                        switch (state.properties.blinks[i]) {
                            case "google-maps":
                                svl.map.blinkGoogleMaps();
                                break;
                            case "compass":
                                svl.compass.blink();
                                break;
                            case "status-field":
                                svl.statusField.blink();
                                break;
                            case "zoom":
                                svl.zoomControl.blink();
                                break;
                            case "action-stack":
                                svl.actionStack.blink();
                                break;
                            case "sound":
                                svl.audioEffect.blink();
                                break;
                            case "jump":
                                svl.modalSkip.blink();
                                break;
                            case "feedback":
                                svl.modalComment.blink();
                                break;
                        }
                    }
                }

                $target = $("#onboarding-ok-button");
                callback = function () {
                    $target.off("click", callback);
                    removeAnnotationListener();

                    if ("blinks" in state.properties && state.properties.blinks) {
                        svl.map.stopBlinkingGoogleMaps();
                        svl.compass.stopBlinking();
                        svl.statusField.stopBlinking();
                        svl.zoomControl.stopBlinking();
                        svl.actionStack.stopBlinking();
                        svl.audioEffect.stopBlinking();
                        svl.modalSkip.stopBlinking();
                        svl.modalComment.stopBlinking();
                    }

                    next.call(this, state.transition);
                };
                $target.on("click", callback);
            }
        }
    }


    // Code for hand animation.
    // Todo. Clean up.
    var layer, stage, OpenHand, ClosedHand, OpenHandReady = false, ClosedHandReady = false,
        ImageObjOpenHand = new Image(), ImageObjClosedHand = new Image(), handAnimationInterval;

    function initializeHandAnimation () {
        hideGrabAndDragAnimation();
        stage = new Kinetic.Stage({
            container: "hand-gesture-holder",
            width: 720,
            height: 200
        });
        layer = new Kinetic.Layer();
        stage.add(layer);
        ImageObjOpenHand.onload = function () {
            OpenHand = new Kinetic.Image({
                x: 0,
                y: stage.getHeight() / 2 - 59,
                image: ImageObjOpenHand,
                width: 128,
                height: 128
            });
            OpenHand.hide();
            layer.add(OpenHand);
            OpenHandReady = true;
        };
        ImageObjOpenHand.src = svl.rootDirectory + "img/onboarding/HandOpen.png";

        ImageObjClosedHand.onload = function () {
            ClosedHand = new Kinetic.Image({
                x: 300,
                y: stage.getHeight() / 2 - 59,
                image: ImageObjClosedHand,
                width: 96,
                height: 96
            });
            ClosedHand.hide();
            layer.add(ClosedHand);
            ClosedHandReady = true;
        };
        ImageObjClosedHand.src = svl.rootDirectory + "img/onboarding/HandClosed.png";
    }

    /**
     * References:
     * Kineticjs callback: http://www.html5canvastutorials.com/kineticjs/html5-canvas-transition-callback-with-kineticjs/
     * Setposition: http://www.html5canvastutorials.com/labs/html5-canvas-animals-on-the-beach-game-with-kineticjs/
     */
    function animateHand(direction) {
        if (direction === 'left-to-right') {
            ClosedHand.hide();
            OpenHand.setPosition(350,100);
            OpenHand.show();
            OpenHand.transitionTo({
                x: 350,
                y: 30,
                duration : 0.5,
                callback : function () {
                    setTimeout(function () {
                        OpenHand.hide();
                        ClosedHand.setPosition(400, 60);
                        ClosedHand.show();
                        ClosedHand.transitionTo({
                            x: 550,
                            y: 60,
                            duration: 1
                        });
                    }, 300);
                }
            });
        } else {
            ClosedHand.hide();
            OpenHand.setPosition(200,100);
            OpenHand.show();
            OpenHand.transitionTo({
                x: 200,
                y: 0,
                duration : 0.5,
                callback : function () {
                    setTimeout(function () {
                        OpenHand.hide();
                        ClosedHand.setPosition(200, 30);
                        ClosedHand.show();
                        ClosedHand.transitionTo({
                            x: 0,
                            y: 30,
                            duration: 1
                        });
                    }, 300);
                }
            });
        }
    }

    function showGrabAndDragAnimation (parameters) {
        if (ClosedHandReady && OpenHandReady) {
            svl.ui.onboarding.handGestureHolder.css("visibility", "visible");
            animateHand("left-to-right");
            handAnimationInterval = setInterval(animateHand.bind(null, "left-to-right"), 2000);
        }
    }

    function hideGrabAndDragAnimation () {
        clearInterval(handAnimationInterval);
        svl.ui.onboarding.handGestureHolder.css("visibility", "hidden");
    }

    function isOnboarding () {
        return status.isOnboarding;
    }

    self.clear = clear;
    self.drawArrow = drawArrow;
    self.next = next;
    self.isOnboarding = isOnboarding;
    self.showMessage = showMessage;
    self.hideMessage = hideMessage;

    _init(params);

    return self;
}