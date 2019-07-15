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
        visible = true;
        var htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br /><u>H</u>ide Label</button>`;
        $("#label-visibility-control-button").html(htmlString);
    }

    /**
     * Hides label in Google StreetView Panorama.
     */
    function hideLabel () {
        svv.panorama.hideLabel();
        visible = false;
        var htmlString = `<img src="assets/javascripts/SVValidate/img/ShowLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br />S<u>h</u>ow Label</button>`;
        $("#label-visibility-control-button").html(htmlString);
    }

    /**
     * Refreshes label visual state
     */
    function refreshLabel () {
        var htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br /><u>H</u>ide Label</button>`;
        $("#label-visibility-control-button").html(htmlString);
        $("#label-visibility-control-button").css({
            "background": ""
        });
    }

    function isVisible () {
        return visible;
    }

    function show () {
        var button = document.getElementById('label-description');
	    var marker = document.getElementById('validate-pano-marker');
        button.style.left = (parseFloat(marker.style.left) - 120) + 'px';
        button.style.top = (parseFloat(marker.style.top) + 10) + 'px';
	    button.style.visibility = 'visible';
    }

    function hide () {
        document.getElementById("label-description").style.visibility = 'hidden';
    }

    labelVisibilityControlButton.on('click', clickAdjustLabel);
    labelVisibilityControlButton.on('mouseover', function (e) {
        document.getElementById('label-description').style.display = 'none';
    	show();
    	e.stopPropagation();
    });
    labelVisibilityControlButton.on('mouseout', function (e) {
        document.getElementById('label-description').style.display = 'block';
        hide();
        e.stopPropagation();
    });

    self.hideLabel = hideLabel;
    self.unhideLabel = unhideLabel;
    self.refreshLabel = refreshLabel;
    self.isVisible = isVisible;
    self.show = show;
    self.hide = hide;

    return this;

}
