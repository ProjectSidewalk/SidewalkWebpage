/**
 * Explore's keyboard shortcuts.
 *
 * Each table below is a group of shortcuts that's active at different times; edit a row to add or change one.
 * Label-type and tag keys come from `util.misc.getLabelDescriptions` instead, since the UI shows those letters.
 */

import { KeyboardShortcuts } from '../../common/KeyboardShortcuts.js';
import { util } from '../../common/utilities.js';
import '../../common/utilitiesSidewalk.js';
/** @typedef {import('../../common/KeyboardShortcuts.js').KeyboardShortcut} KeyboardShortcut */

export class KeyboardManager {
  /** @type {?KeyboardShortcut[]} */
  #labelTypeRows = null;

  #svl;
  #contextMenu;
  #navigationService;
  #ribbon;
  #zoomControl;

  #status = {
    focusOnTextField: false,
    isOnboarding: false,
    disableKeyboard: false,
  };

  /** Moving and turning, while the context menu is closed. On keydown, so holding a key keeps it going. */
  #walkingShortcuts = [
    { keys: ['ArrowLeft'], action: () => this.#rotatePovByDegree(-2) },
    { keys: ['ArrowRight'], action: () => this.#rotatePovByDegree(2) },
    { keys: ['ArrowUp'], action: () => this.#navigationService.moveToLinkedPano(0) },
    { keys: ['ArrowDown'], action: () => this.#navigationService.moveToLinkedPano(180) },
    { keys: ['Space'], when: (e) => !KeyboardManager.#isCheckboxOrRadio(e.target), action: (e) => this.#spacebar(e) },
  ];

  /** Closing the context menu. These also work while typing in its description box. */
  #closeMenuShortcuts = [
    { keys: ['Enter'], action: () => this.#saveAndCloseContextMenu() },
    { keys: ['Escape'], action: (e) => this.#cancelContextMenu(e) },
  ];

  /** Everywhere outside a text box. The label-type keys are added to these. */
  #generalShortcuts = [
    { keys: ['Escape'], action: (e) => this.#backToExploreMode(e) },
    { keys: ['KeyF'], when: (e) => this.#canToggleImmersiveMode(e), action: () => this.#toggleImmersiveMode() },
    { keys: ['KeyZ'], action: (e) => this.#zoom(e) }, // Shift+Z zooms out.
  ];

  /** Rating the label whose context menu is open. Its tag keys run after these. */
  #contextMenuShortcuts = [
    { keys: ['Digit1', 'Numpad1'], when: () => this.#canRateSeverity(), action: (e) => this.#rateSeverity(1, e) },
    { keys: ['Digit2', 'Numpad2'], when: () => this.#canRateSeverity(), action: (e) => this.#rateSeverity(2, e) },
    { keys: ['Digit3', 'Numpad3'], when: () => this.#canRateSeverity(), action: (e) => this.#rateSeverity(3, e) },
  ];

  constructor(svl, canvas, contextMenu, navigationService, ribbon, zoomControl) {
    this.#svl = svl;
    this.#contextMenu = contextMenu;
    this.#navigationService = navigationService;
    this.#ribbon = ribbon;
    this.#zoomControl = zoomControl;

    // We need { capture: true } for keydown to overwrite pano's shortcuts.
    window.addEventListener('keydown', this.#documentKeyDown, { capture: true });
    window.addEventListener('keyup', this.#documentKeyUp);
  }

  /**
   * @param {KeyboardEvent} e
   */
  #documentKeyDown = (e) => {
    if (this.#status.disableKeyboard || this.#status.focusOnTextField) return;
    if (!this.#contextMenu.isOpen()) KeyboardShortcuts.run(this.#walkingShortcuts, e);
  };

  /**
   * A key that closes the context menu stops here, so one Escape isn't handled twice.
   * @param {KeyboardEvent} e
   */
  #documentKeyUp = (e) => {
    if (this.#status.disableKeyboard) return;
    // Enter and Escape on a pinnable tooltip (the rating info icon) or inside its pinned card already pinned or closed
    // that card on keydown (psTooltip); letting their keyup through would also save-and-close the menu around it.
    if ((e.key === 'Enter' || e.key === 'Escape') && KeyboardManager.#isOnPinnableTooltip(e.target)) return;
    if (this.#contextMenu.isOpen() && KeyboardShortcuts.run(this.#closeMenuShortcuts, e)) return;

    // Ctrl/Alt/Cmd combos belong to the browser. Shift is ours (Shift+Z).
    if (this.#status.focusOnTextField || e.ctrlKey || e.altKey || e.metaKey) return;
    this.#labelTypeRows ??= this.#labelTypeShortcuts();
    KeyboardShortcuts.run([...this.#labelTypeRows, ...this.#generalShortcuts], e);
    if (this.#contextMenu.isOpen()) {
      KeyboardShortcuts.run(this.#contextMenuShortcuts, e);
      KeyboardShortcuts.run(this.#tagShortcuts(), e);
    }
  };

  /**
   * One row per labeling mode. E (Walk) is also a tag key, so it only means Walk when the menu is closed.
   * @returns {KeyboardShortcut[]}
   */
  #labelTypeShortcuts() {
    // A newly added label type may not have a letter yet; skip it.
    return ['Walk', ...util.misc.VALID_LABEL_TYPES_WITHOUT_OTHER]
      .map((mode) => ({ mode, key: KeyboardManager.#keyFor(util.misc.getLabelDescriptions(mode)?.keyChar) }))
      .filter(({ key }) => key)
      .map(({ mode, key }) => ({
        keys: [key],
        when: mode === 'Walk' ? () => !this.#contextMenu.isOpen() : undefined,
        action: (e) => this.#switchMode(mode, e),
      }));
  }

  /**
   * One row per tag of the open label's type, from the letter underlined in the tag's name.
   * @returns {KeyboardShortcut[]}
   */
  #tagShortcuts() {
    const targetLabel = this.#contextMenu.getTargetLabel();
    if (!targetLabel || this.#contextMenu.isTaggingDisabled()) return [];
    const labelType = targetLabel.getProperty('labelType');
    const tagInfo = util.misc.getLabelDescriptions(labelType)?.tagInfo;
    return this.#contextMenu.labelTags
      .filter((tag) => tag.label_type === labelType)
      .map((tag) => ({ tag, key: KeyboardManager.#keyFor(tagInfo?.[tag.tag]?.keyChar) }))
      .filter(({ key }) => key)
      .map(({ tag, key }) => ({
        keys: [key],
        action: () => document.querySelector(`[data-tag-id="${tag.tag_id}"]`)?.click(),
      }));
  }

  /**
   * Turns a letter shown in the UI into a row's key name (`C` → `KeyC`).
   * @param {string|undefined} char - A letter, digit, or one of `[ ] ; , . /`.
   * @returns {string|undefined} Its `KeyboardEvent.code`.
   */
  static #keyFor(char) {
    if (/^[A-Z]$/.test(char)) return `Key${char}`;
    if (/^[0-9]$/.test(char)) return `Digit${char}`;
    const punctuation = {
      '[': 'BracketLeft',
      ']': 'BracketRight',
      ';': 'Semicolon',
      ',': 'Comma',
      '.': 'Period',
      '/': 'Slash',
    };
    return punctuation[char];
  }

  disableKeyboard() {
    this.#status.disableKeyboard = true;
  }

  enableKeyboard() {
    this.#status.disableKeyboard = false;
  }

  /**
   * Change the heading of the current panorama point of view by a particular degree value.
   *
   * @param {number} degree
   */
  #rotatePovByDegree(degree) {
    const svl = this.#svl;
    if (!svl.panoManager.getStatus('disablePanning')) {
      svl.contextMenu.hide();
      // Panning hides the label hover card.
      const labels = svl.labelContainer.getCanvasLabels();
      const labelLen = labels.length;
      for (let i = 0; i < labelLen; i++) {
        labels[i].setHoverInfoVisibility('hidden');
      }
      svl.canvas.hideHoverCard();
      const pitch = svl.panoViewer.getPov().pitch;
      const zoom = svl.panoViewer.getPov().zoom;
      const heading = (svl.panoViewer.getPov().heading + degree + 360) % 360;
      svl.panoManager.setPov({ heading, pitch, zoom });
    }
  }

  /**
   * Advance one step forward along the user's assigned route, keeping their current POV (heading/pitch/zoom).
   *
   * First tries to step to the GSV-linked pano in the route direction (not just wherever the camera happens to
   * face); if there's no such link — e.g. GSV shows no navigation arrow that way — falls back to the route-aware
   * moveForward() engine that probes along the assigned street geometry for the next available imagery. This is
   * the spacebar shortcut for the "routed where there's no forward arrow" case from #619/#1041.
   */
  async #advanceForwardAlongRoute() {
    const svl = this.#svl;
    // No-op while walking is disabled (e.g. mid-load), matching the arrow keys — otherwise moveToLinkedPano()
    // resolves false and we'd both fall through to a no-op moveForward() and log a move that never happened.
    if (this.#navigationService.getStatus('disableWalking')) return;

    try {
      // Bias the forward step toward the route direction rather than wherever the camera is currently pointed.
      // moveToLinkedPano() takes a heading offset relative to the current heading, so subtract the current one.
      const routeHeading = svl.compass.getTargetAngle();
      const currHeading = svl.panoViewer.getPov().heading;
      // Silent on failure: a link that won't load is not the end of this shortcut, it's the reason for the
      // moveForward() fallback below — which reports its own outcome. Alerting here would tell the labeler imagery
      // couldn't be loaded on the same keypress that walked them down the street (#4918).
      const moved = await this.#navigationService.moveToLinkedPano(routeHeading - currHeading,
        { alertOnFailure: false });
      if (!moved) {
        await this.#navigationService.moveForward();
      }
      svl.tracker.push('KeyboardShortcut_MoveForwardAlongRoute', { usedRoute: !moved });
    } catch (e) {
      // Keep a failed forward step from surfacing as an unhandled promise rejection out of a key event.
      console.error('Spacebar route-advance failed:', e);
    }
  }

  /**
   * Steps forward along the route. Skipped on a focused checkbox or radio button, which needs Space (#4945).
   * @param {KeyboardEvent} e
   */
  #spacebar(e) {
    // Stop the page scrolling, and stop Space from re-clicking a focused button (e.g. Stuck).
    e.preventDefault();
    this.#advanceForwardAlongRoute();
  }

  /**
   * @param {EventTarget} target
   * @returns {boolean}
   */
  static #isCheckboxOrRadio(target) {
    return target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio');
  }

  /**
   * Whether a key landed on a pinnable tooltip trigger or inside the shared tooltip card (psTooltip.js), where Enter
   * and Escape belong to the card.
   * @param {EventTarget} target
   * @returns {boolean}
   */
  static #isOnPinnableTooltip(target) {
    return target instanceof Element && target.closest('[data-ps-tooltip-pinnable], #ps-tooltip') !== null;
  }

  /** Enter closes the menu, keeping what was entered. */
  #saveAndCloseContextMenu() {
    this.#svl.tracker.push('KeyboardShortcut_CloseContextMenu');
    this.#contextMenu.handleSeverityPopup();
    this.#svl.tracker.push('ContextMenu_ClosePressEnter');
    this.#contextMenu.hide();
  }

  /**
   * @param {KeyboardEvent} e
   */
  #cancelContextMenu(e) {
    this.#closeContextMenu(e);
    this.#ribbon.backToWalk();
    this.#svl.canvas.showLabelHoverInfo(undefined);
  }

  /**
   * Also hides the label hover card, so it can be dismissed without the mouse (WCAG 1.4.13).
   * @param {KeyboardEvent} e
   */
  #backToExploreMode(e) {
    this.#ribbon.backToWalk();
    this.#svl.canvas.showLabelHoverInfo(undefined);
    this.#svl.tracker.push('KeyboardShortcut_ModeSwitch_Walk', { code: e.code });
  }

  /**
   * @param {string} mode - 'Walk' or a label type.
   * @param {KeyboardEvent} e
   */
  #switchMode(mode, e) {
    this.#closeContextMenu(e);
    this.#ribbon.modeSwitch(mode);
    this.#svl.tracker.push(`KeyboardShortcut_ModeSwitch_${mode}`, { code: e.code });
  }

  /**
   * Immersive mode on/off (#5085). Not while the menu is open (F is a tag key there) or while typing.
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  #canToggleImmersiveMode(e) {
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      || /** @type {?HTMLElement} */ (document.activeElement)?.isContentEditable;
    return !e.shiftKey && !e.altKey && !e.metaKey && !this.#contextMenu.isOpen() && !editing
      && Boolean(this.#svl.immersiveMode);
  }

  #toggleImmersiveMode() {
    this.#svl.immersiveMode.toggle('KeyboardShortcut');
  }

  /**
   * Zooms in, or out with Shift held. Closes the context menu first.
   * @param {KeyboardEvent} e
   */
  #zoom(e) {
    if (this.#contextMenu.isOpen()) {
      this.#svl.tracker.push('KeyboardShortcut_CloseContextMenu');
      this.#contextMenu.hide();
    }
    if (e.shiftKey) {
      this.#zoomControl.zoomOut();
      this.#svl.tracker.push('KeyboardShortcut_ZoomOut', { code: e.code });
    } else {
      this.#zoomControl.zoomIn();
      this.#svl.tracker.push('KeyboardShortcut_ZoomIn', { code: e.code });
    }
  }

  /** @returns {boolean} Whether the open label takes a severity rating. */
  #canRateSeverity() {
    return Boolean(this.#contextMenu.getTargetLabel()) && !this.#contextMenu.isRatingSeverityDisabled();
  }

  /**
   * @param {number} severity - 1-3.
   * @param {KeyboardEvent} e
   */
  #rateSeverity(severity, e) {
    this.#contextMenu.checkRadioButton(severity);
    this.#contextMenu.getTargetLabel().setProperty('severity', severity);
    this.#svl.tracker.push(`KeyboardShortcut_Severity_${severity}`, { code: e.code });
    this.#svl.canvas.clear().render();
  }

  /**
   * @param {KeyboardEvent} e
   */
  #closeContextMenu(e) {
    if (this.#contextMenu.isOpen()) {
      this.#svl.tracker.push('KeyboardShortcut_CloseContextMenu');
      this.#svl.tracker.push('ContextMenu_CloseKeyboardShortcut', { code: e.code });
      this.#contextMenu.hide();
    }
  }

  /**
   * Get status
   * @param {string} key - Field name
   * @returns {*}
   */
  getStatus(key) {
    if (!(key in this.#status)) {
      console.warn('You have passed an invalid key for status.');
    }
    return this.#status[key];
  }

  /**
   * Set status
   * @param {string} key - Field name
   * @param {boolean} value - Field value
   */
  setStatus(key, value) {
    if (key in this.#status) {
      this.#status[key] = value;
    }
  }
}
