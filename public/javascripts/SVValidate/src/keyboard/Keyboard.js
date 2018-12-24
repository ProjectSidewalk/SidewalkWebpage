function Keyboard(menuUI) {
    var self = this;
    var lastShiftKeyUpTimestamp = undefined;
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

    this._documentKeyDown = function (e) {
        if (!status.disableKeyboard && !status.keyPressed) {
            status.shiftDown = e.shiftKey;
            switch (e.keyCode) {
                // shift key
                case 16:
                    // Store the timestamp here so that we can check if the z-up event is
                    // within the buffer range
                    lastShiftKeyUpTimestamp = e.timeStamp;
                    break;
                // "a" key
                case 65:
                    menuUI.agreeButton.css("background-color", "lightgrey");
                    svv.tracker.push("ValidationKeyboardShortcut_Agree");
                    svv.panorama.getCurrentLabel().validate("Agree");
                    status.keyPressed = true;
                    break;
                // "d" key
                case 68:
                    menuUI.disagreeButton.css("background-color", "lightgrey");
                    svv.tracker.push("ValidationKeyboardShortcut_Disagree");
                    svv.panorama.getCurrentLabel().validate("Disagree");
                    status.keyPressed = true;
                    break;
                // "n" key
                case 78:
                    menuUI.notSureButton.css("background-color", "lightgrey");
                    svv.tracker.push("ValidationKeyboardShortcut_NotSure");
                    svv.panorama.getCurrentLabel().validate("NotSure");
                    status.keyPressed = true;
                    break;
                // "z" key
                case 90:
                    // Zoom out when shift + z keys are pressed.
                    if (status.shiftDown || (e.timeStamp - lastShiftKeyUpTimestamp) < 100) {
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
                    menuUI.agreeButton.css("background-color", "white");
                    status.keyPressed = false;
                    break;
                // "d" key
                case 68:
                    menuUI.disagreeButton.css("background-color", "white");
                    status.keyPressed = false;
                    break;
                // "n" key
                case 78:
                    menuUI.notSureButton.css("background-color", "white");
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