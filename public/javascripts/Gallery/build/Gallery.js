/**
 * A Card module.
 * @param params properties of the associated label.
 * @param imageUrl google maps static image url for label.
 * @param modal Modal object; used to update the expanded view when modifying a card.
 * @returns {Card}
 * @constructor
 */
function Card (params, imageUrl, modal) {
    let self = this;

    // UI card element.
    let card = null;

    let validationMenu = null;
    let widthHeightRatio = (4/3);
    let imageId = null;

    // Properties of the label in the card.
    let properties = {
        label_id: undefined,
        label_type: undefined,
        gsv_panorama_id: undefined,
        image_date: undefined,
        label_timestamp: undefined,
        heading: undefined,
        pitch: undefined,
        zoom: undefined,
        canvas_x: undefined,
        canvas_y: undefined,
        canvas_width: undefined,
        canvas_height: undefined,
        severity: undefined,
        temporary: undefined,
        description: undefined,
        street_edge_id: undefined,
        region_id: undefined,
        user_validation: undefined,
        tags: []
    };

    // Paths to label icon images.
    // TODO: This object should be moved to a util file since it is shared in validation and admin tools as well.
    let iconImagePaths = {
        CurbRamp : '/assets/images/icons/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/images/icons/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem.png',
        Other : '/assets/images/icons/AdminTool_Other.png',
        Occlusion : '/assets/images/icons/AdminTool_Other.png',
        NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk.png',
        Crosswalk : '/assets/images/icons/AdminTool_Crosswalk.png',
        Signal : '/assets/images/icons/AdminTool_Signal.png'
    };

    // Status to determine if static imagery has been loaded.
    let status = {
        imageFetched: false
    };

    // Default image width.
    let width = 360;

    let imageDim = {
        w: 0,
        h: 0
    };

    // The label icon to be placed on the static pano image.
    const labelIcon = new Image();

    // The static pano image.
    const panoImage = new Image();

    /**
     * Initialize Card.
     * 
     * @param {*} param Label properties.
     */
    function _init (param) {
        for (const attrName in param) {
            if (param.hasOwnProperty(attrName)) {
                properties[attrName] = param[attrName];
            }
        }

        // Place label icon.
        labelIcon.src = iconImagePaths[getLabelType()];
        labelIcon.classList.add("label-icon", "label-icon-gallery");
        let iconCoords = getIconPercent();
        labelIcon.style.left = iconCoords.x + "px";
        labelIcon.style.top = iconCoords.y + "px";

        // Create an element for the image in the card.
        imageId = "label_id_" + properties.label_id;
        panoImage.id = imageId;
        panoImage.className = "static-gallery-image";

        // Create the container card.
        card = document.createElement('div');
        card.id = "gallery_card_" + properties.label_id;
        card.className = "gallery-card";
        let imageHolder = document.createElement('div');
        imageHolder.className = "image-holder";
        card.appendChild(imageHolder);

        // Create the div for the severity and tags information.
        let cardInfo = document.createElement('div');
        cardInfo.className = 'card-info';

        // Create the div to store the label type.
        let cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        cardHeader.innerHTML = `<div>${i18next.t(util.camelToKebab(getLabelType()))}</div>`;
        cardInfo.appendChild(cardHeader);

        // Create the div that will hold the severity and tags.
        let cardData = document.createElement('div');
        cardData.className = 'card-data';
        cardInfo.appendChild(cardData);

        // Create the div to store the severity of the label.
        let cardSeverity = document.createElement('div');
        cardSeverity.className = 'card-severity';
        new SeverityDisplay(cardSeverity, properties.severity, getLabelType());
        cardData.appendChild(cardSeverity);

        // Create the div to store the tags related to a card. Tags won't be populated until card is added to the DOM.
        let cardTags = document.createElement('div');
        cardTags.className = 'card-tags';
        cardTags.innerHTML = `<div class="label-tags-header"></div>`;
        cardTags.id = properties.label_id;
        cardData.appendChild(cardTags);

        // Append the overlays for label information on top of the image.
        imageHolder.appendChild(labelIcon);
        imageHolder.appendChild(panoImage);
        card.appendChild(cardInfo);
        validationMenu = new ValidationMenu(self, imageHolder, properties, modal, false);
    }

    /**
     * Return object with label coords on static image.
     */
    function getIconPercent () {
        return {
            x: 100 * properties.canvas_x / (properties.canvas_width),
            y: 100 * properties.canvas_y / (properties.canvas_height)
        };
    }

    /**
     * Update image width.
     * 
     * @param {*} w New width.
     */
    function updateWidth(w) {
        width = w;
        imageDim.w = w - 10;
        imageDim.h = imageDim.w / widthHeightRatio;       

        let iconCoords = getIconPercent();
        labelIcon.style.left = iconCoords.x + "%";
        labelIcon.style.top = iconCoords.y + "%";
    }

    /**
     * This function returns labelId property.
     * 
     * @returns {string}
     */
    function getLabelId () {
        return properties.label_id;
    }

    /**
     * This function returns labelType property.
     * 
     * @returns {string}
     */
    function getLabelType () {
        return properties.label_type;
    }

    /**
     * Return the deep copy of the properties object, so the caller can only modify properties from setProperty().
     * JavaScript Deepcopy:
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties () { return $.extend(true, {}, properties); }

    /**
     * Get a property.
     * 
     * @param propName Property name.
     * @returns {*} Property value if property name is valid. Otherwise false.
     */
    function getProperty (propName) { return (propName in properties) ? properties[propName] : false; }

    /**
     * Get status of card.
     */
    function getStatus() {
        return status;
    }

    /**
     * Loads the pano image from url.
     */
    function loadImage() {
        return new Promise(resolve => {
            if (!status.imageFetched) {
                let img = panoImage;
                img.onload = () => {
                    status.imageFetched = true;
                    resolve(true);
                };
                img.src = imageUrl;
            } else {
                resolve(true);
            }
        });
    }

    /**
     * Renders the card. 
     * 
     * @param cardContainer UI element to render card in.
     * @returns {self}
     */
    function render (cardContainer) {
        // TODO: should there be a safety check here to make sure pano is loaded?
        // If the card had transparent background from the modal being open earlier, remove transparency on rerender.
        if (card.classList.contains('modal-background-card')) card.classList.remove('modal-background-card');
        panoImage.width = imageDim.w;
        panoImage.height = imageDim.h;
        cardContainer.append(card);
    }

    /**
     * Render with an overload that allows you to set the width and height of the card.
     */
    function renderSize(cardContainer, width) {
        updateWidth(width);
        render(cardContainer);
        renderTags();
    }

    /**
     * Renders the tags on the card when the card is loaded onto on the DOM.
     */
    function renderTags() {
        let selector = ".card-tags#" + properties.label_id;
        let tagContent = new TagDisplay(selector, properties.tags);
    }

    /**
     * Sets a property. 
     * 
     * @param key Property name.
     * @param value Property value.
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Set aspect of status.
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
     * Returns the current ImageID being displayed in the image.
     * @returns the image ID of the card that is being displayed
     */
    function getImageId() {
        return imageId
    }

    self.getLabelId = getLabelId;
    self.getLabelType = getLabelType;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.loadImage = loadImage;
    self.render = render;
    self.renderSize = renderSize;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.getImageId = getImageId;

    _init(params);
    
    self.validationMenu = validationMenu;

    return this;
}

/**
 * A Card Bucket to store Cards of a certain label type.
 * 
 * @param bucket List of Cards in order received from database.
 * @returns {CardBucket}
 * @constructor
 */
function CardBucket(inputCards) {
    let self = this;
    let bucket = inputCards || [];
    /**
     * Add a Card to bucket.
     * 
     * @param {Card} card Card to add.
     */
    function push(card) {
        bucket.push(card);
    }

    /**
     * Filters cards upon a non-empty array of tags.
     * 
     * @param {*} tags Tags to filter upon.
     */
    function filterOnTags(tags) {
        if (tags.length > 0) {
            let tagSet = new Set(tags);
            bucket = bucket.filter(card => card.getProperty("tags").some(tag => tagSet.has(tag)));
        }
    }

    /**
     * Filters cards upon a non-empty array of severities.
     * 
     * @param {*} severities Severities to filter upon.
     */
    function filterOnSeverities(severities) {
        if (severities.length > 0) {
            let severitySet = new Set(severities);
            bucket = bucket.filter(card => severitySet.has(card.getProperty("severity")));
        }
    }

    /**
     * Return all Cards in bucket.
     */
    function getCards() {
        return bucket;
    }

    /**
     * Return how many Cards are in bucket.
     */
    function getSize() {
        return bucket.length;
    }

    /**
     * Return a copy of this CardBucket. This is not a deepcopy (the cards themselves are not copied).
     */
    function copy() {
        return new CardBucket([...bucket]);
    }
    
    /**
     * Gets the card that has the matching imageId.
     * 
     * @param {String} imageId the id to search for.
     * @returns {Card} The card in the card bucket that contains the imageId.
     */
    function findCardByImageId(imageId) {
        let index = findCardIndexByImageId(imageId);
        if (index === -1) {
            return undefined;
        }
        return bucket[index];
    }

    function getCardByIndex(index) {
        return bucket[index];
    }

    function findCardIndexByImageId(imageId) {
        for (let i = 0; i < bucket.length; i++) {
            if (bucket[i].getImageId() === imageId) {
                return i;
            }
        }

        return -1;
    }

    self.push = push;
    self.filterOnTags = filterOnTags;
    self.filterOnSeverities = filterOnSeverities;
    self.getCards = getCards;
    self.getSize = getSize;
    self.copy = copy;
    self.findCardByImageId = findCardByImageId;
    self.findCardIndexByImageId = findCardIndexByImageId;
    self.getCardByIndex = getCardByIndex;

    return this;
}

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
        Crosswalk: 9,
        Signal: 10,
        Assorted: -1
    };

    // Current label type of cards being shown.
    let currentLabelType = 'Assorted';
    let currentPage = 1;
    let lastPage = false;
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
        NoSidewalk: new CardBucket(),
        Crosswalk: new CardBucket(),
        Signal: new CardBucket()
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
        sg.ui.pageControl.hide();
        sg.tagContainer.disable();
        sg.ui.cardContainer.prevPage.prop("disabled", true);
        cardsByType[currentLabelType] = new CardBucket();

        // Grab first batch of labels to show.
        fetchLabels(labelTypeIds.Assorted, initialLoad, Array.from(loadedLabelIds), undefined, undefined, function() {
            currentCards = cardsByType[currentLabelType].copy();
            render();
        });
        // Creates the Modal object in the DOM element currently present.
        modal = new Modal($('.gallery-modal'));
        // Add the click event for opening the Modal when a card is clicked.
        sg.ui.cardContainer.holder.on('click', '.static-gallery-image, .additional-count',  (event) => {
            $('.gallery-modal').attr('style', 'display: flex');
            $('.grid-container').css("grid-template-columns", "1fr 5fr");
            // If the user clicks on the image body in the card, just use the provided id.
            // Otherwise, the user will have clicked on an existing "+n" icon on the card, meaning we need to acquire
            // the cardId from the card-tags DOM element (as well as perform an additional prepend to put the ID in
            // the correct form).
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
        sg.ui.cardContainer.prevPage.prop("disabled", false);
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
     * @param {*} loadedLabels Label Ids of labels already grabbed.
     * @param {*} severities Severities the labels to be grabbed can have. (Set to undefined if N/A)
     * @param {*} tags Tags the labels to be grabbed can have. (Set to undefined if N/A)
     * @param {*} callback Function to be called when labels arrive.
     */
    function fetchLabels(labelTypeId, n, loadedLabels, severities, tags, callback) {
        var url = "/label/labels";
        let data = {
            labelTypeId: labelTypeId,
            n: n,
            ...(severities !== undefined && {severities: severities}),
            ...(tags !== undefined && {tags: tags}),
            loadedLabels: loadedLabels
        }
        $.ajax({
            async: true,
            contentType: "application/json; charset=utf-8",
            url: url,
            type: "post",
            data: JSON.stringify(data),
            dataType: "json",
            success: function (data) {
                if ("labelsOfType" in data) {
                    let labels = data.labelsOfType
                    let card;
                    for (let i = 0; i < labels.length; i++) {
                        let labelProp = labels[i];
                        if ("label" in labelProp && "imageUrl" in labelProp) {
                            card = new Card(labelProp.label, labelProp.imageUrl, modal);
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

            fetchLabels(labelTypeIds[filterLabelType], cardsPerPage * 2, Array.from(loadedLabelIds), undefined, undefined, function () {
                currentCards = cardsByType[currentLabelType].copy();

                // We query double the amount of cards per page, "prepping" for the next page. If after querying we see
                // that we still only have enough labels to fill up to the current page, the current page must be the last page.
                lastPage = currentCards.getCards().length <= currentPage * cardsPerPage;
                render();
            });
        }
    }

    /**
     * Updates Cards being shown when user moves to next/previous page.
     */
    function updateCardsNewPage() {
        refreshUI();

        let appliedTags = sg.tagContainer.getAppliedTagNames();
        let appliedSeverities = sg.tagContainer.getAppliedSeverities();

        currentCards = cardsByType[currentLabelType].copy();
        currentCards.filterOnTags(appliedTags);
        currentCards.filterOnSeverities(appliedSeverities);

        if (currentCards.getSize() < cardsPerPage * currentPage + 1) {
            // When we don't have enough cards of specific query to show on one page, see if more can be grabbed.
            if (currentLabelType === "Occlusion") {
                fetchLabels(labelTypeIds[currentLabelType], cardsPerPage * 2, Array.from(loadedLabelIds), undefined, undefined, function () {
                    currentCards = cardsByType[currentLabelType].copy();
                    lastPage = currentCards.getCards().length <= currentPage * cardsPerPage;
                    render();
                });
            } else {
                fetchLabels(labelTypeIds[currentLabelType], cardsPerPage * 2, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
                    currentCards = cardsByType[currentLabelType].copy();
                    currentCards.filterOnTags(appliedTags);
                    currentCards.filterOnSeverities(appliedSeverities);
                    lastPage = currentCards.getCards().length <= currentPage * cardsPerPage;
                    render();
                });
            }
        } else {
            lastPage = false;
            render();
        }
    }

    /**
     * When a tag or severity filter is updated, update Cards to be shown.
     */
    function updateCardsByTagsAndSeverity() {
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
        pageWidth = uiCardContainer.holder.width();
        const cardWidth = pageWidth/cardsPerLine - cardPadding;

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
                imagesToLoad.forEach((card) => {card.renderSize(uiCardContainer.holder, cardWidth)});
                sg.ui.pageControl.show();
                sg.pageLoading.hide();
                sg.ui.cardFilter.wrapper.css('position', 'fixed');
                sg.ui.cardFilter.wrapper.css('top', '');
                uiCardContainer.holder.css('margin-left', sg.ui.cardFilter.wrapper.css('width'));
                sg.scrollStatus.stickySidebar = true;
                sg.tagContainer.enable();
                sg.ui.labelTypeMenu.select.prop("disabled", false);
                sg.ui.cityMenu.select.prop("disabled", false);
            });
        } else {
            // TODO: figure out how to better do the toggling of this element.
            sg.labelsNotFound.show();
            sg.pageLoading.hide();
            sg.tagContainer.enable();
            sg.ui.labelTypeMenu.select.prop("disabled", false);
            sg.ui.cityMenu.select.prop("disabled", false);
        }
    }

    /**
     * Refreshes the UI after each query made by user.
     */
    function refreshUI() {
        // TODO: To help the loading icon show, we make the sidebar positioned relatively while we are loading on the page.
        // Otherwise, keep it fixed. This is hacky and needs a better fix.

        // Close modal (if open) and empty cards from current page.
        modal.closeModal();
        clearCardContainer(uiCardContainer.holder);

        // Place user back at top of page.
        window.scrollTo(0, 0);

        // Indicate query is sent, loading appropriate cards.
        sg.pageLoading.show();

        // Disable interactable UI elements while query loads.
        sg.tagContainer.disable();
        sg.ui.labelTypeMenu.select.prop("disabled", true);
        sg.ui.cityMenu.select.prop("disabled", true);
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

    function getModal() {
        return modal;
    }

    self.fetchLabels = fetchLabels;
    self.getCards = getCards;
    self.getCurrentCards = getCurrentCards;
    self.isLastPage = isLastPage;
    self.push = push;
    self.updateCardsByType = updateCardsByType;
    self.updateCardsByTagsAndSeverity = updateCardsByTagsAndSeverity;
    self.updateCardsNewPage = updateCardsNewPage;
    self.sortCards = sortCards;
    self.render = render;
    self.clearCurrentCards = clearCurrentCards;
    self.clearCards = clearCards;
    self.getCardByIndex = getCardByIndex;
    self.getCurrentPage = getCurrentPage;
    self.getCurrentPageCards = getCurrentPageCards;
    self.getModal = getModal;

    _init();
    return this;
}

/**
 * Compiles and submits log data from Gallery.
 * 
 * @param {*} url URL to send interaction data to.
 * @param {*} beaconUrl URL to send interaction data to on page unload.
 * @returns {Form}
 * @constructor
 */
function Form(url, beaconUrl) {
    let properties = {
        dataStoreUrl : url,
        beaconDataStoreUrl : beaconUrl
    };

    /**
     * Compiles data into a format that can be parsed by our backend.
     * @returns {{}}
     */
    function compileSubmissionData() {
        let data = {};

        data.environment = {
            browser: util.getBrowser(),
            browser_version: util.getBrowserVersion(),
            browser_width: $(window).width(),
            browser_height: $(window).height(),
            screen_width: screen.width,
            screen_height: screen.height,
            avail_width: screen.availWidth,
            avail_height: screen.availHeight, 
            operating_system: util.getOperatingSystem(),
            language: i18next.language
        };

        data.interactions = sg.tracker.getActions();
        sg.tracker.refresh();
        return data;
    }

    /**
     * Submits all front-end data to the backend.
     * 
     * @param data  Data object containing interactions.
     * @param async Whether to submit asynchronously or not.
     * @returns {*}
     */
    function submit(data, async) {
        if (typeof async === "undefined") {
            async = false;
        }

        if (data.constructor !== Array) {
            data = [data];
        }

        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: properties.dataStoreUrl,
            type: 'post',
            data: JSON.stringify(data),
            success: function () {
                console.log("Data logged successfully");
            },
            error: function (xhr, status, result) {
                console.error(xhr.responseText);
                console.error(result);
            }
        });
    }

    // On page unload, we compile stored interaction data and send it over.
    $(window).on('beforeunload', function () {
        sg.tracker.push("Unload");

        // April 17, 2019
        // What we want here is type: 'application/json'. Can't do that quite yet because the
        // feature has been disabled, but we should switch back when we can.
        //
        // // For now, we send plaintext and the server converts it to actual JSON
        //
        // Source for fix and ongoing discussion is here:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=490015
        let data = [compileSubmissionData()];
        let jsonData = JSON.stringify(data);
        navigator.sendBeacon(properties.beaconDataStoreUrl, jsonData);
    });

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}

/**
 * Logs information from the Gallery.
 * 
 * @returns {Tracker}
 * @constructor
 */
function Tracker() {
    let self = this;
    let actions = [];

    function _init() {
        //_trackWindowEvents();
    }

    // TODO: update/include for v1.1
    function _trackWindowEvents() {
        let prefix = "LowLevelEvent_";

        // Track all mouse related events.
        $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', function(e) {
            self.push(prefix + e.type, {
                cursorX: 'pageX' in e ? e.pageX : null,
                cursorY: 'pageY' in e ? e.pageY : null
            });
        });

        // Keyboard related events.
        $(document).on('keydown keyup', function(e) {
            self.push(prefix + e.type, {
                keyCode: 'keyCode' in e ? e.keyCode : null
            });
        });
    }

    /**
     * Creates action to be added to action buffer.
     * 
     * @param action Action name.
     * @param suppData Optional supplementary data about action.
     * @param notes Optional notes about action.
     * @private
     */
    function _createAction(action, suppData, notes) {
        if (!notes) {
            notes = {};
        }

        let note = _notesToString(notes);
        let timestamp = new Date().getTime();

        let data = {
            action: action,
            pano_id: suppData && suppData.panoId ? suppData.panoId : null,
            note: note,
            timestamp: timestamp
        };

        return data;
    }

    /**
     * Return list of actions.
     */
    function getActions() {
        return actions;
    }

    /**
     * Convert notes object to string.
     * 
     * @param {*} notes Notes object.
     */
    function _notesToString(notes) {
        if (!notes)
            return "";

        let noteString = "";
        for (let key in notes) {
            if (noteString.length > 0)
                noteString += ",";
            noteString += key + ':' + notes[key];
        }

        return noteString;
    }

    /**
     * Pushes information to action list (to be submitted to the database).
     * 
     * @param action (required) Action name.
     * @param suppData (optional) Supplementary data to be logged about action.
     * @param notes (optional) Notes to be logged into the notes fieldin database.
     */
    function push(action, suppData, notes) {
        let item = _createAction(action, suppData, notes);
        actions.push(item);

        // TODO: change action buffer size limit
        if (actions.length > 10) {
            let data = sg.form.compileSubmissionData();
            sg.form.submit(data, true);
        }
        return this;
    }

    /**
     * Empties actions stored in the Tracker.
     */
    function refresh() {
        actions = [];
        self.push("RefreshTracker");
    }

    _init();

    self.getActions = getActions;
    self.push = push;
    self.refresh = refresh;

    return this;
}

