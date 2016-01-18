var svw = svw || {};

function Onboarding_VerifyCurbRamps (params, $) {
    var oPublic = {
        className : 'Onboarding_VerifyCurbRamps'
    };
    var properties = {
        previewMode: false,
        taskDescription: 'Onboarding_VerifyCurbRamps'
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
    var $noBusStopButton;
    var $textieldComment;
    var $spanHideLabel;
    var $buttonAgree;
    var $buttonDisagree;

    var $divValidationDialogWindow;


    // Some public setting parameters that other objects can see
    // Location
    oPublic.latlng = {
        lat : 38.912807,
        lng : -77.051574
    };

    // Heading
    oPublic.panoramaPov = {
        heading : 210, // 190,
        pitch : -10,
        zoom : 1
    };

    // Panorama id.
    // oPublic.panoId = 'B6IBw1oLrutscM435zElSQ';
    oPublic.panoId = 'VGyIKSRx4WZw0pjclpJuFw';

    // Bus stop latlng coordinate
    oPublic.busStopLatLng = {
        lat: 38.912766,
        lng : -77.051647
    };

    //
    oPublic.LabelPoints_FirstLabel = [
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100000",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000001",
            "svImageX": "8000",
            "svImageY": "-610",
            "originalHeading": "210",
            "originalPitch": "-10",
            "originalZoom": "1",
            "heading": "210",
            "pitch": "-10",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        },
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100000",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000002",
            "svImageX": "8500",
            "svImageY": "-610",
            "originalHeading": "210",
            "originalPitch": "-10",
            "originalZoom": "1",
            "heading": "210",
            "pitch": "-10",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        },
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100000",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000003",
            "svImageX": "8500",
            "svImageY": "-410",
            "originalHeading": "210",
            "originalPitch": "-10",
            "originalZoom": "1",
            "heading": "210",
            "pitch": "-10",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        },
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100000",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000004",
            "svImageX": "8000",
            "svImageY": "-410",
            "originalHeading": "210",
            "originalPitch": "-10",
            "originalZoom": "1",
            "heading": "210",
            "pitch": "-10",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        }
    ];

    oPublic.LabelPoints_SecondLabel = [
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100001",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000011",
            "svImageX": "9000",
            "svImageY": "-610",
            "originalHeading": "240",
            "originalPitch": "-16",
            "originalZoom": "1",
            "heading": "240",
            "pitch": "-16",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        },
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100001",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000012",
            "svImageX": "9500",
            "svImageY": "-610",
            "originalHeading": "240",
            "originalPitch": "-16",
            "originalZoom": "1",
            "heading": "240",
            "pitch": "-16",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        },
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100001",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000013",
            "svImageX": "9500",
            "svImageY": "-410",
            "originalHeading": "240",
            "originalPitch": "-16",
            "originalZoom": "1",
            "heading": "240",
            "pitch": "-16",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        },
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100001",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000014",
            "svImageX": "9000",
            "svImageY": "-410",
            "originalHeading": "240",
            "originalPitch": "-16",
            "originalZoom": "1",
            "heading": "240",
            "pitch": "-16",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        }
    ];

    oPublic.LabelPoints_ThirdLabel = [
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100002",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000021",
            "svImageX": "11000",
            "svImageY": "-680",
            "originalHeading": "130",
            "originalPitch": "-16",
            "originalZoom": "1",
            "heading": "300",
            "pitch": "-16",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        },
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100002",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000022",
            "svImageX": "11700",
            "svImageY": "-680",
            "originalHeading": "130",
            "originalPitch": "-16",
            "originalZoom": "1",
            "heading": "130",
            "pitch": "-16",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        },
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100002",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000023",
            "svImageX": "11700",
            "svImageY": "-410",
            "originalHeading": "130",
            "originalPitch": "-16",
            "originalZoom": "1",
            "heading": "130",
            "pitch": "-16",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        },
        {
            "AmazonTurkerId": "Researcher_Jonah",
            "LabelId": "100002",
            "LabelGSVPanoramaId": "_AUz5cV_ofocoDbesxY3Kw",
            "LabelType": "CurbRamp",
            "LabelPointId": "1000024",
            "svImageX": "11000",
            "svImageY": "-410",
            "originalHeading": "130",
            "originalPitch": "-16",
            "originalZoom": "1",
            "heading": "130",
            "pitch": "-16",
            "zoom": "1",
            "Lat": "38.894799",
            "Lng": "-77.021906"
        }
    ];


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
        $spanModeSwitchButtonStopSign = $("#ModeSwitchButton_StopSign");
        $divLabelDrawingLayer = $("div#labelDrawingLayer");
        $divHolderOnboarding = $("#Holder_Onboarding");
        $submitButton = $("#Button_Submit");
        $noBusStopButton = $("#Button_NoBusStop");
        $textieldComment = $("#CommentField");

        // Validation interface jQuery elements
        $divValidationDialogWindow = $("#ValidationDialogWindow");
        $spanHideLabel = $("#ValidationCurrentLabeliVisibility_Hidden");
        $buttonAgree = $("#ValidationButtonAgree");
        $buttonDisagree = $("#ValidationButtonDisagree");
    }


    function FirstExample_IntroduceCurbRampLabel () {
        // This method shows amessage box that introduce curb ramp labels.
        var message = "Let’s learn how to verify curb ramp labels. This green box (or label) is supposed to outline a curb ramp.";
        var blinkInterval = undefined;
        var highlighted = false;

        $('path').remove();

        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(10, 70, message, 350, 160);
        onb.renderArrow(330, 230, 380, 270);

        // Show a label to validate, but hide the dialog window.
        svw.validator.validateNext(0);
        svw.validator.hideDialogWindow();

        // Insert an ok button into the message box.
        $divOnboardingMessageBox.append(dom.BtnNext);
        var $OkBtn = $("#OnboardingButton_Ok01");

        $OkBtn.css({
            left: '20px',
            bottom: '10px',
            position: 'absolute',
            width: 100,
            'z-index': 1000
        });

        // Highlight (blink) the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $OkBtn.css('background', 'rgba(252, 237, 62, 1)');
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
            window.clearInterval(blinkInterval);
            onb.resetMessageBoxFill();
            FirstExample_IntroduceDialogBox();
        });
    }

    function FirstExample_IntroduceDialogBox () {
        // This function shows a message box that introduces the dialog box in the verification interface.
        // Clear and render the onboarding canvas
        var message = 'To verify whether the green box is correctly placed on top of a curb ramp, you must respond to this pop-up window.';
        var blinkInterval;
        var highlighted = false;

        onb.clear();
        onb.renderMessage(10, 220, message, 350, 190);
        onb.renderArrow(330, 410, 380, 440);

        //
        // Change the font color in the dialog box to black.
        $divValidationDialogWindow.css('color', 'black');

        //
        // Insert an ok button into the message box.
        $divOnboardingMessageBox.append(dom.BtnNext);
        var $OkBtn = $("#OnboardingButton_Ok01");

        $OkBtn.css({
            left: '20px',
            bottom: '10px',
            position: 'absolute',
            width: 100,
            'z-index': 1000
        });

        //
        // Show a dialog window.
        // Set the border color and width of the dialog box to highlight it.
        svw.validator.showDialogWindow(500);
        svw.validator.setDialogWindowBorderWidth('3px');
        svw.validator.setDialogWindowBorderColor('yellow');

        // Blink the next button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $OkBtn.css('background', 'rgba(252, 237, 62, 1)');
            } else {
                highlighted = true;
                $OkBtn.css('background', 'white');
            }
        }, 500);

        // Bind a click event to the next button
        $OkBtn.bind('click', function () {
            $OkBtn.remove();
            svw.validator.setDialogWindowBorderWidth('0px');
            svw.validator.setDialogWindowBorderColor('black');
            $divHolderOnboardingCanvas.css({
                left : '0px',
                top: '0px'
            });
            onb.resetMessageBoxFill();
            window.clearInterval(blinkInterval);
            FirstExample_HideLabel();
        });
    }

    function FirstExample_HideLabel () {
        // This method shows a message box that tells a user to put a mouse cursor on top of "Hide label" that allows
        // them to see what's beneath the label.
        var FirstExample_HideLabel_Done = false;
        var blinkInterval = undefined;
        var highlighted = false;
        var message = "You can hide the green box temporarily to help see the image by placing the mouse cursor over \"Hide label.\"";

        onb.clear();
        // onb.renderMessage(360, 10, message, 350, 140);
        onb.renderMessage(30, 220, message, 350, 140);
        onb.renderArrow(330, 360, 380, 410);

        // Blink the Hide label span
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $spanHideLabel.css('background', 'rgba(252, 237, 62, 0.7)');
            } else {
                highlighted = true;
                $spanHideLabel.css('background', 'transparent');
            }
        }, 500);


        $spanHideLabel.bind('mouseover', function () {
            console.log(FirstExample_HideLabel_Done);
            if (!FirstExample_HideLabel_Done) {
                FirstExample_HideLabel_Done = true;
                $spanHideLabel.css('background', 'transparent');
                window.clearInterval(blinkInterval);
                FirstExample_AgreeWithTheLabel();
            }
        });
    }

    function FirstExample_AgreeWithTheLabel () {
        // This method shows a message box that tells user to agree with the label and highlights the Agree button.
        var FirstExample_AgreeWithTheLabel_Done = false;
        var blinkInterval = undefined;
        var highlighted = false;

        var message = 'Great! In this case, <b>there is a curb ramp.</b> So <b>click "Agree."</b>';
        onb.clear();
        onb.renderMessage(10, 220, message, 350, 70);
        svw.validator.enableAgreeButton();

        // Blink the Agree button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonAgree.css('background', 'rgba(252, 237, 62, 0.7)');
            } else {
                highlighted = true;
                $buttonAgree.css('background', 'transparent');
            }
        }, 500);

        $buttonAgree.bind('click', function () {
           if (!FirstExample_AgreeWithTheLabel_Done) {
               FirstExample_AgreeWithTheLabel_Done = true;
               $buttonAgree.css('background', 'transparent');
               svw.validator.disableAgreeButton();
               window.clearInterval(blinkInterval);
               SecondExample_HideLabel()
           }
        });
    }

    function SecondExample_HideLabel () {
        // This method shows a message box that tells a user to put a mouse cursor on top of "Hide label" that allows
        // them to see what's beneath the label.
        var SecondExample_HideLabel_Done = false;
        var blinkInterval = undefined;
        var highlighted = false;
        var message = "Let's see another example. Again, <b>place the mouse cursor on \"Hide label\"</b> " +
            "to see if the box is placed on top of a curb ramp";
        onb.clear();
        onb.renderMessage(10, 230, message, 350, 140);
        onb.renderArrow(310, 230, 360, 210);
        onb.renderArrow(330, 370, 360, 410);

        // Blink the Hide label span
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $spanHideLabel.css('background', 'rgba(252, 237, 62, 0.7)');
            } else {
                highlighted = true;
                $spanHideLabel.css('background', 'transparent');
            }
        }, 500);


        $spanHideLabel.bind('mouseover', function () {
            if (!SecondExample_HideLabel_Done) {
                SecondExample_HideLabel_Done = true;
                $spanHideLabel.css('background', 'transparent');
                window.clearInterval(blinkInterval);
                SecondExample_DisagreeWithTheLabel();
            }
        });
    }


    function SecondExample_DisagreeWithTheLabel () {
        // This method shows a message box that tells user to disagree with the label and highlights the Disagree button.
        var FirstExample_AgreeWithTheLabel_Done = false;
        var blinkInterval = undefined;
        var highlighted = false;

        var message = "The box is on a road and <b>not on a curb ramp.</b> Since the label is incorrect, " +
            "<b>click \"Disagree.\"</b>";
        onb.clear();
        onb.renderMessage(10, 230, message, 350, 100);

        svw.validator.enableDisagreeButton();

        // Blink the Disgree button
        blinkInterval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $buttonDisagree.css('background', 'rgba(252, 237, 62, 0.7)');
            } else {
                highlighted = true;
                $buttonDisagree.css('background', 'transparent');
            }
        }, 500);

        $buttonDisagree.bind('click', function () {
            if (!FirstExample_AgreeWithTheLabel_Done) {
                FirstExample_AgreeWithTheLabel_Done = true;
                $buttonDisagree.css('background', 'transparent');
                svw.validator.disableDisagreeButton();
                window.clearInterval(blinkInterval);
                ThirdExample_Quiz();
            }
        });
    }

    function ThirdExample_Quiz () {
        // This method prompts users to choose Agree/Disagree for the last example.
        var message = "Great! Now, based on what you have learned, click the appropriate button based on whether the green box is correctly placed on a curb ramp.";

        onb.clear();
        onb.renderMessage(0, 0, message, 715, 70);

        // Unbind the click events from Agree/Disagree buttons.
        $buttonAgree.unbind('click');
        $buttonDisagree.unbind('click');
        svw.validator.enableAgreeButton();
        svw.validator.enableDisagreeButton();
        svw.validator.enableRadioButtons();


        $buttonAgree.bind('click', function () {
            if (properties.previewMode) {
                return false;
            }
            TellUsersToMoveOnToVerificationTasks();
            $buttonAgree.unbind('click');
            $buttonDisagree.unbind('click');
            return false;
        });

        $buttonDisagree.bind('click', function () {
            if (properties.previewMode) {
                return false;
            }
            ThirdExample_RedoQuiz ();
            return false;
        });
    }

    function ThirdExample_RedoQuiz () {
        var message = "Hmmmm, that is incorrect. Try again and \"Agree\" or \"Disagree\" with the label.";

        onb.clear();
        onb.renderMessage(0, 0, message, 715, 70);
    }

    function TellUsersToMoveOnToVerificationTasks () {
        // This method shows a message that tells users that this is the end of the training
        // and to move on to actual tasks.

        var message = "That's correct! This is the end of the tutorial. Let's click \"OK\" to move on to the actual task. " +
            "Thank you for helping to improve city sidewalk accessibility.";

        onb.clear();
        onb.renderMessage(0, 0, message, 715, 110);

        // Gray out the dialog box.
        $divValidationDialogWindow.css('color', 'rgba(200,200,200,1)');

        // Insert an ok button into the message box.
        $divOnboardingMessageBox.append(dom.BtnOk);
        var $OkBtn = $("#OnboardingButton_Ok01");

        $OkBtn.css({
            left: '20px',
            bottom: '10px',
            position: 'absolute',
            width: 100,
            'z-index': 1000
        });

        $OkBtn.bind('click', function () {
            $OkBtn.remove();
            $divHolderOnboardingCanvas.css({
                left : '0px',
                top: '0px'
            });
            if (properties.previewMode) {
                return false;
            }
            submit();
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

        svw.canvas.insertLabel(oPublic.LabelPoints_FirstLabel);
        svw.canvas.insertLabel(oPublic.LabelPoints_SecondLabel);
        svw.canvas.insertLabel(oPublic.LabelPoints_ThirdLabel);
        svw.validator.insertLabels(oPublic.LabelPoints_FirstLabel);
        svw.validator.insertLabels(oPublic.LabelPoints_SecondLabel);
        svw.validator.insertLabels(oPublic.LabelPoints_ThirdLabel);
        // svw.validator.validateNext();


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
        svw.canvas.disableMenuClose();
        svw.canvas.disableLabelDelete().lockDisableLabelDelete();
        svw.canvas.disableLabelEdit().lockDisableLabelEdit();
        svw.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        svw.validator.disableRadioButtons();
        svw.validator.disableAgreeButton();
        svw.validator.disableDisagreeButton();

        // svw.actionStack.disableRedo();
        // svw.actionStack.disableUndo();
        // svw.form.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
        // svw.form.unlockDisableNoBusStopButton().disableNoBusStopButton().lockDisableNoBusStopButton();

        $divHolderOnboardingCanvas.css({
            left: '-10px',
            top: '-50px'
        });

        onb.renderMessage(0, 0, "<h2 class='bold'>Tutorial: Verifying Curb Ramp Labels</h2>" +
            "Without curb ramps, wheelchair users cannot navigate city sidewalks. " +
            "In this task, your mission is to verify curb ramp labels in Google Street View. Your work will make city streets and sidewalks more accessible." +
            // " that is they can get on/off the sidewalk from/to street with wheelchairs." +
            "<br /><br />" +
            "<div style='position:relative; left:30px; width: 630px;'>" +
            "<div class='OnboardingLabelingBusStopExample InlineBlock'>" + // First image
            "<div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/onboarding/Onboarding_Verification_CurbRamps_WithLabels.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div>" +
            "<div class='OnboardingLabelingBusStopExampleCaption'>" +
            "An image of curb ramps at a city intersection." +
            "</div>" +
            "</div>" + // End of the first image
            "<div class='OnboardingLabelingBusStopExample InlineBlock'>" + // Second image
            "<div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/onboarding/Onboarding_Verification_LabelOnACurbRamp_WithLabels.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div>" +
            "<div class='OnboardingLabelingBusStopExampleCaption'>" +
            "An image with a curb ramp label (green box), which indicates presence of a curb ramp." +
            "</div>" +
            "</div>" + // End of the second image
            "<div class='OnboardingLabelingBusStopExample InlineBlock'>" + // Third image
            "<div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/onboarding/Onboarding_Verification_LabelNotOnACurbRamp_WithLabels.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div>" +
            "<div class='OnboardingLabelingBusStopExampleCaption'>" +
            "A curb ramp label could be <span class='bold'>misplaced</span> on, for example, a road." +
            "</div>" +
            "</div>" + // End of the third image
            "</div>" +
            "<br/><br /><br />" +
            "<span class='bold'>We'll begin with a short, interactive tutorial to get you started!</span> " +
            "Thanks for helping to improve access to city sidewalks.<br /><br />",
            740, 560);

        onb.setMessageBoxFill('rgba(60,60,60,1)');

        $divOnboardingMessageBox.append(dom.BtnNext);
        $OkBtn01 = $("#OnboardingButton_Ok01");


        $OkBtn01.css({
            'left' : '20px',
            'font-family': 'SegoeUISemiBold',
            'top' : '460px',
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
            $divValidationDialogWindow.css('color', 'rgba(200,200,200,1)');
            window.clearInterval(interval);
            window.clearInterval(blinkInterval);
            FirstExample_IntroduceCurbRampLabel();
        });
    };

    init(params, $);
    return oPublic;
}