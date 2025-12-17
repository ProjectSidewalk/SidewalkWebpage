/**
 * An ExpandedView element that provides extended information about a label, along with placing a label in a GSV Panorama
 * to aid the user in contextualizing the location of labels.
 *
 * @param {HTMLElement} uiModal The container for the ExpandedView in the DOM
 * @returns
 */
function ExpandedView(uiModal) {

    let self = this;

    const cardsPerPage = 9;
    const unselectedCardClassName = "expanded-view-background-card";

    // Observes the card container so that once cards are rendered (added to DOM), we can reopen the expanded view.
    // We need this because the prev/next page actions are asynchronous (they query the backend), so before reopening
    // the expanded view on a new page, we need to make sure the cards have actually been rendered in gallery view.
    const observer = new MutationObserver((mutationsList, observer) => {
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // We check to make sure that the mutation effects the childList (adding/removing child nodes) of the
                // card container and that cards (child nodes) were added in the mutation, indicating the cards have
                // been rendered.
                $('.gallery-expanded-view').attr('style', 'display: flex');
                $('.grid-container').css("grid-template-columns", "1fr 5fr");

                // Sets/Updates the label being displayed in the expanded view.
                updateExpandedViewCardByIndex(self.cardIndex);

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
        image_capture_date: undefined,
        label_timestamp: undefined,
        heading: undefined,
        pitch: undefined,
        zoom: undefined,
        original_canvas_x: undefined,
        original_canvas_y: undefined,
        severity: undefined,
        description: undefined,
        street_edge_id: undefined,
        region_id: undefined,
        val_counts: undefined,
        correctness: undefined,
        user_validation: undefined,
        ai_validation: undefined,
        tags: [],
        ai_generated: false
    };

    /**
     * Initialization function for the ExpandedView. Serves to bind the DOM elements of the ExpandedView to class
     * variables for future access when populating the fields. It also instantiates the GSV panorama in the specified
     * location of the ExpandedView.
     */
    function _init() {
        self.open = false;
        self.panoHolder = $('.actual-pano');
        self.tags = $('.gallery-expanded-view-info-tags');
        self.timestamps = $('.gallery-expanded-view-info-timestamps');
        self.severity = $('.gallery-expanded-view-info-severity');
        self.validation_info = $('.gallery-expanded-view-info-validation');
        self.description = $('.gallery-expanded-view-info-description');
        self.header = $('.gallery-expanded-view-header');
        self.pano = new GalleryPanorama(self.panoHolder);
        self.closeButton = $('.gallery-expanded-view-close');
        self.leftArrow = $('#prev-label');
        self.leftArrowDisabled = false;
        self.rightArrow = $('#next-label');
        self.rightArrowDisabled = false;
        self.validation = $('.gallery-modal-validation');
        self.closeButton.click(closeExpandedViewAndRemoveCardTransparency);
        self.rightArrow.click(function() { nextLabel(false); });
        self.leftArrow.click(function() { previousLabel(false); });
        self.cardIndex = -1;
        self.validationMenu = new ValidationMenu(null, self.panoHolder, null, self, true);

        attachEventHandlers();
    }

    /**
     * Performs the actions to close the expanded view.
     * NOTE does not remove card transparency. For that, use closeExpandedViewAndRemoveCardTransparency().
     */
    function closeExpandedView() {
        // Since we have made the sidebar a "fixed" DOM element, it no longer exists as part of the grid flow. Thus,
        // when we aren't in expanded view mode, the only thing that is part of the grid is the image-container. We
        // therefore shouldn't need to divide the grid into columns (changed "0.5fr 3fr" to "none").
        // Disclaimer: I could be totally wrong lol.
        $('.grid-container').css("grid-template-columns", "none");
        uiModal.hide();
        self.open = false;
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
     * Closes expanded view and removes transparency from cards on the current page.
     * Not used when loading a new page of cards.
     */
    function closeExpandedViewAndRemoveCardTransparency() {
        closeExpandedView();
        removeCardTransparency();
    }

    /**
     * Resets the fields of the expanded view.
     */
    function resetExpandedView() {
        self.description.empty();
        self.validation_info.empty()
        self.severity.empty();
        self.timestamps.empty();
    }

    /**
     * Populates the information in the expanded view.
     */
    function populateExpandedViewDescriptionFields() {
        // Add timestamp data for when label was placed and when pano was created.
        self.labelTimestampData = document.createElement('div');
        self.labelTimestampData.className = 'label-timestamp';
        self.labelTimestampData.innerHTML = `<div>${i18next.t('labeled')}: ${properties.label_timestamp.format('LL, LT')}</div>`;
        let panoTimestampData = document.createElement('div');
        panoTimestampData.className = 'pano-timestamp';
        panoTimestampData.innerHTML = `<div>${i18next.t('image-capture-date')}: ${properties.image_capture_date.format('MMM YYYY')}</div>`;
        self.timestamps.append(self.labelTimestampData);
        self.timestamps.append(panoTimestampData);

        // Add info button to the right of the label timestamp.
        let getPanoId = sg.expandedView().pano.getPanoId;
        self.infoPopover = new GSVInfoPopover(self.labelTimestampData, sg.expandedView().pano.panorama,
            sg.expandedView().pano.getPosition, getPanoId,
            function() { return properties['street_edge_id']; }, function() { return properties['region_id']; },
            function() { return properties['image_capture_date']; },
            function() { return self.pano.panorama.location.shortDescription; }, sg.expandedView().pano.getPov,
            sg.cityName, false, function() { sg.tracker.push('GSVInfoButton_Click', { panoId: getPanoId() }); },
            function() { sg.tracker.push('GSVInfoCopyToClipboard_Click', { panoId: getPanoId() }); },
            function() { sg.tracker.push('GSVInfoViewInGSV_Click', { panoId: getPanoId() }); },
            function() { return properties['label_id']; }, function() { return properties['label_timestamp']; }
        );

        // Add severity, validation info, and tag display to the expanded view.
        new SeverityDisplay(self.severity, properties.severity, properties.label_type, true);
        self.validationInfoDisplay = new ValidationInfoDisplay(
            self.validation_info, properties.val_counts['Agree'], properties.val_counts['Disagree'], properties.ai_validation, true
        );
        new TagDisplay(self.tags, properties.tags, true);
        self.validationMenu.addExpandedViewValInfoOnClicks(self.validationInfoDisplay);

        // Add the information about the description of the label to the expanded view.
        let descriptionHeader = document.createElement('div');
        descriptionHeader.className = 'expanded-view-description-header';
        descriptionHeader.innerHTML = i18next.t("description");
        let descriptionBody = document.createElement('div');
        descriptionBody.className = 'expanded-view-description-body';
        descriptionBody.textContent = properties.description === null ? i18next.t('no-description') : properties.description;
        self.description.append(descriptionHeader);
        self.description.append(descriptionBody);
    }

    /**
     * Performs the actions needed to open the expanded view.
     */
    function openExpandedView() {
        resetExpandedView();
        self.open = true;
        populateExpandedViewDescriptionFields();
        self.pano.setPano(properties.gsv_panorama_id, properties.heading, properties.pitch, properties.zoom);
        self.pano.renderLabel(self.label);
        self.header.text(i18next.t(util.camelToKebab(properties.label_type)));

        // Highlight selected card thumbnail.
        highlightThumbnail(document.getElementById("gallery_card_" + properties.label_id));
    }

    function highlightThumbnail(galleryCard) {
        // Reset the sidebar as sticky as the sidebar should never be under the card container
        // upon opening the expanded view.
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
     * @param newProps The new properties to push into the ExpandedView
     */
    function updateProperties(newProps) {
        for (const attrName in newProps) {
            // Add all the properties. Format the timestamps using the moment library.
            if (attrName === 'label_timestamp' || attrName === 'image_capture_date') {
                properties[attrName] = moment(newProps[attrName]);
            } else if (newProps.hasOwnProperty(attrName) && properties.hasOwnProperty(attrName)) {
                properties[attrName] = newProps[attrName];
            }
        }
        self.label = new GalleryPanoramaLabel(
            properties.label_id, properties.label_type, properties.original_canvas_x, properties.original_canvas_y,
            util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, properties.heading, properties.pitch, properties.zoom,
            properties.ai_generated
        );

        self.validationMenu.updateCardProperties(properties);
        self.validationMenu.updateReferenceCard(sg.cardContainer.getCardByIndex(self.cardIndex));
    }

    function getProperty(key) {
        return properties[key];
    }

    /**
     * Updates the index of the current label being displayed in the expanded view.
     *
     * @param {Number} newIndex The new index of the card being displayed
     */
    function updateCardIndex(newIndex) {
        updateExpandedViewCardByIndex(newIndex);
    }

    /**
     * Tries to update the current card to the given input index.
     *
     * @param {Number} index The index of the card to update to
     */
    function updateExpandedViewCardByIndex(index) {
        self.leftArrow.prop('disabled', false);
        self.leftArrowDisabled = false;
        self.rightArrow.prop('disabled', false);
        self.rightArrowDisabled = false;
        self.cardIndex = index;
        updateProperties(sg.cardContainer.getCardByIndex(index).getProperties());
        openExpandedView();
        if (self.cardIndex === 0) {
            self.leftArrow.prop('disabled', true);
            self.leftArrowDisabled = true;
        }

        if (sg.cardContainer.isLastPage()) {
            let page = sg.cardContainer.getCurrentPage();
            let lastCardIndex = (page - 1) * cardsPerPage + sg.cardContainer.getCurrentPageCards().length - 1;
            if (self.cardIndex === lastCardIndex) {
                // The current page is the last page and the current card being rendered is the last card on the page.
                self.rightArrow.prop('disabled', true);
                self.rightArrowDisabled = true;
            }
        }
    }

    /**
     * Moves to the next label.
     * @param keyboardShortcut {Boolean} Whether the action came from a keyboard shortcut.
     */
    function nextLabel(keyboardShortcut) {
        sg.tracker.push(`NextLabel${keyboardShortcut ? 'KeyboardShortcut' : 'Click'}`);
        let page = sg.cardContainer.getCurrentPage();
        if (self.cardIndex < page * cardsPerPage - 1) {
            // Iterate to next card on the page, updating the label being shown in the expanded view to be
            // that of the next card.
            updateExpandedViewCardByIndex(self.cardIndex + 1);
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
     * @param keyboardShortcut {Boolean} Whether the action came from a keyboard shortcut.
     */
    function previousLabel(keyboardShortcut) {
        sg.tracker.push(`PrevLabel${keyboardShortcut ? 'KeyboardShortcut' : 'Click'}`);
        let page = sg.cardContainer.getCurrentPage();
        if (self.cardIndex > (page - 1) * cardsPerPage) {
            // Iterate to previous card on the page, updating the label being shown in the expanded view to be
            // that of the previous card.
            updateExpandedViewCardByIndex(self.cardIndex - 1);
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

    // Increment zoom by 1 or to the maximum zoom level (3).
    function zoomIn() {
        if (self.open) {
            sg.tracker.push("KeyboardShortcutZoomIn");
            const panorama = self.pano.panorama;
            if (panorama) {
                const currentZoom = panorama.getZoom();
                const newZoom = Math.min(3, currentZoom + 1);
                panorama.setZoom(newZoom);
            }
        }
    }

    // Decrement zoom level by 1 or to the minimum zoom level (1).
    function zoomOut() {
        if (self.open) {
            sg.tracker.push("KeyboardShortcutZoomOut");
            const panorama = self.pano.panorama;
            if (panorama) {
                const currentZoom = panorama.getZoom();
                const newZoom = Math.max(1, currentZoom - 1);
                panorama.setZoom(newZoom);
            }
        }
    }

    /**
     * Attach any specific event handlers for expanded view contents.
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
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE &&
                            node.className &&
                            typeof node.className === 'string' &&
                            node.className.indexOf('widget-scene-canvas') > -1) {

                            // Add event listeners to the new element.
                            node.addEventListener('mousedown', handlerViewControlLayerMouseDown);
                            node.addEventListener('mouseup', handlerViewControlLayerMouseUp);

                            observer.disconnect();
                        }
                    });
                }
            });
        });

        // Start observing the target node for configured mutations.
        observer.observe(document.querySelector('.actual-pano'), {
            childList: true,
            subtree: true
        });
    }

    _init();

    self.closeExpandedView = closeExpandedView;
    self.updateCardIndex = updateCardIndex;
    self.getProperty = getProperty;
    self.nextLabel = nextLabel;
    self.previousLabel = previousLabel;
    self.zoomIn = zoomIn;
    self.zoomOut = zoomOut;
    self.closeExpandedViewAndRemoveCardTransparency = closeExpandedViewAndRemoveCardTransparency;


    return self;
}
