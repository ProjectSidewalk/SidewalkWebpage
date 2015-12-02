var svw = svw || {};

function Onboarding_SkipAlleyWithoutCurbRamps (params, $) {
    var oPublic = {
        className : 'Onboarding_SkipAlleyWithoutCurbRamps'
    };
    var properties = {
        overlapThreshold: 0.5,
        previewMode: false,
        taskDescription: 'Onboarding_SkipAlleyWithoutCurbRamps'
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
    var $divLabelDrawingLayer;
    var $submitButton;
    var $textieldComment;
    var $buttonSkip;
    var $buttonModeSwitchCurbRamp;
    var $buttonModeSwitchMissingCurbRamp;
    var $viewControlLayer;


    // Some public setting parameters that other objects can see
    // Location
    oPublic.latlng = {
        lat : 52.115689,
        lng : -106.655887
    };

    // Heading
    oPublic.panoramaPov = {
        heading : 359, // 190,
        pitch : -10,
        zoom : 1
    };

    // Panorama id.
    oPublic.panoId = 'KqY9X2tkJN1WDFALSkVrvQ';

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

        $buttonSkip = $("#Button_Skip");

        //
        // Labeling interface
        $buttonModeSwitchCurbRamp = $("#ModeSwitchButton_CurbRamp");
        $buttonModeSwitchMissingCurbRamp = $("#ModeSwitchButton_NoCurbRamp");

    }


    function ShowNorthSideOfTheIntersection () {
        // This method shows amessage box that introduce curb ramp labels.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding3_ShowNorthSideOfTheIntersection');
        }
        var message = "At this alley, there are no curbs that would obstruct a wheelchair user from getting on or off the sidewalk. " +
            "So, curb ramps are <b>not</b> needed here.";
        var blinkInterval = undefined;
        var highlighted = false;
        var stepDone = false;
        var $OkBtn;
        $('path').remove();

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(0, 0, message, 715, 110);

        // Draw arrows to the end of sidewalks
        onb.renderArrow(310, 250, 260, 270);
        onb.renderArrow(395, 250, 445, 270);
        onb.renderCanvasMessage(200, 230, "No need for curb ramps", {fontSize: 24});

        $divOnboardingMessageBox.append(dom.BtnNext);
        $OkBtn = $("#OnboardingButton_Ok01");
        $OkBtn.css({
            'left' : '20px',
            'font-family': 'SegoeUISemiBold',
            'bottom' : '10px',
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
            onb.resetMessageBoxFill();
            window.clearInterval(blinkInterval);
            GrabAndDrag();
        });
    }

    function GrabAndDrag () {
        // This method asks a user to turn around.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding3_GrabAndDrag');
        }
        var message = "Let's look at the other side of the alley. " +
            "Grab and drag the Street View image to turn around. " ;
        var AdjustHeadingAngleDone;
        var handAnimationTimeout;
        var mouseDown;

        //
        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(360, 0, message, 355, 110);

        svw.map.unlockDisableWalking().enableWalking().lockDisableWalking();

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
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding3_KeepDragging');
        }
        var keepDraggingMessage = "Keep dragging until you see the other side of the alley.";
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

                    if (179 < heading && heading < 183) {
                        SouthSideOfTheIntersection();
                        stepDone = true;
                    }
                }
            }
        });
    }

    function SouthSideOfTheIntersection () {
        // This method shows a message saying there need not be curb ramps on the South side of the intersection either.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding3_SouthSideOfTheIntersection');
        }
        var $OkBtn;
        var blinkInterval;
        var highlighted;
        var stepDone;
        var message = "Again, you can see a smooth transition from the sidewalk to the alley road. " +
            "So, again, curb ramps are not needed here.";
        onb.renderMessage(360, 0, message, 355, 170);

        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        //
        // Draw arrows to the end of sidewalks. Also render a message
        onb.renderArrow(270, 270, 220, 300);
        onb.renderArrow(480, 270, 530, 300);
        onb.renderCanvasMessage(200, 250, "No need for curb ramps", {fontSize: 24});


        $divOnboardingMessageBox.append(dom.BtnNext);
        $OkBtn = $("#OnboardingButton_Ok01");
        $OkBtn.css({
            'left' : '20px',
            'font-family': 'SegoeUISemiBold',
            'bottom' : '10px',
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
            onb.resetMessageBoxFill();
            window.clearInterval(blinkInterval);
            svw.map.setHeadingRange([undefined,undefined]);
            GrabAndDragToNorth();
        });
    }


    function GrabAndDragToNorth () {
        // After assessing all the angles, this method asks a user to click skip
        //var keepDraggingMessage = "Keep dragging until you see the other side of the intersection.";
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding3_GrabAndDragToNorth');
        }
        var keepDraggingMessage = "Keep dragging to the left until you have reviewed the entire scene. ";
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '0px'
        });
        onb.clear();
        onb.renderMessage(360, 0, keepDraggingMessage, 355, 70);

        //
        // Set parameters
        svw.map.unlockDisableWalking().enableWalking().lockDisableWalking();
        svw.map.setHeadingRange([8, 190]);

        $viewControlLayer.bind({
            'mousemove' : function () {
                if (!stepDone) {
                    //
                    // Check the current pov. Check if the user is facing the second corner.
                    // If so, prompt to click a Curb Ramp button. Otherwise show a message to adjust the angle.
                    var pov = svw.getPOV();
                    var heading = pov.heading;

                    if (8 <= heading && heading < 10) {
                        ClickSkip();
                        stepDone = true;
                    }
                }
            }
        });
    }

    function ClickSkip () {
        // Prompt a user to click skip
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding3_ClickSkip');
        }
        var message = "Great, you have finished inspecting this entire area (notice the progress meter is full on the right). " +
            "Because there are no curb ramps and no missing curb ramps, let's click \"Skip\" to finish the task without submitting any labels. " +
            "You are still paid for your work if you make this selection.";
        var stepDone = false;

        //
        // Clear and render the onboarding canvas
        $divHolderOnboardingCanvas.css({
            top: '40px',
            'z-index': 100
        });
        onb.clear();
        onb.renderMessage(0, 290, message, 715, 140);
        onb.renderArrow(150, 430, 150, 470);
        onb.renderArrow(550, 330, 700, 260);

        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();

        $buttonSkip.bind('click', function () {
            if (!stepDone) {
                stepDone = true;
                SelectSkipOption();
            }
        });
    }

    function SelectSkipOption () {
        // This method asks a user to select a correct option.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding3_SelectSkipOption');
        }
        var message = "The reason for skipping this task is because the sidewalks do not need curb ramps. " +
            "Let's select <b>\"This intersection does not require curb ramps.\"</b>";
        var stepDone = false;

        onb.clear();
        onb.renderMessage(0, 360, message, 715, 70);
        onb.renderArrow(217, 430, 217, 470);

        $("#BusStopAbsence_Submit").unbind('click');
        $("#BusStopAbsence_Submit").attr("disabled", true);
        $("#BusStopAbsence_Cancel").attr("disabled", true);


        $("#Radio_NoCurbRampsRequired").bind('click', function () {
            ClickSkipOk();
        });
    }

    function ClickSkipOk () {
        // Prompt a user to click ok on the skip option.
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding3_ClickSkipOk');
        }
        var message = "Great! Now click <b>OK</b> to submit and we'll start you on an actual task. ";
        var stepDone = false;
        var interval;
        var highlighted;
        var submitButton = $("#BusStopAbsence_Submit")

        $divHolderOnboardingCanvas.css({
            top: '60px'
        });

        interval = setInterval(function () {

        }, 200);

        interval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                submitButton.css('background', 'rgba(252, 247, 192, 1)');
            } else {
                highlighted = true;
                submitButton.css('background', 'white');
            }
        }, 500);

        onb.clear();
        onb.renderMessage(0, 380, message, 715, 40);
        onb.renderArrow(100, 420, 100, 470);

        submitButton.bind('click', function (e) {
            window.clearInterval(interval);
            submitButton.css('background', 'white');
            finalMessage(e);
        });
    }

    function finalMessage (e) {
        if (e && ('preventDefault' in e)) {
            e.preventDefault();
        }
        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding3_finalMessage');
        }
        var $OkBtn;
        var blinkInterval;
        var highlighted = false;
        var message = "You've done it&mdash;you've completed all of the tutorials. Now, you are ready to go out and inspect the world's street intersections to make sure that they are accessible to people in wheelchairs. " +
            "Thanks for helping make the world more accessible! Click <b>OK</b> to move on!";

        onb.clear();
        onb.renderMessage(0, 150, message, 715, 170);
        $divOnboardingMessageBox.append(dom.BtnNext);


        $OkBtn = $("#OnboardingButton_Ok01");
        $OkBtn.css({
            'left' : '20px',
            'font-family': 'SegoeUISemiBold',
            'bottom' : '10px',
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
            onb.resetMessageBoxFill();
            window.clearInterval(blinkInterval);
            submit(e);
        });
    }

    function submit (e) {
        // This method submits the result.
        // http://api.jquery.com/event.preventDefault/
        if (e && ('preventDefault' in e)) {
            e.preventDefault();
        }

        if ('tracker' in svw && svw.tracker) {
            svw.tracker.push('Onboarding3_Submit');
        }

        if (properties.previewMode) {
            // If it is a previewMode, return false.
            return false;
        }


        var data = svw.form.compileSubmissionData();
        data.turker_id = properties.turker_id;
        data.userInteraction = svw.tracker.getActions();
        data.qualification_type = 'SkipAlley';


        // Insert a record that the user finished tutorial
        $.ajax({
            async: false,
            url: properties.qualification_url,
            type: 'post',
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
            svw.tracker.push('Onboarding3_Start');
        }
        var $OkBtn01;
        var interval;
        var blinkInterval;
        var highlighted = false;


        // svw.tracker.push('OnboardingLabelingBusStopsStart');
        // Set feedback fields
        // svw.progressFeedback.setProgress(0);
        // svw.progressFeedback.setMessage("Let's start the first tutorial!");
        svw.currentMissionDescription.setCurrentStatusDescription('Your mission is to learn to <b>skip</b> the task ' +
            'when there need not be curb ramps and are no missing curb ramps.');

        // I have to do this because disableWalking is only effective after
        // SV is loaded + there is no callback for SV load.
        interval = setInterval(svw.map.hideLinks, 200);
        svw.canvas.disableLabeling();
        svw.canvas.disableLabelDelete().lockDisableLabelDelete();
        svw.canvas.disableLabelEdit().lockDisableLabelEdit();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.map.setPitchRange([-10,-5]);
        svw.map.setHeadingRange([180,2]);
        svw.zoomControl.unlockDisableZoomOut().disableZoomOut().lockDisableZoomOut();
        svw.zoomControl.unlockDisableZoomIn().disableZoomIn().lockDisableZoomIn();
        svw.ribbon.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();

        $divHolderOnboardingCanvas.css({
            left: '-10px',
            top: '-115px'
        });

        onb.renderMessage(0, 0, "<h2 class='bold'>Tutorial 3/3: Alleys and Curb Ramps</h2>" +
            "Sometimes, our labeling system will transport you to an alley. " +
            "Many alleys do not require curb ramps because the sidewalk is at the same height as the alley road.",
            940, 150);

        onb.setMessageBoxFill('rgba(60,60,60,1)');

        $divOnboardingMessageBox.append(dom.BtnNext);
        $OkBtn01 = $("#OnboardingButton_Ok01");


        $OkBtn01.css({
            'left' : '20px',
            'font-family': 'SegoeUISemiBold',
            'bottom' : '15px',
            'position' : 'absolute',
            'width' : 100,
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
            ShowNorthSideOfTheIntersection();
        });
    };

    init(params, $);
    return oPublic;
}
