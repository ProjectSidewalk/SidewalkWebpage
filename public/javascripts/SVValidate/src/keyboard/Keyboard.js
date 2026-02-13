function Keyboard(menuUI) {
    const self = this;
    let status = {
        disableKeyboard: false,
        keyPressed: false,
        addingComment: false
    };

    // Add keydown listeners to the text boxes because escape
    // key press is not being recognized when selected input text.
    function handleEscapeKey(e) {
        if (e.keyCode === 27) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.blur();
            svv.tracker.push('KeyboardShortcut_UnfocusComment', { keyCode: e.keyCode });
        }
    }

    // Attach the same function to all three text boxes.
    if (svv.expertValidate) {
        menuUI.optionalCommentTextBox.on('keydown', handleEscapeKey);
        menuUI.disagreeReasonTextBox.on('keydown', handleEscapeKey);
        menuUI.unsureReasonTextBox.on('keydown', handleEscapeKey);
    } else {
        menuUI.comment.on('keydown', handleEscapeKey);
    }

    function disableKeyboard () {
        status.disableKeyboard = true;
    }

    function enableKeyboard () {
        status.disableKeyboard = false;
    }

    // Set the addingComment status based on whether the user is currently typing in a validation comment text field.
    function checkIfTextAreaSelected() {
        // Check if menuUI.comment exists and has a valid element.
        if (menuUI.comment && menuUI.comment[0] && document.activeElement === menuUI.comment[0]) {
            status.addingComment = true;
        } else if (svv.expertValidate) {
            // Check if expertValidate text boxes are focused.
            if (document.activeElement === svv.ui.expertValidate.optionalCommentTextBox[0] ||
                document.activeElement === svv.ui.expertValidate.disagreeReasonTextBox[0] ||
                document.activeElement === svv.ui.expertValidate.unsureReasonTextBox[0] ||
                document.activeElement === document.getElementById('select-tag-selectized')) {
                status.addingComment = true;
            } else {
                status.addingComment = false;
            }
        } else {
            status.addingComment = false
        }
    }

    /**
     * Validate a single label using keyboard shortcuts.
     *
     * @param {jQuery} button jQuery element for the button clicked.
     * @param {string} action Validation action. Must be either agree, disagree, or unsure.
     * @param {string} comment The user's comment associated with the label.
     */
    function validateLabel(button, action, comment) {
        // Want at least 800ms in-between to allow Panorama to load. (Value determined experimentally).
        // It does not look like GSV supports any listeners that will check when the pano is fully loaded yet.
        // TODO changing the pano through PanoViewer now returns a Promise that resolves when it's finished loading.
        let timestamp = new Date();
        if (timestamp - svv.labelContainer.getProperty('validationTimestamp') > 800) {
            button.toggleClass('validate');
            svv.tracker.push('ValidationKeyboardShortcut_' + action);
            svv.labelContainer.getCurrentLabel().validate(action, comment);
            svv.labelContainer.setProperty('validationTimestamp', timestamp);
            status.keyPressed = true;
        }
    }

    /**
     * Removes the visual effect of the buttons being pressed down.
     */
    function removeAllKeyPressVisualEffect () {
        menuUI.yesButton.removeClass('validate');
        menuUI.noButton.removeClass('validate');
        menuUI.unsureButton.removeClass('validate');
        status.keyPressed = false;
    }

    function _agreeShortcutPressed() {
        if (svv.expertValidate) {
            svv.ui.expertValidate.yesButton.click();
        } else {
            let comment = menuUI.comment.val();
            validateLabel(menuUI.yesButton, 'Agree', comment);
            menuUI.noButton.removeClass('validate');
            menuUI.unsureButton.removeClass('validate');
        }
    }

    function _disagreeShortcutPressed() {
        if (svv.expertValidate) {
            svv.ui.expertValidate.noButton.click();
        } else {
            let comment = menuUI.comment.val();
            validateLabel(menuUI.noButton, 'Disagree', comment);
            menuUI.yesButton.removeClass('validate');
            menuUI.unsureButton.removeClass('validate');
        }
    }

    // Handles the logic for the 1, 2, and 3 key shortcuts.
    function handleNumberKeyShortcut(n, e) {
        if (menuUI.yesButton.hasClass('chosen')) {
            $(`#severity-button-${n}`).click();
        } else if (menuUI.noButton.hasClass('chosen')) {
            const buttonId = `#no-button-${n}`;
            // If there's no default disagree option for this key, focus on the comment box, otherwise click the button.
            if (!$(buttonId).hasClass('defaultOption')) {
                e.preventDefault();
                menuUI.disagreeReasonTextBox.click();
            } else {
                $(buttonId).click();
            }
        } else if (menuUI.unsureButton.hasClass('chosen')) {
            const buttonId = `#unsure-button-${n}`;
            // If there's no default unsure option for key 2 or 3, focus on the comment box, otherwise click the button.
            if (!$(buttonId).hasClass('defaultOption')) {
                e.preventDefault();
                menuUI.unsureReasonTextBox.click();
            } else {
                $(buttonId).click();
            }
        }
    }

    function handleCommentBoxShortcut(e) {
        e.preventDefault();
        if (!svv.expertValidate) {
            menuUI.comment.focus();
        } else if (menuUI.yesButton.hasClass('chosen')) {
            menuUI.optionalCommentTextBox.click();
        } else if (menuUI.noButton.hasClass('chosen')) {
            menuUI.disagreeReasonTextBox.click();
        } else if (menuUI.unsureButton.hasClass('chosen')) {
            menuUI.unsureReasonTextBox.click();
        }
    }

    this._documentKeyDown = function (e) {
        // Prevent pano viewer's default panning and moving using arrow keys and WASD.
        if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(e.code) > -1) {
            e.stopPropagation();
        }

        // When the user is typing in the validation comment text field, temporarily disable keyboard
        // shortcuts that can be used to validate a label.
        checkIfTextAreaSelected();
        if (!status.disableKeyboard && !status.keyPressed && !status.addingComment) {
            svv.labelVisibilityControl.hideTagsAndDeleteButton();
            switch (e.code) {
                // Validate yes/agree.
                case 'KeyY':
                case 'KeyA':
                    _agreeShortcutPressed();
                    break;
                // Validate no/disagree.
                case 'KeyN':
                case 'KeyD':
                    _disagreeShortcutPressed();
                    break;
                // Validate unsure.
                case 'KeyU':
                    if (svv.expertValidate) {
                        svv.ui.expertValidate.unsureButton.click();
                    } else {
                        let comment = menuUI.comment.val();
                        validateLabel(menuUI.unsureButton, 'Unsure', comment);
                        menuUI.yesButton.removeClass('validate');
                        menuUI.noButton.removeClass('validate');
                    }
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
                    if (svv.expertValidate) {
                        svv.ui.expertValidate.submitButton.click();
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

    this._documentKeyUp = function (e) {
        if (!status.disableKeyboard && !status.addingComment) {
            switch (e.code) {
                // Remove the button press CSS class on key up for the validation buttons.
                // TODO would rather use the Promise that resolves when next label has loaded to remove the class.
                case 'KeyY':
                case 'KeyA':
                    menuUI.yesButton.removeClass('validate');
                    status.keyPressed = false;
                    break;
                case 'KeyN':
                case 'KeyD':
                    menuUI.noButton.removeClass('validate');
                    status.keyPressed = false;
                    break;
                case 'KeyU':
                    menuUI.unsureButton.removeClass('validate');
                    status.keyPressed = false;
                    break;
            }
        }
    };

    // Add the keyboard event listeners. We need { capture: true } for keydown to disable pano's shortcuts.
    window.addEventListener('keydown', this._documentKeyDown, { capture: true });
    window.addEventListener('keyup', this._documentKeyUp);

    self.disableKeyboard = disableKeyboard;
    self.enableKeyboard = enableKeyboard;
    self.removeAllKeyPressVisualEffect = removeAllKeyPressVisualEffect;

    return this;
}
