/**
 * Gallery ExpandedView — inline wrapper around the shared LabelDetail controller.
 *
 * Hosts LabelDetail inside a `.label-detail.label-detail--inline` container. Manages open/close visibility, prev/next
 * paging, thumbnail highlighting, card transparency, and syncing validation results back onto the small cards.
 *
 * @param {jQuery} uiModal The `.gallery-expanded-view` container element.
 * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize.
 * @param {string} viewerAccessToken An access token used to request images for the pano viewer.
 * @returns {Promise<ExpandedView>}
 */
async function ExpandedView(uiModal, panoViewerType, viewerAccessToken) {

    const self = this;

    const cardsPerPage = 9;
    const unselectedCardClassName = 'expanded-view-background-card';
    const root = uiModal[0]; // Unwrap jQuery to get the DOM element for LabelDetail.

    /**
     * Initialization: instantiate LabelDetail inside the host root, then wire up close and paging buttons.
     */
    async function _init() {
        self.open = false;
        self.cardIndex = -1;
        self.refCard = null;
        self.pendingCardIndex = undefined; // Set by nextLabel/previousLabel for cross-page navigation.

        // Initialize the shared LabelDetail controller inside our inline host.
        self.labelDetail = await LabelDetail(root, {
            admin: false,
            viewerType: panoViewerType,
            viewerAccessToken: viewerAccessToken,
            currUsername: null,
            onVote: _handleVote,
            panoOverlaySource: 'GalleryExpandedImage',
            voteColumnSource: 'GalleryExpandedThumbs'
        });

        // Expose panoManager for Keyboard.js zoom shortcuts.
        self.panoManager = self.labelDetail.panoManager;

        // Wire paging buttons.
        self.leftArrow = root.querySelector('.label-detail__paging--prev');
        self.rightArrow = root.querySelector('.label-detail__paging--next');
        self.leftArrowDisabled = false;
        self.rightArrowDisabled = false;
        if (self.leftArrow) self.leftArrow.addEventListener('click', () => previousLabel(false));
        if (self.rightArrow) self.rightArrow.addEventListener('click', () => nextLabel(false));

        // Wire close button.
        const closeBtn = root.querySelector('[data-action="close-label-detail"]');
        if (closeBtn) closeBtn.addEventListener('click', closeExpandedViewAndRemoveCardTransparency);

        _attachCursorHandlers();
    }

    /**
     * Converts a Gallery Card's properties into the meta object shape that LabelDetail.showLabel() expects.
     * @param {Card} card
     * @returns {object} A meta object compatible with LabelDetail._handleData().
     */
    function _cardToMeta(card) {
        const p = card.getProperties();
        return {
            label_id: p.label_id,
            label_type: p.label_type,
            pano_id: p.pano_id,
            camera_lat: p.camera_lat,
            camera_lng: p.camera_lng,
            // Moment objects → raw date strings so LabelDetail can reparse them uniformly.
            image_capture_date: p.image_capture_date.toISOString(),
            timestamp: p.label_timestamp.toISOString(),
            heading: p.heading,
            pitch: p.pitch,
            zoom: p.zoom,
            canvas_x: p.original_canvas_x,
            canvas_y: p.original_canvas_y,
            severity: p.severity,
            description: p.description,
            street_edge_id: p.street_edge_id,
            region_id: p.region_id,
            num_agree: p.val_counts.Agree,
            num_disagree: p.val_counts.Disagree,
            num_unsure: p.val_counts.Unsure,
            user_validation: p.user_validation,
            ai_validation: p.ai_validation,
            tags: p.tags,
            ai_generated: p.ai_generated,
            crop_url: card.getCropUrl(),
            from_current_user: p.from_current_user,
            expired: p.expired,
            comments: p.comments
        };
    }

    /**
     * Called by LabelDetail after a successful validation POST. Syncs the new vote back onto the small card.
     * @param {'Agree'|'Disagree'|'Unsure'} action
     */
    function _handleVote(action) {
        if (self.refCard) {
            self.refCard.updateUserValidation(action);
        }
    }

    /**
     * Opens the expanded view for the current refCard by passing the card data to LabelDetail.
     */
    function openExpandedView() {
        // Clear the close-guard so the in-flight pano load is allowed to show once this card's load completes.
        const panoEl = root.querySelector('.label-detail__pano');
        if (panoEl) delete panoEl.dataset.closedDuringLoad;

        const meta = _cardToMeta(self.refCard);
        self.labelDetail.showLabel(meta, 'Gallery');

        // Highlight selected card thumbnail.
        highlightThumbnail(document.getElementById('gallery_card_' + self.refCard.getLabelId()));
        self.open = true;
    }

    /**
     * Performs the actions to close the expanded view.
     * NOTE: does not remove card transparency. For that, use closeExpandedViewAndRemoveCardTransparency().
     */
    function closeExpandedView() {
        $('.grid-container').css('grid-template-columns', 'none');
        uiModal.css('position', 'absolute');
        uiModal.css('visibility', 'hidden');
        // Clear the inline visibility set by PopupPanoManager.setPano() so the parent's visibility:hidden cascades.
        // Also set a data flag so that if a pano load is still in-flight, it won't reveal itself when it finishes.
        const panoEl = root.querySelector('.label-detail__pano');
        if (panoEl) {
            panoEl.style.visibility = '';
            panoEl.dataset.closedDuringLoad = 'true';
        }
        self.open = false;
    }

    /**
     * Removes transparency from the current page of cards.
     */
    function removeCardTransparency() {
        const currentPageCards = sg.cardContainer.getCurrentPageCards();
        for (const card of currentPageCards) {
            const cardDomEl = document.getElementById('gallery_card_' + card.getLabelId());
            if (cardDomEl && cardDomEl.classList.contains(unselectedCardClassName)) {
                cardDomEl.classList.remove(unselectedCardClassName);
            }
        }
    }

    /**
     * Closes expanded view, removes transparency from cards, and scrolls the reference card to the top of the viewport.
     */
    function closeExpandedViewAndRemoveCardTransparency() {
        const cardToScrollTo = self.refCard;
        closeExpandedView();
        removeCardTransparency();
        if (cardToScrollTo) {
            requestAnimationFrame(() => {
                const cardEl = document.getElementById('gallery_card_' + cardToScrollTo.getLabelId());
                if (cardEl) {
                    const navbar = document.getElementById('header');
                    const navbarHeight = navbar ? navbar.offsetHeight : 0;
                    const cardMarginTop = parseFloat(window.getComputedStyle(cardEl).marginTop) || 0;
                    const targetScrollY = cardEl.getBoundingClientRect().top + window.scrollY - navbarHeight - cardMarginTop;
                    window.scrollTo({ top: targetScrollY, behavior: 'smooth' });
                }
            });
        }
    }

    /**
     * Tries to update the current card to the given input index.
     * @param {number} index The index of the card to update to.
     */
    function updateExpandedViewCardByIndex(index) {
        if (self.leftArrow) { self.leftArrow.disabled = false; self.leftArrowDisabled = false; }
        if (self.rightArrow) { self.rightArrow.disabled = false; self.rightArrowDisabled = false; }
        self.cardIndex = index;
        self.refCard = sg.cardContainer.getCardByIndex(self.cardIndex);

        openExpandedView();

        if (self.cardIndex === 0) {
            if (self.leftArrow) self.leftArrow.disabled = true;
            self.leftArrowDisabled = true;
        }

        if (sg.cardContainer.isLastPage()) {
            const page = sg.cardContainer.getCurrentPage();
            const lastCardIndex = (page - 1) * cardsPerPage + sg.cardContainer.getCurrentPageCards().length - 1;
            if (self.cardIndex === lastCardIndex) {
                if (self.rightArrow) self.rightArrow.disabled = true;
                self.rightArrowDisabled = true;
            }
        }
    }

    /**
     * Updates the index of the current label being displayed in the expanded view.
     * @param {number} newIndex The new index of the card being displayed.
     */
    function updateCardIndex(newIndex) {
        updateExpandedViewCardByIndex(newIndex);
    }

    /**
     * Moves to the next label.
     * @param {boolean} keyboardShortcut Whether the action came from a keyboard shortcut.
     */
    function nextLabel(keyboardShortcut) {
        sg.tracker.push(`NextLabel${keyboardShortcut ? 'KeyboardShortcut' : 'Click'}`);
        const page = sg.cardContainer.getCurrentPage();
        if (self.cardIndex < page * cardsPerPage - 1) {
            updateExpandedViewCardByIndex(self.cardIndex + 1);
        } else {
            self.cardIndex += 1;
            self.pendingCardIndex = self.cardIndex;
            sg.ui.cardContainer.nextPage.click();
        }
    }

    /**
     * Moves to the previous label.
     * @param {boolean} keyboardShortcut Whether the action came from a keyboard shortcut.
     */
    function previousLabel(keyboardShortcut) {
        sg.tracker.push(`PrevLabel${keyboardShortcut ? 'KeyboardShortcut' : 'Click'}`);
        const page = sg.cardContainer.getCurrentPage();
        if (self.cardIndex > (page - 1) * cardsPerPage) {
            updateExpandedViewCardByIndex(self.cardIndex - 1);
        } else {
            self.cardIndex -= 1;
            self.pendingCardIndex = self.cardIndex;
            sg.ui.cardContainer.prevPage.click();
        }
    }

    /**
     * Highlights the selected thumbnail and dims the rest of the cards on the page.
     * @param {HTMLElement} galleryCard
     */
    function highlightThumbnail(galleryCard) {
        // Reset the sidebar as sticky.
        sg.ui.cardFilter.wrapper.css('position', 'fixed');
        sg.ui.cardFilter.wrapper.css('top', '');
        sg.ui.cardContainer.holder.css('margin-left', sg.ui.cardFilter.wrapper.css('width'));
        sg.scrollStatus.stickySidebar = true;

        // Scroll the selected card into view.
        const index = self.cardIndex;
        const page = sg.cardContainer.getCurrentPage();
        const totalCards = sg.cardContainer.getCurrentCards().getSize();
        galleryCard.scrollIntoView({
            block: (index < page * cardsPerPage - 1 && index < totalCards - 1) ? 'center' : 'end',
            behavior: 'smooth'
        });

        // Remove transparent effect from selected card.
        galleryCard.classList.remove(unselectedCardClassName);

        // The rest of the cards should be semitransparent.
        const currentPageCards = sg.cardContainer.getCurrentPageCards();
        for (const card of currentPageCards) {
            const cardLabelId = card.getLabelId();
            if (cardLabelId !== self.refCard.getLabelId()) {
                const cardDomEl = document.getElementById('gallery_card_' + cardLabelId);
                if (cardDomEl && !cardDomEl.classList.contains(unselectedCardClassName)) {
                    cardDomEl.classList.add(unselectedCardClassName);
                }
            }
        }
    }

    /**
     * Returns the reference card currently being displayed.
     * @returns {Card}
     */
    function getReferenceCard() {
        return self.refCard;
    }

    /**
     * Called by CardContainer after new cards have been rendered to the DOM. If a cross-page navigation
     * was pending (i.e., the user clicked next/prev from the last/first card on a page), reopens the
     * expanded view for the target card on the new page.
     */
    function onPageCardsRendered() {
        if (self.pendingCardIndex === undefined) return;
        const idx = self.pendingCardIndex;
        self.pendingCardIndex = undefined;
        uiModal.css('top', `calc(${$(window).scrollTop()}px + 1vh)`);
        uiModal.css('visibility', 'visible');
        uiModal.css('position', 'relative');
        $('.grid-container').css('grid-template-columns', '1fr 5fr');
        updateExpandedViewCardByIndex(idx);
    }

    /**
     * Sets up cursor handlers for the GSV widget-scene-canvas inside the pano.
     */
    function _attachCursorHandlers() {
        const panoEl = root.querySelector('.label-detail__pano');
        if (!panoEl) return;

        const cursorObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE &&
                            node.className &&
                            typeof node.className === 'string' &&
                            node.className.indexOf('widget-scene-canvas') > -1) {
                            node.addEventListener('mousedown', () => {
                                $(node).css('cursor', 'url(/assets/images/icons/closedhand.cur) 4 4, move');
                            });
                            node.addEventListener('mouseup', () => {
                                $(node).css('cursor', '');
                            });
                            cursorObserver.disconnect();
                        }
                    });
                }
            });
        });

        cursorObserver.observe(panoEl, { childList: true, subtree: true });
    }

    await _init();

    /**
     * Programmatically triggers a validation from the expanded view (used by Keyboard.js shortcuts).
     * Clicks the corresponding pano overlay button in the LabelDetail markup, which goes through
     * LabelDetail's normal vote flow (including the onVote callback that syncs back to the card).
     * @param {'Agree'|'Disagree'|'Unsure'} action
     */
    function validate(action) {
        if (!self.open) return;
        const btn = root.querySelector(`.label-detail__pano-overlay-button--${action.toLowerCase()}`);
        if (btn && !btn.disabled) btn.click();
    }

    self.closeExpandedView = closeExpandedView;
    self.updateCardIndex = updateCardIndex;
    self.getReferenceCard = getReferenceCard;
    self.nextLabel = nextLabel;
    self.previousLabel = previousLabel;
    self.closeExpandedViewAndRemoveCardTransparency = closeExpandedViewAndRemoveCardTransparency;
    self.validate = validate;
    self.onPageCardsRendered = onPageCardsRendered;

    return self;
}
