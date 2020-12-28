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

    function unapplySeverity() {
        bucket.forEach(tag => tag.unapply());
    }

    function getSeverities() {
        return bucket;
    }

    function getSize() {
        return bucket.length;
    }

    function getAppliedSeverities() {
        return bucket.filter(tag => tag.getStatus().applied);
    }

    function isSeverityApplied() {
        for (let i = 0; i < bucket.length; i++){
            if (bucket[i].getActive()) {
                return true;
            }
        }
        return false;
    }

    self.push = push;
    self.render = render;
    self.unapplySeverity = unapplySeverity;
    self.getSeverities = getSeverities;
    self.getSize = getSize;
    self.getAppliedSeverities = getAppliedSeverities;
    self.isSeverityApplied = isSeverityApplied;

    _init();

    return this;
}