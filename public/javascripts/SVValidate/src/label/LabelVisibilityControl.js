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
    let buttonUiVisibilityControlHide = i18next.t('top-ui.visibility-control-hide');
    let buttonUiVisibilityControlShow = i18next.t('top-ui.visibility-control-show');

    /**
     * Logs interaction when the hide label button is clicked.
     */
    function clickAdjustLabel () {
        if (visible) {
            svv.tracker.push("Click_HideLabel");
            hideLabel();
        } else {
            svv.tracker.push("Click_UnhideLabel");
            unhideLabel(false);
        }
    }

    /**
     * Unhides label in Google StreetView Panorama
     * depending on current state.
     * @param {boolean} newLabel Indicates whether we unhide due to showing a new label vs. clicking the unhide button.
     */
    function unhideLabel (newLabel) {
        let panomarker = svv.panorama.getPanomarker();
        let label = svv.panorama.getCurrentLabel();
        panomarker.setIcon(label.getIconUrl());
        panomarker.draw();
        visible = true;
        let htmlString = `${buttonUiVisibilityControlHide}</button>`;
        labelVisibilityButtonOnPano.html(htmlString);
        htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="upper-menu-button-icon" alt="Hide Label">
        <br />${buttonUiVisibilityControlHide}</button>`;
        labelVisibilityControlButton.html(htmlString);
        // If we are unhiding because the user is moving on to their next label, then Panomarker.js adds the outline.
        if (!newLabel) {
            panomarker.marker_.classList.add('icon-outline');
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
        let htmlString = `${buttonUiVisibilityControlShow}</button>`;
        labelVisibilityButtonOnPano.html(htmlString);
        htmlString = `<img src="assets/javascripts/SVValidate/img/ShowLabel.svg" class="upper-menu-button-icon" alt="Hide Label">
        <br />${buttonUiVisibilityControlShow}</button>`;
        labelVisibilityControlButton.html(htmlString);
        panomarker.marker_.classList.remove('icon-outline');
    }

    /**
     * Refreshes label visual state
     */
    function refreshLabel () {
        let htmlString = `<img src="assets/javascripts/SVValidate/img/HideLabel.svg" class="upper-menu-button-icon" alt="Hide Label">
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
        showTagsAndDeleteButton();
        e.stopPropagation();
    });
    labelVisibilityButtonOnPano.on('mouseout', hideTagsAndDeleteButton);

    self.hideLabel = hideLabel;
    self.unhideLabel = unhideLabel;
    self.refreshLabel = refreshLabel;
    self.isVisible = isVisible;
    self.showTagsAndDeleteButton = showTagsAndDeleteButton;
    self.hideTagsAndDeleteButton = hideTagsAndDeleteButton;

    // Call unhideLabel() to start the page with showing the 'hide label' button.
    self.unhideLabel(true);
    return this;
}

