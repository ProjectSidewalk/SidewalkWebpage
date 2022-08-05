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
    let labelDescriptionBox = $("#label-description-box");

    let isAmsterdam = false;
    if (labelDescriptionBox.attr('class') === "label-description-box amsterdam") {
        isAmsterdam = true;
    }
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
        let panomarker = svv.panorama.getPanomarker();
        let label = svv.panorama.getCurrentLabel();
        panomarker.setIcon(label.getIconUrl());
        panomarker.draw();
        visible = true;
        let htmlString = `<u>H</u>ide Label</button>`;
        labelVisibilityButtonOnPano.html(htmlString);
        htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br /><u>H</u>ide Label</button>`;
        labelVisibilityControlButton.html(htmlString);
        if (isAmsterdam) {
            let desBox = labelDescriptionBox[0];
            desBox.style.visibility = 'visible';
        }
    }

    /**
     * Hides label in Google StreetView Panorama.
     */
    function hideLabel () {
        let panomarker = svv.panorama.getPanomarker();
        panomarker.setIcon("assets/javascripts/SVLabel/img/icons/Label_Outline.svg");
        panomarker.draw();
        visible = false;
        let htmlString = `S<u>h</u>ow Label</button>`;
        labelVisibilityButtonOnPano.html(htmlString);
        htmlString = `<img src="assets/javascripts/SVValidate/img/ShowLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br />S<u>h</u>ow Label</button>`;
        labelVisibilityControlButton.html(htmlString);
        if (isAmsterdam) {
            let desBox = labelDescriptionBox[0];
            desBox.style.visibility = 'hidden';
        }
    }

    /**
     * Refreshes label visual state
     */
    function refreshLabel () {
        let htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="label-visibility-control-button-icon" alt="Hide Label">
        <br /><u>H</u>ide Label</button>`;
        labelVisibilityControlButton.html(htmlString);
        labelVisibilityControlButton.css({
            "background": ""
        });
    }

    /**
     * Returns true if label is currently not hidden, false otherwise.
     */
    function isVisible () {
        return visible;
    }

    /**
     * Shows the 'Show/Hide Label' button and the description box on panorama.
     */
    function showTagsAndDeleteButton () {
        svv.tracker.push("MouseOver_Label");

        setPositions();
    }

    // Positions delete button and description box relative to label
    function setPositions () {
        let button = document.getElementById("label-visibility-button-on-pano");
        let marker = document.getElementById("validate-pano-marker");

        // Position the button to the top right corner of the label, 10px right and
        // 15px up from center of the label.
        button.style.left = (parseFloat(marker.style.left) + 10) + 'px';
        button.style.top = (parseFloat(marker.style.top) - 15) + 'px';
        button.style.visibility = 'visible';
        
        // Position the box to the lower left corner of the label, 10px left and
        // 10px down from center of the label.
        let desBox = labelDescriptionBox[0];
        desBox.style.right = (svv.canvasWidth - parseFloat(marker.style.left) - 10) + 'px';
        desBox.style.top = (parseFloat(marker.style.top) + 10) + 'px';
        desBox.style.visibility = 'visible';
    }

    /**
     * Hides the 'Show/Hide Label' button and the description box on GSV pano.
     */
    function hideTagsAndDeleteButton () {
        labelVisibilityButtonOnPano[0].style.visibility = 'hidden';
        labelDescriptionBox[0].style.visibility = 'hidden';
    }

    labelVisibilityControlButton.on('click', clickAdjustLabel);
    labelVisibilityButtonOnPano.on('click', clickAdjustLabel);
    labelVisibilityButtonOnPano.on('mouseover', function (e) {
        if (!isAmsterdam) {
            showTagsAndDeleteButton();
            e.stopPropagation();
        }
    });
    labelVisibilityButtonOnPano.on('mouseout', function() {
        if (!isAmsterdam) {
            hideTagsAndDeleteButton;
        }
    });

    self.hideLabel = hideLabel;
    self.unhideLabel = unhideLabel;
    self.refreshLabel = refreshLabel;
    self.isVisible = isVisible;
    self.showTagsAndDeleteButton = showTagsAndDeleteButton;
    self.hideTagsAndDeleteButton = hideTagsAndDeleteButton;
    self.setPositions = setPositions;

    return this;
}

