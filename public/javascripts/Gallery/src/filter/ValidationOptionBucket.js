/**
 * A Validation Option Bucket to store ValidationOptions.
 * 
 * @param initialValidationOptions array containing validation options to set on page load.
 * @returns {ValidationOptionBucket}
 * @constructor
 */
function ValidationOptionBucket(initialValidationOptions) {
    let self = this;

    // List of validationOptions.
    let bucket = [];

    /**
     * Initialize ValidationOptionBucket.
     */
    function _init() {
        push(new ValidationOption({ validationOption: 'correct'}, initialValidationOptions.includes('correct')));
        push(new ValidationOption({ validationOption: 'incorrect'}, initialValidationOptions.includes('incorrect')));
        push(new ValidationOption({ validationOption: 'notsure'}, initialValidationOptions.includes('notsure')));
        push(new ValidationOption({ validationOption: 'unvalidated'}, initialValidationOptions.includes('unvalidated')));
    }

    /**
     * Add validationOption.
     * 
     * @param {*} validationOption
     */
    function push(validationOption) {
        bucket.push(validationOption);
    }

    /**
     * Render ValidationOptions in ValidationOptionBucket.
     * @param {*} uiValidationOptionHolder UI element to render ValidationOptions in.
     */
    function render(uiValidationOptionHolder) {
        bucket.forEach(validationOption => validationOption.render(uiValidationOptionHolder));
    }

    /**
     * Unapply all ValidationOptions.
     */
    function unapplyValidationOptions() {
        bucket.forEach(validationOption => validationOption.unapply());
    }

    /**
     * Return list of ValidationOptions.
     */
    function getValidationOptions() {
        return bucket;
    }

    /**
     * Return number of ValidationOptions.
     */
    function getSize() {
        return bucket.length;
    }

    /**
     * Return list of applied ValidationOptions.
     */
    function getAppliedValidationOptions() {
        return bucket.filter(valOption => valOption.getActive()).map(valOption => valOption.getValidationOption());
    }

    /**
     * Resets the validation options to the default/initial values.
     */
    function setToDefault() {
        unapplyValidationOptions();
        bucket[0].apply();
        bucket[3].apply();
    }

    self.push = push;
    self.render = render;
    self.unapplyValidationOptions = unapplyValidationOptions;
    self.getValidationOptions = getValidationOptions;
    self.getSize = getSize;
    self.getAppliedValidationOptions = getAppliedValidationOptions;
    self.setToDefault = setToDefault;

    _init();

    return this;
}
