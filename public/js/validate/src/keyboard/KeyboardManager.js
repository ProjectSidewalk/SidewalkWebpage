/**
 * Handles keyboard shortcuts for the validation interface.
 */
class KeyboardManager {
  #validationMenuUi;
  #disableKeyboard = false;
  #addingComment = false;

  /**
   * @param {Record<string, HTMLElement>} validationMenuUi - Validation menu UI elements.
   */
  constructor(validationMenuUi) {
    this.#validationMenuUi = validationMenuUi;

    // Add keydown listeners to the text boxes because esc key press is not being recognized when selected input text.
    validationMenuUi.optionalCommentTextBox.addEventListener('keydown', this.#handleEscapeKey);
    validationMenuUi.disagreeReasonTextBox.addEventListener('keydown', this.#handleEscapeKey);
    validationMenuUi.unsureReasonTextBox.addEventListener('keydown', this.#handleEscapeKey);

    // Add the keyboard event listeners. We need { capture: true } for keydown to overwrite pano's shortcuts.
    window.addEventListener('keydown', this.#documentKeyDown, { capture: true });
  }

  #handleEscapeKey = (e) => {
    if (e.keyCode === 27) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.currentTarget.blur();
      svv.tracker.push('KeyboardShortcut_UnfocusComment', { keyCode: e.keyCode });
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
    if (validationMenuUi.yesButton.classList.contains('chosen')) {
      if (svv.adminVersion) this.#clickSeverity(n);
    } else if (this.#inWrongTypeView()) {
      // Severity only once its section is showing, or a rating typed before a type is picked rides along unseen.
      if (document.getElementById('validate-severity-section')?.style.display === 'block') this.#clickSeverity(n);
    } else if (validationMenuUi.noButton.classList.contains('chosen')) {
      const button = document.getElementById(`no-button-${n}`);
      KeyboardManager.#pickReason(button, validationMenuUi.disagreeReasonTextBox, e);
    } else if (validationMenuUi.unsureButton.classList.contains('chosen')) {
      const button = document.getElementById(`unsure-button-${n}`);
      KeyboardManager.#pickReason(button, validationMenuUi.unsureReasonTextBox, e);
    }
  }

  /**
   * Clicks the numbered reason button, or, where the label type offers no reason under that number, the comment box.
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
   * Read off the physical key rather than `e.key`, which says "!" under Shift, "&" on an AZERTY layout, or "End" on
   * a numpad with NumLock off, for the same key the case labels matched on.
   * @param {KeyboardEvent} e - A keydown whose code is `Digit<n>` or `Numpad<n>`.
   * @returns {number} The digit.
   */
  static #digitOf(e) {
    return Number(e.code.at(-1));
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
    if (validationMenuUi.yesButton.classList.contains('chosen') || this.#inWrongTypeView()) {
      validationMenuUi.optionalCommentTextBox.click();
    } else if (validationMenuUi.noButton.classList.contains('chosen')) {
      validationMenuUi.disagreeReasonTextBox.click();
    } else if (validationMenuUi.unsureButton.classList.contains('chosen')) {
      validationMenuUi.unsureReasonTextBox.click();
    }
  }

  /**
   * Handles keyboard shortcuts by listening to the keydown event.
   *
   * @param {KeyboardEvent} e
   */
  #documentKeyDown = (e) => {
    const validationMenuUi = this.#validationMenuUi;

    // The marker and its card are their own keyboard scope (#4729): none of the shortcuts below may fire from
    // inside, Enter especially, which would submit from a button that means "open". An open popover counts as being
    // in the card wherever the key came from, since Safari and Firefox on macOS don't focus a clicked button.
    const marker = document.getElementById('validate-pano-marker');
    const card = document.getElementById('label-card');
    if (e.target === marker || (card && card.contains(/** @type {Node} */ (e.target)))
      || svv.labelCard?.isPopoverOpen()) {
      if (e.code === 'Escape' && svv.labelCard?.closeTypeDropdown()) {
        // An open type dropdown takes the first Escape, as a menu would, rather than the whole card going with it.
      } else if (e.code === 'Escape') {
        // Guarded, not unconditional: Escape on a focused marker with the card already closed is a common reflex,
        // and logging a dismissal for it would pad the event with no-ops. Focus still returns to the marker.
        if (svv.labelVisibilityControl.isCardVisible()) {
          svv.labelVisibilityControl.hideLabelCard();
          svv.tracker.push('KeyboardShortcut_HideLabelCard', { keyCode: e.keyCode });
        }
        marker?.focus();
      } else if (e.target === marker && ['Enter', 'NumpadEnter', 'Space'].includes(e.code)) {
        e.preventDefault(); // Space would otherwise also scroll the page.
        svv.labelVisibilityControl.toggleLabelCard({ viaKeyboard: true });
      }
      return;
    }

    // When the user is typing in a comment box, disable keyboard shortcuts that validate a label.
    this.#checkIfTextAreaSelected();

    // Handle the various keyboard shortcuts.
    // Enter submits the validation even from a comment box. The tag picker is the exception: there it adds the
    // highlighted tag, and submitting would move on to the next label before the tag is added.
    if (!this.#disableKeyboard && !this.#inTagPicker() && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
      e.preventDefault();
      validationMenuUi.submitButton.click();
    }

    // Not in a comment box, where it undoes typing, and not Ctrl+Shift+Z, which means redo (#5409).
    if (!this.#disableKeyboard && !this.#addingComment && (e.ctrlKey || e.metaKey) && !e.shiftKey
      && e.code === 'KeyZ') {
      e.preventDefault();
      if (svv.undoValidation.canUndo()) svv.ui.undoValidation.undoButton.click();
      return;
    }

    if (!this.#disableKeyboard && !this.#addingComment && !e.ctrlKey) {
      svv.labelVisibilityControl.hideLabelCard();
      switch (e.code) {
        // Validate yes/agree.
        case 'KeyY':
        case 'KeyA':
          validationMenuUi.yesButton.click();
          break;
          // Validate no/disagree.
        case 'KeyN':
        case 'KeyD':
          validationMenuUi.noButton.click();
          break;
          // Validate unsure.
        case 'KeyU':
          validationMenuUi.unsureButton.click();
          break;
          // Hide/Unhide the label.
        case 'KeyH':
          if (svv.labelVisibilityControl.isVisible()) {
            svv.labelVisibilityControl.hideLabel();
            svv.tracker.push('KeyboardShortcut_HideLabel', { keyCode: e.keyCode });
          } else {
            svv.labelVisibilityControl.unhideLabel();
            svv.tracker.push('KeyboardShortcut_UnhideLabel', { keyCode: e.keyCode });
          }
          break;
          // Submit the validation.
        case 'KeyS':
          validationMenuUi.submitButton.click();
          break;
          // Undo the last validation.
        case 'KeyB':
          if (svv.undoValidation.canUndo()) {
            svv.ui.undoValidation.undoButton.click();
          }
          break;
          // Zoom in on 'Z', zoom out on 'Shift+Z'.
        case 'KeyZ':
          if (e.shiftKey) {
            // Zoom out
            svv.zoomControl.zoomOut();
            svv.tracker.push('KeyboardShortcut_ZoomOut', { keyCode: e.keyCode });
          } else {
            svv.zoomControl.zoomIn();
            svv.tracker.push('KeyboardShortcut_ZoomIn', { keyCode: e.keyCode });
          }
          break;
          // Severity shortcuts (1, 2, 3).
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
        case 'Numpad1':
        case 'Numpad2':
        case 'Numpad3':
          this.#handleNumberKeyShortcut(KeyboardManager.#digitOf(e), e);
          break;
          // '4' and '5' keys (Pick the fourth disagree reason, or focus the comment box).
        case 'Digit4':
        case 'Numpad4':
        case 'Digit5':
        case 'Numpad5':
          // The comment box is always the key one past the menu's last reason, so it moves from 4 to 5 on any label
          // type that offers a fourth reason, handled through #handleNumberKeyShortcut. Routed separately from 1-3 only
          // because of the Agree verdict, where it would reach for a severity button 4 or 5 that doesn't exist.
          if (validationMenuUi.noButton.classList.contains('chosen') && !this.#inWrongTypeView()) {
            this.#handleNumberKeyShortcut(KeyboardManager.#digitOf(e), e);
          } else {
            this.#handleCommentBoxShortcut(e);
          }
          break;
          // 'c' key (Focus comment box).
        case 'KeyC':
          this.#handleCommentBoxShortcut(e);
          break;
      }
    }
  };
}
