function Keyboard(menuUI) {
    let self = this;
    let lastShiftKeyDownTimestamp = undefined;
    let status = {
        disableKeyboard: false,
        keyPressed: false,
        shiftDown: false,
        addingComment: false
    };

    function disableKeyboard () {
        status.disableKeyboard = true;
    }

    function enableKeyboard () {
        status.disableKeyboard = false;
    }

    // Set the addingComment status based on whether the user is currently typing in a validation comment text field.
    function checkIfTextAreaSelected() {
        if (document.activeElement === menuUI.comment ||
            (svv.newValidateBeta && document.activeElement === svv.ui.newValidateBeta.optionalCommentTextBox[0]) ||
            (svv.newValidateBeta && document.activeElement === svv.ui.newValidateBeta.disagreeReasonTextBox[0]) ||
            (svv.newValidateBeta && document.activeElement === svv.ui.newValidateBeta.unsureReasonTextBox[0]) ||
            (svv.newValidateBeta && document.activeElement === document.getElementById('select-tag-selectized'))||
            (menuUI && document.activeElement === svv.ui.validation.comment[0])) {
            status.addingComment = true
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
        let timestamp = new Date().getTime();
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
        if (svv.newValidateBeta) {
            svv.ui.newValidateBeta.yesButton.click();
        } else {
            let comment = menuUI.comment.val();
            validateLabel(menuUI.yesButton, "Agree", comment);
            menuUI.noButton.removeClass("validate");
            menuUI.unsureButton.removeClass("validate");
        }
    }

    function _disagreeShortcutPressed() {
        if (svv.newValidateBeta) {
            svv.ui.newValidateBeta.noButton.click();
        } else {
            let comment = menuUI.comment.val();
            validateLabel(menuUI.noButton, "Disagree", comment);
            menuUI.yesButton.removeClass("validate");
            menuUI.unsureButton.removeClass("validate");
        }
    }

    function _setSeverity(severity) {
        svv.ui.newValidateBeta.severityMenu.find(`#severity-button-${severity}`).click();
    }

    function _setDisagreeReason(reasonNumber) {
        if(svv.newValidateBeta){   
            svv.ui.newValidateBeta.disagreeReasonOptions.find(`#no-button-${reasonNumber}`).click();
        } else {
            menuUI.disagreeReasonOptions.find('.validation-reason-button').removeClass('chosen');
        }
    }

    function _setUnsureReason(reasonNumber) {
        if(svv.newValidateBeta){    
            svv.ui.newValidateBeta.unsureReasonOptions.find(`#unsure-button-${reasonNumber}`).click();
        } else {
            menuUI.unsureReasonOptions.find('.validation-reason-button').removeClass('chosen');
        }
    }

    function handleEscapeKey() {
        if (status.addingComment) {
            document.activeElement.blur();
            status.addingComment = false;
            svv.ui.newValidateBeta.disagreeReasonTextBox[0].blur();
            svv.ui.newValidateBeta.unsureReasonTextBox[0].blur();
        }
    }


    this._documentKeyDown = function (e) {
        // When the user is typing in the validation comment text field, temporarily disable keyboard
        // shortcuts that can be used to validate a label.
        checkIfTextAreaSelected();
        if (e.keyCode === 27) {
            handleEscapeKey();
            return;
        } else if (!status.disableKeyboard && !status.keyPressed && !status.addingComment) {
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
                    if (svv.newValidateBeta) {
                        svv.ui.newValidateBeta.unsureButton.click();
                    } else {
                        let comment = menuUI.comment.val();
                        validateLabel(menuUI.unsureButton, "Unsure", comment);
                        menuUI.yesButton.removeClass("validate");
                        menuUI.noButton.removeClass("validate");
                    }
                    break;
                // "s" key
                case 83:
                    if (svv.newValidateBeta) {
                        svv.ui.newValidateBeta.submitButton.click();
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
                    // "4" key
                case 52:
                    if (menuUI.noButton.hasClass('chosen') || menuUI.unsureButton.hasClass('chosen')) {
                        if (svv.newValidateBeta) {
                            menuUI.disagreeReasonTextBox.focus();
                            menuUI.unsureReasonTextBox.focus();
                        }
                    }
                    e.preventDefault();
                    break;
                // "1" key
                case 49:
                    if (menuUI.noButton.hasClass('chosen')) {
                        _setDisagreeReason(1);
                    } else if (menuUI.unsureButton.hasClass('chosen')){
                        _setUnsureReason(1);
                    } else if (menuUI.yesButton.hasClass('chosen')){
                        _setSeverity(1);
                    }
                    break;
                // "2" key
                case 50:
                    if (menuUI.noButton.hasClass('chosen')) {
                        _setDisagreeReason(2);
                    } else if (menuUI.unsureButton.hasClass('chosen')){
                        _setUnsureReason(2);
                    } else if (menuUI.yesButton.hasClass('chosen')){
                        _setSeverity(2);
                    }
                    break;
                // "3" key
                case 51:
                    if (menuUI.noButton.hasClass('chosen')) {
                        _setDisagreeReason(3);
                    } else if (menuUI.unsureButton.hasClass('chosen')){
                        _setUnsureReason(3);
                    } else if (menuUI.yesButton.hasClass('chosen')){
                        _setSeverity(3);
                    }
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
