/**
 * A Card Bucket to store Cards of a certain label type.
 * 
 * @param bucket List of Cards in order received from database.
 * @returns {CardBucket}
 * @constructor
 */
function CardBucket(inputCards) {
    let self = this;
    let bucket = inputCards || [];
    /**
     * Add a Card to bucket.
     * 
     * @param {Card} card Card to add.
     */
    function push(card) {
        bucket.push(card);
    }

    /**
     * Filters cards upon a non-empty array of tags.
     * 
     * @param {*} tags Tags to filter upon.
     */
    function filterOnTags(tags) {
        if (tags.length > 0) {
            let tagSet = new Set(tags);
            bucket = bucket.filter(card => card.getProperty("tags").some(tag => tagSet.has(tag)));
        }
    }

    /**
     * Filters cards upon a non-empty array of severities.
     * 
     * @param {*} severities Severities to filter upon.
     */
    function filterOnSeverities(severities) {
        if (severities.length > 0) {
            let severitySet = new Set(severities);
            bucket = bucket.filter(card => severitySet.has(card.getProperty("severity")));
        }
    }

    /**
     * Return all Cards in bucket.
     */
    function getCards() {
        return bucket;
    }

    /**
     * Return how many Cards are in bucket.
     */
    function getSize() {
        return bucket.length;
    }

    /**
     * Return a copy of this CardBucket. This is not a deepcopy (the cards themselves are not copied).
     */
    function copy() {
        return new CardBucket([...bucket]);
    }
    
    /**
     * Gets the card that has the matching imageId.
     * 
     * @param {String} imageId the id to search for.
     * @returns {Card} The card in the card bucket that contains the imageId.
     */
    function findCardByImageId(imageId) {
        let index = findCardIndexByImageId(imageId);
        if (index === -1) {
            return undefined;
        }
        return bucket[index];
    }

    function getCardByIndex(index) {
        return bucket[index];
    }

    function findCardIndexByImageId(imageId) {
        for (let i = 0; i < bucket.length; i++) {
            if (bucket[i].getImageId() === imageId) {
                return i;
            }
        }
        return -1;
    }

    self.push = push;
    self.filterOnTags = filterOnTags;
    self.filterOnSeverities = filterOnSeverities;
    self.getCards = getCards;
    self.getSize = getSize;
    self.copy = copy;
    self.findCardByImageId = findCardByImageId;
    self.findCardIndexByImageId = findCardIndexByImageId;
    self.getCardByIndex = getCardByIndex;

    return this;
}