/**
 * Card Filter module. 
 * This is responsible for allowing users to apply filters to specify what types of cards to render in the gallery.
 *
 * @param uiCardFilter UI element representing filter components of sidebar.
 * @param labelTypeMenu UI element representing dropdown to select label type in sidebar.
 * @param cityMenu UI element representing dropdown to select city in sidebar.
 * @returns {CardFilter}
 * @constructor
 */
function CardFilter(uiCardFilter, labelTypeMenu, cityMenu) {
    let self = this;

    let status = {
        currentCity: cityMenu.getCurrentCity(),
        currentLabelType: "Assorted"
    };

    // Map label type to their collection of tags.
    let tagsByType = {
        Assorted: new TagBucket(),
        CurbRamp: new TagBucket(),
        NoCurbRamp: new TagBucket(),
        Obstacle: new TagBucket(),
        SurfaceProblem: new TagBucket(),
        Other: new TagBucket(),
        Occlusion: new TagBucket(),
        NoSidewalk: new TagBucket(),
        Crosswalk: new TagBucket(),
        Signal: new TagBucket()
    };

    // Tags of the current label type.
    let currentTags = new TagBucket();

    // Collection of severities.
    let severities = new SeverityBucket();
   
    /**
     * Initialize CardFilter.
     */
    function _init() {
        getTags(function () {
            render();
        });
    }

    /**
     * Grab all tags from backend and sort them by label type into tagsByType.
     * 
     * @param {*} callback Function to be called when tags arrive.
     */
    function getTags(callback) {
        $.getJSON("/label/tags", function (data) {
            let tag;
            let i = 0;
            let len = data.length;
            for (; i < len; i++) {
                tag = new Tag(data[i]);
                tagsByType[tag.getLabelType()].push(tag);
            }

            if (callback) callback();
        });
    }

    /**
     * Update filter components when city or label type changes.
     */
    function update() {
        let currentCity = cityMenu.getCurrentCity();
        if (status.currentCity !== currentCity) {
            // Future: add URI parameters to link.
            window.location.href = currentCity + '/gallery?label=' + status.currentLabelType;
        } else {
            let currentLabelType = labelTypeMenu.getCurrentLabelType();
            if (status.currentLabelType !== currentLabelType) {
                clearCurrentTags();
                severities.unapplySeverities();
                setStatus('currentLabelType', currentLabelType);
                currentTags = tagsByType[currentLabelType];
                sg.cardContainer.updateCardsByType();
            }
            render();
        }
    }

    /**
     * Render tags and severities in sidebar.
     */
    function render() {
        if (currentTags.getTags().length > 0) {
            // TODO: think about to better show tags header in an organized manner.
            $("#tags-header").show();
            currentTags.render(uiCardFilter.tags);
        } else {
            $("#tags-header").hide();
        }
        if (status.currentLabelType === "Occlusion") {
            $("#filters").hide();
            $("#horizontal-line").hide();
        } else {
            $("#filters").show();
            $("#horizontal-line").show();
            if (status.currentLabelType === 'Signal') {
                $('#severity-header').hide();
                $('#severity-select').hide();
            } else {
                $('#severity-header').show();
                $('#severity-select').show();
            }
        }

        severities.render(uiCardFilter.severity);
    }

    /**
     * Return list of tags that have been selected by user.
     */
    function getAppliedTagNames() {
        return currentTags.getAppliedTags().map(tag => tag.getTag());
    }

    /**
     * Return list of all tags for current label type.
     */
    function getTagNames() {
        return currentTags.getTags().map(tag => tag.getTag());
    }

    /**
     * Return object containing all tags.
     */
    function getTagsByType() {
        return tagsByType;
    }

    /**
     * Return status of CardFilter.
     */
    function getStatus() {
        return status;
    }

    /**
     * Set attribute of status.
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
     * Return list of severities.
     */
    function getSeverities() {
        return severities.getSeverities();
    }

    /**
     * Return list of selected severities by user.
     */
    function getAppliedSeverities() {
        return severities.getAppliedSeverities();
    }

    /**
     * Unapply all tags of specified label type.
     * 
     * @param {*} labelType Label type of tags to unapply.
     */
    function unapplyTags(labelType) {
        if (labelType != null) {
            tagsByType[labelType].unapplyTags();
        }
    }

    /**
     * Clear tags currently being shown.
     */
    function clearCurrentTags() {
        uiCardFilter.tags.empty();
        unapplyTags(status.currentLabelType);
        currentTags = new TagBucket();
    }

    /**
     * Disable interaction with filters.
     */
    function disable() {
        severities.disable();
        $('.gallery-tag').prop("disabled", true);
    }

    /**
     * Enable interaction with filters.
     */
    function enable() {
        severities.enable();
        $('.gallery-tag').prop("disabled", false);
    }

    self.update = update;
    self.render = render;
    self.getAppliedTagNames = getAppliedTagNames;
    self.getTagNames = getTagNames;
    self.getTagsByType = getTagsByType;
    self.getStatus = getStatus;
    self.setStatus = setStatus;
    self.getSeverities = getSeverities;
    self.getAppliedSeverities = getAppliedSeverities;
    self.unapplyTags = unapplyTags;
    self.disable = disable;
    self.enable = enable;

    _init();
    return this;
}

/**
 * CardSort Menu module. Responsible for holding the switches allowing users to sort labels on various parameters.
 *
 * @returns {CardSortMenu}
 * @constructor
 */
function CardSortMenu(uiCardSortMenu) {
    let self = this;

    // The code values associated with each sort.
    let orderCodes = {
        sort_LeastSevere: 0,
        sort_MostSevere: 1 
    }

    // The status of the sorting at any point.
    let status = {
        severity: 1,
        sortType: "none"
    };

    function _init() {
        if (uiCardSortMenu) {
            uiCardSortMenu.sort.bind({
                change: sortSelectCallback
            });
        }
    }
    
    /**
     * Callback function for when sorting order of cards is changed.
     */
    function sortSelectCallback() {
        let sortType = $(this).val();
        setStatus("sortType", sortType);

        console.log("sort clicked");

        //TODO: Can we do this without referencing sg namespace?
        sg.cardContainer.sortCards(orderCodes[sortType]);
    }

    /**
     * Returns the status of the CardSortMenu
     */
    function getStatus() {
        // TODO: perhaps remove this if no other status added
        return status;
    }

    /**
     * Sets a specific key, value pair in the status
     * @param {*} key 
     * @param {*} value 
     */
    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}

/**
 * City Menu module.
 * This is responsible for holding the buttons allowing users to filter cities by city.
 *
 * @param uiCityMenu UI element corresponding to CityMenu.
 * @returns {CityMenu}
 * @constructor
 */
