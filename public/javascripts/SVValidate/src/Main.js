/** @namespace */
var svv = svv || {};

/**
 * Main module for SVValidate (Validation interface)
 * @param params    Object passed from validation.scala.html containing initial values pulled from
 *                  the database on page load. (Currently, mission and labels)
 * @constructor
 */
function Main (param) {
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
    }

    function _init() {
        svv.util = {};
        svv.util.properties = {};
        svv.util.properties.panorama = new PanoProperties();

        svv.form = new Form(param.dataStoreUrl);
        svv.statusField = new StatusField(param.mission);
        svv.tracker = new Tracker();

        svv.keyboard = new Keyboard(svv.ui.validation);
        svv.labelContainer = new LabelContainer();
        svv.panorama = new Panorama(param.labelList);
        svv.zoomControl = new ZoomControl();

        svv.menuButtons = new MenuButton(svv.ui.validation);
        svv.modalComment = new ModalComment(svv.ui.modalComment);
        svv.modalSkip = new ModalSkip(svv.ui.modalSkip);

        // mission stuff
        svv.missionContainer = new MissionContainer();
        svv.missionContainer.trigger("MissionContainer:createAMission", param.mission);
    }

    _initUI();
    _init();
    return this;
}