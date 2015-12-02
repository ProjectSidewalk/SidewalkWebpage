/**
 * Created with JetBrains PhpStorm.
 * User: kotarohara
 * Date: 8/19/13
 * Time: 1:02 PM
 * To change this template use File | Settings | File Templates.
 */
var svw = svw || {};

function Onboarding_LabelingCurbRampsDifficultScene (params, $) {
    var oPublic = {
        className : 'Onboarding_LabelingCurbRampsDifficultScene'
    };
    var properties = {
        overlapThreshold: 0.5,
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
        lat : 38.896017,
        lng: -77.049981
    };

//    // Heading
//    oPublic.panoramaPov = {
//        heading : 210, // 190,
//        pitch : -10,
//        zoom : 1a
//    };
    oPublic.panoramaPov = {
        heading: 35,
        pitch: -7,
        zoom: 1
    };

    // Panorama id.
    // oPublic.panoId = 'B6IBw1oLrutscM435zElSQ';
    oPublic.panoId = 'h9SWe4-hPWUjJeIh2gWpdQ';

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
        oPublic.LabelPoints_FirstCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRampsDifficultScene',
            '-1',
            'h9SWe4-hPWUjJeIh2gWpdQ',
            'CurbRamp',
            '35',
            '-10',
            '1',
            '38.896017',
            '-77.049981',[
                {x: 323.62222222222226, y: -820.8277777777778},
                {x: 677.8222222222222, y: -648.7777777777778},
                {x: 585.8222222222222, y: -569.7277777777778},
                {x: 181.02222222222235, y: -574.3777777777777},
                {x: 208.62222222222226, y: -713.8777777777777}
            ]
        );


        oPublic.LabelPoints_SecondCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRampsDifficultScene',
            '-1',
            'h9SWe4-hPWUjJeIh2gWpdQ',
            'CurbRamp',
            '35',
            '-10',
            '1',
            '38.896017',
            '-77.049981',
            [
                {x: 2298.4444444444443, y: -692.9527777777778},
                {x: 2254.744444444444, y: -662.7277777777779},
                {x: 2160.4444444444443, y: -611.5777777777778},
                {x: 2146.644444444444, y: -511.60277777777776},
                {x: 2192.644444444444, y: -486.02777777777777},
                {x: 2542.244444444444, y: -518.5777777777778},
                {x: 2537.644444444444, y: -551.1277777777777}
            ]
        );

        oPublic.LabelPoints_ThirdCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRamps',
            '-1',
            'h9SWe4-hPWUjJeIh2gWpdQ',
            'CurbRamp',
            '296',
            '-10',
            '3',
            '38.916286',
            '-77.0526090',
            [
                {x: 10833.272222222222, y: -316.7736111111111},
                {x: 10898.822222222223, y: -323.74861111111113},
                {x: 11029.922222222223, y: -321.4236111111111},
                {x: 11105.822222222223, y: -315.6111111111111},
                {x: 11104.672222222223, y: -297.0111111111111},
                {x: 11035.672222222223, y: -279.5736111111111},
                {x: 10926.422222222223, y: -278.4111111111111},
                {x: 10832.122222222222, y: -301.6611111111111}
            ]
        );

        oPublic.LabelPoints_FirstMissingCurbRamp = onb.generateLabel(
            'Onboarding_LabelingCurbRamps',
            '-1',
            'h9SWe4-hPWUjJeIh2gWpdQ',
            'NoCurbRamp',
            '253',
            '-10',
            '2',
            '38.916286',
            '-77.0526090',
            [
                {x: 9296.533333333333, y: -285.3944444444444},
                {x: 9572.533333333333, y: -292.3694444444444},
                {x: 9572.533333333333, y: -317.9444444444444},
                {x: 9512.733333333332, y: -336.5444444444444},
                {x: 9409.233333333332, y: -352.8194444444444},
                {x: 9289.633333333333, y: -357.4694444444444},
                {x: 9202.233333333332, y: -352.8194444444444},
                {x: 9202.233333333332, y: -315.6194444444444}
            ]
        );

        oPublic.LabelPoints_SecondMissingCurbRamp = onb.generateLabel(
            'Onboarding_LabelingCurbRamps',
            '-1',
            'h9SWe4-hPWUjJeIh2gWpdQ',
            'NoCurbRamp',
            '162',
            '-10',
            '1',
            '38.916286',
            '-77.0526090',
            [
                {x: 6489.622222222222, y: -695.2777777777778},
                {x: 6443.622222222222, y: -844.0777777777778},
                {x: 6144.622222222222, y: -960.3277777777778},
                {x: 6144.622222222222, y: -806.8777777777777},
                {x: 6264.222222222222, y: -644.1277777777777},
                {x: 6471.222222222222, y: -648.7777777777778}
            ]
        );

        oPublic.LabelPoints_ForthCurbRampLabel = onb.generateLabel(
            'Onboarding_LabelingCurbRamps',
            '-1',
            'h9SWe4-hPWUjJeIh2gWpdQ',
            'CurbRamp',
            '162',
            '-10',
            '1',
            '38.916286',
            '-77.0526090',
            [
                {x: 4704.88888888889, y: -693.0777777777778},
                {x: 4957.88888888889, y: -586.1277777777777},
                {x: 4677.288888888889, y: -488.47777777777776},
                {x: 4447.288888888889, y: -521.0277777777778},
                {x: 4442.68888888889, y: -576.8277777777778}
            ]
        );

    }


    function FirstCorner_IntroduceCurbRamps () {
        // This method shows amessage box that introduce curb ramp labels.
        var message = "In this image, we have two curb ramps. " +
            "Let's label them! Click a <b>Curb Ramp</b> button on the menu to label them.";
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone = false;
        $('path').remove();

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-25px'
        });
        onb.clear();
        onb.renderMessage(200, 20, message, 350, 140);
        onb.renderRoundArrow(200, 70, 115, 20, 'cw');

        // Draw arrows to curb ramps
        onb.renderArrow(270, 260, 220, 310);
        onb.renderArrow(490, 240, 540, 290);

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
        var message = "Now draw an outline around the curb ramp by clicking and tracing the shape of it.";
        var interval = undefined;
        var labels = svw.canvas.getLabels();
        var originalLabelsLen = labels.length;
        var len = undefined;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(150, 120, message, 350, 110);
        onb.renderArrow(260, 230, 215, 280);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        interval = setInterval(function () {
            labels = svw.canvas.getLabels();
            len = labels.length;
            if (len > originalLabelsLen) {
                var userLabel = labels[len - 1];
                var firstCurbRampLabel = labels[0];
                var overlap = userLabel.overlap(firstCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);

                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 4) {
                        FirstCorner_SwitchTheModeToCurbRampForLabelTheSecondCurbRamps()
                    } else {
                        FirstCorner_RedoLabelingTheFirstCurbRampsWithFinerOutline();
                    }

                } else {
                    FirstCorner_RedoLabelingTheFirstCurbRamps();
                }
            }
        }, 200);
    }

    function FirstCorner_RedoLabelingTheFirstCurbRamps () {
        // This method asks a user to redo the labeling
        var message = "Hmm, seems like the label you drew does not overlap with the curb ramp. " +
            "Try again by carefully tracing the outline of the curb ramp.";
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
        onb.renderMessage(360, 0, message, 355, 150);

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
        var labels = svw.canvas.getLabels();
        var label = labels[0];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                FirstCorner_LabelTheFirstCurbRamps();
            }
        });
    }

    function FirstCorner_RedoLabelingTheFirstCurbRampsWithFinerOutline () {
        // This method asks a user to redo the labeling
        var message = "Hmmm, your label overlaps with the ground truth label, but it is not very concise. " +
            "Draw the label with more than four points.";
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
        onb.renderMessage(360, 0, message, 355, 150);
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

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
        var labels = svw.canvas.getLabels();
        var label = labels[0];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                FirstCorner_LabelTheFirstCurbRamps();
            }
        });
    }

    function FirstCorner_SwitchTheModeToCurbRampForLabelTheSecondCurbRamps () {
        // This method shows amessage box that introduce curb ramp labels.
        var message = "Good! To label the second curb ramp, " +
            "click a <b>Curb Ramp</b> button on the menu to label them.";
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
        // This method asks a user to label the second curb ramp.
        var message = "Now draw an outline around the curb ramp by clicking and tracing the shape of it.";
        var interval = undefined;
        var labels = svw.canvas.getLabels();
        var originalLabelsLen = labels.length;
        var len = undefined;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(200, 100, message, 350, 110);
        onb.renderArrow(500, 210, 530, 260);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        interval = setInterval(function () {
            labels = svw.canvas.getLabels();
            len = labels.length;
            if (len > originalLabelsLen) {
                var userLabel = labels[len - 1];
                var secondCurbRampLabel = labels[1];
                var overlap = userLabel.overlap(secondCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);

                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 4) {
                        GrabAndDragToMoveToTheNextCorner();
                    } else {
                        FirstCorner_RedoLabelingTheSecondCurbRampsWithFinerOutline();
                    }
                } else {
                    FirstCorner_RedoLabelingTheSecondCurbRamps();
                }
            }
        }, 200);
    }

    function FirstCorner_RedoLabelingTheSecondCurbRamps () {
        // This method asks a user to redo the labeling for the second curb ramp.
        var message = "Hmm, seems like the label you drew does not overlap with the curb ramp. " +
            "Try again by carefully tracing the outline of the curb ramp.";
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
        onb.renderMessage(360, 0, message, 355, 150);

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
        var labels = svw.canvas.getLabels();
        var label = labels[1];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                FirstCorner_LabelTheSecondCurbRamps();
            }
        });
    }

    function FirstCorner_RedoLabelingTheSecondCurbRampsWithFinerOutline () {
        // This method asks a user to redo the labeling for the second curb ramp.
        var message = "Hmmm, your label overlaps with the ground truth label, but it is not very concise. " +
            "Draw the label with more than four points.";
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
        onb.renderMessage(360, 0, message, 355, 150);

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
        var labels = svw.canvas.getLabels();
        var label = labels[1];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
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
        var mouseDown = false;
        var AdjustHeadingAngleDone = false;
        var handAnimation = undefined;
        var handAnimationTimeout;
        var message = "Great! Let's adjust a view to look at another corner. " +
            "Grab and drag the Street View image to see the corner on the left."

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, message, 355, 150);

        svw.map.unlockDisableWalking().enableWalking().lockDisableWalking();
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.map.setHeadingRange([295, 80]);


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
        // This method asks users to keep dragging the Street View image until their view is facing next corner.
        var keepDraggingMessage = "Keep dragging until you see the next corner.";
        var cornerIsVisible = false;
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, keepDraggingMessage, 355, 70);


        $viewControlLayer.bind({
            'mousemove' : function () {
                if (!stepDone) {
                    //
                    // Check the current pov. Check if the user is facing the second corner.
                    // If so, prompt to click a Curb Ramp button. Otherwise show a message to adjust the angle.
                    var pov = svw.getPOV();
                    var heading = pov.heading;

                    if (290 < heading && heading <= 295) {
                        SecondCorner_FirstZoomIn();
                        stepDone = true;
                    }
                }
            }
        });
    }

    function SecondCorner_FirstZoomIn () {
        // This method asks a user to zoom in.
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        var message = "Now you can see another corner, but this is a little too far to observe. " +
            "Let's zoom in by clicking the <b>Zoom In</b> button. " +
            "<br/><br/><small><img src=\"public/img/icons/Icon_TipWhite.png\" class=\"OnboardingTipIcons\"> " +
        "You can also zoom in by double clicking on the image.</small>";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-10px'
        });
        onb.clear();
        onb.renderMessage(360, 30, message, 350, 200);
        onb.renderArrow(440, 30, 440, 10);

        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

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
        // Let a user to click on the mode switch button
        $buttonZoomIn.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                window.clearInterval(blinkInterval);
                SecondCorner_SecondZoomIn();
            }
        });
    }

    function SecondCorner_SecondZoomIn () {
        // This method asks a user to zoom in.
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        var message = "This is still a little far away. Let's zoom in one more time.";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-10px'
        });
        onb.clear();
        onb.renderArrow(440, 30, 440, 10);
        onb.renderMessage(360, 30, message, 350, 70);

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
        // Let a user to click on the mode switch button
        $buttonZoomIn.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                window.clearInterval(blinkInterval);
                $buttonZoomIn.css('background', 'white');
                // SecondCorner_LabelTheCurbRamps();
                SecondCorner_ModeSwitch();
            }
        });
    }

    function SecondCorner_ModeSwitch () {
        // This method shows amessage box that introduce curb ramp labels.
        var message = "Good! Now you can see the curb ramp. Let's click <b>Curb Ramp</b> button to label them.";
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
                SecondCorner_LabelTheCurbRamps();
            }

        });
    }

    function SecondCorner_LabelTheCurbRamps () {
        // This method asks you to label a curb ramp.
        var interval = undefined;
        var labels = svw.canvas.getLabels();
        var originalLabelsLen = labels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(10955, -255, pov); // This helper function is in a Point file

        var message = "Now let's trace the shape of the curb ramp.";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(curbRampCanvasCoordinate.x - 230, curbRampCanvasCoordinate.y - 130, message, 350, 70);
        //onb.renderRoundArrow(200, 70, 115, 20, 'cw');
        //onb.renderMessage(200, 20, message, 350, 70);
        onb.renderArrow(curbRampCanvasCoordinate.x - 50, curbRampCanvasCoordinate.y - 60, curbRampCanvasCoordinate.x, curbRampCanvasCoordinate.y);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            labels = svw.canvas.getLabels();
            len = labels.length;
            if (len > originalLabelsLen) {
                var userLabel = labels[len - 1];
                var thirdCurbRampLabel = labels[2];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;


                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 4) {
                        SecondCorner_IntroductionToDiagonalCurbRamp ();
                    } else {
                        SecondCorner_RedoLabelingTheThirdCurbRampsWithFinerOutline();
                    }
                } else {
                    SecondCorner_RedoLabelingTheThirdCurbRamps();
                }
            }
        }, 200);

    }

    function SecondCorner_RedoLabelingTheThirdCurbRamps () {
        // This method asks you to redo the labeling for the third curb ramp.
        var message = "Hmm, seems like the label you drew does not overlap with the curb ramp. " +
            "Try again by carefully tracing the outline of the curb ramp.";
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
        onb.renderMessage(360, 0, message, 355, 150);

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
        var labels = svw.canvas.getLabels();
        var label = labels[2];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                $buttonZoomOut.css('background', 'white');
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                SecondCorner_LabelTheCurbRamps();
            }
        });
    }

    function SecondCorner_RedoLabelingTheThirdCurbRampsWithFinerOutline () {
        // This method asks you to redo the labeling for the third curb ramp.
        var message = "Hmmm, your label overlaps with the ground truth label, but it is not very concise. " +
            "Draw the label with more than four points.";
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
        onb.renderMessage(360, 0, message, 355, 150);

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
        var labels = svw.canvas.getLabels();
        var label = labels[2];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                $buttonZoomOut.css('background', 'white');
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                SecondCorner_LabelTheCurbRamps();
            }
        });
    }

    function SecondCorner_IntroductionToDiagonalCurbRamp () {
        // This method introduces that it is ok to have one diagonal curb ramp
        // instead of two.

        var message = "Good! Notice, it is ok even there aren't two curb ramps " +
            "<b>if there is one diagonal curb ramp</b> that faces towards the center of the intersection. ";
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone = false;
        var $OkBtn;

        //
        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(360, 0, message, 350, 200);

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
            SecondCorner_ZoomOut();
        });
    }

    function SecondCorner_ZoomOut () {
        // This method asks a user to zoom out.
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        var message = "Let's zoom out by clicking <b>Zoom Out.</b>" +
            "<br/><br/><small><img src=\"public/img/icons/Icon_TipWhite.png\" class=\"OnboardingTipIcons\"> " +
            "You can also zoom out by shift + double click.</small>";;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-10px'
        });
        onb.clear();
        onb.renderMessage(360, 30, message, 350, 150);
        onb.renderArrow(520, 30, 520, 10);

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
        // Let a user to click on the mode switch button
        $buttonZoomOut.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                $buttonZoomOut.css('background', 'white');
                window.clearInterval(blinkInterval);
                GrabAndDragToMoveToTheThirdCorner();
            }
        });
    }

    function GrabAndDragToMoveToTheThirdCorner () {
        var mouseDown = false;
        var AdjustHeadingAngleDone = false;
        var handAnimation = undefined;
        var handAnimationTimeout;
        var message = "Great! Let's adjust a view to look at another corner. " +
            "Grab and drag the Street View image to see the corner on the left."

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, message, 355, 150);

        svw.map.unlockDisableWalking().enableWalking().lockDisableWalking();
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.map.setHeadingRange([250, 295]);


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
                        KeepDraggingUntilTheThirdCorner();
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

    function KeepDraggingUntilTheThirdCorner () {
        // This method asks users to keep dragging the Street View image until their view is facing next corner.
        var keepDraggingMessage = "Keep dragging until you see the next corner.";
        var cornerIsVisible = false;
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, keepDraggingMessage, 355, 70);


        $viewControlLayer.bind({
            'mousemove' : function () {
                if (!stepDone) {
                    //
                    // Check the current pov. Check if the user is facing the second corner.
                    // If so, prompt to click a Curb Ramp button. Otherwise show a message to adjust the angle.
                    var pov = svw.getPOV();
                    var heading = pov.heading;

                    if (245 < heading && heading <= 250) {
                        ThirdCorner_ModeSwitchToMissingCurbRamp();
                        stepDone = true;
                    }
                }
            }
        });
    }

    function ThirdCorner_ModeSwitchToMissingCurbRamp () {
        var message = "There are no curb ramp at all at this corner. Let's label a missing curb ramp.";
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
        onb.renderMessage(240, 20, message, 350, 110);
        onb.renderRoundArrow(240, 60, 190, 20);

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
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                window.clearInterval(blinkInterval);
                ThirdCorner_LabelMissingCurbRamp();
            }
        });
    }

    function ThirdCorner_LabelMissingCurbRamp () {
        // This method asks you to label the missing curb ramp.
        var interval = undefined;
        var labels = svw.canvas.getLabels();
        var originalLabelsLen = labels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(9300, -255, pov); // This helper function is in a Point file

        var message = "Trace the end of the sidewalk to label the missing curb ramp.";

        //
        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(curbRampCanvasCoordinate.x - 230, curbRampCanvasCoordinate.y - 130, message, 350, 70);
        onb.renderArrow(curbRampCanvasCoordinate.x, curbRampCanvasCoordinate.y - 60, curbRampCanvasCoordinate.x, curbRampCanvasCoordinate.y);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            labels = svw.canvas.getLabels();
            len = labels.length;
            if (len > originalLabelsLen) {
                var userLabel = labels[len - 1];
                var thirdCurbRampLabel = labels[3];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;

                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 4) {
                        GrabAndDragToMoveToTheFourthCorner ();
                    } else {
                        ThirdCorner_RedoLabelingTheMissingCurbRampWithFinerOutline();
                    }
                } else {
                    ThirdCorner_RedoLabelingTheMissingCurbRamp();
                }
            }
        }, 200);

    }

    function ThirdCorner_RedoLabelingTheMissingCurbRamp () {
        // This method asks you to redo the labeling for the third curb ramp.
        var message = "Hmm, seems like the label you drew does not overlap with the missing curb ramp. " +
            "Try again by carefully tracing the outline of end of the sidewalk.";
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
        onb.renderMessage(360, 0, message, 355, 150);


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
        var labels = svw.canvas.getLabels();
        var label = labels[3];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                $buttonZoomOut.css('background', 'white');
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                ThirdCorner_LabelMissingCurbRamp();
            }
        });
    }

    function ThirdCorner_RedoLabelingTheMissingCurbRampWithFinerOutline () {
        // This method asks you to redo the labeling for the third curb ramp.
        var message = "Hmmm, your label overlaps with the ground truth label, but it is not very concise. " +
            "Draw the label with more than four points.";
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
        onb.renderMessage(360, 0, message, 355, 150);


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
        var labels = svw.canvas.getLabels();
        var label = labels[3];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                $buttonZoomOut.css('background', 'white');
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                ThirdCorner_LabelMissingCurbRamp();
            }
        });
    }

    function GrabAndDragToMoveToTheFourthCorner () {
        // This method asks a user to drag a SV image to the fourth corner
        var mouseDown = false;
        var AdjustHeadingAngleDone = false;
        var handAnimation = undefined;
        var handAnimationTimeout;
        var message = "Great! Let's adjust a view to look at another corner. " +
            "Grab and drag the Street View image to see the corner on the left."

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, message, 355, 150);

        svw.map.unlockDisableWalking().enableWalking().lockDisableWalking();
        svw.canvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        svw.map.setHeadingRange([155, 260]);


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
                        KeepDraggingUntilTheFourthCorner();
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

    function KeepDraggingUntilTheFourthCorner () {
        // This method asks users to keep dragging the Street View image until their view is facing next corner.
        var keepDraggingMessage = "Keep dragging until you see the next corner.";
        var cornerIsVisible = false;
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, keepDraggingMessage, 355, 70);


        $viewControlLayer.bind({
            'mousemove' : function () {
                if (!stepDone) {
                    //
                    // Check the current pov. Check if the user is facing the second corner.
                    // If so, prompt to click a Curb Ramp button. Otherwise show a message to adjust the angle.
                    var pov = svw.getPOV();
                    var heading = pov.heading;

                    if (150 < heading && heading <= 155) {
                        FourthCorner_ZoomOut();
                        stepDone = true;
                    }
                }
            }
        });
    }

    function FourthCorner_ZoomOut () {
        // This method asks you to zoom out.
        var interval = undefined;
        var len = undefined;
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone;

        var message = "This is a little too close. Let's zoom out by clicking the Zoom Out button.";

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '-20px'
        });
        onb.clear();
        onb.renderMessage(360, 30, message, 355, 70);
        onb.renderArrow(520, 30, 520, 10);

        //
        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonZoomOut.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $buttonZoomIn.css('background', 'white');
            }
        }, 500);

        //
        // Let a user to click on the mode switch button
        $buttonZoomOut.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                window.clearInterval(blinkInterval);
                $buttonZoomOut.css('background', 'white');
                FourthCorner_ModeSwitchToMissingCurbRamp();
            }
        });
    }

    function FourthCorner_ModeSwitchToMissingCurbRamp () {
        var message = "In this image, there is one missing curb ramp and one curb ramp. " +
            "Let's first label the missing curb ramp!";
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
        onb.renderMessage(240, 20, message, 350, 110);
        onb.renderRoundArrow(240, 60, 190, 20);

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
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                window.clearInterval(blinkInterval);
                FourthCorner_LabelMissingCurbRamp();
            }
        });
    }

    function FourthCorner_LabelMissingCurbRamp () {
        // This method asks a user to label the fourth corner.
        var interval = undefined;
        var labels = svw.canvas.getLabels();
        var originalLabelsLen = labels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(6264, -640, pov); // This helper function is in a Point file
        // {x: 6264.222222222222, y: -644.1277777777777},

        var message = "Let's draw an outline around the end of the crosswalk!";
        onb.clear();
        onb.renderMessage(curbRampCanvasCoordinate.x - 230, curbRampCanvasCoordinate.y - 130, message, 350, 70);
        onb.renderArrow(curbRampCanvasCoordinate.x - 50, curbRampCanvasCoordinate.y - 60, curbRampCanvasCoordinate.x, curbRampCanvasCoordinate.y);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            labels = svw.canvas.getLabels();
            len = labels.length;
            if (len > originalLabelsLen) {
                var userLabel = labels[len - 1];
                var thirdCurbRampLabel = labels[4];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;


                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 4) {
                        FourthCorner_ModeSwitchToCurbRamp ();
                    } else {
                        FourthCorner_RedoLabelingTheMissingCurbRampWithFinerOutline();
                    }
                } else {
                    FourthCorner_RedoLabelingTheMissingCurbRamp();
                }
            }
        }, 200);

    }

    function FourthCorner_RedoLabelingTheMissingCurbRamp () {
        // This method asks you to redo the labeling for the third curb ramp.
        var message = "Hmm, seems like the label you drew does not overlap with the missing curb ramp. " +
            "Try again by carefully drawing an outline at the end of the cross walk.";
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
        onb.renderMessage(360, 0, message, 355, 150);


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
        var labels = svw.canvas.getLabels();
        var label = labels[4];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                $buttonZoomOut.css('background', 'white');
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                FourthCorner_LabelMissingCurbRamp();
            }
        });
    }

    function FourthCorner_RedoLabelingTheMissingCurbRampWithFinerOutline () {
        // This method asks you to redo the labeling for the third curb ramp.
        var message = "Hmmm, your label overlaps with the ground truth label, but it is not very concise. " +
            "Draw the label with more than four points.";
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
        onb.renderMessage(360, 0, message, 355, 150);


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
        var labels = svw.canvas.getLabels();
        var label = labels[4];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchMissingCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                $buttonZoomOut.css('background', 'white');
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                FourthCorner_LabelMissingCurbRamp();
            }
        });
    }

    function FourthCorner_ModeSwitchToCurbRamp () {
        var message = "Great! There is a curb ramp. Let's label it too!";
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
        onb.renderMessage(160, 20, message, 350, 70);
        onb.renderRoundArrow(160, 60, 120, 20);

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
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                window.clearInterval(blinkInterval);
                FourthCorner_LabelACurbRamp();
            }
        });
    }

    function FourthCorner_LabelACurbRamp () {
        var interval = undefined;
        var labels = svw.canvas.getLabels();
        var originalLabelsLen = labels.length;
        var len = undefined;
        var pov = svw.getPOV();
        var curbRampCanvasCoordinate = svw.gsvImageCoordinate2CanvasCoordinate(4704, -690, pov); // This helper function is in a Point file
        var message = "Draw an outline the curb ramp and label it!";

        //
        // Clear and render arrows and messages
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(curbRampCanvasCoordinate.x, curbRampCanvasCoordinate.y - 160, message, 350, 70);
        onb.renderArrow(curbRampCanvasCoordinate.x + 40, curbRampCanvasCoordinate.y - 90, curbRampCanvasCoordinate.x, curbRampCanvasCoordinate.y - 40);

        svw.canvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        interval = setInterval(function () {
            labels = svw.canvas.getLabels();
            len = labels.length;
            if (len > originalLabelsLen) {
                var userLabel = labels[len - 1];
                var thirdCurbRampLabel = labels[5];
                var overlap = userLabel.overlap(thirdCurbRampLabel);
                var numPoints = userLabel.getPath().getPoints().length;


                window.clearInterval(interval);
                //
                // Move on to the next step of redo the labeling
                if (overlap > properties.overlapThreshold) {
                    if (numPoints > 4) {
                        DoneLabelingAllTheCorners_EndLabeling();
                    } else {
                        FourthCorner_RedoLabelingTheCurbRampWithFinerOutline();
                    }
                } else {
                    FourthCorner_RedoLabelingTheCurbRamp();
                }
            }
        }, 200);

    }

    function FourthCorner_RedoLabelingTheCurbRamp () {
        // This method asks you to redo the labeling for the third curb ramp.
        var message = "Hmm, seems like the label you drew does not overlap with the curb ramp. " +
            "Try again by carefully tracing the outline of the curb ramp.";
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
        onb.renderMessage(360, 0, message, 355, 150);

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
        var labels = svw.canvas.getLabels();
        var label = labels[5];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                $buttonZoomOut.css('background', 'white');
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                FourthCorner_LabelACurbRamp();
            }
        });
    }

    function FourthCorner_RedoLabelingTheCurbRampWithFinerOutline () {
        // This method asks you to redo the labeling for the third curb ramp.
        var message = "Hmmm, your label overlaps with the ground truth label, but it is not very concise. " +
            "Draw the label with more than four points.";
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
        onb.renderMessage(360, 0, message, 355, 150);

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
        var labels = svw.canvas.getLabels();
        var label = labels[5];
        label.unlockVisibility().setVisibility('visible').fadeFillStyle().lockVisibility();
        svw.canvas.clear().render2();
        label.blink(3);

        //
        // Let a user to click on the mode switch button
        $buttonModeSwitchCurbRamp.bind('click', function () {
            if (!stepDone) {
                var labels = svw.canvas.getLabels();
                stepDone = true;
                $buttonZoomOut.css('background', 'white');
                window.clearInterval(blinkInterval);
                svw.canvas.removeLabel(labels[labels.length - 1]);
                label.unlockVisibility().setVisibility('hidden').fadeFillStyle().lockVisibility();
                svw.canvas.clear().render2();
                FourthCorner_LabelACurbRamp();
            }
        });
    }

    function DoneLabelingAllTheCorners_EndLabeling () {
        // This method asks a user to submit.
        var message = "Great! Now you've completed the task. Let's submit the task by clicking the submit button.";
        onb.clear();
        onb.renderMessage(0, 365, message, 715, 70);
        onb.renderArrow(600, 440, 600, 470);

        $divHolderOnboardingCanvas.css({
            top: '40px',
            'z-index': 100
        });

        $submitButton.unbind('click');
        $submitButton.bind('click', function () {
            console.log('Submit clicked')
        });
    }

    function submit () {
        // This method submits the result.
        if (properties.previewMode) {
            // If it is a previewMode, return false.
            return false;
        }

        var data = {};
        data.turker_id = properties.turker_id;
        data.userInteraction = svw.tracker.getActions();
        data.qualification_type = 'CurbRampVerifier';

        return false;
        // Insert a record that the user finished tutorial
        $.ajax({
            async: false,
            url: properties.qualification_url,
            type: 'post',
            data: data
        });

        window.location.reload();
        return true;
    }
    ////////////////////////////////////////////////////////////////////////////////
    // oPublic functions
    ////////////////////////////////////////////////////////////////////////////////
    oPublic.start = function () {
        // This method is called when the page is loaded. Once called, the onboarding will start.
        // The method loads 3 labels (oPublic.LabelPoints_FirstLabel, oPublic.LabelPoints_SecondLabel, oPublic.LabelPoints_ThirdLabel)
        // and show it on canvas. Then it will tell users to advance with the tutorial.
        var $OkBtn01;
        var interval;
        var blinkInterval;
        var highlighted = false;
        var i = 0;
        var len = 0;
        var labels = [];

        svw.canvas.insertLabel(oPublic.LabelPoints_FirstCurbRampLabel);
        svw.canvas.insertLabel(oPublic.LabelPoints_SecondCurbRampLabel);
        svw.canvas.insertLabel(oPublic.LabelPoints_ThirdCurbRampLabel);
        svw.canvas.insertLabel(oPublic.LabelPoints_FirstMissingCurbRamp);
        svw.canvas.insertLabel(oPublic.LabelPoints_SecondMissingCurbRamp);
        svw.canvas.insertLabel(oPublic.LabelPoints_ForthCurbRampLabel);

        labels = svw.canvas.getLabels();
        len = labels.length;
        for (i = 0; i < len; i++) {
            labels[i].setVisibility('hidden').lockVisibility();
            labels[i].unlockTagVisibility().setTagVisibility('hidden').lockTagVisibility();
        }

        // svw.tracker.push('OnboardingLabelingBusStopsStart');
        // Set feedback fields
        // svw.progressFeedback.setProgress(0);
        // svw.progressFeedback.setMessage("Let's start the first tutorial!");
        // svw.currentMissionDescription.setCurrentStatusDescription('Your mission is to learn how to ' +
        //    '<span class="bold">label</span> a bus stop using this interface.');

        // I have to do this because disableWalking is only effective after
        // SV is loaded + there is no callback for SV load.
        interval = setInterval(svw.map.hideLinks, 1000);
        svw.canvas.disableLabeling();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.map.setPitchRange([-7,-5]);
        svw.map.setHeadingRange([350, 80]);

        // svw.actionStack.disableRedo();
        // svw.actionStack.disableUndo();
        // svw.form.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
        // svw.form.unlockDisableNoBusStopButton().disableNoBusStopButton().lockDisableNoBusStopButton();

        $divHolderOnboardingCanvas.css({
            left: '-10px',
            top: '-115px'
        });

        onb.renderMessage(0, 0, "<h2 class='bold'>Tutorial 2/3: More on Labeling Curb Ramps</h2>" +
            "Let's work on another tutorial. " +
            "Your task is to label all the curb ramps and missing curb ramps that can be observed from the dropped point. " +
            "Let's walk through how you are supposed to perform the task.",
            940, 180);

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
            FirstCorner_IntroduceCurbRamps();
        });
    };

    init(params, $);
    return oPublic;
}
