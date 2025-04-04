/**
 * Card Container module. This is responsible for managing the Card objects that are to be rendered.
 * 
 * @param {*} uiCardContainer UI element tied with this CardContainer.
 * @param initialFilters Object containing initial set of filters in sidebar.
 * @returns {CardContainer}
 * @constructor
 */
function CardContainer(uiCardContainer, initialFilters) {
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
        Crosswalk: 9,
        Signal: 10,
        Assorted: null
    };

    // Current label type of cards being shown.
    let currentLabelType = initialFilters.labelType;
    sg.neighborhoodIds = initialFilters.neighborhoods; // TODO remove this when we add a UI for filtering neighborhoods.
    let currentPage = 1;
    let lastPage = false;
    let pageNumberDisplay = null;
    let expandedView;
    // Map Cards to a CardBucket containing Cards of their label type.
    let cardsByType = {
        Assorted: new CardBucket(),
        CurbRamp: new CardBucket(),
        NoCurbRamp: new CardBucket(),
        Obstacle: new CardBucket(),
        SurfaceProblem: new CardBucket(),
        Other: new CardBucket(),
        Occlusion: new CardBucket(),
        NoSidewalk: new CardBucket(),
        Crosswalk: new CardBucket(),
        Signal: new CardBucket()
    };

    // Keep track of labels we have loaded already as to not grab the same label from the backend.
    let loadedLabelIds = new Set();

    // Current labels being displayed of current type based off filters.
    let currentCards = new CardBucket();

    function _init() {
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
        sg.ui.pageControl.hide();
        sg.cardFilter.disable();
        sg.ui.cardContainer.prevPage.prop("disabled", true);
        cardsByType[currentLabelType] = new CardBucket();

        // Grab first batch of labels to show.
        fetchLabels(labelTypeIds[currentLabelType], initialLoad, initialFilters.validationOptions, Array.from(loadedLabelIds), initialFilters.neighborhoods, initialFilters.severities, initialFilters.tags, function() {
            currentCards = cardsByType[currentLabelType].copy();
            lastPage = currentCards.getCards().length <= currentPage * cardsPerPage;
            render();
        });
        // Creates the ExpandedView object in the DOM element currently present.
        expandedView = new ExpandedView($('.gallery-expanded-view'));
        // Add the click event for opening the ExpandedView when a card is clicked.
        sg.ui.cardContainer.holder.on('click', '.static-gallery-image, .additional-count', (event) => {
            $('.gallery-expanded-view').css('display', 'flex');
            $('.grid-container').css("grid-template-columns", "1fr 5fr");
            // If the user clicks on the image body in the card, just use the provided id.
            // Otherwise, the user will have clicked on an existing "+n" icon on the card, meaning we need to acquire
            // the cardId from the card-tags DOM element (as well as perform an additional prepend to put the ID in
            // the correct form).
            let clickedImage = event.target.classList.contains("static-gallery-image")
            let cardId = clickedImage ? event.target.id :
                "label_id_" + event.target.closest(".card-tags").id;
            // Sets/Updates the label being displayed in the expanded view.
            expandedView.updateCardIndex(findCardIndex(cardId));
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

    function handleNextPageClick(e) {
        // This variable will be true if this is a "real" click. Otherwise, it will be false for .click() js code.
        const fromUser = typeof (e['clientX']) !== "undefined"

        sg.tracker.push("NextPage", null, {
            from: currentPage,
            to: currentPage + 1
        });

        if (fromUser) {
            sg.tracker.push("NextPageClick", null, null);
        }

        setPage(currentPage + 1);
        sg.ui.cardContainer.prevPage.prop("disabled", false);
        updateCardsNewPage();
    }

    function handlePrevPageClick(e) {
        if (currentPage > 1) {
            // This variable will be true if this is a "real" click. Otherwise, it will be false for .click() js code.
            const fromUser = typeof (e['clientX']) !== "undefined"

            sg.tracker.push("PrevPage", null, {
                from: currentPage,
                to: currentPage - 1
            });

            if (fromUser) {
                sg.tracker.push("PrevPageClick", null, null);
            }

            $("#next-page").prop("disabled", false);
            setPage(currentPage - 1);
            updateCardsNewPage();
        }
    }

    function setPage(pageNumber) {
        if (pageNumber <= 1) {
            sg.ui.cardContainer.prevPage.prop("disabled", true);
        }
        currentPage = pageNumber;
        pageNumberDisplay.innerText = pageNumber;
    }

    /**
     * Grab n assorted labels of specified label type, severities, and tags.
     *
     * @param {*} labelTypeId Label type id specifying labels of what label type to grab.
     * @param {*} n Number of labels to grab.
     * @param validationOptions List of validation options for fetched labels: correct, incorrect, and/or unvalidated.
     * @param {*} loadedLabels Label Ids of labels already grabbed.
     * @param {*} neighborhoods Region IDs the labels to be grabbed can be from (Set to undefined if N/A).
     * @param {*} severities Severities the labels to be grabbed can have (Set to undefined if N/A).
     * @param {*} tags Tags the labels to be grabbed can have (Set to undefined if N/A).
     * @param {*} callback Function to be called when labels arrive.
     */
    function fetchLabels(labelTypeId, n, validationOptions, loadedLabels, neighborhoods, severities, tags, callback) {
        var url = "/label/labels";
        let data = {
            label_type_id: labelTypeId,
            n: n,
            validation_options: validationOptions,
            ...(neighborhoods !== undefined && { neighborhoods: neighborhoods }),
            ...(severities !== undefined && { severities: severities }),
            ...(tags !== undefined && { tags: tags }),
            loaded_labels: loadedLabels
        }
        $.ajax({
            async: true,
            contentType: "application/json; charset=utf-8",
            url: url,
            type: "post",
            data: JSON.stringify(data),
            dataType: "json",
            success: function(data) {
                if ("labelsOfType" in data) {
                    let labels = data.labelsOfType
                    let card;
                    for (let i = 0; i < labels.length; i++) {
                        let labelProp = labels[i];
                        if ("label" in labelProp && "imageUrl" in labelProp) {
                            card = new Card(labelProp.label, labelProp.imageUrl, expandedView);
                            self.push(card);
                            loadedLabelIds.add(card.getLabelId());
                        }
                    }
                    if (callback) callback();
                }
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
     * Updates Cards being shown when user moves to next/previous page.
     */
    function updateCardsNewPage() {
        refreshUI();

        let appliedTags = sg.cardFilter.getAppliedTagNames();
        let appliedSeverities = sg.cardFilter.getAppliedSeverities();
        let appliedValOptions = sg.cardFilter.getAppliedValidationOptions();

        // Occlusion and Signal don't have severity, Occlusion does not have tags.
        if (['Occlusion', 'Signal'].includes(currentLabelType)) appliedSeverities = undefined;
        if ('Occlusion' === currentLabelType) appliedTags = undefined;

        currentCards = cardsByType[currentLabelType].copy();
        currentCards.filterOnTags(appliedTags);
        currentCards.filterOnSeverities(appliedSeverities);
        currentCards.filterOnValidationOptions(appliedValOptions);

        if (currentCards.getSize() < cardsPerPage * currentPage + 1) {
            // When we don't have enough cards of specific query to show on one page, see if more can be grabbed.
            fetchLabels(labelTypeIds[currentLabelType], cardsPerPage * 2, appliedValOptions, Array.from(loadedLabelIds), initialFilters.neighborhoods, appliedSeverities, appliedTags, function() {
                currentCards = cardsByType[currentLabelType].copy();
                currentCards.filterOnTags(appliedTags);
                currentCards.filterOnSeverities(appliedSeverities);
                currentCards.filterOnValidationOptions(appliedValOptions);
                lastPage = currentCards.getCards().length <= currentPage * cardsPerPage;
                render();
            });
        } else {
            lastPage = false;
            render();
        }
    }

    /**
     * When a filter is updated; update which Cards are shown.
     */
    function updateCardsByFilter() {
        // Only need to refresh UI if label type changed, since the tags are swapped out.
        let newLabelType = sg.cardFilter.getStatus().currentLabelType;
        if (currentLabelType !== newLabelType) {
            currentLabelType = newLabelType;
            refreshUI();
        }

        setPage(1);
        updateCardsNewPage();
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
        // TODO: should we try to just empty in render method? Or assume it's was emptied in a method utilizing render?
        clearCardContainer(uiCardContainer.holder);

        let imagesToLoad = getCurrentPageCards();
        let imagePromises = imagesToLoad.map(img => img.loadImage());

        if (imagesToLoad.length > 0) {
            if (lastPage) {
                sg.ui.cardContainer.nextPage.prop("disabled", true);
            } else {
                sg.ui.cardContainer.nextPage.prop("disabled", false);
            }

            // We wait for all the promises from grabbing pano images to resolve before showing cards.
            Promise.all(imagePromises).then(() => {
                imagesToLoad.forEach((card) => { card.render(uiCardContainer.holder) });
                sg.ui.pageControl.show();
                sg.pageLoading.hide();
                sg.ui.cardFilter.wrapper.css('position', 'fixed');
                sg.ui.cardFilter.wrapper.css('top', '');
                uiCardContainer.holder.css('margin-left', sg.ui.cardFilter.wrapper.css('width'));
                imagePromises.length >= 6 ? sg.scrollStatus.stickySidebar = true : sg.scrollStatus.stickySidebar = false;
                sg.cardFilter.enable();
            });
        } else {
            // TODO: figure out how to better do the toggling of this element.
            sg.labelsNotFound.show();
            sg.pageLoading.hide();
            sg.cardFilter.enable();
        }
    }

    /**
     * Refreshes the UI after each query made by user.
     */
    function refreshUI() {
        // TODO: To help the loading icon show, we make the sidebar positioned relatively while we are loading on the page.
        // Otherwise, keep it fixed. This is hacky and needs a better fix.

        // Close expanded views (if open) and empty cards from current page.
        expandedView.closeExpandedView();
        clearCardContainer(uiCardContainer.holder);

        // Place user back at top of page.
        window.scrollTo(0, 0);

        // Indicate query is sent, loading appropriate cards.
        sg.pageLoading.show();

        // Disable interactable UI elements while query loads.
        sg.cardFilter.disable();
        sg.labelsNotFound.hide();
        sg.ui.pageControl.hide();

        // Since we have returned to top of page, 
        sg.ui.cardFilter.wrapper.css('position', 'relative');
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

    /**
     * Returns whether the current page is the last page of queried cards.
     * @returns True if current page is last page of cards that satisfies applied query, false otherwise.
     */
    function isLastPage() {
        return lastPage;
    }

    function getExpandedView() {
        return expandedView;
    }

    self.fetchLabels = fetchLabels;
    self.getCards = getCards;
    self.getCurrentCards = getCurrentCards;
    self.isLastPage = isLastPage;
    self.push = push;
    self.updateCardsByFilter = updateCardsByFilter;
    self.updateCardsNewPage = updateCardsNewPage;
    self.sortCards = sortCards;
    self.render = render;
    self.clearCurrentCards = clearCurrentCards;
    self.clearCards = clearCards;
    self.getCardByIndex = getCardByIndex;
    self.getCurrentPage = getCurrentPage;
    self.getCurrentPageCards = getCurrentPageCards;
    self.getExpandedView = getExpandedView;

    _init();
    return this;
}
