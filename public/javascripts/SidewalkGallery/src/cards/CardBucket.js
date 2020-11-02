function CardBucket(bucket, size) {
    let self = this;

    size = size || 0;

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

    function filterByTag(tag) {
        for (let severity in bucket) {
            bucket[severity] = bucket[severity].filter(card => testInclusion(card, tag));
        }
    }
    
    function testInclusion(card, tag) {
        let include = card.getProperty("tags").includes(tag.getProperty("tag"));
        //TODO: fix decrement, it isn't working
        if (!include) size--;
        return include;
    }

    function getSize() {
        return size;
    }

    function getSizeOfSeverity(severity) {
        return bucket[severity].length;
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
        return new CardBucket({
            1: bucket['1'],
            2: bucket['2'],
            3: bucket['3'],
            4: bucket['4'],
            5: bucket['5'],
            null: bucket['null']
        }, size);
    }

    self.push = push;
    self.filterByTag = filterByTag;
    self.getSize = getSize;
    self.getSizeOfSeverity = getSizeOfSeverity;
    self.getCards = getCards;
    self.getCardsBySeverity = getCardsBySeverity;
    self.copy = copy;

    return this;
}