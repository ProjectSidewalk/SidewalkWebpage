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

    svv.missionsCompleted = 0;

    // Maps label types to label names
    svv.labelNames = {
        CurbRamp: "Curb Ramp",
        NoCurbRamp: "Missing Curb Ramp",
        Obstacle: "Obstacle in Path",
        SurfaceProblem: "Surface Problem",
        NoSidewalk: "No Sidewalk",
        Occlusion: "Occlusion"
    };

    svv.labelTypeNames = {
        1: "Curb Ramp",
        2: "Missing Curb Ramp",
        3: "Obstacle in Path",
        4: "Surface Problem",
        7: "No Sidewalk"
    };

    function _initUI() {
        svv.ui = {};

        svv.ui.validation = {};
        svv.ui.validation.agreeButton = $("#validation-agree-button");
        svv.ui.validation.buttons = $('button.validation-button');
        svv.ui.validation.disagreeButton = $("#validation-disagree-button");
        svv.ui.validation.notSureButton = $("#validation-not-sure-button");

        svv.ui.modal = {};
        svv.ui.modal.background = $("#modal-comment-background");

        svv.ui.modalConfirmation = {};
        svv.ui.modalConfirmation.confirmationCode = $("#left-column-confirmation-code-button");

        svv.ui.modalSkip = {};
        svv.ui.modalSkip.skipButton = $("#left-column-jump-button");

        svv.ui.modalComment = {};
        svv.ui.modalComment.box = $("#modal-comment-box");
        svv.ui.modalComment.feedbackButton = $("#left-column-feedback-button");
        svv.ui.modalComment.holder = $("#modal-comment-holder");
        svv.ui.modalComment.ok = $("#modal-comment-ok-button");
        svv.ui.modalComment.cancel = $("#modal-comment-cancel-button");
        svv.ui.modalComment.textarea = $("#modal-comment-textarea");

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
        svv.ui.modalMissionComplete.closeButton = $("#modal-mission-complete-close-button");
        svv.ui.modalMissionComplete.disagreeCount = $("#modal-mission-complete-disagree-count");
        svv.ui.modalMissionComplete.foreground = $("#modal-mission-complete-foreground");
        svv.ui.modalMissionComplete.holder = $("#modal-mission-complete-holder");
        svv.ui.modalMissionComplete.message = $("#modal-mission-complete-message");
        svv.ui.modalMissionComplete.missionTitle = $("#modal-mission-complete-title");
        svv.ui.modalMissionComplete.notSureCount = $("#modal-mission-complete-not-sure-count");

        svv.ui.status = {};
        svv.ui.status.labelCount = $("#status-neighborhood-label-count");
        svv.ui.status.labelTypeCounterexample = $("#label-type-counterexample");
        svv.ui.status.labelTypeExample = $("#label-type-example");
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
    }

    function _init() {
        svv.util = {};
        svv.util.properties = {};
        svv.util.properties.panorama = new PanoProperties();

        svv.form = new Form(param.dataStoreUrl, param.beaconDataStoreUrl);
        svv.statusField = new StatusField();
        svv.statusExample = new StatusExample(svv.ui.status.examples);
        svv.statusPopupDescriptions = new StatusPopupDescriptions();
        svv.tracker = new Tracker();

        svv.validationContainer = new ValidationContainer(param.canvasCount, param.labelList);

        // There are certain features that will only make sense if we have one validation interface on the screen.
        if (param.canvasCount === 1) {
            svv.keyboard = new Keyboard(svv.ui.validation);
            svv.labelVisibilityControl = new LabelVisibilityControl();
            svv.zoomControl = new ZoomControl();
        }

        svv.modalComment = new ModalComment(svv.ui.modalComment);
        svv.modalMission = new ModalMission(svv.ui.modalMission, svv.user);
        // TODO this code was removed for issue #1693, search for "#1693" and uncomment all later.
        // svv.modalMissionComplete = new ModalMissionComplete(svv.ui.modalMissionComplete, svv.user, svv.ui.modalConfirmation.confirmationCode);
        svv.modalMissionComplete = new ModalMissionComplete(svv.ui.modalMissionComplete, svv.user, null);
        svv.modalSkip = new ModalSkip(svv.ui.modalSkip);
        svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);

        svv.missionContainer = new MissionContainer();
        svv.missionContainer.createAMission(param.mission, param.progress);

        $('#sign-in-modal-container').on('hide.bs.modal', function () {
            svv.keyboard.enableKeyboard();
            $(".toolUI").css('opacity', 1);
        });
        $('#sign-in-modal-container').on('show.bs.modal', function () {
            svv.keyboard.disableKeyboard();
            $(".toolUI").css('opacity', 0.5);
        });
    }

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
