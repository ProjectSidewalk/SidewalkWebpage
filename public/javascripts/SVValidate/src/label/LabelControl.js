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
    var labelControlButton = $("#label-control-button");

    /**
     * Logs interaction when the hide label button is clicked.
     */
    function clickHideLabel () {
        svv.tracker.push("Click_HideLabel");
        hideLabel();
    }

    /**
     * Hides label in Google StreetView Panorama.
     */
    function hideLabel () {
        var backgroundColor;
        if (visible) {
            svv.panorama.hideLabel();
            backgroundColor = "#808080";
            visible = false;
        } else {
            svv.panorama.showLabel();
            backgroundColor = "";
            visible = true;
        }
        $("#label-control-button").css({
            "background": backgroundColor
        });
    }

    /**
     * Refreshes label visual state
     */
    function refreshLabel () {
        $("#label-control-button").css({
            "background": ""
        });
    }

    labelControlButton.on('click', clickHideLabel);

    self.hideLabel = hideLabel;
    self.refreshLabel = refreshLabel;

    return this;
}