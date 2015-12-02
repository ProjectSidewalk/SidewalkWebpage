/**
 * Created with JetBrains PhpStorm.
 * User: kotaro
 * Date: 3/11/13
 * Time: 1:41 AM
 * To change this template use File | Settings | File Templates.
 */
////////////////////////////////////////////////////////////////////////////////
// Onboarding 1.
// This will teach turkers how to label a bus stop.
// This uses a bus stop:
// fenway = new google.maps.LatLng(38.912807,-77.051574);
////////////////////////////////////////////////////////////////////////////////
function Onboarding_LabelingBusStop (params) {
    var oPublic = {
            className : 'Onboarding_LabelingLandmarks'
        };
    var properties = {
            minBusStopTargetX : 335,
            maxBusStopTargetX : 375,
            minBusStopTargetY : 290,
            maxBusStopTargetY : 330,
            totalTaskCount : 5,
            turker_id : undefined,
            qualification_url : undefined,
            taskDescription: 'Onboarding_LabelingBusStop'
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
    var $divLabelDrawingLayer;
    var $submitButton;
    var $noBusStopButton;
    var $textieldComment;

    // Some public setting parameters that other objects can see
    // Location
    oPublic.latlng = {
        lat : 38.912807,
        lng : -77.051574
    };

    // Heading
    oPublic.panoramaPov = {
        heading : 270, // 190,
        pitch : -10,
        zoom : 1
    };

    // Panorama id.
    oPublic.panoId = 'B6IBw1oLrutscM435zElSQ';

    // Bus stop latlng coordinate
    oPublic.busStopLatLng = {
        lat: 38.912766,
        lng : -77.051647
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
        $divLabelDrawingLayer = $("div#labelDrawingLayer");
        $divHolderOnboarding = $("#Holder_Onboarding");
        $submitButton = $("#Button_Submit");
        $noBusStopButton = $("#Button_NoBusStop");
        $textieldComment = $("#CommentField");
    }


    function AdjustHeadingAngle () {
        myTracker.push('OnboardingLabelingBusStop_AdjustHeadingAngle');
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
        myTracker.push('OnboardingLabelingBusStop_SwitchModeToLabelingBusStop');
        // Ask a user to switch to bus stop labeling mode.
        var SwitchModeToLabelingBusStopDone = false;
        var busStopVisible = false;

        myProgressFeedback.setProgress(2 / properties.totalTaskCount);

        $("#viewControlLayer").bind('mousemove', function () {
            var panoId = getPanoId();
                if (!SwitchModeToLabelingBusStopDone) {
                    var pov = svw.getPOV();

                    onb.clear();

                    if (170 < pov.heading &&
                        pov.heading < 210) {
                        busStopVisible = true;
                        myMenu.unlockDisableModeSwitch().enableModeSwitch().lockDisableModeSwitch();

                        onb.clear();
                        onb.renderArrowWithShadow(200, 70, 120, 10, 'cw');
                        onb.renderMessage(200, 30, "Now we can see the bus stop sign. Let's <span class='bold'>label</span> it! " +
                            "First click this icon to label a bus stop sign.", 350, 100);
                        $divHolderOnboardingCanvas.css({
                            top : '-20px'
                        });
                    } else {
                        busStopVisible = false;
                        myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
                        onb.renderMessage(360, 10, "Try to center the bus stop in your view. ",
                            350, 70);
                        $divHolderOnboardingCanvas.css({
                            top : '0px'
                        });
                    }
                }
        });


        $spanModeSwitchButtonStopSign.bind('click', function () {
            if (busStopVisible &&
                !SwitchModeToLabelingBusStopDone) {
                SwitchModeToLabelingBusStopDone = true;
                $divHolderOnboardingCanvas.css({
                    top : '0px'
                });
                myMap.unlockDisableWalking().disableWalking().lockDisableWalking();
                LabelBusStopSign();
            }
        });
    }


    function LabelBusStopSign () {
        myTracker.push('OnboardingLabelingBusStop_LabelBusStopSign');

        // A user is asked to click the bottom of bus stop.
        var step3done = false;

        var pov = svw.getPOV();
        var busStopCanvasCoord;
        busStopCanvasCoord = gsvImageCoordinate2CanvasCoordinate(6995, -681, pov);

        // Set the progress bar and other parts of the feedback window
        myProgressFeedback.setProgress(3 / properties.totalTaskCount);
        myProgressFeedback.setMessage("You are half way down with the first tutorial!");

        // Enable/disable interactivity.
        // myCanvas.setStatus('disableLabeling', false);
        myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
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
                if (!step3done) {
                    if (6845 < coord.x &&
                        7145 > coord.x &&
                        -581 > coord.y &&
                        -781 < coord.y) {
                        // If succeed,
                        step3done = true;
                        status.currentLabel = myCanvas.getCurrentLabel();
                        FinishAndSubmit();
                    } else {
                        // Let them cancel.
                        LabelBusStopSignBranch_UndoLabeling();
                    }
                }
            }
        });
    }


    function LabelBusStopSignBranch_UndoLabeling () {
        myTracker.push('OnboardingLabelingBusStop_LabelBusStopSignBranch_UndoLabeling');
        // Ask a user to remove the current label and redo the bus stop labeling.

        // Close a menu
        var label = myCanvas.getCurrentLabel();
        myCanvas.removeLabel(label);
        // myCanvas.hideRightClickMenu();


        myProgressFeedback.setProgress(4 / properties.totalTaskCount);

        onb.clear();
        // onb.renderArrowWithShadow(menuPosition.x + 150, menuPosition.y - 50, menuPosition.x + 205, menuPosition.y - 5, 'cw');
        onb.renderMessage(10, 10, "Oops, it seems like you did not click the right place. " +
            "Click on the bottom of the bus stop sign to label it.", 690, 70);

    }


    function FinishAndSubmit () {
        myTracker.push('OnboardingLabelingBusStop_FinishAndSubmit');
        // Let them submit the task. Disable everything else.
        var step6done = false;
        var prop = onb.getProperties();
        var highlighted = false;

        // Set the progress bar and other parts of the feedback window
        myProgressFeedback.setProgress(5 / properties.totalTaskCount);
        myProgressFeedback.setMessage("Let's work on the first tutorial!");
        myQualificationBadges.giveBusStopAuditorBadge();

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
        onb.renderMessage(10, 320, "Great! Since there are no other landmarks " +
            "such as trash cans or benches nearby the bus stop, let's submit what you have labeled.",
            500, 100, zIndexIn=100);


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

                myTracker.push('OnboardingLabelingBusStopsSubmit');
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

        myTracker.push('OnboardingLabelingBusStopsStart');
        // Set feedback fields
        myProgressFeedback.setProgress(0);
        myProgressFeedback.setMessage("Let's start the first tutorial!");
        myCurrentMissionDescription.setCurrentStatusDescription('Your mission is to learn how to ' +
            '<span class="bold">label</span> a bus stop using this interface.');

        // I have to do this because disableWalking is only effective after
        // SV is loaded + there is no callback for SV load.
        interval = setInterval(myMap.hideLinks, 1000);
        myCanvas.disableLabeling();
        myCanvas.disableMenuClose();
        myCanvas.disableLabelDelete().lockDisableLabelDelete();
        myCanvas.disableLabelEdit().lockDisableLabelEdit();
        myMenu.unlockDisableModeSwitch().disableModeSwitch().lockDisableModeSwitch();
        myActionStack.disableRedo();
        myActionStack.disableUndo();
        myForm.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
        myForm.unlockDisableNoBusStopButton().disableNoBusStopButton().lockDisableNoBusStopButton();


        $divHolderOnboardingCanvas.css({
            left : '-10px',
            top: '-115px'
        });


        onb.renderMessage(0, 0, "<h2 class='bold'>Tutorial 1/4: Labeling Bus Stops</h2>" +
            "Your mission is to find and label bus stop landmarks in Google Street View. " +
            "Blind bus riders can use collected labels prior to their travel and know what bus stop landmarks " +
            "they should expect near a bus stop sign. " +
            "They can use such information to locate the exact position of the target bus stop." +
            "<br>" +
            "<span class='bold'>You need to find and label the following bus stop landmarks near a bus stop sign:</span>" +
            "<br /><br />" +
            "<div style='position:relative; left: 130px; width: 630px;'>" +
            "<div class='OnboardingLabelingBusStopExample InlineBlock'><div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/onboarding/OnboardingOneExample_BusStop.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div>" +
            "<div class='OnboardingLabelingBusStopExampleCaption'>A bus stop sign itself<br></div>" +
            "</div>" +
            "<div class='OnboardingLabelingBusStopExample InlineBlock'><div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/onboarding/OnboardingOneExample_BusShelter.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div>" +
            "<div class='OnboardingLabelingBusStopExampleCaption'>A bus stop shelter and a bench in the shelter near a bus stop sign</div>" +
            "</div>" +
            "<div class='OnboardingLabelingBusStopExample InlineBlock'><div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/onboarding/OnboardingOneExample_Bench.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div>" +
            "<div class='OnboardingLabelingBusStopExampleCaption'>A bench next to a bus stop sign</div>" +
            "</div>" +
            "</div>" +
            "<div style='position:relative; left: 130px; width: 630px;'>" +
            "<div class='OnboardingLabelingBusStopExample InlineBlock'><div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/onboarding/OnboardingOneExample_TrashCan.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div><div class='OnboardingLabelingBusStopExampleCaption'>" +
            "A trash can next to a bus stop sign" +
            "</div></div>" +
            "<div class='OnboardingLabelingBusStopExample InlineBlock'><div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/onboarding/OnboardingOneExample_NewsPaperBox.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div><div class='OnboardingLabelingBusStopExampleCaption'>A newspaper box or a mailbox</div></div>" +
            "<div class='OnboardingLabelingBusStopExample InlineBlock'><div class='OnboardingLabelingBusStopExampleImageHolder'>" +
            "<img src='public/img/onboarding/OnboardingOneExample_OtherPole.png' class='OnboardingLabelingBusStopExampleImage'> " +
            "</div><div class='OnboardingLabelingBusStopExampleCaption'>A pole near a bus stop sign</div></div>" +
            "</div>" +
            "</div>" +
            "<span class='bold'>We'll begin with a short, interactive tutorial to get you started!</span> " +
            "Thanks for helping to improve access to public transportation.<br /><br />", 940, 670);

        onb.setBackground('rgba(60,60,60,1)');
        $divOnboardingMessageBox.append(dom.Btn_Ok01);
        $OkBtn01 = $("#OnboardingButton_Ok01");

        $OkBtn01.css({
            'left' : '20px',
            'top' : '600px',
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
            AdjustHeadingAngle();
        });
    };

    init(params);
    return oPublic;
}
