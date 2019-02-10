/** @namespace */
var svv = svv || {};

/**
 * Main module for SVValidate (Validation interface)
 * @param params    Object passed from validation.scala.html containing initial values pulled from
 *                  the database on page load. (Currently, mission and labels)
 * @constructor
 */
function Main (param) {
    svv.canvasHeight = 440;
    svv.canvasWidth = 720;

    // Maps label types to label names
    svv.labelNames = {
        CurbRamp: "Curb Ramp",
        NoCurbRamp: "Missing Curb Ramp",
        Obstacle: "Obstacle in Path",
        SurfaceProblem: "Surface Problem",
        NoSidewalk: "Missing Sidewalk",
        Occlusion: "Occlusion"
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

        svv.ui.modalSkip = {};
        svv.ui.modalSkip.skipButton = $("#left-column-jump-button");

        svv.ui.modalComment = {};
        svv.ui.modalComment.box = $("#modal-comment-box");
        svv.ui.modalComment.feedbackButton = $("#left-column-feedback-button");
        svv.ui.modalComment.holder = $("#modal-comment-holder");
        svv.ui.modalComment.ok = $("#modal-comment-ok-button");
        svv.ui.modalComment.cancel = $("#modal-comment-cancel-button");
        svv.ui.modalComment.textarea = $("#modal-comment-textarea");

        svv.ui.status = {};
        svv.ui.status.labelCount = $("#status-neighborhood-label-count");
        svv.ui.status.labelTypeCounterexample = $("#label-type-counterexample");
        svv.ui.status.labelTypeExample = $("#label-type-example");
        svv.ui.status.missionDescription = $("#current-mission-description");
        svv.ui.status.progressBar = $("#status-current-mission-completion-bar");
        svv.ui.status.progressFiller = $("#status-current-mission-completion-bar-filler");
        svv.ui.status.progressText = $("#status-current-mission-completion-rate");
        svv.ui.status.upperMenuTitle = $("#upper-menu-title-bar");

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

        svv.form = new Form(param.dataStoreUrl);
        svv.statusField = new StatusField();
        svv.statusExample = new StatusExample(svv.ui.status.examples);
        svv.statusPopupDescriptions = new StatusPopupDescriptions();
        svv.tracker = new Tracker();

        svv.keyboard = new Keyboard(svv.ui.validation);
        svv.labelContainer = new LabelContainer();
        svv.panoramaContainer = new PanoramaContainer(param.labelList);
        svv.zoomControl = new ZoomControl();

        svv.menuButtons = new MenuButton(svv.ui.validation);
        svv.modalComment = new ModalComment(svv.ui.modalComment);
        svv.modalSkip = new ModalSkip(svv.ui.modalSkip);

        // mission stuff
        svv.missionContainer = new MissionContainer();
        svv.missionContainer.createAMission(param.mission);
    }

    console.log("Has next mission? " + param.hasNextMission);
    if (param.hasNextMission) {
        console.log("Calling init methods");
        _initUI();
        _init();
    } else {
        console.log("Sorry! Nothing here to see :)")
    }

    return this;
}
