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
    var labelVisibilityButton = $("#label-visibility-button");
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
	var panomarker = svv.panorama.getPanomarker();
	var label = svv.panorama.getCurrentLabel();
	panomarker.setIcon(label.getIconUrl());
        panomarker.draw();
        visible = true;
        var htmlString = `<u>H</u>ide Label</button>`;
        $("#label-visibility-control-button").html(htmlString);
        htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-button-icon" alt="Hide Label">
        <br /><u>H</u>ide Label</button>`;
	labelVisibilityButton.html(htmlString);
    }

    /**
     * Hides label in Google StreetView Panorama.
     */
    function hideLabel () {
        var panomarker = svv.panorama.getPanomarker();
	panomarker.setIcon("assets/javascripts/SVLabel/img/icons/LabelOutline.svg");
	panomarker.draw();
        visible = false;
        var htmlString = `S<u>h</u>ow Label</button>`;
        $("#label-visibility-control-button").html(htmlString);
	htmlString = `<img src="assets/javascripts/SVValidate/img/ShowLabel.svg" class="label-visibility-button-icon" alt="Hide Label">
        <br />S<u>h</u>ow Label</button>`;
	labelVisibilityButton.html(htmlString);
    }

    /**
     * Refreshes label visual state
     */
    function refreshLabel () {
        var htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-button-icon" alt="Hide Label">
        <br /><u>H</u>ide Label</button>`;
        $("#label-visibility-button").html(htmlString);
        $("#label-visibility-button").css({
            "background": ""
        });
    }

    function isVisible () {
        return visible;
    }

    function show () {
        var button = document.getElementById("label-visibility-control-button");
	var marker = document.getElementById("validate-pano-marker");
        button.style.left = (parseFloat(marker.style.left) + 10) + 'px';
        button.style.top = (parseFloat(marker.style.top) - 15) + 'px';
	button.style.visibility = 'visible';
    }

    function hide () {
        document.getElementById("label-visibility-control-button").style.visibility = 'hidden';

    }

    labelVisibilityControlButton.on('click', clickAdjustLabel);
    labelVisibilityButton.on('click', clickAdjustLabel);
    labelVisibilityControlButton.on('mouseover', function (e) {
	show();
	e.stopPropagation();
    });
    labelVisibilityControlButton.on('mouseout', hide);

    self.hideLabel = hideLabel;
    self.unhideLabel = unhideLabel;
    self.refreshLabel = refreshLabel;
    self.isVisible = isVisible;
    self.show = show;
    self.hide = hide;

    return this;

}
