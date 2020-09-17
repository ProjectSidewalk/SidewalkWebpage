function OnboardingStates (compass, mapService, statusModel, tracker) {
    var numStates = 42;
    var panoId = "tutorial";
    var afterWalkPanoId = "afterWalkTutorial";
    var headingRanges = {
        "stage-1": [238, 242],
        "stage-2-adjust": [197, 242],
        "stage-2": [197, 209],
        "stage-3-adjust": [98, 197],
        "stage-3": [98, 108],
        "stage-4-adjust": [359, 108],
        "stage-4": [355, 1],
        "stage-5-adjust": [315, 1],
        "stage-5": [315, 343],
        "stage-6": [281, 14]
    };
    this.states = {
        "initialize": {
            "properties": {
                "action": "Introduction",
                "heading": 241,
                "pitch": -6,
                "zoom": 1,
                "lat": 38.9404982935884,
                "lng": -77.06762207994893,
                "name": "initialize",
                "maxLabelCount": 0
            },
            "message": {
                "message": function () {
                    var dom = document.getElementById("onboarding-initial-instruction");
                    return dom ? dom.innerHTML : "";
                },
                "position": "center",
                "width": 1000,
                "top": -50,
                "left": -70,
                "padding": "100px 10px 100px 10px",
                //"fade-direction": "fadeIn",
                "background": true
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 1 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "initialize"});
                var value = this.getAttribute("value");
                return value == "OK" ? "select-label-type-1" : "end-onboarding-skip";
            }
        },
        "end-onboarding-skip": {
            "end-onboarding": {
                "skip": true
            }
        },
        "select-label-type-1": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
                "maxLabelCount": 0
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-1'),
                "position": "top-right"
            },
            "panoId": panoId,
            "annotations": [
                {
                    "name": "arrow-1a",
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "originalPov": {}
                }
            ],
            "transition": function () {
                var completedRate = 2 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-1"});
                return "label-attribute-1";
            }
        },
        "label-attribute-1": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 9730,
                "imageY": -350,
                "tolerance": 300,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
                "maxLabelCount": 0
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-1'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "name": "arrow-1b",
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                }
            ],
            "transition": [function () {
                var completedRate = 3 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-1"});
                return "rate-attribute-1";
            }]
        },
        "rate-attribute-1": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
                "maxLabelCount": 1
            },
            "message": {
                "message": i18next.t('tutorial.rate-attribute-1') +
                    '<br><img src="' + svl.rootDirectory + 'img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" ' +
                    'class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 2, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 4 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-attribute-1"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 1 ? "adjust-heading-angle-1" : "redo-rate-attribute-1"
            }
        },
        "redo-rate-attribute-1": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 2,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
                "maxLabelCount": 1
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 2, somewhat passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-1"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity === 1 ? "adjust-heading-angle-1" : "redo-rate-attribute-1"
            }
        },
        "adjust-heading-angle-1": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 210,
                "tolerance": 20,
                "minHeading": headingRanges["stage-2-adjust"][0],
                "maxHeading": headingRanges["stage-2-adjust"][1],
                "maxLabelCount": 1
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-1'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 6 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-1"});
                return "zoom-in";
            }
        },
        "zoom-in": {
            "properties": {
                "action": "Zoom",
                "type": "in",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 1
            },
            "message": {
                "message": i18next.t('tutorial.zoom-in'),
                "position": "top-right",
                "fade-direction": "fadeInUp",
                "arrow": "top",
                "top": 0,
                "left": 428
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 7 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "zoom-in"});
                return "select-label-type-2";
            }
        },
        "select-label-type-2": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 1
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-2'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 8180,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": null,
                    "originalPov": {}
                }
            ],
            "transition": function () {
                var completedRate = 8 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-2"});
                return "label-attribute-2";
            }
        },
        "label-attribute-2": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 8180,
                "imageY": -340,
                "tolerance": 300,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 1
            }],
            "message": {
                "message": i18next.t('tutorial.common.label-curb-ramp'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 8180,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                }
            ],
            "transition": [function () {
                var completedRate = 9 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-2"});
                return "rate-severity-2";
            }]
        },
        "rate-severity-2": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": 2,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 2
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-2') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" + '" ' +
                'class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 2, somewhat passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 10 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-2"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity === 2 ? "tag-attribute-2" : "redo-rate-attribute-2"
            }
        },
        "redo-rate-attribute-2": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 2,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 2
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-2') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 2, ' +
                'somewhat passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-2"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity === 2 ? "tag-attribute-2" : "redo-rate-attribute-2"
            }
        },
        "tag-attribute-2": {
            "properties": {
                "action": "AddTag",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 2
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-2') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'points into traffic\' tag">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 11 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-2"});
                var tags = this.getProperty('tagIds');
                return tags.includes(23) && tags.length === 1 ? "select-label-type-3" : "redo-tag-attribute-2" // Where 23 is the tag_id of the "not enough landing space" tag
            }
        },
        "redo-tag-attribute-2": {
            "properties": {
                "action": "RedoAddTag",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 1
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-2') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'points into traffic\' tag">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-2"});
                var tags = this.getProperty('tagIds');
                return tags.includes(23) && tags.length === 1 ? "select-label-type-3" : "redo-tag-attribute-2" // Where 23 is the tag_id of the "not enough landing space" tag
            }
        },
        "select-label-type-3": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 2
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-3'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7800,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": null,
                    "originalPov": {}
                }
            ],
            "transition": function () {
                var completedRate = 12 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-3"});
                return "label-attribute-3";
            }
        },
        "label-attribute-3": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "NoCurbRamp",
                "imageX": 7800,
                "imageY": -340,
                "tolerance": 300,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 2
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-3'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7800,
                    "y": -340,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                }
            ],
            "transition": [function () {
                var completedRate = 13 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-3"});
                return "rate-severity-3";
            }]
        },
        "rate-severity-3": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "NoCurbRamp",
                "severity": 3,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 3
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-3') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as ' +
                    '3, a slightly severe problem">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 14 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-3"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 3 ? "tag-attribute-3" : "redo-rate-attribute-3"
            }
        },
        "redo-rate-attribute-3": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "NoCurbRamp",
                "severity": 3,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 3
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-3') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as 3, ' +
                'a slightly severe problem">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-3"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 3 ? "tag-attribute-3" : "redo-rate-attribute-3"
            }
        },
        "tag-attribute-3": {
            "properties": {
                "action": "AddTag",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 3
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-3') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'alternate route present\' tag">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 15 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-3"});
                var tags = this.getProperty('tagIds');
                return tags.includes(5) && tags.length === 1 ? "zoom-out" : "redo-tag-attribute-3" // Where 5 is the tag_id of the "alternate route present" tag
            }
        },
        "redo-tag-attribute-3": {
            "properties": {
                "action": "RedoAddTag",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 3
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-3') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'alternate route present\' tag">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-3"});
                var tags = this.getProperty('tagIds');
                return tags.includes(5) && tags.length === 1 ? "zoom-out" : "redo-tag-attribute-3" // Where 5 is the tag_id of the "alternate route present" tag
            }
        },
        "zoom-out": {
            "properties": {
                "action": "Zoom",
                "type": "out",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
                "maxLabelCount": 3
            },
            "message": {
                "message": i18next.t('tutorial.zoom-out'),
                "position": "top-right",
                "fade-direction": "fadeInUp",
                "arrow": "top",
                "top": 0,
                "left": 495
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 16 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "zoom-out"});
                return "adjust-heading-angle-2";
            }
        },
        "adjust-heading-angle-2": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 177,
                "tolerance": 20,
                "minHeading": headingRanges["stage-3-adjust"][0],
                "maxHeading": headingRanges["stage-3-adjust"][1],
                "maxLabelCount": 3
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-2'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 17 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-2"});
                return "adjust-heading-angle-3";
            }
        },
        "adjust-heading-angle-3": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 115,
                "tolerance": 20,
                "minHeading": headingRanges["stage-3-adjust"][0],
                "maxHeading": headingRanges["stage-3-adjust"][1],
                "maxLabelCount": 3
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-3'),
                "position": "top-right",
                "width": 190
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 18 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-3"});
                return "select-label-type-4";
            }
        },
        "select-label-type-4": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 3
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-4'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "white",
                    "originalPov": {}
                },
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "white",
                    "originalPov": {}
                }

            ],
            "transition": function () {
                var completedRate = 19 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-4"});
                return "label-both-curbs";
            }
        },
        "label-both-curbs": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 4920,
                "imageY": -720,
                "tolerance": 300,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 3
            },{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 3900,
                "imageY": -840,
                "tolerance": 300
            }],
            "message": {
                "message": i18next.t('tutorial.label-both-curbs'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                },
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                }
            ],
            "transition": [function () {
                var completedRate = 20 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-both-curbs"});
                return "rate-severity-4";
            }, function () {
                var completedRate = 20 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-both-curbs"});
                return "rate-severity-5-goto-4";
            }]
        },
        "rate-severity-4": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 4
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-4') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 21 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-4"});
                var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                return severity == 1 ? "select-label-type-5" : "redo-rate-attribute-4";
            }
        },
        "redo-rate-attribute-4": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 4
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
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
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 4
            },
            "message": {
                "message": i18next.t('tutorial.common.select-label-type-second-curb-ramp'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "white",
                    "originalPov": {}
                }
            ],
            "transition": function () {
                var completedRate = 22 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-5"});
                return "label-attribute-5";
            }
        },
        "label-attribute-5": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 3900,
                "imageY": -840,
                "tolerance": 300,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 4
            }],
            "message": {
                "message": i18next.t('tutorial.common.label-curb-ramp'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                }
            ],
            "transition": [function () {
                var completedRate = 23 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-5"});
                return "rate-severity-5";
            }]
        },
        "rate-severity-5": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 5
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-curb-ramp') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 24 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-5"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 1 ? "select-label-type-6" : "redo-rate-attribute-5";
            }
        },
        "redo-rate-attribute-5": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 5
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 1 ? "select-label-type-6" : "redo-rate-attribute-5";
            }
        },
        "select-label-type-4-after-5": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 4
            },
            "message": {
                "message": i18next.t('tutorial.common.select-label-type-second-curb-ramp'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "white",
                    "originalPov": {}
                }

            ],
            "transition": function () {
                var completedRate = 22 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-4-after-5"});
                return "label-attribute-4";
            }
        },
        "label-attribute-4": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 4920,
                "imageY": -720,
                "tolerance": 300,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 4
            }],
            "message": {
                "message": i18next.t('tutorial.common.label-curb-ramp'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 4920,
                    "y": -720,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                }
            ],
            "transition": [function () {
                var completedRate = 23 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-4"});
                return "rate-severity-4-after-5";
            }]
        },
        "rate-severity-4-after-5": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 5
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-4') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 24 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-4-after-5"});
                var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                return severity == 1 ? "select-label-type-6" : "redo-rate-attribute-4-after-5";
            }
        },
        "redo-rate-attribute-4-after-5": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 5
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4-after-5"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 1 ? "select-label-type-6" : "redo-rate-attribute-4-after-5";
            }
        },
        "rate-severity-5-goto-4": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 4
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-curb-ramp') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 21 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-5-goto-4"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 1 ? "select-label-type-4-after-5" : "redo-rate-attribute-5-goto-4";
            }
        },
        "redo-rate-attribute-5-goto-4": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 4
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5-goto-4"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 1 ? "select-label-type-4-after-5" : "redo-rate-attribute-5-goto-4";
            }
        },
        "select-label-type-6": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 5
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-6'),
                "position": "top-left",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 2776,
                    "y": -500,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "white",
                    "originalPov": {}
                }
            ],
            "transition": function () {
                var completedRate = 25 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6"});
                return "label-attribute-6";
            }
        },
        "label-attribute-6": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "NoSidewalk",
                "imageX": 2776,
                "imageY": -500,
                "tolerance": 300,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 5
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-6'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 2776,
                    "y": -500,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow"
                }
            ],
            "transition": [function () {
                var completedRate = 26 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-6"});
                return "rate-severity-6";
            }]
        },
        "rate-severity-6": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "NoSidewalk",
                "severity": 3,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 6
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no sidewalk quality ' +
                    'as 3, a slightly severe problem">',
                "position": "top-right",
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 27 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-6"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 3 ? "tag-attribute-6" : "redo-rate-attribute-6"
            }
        },
        "redo-rate-attribute-6": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "NoSidewalk",
                "severity": 3,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 6
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no sidewalk quality ' +
                    'as 3, a slightly severe problem">',
                "position": "top-right",
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-6"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 3 ? "tag-attribute-6" : "redo-rate-attribute-6"
            }
        },
        "tag-attribute-6": {
            "properties": {
                "action": "AddTag",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 6
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'ends abruptly\' and \'street has a sidewalk\' tags">',
                "position": "top-right",
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-6"});

                var tags = this.getProperty('tagIds');
                var completedRate;
                var nextState;

                if (tags.includes(22)) { // Where 22 is the tag_id of the "street has no sidewalks" tag
                    completedRate = 27 / numStates;
                    nextState = "redo-tag-attribute-6"; // We have selected the wrong tag here, so we move to the redo state
                } else if (tags.length < 2) {
                    completedRate = 28 / numStates;
                    nextState = "tag-attribute-6"; // Keep this state, since we have one right tag, but not both
                } else {
                    completedRate = 29 / numStates;
                    nextState = "adjust-heading-angle-4"; // We have both right tags, so lets continue
                }
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                return nextState;
            }
        },
        "redo-tag-attribute-6": {
            "properties": {
                "action": "RedoAddTag",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
                "maxLabelCount": 6
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'ends abruptly\' and \'street has a sidewalk\' tags">',
                "position": "top-right",
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-6"});
                var tags = this.getProperty('tagIds');

                var completedRate;
                var nextState;
                // Where 20 is the tag_id of the "ends abruptly" tag, and 21 is "street has sidewalk"
                if (tags.includes(20) && tags.includes(21) && tags.length === 2) { // We are done
                    completedRate = 29 / numStates;
                    nextState = "adjust-heading-angle-4";
                } else if (tags.includes(20) && !tags.includes(21) || !tags.includes(20) && tags.includes(21)) { // We have at least one correct tag
                    completedRate = 28 / numStates;
                    nextState = "redo-tag-attribute-6";
                } else { // We don't have any correct tags
                    completedRate = 27 / numStates;
                    nextState = "redo-tag-attribute-6";
                }

                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);

                return nextState;
            }
        },
        "adjust-heading-angle-4": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 0,
                "tolerance": 20,
                "minHeading": headingRanges["stage-4-adjust"][0],
                "maxHeading": headingRanges["stage-4-adjust"][1],
                "maxLabelCount": 6
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-4'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 30 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', { onboardingTransition: "adjust-heading-angle-4" });
                return "select-label-type-7";
            }
        },
        "select-label-type-7": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1],
                "maxLabelCount": 6
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-7'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 750,
                    "y": -670,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "white",
                    "originalPov": {}
                }
            ],
            "transition": function () {
                var completedRate = 30 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-7"});
                return "label-attribute-7";
            }
        },
        "label-attribute-7": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 750,
                "imageY": -670,
                "tolerance": 250,
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1],
                "maxLabelCount": 6
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-7'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 750,
                    "y": -670,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                }
            ],
            "transition": [function () {
                var completedRate = 31 / numStates;

                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-7"});
                return "rate-severity-7";
            }]
        },
        "rate-severity-7": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1],
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-curb-ramp') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 32 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-7"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 1 ? "adjust-heading-angle-5" : "redo-rate-attribute-7";
            }
        },
        "redo-rate-attribute-7": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1],
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 1, passable">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-7"});
                var severity = parseInt(this.getAttribute("value"), 10);
                return severity == 1 ? "adjust-heading-angle-5" : "redo-rate-attribute-7";
            }
        },
        "adjust-heading-angle-5": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 346,
                "tolerance": 20,
                "minHeading": headingRanges["stage-5-adjust"][0],
                "maxHeading": headingRanges["stage-5-adjust"][1],
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-5'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 33 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-5"});
                return "walk-1";
            }
        },
        "walk-1": {
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
                "blinks": ["google-maps"],
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.walk-1'),
                "position": "top-right",
                "fade-direction": "fadeInLeft",
                "arrow": "right",
                "top": 270,
                "left": 405
            },
            "panoId": panoId,
            "transition": function () {
                var completedRate = 34 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-1"});

                // Set Compass Message
                var uiCompassMessageHolder = compass.getCompassMessageHolder();
                var image = "<img src='" + compass.directionToImagePath("straight") + "' class='compass-turn-images' alt='Turn icon' />";
                var message =  "<span class='compass-message-small'>" + i18next.t('center-ui.compass.unlabeled-problems') +
                    "</span><br/>" + image + "<span class='bold'>" + i18next.t('center-ui.compass.straight') + "</span>";
                uiCompassMessageHolder.message.html(message);
                compass.showMessage();
                return "walk-2";
            }
        },
        "walk-2": {
            "properties": {
                "action": "Instruction",
                "blinks": ["compass"],
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.walk-2'),
                "position": "top-right",
                "fade-direction": "fadeInDown",
                "arrow": "bottom",
                "top": 263,
                "left": 405
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 35 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-2"});
                return "walk-3";
            }
        },
        "walk-3": {
            "properties": {
                "action": "WalkTowards",
                "panoId": afterWalkPanoId,
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
                "fade-direction": "fadeIn",
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.walk-3'),
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "double-click",
                    "x": -600,
                    "y": -403,
                    "width": 100,
                    "originalPov": {}
                }
            ],
            "transition": function () {
                var completedRate = 36 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-3"});
                mapService.setPov({heading: 330, pitch: 0, zoom: 1});
                document.getElementById("google-maps-holder").style.backgroundImage = "url('"+ svl.rootDirectory + "img/onboarding/afterWalkTutorialMiniMap.jpg')";
                return "walk-4";
            }
        },
        "walk-4": {
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1],
                "blinks": ["google-maps"],
                "name": "walk-4",
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.walk-4'),
                "position": "top-right",
                "width": 350,
                "arrow": "right",
                "fade-direction": "fadeInLeft",
                "top": 254,
                "left": 350
            },
            "panoId": afterWalkPanoId,
            "annotations": null,
            // okButtonText: "Yes! I see the missing curb ramps.",
            "transition": function () {
                var completedRate = 37 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-4"});
                return "walk-5";
            }
        },
        "walk-5": {
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1],
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.walk-5-1'),
                "position": "top-right",
                "width": 400,
                "fade-direction": "fadeIn"
            },
            "panoId": afterWalkPanoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 200,
                    "y": -600,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                },
                {
                    "type": "arrow",
                    "x": -2530,
                    "y": -470,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                }

            ],
            okButtonText: i18next.t('tutorial.walk-5-2'),
            "transition": function () {
                var completedRate = 38 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-5"});
                return "walk-6";
            }
         },
        "walk-6": {
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1],
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.walk-6-1') +
                '<img src="' + svl.rootDirectory + 'img/cursors/Cursor_NoCurbRamp.png" style="width: 8%; height:auto" alt="Missing Curb Ramp Label">. ' +
                    i18next.t('tutorial.walk-6-2'),
                "position": "top-right",
                "width": 400,
                "fade-direction": "fadeIn"
            },
            "panoId": afterWalkPanoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 200,
                    "y": -600,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                },
                {
                    "type": "arrow",
                    "x": -2530,
                    "y": -470,
                    "length": 50,
                    "angle": 0,
                    "text": null,
                    "fill": "yellow",
                    "originalPov": {}
                }

            ],
            "transition": function () {
                var completedRate = 39 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-6"});
                return "instruction-1";
            }
        },
        "instruction-1": {
            "properties": {
                "action": "Instruction",
                "blinks": ["google-maps"],
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1],
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.instruction-1'),
                "position": "right",
                "arrow": "right",
                "fade-direction": "fadeInLeft",
                "top": 270,
                "left": 405
            },
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 40 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-1"});
                return "instruction-2";
            }
        },
        /*
        "instruction-3": {
            "properties": {
                "action": "Instruction",
                "blinks": ["status-field"],
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1]
            },
            "message": {
                "message": 'You can track your mission <span class="bold">progress and statistics</span> here.',
                "position": "top-right",
                "arrow": "right",
                "fade-direction": "fadeInLeft",
                "top": 15,
                "left": 405
            },
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 34 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-3"});
                return "instruction-4";
            }
        },*/
        "instruction-2": {
            "properties": {
                "action": "Instruction",
                "blinks": ["jump"],
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1],
                "maxLabelCount": 7
            },
            "message": {
                "message": i18next.t('tutorial.instruction-2'),
                "position": "top-right",
                "fade-direction": "fadeInRight",
                "arrow": "left",
                "top": 240,
                "left": 5
            },
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 41 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-2"});
                return "outro";
            }
        },
        "outro": {
            "properties": {
                "action": "Instruction",
                "heading": 280,
                "pitch": -6,
                "zoom": 1,
                "minHeading": undefined,
                "maxHeading": undefined,
                "maxLabelCount": 7
            },
            "message": {
                "message": function () {
                    return document.getElementById("onboarding-outro").innerHTML;
                },
                "position": "center",
                "width": 1000,
                "top": -50,
                "left": -70,
                "padding": "100px 10px 100px 10px",
                //"fade-direction": "fadeIn",
                "background": true
            },
            "okButton": false,
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 42 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "outro"});
                return "end-onboarding";
            }
        },
        "end-onboarding": {
            "end-onboarding": {
                "skip": false
            }
        }
    };

    this.get = function () { return this.states; };
}