function CityMenu(uiCityMenu) {
    let self = this;

    let status = {
        currentCity: null
    };

    /**
     * Initialize CityMenu.
     */
    function _init() {
        if (uiCityMenu) {
            uiCityMenu.select.bind({
                change: citySelectCallback
            })
        }
    }

    /**
     * Handles what happens when a city is selected.
     */
    function citySelectCallback() {
        let city = $(this).val();
        setStatus("currentCity", city);
        sg.tracker.push("Filter_City=" + city);
        sg.tagContainer.update();
    }

    /**
     * Returns current selected city.
     */
    function getCurrentCity() {
        return status.currentCity;
    }

    /**
     * Return status of CityMenu.
     */
    function getStatus() {
        return status;
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

    self.getCurrentCity = getCurrentCity;
    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}

/**
 * Label Type Menu module.
 * This is responsible for holding the buttons allowing users to filter labels by label type.
 *
 * @param labelTypeMenu UI element corresponding to LabelTypeMenu.
 * @returns {LabelTypeMenu}
 * @constructor
 */
function LabelTypeMenu(labelTypeMenu) {
    let self = this;

    let status = {
        currentLabelType: null
    };

    /**
     * Initialize LabelTypeMenu.
     */
    function _init() {
        if (labelTypeMenu) {
            labelTypeMenu.select.bind({
                change: labelSelectCallback
            })
        }
    }

    /**
     * Handles what happens when a label type is selected.
     */
    function labelSelectCallback() {
        let labelType = $(this).val();
        setStatus("currentLabelType", labelType);
        sg.tracker.push("Filter_LabelType=" + labelType);
        sg.tagContainer.update();
    }

    /**
     * Returns current selected label type.
     */
    function getCurrentLabelType() {
        return status.currentLabelType;
    }

    /**
     * Return status of LabelTypeMenu.
     */
    function getStatus() {
        return status;
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

    self.getCurrentLabelType = getCurrentLabelType;
    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}

/**
 * A Severity module.
 *
 * @param {*} params Properties of severity.
 * @param active A boolean to see if the current severity filter is active.
 * @returns {Severity}
 * @constructor
 */
function Severity (params, active){
    let self = this;

    // UI element of the severity container and image.
    let severityElement = null;
    let severityImage = null;
    let interactionEnabled = false;

    let properties = {
        severity: undefined
    };

    // A boolean to see if the current severity filter is active.
    let filterActive = active;

    /**
     * Initialize Severity.
     * 
     * @param {int} param Severity.
     */
    function _init(param) {
        properties.severity = param;

        severityElement = document.createElement('div');
        severityElement.className = 'severity-filter gallery-filter';

        severityImage = document.createElement('img');
        severityImage.className = 'severity-filter-image';
        severityImage.id = properties.severity;
        severityImage.innerText = properties.severity;
        if (filterActive) {
            _showSelected();
        } else {
            _showDeselected();
        }
        
        severityElement.appendChild(severityImage);

        // Show inverted smiley face on click or hover.
        severityElement.onclick = handleOnClickCallback;
        $(severityElement).hover(
            function() { _showSelected(); },
            function() { if (!filterActive) _showDeselected(); }
        );
    }

    /**
     * Handles when severity is selected/deselected.
     */
    function handleOnClickCallback() {
        if (filterActive) {
            sg.tracker.push("SeverityUnapply", null, { Severity: properties.severity });
            unapply();
        } else {
            sg.tracker.push("SeverityApply", null, { Severity: properties.severity });
            apply();
        }

        sg.cardContainer.updateCardsByTagsAndSeverity();
    }

    function _showSelected() {
        severityImage.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${properties.severity}_inverted_green.png`;
    }

    function _showDeselected() {
        severityImage.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${properties.severity}-Gray.png`;
    }

    /**
     * Applies a severity filter.
     */
    function apply() {
        if (interactionEnabled) {
            filterActive = true;
            _showSelected();
        }
    }

    /**
     * Unapplies a severity filter.
     */
    function unapply() {
        if (interactionEnabled) {
            filterActive = false;
            _showDeselected();
        }
    }

    /**
     * Renders Severity in sidebar.
     * 
     * @param {*} filterContainer UI element to render Severity in.
     */
    function render(filterContainer) {
        filterContainer.append(severityElement);
    }

    /**
     * Returns whether Severity is applied or not.
     */
    function getActive(){
        return filterActive;
    }

    /**
     * Returns severity value of Severity.
     */
    function getSeverity() {
        return properties.severity;
    }

    /**
     * Disables interaction with Severity.
     */
    function disable() {
        interactionEnabled = false;
    }

    /**
     * Enables interaction with Severity.
     */
    function enable() {
        interactionEnabled = true;
    }

    self.handleOnClickCallback = handleOnClickCallback;
    self.apply = apply;
    self.unapply = unapply;
    self.getActive = getActive;
    self.getSeverity = getSeverity;
    self.render = render;
    self.disable = disable;
    self.enable = enable;

    _init(params);

    return this;
}

/**
 * A Severity Bucket to store Severities.
 * 
 * @param bucket array containing Severities
 * @returns {SeverityBucket}
 * @constructor
 */
function SeverityBucket(inputSeverities) {
    let self = this;

    // List of severities.
    let bucket = inputSeverities || [];

    /**
     * Initialize SeverityBucket.
     */
    function _init() {
        for(let i = 1; i <= 5; i++ ){
            push(new Severity(i, false));
        }
    }

    /**
     * Add severity.
     * 
     * @param {*} severity
     */
    function push(severity) {
        bucket.push(severity);
    }

    /**
     * Render Severities in SeverityBucket.
     * @param {*} uiSeverityHolder UI element to render Severities in.
     */
    function render(uiSeverityHolder) {
        bucket.forEach(severity => severity.render(uiSeverityHolder));
    }

    /**
     * Unapply all Severities.
     */
    function unapplySeverities() {
        bucket.forEach(severity => severity.unapply());
    }

    /**
     * Return list of Severities.
     */
    function getSeverities() {
        return bucket;
    }

    /**
     * Return number of Severities.
     */
    function getSize() {
        return bucket.length;
    }

    /**
     * Return list of applied Severities.
     */
    function getAppliedSeverities() {
        return bucket.filter(severity => severity.getActive()).map(severity => severity.getSeverity());
    }

    /**
     * Disable interaction with Severities.
     */
    function disable() {
        bucket.forEach(severity => severity.disable());
    }
    
    /**
     * Enable interaction with Severities.
     */
    function enable() {
        bucket.forEach(severity => severity.enable());
    }

    self.push = push;
    self.render = render;
    self.unapplySeverities = unapplySeverities;
    self.getSeverities = getSeverities;
    self.getSize = getSize;
    self.getAppliedSeverities = getAppliedSeverities;
    self.disable = disable;
    self.enable = enable;

    _init();

    return this;
}

/**
 * A Tag module.
 * 
 * @param {*} params Properties of tag.
 * @returns {Tag}
 * @constructor
 */
function Tag (params) {
    let self = this;

    // UI element of Tag.
    let tagElement = null;

    // Properties of this Tag.
    let properties = {
        tag_id: undefined,
        label_type: undefined,
        tag: undefined
    };

    // Status of the tag.
    let status = {
        applied: false
    };

    /**
     * Initialize Tag.
     * 
     * @param {*} param Tag properties.
     */
    function _init (param) {
        Object.keys(param).forEach( attrName => properties[attrName] = param[attrName]);

        tagElement = document.createElement('button');
        tagElement.className = "gallery-tag gallery-tag-sidebar gallery-filter";
        tagElement.id = properties.tag;
        tagElement.innerText = i18next.t('tag.' + properties.tag);
        tagElement.disabled = true;

        tagElement.onclick = tagClickCallback;
    }

    /**
     * Handles what happens when Tag is clicked.
     */
    function tagClickCallback() {
        if (status.applied) {
            sg.tracker.push("TagUnapply", null, {
                Tag: properties.tag,
                Label_Type: properties.label_type
            });
            unapply();
        } else {
            sg.tracker.push("TagApply", null, {
                Tag: properties.tag,
                Label_Type: properties.label_type
            });
            apply();
        }

        sg.cardContainer.updateCardsByTagsAndSeverity();
    }

    /**
     * Applies Tag.
     */
    function apply() {
        setStatus("applied", true);
        tagElement.setAttribute("style", "background-color: #78c8aa");
    }

    /**
     * Unapplies Tag.
     */
    function unapply() {
        setStatus("applied", false);
        tagElement.setAttribute("style", "background-color: none");
    }

    /**
     * Returns Tag name.
     */
    function getTag() {
        return properties.tag;
    }

    /**
     * Returns the tagId of this Tag.
     */
    function getTagId() {
        return properties.tag_id;
    }

    /**
     * Returns label type of Tag.
     */
    function getLabelType() {
        return properties.label_type;
    }

    /**
     * Return the deep copy of the properties object, so the caller can only modify properties from setProperty().
     * 
     * JavaScript Deepcopy:
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties() { return $.extend(true, {}, properties); }

    /**
     * Gets property of Tag.
     * 
     * @param propName Property name.
     * @returns {*} Property value if property name is valid. Otherwise false.
     */
    function getProperty(propName) { return (propName in properties) ? properties[propName] : false; }

    /**
     * Get status of tag.
     */
    function getStatus() {
        return status;
    }

    /**
     * Sets a property of Tag.
     * 
     * @param key Property name.
     * @param value Property value.
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Set status attribute of tag.
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
     * Renders the Tag.
     * 
     * @param filterContainer UI element to render Tag in.
     * @returns {self}
     */
    function render(filterContainer) {
        filterContainer.append(tagElement);
    }

    self.apply = apply;
    self.unapply = unapply;
    self.getTag = getTag;
    self.getTagId = getTagId;
    self.getLabelType = getLabelType;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.render = render;

    _init(params);
    return this;
}

/**
 * A Tag Bucket to store Tags.
 * 
 * @param bucket array containing Tags
 * @returns {TagBucket}
 * @constructor
 */
function TagBucket(inputTags) {
    let self = this;

    // List of Tags.
    let bucket = inputTags || [];

    /**
     * Add Tag.
     * 
     * @param {*} tag Tag to add.
     */
    function push(tag) {
        bucket.push(tag);
    }

    /**
     * Render all Tags.
     * 
     * @param {*} uiTagHolder UI element to render Tags in.
     */
    function render(uiTagHolder) {
        bucket.forEach(tag => tag.render(uiTagHolder));
    }

    /**
     * Unapply all tags.
     */
    function unapplyTags() {
        bucket.forEach(tag => tag.unapply());
    }

    /**
     * Return list of Tags.
     */
    function getTags() {
        return bucket;
    }

    /**
     * Return number of Tags.
     */
    function getSize() {
        return bucket.length;
    }

    /**
     * Return list of applied Tags.
     */
    function getAppliedTags() {
        return bucket.filter(tag => tag.getStatus().applied);
    }

    self.push = push;
    self.render = render;
    self.unapplyTags = unapplyTags;
    self.getTags = getTags;
    self.getSize = getSize;
    self.getAppliedTags = getAppliedTags;

    return this;
}

/**
 * A Validation Menu to be appended to a Card for validation purposes.
 *
 * There are two version of the validation menu that use this class. The first is the menu on the small cards and the
 * second is the menu on the expanded view of a card. There is one ValidationMenu instance for each small card, but
 * there is only one instance of the ValidationMenu for the expanded view (also called the "modal"). For the small
 * cards, the `referenceCard` remains the static. But for the menu in the expanded view, the `referenceCard` changes
 * whenever we switch to the expanded view for a new label.
 *
 * @param refCard Reference card. Stays the same for validation menus on small cards, changes for menu on expanded view.
 * @param uiCardImage The html element to append the validation menu to.
 * @param cardProperties Properties of the label the validation menu is being appended to
 * @param modal The Modal object; used to update the expanded view when modifying a card.
 * @param onExpandedView A boolean flag. If true, the ValidationMenu is a child of the expanded view.
 *                       If false, the ValidationMenu is a child of a card.
 * @returns {ValidationMenu}
 * @constructor
 */
function ValidationMenu(refCard, uiCardImage, cardProperties, modal, onExpandedView) {
    let self = this;
    let currCardProperties = cardProperties;
    let referenceCard = refCard;
    let currSelected = null;

    // A kind of wack way to do this, explore better options.
    const resultOptions = {
        "Agree": 1,
        "Disagree": 2,
        "NotSure": 3
    };
    const classToValidationOption = {
        "validate-agree": "Agree",
        "validate-disagree": "Disagree",
        "validate-not-sure": "NotSure"
    };
    const validationOptionToClass = {
        "Agree": "validate-agree",
        "Disagree": "validate-disagree",
        "NotSure": "validate-not-sure"
    };
    const validationOptionToColor = { // TODO put this somewhere more central at the very least.
        'Agree': '#78c9ab',
        'Disagree': '#eb734d',
        'NotSure': '#fbd78b'
    };

    const cardOverlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="validation-button">${i18next.t('gallery:agree')}</button>
            <button id="gallery-card-disagree-button" class="validation-button">${i18next.t('gallery:disagree')}</button>
            <button id="gallery-card-not-sure-button" class="validation-button">${i18next.t('gallery:not-sure')}</button>
        </div>`;
    const modalOverlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="modal-validation-button">${i18next.t('gallery:agree')}</button>
            <button id="gallery-card-disagree-button" class="modal-validation-button">${i18next.t('gallery:disagree')}</button>
            <button id="gallery-card-not-sure-button" class="modal-validation-button">${i18next.t('gallery:not-sure')}</button>
        </div>`;
    let overlay = $(cardOverlayHTML);

    let validationButtons = undefined;
    // This is a regular DOM element, not jquery.
    let galleryCard = uiCardImage.parentElement;

    // Adds onClick functions for the validation buttons.
    function _init() {
        if (onExpandedView) {
            overlay = $(modalOverlayHTML)
        }

        validationButtons = {
            "validate-agree": overlay.find("#gallery-card-agree-button"),
            "validate-disagree": overlay.find("#gallery-card-disagree-button"),
            "validate-not-sure": overlay.find("#gallery-card-not-sure-button")
        };

        // If the signed in user had already validated this label before loading the page, style the card to show that.
        if (currCardProperties !== null && currCardProperties.user_validation) {
            if (onExpandedView) showValidationOnExpandedView(currCardProperties.user_validation);
            else showValidationOnCard(currCardProperties.user_validation);
        }

        // Add onClick functions for the validation buttons.
        for (const [valKey, button] of Object.entries(validationButtons)) {
            let validationOption = classToValidationOption[valKey];
            button.click(function() {
                // Change the look of the card/expanded view to match the new validation.
                if (onExpandedView) {
                    showValidationOnExpandedView(validationOption);
                    referenceCard.validationMenu.showValidationOnCard(validationOption);
                } else {
                    showValidationOnCard(validationOption);
                    if (currCardProperties.label_id === modal.getProperty('label_id')) {
                        modal.validationMenu.showValidationOnExpandedView(validationOption);
                    }
                }
                // Actually submit the new validation.
                validateLabel(validationOption);
            });
        }
        uiCardImage.append(overlay[0]);
    }

    /**
     * Adds the visual effects of validation to the small card (opaque button and fill color below image).
     *
     * @param validationOption
     */
    function showValidationOnCard(validationOption) {
        const validationClass = validationOptionToClass[validationOption];

        // If the label had already been validated differently, remove the visual effects from the older validation.
        if (currSelected && currSelected !== validationClass) {
            validationButtons[currSelected].attr('class', 'validation-button');
            if (galleryCard.classList.contains(currSelected)) {
                galleryCard.classList.remove(currSelected);
            }
        }
        currSelected = validationClass;

        // Add the visual effects from the new validation.
        galleryCard.classList.add(validationClass);
        validationButtons[validationClass].attr('class', 'validation-button-selected');
    }


    /**
     * Adds the visual effects of validation to the expanded view (opaque button and border color around GSV).
     *
     * @param validationOption
     */
    function showValidationOnExpandedView(validationOption) {
        const validationClass = validationOptionToClass[validationOption];

        // If the label had already been validated differently, remove the visual effects from the older validation.
        if (currSelected && currSelected !== validationClass) {
            validationButtons[currSelected].attr('class', 'modal-validation-button');
        }
        currSelected = validationClass;

        // Add the visual effects from the new validation.
        validationButtons[validationClass].attr('class', 'modal-validation-button-selected');
        uiCardImage.css('border-color', validationOptionToColor[validationOption]);
        uiCardImage.css('background-color', validationOptionToColor[validationOption]);
    }

    /**
     * Resets the border to be transparent and the buttons to be less opaque, indicating a lack of validation.
     * @private
     */
    function _removeExpandedValidationVisuals() {
        uiCardImage.css('border-color', 'transparent');
        uiCardImage.css('background-color', 'transparent');
        Object.values(validationButtons).forEach(valButton => valButton.attr('class', 'modal-validation-button'));
    }

    /**
     * Consolidate data on the validation and submit as a POST request.
     * 
     * @param action Validation result.
     * @private
     */
    function validateLabel(action) {
        referenceCard.setProperty('user_validation', action);

        let actionStr = onExpandedView ? 'Validate_ExpandedMenuClick' + action : 'Validate_MenuClick' + action;
        sg.tracker.push(actionStr, {panoId: currCardProperties.gsv_panorama_id}, {labelId: currCardProperties.label_id});
        let validationTimestamp = new Date().getTime();

        let data = {
            label_id: currCardProperties.label_id,
            label_type: currCardProperties.label_type,
            validation_result: resultOptions[action],
            canvas_x: currCardProperties.canvas_x,
            canvas_y: currCardProperties.canvas_y,
            heading: currCardProperties.heading,
            pitch: currCardProperties.pitch,
            zoom: currCardProperties.zoom,
            canvas_height: currCardProperties.canvas_height,
            canvas_width: currCardProperties.canvas_width,
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            is_mobile: false
        };

        // Submit the validation via POST request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/labelmap/validate",
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    /**
     * Updates the card properties necessary for validation.
     * @param {*} newProperties The properties to update to.
     */
    function updateCardProperties(newProperties) {
        currCardProperties = newProperties;
    }

    /**
     * Updates the reference card. This is only used for the expanded view, whose reference card necessarily changes.
     *
     * @param {Card} newCard The new card the Modal references.
     */
    function updateReferenceCard(newCard) {
        referenceCard = newCard;
        if (onExpandedView) {
            if (currCardProperties !== null && currCardProperties.user_validation) {
                showValidationOnExpandedView(currCardProperties.user_validation);
            } else {
                _removeExpandedValidationVisuals();
            }
        }
    }

    self.updateCardProperties = updateCardProperties;
    self.updateReferenceCard = updateReferenceCard;
    self.showValidationOnCard = showValidationOnCard;
    self.showValidationOnExpandedView = showValidationOnExpandedView;

    _init();
    return self;
}


/**
 * An object that creates a display for the severity.
 * 
 * @param {HTMLElement} container The DOM element that contains the display
 * @param {Number} severity The severity to display
 * @param {Boolean} isModal a toggle to determine if this SeverityDisplay is in a modal, or in a card
 * @returns {SeverityDisplay} the generated object
 */
function SeverityDisplay(container, severity, labelType, isModal=false) {
    let self = this;
    self.severity = severity;
    self.severityContainer = container;

    // List of label types where severity ratings are not supported.
    // If more unsupported label types are made, add them here!
    const unsupportedLabels = ['Occlusion', 'Signal'];

    let unsupported = unsupportedLabels.includes(labelType);

    let circles = [];
    function _init() {
        // Set the different classes and ids depending on whether the severity display is in a Modal or in a card.
        let severityCircleClass = isModal ? 'modal-severity-circle' : 'severity-circle';
        let selectedCircleID = /*isModal ? 'modal-current-severity' : */'current-severity';

        let holder = document.createElement('div');
        holder.className = 'label-severity-content';

        let title = document.createElement('div');
        title.className = 'label-severity-header';
        if (isModal) {
            // Add bold weight. Find better way to do this.
            title.classList.add('modal-severity-header');
            // Centers tooltip.
            holder.classList.add('modal-severity-content')
        }

        title.innerText = `${i18next.t("severity")}`;
        // If no severity rating, gray out title.
        if (unsupported || severity == null) {
            title.classList.add('no-severity-header')
        }
        container.append(title);

        // Highlight the correct severity.
        // We do so by darkening a number of circles from the left equal to the severity. For example, if the severity
        // is 3, we will darken the left 3 circles.
        for (let i = 1; i <= 5; i++) {
            let severityCircle = isModal ? new Image() : document.createElement('div');
            severityCircle.className = severityCircleClass;

            if (unsupported || severity == null) {
                // Create grayed out empty circles/smileys.
                if (isModal) {
                    severityCircle.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${i}_gallery.png`;
                    severityCircle.classList.add('modal-no-severity');
                } else {
                    severityCircle.classList.add(severityCircleClass, 'no-severity-circle');
                }
                circles.push(severityCircle);
            } else {
                // Create severity circle elements.
                if (isModal) {
                    if (i <= severity) { // Filled in smileys.
                        severityCircle.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${i}_inverted.png`;
                    } else { // Empty smileys.
                        severityCircle.src = `/assets/javascripts/SVLabel/img/misc/SmileyRating_${i}_gallery.png`;
                    }
                } else {
                    if (i <= severity) { // Fills in circles.
                        severityCircle.id = selectedCircleID
                    }
                }
            }
            circles.push(severityCircle);
        }

        if (severity == null) {
            // Add tooltip if no severity level.
            holder.setAttribute('data-toggle', 'tooltip');
            holder.setAttribute('data-placement', 'top');

            // Change tooltip message depending on if the label is unsupported or user did not add severity rating.
            if (unsupported) {
                holder.setAttribute('title', `${i18next.t("unsupported")}`);
            } else {
                holder.setAttribute('title', `${i18next.t("no-severity")}`);
            }
            $(holder).tooltip('hide');
        }

        // Add all of the severity circles to the DOM.
        for (let i = 0; i < circles.length; i++) {
            holder.appendChild(circles[i]);
        }
        container.append(holder);
    }

    _init()
    return self;
}

/**
 * An object that can display the tags of a label.
 * 
 * @param {HTMLElement} container The DOM element to contain the label information
 * @param {String[]} tags The tags to display
 * @param {Boolean} isModal a boolean switch used if the tags are displayed in a Modal or in a Card
 * @returns {TagDisplay} The created object
 */
function TagDisplay(container, tags, isModal=false) {
    let self = this;
    const popoverTemplate = '<div class="popover additional-tag-popover" role="tooltip">' +
                                '<div class="arrow"></div>' +
                                '<h3 class="popover-title"></h3>' +
                                '<div class="popover-content additional-tag-popover-content"></div>' +
                            '</div>';

    function _init() {
        // Test to see if there are any tags left.
        if (tags.length > 0 || isModal) {
            // Print the header of the Tags div.
            $(container).empty();
            let tagHeader = document.createElement('div');
            tagHeader.className = 'label-tags-header';
            if (isModal) {
                // Add bold weight. Find better way to do this. 
                tagHeader.classList.add('modal-tag-header');
            }

            tagHeader.innerText = `${i18next.t("tags")}`;
            $(container).append(tagHeader);

            let tagContainer = document.createElement('div');
            tagContainer.className = 'label-tags-holder';
            $(container).append(tagContainer);

            // The width (amount of horizontal space) we have for our tags is the length of the container subtracted by
            // the space taken up by the header. 1.25 to deal with the padding from the space between the "Tag" header
            // and the actual list of tags. For the modal, it's simply the width of the tags section.
            let remainingWidth;
            if (isModal) remainingWidth = parseFloat($('.gallery-modal-info-tags').css('width'));
            else         remainingWidth = $(container).width() - ($(tagHeader).width() * 1.25);

            const MARGIN_BW_TAGS =
                parseFloat($('.gallery-tag').css('marginLeft')) + parseFloat($('.gallery-tag').css('marginRight'));
            const WIDTH_FOR_PLUS_N = 30;
            const MIN_TAG_WIDTH = 75;

            let orderedTags = orderTags(tags);
            let tagsText = orderedTags.map(t => i18next.t('tag.' + t));
            let hiddenTags = [];
            for (let i = 0; i < tagsText.length; i++) {
                let tagEl = document.createElement('div');
                // We may want to rename the thumbnail-tag class if we every choose to make tags editable in modal mode.
                tagEl.className = 'gallery-tag thumbnail-tag';
                tagEl.innerText = tagsText[i];
                $(tagContainer).append(tagEl);

                // If there is enough space to fit the full tag, add it. If there isn't enough to show the full tag but
                // there is still a decent amount of space (75 px if this is the last tag or 105 px if we also need to
                // add the '+n' text), add the tag with a max-width so that it gets cut off with an ellipsis. If we
                // can't fit the tag at all, will need to add to the hidden tags in the '+n' popover.
                let isLastTag = i === tagsText.length - 1;
                let tagWidth = parseFloat($(tagEl).css('width'));

                // If this is the last tag and there are hidden tags, then we need to account for the PLUS_N indicator
                // in addition to the margin between tags in the extra space needed. Otherwise, we just need to account
                // for the margin between tags.
                let extraSpaceNeeded = (isLastTag && hiddenTags.length === 0) ? MARGIN_BW_TAGS : MARGIN_BW_TAGS + WIDTH_FOR_PLUS_N;
                let spaceForShortenedTag = (isLastTag && hiddenTags.length === 0) ? MIN_TAG_WIDTH : MIN_TAG_WIDTH + WIDTH_FOR_PLUS_N;

                if (isModal || (remainingWidth > tagWidth + extraSpaceNeeded)) {
                    // Show the entire tag if there is enough space. Always show in modal bc we have a scrollbar.
                    remainingWidth -= (tagWidth + MARGIN_BW_TAGS);
                } else if (remainingWidth > spaceForShortenedTag) {
                    // Show a tag abbreviated with an ellipsis if there's some space, just not enough for the full tag.
                    $(tagEl).css('maxWidth', remainingWidth - extraSpaceNeeded);
                    tagWidth = parseFloat($(tagEl).css('width'));
                    remainingWidth -= (tagWidth + MARGIN_BW_TAGS);
                    // Since we cut off with an ellipsis, add a tooltip with the full text.
                    tagEl.title = tagsText[i];
                } else {
                    // If the tag does not fit at all, add it to the list of hidden tags to show in the popover.
                    tagEl.remove();
                    tagEl.classList.add("not-added");
                    hiddenTags.push(tagEl);
                }
            }

            // If there was not enough space to display all the tags, show the rest in a popover on the '+n' text.
            if (hiddenTags.length > 0) {
                let additional = document.createElement('div');
                additional.className = "gallery-tag additional-count";
                additional.innerText = " + " + hiddenTags.length;
                $(additional).popover("destroy").popover({
                    placement: 'top',
                    html: true,
                    delay: { "show": 300, "hide": 10 },
                    content: hiddenTags.map(tag => tag.outerHTML).join(""),
                    trigger: 'hover',
                    template: popoverTemplate
                }).popover("show").popover("hide");
                $(tagContainer).append(additional);
            }
        }
    }

    /**
     * Orders tags by placing tags that match applied tags first.
     * @param {*} tags Tags to order.
     * @returns Ordered tag list.
     */
    function orderTags(tags) {
        let orderedTags = [];
        let appliedTags = sg.tagContainer.getAppliedTagNames();
        for (let tag of tags) {
            if (orderedTags.length === 0) {
                orderedTags.push(tag);
            } else {
                if (appliedTags.includes(tag)) {
                    // Prepend tag if it is a selected tag.
                    orderedTags = [tag, ...orderedTags];
                } else {
                    orderedTags.push(tag);
                }
            }
        }
        return orderedTags;
    }

    _init();
    return self;
}

/**
 * A holder class that inserts a GSV Pano into the supplied DOM element.
 *
 * @param {HTMLElement} svHolder The DOM element that the GSV Pano will be placed in.
 * @returns {GalleryPanorama} The gallery panorama that was generated.
 */
 function GalleryPanorama(svHolder) {
    let self = {
        className: "GalleryPanorama",
        labelMarker: undefined,
        panoId: undefined,
        panorama: undefined,
    };

    const icons = {
        CurbRamp : '/assets/images/icons/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/images/icons/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem.png',
        Other : '/assets/images/icons/AdminTool_Other.png',
        Occlusion : '/assets/images/icons/AdminTool_Other.png',
        NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk.png',
        Crosswalk : '/assets/images/icons/AdminTool_Crosswalk.png',
        Signal : '/assets/images/icons/AdminTool_Signal.png'
    };

    // Determined experimentally; varies w/ GSV Panorama size.
    const zoomLevel = {
        1: 1,
        2: 1.95,
        3: 2.95
    };

    /**
     * This function initializes the Panorama.
     */
    function _init () {
        self.svHolder = $(svHolder);
        self.svHolder.addClass("admin-panorama");

        // svHolder's children are absolutely aligned, svHolder's position has to be either absolute or relative.
        if(self.svHolder.css('position') != "absolute" && self.svHolder.css('position') != "relative")
            self.svHolder.css('position', 'relative');

        // GSV will be added to panoCanvas.
        self.panoCanvas = $("<div id='pano'>").css({
            position: 'relative',
            top: '0px',
            width: '100%',
            height: '60vh'
        })[0];

        self.panoNotAvailable = $("<div id='pano-not-avail'>Oops, our fault but there is no longer imagery available " +
            "for this label.</div>").css({
            'font-size': '200%',
            'padding-bottom': '15px'
        })[0];

        self.panoNotAvailableDetails =
            $("<div id='pano-not-avail-2'>We use the Google Maps API to show the sidewalk images and sometimes Google" +
                " removes these images so we can no longer access them. Sorry about that.</div>").css({
            'font-size': '85%',
            'padding-bottom': '15px'
        })[0];

        self.svHolder.append($(self.panoCanvas));
        self.svHolder.append($(self.panoNotAvailable));
        self.svHolder.append($(self.panoNotAvailableDetails));

        let panoOptions = {
            mode: 'html4',
            showRoadLabels: false,
            motionTracking: false,
            motionTrackingControl: false,
            addressControl: false,
            disableDefaultUI: true,
            linksControl: false,
            navigationControl: false,
            panControl: false,
            zoomControl: false,
            keyboardShortcuts: false
        };
        self.panorama = typeof google != "undefined" ? new google.maps.StreetViewPanorama(self.panoCanvas, panoOptions) : null;
        self.panorama.addListener('pano_changed', function() {
            // We always want to update panoId when pano changes (as it is possible the pano changes
            // for a reason OTHER THAN a user clicking on a card - for example, using clickToGo on the pano).
            self.panoId = self.panorama.getPano();
            if (self.labelMarker !== undefined) {
                if (self.labelMarker.panoId === self.panoId) {
                    // We've moved to a pano with an ID that matches the current label to show, so we render the label.
                    self.labelMarker.marker.setVisible(true);
                } else {
                    // Pano ID of label doesn't match the current pano's pano ID, so we don't show the label marker.
                    self.labelMarker.marker.setVisible(false);
                }
            }
        });

        return this;
    }

    function setPov(heading, pitch, zoom) {
        self.panorama.set('pov', {heading: heading, pitch: pitch});
        self.panorama.set('zoom', zoomLevel[zoom]);
    }

    /**
     * Sets the panorama ID and POV from label metadata.
     * @param panoId
     * @param heading
     * @param pitch
     * @param zoom
     */
    function setPano(panoId, heading, pitch, zoom) {
        if (typeof google != "undefined") {
            self.svHolder.css('visibility', 'hidden');
            self.panoId = panoId;

            self.panorama.setPano(panoId);
            self.setPov(heading, pitch, zoom);

            // Based off code from Onboarding.
            // We write another callback function because of a bug in the Google Maps API that
            // causes the screen to go black.
            // This callback gives time for the pano to load for 500ms. Afterwards, we trigger a
            // resize and reset the POV/Zoom.
            function callback (n) {
                google.maps.event.trigger(self.panorama, 'resize');
                self.setPov(heading, pitch, zoom);
                self.svHolder.css('visibility', 'visible');

                // Show pano if it exists, an error message if there is no GSV imagery, and another error message if we
                // wait a full 2 seconds without getting a response from Google.
                if (self.panorama.getStatus() === "OK") {
                    $(self.panoCanvas).css('display', 'block');
                    $(self.panoNotAvailable).css('display', 'none');
                    $(self.panoNotAvailableDetails).css('display', 'none');
                } else if (self.panorama.getStatus() === "ZERO_RESULTS") {
                    $(self.svHolder).css('height', '');
                    $(self.panoNotAvailable).text('Oops, our fault but there is no longer imagery available for this label.');
                    $(self.panoCanvas).css('display', 'none');
                    $(self.panoNotAvailable).css('display', 'block');
                    $(self.panoNotAvailableDetails).css('display', 'block');
                } else if (n < 1) {
                    $(self.svHolder).css('height', '');
                    $(self.panoNotAvailable).text('We had trouble connecting to Google Street View, please try again later!');
                    $(self.panoCanvas).css('display', 'none');
                    $(self.panoNotAvailable).css('display', 'block');
                    $(self.panoNotAvailableDetails).css('display', 'none');
                } else {
                    setTimeout(callback, 200, n - 1);
                }
            }
            setTimeout(callback, 200, 10);
        }
        return this;
    }

    /**
     * Renders a Panomarker (label) onto Google Streetview Panorama.
     * @param label: instance of AdminPanoramaLabel
     * @returns {renderLabel}
     */
    function renderLabel (label) {
        // Get the panomarker icon url.
        const url = icons[label['label_type']];
        const pos = getPosition(label['canvasX'], label['canvasY'], label['originalCanvasWidth'],
            label['originalCanvasHeight'], label['zoom'], label['heading'], label['pitch']);

        if (!self.labelMarker) {
            // No panomarker has been added to the modal, so we create a new one.
            self.labelMarker = {
                panoId: self.panoId,
                marker: new PanoMarker({
                    container: self.panoCanvas,
                    pano: self.panorama,
                    position: {heading: pos.heading, pitch: pos.pitch},
                    icon: url,
                    size: new google.maps.Size(22, 22),
                    anchor: new google.maps.Point(10, 10)
                })
            };
        } else {
            // Adjust the existing panomarker.
            self.labelMarker.panoId = self.panoId;
            self.labelMarker.marker.setPano(self.panorama, self.panoCanvas);
            self.labelMarker.marker.setPosition({
                heading: pos.heading,
                pitch: pos.pitch
            });
            self.labelMarker.marker.setIcon(url);
        }

        // Make our newly set panomarker visible.
        self.labelMarker.marker.setVisible(true);

        return this;
    }

    /**
     * Calculates heading and pitch for a Google Maps marker using (x, y) coordinates
     * From PanoMarker spec.
     * @param canvas_x          X coordinate (pixel) for label.
     * @param canvas_y          Y coordinate (pixel) for label.
     * @param canvas_width      Original canvas width.
     * @param canvas_height     Original canvas height.
     * @param zoom              Original zoom level of label.
     * @param heading           Original heading of label.
     * @param pitch             Original pitch of label.
     * @returns {{heading: number, pitch: number}}
     */
    function getPosition(canvas_x, canvas_y, canvas_width, canvas_height, zoom, heading, pitch) {
        function sgn(x) {
            return x >= 0 ? 1 : -1;
        }

        const PI = Math.PI;
        let cos = Math.cos;
        let sin = Math.sin;
        let tan = Math.tan;
        let sqrt = Math.sqrt;
        let atan2 = Math.atan2;
        let asin = Math.asin;
        const fov = get3dFov(zoom) * PI / 180.0;
        const width = canvas_width;
        const height = canvas_height;
        const h0 = heading * PI / 180.0;
        const p0 = pitch * PI / 180.0;
        const f = 0.5 * width / tan(0.5 * fov);
        const x0 = f * cos(p0) * sin(h0);
        const y0 = f * cos(p0) * cos(h0);
        const z0 = f * sin(p0);
        const du = (canvas_x) - width / 2;
        const dv = height / 2 - (canvas_y - 5);
        const ux = sgn(cos(p0)) * cos(h0);
        const uy = -sgn(cos(p0)) * sin(h0);
        const uz = 0;
        const vx = -sin(p0) * sin(h0);
        const vy = -sin(p0) * cos(h0);
        const vz = cos(p0);
        const x = x0 + du * ux + dv * vx;
        const y = y0 + du * uy + dv * vy;
        const z = z0 + du * uz + dv * vz;
        const R = sqrt(x * x + y * y + z * z);
        const h = atan2(x, y);
        const p = asin(z / R);
        return {
            heading: h * 180.0 / PI,
            pitch: p * 180.0 / PI
        };
    }

    /**
     * This calculates the heading and position for placing this Label onto the panorama from the same POV as when the
     * user placed the label.
     * TODO: Ask Mikey about whether this is needed for good design.
     *       If so, need to change the self.label.
     * @returns {{heading: number, pitch: number}}
     */
    function getOriginalPosition () {
        return getPosition(self.label['canvasX'], self.label['canvasY'], self.label['originalCanvasWidth'],
            self.label['originalCanvasHeight'], self.label['zoom'], self.label['heading'], self.label['pitch']);
    }

    /**
     * From panomarker spec.
     * @param zoom
     * @returns {number}
     */
    function get3dFov (zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent.
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally.
    }

    /**
     * Gets the current coordinates.
     * @returns {{lng: float, lat: float}}
     */
    function getCoords() {
        let coords = self.panorama.getPosition();
        // Creates "TypeError: Cannot read properties of undefined (reading 'lat')", but still works fine.
        return coords ? { 'lat' : coords.lat(), 'lng' : coords.lng() } : undefined;
    }

    /**
     * Get the current point of view.
     * @returns {object} pov
     */
    function getPov() {
        var pov = self.panorama.getPov();

        // Pov can be less than 0. So adjust it.
        while (pov.heading < 0) {
            pov.heading += 360;
        }

        // Pov can be more than 360. Adjust it.
        while (pov.heading > 360) {
            pov.heading -= 360;
        }
        return pov;
    }

    function getPanoId() {
        return self.panoId;
    }

    _init();

    self.setPov = setPov;
    self.setPano = setPano;
    self.renderLabel = renderLabel;
    self.getOriginalPosition = getOriginalPosition;
    self.getPosition = getCoords;
    self.getPov = getPov;
    self.getPanoId = getPanoId;
    return self;
}

/**
 *
 * An object that contains all of the information to render a label onto a GSVPanorama.
 * Used in the GalleryPanorama.renderLabel() method.
 * 
 * @param {String} labelId The ID of the label.
 * @param {String} labelType The type of the label.
 * @param {Number} canvasX The X position of the label on the canvas.
 * @param {Number} canvasY The Y position of the label on the canvas.
 * @param {Number} originalCanvasWidth The width of the canvas when the label was added.
 * @param {Number} originalCanvasHeight The height of the canvas when the label was added.
 * @param {Number} heading The heading of the GSV pano when the label was added in audit.
 * @param {Number} pitch The pitch of the GSV pano when the label was added in audit.
 * @param {Number} zoom The zoom of the GSV pano when the label was added in audit.
 * @returns {GalleryPanoramaLabel}
 * @constructor
 */
 function GalleryPanoramaLabel(labelId, labelType, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight,
    heading, pitch, zoom) {
    let self = { className: "GalleryPanoramaLabel" };

    /**
     * Initializes the instance variables to the values provided in the constructor
     */
    function _init () {
        self.labelId = labelId;
        self.label_type = labelType;
        self.canvasX = canvasX;
        self.canvasY = canvasY;
        self.originalCanvasWidth = originalCanvasWidth;
        self.originalCanvasHeight = originalCanvasHeight;
        self.heading = heading;
        self.pitch = pitch;
        self.zoom = zoom;
    }

    _init();

    return self;
}

/**
 * A Modal element that provides extended information about a label, along with placing a label in a GSV Panorama to
 * aid the user in contextualizing the location of labels.
 *
 * @param {HTMLElement} uiModal The container for the Modal in the DOM
 * @returns
 */
function Modal(uiModal) {

    let self = this;

    const cardsPerPage = 9;
    const unselectedCardClassName = "modal-background-card";

    // Observes the card container so that once cards are rendered (added to DOM), we can reopen the modal.
    // We need this because the prev/next page actions are asynchronous (they query the backend), so before reopening
    // the modal on a new page, we need to make sure the cards have actually been rendered in gallery view.
    const observer = new MutationObserver((mutationsList, observer) => {
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // We check to make sure that the mutation effects the childList (adding/removing child nodes) of the
                // card container and that cards (child nodes) were added in the mutation, indicating the cards have
                // been rendered.
                $('.gallery-modal').attr('style', 'display: flex');
                $('.grid-container').css("grid-template-columns", "1fr 5fr");

                // Sets/Updates the label being displayed in the expanded modal.
                updateModalCardByIndex(self.cardIndex);

                // Stop observing.
                observer.disconnect();
                break; // No need to check all mutation events?
            }
        }
    });

    // Properties of the label in the card.
    let properties = {
        label_id: undefined,
        label_type: undefined,
        gsv_panorama_id: undefined,
        image_date: undefined,
        label_timestamp: undefined,
        heading: undefined,
        pitch: undefined,
        zoom: undefined,
        canvas_x: undefined,
        canvas_y: undefined,
        canvas_width: undefined,
        canvas_height: undefined,
        severity: undefined,
        temporary: undefined,
        description: undefined,
        streetEdgeId: undefined,
        regionId: undefined,
        user_validation: undefined,
        tags: []
    };

    /**
     * Initialization function for the Modal. Serves to bind the DOM elements of the Modal to class variables for future
     * access when populating the fields. It also instantiates the GSV panorama in the specified location of the Modal.
     */
    function _init() {
        self.panoHolder = $('.actual-pano');
        self.tags = $('.gallery-modal-info-tags');
        self.timestamps = $('.gallery-modal-info-timestamps');
        self.severity = $('.gallery-modal-info-severity');
        self.temporary = $('.gallery-modal-info-temporary');
        self.description = $('.gallery-modal-info-description');
        self.header = $('.gallery-modal-header');
        self.pano = new GalleryPanorama(self.panoHolder);
        self.closeButton = $('.gallery-modal-close');
        self.leftArrow = $('#prev-label');
        self.rightArrow = $('#next-label');
        self.validation = $('.gallery-modal-validation');
        self.closeButton.click(closeModalAndRemoveCardTransparency);
        self.rightArrow.click(nextLabel);
        self.leftArrow.click(previousLabel);
        self.cardIndex = -1;
        self.validationMenu = new ValidationMenu(null, self.panoHolder, null, self, true);

        attachEventHandlers();
    }

    /**
     * Performs the actions to close the Modal.
     * NOTE does not remove card transparency. For that, use closeModalAndRemoveCardTransparency().
     */
    function closeModal() {
        // Since we have made the sidebar a "fixed" DOM element, it no longer exists as part of the grid flow. Thus,
        // when we aren't in expanded modal mode, the only thing that is part of the grid is the image-container. We
        // therefore shouldn't need to divide the grid into columns (changed "0.5fr 3fr" to "none").
        // Disclaimer: I could be totally wrong lol.
        $('.grid-container').css("grid-template-columns", "none");
        uiModal.hide();
    }

    /**
     * Removes transparency from the current page of cards.
     */
    function removeCardTransparency() {
        let currentPageCards = sg.cardContainer.getCurrentPageCards();
        for (let card of currentPageCards) {
            let cardDomEl = document.getElementById("gallery_card_" + card.getLabelId());
            if (cardDomEl.classList.contains(unselectedCardClassName)) {
                cardDomEl.classList.remove(unselectedCardClassName);
            }
        }
    }

    /**
     * Closes modal and removes transparency from cards on the current page. Not used when loading a new page of cards.
     */
    function closeModalAndRemoveCardTransparency() {
        closeModal();
        removeCardTransparency();
    }

    /**
     * Resets the fields of the Modal.
     */
    function resetModal() {
        self.description.empty();
        self.temporary.empty();
        self.severity.empty();
        self.timestamps.empty();
    }

    /**
     * Populates the information in the Modal.
     */
    function populateModalDescriptionFields() {
        // Add timestamp data for when label was placed and when pano was created.
        self.labelTimestampData = document.createElement('div');
        self.labelTimestampData.className = 'label-timestamp';
        self.labelTimestampData.innerHTML = `<div>${i18next.t('labeled')}: ${moment(new Date(properties.label_timestamp)).format('LL, LT')}</div>`;
        let panoTimestampData = document.createElement('div');
        panoTimestampData.className = 'pano-timestamp';
        panoTimestampData.innerHTML = `<div>${i18next.t('image-date')}: ${moment(properties.image_date).format('MMM YYYY')}</div>`;
        self.timestamps.append(self.labelTimestampData);
        self.timestamps.append(panoTimestampData);

        // Add info button to the right of the label timestamp.
        let getPanoId = sg.modal().pano.getPanoId;
        self.infoPopover = new GSVInfoPopover(self.labelTimestampData, sg.modal().pano.panorama,
            sg.modal().pano.getPosition, getPanoId,
            function () { return properties['street_edge_id']; }, function () { return properties['region_id']; },
            sg.modal().pano.getPov, false,
            function() { sg.tracker.push('GSVInfoButton_Click', { panoId: getPanoId() }); },
            function() { sg.tracker.push('GSVInfoCopyToClipboard_Click', { panoId: getPanoId() }); },
            function() { sg.tracker.push('GSVInfoViewInGSV_Click', { panoId: getPanoId() }); },
            function () { return properties['label_id']; }
        );

        // Add severity and tag display to the modal.
        new SeverityDisplay(self.severity, properties.severity, properties.label_type, true);
        new TagDisplay(self.tags, properties.tags, true);

        // Add the information about the temporary property to the Modal.
        let temporaryHeader = document.createElement('div');
        temporaryHeader.className = 'modal-temporary-header';
        temporaryHeader.innerHTML = i18next.t("temporary");
        let temporaryBody = document.createElement('div');
        temporaryBody.className = 'modal-temporary-body';
        temporaryBody.innerHTML = properties.temporary ? i18next.t('yes') : i18next.t('no');
        self.temporary.append(temporaryHeader);
        self.temporary.append(temporaryBody);

        // Add the information about the description of the label to the Modal.
        let descriptionHeader = document.createElement('div');
        descriptionHeader.className = 'modal-description-header';
        descriptionHeader.innerHTML = i18next.t("description");
        let descriptionBody = document.createElement('div');
        descriptionBody.className = 'modal-description-body';
        descriptionBody.innerHTML = properties.description === null ? i18next.t('no-description') : properties.description;
        self.description.append(descriptionHeader);
        self.description.append(descriptionBody);
    }

    /**
     * Performs the actions needed to open the modal.
     */
    function openModal() {
        resetModal();
        populateModalDescriptionFields();
        self.pano.setPano(properties.gsv_panorama_id, properties.heading, properties.pitch, properties.zoom);
        self.pano.renderLabel(self.label);
        self.header.text(i18next.t(util.camelToKebab(properties.label_type)));

        // Highlight selected card thumbnail.
        highlightThumbnail(document.getElementById("gallery_card_" + properties.label_id));
    }

    function highlightThumbnail(galleryCard) {
        // Reset the sidebar as sticky as the sidebar should never be under the card container upon opening the modal.
        // Adjust sidebar positioning.
        sg.ui.cardFilter.wrapper.css('position', 'fixed');
        sg.ui.cardFilter.wrapper.css('top', '');

        // Adjust card container margin.
        sg.ui.cardContainer.holder.css('margin-left', sg.ui.cardFilter.wrapper.css('width'));
        sg.scrollStatus.stickySidebar = true;

        // Centers the card thumbnail that was selected. If it's the last card, we scroll such that the card is at the
        // bottom of the visible window.
        let index = self.cardIndex;
        let page = sg.cardContainer.getCurrentPage();
        let totalCards = sg.cardContainer.getCurrentCards().getSize();
        galleryCard.scrollIntoView({
            block: (index < page * cardsPerPage - 1 && index < totalCards - 1) ? 'center' : 'end',
            behavior: 'smooth'
        });

        // Make sure to remove transparent effect from selected card.
        if (galleryCard.classList.contains(unselectedCardClassName)) {
            galleryCard.classList.remove(unselectedCardClassName);
        }

        // The rest of the cards should be semitransparent.
        let currentPageCards = sg.cardContainer.getCurrentPageCards();
        for (let card of currentPageCards) {
            let cardLabelId = card.getLabelId();
            if (cardLabelId !== properties.label_id) {
                let cardDomEl = document.getElementById("gallery_card_" + cardLabelId);
                if (!cardDomEl.classList.contains(unselectedCardClassName)) {
                    cardDomEl.classList.add(unselectedCardClassName);
                }
            }
        }
    }

    /**
     * Updates the local variables to the properties of a new label and creates a new GalleryPanoramaLabel object.
     *
     * @param newProps The new properties to push into the Modal
     */
    function updateProperties(newProps) {
        for (const attrName in newProps) {
            if (newProps.hasOwnProperty(attrName)) {
                properties[attrName] = newProps[attrName];
            }
        }
        self.label = new GalleryPanoramaLabel(properties.label_id, properties.label_type,
                                              properties.canvas_x, properties.canvas_y,
                                              properties.canvas_width, properties.canvas_height,
                                              properties.heading, properties.pitch, properties.zoom);

        self.validationMenu.updateCardProperties(properties);
        self.validationMenu.updateReferenceCard(sg.cardContainer.getCardByIndex(self.cardIndex));
    }

    function getProperty(key) {
        return properties[key];
    }

    /**
     * Updates the index of the current label being displayed in the modal.
     *
     * @param {Number} newIndex The new index of the card being displayed
     */
    function updateCardIndex(newIndex) {
        updateModalCardByIndex(newIndex);
    }

    /**
     * Tries to update the current card to the given input index.
     *
     * @param {Number} index The index of the card to update to
     */
    function updateModalCardByIndex(index) {
        self.leftArrow.prop('disabled', false);
        self.rightArrow.prop('disabled', false);
        self.cardIndex = index;
        updateProperties(sg.cardContainer.getCardByIndex(index).getProperties());
        openModal();
        if (self.cardIndex === 0) {
            self.leftArrow.prop('disabled', true);
        }

        if (sg.cardContainer.isLastPage()) {
            let page = sg.cardContainer.getCurrentPage();
            let lastCardIndex = (page - 1) * cardsPerPage + sg.cardContainer.getCurrentPageCards().length - 1;
            if (self.cardIndex === lastCardIndex) {
                // The current page is the last page and the current card being rendered is the last card on the page.
                self.rightArrow.prop('disabled', true);
            }
        }
    }

    /**
     * Moves to the next label.
     */
    function nextLabel() {
        let page = sg.cardContainer.getCurrentPage();
        if (self.cardIndex < page * cardsPerPage - 1) {
            // Iterate to next card on the page, updating the label being shown in the expanded view to be
            // that of the next card.
            updateModalCardByIndex(self.cardIndex + 1);
        } else {
            // Increment cardIndex now as the observer is ignorant of whether the prev or next arrow was clicked.
            self.cardIndex += 1;

            // Move to the next page as the current card is the last on the page.
            sg.ui.cardContainer.nextPage.click();

            // The target we will observe.
            let cardHolder = sg.ui.cardContainer.holder[0];

            // Start observing the target node for configured mutations.
            observer.observe(cardHolder, { childList: true });
        }
    }

    /**
     * Moves to the previous label.
     */
    function previousLabel() {
        let page = sg.cardContainer.getCurrentPage();
        if (self.cardIndex > (page - 1) * cardsPerPage) {
            // Iterate to previous card on the page, updating the label being shown in the modal to be
            // that of the previous card.
            updateModalCardByIndex(self.cardIndex - 1);
        } else {
            // Decrement cardIndex now as the observer is ignorant of whether the prev or next arrow was clicked.
            self.cardIndex -= 1;

            // Move to the previous page as the current card is the first on the page.
            sg.ui.cardContainer.prevPage.click();

            // The target we will observe.
            let cardHolder = sg.ui.cardContainer.holder[0];

            // Start observing the target node for configured mutations.
            observer.observe(cardHolder, { childList: true });
        }
    }

    /**
     * Attach any specific event handlers for modal contents.
      */
    function attachEventHandlers() {

        // GSV custom handles cursor on '.widget-scene' element. We need to be more specific than that to override.
        function handlerViewControlLayerMouseDown(e) {
            $('.widget-scene-canvas').css('cursor', 'url(/assets/javascripts/SVLabel/img/cursors/closedhand.cur) 4 4, move');
        }

        function handlerViewControlLayerMouseUp(e) {
            $('.widget-scene-canvas').css('cursor', '');
        }

        // Google Street View loads inside 'actual-pano' but there is no event triggered after it loads all the components.
        // So we need to detect it by brute-force.
        $('.actual-pano').bind('DOMNodeInserted', function(e) {
            if (e.target && e.target.className && typeof e.target.className === 'string' && e.target.className.indexOf('widget-scene-canvas') > -1) {
                $('.widget-scene-canvas').bind('mousedown', handlerViewControlLayerMouseDown).bind('mouseup', handlerViewControlLayerMouseUp);
            }
        });
    }

    _init();

    self.closeModal = closeModal;
    self.updateCardIndex = updateCardIndex;
    self.getProperty = getProperty;

    return self;
}

