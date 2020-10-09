/**
 * Card Container module. This is responsible for storing the Card objects that are to be rendered.
 * @returns {CardContainer}
 * @constructor
 */
function CardContainer(uiCardContainer) {
    let self = this;

    let labelTypeIds = {
        CurbRamp: 1,
        NoCurbRamp: 2,
        Obstacle: 3,
        SurfaceProblem: 4,
        Other: 5,
        Occlusion: 6,
        NoSidewalk: 7,
        Problem: 8
    };

    let currentLabelType = null;

    let cardsByType = {
        CurbRamp: null,
        NoCurbRamp: null,
        Obstacle: null,
        SurfaceProblem: null,
        Other: null,
        Occlusion: null,
        NoSidewalk: null,
        Problem: null
    };

    // Current labels being displayed of current type based off filters
    let currentCards = new CardBucket();

    function fetchLabelsByType(labelTypeId, callback) {
        $.getJSON("/label/labelsByType?labelTypeId=" + labelTypeId, function (data) {
            if ("labelsOfType" in data) {
                let labels = data.labelsOfType,
                    card,
                    i = 0,
                    len = labels.length;
                for (; i < len; i++) {
                    let labelProp = labels[i];
                    if ("label" in labelProp && "imageUrl" in labelProp) {
                        card = new Card(labelProp.label, labelProp.imageUrl);
                        self.push(card);
                    }
                }
                if (callback) callback();
            }
        });
        
    }

    /**
     * Returns cards of current type
     */
    function getCards() {
        return cardsByType;
    }

    /**
     * Returns cards of current type that are being rendered
     */
    function getCurrentCards() {
        return currentCards;
    }

    /**
     * Push a card into cardsOfType
     * @param card
     */
    function push(card) {
        cardsByType[card.getLabelType()].push(card);
        currentCards.push(card);
        // tagFiltered.push(card);
    }

    /**
     * Updates cardsOfType if card type changes, and currentCards if filter changes
     */
    function updateCardsByType() {
        let filterLabelType = sg.tagContainer.getStatus().currentLabelType;
        if (currentLabelType !== filterLabelType) {
            currentLabelType = filterLabelType;
            clearCurrentCards();

            if (!cardsByType[currentLabelType]) {
                cardsByType[currentLabelType] = new CardBucket();
                fetchLabelsByType(labelTypeIds[filterLabelType], function () {
                    console.log("new labels gathered");
                    render();
                });
            } else {
                currentCards = cardsByType[currentLabelType];
                render();
            }
        }
    }

    function updateCardsByTag(tag) {
        if (tag.getStatus().applied) {
            let bucket = currentCards.getCards();
            for (let severity in bucket) {
                bucket[severity] = bucket[severity].filter(card => card.getProperty("tags").includes(tag.getProperty("tag")));
            }
        } else {
           //clearCurrentCards();
           currentCards = cardsByType[currentLabelType].copy();
           let bucket = currentCards.getCards();

           let tagsToCheck = sg.tagContainer.getTagsByType()[currentLabelType];
           for (let i = 0; i < tagsToCheck.length; i++) {
               let tag = tagsToCheck[i];
               if (tag.getStatus().applied) {
                   for (let severity in bucket) {
                       bucket[severity] = bucket[severity].filter(card => card.getProperty("tags").includes(tag.getProperty("tag")));
                   }
               }
           }
           //updateCardsBySeverity();
            console.log(currentCards.getCards());
        }

        render();
    }

    // function updateCardsBySeverity(){
    //     uiCardContainer.holder.empty();
    //     // clearCurrentCards();
    //     let newCards = [];
    //     for (let i = 0; i < tagFiltered.length; i++){
    //         // console.log(currentCards[i].getProperty("severity") == severity.getSeverity());
    //         let severities = sg.tagContainer.getSeverities();
    //
    //         for (let j = 0; j < severities.length; j++){
    //             if (severities[j].getActive()){
    //                 if (tagFiltered[i].getProperty("severity") == severities[j].getSeverity()){
    //                     newCards.push(tagFiltered[i]);
    //                     // console.log(tagFiltered[i].getProperty("severity") == severities[j].getSeverity());
    //                 }
    //             }
    //         }
    //         // severities.forEach( severity => {
    //         //     if (currentCards[i].getProperty("severity") == severity.getSeverity() && severity.getActive()){
    //         //         newTags.push(currentCards[i]);
    //         //     }}
    //         // );
    //
    //     }
    //     console.log(newCards.length);
    //     currentCards = newCards;
    //
    //
    //
    //
    //     render();
    // }

    function sortCards() {
        // uiCardContainer.holder.empty();
        // currentCards.sort((card1, card2) => sg.cardSortMenu.getStatus().severity * card1.getProperty("severity") - card2.getProperty("severity"));
        //
        // render();
    }

    /**
     * Renders current cards
     */
    function render() {
        uiCardContainer.holder.empty();

        //TODO: refactor render method to handle going through currentCard CardBucket and rendering those of selected severities
        let num = 0;
        let cardBucket = currentCards.getCards();
        let severities = sg.tagContainer.getSeverities();

        //console.time('render cards');
        for (let i = 0; i < severities.length; i++){
            if (severities[i].getActive()){
                let subBucket = cardBucket[severities[i].getSeverity()];
                for (let j = 0; j < subBucket.length; j++) {
                    if (num >= 10) break;
                    subBucket[j].render(uiCardContainer.holder);
                    num++;
                }
            }
        }
        //console.timeEnd('render cards');
    }

    /**
     * Flush all cards currently being rendered
     */
    function clearCurrentCards() {
        currentCards = new CardBucket();
        //uiCardContainer.holder.empty();
    }

    /**
     * Flush all cards from cardsOfType
     */
    function clearCards() {
        for (let labelType in cardsByType) {
            cardsByType[labelType] = null;
        }
    }

    self.fetchLabelsByType = fetchLabelsByType;
    self.getCards = getCards;
    self.getCurrentCards = getCurrentCards;
    self.push = push;
    self.updateCardsByType = updateCardsByType;
    self.updateCardsByTag = updateCardsByTag;
    //self.updateCardsBySeverity = updateCardsBySeverity;
    self.sortCards = sortCards;
    self.render = render;
    self.clearCurrentCards = clearCurrentCards;
    self.clearCards = clearCards;

    return this;
}