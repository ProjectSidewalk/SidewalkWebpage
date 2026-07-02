/**
 * A Severity Bucket to store Severities.
 */
class SeverityBucket {
    // List of severities: "null" = N/A, "1" = low/good, "2" = medium/okay, "3" = high/bad.
    static #SEVERITY_LEVELS = ['null', '1', '2', '3'];

    #bucket = [];

    /**
     * @param {Array} initialActiveSeverities Array of severity levels to start out as active ("null"/"1"/"2"/"3").
     * @param {string} initialLabelType Initial gallery label type (drives which smiley icon set to use).
     */
    constructor(initialActiveSeverities, initialLabelType) {
        const activeSet = new Set(initialActiveSeverities || []);
        const defaultAll = activeSet.size === 0;
        for (const level of SeverityBucket.#SEVERITY_LEVELS) {
            this.push(new Severity(level, defaultAll || activeSet.has(level), initialLabelType));
        }
    }

    /**
     * Update the label type on all Severities so icons reflect the current smiley set.
     * @param {string} labelType
     */
    setLabelType(labelType) {
        this.#bucket.forEach(severity => severity.setLabelType(labelType));
    }

    /**
     * Add severity.
     *
     * @param {*} severity
     */
    push(severity) {
        this.#bucket.push(severity);
    }

    /**
     * Render Severities in SeverityBucket.
     * @param {*} uiSeverityHolder UI element to render Severities in.
     */
    render(uiSeverityHolder) {
        this.#bucket.forEach(severity => severity.render(uiSeverityHolder));
    }

    /**
     * Reset all Severities to the default (all selected) state.
     */
    selectAllSeverities() {
        this.#bucket.forEach(severity => severity.apply());
    }

    /**
     * Unapply all Severities.
     */
    unapplySeverities() {
        this.#bucket.forEach(severity => severity.unapply());
    }

    /**
     * Return list of Severities.
     */
    getSeverities() {
        return this.#bucket;
    }

    /**
     * Return number of Severities.
     */
    getSize() {
        return this.#bucket.length;
    }

    /**
     * Return list of applied Severities ("null" represents the N/A bucket).
     */
    getAppliedSeverities() {
        return this.#bucket.filter(severity => severity.getActive()).map(severity => severity.getSeverity());
    }

    /**
     * Disable interaction with Severities.
     */
    disable() {
        this.#bucket.forEach(severity => severity.disable());
    }

    /**
     * Enable interaction with Severities.
     */
    enable() {
        this.#bucket.forEach(severity => severity.enable());
    }
}
