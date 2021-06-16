/**
 * A Modal element that provides extended information about a label, along with placing a label in a GSV Panorama to 
 * aid the user in contextualizing the location of labels.
 * 
 * @param {HTMLElement} uiModal The container for the Modal in the DOM
 * @returns 
 */
function Modal(uiModal) {
    
    let self = this;

    // Properties of the label in the card.
    let properties = {
        label_id: undefined,
        label_type: undefined,
        gsv_panorama_id: undefined,
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
        self.severity = $('.gallery-modal-info-severity')
        self.temporary = $('.gallery-modal-info-temporary')
        self.description = $('.gallery-modal-info-description')
        self.header = $('.gallery-modal-header')
        self.pano = new GalleryPanorama(self.panoHolder)
        self.closeButton = $('.gallery-modal-close')
        self.leftArrow = $('#prev-label')
        self.rightArrow = $('#next-label')
        self.closeButton.click(closeModal)
        self.rightArrow.click(nextLabel)
        self.leftArrow.click(previousLabel)
        self.cardIndex = -1;
    }

    /**
     * Performs the actions to close the Modal.
     */
    function closeModal() {
        $('.grid-container').css("grid-template-columns", "1fr 3fr");
        uiModal.hide();
    }

    /**
     * Resets the fields of the Modal.
     */
    function resetModal() {
        self.description.empty();
        self.temporary.empty();
        self.severity.empty();
    }

    /**
     * Populates the information in the Modal.
     */
    function populateModalDescriptionFields() {
        // Add severity and tag display to the modal.
        new SeverityDisplay(self.severity, properties.severity, true);
        new TagDisplay(self.tags, properties.tags, true);

        // Add the information about the temporary property to the Modal.
        let temporaryHeader = document.createElement('div');
        let temporaryText = properties.temporary ? "Yes" : "No";
        temporaryHeader.innerHTML = `<div><b>${i18next.t("temporary")}</b></div><div>${temporaryText}</div>`;
        self.temporary.append(temporaryHeader);

        // Add the information about the description of the label to the Modal.
        let descriptionText = properties.description === null ? "" : properties.description;
        let descriptionObject = document.createElement('div');
        descriptionObject.innerHTML = `<div><b>${i18next.t("description")}</b></div><div>${descriptionText}</div>`;
        self.description.append(descriptionObject);
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

    self.updateProperties = updateProperties;
    self.openModal = openModal;
    self.updateCardIndex = updateCardIndex;

    return self;
}
