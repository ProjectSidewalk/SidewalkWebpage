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

    function getCards() {
        return bucket;
    }

    function size() {
        // let num = 0;
        // for (let i = 1; i <= 5; i++) {
        //     num += bucket[i].length;
        // }
        // num += bucket['null'].length;

        // return num;
        return size;

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
    self.getCards = getCards;
    self.getCardsBySeverity = getCardsBySeverity;
    self.copy = copy;

    return this;
}