/** Wires Validate together: the one place its modules are built, so every dependency between them is visible. */

import { BadgeAchievements } from '../common/BadgeAchievements.js';
import { ImmersiveMode } from '../common/ImmersiveMode.js';
import { MissionStartTutorial } from '../common/MissionStartTutorial.js';
import { PanoImageAdjustments } from '../common/PanoImageAdjustments.js';
import { PanoImageAdjustmentsPopover } from '../common/PanoImageAdjustmentsPopover.js';
import { SpeedLimit } from '../common/SpeedLimit.js';
import { Toast } from '../common/Toast.js';
import { PanoImageCache } from '../common/pano-viewer/PanoImageCache.js';
import { PanoInfoPopover } from '../common/pano-viewer/PanoInfoPopover.js';
import { PanoStore } from '../common/pano-viewer/PanoStore.js';
import { util } from '../common/utilities.js';
import { Tracker } from './Tracker.js';
import { Form } from './data/Form.js';
import { KeyboardLock } from './keyboard/KeyboardLock.js';
import { KeyboardManager } from './keyboard/KeyboardManager.js';
import { LabelContainer } from './label/LabelContainer.js';
import { LabelVisibilityControl } from './label/LabelVisibilityControl.js';
import { DesktopValidationMenu } from './menu/DesktopValidationMenu.js';
import { MobileValidationMenu } from './menu/MobileValidationMenu.js';
import { UndoValidation } from './menu/UndoValidation.js';
import { MissionContainer } from './mission/MissionContainer.js';
import { ModalMission } from './modal/ModalMission.js';
import { ModalMissionComplete } from './modal/ModalMissionComplete.js';
import { ModalNoNewMission } from './modal/ModalNoNewMission.js';
import { PanoControlMenu } from './panorama/PanoControlMenu.js';
import { PanoLoadingStatus } from './panorama/PanoLoadingStatus.js';
import { PanoManager } from './panorama/PanoManager.js';
import { PanoOverlay } from './panorama/PanoOverlay.js';
import { AdminInfo } from './status/AdminInfo.js';
import { StatusField } from './status/StatusField.js';
import { buildReasonButtonInfo } from './util/ConstantsValidate.js';
import { MissionLiveMarker } from './util/MissionLiveMarker.js';
import { PinchZoomDetector } from './zoom/PinchZoomDetector.js';
import { ZoomControl } from './zoom/ZoomControl.js';
import './util/throttle.js';

/**
 * What the page was opened with, read once and shared by every module that needs a page-level fact.
 * @typedef {object} ValidateConfig
 * @property {boolean} adminVersion - Expert Validate: the label's type, rating and tags can be edited.
 * @property {Record<string, any>} validateParams - The queue filters this page validates under, echoed to the server.
 * @property {typeof import('../common/pano-viewer/PanoViewer.js').PanoViewer} viewerType - The primary pano viewer's
 *     class.
 * @property {Record<string, any[]>} tagsByLabelType - Every tag this city offers, keyed by label type.
 * @property {number} labelRadius - The marker's radius in px before UI scaling.
 * @property {string} source - Which Validate UI this is, as the server records it: Validate, ExpertValidate, or
 *     ValidateMobile.
 * @property {() => number} canvasWidth - The on-screen width of the imagery, measured live.
 * @property {() => number} canvasHeight - The on-screen height of the imagery, measured live.
 */

