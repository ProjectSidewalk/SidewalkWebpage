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
    let labelVisibilityButtonOnPano = $("#label-visibility-button-on-pano");

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
        labelVisibilityButtonOnPano.html(htmlString);
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
        labelVisibilityButtonOnPano.html(htmlString);
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

    /**
     * Returns true if label is currently not hidden, false otherwise.
     */
    function isVisible () {
        return visible;
    }

/*
    function show () {
        var button = document.getElementById('label-description');
	    var marker = document.getElementById('validate-pano-marker');
        button.style.right = (710 - parseFloat(marker.style.left)) + 'px';
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
*/

    /**
     * Shows the 'Show/Hide Label' button and the description box on panorama.
     */
    function show () {
        var button = document.getElementById("label-visibility-button-on-pano");
        var desBox = document.getElementById('label-description');
	var marker = document.getElementById("validate-pano-marker");

        button.style.left = (parseFloat(marker.style.left) + 10) + 'px';
        button.style.top = (parseFloat(marker.style.top) - 15) + 'px';
	button.style.visibility = 'visible';

        desBox.style.right = (710 - parseFloat(marker.style.left)) + 'px';
        desBox.style.top = (parseFloat(marker.style.top) + 10) + 'px';
	desBox.style.visibility = 'visible';
    }

    /**
     * Hides the 'Show/Hide Label' button and the description box on GSV pano.
     */
    function hide () {
        document.getElementById("label-visibility-button-on-pano").style.visibility = 'hidden';
        document.getElementById("label-description").style.visibility = 'hidden';
    }

    labelVisibilityControlButton.on('click', clickAdjustLabel);
    labelVisibilityButtonOnPano.on('click', clickAdjustLabel);
    labelVisibilityButtonOnPano.on('mouseover', function (e) {
	show();
	e.stopPropagation();
    });
    labelVisibilityButtonOnPano.on('mouseout', hide);

    self.hideLabel = hideLabel;
    self.unhideLabel = unhideLabel;
    self.refreshLabel = refreshLabel;
    self.isVisible = isVisible;
    self.show = show;
    self.hide = hide;

    return this;
}

