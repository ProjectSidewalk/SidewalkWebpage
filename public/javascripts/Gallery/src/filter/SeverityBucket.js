/**
 * A Severity Bucket to store Severities.
 *
 * @param initialActiveSeverities Array of severity levels to start out as active ("null"/"1"/"2"/"3").
 * @param initialLabelType initial gallery label type (drives which smiley icon set to use).
 * @returns {SeverityBucket}
 * @constructor
 */
function SeverityBucket(initialActiveSeverities, initialLabelType) {
    const self = this;

    // List of severities: "null" = N/A, "1" = low/good, "2" = medium/okay, "3" = high/bad.
    const SEVERITY_LEVELS = ['null', '1', '2', '3'];
    let bucket = [];

    /**
     * Initialize SeverityBucket.
     */
    function _init() {
        const activeSet = new Set(initialActiveSeverities || []);
        const defaultAll = activeSet.size === 0;
        for (const level of SEVERITY_LEVELS) {
            push(new Severity(level, defaultAll || activeSet.has(level), initialLabelType));
        }
    }

    /**
     * Update the label type on all Severities so icons reflect the current smiley set.
     * @param {string} labelType
     */
    function setLabelType(labelType) {
        bucket.forEach(severity => severity.setLabelType(labelType));
    }

    /**
     * Add severity.
     *
     * @param {*} severity
     */
    function push(severity) {
        bucket.push(severity);
    }

    /**
     * Render Severities in SeverityBucket.
     * @param {*} uiSeverityHolder UI element to render Severities in.
     */
    function render(uiSeverityHolder) {
        bucket.forEach(severity => severity.render(uiSeverityHolder));
    }

    /**
     * Reset all Severities to the default (all selected) state.
     */
    function selectAllSeverities() {
        bucket.forEach(severity => severity.apply());
    }

    /**
     * Unapply all Severities.
     */
    function unapplySeverities() {
        bucket.forEach(severity => severity.unapply());
    }

    /**
     * Return list of Severities.
     */
    function getSeverities() {
        return bucket;
    }

    /**
     * Return number of Severities.
     */
    function getSize() {
        return bucket.length;
    }

    /**
     * Return list of applied Severities ("null" represents the N/A bucket).
     */
    function getAppliedSeverities() {
        return bucket.filter(severity => severity.getActive()).map(severity => severity.getSeverity());
    }

    /**
     * Disable interaction with Severities.
     */
    function disable() {
        bucket.forEach(severity => severity.disable());
    }

    /**
     * Enable interaction with Severities.
     */
    function enable() {
        bucket.forEach(severity => severity.enable());
    }

    self.push = push;
    self.render = render;
    self.setLabelType = setLabelType;
    self.selectAllSeverities = selectAllSeverities;
    self.unapplySeverities = unapplySeverities;
    self.getSeverities = getSeverities;
    self.getSize = getSize;
    self.getAppliedSeverities = getAppliedSeverities;
    self.disable = disable;
    self.enable = enable;

    _init();

    return this;
}