/**
 * The verdict menu's elements. An element only one layout has is null on the other.
 * @typedef {object} ValidationMenuUi
 * @property {?HTMLElement} holder - Desktop only; the phone lays its menu over the pano.
 * @property {?HTMLButtonElement} verdictClearButton - Desktop only, shown in immersive mode.
 * @property {?HTMLElement} header - Desktop only; the phone has no menu column.
 * @property {HTMLButtonElement} yesButton
 * @property {HTMLButtonElement} noButton
 * @property {HTMLButtonElement} unsureButton
 * @property {?HTMLElement} labelTypeMenu - Expert Validate only.
 * @property {?HTMLElement} labelTypePicker - Expert Validate only.
 * @property {?HTMLElement} tagsMenu - Expert Validate only.
 * @property {?HTMLElement} severityMenu - Expert Validate only.
 * @property {?HTMLElement} optionalCommentSection - Desktop only.
 * @property {?HTMLInputElement} optionalCommentTextBox - Desktop only.
 * @property {HTMLElement} noMenu
 * @property {HTMLElement} disagreeReasonOptions
 * @property {HTMLInputElement} disagreeReasonTextBox
 * @property {HTMLElement} unsureMenu
 * @property {HTMLElement} unsureReasonOptions
 * @property {HTMLInputElement} unsureReasonTextBox
 * @property {?HTMLButtonElement} submitButton - Desktop only; the phone's verdict buttons submit on their own.
 * @property {?HTMLElement} mobilePopupNotch - Mobile only.
 * @property {?HTMLElement} currentTags - Expert Validate only.
 * @property {?HTMLElement} aiSuggestionSection - Expert Validate only.
 * @property {?HTMLTemplateElement} currentTagTemplate - Expert Validate only.
 * @property {?HTMLTemplateElement} aiSuggestedTagTemplate - Expert Validate only.
 */

/**
 * The mission modal's elements, shared by the mission briefing (ModalMission) and the dead ends (ModalNoNewMission).
 * @typedef {object} ModalMissionUi
 * @property {HTMLElement} holder
 * @property {HTMLElement} foreground
 * @property {HTMLElement} background
 * @property {?HTMLElement} eyebrow - Mobile only.
 * @property {HTMLElement} missionTitle
 * @property {HTMLElement} instruction
 * @property {HTMLButtonElement} closeButton
 */

/**
 * The Admin Info popover's elements; Expert Validate only.
 * @typedef {object} AdminInfoUi
 * @property {HTMLElement} holder - The section holding the button.
 * @property {HTMLButtonElement} button
 * @property {HTMLElement} popover
 * @property {HTMLTemplateElement} template - What the popover is filled from.
 */

/**
 * The pano area's chrome.
 * @typedef {object} ViewerUi
 * @property {HTMLElement} controlLayer - The layer over the imagery that takes the pointer and holds the marker.
 * @property {HTMLElement} dateHolder - Where the capture date and the pano info button sit.
 * @property {HTMLElement} date - The capture date's text.
 */

/**
 * The tool's DOM elements, collected once. An element only one layout has is null on the other.
 * @typedef {object} ValidateUi
 * @property {HTMLElement} holder - The whole tool, revealed once the first label is up.
 * @property {HTMLElement[]} busyRegion - What dims while a label loads (VALIDATE_BUSY_SELECTORS).
 * @property {ValidationMenuUi} validationMenu
 * @property {{undoButton: HTMLButtonElement}} undoValidation
 * @property {ModalMissionUi} modalMission
 * @property {Record<string, HTMLElement>} modalMissionComplete
 * @property {{upperMenuTitle: HTMLElement, upperMenuIcon: ?HTMLImageElement, zoomInButton: HTMLElement,
 *     zoomOutButton: HTMLElement, admin: AdminInfoUi}} status
 * @property {ViewerUi} viewer
 */

/**
 * The console and e2e handle start.js puts on `window.svv`: the few live objects a test or a developer inspects.
 * @typedef {object} ValidateHandle
 * @property {Record<string, any>} validateParams
 * @property {LabelContainer} [labelContainer]
 * @property {PanoManager} [panoManager]
 * @property {PanoImageAdjustmentsPopover} [imageAdjustmentsPopover] - Desktop only.
 */

/**
 * The elements the busy state covers while a label loads (LabelContainer's `#setUiBusy`, #5211), per layout.
 *
 * Desktop dims the whole tool through its application holder, with the menu column alongside it. Mobile has neither
 * of those elements — its controls are laid over the pano rather than sitting in a column of their own — so they are
 * named one by one: dimming the holder they share would take the imagery, and the fallback viewer's progress box,
 * down with them.
 *
 * Every id here has to exist in the matching view, which validateLoadingGuard.test.js checks: a selector that matches
 * nothing fails silently, and that is how mobile came to have no busy state at all.
 */
export const VALIDATE_BUSY_SELECTORS = {
  desktop: ['#svv-application-holder', '#validation-menu-holder'],
  mobile: ['#validation-button-holder', '#validate-why-no-section', '#validate-why-unsure-section',
    '#mobile-popup-notch', '#validate-undo-button', '#label-visibility-control-holder'],
};

