/**
 * Onboarding module.
 * So many dependencies!
 * @param svl
 * @param actionStack
 * @param audioEffect
 * @param compass
 * @param form
 * @param mapService
 * @param missionContainer
 * @param modalComment
 * @param modalMission
 * @param modalSkip
 * @param neighborhoodContainer
 * @param ribbon
 * @param statusField
 * @param statusModel
 * @param storage
 * @param taskContainer
 * @param tracker
 * @param uiCanvas
 * @param uiContextMenu
 * @param uiMap
 * @param uiOnboarding
 * @param uiRibbon
 * @param user
 * @param zoomControl
 * @returns {{className: string}}
 * @constructor
 */
function Onboarding (svl, actionStack, audioEffect, compass, form, mapService, missionContainer, modalComment, modalMission,
                     modalSkip, neighborhoodContainer, ribbon, statusField, statusModel, storage, taskContainer,
                     tracker, uiCanvas, uiContextMenu, uiMap, uiOnboarding, uiRibbon, user, zoomControl) {
    var self = { className : 'Onboarding' },
        ctx, canvasWidth = 720, canvasHeight = 480,
        properties = {},
        status = {
            state: 0,
            isOnboarding: true
        },
        numStates = 32,  // I'm hard coding the number of the states.
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
                    return this.getAttribute("value") == "OK" ? "select-label-type-1" : null;
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
                    "message": 'Good! Now, <span class="bold">click the curb ramp</span> beneath the yellow arrow to label it.',
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
                    "message": 'Now, you can rate the quality of the curb ramp where 1 is passable and 5 is not passable for a wheelchair user. ' +
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
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-1"});
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
                    "message": 'Now we’ve found another curb ramp. Let’s label it! <span class="bold">Click the “Curb Ramp” button</span> like before.',
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
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    statusModel.setMissionCompletionRate(8 / numStates);
                    statusModel.setProgressBar(8 / numStates);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-2"});
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
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-2"});
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
                    "message": 'Notice that there is no curb ramp at the end of this crosswalk. <span class="bold">Click the "Missing Curb Ramp" button</span> to label it.',
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
                    "message": 'Since this missing curb ramp is next to an existing curb ramp, this accessibility problem is less severe. So, let’s <span class="bold">rate it as a 3.</span> ' +
                    'When you rate accessibility, we just ask that you use <span class="bold">your best judgment!</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as 3, a slightly severe problem">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    statusModel.setMissionCompletionRate(11 / numStates);
                    statusModel.setProgressBar(11 / numStates);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-3"});
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
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-3"});
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
                    "message": 'Great! We need to investigate all of the corners on this intersection, so let’s adjust our view.  <span class="bold">Grab and drag the Street View image.</span>',
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
                    "message": 'OK, this corner has two curb ramps. Let’s label them both! <span class="bold">Click the "Curb Ramp" button.</span>',
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
                    "message": 'Now <span class="bold">rate the curb ramp’s quality</span>. Use your best judgment. You can also write in notes in the <span class="bold">Description Box.</span><br>' +
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
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4"});
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
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    statusModel.setMissionCompletionRate(18 / numStates);
                    statusModel.setProgressBar(18 / numStates);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-5"});
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
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5"});
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
                    "message": 'Notice that the sidewalk suddenly ends here. Let’s label this. <span class="bold">Click the "Other" button then "No Sidewalk" to label it.</span>',
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
                    "message": 'Awesome! We’re almost done with the training. Let’s learn how to walk. First, <span class="bold">grab and drag the Street View image.</span>',
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
                    "message": 'Notice the arrow is pointing to another curb ramp, but the image is a bit washed out. <span class="bold">Let’s take a step</span> to see if we can get a better look. To taske a step, double click on the circle below.',
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
                    "message": 'Good, you just took a step! There is a curb ramp. <span class="bold">Click the "Curb Ramp" button on the menu to label it!</span>',
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
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "bdmGHJkiSgmO7_80SnbzXw",
                "annotations": null,
                "transition": function () {
                    statusModel.setMissionCompletionRate(25 / numStates);
                    statusModel.setProgressBar(25 / numStates);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-7"});
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
                "panoId": "bdmGHJkiSgmO7_80SnbzXw",
                "annotations": null,
                "transition": function () {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-7"});
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
                    "message": '<span class="bold">Ok, it\'s almost done!</span> Let’s adjust the view to look at the final corner in this intersection. ' +
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
                    '(<img src="' + svl.rootDirectory + "img/onboarding/Compass.png" + '" width="80px" alt="Navigation message: walk straight">) ' +
                    'and the red line on the map.<br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/GoogleMaps.png" + '" class="width-75" style="margin: 5px auto;display:block;" alt="An instruction saying follow the red line on the Google Maps"> ' +
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
                    "message": 'Your <span class="bold">progress will be tracked and shown</span> on the right side of the interface. ' +
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

    function _init () {
        status.isOnboarding = true;

        tracker.push('Onboarding_Start');

        if ("ui" in svl) {
            var canvas = uiOnboarding.canvas.get(0);
            if (canvas) ctx = canvas.getContext('2d');
            uiOnboarding.holder.css("visibility", "visible");
        }

        if ("map" in svl) {
            mapService.unlockDisableWalking().disableWalking().lockDisableWalking();
        }

        if ("compass" in svl) {
            compass.hideMessage();
        }

        status.state = getState("initialize");
        visit(status.state);
        initializeHandAnimation();
    }

    /**
     * Clear the onboarding canvas
     * @returns {clear}
     */
    function clear () {
        if (ctx) ctx.clearRect(0, 0, canvasWidth, canvasHeight);
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
        if (ctx) {
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
        }
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
        if (uiOnboarding.messageHolder.is(":visible")) uiOnboarding.messageHolder.hide();
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

        uiOnboarding.messageHolder.toggleClass("yellow-background");
        setTimeout(function () { uiOnboarding.messageHolder.toggleClass("yellow-background"); }, 100);

        uiOnboarding.messageHolder.css({
            top: 0,
            left: 0,
            width: 300
        });


        if (!uiOnboarding.messageHolder.is(":visible")) uiOnboarding.messageHolder.show();


        uiOnboarding.background.css("visibility", "hidden");
        if (parameters) {
            if ("width" in parameters) {
                uiOnboarding.messageHolder.css("width", parameters.width);
            }

            if ("left" in parameters) {
                uiOnboarding.messageHolder.css("left", parameters.left);
            }

            if ("top" in parameters) {
                uiOnboarding.messageHolder.css("top", parameters.top);
            }

            if ("background" in parameters && parameters.background) {
                uiOnboarding.background.css("visibility", "visible");
            }
        }

        uiOnboarding.messageHolder.html((typeof message == "function" ? message() : message));
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
            tracker.push('Onboarding_End');
            var task = taskContainer.getCurrentTask();
            var data = form.compileSubmissionData(task);
            form.submit(data, task);
            uiOnboarding.background.css("visibility", "hidden");
            mapService.unlockDisableWalking().enableWalking().lockDisableWalking();
            setStatus("isOnboarding", false);
            storage.set("completedOnboarding", true);

            if (user.getProperty("username") !== "anonymous") {
                var onboardingMission = missionContainer.getMission(null, "onboarding");
                onboardingMission.setProperty("isCompleted", true);
                missionContainer.stage(onboardingMission).commit();
            }

            // Set the next mission
            var neighborhood = neighborhoodContainer.getStatus("currentNeighborhood");
            var missions = missionContainer.getMissionsByRegionId(neighborhood.getProperty("regionId"));
            missions.map(function (m) { if (!m.isCompleted()) return m;});
            var mission = missions[0];  // Todo. Take care of the case where length of the missions is 0

            missionContainer.setCurrentMission(mission);
            modalMission.setMission(mission, neighborhood);
            
            taskContainer.initNextTask();

            return;
        }

        // Show user a message box.
        if ("message" in state && state.message) {
            showMessage(state.message);
        }

        // Draw arrows to annotate target accessibility attributes
        if ("annotations" in state && state.annotations) {
            var coordinate, imX, imY, lineLength, lineAngle, x1, x2, y1, y2, currentPOV = mapService.getPov(), drawAnnotations;
            len = state.annotations.length;

            drawAnnotations = function () {
                clear();
                for (i = 0; i < len; i++) {
                    imX = state.annotations[i].x;
                    imY = state.annotations[i].y;
                    currentPOV = mapService.getPov();

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
                    coordinate = util.misc.imageCoordinateToCanvasCoordinate(imX, imY, currentPOV);

                    if (state.annotations[i].type == "arrow") {
                        lineLength = state.annotations[i].length;
                        lineAngle = state.annotations[i].angle;
                        x2 = coordinate.x;
                        y2 = coordinate.y;
                        x1 = x2 - lineLength * Math.sin(util.math.toRadians(lineAngle));
                        y1 = y2 - lineLength * Math.cos(util.math.toRadians(lineAngle));
                        drawArrow(x1, y1, x2, y2, { "fill": state.annotations[i].fill });
                    } else if (state.annotations[i].type == "double-click") {
                        drawDoubleClickIcon(coordinate.x, coordinate.y);
                    }

                }
            };
            drawAnnotations();
            if (typeof google != "undefined")  annotationListener = google.maps.event.addListener(svl.panorama, "pov_changed", drawAnnotations);
        }

        // A nested function responsible for detaching events from google maps
        function removeAnnotationListener () {
            if (annotationListener) google.maps.event.removeListener(annotationListener);
        }

        // Change behavior based on the current state.
        if ("properties" in state) {
            var $target, labelType, subcategory;
            if (state.properties.action == "Introduction") {
                var pov = { heading: state.properties.heading, pitch: state.properties.pitch, zoom: state.properties.zoom },
                    googleTarget, googleCallback;

                // I need to nest callbacks due to the bug in Street View; I have to first set panorama, and set POV
                // once the panorama is loaded. Here I let the panorama load while the user is reading the instruction.
                // When they click OK, then the POV changes.
                googleCallback = function () {
                    mapService.setPano(state.panoId);
                    google.maps.event.removeListener(googleTarget);
                };
                googleTarget = google.maps.event.addListener(svl.panorama, "position_changed", googleCallback);

                $target = $("#onboarding-message-holder").find(".onboarding-transition-trigger");
                callback = function () {
                    removeAnnotationListener();
                    next.call(this, state.transition);
                    mapService.setPano(state.panoId);
                    mapService.setPov(pov);
                    mapService.setPosition(state.properties.lat, state.properties.lng);

                    if ("compass" in svl) compass.hideMessage();
                };
                $target.one("click", callback);
            } else if (state.properties.action == "SelectLabelType") {
                // Blink the given label type and nudge them to click one of the buttons in the ribbon menu.
                // Move on to the next state if they click the button.
                labelType = state.properties.labelType;
                subcategory = "subcategory" in state.properties ? state.properties.subcategory : null;
                if ("ribbon" in svl) {
                    ribbon.startBlinking(labelType, subcategory);
                }

                if (subcategory) {
                    $target = $(uiRibbon.subcategoryHolder.find('[val="' + subcategory + '"]').get(0));
                } else {
                    $target = $(uiRibbon.holder.find('[val="' + labelType + '"]').get(0));
                }

                callback = function () {
                    ribbon.stopBlinking();
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
                $target = uiCanvas.drawingLayer;

                callback = function (e) {
                    // Check if the point that the user clicked is close enough to the given ground truth point.
                    var clickCoordinate = mouseposition(e, this),
                        pov = mapService.getPov(),
                        canvasX = clickCoordinate.x,
                        canvasY = clickCoordinate.y,
                        imageCoordinate = util.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov),
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
                $target = uiContextMenu.radioButtons;
                labelType = state.properties.labelType;
                callback = function () {
                    $target.off("click", callback);
                    removeAnnotationListener();
                    next.call(this, state.transition);
                };
                $target.on("click", callback);  // This can be changed to "$target.one()"
            } else if (state.properties.action == "AdjustHeadingAngle") {
                // Tell them to remove a label.
                showGrabAndDragAnimation({direction: "left-to-right"});
                callback = function () {
                    var pov = mapService.getPov();
                    if ((360 + state.properties.heading - pov.heading) % 360 < state.properties.tolerance) {
                        if (typeof google != "undefined") google.maps.event.removeListener($target);
                        removeAnnotationListener();
                        hideGrabAndDragAnimation();
                        next(state.transition);
                    }
                };
                // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
                if (typeof google != "undefined") $target = google.maps.event.addListener(svl.panorama, "pov_changed", callback);
            } else if (state.properties.action == "WalkTowards") {
                mapService.unlockDisableWalking().enableWalking().lockDisableWalking();
                callback = function () {
                    var panoId = mapService.getPanoId();
                    if (state.properties.panoId == panoId) {
                        window.setTimeout(function () { mapService.unlockDisableWalking().disableWalking().lockDisableWalking(); }, 1000);
                        if (typeof google != "undefined") google.maps.event.removeListener($target);
                        removeAnnotationListener();
                        next(state.transition);
                    } else {
                        mapService.setPano(state.panoId); // Force the interface to go back to the previous position.
                    }
                };
                // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
                // $target = google.maps.event.addListener(svl.panorama, "pano_changed", callback);
                if (typeof google != "undefined") $target = google.maps.event.addListener(svl.panorama, "position_changed", callback);

                // Sometimes Google changes the topology of Street Views and so double clicking/clicking arrows do not
                // take the user to the right panorama. In that case, programmatically move the user.
                var currentClick, previousClick, canvasX, canvasY, pov, imageCoordinate;
                var mouseUpCallback = function (e) {
                    currentClick = new Date().getTime();


                    // Check if the user has double clicked
                    if (previousClick && currentClick - previousClick < 300) {
                        canvasX = mouseposition(e, this).x;
                        canvasY = mouseposition(e, this).y;
                        pov = mapService.getPov();
                        imageCoordinate = util.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov);

                        // Check if where the user has clicked is in the right spot on the canvas
                        var doubleClickAnnotationCoordinate = state.annotations.filter(function (x) { return x.type == "double-click"; })[0];
                        if (Math.sqrt(Math.pow(imageCoordinate.y - doubleClickAnnotationCoordinate.y, 2) +
                                    Math.pow(imageCoordinate.x - doubleClickAnnotationCoordinate.x, 2)) < 300) {
                            uiMap.viewControlLayer.off("mouseup", mouseUpCallback);
                            mapService.setPano(state.properties.panoId);
                            callback();
                        }
                    }
                    previousClick = currentClick;
                };
                uiMap.viewControlLayer.on("mouseup", mouseUpCallback);
            } else if (state.properties.action == "Instruction") {
                if (!("okButton" in state) || state.okButton) {
                    // Insert an ok button.
                    uiOnboarding.messageHolder.append("<br/><button id='onboarding-ok-button' class='button width-50'>OK</button>");
                }

                // Blink parts of the interface
                if ("blinks" in state.properties && state.properties.blinks) {
                    len = state.properties.blinks.length;
                    for (i = 0; i < len; i++) {
                        switch (state.properties.blinks[i]) {
                            case "google-maps":
                                mapService.blinkGoogleMaps();
                                break;
                            case "compass":
                                compass.blink();
                                break;
                            case "status-field":
                                statusField.blink();
                                break;
                            case "zoom":
                                zoomControl.blink();
                                break;
                            case "action-stack":
                                actionStack.blink();
                                break;
                            case "sound":
                                audioEffect.blink();
                                break;
                            case "jump":
                                modalSkip.blink();
                                break;
                            case "feedback":
                                modalComment.blink();
                                break;
                        }
                    }
                }

                $target = $("#onboarding-ok-button");
                callback = function () {
                    $target.off("click", callback);
                    removeAnnotationListener();

                    if ("blinks" in state.properties && state.properties.blinks) {
                        mapService.stopBlinkingGoogleMaps();
                        compass.stopBlinking();
                        statusField.stopBlinking();
                        zoomControl.stopBlinking();
                        actionStack.stopBlinking();
                        audioEffect.stopBlinking();
                        modalSkip.stopBlinking();
                        modalComment.stopBlinking();
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
        if (document.getElementById("hand-gesture-holder")) {
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
            uiOnboarding.handGestureHolder.css("visibility", "visible");
            animateHand("left-to-right");
            handAnimationInterval = setInterval(animateHand.bind(null, "left-to-right"), 2000);
        }
    }

    function hideGrabAndDragAnimation () {
        clearInterval(handAnimationInterval);
        uiOnboarding.handGestureHolder.css("visibility", "hidden");
    }

    /**
     * Check if the user is working on the onboarding right now
     * @returns {boolean}
     */
    function isOnboarding () {
        return status.isOnboarding;
    }

    /**
     * Set status
     * @param key Status field name
     * @param value Status field value
     * @returns {setStatus}
     */
    function setStatus (key, value) {
        if (key in status) status[key] = value;
        return this;
    }

    self.clear = clear;
    self.drawArrow = drawArrow;
    self.next = next;
    self.isOnboarding = isOnboarding;
    self.showMessage = showMessage;
    self.setStatus = setStatus;
    self.hideMessage = hideMessage;

    _init();

    return self;
}