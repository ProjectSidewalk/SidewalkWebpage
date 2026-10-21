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
/** @typedef {import('../canvas/Canvas.js').Canvas} Canvas */
/** @typedef {import('../navigation/Compass.js').Compass} Compass */
/** @typedef {import('../canvas/ContextMenu.js').ContextMenu} ContextMenu */
/** @typedef {import('../../common/ImmersiveMode.js').ImmersiveMode} ImmersiveMode */
/** @typedef {import('../../common/Gate.js').Gate} Gate */
/** @typedef {import('../navigation/NavigationService.js').NavigationService} NavigationService */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../menu/LabelModes.js').LabelModes} LabelModes */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */
/** @typedef {import('../zoom/ZoomControl.js').ZoomControl} ZoomControl */

export class KeyboardManager {
  /** @type {?KeyboardShortcut[]} */
  #labelTypeRows = null;

  #keyboardLock;
  #canvas;
  #contextMenu;
  #navigationService;
  #labelModes;
  #zoomControl;
  #panoManager;
  #compass;
  #immersiveMode;
  #tracker;

  // Typing in the context menu's description box: the shortcuts stand aside for the letters.
  #focusOnTextField = false;

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

  /**
   * @param {Gate} keyboardLock - Held by whatever needs the shortcuts paused (a move, a pop-up, a panel).
   * @param {Canvas} canvas
   * @param {ContextMenu} contextMenu
   * @param {NavigationService} navigationService
   * @param {LabelModes} labelModes - Switched by the label-type keys.
   * @param {ZoomControl} zoomControl
   * @param {PanoManager} panoManager
   * @param {Compass} compass - Says which way the route goes, for the spacebar.
   * @param {ImmersiveMode} immersiveMode - Toggled by F.
   * @param {Tracker} tracker
   */
  constructor(keyboardLock, canvas, contextMenu, navigationService, labelModes, zoomControl, panoManager, compass,
    immersiveMode, tracker) {
    this.#keyboardLock = keyboardLock;
    this.#canvas = canvas;
    this.#contextMenu = contextMenu;
    this.#navigationService = navigationService;
    this.#labelModes = labelModes;
    this.#zoomControl = zoomControl;
    this.#panoManager = panoManager;
    this.#compass = compass;
    this.#immersiveMode = immersiveMode;
    this.#tracker = tracker;

    contextMenu.onTextFieldFocusChanged((focused) => {
      this.#focusOnTextField = focused;
    });

    // We need { capture: true } for keydown to overwrite pano's shortcuts.
    window.addEventListener('keydown', this.#documentKeyDown, { capture: true });
    window.addEventListener('keyup', this.#documentKeyUp);
  }

  /**
   * @param {KeyboardEvent} e
   */
  #documentKeyDown = (e) => {
    if (this.#keyboardLock.isHeld() || this.#focusOnTextField) return;
    if (!this.#contextMenu.isOpen()) KeyboardShortcuts.run(this.#walkingShortcuts, e);
  };

  /**
   * A key that closes the context menu stops here, so one Escape isn't handled twice.
   * @param {KeyboardEvent} e
   */
  #documentKeyUp = (e) => {
    if (this.#keyboardLock.isHeld()) return;
    if (this.#contextMenu.isOpen() && KeyboardShortcuts.run(this.#closeMenuShortcuts, e)) return;

    // Ctrl/Alt/Cmd combos belong to the browser. Shift is ours (Shift+Z).
    if (this.#focusOnTextField || e.ctrlKey || e.altKey || e.metaKey) return;
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

  /**
   * Change the heading of the current panorama point of view by a particular degree value.
   *
   * @param {number} degree
   */
  #rotatePovByDegree(degree) {
    if (!this.#panoManager.panning.isHeld()) {
      this.#contextMenu.hide();
      // Panning hides the label hover card.
      this.#canvas.showLabelHoverInfo(undefined);
      const pov = this.#panoManager.getPov();
      this.#panoManager.setPov({ heading: (pov.heading + degree + 360) % 360, pitch: pov.pitch, zoom: pov.zoom });
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
    // No-op while walking is disabled (e.g. mid-load), matching the arrow keys — otherwise moveToLinkedPano()
    // resolves false and we'd both fall through to a no-op moveForward() and log a move that never happened.
    if (!this.#navigationService.canWalk()) return;

    try {
      // Bias the forward step toward the route direction rather than wherever the camera is currently pointed.
      // moveToLinkedPano() takes a heading offset relative to the current heading, so subtract the current one.
      const routeHeading = this.#compass.getTargetAngle();
      const currHeading = this.#panoManager.getPov().heading;
      // Silent on failure: a link that won't load is not the end of this shortcut, it's the reason for the
      // moveForward() fallback below — which reports its own outcome. Alerting here would tell the labeler imagery
      // couldn't be loaded on the same keypress that walked them down the street (#4918).
      const moved = await this.#navigationService.moveToLinkedPano(routeHeading - currHeading,
        { alertOnFailure: false });
      if (!moved) {
        await this.#navigationService.moveForward();
      }
      this.#tracker.push('KeyboardShortcut_MoveForwardAlongRoute', { usedRoute: !moved });
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

  /** Enter closes the menu, keeping what was entered. */
  #saveAndCloseContextMenu() {
    this.#tracker.push('KeyboardShortcut_CloseContextMenu', null, this.#contextMenu.getTargetLabel());
    this.#contextMenu.handleSeverityPopup();
    this.#tracker.push('ContextMenu_ClosePressEnter', null, this.#contextMenu.getTargetLabel());
    this.#contextMenu.hide();
  }

  /**
   * @param {KeyboardEvent} e
   */
  #cancelContextMenu(e) {
    this.#closeContextMenu(e);
    this.#labelModes.backToWalk();
    this.#canvas.showLabelHoverInfo(undefined);
  }

  /**
   * Also hides the label hover card, so it can be dismissed without the mouse (WCAG 1.4.13).
   * @param {KeyboardEvent} e
   */
  #backToExploreMode(e) {
    this.#labelModes.backToWalk();
    this.#canvas.showLabelHoverInfo(undefined);
    this.#tracker.push('KeyboardShortcut_ModeSwitch_Walk', { code: e.code });
  }

  /**
   * @param {string} mode - 'Walk' or a label type.
   * @param {KeyboardEvent} e
   */
  #switchMode(mode, e) {
    this.#closeContextMenu(e);
    this.#labelModes.switchTo(mode);
    this.#tracker.push(`KeyboardShortcut_ModeSwitch_${mode}`, { code: e.code });
  }

  /**
   * Immersive mode on/off (#5085). Not while the menu is open (F is a tag key there) or while typing.
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  #canToggleImmersiveMode(e) {
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      || /** @type {?HTMLElement} */ (document.activeElement)?.isContentEditable;
    return !e.shiftKey && !e.altKey && !e.metaKey && !this.#contextMenu.isOpen() && !editing;
  }

  #toggleImmersiveMode() {
    this.#immersiveMode.toggle('KeyboardShortcut');
  }

  /**
   * Zooms in, or out with Shift held. Closes the context menu first.
   * @param {KeyboardEvent} e
   */
  #zoom(e) {
    if (this.#contextMenu.isOpen()) {
      this.#tracker.push('KeyboardShortcut_CloseContextMenu', null, this.#contextMenu.getTargetLabel());
      this.#contextMenu.hide();
    }
    if (e.shiftKey) {
      this.#zoomControl.zoomOut();
      this.#tracker.push('KeyboardShortcut_ZoomOut', { code: e.code });
    } else {
      this.#zoomControl.zoomIn();
      this.#tracker.push('KeyboardShortcut_ZoomIn', { code: e.code });
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
    // Its change event sets the severity and redraws the canvas, as a click would.
    this.#contextMenu.checkRadioButton(severity);
    this.#tracker.push(`KeyboardShortcut_Severity_${severity}`, { code: e.code }, this.#contextMenu.getTargetLabel());
  }

  /**
   * @param {KeyboardEvent} e
   */
  #closeContextMenu(e) {
    if (this.#contextMenu.isOpen()) {
      this.#tracker.push('KeyboardShortcut_CloseContextMenu', null, this.#contextMenu.getTargetLabel());
      this.#tracker.push('ContextMenu_CloseKeyboardShortcut', { code: e.code }, this.#contextMenu.getTargetLabel());
      this.#contextMenu.hide();
    }
  }
}
