/** @namespace */
var svv = svv || {};

/**
 * Main module for SVValidate (Validation interface)
 * @param param    Object passed from validation.scala.html containing initial values pulled from
 *                  the database on page load. (Currently, mission and labels)
 * @constructor
 */
function Main (param) {
    svv.canvasHeight = param.canvasHeight;
    svv.canvasWidth = param.canvasWidth;
    svv.missionsCompleted = param.missionSetProgress;

    function _initUI() {
        // Maps label types to label names.
        svv.labelNames = {
            CurbRamp: i18next.t('curb-ramp-caps'),
            NoCurbRamp: i18next.t('missing-curb-ramp-caps'),
            Obstacle: i18next.t('obstacle-caps'),
            SurfaceProblem: i18next.t('surface-problem-caps'),
            NoSidewalk: i18next.t('no-sidewalk-caps'),
            Crosswalk: i18next.t('crosswalk-caps'),
            Signal: i18next.t('signal-caps')
        };

        svv.labelTypeNames = {
            1: i18next.t('curb-ramp-caps'),
            2: i18next.t('missing-curb-ramp-caps'),
            3: i18next.t('obstacle-caps'),
            4: i18next.t('surface-problem-caps'),
            7: i18next.t('no-sidewalk-caps'),
            9: i18next.t('crosswalk-caps'),
            10: i18next.t('signal-caps')
        };

        svv.labelTypes = {
            1: 'CurbRamp',
            2: 'NoCurbRamp',
            3: 'Obstacle',
            4: 'SurfaceProblem',
            7: 'NoSidewalk',
            9: 'Crosswalk',
            10: 'Signal'
        };
        svv.ui = {};

        svv.ui.validation = {};
        svv.ui.validation.agreeButton = $("#validation-agree-button");
        svv.ui.validation.buttons = $('button.validation-button');
        svv.ui.validation.disagreeButton = $("#validation-disagree-button");
        svv.ui.validation.notSureButton = $("#validation-not-sure-button");

        svv.ui.modal = {};
        svv.ui.modal.background = $("#modal-comment-background");

        svv.ui.modalSkip = {};
        svv.ui.modalSkip.skipButton = $("#left-column-jump-button");

        svv.ui.modalComment = {};
        svv.ui.modalComment.box = $("#modal-comment-box");
        svv.ui.modalComment.feedbackButton = $("#left-column-feedback-button");
        svv.ui.modalComment.holder = $("#modal-comment-holder");
        svv.ui.modalComment.ok = $("#modal-comment-ok-button");
        svv.ui.modalComment.cancel = $("#modal-comment-cancel-button");
        svv.ui.modalComment.textarea = $("#modal-comment-textarea");

        svv.ui.modalInfo = {};
        svv.ui.modalInfo.holder = $("#modal-info-holder");
        svv.ui.modalInfo.foreground = $("#modal-info-foreground");
        svv.ui.modalInfo.background = $("#modal-info-background");
        svv.ui.modalInfo.infoHeader = $("#modal-info-header");
        svv.ui.modalInfo.description = $("#modal-info-description");
        svv.ui.modalInfo.closeButton = $("#modal-info-close-button");
        svv.ui.modalInfo.infoButton = $("#info-button");

        svv.ui.modalLandscape = {};
        svv.ui.modalLandscape.holder = $("#modal-landscape-holder");
        svv.ui.modalLandscape.foreground = $("#modal-landscape-foreground");
        svv.ui.modalLandscape.background = $("#modal-landscape-background");

        svv.ui.modalMission = {};
        svv.ui.modalMission.holder = $("#modal-mission-holder");
        svv.ui.modalMission.foreground = $("#modal-mission-foreground");
        svv.ui.modalMission.background = $("#modal-mission-background");
        svv.ui.modalMission.missionTitle = $("#modal-mission-header");
        svv.ui.modalMission.rewardText = $("#modal-mission-reward-text");
        svv.ui.modalMission.instruction = $("#modal-mission-instruction");
        svv.ui.modalMission.closeButton = $("#modal-mission-close-button");

        svv.ui.modalMissionComplete = {};
        svv.ui.modalMissionComplete.agreeCount = $("#modal-mission-complete-agree-count");
        svv.ui.modalMissionComplete.background = $("#modal-mission-complete-background");
        svv.ui.modalMissionComplete.closeButtonPrimary = $("#modal-mission-complete-close-button-primary");
        svv.ui.modalMissionComplete.closeButtonSecondary = $("#modal-mission-complete-close-button-secondary");
        svv.ui.modalMissionComplete.disagreeCount = $("#modal-mission-complete-disagree-count");
        svv.ui.modalMissionComplete.foreground = $("#modal-mission-complete-foreground");
        svv.ui.modalMissionComplete.holder = $("#modal-mission-complete-holder");
        svv.ui.modalMissionComplete.message = $("#modal-mission-complete-message");
        svv.ui.modalMissionComplete.missionTitle = $("#modal-mission-complete-title");
        svv.ui.modalMissionComplete.notSureCount = $("#modal-mission-complete-not-sure-count");
        svv.ui.modalMissionComplete.yourOverallTotalCount = $("#modal-mission-complete-your-overall-total-count");

        svv.ui.status = {};
        svv.ui.status.labelCount = $("#status-neighborhood-label-count");
        svv.ui.status.missionDescription = $("#current-mission-description");
        svv.ui.status.currentMissionReward = $("#current-mission-reward");
        svv.ui.status.totalMissionReward = $("#total-mission-reward");
        svv.ui.status.progressBar = $("#status-current-mission-completion-bar");
        svv.ui.status.progressFiller = $("#status-current-mission-completion-bar-filler");
        svv.ui.status.progressText = $("#status-current-mission-completion-rate");
        svv.ui.status.upperMenuTitle = $("#upper-menu-title-bar");
        svv.ui.status.zoomInButton = $("#zoom-in-button");
        svv.ui.status.zoomOutButton = $("#zoom-out-button");
        svv.ui.status.labelVisibilityControlButton = $("#label-visibility-control-button");

        svv.ui.status.examples = {};
        svv.ui.status.examples.example1 = $("#example-image-1");
        svv.ui.status.examples.example2 = $("#example-image-2");
        svv.ui.status.examples.example3 = $("#example-image-3");
        svv.ui.status.examples.example4 = $("#example-image-4");
        svv.ui.status.examples.counterExample1 = $("#counterexample-image-1");
        svv.ui.status.examples.counterExample2 = $("#counterexample-image-2");
        svv.ui.status.examples.counterExample3 = $("#counterexample-image-3");
        svv.ui.status.examples.counterExample4 = $("#counterexample-image-4");
        svv.ui.status.examples.popup = $("#example-image-popup-holder");

        svv.ui.status.examples.popupDescription = $("#example-image-popup-description");
        svv.ui.status.examples.popupImage = $("#example-image-popup");
        svv.ui.status.examples.popupPointer = $("#example-image-popup-pointer");
        svv.ui.status.examples.popupTitle = $("#example-image-popup-title");

        svv.ui.dateHolder = $("#svv-panorama-date-holder");
    }

    function _init() {
        svv.util = {};
        svv.util.properties = {};
        svv.util.properties.panorama = new PanoProperties();

        svv.form = new Form(param.dataStoreUrl, param.beaconDataStoreUrl);

        let statusFieldParam = {
            completedValidations: param.completedValidations
        };
        svv.statusField = new StatusField(statusFieldParam);
        svv.statusExample = new StatusExample(svv.ui.status.examples);
        svv.tracker = new Tracker();
        svv.labelDescriptionBox = new LabelDescriptionBox();
        svv.labelContainer = new LabelContainer();
        svv.panoramaContainer = new PanoramaContainer(param.labelList);

        // There are certain features that will only make sense on desktop.
        if (!isMobile()) {
            svv.gsvOverlay = new GSVOverlay();
            svv.keyboard = new Keyboard(svv.ui.validation);
            svv.labelVisibilityControl = new LabelVisibilityControl();
            svv.zoomControl = new ZoomControl();
        }

        // Logs when user zoom in/out on mobile.
        if (isMobile()) {
            svv.pinchZoom = new PinchZoomDetector();
        }

        svv.menuButtons = new MenuButton(svv.ui.validation);
        svv.modalComment = new ModalComment(svv.ui.modalComment);
        svv.modalMission = new ModalMission(svv.ui.modalMission, svv.user);
        svv.modalMissionComplete = new ModalMissionComplete(svv.ui.modalMissionComplete, svv.user);
        svv.modalSkip = new ModalSkip(svv.ui.modalSkip);
        svv.modalInfo = new ModalInfo(svv.ui.modalInfo, param.modalText);
        svv.modalLandscape = new ModalLandscape(svv.ui.modalLandscape);
        svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);
        svv.infoPopover = new GSVInfoPopover(svv.ui.dateHolder, svv.panorama.getPanorama(), svv.panorama.getPosition,
            svv.panorama.getPanoId,
            function() { return svv.panoramaContainer.getCurrentLabel().getAuditProperty('streetEdgeId'); },
            function() { return svv.panoramaContainer.getCurrentLabel().getAuditProperty('regionId'); },
            svv.panorama.getPov, true, function() { svv.tracker.push('GSVInfoButton_Click'); },
            function() { svv.tracker.push('GSVInfoCopyToClipboard_Click'); },
            function() { svv.tracker.push('GSVInfoViewInGSV_Click'); },
            function() { return svv.panoramaContainer.getCurrentLabel().getAuditProperty('labelId'); }
        );

        svv.missionContainer = new MissionContainer();
        svv.missionContainer.createAMission(param.mission, param.progress);

        // Logs when the page's focus changes.
        function logPageFocus() {
            if (document.hasFocus()) {
                svv.tracker.push("PageGainedFocus");
            } else {
                svv.tracker.push("PageLostFocus");
            }
        }
        window.addEventListener("focus", function(event) {
            logPageFocus();
        });
        window.addEventListener("blur", function(event) {
            logPageFocus();
        });
        logPageFocus();

        svv.statusField.refreshLabelCountsDisplay();
        $('#sign-in-modal-container').on('hide.bs.modal', function () {
            svv.keyboard.enableKeyboard();
            $(".tool-ui").css('opacity', 1);
        });
        $('#sign-in-modal-container').on('show.bs.modal', function () {
            svv.keyboard.disableKeyboard();
            $(".tool-ui").css('opacity', 0.5);
        });

        // Validate mission tutorial descriptor.
        // See MissionTutorial.js for documentation.
        const tutorialDescriptor = {
            'CurbRamp': {
                'missionInstruction1': i18next.t('mission-tutorial.mission-instruction-1'),
                'missionInstruction2': i18next.t('mission-tutorial.curb-ramp.instruction'),
                'slides': [
                    {
                        'isExampleCorrect': true,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-correct'),
                        'exampleTypeIcon': '#smile-positive',
                        'slideTitle': i18next.t('mission-tutorial.curb-ramp.slide-1.title'),
                        'slideSubtitle': '',
                        'slideDescription': i18next.t('mission-tutorial.curb-ramp.slide-1.description'),
                        'imageURL': 'assets/images/tutorials/curbramp-correct-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-correct'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-correct'),
                            'position' : {
                                'left': '238px',
                                'top': '222px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.curb-ramp.slide-2.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.curb-ramp.slide-2.description'),
                        'imageURL': 'assets/images/tutorials/curbramp-incorrect-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '466px',
                                'top': '257px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.curb-ramp.slide-3.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.curb-ramp.slide-3.description'),
                        'imageURL': 'assets/images/tutorials/curbramp-incorrect-2.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '435px',
                                'top': '257px'
                            }
                        }
                    }
                ]
            },
            'NoCurbRamp': {
                'missionInstruction1': i18next.t('mission-tutorial.mission-instruction-1'),
                'missionInstruction2': i18next.t('mission-tutorial.no-curb-ramp.instruction'),
                'slides': [
                    {
                        'isExampleCorrect': true,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-correct'),
                        'exampleTypeIcon': '#smile-positive',
                        'slideTitle': i18next.t('mission-tutorial.no-curb-ramp.slide-1.title'),
                        'slideSubtitle': '',
                        'slideDescription': i18next.t('mission-tutorial.no-curb-ramp.slide-1.description'),
                        'imageURL': 'assets/images/tutorials/no-curbramp-correct-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-correct'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-correct'),
                            'position' : {
                                'left': '393px',
                                'top': '157px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.no-curb-ramp.slide-2.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.no-curb-ramp.slide-2.description'),
                        'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '325px',
                                'top': '250px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.no-curb-ramp.slide-3.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.no-curb-ramp.slide-3.description'),
                        'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-2.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '397px',
                                'top': '320px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.no-curb-ramp.slide-4.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.no-curb-ramp.slide-4.description'),
                        'imageURL': 'assets/images/tutorials/no-curbramp-incorrect-3.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '326px',
                                'top': '302px'
                            }
                        }
                    }
                ]
            },
            'Obstacle': {
                'missionInstruction1': i18next.t('mission-tutorial.mission-instruction-1'),
                'missionInstruction2': i18next.t('mission-tutorial.obstacle.instruction'),
                'slides': [
                    {
                        'isExampleCorrect': true,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-correct'),
                        'exampleTypeIcon': '#smile-positive',
                        'slideTitle': i18next.t('mission-tutorial.obstacle.slide-1.title'),
                        'slideSubtitle': '',
                        'slideDescription': i18next.t('mission-tutorial.obstacle.slide-1.description'),
                        'imageURL': 'assets/images/tutorials/obstacle-correct-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-correct'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-correct'),
                            'position' : {
                                'left': '269px',
                                'top': '301px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.obstacle.slide-2.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.obstacle.slide-2.description'),
                        'imageURL': 'assets/images/tutorials/obstacle-incorrect-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '397px',
                                'top': '286px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.obstacle.slide-3.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.obstacle.slide-3.description'),
                        'imageURL': 'assets/images/tutorials/obstacle-incorrect-2.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '79.5px',
                                'top': '112px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.obstacle.slide-4.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.obstacle.slide-4.description'),
                        'imageURL': 'assets/images/tutorials/obstacle-incorrect-3.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '415px',
                                'top': '187px'
                            }
                        }
                    }
                ]
            },
            'SurfaceProblem': {
                'missionInstruction1': i18next.t('mission-tutorial.mission-instruction-1'),
                'missionInstruction2': i18next.t('mission-tutorial.surface-problem.instruction'),
                'slides': [
                    {
                        'isExampleCorrect': true,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-correct'),
                        'exampleTypeIcon': '#smile-positive',
                        'slideTitle': i18next.t('mission-tutorial.surface-problem.slide-1.title'),
                        'slideSubtitle': '',
                        'slideDescription': i18next.t('mission-tutorial.surface-problem.slide-1.description'),
                        'imageURL': 'assets/images/tutorials/surface-problem-correct-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-correct'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-correct'),
                            'position' : {
                                'left': '458px',
                                'top': '203px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.surface-problem.slide-2.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.surface-problem.slide-2.description'),
                        'imageURL': 'assets/images/tutorials/surface-problem-incorrect-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '400px',
                                'top': '190px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.surface-problem.slide-3.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.surface-problem.slide-3.description'),
                        'imageURL': 'assets/images/tutorials/surface-problem-incorrect-2.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '334px',
                                'top': '221px'
                            }
                        }
                    }
                ]
            },
            'NoSideWalk': {
                'missionInstruction1': i18next.t('mission-tutorial.mission-instruction-1'),
                'missionInstruction2': i18next.t('mission-tutorial.no-sidewalk.instruction'),
                'slides': [
                    {
                        'isExampleCorrect': true,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-correct'),
                        'exampleTypeIcon': '#smile-positive',
                        'slideTitle': i18next.t('mission-tutorial.no-sidewalk.slide-1.title'),
                        'slideSubtitle': '',
                        'slideDescription': i18next.t('mission-tutorial.no-sidewalk.slide-1.description'),
                        'imageURL': 'assets/images/tutorials/no-sidewalk-correct-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-correct'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-correct'),
                            'position' : {
                                'left': '290px',
                                'top': '132px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.no-sidewalk.slide-2.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.no-sidewalk.slide-2.description'),
                        'imageURL': 'assets/images/tutorials/no-sidewalk-incorrect-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '352px',
                                'top': '312px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.no-sidewalk.slide-3.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.no-sidewalk.slide-3.description'),
                        'imageURL': 'assets/images/tutorials/no-sidewalk-incorrect-2.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '185px',
                                'top': '299px'
                            }
                        }
                    }
                ]
            },
            'Crosswalk': {
                'missionInstruction1': i18next.t('mission-tutorial.mission-instruction-1'),
                'missionInstruction2': i18next.t('mission-tutorial.crosswalk.instruction'),
                'slides': [
                    {
                        'isExampleCorrect': true,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-correct'),
                        'exampleTypeIcon': '#smile-positive',
                        'slideTitle': i18next.t('mission-tutorial.crosswalk.slide-1.title'),
                        'slideSubtitle': '',
                        'slideDescription': i18next.t('mission-tutorial.crosswalk.slide-1.description'),
                        'imageURL': 'assets/images/tutorials/crosswalk-correct-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-correct'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-correct'),
                            'position' : {
                                'left': '175px',
                                'top': '159px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.crosswalk.slide-2.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.crosswalk.slide-2.description'),
                        'imageURL': 'assets/images/tutorials/crosswalk-incorrect-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '354px',
                                'top': '241px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.crosswalk.slide-3.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.crosswalk.slide-3.description'),
                        'imageURL': 'assets/images/tutorials/crosswalk-incorrect-2.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '249px',
                                'top': '302px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.crosswalk.slide-4.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.crosswalk.slide-4.description'),
                        'imageURL': 'assets/images/tutorials/crosswalk-incorrect-3.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '271px',
                                'top': '102px'
                            }
                        }
                    }
                ]
            },
            'Signal': {
                'missionInstruction1': i18next.t('mission-tutorial.mission-instruction-1'),
                'missionInstruction2': i18next.t('mission-tutorial.signal.instruction'),
                'slides': [
                    {
                        'isExampleCorrect': true,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-correct'),
                        'exampleTypeIcon': '#smile-positive',
                        'slideTitle': i18next.t('mission-tutorial.signal.slide-1.title'),
                        'slideSubtitle': '',
                        'slideDescription': i18next.t('mission-tutorial.signal.slide-1.description'),
                        'imageURL': 'assets/images/tutorials/signal-correct-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-correct'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-correct'),
                            'position' : {
                                'left': '167px',
                                'top': '325px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.signal.slide-2.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.signal.slide-2.description'),
                        'imageURL': 'assets/images/tutorials/signal-incorrect-1.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '377px',
                                'top': '86px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.signal.slide-3.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.signal.slide-3.description'),
                        'imageURL': 'assets/images/tutorials/signal-incorrect-2.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '390px',
                                'top': '203px'
                            }
                        }
                    },
                    {
                        'isExampleCorrect': false,
                        'exampleTypeLabel': i18next.t('mission-tutorial.example-type-label-incorrect'),
                        'exampleTypeIcon': '#smile-negative',
                        'slideTitle': i18next.t('mission-tutorial.signal.slide-4.title'),
                        'slideSubtitle': i18next.t('mission-tutorial.label-type-subtitle'),
                        'slideDescription': i18next.t('mission-tutorial.signal.slide-4.description'),
                        'imageURL': 'assets/images/tutorials/signal-incorrect-3.png',
                        'onImageLabel': {
                            'title': i18next.t('mission-tutorial.on-image-label-title-incorrect'),
                            'description': i18next.t('mission-tutorial.on-image-label-description-incorrect'),
                            'position' : {
                                'left': '359px',
                                'top': '332px'
                            }
                        }
                    }
                ]
            }
        };

        const missionTutorial = new MissionTutorial(tutorialDescriptor);
    }

    // Gets all the text on the validation page for the correct language.
    i18next.use(i18nextXHRBackend);
    i18next.init({
        backend: { loadPath: '/assets/locales/{{lng}}/{{ns}}.json' },
        fallbackLng: 'en',
        ns: ['validate', 'common'],
        defaultNS: 'validate',
        lng: param.language,
        debug: false
    }, function(err, t) {
        if(param.init !== "noInit") {
            _initUI();

            if (param.hasNextMission) {
                _init();
            } else {
                svv.keyboard = new Keyboard(svv.ui.validation);
                svv.form = new Form(param.dataStoreUrl);
                svv.tracker = new Tracker();
                svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);
                svv.modalNoNewMission.show();
            }
        }
    });
}
