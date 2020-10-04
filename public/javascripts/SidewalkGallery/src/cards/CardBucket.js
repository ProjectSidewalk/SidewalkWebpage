function CardBucket(bucket) {
    let self = this;

    // TODO: Is this needed?
    let size = 0;

    bucket = bucket || {
        1: [],
        2: [],
        3: [],
        4: [],
        5: [],
        null: []
    };

    function push(card) {
        bucket[card.getProperty('severity')].push(card);
        size++;
    }

    function getCards() {
        return bucket;
    }

    function getCardsBySeverity(severity) {
        if (!bucket.hasOwnProperty(severity)) {
            throw self.className + ": No such severity bucket";
        }

        return bucket[severity];
    }

    function copy() {
        // TODO: How do we copy the size across? Do we need to?
        return new CardBucket({
            1: bucket['1'],
            2: bucket['2'],
            3: bucket['3'],
            4: bucket['4'],
            5: bucket['5'],
            null: bucket['null']
        });
    }

    self.push = push;
    self.getCards = getCards;
    self.getCardsBySeverity = getCardsBySeverity;
    self.copy = copy;

    return this;
}