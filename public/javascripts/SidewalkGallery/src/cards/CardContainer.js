/**
 * Card Container module. This is responsible for storing the Card objects that are to be rendered.
 * @returns {CardContainer}
 * @constructor
 */
function CardContainer(uiCardContainer) {
    let self = this;

    let pageCardCount = 10;

    let labelTypeIds = {
        CurbRamp: 1,
        NoCurbRamp: 2,
        Obstacle: 3,
        SurfaceProblem: 4,
        Other: 5,
        Occlusion: 6,
        NoSidewalk: 7,
        Problem: 8,
        Assorted: 9
    };

    let currentLabelType = 'Assorted';

    // Assorted is a special bucket: all grabbed labels will be added to the assorted bucket 
    let cardsByType = {
        Assorted: new CardBucket(),
        CurbRamp: new CardBucket(),
        NoCurbRamp: new CardBucket(),
        Obstacle: new CardBucket(),
        SurfaceProblem: new CardBucket(),
        Other: new CardBucket(),
        Occlusion: new CardBucket(),
        NoSidewalk: new CardBucket(),
        Problem: new CardBucket()
    };

    // Keep track of labels we have loaded already as to not grab the same label from the backend
    let loadedLabelIds = new Set();

    // Current labels being displayed of current type based off filters
    let currentCards = new CardBucket();

    function _init() {
        fetchLabelsByType(9, 30, Array.from(loadedLabelIds), function() {
            console.log("assorted labels loaded for landing page");
            console.log(cardsByType['Assorted'].getSize() + " assorted");
            console.log(cardsByType['CurbRamp'].getSize() + " curb ramps after assorted");
            console.log(cardsByType['NoCurbRamp'].getSize() + " non curb ramps after assorted");
            console.log(cardsByType['Obstacle'].getSize() + " obstacles after assorted");
            render();
        });

        // TODO: Create a populate function to prefill labels
        fetchLabelsByType(1, 30, Array.from(loadedLabelIds), function() {
            console.log("populate with curb ramps");
            console.log(cardsByType['CurbRamp'].getSize() + " curb ramps");
            console.log(cardsByType['Assorted'].getSize() + " assorted");
        });

        fetchLabelsByType(2, 30, Array.from(loadedLabelIds), function() {
            console.log("populate with missing curb ramps");
            console.log(cardsByType['NoCurbRamp'].getSize() + " non curb ramps");
            console.log(cardsByType['Assorted'].getSize() + " assorted");
        });
        fetchLabelsByType(3, 30, Array.from(loadedLabelIds), function() {
            console.log("populate with obstacles");
            console.log(cardsByType['Obstacle'].getSize() + " obstacles");
            console.log(cardsByType['Assorted'].getSize() + " assorted");
        });
    }

    function fetchLabelsByType(labelTypeId, n, loadedLabels, callback) {
        $.getJSON("/label/labelsByType", { labelTypeId: labelTypeId, n: n, loadedLabels: JSON.stringify(loadedLabels)}, function (data) {
            if ("labelsOfType" in data) {
                let labels = data.labelsOfType,
                    card,
                    i = 0,
                    len = labels.length;
                for (; i < len; i++) {
                    let labelProp = labels[i];
                    if ("label" in labelProp && "imageUrl" in labelProp) {
                        card = new Card(labelProp.label, labelProp.imageUrl);
                        self.push(card)
                        loadedLabelIds.add(card.getLabelId());
                    }
                }
                if (callback) callback();
            }
        });
    }

    function fetchLabelsBySeverityAndTags(labelTypeId, n, loadedLabels, severities, tags, callback) {
        $.getJSON("/label/labelsBySeveritiesAndTags", { labelTypeId: labelTypeId, n: n, loadedLabels: JSON.stringify(loadedLabels), severities: JSON.stringify(severities), tags: JSON.stringify(tags) }, function (data) {
            if ("labelsOfType" in data) {
                let labels = data.labelsOfType,
                    card,
                    i = 0,
                    len = labels.length;
                for (; i < len; i++) {
                    let labelProp = labels[i];
                    if ("label" in labelProp && "imageUrl" in labelProp) {
                        card = new Card(labelProp.label, labelProp.imageUrl);
                        self.push(card)
                        loadedLabelIds.add(card.getLabelId());
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
        cardsByType['Assorted'].push(card);
        cardsByType[card.getLabelType()].push(card);
    
        // For now, we have to also add every label we grab to the Assorted bucket for the assorted option
        //cardsByType['Assorted'].push(card);
        currentCards.push(card);
    }

    /**
     * Updates cardsOfType if card type changes, and currentCards if filter changes
     */
    function updateCardsByType() {
        uiCardContainer.holder.empty();
        let filterLabelType = sg.tagContainer.getStatus().currentLabelType;
        if (currentLabelType !== filterLabelType) {
            sg.tagContainer.unapplyTags(currentLabelType)
            clearCurrentCards();
            currentLabelType = filterLabelType;

            if (cardsByType[currentLabelType].getSize() != 0) {
                currentCards = cardsByType[currentLabelType].copy();
                render();
                fetchLabelsByType(labelTypeIds[filterLabelType], 30, Array.from(loadedLabelIds), function () {
                    console.log("new labels gathered");
                    console.log(cardsByType[filterLabelType].getSize());
                });
            } else {
                fetchLabelsByType(labelTypeIds[filterLabelType], 30, Array.from(loadedLabelIds), function () {
                    console.log("new labels gathered");
                    render();
                });
            }
        }
    }

    function updateCardsByTag(tag) {
        if (tag.getStatus().applied) {
            currentCards.filterByTag(tag);
            console.log(currentCards.getSize() + " size of card bucket after a filter");

            let currentCardsWithSelectedSeveritiesCount = 0;
            let severities = sg.tagContainer.getSeverities();
            let appliedSeverities = [];
            for (let i = 0; i < severities.length; i++){
                if (severities[i].getActive()){
                    currentCardsWithSelectedSeveritiesCount += currentCards.getSizeOfSeverity(severities[i].getSeverity());
                    appliedSeverities.push(severities[i].getSeverity());
                }
            }

            if (currentCardsWithSelectedSeveritiesCount < pageCardCount) {
                fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], pageCardCount, Array.from(loadedLabelIds), appliedSeverities, sg.tagContainer.getAppliedTags(), function() {
                    console.log("grabbed more cards of severity and tag, rendering afterwards");
                    render();
                });
            } else {
                render();
                fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], pageCardCount, Array.from(loadedLabelIds), appliedSeverities, sg.tagContainer.getAppliedTags(), function() {
                    console.log("grabbed more cards of severity and tag");
                });
            }
        } else {
           //clearCurrentCards();
           currentCards = cardsByType[currentLabelType].copy();
           let tagsToCheck = sg.tagContainer.getTagsByType()[currentLabelType];
           for (let i = 0; i < tagsToCheck.length; i++) {
               let tag = tagsToCheck[i];
               if (tag.getStatus().applied) {
                   currentCards.filterByTag(tag);
               }
           }
           //updateCardsBySeverity();
            console.log(currentCards.getCards());
            render();
        }
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
                    if (num >= pageCardCount) break;
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

    _init();
    return this;
}