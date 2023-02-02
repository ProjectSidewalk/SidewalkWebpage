/**
 * A Validation Option module.
 *
 * @param {*} params Properties of validation option.
 * @param applied A boolean to see if the current validation option filter is active.
 * @returns {ValidationOption}
 * @constructor
 */
function ValidationOption (params, applied){
    let self = this;

    // UI element of the validation option container and image.
    let validationOptionElement = null;
    let interactionEnabled = false;

    let properties = {
        validationOption: undefined
    };

    // A boolean to see if the current validation option filter is active.
    let status = {
        applied: applied
    };

    /**
     * Initialize ValidationOption.
     *
     * @param {int} param ValidationOption.
     */
    function _init(param) {
        Object.keys(param).forEach( attrName => properties[attrName] = param[attrName]);

        validationOptionElement = document.createElement('button');
        validationOptionElement.className = "gallery-filter-validation-button gallery-filter-button gallery-filter";
        validationOptionElement.id = properties.validationOption;
        validationOptionElement.innerText = properties.validationOption;

        if (status.applied) {
            apply();
        } else {
            unapply();
        }

        validationOptionElement.onclick = handleOnClickCallback;
    }

    /**
     * Handles when validation option is selected/deselected.
     */
    function handleOnClickCallback() {
        if (status.applied) {
            sg.tracker.push("ValidationOptionUnapply", null, { ValidationOption: properties.validationOption });
            unapply();
        } else {
            sg.tracker.push("ValidationOptionApply", null, { ValidationOption: properties.validationOption });
            apply();
        }

        sg.cardContainer.updateCardsByTagsAndSeverity();
    }

    /**
     * Applies a validation option filter.
     */
    function apply() {
        status.applied = true;
        validationOptionElement.setAttribute("style", "background-color: #78c8aa");
    }

    /**
     * Unapplies a validation option filter.
     */
    function unapply() {
        status.applied = false;
        validationOptionElement.setAttribute("style", "background-color: none");
    }

    /**
     * Renders ValidationOption in sidebar.
     *
     * @param {*} filterContainer UI element to render ValidationOption in.
     */
    function render(filterContainer) {
        filterContainer.append(validationOptionElement);
    }

    /**
     * Returns whether ValidationOption is applied or not.
     */
    function getActive(){
        return status.applied;
    }

    /**
     * Returns validation option value of ValidationOption.
     */
    function getValidationOption() {
        return properties.validationOption;
    }

    /**
     * Disables interaction with ValidationOption.
     */
    function disable() {
        interactionEnabled = false;
    }

    /**
     * Enables interaction with ValidationOption.
     */
    function enable() {
        interactionEnabled = true;
    }

    self.handleOnClickCallback = handleOnClickCallback;
    self.apply = apply;
    self.unapply = unapply;
    self.getActive = getActive;
    self.getValidationOption = getValidationOption;
    self.render = render;
    self.disable = disable;
    self.enable = enable;

    _init(params);

    return this;
}
