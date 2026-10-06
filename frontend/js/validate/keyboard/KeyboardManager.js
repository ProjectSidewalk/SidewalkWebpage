/**
 * Validate's keyboard shortcuts.
 *
 * Each table below is a group of shortcuts that's active at different times; edit a row to add or change one.
 */

import { svv } from '../svv.js';
import { KeyboardShortcuts } from '../../common/KeyboardShortcuts.js';

export class KeyboardManager {
  #validationMenuUi;
  #disableKeyboard = false;
  #addingComment = false;

  /** The main shortcuts. Off while a modal is up, while typing in a comment box, and with Ctrl, Alt or Cmd held. */
  #shortcuts = [
    { keys: ['KeyY', 'KeyA'], action: () => this.#validationMenuUi.yesButton.click() },
    { keys: ['KeyN', 'KeyD'], action: () => this.#validationMenuUi.noButton.click() },
    { keys: ['KeyU'], action: () => this.#validationMenuUi.unsureButton.click() },
    { keys: ['KeyS'], action: () => this.#validationMenuUi.submitButton.click() },
    { keys: ['KeyB'], action: (e) => this.#undoValidation(e) },
    { keys: ['KeyH'], action: (e) => this.#toggleLabelVisibility(e) },
    { keys: ['KeyZ'], action: (e) => this.#zoom(e) }, // Shift+Z zooms out.
    { keys: ['KeyC'], action: (e) => this.#handleCommentBoxShortcut(e) },
    { keys: ['Digit1', 'Numpad1'], action: (e) => this.#handleNumberKeyShortcut(1, e) },
    { keys: ['Digit2', 'Numpad2'], action: (e) => this.#handleNumberKeyShortcut(2, e) },
    { keys: ['Digit3', 'Numpad3'], action: (e) => this.#handleNumberKeyShortcut(3, e) },
    { keys: ['Digit4', 'Numpad4'], action: (e) => this.#handleFourOrFive(4, e) },
    { keys: ['Digit5', 'Numpad5'], action: (e) => this.#handleFourOrFive(5, e) },
    // A card opened on load (#5675) must close from anywhere, not only with focus on the label (WCAG 1.4.13).
    {
      keys: ['Escape'],
      when: () => svv.labelVisibilityControl.isCardHeldOpen(),
      action: (e) => this.#closeHeldOpenCard(e),
    },
  ];

  /** With Ctrl (Cmd on a Mac) held. Off while a modal is up, and while typing, where Ctrl+Z undoes the typing. */
  #ctrlShortcuts = [
    // Not Ctrl+Shift+Z, which means redo (#5409).
    { keys: ['KeyZ'], when: (e) => !e.shiftKey, action: (e) => this.#undoValidation(e) },
  ];

  /**
   * These also work while typing a comment. Not in the tag picker, where Enter adds the tag instead.
   */
  #whileTypingShortcuts = [
    { keys: ['Enter'], when: () => !this.#inTagPicker(), action: (e) => this.#submit(e) },
  ];

  /** These also work while a modal is open. */
  #alwaysOnShortcuts = [
    { keys: ['KeyF'], when: KeyboardManager.#canToggleImmersiveMode, action: (e) => this.#toggleImmersiveMode(e) },
  ];

  /** On the label's marker or inside its card (#4729), where none of the shortcuts above fire. */
  #labelCardShortcuts = [
    { keys: ['Escape'], action: (e) => this.#escapeLabelCard(e) },
    { keys: ['Enter', 'Space'], when: KeyboardManager.#onMarker, action: (e) => this.#toggleCard(e) },
  ];

  /**
   * @param {Record<string, HTMLElement>} validationMenuUi - Validation menu UI elements.
   */
  constructor(validationMenuUi) {
    this.#validationMenuUi = validationMenuUi;

    // Add keydown listeners to the text boxes because esc key press is not being recognized when selected input text.
    validationMenuUi.optionalCommentTextBox.addEventListener('keydown', this.#handleEscapeKey);
    validationMenuUi.disagreeReasonTextBox.addEventListener('keydown', this.#handleEscapeKey);
    validationMenuUi.unsureReasonTextBox.addEventListener('keydown', this.#handleEscapeKey);

    // We need { capture: true } for keydown to overwrite pano's shortcuts.
    window.addEventListener('keydown', this.#documentKeyDown, { capture: true });
  }

  /**
   * Checks the narrowest scope first; a group that handles the key stops it there.
   * @param {KeyboardEvent} e
   */
  #documentKeyDown = (e) => {
    if (KeyboardManager.#belongsToFocusedControl(e)) return;
    if (KeyboardManager.#inLabelCard(e)) {
      KeyboardShortcuts.run(this.#labelCardShortcuts, e);
      return;
    }

    this.#checkIfTextAreaSelected();
    if (KeyboardShortcuts.run(this.#alwaysOnShortcuts, e)) return;
    if (this.#disableKeyboard) return;
    KeyboardShortcuts.run(this.#whileTypingShortcuts, e);
    if (this.#addingComment) return;

    if (e.ctrlKey || e.metaKey) {
      KeyboardShortcuts.run(this.#ctrlShortcuts, e);
    } else if (!e.altKey) { // Alt+D is the browser's address bar, not Disagree.
      if (!svv.labelVisibilityControl.isCardHeldOpen()) svv.labelVisibilityControl.hideLabelCard();
      KeyboardShortcuts.run(this.#shortcuts, e);
    }
  };

  #handleEscapeKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.currentTarget.blur();
      svv.tracker.push('KeyboardShortcut_UnfocusComment', { code: e.code });
    }
  };

  disableKeyboard() {
    this.#disableKeyboard = true;
  }

  enableKeyboard() {
    this.#disableKeyboard = false;
  }

  // Set the addingComment status based on whether the user is currently typing in a validation comment text field.
  #checkIfTextAreaSelected() {
    const validationMenuUi = this.#validationMenuUi;
    // Check if expertValidate text boxes are focused.
    if (document.activeElement === validationMenuUi.optionalCommentTextBox
      || document.activeElement === validationMenuUi.disagreeReasonTextBox
      || document.activeElement === validationMenuUi.unsureReasonTextBox
      || this.#inTagPicker()) {
      this.#addingComment = true;
    } else {
      this.#addingComment = false;
    }
  }

  /** @returns {boolean} Whether the tag picker's text box has focus. */
  #inTagPicker() {
    return document.activeElement === document.getElementById('select-tag-ts-control');
  }

  /**
   * Handles the logic for the number key shortcuts.
   *
   * @param {number} n - The keyboard shortcut number that was hit. 1-3 map to a severity, disagree reason, or unsure
   *                   reason; 4 maps to a fourth disagree reason where one is offered. Any n with no matching option
   *                   focuses the comment box, which is what makes 5 reach it on a four-reason label type.
   * @param {KeyboardEvent} e - The keypress event.
   */
  #handleNumberKeyShortcut(n, e) {
    const validationMenuUi = this.#validationMenuUi;
    if (validationMenuUi.yesButton.classList.contains('is-chosen')) {
      if (svv.adminVersion) this.#clickSeverity(n);
    } else if (this.#inWrongTypeView()) {
      // Severity only once its section is showing, or a rating typed before a type is picked rides along unseen.
      if (document.getElementById('validate-severity-section')?.style.display === 'block') this.#clickSeverity(n);
    } else if (validationMenuUi.noButton.classList.contains('is-chosen')) {
      const button = document.getElementById(`no-button-${n}`);
      KeyboardManager.#pickReason(button, validationMenuUi.disagreeReasonTextBox, e);
    } else if (validationMenuUi.unsureButton.classList.contains('is-chosen')) {
      const button = document.getElementById(`unsure-button-${n}`);
      KeyboardManager.#pickReason(button, validationMenuUi.unsureReasonTextBox, e);
    }
  }

  /**
   * Clicks the numbered reason button, or the comment box where the label type offers no reason under that number.
   * @param {HTMLElement|null} button - The reason button the number names, if the menu has one.
   * @param {HTMLElement} textBox - The menu's free-text reason box.
   * @param {KeyboardEvent} e - The keypress event.
   */
  static #pickReason(button, textBox, e) {
    if (button?.classList.contains('defaultOption')) {
      button.click();
    } else {
      e.preventDefault();
      textBox.click();
    }
  }

  /**
   * Whether Enter should open the pano's chevron menu rather than submit. Only when the chevron was reached by
   * keyboard: a validator who Tabbed there means "open the menu", while one who clicked it and then pressed Enter
   * means "submit", as from any other button a click left focused (Chrome, Edge, and Firefox outside macOS focus a
   * clicked button). `:focus-visible` tells the two apart, since a mouse click leaves it false. A browser that
   * rejects the selector falls through to submit, the page-wide default.
   * @param {Element} target - The keydown's target.
   * @returns {boolean}
   */
  static #isKeyboardFocusedChevron(target) {
    if (target?.id !== 'validate-control-buttons-toggle') return false;
    try {
      return target.matches(':focus-visible');
    } catch {
      return false;
    }
  }

  /** @returns {boolean} Whether the menu is on the "wrong label type" disagree (#5409). */
  #inWrongTypeView() {
    return svv.validationMenu?.inWrongTypeView() === true;
  }

  /**
   * Clicks the radio, not its label: a label click focuses the radio, which opens the tooltip (#5298).
   * @param {number} n - The severity to pick, 1-3.
   */
  #clickSeverity(n) {
    document.getElementById(`validate-severity-radio-${n}`).click();
  }

  /**
   * Sets focus to the appropriate comment box, depending on which validation option has been selected.
   *
   * @param {KeyboardEvent} e - The keypress event.
   */
  #handleCommentBoxShortcut(e) {
    const validationMenuUi = this.#validationMenuUi;
    e.preventDefault();
    if (validationMenuUi.yesButton.classList.contains('is-chosen') || this.#inWrongTypeView()) {
      validationMenuUi.optionalCommentTextBox.click();
    } else if (validationMenuUi.noButton.classList.contains('is-chosen')) {
      validationMenuUi.disagreeReasonTextBox.click();
    } else if (validationMenuUi.unsureButton.classList.contains('is-chosen')) {
      validationMenuUi.unsureReasonTextBox.click();
    }
  }

  /**
   * Whether a focused control in the pano's corners should get the key instead of a shortcut.
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  static #belongsToFocusedControl(e) {
    // The image adjustments panel is a keyboard scope of its own (#5501): a key on a focused slider nudges it rather
    // than firing a shortcut, and the panel's own document-level listener takes Escape. An open panel counts wherever
    // the key came from, since a click on the panel's whitespace leaves focus on the body. Checked before the card's
    // scope so an open panel takes Escape even with the card showing. Scoped here rather than with disableKeyboard():
    // that flag is one boolean shared with the modals and the loading state, and re-enabling it on close could release
    // a lock the panel never took.
    const target = /** @type {Element} */ (e.target);
    if (document.getElementById('pano-image-adjustments')?.contains(target) || svv.imageAdjustmentsPopover?.isOpen()) {
      return true;
    }

    // Space on a focused control in the pano's top-left group (Hide label, the chevron, the Image pill in its menu) is
    // left to the browser, which activates the button on keyup; that is the keyboard route to opening the panel. Enter
    // is not exempt on the pills: on Validate it submits from any focused button, and closing the panel puts focus back
    // on the Image pill, so an exempt Enter there would reopen the panel for a validator pressing Enter to submit. The
    // letter shortcuts stay live throughout, since a mouse click leaves focus on the control.
    const key = KeyboardShortcuts.keyOf(e);
    if (key === 'Space' && target.closest?.('#label-visibility-control-holder')) return true;
    const enter = key === 'Enter';
    if (enter && KeyboardManager.#isKeyboardFocusedChevron(target)) return true;
    // The dock's X and the immersive toggle mean "take the answer back" and "change the layout": Enter on either has to
    // activate it, as it does every other button of that kind, not submit the answer the X was pressed to undo.
    return enter && Boolean(target.closest?.('#validate-verdict-clear, #immersive-toggle-button'));
  }

  /**
   * Whether the key is on the label's marker or in its card. An open popover counts too, since Safari and Firefox on
   * Mac don't focus clicked buttons.
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  static #inLabelCard(e) {
    const card = document.getElementById('label-card');
    return e.target === KeyboardManager.#marker() || Boolean(card?.contains(/** @type {Node} */ (e.target)))
      || Boolean(svv.labelCard?.isPopoverOpen());
  }

  /**
   * @param {KeyboardEvent} e
   * @returns {boolean} Whether the key was pressed on the label's marker.
   */
  static #onMarker(e) {
    return e.target === KeyboardManager.#marker();
  }

  /** @returns {?HTMLElement} The label's marker on the pano. */
  static #marker() {
    return document.getElementById('validate-pano-marker');
  }

  /**
   * Closes the card's type dropdown if it's open, as a menu would, and otherwise the card.
   * @param {KeyboardEvent} e
   */
  #escapeLabelCard(e) {
    if (svv.labelCard?.closeTypeDropdown()) return;
    // Only log a hide if the card was showing. Focus goes back to the marker either way.
    if (svv.labelVisibilityControl.isCardVisible()) {
      svv.labelVisibilityControl.hideLabelCard();
      svv.tracker.push('KeyboardShortcut_HideLabelCard', { code: e.code });
    }
    KeyboardManager.#marker()?.focus();
  }

  /**
   * Closes a card opened on load. Unlike #escapeLabelCard, focus stays where it was: the user never went to the label.
   * @param {KeyboardEvent} e
   */
  #closeHeldOpenCard(e) {
    svv.labelVisibilityControl.hideLabelCard();
    svv.tracker.push('KeyboardShortcut_HideLabelCard', { code: e.code });
  }

  /**
   * @param {KeyboardEvent} e
   */
  #toggleCard(e) {
    e.preventDefault(); // Space would otherwise also scroll the page.
    svv.labelVisibilityControl.toggleLabelCard({ viaKeyboard: true });
  }

  /**
   * Immersive mode on/off (#5560). Not while typing or with a modifier held.
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  static #canToggleImmersiveMode(e) {
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      || /** @type {?HTMLElement} */ (document.activeElement)?.isContentEditable;
    return !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !editing && Boolean(svv.immersiveMode);
  }

  /**
   * @param {KeyboardEvent} e
   */
  #toggleImmersiveMode(e) {
    // Keydown repeats while the key is held, and each repeat would flip the layout again.
    if (!e.repeat) svv.immersiveMode.toggle('KeyboardShortcut');
  }

  /**
   * @param {KeyboardEvent} e
   */
  #submit(e) {
    e.preventDefault();
    this.#validationMenuUi.submitButton.click();
  }

  /**
   * @param {KeyboardEvent} e
   */
  #undoValidation(e) {
    e.preventDefault();
    if (svv.undoValidation.canUndo()) svv.ui.undoValidation.undoButton.click();
  }

  /**
   * @param {KeyboardEvent} e
   */
  #toggleLabelVisibility(e) {
    if (svv.labelVisibilityControl.isVisible()) {
      svv.labelVisibilityControl.hideLabel();
      svv.tracker.push('KeyboardShortcut_HideLabel', { code: e.code });
    } else {
      svv.labelVisibilityControl.unhideLabel();
      svv.tracker.push('KeyboardShortcut_UnhideLabel', { code: e.code });
    }
  }

  /**
   * Zooms in, or out with Shift held.
   * @param {KeyboardEvent} e
   */
  #zoom(e) {
    if (e.shiftKey) {
      svv.zoomControl.zoomOut();
      svv.tracker.push('KeyboardShortcut_ZoomOut', { code: e.code });
    } else {
      svv.zoomControl.zoomIn();
      svv.tracker.push('KeyboardShortcut_ZoomIn', { code: e.code });
    }
  }

  /**
   * A fourth disagree reason where there is one, otherwise the comment box (always the number after the last
   * reason). Agree has no severity 4 or 5, so it always gets the comment box.
   * @param {number} n - 4 or 5.
   * @param {KeyboardEvent} e
   */
  #handleFourOrFive(n, e) {
    if (this.#validationMenuUi.noButton.classList.contains('is-chosen') && !this.#inWrongTypeView()) {
      this.#handleNumberKeyShortcut(n, e);
    } else {
      this.#handleCommentBoxShortcut(e);
    }
  }
}
