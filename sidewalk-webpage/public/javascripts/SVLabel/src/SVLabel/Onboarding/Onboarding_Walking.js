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
function Onboarding_Walking (params) {
    var oPublic = {
            className : 'Onboarding_Walking'
        };
    var properties = {
            minBusStopTargetX : 335,
            maxBusStopTargetX : 375,
            minBusStopTargetY : 290,
            maxBusStopTargetY : 330,
            totalTaskCount: 15,
            turker_id : undefined,
            qualification_url : undefined,
            taskDescription: 'Onboarding_Walking'
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
        lat : 39.006224,
        lng : -76.9235
    };

    //
    // Some public setting parameters that other objects can see
    //
    // Heading
    oPublic.panoramaPov = {
        heading : 20,
        pitch : -10,
        zoom : 1
    };

    oPublic.availablePanoIds = [
        '7iIfhW9s-HZ3sUJ2XFddFQ',
        't0Kk2wgFDaZK1MiASyj-Qg',
        'zjdmVopuKFritnqzlW838A'
        // 'ksTjlYwXrHcXMSNJWfA9RA',
        // 'vrRivR9GIZSpItu8cC6ccw'
    ];

    // Panorama id where turker starts onboarding.
    // oPublic.panoId = 'ksTjlYwXrHcXMSNJWfA9RA';
    oPublic.panoId = '7iIfhW9s-HZ3sUJ2XFddFQ';

    // Bus stop latlng coordinate
    oPublic.busStopLatLng = {
        lat: 39.006502,
        lng: -76.923518
    };

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
        myTracker.push('OnboardingWalking_InstructTurkersToSeeAMap');

        // In this step turkers will be asked to see a map on the bottom-right corner of the interface.
        var InstructTurkersToSeeAMapDone = false;

        // Update the progress bar
        myProgressFeedback.setProgress(0 / properties.totalTaskCount);
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
        myTracker.push('OnboardingWalking_WalkTowardsBusStop');

        // Blink an arrow to navigate a user to click the link arrow.
        var WalkTowardsBusStopDone = false;

        // Update the progress bar
        myProgressFeedback.setProgress(1 / properties.totalTaskCount);
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
                if (targetPanoId === "zjdmVopuKFritnqzlW838A" &&
                    !WalkTowardsBusStopDone) {
                    myProgressFeedback.setProgress(2 / properties.totalTaskCount);

                    onb.clear();
                    onb.renderMessage(360, 10, "Keep walking until you find a bus stop. " +
                        "<span class='bold'>Hint: there is one coming up on your left!</span>", 350, 110);
                } else if (targetPanoId === "t0Kk2wgFDaZK1MiASyj-Qg") {
                    var pov = svw.getPOV();
                    WalkTowardsBusStopDone = true;
                    myProgressFeedback.setProgress(3 / properties.totalTaskCount);

                    if (305 < pov.heading &&
                        pov.heading < 345) {
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


    function WalkTowardsBusStopBranch_GetCloserToBusStop () {
        myTracker.push('OnboardingWalking_WalkTowardsBusStopBranch_GetCloserToBusStop');
        // A user has gone too far.
        var panoId = getPanoId();

        onb.clear();
        if (panoId !== "t0Kk2wgFDaZK1MiASyj-Qg" &&
            panoId !== "ksTjlYwXrHcXMSNJWfA9RA") {

            onb.renderMessage(360, 10, "Oops, you've passed the bus stop. " +
                "Please turn around and find the bus stop.", 350, 110);
        }
    }


    function AdjustHeadingAngle () {
        myTracker.push('OnboardingWalking_AdjustHeadingAngle');
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
        myTracker.push('OnboardingWalking_SwitchModeToLabelingBusStop');
        // Ask a user to switch to bus stop labeling mode.
        var SwitchModeToLabelingBusStopDone = false;

        myProgressFeedback.setProgress(5 / properties.totalTaskCount);

        $("#viewControlLayer").bind('mousemove', function () {
            var panoId = getPanoId();
            if (panoId === "t0Kk2wgFDaZK1MiASyj-Qg" ||
                panoId === "ksTjlYwXrHcXMSNJWfA9RA") {
                if (!SwitchModeToLabelingBusStopDone) {
                    var pov = svw.getPOV();

                    onb.clear();

                    if (panoId === "t0Kk2wgFDaZK1MiASyj-Qg") {
                        if (305 < pov.heading &&
                            pov.heading < 345) {
                            myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

                            onb.clear();
                            onb.renderArrowWithShadow(200, 70, 120, 10, 'cw');
                            onb.renderMessage(200, 30, "Now we're close to the bus stop. Let's label it! " +
                                "First click this icon to label a bus stop sign.", 350, 100);
                            $divHolderOnboardingCanvas.css({
                                top : '-20px'
                            });
                        } else {
                            onb.renderMessage(360, 40, "Try to center the bus stop in your view.", 350, 70);
                        }
                    } else if (panoId === "ksTjlYwXrHcXMSNJWfA9RA") {
                        if (230 < pov.heading &&
                            pov.heading < 270) {
                            myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

                            onb.clear();
                            onb.renderArrowWithShadow(200, 70, 120, 10, 'cw');
                            onb.renderMessage(200, 30, "Now we're close to the bus stop. Let's label it! " +
                                "First click this icon to label a bus stop sign.", 350, 100);
                            $divHolderOnboardingCanvas.css({
                                top : '-20px'
                            });
                        } else {
                            onb.renderMessage(360, 40, "Try to center the bus stop in your view.", 350, 70);
                        }
                    } else {
                        myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
                    }
                }
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
        myTracker.push('OnboardingWalking_LabelBusStop');

        // Ask a user to label a bus stop
        var step4done = false;
        var pov = svw.getPOV();
        var panoId = getPanoId();
        var busStopCanvasCoord;
        if (panoId === "t0Kk2wgFDaZK1MiASyj-Qg") {
            busStopCanvasCoord = gsvImageCoordinate2CanvasCoordinate(12540, -337, pov);
        } else {
            busStopCanvasCoord = gsvImageCoordinate2CanvasCoordinate(9650, -650, pov);
        }

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

                    if (panoId === "t0Kk2wgFDaZK1MiASyj-Qg" &&
                        12400 < coord.x &&
                        12600 > coord.x &&
                        -300 > coord.y &&
                        -500 < coord.y) {
                        step4done = true;
                        status.currentLabel = myCanvas.getCurrentLabel();
                        // MenuSelectBusStopType();
                        SwitchModeToLabelingBench();
                    } else if (panoId === "ksTjlYwXrHcXMSNJWfA9RA" &&
                        9550 < coord.x &&
                        9750 > coord.x &&
                        -600 > coord.y &&
                        -750 < coord.y) {
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
        myTracker.push('OnboardingWalking_LabelBusStopBranch_UndoLabeling');
        // Ask workers to label the correct positions in the image.

        // Close the right click menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();


        // Show an instruction
        onb.clear();
        onb.renderMessage(10, 10, "That is a little bit off from the bus stop position. " +
            "Let\'s try again!", 365, 70);
    }


    function MenuSelectBusStopType () {
        myTracker.push('OnboardingWalking_MenuSelectBusStopType');
        // Bus stop type selection.
        // Asks a user to click on 'One-leg bus stop sign'
        var MenuSelectBusStopTypeDone = false;
        var menuPosition;
        var interval;
        var highlighted;

        // Update the progress bar
        myProgressFeedback.setProgress(7 / properties.totalTaskCount);

        // Lock, unlock
        myCanvas.unlockDisableMenuSelect().enableMenuSelect().lockDisableMenuSelect();
        myCanvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();

        menuPosition = myCanvas.getRightClickMenu().getMenuPosition();
        onb.clear();
        onb.renderArrowWithShadow(menuPosition.x - 50, menuPosition.y - 5, menuPosition.x - 10, menuPosition.y + 50, 'ccw');
        onb.renderMessage(menuPosition.x - 200, menuPosition.y - 120, 'Now select the type of bus stop sign. ' +
            'In this case, it\'s a "one-leg bus stop sign".', 365, 110);


        // Blink the "I don't know" button
        interval = setInterval(function() {
            if (highlighted) {
                highlighted = false;
                $('div.BusStopLabelMenuItem[value="StopSign_OneLeg"]').css({
                    'background' : 'transparent'
                });
            } else {
                highlighted = true;
                $('div.BusStopLabelMenuItem[value="StopSign_OneLeg"]').css({
                    'background' : onb.getProperties().highlight.fill
                });
            }
        }, 1000);


        // Check if correct button is clicked. If not, let them redo.
        $(".BusStopLabelMenuItem").bind('mouseup', function (e) {
            if (!MenuSelectBusStopTypeDone){
                var busStopTypeId = $(this).attr('value');
                window.clearInterval(interval);

                if (busStopTypeId === 'StopSign_OneLeg') {
                    // Good correct answer.
                    MenuSelectBusStopTypeDone = true;
                    MenuSelectBusStopPosition();
                } else {
                    // Not correct! Go back.
                    MenuSelectBusStopTypeDoneBranch_BackToLabelType(busStopTypeId);
                }
            }
        });
    }


    function MenuSelectBusStopTypeDoneBranch_BackToLabelType (busStopTypeId) {
        myTracker.push('OnboardingWalking_MenuSelectBusStopTypeDoneBranch_BackToLabelType');
        // Ask a user to go back to label type selection.
        var MenuSelectBusStopTypeDoneBranch_BackToLabelTypeDone = false;
        var subLabelType = getLabelDescriptions()[busStopTypeId].text;
        var prop;
        var message;

        // Lock
        myCanvas.unlockDisableMenuSelect().disableMenuSelect().lockDisableMenuSelect();

        console.log(subLabelType);
        if (subLabelType === 'Not provided') {
            message = 'This is a "One-leg Bus Stop Sign." Please go back to the previous menu.';
        } else {
            message = 'This is not a "' + subLabelType +
                '." Please go back to the previous menu.';
        }
        onb.clear();
        onb.renderMessage(10, 365, message, 300, 100);

        var borderColored = false;
        var interval = setInterval(function () {
            if (borderColored) {
                borderColored = false;
                $("#BusStopPositinoMenu_BackButton").css({
                    'background': '',
                    'border': ''
                });
            } else {
                borderColored = true;
                prop = onb.getProperties();
                $("#BusStopPositinoMenu_BackButton").css({
                    'background': prop.highlight.fill,
                    'border': prop.highlight.border
                });
            }
        }, 1000);

        $("#BusStopPositinoMenu_BackButton").bind('click', function () {
            if (!MenuSelectBusStopTypeDoneBranch_BackToLabelTypeDone) {
                MenuSelectBusStopTypeDoneBranch_BackToLabelTypeDone = true;
                $("#BusStopPositinoMenu_BackButton").css({
                    'background': '',
                    'border': ''
                });
                MenuSelectBusStopType();
                window.clearInterval(interval);
            }
        });    }


    function MenuSelectBusStopPosition () {
        myTracker.push('OnboardingWalking_MenuSelectBusStopPosition');
        // Check if the correct button is clicked. If not, let them redo.
        var MenuSelectBusStopPositionDone = false;
        var menuPosition;
        var interval;
        var highlighted;

        menuPosition =  myCanvas.getRightClickMenu().getMenuPosition();

        myProgressFeedback.setProgress(8 / properties.totalTaskCount);

        onb.clear();
        onb.renderArrowWithShadow(menuPosition.x - 50, menuPosition.y - 5, menuPosition.x - 10, menuPosition.y + 140, 'ccw');
        onb.renderMessage(menuPosition.x - 200, menuPosition.y - 120, 'The bus stop sign is not next to nor away from curb. ' +
            'In this case, let\'s select "I don\'t know."', 365, 110);

        // Blink the "I don't know" button
        interval = setInterval(function() {
            if (highlighted) {
                highlighted = false;
                $('div.BusStopPositionMenu_MenuItem[value="None"]').css({
                    'background' : 'transparent'
                });
            } else {
                highlighted = true;
                $('div.BusStopPositionMenu_MenuItem[value="None"]').css({
                    'background' : onb.getProperties().highlight.fill
                });
            }
        }, 1000);


        $(".BusStopPositionMenu_MenuItem").bind('mouseup', function (e) {
            if (!MenuSelectBusStopPositionDone){
                var busStopPosition = $(this).attr('value');
                window.clearInterval(interval);
                if (busStopPosition === 'None') {
                    // Good correct answer.
                    SwitchModeToLabelingBench();
                } else {
                    // Not correct! Edit label.
                    MenuSelectBusStopPositionBranch_EditLabel(busStopPosition);
                }
                MenuSelectBusStopPositionDone = true;
            }
        });
    }


    function MenuSelectBusStopPositionBranch_EditLabel (busStopPosition) {
        myTracker.push('OnboardingWalking_MenuSelectBusStopPositionBranch_EditLabel');
        // Ask a user to redo labeling
        var MenuSelectBusStopPositionBranch_EditLabelDone = false;
        var busStopPositionDescription = getBusStopPositionLabel()[busStopPosition].label;


        onb.clear();
        onb.renderMessage(10, 430, 'Hmmm, this is not ' + busStopPositionDescription +
            '. Please click on <img src=\'public/img/icons/Icon_Edit.png\' height="20" width="20"> to edit it.', 690, 40);

        // Make edit icon visible
        status.currentLabel.unlockTagVisibility().setTagVisibility('visible').lockTagVisibility();
        myCanvas.unlockCurrentLabel().setCurrentLabel(status.currentLabel).lockCurrentLabel().render();
        myCanvas.unlockDisableLabelEdit().enableLabelEdit().lockDisableLabelEdit();
        myMap.unlockDisableWalking().disableWalking().lockDisableWalking();


        $("#LabelEditIcon").bind('click', function () {
            if (!MenuSelectBusStopPositionBranch_EditLabelDone) {
                MenuSelectBusStopPositionBranch_EditLabelDone = true;
                status.currentLabel.unlockTagVisibility();
                myCanvas.unlockCurrentLabel();
                MenuSelectBusStopType();
            }
        });
    }


    function SwitchModeToLabelingBench () {
        myTracker.push('OnboardingWalking_SwitchModeToLabelingBench');
        // Switch to Bench Labeling Mode.
        var SwitchModeToLabelingBenchDone = false;

        myProgressFeedback.setProgress(9 / properties.totalTaskCount);
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
        myTracker.push('OnboardingWalking_LabelBench');
        // Label a bench.
        var LabelBenchDone = false;
        var pov = svw.getPOV();
        var panoId = getPanoId();
        var benchCanvasCoord;
        if (panoId === "t0Kk2wgFDaZK1MiASyj-Qg") {
            benchCanvasCoord = gsvImageCoordinate2CanvasCoordinate(11650, -400, pov);
        } else {
            benchCanvasCoord = gsvImageCoordinate2CanvasCoordinate(8700, -375, pov);
        }

        myProgressFeedback.setProgress(10 / properties.totalTaskCount);

        // Unlock
        myCanvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        onb.clear();
        onb.renderArrowWithShadow(benchCanvasCoord.x + 55, benchCanvasCoord.y - 55, benchCanvasCoord.x, benchCanvasCoord.y + 10, 'cw');
        onb.renderMessage(benchCanvasCoord.x - 200, benchCanvasCoord.y - 130, "Now click the bottom of the bench to label it.", 350, 70);

        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel()) {
                if (!LabelBenchDone) {
                    var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                    // SVImage coordinates from my labels

                    if (panoId === "t0Kk2wgFDaZK1MiASyj-Qg" &&
                        11650 > coord.x &&
                        11250 < coord.x &&
                        -300 > coord.y &&
                        -550 < coord.y) {
                        LabelBenchDone = true;
                        SwitchModeToLabelingTrashCan();
                    } else if (panoId === "ksTjlYwXrHcXMSNJWfA9RA" &&
                        8900 > coord.x &&
                        8500 < coord.x &&
                        -250 > coord.y &&
                        -500 < coord.y) {
                        LabelBenchDone = true;
                        SwitchModeToLabelingTrashCan();
                    } else {
                        // Label is off from the bus stop position. Let a user relabel.
                        LabelBenchBranch_UndoLabeling();
                    }
                }
            }

        });
    }


    function LabelBenchBranch_UndoLabeling () {
        myTracker.push('OnboardingWalking_LabelBenchBranch_UndoLabeling');
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


    function SwitchModeToLabelingTrashCan () {
        myTracker.push('OnboardingWalking_SwitchModeToLabelingTrashCan');

        // Switch to Trash Can labeling mode.
        var step9done = false;

        myProgressFeedback.setProgress(11 / properties.totalTaskCount);

        onb.clear();
        onb.renderArrowWithShadow(400, 70, 345, 10, 'cw');
        onb.renderMessage(400, 30, 'There is a trash can. ' +
            'Let\'s label this too! First click the Trash Can / Recycle Can Icon.',
            310, 110);
        $divHolderOnboardingCanvas.css({
            top : '-20px'
        });

        $(".modeSwitch").bind('click', function () {
            if (!step9done) {
                var labelType = $(this).attr('val');
                if (labelType === 'Landmark_TrashCan') {
                    step9done = true;
                    $divHolderOnboardingCanvas.css({
                        top : '0px'
                    });
                    LabelTrashCan();
                }
            }
        });
    }


    function LabelTrashCan () {
        myTracker.push('OnboardingWalking_LabelTrashCan');

        // Label a trash can.
        var LabelTrashCanDone = false;
        var pov = svw.getPOV();
        var panoId = getPanoId();
        var trashCanCanvasCoord;
        if (panoId === "t0Kk2wgFDaZK1MiASyj-Qg") {
            trashCanCanvasCoord = gsvImageCoordinate2CanvasCoordinate(12050, -400, pov);
        } else {
            trashCanCanvasCoord = gsvImageCoordinate2CanvasCoordinate(9200, -420, pov);
        }

        myProgressFeedback.setProgress(12 / properties.totalTaskCount);

        // Lock
        myCanvas.unlockDisableLabeling();
        myCanvas.enableLabeling();


        onb.clear();
        onb.renderArrowWithShadow(trashCanCanvasCoord.x - 50, trashCanCanvasCoord.y - 55, trashCanCanvasCoord.x - 10, trashCanCanvasCoord.y + 10, 'ccw');
        onb.renderMessage(trashCanCanvasCoord.x - 200, trashCanCanvasCoord.y - 130, "Now click the bottom of the trash can to label it.", 300, 70);

        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel) {
                if (!LabelTrashCanDone) {
                    var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                    var panoId = getPanoId();
                    console.log(coord);
                    // SVImage coordinates from my labels
                    // {x: 12058.066666666666, y: -402.3277777777778}
                    // {x: 12016.755555555555, y: -421.3722222222222}
                    // {x: 12126.666666666668, y: -397.9555555555555}
                    // {x: 12044, y: -240.85555555555555}
                    // {x: 12048.91111111111, y: -449.3833333333333}
                    // {x: 12145.333333333332, y: -399.90000000000003}


                    if (panoId === "t0Kk2wgFDaZK1MiASyj-Qg" &&
                        12200 > coord.x &&
                        12000 < coord.x &&
                        -350 > coord.y &&
                        -450 < coord.y) {
                        //SubmitAndComplete();
                        SwitchModeToLabelingPole();
                        LabelTrashCanDone = true;
                    } else if (panoId === "ksTjlYwXrHcXMSNJWfA9RA" &&
                        9300 > coord.x &&
                        9090 < coord.x &&
                        -330 > coord.y &&
                        -550 < coord.y) {
                        // SubmitAndComplete();
                        SwitchModeToLabelingPole();
                        LabelTrashCanDone = true;
                    } else {
                        // Label is off from the bus stop position. Let a user relabel.
                        LabelTrashCanBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelTrashCanBranch_UndoLabeling () {
        myTracker.push('OnboardingWalking_LabelTrashCanBranch_UndoLabeling');

        // Branch. Show a message to re-label the trash can.
        var interval;

        // Close the right click menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();


        // Show an instruction
        onb.clear();
        onb.renderMessage(10, 10, "That is a little bit off from the trash can position. " +
            "Let\'s try again!", 365, 70);
        interval = setInterval(function () {
            myMenu.modeSwitchClick('Landmark_TrashCan');
            window.clearInterval(interval);
        }, 100);
    }


    function SwitchModeToLabelingPole () {
        myTracker.push('OnboardingWalking_SwitchModeToLabelingPole');

        // Switch to Trash Can labeling mode.
        var SwitchModeToLabelingPoleDone = false;

        myProgressFeedback.setProgress(13 / properties.totalTaskCount);

        onb.clear();
        onb.renderArrowWithShadow(440, 70, 485, 10, 'ccw');
        onb.renderMessage(130, 30, 'There is a traffic sign. ' +
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
        myTracker.push('OnboardingWalking_LabelPole');

        // Label a trash can.
        var LabelPoleDone = false;
        var pov = svw.getPOV();
        var panoId = getPanoId();
        var poleCanCanvasCoord;
        if (panoId === "t0Kk2wgFDaZK1MiASyj-Qg") {
            poleCanCanvasCoord = gsvImageCoordinate2CanvasCoordinate(12750, -420, pov);
        } else {
            poleCanCanvasCoord = gsvImageCoordinate2CanvasCoordinate(9200, -420, pov);
        }

        myProgressFeedback.setProgress(14 / properties.totalTaskCount);

        // Lock
        myCanvas.unlockDisableLabeling();
        myCanvas.enableLabeling();


        onb.clear();
        onb.renderArrowWithShadow(poleCanCanvasCoord.x - 90, poleCanCanvasCoord.y - 55, poleCanCanvasCoord.x - 10, poleCanCanvasCoord.y + 10, 'ccw');
        onb.renderMessage(poleCanCanvasCoord.x - 350, poleCanCanvasCoord.y - 130,
            "Now click the bottom of the traffic sign to label it.",
            300, 70);

        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel) {
                if (!LabelPoleDone) {
                    var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                    var panoId = getPanoId();
                    console.log(coord);

                    if (12900 > coord.x &&
                        12600 < coord.x &&
                        -300 > coord.y &&
                        -550 < coord.y) {
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
        myTracker.push('OnboardingWalking_LabelPole_UndoLabeling');

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
        myTracker.push('OnboardingWalking_SubmitAndComplete');
        // Submit!
        // Let them submit the task. Disable everything else.
        var prop = onb.getProperties();
        var borderColored = false;
        var data = {turker_id : properties.turker_id};

        // Update the feedback window (progress bar and badge)
        myProgressFeedback.setProgress(15 / properties.totalTaskCount);
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
        onb.renderMessage(10, 350, 'Great! Since there are no other landmarks nearby the bus stop, let\'s submit ' +
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

            myTracker.push('OnboardingWalkingSubmit');
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

        myTracker.push('OnboardingWalkingStart');
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