/** @namespace */
var sg = sg || {};

/**
 * Main module for Gallery.
 * @param params Object passed from gallery.scala.html containing initial values pulled from the database on page
 *              load.
 * @returns {Main}
 * @constructor
 */
function Main (params) {
    let self = this;

    sg.scrollStatus = {
        stickySidebar: true,
        stickyModal: true
    };

    let headerSidebarOffset = undefined;

    function _initUI() {
        sg.ui = {};

        // Initializes filter components in sidebar.
        sg.ui.cardFilter = {};
        sg.ui.cardFilter.wrapper = $(".sidebar");
        sg.ui.cardFilter.holder = $("#card-filter");
        sg.ui.cardFilter.tags = $("#tags");
        sg.ui.cardFilter.severity = $("#severity-select");

        // Initializes city select component in sidebar.
        sg.ui.cityMenu = {};
        sg.ui.cityMenu.holder = $("#city-filter-holder");
        sg.ui.cityMenu.select = $('#city-select');

        // Initializes label select component in sidebar.
        sg.ui.labelTypeMenu = {};
        sg.ui.labelTypeMenu.holder = $("#label-type-filter-holder");
        sg.ui.labelTypeMenu.select = $('#label-select');

        // TODO: potentially remove if we decide sorting is not desired for later versions.
        sg.ui.cardSortMenu = {};
        sg.ui.cardSortMenu.holder = $("#card-sort-menu-holder");
        sg.ui.cardSortMenu.sort = $('#card-sort-select');

        // Initialize card container component.
        sg.ui.cardContainer = {};
        sg.ui.cardContainer.holder = $("#image-card-container");
        sg.ui.cardContainer.prevPage = $("#prev-page");
        sg.ui.cardContainer.pageNumber = $("#page-number")
        sg.ui.cardContainer.nextPage = $("#next-page");

        // Keep track of some other elements whose status or dimensions are useful.
        sg.ui.pageControl = $(".page-control");
        sg.ui.navbar = $("#header");
        sg.pageLoading = $('#page-loading');
        sg.labelsNotFound = $('#labels-not-found');

        $('.gallery-modal').hide();

        // Calculate offset between bottom of navbar and sidebar.
        headerSidebarOffset =
            sg.ui.cardFilter.wrapper.offset().top - (sg.ui.navbar.offset().top + sg.ui.navbar.outerHeight());
    }

    function _init() {

        sg.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';

        // Initialize functional components of UI elements.
        sg.cityMenu = new CityMenu(sg.ui.cityMenu);
        sg.labelTypeMenu = new LabelTypeMenu(sg.ui.labelTypeMenu);

        // sg.cardSortMenu = new CardSortMenu(sg.ui.cardSortMenu);
        sg.tagContainer = new CardFilter(sg.ui.cardFilter, sg.labelTypeMenu, sg.cityMenu);
        sg.cardContainer = new CardContainer(sg.ui.cardContainer);
        sg.modal = sg.cardContainer.getModal;
        // Initialize data collection.
        sg.form = new Form(params.dataStoreUrl, params.beaconDataStoreUrl);
        sg.tracker = new Tracker();

        let sidebarWrapper = sg.ui.cardFilter.wrapper;
        let sidebarWidth = sidebarWrapper.css('width');

        sg.ui.labelTypeMenu.select.change();

        // Handle sidebar and expanded view stickiness while scrolling.
        $(window).scroll(function () {
            // Make sure the page isn't loading.
            if (!sg.pageLoading.is(":visible") && !sg.labelsNotFound.is(':visible')) {
                let sidebarBottomOffset = sidebarWrapper.offset().top + sidebarWrapper.outerHeight(true);
                let cardContainerBottomOffset = sg.ui.cardContainer.holder.offset().top +
                                                sg.ui.cardContainer.holder.outerHeight(true) - 5;
                let visibleWindowBottomOffset = $(window).scrollTop() + $(window).height();

                // Handle sidebar stickiness.
                if (sg.scrollStatus.stickySidebar) {
                    if (cardContainerBottomOffset < sidebarBottomOffset) {
                        let sidebarHeightBeforeRelative = sidebarWrapper.outerHeight(true);

                        // Adjust sidebar positioning.
                        sidebarWrapper.css('position', 'relative');

                        // Compute the new location for the top of the sidebar, just above the paging arrows.
                        let navbarHeight = sg.ui.navbar.outerHeight(false);
                        let newTop = cardContainerBottomOffset - sidebarHeightBeforeRelative - navbarHeight;
                        sidebarWrapper.css('top', newTop);

                        // Adjust card container margin.
                        sg.ui.cardContainer.holder.css('margin-left', '0px');
                        sg.scrollStatus.stickySidebar = false;
                    }
                } else {
                    let currHeaderSidebarOffset =
                        sidebarWrapper.offset().top - (sg.ui.navbar.offset().top + sg.ui.navbar.outerHeight(false));
                    if (currHeaderSidebarOffset > headerSidebarOffset) {
                        // Adjust sidebar positioning.
                        sidebarWrapper.css('position', 'fixed');
                        sidebarWrapper.css('top', '');

                        // Adjust card container margin.
                        sg.ui.cardContainer.holder.css('margin-left', sidebarWidth);
                        sg.scrollStatus.stickySidebar = true;
                    }
                }

                // Handle modal stickiness.
                if (cardContainerBottomOffset < visibleWindowBottomOffset) {
                    if (sg.scrollStatus.stickyModal) {
                        // Prevent modal from going too low (i.e., when a user scrolls down fast).
                        $('.gallery-modal').css('top', cardContainerBottomOffset - $(window).height());
                        sg.scrollStatus.stickyModal = false;
                    }
                } else {
                    if (!sg.scrollStatus.stickyModal) sg.scrollStatus.stickyModal = true;

                    // Emulate the modal being "fixed".
                    $('.gallery-modal').css('top', $(window).scrollTop());
                }
            }
        });
    }

    // Gets all the text on the gallery page for the correct language.
    i18next.use(i18nextXHRBackend);
    i18next.init({
        backend: { loadPath: '/assets/locales/{{lng}}/{{ns}}.json' },
        fallbackLng: 'en',
        ns: ['common', 'gallery'],
        defaultNS: 'common',
        lng: params.language,
        debug: false
    }, function(err, t) {
        if (err) return console.log('something went wrong loading', err);

        _initUI();
        _init();
    });
    return self;
}

