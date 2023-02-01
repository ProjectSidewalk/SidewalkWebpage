/**
 * A Validation Option Bucket to store ValidationOptions.
 * 
 * @param bucket array containing ValidationOptions
 * @returns {ValidationOptionBucket}
 * @constructor
 */
function ValidationOptionBucket(inputValidationOptions) {
    let self = this;

    // List of validationOptions.
    let bucket = inputValidationOptions || [];

    /**
     * Initialize ValidationOptionBucket.
     */
    function _init() {
        for (const valOption of ['Validated Correct', 'Validated Incorrect', 'Unvalidated']) {
            push(new ValidationOption({ validationOption: valOption }, false));
        }
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
     * Disable interaction with ValidationOptions.
     */
    function disable() {
        bucket.forEach(validationOption => validationOption.disable());
    }
    
    /**
     * Enable interaction with ValidationOptions.
     */
    function enable() {
        bucket.forEach(validationOption => validationOption.enable());
    }

    self.push = push;
    self.render = render;
    self.unapplyValidationOptions = unapplyValidationOptions;
    self.getValidationOptions = getValidationOptions;
    self.getSize = getSize;
    self.getAppliedValidationOptions = getAppliedValidationOptions;
    self.disable = disable;
    self.enable = enable;

    _init();

    return this;
}
