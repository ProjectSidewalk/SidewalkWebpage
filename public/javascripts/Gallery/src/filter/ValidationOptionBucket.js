/**
 * A Validation Option Bucket to store ValidationOptions.
 */
class ValidationOptionBucket {
    // List of validationOptions.
    #bucket = [];

    /**
     * @param {Array} initialValidationOptions Array containing validation options to set on page load.
     */
    constructor(initialValidationOptions) {
        this.push(new ValidationOption({ validationOption: 'correct' }, initialValidationOptions.includes('correct')));
        this.push(new ValidationOption({ validationOption: 'incorrect' }, initialValidationOptions.includes('incorrect')));
        this.push(new ValidationOption({ validationOption: 'unsure' }, initialValidationOptions.includes('unsure')));
        this.push(new ValidationOption({ validationOption: 'unvalidated' }, initialValidationOptions.includes('unvalidated')));
    }

    /**
     * Add validationOption.
     *
     * @param {*} validationOption
     */
    push(validationOption) {
        this.#bucket.push(validationOption);
    }

    /**
     * Render ValidationOptions in ValidationOptionBucket.
     * @param {*} uiValidationOptionHolder UI element to render ValidationOptions in.
     */
    render(uiValidationOptionHolder) {
        this.#bucket.forEach((validationOption) => validationOption.render(uiValidationOptionHolder));
    }

    /**
     * Unapply all ValidationOptions.
     */
    unapplyValidationOptions() {
        this.#bucket.forEach((validationOption) => validationOption.unapply());
    }

    /**
     * Return list of ValidationOptions.
     */
    getValidationOptions() {
        return this.#bucket;
    }

    /**
     * Return number of ValidationOptions.
     */
    getSize() {
        return this.#bucket.length;
    }

    /**
     * Return list of applied ValidationOptions.
     */
    getAppliedValidationOptions() {
        return this.#bucket.filter((valOption) => valOption.getActive()).map((valOption) => valOption.getValidationOption());
    }

    /**
     * Resets the validation options to the default/initial values.
     */
    setToDefault() {
        this.unapplyValidationOptions();
        this.#bucket[0].apply();
        this.#bucket[3].apply();
    }
}
