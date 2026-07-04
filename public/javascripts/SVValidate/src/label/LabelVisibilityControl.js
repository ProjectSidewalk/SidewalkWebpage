/**
 * Handles the hiding and showing of labels in the panorama.
 */
class LabelVisibilityControl {
  #visible = true;
  #labelVisibilityControlButton;
  #labelVisibilityButtonOnPano;
  #labelDescriptionBox;
  #hideText;
  #showText;

  constructor() {
    this.#labelVisibilityControlButton = $('#label-visibility-control-button');
    this.#labelVisibilityButtonOnPano = $('#label-visibility-button-on-label');
    this.#labelDescriptionBox = $('#label-description-box');
    this.#hideText = i18next.t('top-ui.visibility-control-hide');
    this.#showText = i18next.t('top-ui.visibility-control-show');

    // Set up the event listeners.
    this.#labelVisibilityControlButton.on('click', this.#clickAdjustLabel);
    this.#labelVisibilityButtonOnPano.on('click', this.#clickAdjustLabel);
    this.#labelVisibilityButtonOnPano.on('mouseover', (e) => {
      // Don't re-show the hover info if the cursor passes over the button mid-pan (a mouse button is held down).
      if (e.buttons) return;
      this.showTagsAndDeleteButton();
      e.stopPropagation();
    });
    this.#labelVisibilityButtonOnPano.on('mouseout', () => this.hideTagsAndDeleteButton());

    // Call unhideLabel() to start the page with showing the 'hide label' button.
    this.unhideLabel();
  }

  /**
     * Logs interaction when the hide label button is clicked.
     */
  #clickAdjustLabel = () => {
    if (this.#visible) {
      svv.tracker.push('Click_HideLabel');
      this.hideLabel();
    } else {
      svv.tracker.push('Click_UnhideLabel');
      this.unhideLabel();
    }
  };

  /**
     * Unhides label in the panorama depending on current state.
     */
  unhideLabel() {
    const panoMarker = svv.panoManager.getPanoMarker();
    const label = svv.labelContainer.getCurrentLabel();
    panoMarker.setIcon(label.getIconUrl());
    panoMarker.draw();
    this.#visible = true;
    this.#labelVisibilityButtonOnPano.html(`<span>${this.#hideText}</span>`);
    const htmlString
            = `<img src="assets/images/icons/eye-invisible.svg" class="hide-label-button-icon" alt="${this.#hideText}">
            <span>${this.#hideText}</span>`;
    this.#labelVisibilityControlButton.html(htmlString);
    panoMarker.marker_.classList.add('icon-outline');
  }

  /**
     * Hides label in the panorama.
     */
  hideLabel() {
    const panoMarker = svv.panoManager.getPanoMarker();
    panoMarker.setIcon('assets/javascripts/SVLabel/img/icons/Label_Outline.svg');
    panoMarker.draw();
    this.#visible = false;
    this.#labelVisibilityButtonOnPano.html(`<span>${this.#showText}</span>`);
    const htmlString
            = `<img src="assets/images/icons/eye-visible.svg" class="hide-label-button-icon" alt="${this.#showText}">
            <span>${this.#showText}</span>`;
    this.#labelVisibilityControlButton.html(htmlString);
    panoMarker.marker_.classList.remove('icon-outline');
  }

  /**
     * Returns true if label is currently not hidden, false otherwise.
     */
  isVisible() {
    return this.#visible;
  }

  /**
     * Shows the 'Show/Hide Label' button and the description box on panorama.
     */
  showTagsAndDeleteButton() {
    svv.tracker.push('MouseOver_Label');

    const button = document.getElementById('label-visibility-button-on-label');
    const marker = document.getElementById('validate-pano-marker');
    const scale = util.uiScale();

    // Position the button to the top right corner of the label, 15px right and 15px up from center of the label.
    button.style.left = `${parseFloat(marker.style.left) + 15 * scale}px`;
    button.style.top = `${parseFloat(marker.style.top) - 15 * scale}px`;
    button.style.visibility = 'visible';

    // Position the box to the lower left corner of the label, 10px left and 10px down from center of the label.
    const desBox = this.#labelDescriptionBox[0];
    desBox.style.right = `${svv.canvasWidth() - parseFloat(marker.style.left) - 10 * scale}px`;
    desBox.style.top = `${parseFloat(marker.style.top) + 10 * scale}px`;
    desBox.style.visibility = 'visible';
  }

  /**
     * Hides the 'Show/Hide Label' button and the description box on pano.
     */
  hideTagsAndDeleteButton() {
    this.#labelVisibilityButtonOnPano[0].style.visibility = 'hidden';
    this.#labelDescriptionBox[0].style.visibility = 'hidden';
  }
}
