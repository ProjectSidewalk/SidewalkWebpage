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
        if (visible) {
            svv.panorama.hideLabel();
            visible = false;
        } else {
            svv.panorama.showLabel();
            visible = true;
        }
    }

    labelControlButton.on('click', clickHideLabel);

    self.hideLabel = hideLabel;

    return this;
}