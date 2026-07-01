/**
 * Handles keyboard shortcuts for the validation interface.
 */
class Keyboard {
    #validationMenuUi;
    #disableKeyboard = false;
    #addingComment = false;

    /**
     * @param {object} validationMenuUi Validation menu UI elements.
     */
    constructor(validationMenuUi) {
        this.#validationMenuUi = validationMenuUi;

        // Add keydown listeners to the text boxes because esc key press is not being recognized when selected input text.
        validationMenuUi.optionalCommentTextBox.on('keydown', this.#handleEscapeKey);
        validationMenuUi.disagreeReasonTextBox.on('keydown', this.#handleEscapeKey);
        validationMenuUi.unsureReasonTextBox.on('keydown', this.#handleEscapeKey);

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
        if (document.activeElement === validationMenuUi.optionalCommentTextBox[0] ||
            document.activeElement === validationMenuUi.disagreeReasonTextBox[0] ||
            document.activeElement === validationMenuUi.unsureReasonTextBox[0] ||
            document.activeElement === document.getElementById('select-tag-selectized')) {
            this.#addingComment = true;
        } else {
            this.#addingComment = false;
        }
    }

    /**
     * Handles the logic for the 1, 2, and 3 key shortcuts.
     * @param {number} n The keyboard shortcut number that was hit (1, 2, or 3).
     * @param {Event} e The keypress event.
     */
    #handleNumberKeyShortcut(n, e) {
        const validationMenuUi = this.#validationMenuUi;
        if (validationMenuUi.yesButton.hasClass('chosen')) {
            if (svv.adminVersion) $(`#severity-button-${n}`).click();
        } else if (validationMenuUi.noButton.hasClass('chosen')) {
            const buttonId = `#no-button-${n}`;
            // If there's no default disagree option for this key, focus on the comment box, otherwise click the button.
            if (!$(buttonId).hasClass('defaultOption')) {
                e.preventDefault();
                validationMenuUi.disagreeReasonTextBox.click();
            } else {
                $(buttonId).click();
            }
        } else if (validationMenuUi.unsureButton.hasClass('chosen')) {
            const buttonId = `#unsure-button-${n}`;
            // If there's no default unsure option for key 2 or 3, focus on the comment box, otherwise click the button.
            if (!$(buttonId).hasClass('defaultOption')) {
                e.preventDefault();
                validationMenuUi.unsureReasonTextBox.click();
            } else {
                $(buttonId).click();
            }
        }
    }

    /**
     * Sets focus to the appropriate comment box, depending on which validation option has been selected.
     *
     * @param {Event} e The keypress event.
     */
    #handleCommentBoxShortcut(e) {
        const validationMenuUi = this.#validationMenuUi;
        e.preventDefault();
        if (validationMenuUi.yesButton.hasClass('chosen')) {
            validationMenuUi.optionalCommentTextBox.click();
        } else if (validationMenuUi.noButton.hasClass('chosen')) {
            validationMenuUi.disagreeReasonTextBox.click();
        } else if (validationMenuUi.unsureButton.hasClass('chosen')) {
            validationMenuUi.unsureReasonTextBox.click();
        }
    }

    /**
     * Handles keyboard shortcuts by listening to the keydown event.
     *
     * @param {Event} e
     */
    #documentKeyDown = (e) => {
        const validationMenuUi = this.#validationMenuUi;
        // When the user is typing in a comment box, disable keyboard shortcuts that validate a label.
        this.#checkIfTextAreaSelected();

        // Handle the various keyboard shortcuts.
        // Enter submits validation regardless of whether a text box is focused.
        if (!this.#disableKeyboard && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
            e.preventDefault();
            validationMenuUi.submitButton.click();
        }

        if (!this.#disableKeyboard && !this.#addingComment && !e.ctrlKey) {
            svv.labelVisibilityControl.hideTagsAndDeleteButton();
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
                    this.#handleNumberKeyShortcut(parseInt(e.key), e);
                    break;
                // '4' or 'c' key (Focus comment box)
                case 'Digit4':
                case 'Numpad4':
                case 'KeyC':
                    this.#handleCommentBoxShortcut(e);
                    break;
            }
        }
    };
}
