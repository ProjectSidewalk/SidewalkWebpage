/** @namespace */
window.svv = window.svv || {};

/**
 * Main module for Validate / Expert Validate / and Mobile Validate.
 */
class Main {
  // Long enough to read two lines and try the drag it suggests, without sitting on the imagery it is describing.
  static #PANO_HINT_MS = 6000;

  // Re-sizing the pano is a layout and a viewer redraw, and a rotation fires resize several times as the device
  // settles. Coalescing at about a frame's worth keeps the pano tracking the screen without doing it every event.
  static #RESIZE_THROTTLE_MS = 150;

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
      // The unhide in #init() never runs on this path, and the page still needs revealing: without it the loading
      // overlay sits on screen forever and the modal is visible only through its own inline visibility override.
      $('#page-loading').css({ visibility: 'hidden' });
      $('.tool-ui').removeClass('ps-invisible');
    }
  }

  /**
   * Collects the tool's DOM elements into the `svv.ui` tree that the other modules read.
   */
  #initUI() {
    svv.tagsByLabelType = this.#param.tagList.reduce((acc, t) => {
      (acc[t.label_type] ??= []).push(t);
      return acc;
    }, {});
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

    svv.ui.modalMission = {};
    svv.ui.modalMission.holder = $('#modal-mission-holder');
    svv.ui.modalMission.foreground = $('#modal-mission-foreground');
    svv.ui.modalMission.background = $('#modal-mission-background');
    svv.ui.modalMission.eyebrow = $('#modal-mission-eyebrow'); // Mobile only; empty jQuery set on desktop.
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
    // The mission's label type, and the validator's standing after it. Mobile only; empty jQuery sets on desktop.
    svv.ui.modalMissionComplete.labelIcon = $('#mission-complete-label-icon');
    svv.ui.modalMissionComplete.badgeIcon = $('#mission-complete-badge-icon');
    svv.ui.modalMissionComplete.badgeName = $('#mission-complete-badge-name');
    svv.ui.modalMissionComplete.badgeProgressFill = $('#mission-complete-badge-progress-fill');
    svv.ui.modalMissionComplete.badgeNext = $('#mission-complete-badge-next');
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

    // Measured live off the layer the imagery is actually drawn in, on both platforms: desktop scales the pano to
    // fit the viewport and mobile sizes it to the screen below the header, and either can change under a resize.
    // Label projection math and the canvas_width/height submitted with each validation follow the on-screen size.
    svv.canvasWidth = () => Math.round(svv.ui.viewer.controlLayer[0].getBoundingClientRect().width);
    svv.canvasHeight = () => Math.round(svv.ui.viewer.controlLayer[0].getBoundingClientRect().height);
    // A phone activates the marker by pointer — it is what opens the label card — so mobile-validate.css floors its
    // target at 44px. The mark itself stays 32px across (2 * radius + 2): bigger hides the imagery being judged.
    svv.labelRadius = util.isMobile() ? 15 : 10;

    const labelType = param.mission.label_type;

    svv.validationMenu = util.isMobile()
      ? new MobileValidationMenu(svv.ui.validationMenu)
      : new DesktopValidationMenu(svv.ui.validationMenu);

    svv.form = new Form(param.dataStoreUrl);

    if (svv.adminVersion) svv.adminInfo = new AdminInfo(svv.ui.status.admin);

    svv.statusField = new StatusField(param.completedValidations);
    svv.tracker = new Tracker();

    BadgeAchievements.seedCounts();
    svv.labelCard = new LabelCard();

    svv.panoStore = new PanoStore();

    // Built before the first label renders because that render can need it: if none of the mission's labels have
    // usable imagery, LabelContainer drops all of them and shows this modal instead of an empty pano (#4810).
    svv.modalNoNewMission = new ModalNoNewMission(svv.ui.modalMission);

    const firstLabel = param.labelList[0];
    svv.panoManager = await PanoManager.create(
      svv.viewerType, param.viewerAccessToken, firstLabel.pano_id, buildBackupImageData(firstLabel),
    );
    svv.labelContainer = await LabelContainer.create(param.labelList, param.mission.label_type);

    // There are certain features that will only make sense on desktop vs mobile.
    if (util.isMobile()) {
      svv.pinchZoom = new PinchZoomDetector();
    } else {
      svv.panoOverlay = new PanoOverlay();
      svv.keyboard = new KeyboardManager(svv.ui.validationMenu);
      // Shortcuts act on the current label, and behind the dead-end modal there isn't one. The modal disables the
      // keyboard when it goes up, but the first label's render can raise it before this exists to be told (#4810).
      if (svv.modalNoNewMission.isShowing()) svv.keyboard.disableKeyboard();
      // Read svv.panoViewer through closures rather than capturing it here, for the same reason as the info popover
      // below: PanoManager swaps it between the primary viewer and Pannellum, and the sign would otherwise stay
      // subscribed to whichever one happened to be showing the first label (#4828).
      svv.speedLimit = new SpeedLimit(
        () => svv.panoViewer, () => svv.panoViewer.getPosition(), () => false, param.countryId,
        { labelContainer: svv.labelContainer },
      );
      svv.zoomControl = new ZoomControl();
      new MissionStartTutorial('validate', labelType, { nLabels: param.mission.labels_validated }, svv, param.language);
    }

    // Now that mission start tutorial has loaded, can unhide the UI under it and remove the loading icon.
    $('#page-loading').css({ visibility: 'hidden' });
    $('.tool-ui').removeClass('ps-invisible');

    // The first label rendered while the tool was still invisible (visibility: hidden doesn't pause animations),
    // so its halo pulse played unseen. Replay it now that the marker can be seen — or, on desktop, once the
    // mission-start tutorial overlay raised just above it clears (#4790).
    svv.panoManager.replayMarkerPulse();

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
    } else {
      // The pano is sized to the viewport, so a rotation (or an on-screen keyboard opening) leaves it the wrong
      // shape. Re-size it in place: a reload would be the only alternative, and it would cost the validator their
      // place in the mission and a fresh round of imagery loading every time they turned the phone.
      let lastWidth = document.documentElement.clientWidth;
      let lastHeight = document.documentElement.clientHeight;
      const resizePano = () => {
        const width = document.documentElement.clientWidth;
        const height = document.documentElement.clientHeight;
        // A pinch fires resize on iOS but only moves the *visual* viewport: the layout is the shape it always was,
        // and re-sizing the pano to a zoomed-into region is exactly the wrong answer.
        if (width === lastWidth && height === lastHeight) return;

        const rotated = (width > height) !== (lastWidth > lastHeight);
        lastWidth = width;
        lastHeight = height;

        svv.panoManager.sizePano();
        svv.panoViewer.resize();
        svv.tracker.push('Window_Resized', {
          width, height, orientation: width > height ? 'landscape' : 'portrait', rotated,
        });
      };
      // Leading + trailing edges both matter: iOS settles on its post-rotation dimensions over several events, so
      // the first one keeps the pano from sitting visibly wrong and the last one is the size that sticks.
      window.addEventListener('resize', util.throttle(resizePano, Main.#RESIZE_THROTTLE_MS));
    }

    svv.labelVisibilityControl = new LabelVisibilityControl();

    this.#showPanoInteractiveHint();

    svv.undoValidation = new UndoValidation(svv.ui.undoValidation);

    svv.modalMission = new ModalMission(svv.ui.modalMission);
    svv.missionContainer = new MissionContainer();
    svv.missionContainer.createAMission(param.mission, param.progress);

    if (!util.isMobile()) {
      // Read svv.panoViewer through closures rather than capturing it here: PanoManager swaps it between the
      // primary viewer and Pannellum as labels come and go, and a captured viewer keeps reporting the pano from
      // the last label it showed (#4813).
      svv.infoPopover = new PanoInfoPopover(
        svv.ui.viewer.dateHolder, () => svv.panoViewer,
        () => svv.panoViewer.getPosition(), () => svv.panoViewer.getPanoId(),
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
        () => svv.panoViewer.getPov(), true, () => {
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

    // The auth dialog is absent when signed in, and svv.keyboard is absent on the mobile page (#4884); pause
    // keyboard shortcuts while the dialog is open (events from Modal.js).
    const signInModal = document.getElementById('sign-in-modal-container');
    signInModal?.addEventListener('ps:modal:hidden', () => {
      svv.keyboard?.enableKeyboard();
      $('.tool-ui').css('opacity', 1);
    });
    signInModal?.addEventListener('ps:modal:show', () => {
      svv.keyboard?.disableKeyboard();
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

  /**
   * Tells the validator the pano is not a still photo — it pans and zooms, which is often the difference between
   * "I can't tell" and a confident answer (#4726).
   *
   * One line, no title: it is laid over the very imagery it is describing, so it has to be small enough to leave
   * that imagery readable. It names the two mouse gestures rather than the zoom buttons or the Z shortcut, since a
   * mouse is what someone who hasn't found either will already have their hand on.
   *
   * Desktop only, for that same reason: the gestures it names are a mouse's, where touch pans with a drag and zooms
   * with a pinch. A phone also has nowhere to put it — the toast would cover a strip of the very pano the validator
   * is being asked to judge, on a screen where that pano is the whole page.
   *
   * Held until the mission-start tutorial's overlay clears, since anything shown before that lands underneath it.
   * A mission that doesn't open with one gets the hint immediately.
   */
  #showPanoInteractiveHint() {
    if (util.isMobile()) return;

    const show = () => Toast.show({
      message: i18next.t('center-ui.pano-interactive-message'),
      reference: svv.ui.viewer.controlLayer[0],
      duration: Main.#PANO_HINT_MS,
      dark: true,    // It floats over street imagery, where a white card glares.
      compact: true, // An aside, not an announcement.
    });

    const overlay = document.querySelector('.mission-start-tutorial-overlay');
    if (overlay && getComputedStyle(overlay).display !== 'none') {
      document.addEventListener('ps:mission-start-tutorial:done', show, { once: true });
    } else {
      show();
    }
  }
}
