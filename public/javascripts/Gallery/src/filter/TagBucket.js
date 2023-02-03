/**
 * A Tag Bucket to store Tags.
 *
 * @returns {TagBucket}
 * @constructor
 */
function TagBucket() {
    let self = this;

    // List of Tags.
    let bucket = [];

    /**
     * Add Tag.
     * 
     * @param {*} tag Tag to add.
     */
    function push(tag) {
        bucket.push(tag);
    }

    /**
     * Render all Tags.
     * 
     * @param {*} uiTagHolder UI element to render Tags in.
     */
    function render(uiTagHolder) {
        bucket.forEach(tag => tag.render(uiTagHolder));
    }

    /**
     * Unapply all tags.
     */
    function unapplyTags() {
        bucket.forEach(tag => tag.unapply());
    }

    /**
     * Return list of Tags.
     */
    function getTags() {
        return bucket;
    }

    /**
     * Return number of Tags.
     */
    function getSize() {
        return bucket.length;
    }

    /**
     * Return list of applied Tags.
     */
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
