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

    // Fetched labels of current type
    let cardsOfType = [];

    // Current labels being displayed of current type based off filters
    let currentCards = [];

    let tagFiltered = [];

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
        return cardsOfType;
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
        cardsOfType.push(card);
        currentCards.push(card);
        tagFiltered.push(card);
    }

    /**
     * Updates cardsOfType if card type changes, and currentCards if filter changes
     */
    function updateCardsByType() {
        let filterLabelType = sg.tagContainer.getStatus().currentLabelType;
        if (currentLabelType !== filterLabelType) {
            currentLabelType = filterLabelType;
            clearCards();
            clearCurrentCards();
            fetchLabelsByType(labelTypeIds[filterLabelType], function () {
                console.log("new labels gathered");
                render();
            });
        }
    }

    function updateCardsByTag(tag) {
        uiCardContainer.holder.empty();

        if (tag.getStatus().applied) {
            currentCards = currentCards.filter(card => card.getProperty("tags").includes(tag.getProperty("tag")));
        } else {
           clearCurrentCards();
           let newCards = cardsOfType;
           //let initialCardsSet = false;
           let tagsToCheck = sg.tagContainer.getTagsByType()[currentLabelType];
           //console.log(tagsToCheck.length);
           for (let i = 0; i < tagsToCheck.length; i++) {
               let tag = tagsToCheck[i];
               if (tag.getStatus().applied) {
                   //if (initialCardsSet) {
                   newCards = newCards.filter(card => card.getProperty("tags").includes(tag.getProperty("tag")));
                   // } else {
                   //     newCards = cardsOfType.filter(card => card.getProperty("tags").includes(tag.getProperty("tag")));
                   //     initialCardsSet = true;
                   // }
               }
           }

           // if (!initialCardsSet) {
           //     cardsOfType.forEach(card => newCards.push(card));
           // }
           tagFiltered = newCards;
           console.log(newCards.length);
           console.log(tagFiltered.length);
           updateCardsBySeverity();
        }

        render();
    }

    function updateCardsBySeverity(){
        uiCardContainer.holder.empty();
        // clearCurrentCards();
        let newCards = [];
        for (let i = 0; i < tagFiltered.length; i++){
            // console.log(currentCards[i].getProperty("severity") == severity.getSeverity());
            let severities = sg.tagContainer.getSeverities();

            for (let j = 0; j < severities.length; j++){
                if (severities[j].getActive()){
                    if (tagFiltered[i].getProperty("severity") == severities[j].getSeverity()){
                        newCards.push(tagFiltered[i]);
                        // console.log(tagFiltered[i].getProperty("severity") == severities[j].getSeverity());
                    }
                }
            }
            // severities.forEach( severity => {
            //     if (currentCards[i].getProperty("severity") == severity.getSeverity() && severity.getActive()){
            //         newTags.push(currentCards[i]);
            //     }}
            // );
            
        }
        console.log(newCards.length);
        currentCards = newCards;
        
            
       

        render();
    }

    /**
     * Renders current cards
     */
    function render() {
        let num = currentCards.length >= 10 ? 10 : currentCards.length;
        for (let i = 0; i < num; i++) {
            currentCards[i].render(uiCardContainer.holder);
        }
    }

    /**
     * Flush all cards currently being rendered
     */
    function clearCurrentCards() {
        currentCards = [];
        uiCardContainer.holder.empty();
    }

    /**
     * Flush all cards from cardsOfType
     */
    function clearCards() {
        cardsOfType = [];
        tagFiltered = [];
    }

    self.fetchLabelsByType = fetchLabelsByType;
    self.getCards = getCards;
    self.getCurrentCards = getCurrentCards;
    self.push = push;
    self.updateCardsByType = updateCardsByType;
    self.updateCardsByTag = updateCardsByTag;
    self.updateCardsBySeverity = updateCardsBySeverity;
    self.render = render;
    self.clearCurrentCards = clearCurrentCards;
    self.clearCards = clearCards;

    return this;
}