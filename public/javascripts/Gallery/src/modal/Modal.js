/**
 * A Modal element that provides extended information about a label, along with placing a label in a GSV Panorama to 
 * aid the user in contextualizing the location of labels.
 * 
 * @param {HTMLElement} uiModal The container for the Modal in the DOM
 * @returns 
 */
function Modal(uiModal) {
    
    let self = this;

    const unselectedCardClassName = "modal-background-card";

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
        self.closeButton.click(closeModalAndRemoveCardTransparency)
        self.rightArrow.click(nextLabel)
        self.leftArrow.click(previousLabel)
        self.cardIndex = -1;
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
        // Centers the card thumbnail that was selected. If it's the last card, we shouldn't center (use "end").
        galleryCard.scrollIntoView({
            block: 'center',
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
        self.cardIndex = index;
        updateProperties(sg.cardContainer.getCardByIndex(index).getProperties());
        openModal();
        let page = sg.cardContainer.getCurrentPage();
        if (index > (page - 1) * 9) {
            self.leftArrow.prop('disabled', false);
        } else {
            self.leftArrow.prop('disabled', true);
        }
        if (index < page * 9 - 1) {
            self.rightArrow.prop('disabled', false);
        } else {
            self.rightArrow.prop('disabled', true);
        }
    }

    /**
     * Moves to the next label.
     */
    function nextLabel() {
        let page = sg.cardContainer.getCurrentPage();
        if (self.cardIndex < page * 9 - 1) {
            updateModalCardByIndex(self.cardIndex + 1);
        }
    }

    /**
     * Moves to the previous label.
     */
    function previousLabel() {
        let page = sg.cardContainer.getCurrentPage();
        if (self.cardIndex > (page - 1) * 9) {
            updateModalCardByIndex(self.cardIndex - 1);
        }
    }

    _init();

    self.closeModal = closeModal;
    self.updateCardIndex = updateCardIndex;

    return self;
}
