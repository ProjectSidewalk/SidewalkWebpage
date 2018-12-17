function Keyboard(menuUI) {
    var self = this;

    var status = {
        keyPressed: false,
        disableKeyboard: false
    };

    function disableKeyboard () {
        status.disableKeyboard = true;
    }

    function enableKeyboard () {
        status.disableKeyboard = false;
    }

    this._documentKeyDown = function (e) {
        if (!status.disableKeyboard && !status.keyPressed) {
            switch (e.keyCode) {
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
                // "u" key
                case 85:
                    menuUI.notSureButton.css("background-color", "lightgrey");
                    svv.tracker.push("ValidationKeyboardShortcut_Unclear");
                    svv.panorama.getCurrentLabel().validate("Unclear");
                    status.keyPressed = true;
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
                // "u" key
                case 85:
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