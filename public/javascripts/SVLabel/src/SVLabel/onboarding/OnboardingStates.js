function OnboardingStates (compass, mapService, statusModel, tracker) {
    var numStates = 32;
    this.states = {
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
                    var dom = document.getElementById("onboarding-initial-instruction");
                    return dom ? dom.innerHTML : "";
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
                statusModel.setMissionCompletionRate(1 / numStates);
                statusModel.setProgressBar(1 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "initialize"});
                return "select-label-type-1";
            }
        },
        "select-label-type-1": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp"
            },
            "message": {
                "message": 'In this Street View image, we have drawn an arrow to a curb ramp. Let’s label it. Click the flashing <span class="bold">"Curb Ramp"</span> button above.',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(2 / numStates);
                statusModel.setProgressBar(2 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-1"});
                return "label-attribute-1";
            }
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
                "message": 'Good! Now, <span class="bold">click the curb ramp</span> ' +
                'beneath the yellow arrow to label it.',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(3 / numStates);
                statusModel.setProgressBar(3 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-1"});
                return "rate-attribute-1";
            }
        },
        "rate-attribute-1": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": 1
            },
            "message": {
                "message": 'Now, you can rate the quality of the curb ramp where 1 is passable and 5 is not ' +
                'passable for a wheelchair user. ' +
                '<span class="bold">Let’s rate it as 1, passable.</span><br> ' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(4 / numStates);
                statusModel.setProgressBar(4 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-attribute-1"});
                var severity = parseInt(this.getAttribute("value"), 10);
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
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-1"});
                var severity = parseInt(this.getAttribute("value"), 10);
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
            "transition": function () {
                statusModel.setMissionCompletionRate(5 / numStates);
                statusModel.setProgressBar(5 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-1"});
                return "select-label-type-2";
            }
        },
        "select-label-type-2": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp"
            },
            "message": {
                "message": 'Now we’ve found another curb ramp. Let’s label it! ' +
                '<span class="bold">Click the “Curb Ramp” button</span> like before.',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(6 / numStates);
                statusModel.setProgressBar(6 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-2"});
                return "label-attribute-2";
            }
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
            "transition": function () {
                statusModel.setMissionCompletionRate(7 / numStates);
                statusModel.setProgressBar(7 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-2"});
                return "rate-severity-2";
            }
        },
        "rate-severity-2": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": 1
            },
            "message": {
                "message": 'Good, now <span class="bold">rate the quality</span> of the curb ramp.<br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" ' +
                'class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(8 / numStates);
                statusModel.setProgressBar(8 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-2"});
                var severity = parseInt(this.getAttribute("value"), 10);
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
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, ' +
                'passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-2"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 1 ? "select-label-type-3" : "redo-rate-attribute-2"
            }
        },
        "select-label-type-3": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "NoCurbRamp"
            },
            "message": {
                "message": 'Notice that there is no curb ramp at the end of this crosswalk. ' +
                '<span class="bold">Click the "Missing Curb Ramp" button</span> to label it.',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(9 / numStates);
                statusModel.setProgressBar(9 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-3"});
                return "label-attribute-3";
            }
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
                "message": 'Now click beneath the yellow arrow to <span class="bold">label the missing curb ramp.</span>',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(10 / numStates);
                statusModel.setProgressBar(10 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-3"});
                return "rate-severity-3";
            }
        },
        "rate-severity-3": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "NoCurbRamp",
                "severity": 3
            },
            "message": {
                "message": 'Since this missing curb ramp is next to an existing curb ramp, this accessibility problem ' +
                'is less severe. So, let’s <span class="bold">rate it as a 3.</span> ' +
                'When you rate accessibility, we just ask that you use <span class="bold">your best judgment!</span><br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as 3, ' +
                'a slightly severe problem">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(11 / numStates);
                statusModel.setProgressBar(11 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-3"});
                var severity = parseInt(this.getAttribute("value"), 10);
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
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as 3, ' +
                'a slightly severe problem">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-3"});
                var severity = parseInt(this.getAttribute("value"), 10);
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
                "message": 'Great! We need to investigate all of the corners on this intersection, ' +
                'so let’s adjust our view.  <span class="bold">Grab and drag the Street View image.</span>',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(12 / numStates);
                statusModel.setProgressBar(12 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-2"});
                return "select-label-type-4";
            }
        },
        "select-label-type-4": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp"
            },
            "message": {
                "message": 'OK, this corner has two curb ramps. Let’s label them both! ' +
                '<span class="bold">Click the "Curb Ramp" button.</span>',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(13 / numStates);
                statusModel.setProgressBar(13 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-4"});
                return "label-attribute-4";
            }
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
                "message": 'Now, <span class="bold">click the curb ramp</span> to label it.',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(14 / numStates);
                statusModel.setProgressBar(14 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-4"});
                return "rate-severity-4";
            }
        },
        "rate-severity-4": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null
            },
            "message": {
                "message": 'Now <span class="bold">rate the curb ramp’s quality</span>. ' +
                'Use your best judgment. You can also write in notes in the <span class="bold">Description Box.</span><br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(15 / numStates);
                statusModel.setProgressBar(15 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-4"});
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
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 1 ? "select-label-type-5" : "redo-rate-attribute-4";
            }
        },
        "select-label-type-5": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp"
            },
            "message": {
                "message": '<span class="bold">Click the "Curb Ramp" button</span> to label the other curb ramp now.',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(16 / numStates);
                statusModel.setProgressBar(16 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-5"});
                return "label-attribute-5";
            }
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
            "transition": function () {
                statusModel.setMissionCompletionRate(17 / numStates);
                statusModel.setProgressBar(17 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-5"});
                return "rate-severity-5";
            }
        },
        "rate-severity-5": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null
            },
            "message": {
                "message": '<span class="bold">Let’s rate the quality of the curb ramp.</span><br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(18 / numStates);
                statusModel.setProgressBar(18 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-5"});
                var severity = parseInt(this.getAttribute("value"), 10);
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
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5"});
                var severity = parseInt(this.getAttribute("value"), 10);
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
                "message": 'Notice that the sidewalk suddenly ends here. Let’s label this. ' +
                '<span class="bold">Click the "Other" button then "No Sidewalk" to label it.</span>',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(19 / numStates);
                statusModel.setProgressBar(19 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6"});
                return "label-attribute-6";
            }
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
                "message": '<span class="bold">Click on the ground</span> where the sidewalk is missing.',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(20 / numStates);
                statusModel.setProgressBar(20 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-6"});
                return "adjust-heading-angle-3";
            }
        },
        "adjust-heading-angle-3": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 17,
                "tolerance": 20
            },
            "message": {
                "message": 'Awesome! We’re almost done with the training. Let’s learn how to walk. First, ' +
                '<span class="bold">grab and drag the Street View image.</span>',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(21 / numStates);
                statusModel.setProgressBar(21 / numStates);
                tracker.push('Onboarding_Transition', { onboardingTransition: "adjust-heading-angle-3" });
                return "walk-1";
            }
        },
        "walk-1": {
            "properties": {
                "action": "WalkTowards",
                "panoId": "bdmGHJkiSgmO7_80SnbzXw"
            },
            "message": {
                "message": 'Notice the arrow is pointing to another curb ramp, but the image is a bit washed out. ' +
                '<span class="bold">Let’s take a step</span> to see if we can get a better look. To taske a step, ' +
                'double click on the circle below.',
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
            "transition": function () {
                statusModel.setMissionCompletionRate(22 / numStates);
                statusModel.setProgressBar(22 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-1"});
                mapService.setPov({heading: 34, pitch: -13, zoom: 1}, 1000);
                return "select-label-type-7";
            }
        },
        "select-label-type-7": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp"
            },
            "message": {
                "message": 'Good, you just took a step! There is a curb ramp. ' +
                '<span class="bold">Click the "Curb Ramp" button on the menu to label it!</span>',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
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
            "transition": function () {
                statusModel.setMissionCompletionRate(23 / numStates);
                statusModel.setProgressBar(23 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-7"});
                return "label-attribute-7";
            }
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
                "message": '<span class="bold">Click on the curb ramp (below the yellow arrow) to label it.</span>',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
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
            "transition": function () {
                statusModel.setMissionCompletionRate(24 / numStates);
                statusModel.setProgressBar(24 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-7"});
                return "rate-severity-7";
            }
        },
        "rate-severity-7": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null
            },
            "message": {
                "message": '<span class="bold">Let’s rate the quality of the curb ramp.</span><br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(25 / numStates);
                statusModel.setProgressBar(25 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-7"});
                var severity = parseInt(this.getAttribute("value"), 10);
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
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-7"});
                var severity = parseInt(this.getAttribute("value"), 10);
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
                "message": '<span class="bold">Ok, it\'s almost done!</span> Let’s adjust the view to ' +
                'look at the final corner in this intersection. ' +
                '<span class="bold">Grab and drag the Street View image.</span>',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(26 / numStates);
                statusModel.setProgressBar(26 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-4"});
                return "instruction-1";
            }
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
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(27 / numStates);
                statusModel.setProgressBar(27 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-1"});
                compass.showMessage();
                return "instruction-2";
            }
        },
        "instruction-2": {
            "properties": {
                "action": "Instruction",
                "blinks": ["google-maps", "compass"]
            },
            "message": {
                "message": 'From here on, we\'ll guide you through your missions with the navigation message ' +
                '(<img src="' + svl.rootDirectory + "img/onboarding/Compass.png" +
                '" width="80px" alt="Navigation message: walk straight">) ' +
                'and the red line on the map.<br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/GoogleMaps.png" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="An instruction saying ' +
                'follow the red line on the Google Maps"> ' +
                'See flashing yellow highlights.',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(28 / numStates);
                statusModel.setProgressBar(28 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-2"});
                return "instruction-3";
            }
        },
        "instruction-3": {
            "properties": {
                "action": "Instruction",
                "blinks": ["status-field"]
            },
            "message": {
                "message": 'Your <span class="bold">progress will be tracked and shown</span> ' +
                'on the right side of the interface. ' +
                'Your overall goal is to label as many accessibility problems as you find—such as missing curb ramps.',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(29 / numStates);
                statusModel.setProgressBar(29 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-3"});
                return "instruction-4";
            }
        },
        "instruction-4": {
            "properties": {
                "action": "Instruction",
                "blinks": ["zoom", "action-stack"]
            },
            "message": {
                "message": 'Other interface features include: <br>' +
                '<span class="bold">Zooming:</span> Zoom in or out of the Street View image<br> ' +
                '<span class="bold">Undo/Redo:</span> Undo or redo the labeling',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(30 / numStates);
                statusModel.setProgressBar(30 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-4"});
                return "instruction-5";
            }
        },
        "instruction-5": {
            "properties": {
                "action": "Instruction",
                "blinks": ["sound", "jump", "feedback"]
            },
            "message": {
                "message": 'Finally, you can also control: <br>' +
                '<span class="bold">Sound:</span> turn on/off the sound effects <br> ' +
                '<span class="bold">Jump:</span> jump to a different street <br>' +
                '<span class="bold">Feedback:</span> provide comments about your mission or report bugs',
                "position": "top-right",
                "parameters": null
            },
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(31 / numStates);
                statusModel.setProgressBar(31 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-5"});
                return "outro";
            }
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
            "panoId": "bdmGHJkiSgmO7_80SnbzXw",
            "annotations": null,
            "transition": function () {
                statusModel.setMissionCompletionRate(32 / numStates);
                statusModel.setProgressBar(32 / numStates);
                tracker.push('Onboarding_Transition', {onboardingTransition: "outro"});
                return null;
            }
        }

    };

    this.get = function () { return this.states; };
}