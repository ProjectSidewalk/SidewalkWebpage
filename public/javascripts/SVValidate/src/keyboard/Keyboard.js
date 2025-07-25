function Keyboard(menuUI) {
    let self = this;
    let lastShiftKeyDownTimestamp = undefined;
    let status = {
        disableKeyboard: false,
        keyPressed: false,
        shiftDown: false,
        addingComment: false
    };

    // Add keydown listeners to the text boxes because escape
    // key press is not being recognized when selected input text.
    function handleEscapeKey(e) {
        if (e.keyCode === 27) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.blur();
            svv.tracker.push("KeyboardShortcut_UnfocusComment", { keyCode: e.keyCode });
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
     * @param button    jQuery element for the button clicked.
     * @param action    {String} Validation action. Must be either agree, disagree, or unsure.
     */
    function validateLabel(button, action, comment) {
        // Want at least 800ms in-between to allow GSV Panorama to load. (Value determined
        // experimentally).

        // It does not look like GSV StreetView supports any listeners that will check when the
        // panorama is fully loaded yet.
        let timestamp = new Date();
        if (timestamp - svv.panorama.getProperty('validationTimestamp') > 800) {
            button.toggleClass("validate");
            svv.tracker.push("ValidationKeyboardShortcut_" + action);
            svv.panorama.getCurrentLabel().validate(action, comment);
            svv.panorama.setProperty('validationTimestamp', timestamp);
            status.keyPressed = true;
        }
    }

    /**
     * Removes the visual effect of the buttons being pressed down.
     */
    function removeAllKeyPressVisualEffect () {
        menuUI.yesButton.removeClass("validate");
        menuUI.noButton.removeClass("validate");
        menuUI.unsureButton.removeClass("validate");
        status.keyPressed = false;
    }

    function _agreeShortcutPressed() {
        if (svv.expertValidate) {
            svv.ui.expertValidate.yesButton.click();
        } else {
            let comment = menuUI.comment.val();
            validateLabel(menuUI.yesButton, "Agree", comment);
            menuUI.noButton.removeClass("validate");
            menuUI.unsureButton.removeClass("validate");
        }
    }

    function _disagreeShortcutPressed() {
        if (svv.expertValidate) {
            svv.ui.expertValidate.noButton.click();
        } else {
            let comment = menuUI.comment.val();
            validateLabel(menuUI.noButton, "Disagree", comment);
            menuUI.yesButton.removeClass("validate");
            menuUI.unsureButton.removeClass("validate");
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
        // When the user is typing in the validation comment text field, temporarily disable keyboard
        // shortcuts that can be used to validate a label.
        checkIfTextAreaSelected();
        if (!status.disableKeyboard && !status.keyPressed && !status.addingComment) {
            status.shiftDown = e.shiftKey;
            svv.labelVisibilityControl.hideTagsAndDeleteButton();
            switch (e.keyCode) {
                // shift key
                case 16:
                    // Store the timestamp here so that we can check if the z-up event is
                    // within the buffer range
                    lastShiftKeyDownTimestamp = e.timeStamp;
                    break;
                // "y" key
                case 89:
                    _agreeShortcutPressed();
                    break;
                // "a" key (keeping old "agree" shortcut for backwards compatibility)
                case 65:
                    _agreeShortcutPressed();
                    break;
                // "n" key
                case 78:
                    _disagreeShortcutPressed();
                    break;
                // "d" key (keeping old "disagree" shortcut for backwards compatibility)
                case 68:
                    _disagreeShortcutPressed();
                    break;
                // "h" key
                case 72:
                    if (svv.labelVisibilityControl.isVisible()) {
                        svv.labelVisibilityControl.hideLabel();
                        svv.tracker.push("KeyboardShortcut_HideLabel", {
                            keyCode: e.keyCode
                        });
                    } else {
                        svv.labelVisibilityControl.unhideLabel();
                        svv.tracker.push("KeyboardShortcut_UnhideLabel", {
                            keyCode: e.keyCode
                        });
                    }
                    break;
                // "u" key
                case 85:
                    if (svv.expertValidate) {
                        svv.ui.expertValidate.unsureButton.click();
                    } else {
                        let comment = menuUI.comment.val();
                        validateLabel(menuUI.unsureButton, "Unsure", comment);
                        menuUI.yesButton.removeClass("validate");
                        menuUI.noButton.removeClass("validate");
                    }
                    break;
                // "s" key
                case 83:
                    if (svv.expertValidate) {
                        svv.ui.expertValidate.submitButton.click();
                    }
                    break;
                // "z" key
                case 90:
                    // Zoom out when shift + z keys are pressed.
                    if (status.shiftDown || (e.timeStamp - lastShiftKeyDownTimestamp) < 100) {
                        // Zoom out
                        svv.zoomControl.zoomOut();
                        svv.tracker.push("KeyboardShortcut_ZoomOut", {
                            keyCode: e.keyCode
                        });
                    // Zoom in when just the z key is pressed.
                    } else {
                        svv.zoomControl.zoomIn();
                        svv.tracker.push("KeyboardShortcut_ZoomIn", {
                            keyCode: e.keyCode
                        });
                    }
                    break;
                // Severity shortcuts (1, 2, 3)
                case 49: // "1"
                case 97: // Numpad "1"
                    handleNumberKeyShortcut(1, e);
                    break;

                case 50: // "2"
                case 98: // Numpad "2"
                    handleNumberKeyShortcut(2, e);
                    break;

                case 51: // "3"
                case 99: // Numpad "3"
                    handleNumberKeyShortcut(3, e);
                    break;

                // "4" or "c" key (Focus comment box)
                case 52: // "4"
                case 100: // Numpad "4"
                case 67: // "c"
                    handleCommentBoxShortcut(e);
                    break;
            }
        }
    };

    this._documentKeyUp = function (e) {
        if (!status.disableKeyboard && !status.addingComment) {
            switch (e.keyCode) {
                // "y" key
                case 89:
                    menuUI.yesButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
                // "a" key
                case 65:
                    menuUI.yesButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
                // "n" key
                case 78:
                    menuUI.noButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
                // "d" key
                case 68:
                    menuUI.noButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
                // "u" key
                case 85:
                    menuUI.unsureButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
            }
        }
    };

    $(document).bind('keyup', this._documentKeyUp);
    $(document).bind('keydown', this._documentKeyDown);

    self.disableKeyboard = disableKeyboard;
    self.enableKeyboard = enableKeyboard;
    self.removeAllKeyPressVisualEffect = removeAllKeyPressVisualEffect;

    return this;
}
