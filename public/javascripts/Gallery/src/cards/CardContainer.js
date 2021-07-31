/**
 * Card Container module. This is responsible for managing the Card objects that are to be rendered.
 * 
 * @param {*} uiCardContainer UI element tied with this CardContainer.
 * @returns {CardContainer}
 * @constructor
 */
function CardContainer(uiCardContainer) {
    let self = this;

    // The number of labels to grab from database on initial page load.
    const initialLoad = 30;

    const cardsPerPage = 9;
    const cardsPerLine = 3;
    const cardPadding = 25;

    // TODO: Possibly remove if any type of sorting is no longer wanted.
    let status = {
        order: 0
    };

    // Map label type to id.
    let labelTypeIds = {
        CurbRamp: 1,
        NoCurbRamp: 2,
        Obstacle: 3,
        SurfaceProblem: 4,
        Other: 5,
        Occlusion: 6,
        NoSidewalk: 7,
        Assorted: -1
    };

    // Current label type of cards being shown.
    let currentLabelType = 'Assorted';
    let currentPage = 1;
    let pageNumberDisplay = null;
    let pageWidth;
    let modal;
    // Map Cards to a CardBucket containing Cards of their label type.
    let cardsByType = {
        Assorted: new CardBucket(),
        CurbRamp: new CardBucket(),
        NoCurbRamp: new CardBucket(),
        Obstacle: new CardBucket(),
        SurfaceProblem: new CardBucket(),
        Other: new CardBucket(),
        Occlusion: new CardBucket(),
        NoSidewalk: new CardBucket()
    };

    // Keep track of labels we have loaded already as to not grab the same label from the backend.
    let loadedLabelIds = new Set();

    // Current labels being displayed of current type based off filters.
    let currentCards = new CardBucket();

    function _init() {
        pageWidth = uiCardContainer.holder.width();

        // Bind click actions to the forward/backward paging buttons.
        if (uiCardContainer) {
            uiCardContainer.nextPage.bind({
                click: handleNextPageClick
            });
            uiCardContainer.prevPage.bind({
                click: handlePrevPageClick
            });
        }

        pageNumberDisplay = document.createElement('h2');
        pageNumberDisplay.innerText = "1";
        uiCardContainer.pageNumber.append(pageNumberDisplay);
        $(".page-control").hide();
        sg.tagContainer.disable();
        $("#prev-page").prop("disabled", true);
        cardsByType[currentLabelType] = new CardBucket();

        // Grab first batch of labels to show.
        fetchLabelsByType(labelTypeIds.Assorted, initialLoad, Array.from(loadedLabelIds), function() {
            currentCards = cardsByType[currentLabelType].copy();
            render();
        });
        // Creates the Modal object in the DOM element currently present.
        modal = new Modal($('.gallery-modal'));
        // Add the click event for opening the Modal when a card is clicked.
        $("#image-card-container").on('click', '.static-gallery-image, .additional-count',  (event) => {
            $('.gallery-modal').attr('style', 'display: flex');
            $('.grid-container').css("grid-template-columns", "1fr 2fr 3fr");
            // If the user clicks on the image body in the card, just use the provided id.
            // Otherwise, the user will have clicked on an existing "+n" icon on the card, meaning we need to acquire
            // the cardId from the card-tags DOM element (as well as perform an additional prepend to put the ID in
            // the correct form).
            // TODO(micdun): this is pretty janky, think of better way?
            let clickedImage = event.target.classList.contains("static-gallery-image")
            let cardId = clickedImage ? event.target.id :
                                        "label_id_" + event.target.closest(".card-tags").id;
            // Sets/Updates the label being displayed in the expanded modal.
            modal.updateCardIndex(findCardIndex(cardId));
        });
    }

    /**
     * Find the card which contains the image with the same imageID as supplied.
     * 
     * @param {String} id The id of the image Id to find
     * @returns {Card} finds the matching card and returns it
     */
    function findCard(id) {
        return currentCards.findCardByImageId(id);
    }

    /**
     * Returns the index of a card in the current CardBucket in use. 
     * 
     * @param {String} id The id of the image Id to find
     * @returns {Number} the index of the matching card in the current CardBucket
     */
    function findCardIndex(id) {
        return currentCards.findCardIndexByImageId(id);
    }

    /**
     * Gets a card from the current CardBucket given an index.
     * 
     * @param {Number} index the index of the card to find
     * @returns {Card} the Card that has the matching index in the current CardBucket
     */
    function getCardByIndex(index) {
        return currentCards.getCardByIndex(index);
    }

    function handleNextPageClick() {
        sg.tracker.push("NextPageClick", null, {
            from: currentPage,
            to: currentPage + 1
        });
        setPage(currentPage + 1);
        $("#prev-page").prop("disabled", false);
        updateCardsNewPage();
    }

    function handlePrevPageClick() {
        if (currentPage > 1) {
            sg.tracker.push("PrevPageClick", null, {
                from: currentPage,
                to: currentPage - 1
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

    /**
     * Grab n assorted labels of specified type.
     * 
     * @param {*} labelTypeId Label type id specifying labels of what label type to grab.
     * @param {*} n Number of labels to grab.
     * @param {*} loadedLabels Label Ids of labels already grabbed.
     * @param {*} callback Function to be called when labels arrive.
     */
    function fetchLabelsByType(labelTypeId, n, loadedLabels, callback) {
        $.getJSON("/label/labelsByType", { labelTypeId: labelTypeId, n: n, loadedLabels: JSON.stringify(loadedLabels)}, function (data) {
            if ("labelsOfType" in data) {
                let labels = data.labelsOfType
                let card;
                let i = 0;
                let len = labels.length;
                for (; i < len; i++) {
                    let labelProp = labels[i];
                    if ("label" in labelProp && "imageUrl" in labelProp) {
                        card = new Card(labelProp.label, labelProp.imageUrl);
                        self.push(card);
                        loadedLabelIds.add(card.getLabelId());
                    }
                }
                if (callback) callback();
            }
        });
        
    }

    /**
     * Grab n assorted labels of specified label type, severities, and tags.
     * 
     * @param {*} labelTypeId Label type id specifying labels of what label type to grab.
     * @param {*} n Number of labels to grab.
     * @param {*} loadedLabels Label Ids of labels already grabbed.
     * @param {*} severities Severities the labels to be grabbed can have.
     * @param {*} tags Tags the labels to be grabbed can have.
     * @param {*} callback Function to be called when labels arrive.
     */
    function fetchLabelsBySeverityAndTags(labelTypeId, n, loadedLabels, severities, tags, callback) {
        $.getJSON("/label/labelsBySeveritiesAndTags", { labelTypeId: labelTypeId, n: n, loadedLabels: JSON.stringify(loadedLabels), severities: JSON.stringify(severities), tags: JSON.stringify(tags) }, function (data) {
            if ("labelsOfType" in data) {
                let labels = data.labelsOfType
                let card;
                let i = 0;
                let len = labels.length;
                for (; i < len; i++) {
                    let labelProp = labels[i];
                    if ("label" in labelProp && "imageUrl" in labelProp) {
                        card = new Card(labelProp.label, labelProp.imageUrl);
                        self.push(card);
                        loadedLabelIds.add(card.getLabelId());
                    }
                }
                if (callback) callback();
            }
        });

    }

    /**
     * Returns cards of current type.
     */
    function getCards() {
        return cardsByType;
    }

    /**
     * Returns cards of current type that are being rendered.
     */
    function getCurrentCards() {
        return currentCards;
    }

    /**
     * Push a card into corresponding CardBucket in cardsOfType as well as the "Assorted" bucket.
     * @param card Card to add.
     */
    function push(card) {
        cardsByType.Assorted.push(card);
        cardsByType[card.getLabelType()].push(card);
    }

    /**
     * Updates cardsOfType when new label type selected.
     */
    function updateCardsByType() {
        refreshUI();

        let filterLabelType = sg.tagContainer.getStatus().currentLabelType;
        if (currentLabelType !== filterLabelType) {
            // Reset back to the first page.
            setPage(1);
            sg.tagContainer.unapplyTags(currentLabelType);
            currentLabelType = filterLabelType;

            fetchLabelsByType(labelTypeIds[filterLabelType], cardsPerPage, Array.from(loadedLabelIds), function () {
                currentCards = cardsByType[currentLabelType].copy();
                render();
            });
        }
    }

    /**
     * Updates Cards being shown when user moves to next/previous page.
     */
    function updateCardsNewPage() {
        // TODO: lots of repeated code among this method and updateCardsByTag and updateCardsBySeverity.
        // Think about improving code design.
        refreshUI();

        let appliedTags = sg.tagContainer.getAppliedTagNames();
        let appliedSeverities = sg.tagContainer.getAppliedSeverities();

        currentCards = cardsByType[currentLabelType].copy();
        currentCards.filterOnTags(appliedTags);
        currentCards.filterOnSeverities(appliedSeverities);

        if (currentCards.getSize() < cardsPerPage * currentPage) {
            // When we don't have enough cards of specific query to show on one page, see if more can be grabbed.
            if (currentLabelType === "Occlusion") {
                fetchLabelsByType(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), function () {
                    currentCards = cardsByType[currentLabelType].copy();
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

    /**
     * When tag filter is updated, update Cards to be shown.
     */
    function updateCardsByTag() {
        setPage(1);
        refreshUI();

        let appliedTags = sg.tagContainer.getAppliedTagNames();
        let appliedSeverities = sg.tagContainer.getAppliedSeverities();

        fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
            currentCards = cardsByType[currentLabelType].copy();
            currentCards.filterOnTags(appliedTags);
            currentCards.filterOnSeverities(appliedSeverities);

            render();
        });
    }

    /**
     * When severity filter is updated, update Cards to be shown.
     */
    function updateCardsBySeverity() {
        setPage(1);
        refreshUI();

        let appliedTags = sg.tagContainer.getAppliedTagNames();
        let appliedSeverities = sg.tagContainer.getAppliedSeverities();

        fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
            currentCards = cardsByType[currentLabelType].copy();
            currentCards.filterOnTags(appliedTags);
            currentCards.filterOnSeverities(appliedSeverities);

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
     * Renders current cards.
     */
    function render() {
        // To help the loading icon show, we make the sidebar positioned relatively while we are loading on the page.
        // Otherwise, keep it fixed. This is hacky and needs a better fix.
        $("#page-loading").show();
        $('.sidebar').css('position', 'relative');
        $(".page-control").hide();
         
        // TODO: should we try to just empty in render method? Or assume it's was emptied in a method utilizing render?
        clearCardContainer(uiCardContainer.holder);
        pageWidth = uiCardContainer.holder.width();
        const cardWidth = pageWidth/cardsPerLine - cardPadding;

        let imagesToLoad = getCurrentPageCards();
        let imagePromises = imagesToLoad.map(img => img.loadImage());

        if (imagesToLoad.length > 0) {
            if (imagesToLoad.length < cardsPerPage) {
                $("#next-page").prop("disabled", true);
            } else {
                $("#next-page").prop("disabled", false);
            }

            // We wait for all the promises from grabbing pano images to resolve before showing cards.
            Promise.all(imagePromises).then(() => {
                imagesToLoad.forEach((card) => {card.renderSize(uiCardContainer.holder, cardWidth)});
                $(".page-control").show();
                $("#page-loading").hide();
                $('.sidebar').css('position', 'fixed');
                sg.tagContainer.enable();
                $("#label-select").prop("disabled", false);
            });
        } else {
            // TODO: figure out how to better do the toggling of this element.
            $("#labels-not-found").show();
            $("#page-loading").hide();
            sg.tagContainer.enable();
            $("#label-select").prop("disabled", false);
        }
    }

    /**
     * Refreshes the UI after each query made by user.
     */
    function refreshUI() {
        modal.closeModal();
        sg.tagContainer.disable();
        $("#label-select").prop("disabled", true);
        $("#labels-not-found").hide();
        $("#page-loading").show();
        $('.sidebar').css('position', 'relative');
        $(".page-control").hide();
        clearCardContainer(uiCardContainer.holder);
    }

    /**
     * Set status attribute.
     * 
     * @param {*} key Status name.
     * @param {*} value Status value. 
     */
    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    /**
     * Flush all Cards currently being rendered.
     */
    function clearCurrentCards() {
        currentCards = new CardBucket();
    }

    /**
     * Flush all Cards from cardsOfType.
     */
    function clearCards() {
        for (const labelType of cardsByType) {
            cardsByType[labelType] = null;
        }
    }

    /**
     * Clear Cards from UI.
     * @param {*} cardContainer UI element to clear Cards from.
     */
    function clearCardContainer(cardContainer) {
        cardContainer.children().each(function() {
            $(this).detach();
        });
    }

    function getCurrentPage() {
        return currentPage;
    }

    /**
     * Get the cards that form the current page.
     * @returns Array of cards from the current page.
     */
    function getCurrentPageCards() {
        let idx = (currentPage - 1) * cardsPerPage;
        let cardBucket = currentCards.getCards();

        let currentPageCards = [];
        while (idx < currentPage * cardsPerPage && idx < cardBucket.length) {
            currentPageCards.push(cardBucket[idx]);
            idx++;
        }
        return currentPageCards;
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
    self.getCardByIndex = getCardByIndex;
    self.getCurrentPage = getCurrentPage;
    self.getCurrentPageCards = getCurrentPageCards;

    _init();
    return this;
}
