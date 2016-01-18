/**
 * Created with JetBrains PhpStorm.
 * User: kotaro
 * Date: 3/11/13
 * Time: 1:41 AM
 * To change this template use File | Settings | File Templates.
 */
////////////////////////////////////////////////////////////////////////////////
// Onboarding 2.
// This will teach turkers how to walk around the SV.
// This uses a bus stop:
// fenway = new google.maps.LatLng(38.912807,-77.051574);
// 39.006288, -76.923481
//
// Other potential bus stops
// https://maps.google.com/?ll=38.924156,-76.997053&spn=0.001619,0.00302&t=m&layer=c&cbll=38.924156,-76.99808&panoid=7iSImRvguH39eGMtTWJ1EQ&cbp=11,287.47,,0,1.33&z=18
// https://maps.google.com/?ll=38.926481,-77.030361&spn=0.003238,0.00604&t=m&layer=c&cbll=38.926477,-77.03241&panoid=UedeH3sK0-ZGBQjRltd6Cg&cbp=11,136.68,,0,10.49&z=17
////////////////////////////////////////////////////////////////////////////////
function Onboarding_Seattle_Walking (params) {
    var oPublic = {
        className : 'Onboarding_Seattle_Walking'
    };
    var properties = {
        minBusStopTargetX : 335,
        maxBusStopTargetX : 375,
        minBusStopTargetY : 290,
        maxBusStopTargetY : 330,
        totalTaskCount: 11,
        turker_id : undefined,
        qualification_url : undefined,
        taskDescription: 'Onboarding_Seattle_Walking'
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
        lat : 47.661616,
        lng : -122.325004
    };

    oPublic.latlng = {
        lat : 47.699969,
        lng : -122.366149
    };

    //
    // Some public setting parameters that other objects can see
    //
    // Heading
//    oPublic.panoramaPov = {
//        heading : 0, //180,
//        pitch : -10,
//        zoom : 1
//    };
//
//    oPublic.availablePanoIds = [
//        '-YE9X_--6HRzqKIwjTbM7Q',
//        '75-kJQhPXiiMmLR0pKKC1w',
//        'T_C2AUjq9Q6mSsn49RjVBw',
//        '8PY9oFduqdZs1tQNdjJ20A',
//        '9-_DlSGZzW7D2QZl5QUP4A'
//    ];
    oPublic.availablePanoIds = [
        'dzQ6yGb_Lj-UtlguJsQj9w',
        'VF3py06JbNDehDniB-SlWQ',
        'JNcVIJcM7KFsefaGpJ58pw'
    ];

    oPublic.busStopLatLng = oPublic.latlng = {
        lat: 47.617282,
        lng: -122.351282
    };

    oPublic.panoramaPov = {
        heading : 310, //180,
        pitch : -10,
        zoom : 1
    };

    // Panorama id where turker starts onboarding.
    // oPublic.panoId = 'ksTjlYwXrHcXMSNJWfA9RA';
    // oPublic.panoId = '-YE9X_--6HRzqKIwjTbM7Q';
    // https://maps.google.com/maps?daddr=47.614519,-122.342625&hl=en&ll=47.617287,-122.351142&spn=0.003341,0.016512&sll=47.614054,-122.339383&sspn=0.00703,0.018797&t=m&mra=mift&mrsp=1&sz=17&layer=c&cbll=47.617285,-122.351146&panoid=JNcVIJcM7KFsefaGpJ58pw&cbp=11,251.23,,0,15.91&z=17
    // oPublic.panoId = '7XsM_nl-eD0roTDOPT4XGg';
    oPublic.panoId = 'dzQ6yGb_Lj-UtlguJsQj9w';

    // Bus stop latlng coordinate
//    oPublic.busStopLatLng = {
//        lat : 47.661616,
//        lng : -122.325004
//    };

    // some dom elements that we will dynamically create.
    dom = {
        'Btn_Ok01' : '<button id="OnboardingButton_Ok01" class="button">OK</button>',
        'Btn_Ok_MapInstruction' : '<button id="OnboardingButton_Ok_MapInstruction" class="button">OK</button>',
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


    function InstructTurkersToSeeAMap () {
        myTracker.push('OnboardingSeattleWalking_InstructTurkersToSeeAMap');

        // In this step turkers will be asked to see a map on the bottom-right corner of the interface.
        var InstructTurkersToSeeAMapDone = false;

        // Update the progress bar
        myProgressFeedback.setProgress(1 / properties.totalTaskCount);
        myProgressFeedback.setMessage("Keep following the tutorial.");

        //
        onbMap.unlockDisableWalking().disableWalking().lockDisableWalking();

        // Clear and render on the onboarding canvas
        $divHolderOnboardingCanvas.css({
            'left': '150px',
            'z-index': 100
        });
        onb.clear();
        onb.renderArrowWithShadow(500, 325, 550, 380, 'ccw');
        onb.renderArrowWithShadow(550, 300, 678, 340, 'cw');
        onb.renderMessage(250, 130, "<span class='bold'>Your initial objective is to find a bus stop.</span> " +
            "The approximate position of the bus stop is shown on this map with a bus stop icon: " +
            dom.BusStopIconImage +
            "", 300, 190);

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
                $divHolderOnboardingCanvas.css({
                    'left': '0px',
                    'z-index': 0
                });
                WalkTowardsBusStop();
            }
        });
    }


    function WalkTowardsBusStop () {
        myTracker.push('OnboardingSeattleWalking_WalkTowardsBusStop');

        // Blink an arrow to navigate a user to click the link arrow.
        var WalkTowardsBusStopDone = false;

        // Update the progress bar
        myProgressFeedback.setProgress(2 / properties.totalTaskCount);
        myProgressFeedback.setMessage("Keep following the tutorial.");

        //
        onbMap.unlockDisableWalking().enableWalking().lockDisableWalking();

        // Clear and render on the onboarding canvas
        onb.clear();
        onb.renderArrowWithShadow(480, 245, 430, 300, 'cw');
        onb.renderMessage(360, 130, "You have to walk forward to find a bus stop. " +
            "Click this '<' to walk forward.", 300, 110);


        // Adding delegation on SVG elements
        // http://stackoverflow.com/questions/14431361/event-delegation-on-svg-elements
        // Or rather just attach a listener to svg and check it's target.
        $('svg')[0].addEventListener('click', function (e) {
            var targetPanoId = e.target.getAttribute('pano');

            if (!WalkTowardsBusStopDone) {
                if (targetPanoId === 'VF3py06JbNDehDniB-SlWQ' &&
                    !WalkTowardsBusStopDone) {
                    myProgressFeedback.setProgress(3 / properties.totalTaskCount);

                    onb.clear();
                    onb.renderMessage(360, 10, "Keep walking until you find a bus stop. " +
                        "<span class='bold'>Hint: there is one coming up on your left!</span>", 350, 110);
                } else if (targetPanoId === "JNcVIJcM7KFsefaGpJ58pw") {
                    var pov = svw.getPOV();
                    WalkTowardsBusStopDone = true;

                    if (240 < pov.heading &&
                        pov.heading < 280) {
                        onb.clear();

                        SwitchModeToLabelingBusStop();
                        return true;
                    } else {
                        AdjustHeadingAngle();
                    }
                }
            }
        });
    }


    function AdjustHeadingAngle () {
        myTracker.push('OnboardingSeattleWalking_AdjustHeadingAngle');
        // Let a user change heading angle.
        var AdjustHeadingAngleDone = false;
        var mouseDown = false;
        var handAnimationTimeout;

        // Update the progress bar!
        myProgressFeedback.setProgress(4 / properties.totalTaskCount);

        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(360, 10, "Now you are close enough to see a bus stop. " +
            "But this is not the best angle to label the scene. " +
            "You need to grab and drag the Street View image. " +
            "<span class='bold'>Hint: there is a bus stop on your left!</span>", 350, 200);

        // Add a hand animation
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
                        var pov = svw.getPOV();

                        if (handAnimation) {
                            handAnimation.remove();
                        }
                        window.clearTimeout(handAnimationTimeout);

                        AdjustHeadingAngleDone = true;
                        onb.clear();

                        SwitchModeToLabelingBusStop();
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


    function SwitchModeToLabelingBusStop () {
        myTracker.push('OnboardingSeattleWalking_SwitchModeToLabelingBusStop');
        // Ask a user to switch to bus stop labeling mode.
        var SwitchModeToLabelingBusStopDone = false;

        myProgressFeedback.setProgress(5 / properties.totalTaskCount);

        $("#viewControlLayer").bind('mousemove', function () {
            var panoId = getPanoId();
            if (panoId === "JNcVIJcM7KFsefaGpJ58pw") {
                if (!SwitchModeToLabelingBusStopDone) {
                    var pov = svw.getPOV();

                    onb.clear();

                    if (panoId === "JNcVIJcM7KFsefaGpJ58pw") {
                        if (240 < pov.heading &&
                            pov.heading < 280) {
                            myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

                            onb.clear();
                            onb.renderArrowWithShadow(200, 70, 120, 10, 'cw');
                            onb.renderMessage(200, 30, "Now we're close to the bus stop. Let's label it! " +
                                "First click this icon to label a bus stop sign.", 350, 100);
                            $divHolderOnboardingCanvas.css({
                                top : '-20px'
                            });
                        } else {
                            onb.clear();
                            onb.renderMessage(360, 40, "Try to center the bus stop in your view.", 350, 70);
                        }
                    } else {
                        myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
                    }
                }
            } else {
                onb.renderMessage(360, 40, "Oops, let's go back and get closer to the bus stop.",
                    350, 70);
            }
        });


        $spanModeSwitchButtonStopSign.bind('click', function () {
            if (!SwitchModeToLabelingBusStopDone) {
                SwitchModeToLabelingBusStopDone = true;
                $divHolderOnboardingCanvas.css({
                    top : '0px'
                });
                onbMap.unlockDisableWalking().disableWalking().lockDisableWalking();
                LabelBusStop();
            }
        });
    }

    function LabelBusStop () {
        myTracker.push('OnboardingSeattleWalking_LabelBusStop');

        // Ask a user to label a bus stop
        var step4done = false;
        var pov = svw.getPOV();
        var panoId = getPanoId();
        var busStopCanvasCoord;
        busStopCanvasCoord = gsvImageCoordinate2CanvasCoordinate(9800, -680, pov);

        // Update the progress bar
        myProgressFeedback.setProgress(6 / properties.totalTaskCount);
        myProgressFeedback.setMessage("You've done half of the tutorial!");


        // Unlock
        myCanvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();


        onb.clear();
        onb.renderArrowWithShadow(busStopCanvasCoord.x - 60, busStopCanvasCoord.y - 105, busStopCanvasCoord.x - 10, busStopCanvasCoord.y, 'ccw');
        onb.renderMessage(busStopCanvasCoord.x - 200, busStopCanvasCoord.y - 180, "Now click the bottom of the bus stop sign to label it.", 365, 70);


        $divLabelDrawingLayer.bind('mouseup', function () {
            if (myCanvas.getCurrentLabel()) {
                if (!step4done) {
                    var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                    console.log(coord);

                    if (9970 > coord.x &&
                        9590 < coord.x &&
                        -500 > coord.y &&
                        -870 < coord.y) {
                        step4done = true;
                        status.currentLabel = myCanvas.getCurrentLabel();
                        // MenuSelectBusStopType();
                        SwitchModeToLabelingBench();
                    } else {
                        // Label is off from the bus stop position. Let a user relabel.
                        LabelBusStopBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelBusStopBranch_UndoLabeling () {
        myTracker.push('OnboardingSeattleWalking_LabelBusStopBranch_UndoLabeling');
        // Ask workers to label the correct positions in the image.

        // Close the right click menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        myMenu.modeSwitchClick('StopSign');

        // Show an instruction
        onb.clear();
        onb.renderMessage(10, 10, "That is a little bit off from the bus stop position. " +
            "Let\'s try again!", 365, 70);
    }


    function SwitchModeToLabelingBench () {
        myTracker.push('OnboardingSeattleWalking_SwitchModeToLabelingBench');
        // Switch to Bench Labeling Mode.
        var SwitchModeToLabelingBenchDone = false;

        myProgressFeedback.setProgress(7 / properties.totalTaskCount);
        myProgressFeedback.setMessage("You are almost done with this tutorial!");

        myCanvas.unlockDisableLabelEdit().disableLabelEdit().lockDisableLabelEdit();

        onb.clear();
        onb.renderArrowWithShadow(325, 70, 270, 10, 'cw');
        onb.renderMessage(325, 30,
            'Ok, there are more attributes to label. ' +
                'Remember to <span class="bold">label all landmarks near a bus stop sign.</span> ' +
                'Let\'s first label a Bench.',
            380, 150);
        $divHolderOnboardingCanvas.css({
            top : '-20px'
        });

        $(".modeSwitch").bind('click', function () {
            if (!SwitchModeToLabelingBenchDone) {
                var labelType = $(this).attr('val');

                if (labelType === 'Landmark_Bench') {
                    SwitchModeToLabelingBenchDone = true;
                    LabelBench();
                    $divHolderOnboardingCanvas.css({
                        top : '0px'
                    });
                }
            }
        });
    }


    function LabelBench () {
        myTracker.push('OnboardingSeattleWalking_LabelBench');
        // Label a bench.
        var LabelBenchDone = false;
        var pov = svw.getPOV();
        var panoId = getPanoId();
        var benchCanvasCoord;
        benchCanvasCoord = gsvImageCoordinate2CanvasCoordinate(8840, -830, pov);

        myProgressFeedback.setProgress(8 / properties.totalTaskCount);

        // Unlock
        myCanvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        onb.clear();
        onb.renderArrowWithShadow(benchCanvasCoord.x + 55, benchCanvasCoord.y - 55, benchCanvasCoord.x, benchCanvasCoord.y + 10, 'cw');
        onb.renderMessage(benchCanvasCoord.x - 200, benchCanvasCoord.y - 130, "Now click the bottom of the bench to label it.", 350, 70);

        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel()) {
                if (!LabelBenchDone) {
                    var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                    console.log(coord);
                    // SVImage coordinates from my labels

                    if (9110 > coord.x &&
                        8440 < coord.x &&
                        -630 > coord.y &&
                        -1000 < coord.y) {
                        LabelBenchDone = true;
                        // SwitchModeToLabelingTrashCan();
                        // SubmitAndComplete();
                        SwitchModeToLabelingPole();
                    } else {
                        // Label is off from the bus stop position. Let a user relabel.
                        LabelBenchBranch_UndoLabeling();
                    }
                }
            }

        });
    }


    function LabelBenchBranch_UndoLabeling () {
        myTracker.push('OnboardingSeattleWalking_LabelBenchBranch_UndoLabeling');
        var interval;

        // Close the right click menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();


        // Show an instruction
        onb.clear();
        onb.renderMessage(10, 10, "That is a little bit off from the bench position. " +
            "Let\'s try again!", 365, 70);

        interval = setInterval(function () {
            myMenu.modeSwitchClick('Landmark_Bench');
            window.clearInterval(interval);
        }, 100);

    }


    function SwitchModeToLabelingPole () {
        myTracker.push('OnboardingSeattleWalking_SwitchModeToLabelingPole');

        // Switch to Trash Can labeling mode.
        var SwitchModeToLabelingPoleDone = false;

        myProgressFeedback.setProgress(9 / properties.totalTaskCount);

        onb.clear();
        onb.renderArrowWithShadow(440, 70, 485, 10, 'ccw');
        onb.renderMessage(130, 30, 'There is a light pole. ' +
            'Let\'s label this too! Click the Traffic Sign / Pole button.',
            310, 110);
        $divHolderOnboardingCanvas.css({
            top : '-20px'
        });

        $(".modeSwitch").bind('click', function () {
            if (!SwitchModeToLabelingPoleDone) {
                var labelType = $(this).attr('val');
                if (labelType === 'Landmark_OtherPole') {
                    SwitchModeToLabelingPoleDone = true;
                    $divHolderOnboardingCanvas.css({
                        top : '0px'
                    });
                    LabelPole();
                }
            }
        });
    }


    function LabelPole () {
        myTracker.push('OnboardingSeattleWalking_LabelPole');

        // Label a trash can.
        var LabelPoleDone = false;
        var pov = svw.getPOV();
        var panoId = getPanoId();
        var poleCanCanvasCoord;
        poleCanCanvasCoord = gsvImageCoordinate2CanvasCoordinate(9316, -800, pov);

        myProgressFeedback.setProgress(10 / properties.totalTaskCount);

        // Lock
        myCanvas.unlockDisableLabeling();
        myCanvas.enableLabeling();


        onb.clear();
        onb.renderArrowWithShadow(poleCanCanvasCoord.x - 90, poleCanCanvasCoord.y - 55, poleCanCanvasCoord.x - 10, poleCanCanvasCoord.y + 10, 'ccw');
        onb.renderMessage(poleCanCanvasCoord.x - 350, poleCanCanvasCoord.y - 130,
            "Now click the bottom of the light pole to label it.",
            300, 70);

        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel) {
                if (!LabelPoleDone) {
                    var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                    var panoId = getPanoId();
                    console.log(coord);

                    if (9500 > coord.x &&
                        9100 < coord.x &&
                        -600 > coord.y &&
                        -1000 < coord.y) {
                        SubmitAndComplete();
                        LabelPoleDone = true;
                    } else {
                        // Label is off from the bus stop position. Let a user relabel.
                        LabelPoleBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelPoleBranch_UndoLabeling () {
        myTracker.push('OnboardingSeattleWalking_LabelPole_UndoLabeling');

        // Branch. Show a message to re-label the trash can.
        var interval;

        // Close the right click menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();


        // Show an instruction
        onb.clear();
        onb.renderMessage(10, 10, "That is a little bit off from the traffic sign. " +
            "Let\'s try again!", 365, 70);
        interval = setInterval(function () {
            myMenu.modeSwitchClick('Landmark_OtherPole');
            window.clearInterval(interval);
        }, 100);
    }


    function SubmitAndComplete () {
        myTracker.push('OnboardingSeattleWalking_SubmitAndComplete');
        // Submit!
        // Let them submit the task. Disable everything else.
        var prop = onb.getProperties();
        var borderColored = false;
        var data = {turker_id : properties.turker_id};

        // Update the feedback window (progress bar and badge)
        myProgressFeedback.setProgress(11 / properties.totalTaskCount);
        myProgressFeedback.setMessage("You've finished tutorials! <br />Proceed to HITs.");
        myQualificationBadges.giveBusStopExplorerBadge();


        // Disabling user control
        myMap.disableWalking();
        myMap.lockDisableWalking();
        myMenu.disableModeSwitch();
        myMenu.lockDisableModeSwitch();
        myCanvas.disableLabeling();
        myCanvas.lockDisableLabeling();
        myForm.unlockDisableSubmit().enableSubmit().lockDisableSubmit();

        $divHolderOnboardingCanvas.css({
            top: '50px',
            'z-index': 1000
        });
        onb.clear();
        onb.renderArrowWithShadow(575, 400, 630, 460);
        onb.renderMessage(10, 350, 'Great! Since there are no other landmarks <span class="bold">near the bus stop</span>, let\'s submit ' +
            'what you have labeled.' , 560, 70);

        var interval = setInterval(function () {
            if (borderColored) {
                borderColored = false;
                $("#Button_Submit").css({
                    'background': '',
                    'border': ''
                });
            } else {
                borderColored = true;
                prop = onb.getProperties();
                $("#Button_Submit").css({
                    'background': prop.highlight.fill,
                    'border': prop.highlight.border
                });
            }
        }, 1000);

        $("#Button_Submit").bind('click', function (){
            window.clearInterval(interval);
            $("#Button_Submit").css({
                'background': '',
                'border': ''
            });

            // Submit label data and user interaction
            var data = {turker_id : properties.turker_id};
            var labels;
            var hitId;
            var assignmentId;
            var turkerId;
            var taskPanoId = myMap.getInitialPanoId();

            myTracker.push('OnboardingSeattleWalkingSubmit');
            myTracker.push('TaskSubmit');

            hitId = properties.hitId ? properties.hitId : getURLParameter("hitId");
            assignmentId = properties.assignmentId? properties.assignmentId : getURLParameter("assignmentId");
            turkerId = properties.turkerId ? properties.turkerId : getURLParameter("workerId");

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
            data.assignment = {
                amazon_turker_id : turkerId,
                amazon_hit_id : hitId,
                amazon_assignment_id : assignmentId,
                interface_type : 'StreetViewLabeler',
                interface_version : '2',
                completed : 0,
                need_qualification : 0,
                task_description : properties.taskDescription
            };

            data.labelingTask = {
                task_gsv_panorama_id : taskPanoId,
                no_bus_stop : 0
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
            labels = myCanvas.getLabels();
            for(var i = 0; i < labels.length; i += 1) {
                var label = labels[i];
                var prop = label.getProperties();
                var point = label.getPoint();
                var gsvImageCoordinate = point.getGSVImageCoordinate();
                var temp = {
                    deleted : label.isDeleted() ? 1 : 0,
                    label_type : label.getLabelType(),
                    label_gsv_panorama_id : prop.panoId,
                    label_position_param : {
                        svImageX : gsvImageCoordinate.x,
                        svImageY : gsvImageCoordinate.y,
                        originalCanvasX: point.originalCanvasCoordinate.x,
                        originalCanvasY: point.originalCanvasCoordinate.y,
                        originalHeading: point.originalPov.heading,
                        originalPitch: point.originalPov.pitch,
                        originalZoom : point.originalPov.zoom,
                        canvasX : point.canvasCoordinate.x,
                        canvasY : point.canvasCoordinate.y,
                        heading : point.pov.heading,
                        pitch : point.pov.pitch,
                        zoom : point.pov.zoom,
                        lat : prop.panoramaProperties.latlng.lat,
                        lng : prop.panoramaProperties.latlng.lng,
                        svImageHeight : prop.svImageProperties.imageSize.height,
                        svImageWidth : prop.svImageProperties.imageSize.width,
                        canvasHeight : prop.canvasProperties.canvasSize.height,
                        canvasWidth : prop.canvasProperties.canvasSize.width,
                        alphaX : prop.canvasProperties.distortionConstants.alpha_x,
                        alphaY : prop.canvasProperties.distortionConstants.alpha_y
                    },
                    label_additional_information : undefined
                };

                data.labels.push(temp)
            }
            // data.labels could be
            if (data.labels.length === 0) {
                data.labelingTask.no_bus_stop = 0;
            }

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
        interval = setInterval(onbMap.disableWalking, 1000);
        myActionStack.disableRedo();
        myActionStack.disableUndo();
        myForm.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
        myForm.unlockDisableNoBusStopButton().disableNoBusStopButton().lockDisableNoBusStopButton();

        // Set the progress bar
        myProgressFeedback.setProgress(0);
        myProgressFeedback.setMessage("Let's start the second tutorial!");

        // Give a bus stop auditor badge.
        myQualificationBadges.giveBusStopAuditorBadge();

        myTracker.push('OnboardingSeattleWalkingStart');
        // Set the available links
        onbMap.setStatus('hideNonavailablePanoLinks', true);
        onbMap.setStatus('availablePanoIds', oPublic.availablePanoIds);


        $divHolderOnboardingCanvas.css({
            left : '-10px',
            top: '-115px'
        });
        onb.renderMessage(0, 0, "<h2 class='bold'>Tutorial 2/4: Explore the Street View Scene!</h2>" +
            "Sometimes, you have to <span class='bold'>walk</span> to find a bus stop. " +
            "In this scene, you cannot initially see any bus stop. " +
            "Let's work on the tutorial and find where the bus stop is. <br />",
            940, 150);

        onb.setBackground('rgba(60,60,60,1)');

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
            $OkBtn01.remove();
            $divHolderOnboardingCanvas.css({
                left : '0px',
                top: '0px'
            });
            $divOnboardingMessage.css({
                'padding-bottom' : ''
            });
            onb.setBackground();
            window.clearInterval(interval);
            InstructTurkersToSeeAMap();
        });
    };

    init(params);
    return oPublic;
}
