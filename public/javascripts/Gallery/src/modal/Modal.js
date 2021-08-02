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

    let cardReference = null;
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
                $('.grid-container').css("grid-template-columns", "1fr 2fr 3fr");
    
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
        user_validation: undefined,
        tags: []
    };

    /**
     * Initialization function for the Modal. Serves to bind the DOM elements of the Modal to class variables for future
     * access when populating the fields. It also instantiates the GSV panorama in the specified location of the Modal.
     */
    function _init() {
        self.panoHolder = $('.actual-pano')
        self.tags = $('.gallery-modal-info-tags')
        self.timestamps = $('.gallery-modal-info-timestamps');
        self.severity = $('.gallery-modal-info-severity')
        self.temporary = $('.gallery-modal-info-temporary')
        self.description = $('.gallery-modal-info-description')
        self.header = $('.gallery-modal-header')
        self.pano = new GalleryPanorama(self.panoHolder)
        self.closeButton = $('.gallery-modal-close')
        self.leftArrow = $('#prev-label')
        self.rightArrow = $('#next-label')
        self.validation = $('.gallery-modal-validation')
        self.closeButton.click(closeModalAndRemoveCardTransparency)
        self.rightArrow.click(nextLabel)
        self.leftArrow.click(previousLabel)
        self.cardIndex = -1;
        self.validationMenu = new ValidationMenu(self.panoHolder, null, false)
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
        let labelTimestampData = document.createElement('div');
        labelTimestampData.className = 'label-timestamp';
        labelTimestampData.innerHTML = `<div>${i18next.t('labeled')}: ${moment(new Date(properties.label_timestamp)).format('LL, LT')}</div>`;
        let panoTimestampData = document.createElement('div');
        panoTimestampData.className = 'pano-timestamp';
        panoTimestampData.innerHTML = `<div>${i18next.t('image-date')}: ${moment(properties.image_date).format('MMM YYYY')}</div>`;
        self.timestamps.append(labelTimestampData);
        self.timestamps.append(panoTimestampData);

        // Add severity and tag display to the modal.
        new SeverityDisplay(self.severity, properties.severity, true);
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

        // Add the validation buttons
        
    }

    /**
     * Performs the actions needed to open the modal.
     */
    function openModal() {
        resetModal();
        populateModalDescriptionFields();
        self.pano.setPano(properties.gsv_panorama_id, properties.heading, properties.pitch, properties.zoom);
        self.pano.renderLabel(self.label);
        self.header.text(i18next.t('gallery.' + properties.label_type));

        // Highlight selected card thumbnail.
        highlightThumbnail(document.getElementById("gallery_card_" + properties.label_id));
    }

    function highlightThumbnail(galleryCard) {
        // Centers the card thumbnail that was selected. If it's the last card, we scroll such that the card is at the
        // bottom of the visible window.
        let index = self.cardIndex;
        let page = sg.cardContainer.getCurrentPage();
        galleryCard.scrollIntoView({
            block: (index < page * cardsPerPage - 1) ? 'center' : 'end',
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
            if (cardLabelId != properties.label_id) {
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
        console.log('next label');
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

    _init();

    self.closeModal = closeModal;
    self.updateCardIndex = updateCardIndex;

    return self;
}
