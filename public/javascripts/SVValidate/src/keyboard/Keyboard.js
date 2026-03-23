function Keyboard(validationMenuUi) {
    const self = this;
    let status = {
        disableKeyboard: false,
        addingComment: false
    };

    // Add keydown listeners to the text boxes because esc key press is not being recognized when selected input text.
    function handleEscapeKey(e) {
        if (e.keyCode === 27) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.blur();
            svv.tracker.push('KeyboardShortcut_UnfocusComment', { keyCode: e.keyCode });
        }
    }

    // Attach the same function to all three text boxes.
    validationMenuUi.optionalCommentTextBox.on('keydown', handleEscapeKey);
    validationMenuUi.disagreeReasonTextBox.on('keydown', handleEscapeKey);
    validationMenuUi.unsureReasonTextBox.on('keydown', handleEscapeKey);

    function disableKeyboard () {
        status.disableKeyboard = true;
    }

    function enableKeyboard () {
        status.disableKeyboard = false;
    }

    // Set the addingComment status based on whether the user is currently typing in a validation comment text field.
    function checkIfTextAreaSelected() {
        // Check if expertValidate text boxes are focused.
        if (document.activeElement === validationMenuUi.optionalCommentTextBox[0] ||
            document.activeElement === validationMenuUi.disagreeReasonTextBox[0] ||
            document.activeElement === validationMenuUi.unsureReasonTextBox[0] ||
            document.activeElement === document.getElementById('select-tag-selectized')) {
            status.addingComment = true;
        } else {
            status.addingComment = false;
        }
    }

    /**
     * Handles the logic for the 1, 2, and 3 key shortcuts.
     * @param {number} n The keyboard shortcut number that was hit (1, 2, or 3)
     * @param {Event} e The keypress event
     */
    function handleNumberKeyShortcut(n, e) {
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
     * @param {Event} e The keypress event
     */
    function handleCommentBoxShortcut(e) {
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
     * @private
     */
    this._documentKeyDown = function (e) {
        // When the user is typing in a comment box, disable keyboard shortcuts that can be used to validate a label.
        checkIfTextAreaSelected();

        // Handle the various keyboard shortcuts.
        // Enter submits validation regardless of whether a text box is focused.
        if (!status.disableKeyboard && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
            e.preventDefault();
            validationMenuUi.submitButton.click();
        }

        if (!status.disableKeyboard && !status.addingComment && !e.ctrlKey) {
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
                    handleNumberKeyShortcut(parseInt(e.key), e);
                    break;
                // '4' or 'c' key (Focus comment box)
                case 'Digit4':
                case 'Numpad4':
                case 'KeyC':
                    handleCommentBoxShortcut(e);
                    break;
            }
        }
    };

    // Add the keyboard event listeners. We need { capture: true } for keydown to overwrite pano's shortcuts.
    window.addEventListener('keydown', this._documentKeyDown, { capture: true });

    self.disableKeyboard = disableKeyboard;
    self.enableKeyboard = enableKeyboard;

    return this;
}
