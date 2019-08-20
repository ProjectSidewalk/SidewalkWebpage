/**
 * Handles the hiding and showing of labels in the Google StreetView panorama.
 * This is also called by the Keyboard class to deal with hiding the label
 * via keyboard shortcuts.
 * @returns {LabelVisibilityControl}
 * @constructor
 */
function LabelVisibilityControl () {
    let self = this;
    let visible = true;
    let labelVisibilityControlButton = $("#label-visibility-control-button");
    let labelVisibilityButtonInPano = $("#label-visibility-button-in-pano");

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
        let htmlString = `<u>H</u>ide Label</button>`;
        labelVisibilityButtonInPano.html(htmlString);
        htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br /><u>H</u>ide Label</button>`;
	labelVisibilityControlButton.html(htmlString);
    }

    /**
     * Hides label in Google StreetView Panorama.
     */
    function hideLabel () {
        var panomarker = svv.panorama.getPanomarker();
	panomarker.setIcon("assets/javascripts/SVLabel/img/icons/Label_Outline.svg");
	panomarker.draw();
        visible = false;
        let htmlString = `S<u>h</u>ow Label</button>`;
        labelVisibilityButtonInPano.html(htmlString);
	htmlString = `<img src="assets/javascripts/SVValidate/img/ShowLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br />S<u>h</u>ow Label</button>`;
	labelVisibilityControlButton.html(htmlString);
    }

    /**
     * Refreshes label visual state
     */
    function refreshLabel () {
        let htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
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
        var button = document.getElementById("label-visibility-button-in-pano");
	var marker = document.getElementById("validate-pano-marker");
        button.style.left = (parseFloat(marker.style.left) + 10) + 'px';
        button.style.top = (parseFloat(marker.style.top) - 15) + 'px';
	button.style.visibility = 'visible';
    }

    function hide () {
        document.getElementById("label-visibility-button-in-pano").style.visibility = 'hidden';

    }

    labelVisibilityControlButton.on('click', clickAdjustLabel);
    labelVisibilityButtonInPano.on('click', clickAdjustLabel);
    labelVisibilityButtonInPano.on('mouseover', function (e) {
	show();
	e.stopPropagation();
    });
    labelVisibilityButtonInPano.on('mouseout', hide);

    self.hideLabel = hideLabel;
    self.unhideLabel = unhideLabel;
    self.refreshLabel = refreshLabel;
    self.isVisible = isVisible;
    self.show = show;
    self.hide = hide;

    return this;

}
