function OnboardingStates (contextMenu, compass, mapService, statusModel, tracker) {
    var panoId = "tutorial";
    var afterWalkPanoId = "afterWalkTutorial";
    var headingRanges = {
        "stage-1": [230, 233],
        "stage-2-adjust": [197, 242],
        "stage-2": [197, 209],
        "stage-3-adjust": [167, 197],
        "stage-3": [167, 187],
        "stage-4-adjust": [98, 187],
        "stage-4": [98, 108],
        "stage-5-adjust": [359, 108],
        "stage-5": [355, 1],
        "stage-6-adjust": [315, 1],
        "stage-6": [315, 343],
        "stage-7": [281, 14]
    };

    this.states = [
        {
            "id": "initialize",
            "progression": true,
            "properties": {
                "action": "Introduction",
                "heading": 230,
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
                var value = this.getAttribute("value");
                // If "Let's get started!" button is clicked.
                if (value === "OK") {
                    return "select-label-type-1";
                } else {
                    return "end-onboarding-skip";
                }
            }
        }, {
            "id": "end-onboarding-skip",
            "progression": false,
            "end-onboarding": {
                "skip": true
            }
        },
        {
            "id": "select-label-type-1",
            "progression": true,
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-1')
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": "label-attribute-1"
        },
        {
            "id": "label-attribute-1",
            "progression": true,
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 1170,
                "imageY": 3800,
                "tolerance": 300,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-1')
            },
            "panoId": panoId,
            "annotations": [
                {
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
                    return "rate-severity-1";
                } else {
                    return "delete-attribute-1";
                }
            }]
        },
        {
            "id": "delete-attribute-1",
            "progression": false,
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far-generic')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": "redo-select-label-type-1"
        },
        {
            "id": "redo-select-label-type-1",
            "progression": false,
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', { label_type: i18next.t('common:curb-ramp') })
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 9730,
                    "y": -350,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": "label-attribute-1"
        },
        {
            "id": "rate-severity-1",
            "progression": true,
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-1') +
                    '<br><img src="' + svl.rootDirectory + 'img/onboarding/RatingCurbRampQuality-severity-2-v3.gif" ' +
                    'class="width-75" style="margin: 5px auto;display:block;">'
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    return "select-label-type-2";
                } else {
                    return "redo-rate-attribute-1";
                }
            }
        },
        {
            "id": "redo-rate-attribute-1",
            "progression": false,
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-1') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingCurbRampQuality-severity-2-v3.gif` +
                    `" class="width-75" style="margin: 5px auto;display:block;"`
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    return "select-label-type-2";
                } else {
                    return "redo-rate-attribute-1";
                }
            }
        },
        {
            "id": "select-label-type-2",
            "progression": true,
            "properties": {
                "action": "SelectLabelType",
                "labelType": "Crosswalk",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-2')
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 8950,
                    "y": -300,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": "label-attribute-2"
        },
        {
            "id": "label-attribute-2",
            "progression": true,
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "Crosswalk",
                "imageX": 420,
                "imageY": 3800,
                "tolerance": 300,
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-2')
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 8950,
                    "y": -300,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    return "rate-severity-2";
                } else {
                    return "delete-attribute-2";
                }
            }]
        },
        {
            "id": "delete-attribute-2",
            "progression": false,
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "Crosswalk",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far-crosswalk')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 8950,
                    "y": -300,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": "redo-select-label-type-2"
        },
        {
            "id": "redo-select-label-type-2",
            "progression": false,
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "Crosswalk",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', { label_type: i18next.t('common:crosswalk') })
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 8950,
                    "y": -300,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": "label-attribute-2"
        },
        {
            "id": "rate-severity-2",
            "progression": true,
            "properties": {
                "action": "RateSeverity",
                "labelType": "Crosswalk",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-crosswalk-sev-1')
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    return "adjust-heading-angle-1";
                } else {
                    return "redo-rate-attribute-2";
                }
            }
        },
        {
            "id": "redo-rate-attribute-2",
            "progression": false,
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "Crosswalk",
                "minHeading": headingRanges["stage-1"][0],
                "maxHeading": headingRanges["stage-1"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-crosswalk-sev-1')
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    return "adjust-heading-angle-1";
                } else {
                    return "redo-rate-attribute-2";
                }
            }
        },
        {
            "id": "adjust-heading-angle-1",
            "progression": true,
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 210,
                "tolerance": 20,
                "minHeading": headingRanges["stage-2-adjust"][0],
                "maxHeading": headingRanges["stage-2-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-1')
            },
            "panoId": panoId,
            "annotations": null,
            "transition": "zoom-in"
        },
        {
            "id": "zoom-in",
            "progression": true,
            "properties": {
                "action": "Zoom",
                "type": "in",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.zoom-in'),
                "arrow": "left",
                "fade-direction": "fadeInRightCustom",
                "top": 30,
                "transform": "true"
            },
            "panoId": panoId,
            "annotations": null,
            "transition": "select-label-type-3"
        },
        {
            "id": "select-label-type-3",
            "progression": true,
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-3')
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
            "transition": "label-attribute-3"
        },
        {
            "id": "label-attribute-3",
            "progression": true,
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 12950,
                "imageY": 3720,
                "tolerance": 300,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-3')
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
                    return "rate-severity-3";
                } else {
                    return "delete-attribute-3";
                }
            }]
        },
        {
            "id": "delete-attribute-3",
            "progression": false,
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far-generic')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`
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
            "transition": "redo-select-label-type-3"
        },
        {
            "id": "redo-select-label-type-3",
            "progression": false,
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', { label_type: i18next.t('common:curb-ramp') })
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
            "transition": "label-attribute-3"
        },
        {
            "id": "rate-severity-3",
            "progression": true,
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-3') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif" ` +
                    'class="width-75" style="margin: 5px auto;display:block;">'
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 2) {
                    return "tag-attribute-3";
                } else {
                    return "redo-rate-attribute-3";
                }
            }
        },
        {
            "id": "redo-rate-attribute-3",
            "progression": false,
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-3') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">'
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 2) {
                    return "tag-attribute-3";
                } else {
                    return "redo-rate-attribute-3";
                }
            }
        },
        {
            "id": "tag-attribute-3",
            "progression": true,
            "properties": {
                "action": "AddTag",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-3') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">'
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(23) && tags.length === 1) { // 23 is the id of the "not enough landing space" tag.
                    contextMenu.hide();
                    return "select-label-type-4";
                } else {
                    return "redo-tag-attribute-3";
                }
            }
        },
        {
            "id": "redo-tag-attribute-3",
            "progression": false,
            "properties": {
                "action": "RedoAddTag",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-3') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingCurbRamp-no-tag-severity-2-v2.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">'
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(23) && tags.length === 1) { // 23 is the id of the "not enough landing space" tag.
                    contextMenu.hide();
                    return "select-label-type-4";
                } else {
                    return "redo-tag-attribute-3";
                }
            }
        },
        {
            "id": "select-label-type-4",
            "progression": true,
            "properties": {
                "action": "SelectLabelType",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-4')
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
            "transition": "label-attribute-4"
        },
        {
            "id": "label-attribute-4",
            "progression": true,
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "NoCurbRamp",
                "imageX": 12560,
                "imageY": 3720,
                "tolerance": 300,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-4')
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
                    return "rate-severity-4";
                } else {
                    return "delete-attribute-4";
                }
            }]
        },
        {
            "id": "delete-attribute-4",
            "progression": false,
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far-generic')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`
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
            "transition": "redo-select-label-type-4"
        },
        {
            "id": "redo-select-label-type-4",
            "progression": false,
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', { label_type: i18next.t('common:no-curb-ramp') })
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
            "transition": "label-attribute-4"
        },
        {
            "id": "rate-severity-4",
            "progression": true,
            "properties": {
                "action": "RateSeverity",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-4') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingNoCurbRampSeverity-v2.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">'
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    return "tag-attribute-4";
                } else {
                    return "redo-rate-attribute-4";
                }
            }
        },
        {
            "id": "redo-rate-attribute-4",
            "progression": false,
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-4') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingNoCurbRampSeverity-v2.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">'
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    return "tag-attribute-4";
                } else {
                    return "redo-rate-attribute-4";
                }
            }
        },
        {
            "id": "tag-attribute-4",
            "progression": true,
            "properties": {
                "action": "AddTag",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-4') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingNoCurbRampSeverity-v2.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">'
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(5) && tags.length === 1) { // 5 is the id of the "alternate route present" tag.
                    contextMenu.hide();
                    return "select-label-type-5";
                } else {
                    return "redo-tag-attribute-4";
                }
            }
        },
        {
            "id": "redo-tag-attribute-4",
            "progression": false,
            "properties": {
                "action": "RedoAddTag",
                "labelType": "NoCurbRamp",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-4') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingNoCurbRampSeverity-v2.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">'
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.includes(5) && tags.length === 1) { // 5 is the id of the "alternate route present" tag.
                    contextMenu.hide();
                    return "select-label-type-5";
                } else {
                    return "redo-tag-attribute-4";
                }
            }
        },
        {
            "id": "select-label-type-5",
            "progression": true,
            "properties": {
                "action": "SelectLabelType",
                "labelType": "Signal",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-5')
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7705,
                    "y": -285,
                    "length": 50,
                    "angle": 0
                },
                {
                    "type": "box",
                    "x": 7735,
                    "y": 64,
                    "width": 30,
                    "height": 46
                }
            ],
            "transition": "label-attribute-5"
        },
        {
            "id": "label-attribute-5",
            "progression": true,
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "Signal",
                "imageX": 12500,
                "imageY": 3690,
                "tolerance": 200,
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-5')
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7705,
                    "y": -285,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                },
                {
                    "type": "box",
                    "x": 7735,
                    "y": 64,
                    "width": 30,
                    "height": 46
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    contextMenu.hide();
                    return "zoom-out";
                } else {
                    return "delete-attribute-5";
                }
            }]
        },
        {
            "id": "delete-attribute-5",
            "progression": false,
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "Signal",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far-signal')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7705,
                    "y": -285,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                },
                {
                    "type": "box",
                    "x": 7735,
                    "y": 64,
                    "width": 30,
                    "height": 46
                }
            ],
            "transition": "redo-select-label-type-5"
        },
        {
            "id": "redo-select-label-type-5",
            "progression": false,
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "Signal",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', { label_type: i18next.t('common:signal') })
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7705,
                    "y": -285,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                },
                {
                    "type": "box",
                    "x": 7735,
                    "y": 64,
                    "width": 30,
                    "height": 46
                }
            ],
            "transition": "label-attribute-5"
        },
        {
            "id": "zoom-out",
            "progression": true,
            "properties": {
                "action": "Zoom",
                "type": "out",
                "minHeading": headingRanges["stage-2"][0],
                "maxHeading": headingRanges["stage-2"][1]
            },
            "message": {
                "message": i18next.t('tutorial.zoom-out'),
                "fade-direction": "fadeInRight",
                "arrow": "left",
                "top": 30
            },
            "panoId": panoId,
            "annotations": null,
            "transition": "adjust-heading-angle-2"
        },
        {
            "id": "adjust-heading-angle-2",
            "progression": true,
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 187,
                "tolerance": 20,
                "minHeading": headingRanges["stage-3-adjust"][0],
                "maxHeading": headingRanges["stage-3-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-2')
            },
            "panoId": panoId,
            "annotations": null,
            "transition": "select-label-type-6"
        },
        {
            "id": "select-label-type-6",
            "progression": true,
            "properties": {
                "action": "SelectLabelType",
                "labelType": "Crosswalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-6')
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7050,
                    "y": -450,
                    "length": 50,
                    "angle": 0
                }
            ],
            "transition": "label-attribute-6"
        },
        {
            "id": "label-attribute-6",
            "progression": true,
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "Crosswalk",
                "imageX": 11850,
                "imageY": 3980,
                "tolerance": 350,
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-6')
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7050,
                    "y": -450,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    return "rate-severity-6";
                } else {
                    return "delete-attribute-6";
                }
            }]
        },
        {
            "id": "delete-attribute-6",
            "progression": false,
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "Crosswalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far-crosswalk')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7050,
                    "y": -450,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": "redo-select-label-type-6"
        },
        {
            "id": "redo-select-label-type-6",
            "progression": false,
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "Crosswalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', { label_type: i18next.t('common:crosswalk') })
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 7050,
                    "y": -450,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                }
            ],
            "transition": "label-attribute-6"
        },
        {
            "id": "rate-severity-6",
            "progression": true,
            "properties": {
                "action": "RateSeverity",
                "labelType": "Crosswalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.rate-crosswalk-sev-1')
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    return "adjust-heading-angle-3";
                } else {
                    return "redo-rate-attribute-6";
                }
            }
        },
        {
            "id": "redo-rate-attribute-6",
            "progression": false,
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "Crosswalk",
                "minHeading": headingRanges["stage-3"][0],
                "maxHeading": headingRanges["stage-3"][1]
            },
            "message": {
                "message": i18next.t('tutorial.common.redo-rate-crosswalk-sev-1')
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    return "adjust-heading-angle-3";
                } else {
                    return "redo-rate-attribute-6";
                }
            }
        },
        {
            "id": "adjust-heading-angle-3",
            "progression": true,
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 115,
                "tolerance": 20,
                "minHeading": headingRanges["stage-4-adjust"][0],
                "maxHeading": headingRanges["stage-4-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-3'),
                "width": 190
            },
            "panoId": panoId,
            "annotations": null,
            "transition": "speed-things-up"
        },
        {
            "id": "speed-things-up",
            "progression": true,
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.speed-things-up')
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "label",
                    "labelType": "Crosswalk",
                    "x": 2150,
                    "y": -1150,
                    "lat": 38.94048737098884,
                    "lng": -77.06751796530399,
                    "keepUntil": "select-label-type-8"
                },
                {
                    "type": "label",
                    "labelType": "CurbRamp",
                    "x": 3850,
                    "y": -975,
                    "lat": 38.94039365744705,
                    "lng": -77.06749504111177,
                    "keepUntil": "select-label-type-8"
                },
                {
                    "type": "label",
                    "labelType": "CurbRamp",
                    "x": 4925,
                    "y": -850,
                    "lat": 38.940334177869914,
                    "lng": -77.06752911216995,
                    "keepUntil": "select-label-type-8"
                },
                {
                    "type": "label",
                    "labelType": "Signal",
                    "x": 5225,
                    "y": -650,
                    "lat": 38.94030890329519,
                    "lng": -77.06755034635032,
                    "keepUntil": "select-label-type-8"
                }
            ],
            "transition": 'select-label-type-7'
        },
        {
            "id": "select-label-type-7",
            "progression": true,
            "properties": {
                "action": "SelectLabelType",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-7')
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
            "transition": "label-attribute-7"
        },
        {
            "id": "label-attribute-7",
            "progression": true,
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "NoSidewalk",
                "imageX": 7550,
                "imageY": 3900,
                "tolerance": 300,
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-7')
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
                    return "rate-severity-7";
                } else {
                    return "delete-attribute-7";
                }
            }]
        },
        {
            "id": "delete-attribute-7",
            "progression": false,
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far-generic')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`
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
            "transition": "redo-select-label-type-7"
        },
        {
            "id": "redo-select-label-type-7",
            "progression": false,
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', { label_type: i18next.t('no-sidewalk') })
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
            "transition": "label-attribute-7"
        },
        {
            "id": "rate-severity-7",
            "progression": true,
            "properties": {
                "action": "RateSeverity",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-7') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingMissingSidewalk.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">',
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    return "tag-attribute-7";
                } else {
                    return "redo-rate-attribute-7";
                }
            }
        },
        {
            "id": "redo-rate-attribute-7",
            "progression": false,
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-7') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingMissingSidewalk.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">',
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 3) {
                    return "tag-attribute-7";
                } else {
                    return "redo-rate-attribute-7";
                }
            }
        },
        {
            "id": "tag-attribute-7",
            "progression": true,
            "properties": {
                "action": "AddTag",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.tag-attribute-7') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingMissingSidewalk.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">',
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.length === 2 && tags.includes(20) && tags.includes(21)) {
                    // We have both tags correct, so lets continue.
                    contextMenu.hide();
                    return "adjust-heading-angle-4";
                } else if (tags.length === 1 && (tags.includes(20) || tags.includes(21))) {
                    // We have one of the two tags so far, so stay in this state.
                    return "tag-attribute-7";
                } else {
                    // A mistake was made, move to the redo state.
                    return "redo-tag-attribute-7";
                }
            }
        },
        {
            "id": "redo-tag-attribute-7",
            "progression": false,
            "properties": {
                "action": "RedoAddTag",
                "labelType": "NoSidewalk",
                "minHeading": headingRanges["stage-4"][0],
                "maxHeading": headingRanges["stage-4"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-tag-attribute-7') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingMissingSidewalk.gif` +
                    '" class="width-75" style="margin: 5px auto;display:block;">',
                "left": 410
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var tags = this.getProperty('tagIds');
                if (tags.length === 2 && tags.includes(20) && tags.includes(21)) {
                    // We have both tags correct, so let's continue.
                    contextMenu.hide();
                    return "adjust-heading-angle-4";
                } else if (tags.includes(20) || tags.includes(21)) {
                    // We have at least one of the two tags so far, but not both. Move progress bar, stay in this state.
                    return "redo-tag-attribute-7";
                } else {
                    // We don't have any correct tags, don't move progress bar forward, stay in same state.
                    return "redo-tag-attribute-7";
                }
            }
        },
        {
            "id": "adjust-heading-angle-4",
            "progression": true,
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 0,
                "tolerance": 20,
                "minHeading": headingRanges["stage-5-adjust"][0],
                "maxHeading": headingRanges["stage-5-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-4')
            },
            "panoId": panoId,
            "annotations": null,
            "transition": "select-label-type-8"
        },
        {
            "id": "select-label-type-8",
            "progression": true,
            "properties": {
                "action": "SelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-8')
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
            "transition": "label-attribute-8"
        },
        {
            "id": "label-attribute-8",
            "progression": true,
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "CurbRamp",
                "imageX": 5550,
                "imageY": 4080,
                "tolerance": 250,
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-8')
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
                    return "rate-severity-8";
                } else {
                    return "delete-attribute-8";
                }
            }]
        },
        {
            "id": "delete-attribute-8",
            "progression": false,
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far-generic')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`
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
            "transition": "redo-select-label-type-8"
        },
        {
            "id": "redo-select-label-type-8",
            "progression": false,
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', { label_type: i18next.t('common:curb-ramp') })
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
            "transition": "label-attribute-8"
        },
        {
            "id": "rate-severity-8",
            "progression": true,
            "properties": {
                "action": "RateSeverity",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1]
            },
            "message": {
                "message": i18next.t('tutorial.rate-severity-8') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingCurbRampQuality-v3.gif` +
                    `" class="width-75" style="margin: 5px auto;display:block;" `
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    return "select-label-type-9";
                } else {
                    return "redo-rate-attribute-8";
                }
            }
        },
        {
            "id": "redo-rate-attribute-8",
            "progression": false,
            "properties": {
                "action": "RedoRateSeverity",
                "labelType": "CurbRamp",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1]
            },
            "message": {
                "message": i18next.t('tutorial.redo-rate-attribute-8') +
                    `<br><img src="${svl.rootDirectory}img/onboarding/RatingCurbRampQuality-v3.gif` +
                    `" class="width-75" style="margin: 5px auto;display:block;" `
            },
            "panoId": panoId,
            "annotations": null,
            "transition": function () {
                var severity = parseInt(this.getAttribute("value"), 10);
                if (severity === 1) {
                    contextMenu.hide();
                    return "select-label-type-9";
                } else {
                    return "redo-rate-attribute-8";
                }
            }
        },
        {
            "id": "select-label-type-9",
            "progression": true,
            "properties": {
                "action": "SelectLabelType",
                "labelType": "Signal",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1]
            },
            "message": {
                "message": i18next.t('tutorial.select-label-type-9')
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 225,
                    "y": -750,
                    "length": 50,
                    "angle": 0
                },
                {
                    "type": "box",
                    "x": 255,
                    "y": 440,
                    "width": 45,
                    "height": 65
                }
            ],
            "transition": "label-attribute-9"
        },
        {
            "id": "label-attribute-9",
            "progression": true,
            "properties": [{
                "action": "LabelAccessibilityAttribute",
                "labelType": "Signal",
                "imageX": 5015,
                "imageY": 4260,
                "tolerance": 200,
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1]
            }],
            "message": {
                "message": i18next.t('tutorial.label-attribute-9')
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 225,
                    "y": -750,
                    "length": 50,
                    "angle": 0,
                    "fill": "yellow"
                },
                {
                    "type": "box",
                    "x": 255,
                    "y": 440,
                    "width": 45,
                    "height": 65
                }
            ],
            "transition": [function (params) {
                if (params.accurate) {
                    contextMenu.hide();
                    return "adjust-heading-angle-5";
                } else {
                    return "delete-attribute-9";
                }
            }]
        },
        {
            "id": "delete-attribute-9",
            "progression": false,
            "properties": {
                "action": "DeleteAccessibilityAttribute",
                "labelType": "Signal",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
            },
            "message": {
                "message": `${i18next.t('tutorial.common.label-too-far-signal')} <img src="${svl.rootDirectory}img/icons/Icon_Delete.png" style="width: 6%; height:auto" alt="Delete Icon">`
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 225,
                    "y": -750,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                },
                {
                    "type": "box",
                    "x": 255,
                    "y": 440,
                    "width": 45,
                    "height": 65
                }
            ],
            "transition": "redo-select-label-type-9"
        },
        {
            "id": "redo-select-label-type-9",
            "progression": false,
            "properties": {
                "action": "RedoSelectLabelType",
                "labelType": "Signal",
                "minHeading": headingRanges["stage-5"][0],
                "maxHeading": headingRanges["stage-5"][1],
            },
            "message": {
                "message": i18next.t('tutorial.common.re-label', { label_type: i18next.t('common:signal') })
            },
            "panoId": panoId,
            "annotations": [
                {
                    "type": "arrow",
                    "x": 225,
                    "y": -750,
                    "length": 50,
                    "angle": 0,
                    "fill": null
                },
                {
                    "type": "box",
                    "x": 255,
                    "y": 440,
                    "width": 45,
                    "height": 65
                }
            ],
            "transition": "label-attribute-9"
        },
        {
            "id": "adjust-heading-angle-5",
            "progression": true,
            "properties": {
                "action": "AdjustHeadingAngle",
                "heading": 346,
                "tolerance": 20,
                "minHeading": headingRanges["stage-6-adjust"][0],
                "maxHeading": headingRanges["stage-6-adjust"][1]
            },
            "message": {
                "message": i18next.t('tutorial.adjust-heading-angle-5')
            },
            "panoId": panoId,
            "annotations": null,
            "transition": "walk-1"
        },
        {
            "id": "walk-1",
            "progression": true,
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1],
                "blinks": ["minimap"]
            },
            "message": {
                "message": i18next.t('tutorial.walk-1'),
                "fade-direction": "fadeInLeft",
                "arrow": "right",
                "top": 310,
                "left": 405
            },
            "panoId": panoId,
            "transition": function () {

                // Set Compass Message
                var uiCompassMessageHolder = compass.getCompassMessageHolder();
                var image = "<img src='" + compass.directionToImagePath("straight") + "' class='compass-turn-images' alt='Turn icon' />";
                var message = "<span class='compass-message-small'>" + i18next.t('center-ui.compass.unlabeled-problems') +
                    "</span><br/>" + image + "<span class='bold'>" + i18next.t('center-ui.compass.straight') + "</span>";
                uiCompassMessageHolder.message.html(message);
                compass.showMessage();
                return "walk-2";
            }
        },
        {
            "id": "walk-2",
            "progression": true,
            "properties": {
                "action": "Instruction",
                "blinks": ["compass"],
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1]
            },
            "message": {
                "message": i18next.t('tutorial.walk-2'),
                "fade-direction": "fadeInDown",
                "arrow": "bottom",
                "top": 225,
                "left": 405
            },
            "panoId": panoId,
            "annotations": null,
            "transition": "walk-3"
        },
        {
            "id": "walk-3",
            "progression": true,
            "properties": {
                "action": "WalkTowards",
                "blinks": ["compass", "movement-arrow"],
                "panoId": afterWalkPanoId,
                "minHeading": headingRanges["stage-6"][0],
                "maxHeading": headingRanges["stage-6"][1],
                "fade-direction": "fadeIn"
            },
            "message": {
                "message": i18next.t('tutorial.walk-3')
            },
            "panoId": panoId,
            "transition": function () {
                mapService.setPov({heading: 329, pitch: 0, zoom: 1});
                svl.ui.minimap.holder.css('backgroundImage', `url('${svl.rootDirectory}img/onboarding/afterWalkTutorialMiniMap.jpg')`);
                return "walk-4";
            }
        },
        {
            "id": "walk-4",
            "progression": true,
            "properties": {
                "action": "Instruction",
                "stopBlinking": true,
                "minHeading": headingRanges["stage-7"][0],
                "maxHeading": headingRanges["stage-7"][1],
                "blinks": ["minimap"]
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
            "transition": "walk-5"
        },
        {
            "id": "walk-5",
            "progression": true,
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-7"][0],
                "maxHeading": headingRanges["stage-7"][1]
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
            "transition": "walk-6"
        },
        {
            "id": "walk-6",
            "progression": true,
            "properties": {
                "action": "Instruction",
                "minHeading": headingRanges["stage-7"][0],
                "maxHeading": headingRanges["stage-7"][1]
            },
            "message": {
                "message": i18next.t('tutorial.walk-6'),
                "width": 400,
                "fade-direction": "fadeIn"
            },
            "panoId": afterWalkPanoId,
            "annotations": [
                {
                    "type": "label",
                    "labelType": "Signal",
                    "x": 10510,
                    "y": -500,
                    "lat": 38.940656819984454,
                    "lng": -77.06787178273665,
                    "keepUntil": "outro"
                },
                {
                    "type": "label",
                    "labelType": "NoCurbRamp",
                    "x": 10800,
                    "y": -525,
                    "lat": 38.94067750463137,
                    "lng": -77.06786106607106,
                    "keepUntil": "outro"
                },
                {
                    "type": "label",
                    "labelType": "Crosswalk",
                    "x": 12150,
                    "y": -785,
                    "lat": 38.940735726268095,
                    "lng": -77.06778530284552,
                    "keepUntil": "outro"
                },
                {
                    "type": "label",
                    "labelType": "NoCurbRamp",
                    "x": 225,
                    "y": -700,
                    "lat": 38.94076274068959,
                    "lng": -77.0676653183858,
                    "keepUntil": "outro"
                },
                {
                    "type": "label",
                    "labelType": "Signal",
                    "x": 510,
                    "y": -600,
                    "lat": 38.94076199025627,
                    "lng": -77.06763764329555,
                    "keepUntil": "outro"
                },

            ],
            "transition": "instruction-1"
        },
        {
            "id": "instruction-1",
            "progression": true,
            "properties": {
                "action": "Instruction",
                "blinks": ["minimap"],
                "minHeading": headingRanges["stage-7"][0],
                "maxHeading": headingRanges["stage-7"][1]
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
            "transition": "instruction-2"
        },
        {
            "id": "instruction-2",
            "progression": true,
            "properties": {
                "action": "Instruction",
                "blinks": ["stuck"],
                "minHeading": headingRanges["stage-7"][0],
                "maxHeading": headingRanges["stage-7"][1]
            },
            "message": {
                "message": i18next.t('tutorial.instruction-2'),
                "fade-direction": "fadeInRight",
                "arrow": "left",
                "top": 265,
                "left": 5
            },
            "panoId": afterWalkPanoId,
            "annotations": null,
            "transition": "outro"
        },
        {
            "id": "outro",
            "progression": true,
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
            "transition": "end-onboarding"
        },
        {
            "id": "end-onboarding",
            "progression": false,
            "end-onboarding": {
                "skip": false
            }
        }
    ];

    this.get = function () { return this.states; };
}
