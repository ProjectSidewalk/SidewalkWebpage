function TagBucket(bucket) {
    let self = this;

    bucket = bucket || [];

    function push(tag) {
        bucket.push(tag);
    }

    function render(uiTagHolder) {
        bucket.forEach(tag => tag.render(uiTagHolder));
    }

    function unapplyTags() {
        bucket.forEach(tag => tag.unapply);
    }

    function getTags() {
        return bucket;
    }

    function getSize() {
        return bucket.length;
    }

    function getAppliedTags() {
        return bucket.filter(tag => tag.getStatus().applied);
    }

    self.push = push;
    self.render = render;
    self.unapplyTags = unapplyTags;
    self.getTags = getTags;
    self.getSize = getSize;
    self.getAppliedTags = getAppliedTags;

    return this;
}