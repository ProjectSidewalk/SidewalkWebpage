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
                "message": 'Good! Now <span class="bold">click the curb ramp</span> ' +
                'beneath the flashing yellow arrow to label it.',
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
                "severity": 2,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
                "maxLabelCount": 1
            },
            "message": {
                "message": 'Now you can rate the quality of the curb ramp where 1 is passable and 5 is not passable ' +
                    'for a wheelchair user. Because it points into traffic a bit ' +
                '<span class="bold">let’s rate it as 2, somewhat passable.</span><br> ' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" +
                '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 2, passable">',
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
                return severity == 2 ? "tag-attribute-1" : "redo-rate-attribute-1"
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
                "message": 'Uh-oh, you should rate this curb ramp as 2, somewhat passable. It is a high quality curb ' +
                    'ramp but points into traffic a bit. ' +
                '<span class="bold">Let’s click "2" to set its quality.</span><br> ' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" +
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
                return severity === 2 ? "tag-attribute-1" : "redo-rate-attribute-1"
            }
        },
        "tag-attribute-1": {
            "properties": {
                "action": "AddTag",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
                "maxLabelCount": 1
            },
            "message": {
                "message": 'Every label includes optional tags that add descriptive information. Choose appropriate tags for every label you place! ' +
                    '<span class="bold">Let\'s add the “points into traffic” tag,</span> since this ramp points into the street.<br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'points into traffic\' tag">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var completedRate = 5 / numStates;
                statusModel.setMissionCompletionRate(completedRate);
                statusModel.setProgressBar(completedRate);
                tracker.push('Onboarding_Transition', {onboardingTransition: "tag-attribute-1"});
                var tags = this.getProperty('tagIds');
                return tags.includes(2) && tags.length === 1 ? "adjust-heading-angle-1" : "redo-tag-attribute-1" // Where 2 is the tag_id of the "points into traffic" tag
            }
        },
        "redo-tag-attribute-1": {
            "properties": {
                "action": "RedoAddTag",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
                "maxLabelCount": 1
            },
            "message": {
                "message": 'The "points into traffic" tag is the only tag that applies here, since the curb ramp has a ' +
                    'friction strip, is not too narrow, and is not too steep. So add <span class="bold">only the "points into traffic" tag.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" +
                    '" class="width-75" style="margin: 5px auto;display:block;" alt="Adding the \'points into traffic\' tag">',
                "position": "top-right",
                "parameters": null
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                tracker.push('Onboarding_Transition', {onboardingTransition: "redo-tag-attribute-1"});
                var tags = this.getProperty('tagIds');
                return tags.includes(2) && tags.length === 1 ? "adjust-heading-angle-1" : "redo-tag-attribute-1" // Where 2 is the tag_id of the "points into traffic" tag
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
                "message": 'Great! Let’s adjust the view to look at another corner of the intersection. ' +
                '<span class="bold">Grab and drag the Street View image to look left.</span>',
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
                "message": 'Hmm, it looks like the intersection corner is too far away to see clearly. ' +
                '<span class="bold">Click the “Zoom In” button</span> to get a closer look.',
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
                "message": 'Great! Now you’ve found another curb ramp. Let’s label it! ' +
                '<span class="bold">Click the “Curb Ramp” button</span> like before.',
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
                "message": 'Now <span class="bold">click the curb ramp</span> beneath the flashing yellow arrow to label it.',
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
                "message": 'Good, now <span class="bold">rate the quality</span> of the curb ramp.<br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" + '" ' +
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
                "message": 'Uh-oh, you should rate this curb ramp as 2, somewhat passable. It is a high quality curb ' +
                    'ramp but it has no landing space at the top of the ramp for making turns. ' +
                '<span class="bold">Let’s click "2" to set its quality.</span><br> ' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
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
                "message": 'Let\'s add the <span class="bold">"not enough landing space tag"</span> because there is ' +
                    'not enough space for a wheelchair user to turn when they get to the top of the ramp.<br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
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
                "message": 'Only the "not enough landing space" tag applies here, since the curb ramp has a ' +
                    'friction strip, is not too narrow nor steep, and does not point into traffic. ' +
                    'So add <span class="bold">only the "not enough landing space" tag.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" +
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
                "message": 'Notice that there is no curb ramp at the end of this crosswalk. ' +
                '<span class="bold">Click the "Missing Curb Ramp" button</span> to label it.',
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
                "message": 'Now click beneath the flashing yellow arrow to <span class="bold">label the missing ' +
                'curb ramp.</span>',
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
                "message": 'Since this missing curb ramp is next to an existing curb ramp, this accessibility problem' +
                    ' is less severe. So <span class="bold">let’s rate it as a 3.</span> When you rate accessibility,' +
                    ' we just ask that you <span class="bold">use your best judgment!</span><br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
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
                "message": 'Hmm, since this missing curb ramp is next to an existing curb ramp, this accessibility ' +
                    'problem is less severe. ' +
                '<span class="bold">Let’s click "3" to change the severity of the missing curb ramp.</span><br> ' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
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
                "message": '<span class="bold">Let\'s add the "alternate route present" tag</span> because there is a nearby curb ramp that could be used.<br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
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
                "message": 'The "alternate route present" tag is the only tag that applies here because there is a nearby curb ramp that could be used.' +
                    ' So add <span class="bold">only the "alternate route present" tag.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity-v2.gif" +
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
                "message": 'Now let’s zoom out and look at the next intersection corner. ' +
                '<span class="bold">Click the “Zoom Out” button</span>.',
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
                "message": 'Look to the left by <span class="bold">grabbing and dragging the Street View image.</span>',
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
                "message": 'Keep looking <span class="bold">left</span>.',
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
                "message": 'OK, this corner has two curb ramps. Let’s label them both! ' +
                '<span class="bold">Click the "Curb Ramp" button.</span>',
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
                "message": 'Now <span class="bold">click on one of the curb ramps</span> to label it.',
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
                "message": 'Now <span class="bold">rate the curb ramp’s quality</span>. ' +
                'Use your best judgment. You can also write notes in the <span class="bold">Description Box.</span><br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
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
                "message": 'Hmm, you should rate this curb ramp as 1, passable. This curb ramp is wide enough, has a ' +
                    'friction strip, and doesn\'t point into traffic. ' +
                '<span class="bold">Let’s click "1" to change its rating.</span><br> ' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
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
                "message": '<span class="bold">Click the "Curb Ramp" button</span> to label the other curb ramp now.',
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
                "message": 'Now <span class="bold">click the curb ramp</span> beneath the flashing yellow arrow to label it.',
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
                "message": '<span class="bold">Let’s rate the quality</span> of the curb ramp.<br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
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
                "message": 'Hmm, you should rate this curb ramp as 1, passable. This curb ramp is wide enough, has a ' +
                    'friction strip, and doesn\'t point into traffic. ' +
                '<span class="bold">Let’s click "1" to change its rating.</span><br> ' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
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
                "message": '<span class="bold">Click the "Curb Ramp" button</span> to label the other curb ramp now.',
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
                "message": 'Now <span class="bold">click the curb ramp</span> beneath the flashing yellow arrow to label it.',
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
                "message": 'Now <span class="bold">rate the curb ramp’s quality</span>. ' +
                'Use your best judgment. You can also write notes in the <span class="bold">Description Box.</span><br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
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
                "message": 'Hmm, you should rate this curb ramp as 1, passable. This curb ramp is wide enough, has a ' +
                    'friction strip, and doesn\'t point into traffic. ' +
                '<span class="bold">Let’s click "1" to change its rating.</span><br> ' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
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
                "message": '<span class="bold">Let’s rate the quality</span> of the curb ramp.<br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
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
                "message": 'Hmm, you should rate this curb ramp as 1, passable. This curb ramp is wide enough, has a ' +
                    'friction strip, and doesn\'t point into traffic. ' +
                '<span class="bold">Let’s click "1" to change its rating.</span><br> ' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
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
                "message": 'Notice that the sidewalk suddenly ends here. Let’s label this. ' +
                'Click the <span class="bold">"No Sidewalk"</span> button to label it.',
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
                "message": '<span class="bold">Click on the ground</span> where the sidewalk is missing.',
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
                "message": 'Since there is a sidewalk on the other side of the street, this accessibility problem is ' +
                    'less severe. So <span class="bold">let’s rate it as a 3.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
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
                "message": 'Hmm, since there is a sidewalk on the other side of the street, this accessibility ' +
                    'problem is less severe. <span class="bold">Let’s click "3" to change the severity of the no ' +
                    'sidewalk label.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
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
                "message": '<span class="bold">Let\'s add the "ends abruptly" and "street has a sidewalk" tags</span> because there is a sidewalk on the other side of the street.<br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
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
                "message": 'The "ends abruptly" and "street has a sidewalk" tags are the only tags that apply here.' +
                    ' So <span class="bold">make sure to add only those two tags.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingMissingSidewalk.gif" +
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
                "message": 'Awesome! Let’s finish labeling the last curb ramp in the intersection. ' +
                'First, <span class="bold">grab and drag the Street View image.</span>',
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
                "message": 'Good! Now <span class="bold">click the "Curb Ramp" button</span> on the menu to label it.',
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
                "message": '<span class="bold">Click the curb ramp</span> beneath the flashing yellow arrow to label it.',
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
                "message": '<span class="bold">Let’s rate the quality</span> of the curb ramp.<br>' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
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
                "message": 'Hmm, you should rate this curb ramp as 1, passable. This curb ramp is wide enough, has a ' +
                    'friction strip, and doesn\'t point into traffic. ' +
                '<span class="bold">Let’s click "1" to change its rating.</span><br> ' +
                '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality-v3.gif" +
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
                "message": 'Great Job! We are almost done. Now let’s learn how to walk. ' +
                '<span class="bold">Grab and drag the Street View image</span>.',
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
                "message": 'Good! Now to figure out where to walk, you will follow the ' +
                '<span class="bold" style="color: #ff0000;">red</span> line on this mini map.',
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
                var message =  "<span class='compass-message-small'>Do you see any unlabeled problems? If not,</span><br/>" +
                    image + "<span class='bold'>Walk straight</span>";
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
                "message": 'We will also guide you via <span class="bold">navigation messages</span> ' +
                'shown in this area.',
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
                "message": 'Now let’s actually take a step! <span class="bold">' +
                'Double click on the street</span> in the direction you want to move. ' +
                'In this case, double click in the circle below.',
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
                "message": 'Great! You just moved one step down the street. Visited parts of a route are marked in ' +
                '<span class= "bold" style="color: #3c763d;">green</span> in the mini map.',
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
                "message": 'Now you can look for more issues at this ' +
                'location. In this case, notice how there is a crosswalk with <span class="bold">no curb ramps</span>.',
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
            okButtonText: "Yes! I see the missing curb ramps.",
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
                "message": 'Ordinarily, you would label the areas under the flashing arrows with a Missing Curb Ramp ' +
                '<img src="' + svl.rootDirectory + "img/cursors/Cursor_NoCurbRamp.png" +
                '" style="width: 8%; height:auto" alt="Missing Curb Ramp Label">. ' +
                'However, we want to get you started on actual missions, so let’s <span class="bold">finish this ' +
                'tutorial!</span>',
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
                "message": 'You can track <span class="bold">your labels</span> in the mini map!',
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
                "message": 'Finally, if you get stuck while walking, you can use the ' +
                '<span class="bold">Jump button</span> to move to a different location.',
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

