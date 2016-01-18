/**
 * Created with JetBrains PhpStorm.
 * User: kotarohara
 * Date: 8/19/13
 * Time: 1:02 PM
 * To change this template use File | Settings | File Templates.
 */
var svw = svw || {};

function Onboarding_LabelingCurbRampsDifficultScene2 (params, $) {
    var oPublic = {
        className : 'Onboarding_LabelingCurbRampsDifficultScene'
    };
    var properties = {
        overlapThreshold: 0.5,
        overlapThresholdForMissingCurbRamp: 0.4,
        previewMode: false,
        taskDescription: 'Onboarding_LabelingCurbRampsDifficultScene'
    };
    var status = {
        currentLabel : undefined
    };
    var mouse = {};
    var onb;
    var rightClickMenu;
    var dom;
    var handAnimation;
    var quickcheck;

    // jQuery dom
    var $divHolderOnboarding;
    var $divHolderOnboardingCanvas;
    var $divOnboardingMessageBox;
    var $spanModeSwitchButtonStopSign;
    var $divLabelDrawingLayer;
    var $submitButton;
    var $textieldComment;
    var $spanHideLabel;
    var $buttonAgree;
    var $buttonDisagree;
    var $buttonModeSwitchCurbRamp;
    var $buttonModeSwitchMissingCurbRamp;
    var $viewControlLayer;
    var $buttonZoomIn;
    var $buttonZoomOut;

    var $divValidationDialogWindow;


    // Some public setting parameters that other objects can see
    // Location
    oPublic.latlng = {
        lat : 38.896069,
        lng: -77.050112
    };

//    // Heading
//    oPublic.panoramaPov = {
//        heading : 210, // 190,
//        pitch : -10,
//        zoom : 1a
//    };
    oPublic.panoramaPov = {
        heading: 220,
        pitch: -7,
        zoom: 1
    };
    // Panorama id.
    // oPublic.panoId = 'B6IBw1oLrutscM435zElSQ';
    oPublic.panoId = '_LgF08PrBvzKF2ZTzBlzag';

    //
    // DOMs that will be created dynamicallysome doms
    dom = {
        'BtnNext' : '<button id="OnboardingButton_Ok01" class="button bold">Next</button>',
        'BtnOk' : '<button id="OnboardingButton_Ok01" class="button bold">OK</button>',
        'Div_BusStopSceneHighlighter' : '<div id="OnboardingDiv_BusStopSceneHighlighter"></div>'
    };
    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function init(params, $) {
        onb = new Onboarding(params, $);
        properties.turker_id = params.turker_id;
        properties.qualification_url = params.qualification_url;
        properties.previewMode = params.previewMode;

        $divOnboardingMessageBox = $("#Holder_OnboardingMessageBox");
        $divHolderOnboardingCanvas = $("#Holder_OnboardingCanvas");
        $divLabelDrawingLayer = $("div#labelDrawingLayer");
        $divHolderOnboarding = $("#Holder_Onboarding");
        $submitButton = $("#Button_Submit");
        $textieldComment = $("#CommentField");
        $viewControlLayer = $("#viewControlLayer");
        $buttonZoomIn = $("#ZoomControlZoomInButton");
        $buttonZoomOut = $("#ZoomControlZoomOutButton");

        //
        // Labeling interface
        $buttonModeSwitchCurbRamp = $("#ModeSwitchButton_CurbRamp");
        $buttonModeSwitchMissingCurbRamp = $("#ModeSwitchButton_NoCurbRamp");

        //
        // Generate ground truth labels
        var photographerHeading = 181.86;
        var photographerPitch = -1.83;
        oPublic.LabelPoints_FirstMissingCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRampsDifficultScene',
            '-1',
            '_LgF08PrBvzKF2ZTzBlzag',
            'NoCurbRamp',
            '220',
            '-7',
            '1',
            '38.896069',
            '-77.050112',
            [
                {x: 7836.111111111111, y: -654.0944444444444},
                {x: 7960.311111111111, y: -714.5444444444445},
                {x: 8268.511111111111, y: -779.6444444444445},
                {x: 8595.111111111111, y: -770.3444444444444},
                {x: 8921.711111111112, y: -709.8944444444444},
                {x: 8875.711111111112, y: -607.5944444444444},
                {x: 8535.311111111112, y: -542.4944444444445},
                {x: 7868.311111111111, y: -588.9944444444445}
            ],
            photographerHeading,
            photographerPitch
        );

        oPublic.LabelPoints_FirstCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRampsDifficultScene',
            '-1',
            '_LgF08PrBvzKF2ZTzBlzag',
            'CurbRamp',
            '322',
            '-7',
            '1',
            '38.896017',
            '-77.049981',
            [
                {x: 11734.31111111111, y: -588.9944444444445} ,
                {x: 11734.31111111111, y: -565.7444444444445} ,
                {x: 11807.91111111111, y: -491.34444444444443},
                {x: 12005.71111111111, y: -463.44444444444446},
                {x: 12249.511111111111, y: -500.64444444444445},
                {x: 12254.111111111111, y: -542.4944444444445},
                {x: 12139.111111111111, y: -579.6944444444445},
                {x: 11922.91111111111, y: -602.9444444444445}
            ],
            photographerHeading,
            photographerPitch
        );

        oPublic.LabelPoints_SecondCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRampsDifficultScene',
            '-1',
            '_LgF08PrBvzKF2ZTzBlzag',
            'CurbRamp',
            '63',
            '-7',
            '2',
            '38.896017',
            '-77.049981',
            [
                {x: 2538.3444444444444, y: -368.56388888888887},
                {x: 2538.3444444444444, y: -354.61388888888894},
                {x: 2519.9444444444443, y: -303.4638888888889} ,
                {x: 2407.2444444444445, y: -291.8388888888889} ,
                {x: 2232.4444444444443, y: -324.3888888888889} ,
                {x: 2223.2444444444445, y: -352.2888888888889} ,
                {x: 2310.6444444444446, y: -368.56388888888887},
                {x: 2446.3444444444444, y: -375.5388888888889}
            ],
            photographerHeading,
            photographerPitch
        );

        oPublic.LabelPoints_ThirdCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRampsDifficultScene',
            '-1',
            '_LgF08PrBvzKF2ZTzBlzag',
            'CurbRamp',
            '80',
            '-7',
            '2',
            '38.896069',
            '-77.050112',
            [
                {x: 2928.8944444444446, y: -254.63888888888889},
                {x: 3069.1944444444443, y: -282.5388888888889},
                {x: 3111.7444444444445, y: -258.12638888888887},
                {x: 3111.7444444444445, y: -243.01388888888889},
                {x: 2948.4444444444443, y: -239.5263888888889}
            ],
            photographerHeading,
            photographerPitch
        );

        oPublic.LabelPoints_FirstMissingCurbRampLabel_ver2_1 = onb.generateLabel(
            'Onboarding_LabelingCurbRampsDifficultScene',
            '-1',
            '_LgF08PrBvzKF2ZTzBlzag',
            'NoCurbRamp',
            '220',
            '-7',
            '1',
            '38.896069',
            '-77.050112',
            [
                {x: 7900.511111111111, y: -695.9444444444445},
                {x: 8061.511111111111, y: -756.3944444444444},
                {x: 8286.91111111111, y: -784.2944444444445},
                {x: 8466.311111111112, y: -779.6444444444445},
                {x: 8470.91111111111, y: -663.3944444444444},
                {x: 7932.711111111112, y: -593.6444444444444},
                {x: 7895.9111111111115, y: -612.2444444444445}
            ],
            photographerHeading,
            photographerPitch
        );

        oPublic.LabelPoints_FirstMissingCurbRampLabel_ver2_2 = onb.generateLabel(
            'Onboarding_LabelingCurbRampsDifficultScene',
            '-1',
            '_LgF08PrBvzKF2ZTzBlzag',
            'NoCurbRamp',
            '220',
            '-7',
            '1',
            '38.896069',
            '-77.050112',
            [
                {x: 8608.91111111111, y: -779.6444444444445},
                {x: 8820.511111111111, y: -737.7944444444445},
                {x: 9101.111111111111, y: -607.5944444444444},
                {x: 9101.111111111111, y: -533.1944444444445},
                {x: 8972.311111111112, y: -514.5944444444444},
                {x: 8539.91111111111, y: -654.0944444444444}
            ],
            photographerHeading,
            photographerPitch
        );

        //
        // Quick check
        svw.quickCheck = new Onboarding_QuickCheckCurbRamps({}, $);
        svw.quickCheck.hide();
    }

    function FirstCorner_IntroduceMissingCurbRamps () {
        // This method shows amessage box that introduce curb ramp labels.
        //var message = "In this image, there is a sidewalk corner without any curb ramp. " +
        //    "Let's click a <b>Missing Curb Ramp</b> button to label the end of the sidewalk!";

        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_FirstCorner_IntroduceMissingCurbRamps');
        }

        var message = "In this image, there is a sidewalk corner without any curb ramp. " +
            "Let's click a <b>Missing Curb Ramp</b> button to label the missing curb ramps!";
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;
        var pov = svw.getPOV();
        // var noCurbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(8268, -600, pov); // This helper function is in a Point file
        var firstMissingCurbRampCanvasCoordiante = svw.gsvImageCoordinate2CanvasCoordinate(8168, -700, pov); // This helper function is in a Point file
        var secondMissingCurbRampCanvasCoordiante = svw.gsvImageCoordinate2CanvasCoordinate(8900, -640, pov); // This helper function is in a Point file

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(240, 20, message, 350, 130);
        onb.renderRoundArrow(240, 60, 190, 20);
        // onb.renderArrow(noCurbRampCanvasCoordinate.x - 50, noCurbRampCanvasCoordinate.y - 30, noCurbRampCanvasCoordinate.x, noCurbRampCanvasCoordinate.y + 20)
        onb.renderArrow(firstMissingCurbRampCanvasCoordiante.x + 40, firstMissingCurbRampCanvasCoordiante.y - 50, firstMissingCurbRampCanvasCoordiante.x, firstMissingCurbRampCanvasCoordiante.y)
        onb.renderArrow(secondMissingCurbRampCanvasCoordiante.x - 50, secondMissingCurbRampCanvasCoordiante.y - 40, secondMissingCurbRampCanvasCoordiante.x - 5, secondMissingCurbRampCanvasCoordiante.y)
        onb.renderCanvasMessage(firstMissingCurbRampCanvasCoordiante.x - 50, firstMissingCurbRampCanvasCoordiante.y - 65, "Missing curb ramps");
        $('path').remove();

        //
        // Set object statuses
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.ribbon.setAllowedMode('NoCurbRamp');

        //
        // Highlight and blink the button that the user is supposed to click
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchMissingCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');
            }
        }, 500);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;
                window.clearInterval(blinkInterval);
                // FirstCorner_LabelTheMissingCurbRamps();
                FirstCorner_V2_LabelTheFirstMissingCurbRamps();
            }
        });
    }

    function FirstCorner_LabelTheMissingCurbRamps () {
        // This method asks you to label the missing curb ramp at the first corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_FirstCorner_LabelTheMissingCurbRamps');
        }

        var interval = undefined;
        var userLabels = svw.canvas.getLabels();
        var originalLabelsLen = userLabels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(8268, -600, pov); // This helper function is in a Point file

        var message = "Draw an outline around the end of the sidewalk to label a missing curb ramp.";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(curbRampCanvasCoordinate.x - 220, curbRampCanvasCoordinate.y - 160, message, 350, 100);
        onb.renderArrow(curbRampCanvasCoordinate.x + 20, curbRampCanvasCoordinate.y - 60, curbRampCanvasCoordinate.x + 20, curbRampCanvasCoordinate.y - 10);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            userLabels = svw.canvas.getLabels();
            len = userLabels.length;
            if (len > originalLabelsLen) {
                var systemLabels = svw.canvas.getLabels('system');
                var userLabel = userLabels[len - 1];
                userLabel.unlockTagVisibility().setTagVisibility('hidden').lockTagVisibility();
                var thirdCurbRampLabel = systemLabels[0];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);

                // var points = userLabel.getPath().getPoints();
                // var ptlen = points.length;
                // for (var i = 0; i < ptlen; i++) {
                //    console.log(points[i].svImageCoordinate);
                // }

                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThresholdForMissingCurbRamp) {
                    if (numPoints > 3) {
                        // GrabAndDragToTheSecondCorner();
                        FirstCorner_MissingCurbRampExampleLabels ();
                    } else {
                        FirstCorner_RedoLabelingTheMissingCurbRamps('CoarseLabel');
                    }
                } else {
                    FirstCorner_RedoLabelingTheMissingCurbRamps('NoOverlap');
                }
            }
        }, 200);
    }

    function FirstCorner_RedoLabelingTheMissingCurbRamps (problemType) {
        // This method asks a user to redo the labeling
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_FirstCorner_RedoLabelingTheMissingCurbRamps', {errorType:problemType});
        }
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;
        if (problemType === 'CoarseLabel') {
            var message = "Hmmm, your label overlaps with the ground truth label, but it is not very concise. " +
                "Click the <b>Curb Ramp</b> button and draw the label with more than three points."
        } else {
            var message = "Hmm, it seems like the label you drew is not placed well on the end of the sidewalk. " +
                "Click the <b>Missing Curb Ramp</b> button and try again by drawing an outline on the sidewalk.";
        }

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(360, 20, message, 355, 150);
        // onb.renderRoundArrow(240, 60, 190, 20);

        //
        // Click here message
        onb.renderArrow(190, 60, 190, 20, {arrowWidth: 5});
        onb.renderCanvasMessage(120, 90, "Click here", {fontSize: 24, bold: true});

        //
        // Set statuses of objects.
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchMissingCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');
            }
        }, 500);

        //
        // Show the ground truth curb ramp label
        var labels = svw.canvas.getLabels('system');
        var label = labels[0];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;

                //
                // Remove the fasle label from the list.
                var labels = svw.canvas.getLabels('user');
                svw.canvas.removeLabel(labels[labels.length - 1]);
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');

                //
                window.clearInterval(blinkInterval);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                // FirstCorner_LabelTheMissingCurbRamps();
                FirstCorner_V2_LabelTheFirstMissingCurbRamps();
            }
        });
    }

    function FirstCorner_V2_LabelTheFirstMissingCurbRamps () {
        // This method asks you to label the missing curb ramp at the first corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_FirstCorner_V2_LabelTheFirstMissingCurbRamps');
        }

        var interval = undefined;
        var userLabels = svw.canvas.getLabels();
        var originalLabelsLen = userLabels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var firstMissingCurbRampCanvasCoordiante = svw.gsvImageCoordinate2CanvasCoordinate(8168, -700, pov); // This helper function is in a Point file
        var message = "Draw an outline around the end of the sidewalk to label the missing curb ramp.<br /><div style=\"height:10px;\"></div>" +
            "<img src=\"public/img/examples/Onboarding2_LabelingMissingCurbRamp2.gif\" style='height: 120px; width: 220px; position: relative; left: 15px;'>";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(firstMissingCurbRampCanvasCoordiante.x - 220, firstMissingCurbRampCanvasCoordiante.y - 300, message, 300, 240);
        onb.renderArrow(firstMissingCurbRampCanvasCoordiante.x + 10, firstMissingCurbRampCanvasCoordiante.y - 60, firstMissingCurbRampCanvasCoordiante.x + 10, firstMissingCurbRampCanvasCoordiante.y - 20);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            userLabels = svw.canvas.getLabels();
            len = userLabels.length;
            if (len > originalLabelsLen) {
                var systemLabels = svw.canvas.getLabels('system');
                var userLabel = userLabels[len - 1];
                userLabel.unlockTagVisibility().setTagVisibility('hidden').lockTagVisibility();
                var smallMissingCurbRampLabel = systemLabels[4];
                var largeMissingCurbRampLabel = systemLabels[0];

                var overlap = userLabel.overlap(smallMissingCurbRampLabel);
                var overlapLarge = userLabel.overlap(largeMissingCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);

                //
                // Move on to the next step of redo the labeling
                if (overlap >= overlapLarge) {
                    if (overlap > properties.overlapThresholdForMissingCurbRamp) {
                        if (numPoints <= 3) {
                            FirstCorner_V2_RedoLabelingTheFirstMissingCurbRamps('CoarseLabel');
                        } else {
                            FirstCorner_V2_ModeSwitchToMissingCurbRamp ();
                        }
                    } else {
                        FirstCorner_V2_RedoLabelingTheFirstMissingCurbRamps('NoOverlap');
                    }
                } else {
                    if (overlapLarge > properties.overlapThresholdForMissingCurbRamp) {
                        if (numPoints <= 3) {
                            FirstCorner_V2_RedoLabelingTheFirstMissingCurbRamps('CoarseLabel');
                        } else {
                            FirstCorner_MissingCurbRampExampleLabels();
                        }
                    } else {
                        FirstCorner_RedoLabelingTheMissingCurbRamps('NoOverlap');
                    }
                }

//                if (overlap > properties.overlapThresholdForMissingCurbRamp) {
//                    if (numPoints > 3) {
//                        // GrabAndDragToTheSecondCorner();
//                        FirstCorner_V2_ModeSwitchToMissingCurbRamp ();
//                    } else {
//                        FirstCorner_V2_RedoLabelingTheFirstMissingCurbRamps('CoarseLabel');
//                    }
//                } else if (overlapLarge > properties.overlapThresholdForMissingCurbRamp) {
//                    FirstCorner_MissingCurbRampExampleLabels();
//                } else {
//                    FirstCorner_V2_RedoLabelingTheFirstMissingCurbRamps('NoOverlap');
//                }
            }
        }, 200);
    }

    function FirstCorner_V2_RedoLabelingTheFirstMissingCurbRamps (problemType) {
        // This method asks a user to redo the labeling
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_FirstCorner_V2_RedoLabelingTheFirstMissingCurbRamps');
        }

        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;
        if (problemType === 'CoarseLabel') {
            var message = "Hmmm, your label is not very precise. " +
                "Draw a label with more than three points.";
        } else {
            var message = "Hmm, it seems like the label you drew is not placed on the end of the sidewalk. " +
                "Click the <b>Missing Curb Ramp</b> button and try again by drawing an outline on the sidewalk.";
        }

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(360, 20, message, 355, 150);
        // onb.renderRoundArrow(240, 60, 190, 20);

        //
        // Click here message
        onb.renderArrow(190, 60, 190, 20, {arrowWidth: 5});
        onb.renderCanvasMessage(120, 90, "Click here", {fontSize: 24, bold: true});

        //
        // Set statuses of objects.
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchMissingCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');
            }
        }, 500);

        //
        // Show the ground truth curb ramp label
        var labels = svw.canvas.getLabels('system');
        var label = labels[4];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;

                //
                // Remove the fasle label from the list.
                var labels = svw.canvas.getLabels('user');
                svw.canvas.removeLabel(labels[labels.length - 1]);
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');

                //
                window.clearInterval(blinkInterval);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                FirstCorner_V2_LabelTheFirstMissingCurbRamps();
            }
        });
    }

    function FirstCorner_V2_ModeSwitchToMissingCurbRamp () {
        // This method shows amessage box that introduce curb ramp labels.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_FirstCorner_V2_ModeSwitchToMissingCurbRamp');
        }

        var message = "There is another end of the sidewalk without a curb ramp. " +
            "Let's click the <b>Missing Curb Ramp</b> button again to label it!";
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;
        var pov = svw.getPOV();
        var secondMissingCurbRampCanvasCoordiante = svw.gsvImageCoordinate2CanvasCoordinate(8900, -640, pov); // This helper function is in a Point file

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(240, 20, message, 350, 140);
        onb.renderRoundArrow(240, 60, 190, 20);
        onb.renderArrow(secondMissingCurbRampCanvasCoordiante.x - 40, secondMissingCurbRampCanvasCoordiante.y - 40, secondMissingCurbRampCanvasCoordiante.x, secondMissingCurbRampCanvasCoordiante.y);
        $('path').remove();

        //
        // Set object statuses
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.ribbon.setAllowedMode('NoCurbRamp');

        //
        // Highlight and blink the button that the user is supposed to click
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchMissingCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');
            }
        }, 500);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;
                window.clearInterval(blinkInterval);
                // FirstCorner_LabelTheMissingCurbRamps();
                FirstCorner_V2_LabelTheSecondMissingCurbRamps();
            }
        });
    }

    function FirstCorner_V2_LabelTheSecondMissingCurbRamps () {
        // This method asks you to label the missing curb ramp at the first corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_FirstCorner_V2_LabelTheSecondMissingCurbRamps');
        }

        var interval = undefined;
        var userLabels = svw.canvas.getLabels();
        var originalLabelsLen = userLabels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var secondMissingCurbRampCanvasCoordiante = svw.gsvImageCoordinate2CanvasCoordinate(8900, -640, pov); // This helper function is in a Point file

        var message = "Draw an outline around the end of the sidewalk to label the missing curb ramp.";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(secondMissingCurbRampCanvasCoordiante.x - 220, secondMissingCurbRampCanvasCoordiante.y - 180, message, 350, 100);
        onb.renderArrow(secondMissingCurbRampCanvasCoordiante.x, secondMissingCurbRampCanvasCoordiante.y - 80, secondMissingCurbRampCanvasCoordiante.x, secondMissingCurbRampCanvasCoordiante.y - 25);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            userLabels = svw.canvas.getLabels();
            len = userLabels.length;
            if (len > originalLabelsLen) {
                var systemLabels = svw.canvas.getLabels('system');
                var userLabel = userLabels[len - 1];
                userLabel.unlockTagVisibility().setTagVisibility('hidden').lockTagVisibility();
                var thirdCurbRampLabel = systemLabels[5];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThresholdForMissingCurbRamp) {
                    if (numPoints > 3) {
                        // GrabAndDragToTheSecondCorner();
                        FirstCorner_MissingCurbRampExampleLabels ();
                    } else {
                        FirstCorner_V2_RedoLabelingTheSecondMissingCurbRamps('CoarseLabel');
                    }
                } else {
                    FirstCorner_V2_RedoLabelingTheSecondMissingCurbRamps('NoOverlap');
                }
            }
        }, 200);
    }

    function FirstCorner_V2_RedoLabelingTheSecondMissingCurbRamps (problemType) {
        // This method asks a user to redo the labeling
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_FirstCorner_V2_RedoLabelingTheSecondMissingCurbRamps', {errorType:problemType});
        }

        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;
        if (problemType === 'CoarseLabel') {
            var message = "Hmmm, your label is not very precise. " +
                "Draw a label with more than three points.";
        } else {
            var message = "Hmm, it seems like the label you drew is not placed well on the end of the sidewalk. " +
                "Click the <b>Missing Curb Ramp</b> button and try again by drawing an outline on the sidewalk.";
        }

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(360, 20, message, 355, 150);
        // onb.renderRoundArrow(240, 60, 190, 20);

        //
        // Click here message
        onb.renderArrow(190, 60, 190, 20, {arrowWidth: 5});
        onb.renderCanvasMessage(120, 90, "Click here", {fontSize: 24, bold: true});

        //
        // Set statuses of objects.
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchMissingCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');
            }
        }, 500);

        //
        // Show the ground truth curb ramp label
        var labels = svw.canvas.getLabels('system');
        var label = labels[5];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;

                //
                // Remove the fasle label from the list.
                var labels = svw.canvas.getLabels('user');
                svw.canvas.removeLabel(labels[labels.length - 1]);
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');

                //
                window.clearInterval(blinkInterval);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                FirstCorner_V2_LabelTheSecondMissingCurbRamps();
            }
        });
    }

    function FirstCorner_MissingCurbRampExampleLabels () {
        // This method shows how a user should label missing curb ramps.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_FirstCorner_MissingCurbRampExampleLabels');
        }
        var message = "Good! Note for a sidewalk without any curb ramps, you can either provide one large " +
            "label or two labels perpendicular to the curbs. For example: " +
            '<div>' +
            '<img src="public/img/examples/Example_MissingCurbRamp_01.png" class="Onboarding_MissingCurbRampExamples"/>' +
            '<img src="public/img/examples/Example_MissingCurbRamp_02.png" class="Onboarding_MissingCurbRampExamples"/>' +
            '</div>';
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone = false;
        var $OkBtn;

        //
        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(0, 0, message, 350, 290);

        svw.ribbon.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();

        $divOnboardingMessageBox.append(dom.BtnNext);
        $OkBtn = $("#OnboardingButton_Ok01");

        $OkBtn.css({
            'left' : '20px',
            'font-family': 'SegoeUISemiBold',
            'bottom' : '20px',
            'position' : 'absolute',
            'width' : 100,
            'z-index' : 1000
        });

        // Blink the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $OkBtn.css('background', 'rgba(252, 247, 192, 1)');
            } else {
                highlighted = true;
                $OkBtn.css('background', 'white');
            }
        }, 500);

        $OkBtn.bind('click', function () {

            $OkBtn.remove();
            $divHolderOnboardingCanvas.css({
                left : '0px',
                top: '0px'
            });
            onb.resetMessageBoxFill();
            window.clearInterval(blinkInterval);
            GrabAndDragToTheSecondCorner();
        });
    }

    function GrabAndDragToTheSecondCorner () {
        // This method asks a user to move to a next corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_GrabAndDragToTheSecondCorner');
        }
        var mouseDown = false;
        var AdjustHeadingAngleDone = false;
        var handAnimation = undefined;
        var handAnimationTimeout;
        var message = "Let's adjust the view to look at another corner. " +
            "Grab and drag the Street View image to see the corner on the right."

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(0, 0, message, 355, 140);

        //
        // Set object statuses
        svw.map.unlockDisableWalking().enableWalking().lockDisableWalking();
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.map.setHeadingRange([180, 320]);


        //
        // Put the hand animation
        if (!handAnimation) {
            handAnimationTimeout = setTimeout(function () {
                handAnimation = new Onboarding_GrabAndDragAnimation({direction: 'rightToLeft'});
                handAnimation.setPosition(380, 50);
            }, 1000);
        }


        $("#viewControlLayer").bind({
            'mousemove' : function () {
                if (!AdjustHeadingAngleDone) {
                    if (mouseDown) {
                        //
                        // Remove the hand animation.
                        // Clear time out in case the animation hasn't started yet.
                        // Then move on to the next task.
                        if (handAnimation) {

                            handAnimation.remove();
                        }
                        window.clearTimeout(handAnimationTimeout);

                        AdjustHeadingAngleDone = true;
                        onb.clear();
                        KeepDraggingToTheSecondCorner();
                    }
                }
            },
            'mousedown' : function () {
                mouseDown = true;
            },
            'mouseup' : function () {
                mouseDown = false;
            }
        });
    }

    function KeepDraggingToTheSecondCorner () {
        // This method asks users to keep dragging the Street View image until their view is facing next corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_KeepDraggingToTheSecondCorner');
        }
        var keepDraggingMessage = "Keep dragging until you see the next corner at the center of the image.";
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        //onb.renderMessage(360, 0, keepDraggingMessage, 355, 70);
        onb.renderMessage(0, 0, keepDraggingMessage, 355, 70);


        $viewControlLayer.bind({
            'mousemove' : function () {
                if (!stepDone) {
                    //
                    // Check the current pov. Check if the user is facing the second corner.
                    // If so, prompt to click a Curb Ramp button. Otherwise show a message to adjust the angle.
                    var pov = svw.getPOV();
                    var heading = pov.heading;

                    //if (320 <= heading && heading < 325) {
                    if (310 <= heading && heading < 325) {
                        SecondCorner_ModeSwitchToCurbRamp();
                        stepDone = true;
                    }
                }
            }
        });
    }

    function SecondCorner_ModeSwitchToCurbRamp () {
        // This method shows amessage box that introduce curb ramp labels.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_SecondCorner_ModeSwitchToCurbRamp');
        }
        var message = "Great, now you can see the second corner of this intersection. " +
            "Let's click the <b>Curb Ramp</b> button to label the curb ramp!";
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(200, 20, message, 350, 130);
        onb.renderRoundArrow(200, 70, 115, 20, 'cw');

        //
        // Set object statuses
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.ribbon.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();
        svw.ribbon.setAllowedMode('CurbRamp');

        //
        // Highlight and blink the button that the user is supposed to click
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchCurbRamp.css('background', 'white');
            }
        }, 500);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;
                window.clearInterval(blinkInterval);
                $buttonModeSwitchCurbRamp.css('background', 'white');
                SecondCorner_LabelTheCurbRamp();
            }
        });
    }

    function SecondCorner_LabelTheCurbRamp () {
        // This method asks you to label the missing curb ramp at the first corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_SecondCorner_LabelTheCurbRamp');
        }
        var interval = undefined;
        var userLabels = svw.canvas.getLabels('user');
        var originalLabelsLen = userLabels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(12005, -600, pov); // This helper function is in a Point file

        var message = "Draw an outline around this curb ramp.";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(curbRampCanvasCoordinate.x - 240, curbRampCanvasCoordinate.y - 140, message, 350, 70);
        onb.renderArrow(curbRampCanvasCoordinate.x - 10, curbRampCanvasCoordinate.y - 70, curbRampCanvasCoordinate.x - 10, curbRampCanvasCoordinate.y - 40);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            userLabels = svw.canvas.getLabels('user');
            len = userLabels.length;
            if (len > originalLabelsLen) {
                var systemLabels = svw.canvas.getLabels('system');
                var userLabel = userLabels[len - 1];
                userLabel.setTagVisibility('hidden');
                var thirdCurbRampLabel = systemLabels[1];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);

                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 3) {
                        // GrabAndDragToTheThirdCorner();
                        SecondCorner_ExamplesOfDiagonalCurbRamps();
                    } else {
                        SecondCorner_RedoLabelingTheCurbRamps('CoarseLabel');
                    }
                } else {
                    SecondCorner_RedoLabelingTheCurbRamps('NoOverlap');
                }
            }
        }, 200);
    }

    function SecondCorner_RedoLabelingTheCurbRamps (problemType) {
        // This method asks a user to redo the labeling
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_SecondCorner_RedoLabelingTheCurbRamps', {errorType:problemType});
        }
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;
        if (problemType === 'CoarseLabel') {
            var message = "Hmmm, your label is not very precise. " +
                "Draw a label with more than three points."
        } else {
            var message = "Hmm, seems like the label you drew does not overlap with the curb ramp. " +
                "Click the <b>Curb Ramp</b> button and try again by carefully tracing the outline of the curb ramp.";
        }

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(360, 20, message, 355, 150);
        // onb.renderRoundArrow(200, 70, 115, 20, 'cw');

        //
        // Click here message
        onb.renderArrow(120, 60, 120, 20, {arrowWidth: 5});
        onb.renderCanvasMessage(50, 90, "Click here", {fontSize: 24, bold: true});

        //
        // Set statuses of objects.
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchCurbRamp.css('background', 'white');
            }
        }, 500);

        //
        // Show the ground truth curb ramp label
        var labels = svw.canvas.getLabels('system');
        var label = labels[1];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;

                //
                // Remove the fasle label from the list.
                var labels = svw.canvas.getLabels('user');
                svw.canvas.removeLabel(labels[labels.length - 1]);
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');

                //
                window.clearInterval(blinkInterval);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                SecondCorner_LabelTheCurbRamp();
            }
        });
    }

    function SecondCorner_ExamplesOfDiagonalCurbRamps () {
        // This method shows examples of diagonal curb ramps
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_SecondCorner_ExamplesOfDiagonalCurbRamps');
        }
        var message = "Good! This is an example of a <b>diagonal curb ramp</b>. " +
            "Diagonal curb ramps face the center of the intersection. See the examples below:" +
            '<div>' +
            '<img src="public/img/examples/Example_DiagonalCurbRamp_01.png" class="Onboarding_DiagonalCurbRampExamples"/>' +
            '<img src="public/img/examples/Example_DiagonalCurbRamp_02.png" class="Onboarding_DiagonalCurbRampExamples"/>' +
            '<img src="public/img/examples/Example_DiagonalCurbRamp_03.png" class="Onboarding_DiagonalCurbRampExamples"/>' +
            '</div>';
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone = false;
        var $OkBtn;

        //
        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(0, 0, message, 715, 250);

        $divOnboardingMessageBox.append(dom.BtnNext);
        $OkBtn = $("#OnboardingButton_Ok01");
        $OkBtn.css({
            'left' : '20px',
            'font-family': 'SegoeUISemiBold',
            'bottom' : '20px',
            'position' : 'absolute',
            'width' : 100,
            'z-index' : 1000
        });

        // Blink the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $OkBtn.css('background', 'rgba(252, 247, 192, 1)');
            } else {
                highlighted = true;
                $OkBtn.css('background', 'white');
            }
        }, 500);

        $OkBtn.bind('click', function () {

            $OkBtn.remove();
            $divHolderOnboardingCanvas.css({
                left : '0px',
                top: '0px'
            });
            onb.resetMessageBoxFill();
            window.clearInterval(blinkInterval);
            // GrabAndDragToTheThirdCorner();
            RemindAboutTheCompletionRateMeter();
        });
    }

    function RemindAboutTheCompletionRateMeter () {
        // Let a user know there is a completion bar and it is 50% done.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_RemindAboutTheCompletionRateMeter');
        }
        var message = "You are doing a great job! This yellow bar shows that you have observed half of the scene. " +
            "To finish the task, you need to review the entire intersection.";

        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone = false;
        var $OkBtn;

        //
        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(300, 250, message, 350, 200);
        onb.renderArrow(650, 282, 710, 282);

        $divOnboardingMessageBox.append(dom.BtnNext);
        $OkBtn = $("#OnboardingButton_Ok01");


        $OkBtn.css({
            'left' : '20px',
            'font-family': 'SegoeUISemiBold',
            'bottom' : '20px',
            'position' : 'absolute',
            'width' : 100,
            'z-index' : 1000
        });

        // Blink the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $OkBtn.css('background', 'rgba(252, 247, 192, 1)');
            } else {
                highlighted = true;
                $OkBtn.css('background', 'white');
            }
        }, 500);

        $OkBtn.bind('click', function () {

            $OkBtn.remove();
            $divHolderOnboardingCanvas.css({
                left : '0px',
                top: '0px'
            });
            onb.resetMessageBoxFill();
            window.clearInterval(blinkInterval);
            // GrabAndDragToTheThirdCorner();
            GrabAndDragToTheThirdCorner ();
        });

    }

    function GrabAndDragToTheThirdCorner () {
    // This method asks a user to move to a next corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_GrabAndDragToTheThirdCorner');
        }
        var mouseDown = false;
        var AdjustHeadingAngleDone = false;
        var handAnimation = undefined;
        var handAnimationTimeout;
        var message = "Let's inspect the third corner. " +
            "Grab and drag the Street View image."

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(0, 0, message, 355, 70);

        //
        // Set object statuses
        svw.map.unlockDisableWalking().enableWalking().lockDisableWalking();
        svw.map.setHeadingRange([280, 63]);
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.ribbon.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();


        //
        // Put the hand animation
        if (!handAnimation) {
            handAnimationTimeout = setTimeout(function () {
                handAnimation = new Onboarding_GrabAndDragAnimation({direction: 'rightToLeft'});
                handAnimation.setPosition(380, 50);
            }, 1000);
        }

        $("#viewControlLayer").bind({
            'mousemove' : function () {
                if (!AdjustHeadingAngleDone) {
                    if (mouseDown) {
                        //
                        // Remove the hand animation.
                        // Clear time out in case the animation hasn't started yet.
                        // Then move on to the next task.
                        if (handAnimation) {
                            handAnimation.remove();
                        }
                        window.clearTimeout(handAnimationTimeout);

                        AdjustHeadingAngleDone = true;
                        onb.clear();
                        KeepDraggingToTheThirdCorner();
                    }
                }
            },
            'mousedown' : function () {
                mouseDown = true;
            },
            'mouseup' : function () {
                mouseDown = false;
            }
        });
    }

    function KeepDraggingToTheThirdCorner () {
        // This method asks users to keep dragging the Street View image until their view is facing next corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_KeepDraggingToTheThirdCorner');
        }
        var keepDraggingMessage = "Keep dragging until you see the next corner at the center of the image.";
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        // onb.renderMessage(360, 0, keepDraggingMessage, 355, 70);
        onb.renderMessage(0, 0, keepDraggingMessage, 355, 70);


        $viewControlLayer.bind({
            'mousemove' : function () {
                if (!stepDone) {
                    //
                    // Check the current pov. Check if the user is facing the second corner.
                    // If so, prompt to click a Curb Ramp button. Otherwise show a message to adjust the angle.
                    var pov = svw.getPOV();
                    var heading = pov.heading;

                    if (62 <= heading && heading < 65) {
                        ThirdCorner_FirstZoomIn();
                        stepDone = true;
                    }
                }
            }
        });
    }

    function ThirdCorner_FirstZoomIn () {
        // This method asks a user to zoom in.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_FirstZoomIn');
        }
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        var message = "Now you can see the third corner, but it is a little far away. " +
            "Let's zoom in by clicking the <b>Zoom In</b> button. " +
            "<br /><br /><small><img src=\"public/img/icons/Icon_TipWhite.png\" class=\"OnboardingTipIcons\"> Quick Tip: " +
            "You can also zoom in by <b>double clicking</b> on the image.</small>";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-10px'
        });
        onb.clear();
        onb.renderMessage(300, 30, message, 400, 170);
        onb.renderArrow(440, 30, 440, 10);

        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.zoomControl.unlockDisableZoomIn().enableZoomIn().lockDisableZoomIn();

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonZoomIn.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonZoomIn.css('background', 'white');
            }
        }, 500);


        //
        // Keep checking zoom level
        svw.zoomControl.setMaxZoomLevel(2);
        interval = setInterval(function () {
                var pov = svw.getPOV();
                var zoom = pov.zoom;

                if (zoom === 2) {
                    $buttonZoomIn.css('background', 'white');
                    window.clearInterval(interval);
                    window.clearInterval(blinkInterval);
                    ThirdCorner_FirstModeSwitchToCurbRamp();
                }
            },
            200);
    }

    function ThirdCorner_FirstModeSwitchToCurbRamp () {
        // This method shows amessage box that introduce curb ramp labels.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_FirstModeSwitchToCurbRamp');
        }
        var message = "Great, now you can see this corner more closely. " +
            "Let's click the <b>Curb Ramp</b> button to label the curb ramp.";
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(200, 20, message, 350, 120);
        onb.renderRoundArrow(200, 70, 115, 20, 'cw');

        //
        // Set object statuses
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.ribbon.unlockDisableModeSwitch().enableModeSwitch().unlockDisableModeSwitch();

        //
        // Highlight and blink the button that the user is supposed to click
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchCurbRamp.css('background', 'white');
            }
        }, 500);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;
                window.clearInterval(blinkInterval);
                $buttonModeSwitchCurbRamp.css('background', 'white');
                ThirdCorner_LabelTheFirstCurbRamp();
            }
        });
    }

    function ThirdCorner_LabelTheFirstCurbRamp () {
        // This method asks you to label the missing curb ramp at the first corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_LabelTheFirstCurbRamp');
        }
        var interval = undefined;
        var userLabels = svw.canvas.getLabels('user');
        var originalLabelsLen = userLabels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(2357, -350, pov); // This helper function is in a Point file

        var message = "Draw an outline around the curb ramp.";

        //
        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(curbRampCanvasCoordinate.x - 240, curbRampCanvasCoordinate.y - 130, message, 350, 70);
        onb.renderArrow(curbRampCanvasCoordinate.x - 5, curbRampCanvasCoordinate.y - 60, curbRampCanvasCoordinate.x - 5, curbRampCanvasCoordinate.y - 30);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            userLabels = svw.canvas.getLabels();
            len = userLabels.length;
            if (len > originalLabelsLen) {
                var userLabel = userLabels[len - 1];
                userLabel.setTagVisibility('hidden');
                var systemLabels = svw.canvas.getLabels('system');
                var thirdCurbRampLabel = systemLabels[2];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 3) {
                        ThirdCorner_AdjustTheCameraAngle();
                    } else {
                        ThirdCorner_RedoLabelingTheFirstCurbRamps('CoarseLabel');
                    }
                } else {
                    ThirdCorner_RedoLabelingTheFirstCurbRamps('NoOverlap');
                }
            }
        }, 200);
    }

    function ThirdCorner_RedoLabelingTheFirstCurbRamps (problemType) {
        // This method asks a user to redo the labeling
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_RedoLabelingTheFirstCurbRamps', {errorType:problemType});
        }
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;
        if (problemType === 'CoarseLabel') {
            var message = "Hmmm, your label is not very precise. " +
                "Draw a label with more than three points.";
            var messageHeight = 110;
        } else {
            var message = "Hmmm, seems like the label you drew does not overlap with the curb ramp. " +
                "Click the <b>Curb Ramp</b> button and try again by carefully tracing the outline of the curb ramp.";
            var messageHeight = 150;
        }

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(360, 20, message, 355, messageHeight);

        //
        // Click here message
        onb.renderArrow(120, 60, 120, 20, {arrowWidth: 5});
        onb.renderCanvasMessage(50, 90, "Click here", {fontSize: 24, bold: true});

        //
        // Set statuses of objects.
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchCurbRamp.css('background', 'white');
            }
        }, 500);

        //
        // Show the ground truth curb ramp label
        var labels = svw.canvas.getLabels('system');
        var label = labels[2];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;

                //
                // Remove the fasle label from the list.
                var labels = svw.canvas.getLabels('user');
                svw.canvas.removeLabel(labels[labels.length - 1]);
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');

                //
                window.clearInterval(blinkInterval);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                ThirdCorner_LabelTheFirstCurbRamp();
            }
        });
    }

    function ThirdCorner_AdjustTheCameraAngle () {
        // Adjust the camera angle slightly.
        // This method asks a user to move to a next corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_AdjustTheCameraAngle');
        }
        var mouseDown = false;
        var AdjustHeadingAngleDone = false;
        var handAnimation = undefined;
        var handAnimationTimeout;
        var message = "Great! Notice there is another curb ramp on the right. " +
            "Let's adjust the view to center the curb ramp in the image. ";
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(2878, -254, pov); // This helper function is in a Point file

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(0, 0, message, 355, 130);
        onb.renderArrow(curbRampCanvasCoordinate.x - 30, curbRampCanvasCoordinate.y - 40, curbRampCanvasCoordinate.x, curbRampCanvasCoordinate.y - 10);

        //
        // Set object statuses
        svw.map.unlockDisableWalking().enableWalking().lockDisableWalking();
        svw.map.setHeadingRange([60, 80]);
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.ribbon.unlockDisableModeSwitch().disableModeSwitch().unlockDisableModeSwitch();
        svw.ribbon.setAllowedMode('Walk');

        //
        // Pub the hand animation
        if (!handAnimation) {
            handAnimationTimeout = setTimeout(function () {
                handAnimation = new Onboarding_GrabAndDragAnimation({direction: 'rightToLeft'});
                handAnimation.setPosition(380, 50);
            }, 1000);
        }

        $("#viewControlLayer").bind({
            'mousemove' : function () {
                if (!AdjustHeadingAngleDone) {
                    if (mouseDown) {
                        //
                        // Remove the hand animation.
                        // Clear time out in case the animation hasn't started yet.
                        // Then move on to the next task.
                        if (handAnimation) {
                            handAnimation.remove();
                        }
                        window.clearTimeout(handAnimationTimeout);

                        AdjustHeadingAngleDone = true;
                        onb.clear();
                        ThirdCorner_KeepAdjustingTheCameraAngle();
                    }
                }
            },
            'mousedown' : function () {
                mouseDown = true;
            },
            'mouseup' : function () {
                mouseDown = false;
            }
        });
    }

    function ThirdCorner_KeepAdjustingTheCameraAngle () {
        // This method asks users to keep dragging the Street View image until their view is facing next corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_KeepAdjustingTheCameraAngle');
        }
        var keepDraggingMessage = "Keep dragging until you center the next curb ramp.";
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        // onb.renderMessage(360, 0, keepDraggingMessage, 355, 70);
        onb.renderMessage(0, 0, keepDraggingMessage, 355, 70);


        $viewControlLayer.bind({
            'mousemove' : function () {
                if (!stepDone) {
                    //
                    // Check the current pov. Check if the user is facing the second corner.
                    // If so, prompt to click a Curb Ramp button. Otherwise show a message to adjust the angle.
                    var pov = svw.getPOV();
                    var heading = pov.heading;

                    if (80 <= heading && heading < 85) {
                        ThirdCorner_SecondZoomIn();
                        stepDone = true;
                    }
                }
            }
        });
    }

    function ThirdCorner_SecondZoomIn () {
        // This method asks a user to zoom in.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_SecondZoomIn');
        }
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        var message = "Good! But this curb ramp is also a little far away. Let's zoom in even further by clicking the Zoom In button.";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-10px'
        });
        onb.clear();
        onb.renderArrow(440, 30, 440, 10);
        onb.renderMessage(360, 30, message, 350, 130);

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonZoomIn.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonZoomIn.css('background', 'white');
            }
        }, 500);

        //
        // Set the parameters of objects
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.zoomControl.setMaxZoomLevel(3);


        interval = setInterval(function () {
                var pov = svw.getPOV();
                var zoom = pov.zoom;

                if (zoom === 3) {
                    $buttonZoomIn.css('background', 'white');
                    window.clearInterval(interval);
                    window.clearInterval(blinkInterval);
                    ThirdCorner_SecondModeSwitchToCurbRamp();
                }
            },
            200);
    }

    function ThirdCorner_SecondModeSwitchToCurbRamp () {
        // This method shows amessage box that introduce curb ramp labels.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_SecondModeSwitchToCurbRamp');
        }
        var message = "Good! Now you can see the curb ramp. Let's click the <b>Curb Ramp</b> button to label it.";
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-15px'
        });
        onb.clear();
        onb.renderMessage(200, 20, message, 350, 110);
        onb.renderRoundArrow(200, 70, 115, 20, 'cw');

        //
        // Set object parameters
        svw.ribbon.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();
        svw.ribbon.setAllowedMode('CurbRamp');

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchCurbRamp.css('background', 'white');
            }
        }, 500);

        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;
                $buttonModeSwitchCurbRamp.css('background', 'white');
                $divHolderOnboardingCanvas.css({
                    left : '0px',
                    top: '0px'
                });
                window.clearInterval(blinkInterval);
                onb.resetMessageBoxFill();
                ThirdCorner_LabelTheSecondCurbRamps();
            }

        });
    }

    function ThirdCorner_LabelTheSecondCurbRamps () {
        // This method asks you to label the missing curb ramp at the first corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_LabelTheSecondCurbRamps');
        }
        var interval = undefined;
        var userLabels = svw.canvas.getLabels('user');
        var originalLabelsLen = userLabels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(3000, -250, pov); // This helper function is in a Point file

        // var message = "Draw an outline around the curb ramp. Draw an outline over the pole in front of the curb ramp.";
        var message = "<div style='width:270px;'>Notice that there is a pole in the way of your view&mdash;ignore it. " +
            "Draw an outline around the curb ramp as if the pole was not there.</div><br /><div style=\"height:10px;\"></div>" +
            "<img src=\"public/img/examples/Onboarding2_LabelingCurbRamp.gif\" style='height: 120px; width: 220px; position: relative; left: 290px; top:-162px'>";

        //
        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(curbRampCanvasCoordinate.x - 300, curbRampCanvasCoordinate.y + 80, message, 550, 150);
        onb.renderArrow(curbRampCanvasCoordinate.x - 10, curbRampCanvasCoordinate.y + 80, curbRampCanvasCoordinate.x - 10, curbRampCanvasCoordinate.y + 50);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            userLabels = svw.canvas.getLabels('user');
            len = userLabels.length;
            if (len > originalLabelsLen) {
                var userLabel = userLabels[len - 1];
                userLabel.setTagVisibility('hidden');
                var systemLabels = svw.canvas.getLabels('system');
                var thirdCurbRampLabel = systemLabels[3];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 3) {
                        // ThirdCorner_AdjustTheCameraAngle();
                        ThirdCorner_FirstZoomOut();
                    } else {
                        ThirdCorner_RedoLabelingTheSecondCurbRamps('CoarseLabel');
                    }
                } else {
                    ThirdCorner_RedoLabelingTheSecondCurbRamps('NoOverlap');
                }
            }
        }, 200);
    }

    function ThirdCorner_RedoLabelingTheSecondCurbRamps (problemType) {
        // This method asks a user to redo the labeling
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_RedoLabelingTheSecondCurbRamps', {errorType:problemType});
        }
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;
        if (problemType === 'CoarseLabel') {
            var message = "Hmmm, your label is not very precise. " +
                "Draw a label with more than three points.";
        } else {
            var message = "Hmm, seems like the label you drew does not overlap with the curb ramp. " +
                "Click <b>Curb Ramp</b> button and try again by carefully tracing the outline of the curb ramp.";
        }

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(360, 20, message, 355, 150);
        // onb.renderRoundArrow(200, 70, 115, 20, 'cw');

        //
        // Click here message
        onb.renderArrow(120, 60, 120, 20, {arrowWidth: 5});
        onb.renderCanvasMessage(50, 90, "Click here", {fontSize: 24, bold: true});

        //
        // Set statuses of objects.
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonModeSwitchCurbRamp.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonModeSwitchCurbRamp.css('background', 'white');
            }
        }, 500);

        //
        // Show the ground truth curb ramp label
        var labels = svw.canvas.getLabels('system');
        var label = labels[3];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;

                //
                // Remove the fasle label from the list.
                var labels = svw.canvas.getLabels('user');
                svw.canvas.removeLabel(labels[labels.length - 1]);
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');

                //
                window.clearInterval(blinkInterval);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                ThirdCorner_LabelTheSecondCurbRamps();
            }
        });
    }

    function ThirdCorner_FirstZoomOut () {
        // This method asks a user to zoom in.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_FirstZoomOut');
        }
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        var message = "Good! One corner left. Let's zoom out before we move the view to the 4th and last corner in the intersection. " +
            "Click the <b>Zoom Out</b> button. " +
            "<br/><br/><small><img src=\"public/img/icons/Icon_TipWhite.png\" class=\"OnboardingTipIcons\"> Quick Tip: " +
            "You can also zoom out by <b>shift + double clicking</b> on the image.</small>";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-10px'
        });
        onb.clear();
        onb.renderMessage(360, 30, message, 350, 230);
        onb.renderArrow(520, 30, 520, 10);

        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.ribbon.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        svw.zoomControl.unlockDisableZoomOut().enableZoomOut().lockDisableZoomOut();

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonZoomOut.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonZoomOut.css('background', 'white');
            }
        }, 500);


        //
        // Keep checking zoom level
        svw.zoomControl.setMaxZoomLevel(3);
        svw.zoomControl.setMinZoomLevel(2);
        // svw.zoomControl.unlockDisableZoomIn().enableZoomIn().lockDisableZoomIn();

        interval = setInterval(function () {
                var pov = svw.getPOV();
                var zoom = pov.zoom;

                if (zoom === 2) {
                    $buttonZoomOut.css('background', 'white');
                    window.clearInterval(interval);
                    window.clearInterval(blinkInterval);
                    ThirdCorner_SecondZoomOut();
                }
            },
            200);
    }

    function ThirdCorner_SecondZoomOut () {
        // This method asks a user to zoom in.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_ThirdCorner_SecondZoomOut');
        }
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        var message = "Let's zoom out one more time.";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-10px'
        });
        onb.clear();
        onb.renderMessage(360, 30, message, 350, 50);
        onb.renderArrow(520, 30, 520, 10);

        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.zoomControl.unlockDisableZoomOut().enableZoomOut().lockDisableZoomOut();
        svw.zoomControl.unlockDisableZoomIn().disableZoomIn().lockDisableZoomIn();


        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonZoomOut.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonZoomOut.css('background', 'white');
            }
        }, 500);


        //
        // Keep checking zoom level
        svw.zoomControl.setMaxZoomLevel(3);
        svw.zoomControl.setMinZoomLevel(1);
        interval = setInterval(function () {
                var pov = svw.getPOV();
                var zoom = pov.zoom;

                if (zoom === 1) {
                    $buttonZoomOut.css('background', 'white');
                    window.clearInterval(interval);
                    window.clearInterval(blinkInterval);
                    GrabAndDragToTheFourthCorner();
                }
            },
            200);
    }

    function GrabAndDragToTheFourthCorner () {
        // This method asks a user to move to a next corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_GrabAndDragToTheFourthCorner');
        }
        var mouseDown = false;
        var AdjustHeadingAngleDone = false;
        var handAnimation = undefined;
        var handAnimationTimeout;
        var message = "OK, now we're ready to look at the 4th and last corner. " +
            "Grab and drag the Street View image."

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(0, 0, message, 355, 110);

        svw.zoomControl.unlockDisableZoomIn().disableZoomIn().lockDisableZoomIn();

        //
        // Set object statuses
        svw.map.unlockDisableWalking().enableWalking().lockDisableWalking();
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.map.setHeadingRange([60, 180]);

        //
        // Put the hand animation
        if (!handAnimation) {
            handAnimationTimeout = setTimeout(function () {
                handAnimation = new Onboarding_GrabAndDragAnimation({direction: 'rightToLeft'});
                handAnimation.setPosition(380, 50);
            }, 1000);
        }

        $("#viewControlLayer").bind({
            'mousemove' : function () {
                if (!AdjustHeadingAngleDone) {
                    if (mouseDown) {
                        //
                        // Remove the hand animation.
                        // Clear time out in case the animation hasn't started yet.
                        // Then move on to the next task.
                        if (handAnimation) {
                            handAnimation.remove();
                        }
                        window.clearTimeout(handAnimationTimeout);

                        AdjustHeadingAngleDone = true;
                        onb.clear();
                        KeepDraggingToTheFourthCorner();
                    }
                }
            },
            'mousedown' : function () {
                mouseDown = true;
            },
            'mouseup' : function () {
                mouseDown = false;
            }
        });
    }

    function KeepDraggingToTheFourthCorner () {
        // This method asks users to keep dragging the Street View image until their view is facing next corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_KeepDraggingToTheFourthCorner');
        }
        var keepDraggingMessage = "Keep dragging until you see the 4th corner at the center of the image.";
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        // onb.renderMessage(360, 0, keepDraggingMessage, 355, 70);
        onb.renderMessage(0, 0, keepDraggingMessage, 355, 70);

        svw.map.setHeadingRange([60, 135]);

        $viewControlLayer.bind({
            'mousemove' : function () {
                if (!stepDone) {
                    //
                    // Check the current pov. Check if the user is facing the second corner.
                    // If so, prompt to click a Curb Ramp button. Otherwise show a message to adjust the angle.
                    var pov = svw.getPOV();
                    var heading = pov.heading;

                    if (130 <= heading && heading <= 135) {
                        FourthCorner_IntroduceOcclusion();
                        stepDone = true;
                    }
                }
            }
        });
    }

    function FourthCorner_IntroduceOcclusion () {
        // This method introduces occlusion.
        // This method shows how a user should label missing curb ramps.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_FourthCorner_IntroduceOcclusion');
        }
        var message = "Oh no, in this case a vehicle is blocking our view, and we cannot inspect the corner. " +
            "In such cases, you should <b>not</b> label anything.";
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone = false;
        var $OkBtn;

        //
        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(360, 0, message, 355, 180);

        //
        // Object setting
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();


        $divOnboardingMessageBox.append(dom.BtnNext);
        $OkBtn = $("#OnboardingButton_Ok01");


        $OkBtn.css({
            'left' : '20px',
            'font-family': 'SegoeUISemiBold',
            'bottom' : '20px',
            'position' : 'absolute',
            'width' : 100,
            'z-index' : 1000
        });

        // Blink the next button
        $OkBtn.html('OK');
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $OkBtn.css('background', 'rgba(252, 247, 192, 1)');
            } else {
                highlighted = true;
                $OkBtn.css('background', 'white');
            }
        }, 500);

        $OkBtn.bind('click', function () {

            $OkBtn.remove();
            $divHolderOnboardingCanvas.css({
                left : '0px',
                top: '0px'
            });
            onb.resetMessageBoxFill();
            window.clearInterval(blinkInterval);
            DoneLabelingAllTheCorners_EndLabeling();
        });
    }

    function DoneLabelingAllTheCorners_EndLabeling () {
        // This method asks a user to submit.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_DoneLabelingAllTheCorners_EndLabeling');
        }
        var message = "Great! Once you finish observing all the corners in an intersection, " +
            "the percentage of the meter on the right becomes 100%. " +
            "You are then ready to submit your task. Let's click the " +
            "<b>Submit</b> button.";
        onb.clear();
        onb.renderMessage(0, 325, message, 715, 110);
        onb.renderArrow(600, 440, 600, 470); // An arrow towards the submit button
        onb.renderArrow(650, 330, 710, 250); // An arrow towards the meter

        $divHolderOnboardingCanvas.css({
            top: '40px',
            'z-index': 100
        });

        $submitButton.unbind('click');
        $submitButton.bind('click', function (e) {
            $divHolderOnboardingCanvas.css('z-index', 1);
            onb.clear();
            $("#ajax-loader-image").css('visibility', 'hidden');
            svw.quickCheck.show();

            // submit(e);
        });
    }

    function submit (e) {
        // This method submits the result.
        // http://api.jquery.com/event.preventDefault/
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_Submit');
        }
        if (e && ('preventDefault' in e)) {
            e.preventDefault();
        }

        if (properties.previewMode) {
            // If it is a previewMode, return false.
            return false;
        }

        var data = svw.form.compileSubmissionData();
        data.turker_id = properties.turker_id;
        data.userInteraction = svw.tracker.getActions();
        data.qualification_type = 'CompletingATask';

        //
        // Insert a record that the user finished tutorial
        $.ajax({
            async: false,
            url: properties.qualification_url,
            type: 'post',
            dataType: 'json',
            data: data,
            success: function (result) {
                console.log(result);
            },
            error: function (result) {
                console.log(result)
            }
        });

        window.location.reload();
        return false;
    }
    ////////////////////////////////////////////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////////////////////////////////////////////
    oPublic.start = function () {
        // This method is called when the page is loaded. Once called, the onboarding will start.
        // The method loads 3 labels (oPublic.LabelPoints_FirstLabel, oPublic.LabelPoints_SecondLabel, oPublic.LabelPoints_ThirdLabel)
        // and show it on canvas. Then it will tell users to advance with the tutorial.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding2_Start');
        }

        var $OkBtn01;
        var interval;
        var blinkInterval;
        var highlighted = false;
        var i = 0;
        var len = 0;
        var labels = [];

        //
        // Prepare the ground truth labels
        svw.canvas.insertLabel(oPublic.LabelPoints_FirstMissingCurbRampLabel, 'system');
        svw.canvas.insertLabel(oPublic.LabelPoints_FirstCurbRampLabel, 'system');
        svw.canvas.insertLabel(oPublic.LabelPoints_SecondCurbRampLabel, 'system');
        svw.canvas.insertLabel(oPublic.LabelPoints_ThirdCurbRampLabel, 'system');
        svw.canvas.insertLabel(oPublic.LabelPoints_FirstMissingCurbRampLabel_ver2_1, 'system')
        svw.canvas.insertLabel(oPublic.LabelPoints_FirstMissingCurbRampLabel_ver2_2, 'system')

        labels = svw.canvas.getLabels('system');
        len = labels.length;
        for (i = 0; i < len; i++) {
            labels[i].setVisibility('hidden').lockVisibility();
            labels[i].unlockTagVisibility().setTagVisibility('hidden').lockTagVisibility();
        }

        svw.currentMissionDescription.setCurrentStatusDescription('Your mission is to learn how to ' +
            '<b>label</b> curb ramps and missing curb ramps using this interface.');

        //
        // I have to do this because disableWalking is only effective after
        // SV is loaded + there is no callback for SV load.
        interval = setInterval(function () {$('path').remove();}, 200);
        svw.canvas.disableLabeling();
        svw.canvas.disableLabelDelete().lockDisableLabelDelete();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.map.setPitchRange([-7,-5]);
        svw.map.setHeadingRange([350, 80]);
        svw.zoomControl.disableZoomIn().lockDisableZoomIn();
        svw.zoomControl.disableZoomOut().lockDisableZoomOut();
        svw.actionStack.disableUndo().lockDisableUndo();
        svw.actionStack.disableRedo().lockDisableRedo();
        svw.progressPov.setCompletedHeading([157,220])

        $divHolderOnboardingCanvas.css({
            left: '-10px',
            top: '-115px'
        });

        onb.renderMessage(0, 0, "<h2 class='bold'>Tutorial 2/3: Advanced Labeling Concepts</h2>" +
            "Great job on Tutorial One! In this second tutorial, " +
            "we are going to teach you about corners with no curb ramps, " +
            "diagonal curb ramps, zooming in and out, and " +
            "what to do when you can't actually see a corner. " +
            "",
            940, 150);

        onb.setMessageBoxFill('rgba(60,60,60,1)');

        $divOnboardingMessageBox.append(dom.BtnNext);
        $OkBtn01 = $("#OnboardingButton_Ok01");
        $OkBtn01.css({
            left : '20px',
            'font-family': 'SegoeUISemiBold',
            bottom : '10px',
            position : 'absolute',
            width : 100,
            'z-index' : 1000
        });

        // Blink the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $OkBtn01.css('background', 'rgba(252, 247, 192, 1)');
            } else {
                highlighted = true;
                $OkBtn01.css('background', 'white');
            }
        }, 500);

        $OkBtn01.bind('click', function () {

            $OkBtn01.remove();
            $divHolderOnboardingCanvas.css({
                left : '0px',
                top: '0px'
            });
            onb.resetMessageBoxFill();
            window.clearInterval(interval);
            window.clearInterval(blinkInterval);
            FirstCorner_IntroduceMissingCurbRamps();
        });
    };

    oPublic.submit = function () {
        submit(null);
    };

    init(params, $);
    return oPublic;
}
