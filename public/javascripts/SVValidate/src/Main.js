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

        const missionTutorial = new MissionTutorial();
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
