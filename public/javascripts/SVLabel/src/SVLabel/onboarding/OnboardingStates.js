function OnboardingStates (contextMenu, compass, mapService, statusModel, tracker) {
    var numSteps = 41;
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

    function _updateProgressBar(stepNumber) {
        var completedRate = stepNumber / numSteps;
        statusModel.setMissionCompletionRate(completedRate);
        statusModel.setProgressBar(completedRate);
    }

    this.states = {
        "initialize": {
            "properties": {
                "action": "Introduction",
                "heading": 241,
                "pitch": -6,
                "zoom": 1,
                "lat": 38.9404982935884,
                "lng": -77.06762207994893
            },
            "message": {
                "message": function () {
                    var dom = document.getElementById("onboarding-initial-instruction");
                    return dom ? dom.innerHTML : "";
                },
                "width": 1000,
                "top": -50,
                "left": -70,
                "padding": "100px 10px 100px 10px",
                "background": true
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "initialize", step: 0});
                var value = this.getAttribute("value");
                // If "Let's get started!" button is clicked.
                if (value === "OK") {
                    _updateProgressBar(1);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-1", step: 1});
                    return "select-label-type-1";
                } else {
                    return "end-onboarding-skip";
                }
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
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-1'),
            },
            "panoId": panoId,
            "annotations": [
                {
                    "name": "arrow-1a",
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": function () {
                _updateProgressBar(2);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-1", step: 2});
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
                "maxHeading": headingRanges["stage-1"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-1'),
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
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(3);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-1", step: 3});
                    return "rate-severity-1";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-1"});
                    return "delete-attribute-1";
                }
            }]
        },
        "delete-attribute-1": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "name": "arrow-1a",
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-1"});
                return "redo-select-label-type-1";
            }
        },
        "redo-select-label-type-1": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": [
                {
                    "name": "arrow-1a",
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-1"});
                return "label-attribute-1";
            }
        },
        "rate-severity-1": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-1') +
                    '<br><img src="' + svl.rootDirectory + 'img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" ' +
                    'class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 2, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(4);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-1", step: 4});
                    return "adjust-heading-angle-1";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-1"});
                    return "redo-rate-attribute-1";
                }
            }
        },
        "redo-rate-attribute-1": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 2,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 2, somewhat passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(4);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-1", step: 4});
                    return "adjust-heading-angle-1";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-1"});
                    return "redo-rate-attribute-1";
                }
            }
        },
        "adjust-heading-angle-1": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 210,
                "tolerance": 20,
                "minHeading": headingRanges["stage-2-adjust"][0],
                "maxHeading": headingRanges["stage-2-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-1'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(5);
                tracker.push('Onboarding_Transition', {onboardingTransition: "zoom-in", step: 5});
                return "zoom-in";
            }
        },
        "zoom-in": {
            "properties": {
                "action": "Zoom",
                "type": "in",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.zoom-in'),
                "fade-direction": "fadeInUp",
                "arrow": "top",
                "top": 0,
                "left": 428
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(6);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-2", step: 6});
                return "select-label-type-2";
            }
        },
        "select-label-type-2": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-2'),
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
                    "fill": null
                }
            ],
            "transition": function () {
                _updateProgressBar(7);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-2", step: 7});
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
                "maxHeading": headingRanges["stage-2"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.common.label-curb-ramp'),
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
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(8);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-2", step: 8});
                    return "rate-severity-2";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-2"});
                    return "delete-attribute-2";
                }
            }]
        },
        "delete-attribute-2": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-2"});
                return "redo-select-label-type-2";
            }
        },
        "redo-select-label-type-2": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-2"});
                return "label-attribute-2";
            }
        },
        "rate-severity-2": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": 2,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-2') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" + '" ' +
                'class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 2, somewhat passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 2) {
                    _updateProgressBar(9);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-2", step: 9});
                    return "tag-attribute-2";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-2"});
                    return "redo-rate-attribute-2";
                }
            }
        },
        "redo-rate-attribute-2": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 2,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-2') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 2, ' +
                'somewhat passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 2) {
                    _updateProgressBar(9);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-2", step: 9});
                    return "tag-attribute-2";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-2"});
                    return "redo-rate-attribute-2";
                }
            }
        },
        "tag-attribute-2": {
            "properties": {
                "action": "AddTag",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-2') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'points into traffic\' tag">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(23) && tags.length === 1) { // 23 is the id of the "not enough landing space" tag.
                    contextMenu.hide();
                    _updateProgressBar(10);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-3", step: 10});
                    return "select-label-type-3";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-2"});
                    return "redo-tag-attribute-2";
                }
            }
        },
        "redo-tag-attribute-2": {
            "properties": {
                "action": "RedoAddTag",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-2') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'points into traffic\' tag">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(23) && tags.length === 1) { // 23 is the id of the "not enough landing space" tag.
                    contextMenu.hide();
                    _updateProgressBar(10);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-3", step: 10});
                    return "select-label-type-3";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-2"});
                    return "redo-tag-attribute-2";
                }
            }
        },
        "select-label-type-3": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-3'),
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
                    "fill": null
                }
            ],
            "transition": function () {
                _updateProgressBar(11);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-3", step: 11});
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
                "maxHeading": headingRanges["stage-2"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-3'),
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
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(12);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-3", step: 12});
                    return "rate-severity-3";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-3"});
                    return "delete-attribute-3";
                }
            }]
        },
        "delete-attribute-3": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-3"});
                return "redo-select-label-type-3";
            }
        },
        "redo-select-label-type-3": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('NoCurbRamp-description')}),
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-3"});
                return "label-attribute-3";
            }
        },
        "rate-severity-3": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "NoCurbRamp",
                "severity": 3,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-3') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as ' +
                    '3, a slightly severe problem">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    _updateProgressBar(13);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-3", step: 13});
                    return "tag-attribute-3";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-3"});
                    return "redo-rate-attribute-3";
                }
            }
        },
        "redo-rate-attribute-3": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "NoCurbRamp",
                "severity": 3,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-3') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as 3, ' +
                'a slightly severe problem">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    _updateProgressBar(13);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-3", step: 13});
                    return "tag-attribute-3";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-3"});
                    return "redo-rate-attribute-3";
                }
            }
        },
        "tag-attribute-3": {
            "properties": {
                "action": "AddTag",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-3') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'alternate route present\' tag">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(5) && tags.length === 1) { // 5 is the id of the "alternate route present" tag.
                    contextMenu.hide();
                    _updateProgressBar(14);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "zoom-out", step: 14});
                    return "zoom-out";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-3"});
                    return "redo-tag-attribute-3";
                }
            }
        },
        "redo-tag-attribute-3": {
            "properties": {
                "action": "RedoAddTag",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-3') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'alternate route present\' tag">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(5) && tags.length === 1) { // 5 is the id of the "alternate route present" tag.
                    contextMenu.hide();
                    _updateProgressBar(14);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "zoom-out", step: 14});
                    return "zoom-out";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-3"});
                    return "redo-tag-attribute-3";
                }
            }
        },
        "zoom-out": {
            "properties": {
                "action": "Zoom",
                "type": "out",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.zoom-out'),
                "fade-direction": "fadeInUp",
                "arrow": "top",
                "top": 0,
                "left": 495
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(15);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-2", step: 15});
                return "adjust-heading-angle-2";
            }
        },
        "adjust-heading-angle-2": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 177,
                "tolerance": 20,
                "minHeading": headingRanges["stage-3-adjust"][0],
                "maxHeading": headingRanges["stage-3-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-2'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(16);
                tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-3", step: 16});
                return "adjust-heading-angle-3";
            }
        },
        "adjust-heading-angle-3": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 115,
                "tolerance": 20,
                "minHeading": headingRanges["stage-3-adjust"][0],
                "maxHeading": headingRanges["stage-3-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-3'),
                "width": 190
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(17);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-4", step: 17});
                return "select-label-type-4";
            }
        },
        "select-label-type-4": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-4'),
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
                    "fill": "white"
                },
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": "white"
                }
            ],
            "transition": function () {
                _updateProgressBar(18);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-both-curbs", step: 18});
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
                "maxHeading": headingRanges["stage-3"][1]
            },{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 3900,
                "imageY": -840,
                "tolerance": 300
            }],
            "message": {
                "message": i18next.t('tutorial.label-both-curbs'),
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
                    "fill": "yellow"
                },
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(19);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-4", step: 19});
                    return "rate-severity-4";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-4"});
                    return "delete-attribute-4";
                }
            }, function (params) {
                if (params.accurate) {
                    _updateProgressBar(19);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-5-goto-4", step: 19});
                    return "rate-severity-5-goto-4";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-4"});
                    return "delete-attribute-4";
                }
            }]
        },
        "delete-attribute-4": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
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
                    "fill": null
                },
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-4"});
                return "redo-select-label-type-4";
            }
        },
        "redo-select-label-type-4": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
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
                    "fill": "white"
                },
                {
                    "type": "arrow",
                    "x": 3900,
                    "y": -840,
                    "length": 50,
                    "angle": 0,
                    "fill": "white"
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-both-curbs"});
                return "label-both-curbs";
            }
        },
        "rate-severity-4": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-4') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(20);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-5", step: 20});
                    return "select-label-type-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4"});
                    return "redo-rate-attribute-4";
                }
            }
        },
        "redo-rate-attribute-4": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(20);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-5", step: 20});
                    return "select-label-type-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4"});
                    return "redo-rate-attribute-4";
                }
            }
        },
        "select-label-type-5": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.select-label-type-second-curb-ramp'),
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
                    "fill": "white"
                }
            ],
            "transition": function () {
                _updateProgressBar(21);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-5", step: 21});
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
                "maxHeading": headingRanges["stage-3"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.common.label-curb-ramp'),
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
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(22);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-5", step: 22});
                    return "rate-severity-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-5"});
                    return "delete-attribute-5";
                }
            }]
        },
        "delete-attribute-5": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-5"});
                return "redo-select-label-type-5";
            }
        },
        "redo-select-label-type-5": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-5"});
                return "label-attribute-5";
            }
        },
        "rate-severity-5": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-curb-ramp') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(23);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6", step: 23});
                    return "select-label-type-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5"});
                    return "redo-rate-attribute-5";
                }
            }
        },
        "redo-rate-attribute-5": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(23);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6", step: 23});
                    return "select-label-type-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5"});
                    return "redo-rate-attribute-5";
                }
            }
        },
        "select-label-type-4-after-5": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.select-label-type-second-curb-ramp'),
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
                    "fill": "white"
                }

            ],
            "transition": function () {
                _updateProgressBar(21);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-4-after-5", step: 21});
                return "label-attribute-4-after-5";
            }
        },
        "label-attribute-4-after-5": {
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 4920,
                "imageY": -720,
                "tolerance": 300,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.common.label-curb-ramp'),
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
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(22);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-4-after-5", step: 22});
                    return "rate-severity-4-after-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-4-after-5"});
                    return "delete-attribute-4-after-5";
                }
            }]
        },
        "delete-attribute-4-after-5": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-4-after-5"});
                return "redo-select-label-type-4-after-5";
            }
        },
        "redo-select-label-type-4-after-5": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-4-after-5"});
                return "label-attribute-4-after-5";
            }
        },
        "rate-severity-4-after-5": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-4') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(23);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6", step: 23});
                    return "select-label-type-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4-after-5"});
                    return "redo-rate-attribute-4-after-5";
                }
            }
        },
        "redo-rate-attribute-4-after-5": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(23);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6", step: 23});
                    return "select-label-type-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4-after-5"});
                    return "redo-rate-attribute-4-after-5";
                }
            }
        },
        "rate-severity-5-goto-4": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-curb-ramp') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(20);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-4-after-5", step: 20});
                    return "select-label-type-4-after-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5-goto-4"});
                    return "redo-rate-attribute-5-goto-4";
                }
            }
        },
        "redo-rate-attribute-5-goto-4": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(20);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-4-after-5", step: 20});
                    return "select-label-type-4-after-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5-goto-4"});
                    return "redo-rate-attribute-5-goto-4";
                }
            }
        },
        "select-label-type-6": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-6'),
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
                    "fill": "white"
                }
            ],
            "transition": function () {
                _updateProgressBar(24);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-6", step: 24});
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
                "maxHeading": headingRanges["stage-3"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-6'),
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
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(25);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-6", step: 25});
                    return "rate-severity-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-6"});
                    return "delete-attribute-6";
                }
            }]
        },
        "delete-attribute-6": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-6"});
                return "redo-select-label-type-6";
            }
        },
        "redo-select-label-type-6": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('NoSidewalk-description')}),
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-6"});
                return "label-attribute-6";
            }
        },
        "rate-severity-6": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "NoSidewalk",
                "severity": 3,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no sidewalk quality ' +
                    'as 3, a slightly severe problem">',
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    _updateProgressBar(26);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-6", step: 26});
                    return "tag-attribute-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-6"});
                    return "redo-rate-attribute-6";
                }
            }
        },
        "redo-rate-attribute-6": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "NoSidewalk",
                "severity": 3,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no sidewalk quality ' +
                    'as 3, a slightly severe problem">',
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    _updateProgressBar(26);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-6", step: 26});
                    return "tag-attribute-6";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-6"});
                    return "redo-rate-attribute-6";
                }
            }
        },
        "tag-attribute-6": {
            "properties": {
                "action": "AddTag",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'ends abruptly\' and \'street has a sidewalk\' tags">',
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.length === 2 && tags.includes(20) && tags.includes(21)) {
                    // We have both tags correct, so lets continue.
                    contextMenu.hide();
                    _updateProgressBar(28);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-4", step: 28});
                    return "adjust-heading-angle-4";
                } else if (tags.length === 1 && (tags.includes(20) || tags.includes(21))) {
                    // We have one of the two tags so far, so stay in this state.
                    _updateProgressBar(27);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-6", step: 27});
                    return "tag-attribute-6";
                } else {
                    // A mistake was made, move to the redo state.
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-6"});
                    return "redo-tag-attribute-6";
                }
            }
        },
        "redo-tag-attribute-6": {
            "properties": {
                "action": "RedoAddTag",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-6') +
                    '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'ends abruptly\' and \'street has a sidewalk\' tags">',
                "parameters": null,
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.length === 2 && tags.includes(20) && tags.includes(21)) {
                    // We have both tags correct, so lets continue.
                    _updateProgressBar(28);
                    contextMenu.hide();
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-4", step: 28});
                    return "adjust-heading-angle-4";
                } else if (tags.includes(20) || tags.includes(21)) {
                    // We have at least one of the two tags so far, but not both. Move progress bar, stay in this state.
                    _updateProgressBar(27);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-6", step: 27});
                    return "redo-tag-attribute-6";
                } else {
                    // We don't have any correct tags, don't move progress bar forward, stay in same state.
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-6"});
                    return "redo-tag-attribute-6";
                }
            }
        },
        "adjust-heading-angle-4": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 0,
                "tolerance": 20,
                "minHeading": headingRanges["stage-4-adjust"][0],
                "maxHeading": headingRanges["stage-4-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-4'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(29);
                tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-7", step: 29});
                return "select-label-type-7";
            }
        },
        "select-label-type-7": {
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-7'),
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
                    "fill": "white"
                }
            ],
            "transition": function () {
                _updateProgressBar(30);
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-7", step: 30});
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
                "maxHeading": headingRanges["stage-4"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-7'),
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
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    _updateProgressBar(31);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-7", step: 31});
                    return "rate-severity-7";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "delete-attribute-7"});
                    return "delete-attribute-7";
                }
            }]
        },
        "delete-attribute-7": {
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`,
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-select-label-type-7"});
                return "redo-select-label-type-7";
            }
        },
        "redo-select-label-type-7": {
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', {label_type: i18next.t('CurbRamp-description')}),
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
                    "fill": null
                }
            ],
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-7"});
                return "label-attribute-7";
            }
        },
        "rate-severity-7": {
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "severity": null,
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-severity-curb-ramp') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(32);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-5", step: 32});
                    return "adjust-heading-angle-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-7"});
                    return "redo-rate-attribute-7";
                }
            }
        },
        "redo-rate-attribute-7": {
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "severity": 1,
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-curb-ramp-severity-1') +
                '<br><img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" ' +
                'alt="Rating curb ramp quality as 1, passable">',
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    _updateProgressBar(32);
                    tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-5", step: 32});
                    return "adjust-heading-angle-5";
                } else {
                    tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-7"});
                    return "redo-rate-attribute-7";
                }
            }
        },
        "adjust-heading-angle-5": {
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 346,
                "tolerance": 20,
                "minHeading": headingRanges["stage-5-adjust"][0],
                "maxHeading": headingRanges["stage-5-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-5'),
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(33);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-1", step: 33});
                return "walk-1";
            }
        },
        "walk-1": {
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
                "blinks": ["google-maps"]
            },
            "message": {
                "message": i18next.t('tutorial.walk-1'),
                "fade-direction": "fadeInLeft",
                "arrow": "right",
                "top": 270,
                "left": 405
            },
            "panoId": panoId,
            "transition": function () {
                _updateProgressBar(34);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-2", step: 34});

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
                "maxHeading": headingRanges["stage-5"][1]
            },
            "message": {
                "message": i18next.t('tutorial.walk-2'),
                "fade-direction": "fadeInDown",
                "arrow": "bottom",
                "top": 263,
                "left": 405
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(35);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-3", step: 35});
                return "walk-3";
            }
        },
        "walk-3": {
            "properties": {
                "action": "WalkTowards",
                "panoId": afterWalkPanoId,
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
                "fade-direction": "fadeIn"
            },
            "message": {
                "message": i18next.t('tutorial.walk-3'),
                "parameters": null
            },
            "panoId": panoId,
            "transition": function () {
                _updateProgressBar(36);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-4", step: 36});
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
                "blinks": ["google-maps"]
            },
            "message": {
                "message": i18next.t('tutorial.walk-4'),
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
                _updateProgressBar(37);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-5", step: 37});
                return "walk-5";
            }
        },
        "walk-5": {
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1]
            },
            "message": {
                "message": i18next.t('tutorial.walk-5-1'),
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
                    "fill": "yellow"
                },
                {
                    "type": "arrow",
                    "x": -2530,
                    "y": -470,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }

            ],
            okButtonText: i18next.t('tutorial.walk-5-2'),
            "transition": function () {
                _updateProgressBar(38);
                tracker.push('Onboarding_Transition', {onboardingTransition: "walk-6", step: 38});
                return "walk-6";
            }
         },
        "walk-6": {
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1]
            },
            "message": {
                "message": i18next.t('tutorial.walk-6-1') +
                '<img src="' + svl.rootDirectory + 'img/cursors/curbRampNeeded_small.png" style="width: 8%; height:auto" alt="Missing Curb Ramp Label">. ' +
                    i18next.t('tutorial.walk-6-2'),
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
                    "fill": "yellow"
                },
                {
                    "type": "arrow",
                    "x": -2530,
                    "y": -470,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }

            ],
            "transition": function () {
                _updateProgressBar(39);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-1", step: 39});
                return "instruction-1";
            }
        },
        "instruction-1": {
            "properties": {
                "action": "Instruction",
                "blinks": ["google-maps"],
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1]
            },
            "message": {
                "message": i18next.t('tutorial.instruction-1'),
                "arrow": "right",
                "fade-direction": "fadeInLeft",
                "top": 270,
                "left": 405
            },
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(40);
                tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-2", step: 40});
                return "instruction-2";
            }
        },
        "instruction-2": {
            "properties": {
                "action": "Instruction",
                "blinks": ["stuck"],
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1]
            },
            "message": {
                "message": i18next.t('tutorial.instruction-2'),
                "fade-direction": "fadeInRight",
                "arrow": "left",
                "top": 235,
                "left": 5
            },
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": function () {
                _updateProgressBar(41);
                tracker.push('Onboarding_Transition', {onboardingTransition: "outro", step: 41});
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
                "maxHeading": undefined
            },
            "message": {
                "message": function () {
                    return document.getElementById("onboarding-outro").innerHTML;
                },
                "width": 1000,
                "top": -50,
                "left": -70,
                "padding": "100px 10px 100px 10px",
                "background": true
            },
            "okButton": false,
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": function () {
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
