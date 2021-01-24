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
        $("#page-control").hide();
        sg.tagContainer.disable();
        $("#prev-page").prop("disabled", true);
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
        $("#prev-page").prop("disabled", false);
        updateCardsNewPage();
    }

    function handlePrevPageClick() {
        if (currentPage > 1) {
            sg.tracker.push("PrevPageClick", null, {
                From: currentPage,
                To: currentPage - 1
            });
            $("#next-page").prop("disabled", false);
            setPage(currentPage - 1);
            updateCardsNewPage();
        }
    }

    function setPage(pageNumber) {
        if (pageNumber <= 1) {
            $("#prev-page").prop("disabled", true);
        } 
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
            // TODO: Can we cache cards pulled in the "assorted" bucket into their respective card buckets?
            cardsByType[currentLabelType].push(card);
        } else {
            cardsByType[card.getLabelType()].push(card);
        }
    }

    /**
     * Updates cardsOfType if card type changes, and currentCards if filter changes
     */
    function updateCardsByType() {
        refreshUI();

        let filterLabelType = sg.tagContainer.getStatus().currentLabelType;
        if (currentLabelType !== filterLabelType) {
            // reset back to the first page
            setPage(1);
            sg.tagContainer.unapplyTags(currentLabelType)
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
        // TODO: lots of repeated code among this method and updateCardsByTag and updateCardsBySeverity
        // Think about imrpoving code design
        refreshUI();

        let appliedTags = sg.tagContainer.getAppliedTagNames();

        let appliedSeverities = sg.tagContainer.getAppliedSeverities();s

        currentCards = cardsByType[currentLabelType].copy();
        currentCards.filterOnTags(appliedTags);
        currentCards.filterOnSeverities(appliedSeverities);

        if (currentCards.getSize() < cardsPerPage * currentPage) {
            if (currentLabelType === "Occlusion") {
                fetchLabelsByType(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), function () {
                    render();
                });
            } else {
                fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
                    currentCards = cardsByType[currentLabelType].copy();
                    currentCards.filterOnTags(appliedTags);
                    currentCards.filterOnSeverities(appliedSeverities);
        
                    render();
                });
            }
        } else {
            render();
        }
    }

    function updateCardsByTag() {
        setPage(1);
        refreshUI();

        let appliedTags = sg.tagContainer.getAppliedTagNames();
        //appliedTags = appliedTags.length > 0 ? appliedTags : sg.tagContainer.getTagNames();

        let appliedSeverities = sg.tagContainer.getAppliedSeverities();

        fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
            currentCards = cardsByType[currentLabelType].copy();
            currentCards.filterOnTags(appliedTags);
            currentCards.filterOnSeverities(appliedSeverities);

            render();
        });
    }

    function updateCardsBySeverity() {
        setPage(1);
        refreshUI();

        let appliedTags = sg.tagContainer.getAppliedTagNames();
        //appliedTags = appliedTags.length > 0 ? appliedTags : sg.tagContainer.getTagNames();

        let appliedSeverities = sg.tagContainer.getAppliedSeverities();

        fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
            currentCards = cardsByType[currentLabelType].copy();
            console.log(currentCards.getCards());
            currentCards.filterOnTags(appliedTags);
            console.log(currentCards.getCards());
            currentCards.filterOnSeverities(appliedSeverities);
            console.log(currentCards.getCards());

            render();
        });
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
        $("#page-control").hide();
        // https://stackoverflow.com/questions/11071314/javascript-execute-after-all-images-have-loaded
        // ^^^
        // Useful link for loading then showing all iamges at once rather than weird card "shells"
         
        // TODO: should we try to just empty in the render method? Or assume it's 
        // already been emptied in a method utilizing render?
        uiCardContainer.holder.empty();
        pagewidth = uiCardContainer.holder.width();
        const cardWidth = pagewidth/3 - cardPadding;

        //TODO: refactor render method to handle going through currentCard CardBucket and rendering those of selected severities
        let idx = (currentPage - 1) * cardsPerPage;
        let cardBucket = currentCards.getCards();

        let imagesToLoad = [];
        let imagePromises = [];

        while (idx < currentPage * cardsPerPage && idx < cardBucket.length) {
            imagesToLoad.push(cardBucket[idx]);
            imagePromises.push(cardBucket[idx].loadImage());

            idx++;
        }

        if (imagesToLoad.length > 0) {
            if (imagesToLoad.length < cardsPerPage) {
                $("#next-page").prop("disabled", true);
            } else {
                $("#next-page").prop("disabled", false);
            }
            Promise.all(imagePromises).then(() => {
                imagesToLoad.forEach(card => card.renderSize(uiCardContainer.holder, cardWidth));
                $("#page-loading").hide();
                $("#page-control").show();
                sg.tagContainer.enable();
                $("#label-select").prop("disabled", false);
            });
        } else {
            // TODO: figure out how to better do the toggling of this element
            $("#labels-not-found").show();
            $("#page-loading").hide();
            sg.tagContainer.enable();
            $("#label-select").prop("disabled", false);
        }
    }

    /**
     * Refreshes the UI after each query made by user
     */
    function refreshUI() {
        sg.tagContainer.disable();
        $("#label-select").prop("disabled", true);
        $("#labels-not-found").hide();
        $("#page-loading").show();
        $("#page-control").hide();
        uiCardContainer.holder.empty();
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