/**
 * Main module for Validate / Expert Validate / and Mobile Validate.
 */
export class Main {
  // Long enough to read two lines and try the drag it suggests, without sitting on the imagery it is describing.
  static #PANO_HINT_MS = 6000;

  // Re-sizing the pano is a layout and a viewer redraw, and a rotation fires resize several times as the device
  // settles. Coalescing at about a frame's worth keeps the pano tracking the screen without doing it every event.
  // Desktop, which rescales on every event, uses the same span as the quiet period before it logs Window_Resized.
  static #RESIZE_THROTTLE_MS = 150;

  #param;

  // The mission the page opens on, as /validationTask/mission answered.
  #firstMission;

  /** @type {ValidateUi} */
  #ui;

  /** @type {ValidateConfig} */
  #config;

  /** @type {PanoManager} Set during start(); read by the relayout and resize handlers, which run after it. */
  #panoManager;

  /** @type {?ImmersiveMode} Desktop only. */
  #immersiveMode = null;

  /**
   * @param {Record<string, any>} param - The page's session scalars, from the view's page-data block.
   * @param {Record<string, any>} firstMission - The mission to start on: `mission`, its `labels` and `progress`,
   *                                             `has_mission_available`, and the user's `completed_validations`.
   */
  constructor(param, firstMission) {
    this.#param = param;
    this.#firstMission = firstMission;
    this.#ui = Main.#collectUi();

    const adminVersion = param.validateParams.admin_version;
    const controlLayer = this.#ui.viewer.controlLayer;
    this.#config = Object.freeze({
      adminVersion,
      validateParams: param.validateParams,
      viewerType: param.viewerType,
      tagsByLabelType: Object.freeze(param.tagList.reduce((acc, t) => {
        (acc[t.label_type] ??= []).push(t);
        return acc;
      }, {})),
      // A phone activates the marker by pointer — it is what opens the label card — so mobile-validate.css floors
      // its target at 44px. The mark itself stays 32px across (2 * radius + 2): bigger hides the imagery being judged.
      labelRadius: util.isMobile() ? 15 : 10,
      source: Main.#source(adminVersion),
      // Measured live off the layer the imagery is actually drawn in, on both platforms: desktop scales the pano to
      // fit the viewport and mobile sizes it to the screen below the header, and either can change under a resize.
      // Label projection math and the canvas_width/height submitted with each validation follow the on-screen size.
      canvasWidth: () => Math.round(controlLayer.getBoundingClientRect().width),
      canvasHeight: () => Math.round(controlLayer.getBoundingClientRect().height),
    });
  }

  /**
   * Which Validate UI the data comes from, as the server records it.
   * @param {boolean} adminVersion - Whether this is Expert Validate.
   * @returns {string} One of 'ValidateMobile', 'ExpertValidate', or 'Validate'.
   */
  static #source(adminVersion) {
    if (util.isMobile()) return 'ValidateMobile';
    return adminVersion ? 'ExpertValidate' : 'Validate';
  }

  /**
   * Builds the tool's modules and starts it.
   * @returns {Promise<ValidateHandle>} The console handle, once the first label is on screen.
   */
  start() {
    if (this.#firstMission.has_mission_available) return this.#init();

    const tracker = new Tracker();
    // The dead end still logs its visit, and the exit flush is the Form's; there is no mission for it to compile.
    new Form(this.#param.dataStoreUrl, this.#config, tracker, null);
    new ModalNoNewMission(this.#ui.modalMission, new KeyboardLock(), tracker).show();
    // The unhide in #init() never runs on this path, and the page still needs revealing: without it the loading
    // overlay sits on screen forever and the modal is visible only through its own inline visibility override.
    this.#revealTool();
    return Promise.resolve({ validateParams: this.#config.validateParams });
  }

  /** Takes down the loading overlay and shows the tool under it. */
  #revealTool() {
    document.getElementById('page-loading').style.visibility = 'hidden';
    this.#ui.holder.classList.remove('ps-invisible');
  }

  /**
   * Collects the tool's DOM elements. An element only one layout has (mobile's briefing eyebrow, desktop's tag
   * editor) is null on the other.
   * @returns {ValidateUi}
   */
  static #collectUi() {
    const byId = (id) => document.getElementById(id);
    const busySelectors = util.isMobile() ? VALIDATE_BUSY_SELECTORS.mobile : VALIDATE_BUSY_SELECTORS.desktop;

    // A tap would pin the markup's tooltips open on a touch device; the ones added by script check the same query.
    if (!window.matchMedia('(hover: hover)').matches) {
      document.querySelectorAll('[data-ps-tooltip]').forEach((el) => el.removeAttribute('data-ps-tooltip'));
    }

    return {
      holder: document.querySelector('.tool-ui'),
      busyRegion: [...document.querySelectorAll(busySelectors.join(', '))],
      validationMenu: {
        holder: byId('validation-menu-holder'),
        verdictClearButton: /** @type {HTMLButtonElement} */ (byId('validate-verdict-clear')),
        header: byId('main-validate-header'),
        yesButton: /** @type {HTMLButtonElement} */ (byId('validate-yes-button')),
        noButton: /** @type {HTMLButtonElement} */ (byId('validate-no-button')),
        unsureButton: /** @type {HTMLButtonElement} */ (byId('validate-unsure-button')),
        labelTypeMenu: byId('validate-label-type-section'),
        labelTypePicker: byId('label-type-picker'),
        tagsMenu: byId('validate-tags-section'),
        severityMenu: byId('validate-severity-section'),
        optionalCommentSection: byId('validate-optional-comment-section'),
        optionalCommentTextBox: /** @type {HTMLInputElement} */ (byId('add-optional-comment')),
        noMenu: byId('validate-why-no-section'),
        disagreeReasonOptions: byId('no-reason-options'),
        disagreeReasonTextBox: /** @type {HTMLInputElement} */ (byId('add-disagree-comment')),
        unsureMenu: byId('validate-why-unsure-section'),
        unsureReasonOptions: byId('unsure-reason-options'),
        unsureReasonTextBox: /** @type {HTMLInputElement} */ (byId('add-unsure-comment')),
        submitButton: /** @type {HTMLButtonElement} */ (byId('validate-submit-button')),
        mobilePopupNotch: byId('mobile-popup-notch'),
        currentTags: byId('current-tags-list'),
        aiSuggestionSection: byId('sidewalk-ai-suggestions-block'),
        currentTagTemplate: /** @type {HTMLTemplateElement} */ (byId('current-tag-template')),
        aiSuggestedTagTemplate: /** @type {HTMLTemplateElement} */ (byId('sidewalk-ai-suggested-tag-template')),
      },
      undoValidation: { undoButton: /** @type {HTMLButtonElement} */ (byId('validate-undo-button')) },
      modalMission: {
        holder: byId('modal-mission-holder'),
        foreground: byId('modal-mission-foreground'),
        background: byId('modal-mission-background'),
        eyebrow: byId('modal-mission-eyebrow'),
        missionTitle: byId('modal-mission-header'),
        instruction: byId('modal-mission-instruction'),
        closeButton: /** @type {HTMLButtonElement} */ (byId('modal-mission-close-button')),
      },
      modalMissionComplete: {
        agreeCount: byId('modal-mission-complete-agree-count'),
        background: byId('modal-mission-complete-background'),
        closeButtonPrimary: byId('modal-mission-complete-close-button-primary'),
        closeButtonSecondary: byId('modal-mission-complete-close-button-secondary'),
        disagreeCount: byId('modal-mission-complete-disagree-count'),
        foreground: byId('modal-mission-complete-foreground'),
        holder: byId('modal-mission-complete-holder'),
        message: byId('modal-mission-complete-message'),
        missionTitle: byId('modal-mission-complete-title'),
        unsureCount: byId('modal-mission-complete-unsure-count'),
        // The mission's label type, and the validator's standing after it. Mobile only.
        labelIcon: byId('mission-complete-label-icon'),
        badgeIcon: byId('mission-complete-badge-icon'),
        badgeName: byId('mission-complete-badge-name'),
        badgeProgressFill: byId('mission-complete-badge-progress-fill'),
        badgeNext: byId('mission-complete-badge-next'),
        yourOverallTotalCount: byId('modal-mission-complete-your-overall-total-count'),
      },
      status: {
        upperMenuTitle: byId('mission-title'),
        upperMenuIcon: /** @type {?HTMLImageElement} */ (byId('mission-title-icon')),
        zoomInButton: byId('zoom-in-button'),
        zoomOutButton: byId('zoom-out-button'),
        admin: {
          holder: byId('admin-info-section'),
          button: /** @type {HTMLButtonElement} */ (byId('admin-info-button')),
          popover: byId('admin-info-popover'),
          template: /** @type {HTMLTemplateElement} */ (byId('admin-info-template')),
        },
      },
      viewer: {
        controlLayer: byId('view-control-layer'),
        dateHolder: byId('svv-panorama-date-holder'),
        date: byId('svv-panorama-date'),
      },
    };
  }

  /**
   * Instantiates the tool's components in dependency order and reveals the UI once everything is ready.
   * @returns {Promise<ValidateHandle>}
   */
  async #init() {
    const param = this.#param;
    const config = this.#config;
    const ui = this.#ui;
    const { mission, labels, progress } = this.#firstMission;
    const labelType = mission.label_type;

    // Logging comes first, so nothing built after it has to cope with its absence.
    const tracker = new Tracker();
    const keyboardLock = new KeyboardLock();

    const statusField = new StatusField(this.#firstMission.completed_validations, ui);

    // Immersive mode (#5560): built before the pano viewer so a mode restored from the tab's last page load has its
    // classes on the body when the viewer measures its container. Desktop only: the phone is already full-bleed.
    // Expert Validate keeps the boxed layout for now (the view omits the toggle there too): its edit sections have
    // no immersive placement yet, so the mode is off limits rather than half-designed.
    /** @type {?LabelVisibilityControl} Assigned below; a toggle can only land once the tool is up. */
    let labelVisibilityControl = null;
    if (!util.isMobile()) {
      this.#immersiveMode = new ImmersiveMode({
        tracker,
        bodyClass: 'svv-immersive',
        relayout: () => Main.relayout(this.#panoManager, /** @type {ImmersiveMode} */ (this.#immersiveMode)),
        isDisabled: () => config.adminVersion,
        // The label card is anchored against the marker, which the relayout moves; it reopens on the next hover.
        beforeToggle: () => labelVisibilityControl?.hideLabelCard(),
        frame: () => ({ width: config.canvasWidth(), height: config.canvasHeight() }),
        hintReference: () => document.getElementById('svv-panorama-holder'),
        deferRestoreLog: true, // Logged once the mission exists, like ImageAdjustments_Restored below.
      });
    }

    BadgeAchievements.seedCounts();

    const panoStore = new PanoStore();
    // Backup panos fetched ahead of the label that needs them (#5562); the Pannellum fallback loads from it first.
    const panoImageCache = new PanoImageCache();

    // Built before the first label renders because that render can need it: if none of the mission's labels have
    // usable imagery, LabelContainer drops all of them and shows this modal instead of an empty pano (#4810).
    const modalNoNewMission = new ModalNoNewMission(ui.modalMission, keyboardLock, tracker);

    // Built before the first label renders so that render can report a slow load too (#5581).
    const panoLoadingStatus = new PanoLoadingStatus(document.getElementById('svv-pano-loading'));

    const panoManager = await PanoManager.create(
      param.viewerAccessToken, ui.viewer, config, panoStore, panoImageCache, tracker,
    );
    this.#panoManager = panoManager;

    const zoomControl = util.isMobile() ? null : new ZoomControl(ui, panoManager, tracker);

    // What the mission-start tutorial logs through and hands back when it closes. Desktop only: the phone's
    // briefing is ModalMission's carousel.
    const tutorialHooks = util.isMobile() ? null : { tracker, keyboard: keyboardLock, zoomControl };

    const modalMissionComplete = new ModalMissionComplete(
      ui.modalMissionComplete, param.language, tutorialHooks, keyboardLock, statusField, panoManager, tracker,
    );
    const modalMission = new ModalMission(ui.modalMission, keyboardLock, modalNoNewMission, tracker);

    // Did the last page life in this tab end without a pagehide? On a phone that is the browser killing the tab for
    // memory (#5561), which from in here is otherwise indistinguishable from a reload. Read before the first mission
    // is created, which is what marks this life live; the tracker files the row under that mission when the buffer
    // drains, so it still names this mission alongside the one that was cut short.
    const missionLiveMarker = new MissionLiveMarker(window.sessionStorage);
    const unexpectedUnload = missionLiveMarker.takeUnexpectedUnload();
    if (unexpectedUnload) tracker.push('Validate_UnexpectedUnload', unexpectedUnload);

    const missionContainer = new MissionContainer(
      statusField, modalMission, modalMissionComplete, missionLiveMarker, tracker,
    );

    // Nothing renders yet: what describes a label subscribes to the container first, then the first label is drawn.
    const labelContainer = new LabelContainer(labels, labelType, ui, config, panoManager, panoLoadingStatus,
      modalMissionComplete, modalNoNewMission, missionContainer, tracker);

    labelVisibilityControl = new LabelVisibilityControl(ui.viewer, config, labelContainer, panoManager, tracker);
    const labelCard = labelVisibilityControl.getLabelCard();

    const reasonButtonInfo = buildReasonButtonInfo();
    const validationMenu = util.isMobile()
      ? new MobileValidationMenu(ui.validationMenu, reasonButtonInfo, labelContainer, tracker)
      : new DesktopValidationMenu(
          ui.validationMenu, config, reasonButtonInfo, labelContainer, labelCard, panoManager, tracker,
        );

    const undoValidation = new UndoValidation(
      ui.undoValidation, labelContainer, validationMenu, missionContainer, tracker,
    );

    if (config.adminVersion) {
      const adminInfo = new AdminInfo(ui.status.admin);
      labelContainer.onLabelShown((label) => adminInfo.updateAdminInfo(label));
    }

    new Form(param.dataStoreUrl, config, tracker, {
      missionContainer, labelContainer, panoStore, modalMissionComplete, modalNoNewMission,
    });

    /** @type {?PanoImageAdjustmentsPopover} */
    let imageAdjustmentsPopover = null;
    /** @type {?PanoImageAdjustments} */
    let imageAdjustments = null;
    // There are certain features that will only make sense on desktop vs mobile.
    if (util.isMobile()) {
      new PinchZoomDetector(panoManager, tracker);
    } else {
      new PanoOverlay(ui.viewer.controlLayer, labelVisibilityControl, panoManager);

      // Read the viewer through closures rather than capturing it here, for the same reason as the info popover
      // below: PanoManager swaps it between the primary viewer and Pannellum, and the sign would otherwise stay
      // subscribed to whichever one happened to be showing the first label (#4828).
      const speedLimit = new SpeedLimit(
        () => panoManager.panoViewer, () => panoManager.panoViewer.getPosition(), () => false, param.countryId,
        { labelContainer },
      );
      // Told rather than left waiting on a pano_changed: the label that just loaded may have swapped the active
      // viewer, and the viewer the sign last heard from is then the one that stays silent (#4828).
      labelContainer.onLabelShown(() => speedLimit.refresh());
      labelContainer.onLabelShown(() => zoomControl.updateZoomAvailability());

      // Shadows/brightness/contrast as a display-only filter (#5501), the same model and panel Explore uses. Both
      // viewer mounts get it, since PanoManager swaps a label onto the Pannellum sibling when GSV has no imagery, and
      // by now #init has created that sibling. No keyboard hooks: KeyboardManager treats the panel as its own scope.
      // Desktop only because mobile has neither the pill nor the panel, and the popover logs an error without them.
      imageAdjustments = new PanoImageAdjustments([
        document.getElementById('svv-panorama'), document.getElementById('svv-panorama-pannellum'),
      ]);
      imageAdjustmentsPopover = new PanoImageAdjustmentsPopover(imageAdjustments,
        document.getElementById('validate-control-image'), document.getElementById('pano-image-adjustments'), {
          // Below, so the hide-label toggle and chevron in the row stay visible beside the open panel.
          placement: 'below',
          onOpen: () => tracker.push('Click_ImageAdjustments_Open'),
          onClose: (via) => tracker.push('Click_ImageAdjustments_Close', { via }),
          onChange: (values) => tracker.push('ImageAdjustments_Change', values),
          onReset: () => tracker.push('Click_ImageAdjustments_Reset'),
        });
      // The Image pill waits in the chevron's menu, so the chevron carries its active dot while the menu is closed.
      const panoControlMenu
        = new PanoControlMenu(document.getElementById('validate-control-buttons-toggle'), tracker);
      panoControlMenu.setCollapsedIndicator(!imageAdjustments.isDefault());
      const adjustmentsModel = imageAdjustments;
      imageAdjustments.onChange(() => panoControlMenu.setCollapsedIndicator(!adjustmentsModel.isDefault()));

      new KeyboardManager(ui, config, keyboardLock, labelContainer, labelVisibilityControl, labelCard,
        /** @type {DesktopValidationMenu} */ (validationMenu), zoomControl, undoValidation,
        /** @type {ImmersiveMode} */ (this.#immersiveMode), imageAdjustmentsPopover, tracker);
    }

    await labelContainer.renderCurrentLabel();

    if (!util.isMobile()) {
      new MissionStartTutorial('validate', labelType, { nLabels: mission.labels_validated }, tutorialHooks,
        param.language);
    }

    // Now that mission start tutorial has loaded, can unhide the UI under it and remove the loading icon.
    this.#revealTool();

    // The first label rendered while the tool was still invisible (visibility: hidden doesn't pause animations),
    // so its halo pulse played unseen. Replay it now that the marker can be seen — or, on desktop, once the
    // mission-start tutorial overlay raised just above it clears (#4790).
    panoManager.replayMarkerPulse();

    // Uniformly scale the whole tool to fit the viewport (like browser zoom) using var(--ui-scale). Mobile
    // instead fills the screen via PanoManager's own sizing.
    if (!util.isMobile()) {
      const immersiveMode = /** @type {ImmersiveMode} */ (this.#immersiveMode);
      Main.applyValidateScale(panoManager, immersiveMode);
      window.addEventListener('resize', Main.createDesktopResizeHandler(panoManager, immersiveMode, tracker));
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

        panoManager.sizePano();
        panoManager.panoViewer.resize();
        panoManager.panoViewer.repaint();
        tracker.push('Window_Resized', {
          width, height, orientation: width > height ? 'landscape' : 'portrait', rotated,
        });
      };
      // Leading + trailing edges both matter: iOS settles on its post-rotation dimensions over several events, so
      // the first one keeps the pano from sitting visibly wrong and the last one is the size that sticks.
      window.addEventListener('resize', util.throttle(resizePano, Main.#RESIZE_THROTTLE_MS));
    }

    this.#showPanoInteractiveHint();

    missionContainer.createAMission(mission, progress);
    // Logged only now: the tracker stamps each row with the current mission, and without one this row, the only
    // record of a filter carried in from an earlier visit, could not be tied to a validator. Desktop builds the model.
    if (imageAdjustments && !imageAdjustments.isDefault()) {
      tracker.push('ImageAdjustments_Restored', imageAdjustments.values());
    }
    this.#immersiveMode?.logRestored();

    if (!util.isMobile()) {
      // Read the viewer through closures rather than capturing it here: PanoManager swaps it between the primary
      // viewer and Pannellum as labels come and go, and a captured viewer keeps reporting the pano from the last
      // label it showed (#4813).
      new PanoInfoPopover(
        ui.viewer.dateHolder, () => panoManager.panoViewer,
        () => panoManager.panoViewer.getPosition(), () => panoManager.panoViewer.getPanoId(),
        () => labelContainer.getCurrentLabel().getAuditProperty('streetEdgeId'),
        () => labelContainer.getCurrentLabel().getAuditProperty('regionId'),
        () => panoStore.getPanoData(panoManager.panoViewer.getPanoId()).getProperty('captureDate'),
        () => panoStore.getPanoData(panoManager.panoViewer.getPanoId()).getProperty('address'),
        () => panoManager.getPov(), true,
        () => tracker.push('PanoInfoButton_Click'),
        () => tracker.push('PanoInfoCopyToClipboard_Click'),
        () => tracker.push('PanoInfoViewInPano_Click'),
        () => labelContainer.getCurrentLabel().getAuditProperty('labelId'),
        () => labelContainer.getCurrentLabel().getAuditProperty('labelTimestamp'),
      );
    }

    // Logs when the page's focus changes.
    const logPageFocus = () => tracker.push(document.hasFocus() ? 'PageGainedFocus' : 'PageLostFocus');
    window.addEventListener('focus', logPageFocus);
    window.addEventListener('blur', logPageFocus);
    logPageFocus();

    // The auth dialog is absent when signed in; pause keyboard shortcuts while it is open (events from Modal.js).
    const signInModal = document.getElementById('sign-in-modal-container');
    signInModal?.addEventListener('ps:modal:hidden', () => {
      keyboardLock.enableKeyboard();
      ui.holder.style.opacity = '1';
    });
    signInModal?.addEventListener('ps:modal:show', () => {
      keyboardLock.disableKeyboard();
      ui.holder.style.opacity = '0.5';
    });

    return {
      validateParams: config.validateParams,
      labelContainer,
      panoManager,
      ...(imageAdjustmentsPopover ? { imageAdjustmentsPopover } : {}),
    };
  }

  /**
   * Scales the whole desktop tool to fit the viewport (like browser zoom, via var(--ui-scale)) and hands the pano
   * viewer its new container size. Runs once at startup and again on every window resize.
   *
   * The viewer is told twice over: `resize()` is the documented "your container moved" call, and `repaint()` covers
   * the case where GSV re-measures but never draws, leaving the validator a black image until they drag it (#2468,
   * #5367). Neither is known to be sufficient on its own, and both are cheap. The startup call repaints too: the
   * first label's marker set the POV while the tool was still at scale 1, so the rescale here is the first change
   * to the pano's box after it painted — the very trigger — and a black first label is what gets reported.
   *
   * @param {PanoManager} panoManager - Whose marker and live viewer are re-fitted.
   * @param {ImmersiveMode} immersiveMode - Decides which of the tool's boxes the scale has to fit.
   * @returns {void}
   */
  static applyValidateScale(panoManager, immersiveMode) {
    // Immersive mode (#5560) sizes the pano with CSS and floats the controls over it, so the scale fits only the
    // pano's own footprint into the whole window, with no page margins to keep clear of, as Explore's does.
    const immersive = immersiveMode.isActive();
    const scale = util.applyToolScale(
      immersive ? ['--pano-base-width'] : ['--pano-base-width', '--menu-base-gap', '--menu-base-width'],
      ['--header-base-height', '--pano-base-height'],
      immersive ? { maxScale: 3, hMargin: 0, bottomReserve: 0 } : {},
    );
    panoManager.setMarkerScale(scale);
    panoManager.panoViewer.resize();
    panoManager.panoViewer.repaint();
  }

  /**
   * Re-lays out the desktop tool for its current box, for a layout switch rather than a window resize: the rescale
   * and the viewer's resize and repaint, plus the toasts, which are anchored to the pano's old box and are told of a
   * window resize but not of the tool moving under them (Toast.repositionAll). Synchronous, so the immersive toggle
   * (#5560) lands in one frame.
   *
   * @param {PanoManager} panoManager - Whose marker and live viewer are re-fitted.
   * @param {ImmersiveMode} immersiveMode - Decides which of the tool's boxes the scale has to fit.
   * @returns {void}
   */
  static relayout(panoManager, immersiveMode) {
    Main.applyValidateScale(panoManager, immersiveMode);
    Toast.repositionAll();
  }

  /**
   * Builds the desktop `resize` listener: re-scale the tool, and record that the viewport changed shape.
   *
   * The logging lives here rather than in applyValidateScale() because that also runs at startup, where nothing was
   * resized — a `Window_Resized` then would read as a user action that never happened. Logged on the settled size,
   * once the events have stopped for a window, rather than throttled like mobile's: a throttle keeps emitting for as
   * long as a drag lasts, and a drag is one act, so it gets one line carrying the size that stuck.
   *
   * @param {PanoManager} panoManager - Whose marker and live viewer are re-fitted.
   * @param {ImmersiveMode} immersiveMode - Decides which of the tool's boxes the scale has to fit.
   * @param {Tracker} tracker - Logs the settled size.
   * @returns {() => void} The listener to attach to the window's `resize` event.
   */
  static createDesktopResizeHandler(panoManager, immersiveMode, tracker) {
    let logTimer;
    return () => {
      Main.applyValidateScale(panoManager, immersiveMode);
      clearTimeout(logTimer);
      logTimer = setTimeout(() => {
        tracker.push('Window_Resized', {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        });
      }, Main.#RESIZE_THROTTLE_MS);
    };
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
      reference: this.#ui.viewer.controlLayer,
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
