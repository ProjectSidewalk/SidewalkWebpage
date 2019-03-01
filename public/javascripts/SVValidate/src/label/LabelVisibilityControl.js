/**
 * Handles the hiding and showing of labels in the Google StreetView panorama.
 * This is also called by the Keyboard class to deal with hiding the label
 * via keyboard shortcuts.
 * @returns {LabelVisibilityControl}
 * @constructor
 */
function LabelVisibilityControl () {
    var self = this;
    var visible = true;
    var labelVisibilityControlButton = $("#label-visibility-control-button");

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
        $("#label-visibility-control-button").css({
            "background": backgroundColor
        });
        var htmlString = '<img src="/assets/javascripts/SVValidate/img/HideLabel.svg")" class="label-visibility-control-button-icon" alt="Hide Label">';
        ("#label-visibility-control-button-icon").html(htmlString);
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
        var htmlString = '<img src="/assets/javascripts/SVValidate/img/ShowLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">';
        ("#label-visibility-control-button-icon").html(htmlString);
    }

    /**
     * Refreshes label visual state
     */
    function refreshLabel () {
        $("#label-visibility-control-button").css({
            "background": ""
        });
        var htmlString = '<img src="/assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">';
        ("#label-visibility-control-button-icon").html(htmlString);
    }

    function isVisible () {
        return visible;
    }

    labelVisibilityControlButton.on('click', clickAdjustLabel);

    self.hideLabel = hideLabel;
    self.unhideLabel = unhideLabel;
    self.refreshLabel = refreshLabel;
    self.isVisible = isVisible;

    return this;

}
