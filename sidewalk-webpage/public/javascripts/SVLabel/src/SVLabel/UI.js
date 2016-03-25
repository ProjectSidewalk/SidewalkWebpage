var svl = svl || {};

/**
 * Todo. Move what's in the UI to Main.
 */
function UI ($, params) {
    var self = {moduleName: 'MainUI'};
    self.streetViewPane = {};
    params = params || {};


    function _init (params) {
        // Todo. Use better templating techniques rather so it's prettier!

        self.actionStack = {};
        self.actionStack.holder = $("#action-stack-control-holder");
        self.actionStack.holder.append('<button id="undo-button" class="button action-stack-button" value="Undo"><img src="' + svl.rootDirectory + 'img/icons/Icon_Undo.png" class="action-stack-icons" alt="Undo" /><br /><small>Undo</small></button>');
        self.actionStack.holder.append('<button id="redo-button" class="button action-stack-button" value="Redo"><img src="' + svl.rootDirectory + 'img/icons/Icon_Redo.png" class="action-stack-icons" alt="Redo" /><br /><small>Redo</small></button>');
        self.actionStack.redo = $("#redo-button");
        self.actionStack.undo = $("#undo-button");

      // LabeledLandmarkFeedback DOMs
//      $labelCountCurbRamp = $("#LabeledLandmarkCount_CurbRamp");
//      $labelCountNoCurbRamp = $("#LabeledLandmarkCount_NoCurbRamp");
//      $submittedLabelMessage = $("#LabeledLandmarks_SubmittedLabelCount");

//      self.labeledLandmark = {};
//      self.labeledLandmark.curbRamp = $labelCountCurbRamp;
//      self.labeledLandmark.noCurbRamp = $labelCountNoCurbRamp;
//      self.labeledLandmark.submitted = $submittedLabelMessage;
        self.counterHolder = $("#counter-holder");
        self.labelCounter = $("#label-counter");

        // Map DOMs
        self.map = {};
        self.map.canvas = $("canvas#labelCanvas");
        self.map.drawingLayer = $("div#labelDrawingLayer");
        self.map.pano = $("div#pano");
        self.map.streetViewHolder = $("div#streetViewHolder");
        self.map.viewControlLayer = $("div#viewControlLayer");
        self.map.modeSwitchWalk = $("span#modeSwitchWalk");
        self.map.modeSwitchDraw = $("span#modeSwitchDraw");
        self.googleMaps = {};
        self.googleMaps.holder = $("#google-maps-holder");
        self.googleMaps.holder.append('<div id="google-maps" class="google-maps-pane" style=""></div><div id="google-maps-overlay" class="google-maps-pane" style="z-index: 1"></div>')

        // MissionDescription DOMs
        self.statusMessage = {};
        self.statusMessage.holder = $("#current-status-holder");
        self.statusMessage.title = $("#current-status-title");
        self.statusMessage.description = $("#current-status-description");

        // OverlayMessage
        self.overlayMessage = {};
        self.overlayMessage.holder = $("#overlay-message-holder");
        self.overlayMessage.holder.append("<span id='overlay-message-box'><span id='overlay-message'>Walk</span></span>");
        self.overlayMessage.box = $("#overlay-message-box");
        self.overlayMessage.message = $("#overlay-message");

        // Pop up message
        self.popUpMessage = {};
        self.popUpMessage.holder = $("#pop-up-message-holder");
        self.popUpMessage.box = $("#pop-up-message-box");
        self.popUpMessage.background = $("#pop-up-message-background");
        self.popUpMessage.title = $("#pop-up-message-title");
        self.popUpMessage.content = $("#pop-up-message-content");

        // Progress
        self.progress = {};
        self.progress.auditedDistance = $("#status-audited-distance");

        // ProgressPov
        self.progressPov = {};
        self.progressPov.holder = $("#progress-pov-holder");
        //self.progressPov.holder.append("<div id='progress-pov-label' class='bold'>Task completion rate:</div>");
        //self.progressPov.holder.append("<div id='progress-pov-current-completion-bar'></div>");
        //self.progressPov.holder.append("<div id='progress-pov-current-completion-bar-filler'></div>");
        //self.progressPov.holder.append("<div id='progress-pov-current-completion-rate'></div>");
        self.progressPov.rate = $("#progress-pov-current-completion-rate");
        self.progressPov.bar = $("#progress-pov-current-completion-bar");
        self.progressPov.filler = $("#progress-pov-current-completion-bar-filler");

        // Ribbon menu DOMs
        self.ribbonMenu = {};
        self.ribbonMenu.holder = $("#ribbon-menu-landmark-button-holder");
        self.ribbonMenu.streetViewHolder = $("#street-view-holder");
        self.ribbonMenu.buttons = $('span.modeSwitch');
        self.ribbonMenu.bottonBottomBorders = $(".ribbon-menu-mode-switch-horizontal-line");
        self.ribbonMenu.connector = $("#ribbon-street-view-connector");
        self.ribbonMenu.subcategoryHolder = $("#ribbon-menu-other-subcategory-holder");
        self.ribbonMenu.subcategories = $(".ribbon-menu-other-subcategories");

        // Context menu
        self.contextMenu = {};
        self.contextMenu.holder = $("#context-menu-holder");
        self.contextMenu.connector = $("#context-menu-vertical-connector");
        self.contextMenu.radioButtons = $("input[name='problem-severity']");
        self.contextMenu.temporaryProblemCheckbox = $("#context-menu-temporary-problem-checkbox");
        self.contextMenu.textBox = $("#context-menu-problem-description-text-box");
        self.contextMenu.closeButton = $("#context-menu-close-button");

        // Modal
        self.modalSkip = {};
        self.modalSkip.holder = $("#modal-skip-holder");
        self.modalSkip.ok = $("#modal-skip-ok-button");
        self.modalSkip.cancel = $("#modal-skip-cancel-button");
        self.modalSkip.radioButtons = $(".modal-skip-radio-buttons");
        self.modalComment = {};
        self.modalComment.holder = $("#modal-comment-holder");
        self.modalComment.ok = $("#modal-comment-ok-button");
        self.modalComment.cancel = $("#modal-comment-cancel-button");
        self.modalComment.textarea = $("#modal-comment-textarea");

        // Mission
        self.modalMission = {};
        self.modalMission.holder = $("#modal-mission-holder");
        self.modalMission.box = $("#modal-mission-box");

        // Zoom control
        self.zoomControl = {};
        self.zoomControl.holder = $("#zoom-control-holder");
        self.zoomControl.holder.append('<button id="zoom-in-button" class="button zoom-control-button"><img src="' + svl.rootDirectory + 'img/icons/ZoomIn.svg" class="zoom-button-icon" alt="Zoom in"><br /><u>Z</u>oom In</button>');
        self.zoomControl.holder.append('<button id="zoom-out-button" class="button zoom-control-button"><img src="' + svl.rootDirectory + 'img/icons/ZoomOut.svg" class="zoom-button-icon" alt="Zoom out"><br />Zoom Out</button>');
        self.zoomControl.zoomIn = $("#zoom-in-button");
        self.zoomControl.zoomOut = $("#zoom-out-button");

        // Form
        self.form = {};
        self.form.holder = $("#form-holder");
        self.form.commentField = $("#comment-field");
        self.form.skipButton = $("#skip-button");
        self.form.submitButton = $("#submit-button");

        self.leftColumn = {};
        self.leftColumn.sound = $("#left-column-sound-button");
        self.leftColumn.muteIcon = $("#left-column-mute-icon");
        self.leftColumn.soundIcon = $("#left-column-sound-icon");
        self.leftColumn.jump = $("#left-column-jump-button");
        self.leftColumn.feedback = $("#left-column-feedback-button");

        self.compass = {};
        self.compass.messageHolder = $("#compass-message-holder");
        self.compass.message = $("#compass-message");

        self.canvas = {};
        self.canvas.drawingLayer = $("#labelDrawingLayer");
        self.canvas.deleteIconHolder = $("#delete-icon-holder");
        self.canvas.deleteIcon = $("#LabelDeleteIcon");

        self.tracker = {};
        self.tracker.itemHolder = $("#tracked-items-holder");


        self.task = {};
        self.task.taskCompletionMessage = $("#task-completion-message-holder");

        self.onboarding = {};
        self.onboarding.holder = $("#onboarding-holder");
        self.onboarding.messageHolder = $("#onboarding-message-holder");
        self.onboarding.background = $("#onboarding-background");
        self.onboarding.canvas = $("#onboarding-canvas");
        if ("onboarding" in params && params.onboarding) {
          self.onboarding.holder.append("<div id='Holder_OnboardingCanvas'><canvas id='onboardingCanvas' width='720px' height='480px'></canvas><div id='Holder_OnboardingMessageBox'><div id='Holder_OnboardingMessage'></div></div></div>");
        }
    }

    _init(params);
    return self;
}
