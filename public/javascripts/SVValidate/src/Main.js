/** @namespace */
var svv = svv || {};

/**
 * Main module for SVValidate (Validation interface)
 * @param param    Object passed from validation.scala.html containing initial values pulled from
 *                  the database on page load. (Currently, mission and labels)
 * @constructor
 */
function Main (param) {
    svv.expertValidate = param.expertValidate;
    svv.adminVersion = param.validateParams.adminVersion;
    svv.validateParams = param.validateParams;
    svv.missionLength = param.mission?.labels_validated ?? 0;
    svv.canvasHeight = param.canvasHeight;
    svv.canvasWidth = param.canvasWidth;
    svv.cityId = param.cityId;
    svv.cityName = param.cityName;
    svv.missionsCompleted = 0;

    function _initUI() {
        if (svv.expertValidate) {
            svv.tagsByLabelType = {
                'CurbRamp': param.tagList.filter(t => t.label_type_id === 1),
                'NoCurbRamp': param.tagList.filter(t => t.label_type_id === 2),
                'Obstacle': param.tagList.filter(t => t.label_type_id === 3),
                'SurfaceProblem': param.tagList.filter(t => t.label_type_id === 4),
                'NoSidewalk': param.tagList.filter(t => t.label_type_id === 7),
                'Crosswalk': param.tagList.filter(t => t.label_type_id === 9),
                'Signal': param.tagList.filter(t => t.label_type_id === 10)
            }
        }
        svv.ui = {};

        svv.ui.validation = {};
        svv.ui.validation.yesButton = $("#validation-yes-button");
        svv.ui.validation.noButton = $("#validation-no-button");
        svv.ui.validation.unsureButton = $("#validation-unsure-button");
        svv.ui.validation.buttons = $('button.validation-button');
        svv.ui.validation.comment = $("#validation-label-comment");

        if (svv.expertValidate) {
            svv.ui.expertValidate = {};
            svv.ui.expertValidate.header = $("#main-validate-header");

            svv.ui.expertValidate.yesButton = $("#new-validate-beta-yes-button");
            svv.ui.expertValidate.noButton = $("#new-validate-beta-no-button");
            svv.ui.expertValidate.unsureButton = $("#new-validate-beta-unsure-button");

            svv.ui.expertValidate.tagsMenu = $("#validate-tags-section");
            svv.ui.expertValidate.severityMenu = $("#validate-severity-section");
            svv.ui.expertValidate.optionalCommentSection = $("#validate-optional-comment-section");
            svv.ui.expertValidate.optionalCommentTextBox = $("#add-optional-comment");
            svv.ui.expertValidate.noMenu = $("#validate-why-no-section");
            svv.ui.expertValidate.disagreeReasonOptions = $("#no-reason-options");
            svv.ui.expertValidate.disagreeReasonTextBox = $("#add-disagree-comment")
            svv.ui.expertValidate.unsureMenu = $("#validate-why-unsure-section");
            svv.ui.expertValidate.unsureReasonOptions = $("#unsure-reason-options");
            svv.ui.expertValidate.unsureReasonTextBox = $("#add-unsure-comment");

            svv.ui.expertValidate.currentTags = $('#current-tags-list')

            svv.ui.expertValidate.backButton = $("#new-validate-beta-back-button");
            svv.ui.expertValidate.submitButton = $("#new-validate-beta-submit-button");
        }

        svv.ui.modal = {};
        svv.ui.modal.background = $("#modal-comment-background");

        svv.ui.skipValidation = {};
        svv.ui.skipValidation.skipButton = $("#left-column-jump-button");

        svv.ui.undoValidation = {};
        svv.ui.undoValidation.undoButton = svv.expertValidate ? $("#new-validate-beta-back-button") : $("#left-column-undo-button");

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
        svv.ui.modalMissionComplete.unsureCount = $("#modal-mission-complete-unsure-count");
        svv.ui.modalMissionComplete.yourOverallTotalCount = $("#modal-mission-complete-your-overall-total-count");

        svv.ui.status = {};
        svv.ui.status.labelCount = $("#status-neighborhood-label-count");
        svv.ui.status.missionDescription = $("#current-mission-description");
        svv.ui.status.progressBar = $("#status-current-mission-completion-bar");
        svv.ui.status.progressFiller = $("#status-current-mission-completion-bar-filler");
        svv.ui.status.progressText = $("#status-current-mission-completion-rate");
        svv.ui.status.upperMenuTitle = $("#mission-title");
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

        svv.ui.status.admin = {};
        svv.ui.status.admin.username = $('#curr-label-username');
        svv.ui.status.admin.labelId = $('#curr-label-id');
        svv.ui.status.admin.prevValidations = $('#curr-label-prev-validations');

        svv.ui.dateHolder = $("#svv-panorama-date-holder");
    }

    function _init() {
        svv.util = {};
        svv.util.properties = {};

        const labelType = param.labelList[0].getAuditProperty('labelType');

        if (svv.expertValidate) svv.rightMenu = new RightMenu(svv.ui.expertValidate);
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
            if (svv.expertValidate) {
                svv.keyboard = new Keyboard(svv.ui.expertValidate);
            } else {
                svv.keyboard = new Keyboard(svv.ui.validation);
            }
            svv.labelVisibilityControl = new LabelVisibilityControl();
            svv.speedLimit = new SpeedLimit(svv.panorama.getPanorama(), svv.panorama.getPosition, () => false, svv.panoramaContainer, labelType);
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
        svv.skipValidation = new SkipValidation(svv.ui.skipValidation);
        svv.undoValidation = new UndoValidation(svv.ui.undoValidation);
        svv.modalInfo = new ModalInfo(svv.ui.modalInfo, param.modalText);
        svv.modalLandscape = new ModalLandscape(svv.ui.modalLandscape);
        svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);
        svv.infoPopover = new GSVInfoPopover(svv.ui.dateHolder, svv.panorama.getPanorama(), svv.panorama.getPosition,
            svv.panorama.getPanoId,
            function() { return svv.panoramaContainer.getCurrentLabel().getAuditProperty('streetEdgeId'); },
            function() { return svv.panoramaContainer.getCurrentLabel().getAuditProperty('regionId'); },
            svv.panorama.getPov, svv.cityName, true, function() { svv.tracker.push('GSVInfoButton_Click'); },
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
        $('[data-toggle="tooltip"]').tooltip({
            delay: { "show": 500, "hide": 100 },
            html: true
        });

        const missionStartTutorial = new MissionStartTutorial('validate', labelType, { nLabels: param.mission.labels_validated }, svv, param.language);

        // Use CSS zoom to scale the UI for users with high resolution screens.
        // Has only been tested on Chrome and Safari. Firefox doesn't support CSS zoom.
        if (!isMobile() && bowser.safari) {
            svv.cssZoom = util.scaleUI();
            window.addEventListener('resize', (e) => { svv.cssZoom = util.scaleUI(); });
        }
    }

    // Finally, do the actual initialization of the UI and other components.
    defineValidateConstants();
    _initUI();

    if (param.hasNextMission) {
        _init();
    } else {
        if (svv.expertValidate) {
            svv.keyboard = new Keyboard(svv.ui.expertValidate);
        } else {
            svv.keyboard = new Keyboard(svv.ui.validation);
        }
        svv.form = new Form(param.dataStoreUrl);
        svv.tracker = new Tracker();
        svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);
        svv.modalNoNewMission.show();
    }
}
