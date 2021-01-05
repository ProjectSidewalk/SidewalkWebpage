/**
 * A Severity Bucket to store Severities
 * @param bucket array containing Severities
 * @returns {SeverityBucket}
 * @constructor
 */
function SeverityBucket(bucket) {
    let self = this;

    bucket = bucket || [];

    function _init() {
        for(let i = 1; i <= 5; i++ ){
            push(new Severity(i));
        }
    }

    function push(tag) {
        bucket.push(tag);
    }

    function render(uiSeverityHolder) {
        bucket.forEach(severity => severity.render(uiSeverityHolder));
    }

    function unapplySeverities() {
        bucket.forEach(severity => severity.unapply());
    }

    function getSeverities() {
        return bucket;
    }

    function getSize() {
        return bucket.length;
    }

    function getAppliedSeverities() {
        return bucket.filter(severity => severity.getActive()).map(severity => severity.getSeverity());
    }

    function isSeverityApplied() {
        // for (let i = 0; i < bucket.length; i++){
        //     if (bucket[i].getActive()) {
        //         return true;
        //     }
        // }
        // return false;
        return getAppliedSeverities().length > 0;
    }

    self.push = push;
    self.render = render;
    self.unapplySeverities = unapplySeverities;
    self.getSeverities = getSeverities;
    self.getSize = getSize;
    self.getAppliedSeverities = getAppliedSeverities;
    self.isSeverityApplied = isSeverityApplied;

    _init();

    return this;
}