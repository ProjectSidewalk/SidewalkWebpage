/**
 * Card Container module. This is responsible for storing the Card objects that are to be rendered.
 * @returns {CardContainer}
 * @constructor
 */
function CardContainer(uiCardContainer) {
    let self = this;

    const cardsPerPage = 9;

    const cardPadding = 25;

    let status = {
        order: 0
    };

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

    let currentPage = 1;

    let pageNumberDisplay = null;

    let pagewidth;

    //const cardPadding = 15;

    let cardsByType = {
        Assorted: null,
        CurbRamp: null,
        NoCurbRamp: null,
        Obstacle: null,
        SurfaceProblem: null,
        Other: null,
        Occlusion: null,
        NoSidewalk: null,
        Problem: null
    };

    // Keep track of labels we have loaded already as to not grab the same label from the backend
    let loadedLabelIds = new Set();

    // Current labels being displayed of current type based off filters
    let currentCards = new CardBucket();

    function _init() {
        pagewidth = uiCardContainer.holder.width();
        if (uiCardContainer) {
            uiCardContainer.nextPage.bind({
                click: handleNextPageClick
            })
            uiCardContainer.prevPage.bind({
                click: handlePrevPageClick
            })
        }
        pageNumberDisplay = document.createElement('h2');
        pageNumberDisplay.innerText = "1";
        uiCardContainer.pageNumber.append(pageNumberDisplay);
        cardsByType[currentLabelType] = new CardBucket();
        fetchLabelsByType(9, 30, Array.from(loadedLabelIds), function() {
            console.log("assorted labels loaded for landing page");
            render();
        });
    }

    function handleNextPageClick() {
        console.log('next page');
        setPage(currentPage + 1);
        updateCardsNewPage();
    }

    function handlePrevPageClick() {
        if (currentPage > 1) {
            console.log('previous page');
            setPage(currentPage - 1);
            updateCardsNewPage();
        }
    }

    function setPage(pageNumber) {
        currentPage = pageNumber;
        console.log("next page " + pageNumber)
        pageNumberDisplay.innerText = pageNumber;
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
                        self.push(card);
                        loadedLabelIds.add(card.getLabelId());
                    }
                }
                currentCards = cardsByType[currentLabelType].copy();
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
        if (currentLabelType == 'Assorted') {
            cardsByType[currentLabelType].push(card);
        } else {
            cardsByType[card.getLabelType()].push(card);
        }
    }

    /**
     * Updates cardsOfType if card type changes, and currentCards if filter changes
     */
    function updateCardsByType() {
        uiCardContainer.holder.empty();
        let filterLabelType = sg.tagContainer.getStatus().currentLabelType;
        if (currentLabelType !== filterLabelType) {
            // reset back to the first page
            setPage(1);
            sg.tagContainer.unapplyTags(currentLabelType)
            clearCurrentCards();
            currentLabelType = filterLabelType;

            if (cardsByType[currentLabelType] == null) {
                cardsByType[currentLabelType] = new CardBucket();
                console.log(Array.from(loadedLabelIds));
                fetchLabelsByType(labelTypeIds[filterLabelType], 30, Array.from(loadedLabelIds), function () {
                    console.log("new labels gathered");
                    render();
                });
            } else {
                currentCards = cardsByType[currentLabelType].copy();
                render();
            }
        }
    }

    function updateCardsNewPage() {
        currentCards = cardsByType[currentLabelType].copy();
        let bucket = currentCards.getCards();

        currentCards.filterOnTags(sg.tagContainer.getAppliedTagNames());
        let numTags = sg.tagContainer.getAppliedTagNames().length;

        const numCards = numCardsInBucket(bucket);
        let appliedSeverities = getAppliedSeverities(sg.tagContainer.getSeverities());
        appliedSeverities = appliedSeverities > 0 ? appliedSeverities : [1, 2, 3, 4, 5];

        if (numCards < cardsPerPage * currentPage) {
            console.log("grabbed more cards of severity and tag, rendering afterwards");
            if (numTags == 0) {
                fetchLabelsByType(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), function() {
                    console.log("got new labels");
                    render();
                });
            } else {
                fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, sg.tagContainer.getAppliedTagNames(), function() {
                    console.log("got new labels");
                    updateCardsNewPage();
                });
            }
            
        }
        render();
    }

    function numCardsInBucket(bucket) {
        if (bucket == null) {
            return 0;
        }

        let num = 0;
        for (let severity in bucket) {
            num += bucket[severity].length;
        }
        return num;
    }

    function getAppliedSeverities(severities) {
        appliedSeverities = [];
        for (let i = 0; i < severities.length; i++){
            if (severities[i].getActive()){
                appliedSeverities.push(severities[i].getSeverity());
            }
        }
        return appliedSeverities;
    }

    // Fix how this filter works
    function updateCardsByTag() {
        setPage(1);

        console.log("grabbed more cards of severity and tag, rendering afterwards");
        let appliedTags = sg.tagContainer.getAppliedTagNames();

        if (appliedTags.length > 0) {
            // TODO: fix this edge case!!!
            let appliedSeverities = getAppliedSeverities(sg.tagContainer.getSeverities());
            appliedSeverities = appliedSeverities > 0 ? appliedSeverities : [1, 2, 3, 4, 5];
            fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
                console.log("got new labels");
                currentCards = cardsByType[currentLabelType].copy();

                currentCards.filterOnTags(appliedTags);

                render();
            });
        } else {
            currentCards = cardsByType[currentLabelType].copy();
            render();
        }
    }


    function sortCards(order) {
        // uiCardContainer.holder.empty();
        // currentCards.sort((card1, card2) => sg.cardSortMenu.getStatus().severity * card1.getProperty("severity") - card2.getProperty("severity"));
        //
        // render();
        // console.log("sort cards in card container called");
        // // Write a sorting query for backend
        // setStatus("order", order);
        // render();
    }

    /**
     * Renders current cards
     */
    function render() {
        // https://stackoverflow.com/questions/11071314/javascript-execute-after-all-images-have-loaded
        // ^^^
        // Useful link for loading then showing all iamges at once rather than weird card "shells"
         
        // TODO: consider a build query model, discuss with Aroosh
        uiCardContainer.holder.empty();
        pagewidth = uiCardContainer.holder.width();
        const cardWidth = pagewidth/3 - cardPadding;

        //TODO: refactor render method to handle going through currentCard CardBucket and rendering those of selected severities
        let num = 0;
        let start = (currentPage - 1) * cardsPerPage;
        let cardBucket = currentCards.getCards();
        let severities = sg.tagContainer.getSeverities();

        let noSeverities = !sg.tagContainer.isSeverityApplied();

        let imagesToLoad = [];
        let imagePromises = [];
        //console.time('render cards');
        for (let i = severities.length - 1; i >= 0; i--){
            if (severities[i].getActive() || noSeverities){
                let subBucket = cardBucket[severities[i].getSeverity()];
                for (let j = 0; j < subBucket.length; j++) {
                    if (num >= cardsPerPage * currentPage) break;
                    if (num >= start) {
                        imagesToLoad.push(subBucket[j]);
                        imagePromises.push(subBucket[j].loadImage());
                    }

                    num++;
                }
            }
        }

        console.log("images pushed to subbucket: " + imagesToLoad.length);
        Promise.all(imagePromises).then(() => {
            console.log("all images loaded");
            imagesToLoad.forEach(card => card.renderSize(uiCardContainer.holder, cardWidth));
        });
        // We can put a call to start the loading gif here and end the gif in the 'then' statement of the promise
    }

    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
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
    self.sortCards = sortCards;
    self.render = render;
    self.clearCurrentCards = clearCurrentCards;
    self.clearCards = clearCards;

    _init();
    return this;
}