/**
 * Source:
 * https://github.com/marmat/google-maps-api-addons/blob/master/panomarker/src/panomarker.js
 *
 * PanoMarker
 * Version 1.0
 *
 * @author kaktus621@gmail.com (Martin Matysiak)
 * @fileoverview A marker that can be placed inside custom StreetView panoramas.
 * Regular markers inside StreetViewPanoramas can only be shown vertically
 * centered and aligned to LatLng coordinates.
 *
 * Custom StreetView panoramas usually do not have any geographical information
 * (e.g. inside views), thus a different method of positioning the marker has to
 * be used. This class takes simple heading and pitch values from the panorama's
 * center in order to move the marker correctly with the user's viewport
 * changes.
 *
 * Since something like that is not supported natively by the Maps API, the
 * marker actually sits on top of the panorama, DOM-wise outside of the
 * actual map but still inside the map container.
 */

/**
 * @license Copyright 2014 — 2015 Martin Matysiak.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * PanoMarkerOptions
 *
 * {google.maps.Point} anchor The point (in pixels) to which objects will snap.
 * {string} className The class name which will be assigned to the
 *    created div node.
 * {HTMLDivElement} container The container holding the panorama.
 * {string} icon URL to an image file that shall be used.
 * {string} id A unique identifier that will be assigned to the
 *    created div-node.
 * {google.maps.StreetViewPanorama} pano Panorama in which to display marker.
 * {google.maps.StreetViewPov} position Marker position.
 * {google.maps.Size} size The size of the marker in pixels.
 * {string} title Rollover text.
 * {boolean} visible If true, the marker is visible.
 * {number} zIndex The marker's z-index.
 */


