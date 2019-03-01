/**
 * Handles the hiding and showing of labels in the Google StreetView panorama.
 * This is also called by the Keyboard class to deal with hiding the label
 * via keyboard shortcuts.
 * @returns {LabelControl}
 * @constructor
 */
function LabelControl () {
    var self = this;
    var visible = true;
    var labelControlButton = $("#label-visibility-control-button");

    /**
     * Logs interaction when the hide label button is clicked.
     */
    function clickAdjustLabel () {
        if (visible) {
            svv.tracker.push("Click_HideLabel");
            hideLabel();
        } else {
            svv.tracker.push("Click_UnhideLabel");
            unhideLabel();
        }
    }

    /**
     * Unhides label in Google StreetView Panorama
     * depending on current state.
     */
    function unhideLabel () {
        svv.panorama.showLabel();
        backgroundColor = "";
        visible = true;
    }

    /**
     * Hides label in Google StreetView Panorama.
     */
    function hideLabel () {
        svv.panorama.hideLabel();
        var backgroundColor = "#808080";
        visible = false;
        $("#label-visibility-control-button").css({
            "background": backgroundColor
        });
    }

    /**
     * Refreshes label visual state
     */
    function refreshLabel () {
        $("#label-visibility-control-button").css({
            "background": ""
        });
    }

    function isVisible () {
        return visible;
    }

    labelControlButton.on('click', clickAdjustLabel);

    self.hideLabel = hideLabel;
    self.unhideLabel = unhideLabel;
    self.refreshLabel = refreshLabel;
    self.isVisible = isVisible;

    return this;

}
