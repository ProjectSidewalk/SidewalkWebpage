/**
 * Handles the hiding and showing of labels in the panorama.
 *
 * @returns {LabelVisibilityControl}
 * @constructor
 */
function LabelVisibilityControl() {
    const self = this;
    let visible = true;
    let labelVisibilityControlButton = $('#label-visibility-control-button');
    let labelVisibilityButtonOnPano = $('#label-visibility-button-on-label');
    let labelDescriptionBox = $('#label-description-box');
    let hideText = i18next.t('top-ui.visibility-control-hide');
    let showText = i18next.t('top-ui.visibility-control-show');

    /**
     * Logs interaction when the hide label button is clicked.
     */
    function clickAdjustLabel() {
        if (visible) {
            svv.tracker.push('Click_HideLabel');
            hideLabel();
        } else {
            svv.tracker.push('Click_UnhideLabel');
            unhideLabel();
        }
    }

    /**
     * Unhides label in the panorama depending on current state.
     */
    function unhideLabel() {
        let panoMarker = svv.panoManager.getPanoMarker();
        let label = svv.labelContainer.getCurrentLabel();
        panoMarker.setIcon(label.getIconUrl());
        panoMarker.draw();
        visible = true;
        labelVisibilityButtonOnPano.html(`<span>${hideText}</span>`);
        let htmlString =
            `<img src="assets/images/icons/eye-invisible.svg" class="hide-label-button-icon" alt="${hideText}">
            <br /><span>${hideText}</span>`;
        labelVisibilityControlButton.html(htmlString);
        panoMarker.marker_.classList.add('icon-outline');
    }

    /**
     * Hides label in the panorama.
     */
    function hideLabel() {
        let panoMarker = svv.panoManager.getPanoMarker();
        panoMarker.setIcon('assets/javascripts/SVLabel/img/icons/Label_Outline.svg');
        panoMarker.draw();
        visible = false;
        labelVisibilityButtonOnPano.html(`<span>${showText}</span>`);
        let htmlString =
            `<img src="assets/images/icons/eye-visible.svg" class="hide-label-button-icon" alt="${showText}">
            <br /><span>${showText}</span>`;
        labelVisibilityControlButton.html(htmlString);
        panoMarker.marker_.classList.remove('icon-outline');
    }

    /**
     * Returns true if label is currently not hidden, false otherwise.
     */
    function isVisible() {
        return visible;
    }

    /**
     * Shows the 'Show/Hide Label' button and the description box on panorama.
     */
    function showTagsAndDeleteButton() {
        svv.tracker.push('MouseOver_Label');

        let button = document.getElementById('label-visibility-button-on-label');
        let marker = document.getElementById('validate-pano-marker');

        // Position the button to the top right corner of the label, 10px right and 15px up from center of the label.
        button.style.left = (parseFloat(marker.style.left) + 10) + 'px';
        button.style.top = (parseFloat(marker.style.top) - 15) + 'px';
        button.style.visibility = 'visible';

        // Position the box to the lower left corner of the label, 10px left and 10px down from center of the label.
        let desBox = labelDescriptionBox[0];
        desBox.style.right = (svv.canvasWidth() - parseFloat(marker.style.left) - 10) + 'px';
        desBox.style.top = (parseFloat(marker.style.top) + 10) + 'px';
        desBox.style.visibility = 'visible';
    }

    /**
     * Hides the 'Show/Hide Label' button and the description box on pano.
     */
    function hideTagsAndDeleteButton() {
        labelVisibilityButtonOnPano[0].style.visibility = 'hidden';
        labelDescriptionBox[0].style.visibility = 'hidden';
    }

    // Set up the event listeners.
    labelVisibilityControlButton.on('click', clickAdjustLabel);
    labelVisibilityButtonOnPano.on('click', clickAdjustLabel);
    labelVisibilityButtonOnPano.on('mouseover', function (e) {
        showTagsAndDeleteButton();
        e.stopPropagation();
    });
    labelVisibilityButtonOnPano.on('mouseout', hideTagsAndDeleteButton);

    self.hideLabel = hideLabel;
    self.unhideLabel = unhideLabel;
    self.isVisible = isVisible;
    self.showTagsAndDeleteButton = showTagsAndDeleteButton;
    self.hideTagsAndDeleteButton = hideTagsAndDeleteButton;

    // Call unhideLabel() to start the page with showing the 'hide label' button.
    self.unhideLabel();
    return this;
}
