/** @namespace */
window.svv = window.svv || {};

/**
 * Main module for Validate / Expert Validate / and Mobile Validate.
 */
class Main {
  #param;

  /**
   * @param {object} param Object passed from validation.scala.html containing data from the back end.
   */
  constructor(param) {
    this.#param = param;

    svv.adminVersion = param.validateParams.adminVersion;
    svv.validateParams = param.validateParams;
    svv.viewerType = param.viewerType;
    svv.missionLength = param.mission?.labels_validated ?? 0;
    svv.missionsCompleted = 0;

    // Finally, do the actual initialization of the UI and other components.
    defineValidateConstants();
    this.#initUI();

    if (param.hasNextMission) {
      this.#init();
    } else {
      if (!util.isMobile()) svv.keyboard = new KeyboardManager(svv.ui.validationMenu);
      svv.form = new Form(param.dataStoreUrl);
      svv.tracker = new Tracker();
      svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);
      svv.modalNoNewMission.show();
    }
  }

  /**
   * Collects the tool's DOM elements into the `svv.ui` tree that the other modules read.
   */
  #initUI() {
    svv.tagsByLabelType = {
      CurbRamp: this.#param.tagList.filter((t) => t.label_type_id === 1),
      NoCurbRamp: this.#param.tagList.filter((t) => t.label_type_id === 2),
      Obstacle: this.#param.tagList.filter((t) => t.label_type_id === 3),
      SurfaceProblem: this.#param.tagList.filter((t) => t.label_type_id === 4),
      NoSidewalk: this.#param.tagList.filter((t) => t.label_type_id === 7),
      Crosswalk: this.#param.tagList.filter((t) => t.label_type_id === 9),
      Signal: this.#param.tagList.filter((t) => t.label_type_id === 10),
    };
    svv.ui = {};
    svv.ui.holder = $('.tool-ui');

    svv.ui.validationMenu = {};
    svv.ui.validationMenu.holder = $('#validation-menu-holder');
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
    svv.ui.validationMenu.disagreeReasonTextBox = $('#add-disagree-comment');
    svv.ui.validationMenu.unsureMenu = $('#validate-why-unsure-section');
    svv.ui.validationMenu.unsureReasonOptions = $('#unsure-reason-options');
    svv.ui.validationMenu.unsureReasonTextBox = $('#add-unsure-comment');
    svv.ui.validationMenu.submitButton = $('#validate-submit-button');
    svv.ui.validationMenu.mobilePopupNotch = $('#mobile-popup-notch');

    svv.ui.validationMenu.currentTags = $('#current-tags-list');
    svv.ui.validationMenu.aiSuggestionSection = $('#sidewalk-ai-suggestions-block');
    svv.ui.validationMenu.aiSuggestedTagTemplate = $('.sidewalk-ai-suggested-tag.template');

    svv.ui.undoValidation = {};
    svv.ui.undoValidation.undoButton = $('#validate-undo-button');

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
    svv.ui.status.upperMenuTitle = $('#mission-title');
    svv.ui.status.zoomInButton = $('#zoom-in-button');
    svv.ui.status.zoomOutButton = $('#zoom-out-button');
    svv.ui.status.labelVisibilityControlButton = $('#label-visibility-control-button');

    svv.ui.status.admin = {
      holder: $('#admin-info-section'),
      button: $('#admin-info-button'),
      template: $('#admin-info-template'),
    };

    svv.ui.viewer = {};
    svv.ui.viewer.holder = $('#svv-application-holder');
    svv.ui.viewer.controlLayer = $('#view-control-layer');
    svv.ui.viewer.dateHolder = $('#svv-panorama-date-holder');
    svv.ui.viewer.date = $('#svv-panorama-date');
  }

  /**
   * Instantiates the tool's components in dependency order and reveals the UI once everything is ready.
   */
  async #init() {
    const param = this.#param;

    // On desktop the pano's display size is scaled to fit the viewport, so measure it live; label projection
    // math and the canvas_width/height submitted with each validation always reflect the on-screen size.
    svv.canvasWidth = () => (util.isMobile()
      ? window.innerWidth
      : Math.round(svv.ui.viewer.controlLayer[0].getBoundingClientRect().width));
    svv.canvasHeight = () => (util.isMobile()
      ? window.innerHeight
      : Math.round(svv.ui.viewer.controlLayer[0].getBoundingClientRect().height));
    svv.labelRadius = util.isMobile() ? 25 : 10;

    const labelType = svv.labelTypes[param.mission.label_type_id];

    svv.validationMenu = util.isMobile()
      ? new MobileValidationMenu(svv.ui.validationMenu)
      : new DesktopValidationMenu(svv.ui.validationMenu);

    svv.form = new Form(param.dataStoreUrl);

    if (svv.adminVersion) svv.adminInfo = new AdminInfo(svv.ui.status.admin);

    svv.statusField = new StatusField(param.completedValidations);
    svv.tracker = new Tracker();

    BadgeAchievements.seedCounts();
    svv.labelDescriptionBox = new LabelDescriptionBox();

    svv.panoStore = new PanoStore();
    const firstLabel = param.labelList[0];
    svv.panoManager = await PanoManager.create(
      svv.viewerType, param.viewerAccessToken, firstLabel.pano_id, buildBackupImageData(firstLabel),
    );
    svv.labelContainer = await LabelContainer.create(param.labelList);

    // There are certain features that will only make sense on desktop vs mobile.
    if (util.isMobile()) {
      svv.pinchZoom = new PinchZoomDetector();
    } else {
      svv.panoOverlay = new PanoOverlay();
      svv.keyboard = new KeyboardManager(svv.ui.validationMenu);
      svv.speedLimit = new SpeedLimit(
        svv.panoViewer, svv.panoViewer.getPosition, () => false, svv.labelContainer, labelType,
      );
      svv.zoomControl = new ZoomControl();
      new MissionStartTutorial('validate', labelType, { nLabels: param.mission.labels_validated }, svv, param.language);
    }

    // Now that mission start tutorial has loaded, can unhide the UI under it and remove the loading icon.
    $('#page-loading').css({ visibility: 'hidden' });
    $('.tool-ui').css({ visibility: 'visible' });

    // Uniformly scale the whole tool to fit the viewport (like browser zoom) using var(--ui-scale). Mobile
    // instead fills the screen via PanoManager's own sizing.
    if (!util.isMobile()) {
      const applyValidateScale = () => {
        const scale = util.applyToolScale(
          ['--pano-base-width', '--menu-base-gap', '--menu-base-width'],
          ['--header-base-height', '--pano-base-height'],
        );
        svv.panoManager.setMarkerScale(scale);
        svv.panoViewer.resize();
      };
      applyValidateScale();
      window.addEventListener('resize', applyValidateScale);
    }

    svv.labelVisibilityControl = new LabelVisibilityControl();

    svv.undoValidation = new UndoValidation(svv.ui.undoValidation);

    svv.modalMission = new ModalMission(svv.ui.modalMission);
    svv.missionContainer = new MissionContainer();
    svv.missionContainer.createAMission(param.mission, param.progress);

    if (!util.isMobile()) {
      svv.infoPopover = new PanoInfoPopover(
        svv.ui.viewer.dateHolder, svv.panoViewer, svv.panoViewer.getPosition, svv.panoViewer.getPanoId,
        () => {
          return svv.labelContainer.getCurrentLabel().getAuditProperty('streetEdgeId');
        },
        () => {
          return svv.labelContainer.getCurrentLabel().getAuditProperty('regionId');
        },
        () => {
          return svv.panoStore.getPanoData(svv.panoViewer.getPanoId()).getProperty('captureDate');
        },
        () => {
          return svv.panoStore.getPanoData(svv.panoViewer.getPanoId()).getProperty('address');
        },
        svv.panoViewer.getPov, true, () => {
          svv.tracker.push('PanoInfoButton_Click');
        },
        () => {
          svv.tracker.push('PanoInfoCopyToClipboard_Click');
        },
        () => {
          svv.tracker.push('PanoInfoViewInPano_Click');
        },
        () => {
          return svv.labelContainer.getCurrentLabel().getAuditProperty('labelId');
        },
        () => {
          return svv.labelContainer.getCurrentLabel().getAuditProperty('labelTimestamp');
        },
      );
    }

    svv.modalMissionComplete = new ModalMissionComplete(svv.ui.modalMissionComplete, svv.user);
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

    window.addEventListener('focus', () => {
      logPageFocus();
    });
    window.addEventListener('blur', () => {
      logPageFocus();
    });
    logPageFocus();

    $('#sign-in-modal-container').on('hide.bs.modal', () => {
      svv.keyboard.enableKeyboard();
      $('.tool-ui').css('opacity', 1);
    });
    $('#sign-in-modal-container').on('show.bs.modal', () => {
      svv.keyboard.disableKeyboard();
      $('.tool-ui').css('opacity', 0.5);
    });

    // Initialize bootstrap tooltips (except on touch devices).
    if (window.matchMedia('(hover: hover)').matches) {
      $('[data-toggle="tooltip"]').tooltip({
        delay: { show: 500, hide: 100 },
        html: true,
        container: 'body',
      });
    }
  }
}
