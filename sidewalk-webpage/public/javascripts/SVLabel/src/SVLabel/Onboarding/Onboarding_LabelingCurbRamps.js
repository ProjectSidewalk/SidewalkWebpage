var svw = svw || {};

function Onboarding_LabelingCurbRamps (params, $) {
    var oPublic = {
        className : 'Onboarding_LabelingCurbRamps'
    };
    var properties = {
        overlapThreshold: 0.5,
        overlapThresholdForMissingCurbRamp: 0.3,
        previewMode: false,
        taskDescription: 'Onboarding_LabelingCurbRamps'
    };
    var status = {
        currentLabel : undefined
    };
    var mouse = {};
    var onb;
    var rightClickMenu;
    var dom;
    var handAnimation;

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

    var $divValidationDialogWindow;


    // Some public setting parameters that other objects can see
    // Location
    oPublic.latlng = {
        lat : 38.916286,
        lng : -77.0526090
    };

//    // Heading
//    oPublic.panoramaPov = {
//        heading : 210, // 190,
//        pitch : -10,
//        zoom : 1a
//    };
    oPublic.panoramaPov = {
        heading: 229,
        pitch: -3.25,
        zoom: 1
    };

    // Panorama id.
    // oPublic.panoId = 'B6IBw1oLrutscM435zElSQ';
    oPublic.panoId = 'Nd0m6cjkXqqugsP9AOHkdQ';

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

        //
        // Labeling interface
        $buttonModeSwitchCurbRamp = $("#ModeSwitchButton_CurbRamp");
        $buttonModeSwitchMissingCurbRamp = $("#ModeSwitchButton_NoCurbRamp");

        //
        // Generate ground truth labels
        var photographerHeading = 356.29;
        var photographerPitch = -4.59;
        oPublic.LabelPoints_FirstCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRamps',
            '-1',
            'Nd0m6cjkXqqugsP9AOHkdQ',
            'CurbRamp',
            '210',
            '-10',
            '1',
            '38.916286',
            '-77.0526090',[
                {x: 8737.111111111111, y: -659.5777777777779},
                {x: 8631.31111111111, y: -473.5777777777778} ,
                {x: 8787.71111111111, y: -422.4277777777778} ,
                {x: 9114.31111111111, y: -436.37777777777785},
                {x: 9123.511111111111, y: -487.5277777777778},
                {x: 9068.31111111111, y: -520.0777777777778} ,
                {x: 8875.111111111111, y: -599.1277777777779}
            ],
            photographerHeading,
            photographerPitch
        );

        oPublic.LabelPoints_SecondCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRamps',
            '-1',
            'Nd0m6cjkXqqugsP9AOHkdQ',
            'CurbRamp',
            '210',
            '-10',
            '1',
            '38.916286',
            '-77.0526090',
            [
                {x: 8410.511111111111, y: -673.5277777777778},
                {x: 8410.511111111111, y: -534.0277777777778},
                {x: 8189.711111111111, y: -487.5277777777778},
                {x: 7996.511111111111, y: -529.3777777777779},
                {x: 7991.911111111111, y: -561.9277777777778},
                {x: 8083.911111111111, y: -603.7777777777778},
                {x: 8258.71111111111, y: -650.2777777777778}
            ],
            photographerHeading,
            photographerPitch
        );

        oPublic.LabelPoints_ThirdCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRamps',
            '-1',
            'Nd0m6cjkXqqugsP9AOHkdQ',
            'CurbRamp',
            '140',
            '-10',
            '1',
            '38.916286',
            '-77.0526090',
            [
                {x: 5666.2444444444445, y: -913.8277777777778},
                {x: 5463.844444444445, y: -690.6277777777777},
                {x: 5652.444444444444, y: -611.5777777777778},
                {x: 6071.044444444445, y: -630.1777777777778},
                {x: 6075.644444444444, y: -662.7277777777779},
                {x: 6006.644444444444, y: -746.4277777777778},
                {x: 5859.444444444444, y: -844.0777777777778}
            ],
            photographerHeading,
            photographerPitch
        );

        oPublic.LabelPoints_MissingCurbRamp = onb.generateLabel(
            'Onboarding_LabelingCurbRamps',
            '-1',
            'Nd0m6cjkXqqugsP9AOHkdQ',
            'NoCurbRamp',
            '140',
            '-10',
            '1',
            '38.916286',
            '-77.0526090',
            [
                {x: 4589.377777777778, y: -773.3777777777779},
                {x: 4805.577777777778, y: -685.0277777777778},
                {x: 5196.577777777778, y: -796.6277777777779},
                {x: 5205.777777777777, y: -973.3277777777778},
                {x: 4906.777777777777, y: -912.8777777777779}
            ],
            photographerHeading,
            photographerPitch
        );
    }

    function FirstCorner_IntroduceCurbRamps () {
        // This method shows amessage box that introduce curb ramp labels.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_FirstCorner_IntroduceCurbRamps');
        }

        var message = "In this image, we can see two curb ramps. " +
            "Let's label them! Click the <b>Curb Ramp</b> button in the menu."; // to label them.";
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone = false;
        $('path').remove();

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-15px'
        });
        onb.clear();
        onb.renderMessage(200, 20, message, 350, 110);
        onb.renderRoundArrow(200, 70, 115, 20, 'cw');

        //
        // Draw arrows to curb ramps. Mark
        onb.renderArrow(350, 270, 330, 310);
        onb.renderArrow(380, 270, 400, 310);
        onb.renderCanvasMessage(280, 250, "Curb ramps", {fontSize: 28, lineWidth: 1, bold: true});

        //
        // Prohibit a user from doing any other action other than mode swithc.
        svw.ribbon.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();
        svw.ribbon.setAllowedMode('CurbRamp');

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
                FirstCorner_LabelTheFirstCurbRamps();
            }

        });
    }

    function FirstCorner_LabelTheFirstCurbRamps () {
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_FirstCorner_LabelTheFirstCurbRamps');
        }
        var message = "Now <b>draw an outline</b> around the curb ramp <b>as precisely as you can</b> by clicking and tracing the shape.<br /><div style=\"height:10px;\"></div>" +
            "<img src=\"public/img/examples/Onboarding_LabelingCurbRamp.gif\" style='height: 120px; width: 220px; position: relative; left: 15px;'>";
        // var message = "Now draw an outline around the curb ramp by clicking and tracing the shape of it. <br /><div style=\"height:10px;\"></div>" +

        var interval = undefined;
        // var labels = svw.canvas.getLabels();
        var userLabels = svw.canvas.getLabels('user');
        var systemLabels;
        var originalLabelsLen = userLabels.length;
        var len = undefined;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(100, 10, message, 300, 250);
        onb.renderArrow(380, 260, 410, 300);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        interval = setInterval(function () {
            systemLabels = svw.canvas.getLabels('system');
            userLabels = svw.canvas.getLabels('user');
            len = userLabels.length;
            if (len > originalLabelsLen) {
                var userLabel = userLabels[len - 1];
                var firstCurbRampLabel = systemLabels[0];
                var overlap = userLabel.overlap(firstCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 4) {
                        FirstCorner_SwitchTheModeToCurbRampForLabelTheSecondCurbRamps()
                    } else {
                        FirstCorner_RedoLabelingTheFirstCurbRamps('CoarseLabel');
                    }
                } else {
                    FirstCorner_RedoLabelingTheFirstCurbRamps('NoOverlap');
                }
            }
        }, 200);
    }

    function FirstCorner_RedoLabelingTheFirstCurbRamps (mode) {
        // This method asks a user to redo the labeling
        if (!mode) {
            mode = 'NoOverlap';
        }

        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_FirstCorner_RedoLabelingTheFirstCurbRamps', {errorType: mode});
        }

        if (mode === 'NoOverlap') {
            var message = "Hmmm, seems like the label you drew does not overlap with the curb ramp. " +
                "Click the <b>Curb Ramp</b> button and try again by carefully tracing the outline of the curb ramp.";
            var messageHeight = 150;
        } else {
            var message = "Hmmm, your label is not very precise. " +
                "Draw a label with more than four points.";
            var messageHeight = 110;
        }

        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px',
            left: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, message, 355, messageHeight);

        //
        // Click here message
        onb.renderArrow(120, 60, 120, 20, {arrowWidth: 5});
        onb.renderCanvasMessage(50, 90, "Click here", {fontSize: 24, bold: true});


        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

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
        var label = labels[0];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button.
        // Then hide the ground truth label.
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').lockVisibility();
                svw.canvas.clear().render2()
                FirstCorner_LabelTheFirstCurbRamps();
            }
        });
    }

    function FirstCorner_SwitchTheModeToCurbRampForLabelTheSecondCurbRamps () {
        // This method shows amessage box that introduce curb ramp labels.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_FirstCorner_SwitchTheModeToCurbRampForLabelTheSecondCurbRamps');
        }

        var message = "Good! To label the second curb ramp, " +
            "click the <b>Curb Ramp</b> button on the menu to label it.";
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
                FirstCorner_LabelTheSecondCurbRamps();
            }

        });
    }

    function FirstCorner_LabelTheSecondCurbRamps () {
        // The method asks a user to draw an outline around the second curb ramp in the scene.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_FirstCorner_LabelTheSecondCurbRamps');
        }

        var message = "Let's draw an outline around the second curb ramp.";
        var interval = undefined;
        // var labels = svw.canvas.getLabels();
        var userLabels = svw.canvas.getLabels('user');
        var originalLabelsLen = userLabels.length;
        var len = undefined;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(250, 190, message, 350, 70);
        onb.renderArrow(380, 260, 350, 300);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        interval = setInterval(function () {
            userLabels = svw.canvas.getLabels('user');
            len = userLabels.length;
            if (len > originalLabelsLen) {
                var userLabel = userLabels[len - 1];
                var systemLabels = svw.canvas.getLabels('system');
                var secondCurbRampLabel = systemLabels[1];
                var overlap = userLabel.overlap(secondCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 3) {
                        GrabAndDragToMoveToTheNextCorner();
                    } else {
                        FirstCorner_RedoLabelingTheSecondCurbRamps('CoarseLabel');
                    }
                } else {
                    FirstCorner_RedoLabelingTheSecondCurbRamps('NoOverlap');
                }
            }
        }, 200);
    }

    function FirstCorner_RedoLabelingTheSecondCurbRamps (mode) {
        // This method asks a user to redo the labeling for the second curb ramp.
        if (!mode) {
            mode = 'NoOverlap';
        }

        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_FirstCorner_RedoLabelingTheSecondCurbRamps', {errorType:mode});
        }

        if (mode === 'NoOverlap') {
            var message = "Hmmm, seems like the label you drew does not overlap with the curb ramp. " +
                "Click the <b>Curb Ramp</b> button and try again by carefully tracing the outline of the curb ramp.";
            var messageHeight = 150;
        } else { // CoarseLabel
            var message = "Hmmm, your label is not very precise. " +
                "Draw a label with more than three points.";
            var messageHeight = 110;
        }

        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px',
            left: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, message, 355, messageHeight);

        //
        // Click here message
        onb.renderArrow(120, 60, 120, 20, {arrowWidth: 5});
        onb.renderCanvasMessage(50, 90, "Click here", {fontSize: 24, bold: true});

        //
        // Object option
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

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
                var labels = svw.canvas.getLabels('user');
                stepDone = true;
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                FirstCorner_LabelTheSecondCurbRamps();
            }
        });
    }

    function GrabAndDragToMoveToTheNextCorner() {
        // This method asks a user to move to a next corner.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_GrabAndDragToMoveToTheNextCorner');
        }

        var mouseDown = false;
        var AdjustHeadingAngleDone = false;
        var handAnimation = undefined;
        var handAnimationTimeout;
        var message = "Great! Let's adjust the view to look at another corner. " +
            "Grab and drag the Street View image to see the street corner on the left."

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, message, 355, 130);

        svw.map.unlockDisableWalking().enableWalking().lockDisableWalking();
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.ribbon.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();

        if (!handAnimation) {
            handAnimationTimeout = setTimeout(function () {
                handAnimation = new Onboarding_GrabAndDragAnimation();
                handAnimation.setPosition(50, 50);
            }, 3000);
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
                        KeepDragging();
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

    function KeepDragging () {
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_KeepDragging');
        }

        var keepDraggingMessage = "Keep dragging to the left until you see the next corner. ";
        var almostThereMessage = "You are almost there! Keep dragging to the left until the corner is at the center of the image. ";
        var cornerIsVisible = false;
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, keepDraggingMessage, 355, 110);


        $viewControlLayer.bind({
            'mousemove' : function () {
                if (!stepDone) {
                    //
                    // Check the current pov. Check if the user is facing the second corner.
                    // If so, prompt to click a Curb Ramp button. Otherwise show a message to adjust the angle.
                    var pov = svw.getPOV();
                    var heading = pov.heading;

                    if (130 <= heading && heading < 160) {
                        stepDone = true;
                        SecondCorner_ModeSwitchToCurbRamps();
                    } else if (140 <= heading && heading < 185) {
                        onb.clear();
                        onb.renderMessage(360, 0, almostThereMessage, 355, 110);
                    } else {
                        onb.clear();
                        onb.renderMessage(360, 0, keepDraggingMessage, 355, 70);
                    }
                }
            }
        });

    }

    function SecondCorner_ModeSwitchToCurbRamps () {
        // This method asks a user to switch the mode to Curb Ramp.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_SecondCorner_ModeSwitchToCurbRamps');
        }

        var clickButtonMessage = "Good! On this corner, we can see <b>one curb ramp</b> and <b>one missing curb</b> ramp. " +
            "Let's label them! " +
            "First, let's label the curb ramp. Click the curb ramp button."; //First, click the Curb Ramp button on the menu to label the curb ramp.";
        var stepDone = false;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(5622, -611, pov);
        var missingCurbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(5166, -685, pov);


        $divHolderOnboardingCanvas.css({
            top: '-30px'
        });
        onb.clear();
        onb.renderMessage(200, 20, clickButtonMessage, 350, 150);
        onb.renderRoundArrow(200, 70, 115, 20, 'cw');

        //
        // Draw an arrow to a curb ramp.
        // onb.renderArrow(curbRampCanvasCoordinate.x - 20, curbRampCanvasCoordinate.y - 40, curbRampCanvasCoordinate.x - 20, curbRampCanvasCoordinate.y + 10);
        onb.renderArrow(curbRampCanvasCoordinate.x + 10, missingCurbRampCanvasCoordinate.y - 40, curbRampCanvasCoordinate.x + 10, curbRampCanvasCoordinate.y + 15);
        onb.renderCanvasMessage(curbRampCanvasCoordinate.x - 30, missingCurbRampCanvasCoordinate.y - 50, "Curb ramp", {fontSize: 20, lineWidth: 1, bold: true});

        //
        // Draw an arrow to a missing curb ramp
        onb.renderArrow(missingCurbRampCanvasCoordinate.x - 35, missingCurbRampCanvasCoordinate.y - 40, missingCurbRampCanvasCoordinate.x - 35, missingCurbRampCanvasCoordinate.y + 20);
        onb.renderCanvasMessage(missingCurbRampCanvasCoordinate.x - 150, missingCurbRampCanvasCoordinate.y - 50, "No curb ramp", {fontSize: 20, lineWidth: 1, bold: true});


        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.ribbon.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                    stepDone = true;
                    SecondCorner_LabelTheCurbRamps();
            }
        });
    }

    function SecondCorner_LabelTheCurbRamps () {
        // This method asks you to label a curb ramp.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_SecondCorner_LabelTheCurbRamps');
        }

        var interval = undefined;
        var userLabels = svw.canvas.getLabels('user');
        var originalLabelsLen = userLabels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(5600, -580, pov); // This helper function is in a Point file

        var message = "Let's draw an outline around the curb ramp.";
        onb.clear();
        onb.renderMessage(curbRampCanvasCoordinate.x - 230, curbRampCanvasCoordinate.y - 130, message, 350, 70);
        onb.renderArrow(curbRampCanvasCoordinate.x - 100, curbRampCanvasCoordinate.y - 60, curbRampCanvasCoordinate.x - 40, curbRampCanvasCoordinate.y);

        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            userLabels = svw.canvas.getLabels('user');
            len = userLabels.length;
            if (len > originalLabelsLen) {
                var sytemLabels = svw.canvas.getLabels('system');
                var userLabel = userLabels[len - 1];
                var thirdCurbRampLabel = sytemLabels[2];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 3) {
                        SecondCorner_IntroductionToAMissingCurbRamp ();
                    } else {
                        SecondCorner_RedoLabelingTheThirdCurbRamps('CoarseLabel');
                    }
                } else {
                    SecondCorner_RedoLabelingTheThirdCurbRamps('NoOverlap');
                }
            }
        }, 200);

    }

    function SecondCorner_RedoLabelingTheThirdCurbRamps (mode) {
        // This method asks you to redo the labeling for the third curb ramp.
        if (!mode) {
            mode = 'NoOverlap';
        }

        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_SecondCorner_RedoLabelingTheThirdCurbRamps', {errorType: mode});
        }

        if (mode === 'NoOverlap') {
            var message = "Hmmm, seems like the label you drew does not overlap with the curb ramp. " +
                "Click the <b>Curb Ramp</b> button and try again by carefully tracing the outline of the curb ramp.";
            var messageHeight = 150;
        } else { // CoarseLabel
            var message = "Hmmm, your label is not very precise. " +
                "Draw a label with more than three points.";
            var messageHeight = 110;
        }
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 10, message, 355, messageHeight);

        //
        // Click here message
        onb.renderArrow(120, 60, 120, 20, {arrowWidth: 5});
        onb.renderCanvasMessage(50, 90, "Click here", {fontSize: 24, bold: true});

        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

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
                var labels = svw.canvas.getLabels('user');
                stepDone = true;
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                SecondCorner_LabelTheCurbRamps();
            }
        });
    }

    function SecondCorner_IntroductionToAMissingCurbRamp () {
        // This method introduces the fact there is a missing curb ramp and
        // that a user has to label it as a Missing Curb Ramp.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_SecondCorner_IntroductionToAMissingCurbRamp');
        }

        var message = "Good! Now let's label the missing curb ramp. Click on the Missing Curb Ramp button.";
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-15px'
        });
        onb.clear();
        onb.renderMessage(270, 20, message, 350, 110);
        onb.renderRoundArrow(270, 70, 185, 20, 'cw');

        //
        // Set object status
        svw.ribbon.setAllowedMode('NoCurbRamp');

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

        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                stepDone = true;
                $buttonModeSwitchMissingCurbRamp.css('background', 'white');
                $divHolderOnboardingCanvas.css({
                    left : '0px',
                    top: '0px'
                });
                window.clearInterval(blinkInterval);
                SecondCorner_LabelTheMissingCurbRamp();
            }
        });
    }

    function SecondCorner_LabelTheMissingCurbRamp () {
        // This method asks you to label a missing curb ramp.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_SecondCorner_LabelTheMissingCurbRamp');
        }

        var interval = undefined;
        var userLabels = svw.canvas.getLabels('user');
        var originalLabelsLen = userLabels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(5000, -610, pov); // This helper function is in a Point file

        var message = "Let's draw an outline around the missing curb ramp.<br /><div style=\"height:10px;\"></div>" +
            "<img src=\"public/img/examples/Onboarding_LabelingMissingCurbRamp.gif\" style='height: 120px; width: 220px; position: relative; left: 15px;'>";
        onb.clear();
        onb.renderMessage(curbRampCanvasCoordinate.x + 20, curbRampCanvasCoordinate.y - 260, message, 300, 200);
        onb.renderArrow(curbRampCanvasCoordinate.x + 100, curbRampCanvasCoordinate.y - 60, curbRampCanvasCoordinate.x, curbRampCanvasCoordinate.y + 20);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        interval = setInterval(function () {
            userLabels = svw.canvas.getLabels('user');
            len = userLabels.length;
            if (len > originalLabelsLen) {
                var userLabel = userLabels[len - 1];
                var systemLabels = svw.canvas.getLabels('system');
                var thirdCurbRampLabel = systemLabels[3];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThresholdForMissingCurbRamp) {
                    if (numPoints > 3) {
                        DoneLabelingAllTheCorners_EndLabeling ();
                    } else {
                        SecondCorner_RedoLabelingTheMissingCurbRamps('CoarseLabel');
                    }
                } else {
                    SecondCorner_RedoLabelingTheMissingCurbRamps('NoOverlap');
                }
            }
        }, 200);
    }

    function SecondCorner_RedoLabelingTheMissingCurbRamps (mode) {
        if (!mode) {
            mode = 'NoOverlap';
        }

        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_SecondCorner_RedoLabelingTheMissingCurbRamps', {errorType: mode});
        }

        if (mode === 'NoOverlap') {
            var message = "Hmm, seems like the label you drew is not placed correctly. " +
                "Click the <b>Missing Curb Ramp</b> button and try again to label the missing curb ramp.";
            var messageHeight = 150;
        } else { // CoarseLabel
            var message = "Hmmm, your label is not very precise. " +
                "Draw a label with more than three points.";
            var messageHeight = 110;
        }

        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 10, message, 355, messageHeight);

        //
        // Click here message
        onb.renderArrow(190, 60, 190, 20, {arrowWidth: 5});
        onb.renderCanvasMessage(120, 90, "Click here", {fontSize: 24, bold: true});

        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

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
        var label = labels[3];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels('user');
                stepDone = true;
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                SecondCorner_LabelTheMissingCurbRamp();
            }
        });
    }

    function DoneLabelingAllTheCorners_EndLabeling () {
        // This method asks a user to submit.
        //var message = "Great! Now you've completed the tutotial one. Let's <b>submit the task</b> by clicking the submit button.";
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_DoneLabelingAllTheCorners_EndLabeling');
        }

        var message = "Great! You've successfully completed the Tutorial One. Click the <b>submit button</b> to move on to the second tutorial.";
        onb.clear();

        onb.renderMessage(0, 365, message, 715, 70);
        onb.renderArrow(600, 440, 600, 470);

        $divHolderOnboardingCanvas.css({
            top: '40px',
            'z-index': 100
        });

        svw.form.enableSubmit();
        $submitButton.unbind('click');
        $submitButton.bind('click', submit);
    }

    function submit (e) {
        // This method submits the result.
        // http://api.jquery.com/event.preventDefault/
        e.preventDefault();

        if (properties.previewMode) {
            // If it is a previewMode, return false.
            return false;
        }
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_Submit');
        }

        var data = svw.form.compileSubmissionData();
        data.turker_id = properties.turker_id;
        data.userInteraction = svw.tracker.getActions();
        data.qualification_type = 'LabelingCurbRamp';


        // Insert a record that the user finished tutorial
        $.ajax({
            async: false,
            url: properties.qualification_url,
            type: 'POST',
            dataType: 'json',
            data: data
        });

        window.location.reload();
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////
    // oPublic functions
    ////////////////////////////////////////////////////////////////////////////////
    oPublic.start = function () {
        // This method is called when the page is loaded. Once called, the onboarding will start.
        // The method loads 3 labels (oPublic.LabelPoints_FirstLabel, oPublic.LabelPoints_SecondLabel, oPublic.LabelPoints_ThirdLabel)
        // and show it on canvas. Then it will tell users to advance with the tutorial.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding1_Start');
        }

        var $OkBtn01;
        var interval;
        var blinkInterval;
        var highlighted = false;
        var i = 0;
        var len = 0;
        var labels = [];

        svw.canvas.insertLabel(oPublic.LabelPoints_FirstCurbRampLabel, 'system');
        svw.canvas.insertLabel(oPublic.LabelPoints_SecondCurbRampLabel, 'system');
        svw.canvas.insertLabel(oPublic.LabelPoints_ThirdCurbRampLabel, 'system');
        svw.canvas.insertLabel(oPublic.LabelPoints_MissingCurbRamp, 'system');

        labels = svw.canvas.getLabels('system');
        len = labels.length;
        for (i = 0; i < len; i++) {
            labels[i].setVisibility('hidden').lockVisibility();
            labels[i].unlockTagVisibility().setTagVisibility('hidden').lockTagVisibility();
        }

        // Set feedback fields
        // svw.progressFeedback.setProgress(0);
        // svw.progressFeedback.setMessage("Let's start the first tutorial!");
        svw.currentMissionDescription.setCurrentStatusDescription('Your mission is to learn how to ' +
            '<span class="bold">label</span> curb ramps and missing curb ramps.');

        // I have to do this because disableWalking is only effective after
        // SV is loaded + there is no callback for SV load.
        interval = setInterval(svw.map.hideLinks, 1000);
        svw.canvas.disableLabeling();
        svw.canvas.disableLabelDelete().lockDisableLabelDelete();
        svw.canvas.disableLabelEdit().lockDisableLabelEdit();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.map.setPitchRange([-10,0]);
        svw.map.setHeadingRange([130,245]);
        svw.zoomControl.unlockDisableZoomIn().disableZoomIn().lockDisableZoomIn();
        svw.actionStack.unlockDisableUndo().disableUndo().lockDisableUndo();
        svw.actionStack.unlockDisableRedo().disableRedo().lockDisableRedo();
        svw.ribbon.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();

        // svw.actionStack.disableRedo();
        // svw.actionStack.disableUndo();
        // svw.form.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
        // svw.form.unlockDisableNoBusStopButton().disableNoBusStopButton().lockDisableNoBusStopButton();

        $divHolderOnboardingCanvas.css({
            left: '-10px',
            top: '-115px'
        });

        onb.renderMessage(0, 0, "<h2 class='bold' style='margin-bottom: 6px;'><span class='bold' style=''>Help Us</span> Improve Street Accessibility</h2>" +
            //"Hi! We're exploring new ways to find out about inaccessible areas of cities. " +
            "Hi, we're exploring new ways to find accessibility problems in cities, and we need your help! " +
            "In this task, <span class='highlight'>your mission is to label curb ramps</span> and <span class='highlight'>missing curb ramps</span> in Google Street View. " +
            "Curb ramps are very important--without them, people in wheelchairs cannot move about the city. " +
            //"Plus, curb ramps are actually helpful " +
            //" to everyone--for example, when you're on your bike, pulling luggage, or pushing a stroller, curb ramps can help you get up and down curbs easily. " +
            "" +
            "<br /><br /><br />" +
            "<div style='position:relative; left:30px; width: 830px;'>" +
            "<div class='OnboardingLabelingBusStopExample InlineBlock'>" + // First image
            "<div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/onboarding/Onboarding_Verification_CurbRamps_WithLabels.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div>" +
            "<div class='OnboardingLabelingBusStopExampleCaption'>" +
            "An image of curb ramps at an intersection." +
            "</div>" +
            "</div>" + // End of the first image
            //"<div class='OnboardingLabelingBusStopExample InlineBlock'>" + // Second image
            //"<div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            //"<img src='public/img/onboarding/Onboarding_Verification_LabelOnACurbRamp_WithLabels.png' class='OnboardingLabelingBusStopExampleImage'> " +
            //"</div>" +
            //"<div class='OnboardingLabelingBusStopExampleCaption'>" +
            //"An image with a curb ramp label (green box), which indicates presence of a curb ramp." +
            //"</div>" +
            //"</div>" + // End of the second image
            "<div class='OnboardingLabelingBusStopExample InlineBlock'>" + // Third image
            "<div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/examples/Example_MissingCurbRamp.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div>" +
            "<div class='OnboardingLabelingBusStopExampleCaption'>" +
            "A lack of a curb ramp at this corner obstruct wheelchair users from getting on and off the sidewalk." +
            "</div>" +
            "</div>" + // End of the third image
            "</div>" +
            "<br/><br /><br />" +
            "We'll <span class='highlight'>begin with a short, interactive tutorial</span> to get you started! " +
            "Thanks for your help in improving the accessibility of cities. ",
            //"<span class=''>Your work will help make cities better</span> for everyone.<br /><br />",
            940, 700);

        onb.setMessageBoxFill('rgba(60,60,60,1)');

        $divOnboardingMessageBox.append(dom.BtnNext);
        $OkBtn01 = $("#OnboardingButton_Ok01");


        $OkBtn01.css({
            'left' : '20px',
            'font-family': 'SegoeUISemiBold',
            'bottom' : '30px',
            'position' : 'absolute',
            'width' : '200px',
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
            FirstCorner_IntroduceCurbRamps();
        });
    };

    init(params, $);
    return oPublic;
}
