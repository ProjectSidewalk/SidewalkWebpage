/**
 * Created with JetBrains PhpStorm.
 * User: kotaro
 * Date: 3/11/13
 * Time: 1:41 AM
 * To change this template use File | Settings | File Templates.
 */
function Onboarding_LabelingLandmarks (params) {
    var oPublic = {
        className : 'Onboarding_LabelingLandmarks.js'
    };
    var properties = {
        minBusStopTargetX : 335,
        maxBusStopTargetX : 375,
        minBusStopTargetY : 290,
        maxBusStopTargetY : 330,
        totalTaskCount : 23,
        turker_id : undefined,
        qualification_url : undefined,
        taskDescription: 'Onboarding_LabelingLandmarks'
    };
    var status = {
        currentLabel : undefined
    };
    var mouse = {

    };
    var onb;
    var rightClickMenu;
    var dom;
    var handAnimation;

    // jQuery dom
    var $divHolderOnboarding;
    var $divHolderOnboardingCanvas;
    var $divOnboardingMessageBox;
    var $spanModeSwitchButtonStopSign;
    var $spanModeSwitchButtonShelter;
    var $spanModeSwitchButtonBench;
    var $spanModeSwitchButtonTrashCan;
    var $spanModeSwitchButtonMailbox;
    var $spanModeSwitchButtonPole;
    var $divLabelDrawingLayer;
    var $submitButton;
    var $noBusStopButton;
    var $textieldComment;

    // Some public setting parameters that other objects can see
    // Location
    oPublic.latlng = {
        lat : 38.897811,
        lng : -77.009252
    };

    // Heading
    oPublic.panoramaPov = {
        heading : 280, // 190,
        pitch : -10,
        zoom : 1
    };

    // Panorama id.
    oPublic.panoId = 'Xgy1rerrvj8qmgAXZnUwOA';

    // Bus stop latlng coordinate
    oPublic.busStopLatLng = {
        lat : 38.897811,
        lng : -77.009252
    };


    // some doms
    dom = {
        'Btn_Ok01' : '<button id="OnboardingButton_Ok01" class="button">OK</button>',
        'Btn_Ok02' : '<button id="OnboardingButton_Ok02" class="button">OK</button>',
        'Btn_Ok_Step3Branch' : '<button id="OnboardingButton_Ok_Step3Branch" class="button">OK</button>',
        'Div_BusStopSceneHighlighter' : '<div id="OnboardingDiv_BusStopSceneHighlighter"></div>'
    };
    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function init(params) {
        onb = new Onboarding(params);
        properties.turker_id = params.turker_id;
        properties.qualification_url = params.qualification_url;

        $divOnboardingMessageBox = $("#Holder_OnboardingMessageBox");
        $divHolderOnboardingCanvas = $("#Holder_OnboardingCanvas");
        $spanModeSwitchButtonStopSign = $("#ModeSwitchButton_StopSign");
        $spanModeSwitchButtonShelter = $("#ModeSwitchButton_Shelter");
        $spanModeSwitchButtonBench = $("#ModeSwitchButton_Bench");
        $spanModeSwitchButtonTrashCan = $("#ModeSwitchButton_TrashCan");
        $spanModeSwitchButtonMailbox = $("#ModeSwitchButton_MailboxAndNewsPaperBox");
        $spanModeSwitchButtonPole = $("#ModeSwitchButton_OtherPole");
        $divLabelDrawingLayer = $("div#labelDrawingLayer");
        $divHolderOnboarding = $("#Holder_Onboarding");
        $submitButton = $("#Button_Submit");
        $noBusStopButton = $("#Button_NoBusStop");
        $textieldComment = $("#CommentField");
    }


    function AdjustHeadingAngle () {
        myTracker.push('OnboardingLabelingLandmarks_AdjustHeadingAngle');
        // Let a user change heading angle.
        var AdjustHeadingAngleDone = false;
        var mouseDown = false;
        var handAnimationTimeout;

        // Update the progress bar!
        myProgressFeedback.setProgress(1 / properties.totalTaskCount);
        $('path').remove();

        // Clear and render the onboarding canvas
        onb.clear();
        onb.renderMessage(360, 10, "Let's first learn how to adjust a view. " +
            "Grab and drag the Street View image to find a bus stop. ",
            350, 110);

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
        myTracker.push('OnboardingLabelingLandmarks_SwitchModeToLabelingBusStop');
        // Ask a user to switch to bus stop labeling mode.
        var SwitchModeToLabelingBusStopDone = false;

        myProgressFeedback.setProgress(2 / properties.totalTaskCount);
        myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();
        onb.clear();
        onb.renderArrowWithShadow(200, 70, 120, 10, 'cw');
        onb.renderMessage(200, 30,
            "First click this icon to label a bus stop sign.",
            350, 70);
        $divHolderOnboardingCanvas.css({
            top : '-20px'
        });

        $spanModeSwitchButtonStopSign.bind('click', function () {
            if (!SwitchModeToLabelingBusStopDone) {
                SwitchModeToLabelingBusStopDone = true;
                myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
                LabelBusStopSign();
            }
        });
    }


    function LabelBusStopSign () {
        myTracker.push('OnboardingLabelingLandmarks_LabelBusStopSign');

        // A user is asked to click the bottom of bus stop.
        var LabelBusStopSignDone = false;

        var pov = svw.getPOV();
        var busStopCanvasCoord;
        busStopCanvasCoord = gsvImageCoordinate2CanvasCoordinate(11500, -600, pov);

        // Set the progress bar and other parts of the feedback window
        myProgressFeedback.setProgress(3 / properties.totalTaskCount);
        myProgressFeedback.setMessage("You are half way down with the first tutorial!");

        // Enable/disable interactivity.
        // myCanvas.setStatus('disableLabeling', false);
        // myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myCanvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        onb.clear();
        // onb.renderArrowWithShadow(270, 375, 340, 310, 'cw');
        // onb.renderMessage(75, 375, "Now click the bottom of the bus stop sign to label it.", 300, 70);
        onb.renderArrowWithShadow(busStopCanvasCoord.x - 60, busStopCanvasCoord.y - 105, busStopCanvasCoord.x - 10, busStopCanvasCoord.y, 'ccw');
        onb.renderMessage(busStopCanvasCoord.x - 200, busStopCanvasCoord.y - 180, "Now click the bottom of the bus stop sign to label it.", 365, 70);


        // Listener to get canvas click. Check if the clicked position is correct.
        // Bus stop target area in canvas:
        // 335 < x < 375
        // 290 < y < 330
        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel()) {
                var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                if (!LabelBusStopSignDone) {
                    if (11450 < coord.x &&
                        11700 > coord.x &&
                        -400 > coord.y &&
                        -700 < coord.y) {
                        // If succeed,
                        LabelBusStopSignDone = true;
                        status.currentLabel = myCanvas.getCurrentLabel();
                        SwitchModeToLabelingShelter();
                    } else {
                        // Let them cancel.
                        LabelBusStopSignBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelBusStopSignBranch_UndoLabeling () {
        myTracker.push('OnboardingLabelingLandmarks_LabelBusStopSignBranch_UndoLabeling');
        // Ask a user to remove the current label and redo the bus stop labeling.

        // Close a menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();


        myProgressFeedback.setProgress(4 / properties.totalTaskCount);
        myMenu.modeSwitchClick('StopSign');

        onb.clear();
        onb.renderMessage(10, 10, "Oops, it seems like you did not click the right place. " +
            "Click on the bus stop sign again to label it.", 690, 70);

    }


    function SwitchModeToLabelingShelter () {
        myTracker.push('OnboardingLabelingLandmarks_SwitchModeToLabelingShelter');
        // Ask a user to switch to bus stop labeling mode.
        var SwitchModeToLabelingShelterDone = false;
        var busStopVisible = false;

        myProgressFeedback.setProgress(5 / properties.totalTaskCount);

        onb.clear();

        myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

        onb.clear();
        onb.renderArrowWithShadow(250, 70, 190, 10, 'cw');
        onb.renderMessage(250, 30,
            "Click this button to label a bus stop shelter.",
            350, 70);
        $divHolderOnboardingCanvas.css({
            top : '-20px'
        });

        $spanModeSwitchButtonShelter.bind('click', function () {
            if (!SwitchModeToLabelingShelterDone) {
                SwitchModeToLabelingShelterDone = true;
                myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
                LabelShelter();
            }
        });
    }


    function LabelShelter () {
        myTracker.push('OnboardingLabelingLandmarks_LabelShelter');

        // A user is asked to click the bottom of bus stop.
        var LabelShelterDone= false;

        var pov = svw.getPOV();
        var shelterCanvasCoord;
        shelterCanvasCoord = gsvImageCoordinate2CanvasCoordinate(10100, -550, pov);

        // Set the progress bar and other parts of the feedback window
        myProgressFeedback.setProgress(6 / properties.totalTaskCount);
        // myProgressFeedback.setMessage("You are half way down with the first tutorial!");

        // Enable/disable interactivity.
        // myCanvas.setStatus('disableLabeling', false);
        // myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myCanvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        onb.clear();
        // onb.renderArrowWithShadow(270, 375, 340, 310, 'cw');
        // onb.renderMessage(75, 375, "Now click the bottom of the bus stop sign to label it.", 300, 70);
        onb.renderArrowWithShadow(shelterCanvasCoord.x - 60, shelterCanvasCoord.y - 105, shelterCanvasCoord.x - 10, shelterCanvasCoord.y, 'ccw');
        onb.renderMessage(shelterCanvasCoord.x - 200, shelterCanvasCoord.y - 180,
            "Now click the bottom of the bus stop shelter to label it.",
            365, 70);


        // Listener to get canvas click. Check if the clicked position is correct.
        // Bus stop target area in canvas:
        // 335 < x < 375
        // 290 < y < 330
        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel()) {
                var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                if (!LabelShelterDone) {
                    if (10050 < coord.x &&
                        10900 > coord.x &&
                        -300 > coord.y &&
                        -660 < coord.y) {
                        // If succeed,
                        LabelShelterDone = true;
                        status.currentLabel = myCanvas.getCurrentLabel();
                        // FinishAndSubmit();
                        SwitchModeToLabelingBench();
                    } else {
                        // Let them cancel.
                        LabelShelterBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelShelterBranch_UndoLabeling () {
        myTracker.push('OnboardingLabelingLandmarks_LabelShelterBranch_UndoLabeling');
        // Ask a user to remove the current label and redo the bus stop labeling.

        // Close a menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();
        myMenu.modeSwitchClick('Landmark_Shelter');

        myProgressFeedback.setProgress(7 / properties.totalTaskCount);

        onb.clear();
        // onb.renderArrowWithShadow(menuPosition.x + 150, menuPosition.y - 50, menuPosition.x + 205, menuPosition.y - 5, 'cw');
        onb.renderMessage(10, 10, "Oops, it seems like you did not click the right place. " +
            "Click on the bus stop shelter again to label it.", 690, 70);

    }


    function SwitchModeToLabelingBench () {
        myTracker.push('OnboardingLabelingLandmarks_SwitchModeToLabelingBench');
        // Ask a user to switch to bus stop labeling mode.
        var SwitchModeToLabelingBenchDone = false;
        var busStopVisible = false;

        myProgressFeedback.setProgress(8 / properties.totalTaskCount);

        onb.clear();

        myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

        onb.clear();
        onb.renderArrowWithShadow(330, 70, 270, 10, 'cw');
        onb.renderMessage(330, 30,
            "<span class='bold'>Remember to label a bench in the shelter too!</span> Click this button to label a bench.",
            350, 110);
        $divHolderOnboardingCanvas.css({
            top : '-20px'
        });

        $spanModeSwitchButtonBench.bind('click', function () {
            if (!SwitchModeToLabelingBenchDone) {
                SwitchModeToLabelingBenchDone = true;
                myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
                LabelBench();
            }
        });
    }


    function LabelBench () {
        myTracker.push('OnboardingLabelingLandmarks_LabelBench');

        // A user is asked to click the bottom of bus stop.
        var LabelShelterDone= false;

        var pov = svw.getPOV();
        var benchCanvasCoord;
        benchCanvasCoord = gsvImageCoordinate2CanvasCoordinate(10300, -550, pov);

        // Set the progress bar and other parts of the feedback window
        myProgressFeedback.setProgress(9 / properties.totalTaskCount);
        // myProgressFeedback.setMessage("You are half way down with the first tutorial!");

        // Enable/disable interactivity.
        // myCanvas.setStatus('disableLabeling', false);
        // myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myCanvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        onb.clear();
        // onb.renderArrowWithShadow(270, 375, 340, 310, 'cw');
        // onb.renderMessage(75, 375, "Now click the bottom of the bus stop sign to label it.", 300, 70);
        onb.renderArrowWithShadow(benchCanvasCoord.x + 120, benchCanvasCoord.y - 105, benchCanvasCoord.x + 70, benchCanvasCoord.y, 'cw');
        onb.renderMessage(benchCanvasCoord.x - 100, benchCanvasCoord.y - 180,
            "Now click the bottom of the bench to label it.",
            365, 70);


        // Listener to get canvas click. Check if the clicked position is correct.
        // Bus stop target area in canvas:
        // 335 < x < 375
        // 290 < y < 330
        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel()) {
                var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                if (!LabelShelterDone) {
                    if (10250 < coord.x &&
                        10770 > coord.x &&
                        -300 > coord.y &&
                        -600 < coord.y) {
                        // If succeed,
                        LabelShelterDone = true;
                        status.currentLabel = myCanvas.getCurrentLabel();
                        SwitchModeToLabelingTrashCan();
                    } else {
                        // Let them cancel.
                        LabelBenchBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelBenchBranch_UndoLabeling () {
        myTracker.push('OnboardingLabelingLandmarks_LabelBenchBranch_UndoLabeling');
        // Ask a user to remove the current label and redo the bus stop labeling.

        // Close a menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();
        myMenu.modeSwitchClick('Landmark_Bench');

        myProgressFeedback.setProgress(10 / properties.totalTaskCount);

        onb.clear();
        // onb.renderArrowWithShadow(menuPosition.x + 150, menuPosition.y - 50, menuPosition.x + 205, menuPosition.y - 5, 'cw');
        onb.renderMessage(10, 10, "Oops, it seems like you did not click the right place. " +
            "Click on the bench in the shelter again to label it.", 690, 70);

    }


    function SwitchModeToLabelingTrashCan () {
        myTracker.push('OnboardingLabelingLandmarks_SwitchModeToLabelingTrashCan');
        // Ask a user to switch to bus stop labeling mode.
        var SwitchModeToLabelingTrashCanDone = false;
        var busStopVisible = false;

        myProgressFeedback.setProgress(11 / properties.totalTaskCount);

        onb.clear();

        myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

        onb.clear();
        onb.renderArrowWithShadow(410, 70, 350, 10, 'cw');
        onb.renderMessage(410, 30,
            "There is a trash can too. Click this button to label a trash can.",
            350, 70);
        $divHolderOnboardingCanvas.css({
            top : '-20px'
        });

        $spanModeSwitchButtonTrashCan.bind('click', function () {
            if (!SwitchModeToLabelingTrashCanDone) {
                SwitchModeToLabelingTrashCanDone = true;
                myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
                LabelTrashCan();
            }
        });
    }


    function LabelTrashCan () {
        myTracker.push('OnboardingLabelingLandmarks_LabelTrashCan');

        // A user is asked to click the bottom of bus stop.
        var LabelShelterDone= false;

        var pov = svw.getPOV();
        var trashCanCanvasCoord;
        trashCanCanvasCoord = gsvImageCoordinate2CanvasCoordinate(9600, -600, pov);

        // Set the progress bar and other parts of the feedback window
        myProgressFeedback.setProgress(12 / properties.totalTaskCount);
        // myProgressFeedback.setMessage("You are half way down with the first tutorial!");

        // Enable/disable interactivity.
        // myCanvas.setStatus('disableLabeling', false);
        // myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myCanvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        onb.clear();
        // onb.renderArrowWithShadow(270, 375, 340, 310, 'cw');
        // onb.renderMessage(75, 375, "Now click the bottom of the bus stop sign to label it.", 300, 70);
        onb.renderArrowWithShadow(trashCanCanvasCoord.x + 90, trashCanCanvasCoord.y - 105, trashCanCanvasCoord.x + 35, trashCanCanvasCoord.y, 'cw');
        onb.renderMessage(trashCanCanvasCoord.x - 100, trashCanCanvasCoord.y - 180,
            "Now click the bottom of the trash can to label it.",
            365, 70);


        // Listener to get canvas click. Check if the clicked position is correct.
        // Bus stop target area in canvas:
        // 335 < x < 375
        // 290 < y < 330
        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel()) {
                var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                if (!LabelShelterDone) {
                    if (9550 < coord.x &&
                        9830 > coord.x &&
                        -390 > coord.y &&
                        -640 < coord.y) {
                        // If succeed,
                        LabelShelterDone = true;
                        status.currentLabel = myCanvas.getCurrentLabel();
                        SwitchModeToLabelingFirstNewspaperBox();
                    } else {
                        // Let them cancel.
                        LabelTrashCanBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelTrashCanBranch_UndoLabeling () {
        myTracker.push('OnboardingLabelingLandmarks_LabelTrashCanBranch_UndoLabeling');
        // Ask a user to remove the current label and redo the bus stop labeling.

        // Close a menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();
        myMenu.modeSwitchClick('Landmark_TrashCan');

        myProgressFeedback.setProgress(13 / properties.totalTaskCount);

        onb.clear();
        // onb.renderArrowWithShadow(menuPosition.x + 150, menuPosition.y - 50, menuPosition.x + 205, menuPosition.y - 5, 'cw');
        onb.renderMessage(10, 10, "Oops, it seems like you did not click the right place. " +
            "Click on the trash can again to label it.", 690, 70);

    }


    function SwitchModeToLabelingFirstNewspaperBox () {
        myTracker.push('OnboardingLabelingLandmarks_SwitchModeToLabelingFirstNewspaperBox');
        // Ask a user to switch to bus stop labeling mode.
        var SwitchModeToLabelingFirstNewspaperBoxDone = false;
        var busStopVisible = false;

        myProgressFeedback.setProgress(14 / properties.totalTaskCount);

        onb.clear();

        myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

        onb.clear();
        onb.renderArrowWithShadow(370, 70, 420, 10, 'ccw');
        onb.renderMessage(20, 30,
            "There are two newspaper boxes next to the bus stop sign. Let's click this button to label the newspaper box on the right.",
            350, 140);
        $divHolderOnboardingCanvas.css({
            top : '-20px'
        });

        $spanModeSwitchButtonMailbox.bind('click', function () {
            if (!SwitchModeToLabelingFirstNewspaperBoxDone) {
                SwitchModeToLabelingFirstNewspaperBoxDone = true;
                myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
                LabelFirstNewspaperBox();
            }
        });
    }


    function LabelFirstNewspaperBox () {
        myTracker.push('OnboardingLabelingLandmarks_LabelFirstNewspaperBox');

        // A user is asked to click the bottom of bus stop.
        var LabelShelterDone= false;

        var pov = svw.getPOV();
        var newspapaperBoxCanvasCoord;
        newspapaperBoxCanvasCoord = gsvImageCoordinate2CanvasCoordinate(11600, -550, pov);

        // Set the progress bar and other parts of the feedback window
        myProgressFeedback.setProgress(15 / properties.totalTaskCount);
        // myProgressFeedback.setMessage("You are half way down with the first tutorial!");

        // Enable/disable interactivity.
        // myCanvas.setStatus('disableLabeling', false);
        // myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myCanvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        onb.clear();
        // onb.renderArrowWithShadow(270, 375, 340, 310, 'cw');
        // onb.renderMessage(75, 375, "Now click the bottom of the bus stop sign to label it.", 300, 70);
        onb.renderArrowWithShadow(newspapaperBoxCanvasCoord.x - 70, newspapaperBoxCanvasCoord.y - 105, newspapaperBoxCanvasCoord.x - 5, newspapaperBoxCanvasCoord.y, 'ccw');
        onb.renderMessage(newspapaperBoxCanvasCoord.x - 250, newspapaperBoxCanvasCoord.y - 180,
            "Click the bottom of the newspaper box on the right to label it.",
            365, 70);


        // Listener to get canvas click. Check if the clicked position is correct.
        // Bus stop target area in canvas:
        // 335 < x < 375
        // 290 < y < 330
        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel()) {
                var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                if (!LabelShelterDone) {
                    if (11600 < coord.x &&
                        11770 > coord.x &&
                        -300 > coord.y &&
                        -550 < coord.y) {
                        // If succeed,
                        LabelShelterDone = true;
                        status.currentLabel = myCanvas.getCurrentLabel();
                        SwitchModeToLabelingSecondNewspaperBox();
                    } else {
                        // Let them cancel.
                        LabelFirstNewspaperBoxBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelFirstNewspaperBoxBranch_UndoLabeling () {
        myTracker.push('OnboardingLabelingLandmarks_LabelFirstNewspaperBoxBranch_UndoLabeling');
        // Ask a user to remove the current label and redo the bus stop labeling.

        // Close a menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();
        myMenu.modeSwitchClick('Landmark_MailboxAndNewsPaperBox');

        myProgressFeedback.setProgress(16 / properties.totalTaskCount);

        onb.clear();
        // onb.renderArrowWithShadow(menuPosition.x + 150, menuPosition.y - 50, menuPosition.x + 205, menuPosition.y - 5, 'cw');
        // onb.renderMessage(menuPosition.x - 100, menuPosition.y - 110, 'Oops, it seems like you did not click the right place.' +
        onb.renderMessage(10, 10, "Oops, it seems like you did not click the right place. " +
            "Click on the newspaper box again to label it.", 690, 70);

    }


    function SwitchModeToLabelingSecondNewspaperBox () {
        myTracker.push('OnboardingLabelingLandmarks_SwitchModeToLabelingSecondNewspaperBox');
        // Ask a user to switch to bus stop labeling mode.
        var SwitchModeToLabelingSecondNewspaperBoxDone = false;
        var busStopVisible = false;

        myProgressFeedback.setProgress(17 / properties.totalTaskCount);

        onb.clear();

        myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

        onb.clear();
        onb.renderArrowWithShadow(370, 70, 420, 10, 'ccw');
        onb.renderMessage(20, 30,
            "There is another newspaper box next to the one you labeled. Let's click this button to label the newspaper box on the left.",
            350, 140);
        $divHolderOnboardingCanvas.css({
            top : '-20px'
        });

        $spanModeSwitchButtonMailbox.bind('click', function () {
            if (!SwitchModeToLabelingSecondNewspaperBoxDone) {
                SwitchModeToLabelingSecondNewspaperBoxDone = true;
                myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
                LabelSecondNewspaperBox();
            }
        });
    }


    function LabelSecondNewspaperBox () {
        myTracker.push('OnboardingLabelingLandmarks_LabelSecondNewspaperBox');

        // A user is asked to click the bottom of bus stop.
        var LabelShelterDone= false;

        var pov = svw.getPOV();
        var newspapaperBoxCanvasCoord;
        newspapaperBoxCanvasCoord = gsvImageCoordinate2CanvasCoordinate(11600, -550, pov);

        // Set the progress bar and other parts of the feedback window
        myProgressFeedback.setProgress(18 / properties.totalTaskCount);
        // myProgressFeedback.setMessage("You are half way down with the first tutorial!");

        // Enable/disable interactivity.
        // myCanvas.setStatus('disableLabeling', false);
        // myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myCanvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        onb.clear();
        // onb.renderArrowWithShadow(270, 375, 340, 310, 'cw');
        // onb.renderMessage(75, 375, "Now click the bottom of the bus stop sign to label it.", 300, 70);
        onb.renderArrowWithShadow(newspapaperBoxCanvasCoord.x - 70, newspapaperBoxCanvasCoord.y - 105, newspapaperBoxCanvasCoord.x - 15, newspapaperBoxCanvasCoord.y, 'ccw');
        onb.renderMessage(newspapaperBoxCanvasCoord.x - 250, newspapaperBoxCanvasCoord.y - 180,
            "Click the bottom of the newspaper box on the left to label it.",
            365, 70);


        // Listener to get canvas click. Check if the clicked position is correct.
        // Bus stop target area in canvas:
        // 335 < x < 375
        // 290 < y < 330
        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel()) {
                var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                if (!LabelShelterDone) {
                    if (11420 < coord.x &&
                        11710 > coord.x &&
                        -300 > coord.y &&
                        -550 < coord.y) {
                        // If succeed,
                        LabelShelterDone = true;
                        status.currentLabel = myCanvas.getCurrentLabel();
                        SwitchModeToLabelingPole();
                    } else {
                        // Let them cancel.
                        LabelSecondNewspaperBoxBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelSecondNewspaperBoxBranch_UndoLabeling () {
        myTracker.push('OnboardingLabelingLandmarks_LabelSecondNewspaperBoxBranch_UndoLabeling');
        // Ask a user to remove the current label and redo the bus stop labeling.

        // Close a menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();
        myMenu.modeSwitchClick('Landmark_MailboxAndNewsPaperBox');

        myProgressFeedback.setProgress(19 / properties.totalTaskCount);

        onb.clear();
        onb.renderMessage(10, 10, "Oops, it seems like you did not click the right place. " +
            "Click on the newspaper box on the left to label it.", 690, 70);

    }


    function SwitchModeToLabelingPole () {
        myTracker.push('OnboardingLabelingLandmarks_SwitchModeToLabelingPole');
        // Ask a user to switch to bus stop labeling mode.
        var SwitchModeToLabelingSecondNewspaperBoxDone = false;

        myProgressFeedback.setProgress(20 / properties.totalTaskCount);

        onb.clear();

        myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

        onb.clear();
        onb.renderArrowWithShadow(450, 70, 500, 10, 'ccw');
        onb.renderMessage(20, 30,
            "There is a pole next to a trash can. Let's click this button to label the pole.",
            430, 70);
        $divHolderOnboardingCanvas.css({
            top : '-20px'
        });

        $spanModeSwitchButtonPole.bind('click', function () {
            if (!SwitchModeToLabelingSecondNewspaperBoxDone) {
                SwitchModeToLabelingSecondNewspaperBoxDone = true;
                myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
                LabelPole();
            }
        });
    }


    function LabelPole () {
        myTracker.push('OnboardingLabelingLandmarks_LabelPole');

        // A user is asked to click the bottom of bus stop.
        var LabelShelterDone= false;

        var pov = svw.getPOV();
        var poleCanvasCoord;
        poleCanvasCoord = gsvImageCoordinate2CanvasCoordinate(9850, -680, pov);

        // Set the progress bar and other parts of the feedback window
        myProgressFeedback.setProgress(21 / properties.totalTaskCount);
        // myProgressFeedback.setMessage("You are half way down with the first tutorial!");

        // Enable/disable interactivity.
        // myCanvas.setStatus('disableLabeling', false);
        // myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myCanvas.unlockDisableLabeling().enableLabeling().lockDisableLabeling();

        onb.clear();
        // onb.renderArrowWithShadow(270, 375, 340, 310, 'cw');
        // onb.renderMessage(75, 375, "Now click the bottom of the bus stop sign to label it.", 300, 70);
        onb.renderArrowWithShadow(poleCanvasCoord.x + 60, poleCanvasCoord.y - 105, poleCanvasCoord.x + 10, poleCanvasCoord.y, 'cw');
        onb.renderMessage(poleCanvasCoord.x - 100, poleCanvasCoord.y - 180,
            "Click the bottom of the pole to label it.",
            365, 70);


        // Listener to get canvas click. Check if the clicked position is correct.
        // Bus stop target area in canvas:
        // 335 < x < 375
        // 290 < y < 330
        $divLabelDrawingLayer.bind('mouseup', function (e) {
            if (myCanvas.getCurrentLabel()) {
                var coord = myCanvas.getCurrentLabel().getGSVImageCoordinate();
                console.log(coord);
                if (!LabelShelterDone) {
                    if (9700 < coord.x &&
                        9960 > coord.x &&
                        -380 > coord.y &&
                        -730 < coord.y) {
                        // If succeed,
                        LabelShelterDone = true;
                        status.currentLabel = myCanvas.getCurrentLabel();
                        FinishAndSubmit();
                    } else {
                        // Let them cancel.
                        LabelPoleBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelPoleBranch_UndoLabeling () {
        myTracker.push('OnboardingLabelingLandmarks_LabelPoleBranch_UndoLabeling');
        // Ask a user to remove the current label and redo the bus stop labeling.

        // Close a menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();
        myMenu.modeSwitchClick('Landmark_OtherPole');

        myProgressFeedback.setProgress(22 / properties.totalTaskCount);

        onb.clear();
        onb.renderMessage(10, 10, "Oops, it seems like you did not click the right place. " +
            "Click on the pole to label it.", 690, 70);

    }



    function FinishAndSubmit () {
        myTracker.push('OnboardingLabelingBusStop_FinishAndSubmit');
        // Let them submit the task. Disable everything else.
        var step6done = false;
        var prop = onb.getProperties();
        var highlighted = false;

        // Set the progress bar and other parts of the feedback window
        myProgressFeedback.setProgress(23 / properties.totalTaskCount);
        myProgressFeedback.setMessage("Let's work on the first tutorial!");
        myQualificationBadges.giveBusStopAuditorBadge();
        myQualificationBadges.giveBusStopExplorerBadge();

        // Set interactivity
        myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
        myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myCanvas.unlockDisableLabeling().disableLabeling().lockDisableLabeling();
        myForm.unlockDisableSubmit().enableSubmit().lockDisableSubmit();

        // Shift the entire canvas a little bit to the bottom
        $divHolderOnboardingCanvas.css({
            top : '50px'
        });
        onb.clear();
        onb.renderArrowWithShadow(510, 380, 610, 470, 'cw');
        onb.renderMessage(10, 270, "Great! Remember, there are other landmarks that we want you to label " +
            "such as mailboxes, traffic signals, and traffic signs. " +
            "Only label landmarks that are close to the bus stop sign. " +
            "Let's submit what you have labeled and " +
            "move on to the actual task.",
            500, 150, zIndexIn=100);


        var interval = setInterval(function () {
            if (highlighted) {
                highlighted = false;
                $("#Button_Submit").css({
                    'background': '',
                    'border': ''
                });
            } else {
                highlighted = true;
                prop = onb.getProperties();
                $("#Button_Submit").css({
                    'background': prop.highlight.fill,
                    'border': prop.highlight.border
                });
            }
        }, 1000);




        $("#Button_Submit").bind('click', function (){
            if (!step6done) {
                step6done = true;
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

                myTracker.push('OnboardingLabelingLandmarks_Submit');
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
            }

        });
    }

    ////////////////////////////////////////////////////////////////////////////////
    // oPublic functions
    ////////////////////////////////////////////////////////////////////////////////
    oPublic.set = function (key, value) {
        // I do not need to implement this function for this class.
        return false;
    };


    oPublic.setRightClickMenu = function (menu) {
        rightClickMenu = menu;
        return this;
    };


    oPublic.start = function () {
        var $OkBtn01;
        var interval;

        myTracker.push('OnboardingLabelingLandmarks_Start');

        // Set feedback fields
        myProgressFeedback.setProgress(0);
        myProgressFeedback.setMessage("Let's start the last tutorial!");
        myCurrentMissionDescription.setCurrentStatusDescription('Your mission is to learn ' +
            '<span class="bold">what landmarks to label.</span>');

        // I have to do this because disableWalking is only effective after
        // SV is loaded + there is no callback for SV load.
        interval = setInterval(function () {
            $('path').remove();
            myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
        }, 1000);
        myCanvas.disableLabeling();
        myCanvas.disableMenuClose();
        myCanvas.disableLabelDelete().lockDisableLabelDelete();
        myCanvas.disableLabelEdit().lockDisableLabelEdit();
        myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myActionStack.disableRedo();
        myActionStack.disableUndo();
        myForm.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
        myForm.unlockDisableNoBusStopButton().disableNoBusStopButton().lockDisableNoBusStopButton();
        myQualificationBadges.giveBusStopAuditorBadge();
        myQualificationBadges.giveBusStopExplorerBadge();

        $divHolderOnboardingCanvas.css({
            left : '-10px',
            top: '-115px'
        });


        onb.renderMessage(0, 0, "<h2 class='bold'>Tutorial 4/4: Labeling Bus Stop Landmarks</h2>" +
            "<span class='bold'>In this final tutorial,</span> you will learn all categories of landmarks that you have to find and label. ",
            940, 150);

        onb.setBackground('rgba(60,60,60,1)');
        $divOnboardingMessageBox.append(dom.Btn_Ok01);
        $OkBtn01 = $("#OnboardingButton_Ok01");

        $OkBtn01.css({
            'left' : '20px',
            'bottom' : '10px',
            'position' : 'absolute',
            'width' : 100,
            'z-index' : 1000
        });

        $OkBtn01.bind('click', function () {

            $OkBtn01.remove();
            $divHolderOnboardingCanvas.css({
                left : '0px',
                top: '0px'
            });
            onb.setBackground();
            window.clearInterval(interval);
            SwitchModeToLabelingBusStop();
        });
    };

    init(params);
    return oPublic;
}
