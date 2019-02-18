function Keyboard(menuUI) {
    var self = this;
    var lastShiftKeyDownTimestamp = undefined;
    var status = {
        disableKeyboard: false,
        keyPressed: false,
        shiftDown: false
    };

    function disableKeyboard () {
        status.disableKeyboard = true;
    }

    function enableKeyboard () {
        status.disableKeyboard = false;
    }

    /**
     * Validate a single label using keyboard shortcuts.
     * @param button    jQuery element for the button clicked.
     * @param action    {String} Validation action. Must be either agree, disagree, or not sure.
     */
    function validateLabel (button, action) {
        // Want at least 800ms in-between to allow GSV Panorama to load. (Value determined
        // experimentally).

        // It does not look like GSV StreetView supports any listeners that will check when the
        // panorama is fully loaded yet.
        var timestamp = new Date().getTime();
        if (timestamp - svv.panorama.getProperty('validationTimestamp') > 800) {
            button.toggleClass("validate");
            svv.tracker.push("ValidationKeyboardShortcut_" + action);
            svv.panorama.getCurrentLabel().validate(action);
            svv.panorama.setProperty('validationTimestamp', timestamp);
            status.keyPressed = true;
        }
    }

    this._documentKeyDown = function (e) {
        if (!status.disableKeyboard && !status.keyPressed) {
            status.shiftDown = e.shiftKey;
            switch (e.keyCode) {
                // shift key
                case 16:
                    // Store the timestamp here so that we can check if the z-up event is
                    // within the buffer range
                    lastShiftKeyDownTimestamp = e.timeStamp;
                    break;
                // "a" key
                case 65:
                    validateLabel(menuUI.agreeButton, "Agree");
                    menuUI.disagreeButton.removeClass("validate");
                    menuUI.notSureButton.removeClass("validate");
                    break;
                // "d" key
                case 68:
                    validateLabel(menuUI.disagreeButton, "Disagree");
                    menuUI.agreeButton.removeClass("validate");
                    menuUI.notSureButton.removeClass("validate");
                    break;
                // "n" key
                case 78:
                    validateLabel(menuUI.notSureButton, "NotSure");
                    menuUI.agreeButton.removeClass("validate");
                    menuUI.disagreeButton.removeClass("validate");
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
            }
        }
    };

    this._documentKeyUp = function (e) {
        if (!status.disableKeyboard) {
            switch (e.keyCode) {
                // "a" key
                case 65:
                    menuUI.agreeButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
                // "d" key
                case 68:
                    menuUI.disagreeButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
                // "n" key
                case 78:
                    menuUI.notSureButton.removeClass("validate");
                    status.keyPressed = false;
                    break;
            }
        }
    };

    $(document).bind('keyup', this._documentKeyUp);
    $(document).bind('keydown', this._documentKeyDown);

    self.disableKeyboard = disableKeyboard;
    self.enableKeyboard = enableKeyboard;

    return this;
}
