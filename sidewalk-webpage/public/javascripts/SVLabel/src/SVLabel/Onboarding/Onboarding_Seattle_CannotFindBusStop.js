/**
 * Created with JetBrains PhpStorm.
 * User: kotarohara
 * Date: 4/2/13
 * Time: 9:27 AM
 * To change this template use File | Settings | File Templates.
 */

function Onboarding_Seattle_CannotFindBusStop (params) {
    var oPublic = {
        className : 'Onboarding_Seattle_CannotFindBusStop'
    };

    var properties = {
        minBusStopTargetX : 335,
        maxBusStopTargetX : 375,
        minBusStopTargetY : 290,
        maxBusStopTargetY : 330,
        totalTaskCount: 6,
        turker_id : undefined,
        qualification_url : undefined,
        taskDescription: 'Onboarding_Seattle_LabelingBusStop'
    };
    var status = {
        currentLabel : undefined
    };
    var onb;
    var onbMap;
    var rightClickMenu;
    var dom;
    var handAnimation;

    // jQuery dom
    var $divHolderOnboardingCanvas;
    var $divHolderOnboarding;
    var $divOnboardingMessage;
    var $divOnboardingMessageBox;
    var $spanModeSwitchButtonStopSign;
    var $divLabelDrawingLayer;
    var $submitButton;
    var $noBusStopButton;
    var $textieldComment;


    oPublic.latlng = {
        lat : 47.656311,
        lng : -122.3146
    };

    //
    // Some public setting parameters that other objects can see
    //
    // Heading
    oPublic.panoramaPov = {
        heading : 270,
        pitch : -10,
        zoom : 1
    };

    oPublic.availablePanoIds = [

    ];

    // Panorama id where turker starts onboarding.
    oPublic.panoId = 'I9jZZt-qDua5VBd9JUytMg';

    // Bus stop latlng coordinate
    oPublic.busStopLatLng = {
        lat : 47.656311,
        lng : -122.3146
    };

    // some dom elements that we will dynamically create.
    dom = {
        'Btn_Ok01' : '<button id="OnboardingButton_Ok01" class="button">OK</button>',
        'Btn_Ok_MapInstruction' : '<button id="OnboardingButton_Ok_MapInstruction" class="button">Ok</button>',
        'Btn_Ok_Step4' : '<button id="OnboardingButton_Ok_Step4" class="button">OK</button>',
        'Btn_Ok_Step8' : '<button id="OnboardingButton_Ok_Step8" class="button">OK</button>',
        'Btn_Ok_Step10' : '<button id="OnboardingButton_Ok_Step10" class="button">OK</button>',
        'BusStopIconImage' : '<span class="InlineBlock OnboardingBusStopImageBox"><img src="public/img/icons/Icon_GoogleBusStopIcon.png"></span>',
        'Div_BusStopSceneHighlighter' : '<div id="OnboardingDiv_BusStopSceneHighlighter"></div>'
    };
    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function init(params) {
        onb = new Onboarding(params);
        properties.turker_id = params.turker_id;
        properties.qualification_url = params.qualification_url;

        $divHolderOnboardingCanvas = $("#Holder_OnboardingCanvas");
        $divOnboardingMessageBox = $("#Holder_OnboardingMessageBox");
        $divOnboardingMessage = $("#Holder_OnboardingMessage");
        $spanModeSwitchButtonStopSign = $("#ModeSwitchButton_StopSign");
        $divLabelDrawingLayer = $("div#labelDrawingLayer");
        $divHolderOnboarding = $("#Holder_Onboarding");
        $submitButton = $("#Button_Submit");
        $noBusStopButton = $("#Button_NoBusStop");
        $textieldComment = $("#CommentField");

    }


    function InstructTurkerToLookAtTheMap () {
        // In this step turkers will be asked to look around the scene.
        var InstructTurkersToSeeAMapDone = false;
        myTracker.push('OnboardingSeattleCannotFindBusStop_InstructTurkerToLookAtTheMap');

        // Update the progress bar
        myProgressFeedback.setProgress(1 / properties.totalTaskCount);
        myProgressFeedback.setMessage("Keep following the tutorial.");

        //
        onbMap.unlockDisableWalking().disableWalking().lockDisableWalking();

        // Clear and render on the onboarding canvas
        onb.clear();
        onb.renderArrowWithShadow(640, 325, 710, 380, 'ccw');
        onb.renderMessage(390, 170, "The expected position of the bus stop is shown as " +
            dom.BusStopIconImage +
            " on the map.", 300, 150);

        // Add an ok button to move on to the next tutorial.
        $divOnboardingMessageBox.append(dom.Btn_Ok_MapInstruction);
        var $Btn = $("#OnboardingButton_Ok_MapInstruction");
        $Btn.css({
            'left' : '20px',
            'bottom' : '10px',
            'position' : 'absolute',
            'width' : 100,
            'z-index' : 1000
        });
        $Btn.on('click', function() {
            if (!InstructTurkersToSeeAMapDone) {
                InstructTurkersToSeeAMapDone = true;
                $Btn.remove();
                AdjustHeadingAngle();
            }
        });
    }


    function AdjustHeadingAngle () {
        // Let a user change heading angle.
        var AdjustHeadingAngleDone = false;
        var mouseDown = false;
        myTracker.push('OnboardingSeattleCannotFindBusStop_AdjustHeadingAngle');


        // Update the progress bar!
        myProgressFeedback.setProgress(2 / properties.totalTaskCount);
        onbMap.unlockDisableWalking().enableWalking().lockDisableWalking();

        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(360, 10, "Look around in this scene to find a bus stop. " +
            "<span class='bold'>Hint: it should be on your right based on the map.</span>",
            350, 150);


        $("#viewControlLayer").bind({
            'mousemove' : function () {
                if (!AdjustHeadingAngleDone) {
                    if (mouseDown) {
                        var pov = svw.getPOV();

                        AdjustHeadingAngleDone = true;
                        onb.clear();

                        SuggestTheBusStopIsMissing();
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


    //"It seems like they took out the bus stop sign because of building construction. " +
    function SuggestTheBusStopIsMissing () {
        myTracker.push('OnboardingSeattleCannotFindBusStop_SuggestTheBusStopIsMissing');

        var message = "This is where the bus stop should be based on the map, " +
            "but the bus stop was removed for construction. ";
        var $OkBtn01;

        var SuggestTheBusStopIsMissingDone = false;
        var BtnAppended = false;
        myProgressFeedback.setProgress(3 / properties.totalTaskCount);

        $("#viewControlLayer").bind('mousemove', function () {
            var panoId = getPanoId();

            if (!SuggestTheBusStopIsMissingDone) {
                var pov = svw.getPOV();

                onb.clear();
                if ((0 <= pov.heading &&
                    pov.heading < 40) ||
                    (340 < pov.heading && pov.heading <= 360)
                    ) {
                    onb.clear();
                    onb.renderMessage(10, 10, message, 700, 100);

                    if (!BtnAppended) {
                        BtnAppended = true;
                        $divOnboardingMessageBox.append(dom.Btn_Ok01);
                        $OkBtn01 = $("#OnboardingButton_Ok01");
                        $OkBtn01.css({
                            'left' : '20px',
                            'bottom' : '10px',
                            'position' : 'absolute',
                            'width' : 100,
                            'z-index' : 1000
                        });

                        $divOnboardingMessage.css({
                            'padding-bottom' : '50px',
                            left: '0px',
                            top: '0px'
                        });

                        $OkBtn01.bind('click', function () {
                            console.log('clicked');
                            SuggestTheBusStopIsMissingDone = true;
                            $OkBtn01.remove();
                            $divHolderOnboardingCanvas.css({
                                left : '0px',
                                top: '0px'
                            });
                            $divOnboardingMessage.css({
                                'padding-bottom' : ''
                            });
                            InstructToReportAbsenceOfBusStop();
                        });
                    }

                } else {
                    BtnAppended = false;
                    if ($OkBtn01) {
                        $OkBtn01.remove();
                    }
                    onb.renderMessage(360, 40, "Try to center the bus stop in your view.", 350, 70);
                }
            }
        });
    }


    function InstructToReportAbsenceOfBusStop () {
        myTracker.push('OnboardingSeattleCannotFindBusStop_InstructToReportAbsenceOfBusStop');

        // Ask a user to switch to bus stop labeling mode.
        var InstructToReportAbsenceOfBusStopDone = false;
        myProgressFeedback.setProgress(4 / properties.totalTaskCount);

        if (!InstructToReportAbsenceOfBusStopDone) {
            var pov = svw.getPOV();

            onb.clear();
            if ((0 <= pov.heading && pov.heading < 40) ||
                (340 < pov.heading && pov.heading <= 360)) {
                myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

                onb.clear();
                $divHolderOnboardingCanvas.css({
                    left : '0px',
                    top: '50px',
                    'z-index': 1000
                });
                onb.renderMessage(250, 340,
                    "Let's report that the bus stop is missing by clicking 'I cannot find any bus stop.'",
                    430, 70);
                onb.renderArrowWithShadow(250, 390, 200, 470, 'ccw');
                onbMap.unlockDisableWalking().disableWalking().lockDisableWalking();
                myForm.unlockDisableNoBusStopButton().enableNoBusStopButton().lockDisableNoBusStopButton();
                $("#Button_NoBusStop").on('click', InstructToClickICannotFindAnyBusStopRadioButton);
            } else {
                onb.renderMessage(360, 40, "Try to center the bus stop in your view.", 350, 70);
            }
        }
    }


    function InstructToClickICannotFindAnyBusStopRadioButton () {
        myTracker.push('OnboardingSeattleCannotFindBusStop_InstructToClickICannotFindAnyBusStopRadioButton');

        myProgressFeedback.setProgress(5 / properties.totalTaskCount);
        onb.clear();
        onb.renderArrowWithShadow(260, 390, 177, 460, 'ccw');
        onb.renderMessage(260, 350, 'Click "Cannot find the bus stop at where it should be" to report absence of a bus stop.',
            350, 100);
        // Disable cancel button.
        $("#BusStopAbsence_Cancel").attr('disabled', true);

        $("input.Radio_BusStopAbsence").on('click', function () {
            var strValue = $(this).attr('value');
            console.log(strValue);
            // Check if the string has the substring 'Absence:'
            // http://stackoverflow.com/questions/3480771/jquery-how-to-see-if-string-contains-substring
            if (strValue.indexOf('Absence:') >= 0) {
                SubmitAndComplete();
            }
        });
    }


    function SubmitAndComplete () {
        myTracker.push('OnboardingSeattleCannotFindBusStop_SubmitAndComplete');
        // Submit!
        // Let them submit the task. Disable everything else.
        var prop = onb.getProperties();
        var borderColored = false;

        // Update the feedback window (progress bar and badge)
        myProgressFeedback.setProgress(6 / properties.totalTaskCount);
        myProgressFeedback.setMessage("You've finished tutorials! <br />Proceed to HITs.");

        // Disabling user control
        myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
        myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myCanvas.disableLabeling();
        myCanvas.lockDisableLabeling();
        myForm.unlockDisableSubmit().enableSubmit().lockDisableSubmit();

        $divHolderOnboardingCanvas.css({
            left : '0px',
            top: '70px',
            'z-index': 1000
        });

        onb.clear();
        onb.renderArrowWithShadow(230, 390, 150, 470, 'ccw');
        onb.renderMessage(230, 350, "Great! Let's click OK to submit." ,
            350, 70);

        var interval = setInterval(function () {
            if (borderColored) {
                borderColored = false;
                $("#BusStopAbsence_Submit").css({
                    'background': '',
                    'border': ''
                });
            } else {
                borderColored = true;
                prop = onb.getProperties();
                $("#BusStopAbsence_Submit").css({
                    'background': prop.highlight.fill,
                    'border': prop.highlight.border
                });
            }
        }, 1000);

        $("#BusStopAbsence_Submit").on('click', function (){
            window.clearInterval(interval);
            $("#BusStopAbsence_Submit").css({
                'background': '',
                'border': ''
            });

            myTracker.push('OnboardingSeattleCannotFindBusStopSubmit');
            myTracker.push('TaskSubmitBusStopAbsence');


            var data = {turker_id : properties.turker_id};
            var hitId = getURLParameter("hitId");
            var assignmentId =  getURLParameter("assignmentId");
            var turkerId =  getURLParameter("workerId");
            var taskPanoId = myMap.getInitialPanoId();



            if (!turkerId) {
                turkerId = 'Test_Kotaro';
            }
            if (!hitId) {
                hitId = 'Test_Hit';
            }
            if (!assignmentId) {
                assignmentId = 'Test_Assignment';
            }

            // Disable a submit button.
            $submitButton.attr('disabled', true);
            $noBusStopButton.attr('disabled', true);

            // Set a value for busStopAbsenceDescription.
            if (status.radioValue === 'Other:') {
                status.busStopAbsenceDescription = "Other: " + $textBusStopAbsenceOtherReason.val();
            }

            data.assignment = {
                amazon_turker_id : turkerId,
                amazon_hit_id : hitId,
                amazon_assignment_id : assignmentId,
                interface_type : 'StreetViewLabeler',
                interface_version : '3',
                completed : 0,
                need_qualification : 0,
                task_description : properties.taskDescription
            };

            data.labelingTask = {
                task_gsv_panorama_id : taskPanoId,
                no_bus_stop : 1,
                description: 'Onboarding: Cannot find the bus stop at where it should be.'
            };

            data.labelingTaskEnvironment = {
                browser: getBrowser(),
                browser_version: getBrowserVersion(),
                browser_width: $(window).width(),
                browser_height: $(window).height(),
                screen_width: screen.width,
                screen_height: screen.height,
                avail_width: screen.availWidth,		// total width - interface (taskbar)
                avail_height: screen.availHeight,		// total height - interface };
                operating_system: getOperatingSystem()
            };

            data.userInteraction = myTracker.getActions();

            data.labels = [];

            // Add the value in the comment field if there are any.
            var comment = $textieldComment.val();
            data.comment = undefined;
            if (comment &&
                comment !== $textieldComment.attr('title')) {
                data.comment = $textieldComment.val();
            }
            // Insert a record that the user finished tutorial
            $.ajax({
                async: false,
                url: properties.qualification_url,
                type: 'post',
                data: data
            });

            window.location.reload();
            return true;
        });
    }

    ////////////////////////////////////////////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////////////////////////////////////////////
    oPublic.set = function (key, value) {
        if (key === 'map') {
            onbMap = value;
        }
        return this;
    };


    oPublic.setRightClickMenu = function (menu) {
        rightClickMenu = menu;
        return this;
    };


    oPublic.start = function () {
        var $OkBtn01;
        var interval;

        // I have to do this because disableWalking is only effective after
        // SV is loaded + there is no callback for SV load.
        myCanvas.disableLabeling();
        myCanvas.disableMenuClose();
        myCanvas.unlockDisableLabelDelete().disableLabelDelete().lockDisableLabelDelete();
        myMenu.disableModeSwitch();
        onbMap.disableWalking();
        myActionStack.disableRedo();
        myActionStack.disableUndo();
        myForm.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
        myForm.unlockDisableNoBusStopButton().disableNoBusStopButton().lockDisableNoBusStopButton();


        // Set the mission
        myCurrentMissionDescription.setCurrentStatusDescription("Let's learn how to " +
            "report absence of a bus stop.");

        // Set the progress bar
        myProgressFeedback.setProgress(0);
        myProgressFeedback.setMessage("Let's start the second tutorial!");

        // Give a bus stop auditor badge.
        myQualificationBadges.giveBusStopAuditorBadge();
        myQualificationBadges.giveBusStopExplorerBadge();


        myTracker.push('OnboardingSeattleCannotFindBusStopStart');


        // Set the available links
        onbMap.setStatus('hideNonavailablePanoLinks', true);
        onbMap.setStatus('availablePanoIds', oPublic.availablePanoIds);
        interval = setInterval(myMap.disableWalking, 1000);
        onb.setBackground('rgba(60,60,60,1)');

        $divHolderOnboardingCanvas.css({
            left : '-10px',
            top: '-115px'
        });
        onb.renderMessage(0, 0, "<h2 class='bold'>Tutorial 3/4: Identify a Missing Bus Stop</h2>" +
            "<span class='bold'>Sometimes, bus stops are missing in Street View images because of inaccurate data.</span> " +
            "In this tutorial, you will learn how to report the missing bus stops in Street View images.",
            940, 180);


        // Append an ok button and set its style
        $divOnboardingMessageBox.append(dom.Btn_Ok01);
        $OkBtn01 = $("#OnboardingButton_Ok01");
        $OkBtn01.css({
            'left' : '20px',
            'bottom' : '10px',
            'position' : 'absolute',
            'width' : 100,
            'z-index' : 1000
        });

        $divOnboardingMessage.css({
            'padding-bottom' : '50px'
        });

        $OkBtn01.bind('click', function () {
            onb.setBackground();
            $OkBtn01.remove();
            $divHolderOnboardingCanvas.css({
                left : '0px',
                top: '0px'
            });
            $divOnboardingMessage.css({
                'padding-bottom' : ''
            });
            window.clearInterval(interval);
            InstructTurkerToLookAtTheMap();
        });
    };

    init(params);
    return oPublic;
}
