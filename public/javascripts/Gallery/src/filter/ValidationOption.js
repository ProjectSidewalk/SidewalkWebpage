/**
 * A Validation Option module.
 */
class ValidationOption {
  // UI element of the validation option container and image.
  #validationOptionElement = null;

  #properties = {
    validationOption: undefined,
  };

  // A boolean to see if the current validation option filter is active.
  #status;

  /**
     * @param {*} params Properties of validation option.
     * @param {boolean} applied A boolean to see if the current validation option filter is active.
     */
  constructor(params, applied) {
    this.#status = { applied };
    this.#init(params);
  }

  /**
     * Initialize ValidationOption.
     *
     * @param {int} param ValidationOption.
     */
  #init(param) {
    Object.keys(param).forEach((attrName) => this.#properties[attrName] = param[attrName]);

    this.#validationOptionElement = document.createElement('button');
    this.#validationOptionElement.className = 'gallery-filter-validation-button gallery-filter-button gallery-filter';
    this.#validationOptionElement.id = this.#properties.validationOption;
    this.#validationOptionElement.innerText = i18next.t(`common:${this.#properties.validationOption}`);
    this.#validationOptionElement.disabled = true; // Will be enabled once images load.

    if (this.#status.applied) {
      this.apply();
    }

    this.#validationOptionElement.onclick = this.handleOnClickCallback;
  }

  /**
     * Handles when validation option is selected/deselected.
     */
  handleOnClickCallback = () => {
    if (this.#status.applied) {
      sg.tracker.push('ValidationOptionUnapply', null, { ValidationOption: this.#properties.validationOption });
      this.unapply();
    } else {
      sg.tracker.push('ValidationOptionApply', null, { ValidationOption: this.#properties.validationOption });
      this.apply();
    }

    sg.cardFilter.update();
  };

  /**
     * Applies a validation option filter.
     */
  apply() {
    this.#status.applied = true;
    this.#validationOptionElement.classList.add('gallery-filter-button-selected');
  }

  /**
     * Unapplies a validation option filter.
     */
  unapply() {
    this.#status.applied = false;
    this.#validationOptionElement.classList.remove('gallery-filter-button-selected');
  }

  /**
     * Renders ValidationOption in sidebar.
     *
     * @param {*} filterContainer UI element to render ValidationOption in.
     */
  render(filterContainer) {
    filterContainer.append(this.#validationOptionElement);
  }

  /**
     * Returns whether ValidationOption is applied or not.
     */
  getActive() {
    return this.#status.applied;
  }

  /**
     * Returns validation option value of ValidationOption.
     */
  getValidationOption() {
    return this.#properties.validationOption;
  }
}
