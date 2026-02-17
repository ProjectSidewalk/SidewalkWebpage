/** @namespace */
var svv = svv || {};

/**
 * Main module for Validate / Expert Validate/ and Mobile Validate.
 *
 * @param {object} param Object passed from validation.scala.html containing data from the back end.
 * @constructor
 */
function Main (param) {
    svv.adminVersion = param.validateParams.adminVersion;
    svv.validateParams = param.validateParams;
    svv.viewerType = param.viewerType;
    svv.missionLength = param.mission?.labels_validated ?? 0;
    svv.cityId = param.cityId;
    svv.cityName = param.cityName;
    svv.missionsCompleted = 0;

    function _initUI() {
        svv.tagsByLabelType = {
            'CurbRamp': param.tagList.filter(t => t.label_type_id === 1),
            'NoCurbRamp': param.tagList.filter(t => t.label_type_id === 2),
            'Obstacle': param.tagList.filter(t => t.label_type_id === 3),
            'SurfaceProblem': param.tagList.filter(t => t.label_type_id === 4),
            'NoSidewalk': param.tagList.filter(t => t.label_type_id === 7),
            'Crosswalk': param.tagList.filter(t => t.label_type_id === 9),
            'Signal': param.tagList.filter(t => t.label_type_id === 10)
        }
        svv.ui = {};

        svv.ui.validationMenu = {};
        svv.ui.validationMenu.header = $('#main-validate-header');

        svv.ui.validationMenu.yesButton = $('#validate-yes-button');
        svv.ui.validationMenu.noButton = $('#validate-no-button');
        svv.ui.validationMenu.unsureButton = $('#validate-unsure-button');

        svv.ui.validationMenu.tagsMenu = $('#validate-tags-section');
        svv.ui.validationMenu.severityMenu = $('#validate-severity-section');
        svv.ui.validationMenu.optionalCommentSection = $('#validate-optional-comment-section');
        svv.ui.validationMenu.optionalCommentTextBox = $('#add-optional-comment');
        svv.ui.validationMenu.noMenu = $('#validate-why-no-section');
        svv.ui.validationMenu.disagreeReasonOptions = $('#no-reason-options');
        svv.ui.validationMenu.disagreeReasonTextBox = $('#add-disagree-comment')
        svv.ui.validationMenu.unsureMenu = $('#validate-why-unsure-section');
        svv.ui.validationMenu.unsureReasonOptions = $('#unsure-reason-options');
        svv.ui.validationMenu.unsureReasonTextBox = $('#add-unsure-comment');
        svv.ui.validationMenu.submitButton = $('#validate-submit-button');
        svv.ui.validationMenu.mobilePopupNotch = $('#mobile-popup-notch');

        svv.ui.validationMenu.currentTags = $('#current-tags-list');
        svv.ui.validationMenu.aiSuggestionSection = $('#sidewalk-ai-suggestions-block');
        svv.ui.validationMenu.aiSuggestedTagTemplate = $('.sidewalk-ai-suggested-tag.template');

        svv.ui.modal = {};
        svv.ui.modal.background = $('#modal-comment-background');

        svv.ui.skipValidation = {};
        svv.ui.skipValidation.skipButton = $('#left-column-skip-button');

        svv.ui.undoValidation = {};
        svv.ui.undoValidation.undoButton = $('#validate-back-button');

        svv.ui.modalLandscape = {};
        svv.ui.modalLandscape.holder = $('#modal-landscape-holder');
        svv.ui.modalLandscape.foreground = $('#modal-landscape-foreground');
        svv.ui.modalLandscape.background = $('#modal-landscape-background');

        svv.ui.modalMission = {};
        svv.ui.modalMission.holder = $('#modal-mission-holder');
        svv.ui.modalMission.foreground = $('#modal-mission-foreground');
        svv.ui.modalMission.background = $('#modal-mission-background');
        svv.ui.modalMission.missionTitle = $('#modal-mission-header');
        svv.ui.modalMission.instruction = $('#modal-mission-instruction');
        svv.ui.modalMission.closeButton = $('#modal-mission-close-button');

        svv.ui.modalMissionComplete = {};
        svv.ui.modalMissionComplete.agreeCount = $('#modal-mission-complete-agree-count');
        svv.ui.modalMissionComplete.background = $('#modal-mission-complete-background');
        svv.ui.modalMissionComplete.closeButtonPrimary = $('#modal-mission-complete-close-button-primary');
        svv.ui.modalMissionComplete.closeButtonSecondary = $('#modal-mission-complete-close-button-secondary');
        svv.ui.modalMissionComplete.disagreeCount = $('#modal-mission-complete-disagree-count');
        svv.ui.modalMissionComplete.foreground = $('#modal-mission-complete-foreground');
        svv.ui.modalMissionComplete.holder = $('#modal-mission-complete-holder');
        svv.ui.modalMissionComplete.message = $('#modal-mission-complete-message');
        svv.ui.modalMissionComplete.missionTitle = $('#modal-mission-complete-title');
        svv.ui.modalMissionComplete.unsureCount = $('#modal-mission-complete-unsure-count');
        svv.ui.modalMissionComplete.yourOverallTotalCount = $('#modal-mission-complete-your-overall-total-count');

        svv.ui.status = {};
        svv.ui.status.labelCount = $('#status-neighborhood-label-count');

        svv.ui.status.progressFiller = $('#mission-progress-bar-complete');
        svv.ui.status.progressText = $('#mission-progress-bar-text');
        svv.ui.status.upperMenuTitle = $('#mission-title');
        svv.ui.status.zoomInButton = $('#zoom-in-button');
        svv.ui.status.zoomOutButton = $('#zoom-out-button');
        svv.ui.status.labelVisibilityControlButton = $('#label-visibility-control-button');

        svv.ui.status.admin = {
            holder: $('#admin-info-section'),
            button: $('#admin-info-button'),
            template: $('#admin-info-template')
        };

        svv.ui.viewer = {};
        svv.ui.viewer.dateHolder = $('#svv-panorama-date-holder');
        svv.ui.viewer.date = $('#svv-panorama-date');
    }

    async function _init() {
        svv.canvasWidth = () => isMobile() ? window.innerWidth : 720;
        svv.canvasHeight = () => isMobile() ? window.innerHeight : 440;
        svv.labelRadius = isMobile() ? 25 : 10;

        const labelType = svv.labelTypes[param.mission.label_type_id];

        svv.validationMenu = isMobile() ? new MobileValidationMenu(svv.ui.validationMenu) : new DesktopValidationMenu(svv.ui.validationMenu);

        svv.form = new Form(param.dataStoreUrl, param.beaconDataStoreUrl);

        if (svv.adminVersion) svv.adminInfo = new AdminInfo(svv.ui.status.admin);

        svv.statusField = new StatusField(param.completedValidations);
        svv.tracker = new Tracker();
        svv.labelDescriptionBox = new LabelDescriptionBox();

        svv.panoStore = new PanoStore();
        svv.panoManager = await PanoManager.create(svv.viewerType, param.viewerAccessToken, param.labelList[0].pano_id);
        svv.labelContainer = await LabelContainer(param.labelList);

        // There are certain features that will only make sense on desktop vs mobile.
        if (isMobile()) {
            svv.pinchZoom = new PinchZoomDetector();
        } else {
            svv.panoOverlay = new PanoOverlay();
            svv.keyboard = new Keyboard(svv.ui.validationMenu);
            svv.speedLimit = new SpeedLimit(svv.panoViewer, svv.panoViewer.getPosition, () => false, svv.labelContainer, labelType);
            svv.zoomControl = new ZoomControl();
            const missionStartTutorial = new MissionStartTutorial('validate', labelType, {nLabels: param.mission.labels_validated}, svv, param.language);
        }

        // Now that mission start tutorial has loaded, can unhide the UI under it and remove the loading icon.
        $('#page-loading').css({ 'visibility': 'hidden' });
        $('.tool-ui').css({ 'visibility': 'visible' });

        svv.labelVisibilityControl = new LabelVisibilityControl();

        svv.undoValidation = new UndoValidation(svv.ui.undoValidation);

        svv.modalMission = new ModalMission(svv.ui.modalMission, svv.user);
        svv.missionContainer = new MissionContainer();
        svv.missionContainer.createAMission(param.mission, param.progress);

        svv.infoPopover = new PanoInfoPopover(
            svv.ui.viewer.dateHolder, svv.panoViewer, svv.panoViewer.getPosition, svv.panoViewer.getPanoId,
            function() { return svv.labelContainer.getCurrentLabel().getAuditProperty('streetEdgeId'); },
            function() { return svv.labelContainer.getCurrentLabel().getAuditProperty('regionId'); },
            function() { return svv.panoStore.getPanoData(svv.panoViewer.getPanoId()).getProperty('captureDate'); },
            function() { return svv.panoStore.getPanoData(svv.panoViewer.getPanoId()).getProperty('address'); },
            svv.panoViewer.getPov, svv.cityName, true, function() { svv.tracker.push('PanoInfoButton_Click'); },
            function() { svv.tracker.push('PanoInfoCopyToClipboard_Click'); },
            function() { svv.tracker.push('PanoInfoViewInPano_Click'); },
            function() { return svv.labelContainer.getCurrentLabel().getAuditProperty('labelId'); },
            function() { return svv.labelContainer.getCurrentLabel().getAuditProperty('labelTimestamp'); }
        );

        svv.modalMissionComplete = new ModalMissionComplete(svv.ui.modalMissionComplete, svv.user);
        svv.skipValidation = new SkipValidation(svv.ui.skipValidation);
        svv.modalLandscape = new ModalLandscape(svv.ui.modalLandscape);
        svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);

        // Logs when the page's focus changes.
        function logPageFocus() {
            if (document.hasFocus()) {
                svv.tracker.push('PageGainedFocus');
            } else {
                svv.tracker.push('PageLostFocus');
            }
        }
        window.addEventListener('focus', function(event) {
            logPageFocus();
        });
        window.addEventListener('blur', function(event) {
            logPageFocus();
        });
        logPageFocus();

        $('#sign-in-modal-container').on('hide.bs.modal', function () {
            svv.keyboard.enableKeyboard();
            $('.tool-ui').css('opacity', 1);
        });
        $('#sign-in-modal-container').on('show.bs.modal', function () {
            svv.keyboard.disableKeyboard();
            $('.tool-ui').css('opacity', 0.5);
        });

        // Initialize bootstrap tooltips (except on touch devices).
        if (window.matchMedia('(hover: hover)').matches) {
            $('[data-toggle="tooltip"]').tooltip({
                delay: { 'show': 500, 'hide': 100 },
                html: true,
                container: 'body'
            });
        }

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
        if (!isMobile()) svv.keyboard = new Keyboard(svv.ui.validationMenu);
        svv.form = new Form(param.dataStoreUrl);
        svv.tracker = new Tracker();
        svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);
        svv.modalNoNewMission.show();
    }
}
