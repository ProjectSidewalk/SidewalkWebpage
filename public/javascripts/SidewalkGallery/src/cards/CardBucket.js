/**
 * A Card Bucket to store Cards of a certain label type
 * @param bucket object containing cards categorized by severity
 * @returns {TagBucket}
 * @constructor
 */
function CardBucket(bucket) {
    let self = this;

    bucket = bucket || [];

    function push(card) {
        bucket.push(card);
    }

    /**
     * Filters cards upon a non-empty array of tags
     * 
     * @param {*} tags tags to filter upon
     */
    function filterOnTags(tags) {
        if (tags.length > 0) {
            let tagSet = new Set(tags);
            bucket = bucket.filter(card => card.getProperty("tags").some(tag => tagSet.has(tag)));
        }
    }

    /**
     * Filters cards upon a non-empty array of severities
     * 
     * @param {*} severities severities to filter upon
     */
    function filterOnSeverities(severities) {
        if (severities.length > 0) {
            let severitySet = new Set(severities);
            bucket = bucket.filter(card => severitySet.has(card.getProperty("severity")));
        }
    }

    function getCards() {
        return bucket;
    }

    function getSize() {
        return bucket.length;
    }

    function copy() {
        return new CardBucket([...bucket]);
    }

    self.push = push;
    self.filterOnTags = filterOnTags;
    self.filterOnSeverities = filterOnSeverities;
    self.getCards = getCards;
    self.getSize = getSize;
    self.copy = copy;

    return this;
}