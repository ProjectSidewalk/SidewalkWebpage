/**
 * A Card Bucket to store Cards of a certain label type.
 */
class CardBucket {
    #bucket;

    /**
     * @param {Array} inputCards List of Cards in order received from database.
     */
    constructor(inputCards) {
        this.#bucket = inputCards || [];
    }

    /**
     * Add a Card to bucket.
     *
     * @param {Card} card Card to add.
     */
    push(card) {
        this.#bucket.push(card);
    }

    /**
     * Filters cards upon a non-empty array of tags.
     *
     * @param {*} tags Tags to filter upon.
     */
    filterOnTags(tags) {
        if (tags !== undefined && tags.length > 0) {
            const tagSet = new Set(tags);
            this.#bucket = this.#bucket.filter(card => card.getProperty("tags").some(tag => tagSet.has(tag)));
        }
    }

    /**
     * Filters cards upon a non-empty array of severities.
     *
     * @param {*} severities Severities to filter upon.
     */
    filterOnSeverities(severities) {
        if (severities !== undefined && severities.length > 0) {
            const severitySet = new Set(severities);
            this.#bucket = this.#bucket.filter(card => {
                const sev = card.getProperty("severity");
                return severitySet.has(sev == null ? 'null' : String(sev));
            });
        }
    }

    /**
     * Filters cards upon an array of validation options.
     *
     * @param {*} validationOptions Validation Options to filter upon.
     */
    filterOnValidationOptions(validationOptions) {
        const validationOptionsSet = new Set(validationOptions);
        this.#bucket = this.#bucket.filter(card => validationOptionsSet.has(card.getProperty("correctness")));
    }

    /**
     * Return all Cards in bucket.
     */
    getCards() {
        return this.#bucket;
    }

    /**
     * Return how many Cards are in bucket.
     */
    getSize() {
        return this.#bucket.length;
    }

    /**
     * Return a copy of this CardBucket. This is not a deepcopy (the cards themselves are not copied).
     */
    copy() {
        return new CardBucket([...this.#bucket]);
    }

    /**
     * Gets the card that has the matching imageId.
     *
     * @param {string} imageId The id to search for.
     * @returns {Card} The card in the card bucket that contains the imageId.
     */
    findCardByImageId(imageId) {
        const index = this.findCardIndexByImageId(imageId);
        if (index === -1) {
            return undefined;
        }
        return this.#bucket[index];
    }

    getCardByIndex(index) {
        return this.#bucket[index];
    }

    findCardIndexByImageId(imageId) {
        for (let i = 0; i < this.#bucket.length; i++) {
            if (this.#bucket[i].getImageId() === imageId) {
                return i;
            }
        }

        return -1;
    }
}
