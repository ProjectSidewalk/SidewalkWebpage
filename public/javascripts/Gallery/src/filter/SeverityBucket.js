/**
 * A Severity Bucket to store Severities.
 * 
 * @param initialActiveSeverities array of severity levels to start out as active. Received from query params.
 * @returns {SeverityBucket}
 * @constructor
 */
function SeverityBucket(initialActiveSeverities) {
    let self = this;

    // List of severities.
    let bucket = [];

    /**
     * Initialize SeverityBucket.
     */
    function _init() {
        for (let i = 1; i <= 5; i++ ) {
            push(new Severity(i, initialActiveSeverities ? initialActiveSeverities.includes(i) > 0 : false));
        }
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
     * Return list of applied Severities.
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
    self.unapplySeverities = unapplySeverities;
    self.getSeverities = getSeverities;
    self.getSize = getSize;
    self.getAppliedSeverities = getAppliedSeverities;
    self.disable = disable;
    self.enable = enable;

    _init();

    return this;
}