(function(global, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else if (typeof define === 'function' && typeof define.amd === 'object') {
        define(['goog!maps,3,other_params:[sensor=false&libraries=visualization]'],
            factory);
    } else {
        if (typeof google !== 'object' || typeof google.maps !== 'object') {
            throw new Error('PanoMarker requires google maps library');
        }
        global.PanoMarker = factory();
    }
}(typeof window !== 'undefined' ? window : this, function() {

    /**
     * Creates a PanoMarker with the options specified. If a panorama is specified,
     * the marker is added to the map upon construction. Note that the position must
     * be set for the marker to display.
     *
     * Important: do not use the inherited method <code>setMap()</code> to change
     * the panorama, but use <code>setPano()</code> instead, otherwise a proper
     * functionality is not guaranteed.
     *
     * @constructor
     * @param {PanoMarkerOptions} opts A set of parameters to customize the marker.
     * @extends google.maps.OverlayView
     */
    var PanoMarker = function(opts) {

        // In case no options have been given at all, fallback to {} so that the
        // following won't throw errors.
        opts = opts || {};

        // panorama.getContainer has been deprecated in the Google Maps API. The user
        // now explicity needs to pass in the container for the panorama.
        if (!opts.container) {
            throw 'A panorama container needs to be defined.';
        }

        /** @private @type {HTMLDivElement} */
        this.container_ = opts.container;

        /**
         * Currently only Chrome is rendering panoramas in a 3D sphere. The other
         * browsers are just showing the raw panorama tiles and pan them around.
         *
         * @private
         * @type {function(StreetViewPov, StreetViewPov, number, Element): Object}
         */

        // Original code:
        // this.povToPixel_ = (!!window.chrome || isMobile()) ? PanoMarker.povToPixel3d :
        //     PanoMarker.povToPixel2d;

        // New code (April 17, 2019) -- modified by Aileen
        // Source: https://github.com/marmat/google-maps-api-addons/issues/36#issuecomment-342774699
        this.povToPixel_ = PanoMarker.povToPixel2d;
        var pixelCanvas = document.createElement("canvas");

        if (pixelCanvas && (pixelCanvas.getContext("experimental-webgl") || pixelCanvas.getContext("webgl"))) {
            this.povToPixel_ = PanoMarker.povToPixel3d;
        }

        /** @private @type {google.maps.Point} */
        this.anchor_ = opts.anchor || new google.maps.Point(16, 16);

        /** @private @type {?string} */
        this.className_ = opts.className || null;

        /** @private @type {boolean} */
        this.clickable_ = opts.clickable || true;

        /** @private @type {?string} */
        this.icon_ = opts.icon || null;

        /** @private @type {?string} */
        this.id_ = opts.id || null;

        /** @private @ŧype {?HTMLDivElement} */
        this.marker_ = null;

        /** @private @type {?google.maps.StreetViewPanorama} */
        this.pano_ = null;

        /** @private @type {number} */
        this.pollId_ = -1;

        /** @private @type {google.maps.StreetViewPov} */
        this.position_ = opts.position || {heading: 0, pitch: 0};

        /** @private @type {Object} */
        this.povListener_ = null;

        /** @private @type {Object} */
        this.zoomListener_ = null;

        /** @private @type {google.maps.Size} */
        this.size_ = opts.size || new google.maps.Size(32, 32);

        /** @private @type {string} */
        this.title_ = opts.title || '';

        /** @private @type {boolean} */
        this.visible_ = (typeof opts.visible === 'boolean') ? opts.visible : true;

        /** @private @type {number} */
        this.zIndex_ = opts.zIndex || 1;

        /** @private @type {Object} */
        this.markerContainer_ = opts.markerContainer || null;

        /** @private @type {boolean} */
        this.toggleDescription_ = false;

        // At last, call some methods which use the initialized parameters
        this.setPano(opts.pano || null, opts.container);
    };

    PanoMarker.prototype = new google.maps.OverlayView();


//// Static helper methods for the position calculation ////


    /**
     * According to the documentation (goo.gl/WT4B57), the field-of-view angle
     * should precisely follow the curve of the form 180/2^zoom. Unfortunately, this
     * is not the case in practice in the 3D environment. From experiments, the
     * following FOVs seem to be more correct:
     *
     *        Zoom | best FOV | documented FOV
     *       ------+----------+----------------
     *          0  | 126.5    | 180
     *          1  | 90       | 90
     *          2  | 53       | 45
     *          3  | 28       | 22.5
     *          4  | 14.25    | 11.25
     *          5  | 7.25     | not specified
     *
     * Because of this, we are doing a linear interpolation for zoom values <= 2 and
     * then switch over to an inverse exponential. In practice, the produced
     * values are good enough to result in stable marker positioning, even for
     * intermediate zoom values.
     *
     * @return {number} The (horizontal) field of view angle for the given zoom.
     */
    PanoMarker.get3dFov = function(zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    };


    /**
     * Given the current POV, this method calculates the Pixel coordinates on the
     * given viewport for the desired POV. All credit for the math this method goes
     * to user3146587 on StackOverflow: http://goo.gl/0GGKi6
     *
     * My own approach to explain what is being done here (including figures!) can
     * be found at http://martinmatysiak.de/blog/view/panomarker
     *
     * @param {StreetViewPov} targetPov The point-of-view whose coordinates are
     *     requested.
     * @param {StreetViewPov} currentPov POV of the viewport center.
     * @param {number} zoom The current zoom level.
     * @param {Element} viewport The current viewport containing the panorama.
     * @return {Object} Top and Left offsets for the given viewport that point to
     *     the desired point-of-view.
     */
    PanoMarker.povToPixel3d = function(targetPov, currentPov, zoom, viewport) {

        // Gather required variables and convert to radians where necessary
        var width = viewport.offsetWidth;
        var height = viewport.offsetHeight;

        // Adjusts the width and height for when placing PanoMarkers on mobile phones.
        if (isMobile()) {
            width = window.innerWidth;
            height = window.innerHeight;
        }

        var target = {
            left: width / 2,
            top: height / 2
        };

        var DEG_TO_RAD = Math.PI / 180.0;
        var fov = PanoMarker.get3dFov(zoom) * DEG_TO_RAD;
        var h0 = currentPov.heading * DEG_TO_RAD;
        var p0 = currentPov.pitch * DEG_TO_RAD;
        var h = targetPov.heading * DEG_TO_RAD;
        var p = targetPov.pitch * DEG_TO_RAD;

        // f = focal length = distance of current POV to image plane
        var f = (width / 2) / Math.tan(fov / 2);

        // our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0)
        // calculate 3d coordinates of viewport center and target
        var cos_p = Math.cos(p);
        var sin_p = Math.sin(p);

        var cos_h = Math.cos(h);
        var sin_h = Math.sin(h);

        var x = f * cos_p * sin_h;
        var y = f * cos_p * cos_h;
        var z = f * sin_p;

        var cos_p0 = Math.cos(p0);
        var sin_p0 = Math.sin(p0);

        var cos_h0 = Math.cos(h0);
        var sin_h0 = Math.sin(h0);

        var x0 = f * cos_p0 * sin_h0;
        var y0 = f * cos_p0 * cos_h0;
        var z0 = f * sin_p0;

        var nDotD = x0 * x + y0 * y + z0 * z;
        var nDotC = x0 * x0 + y0 * y0 + z0 * z0;

        // nDotD == |targetVec| * |currentVec| * cos(theta)
        // nDotC == |currentVec| * |currentVec| * 1
        // Note: |currentVec| == |targetVec| == f

        // Sanity check: the vectors shouldn't be perpendicular because the line
        // from camera through target would never intersect with the image plane
        if (Math.abs(nDotD) < 1e-6) {
            return null;
        }

        // t is the scale to use for the target vector such that its end
        // touches the image plane. It's equal to 1/cos(theta) ==
        //     (distance from camera to image plane through target) /
        //     (distance from camera to target == f)
        var t = nDotC / nDotD;

        // Sanity check: it doesn't make sense to scale the vector in a negative
        // direction. In fact, it should even be t >= 1.0 since the image plane
        // is always outside the pano sphere (except at the viewport center)
        if (t < 0.0) {
            return null;
        }

        // (tx, ty, tz) are the coordinates of the intersection point between a
        // line through camera and target with the image plane
        var tx = t * x;
        var ty = t * y;
        var tz = t * z;

        // u and v are the basis vectors for the image plane
        var vx = -sin_p0 * sin_h0;
        var vy = -sin_p0 * cos_h0;
        var vz = cos_p0;

        var ux = cos_h0;
        var uy = -sin_h0;
        var uz = 0;

        // normalize horiz. basis vector to obtain orthonormal basis
        var ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        ux /= ul;
        uy /= ul;
        uz /= ul;

        // project the intersection point t onto the basis to obtain offsets in
        // terms of actual pixels in the viewport
        var du = tx * ux + ty * uy + tz * uz;
        var dv = tx * vx + ty * vy + tz * vz;

        // use the calculated pixel offsets
        target.left += du;
        target.top -= dv;
        return target;
    };


    /**
     * Helper function that converts the heading to be in the range [-180,180).
     *
     * @param {number} heading The heading to convert.
     */
    PanoMarker.wrapHeading = function(heading) {
        // We shift to the range [0,360) because of the way JS behaves for modulos of
        // negative numbers.
        heading = (heading + 180) % 360;

        // Determine if we have to wrap around
        if (heading < 0) {
            heading += 360;
        }

        return heading - 180;
    };


    /**
     * A simpler version of povToPixel2d which does not have to do the spherical
     * projection because the raw StreetView tiles are just panned around when the
     * user changes the viewport position.
     *
     * @param {StreetViewPov} targetPov The point-of-view whose coordinates are
     *     requested.
     * @param {StreetViewPov} currentPov POV of the viewport center.
     * @param {number} zoom The current zoom level.
     * @param {Element} viewport The current viewport containing the panorama.
     * @return {Object} Top and Left offsets for the given viewport that point to
     *     the desired point-of-view.
     */
    PanoMarker.povToPixel2d = function(targetPov, currentPov, zoom, viewport) {
        // Gather required variables
        var width = viewport.offsetWidth;
        var height = viewport.offsetHeight;

        var target = {
            left: width / 2,
            top: height / 2
        };

        // In the 2D environment, the FOV follows the documented curve.
        var hfov = 180 / Math.pow(2, zoom);
        var vfov = hfov * (height / width);
        var dh = PanoMarker.wrapHeading(targetPov.heading - currentPov.heading);
        var dv = targetPov.pitch - currentPov.pitch;

        target.left += dh / hfov * width;
        target.top -= dv / vfov * height;
        return target;
    };


//// Implementations for abstract methods inherited from g.m.OverlayView ////


    /** @override */
    PanoMarker.prototype.onAdd = function() {
        if (!!this.marker_) {
            // Sometimes the maps API does trigger onAdd correctly. We have to prevent
            // duplicate execution of the following code by checking if the marker node
            // has already been created.
            return;
        }

        var marker = document.createElement('div');
        marker.classList.add('icon-outline');

        // Basic style attributes for every marker
        marker.style.position = 'absolute';
        marker.style.cursor = 'inherit';    // To keep the mouseover icon open hand. See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1393
        marker.style.width = this.size_.width + 'px';
        marker.style.height = this.size_.height + 'px';
        marker.style.display = this.visible_ ? 'block' : 'none';
        marker.style.zIndex = this.zIndex_;

        // Set other css attributes based on the given parameters
        if (this.id_) { marker.id = this.id_; }
        if (this.className_) { marker.className = this.className_; }
        if (this.title_) { marker.title = this.title_; }
        if (this.icon_) { marker.style.backgroundImage = 'url(' + this.icon_ + ')'; }

        // If neither icon, class nor id is specified, assign the basic google maps
        // marker image to the marker (otherwise it will be invisible)
        if (!(this.id_ || this.className_ || this.icon_)) {
            marker.style.backgroundImage = 'url(https://www.google.com/intl/en_us/' +
                'mapfiles/ms/micons/red-dot.png)';
        }

        this.marker_ = marker;

        // Add marker to viewControlLayer if on validate page.
        if (this.markerContainer_ == null) {
            this.markerContainer_ = this.getPanes().overlayMouseTarget;
        }

        this.markerContainer_.appendChild(marker);

        // Attach to some global events
        window.addEventListener('resize', this.draw.bind(this));
        this.povListener_ = google.maps.event.addListener(this.getMap(),
            'pov_changed', this.draw.bind(this));
        this.zoomListener_ = google.maps.event.addListener(this.getMap(),
            'zoom_changed', this.draw.bind(this));

        var eventName = 'click';

        // Make clicks possible
        if (window.PointerEvent) {
            eventName = 'pointerdown';
        } else if (window.MSPointerEvent) {
            eventName = 'MSPointerDown';
        }

        marker.addEventListener(eventName, this.onClick.bind(this), false);

        // If this is a validation label, we want to add mouse-hovering event
        // for popped up hide/show label.
        if (this.id_ === "validate-pano-marker") {
            if (isMobile()) {
                marker.addEventListener('touchstart', function () {
                    let labelDescriptionBox = $("#label-description-box");
                    let desBox = labelDescriptionBox[0];
                    if (!this.toggleDescription_) {
                        desBox.style.right = (svv.canvasWidth - parseFloat(marker.style.left) - (parseFloat(marker.style.width) / 2)) + 'px';
                        desBox.style.top = (parseFloat(marker.style.top) + (parseFloat(marker.style.height) / 2)) + 'px';
                        desBox.style.zIndex = 2;
                        desBox.style.visibility = 'visible';
                        this.toggleDescription_ = true;
                    } else {
                        desBox.style.visibility = 'hidden';
                        this.toggleDescription_ = false;
                    }
                }.bind(this), false);
            } else {
                marker.addEventListener("mouseover", function () {
                    svv.labelVisibilityControl.showTagsAndDeleteButton();
                });

                marker.addEventListener("mouseout", function () {
                    svv.labelVisibilityControl.hideTagsAndDeleteButton();
                });
            }
        }

        this.draw();

        // Fire 'add' event once the marker has been created.
        google.maps.event.trigger(this, 'add', this.marker_);
    };


    /** @override */
    PanoMarker.prototype.draw = function() {
        if (!this.pano_) {
            return;
        }

        if (this.toggleDescription_) {
            let labelDescriptionBox = $("#label-description-box");
            let desBox = labelDescriptionBox[0];
            desBox.style.visibility = 'hidden';
            this.toggleDescription_ = false;
        }

        // Calculate the position according to the viewport. Even though the marker
        // doesn't sit directly underneath the panorama container, we pass it on as
        // the viewport because it has the actual viewport dimensions.
        var offset = this.povToPixel_(this.position_,
            this.pano_.getPov(),
            typeof this.pano_.getZoom() !== 'undefined' ? this.pano_.getZoom() : 1,
            this.container_);
        if (this.marker_) {
            if (offset !== null) {
                this.marker_.style.left = (offset.left - this.anchor_.x) + 'px';
                this.marker_.style.top = (offset.top - this.anchor_.y) + 'px';
            } else {
                // If offset is null, the marker is "behind" the camera,
                // therefore we position the marker outside of the viewport
                this.marker_.style.left = -(9999 + this.size_.width) + 'px';
                this.marker_.style.top = '0';
            }
        }
    };


    /** @param {Object} event The event object. */
    PanoMarker.prototype.onClick = function(event) {
        if (this.clickable_) {
            google.maps.event.trigger(this, 'click');
        }

        // don't let the event bubble up
        event.cancelBubble = true;
        if (event.stopPropagation) { event.stopPropagation(); }
    };


    /** @override */
    PanoMarker.prototype.onRemove = function() {
        if (!this.marker_) {
            // Similar to onAdd, we have to prevent duplicate onRemoves as well.
            return;
        }

        google.maps.event.removeListener(this.povListener_);
        google.maps.event.removeListener(this.zoomListener_);
        this.marker_.parentNode.removeChild(this.marker_);
        this.marker_ = null;

        // Fire 'remove' event once the marker has been destroyed.
        google.maps.event.trigger(this, 'remove');
    }

//// Getter to be roughly equivalent to the regular google.maps.Marker ////


    /** @return {google.maps.Point} The marker's anchor. */
    PanoMarker.prototype.getAnchor = function() { return this.anchor_; };


    /** @return {string} The className or null if not set upon marker creation. */
    PanoMarker.prototype.getClassName = function() { return this.className_; };


    /** @return {boolean} Whether the marker is clickable. */
    PanoMarker.prototype.getClickable = function() { return this.clickable_; };


    /** @return {string} The current icon, if any. */
    PanoMarker.prototype.getIcon = function() { return this.icon_; };


    /** @return {string} The identifier or null if not set upon marker creation. */
    PanoMarker.prototype.getId = function() { return this.id_; };

    /** @return {google.maps.StreetViewPanorama} The current panorama. */
    PanoMarker.prototype.getPano = function() { return this.pano_; };


    /** @return {google.maps.StreetViewPov} The marker's current position. */
    PanoMarker.prototype.getPosition = function() { return this.position_; };


    /** @return {google.maps.Size} The marker's size. */
    PanoMarker.prototype.getSize = function() { return this.size_; };


    /** @return {string} The marker's rollover text. */
    PanoMarker.prototype.getTitle = function() { return this.title_; };


    /** @return {boolean} Whether the marker is currently visible. */
    PanoMarker.prototype.getVisible = function() { return this.visible_; };


    /** @return {number} The marker's z-index. */
    PanoMarker.prototype.getZIndex = function() { return this.zIndex_; };

//// Setter for the properties mentioned above ////


    /** @param {google.maps.Point} anchor The marker's new anchor. */
    PanoMarker.prototype.setAnchor = function(anchor) {
        this.anchor_ = anchor;
        this.draw();
    };


    /** @param {string} className The new className. */
    PanoMarker.prototype.setClassName = function(className) {
        this.className_ = className;
        if (!!this.marker_) {
            this.marker_.className = className;
        }
    };


    /** @param {boolean} clickable Whether the marker shall be clickable. */
    PanoMarker.prototype.setClickable = function(clickable) {
        this.clickable_ = clickable;
    };


    /** @param {?string} icon URL to a new icon, or null in order to remove it. */
    PanoMarker.prototype.setIcon = function(icon) {
        this.icon_ = icon;
        if (!!this.marker_) {
            this.marker_.style.backgroundImage = !!icon ? 'url(' + icon + ')' : '';
        }
    };


    /** @param {string} id The new id. */
    PanoMarker.prototype.setId = function(id) {
        this.id_ = id;
        if (!!this.marker_) {
            this.marker_.id = id;
        }
    };


    /**
     * It turns out OverlayViews can be used with StreetViewPanoramas as well.
     * However, we have to fire onAdd and onRemove calls manually as they are not
     * triggered automatically for some reason if the object given to setMap is a
     * StreetViewPanorama.
     *
     * @param {google.maps.StreetViewPanorama} pano The panorama in which to show
     *    the marker.
     * @param {HTMLDivElement} container The container holding the panorama.
     */
    PanoMarker.prototype.setPano = function(pano, container) {
        // In contrast to regular OverlayViews, we are disallowing the usage on
        // regular maps
        if (!!pano && !(pano instanceof google.maps.StreetViewPanorama)) {
            throw 'PanoMarker only works inside a StreetViewPanorama.';
        }

        // Remove the marker if it previously was on a panorama
        if (!!this.pano_) {
            this.onRemove();
        }

        // Call method from superclass
        this.setMap(pano);
        this.pano_ = pano;
        this.container_ = container;

        // Fire the onAdd Event manually as soon as the pano is ready
        if (!!pano) {
            var promiseFn = function(resolve) {
                // Poll for panes to become available
                var pollCallback = function() {
                    if (!!this.getPanes()) {
                        window.clearInterval(this.pollId_);
                        this.onAdd();
                        if (resolve) { resolve(this); }
                    }
                };

                this.pollId_ = window.setInterval(pollCallback.bind(this), 10);
            };

            // Best case, the promiseFn can be wrapped in a Promise so the consumer knows when the pano is set
            // Otherwise just call the function immediately
            if (typeof Promise !== 'undefined') {
                return new Promise(promiseFn.bind(this));
            } else {
                promiseFn.call(this);
            }
        }
    };


    /** @param {google.maps.StreetViewPov} position The desired position. */
    PanoMarker.prototype.setPosition = function(position) {
        this.position_ = position;
        this.draw();
    };


    /** @param {google.maps.Size} size The new size. */
    PanoMarker.prototype.setSize = function(size) {
        this.size_ = size;
        if (!!this.marker_) {
            this.marker_.style.width = size.width + 'px';
            this.marker_.style.height = size.height + 'px';
            this.draw();
        }
    };


    /** @param {string} title The new rollover text. */
    PanoMarker.prototype.setTitle = function(title) {
        this.title_ = title;
        if (!!this.marker_) {
            this.marker_.title = title;
        }
    };


    /** @param {boolean} show Whether the marker shall be visible. */
    PanoMarker.prototype.setVisible = function(show) {
        this.visible_ = show;
        if (!!this.marker_) {
            this.marker_.style.display = show ? 'block' : 'none';
        }
    };


    /** @param {number} zIndex The new z-index. */
    PanoMarker.prototype.setZIndex = function(zIndex) {
        this.zIndex_ = zIndex;
        if (!!this.marker_) {
            this.marker_.style.zIndex = zIndex;
        }
    };

    return PanoMarker;
}));


