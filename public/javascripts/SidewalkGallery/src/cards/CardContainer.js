/**
 * Card Container module. This is responsible for managing the Card objects that are to be rendered.
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
        NoSidewalk: null
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
            render();
        });
    }

    function handleNextPageClick() {
        sg.tracker.push("NextPageClick", null, {
            From: currentPage,
            To: currentPage + 1
        });
        setPage(currentPage + 1);
        updateCardsNewPage();
    }

    function handlePrevPageClick() {
        if (currentPage > 1) {
            sg.tracker.push("PrevPageClick", null, {
                From: currentPage,
                To: currentPage - 1
            });
            setPage(currentPage - 1);
            updateCardsNewPage();
        }
    }

    function setPage(pageNumber) {
        currentPage = pageNumber;
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
            // TODO: Can we cache cards pulled in the "assorted" bucket into their resepctive card buckets?
            cardsByType[currentLabelType].push(card);
        } else {
            cardsByType[card.getLabelType()].push(card);
        }
    }

    /**
     * Updates cardsOfType if card type changes, and currentCards if filter changes
     */
    function updateCardsByType() {
        $("#labels-not-found").hide();
        $("#page-loading").show();

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
                fetchLabelsByType(labelTypeIds[filterLabelType], 30, Array.from(loadedLabelIds), function () {
                    render();
                });
            } else {
                currentCards = cardsByType[currentLabelType].copy();
                render();
            }
        }
    }

    function updateCardsNewPage() {
        // TODO: fix
        $("#labels-not-found").hide();
        $("#page-loading").show();

        currentCards = cardsByType[currentLabelType].copy();
        let bucket = currentCards.getCards();

        currentCards.filterOnTags(sg.tagContainer.getAppliedTagNames());
        let numTags = sg.tagContainer.getAppliedTagNames().length;

        const numCards = numCardsInBucket(bucket);
        let appliedSeverities = sg.tagContainer.getAppliedSeverities();
        appliedSeverities = appliedSeverities.length > 0 ? appliedSeverities : [1, 2, 3, 4, 5];

        if (numCards < cardsPerPage * currentPage) {
            if (numTags == 0) {
                fetchLabelsByType(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), function() {
                    render();
                });
            } else {
                fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, sg.tagContainer.getAppliedTagNames(), function() {
                    updateCardsNewPage();
                });
            }
        } else {
            render();
        }
    }

    function numCardsInBucket(bucket) {
        if (bucket == null) {
            return 0;
        }

        let num = 0;
        let severities = sg.tagContainer.getSeverities();

        for (let severity in bucket) {

            if (!sg.tagContainer.isSeverityApplied()){
                num += bucket[severity].length;
            } else if (severity != "null") {
                if (severities[severity - 1].getActive() == true) {
                    num += bucket[severity].length;
                }
            }
        }
        return num;
    }

    function updateCardsByTag() {
        setPage(1);
        $("#labels-not-found").hide();
        $("#page-loading").show();
        let appliedTags = sg.tagContainer.getAppliedTagNames();

        if (appliedTags.length > 0) {
            // TODO: fix this edge case!!!
            let appliedSeverities = sg.tagContainer.getAppliedSeverities();
            appliedSeverities = appliedSeverities.length > 0 ? appliedSeverities : [1, 2, 3, 4, 5];
            fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
                currentCards = cardsByType[currentLabelType].copy();

                currentCards.filterOnTags(appliedTags);

                render();
            });
        } else {
            currentCards = cardsByType[currentLabelType].copy();
            render();
        }
    }

    function updateCardsBySeverity() {
        // TODO: Doesn't work when label type is "assorted", need fix
        setPage(1);
        $("#labels-not-found").hide();
        $("#page-loading").show();
        let appliedSeverities = sg.tagContainer.getAppliedSeverities();
        let appliedTags = sg.tagContainer.getAppliedTagNames();
        appliedTags = appliedTags.length > 0 ? appliedTags : sg.tagContainer.getTagNames();

        if (appliedSeverities.length > 0) {
            fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
                currentCards = cardsByType[currentLabelType].copy();
                if (appliedTags.length > 0) {
                    // TODO: think about whether or not there is better way to do this
                    currentCards.filterOnTags(appliedTags);
                }

                render();
            });
        } else {
            currentCards = cardsByType[currentLabelType].copy();
            if (appliedTags.length > 0) {
                currentCards.filterOnTags(appliedTags);
            }

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
        $("#page-loading").show();
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

        // TODO: Some label types like Occlusion, have a lot of null severities. What to do with these?
        for (let i = severities.length - 1; i >= 0; i--) {
            if (severities[i].getActive() || noSeverities) {
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

        if (imagesToLoad.length > 0) {
            Promise.all(imagePromises).then(() => {
                imagesToLoad.forEach(card => card.renderSize(uiCardContainer.holder, cardWidth));
                $("#page-loading").hide();
            });
        } else {
            // TODO: figure out how to better do the toggling of this element
            $("#labels-not-found").show();
            $("#page-loading").hide();
        }
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
    self.updateCardsBySeverity = updateCardsBySeverity;
    self.updateCardsNewPage = updateCardsNewPage;
    self.sortCards = sortCards;
    self.render = render;
    self.clearCurrentCards = clearCurrentCards;
    self.clearCards = clearCards;

    _init();
    return this;
}