/**
 * Displays info about the current GSV pane.
 *
 * @param {HTMLElement} container Element where the info button will be displayed
 * @param {StreetViewPanorama} panorama Panorama object
 * @param {function} coords Function that returns current longitude and latitude coordinates
 * @param {function} panoId Function that returns current panorama ID
 * @param {function} streetEdgeId Function that returns current Street Edge ID
 * @param {function} regionId Function that returns current Region ID
 * @param {function} pov Function that returns current POV
 * @param {Boolean} whiteIcon Set to true if using white icon, false if using blue icon.
 * @param {function} infoLogging Function that adds the info button click to the appropriate logs.
 * @param {function} clipboardLogging Function that adds the copy to clipboard click to the appropriate logs.
 * @param {function} viewGSVLogging Function that adds the View in GSV click to the appropriate logs.
 * @param {function} [labelId] Optional function that returns the Label ID.
 * @returns {GSVInfoPopover} Popover object, which holds the popover title html, content html, info button html, and
 * update values method
 */
function GSVInfoPopover (container, panorama, coords, panoId, streetEdgeId, regionId, pov, whiteIcon, infoLogging, clipboardLogging, viewGSVLogging, labelId) {
    let self = this;

    function _init() {
        // Create popover title bar.
        self.titleBox = document.createElement('div');

        let title = document.createElement('span');
        title.classList.add('popover-element');
        title.textContent = i18next.t('common:gsv-info.details-title');
        self.titleBox.appendChild(title);

        let clipboard = document.createElement('img');
        clipboard.classList.add('popover-element');
        clipboard.src = '/assets/images/icons/clipboard_copy.png';
        clipboard.id = 'clipboard';
        clipboard.setAttribute('data-toggle', 'popover');

        self.titleBox.appendChild(clipboard);

        // Create popover content.
        self.popoverContent = document.createElement('div');

        // Add in container for each info type to the popover.
        let dataList = document.createElement('ul');
        dataList.classList.add('list-group', 'list-group-flush', 'gsv-info-list-group');

        addListElement('latitude', dataList);
        addListElement('longitude', dataList);
        addListElement('panorama-id', dataList);
        addListElement('street-id', dataList);
        addListElement('region-id', dataList);
        if (labelId) addListElement('label-id', dataList);

        self.popoverContent.appendChild(dataList);

        // Create element for a link to GSV in a separate tab.
        let linkGSV = document.createElement('a');
        linkGSV.classList.add('popover-element');
        linkGSV.id = 'gsv-link'
        linkGSV.textContent = i18next.t('common:gsv-info.view-in-gsv');
        self.popoverContent.appendChild(linkGSV);

        // Create info button and add popover attributes.
        self.infoButton = document.createElement('img');
        self.infoButton.classList.add('popover-element');
        self.infoButton.id = 'gsv-info-button';
        if (whiteIcon) self.infoButton.src = '/assets/images/icons/gsv_info_btn_white.svg';
        else self.infoButton.src = '/assets/images/icons/gsv_info_btn.png';
        self.infoButton.setAttribute('data-toggle', 'popover');

        container.append(self.infoButton);

        // Enable popovers/tooltips and set options.
        $('#gsv-info-button').popover({
            html: true,
            placement: 'top',
            container: 'body',
            title: self.titleBox.innerHTML,
            content: self.popoverContent.innerHTML
        }).on('click', updateVals).on('shown.bs.popover', () => {
            // Add popover-element classes to more elements, making it easier to dismiss popover on when outside it.
            $('.popover-title').addClass('popover-element');
            $('.popover-content').addClass('popover-element');

            // Initialize the popover for the clipboard.
            $('#clipboard').popover({
                placement: 'top',
                trigger: 'manual',
                html: true,
                content: `<span class="clipboard-tooltip">${i18next.t('common:gsv-info.copied-to-clipboard')}</span>`
            });
        });

        // Dismiss popover when clicking outside it. Anything without the 'popover-element' class is considered outside.
        $(document).on('mousedown', (e) => {
            let tar = $(e.target);
            if (!tar[0].classList.contains('popover-element')) {
                $('#gsv-info-button').popover('hide');
            }
        });
        // Dismiss popover whenever panorama changes.
        panorama.addListener('pano_changed', () => {
            $('#gsv-info-button').popover('hide');
        })
    }

    /**
     * Update the values within the popover.
     */
    function updateVals() {
        // Log the click on the info button.
        infoLogging();

        // Get info values.
        const currCoords = coords ? coords() : {lat: null, lng: null};
        const currPanoId = panoId ? panoId() : null;
        const currStreetEdgeId = streetEdgeId ? streetEdgeId() : null;
        const currRegionId = regionId ? regionId() : null;
        const currPov = pov ? pov() : {heading: 0, pitch: 0};
        const currLabelId = labelId ? labelId() : null;

        function changeVals(key, val) {
            if (!val) {
                val = 'No Info';
            } else if (key === "latitude" || key === 'longitude') {
                val = val.toFixed(8) + '°';
            }
            let valSpan = document.getElementById(`${key}-value`);
            valSpan.textContent = val;
        }
        changeVals('latitude', currCoords.lat);
        changeVals('longitude', currCoords.lng);
        changeVals('panorama-id', currPanoId);
        changeVals('street-id', currStreetEdgeId);
        changeVals('region-id', currRegionId);
        if (currLabelId) changeVals('label-id', currLabelId);

        // Create GSV link and log the click.
        let gsvLink = $('#gsv-link');
        gsvLink.attr('href', `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${currCoords.lat}%2C${currCoords.lng}&heading=${currPov.heading}&pitch=${currPov.pitch}`);
        gsvLink.attr('target', '_blank');
        gsvLink.on('click', viewGSVLogging);

        // Position popover.
        let infoPopover = $('.popover');
        let infoRect = self.infoButton.getBoundingClientRect();
        let xpos = infoRect.x + (infoRect.width / 2) - (infoPopover.width() / 2);
        infoPopover.css('left', `${xpos}px`);

        // Copy to clipboard.
        $('#clipboard').on('click', function(e) {
            // Log the click on the copy to keyboard button.
            clipboardLogging();

            let clipboardText = `${i18next.t(`common:gsv-info.latitude`)}: ${currCoords.lat}°\n` +
                `${i18next.t(`common:gsv-info.longitude`)}: ${currCoords.lng}°\n` +
                `${i18next.t(`common:gsv-info.panorama-id`)}: ${currPanoId}\n` +
                `${i18next.t(`common:gsv-info.street-id`)}: ${currStreetEdgeId}\n` +
                `${i18next.t(`common:gsv-info.region-id`)}: ${currRegionId}\n`;
            if (currLabelId) clipboardText += `${i18next.t(`common:gsv-info.label-id`)}: ${currLabelId}`;
            navigator.clipboard.writeText(clipboardText);

            // The clipboard popover will only show one time until you close and reopen the info button popover. I have
            // no idea why that's happening, but for some reason it works if you put it in a setTimeout. So I have a one
            // ms delay before showing the popover. Then it disappears after 1.5 seconds.
            setTimeout(function() {
                $(e.target).popover('show');
                setTimeout(function() {
                    $(e.target).popover('hide');
                }, 1500);
            }, 1);
        });
    }

    /**
     * Creates a key-value pair display within the popover.
     * @param {String} key Key name of the key-value pair
     * @param {HTMLElement} dataList List element container to add list item to
     */
    function addListElement(key, dataList) {
        let listElement = document.createElement('li');
        listElement.classList.add('list-group-item', 'info-list-item', 'popover-element', 'audit-selectable');

        let keySpan = document.createElement('span');
        keySpan.classList.add('info-key', 'popover-element');
        keySpan.textContent = i18next.t(`common:gsv-info.${key}`);
        listElement.appendChild(keySpan);

        let valSpan = document.createElement('span');
        valSpan.classList.add('info-val', 'popover-element');
        valSpan.textContent = '-';
        valSpan.id = `${key}-value`

        listElement.appendChild(valSpan);
        dataList.appendChild(listElement);
    }

    _init();

    self.updateVals = updateVals;

    return self;
}
